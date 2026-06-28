-- =============================================================================
-- VSP — RLS, partitions, hash-chained audit, hot-path indexes
-- Run AFTER `prisma migrate dev` has created the base tables.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── GUC helpers ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_current_workspace() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true), 'off') = 'on'
$$;

-- ─── RLS on workspace-scoped tables ─────────────────────────────────────────
ALTER TABLE workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE downloads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE playback_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation ON workspaces
  USING (app_bypass() OR id = app_current_workspace());

CREATE POLICY project_access ON projects
  USING (
    app_bypass()
    OR (workspace_id = app_current_workspace()
        AND (
          EXISTS (SELECT 1 FROM workspace_members m
                   WHERE m.workspace_id = projects.workspace_id
                     AND m.user_id = app_current_user())
          OR EXISTS (SELECT 1 FROM project_clients c
                   WHERE c.project_id = projects.id
                     AND c.user_id = app_current_user()
                     AND c.removed_at IS NULL)
        ))
  );

CREATE POLICY asset_workspace ON assets
  USING (
    app_bypass()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = assets.project_id
        AND p.workspace_id = app_current_workspace()
    )
  );

CREATE POLICY asset_version_access ON asset_versions
  USING (
    app_bypass()
    OR EXISTS (
      SELECT 1 FROM assets a
      JOIN projects p ON p.id = a.project_id
      WHERE a.id = asset_versions.asset_id
        AND p.workspace_id = app_current_workspace()
    )
  );

CREATE POLICY comment_read ON comments FOR SELECT
  USING (
    app_bypass()
    OR EXISTS (SELECT 1 FROM asset_versions v WHERE v.id = comments.asset_version_id)
  );

CREATE POLICY comment_write ON comments FOR INSERT
  WITH CHECK (
    app_bypass()
    OR author_user_id = app_current_user()
    OR author_share_view_id IS NOT NULL
  );

CREATE POLICY approval_read ON approvals FOR SELECT
  USING (
    app_bypass()
    OR EXISTS (SELECT 1 FROM asset_versions v WHERE v.id = approvals.asset_version_id)
  );

CREATE POLICY share_link_workspace ON share_links
  USING (app_bypass() OR workspace_id = app_current_workspace());

CREATE POLICY download_access ON downloads
  USING (
    app_bypass()
    OR EXISTS (
      SELECT 1 FROM asset_versions v
      JOIN assets a ON a.id = v.asset_id
      JOIN projects p ON p.id = a.project_id
      WHERE v.id = downloads.asset_version_id
        AND p.workspace_id = app_current_workspace()
    )
  );

CREATE POLICY playback_session_access ON playback_sessions
  USING (
    app_bypass()
    OR EXISTS (
      SELECT 1 FROM asset_versions v
      JOIN assets a ON a.id = v.asset_id
      JOIN projects p ON p.id = a.project_id
      WHERE v.id = playback_sessions.asset_version_id
        AND p.workspace_id = app_current_workspace()
    )
  );

CREATE POLICY audit_read ON audit_events FOR SELECT
  USING (app_bypass() OR workspace_id = app_current_workspace());

CREATE POLICY audit_write ON audit_events FOR INSERT
  WITH CHECK (app_bypass());

CREATE POLICY notification_owner ON notifications
  USING (app_bypass() OR user_id = app_current_user());

-- ─── Hash-chained audit ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_link_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_hash text;
BEGIN
  SELECT hash INTO last_hash
    FROM audit_events
    WHERE workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

  NEW.prev_hash := last_hash;
  NEW.hash := encode(
    digest(
      coalesce(last_hash,'') ||
      NEW.id::text ||
      coalesce(NEW.actor_user_id::text,'') ||
      NEW.action ||
      coalesce(NEW.target_type,'') ||
      coalesce(NEW.target_id::text,'') ||
      coalesce(NEW.metadata::text,'') ||
      NEW.created_at::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END $$;

CREATE TRIGGER audit_events_link
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_link_hash();

-- ─── Partitioning (telemetry + audit) ───────────────────────────────────────
-- Prisma created these as plain tables; we convert by renaming + recreating
-- as partitioned. Safe at init time when tables are empty.

-- playback_events
ALTER TABLE playback_events RENAME TO playback_events_legacy;
CREATE TABLE playback_events (LIKE playback_events_legacy INCLUDING ALL)
  PARTITION BY RANGE (created_at);
DROP TABLE playback_events_legacy;

CREATE TABLE playback_events_default PARTITION OF playback_events DEFAULT;

-- audit_events
ALTER TABLE audit_events RENAME TO audit_events_legacy;
CREATE TABLE audit_events (LIKE audit_events_legacy INCLUDING ALL)
  PARTITION BY RANGE (created_at);
DROP TABLE audit_events_legacy;

CREATE TABLE audit_events_default PARTITION OF audit_events DEFAULT;

-- Bootstrap current month
DO $$
DECLARE
  start_ts timestamptz := date_trunc('month', now());
  end_ts   timestamptz := date_trunc('month', now() + interval '1 month');
  pe_part  text := 'playback_events_' || to_char(start_ts, 'YYYY_MM');
  ae_part  text := 'audit_events_'    || to_char(start_ts, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF playback_events FOR VALUES FROM (%L) TO (%L)',
    pe_part, start_ts, end_ts);
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
    ae_part, start_ts, end_ts);
END $$;

-- Re-enable RLS + trigger on the new audit_events
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_read ON audit_events FOR SELECT
  USING (app_bypass() OR workspace_id = app_current_workspace());

CREATE POLICY audit_write ON audit_events FOR INSERT
  WITH CHECK (app_bypass());

CREATE TRIGGER audit_events_link
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_link_hash();

-- ─── Hot-path indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS comments_thread ON comments (asset_version_id, parent_id, time_ms)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS versions_open_review ON asset_versions (asset_id, review_status)
  WHERE review_status IN ('PENDING','IN_REVIEW','CHANGES_REQUESTED');

CREATE UNIQUE INDEX IF NOT EXISTS share_links_slug_active ON share_links (public_slug)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS sessions_expire_sweep ON sessions (expires)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS audit_action_time ON audit_events (action, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

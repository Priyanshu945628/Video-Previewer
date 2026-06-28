/**
 * Email worker — drains `notifications` rows that haven't been emailed yet
 * and sends them via Resend. Per-user `NotificationPreference` controls
 * whether each kind is delivered; defaults are opt-in for the kinds the
 * product needs (comments, versions, approvals, downloads).
 *
 * Job payload kept tiny: just the notification id. The worker reads the
 * notification and the user's prefs from the DB itself, so a re-queue
 * after a crash always sees the current state.
 */
import { Worker, type Job } from 'bullmq';
import { Resend } from 'resend';
import { createLogger } from '@vsp/logger';
import { env } from '@vsp/config';
import { withRlsBypass } from '@vsp/db';
import { makeConnection } from '../lib/connection';

const logger = createLogger('worker:email');
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

interface EmailJob {
  notificationId: string;
}

function shouldSend(kind: string, prefs: { emailComments: boolean; emailVersions: boolean; emailApprovals: boolean; emailDownloads: boolean }): boolean {
  if (kind.startsWith('comment.')) return prefs.emailComments;
  if (kind.startsWith('version.')) return prefs.emailVersions;
  if (kind.startsWith('approval.')) return prefs.emailApprovals;
  if (kind.startsWith('download.')) return prefs.emailDownloads;
  // Share/system events default to ON (rare, high-signal).
  return true;
}

function renderHtml(title: string, body: string | null, link: string | null): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0d;color:#e7e7ea;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#141416;border:1px solid #25252b;border-radius:12px;padding:24px">
      <div style="font-size:11px;letter-spacing:2px;color:#8a8a93;text-transform:uppercase">VSP</div>
      <h1 style="font-size:18px;margin:8px 0 0">${escapeHtml(title)}</h1>
      ${body ? `<p style="color:#c7c7cd;line-height:1.5;margin-top:12px">${escapeHtml(body)}</p>` : ''}
      ${
        link
          ? `<a href="${escapeHtml(link)}" style="display:inline-block;margin-top:18px;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open in VSP</a>`
          : ''
      }
      <p style="color:#6b6b73;font-size:11px;margin-top:24px">You're receiving this because of your VSP notification preferences. <a style="color:#8a8a93" href="${env.APP_URL}/settings/notifications">Change preferences</a>.</p>
    </div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

export async function processEmail(job: Job<EmailJob>) {
  const { notificationId } = job.data;

  if (!resend) {
    logger.warn({ notificationId }, 'RESEND_API_KEY unset; skipping email');
    return;
  }

  const n = await withRlsBypass((tx) =>
    tx.notification.findUnique({
      where: { id: notificationId },
      include: { user: { include: { notifyPrefs: true } } },
    }),
  );
  if (!n) return;
  if (n.emailedAt) return; // already sent — idempotent
  if (!n.user.email) return;

  const prefs = n.user.notifyPrefs ?? {
    emailComments: true,
    emailVersions: true,
    emailApprovals: true,
    emailDownloads: true,
  };
  if (!shouldSend(n.kind, prefs)) {
    logger.debug({ kind: n.kind, userId: n.userId }, 'skipped by prefs');
    return;
  }

  const link = n.link ? new URL(n.link, env.APP_URL).toString() : null;

  try {
    await resend.emails.send({
      from: env.MAIL_FROM,
      to: n.user.email,
      subject: n.title,
      html: renderHtml(n.title, n.body, link),
    });
    await withRlsBypass((tx) =>
      tx.notification.update({ where: { id: notificationId }, data: { emailedAt: new Date() } }),
    );
    logger.info({ notificationId, to: n.user.email }, 'email sent');
  } catch (err) {
    logger.error({ err, notificationId }, 'email send failed');
    throw err;
  }
}

export function startEmailWorker() {
  return new Worker<EmailJob>('email', processEmail, {
    connection: makeConnection(),
    concurrency: 8,
  });
}

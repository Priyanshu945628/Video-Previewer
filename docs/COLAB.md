# Running VSP on Google Colab

You don't have Docker locally, so here's how to run the whole stack on a
free Colab VM. Colab gives you:

- 1 GPU (we won't use it) + ~12 GB RAM + ~80 GB disk
- ffmpeg pre-installed
- root access via `!apt` / `!pip`
- **but no permanent storage** — the VM dies when you close the tab,
  so everything below has to be re-run on each session. (Mount Google
  Drive if you want to persist uploads — see the bottom of this doc.)

What we'll end up with:

```
Colab VM
 ├── Postgres 16     (apt, runs as a service)
 ├── Redis 7         (apt, runs as a service)
 ├── MinIO           (single binary, S3-compatible)
 ├── @vsp/api        (NestJS, port 4000)
 ├── @vsp/workers    (BullMQ)
 └── @vsp/web        (Next.js, port 3000)

cloudflared → public URLs for ports 3000 and 4000
              so you can open the app from your browser
```

---

## Step 0 — Get the files into Colab

Pick the easiest of three options.

### Option A — push to a private GitHub repo (recommended)

On your Windows machine, in `D:\vsp`:

```bash
git init
git add .
git commit -m "vsp initial"
git branch -M main
# create an empty private repo at github.com, then:
git remote add origin https://github.com/<your-user>/vsp.git
git push -u origin main
```

In Colab, clone with a [Personal Access Token](https://github.com/settings/tokens)
(`repo` scope) so the private repo authenticates:

```python
!git clone https://<PAT>@github.com/<your-user>/vsp.git
%cd vsp
```

### Option B — zip + upload through the Colab file picker

On Windows:

```powershell
Compress-Archive -Path D:\vsp\* -DestinationPath D:\vsp.zip
```

In a Colab cell:

```python
from google.colab import files
uploaded = files.upload()  # pick vsp.zip
!unzip -q vsp.zip -d vsp
%cd vsp
```

Files-tab upload is slow (~1–2 MB/s). For projects > 100 MB, prefer A.

### Option C — Google Drive

On Windows, copy `D:\vsp` into a `vsp/` folder under your Drive
(skipping `node_modules`, `dist`, `.next`, `.turbo`). Then in Colab:

```python
from google.colab import drive
drive.mount('/content/drive')
!cp -r /content/drive/MyDrive/vsp /content/vsp
%cd /content/vsp
```

---

## Step 1 — Install system deps

Paste this whole block into one cell. It installs Postgres, Redis,
MinIO, and pnpm.

```bash
%%bash
set -euo pipefail

# --- Node 20 + pnpm 9
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
corepack enable
corepack prepare pnpm@9.7.0 --activate
node --version
pnpm --version

# --- Postgres 16
apt-get install -y postgresql postgresql-contrib
service postgresql start
sudo -u postgres psql -c "CREATE USER vsp WITH SUPERUSER PASSWORD 'vsp';"
sudo -u postgres psql -c "CREATE DATABASE vsp OWNER vsp;"

# --- Redis 7
apt-get install -y redis-server
sed -i 's/^bind .*/bind 0.0.0.0/' /etc/redis/redis.conf
service redis-server start
redis-cli ping

# --- MinIO (S3-compatible local storage)
curl -fsSLo /usr/local/bin/minio https://dl.min.io/server/minio/release/linux-amd64/minio
curl -fsSLo /usr/local/bin/mc     https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x /usr/local/bin/minio /usr/local/bin/mc
mkdir -p /var/lib/minio
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
  nohup minio server /var/lib/minio --console-address ':9001' \
  > /var/log/minio.log 2>&1 &
sleep 3
mc alias set local http://127.0.0.1:9000 minioadmin minioadmin
for b in vsp-originals vsp-hls vsp-thumbs vsp-exports; do mc mb -p local/$b || true; done
mc ls local

# --- ffmpeg (Colab has it, but force-install in case the image differs)
apt-get install -y ffmpeg
ffmpeg -version | head -n1

# --- cloudflared (for public URLs)
curl -fsSLo /usr/local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /usr/local/bin/cloudflared
```

---

## Step 2 — Configure `.env`

```python
import os, secrets, base64, pathlib
def b64key(n=32): return base64.b64encode(secrets.token_bytes(n)).decode()

env = f"""
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
CORS_ALLOWED_ORIGINS=http://localhost:3000

DATABASE_URL=postgresql://vsp:vsp@localhost:5432/vsp?schema=public
DATABASE_DIRECT_URL=postgresql://vsp:vsp@localhost:5432/vsp?schema=public
REDIS_URL=redis://localhost:6379

AUTH_SECRET={b64key()}
AUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true

INTERNAL_JWT_SECRET={b64key()}
SIGNING_KEY_CURRENT={b64key()}
SIGNED_URL_TTL_SECONDS=300
DOWNLOAD_URL_TTL_SECONDS=60

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET_ORIGINALS=vsp-originals
S3_BUCKET_HLS=vsp-hls
S3_BUCKET_THUMBS=vsp-thumbs
S3_BUCKET_EXPORTS=vsp-exports
S3_FORCE_PATH_STYLE=true

KMS_PROVIDER=local
KMS_LOCAL_MASTER_KEY={b64key()}

# AI (optional — leave empty to disable the AI summary panel)
AI_ENABLED=false
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=
AI_DEFAULT_MODEL=claude-sonnet-4-6

# Email (mailhog isn't installed; emails will no-op)
RESEND_API_KEY=
MAIL_FROM=VSP <no-reply@vsp.local>

FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
TRANSCODE_WORK_DIR=/tmp/vsp-transcode
TRANSCODE_CONCURRENCY=1
"""
pathlib.Path('.env').write_text(env.strip() + '\n')
print('.env written, keys generated')
```

> **Want AI summaries?** Get a key from https://console.anthropic.com,
> flip `AI_ENABLED=true`, and paste the key into `ANTHROPIC_API_KEY`.

---

## Step 3 — Install JS deps, migrate, seed

```bash
%%bash
set -euo pipefail
pnpm install
pnpm db:generate
pnpm db:migrate:deploy   # applies schema + RLS + partitions + hash-chain
pnpm db:seed             # creates editor@vsp.local / EditorPass!42
```

If `db:migrate:deploy` complains there are no migrations applied, run the
init migration manually:

```bash
%%bash
psql postgresql://vsp:vsp@localhost:5432/vsp \
  -f packages/db/prisma/migrations/20260628_init_rls_partitions/migration.sql
```

---

## Step 4 — Start API + workers + web

Each runs in the background and writes to its own log file so you can
tail them in another cell.

```bash
%%bash
set -euo pipefail
mkdir -p /var/log/vsp

# API gateway (port 4000) + realtime (4001)
nohup pnpm --filter @vsp/api dev > /var/log/vsp/api.log 2>&1 &
echo $! > /var/log/vsp/api.pid

# Background workers (BullMQ consumers)
nohup pnpm --filter @vsp/workers dev > /var/log/vsp/workers.log 2>&1 &
echo $! > /var/log/vsp/workers.pid

# Next.js web (port 3000)
nohup pnpm --filter @vsp/web dev > /var/log/vsp/web.log 2>&1 &
echo $! > /var/log/vsp/web.pid

sleep 8
ss -ltn | grep -E ':(3000|4000|4001|9000) '
```

Tail any of the logs:

```bash
!tail -n 50 -f /var/log/vsp/web.log
```

(Hit the stop button on the cell when you've seen enough.)

---

## Step 5 — Expose public URLs with Cloudflared

Colab's port-forward (`google.colab.output.serve_kernel_port_as_iframe`)
works for simple apps but breaks on Next.js because of WebSocket /
absolute-URL assumptions. Cloudflared's free quick tunnels are the
reliable option:

```bash
%%bash
# Tunnel the web app
nohup cloudflared tunnel --no-autoupdate --url http://localhost:3000 \
  > /var/log/vsp/tunnel-web.log 2>&1 &
sleep 4
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /var/log/vsp/tunnel-web.log | tail -1

# Tunnel the API
nohup cloudflared tunnel --no-autoupdate --url http://localhost:4000 \
  > /var/log/vsp/tunnel-api.log 2>&1 &
sleep 4
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /var/log/vsp/tunnel-api.log | tail -1
```

The cell prints two URLs — copy them. Then update `.env` so the web app
points at the public API and restart the web process:

```python
import re, pathlib, subprocess, time
web_url = subprocess.check_output(
  "grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' /var/log/vsp/tunnel-web.log | tail -1",
  shell=True, text=True).strip()
api_url = subprocess.check_output(
  "grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' /var/log/vsp/tunnel-api.log | tail -1",
  shell=True, text=True).strip()
print('WEB:', web_url)
print('API:', api_url)

env = pathlib.Path('.env').read_text()
env = re.sub(r'^APP_URL=.*$', f'APP_URL={web_url}', env, flags=re.M)
env = re.sub(r'^API_URL=.*$', f'API_URL={api_url}', env, flags=re.M)
env = re.sub(r'^AUTH_URL=.*$', f'AUTH_URL={web_url}', env, flags=re.M)
env = re.sub(r'^CORS_ALLOWED_ORIGINS=.*$', f'CORS_ALLOWED_ORIGINS={web_url}', env, flags=re.M)
pathlib.Path('.env').write_text(env)

# Pass the API URL through to Next.js
with open('apps/web/.env.local','w') as f:
    f.write(f'NEXT_PUBLIC_API_URL={api_url}\n')

# Restart web + api so the new env loads
import os, signal
for name in ('web','api'):
    pid = int(open(f'/var/log/vsp/{name}.pid').read())
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass

time.sleep(3)
subprocess.Popen(
  ['bash','-lc','pnpm --filter @vsp/api dev > /var/log/vsp/api.log 2>&1 & echo $! > /var/log/vsp/api.pid'])
subprocess.Popen(
  ['bash','-lc','pnpm --filter @vsp/web dev > /var/log/vsp/web.log 2>&1 & echo $! > /var/log/vsp/web.pid'])
print('restarted; give it ~15s')
```

Open the **WEB** URL in your browser and sign in with the seeded
credentials:

```
editor@vsp.local / EditorPass!42
client@vsp.local / ClientPass!42
```

---

## Step 6 — Smoke-test the whole flow

1. Sign in as `editor@vsp.local`.
2. Click into the "Acme Q3 Launch" project (seeded).
3. **Upload** a small `.mp4` (15-30 s, under 100 MB — Colab disk is
   shared, and the transcode worker has `concurrency=1` here).
4. Watch the workers tail: `!tail -f /var/log/vsp/workers.log`. You'll
   see `transcode start`, ladder selection, progress updates, then
   `transcode done`.
5. Refresh the page → the player should appear with the dynamic
   watermark.
6. Drop a few comments at different timestamps (click the rail).
7. (Optional) Switch to the AI Summary tab and hit **Generate** —
   needs `AI_ENABLED=true` + an Anthropic key.
8. Open the **Share** dialog → set a password → copy the URL. Open it
   in an incognito tab to test the share-link viewer.

---

## Common problems

| Symptom | Fix |
|---|---|
| `psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed` | `!service postgresql start` then re-run |
| Migration says "no migrations to apply" but tables are missing | Run the migration SQL directly with `psql -f packages/db/prisma/migrations/20260628_init_rls_partitions/migration.sql` |
| Web shows "Network error" calling the API | The cloudflared API URL changed (new tunnel session). Re-run Step 5. |
| `Error: cannot find module '@vsp/...'` | Re-run `pnpm install` from the repo root, then `pnpm db:generate` |
| Transcode jobs stuck in `QUEUED` | Workers process died. Check `/var/log/vsp/workers.log`, restart with the cell in Step 4 |
| Player shows black screen | Hard-refresh; check the browser network tab for `/stream/.../key` — a 401 means the cookie didn't reach the API origin. Confirm `NEXT_PUBLIC_API_URL` is the public cloudflared URL, not `localhost:4000` |
| Out of RAM | Lower `TRANSCODE_CONCURRENCY=1` (already the default here) and avoid uploading > 1080p clips |

---

## Persisting work across Colab sessions

Colab wipes everything when the runtime stops. To keep your uploads
(or just to avoid re-uploading the code each session), mount Drive and
symlink the heavy directories:

```python
from google.colab import drive
drive.mount('/content/drive')

import os, pathlib
persist = pathlib.Path('/content/drive/MyDrive/vsp-state')
for sub in ('minio', 'postgres'):
    (persist / sub).mkdir(parents=True, exist_ok=True)

# Point MinIO at Drive (re-run Step 1's MinIO block after this).
os.environ['MINIO_DIR'] = str(persist / 'minio')
```

Postgres data on Drive is slow because every write goes through a FUSE
mount — only worth it if you really need it. For most testing, just
keep `db:seed` ready to recreate the demo state in 5 seconds.

---

## Tearing down

You don't strictly need to — closing the tab does it for you — but if
you want a clean rerun without restarting the runtime:

```bash
%%bash
for f in /var/log/vsp/*.pid; do kill -TERM $(cat $f) 2>/dev/null || true; done
pkill -f cloudflared || true
service postgresql stop || true
service redis-server stop || true
pkill -f 'minio server' || true
```

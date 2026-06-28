#!/usr/bin/env python3
"""
VSP — one-shot Colab bootstrap.

Run from a Colab cell:

    !curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/main/scripts/colab_bootstrap.py -o /tmp/boot.py
    !python3 /tmp/boot.py --repo https://github.com/<user>/<repo>.git

…or, if you've already cloned the repo and cd'd into it:

    !python3 scripts/colab_bootstrap.py

What it does, in order:
    1. Installs Node 20, pnpm 9, Postgres 16, Redis 7, MinIO, ffmpeg, cloudflared.
    2. Starts Postgres / Redis / MinIO as background services + creates buckets.
    3. Clones the repo (if --repo given) and cd's into it.
    4. Writes a .env with freshly-generated secrets.
    5. Runs `pnpm install`, `prisma generate`, `prisma migrate deploy`, `db:seed`.
    6. Starts api / workers / web as background processes.
    7. Opens two cloudflared quick-tunnels (web + api), waits for URLs.
    8. Rewrites .env and apps/web/.env.local with the public URLs.
    9. Restarts api + web so they pick up the new env.
   10. Prints the public WEB url + seeded login credentials.

Idempotent: safe to re-run. Each step skips work that's already done.
"""

from __future__ import annotations

import argparse
import base64
import os
import pathlib
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
from typing import Iterable


# ─── tiny helpers ────────────────────────────────────────────────────────────

ROOT_LOG = pathlib.Path("/var/log/vsp")
ROOT_LOG.mkdir(parents=True, exist_ok=True)
# `touch` empty log files so `!tail -f` in another cell doesn't error out
# before the first process writes to them.
for _name in ("api", "workers", "web", "minio", "tunnel-web", "tunnel-api"):
    (ROOT_LOG / f"{_name}.log").touch(exist_ok=True)


def port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    """True iff a TCP connect to host:port succeeds. Used in place of `ss`."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def say(msg: str) -> None:
    print(f"\n\033[1;36m▶ {msg}\033[0m", flush=True)


def ok(msg: str) -> None:
    print(f"  \033[1;32m✓\033[0m {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"  \033[1;33m!\033[0m {msg}", flush=True)


def run(cmd: str | list[str], *, check: bool = True, env: dict | None = None) -> int:
    """Run a shell command, streaming output. Returns the exit code."""
    if isinstance(cmd, list):
        printable = " ".join(cmd)
    else:
        printable = cmd
    print(f"  $ {printable}", flush=True)
    full_env = {**os.environ, **(env or {})}
    proc = subprocess.run(
        cmd,
        shell=isinstance(cmd, str),
        env=full_env,
        text=True,
    )
    if check and proc.returncode != 0:
        raise SystemExit(f"command failed ({proc.returncode}): {printable}")
    return proc.returncode


def have(binary: str) -> bool:
    return shutil.which(binary) is not None


def write_if_missing(path: pathlib.Path, content: str) -> None:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


def b64_key(n: int = 32) -> str:
    return base64.b64encode(secrets.token_bytes(n)).decode()


def background(name: str, cmd: str, *, cwd: str | None = None, env: dict | None = None) -> int:
    """Spawn a detached process, writing stdout+stderr to /var/log/vsp/<name>.log."""
    log = ROOT_LOG / f"{name}.log"
    pidfile = ROOT_LOG / f"{name}.pid"
    full_env = {**os.environ, **(env or {})}
    with open(log, "ab") as f:
        proc = subprocess.Popen(
            cmd,
            shell=True,
            stdout=f,
            stderr=subprocess.STDOUT,
            cwd=cwd,
            env=full_env,
            preexec_fn=os.setsid,
        )
    pidfile.write_text(str(proc.pid))
    return proc.pid


def kill_background(name: str) -> None:
    pidfile = ROOT_LOG / f"{name}.pid"
    if not pidfile.exists():
        return
    try:
        pid = int(pidfile.read_text().strip())
    except ValueError:
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(os.getpgid(pid), sig)
        except (ProcessLookupError, PermissionError):
            return
        time.sleep(0.5)
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return


def wait_for(predicate, *, timeout: float = 60, every: float = 1.0, what: str = "service") -> None:
    start = time.time()
    while time.time() - start < timeout:
        if predicate():
            return
        time.sleep(every)
    raise SystemExit(f"timed out waiting for {what}")


def grep_one(path: pathlib.Path, pattern: str) -> str | None:
    if not path.exists():
        return None
    m = re.findall(pattern, path.read_text())
    return m[-1] if m else None


# ─── steps ───────────────────────────────────────────────────────────────────


def step_apt(packages: Iterable[str]) -> None:
    pkgs = list(packages)
    missing = [p for p in pkgs if subprocess.run(
        ["dpkg-query", "-W", "-f=${Status}", p],
        capture_output=True, text=True).stdout.strip() != "install ok installed"]
    if not missing:
        ok(f"apt packages already installed: {' '.join(pkgs)}")
        return
    run("apt-get update -qq")
    run(f"DEBIAN_FRONTEND=noninteractive apt-get install -y -qq {' '.join(missing)}")


def step_node_and_pnpm() -> None:
    say("Node 20 + pnpm 9")
    if not have("node") or subprocess.run(
        ["node", "-e", "process.exit(process.versions.node.split('.')[0]>='20'?0:1)"],
    ).returncode != 0:
        run("curl -fsSL https://deb.nodesource.com/setup_20.x | bash -")
        run("apt-get install -y -qq nodejs")
    else:
        ok("node ≥20 already installed")
    if not have("pnpm"):
        run("corepack enable")
        run("corepack prepare pnpm@9.7.0 --activate")
    else:
        ok("pnpm already on PATH")


def step_postgres() -> None:
    say("Postgres 16")
    step_apt(["postgresql", "postgresql-contrib"])
    run("service postgresql start", check=False)
    # Wait for socket / TCP.
    wait_for(
        lambda: subprocess.run(
            ["sudo", "-u", "postgres", "psql", "-tAc", "SELECT 1"],
            capture_output=True,
        ).returncode == 0,
        timeout=30, what="postgres",
    )
    # User + DB (idempotent).
    run(
        "sudo -u postgres psql -tAc "
        "\"SELECT 1 FROM pg_roles WHERE rolname='vsp'\" | grep -q 1 || "
        "sudo -u postgres psql -c \"CREATE USER vsp WITH SUPERUSER PASSWORD 'vsp'\"",
        check=False,
    )
    run(
        "sudo -u postgres psql -tAc "
        "\"SELECT 1 FROM pg_database WHERE datname='vsp'\" | grep -q 1 || "
        "sudo -u postgres psql -c \"CREATE DATABASE vsp OWNER vsp\"",
        check=False,
    )


def step_redis() -> None:
    say("Redis 7")
    step_apt(["redis-server"])
    # Bind on all interfaces so internal connections work.
    conf = pathlib.Path("/etc/redis/redis.conf")
    if conf.exists():
        text = conf.read_text()
        new = re.sub(r"(?m)^bind .*$", "bind 0.0.0.0", text)
        if new != text:
            conf.write_text(new)
    run("service redis-server start", check=False)
    wait_for(
        lambda: subprocess.run(["redis-cli", "ping"], capture_output=True).stdout.strip() == b"PONG",
        timeout=15, what="redis",
    )


def step_minio() -> None:
    say("MinIO + buckets")
    if not have("minio"):
        run("curl -fsSLo /usr/local/bin/minio https://dl.min.io/server/minio/release/linux-amd64/minio")
        run("chmod +x /usr/local/bin/minio")
    if not have("mc"):
        run("curl -fsSLo /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc")
        run("chmod +x /usr/local/bin/mc")
    pathlib.Path("/var/lib/minio").mkdir(parents=True, exist_ok=True)

    # Pick a free pair of ports. Default 9000/9001; fall back to 9100/9101
    # if anything is already on them. Save the choice for downstream steps.
    api_port = 9000 if not port_open("127.0.0.1", 9000) else 9100
    console_port = 9001 if not port_open("127.0.0.1", 9001) else 9101
    os.environ["VSP_S3_PORT"] = str(api_port)
    os.environ["VSP_S3_CONSOLE_PORT"] = str(console_port)

    minio_running = port_open("127.0.0.1", api_port)
    if not minio_running:
        # Defensive: kill any lingering minio from a previous attempt
        # before we try to bind. Different `fuser`/`pkill` paths matter
        # because Colab's busybox is occasionally light on flags.
        subprocess.run("pkill -9 -f '^minio server' 2>/dev/null", shell=True)
        subprocess.run(f"fuser -k -9 {api_port}/tcp {console_port}/tcp 2>/dev/null",
                       shell=True)
        time.sleep(1)

        # MinIO 2024+ rejects "minioadmin" as the root password.
        minio_secret = "minio-vsp-dev-secret-2026"  # noqa: S105 (dev only)
        background(
            "minio",
            f"minio server /var/lib/minio --address :{api_port} --console-address :{console_port}",
            env={
                "MINIO_ROOT_USER": "minioadmin",
                "MINIO_ROOT_PASSWORD": minio_secret,
            },
        )
        os.environ["VSP_S3_SECRET"] = minio_secret
        # MinIO is "up" when /minio/health/ready returns 200 AND the port
        # accepts TCP. Belt + suspenders.
        try:
            wait_for(
                lambda: port_open("127.0.0.1", api_port) and subprocess.run(
                    f"curl -fsS -o /dev/null http://127.0.0.1:{api_port}/minio/health/ready",
                    shell=True,
                ).returncode == 0,
                timeout=45,
                every=1,
                what=f"minio :{api_port}",
            )
        except SystemExit:
            warn("minio failed to start — its log:")
            run("tail -n 80 /var/log/vsp/minio.log", check=False)
            warn("ports currently bound:")
            run("ss -ltn | grep -E ':(9000|9001|9100|9101) ' || echo '(none)'", check=False)
            raise
        ok(f"minio ready on :{api_port}")
    else:
        ok(f"minio already running on :{api_port}")

    minio_secret = os.environ.get("VSP_S3_SECRET", "minio-vsp-dev-secret-2026")
    run(f"mc alias set local http://127.0.0.1:{api_port} minioadmin {minio_secret}", check=False)
    for bucket in ("vsp-originals", "vsp-hls", "vsp-thumbs", "vsp-exports"):
        run(f"mc mb -p local/{bucket}", check=False)


def step_ffmpeg() -> None:
    say("ffmpeg")
    step_apt(["ffmpeg"])


def step_cloudflared() -> None:
    say("cloudflared")
    if have("cloudflared"):
        ok("already installed")
        return
    run(
        "curl -fsSLo /usr/local/bin/cloudflared "
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    )
    run("chmod +x /usr/local/bin/cloudflared")


def step_clone(repo: str | None) -> pathlib.Path:
    say("repository")
    if repo is None:
        # 1) Already inside a checkout?
        cwd = pathlib.Path.cwd()
        if (cwd / "pnpm-workspace.yaml").exists():
            ok(f"using existing checkout at {cwd}")
            return cwd

        # 2) Auto-discover a sibling checkout under /content.
        for cand in (
            pathlib.Path("/content/Video-Previewer"),
            pathlib.Path("/content/vsp"),
        ):
            if (cand / "pnpm-workspace.yaml").exists():
                os.chdir(cand)
                ok(f"auto-discovered checkout at {cand} (cd'd in)")
                return cand

        raise SystemExit(
            "No --repo given and no existing checkout found.\n"
            "  Either pass --repo <git-url>, or clone the repo first:\n"
            "    !git clone https://github.com/<user>/<repo>.git /content/Video-Previewer"
        )

    target = pathlib.Path("/content") / pathlib.Path(repo.rstrip("/").split("/")[-1]).stem
    if target.exists() and (target / ".git").exists():
        ok(f"already cloned at {target}; pulling")
        run("git -C %s pull --ff-only" % target, check=False)
    else:
        run(f"git clone --depth=1 {repo} {target}")
    os.chdir(target)
    return target


def step_env() -> None:
    say(".env")
    path = pathlib.Path(".env")
    if path.exists():
        ok(".env already present; leaving it alone")
        return
    env = (
        "NODE_ENV=development\n"
        "APP_URL=http://localhost:3000\n"
        "API_URL=http://localhost:4000\n"
        "CORS_ALLOWED_ORIGINS=http://localhost:3000\n"
        "DATABASE_URL=postgresql://vsp:vsp@localhost:5432/vsp?schema=public\n"
        "DATABASE_DIRECT_URL=postgresql://vsp:vsp@localhost:5432/vsp?schema=public\n"
        "REDIS_URL=redis://localhost:6379\n"
        f"AUTH_SECRET={b64_key()}\n"
        "AUTH_URL=http://localhost:3000\n"
        "AUTH_TRUST_HOST=true\n"
        f"INTERNAL_JWT_SECRET={b64_key()}\n"
        f"SIGNING_KEY_CURRENT={b64_key()}\n"
        "SIGNED_URL_TTL_SECONDS=300\n"
        "DOWNLOAD_URL_TTL_SECONDS=60\n"
        f"S3_ENDPOINT=http://localhost:{os.environ.get('VSP_S3_PORT', '9000')}\n"
        "S3_REGION=us-east-1\n"
        "S3_ACCESS_KEY_ID=minioadmin\n"
        f"S3_SECRET_ACCESS_KEY={os.environ.get('VSP_S3_SECRET', 'minio-vsp-dev-secret-2026')}\n"
        "S3_BUCKET_ORIGINALS=vsp-originals\n"
        "S3_BUCKET_HLS=vsp-hls\n"
        "S3_BUCKET_THUMBS=vsp-thumbs\n"
        "S3_BUCKET_EXPORTS=vsp-exports\n"
        "S3_FORCE_PATH_STYLE=true\n"
        "KMS_PROVIDER=local\n"
        f"KMS_LOCAL_MASTER_KEY={b64_key()}\n"
        "AI_ENABLED=false\n"
        "AI_PROVIDER=anthropic\n"
        "ANTHROPIC_API_KEY=\n"
        "AI_DEFAULT_MODEL=claude-sonnet-4-6\n"
        "RESEND_API_KEY=\n"
        "MAIL_FROM=VSP <no-reply@vsp.local>\n"
        "FFMPEG_PATH=ffmpeg\n"
        "FFPROBE_PATH=ffprobe\n"
        "TRANSCODE_WORK_DIR=/tmp/vsp-transcode\n"
        "TRANSCODE_CONCURRENCY=1\n"
    )
    path.write_text(env)
    ok(".env written")


def step_patch_schema_for_prisma_5() -> None:
    """
    Prisma 5.x (pinned in package.json) renamed several preview-feature
    flags vs Prisma 6.x. If the schema was authored against a newer
    Prisma, generate fails with P1012 — patch the most common offender
    so the bootstrap works out of the box.
    """
    schema = pathlib.Path("packages/db/prisma/schema.prisma")
    if not schema.exists():
        return
    src = schema.read_text()
    patched = src.replace('"fullTextSearchPostgres"', '"fullTextSearch"')
    if patched != src:
        schema.write_text(patched)
        ok("patched schema.prisma: fullTextSearchPostgres → fullTextSearch")


def step_patch_dev_tooling() -> None:
    """
    Two known monorepo-tsc footguns we patch for Colab dev:

      1. apps/{api,workers}/tsconfig.json sets `rootDir: "src"`. With cross-
         package imports (`@vsp/logger`, etc.) tsc then refuses to include
         the imported sources because they live outside rootDir. Drop it.
      2. The base tsconfig is intentionally strict (noUnusedLocals,
         noUncheckedIndexedAccess, …). Those are correct for CI but turn dev
         into a wall of red. We loosen them for the apps only.
      3. NestJS's default `nest start --watch` invokes tsc — same blocker.
         We swap the dev script for `tsx watch`, which transpiles per-file,
         ignores rootDir, and preserves emitDecoratorMetadata.
    """
    import json

    for app in ("api", "workers"):
        tsc = pathlib.Path(f"apps/{app}/tsconfig.json")
        if tsc.exists():
            cfg = json.loads(tsc.read_text())
            opts = cfg.setdefault("compilerOptions", {})
            removed = opts.pop("rootDir", None)
            opts.update({
                "noUnusedLocals": False,
                "noUnusedParameters": False,
                "noUncheckedIndexedAccess": False,
                "noEmitOnError": False,
                "skipLibCheck": True,
            })
            tsc.write_text(json.dumps(cfg, indent=2) + "\n")
            ok(f"patched apps/{app}/tsconfig.json (rootDir={removed!r}, loosened strict flags)")

        pj = pathlib.Path(f"apps/{app}/package.json")
        if pj.exists():
            data = json.loads(pj.read_text())
            scripts = data.setdefault("scripts", {})
            scripts["dev"] = "tsx watch src/main.ts"
            pj.write_text(json.dumps(data, indent=2) + "\n")
            ok(f"patched apps/{app}/package.json: dev → tsx watch")

    # Ensure tsx is installed at the workspace root so both apps can find it.
    if subprocess.run(
        "pnpm list -w tsx 2>/dev/null | grep -q tsx",
        shell=True,
    ).returncode != 0:
        run("pnpm add -w -D tsx@^4.16.2", check=False)


def step_install_and_migrate() -> None:
    say("pnpm install + Prisma migrate + seed")
    run("pnpm install --frozen-lockfile=false")
    step_patch_schema_for_prisma_5()
    step_patch_dev_tooling()
    run("pnpm db:generate")
    # Prefer Prisma's migrate; fall back to running the raw SQL if Prisma is unhappy.
    rc = subprocess.run("pnpm db:migrate:deploy", shell=True).returncode
    if rc != 0:
        warn("prisma migrate deploy failed; applying init SQL directly")
        sql = next(
            pathlib.Path("packages/db/prisma/migrations").rglob("*migration.sql"), None
        )
        if not sql:
            raise SystemExit("no init migration SQL found under packages/db/prisma/migrations")
        run(f"psql postgresql://vsp:vsp@localhost:5432/vsp -f {sql}")
    run("pnpm db:seed", check=False)  # seed errors shouldn't block startup


def step_start_services() -> None:
    say("starting api / workers / web")
    for name in ("api", "workers", "web"):
        kill_background(name)
    background("api",     "pnpm --filter @vsp/api dev")
    background("workers", "pnpm --filter @vsp/workers dev")
    background("web",     "pnpm --filter @vsp/web dev")

    say("waiting for ports 4000 (api) and 3000 (web) to listen")
    try:
        wait_for(lambda: port_open("127.0.0.1", 4000), timeout=180, every=2, what="api :4000")
        ok("api up")
    except SystemExit:
        warn("api never bound :4000 — last 80 lines of its log:")
        run("tail -n 80 /var/log/vsp/api.log", check=False)
        raise
    try:
        wait_for(lambda: port_open("127.0.0.1", 3000), timeout=240, every=2, what="web :3000")
        ok("web up")
    except SystemExit:
        warn("web never bound :3000 — last 80 lines of its log:")
        run("tail -n 80 /var/log/vsp/web.log", check=False)
        raise


def step_tunnels() -> tuple[str, str]:
    say("cloudflared tunnels")
    for name in ("tunnel-web", "tunnel-api"):
        kill_background(name)
    background("tunnel-web", "cloudflared tunnel --no-autoupdate --url http://localhost:3000")
    background("tunnel-api", "cloudflared tunnel --no-autoupdate --url http://localhost:4000")

    web_log = ROOT_LOG / "tunnel-web.log"
    api_log = ROOT_LOG / "tunnel-api.log"
    pattern = r"https://[a-z0-9-]+\.trycloudflare\.com"

    say("waiting for tunnel URLs (this is the slow step)")
    wait_for(lambda: grep_one(web_log, pattern) is not None, timeout=60, what="web tunnel")
    wait_for(lambda: grep_one(api_log, pattern) is not None, timeout=60, what="api tunnel")
    web_url = grep_one(web_log, pattern)
    api_url = grep_one(api_log, pattern)
    assert web_url and api_url
    ok(f"web → {web_url}")
    ok(f"api → {api_url}")
    return web_url, api_url


def step_rewire(web_url: str, api_url: str) -> None:
    say("rewiring env to public URLs and restarting web + api")

    def listening(port: int) -> bool:
        return port_open("127.0.0.1", port)

    env_path = pathlib.Path(".env")
    text = env_path.read_text()
    for key, val in (("APP_URL", web_url), ("API_URL", api_url),
                     ("AUTH_URL", web_url), ("CORS_ALLOWED_ORIGINS", web_url)):
        if re.search(rf"(?m)^{key}=.*$", text):
            text = re.sub(rf"(?m)^{key}=.*$", f"{key}={val}", text)
        else:
            text += f"\n{key}={val}\n"
    env_path.write_text(text)
    pathlib.Path("apps/web/.env.local").write_text(f"NEXT_PUBLIC_API_URL={api_url}\n")

    kill_background("web")
    kill_background("api")
    time.sleep(2)
    background("api", "pnpm --filter @vsp/api dev")
    background("web", "pnpm --filter @vsp/web dev")

    wait_for(lambda: listening(4000), timeout=180, every=2, what="api restart")
    wait_for(lambda: listening(3000), timeout=240, every=2, what="web restart")
    ok("api + web restarted")


def banner(web_url: str) -> None:
    print(
        "\n\033[1;35m" + "=" * 72 + "\033[0m\n"
        "\033[1;35mVSP is up.\033[0m\n\n"
        f"  Open: \033[1;36m{web_url}\033[0m\n\n"
        "  Seeded users:\n"
        "    editor@vsp.local  /  EditorPass!42\n"
        "    client@vsp.local  /  ClientPass!42\n\n"
        "  Live logs:\n"
        "    !tail -f /var/log/vsp/api.log\n"
        "    !tail -f /var/log/vsp/workers.log\n"
        "    !tail -f /var/log/vsp/web.log\n"
        "\033[1;35m" + "=" * 72 + "\033[0m\n",
        flush=True,
    )


# ─── orchestration ───────────────────────────────────────────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description="VSP one-shot Colab bootstrap")
    p.add_argument(
        "--repo",
        help="Git URL to clone (e.g. https://github.com/<user>/Video-Previewer.git). "
             "Omit if you're already inside the repo.",
    )
    p.add_argument(
        "--skip-tunnels",
        action="store_true",
        help="Don't open cloudflared tunnels. App will only be reachable from inside Colab.",
    )
    # When this file is invoked via Jupyter's `%run` or pasted into a cell,
    # sys.argv contains kernel args like `-f /path/to/kernel-*.json`. Filter
    # those out so the user can still call main() the normal way from a cell.
    argv = [a for a in sys.argv[1:] if not a.startswith("-f") and ".json" not in a]
    if len(argv) != len(sys.argv) - 1:
        # Drop the -f and its value as a pair too.
        cleaned, skip = [], False
        for a in sys.argv[1:]:
            if skip:
                skip = False
                continue
            if a == "-f":
                skip = True
                continue
            if a.startswith("-f="):
                continue
            if a.endswith(".json"):
                continue
            cleaned.append(a)
        argv = cleaned
    args = p.parse_args(argv)

    if os.geteuid() != 0:
        warn("not running as root; if apt/install steps fail, try `!sudo python3 …`")

    # iproute2 ships `ss`; psmisc ships `pkill`; net-tools is occasionally
    # missing on slim images. Cheap belt-and-braces.
    step_apt(["iproute2", "psmisc", "net-tools"])
    step_node_and_pnpm()
    step_postgres()
    step_redis()
    step_minio()
    step_ffmpeg()
    if not args.skip_tunnels:
        step_cloudflared()

    step_clone(args.repo)
    step_env()
    step_install_and_migrate()
    step_start_services()

    if args.skip_tunnels:
        banner("http://localhost:3000  (Colab-internal only — pass without --skip-tunnels to expose)")
        return

    web_url, api_url = step_tunnels()
    step_rewire(web_url, api_url)
    banner(web_url)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\ninterrupted")
        sys.exit(130)

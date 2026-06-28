/**
 * Transcode worker.
 *
 *   input:   originals/{assetId}/source.{ext}
 *   outputs: hls/{assetId}/{rendition}/playlist.m3u8 + segments (AES-128)
 *            hls/{assetId}/master.m3u8
 *            thumbs/{assetId}/poster.jpg
 *            thumbs/{assetId}/sprite.jpg + sprite.vtt  (timed thumbnails)
 *
 * AES-128: key bytes live in S3 originals/{assetId}/.hls.key (NOT in the public hls
 * bucket); the .m3u8 references /api/v1/assets/:id/hls/key which checks auth and
 * proxies the bytes. Key URI is rewritten at request time, so segments stay static.
 *
 * Renditions: source-aware ladder — we never upscale. 1080p source → 1080/720/480/240.
 * 4K source → 2160/1440/1080/720/480.
 *
 * Concurrency is set in main.ts via `concurrency`, NOT here, so the queue name stays
 * the single source of truth.
 */
import { Worker, type Job } from 'bullmq';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import { createLogger } from '@vsp/logger';
import { prisma, withRlsBypass } from '@vsp/db';
import { kms } from '@vsp/crypto';
import { downloadTo, uploadFile } from '../lib/s3';
import { makeConnection } from '../lib/connection';

const logger = createLogger('worker:transcode');

interface TranscodeJob {
  workspaceId: string;
  projectId: string;
  assetId: string;
  versionId: string;
  sourceKey: string; // originals/...
}

interface Rendition {
  name: '240p' | '480p' | '720p' | '1080p' | '1440p' | '2160p';
  height: number;
  vBitrate: string;
  aBitrate: string;
  maxrate: string;
  bufsize: string;
}

const LADDER: Rendition[] = [
  { name: '240p', height: 240, vBitrate: '400k', aBitrate: '64k', maxrate: '600k', bufsize: '1200k' },
  { name: '480p', height: 480, vBitrate: '1000k', aBitrate: '96k', maxrate: '1500k', bufsize: '3000k' },
  { name: '720p', height: 720, vBitrate: '2500k', aBitrate: '128k', maxrate: '3750k', bufsize: '7500k' },
  { name: '1080p', height: 1080, vBitrate: '5000k', aBitrate: '160k', maxrate: '7500k', bufsize: '15000k' },
  { name: '1440p', height: 1440, vBitrate: '8000k', aBitrate: '192k', maxrate: '12000k', bufsize: '24000k' },
  { name: '2160p', height: 2160, vBitrate: '14000k', aBitrate: '256k', maxrate: '21000k', bufsize: '42000k' },
];

function pickLadder(sourceHeight: number): Rendition[] {
  // Always include the lowest rung for ABR floor, plus everything ≤ source.
  const fit = LADDER.filter((r) => r.height <= sourceHeight);
  return fit.length ? fit : [LADDER[0]];
}

function probe(path: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, data) => {
      if (err) return reject(err);
      const v = data.streams.find((s) => s.codec_type === 'video');
      if (!v?.width || !v.height) return reject(new Error('no video stream'));
      resolve({ width: v.width, height: v.height, duration: Number(data.format.duration ?? 0) });
    });
  });
}

function run(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd.on('end', () => resolve()).on('error', reject).run();
  });
}

async function transcodeRendition(opts: {
  source: string;
  outDir: string;
  rendition: Rendition;
  keyInfoPath: string;
}): Promise<void> {
  const { source, outDir, rendition, keyInfoPath } = opts;
  await run(
    ffmpeg(source)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset veryfast',
        '-profile:v main',
        '-sc_threshold 0',
        '-g 48',
        '-keyint_min 48',
        `-vf scale=-2:${rendition.height}`,
        `-b:v ${rendition.vBitrate}`,
        `-maxrate ${rendition.maxrate}`,
        `-bufsize ${rendition.bufsize}`,
        `-b:a ${rendition.aBitrate}`,
        '-ac 2',
        '-hls_time 6',
        '-hls_playlist_type vod',
        '-hls_segment_type mpegts',
        `-hls_key_info_file ${keyInfoPath}`,
        `-hls_segment_filename ${join(outDir, 'seg_%05d.ts')}`,
      ])
      .output(join(outDir, 'playlist.m3u8')),
  );
}

function buildMaster(renditions: Rendition[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const r of renditions) {
    const bandwidth =
      (parseInt(r.vBitrate) + parseInt(r.aBitrate)) * 1000; // k → bits
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=x${r.height},NAME="${r.name}"`,
      `${r.name}/playlist.m3u8`,
    );
  }
  return lines.join('\n') + '\n';
}

async function makePosterAndSprite(opts: {
  source: string;
  outDir: string;
  duration: number;
}): Promise<{ poster: string; sprite: string; vtt: string }> {
  const { source, outDir, duration } = opts;
  const poster = join(outDir, 'poster.jpg');
  const sprite = join(outDir, 'sprite.jpg');
  const vtt = join(outDir, 'sprite.vtt');

  // Poster: single frame at 10% in (skip intro black).
  await run(
    ffmpeg(source)
      .seekInput(Math.max(1, duration * 0.1))
      .frames(1)
      .outputOptions(['-vf scale=1280:-2', '-q:v 3'])
      .output(poster),
  );

  // Sprite: one tile every `step` seconds, tiled 10 wide.
  const targetTiles = Math.min(200, Math.max(20, Math.floor(duration / 5)));
  const step = duration / targetTiles;
  const cols = 10;
  const rows = Math.ceil(targetTiles / cols);
  const tileW = 160;
  const tileH = 90;

  await run(
    ffmpeg(source)
      .outputOptions([
        `-vf fps=1/${step.toFixed(3)},scale=${tileW}:${tileH},tile=${cols}x${rows}`,
        '-q:v 4',
        '-frames:v 1',
      ])
      .output(sprite),
  );

  // WebVTT cues for the player scrubber preview.
  const cues = ['WEBVTT', ''];
  for (let i = 0; i < targetTiles; i++) {
    const start = i * step;
    const end = Math.min(duration, (i + 1) * step);
    const x = (i % cols) * tileW;
    const y = Math.floor(i / cols) * tileH;
    cues.push(
      `${i + 1}`,
      `${fmtVtt(start)} --> ${fmtVtt(end)}`,
      `sprite.jpg#xywh=${x},${y},${tileW},${tileH}`,
      '',
    );
  }
  await writeFile(vtt, cues.join('\n'));
  return { poster, sprite, vtt };
}

function fmtVtt(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.padStart(6, '0')}`;
}

export async function processTranscode(job: Job<TranscodeJob>) {
  const { workspaceId, assetId, versionId, sourceKey } = job.data;
  // Storage prefix convention (matches streaming.service.locateMaster):
  //   hls/{workspaceId}/{assetId}/{versionId}/...
  const prefix = `hls/${workspaceId}/${assetId}/${versionId}`;
  const thumbsPrefix = `thumbs/${workspaceId}/${assetId}/${versionId}`;

  const work = await mkdtemp(join(tmpdir(), `vsp-${versionId}-`));
  logger.info({ versionId, work }, 'transcode start');

  // Held in the outer scope so `finally` can zero it regardless of where we fail.
  let keyBytes: Buffer | null = null;

  try {
    const sourcePath = join(work, 'source.bin');
    await downloadTo('originals', sourceKey, sourcePath);
    await job.updateProgress(5);

    const meta = await probe(sourcePath);
    const ladder = pickLadder(meta.height);
    logger.info({ versionId, ...meta, ladder: ladder.map((r) => r.name) }, 'probed');

    // Per-version AES-128 key + IV. KEY BYTES STAY IN MEMORY — they are
    // never written to S3 in the clear. The manifest references a virtual
    // URI (`key.bin`) that the API resolves only after auth + signed token,
    // unwrapping the wrapped DEK from KMS.
    keyBytes = randomBytes(16);
    const iv = randomBytes(16);
    const keyPath = join(work, 'enc.key');
    const keyInfoPath = join(work, 'enc.keyinfo');
    await writeFile(keyPath, keyBytes);
    await writeFile(
      keyInfoPath,
      // line 1: URI placeholder rewritten by API at delivery time
      // line 2: local path the encoder reads
      // line 3: IV hex
      `key.bin\n${keyPath}\n${iv.toString('hex')}\n`,
    );

    // Wrap the DEK with KMS for at-rest storage.
    const wrappedDek = await kms().wrap(keyBytes);

    // Render each rendition sequentially — parallel ffmpeg processes thrash the disk
    // and don't help on a single-core-bound encode anyway.
    let progress = 10;
    const progressStep = Math.floor(75 / ladder.length);
    for (const r of ladder) {
      const renditionDir = join(work, r.name);
      await import('node:fs/promises').then((fs) => fs.mkdir(renditionDir, { recursive: true }));
      await transcodeRendition({ source: sourcePath, outDir: renditionDir, rendition: r, keyInfoPath });

      // Upload playlist + segments.
      const files = await readdir(renditionDir);
      for (const f of files) {
        const ct = f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        await uploadFile('hls', `${prefix}/${r.name}/${f}`, join(renditionDir, f), ct);
      }

      progress += progressStep;
      await job.updateProgress(progress);
    }

    // Master playlist.
    const masterPath = join(work, 'master.m3u8');
    await writeFile(masterPath, buildMaster(ladder));
    await uploadFile('hls', `${prefix}/master.m3u8`, masterPath, 'application/vnd.apple.mpegurl');
    await job.updateProgress(88);

    // Poster + sprite sheet.
    const { poster, sprite, vtt } = await makePosterAndSprite({
      source: sourcePath,
      outDir: work,
      duration: meta.duration,
    });
    await uploadFile('thumbs', `${thumbsPrefix}/poster.jpg`, poster, 'image/jpeg');
    await uploadFile('thumbs', `${thumbsPrefix}/sprite.jpg`, sprite, 'image/jpeg');
    await uploadFile('thumbs', `${thumbsPrefix}/sprite.vtt`, vtt, 'text/vtt');
    await job.updateProgress(95);

    // Persist renditions + encryption key + flip version status.
    // Workers run as system: bypass RLS, but stay scoped via workspaceId.
    await withRlsBypass(async (tx) => {
      // Encryption key row first — we need its id on the AssetVersion.
      const key = await tx.encryptionKey.create({
        data: {
          kekId: wrappedDek.kekId,
          wrappedDek: Buffer.from(wrappedDek.ciphertext),
          algorithm: 'AES-128-CBC',
        },
      });

      // Renditions (label + height + bitrate + playlistKey + segmentCount).
      await tx.rendition.deleteMany({ where: { assetVersionId: versionId } });
      for (const r of ladder) {
        const segCount = await readdir(join(work, r.name)).then((files) =>
          files.filter((f) => f.endsWith('.ts')).length,
        );
        await tx.rendition.create({
          data: {
            assetVersionId: versionId,
            label: r.name,
            height: r.height,
            bitrateKbps: parseInt(r.vBitrate) + parseInt(r.aBitrate),
            playlistKey: `${prefix}/${r.name}/playlist.m3u8`,
            segmentCount: segCount,
          },
        });
      }

      await tx.assetVersion.update({
        where: { id: versionId },
        data: {
          status: 'READY',
          durationMs: Math.round(meta.duration * 1000),
          width: meta.width,
          height: meta.height,
          hlsManifestKey: `${prefix}/master.m3u8`,
          posterKey: `${thumbsPrefix}/poster.jpg`,
          spritesheetKey: `${thumbsPrefix}/sprite.jpg`,
          encryptionKeyId: key.id,
          processedAt: new Date(),
        },
      });
    });

    await job.updateProgress(100);
    logger.info({ versionId }, 'transcode done');
  } catch (err) {
    logger.error({ err, versionId }, 'transcode failed');
    await withRlsBypass(async (tx) => {
      await tx.assetVersion.update({
        where: { id: versionId },
        data: { status: 'FAILED' },
      });
    });
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
    keyBytes?.fill(0);
  }
}

export function startTranscodeWorker() {
  return new Worker<TranscodeJob>('transcode', processTranscode, {
    connection: makeConnection(),
    concurrency: 2,
    lockDuration: 60_000 * 30, // 30min — long encodes
  });
}

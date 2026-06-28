import { Injectable } from '@nestjs/common';

/**
 * Rewrites an HLS manifest so every URL in it points back to our API,
 * with a fresh signed token attached. R2 keys never appear in any
 * response sent to the client.
 *
 *   Input (variant playlist as stored in R2):
 *     #EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x...
 *     #EXTINF:5.000,
 *     0001.ts
 *
 *   Output (sent to client):
 *     #EXT-X-KEY:METHOD=AES-128,URI="/stream/<vid>/key?t=<tok>",IV=0x...
 *     #EXTINF:5.000,
 *     /stream/<vid>/seg/0001?t=<tok>
 */
@Injectable()
export class ManifestRewriter {
  rewrite(playlist: string, opts: { versionId: string; mintToken: (idx: number) => string; keyToken: string }): string {
    const lines = playlist.split('\n');
    let segIdx = 0;

    return lines
      .map((line) => {
        if (line.startsWith('#EXT-X-KEY')) {
          return line.replace(
            /URI="([^"]+)"/,
            `URI="/api/stream/${opts.versionId}/key?t=${encodeURIComponent(opts.keyToken)}"`,
          );
        }
        // For master playlists, sub-playlist URIs come on bare lines too.
        if (line && !line.startsWith('#')) {
          // Distinguish between a sub-playlist .m3u8 (master) and a segment.
          if (line.endsWith('.m3u8')) {
            const subToken = opts.mintToken(-1); // sentinel for sub-manifest
            return `/api/stream/${opts.versionId}/sub?p=${encodeURIComponent(line)}&t=${encodeURIComponent(subToken)}`;
          }
          const tok = opts.mintToken(segIdx++);
          return `/api/stream/${opts.versionId}/seg/${segIdx - 1}?t=${encodeURIComponent(tok)}&p=${encodeURIComponent(line)}`;
        }
        return line;
      })
      .join('\n');
  }
}

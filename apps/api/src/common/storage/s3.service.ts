import { Injectable } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { env } from '@vsp/config';
import { createLogger } from '@vsp/logger';

const log = createLogger('s3');

export type BucketName = 'originals' | 'hls' | 'thumbs' | 'exports';

/**
 * S3-compatible object storage (Cloudflare R2 in prod, MinIO in dev).
 *
 * Public helpers NEVER return signed URLs to the caller — we proxy bytes
 * through our API. The only place this exposes a signed URL is the
 * `presignPut` upload flow (browser → R2 direct upload).
 */
@Injectable()
export class S3Service {
  readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
    log.info({ endpoint: env.S3_ENDPOINT }, 's3 client initialized');
  }

  private bucket(name: BucketName): string {
    switch (name) {
      case 'originals':
        return env.S3_BUCKET_ORIGINALS;
      case 'hls':
        return env.S3_BUCKET_HLS;
      case 'thumbs':
        return env.S3_BUCKET_THUMBS;
      case 'exports':
        return env.S3_BUCKET_EXPORTS;
    }
  }

  // ─── Direct (server-side) operations ────────────────────────────────────
  async putObject(bucket: BucketName, key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(bucket),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectStream(bucket: BucketName, key: string, range?: string) {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key, Range: range }),
    );
    return {
      stream: r.Body as Readable,
      length: r.ContentLength,
      contentType: r.ContentType,
      range: r.ContentRange,
    };
  }

  /** Read an entire object into memory as UTF-8 text. Use for HLS manifests. */
  async getText(bucket: BucketName, key: string): Promise<string> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of r.Body as Readable) {
      chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async headObject(bucket: BucketName, key: string) {
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
  }

  async deleteObject(bucket: BucketName, key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
  }

  // ─── Resumable upload (multipart) ───────────────────────────────────────
  async createMultipart(bucket: BucketName, key: string, contentType: string) {
    const r = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket(bucket),
        Key: key,
        ContentType: contentType,
      }),
    );
    return r.UploadId!;
  }

  async presignUploadPart(bucket: BucketName, key: string, uploadId: string, partNumber: number) {
    const cmd = new UploadPartCommand({
      Bucket: this.bucket(bucket),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: 60 * 30 });
  }

  async completeMultipart(
    bucket: BucketName,
    key: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[],
  ) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket(bucket),
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }
}

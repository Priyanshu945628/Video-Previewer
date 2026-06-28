/** Worker-side S3 client. Identical config to the API service. */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { env } from '@vsp/config';

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export type Bucket = 'originals' | 'hls' | 'thumbs' | 'exports';

const bucketName = (b: Bucket): string =>
  b === 'originals'
    ? env.S3_BUCKET_ORIGINALS
    : b === 'hls'
      ? env.S3_BUCKET_HLS
      : b === 'thumbs'
        ? env.S3_BUCKET_THUMBS
        : env.S3_BUCKET_EXPORTS;

export async function downloadTo(bucket: Bucket, key: string, dest: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucketName(bucket), Key: key }));
  if (!r.Body) throw new Error(`no body for ${key}`);
  await pipeline(r.Body as Readable, createWriteStream(dest));
}

export async function uploadFile(bucket: Bucket, key: string, src: string, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName(bucket),
      Key: key,
      Body: createReadStream(src),
      ContentType: contentType,
    }),
  );
}

export async function uploadBuffer(bucket: Bucket, key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: bucketName(bucket), Key: key, Body: body, ContentType: contentType }));
}

export async function head(bucket: Bucket, key: string) {
  return s3.send(new HeadObjectCommand({ Bucket: bucketName(bucket), Key: key }));
}

export async function deleteObject(bucket: Bucket, key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key }));
}

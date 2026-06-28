import { Injectable } from '@nestjs/common';
import { S3Service } from '../../common/storage/s3.service';
import { randomToken } from '@vsp/crypto';

/**
 * Resumable upload coordinator. Browser does direct-to-R2 multipart upload.
 *
 *   1. POST /assets/upload/init    → returns uploadId + first presigned part URL
 *   2. PUT  <signed URL>           ← uploader sends part bytes
 *   3. POST /assets/upload/part    → next presigned URL (or batch list)
 *   4. POST /assets/upload/complete → finalize, enqueue transcode
 *
 * The bucket is private; the only ingress for the uploaded bytes is the
 * presigned URL we issue here, valid for 30 min per part.
 */
@Injectable()
export class UploadsService {
  constructor(private readonly s3: S3Service) {}

  storageKey(workspaceId: string, projectId: string, assetId: string, versionId: string, filename: string) {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = randomToken(6);
    return `originals/${workspaceId}/${projectId}/${assetId}/${versionId}/${stamp}-${safe}`;
  }

  async initMultipart(key: string, mimeType: string) {
    return this.s3.createMultipart('originals', key, mimeType);
  }

  async presignPart(key: string, uploadId: string, partNumber: number) {
    return this.s3.presignUploadPart('originals', key, uploadId, partNumber);
  }

  async complete(key: string, uploadId: string, parts: { ETag: string; PartNumber: number }[]) {
    return this.s3.completeMultipart('originals', key, uploadId, parts);
  }
}

import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { SignedUrlService } from './signed-url.service';

@Global()
@Module({
  providers: [S3Service, SignedUrlService],
  exports: [S3Service, SignedUrlService],
})
export class StorageModule {}

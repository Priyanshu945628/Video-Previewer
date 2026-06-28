import { Module } from '@nestjs/common';
import { StreamingController } from './streaming.controller';
import { StreamingService } from './streaming.service';
import { ManifestRewriter } from './manifest-rewriter';
import { KeyDeliveryService } from './key-delivery.service';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [AssetsModule],
  controllers: [StreamingController],
  providers: [StreamingService, ManifestRewriter, KeyDeliveryService],
  exports: [StreamingService],
})
export class StreamingModule {}

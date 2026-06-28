import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssetsRepository } from './assets.repository';
import { UploadsService } from './uploads.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'transcode' }, { name: 'diff-strip' })],
  controllers: [AssetsController],
  providers: [AssetsService, AssetsRepository, UploadsService],
  exports: [AssetsService, AssetsRepository],
})
export class AssetsModule {}

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReviewExportsController } from './review-exports.controller';
import { ReviewExportsService } from './review-exports.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'review-export' })],
  controllers: [ReviewExportsController],
  providers: [ReviewExportsService],
  exports: [ReviewExportsService],
})
export class ReviewExportsModule {}

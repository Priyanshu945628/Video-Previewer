import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiSummaryController } from './ai-summary.controller';
import { AiSummaryService } from './ai-summary.service';
import { LlmProvider } from './llm.provider';

@Module({
  imports: [BullModule.registerQueue({ name: 'ai-summary' })],
  controllers: [AiSummaryController],
  providers: [AiSummaryService, LlmProvider],
  exports: [AiSummaryService, LlmProvider],
})
export class AiSummaryModule {}

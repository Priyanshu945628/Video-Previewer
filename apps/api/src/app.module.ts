import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { env } from '@vsp/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AssetsModule } from './modules/assets/assets.module';
import { CommentsModule } from './modules/comments/comments.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ShareLinksModule } from './modules/share-links/share-links.module';
import { DownloadsModule } from './modules/downloads/downloads.module';
import { StreamingModule } from './modules/streaming/streaming.module';
import { AiSummaryModule } from './modules/ai-summary/ai-summary.module';
import { ReviewExportsModule } from './modules/review-exports/review-exports.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AdminModule } from './modules/admin/admin.module';
import { RealtimeModule } from './modules/realtime/realtime.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: env.RATE_LIMIT_API_PER_MIN }]),
    BullModule.forRoot({
      connection: { url: env.REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    AuditModule,
    AuthModule,
    ProjectsModule,
    AssetsModule,
    CommentsModule,
    ApprovalsModule,
    ShareLinksModule,
    DownloadsModule,
    StreamingModule,
    AiSummaryModule,
    ReviewExportsModule,
    ActivityModule,
    AdminModule,
    RealtimeModule,
  ],
})
export class AppModule {}

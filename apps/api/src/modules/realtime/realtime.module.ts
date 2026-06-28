import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { PresenceService } from './presence.service';

@Module({
  providers: [RealtimeGateway, PresenceService],
  exports: [RealtimeGateway, PresenceService],
})
export class RealtimeModule {}

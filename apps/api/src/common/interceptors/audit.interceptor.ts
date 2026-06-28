import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { runWithContext, currentContext } from '@vsp/logger';

/**
 * Per-request context interceptor. Stashes request id, ip, ua, route into
 * AsyncLocalStorage so logs and audit emits automatically pick them up.
 *
 * Does NOT write audit_events rows itself — domain services do that with
 * the appropriate action name and metadata. This just enriches context.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      id?: string;
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
      url?: string;
      method?: string;
    }>();
    const res = http.getResponse<{ header: (k: string, v: string) => void }>();

    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.id = requestId;
    res.header('X-VSP-Request-Id', requestId);

    const ctx = {
      requestId,
      ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
      route: `${req.method} ${req.url}`,
    };

    return new Observable<unknown>((subscriber) => {
      runWithContext(ctx, () => {
        next
          .handle()
          .pipe(
            tap({
              next: (v) => subscriber.next(v),
              error: (e) => subscriber.error(e),
              complete: () => subscriber.complete(),
            }),
          )
          .subscribe();
      });
    });
  }
}

export { currentContext };

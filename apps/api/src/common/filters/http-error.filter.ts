import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { createLogger } from '@vsp/logger';

const log = createLogger('http-error');

/**
 * Single error filter. Goals:
 *   - No leaked stack traces.
 *   - Zod errors become 422 with a stable shape.
 *   - Prisma constraint violations are mapped to 409 / 404 without surfacing
 *     SQL details.
 *   - Always log the original error server-side with the request id.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<{ status: (n: number) => { send: (b: unknown) => void } }>();
    const req = ctx.getRequest<{ id?: string; url?: string; method?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'Something went wrong.';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = 'VALIDATION';
      message = 'Invalid request body.';
      details = { fieldErrors: exception.flatten().fieldErrors };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        message = raw;
        code = exception.name.replace(/Exception$/, '').toUpperCase();
      } else {
        const obj = raw as Record<string, unknown>;
        code = (obj.code as string | undefined) ?? code;
        message = (obj.message as string | undefined) ?? message;
        details = (obj.details as Record<string, unknown> | undefined) ?? undefined;
      }
    } else if (exception instanceof Error) {
      // Prisma-style errors carry codes like P2002, P2025, etc.
      const err = exception as Error & { code?: string };
      if (err.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'ALREADY_EXISTS';
        message = 'A resource with the same identifier already exists.';
      } else if (err.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Resource not found.';
      }
    }

    log.warn(
      {
        status,
        code,
        url: req.url,
        method: req.method,
        requestId: req.id,
        err: exception instanceof Error ? { name: exception.name, message: exception.message } : exception,
      },
      'request failed',
    );

    res.status(status).send({ error: { code, message, details } });
  }
}

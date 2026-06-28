import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Param-scoped Zod validation. Controllers decorate parameters with
 * `@Body(new ZodPipe(SomeSchema))` etc. Global usage of this pipe is a
 * no-op for non-zod metadata — keeping it cheap as a default.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodSchema) {}

  transform(value: unknown, _meta: ArgumentMetadata) {
    if (!this.schema) return value;
    return this.schema.parse(value);
  }
}

/** Sugar so controllers can write `@Body(ZodPipe(LoginInput))`. */
export const ZodPipe = (schema: ZodSchema) => new ZodValidationPipe(schema);

import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { errors } from '../utils/errors';

/**
 * Validates and replaces req.body with the parsed result, so handlers only ever
 * see values that already satisfy the schema.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      next(
        errors.invalidInput(
          first ? `${first.path.join('.') || 'Input'}: ${first.message}` : 'Please check the details you entered.',
          result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        ),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req as T, res, next).catch(next);
  };
}

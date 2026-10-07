import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@getfit/shared';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Converts anything thrown in a route into a safe JSON body. Raw errors and
 * stack traces never reach the client — unknown failures are reported as a
 * single generic message the UI renders with a TRY AGAIN action.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    const body: ApiErrorBody & { details?: unknown } = {
      error: { code: error.code, message: error.message },
    };
    if (error.details !== undefined) body.details = error.details;
    res.status(error.statusCode).json(body);
    return;
  }

  // Multer and body-parser surface their own recognisable failures.
  const code = (error as { code?: string })?.code;
  if (code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: { code: 'upload_failed', message: 'That photo is too large. Please try a smaller one.' },
    });
    return;
  }

  logger.error('Unhandled request error', {
    method: req.method,
    path: req.path,
    error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
  });

  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong.' },
  } satisfies ApiErrorBody);
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: 'We could not find what you were looking for.' },
  } satisfies ApiErrorBody);
}

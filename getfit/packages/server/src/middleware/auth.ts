import type { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { userRepository } from '../repositories/userRepository';
import { errors } from '../utils/errors';

export interface AuthenticatedRequest extends Request {
  userId: string;
  isGuest: boolean;
}

export interface TokenPayload {
  sub: string;
  guest: boolean;
}

export function issueToken(userId: string, isGuest: boolean): string {
  return jwt.sign({ sub: userId, guest: isGuest } satisfies TokenPayload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Verifies the bearer token and confirms the user still exists. Every route
 * below this point acts only on `req.userId` — a user id is never accepted
 * from the request body, params or query.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw errors.unauthorized();
    }

    let payload: TokenPayload;
    try {
      payload = jwt.verify(header.slice(7), env.jwtSecret) as TokenPayload;
    } catch {
      throw errors.unauthorized('Your session has expired. Please sign in again.');
    }

    const user = await userRepository.findById(payload.sub);
    if (!user) throw errors.unauthorized('Your session is no longer valid.');

    (req as AuthenticatedRequest).userId = user.id;
    (req as AuthenticatedRequest).isGuest = user.is_guest;
    next();
  } catch (error) {
    next(error);
  }
}

/** Routes that require a real account rather than a pre-signup guest session. */
export function requireAccount(req: Request, _res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).isGuest) {
    next(errors.forbidden('Finish creating your account to continue.'));
    return;
  }
  next();
}

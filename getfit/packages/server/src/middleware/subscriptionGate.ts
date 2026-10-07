import type { NextFunction, Request, Response } from 'express';
import { subscriptionService } from '../services/subscriptionService';
import { AppError } from '../utils/errors';
import type { AuthenticatedRequest } from './auth';

/**
 * Blocks subscription-gated functionality. Entitlement is recomputed on the
 * server for every request — nothing the client sends is trusted, and an
 * expired membership starts failing immediately rather than at the next login.
 */
export async function requireSubscription(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = req as AuthenticatedRequest;
    const entitlement = await subscriptionService.getEntitlement(userId);

    if (!entitlement.active) {
      throw new AppError(
        'subscription_required',
        'Your GetFit membership is not active.',
        402,
        { status: entitlement.status, expiresAt: entitlement.expiresAt },
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

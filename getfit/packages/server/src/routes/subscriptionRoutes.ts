import { Router } from 'express';
import { SUBSCRIPTION_PRICE_USD, SUBSCRIPTION_PRODUCT_ID } from '@getfit/shared';
import { env } from '../config/env';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, validateBody } from '../middleware/validate';
import { subscriptionRepository } from '../repositories/subscriptionRepository';
import { subscriptionService } from '../services/subscriptionService';
import { errors } from '../utils/errors';
import { purchaseSchema } from './schemas';

export const subscriptionRoutes = Router();

subscriptionRoutes.get('/plan', (_req, res) => {
  res.json({
    productId: SUBSCRIPTION_PRODUCT_ID,
    priceUsd: SUBSCRIPTION_PRICE_USD,
    period: 'month',
    freeTrial: false,
    features: [
      'Personalized workouts',
      'AI progression',
      'Guided workouts',
      'Weekly body analysis',
      'Progress tracking',
      'Goal tracking',
    ],
    // Lets the client know whether the mock store is available in this build.
    mockBillingAvailable: env.mockBilling,
  });
});

/** The server-side entitlement. This is the only answer the client may trust. */
subscriptionRoutes.get(
  '/entitlement',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await subscriptionService.getEntitlement(req.userId));
  }),
);

subscriptionRoutes.post(
  '/purchase',
  requireAuth,
  validateBody(purchaseSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const body = req.body as typeof purchaseSchema._output;
    if (body.platform === 'mock' && !env.mockBilling) {
      throw errors.forbidden('Mock purchases are disabled in this environment.');
    }
    const result = await subscriptionService.purchase({ userId: req.userId, ...body });
    res.status(201).json(result);
  }),
);

subscriptionRoutes.post(
  '/restore',
  requireAuth,
  validateBody(purchaseSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const body = req.body as typeof purchaseSchema._output;
    if (body.platform === 'mock' && !env.mockBilling) {
      throw errors.forbidden('Mock purchases are disabled in this environment.');
    }
    res.json(await subscriptionService.restore({ userId: req.userId, ...body }));
  }),
);

subscriptionRoutes.post(
  '/cancel',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await subscriptionService.cancel(req.userId));
  }),
);

subscriptionRoutes.get(
  '/events',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json({ events: await subscriptionRepository.listEvents(req.userId) });
  }),
);

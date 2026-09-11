import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/validate';
import { subscriptionRepository } from '../repositories/subscriptionRepository';
import { workoutRepository } from '../repositories/workoutRepository';
import { subscriptionService } from '../services/subscriptionService';
import { errors } from '../utils/errors';

export const devRoutes = Router();

/**
 * Development-mode test harness. Mounted only when DEV_MODE is on, and every
 * handler re-checks the flag so it can never be reached in production.
 */
devRoutes.use((_req, _res, next) => {
  if (!env.devMode || env.isProduction) {
    next(errors.notFound());
    return;
  }
  next();
});

devRoutes.use(requireAuth);

devRoutes.get('/config', (_req, res) => {
  res.json({
    devMode: env.devMode,
    mockAiMode: env.mockAiMode,
    mockBilling: env.mockBilling,
    aiProvider: env.aiProvider,
    storageDriver: env.storageDriver,
    scenarios: [
      'mock-success',
      'mock-expired',
      'mock-cancelled',
      'mock-failed',
      'mock-revoked',
      'mock-expiring-<minutes>',
    ],
  });
});

/** Forces the membership into the expired state to test the renewal screen. */
devRoutes.post(
  '/subscription/expire',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json({ entitlement: await subscriptionService.forceExpire(req.userId) });
  }),
);

devRoutes.get(
  '/subscription/events',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json({ events: await subscriptionRepository.listEvents(req.userId, 100) });
  }),
);

/**
 * Backdates the most recent assessment so the seven-day lock can be exercised
 * without waiting a week.
 */
devRoutes.post(
  '/assessment/backdate',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const days = Number((req.query.days as string) ?? 7);
    const { query } = await import('../db/pool');
    await query(
      `UPDATE body_assessments SET created_at = created_at - ($2 || ' days')::INTERVAL
       WHERE user_id = $1`,
      [req.userId, String(days)],
    );
    await query(
      `UPDATE body_metrics SET recorded_at = recorded_at - ($2 || ' days')::INTERVAL
       WHERE user_id = $1`,
      [req.userId, String(days)],
    );
    res.json({ backdatedDays: days });
  }),
);

/** Backdates scheduled sessions so missed-workout reorganisation can be tested. */
devRoutes.post(
  '/schedule/backdate',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const days = Number((req.query.days as string) ?? 3);
    const { query } = await import('../db/pool');
    await query(
      `UPDATE scheduled_workouts
       SET scheduled_date = scheduled_date - ($2 || ' days')::INTERVAL
       WHERE user_id = $1 AND status = 'scheduled'`,
      [req.userId, String(days)],
    );
    const upcoming = await workoutRepository.listUpcoming(req.userId, 20);
    res.json({ backdatedDays: days, upcoming });
  }),
);

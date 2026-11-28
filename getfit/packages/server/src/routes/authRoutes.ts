import { Router } from 'express';
import type { AuthTokens } from '@getfit/shared';
import { issueToken, requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, validateBody } from '../middleware/validate';
import { userRepository } from '../repositories/userRepository';
import { userService } from '../services/userService';
import { errors } from '../utils/errors';
import { accountSchema } from './schemas';

export const authRoutes = Router();

/**
 * Starts a guest session. This is what lets a new user complete onboarding and
 * their first body analysis before they have an account or a subscription,
 * while every record they create is still owned by a real user row.
 */
authRoutes.post(
  '/guest',
  asyncHandler(async (_req, res) => {
    const { userId, isGuest } = await userService.createGuest();
    const body: AuthTokens = { accessToken: issueToken(userId, isGuest), userId, isGuest };
    res.status(201).json(body);
  }),
);

/** Completes the account after payment, upgrading the guest in place. */
authRoutes.post(
  '/account',
  requireAuth,
  validateBody(accountSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    await userService.completeAccount(req.userId, email, password);
    const body: AuthTokens = {
      accessToken: issueToken(req.userId, false),
      userId: req.userId,
      isGuest: false,
    };
    res.json(body);
  }),
);

authRoutes.post(
  '/login',
  validateBody(accountSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const userId = await userService.verifyPassword(email, password);
    if (!userId) throw errors.unauthorized('That email or password is not correct.');

    const body: AuthTokens = { accessToken: issueToken(userId, false), userId, isGuest: false };
    res.json(body);
  }),
);

authRoutes.get(
  '/me',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const user = await userRepository.findById(req.userId);
    if (!user) throw errors.unauthorized();
    res.json({ userId: user.id, email: user.email, isGuest: user.is_guest });
  }),
);

authRoutes.delete(
  '/account',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const result = await userService.deleteAccount(req.userId);
    res.json({ deleted: true, ...result });
  }),
);

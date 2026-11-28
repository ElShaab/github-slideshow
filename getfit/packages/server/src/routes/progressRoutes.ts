import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { requireSubscription } from '../middleware/subscriptionGate';
import { asyncHandler } from '../middleware/validate';
import { workoutRepository } from '../repositories/workoutRepository';
import { progressAnalysisService } from '../services/progressAnalysisService';

export const progressRoutes = Router();

progressRoutes.use(requireAuth, requireSubscription);

progressRoutes.get(
  '/overview',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await progressAnalysisService.overview(req.userId));
  }),
);

progressRoutes.get(
  '/strength',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json({ strength: await progressAnalysisService.strengthProgress(req.userId, 12) });
  }),
);

progressRoutes.get(
  '/records',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json({ records: await workoutRepository.listPersonalRecords(req.userId, 60) });
  }),
);

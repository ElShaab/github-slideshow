import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, validateBody } from '../middleware/validate';
import { userRepository } from '../repositories/userRepository';
import { subscriptionService } from '../services/subscriptionService';
import { userService } from '../services/userService';
import { equipmentSchema, goalsSchema, profilePatchSchema, settingsSchema } from './schemas';

export const settingsRoutes = Router();

settingsRoutes.use(requireAuth);

/** Everything the Settings screen renders, in one round trip. */
settingsRoutes.get(
  '/',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const [profile, goals, equipment, preferences, appSettings, entitlement] = await Promise.all([
      userRepository.getProfile(req.userId),
      userRepository.getGoals(req.userId),
      userRepository.getEquipment(req.userId),
      userRepository.getPreferences(req.userId),
      userService.getSettings(req.userId),
      subscriptionService.getEntitlement(req.userId),
    ]);

    res.json({ profile, goals, equipment, preferences, appSettings, entitlement });
  }),
);

settingsRoutes.patch(
  '/profile',
  validateBody(profilePatchSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await userService.updateProfile(req.userId, req.body as never));
  }),
);

settingsRoutes.put(
  '/goals',
  validateBody(goalsSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const body = req.body as typeof goalsSchema._output;
    const goals = await userService.updateGoals(
      req.userId,
      body.goals.map((goal) => ({
        goalType: goal.goalType,
        targetValue: goal.targetValue ?? null,
        targetUnit: goal.targetUnit ?? null,
        targetExerciseId: goal.targetExerciseId ?? null,
      })),
    );
    res.json({ goals, programRegenerated: true });
  }),
);

settingsRoutes.put(
  '/equipment',
  validateBody(equipmentSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const body = req.body as typeof equipmentSchema._output;
    const equipment = await userService.updateEquipment(req.userId, body.equipment as never);
    res.json({ equipment, programRegenerated: true });
  }),
);

settingsRoutes.patch(
  '/app',
  validateBody(settingsSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json({ appSettings: await userService.updateSettings(req.userId, req.body as never) });
  }),
);

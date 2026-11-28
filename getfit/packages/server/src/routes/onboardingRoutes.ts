import { Router } from 'express';
import {
  EQUIPMENT,
  GOAL_DESCRIPTIONS,
  GOAL_LABELS,
  LEVEL_DESCRIPTIONS,
  LEVEL_LABELS,
  PHOTO_INSTRUCTIONS,
  SESSION_DURATIONS,
  TRAINING_DAY_OPTIONS,
  WEEKLY_PHOTO_INSTRUCTIONS,
  type GoalType,
  type TrainingLevel,
} from '@getfit/shared';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, validateBody } from '../middleware/validate';
import { userRepository } from '../repositories/userRepository';
import { userService } from '../services/userService';
import { onboardingSchema } from './schemas';

export const onboardingRoutes = Router();

/** Everything the onboarding screens need, so the client holds no copies. */
onboardingRoutes.get('/options', (_req, res) => {
  res.json({
    levels: (Object.keys(LEVEL_LABELS) as TrainingLevel[]).map((id) => ({
      id,
      label: LEVEL_LABELS[id],
      description: LEVEL_DESCRIPTIONS[id],
    })),
    goals: (Object.keys(GOAL_LABELS) as GoalType[]).map((id) => ({
      id,
      label: GOAL_LABELS[id],
      description: GOAL_DESCRIPTIONS[id],
    })),
    equipment: EQUIPMENT.filter((e) => e.selectable).map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
    })),
    trainingDays: TRAINING_DAY_OPTIONS,
    sessionDurations: SESSION_DURATIONS,
    photoInstructions: PHOTO_INSTRUCTIONS,
    weeklyPhotoInstructions: WEEKLY_PHOTO_INSTRUCTIONS,
  });
});

onboardingRoutes.post(
  '/',
  requireAuth,
  validateBody(onboardingSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const body = req.body as typeof onboardingSchema._output;
    const profile = await userService.saveOnboarding(req.userId, {
      age: body.age,
      sex: body.sex,
      heightCm: body.heightCm,
      weightKg: body.weightKg,
      trainingLevel: body.trainingLevel,
      trainingLocation: body.trainingLocation,
      trainingDays: body.trainingDays as 1,
      sessionDurationMinutes: body.sessionDurationMinutes as 15,
      goals: body.goals.map((goalType) => ({ goalType })),
      equipment: body.equipment as never,
    });
    res.json({ profile });
  }),
);

onboardingRoutes.get(
  '/status',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const [profile, goals, equipment, preferences] = await Promise.all([
      userRepository.getProfile(req.userId),
      userRepository.getGoals(req.userId),
      userRepository.getEquipment(req.userId),
      userRepository.getPreferences(req.userId),
    ]);
    res.json({
      profile,
      goals,
      equipment,
      hasPreferences: preferences.length > 0,
    });
  }),
);

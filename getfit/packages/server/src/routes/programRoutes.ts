import { Router } from 'express';
import { addDays, isoDate } from '@getfit/shared';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { requireSubscription } from '../middleware/subscriptionGate';
import { asyncHandler } from '../middleware/validate';
import { programRepository } from '../repositories/programRepository';
import { workoutRepository } from '../repositories/workoutRepository';
import { hydrateProgram } from '../services/programGenerationService';
import { programService } from '../services/programService';
import { errors } from '../utils/errors';

export const programRoutes = Router();

// Everything below requires an active membership.
programRoutes.use(requireAuth, requireSubscription);

/** Builds the program after payment and exercise preferences are in place. */
programRoutes.post(
  '/generate',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const program = await programService.generateAndSave(req.userId, 'initial');
    res.status(201).json({ program: hydrateProgram(program) });
  }),
);

programRoutes.get(
  '/active',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const program = await programRepository.getActive(req.userId);
    if (!program) throw errors.notFound('You do not have a program yet.');
    res.json({ program: hydrateProgram(program) });
  }),
);

/** Today's session plus the week around it — what the Workouts tab renders. */
programRoutes.get(
  '/schedule',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    await programService.refreshSchedule(req.userId);

    const today = new Date();
    const [week, upcoming, completed] = await Promise.all([
      workoutRepository.listSchedule(
        req.userId,
        isoDate(addDays(today, -7)),
        isoDate(addDays(today, 14)),
      ),
      workoutRepository.listUpcoming(req.userId, 10),
      workoutRepository.listCompleted(req.userId, 20),
    ]);

    res.json({ week, upcoming, completed });
  }),
);

programRoutes.get(
  '/day/:workoutDayId',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const day = await programRepository.getDay(req.userId, req.params.workoutDayId);
    if (!day) throw errors.notFound('That workout is not part of your program.');
    res.json({ day: hydrateProgram({ days: [day] } as never).days[0] });
  }),
);

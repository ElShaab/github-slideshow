import { Router } from 'express';
import { EXERCISE_BY_ID } from '@getfit/shared';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/validate';
import { assessmentRepository } from '../repositories/assessmentRepository';
import { userRepository } from '../repositories/userRepository';
import { workoutRepository } from '../repositories/workoutRepository';
import { bodyAnalysisService } from '../services/bodyAnalysisService';
import { programService } from '../services/programService';
import { subscriptionService } from '../services/subscriptionService';
import { workoutService } from '../services/workoutService';

export const homeRoutes = Router();

/**
 * One request that fills the entire Home screen: current body, today's session,
 * the assessment countdown and the membership state. Keeping this on the server
 * means Home renders in a single round trip and works from cache offline.
 */
homeRoutes.get(
  '/',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const entitlement = await subscriptionService.getEntitlement(req.userId);

    const [profile, assessment, availability] = await Promise.all([
      userRepository.getProfile(req.userId),
      assessmentRepository.latest(req.userId),
      bodyAnalysisService.checkAvailability(req.userId),
    ]);

    // Without an active membership the paid sections stay empty rather than
    // leaking a program the user cannot access.
    if (!entitlement.active) {
      res.json({
        entitlement,
        profile,
        assessment,
        assessmentAvailability: availability,
        today: null,
        totals: { workouts: 0, sets: 0 },
      });
      return;
    }

    await programService.refreshSchedule(req.userId);

    const [today, totals, recent] = await Promise.all([
      workoutService.getTodaysWorkout(req.userId),
      workoutRepository.totals(req.userId),
      workoutRepository.listCompleted(req.userId, 3),
    ]);

    res.json({
      entitlement,
      profile,
      assessment,
      assessmentAvailability: availability,
      today: today
        ? {
            scheduled: today.scheduled,
            focus: today.day.focus,
            durationMinutes: today.day.durationMinutes,
            exerciseCount: today.day.exercises.length,
            cardio: today.day.cardio,
            preview: today.day.exercises.slice(0, 3).map((exercise) => ({
              exerciseId: exercise.exerciseId,
              name: EXERCISE_BY_ID[exercise.exerciseId]?.name ?? exercise.exerciseId,
              sets: exercise.sets,
              repsMin: exercise.repsMin,
              repsMax: exercise.repsMax,
              startingWeight: exercise.startingWeight,
            })),
          }
        : null,
      totals,
      recentWorkouts: recent,
    });
  }),
);

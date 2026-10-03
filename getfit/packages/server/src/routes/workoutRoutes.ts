import { Router } from 'express';
import { EXERCISE_BY_ID } from '@getfit/shared';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { requireSubscription } from '../middleware/subscriptionGate';
import { asyncHandler, validateBody } from '../middleware/validate';
import { workoutRepository } from '../repositories/workoutRepository';
import { workoutService } from '../services/workoutService';
import { errors } from '../utils/errors';
import { completeWorkoutSchema } from './schemas';

export const workoutRoutes = Router();

workoutRoutes.use(requireAuth, requireSubscription);

/** The guided session the Home screen's START WORKOUT button opens. */
workoutRoutes.get(
  '/today',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const result = await workoutService.getTodaysWorkout(req.userId);
    if (!result) {
      res.json({ workout: null });
      return;
    }

    res.json({
      workout: {
        scheduled: result.scheduled,
        day: {
          ...result.day,
          exercises: result.day.exercises.map((exercise) => ({
            ...exercise,
            exercise: EXERCISE_BY_ID[exercise.exerciseId],
          })),
        },
      },
    });
  }),
);

workoutRoutes.post(
  '/complete',
  validateBody(completeWorkoutSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const body = req.body as typeof completeWorkoutSchema._output;
    const summary = await workoutService.complete({
      userId: req.userId,
      scheduledWorkoutId: body.scheduledWorkoutId ?? null,
      workoutDayId: body.workoutDayId,
      startedAt: body.startedAt,
      durationSeconds: body.durationSeconds,
      cardioMinutes: body.cardioMinutes,
      exercises: body.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        workoutExerciseId: exercise.workoutExerciseId ?? null,
        orderIndex: exercise.orderIndex,
        sets: exercise.sets,
      })),
    });
    res.status(201).json({ summary });
  }),
);

workoutRoutes.get(
  '/history',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json({ workouts: await workoutRepository.listCompleted(req.userId, 40) });
  }),
);

workoutRoutes.get(
  '/history/:workoutId',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const workout = await workoutRepository.getCompleted(req.userId, req.params.workoutId);
    if (!workout) throw errors.notFound('That workout is not available.');
    res.json({ workout });
  }),
);

/** Marks a session as missed so the week is reorganised around it. */
workoutRoutes.post(
  '/skip/:scheduledWorkoutId',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    // A row belonging to someone else matches nothing, so this is also what
    // refuses a skip against another user's schedule.
    const skipped = await workoutRepository.updateScheduleEntry(
      req.userId,
      req.params.scheduledWorkoutId,
      { status: 'missed' },
    );
    if (!skipped) throw errors.notFound('That scheduled workout was not found.');
    res.json({ skipped: true });
  }),
);

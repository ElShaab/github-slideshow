import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { requireSubscription } from '../middleware/subscriptionGate';
import { asyncHandler } from '../middleware/validate';
import { assessmentRepository } from '../repositories/assessmentRepository';
import { userRepository } from '../repositories/userRepository';
import { bodyAnalysisService } from '../services/bodyAnalysisService';
import { errors } from '../utils/errors';
import { assessmentSubmissionSchema } from './schemas';

export const assessmentRoutes = Router();

// Photos are held in memory only long enough to hand to the storage driver.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxPhotoBytes, files: 1 },
});

/**
 * Parses the tape measurements and weight off a multipart submission.
 *
 * Every field is optional: with a waist and neck reading the analysis uses the
 * circumference formula, and without them it falls back to a BMI estimate and
 * labels itself as one. A photo is optional too, and is only ever kept as a
 * progress photo for the user.
 */
function parseSubmission(body: unknown) {
  const parsed = assessmentSubmissionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw errors.invalidInput(
      parsed.error.issues[0]?.message ?? 'Check your measurements and try again.',
    );
  }
  const { weightKg, ...measurements } = parsed.data;
  return { weightKg, measurements };
}

/**
 * The first assessment runs before payment — that is the whole point of the
 * onboarding flow — so it is authenticated but not subscription-gated.
 */
assessmentRoutes.post(
  '/initial',
  requireAuth,
  upload.single('photo'),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const profile = await userRepository.getProfile(req.userId);
    if (!profile) throw errors.invalidInput('Complete onboarding before your analysis.');

    const existing = await assessmentRepository.latest(req.userId);
    if (existing) {
      // Re-running the initial analysis is not a new weekly assessment.
      res.json({ assessment: existing, repeated: true });
      return;
    }

    const { measurements } = parseSubmission(req.body);

    const assessment = await bodyAnalysisService.analyze({
      userId: req.userId,
      profile,
      measurements,
      photo: req.file?.buffer,
      contentType: req.file?.mimetype,
      enforceInterval: false,
    });

    res.status(201).json({ assessment, repeated: false });
  }),
);

/** Weekly reassessment — gated by both the membership and the 7-day lock. */
assessmentRoutes.post(
  '/weekly',
  requireAuth,
  requireSubscription,
  upload.single('photo'),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const profile = await userRepository.getProfile(req.userId);
    if (!profile) throw errors.invalidInput('Complete onboarding before your analysis.');

    const { weightKg, measurements } = parseSubmission(req.body);

    const assessment = await bodyAnalysisService.analyze({
      userId: req.userId,
      profile,
      measurements,
      photo: req.file?.buffer,
      contentType: req.file?.mimetype,
      weightKg,
      enforceInterval: true,
    });

    // The profile weight follows the latest assessment so future programming
    // uses the user's current bodyweight.
    if (weightKg !== undefined && weightKg !== profile.weightKg) {
      await userRepository.updateProfile(req.userId, { weightKg });
    }

    res.status(201).json({ assessment });
  }),
);

assessmentRoutes.get(
  '/availability',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await bodyAnalysisService.checkAvailability(req.userId));
  }),
);

assessmentRoutes.get(
  '/latest',
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json({ assessment: await assessmentRepository.latest(req.userId) });
  }),
);

/**
 * Assessment history. Source photo ids are deliberately stripped — the history
 * UI shows the hologram and the numbers, never the original photo.
 */
assessmentRoutes.get(
  '/history',
  requireAuth,
  requireSubscription,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const history = await assessmentRepository.history(req.userId);
    res.json({
      assessments: history.map(({ sourcePhotoId: _sourcePhotoId, ...rest }) => rest),
    });
  }),
);

import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { assessmentRoutes } from './routes/assessmentRoutes';
import { authRoutes } from './routes/authRoutes';
import { devRoutes } from './routes/devRoutes';
import { exerciseRoutes } from './routes/exerciseRoutes';
import { homeRoutes } from './routes/homeRoutes';
import { onboardingRoutes } from './routes/onboardingRoutes';
import { photoRoutes } from './routes/photoRoutes';
import { programRoutes } from './routes/programRoutes';
import { progressRoutes } from './routes/progressRoutes';
import { settingsRoutes } from './routes/settingsRoutes';
import { subscriptionRoutes } from './routes/subscriptionRoutes';
import { workoutRoutes } from './routes/workoutRoutes';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Express 4 parses req.query with qs, whose 6.15.x line carries two DoS
  // advisories and which express pins out of reach of an override. Nothing
  // here reads a nested query object, so the built-in parser removes that
  // code path entirely at no cost.
  app.set('query parser', 'simple');

  app.use(
    helmet({
      // The API serves JSON and private images only; no HTML is rendered.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      credentials: false,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  const generalLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.isProduction ? 120 : 1000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  // Credential and purchase endpoints get a tighter budget than the rest.
  const sensitiveLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.isProduction ? 12 : 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  app.use(generalLimiter);

  // Unauthenticated, so it reports liveness only — the mock/dev flags it used
  // to return told an attacker whether billing could be forged.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', sensitiveLimiter, authRoutes);
  app.use('/api/onboarding', onboardingRoutes);
  app.use('/api/assessments', assessmentRoutes);
  app.use('/api/subscription', sensitiveLimiter, subscriptionRoutes);
  app.use('/api/exercises', exerciseRoutes);
  app.use('/api/program', programRoutes);
  app.use('/api/workouts', workoutRoutes);
  app.use('/api/progress', progressRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/photos', photoRoutes);
  app.use('/api/home', homeRoutes);

  if (env.devMode && !env.isProduction) {
    app.use('/api/dev', devRoutes);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

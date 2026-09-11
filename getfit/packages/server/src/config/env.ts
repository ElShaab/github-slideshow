import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

function str(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function bool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function int(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

export const env = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: int('PORT', 4000),

  databaseUrl: str('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/getfit'),
  databaseSsl: bool('DATABASE_SSL', false),
  databasePoolMax: int('DATABASE_POOL_MAX', 10),

  // A development default keeps `npm run dev` working out of the box; production
  // refuses to start without a real secret (checked below).
  jwtSecret: str('JWT_SECRET', 'getfit-development-secret-do-not-use-in-production'),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '30d'),

  /**
   * When true every AI call is served by the deterministic mock provider.
   * Defaults off in production: shipping fabricated body analysis to a paying
   * user because an env var was forgotten is worse than failing to start.
   */
  mockAiMode: bool('MOCK_AI_MODE', !isProduction),
  aiProvider: str('AI_PROVIDER', isProduction ? '' : 'mock'),
  aiApiKey: process.env.AI_API_KEY ?? '',
  aiBaseUrl: process.env.AI_BASE_URL ?? '',

  /** Development mode allows the mock billing provider and test-only routes. */
  devMode: bool('DEV_MODE', !isProduction),
  mockBilling: bool('MOCK_BILLING', !isProduction),

  storageDriver: str('STORAGE_DRIVER', 'local') as 'local' | 's3',
  storageLocalPath: str('STORAGE_LOCAL_PATH', path.resolve(process.cwd(), 'storage/photos')),
  storageS3Bucket: process.env.STORAGE_S3_BUCKET ?? '',
  storageS3Region: process.env.STORAGE_S3_REGION ?? '',

  appleBundleId: process.env.APPLE_BUNDLE_ID ?? 'com.getfit.app',
  appleSharedSecret: process.env.APPLE_SHARED_SECRET ?? '',
  appleVerifyUrl: str('APPLE_VERIFY_URL', 'https://buy.itunes.apple.com/verifyReceipt'),
  appleSandboxVerifyUrl: str('APPLE_SANDBOX_VERIFY_URL', 'https://sandbox.itunes.apple.com/verifyReceipt'),

  googlePackageName: process.env.GOOGLE_PACKAGE_NAME ?? 'com.getfit.app',
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',

  maxPhotoBytes: int('MAX_PHOTO_BYTES', 12 * 1024 * 1024),
  corsOrigins: str('CORS_ORIGINS', '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

/**
 * Production refuses to start misconfigured rather than running in a degraded
 * state. Each of these would be invisible at runtime but harmful to real users.
 */
if (env.isProduction) {
  const failures: string[] = [];

  if (env.jwtSecret.includes('development-secret') || env.jwtSecret.length < 32) {
    failures.push('JWT_SECRET must be set to a random secret of at least 32 characters.');
  }
  if (env.mockBilling) {
    failures.push('MOCK_BILLING must be false — mock receipts would grant free memberships.');
  }
  if (env.devMode) {
    failures.push('DEV_MODE must be false.');
  }
  if (env.mockAiMode || env.aiProvider === 'mock' || env.aiProvider === '') {
    failures.push('AI_PROVIDER must name a real provider and MOCK_AI_MODE must be false.');
  }
  if (env.aiProvider !== 'mock' && (!env.aiBaseUrl || !env.aiApiKey)) {
    failures.push('AI_BASE_URL and AI_API_KEY are required for a real AI provider.');
  }
  if (env.corsOrigins.includes('*')) {
    failures.push('CORS_ORIGINS must list explicit origins rather than "*".');
  }
  if (env.storageDriver === 'local') {
    failures.push('STORAGE_DRIVER=local stores photos on ephemeral disk; use s3.');
  }
  if (env.storageDriver === 's3' && (!env.storageS3Bucket || !env.storageS3Region)) {
    failures.push('STORAGE_S3_BUCKET and STORAGE_S3_REGION are required for s3 storage.');
  }
  if (!env.appleSharedSecret) {
    failures.push('APPLE_SHARED_SECRET is required to verify App Store receipts.');
  }
  if (!env.googleServiceAccountJson) {
    failures.push('GOOGLE_SERVICE_ACCOUNT_JSON is required to verify Play purchases.');
  }

  if (failures.length > 0) {
    throw new Error(`Refusing to start in production:\n  - ${failures.join('\n  - ')}`);
  }
}

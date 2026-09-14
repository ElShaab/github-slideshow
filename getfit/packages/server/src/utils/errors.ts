/**
 * Errors that are safe to show a user. Anything else is reported to the client
 * as a generic "Something went wrong" so stack traces never leak.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthorized: (message = 'You need to sign in to continue.') =>
    new AppError('unauthorized', message, 401),
  forbidden: (message = 'You do not have access to this.') =>
    new AppError('forbidden', message, 403),
  notFound: (message = 'We could not find what you were looking for.') =>
    new AppError('not_found', message, 404),
  invalidInput: (message = 'Please check the details you entered.', details?: unknown) =>
    new AppError('invalid_input', message, 422, details),
  conflict: (message = 'That conflicts with something that already exists.') =>
    new AppError('conflict', message, 409),
  subscriptionRequired: (message = 'Your GetFit membership is not active.') =>
    new AppError('subscription_required', message, 402),
  assessmentLocked: (message = 'Your next assessment is not available yet.') =>
    new AppError('assessment_locked', message, 423),
  analysisFailed: (message = 'We could not analyse that photo. Please try again.') =>
    new AppError('analysis_failed', message, 502),
  paymentFailed: (message = 'That payment could not be completed.') =>
    new AppError('payment_failed', message, 402),
  programGenerationFailed: (message = 'We could not build your program. Please try again.') =>
    new AppError('program_generation_failed', message, 500),
  uploadFailed: (message = 'That photo could not be uploaded. Please try again.') =>
    new AppError('upload_failed', message, 400),
};

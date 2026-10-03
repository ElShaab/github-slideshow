/**
 * The server's errors are the shared domain errors — re-exported here so the
 * existing `../utils/errors` imports keep working, and so there is one
 * definition rather than a server copy and a device copy that drift.
 */
export { AppError, errors } from '@getfit/shared';

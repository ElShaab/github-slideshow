/**
 * Where in the product journey the user currently is.
 *
 * Its own module so that the rules about stages can be imported without
 * importing the provider that owns them — a provider that pulls in the store,
 * the local repository and the billing adapter behind it.
 */
export type SessionStage =
  | 'loading'
  | 'onboarding'
  | 'analysis'
  | 'paywall'
  | 'account'
  | 'preferences'
  | 'program'
  | 'ready'
  | 'expired';

import { legal, missingLegalFields } from './legal';
import { readinessProblems, type ReadinessProblem } from './readiness';
import { accountsAvailable } from '../supabase/auth';

/**
 * The configuration a shipped build cannot do without.
 *
 * Each of these is something App Review checks, and each fails in a way that is
 * invisible on the machine that built the app — a missing privacy-policy link
 * is a Guideline 3.1.2 rejection two days after upload, not a build error.
 *
 * Surfacing them at launch, in the build itself, is the only way they get found
 * before submission rather than after.
 */
export type { ReadinessProblem };

export function releaseReadiness(): ReadinessProblem[] {
  return readinessProblems({
    // accountsAvailable rather than "the two strings are present": it also
    // builds the client. A build carrying keys whose client cannot be
    // constructed would otherwise pass this check and go on skipping the
    // account step in exactly the same silence.
    supabaseConfigured: accountsAvailable(),
    missingLegalFields: missingLegalFields(),
  });
}

export { legal };

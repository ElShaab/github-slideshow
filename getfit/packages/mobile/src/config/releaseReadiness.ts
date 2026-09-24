import { legal, missingLegalFields } from './legal';
import { readinessProblems, type ReadinessProblem } from './readiness';
import { isSupabaseConfigured } from '../supabase/client';

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
    supabaseConfigured: isSupabaseConfigured,
    missingLegalFields: missingLegalFields(),
  });
}

export { legal };

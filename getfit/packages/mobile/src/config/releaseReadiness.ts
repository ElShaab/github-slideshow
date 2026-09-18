import { legal, missingLegalFields } from './legal';

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
export interface ReadinessProblem {
  field: string;
  detail: string;
}

export function releaseReadiness(): ReadinessProblem[] {
  const problems: ReadinessProblem[] = [];

  // No API URL is checked because there is no API. Every read and write goes
  // to local storage, so a build with no network configuration is correct.
  for (const field of missingLegalFields()) {
    problems.push({
      field,
      detail:
        'App Review requires a working link to this from inside the app. Set it in app.json under extra.legal.',
    });
  }

  return problems;
}

/**
 * Whether this build is fit to submit. Development builds are exempt: the
 * localhost fallback is the point of them.
 */
export function isReleaseReady(): boolean {
  return __DEV__ || releaseReadiness().length === 0;
}

export { legal };

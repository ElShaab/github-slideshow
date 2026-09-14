import { API_BASE_URL, apiBaseUrlIsSecure } from '../api/client';
import { legal, missingLegalFields } from './legal';

/**
 * The configuration a shipped build cannot do without.
 *
 * Each of these is something App Review checks, and each fails in a way that is
 * invisible on the machine that built the app: an unset API URL looks fine in
 * Expo Go and reaches nothing on a reviewer's phone; a missing privacy-policy
 * link is a Guideline 3.1.2 rejection two days after upload.
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

  if (!API_BASE_URL) {
    problems.push({
      field: 'EXPO_PUBLIC_API_URL',
      detail: 'No API URL is configured, so the app cannot reach its server at all.',
    });
  } else if (!apiBaseUrlIsSecure) {
    problems.push({
      field: 'EXPO_PUBLIC_API_URL',
      detail: `"${API_BASE_URL}" is not https. App Transport Security blocks cleartext requests, so every call would fail on a real device.`,
    });
  }

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

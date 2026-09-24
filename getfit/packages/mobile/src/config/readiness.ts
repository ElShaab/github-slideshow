/**
 * What a shipped build cannot do without, as a pure rule.
 *
 * Separated from the values it reads so it can be tested off-device: the whole
 * point of this check is to catch a misconfigured build before submission, and
 * a check nobody can test is one more thing to be wrong.
 */

export interface ReadinessProblem {
  field: string;
  detail: string;
}

export interface ReadinessInput {
  /** Whether this build carries a Supabase project. */
  supabaseConfigured: boolean;
  /** Legal URLs still unset, named as they appear in app.json. */
  missingLegalFields: string[];
}

export function readinessProblems(input: ReadinessInput): ReadinessProblem[] {
  const problems: ReadinessProblem[] = [];

  // No API URL is checked because there is no API. Every read and write goes to
  // local storage, so a build with no network configuration is correct.
  //
  // Supabase is different, and only became so when the account after payment
  // stopped being optional. Without it the app reports every user as having a
  // finished account, so the account step is skipped in silence: the customer
  // pays and lands in the exercise picker, and nothing says the build was
  // missing its keys. That is the kind of failure this exists to turn into a
  // sentence.
  if (!input.supabaseConfigured) {
    problems.push({
      field: 'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      detail:
        'Accounts are required after payment, and this build carries no Supabase project, ' +
        'so nobody can create one. These are read at build time — set them in ' +
        'packages/mobile/.env (or in EAS) and build again.',
    });
  }

  for (const field of input.missingLegalFields) {
    problems.push({
      field,
      detail:
        'App Review requires a working link to this from inside the app. Set it in app.json under extra.legal.',
    });
  }

  return problems;
}

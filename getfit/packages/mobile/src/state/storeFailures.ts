/**
 * A short code for every distinct way a purchase can fail.
 *
 * App Review rejected build 9 with a screenshot of "Purchase cancelled." and
 * nothing else. That sentence could have come from four places, and there was
 * no way to tell which from the only evidence anyone had — a photograph of a
 * screen. These codes exist so that a screenshot, from a reviewer or from a
 * customer in a support email, names the line it came from.
 *
 * The codes are stable and must stay that way. Renumbering them turns every
 * screenshot taken before the change into a wrong answer, which is worse than
 * having no code at all. Retire one by leaving a gap.
 *
 * They are shown to the customer, in brackets after a sentence that already
 * says what went wrong in plain words. Nobody should need to read the code to
 * understand the message; it is there so that the one person who has to debug
 * it does not have to guess.
 */
export const STORE_FAILURE = {
  /** The billing library is not linked into this build at all. */
  moduleMissing: 'GF-01',
  /** initConnection failed, so the app never reached the store. */
  connectFailed: 'GF-02',
  /** The store has no such product. Wrong id, or not ready to sell. */
  productMissing: 'GF-03',
  /** Android: the base plan carries no offer token to buy against. */
  noOffer: 'GF-04',
  /** The store reported a cancellation, and it had priced the product. */
  cancelled: 'GF-05',
  /**
   * The store reported a cancellation for a product it never priced.
   *
   * Almost certainly not a cancellation: StoreKit says this when the sheet
   * could not meaningfully open. This is the code App Review's failure would
   * have carried.
   */
  cancelledUnavailable: 'GF-06',
  /** Waiting on somebody else — Ask to Buy, or a slow payment method. */
  deferred: 'GF-07',
  /** Already owned, and reading the existing purchase back found nothing. */
  alreadyOwned: 'GF-08',
  /** The store could not be reached, or answered with a service error. */
  network: 'GF-09',
  /** The store refused with a code we do not have a specific case for. */
  storeError: 'GF-10',
  /** A transaction arrived carrying neither a transaction id nor a receipt. */
  unverifiable: 'GF-11',
  /** Two minutes passed with no transaction and no error. */
  timedOut: 'GF-12',
  /** The purchase succeeded; writing it down on the device did not. */
  notRecorded: 'GF-13',
  /** Restore ran and the store reported nothing to restore. */
  nothingToRestore: 'GF-14',
  /** Anything that reached the screen without being classified. */
  unknown: 'GF-99',
} as const;

export type StoreFailureCode = (typeof STORE_FAILURE)[keyof typeof STORE_FAILURE];

/** Carries a code alongside the sentence shown to the customer. */
export interface CodedFailure {
  readonly failureCode: StoreFailureCode;
}

/**
 * The code on an error, or `unknown` for anything that never carried one.
 *
 * Deliberately not `error.code`: react-native-iap puts the store's own codes
 * there — `E_USER_CANCELLED` and friends — and conflating the two would make a
 * screenshot say `GF-E_USER_CANCELLED` or worse, nothing.
 */
export function failureCodeOf(error: unknown): StoreFailureCode {
  const code = (error as Partial<CodedFailure> | null)?.failureCode;
  return isFailureCode(code) ? code : STORE_FAILURE.unknown;
}

function isFailureCode(value: unknown): value is StoreFailureCode {
  return (
    typeof value === 'string' &&
    (Object.values(STORE_FAILURE) as string[]).includes(value)
  );
}

/**
 * The sentence as the customer sees it.
 *
 * The code goes last and in brackets so it reads as a reference rather than
 * part of the sentence. A message that already ends in one is left alone, so
 * that passing a message through twice cannot produce "(GF-05) (GF-05)".
 */
export function withFailureCode(message: string, code: StoreFailureCode): string {
  const trimmed = message.trim();
  if (trimmed.endsWith(`(${code})`)) return trimmed;
  return `${trimmed} (${code})`;
}

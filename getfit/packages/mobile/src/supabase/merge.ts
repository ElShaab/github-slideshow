import type {
  AssessmentsDocument,
  ProfileDocument,
  ProgramDocument,
  WorkoutsDocument,
} from '../local/documents';
import { recordId } from './rows';

/**
 * How two copies of the same account are reconciled.
 *
 * A user with a phone and a tablet, or a phone restored from backup, ends up
 * with the device and the server each holding a version. Picking a winner
 * wholesale would be simple and would also throw away a week of logged
 * workouts, so the rule depends on what the data is:
 *
 *   - History is append-only. An assessment or a finished workout is written
 *     once and never edited, so the two sides are unioned by id. Nothing is
 *     ever lost, and the same row arriving twice is the same row.
 *   - The profile and the programme are overwritten in place. There is no
 *     union to take, so the more recently written side wins outright.
 *
 * Every function here is pure, and none of them can drop a history entry that
 * either side holds — that is the invariant the tests pin down.
 */

/** Which side was written last. Ties go to the local copy: it is in the user's hands. */
export type Winner = 'local' | 'remote';

export function newerSide(localAt: string | null, remoteAt: string | null): Winner {
  if (!remoteAt) return 'local';
  if (!localAt) return 'remote';
  const local = Date.parse(localAt);
  const remote = Date.parse(remoteAt);
  if (Number.isNaN(remote)) return 'local';
  if (Number.isNaN(local)) return 'remote';
  return remote > local ? 'remote' : 'local';
}

/**
 * Union by id, newest first.
 *
 * `local` is listed first so that when both sides carry the same id — the same
 * record pushed and pulled back — the device's copy is the one kept. They
 * should be identical; if a round trip through Postgres has rounded a number,
 * the untouched original is the better of the two.
 */
function unionById<T>(local: T[], remote: T[], idOf: (item: T) => string): T[] {
  const byId = new Map<string, T>();
  for (const item of remote) byId.set(idOf(item), item);
  for (const item of local) byId.set(idOf(item), item);
  return [...byId.values()];
}

export function mergeAssessments(
  local: AssessmentsDocument,
  remote: AssessmentsDocument,
): AssessmentsDocument {
  const assessments = unionById(local.assessments, remote.assessments, (a) => a.id).sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );

  // assessmentNumber is "your 4th analysis", and two devices that each ran one
  // offline would both claim the same number. Chronological order is the truth,
  // so they are renumbered from it.
  return {
    assessments: assessments.map((assessment, index) => ({
      ...assessment,
      assessmentNumber: index + 1,
    })),
  };
}

export function mergeWorkouts(
  local: WorkoutsDocument,
  remote: WorkoutsDocument,
): WorkoutsDocument {
  return {
    completed: unionById(local.completed, remote.completed, (workout) => workout.id).sort(
      (a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt),
    ),
    records: unionById(local.records, remote.records, recordId).sort(
      (a, b) => Date.parse(a.achievedAt) - Date.parse(b.achievedAt),
    ),
  };
}

/**
 * The profile, resolved as a whole.
 *
 * One exception: a profile that has completed onboarding always beats one that
 * has not, whatever the timestamps say. Signing in on a fresh install writes an
 * empty profile a moment later than the real one on the server, and letting
 * that win would wipe the account clean on sight.
 */
export function mergeProfile(
  local: ProfileDocument,
  remote: ProfileDocument,
  winner: Winner,
): ProfileDocument {
  const localComplete = local.profile?.onboardingCompleted ?? false;
  const remoteComplete = remote.profile?.onboardingCompleted ?? false;

  if (localComplete !== remoteComplete) return localComplete ? local : remote;
  return winner === 'remote' ? remote : local;
}

/**
 * The programme and its schedule, resolved together.
 *
 * They are one unit: a schedule points at day ids inside a programme, so taking
 * the newer programme and the older schedule would leave slots referring to
 * days that no longer exist. A programme-less side never wins — there is
 * nothing there to prefer.
 */
export function mergeProgram(
  local: ProgramDocument,
  remote: ProgramDocument,
  winner: Winner,
): ProgramDocument {
  if (!remote.program) return local;
  if (!local.program) return remote;
  return winner === 'remote' ? remote : local;
}

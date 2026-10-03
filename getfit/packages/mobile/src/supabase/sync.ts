import {
  DOCUMENT_KEYS,
  emptyAssessments,
  emptyProfile,
  emptyProgram,
  emptyWorkouts,
  type AssessmentsDocument,
  type ProfileDocument,
  type ProgramDocument,
  type WorkoutsDocument,
} from '../local/documents';
import type { DocumentStore } from '../local/store';
import {
  mergeAssessments,
  mergeProfile,
  mergeProgram,
  mergeWorkouts,
  newerSide,
} from './merge';
import {
  assessmentsDocToRows,
  profileDocToRows,
  programDocToRows,
  rowsToAssessmentsDoc,
  rowsToProfileDoc,
  rowsToProgramDoc,
  rowsToWorkoutsDoc,
  workoutsDocToRows,
  type AssessmentRow,
  type ProfileRows,
  type ProgramRows,
  type WorkoutRows,
} from './rows';

/** Everything the account holds on the server, as the device needs to see it. */
export interface RemoteSnapshot {
  /** Null when this account has never been written to. */
  profile: ProfileRows | null;
  profileUpdatedAt: string | null;
  program: ProgramRows;
  programUpdatedAt: string | null;
  workouts: WorkoutRows;
  assessments: AssessmentRow[];
}

export interface PushPayload {
  profile: ProfileRows;
  program: ProgramRows;
  workouts: WorkoutRows;
  assessments: AssessmentRow[];
}

/**
 * The storage the engine talks to, narrowed to three operations.
 *
 * Declared as an interface rather than reaching for the Supabase client
 * directly, so the reconciliation above can be tested against an in-memory
 * backend instead of a network.
 */
export interface SyncBackend {
  fetchAll(userId: string): Promise<RemoteSnapshot>;
  push(userId: string, payload: PushPayload): Promise<void>;
  deleteAll(userId: string): Promise<void>;
}

/** Local bookkeeping: when each overwritable document was last written here. */
export const SYNC_KEY = 'getfit.local.sync';

export interface SyncMeta {
  profileUpdatedAt: string | null;
  programUpdatedAt: string | null;
  lastSyncedAt: string | null;
  /** True when a local write has not reached the server yet. */
  pending: boolean;
}

export const emptySyncMeta = (): SyncMeta => ({
  profileUpdatedAt: null,
  programUpdatedAt: null,
  lastSyncedAt: null,
  pending: false,
});

export type SyncOutcome = 'synced' | 'pending' | 'failed';

export interface SyncResult {
  outcome: SyncOutcome;
  /** Null unless the sync failed, in which case it says why. */
  error: string | null;
}

/**
 * Keeps the device and the account in step.
 *
 * The device stays the working copy: every screen still reads and writes local
 * storage, and nothing waits on a network. This runs alongside — it pulls what
 * the account holds, reconciles it with what is here, writes the result back
 * locally, and pushes the union up. A sync that fails leaves the device
 * untouched and marks the account as having unsent work, so the next one
 * catches up. Losing signal costs nothing; losing the phone costs nothing.
 */
export class SyncEngine {
  private running: Promise<SyncResult> | null = null;

  constructor(
    private readonly store: DocumentStore,
    private readonly backend: SyncBackend,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  meta(): Promise<SyncMeta> {
    return this.store.read<SyncMeta>(SYNC_KEY, emptySyncMeta);
  }

  /**
   * Records that an overwritable document changed on this device.
   *
   * Only the profile and the programme need this: history is unioned, so it
   * never needs to know which side is newer. The stamp is what lets a device
   * that has been edited offline win against a stale server copy.
   */
  async noteLocalChange(key: string): Promise<void> {
    const field =
      key === DOCUMENT_KEYS.profile
        ? 'profileUpdatedAt'
        : key === DOCUMENT_KEYS.program
          ? 'programUpdatedAt'
          : null;

    await this.store.update<SyncMeta>(SYNC_KEY, emptySyncMeta, (current) => ({
      ...current,
      ...(field ? { [field]: this.now() } : {}),
      pending: true,
    }));
  }

  /**
   * One full reconcile.
   *
   * Concurrent calls share the one in flight — the app asks on sign-in and
   * again whenever it returns to the foreground, and those overlap.
   */
  sync(userId: string): Promise<SyncResult> {
    if (this.running) return this.running;
    this.running = this.reconcile(userId).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async reconcile(userId: string): Promise<SyncResult> {
    const meta = await this.meta();

    let remote: RemoteSnapshot;
    try {
      remote = await this.backend.fetchAll(userId);
    } catch (error) {
      return this.failed(error);
    }

    const [localProfile, localProgram, localWorkouts, localAssessments] = await Promise.all([
      this.store.read<ProfileDocument>(DOCUMENT_KEYS.profile, () =>
        emptyProfile(userId, this.now()),
      ),
      this.store.read<ProgramDocument>(DOCUMENT_KEYS.program, emptyProgram),
      this.store.read<WorkoutsDocument>(DOCUMENT_KEYS.workouts, emptyWorkouts),
      this.store.read<AssessmentsDocument>(DOCUMENT_KEYS.assessments, emptyAssessments),
    ]);

    // An account with nothing in it is the first sign-in on this phone: adopt
    // what is already here rather than reconciling against emptiness.
    const merged = remote.profile
      ? this.reconcileWith(
          { localProfile, localProgram, localWorkouts, localAssessments },
          remote,
          meta,
        )
      : { localProfile, localProgram, localWorkouts, localAssessments };

    const payload: PushPayload = {
      profile: profileDocToRows(userId, merged.localProfile),
      program: programDocToRows(userId, merged.localProgram),
      workouts: workoutsDocToRows(userId, merged.localWorkouts),
      assessments: assessmentsDocToRows(userId, merged.localAssessments),
    };

    try {
      await this.backend.push(userId, payload);
    } catch (error) {
      // The merge is still worth keeping: it is the union of both sides, and
      // dropping it would mean pulling the same rows again next time.
      await this.writeLocal(merged);
      return this.failed(error);
    }

    await this.writeLocal(merged);
    await this.store.update<SyncMeta>(SYNC_KEY, emptySyncMeta, (current) => ({
      ...current,
      lastSyncedAt: this.now(),
      pending: false,
    }));

    return { outcome: 'synced', error: null };
  }

  private reconcileWith(
    local: {
      localProfile: ProfileDocument;
      localProgram: ProgramDocument;
      localWorkouts: WorkoutsDocument;
      localAssessments: AssessmentsDocument;
    },
    remote: RemoteSnapshot,
    meta: SyncMeta,
  ) {
    const remoteProfile = rowsToProfileDoc(remote.profile as ProfileRows);
    const localUserId = remoteProfile.userId;

    return {
      localProfile: mergeProfile(
        local.localProfile,
        remoteProfile,
        newerSide(meta.profileUpdatedAt, remote.profileUpdatedAt),
      ),
      localProgram: mergeProgram(
        local.localProgram,
        rowsToProgramDoc(remote.program, localUserId),
        newerSide(meta.programUpdatedAt, remote.programUpdatedAt),
      ),
      localWorkouts: mergeWorkouts(
        local.localWorkouts,
        rowsToWorkoutsDoc(remote.workouts, localUserId),
      ),
      localAssessments: mergeAssessments(
        local.localAssessments,
        rowsToAssessmentsDoc(remote.assessments, localUserId),
      ),
    };
  }

  private async writeLocal(merged: {
    localProfile: ProfileDocument;
    localProgram: ProgramDocument;
    localWorkouts: WorkoutsDocument;
    localAssessments: AssessmentsDocument;
  }): Promise<void> {
    // Through `update` rather than `write`, so these queue behind any write
    // already in flight. History is re-merged against whatever is on disk by
    // then, so a set logged mid-sync survives; the profile and the programme
    // take the resolved copy, which is what the merge above just decided.
    await this.store.update<ProfileDocument>(
      DOCUMENT_KEYS.profile,
      () => merged.localProfile,
      () => merged.localProfile,
    );
    await this.store.update<ProgramDocument>(
      DOCUMENT_KEYS.program,
      emptyProgram,
      () => merged.localProgram,
    );
    await this.store.update<WorkoutsDocument>(DOCUMENT_KEYS.workouts, emptyWorkouts, (current) =>
      mergeWorkouts(current, merged.localWorkouts),
    );
    await this.store.update<AssessmentsDocument>(
      DOCUMENT_KEYS.assessments,
      emptyAssessments,
      (current) => mergeAssessments(current, merged.localAssessments),
    );
  }

  /** Removes the account's rows. Local data is cleared separately. */
  async deleteRemote(userId: string): Promise<void> {
    await this.backend.deleteAll(userId);
  }

  private async failed(error: unknown): Promise<SyncResult> {
    await this.store.update<SyncMeta>(SYNC_KEY, emptySyncMeta, (current) => ({
      ...current,
      pending: true,
    }));
    const message = error instanceof Error ? error.message : 'Sync failed.';
    // Never surfaced as a blocking error: the app works offline by design.
    console.warn('GetFit sync failed:', message);
    return { outcome: 'failed', error: message };
  }
}

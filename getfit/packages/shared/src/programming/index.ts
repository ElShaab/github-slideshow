/**
 * Training programme logic.
 *
 * These are the rules that decide what a user is asked to do: which split,
 * which exercises, how many sets, what weight to start at, when to add load,
 * and how a session fits the time available. They were written as server
 * services and are pure functions over their inputs, so they run unchanged on
 * a device with no network.
 */
export * from './splits';
export * from './sessionBudget';
export * from './startingWeight';
export * from './cardio';
export * from './exerciseSelection';
export * from './progression';
export * from './programGeneration';
export * from './workoutAdaptation';
export * from './goalTracking';
export * from './personalRecords';

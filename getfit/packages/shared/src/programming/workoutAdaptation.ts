import { addDays, isoDate } from '../format';
import type { TrainingDays } from '../types';

export interface ScheduleSlot {
  id: string;
  workoutDayId: string;
  dayNumber: number;
  focus: string;
  scheduledDate: string;
  status: 'scheduled' | 'completed' | 'missed' | 'rescheduled';
}

export interface RescheduleResult {
  updates: Array<{ id: string; scheduledDate: string; status: ScheduleSlot['status'] }>;
  notes: string[];
}

/**
 * WorkoutAdaptationService
 *
 * A missed workout is never deleted. It is folded back into the remaining days
 * of the week so muscle frequency and the order of the split are preserved. If
 * the week has no room left the session moves to the front of the next week
 * rather than disappearing.
 */
export class WorkoutAdaptationService {
  /**
   * Reorganises the current week after `today` given the sessions still to come.
   *
   * @param slots     every scheduled slot in the current week
   * @param today     the date the reorganisation runs on
   * @param weekEnd   last date of the current training week
   */
  reorganiseWeek(slots: ScheduleSlot[], today: Date, weekEnd: Date): RescheduleResult {
    const updates: RescheduleResult['updates'] = [];
    const notes: string[] = [];
    const todayKey = isoDate(today);

    const missed = slots
      .filter((s) => s.status === 'scheduled' && s.scheduledDate < todayKey)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

    if (missed.length === 0) return { updates, notes };

    const upcoming = slots
      .filter((s) => s.status === 'scheduled' && s.scheduledDate >= todayKey)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

    // Dates still free between today and the end of the training week.
    const takenDates = new Set(
      slots.filter((s) => s.status !== 'missed').map((s) => s.scheduledDate),
    );
    const freeDates: string[] = [];
    for (let date = new Date(today); date <= weekEnd; date = addDays(date, 1)) {
      const key = isoDate(date);
      if (!takenDates.has(key)) freeDates.push(key);
    }

    for (const slot of missed) {
      const target = freeDates.shift();
      if (target) {
        updates.push({ id: slot.id, scheduledDate: target, status: 'rescheduled' });
        takenDates.add(target);
        notes.push(`${slot.focus} moved to ${target} so the week keeps its muscle frequency.`);
        continue;
      }

      // No gap left. Push it to the day after the last remaining session so the
      // split order is preserved rather than doubling up two hard sessions.
      const last = upcoming[upcoming.length - 1];
      const anchor = last ? new Date(`${last.scheduledDate}T00:00:00Z`) : weekEnd;
      let candidate = addDays(anchor, 1);
      while (takenDates.has(isoDate(candidate))) candidate = addDays(candidate, 1);

      const key = isoDate(candidate);
      updates.push({ id: slot.id, scheduledDate: key, status: 'rescheduled' });
      takenDates.add(key);
      notes.push(`${slot.focus} carried into ${key} — the week was already full.`);
    }

    return { updates, notes };
  }

  /**
   * Lays out a week of training. Sessions are spread across the week rather
   * than stacked, so recovery between hard days is preserved.
   */
  planWeek(startDate: Date, trainingDays: TrainingDays, dayNumbers: number[]): Array<{ dayNumber: number; date: string }> {
    const offsets = WEEK_LAYOUTS[trainingDays];
    return dayNumbers.slice(0, trainingDays).map((dayNumber, index) => ({
      dayNumber,
      date: isoDate(addDays(startDate, offsets[index] ?? index)),
    }));
  }
}

/**
 * Day offsets from the start of the training week. Rest days are placed where
 * they do the most good — e.g. four days becomes Mon/Tue/Thu/Fri.
 */
export const WEEK_LAYOUTS: Record<TrainingDays, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 3, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

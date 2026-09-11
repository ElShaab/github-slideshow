import * as bcrypt from 'bcryptjs';
import type {
  AppSettings,
  EquipmentId,
  ExercisePreference,
  UserGoal,
  UserProfile,
} from '@getfit/shared';
import { userRepository } from '../repositories/userRepository';
import { errors } from '../utils/errors';
import { photoStorageService } from './photoStorageService';
import { programService } from './programService';

export interface OnboardingInput {
  age: number;
  sex: UserProfile['sex'];
  heightCm: number;
  weightKg: number;
  trainingLevel: UserProfile['trainingLevel'];
  trainingLocation: UserProfile['trainingLocation'];
  trainingDays: UserProfile['trainingDays'];
  sessionDurationMinutes: UserProfile['sessionDurationMinutes'];
  goals: UserGoal[];
  equipment: EquipmentId[];
}

/** Settings changes that require future training to be regenerated. */
const PROGRAM_AFFECTING_FIELDS: Array<keyof UserProfile> = [
  'trainingLevel',
  'trainingLocation',
  'trainingDays',
  'sessionDurationMinutes',
  'weightKg',
  'sex',
  'age',
];

/**
 * UserService
 *
 * Owns the user record and everything hanging off it: onboarding, converting a
 * guest into a real account after payment, settings changes that force a
 * program rebuild, and account deletion.
 */
export class UserService {
  /** A guest identity is created before onboarding so nothing is ever orphaned. */
  async createGuest(): Promise<{ userId: string; isGuest: boolean }> {
    const user = await userRepository.createGuest();
    return { userId: user.id, isGuest: user.is_guest };
  }

  async saveOnboarding(userId: string, input: OnboardingInput): Promise<UserProfile> {
    if (input.goals.length === 0) {
      throw errors.invalidInput('Choose at least one goal.');
    }

    const profile = await userRepository.upsertProfile(userId, {
      age: input.age,
      sex: input.sex,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      trainingLevel: input.trainingLevel,
      trainingLocation: input.trainingLocation,
      trainingDays: input.trainingDays,
      sessionDurationMinutes: input.sessionDurationMinutes,
      onboardingCompleted: true,
    });

    await userRepository.setGoals(userId, input.goals);
    await userRepository.setEquipment(
      userId,
      input.trainingLocation === 'home' ? input.equipment : [],
    );

    return profile;
  }

  /**
   * Completes the account after payment. The guest user is upgraded in place so
   * the assessment taken before signup stays attached to the same person.
   */
  async completeAccount(userId: string, email: string, password: string): Promise<void> {
    const normalised = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
      throw errors.invalidInput('Enter a valid email address.');
    }
    if (password.length < 8) {
      throw errors.invalidInput('Use a password of at least 8 characters.');
    }

    const existing = await userRepository.findByEmail(normalised);
    if (existing && existing.id !== userId) {
      throw errors.conflict('An account already uses that email address.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await userRepository.attachCredentials(userId, normalised, passwordHash);
  }

  async verifyPassword(email: string, password: string): Promise<string | null> {
    const user = await userRepository.findByEmail(email.trim().toLowerCase());
    if (!user?.password_hash) return null;
    const matches = await bcrypt.compare(password, user.password_hash);
    return matches ? user.id : null;
  }

  /**
   * Applies a settings change and rebuilds future training when the change
   * affects programming. History is never touched.
   */
  async updateProfile(userId: string, patch: Partial<UserProfile>): Promise<{
    profile: UserProfile;
    programRegenerated: boolean;
  }> {
    const before = await userRepository.getProfile(userId);
    if (!before) throw errors.notFound('Profile not found.');

    const profile = await userRepository.updateProfile(userId, patch);
    if (!profile) throw errors.notFound('Profile not found.');

    const changed = PROGRAM_AFFECTING_FIELDS.some(
      (field) => patch[field] !== undefined && patch[field] !== before[field],
    );

    if (changed) {
      await programService.generateAndSave(userId, 'profile_change');
    }

    return { profile, programRegenerated: changed };
  }

  async updateGoals(userId: string, goals: UserGoal[]): Promise<UserGoal[]> {
    if (goals.length === 0) throw errors.invalidInput('Choose at least one goal.');
    const saved = await userRepository.setGoals(userId, goals);
    await programService.generateAndSave(userId, 'goal_change');
    return saved;
  }

  async updateEquipment(userId: string, equipment: EquipmentId[]): Promise<EquipmentId[]> {
    const saved = await userRepository.setEquipment(userId, equipment);
    await programService.generateAndSave(userId, 'equipment_change');
    return saved;
  }

  async updatePreferences(
    userId: string,
    preferences: ExercisePreference[],
  ): Promise<ExercisePreference[]> {
    const saved = await userRepository.setPreferences(userId, preferences);
    await programService.generateAndSave(userId, 'preference_change');
    return saved;
  }

  async getSettings(userId: string): Promise<AppSettings> {
    return userRepository.getSettings(userId);
  }

  async updateSettings(userId: string, patch: Partial<AppSettings>): Promise<AppSettings> {
    return userRepository.updateSettings(userId, patch);
  }

  /**
   * Deletes the account. Stored photo files are removed from the storage
   * driver first, then the user row — every dependent table cascades from it.
   */
  async deleteAccount(userId: string): Promise<{ photosRemoved: number }> {
    const photosRemoved = await photoStorageService.deleteAllForUser(userId);
    await userRepository.deleteAccount(userId);
    return { photosRemoved };
  }
}

export const userService = new UserService();

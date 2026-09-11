import type { NavigatorScreenParams } from '@react-navigation/native';

export type OnboardingStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  Basics: undefined;
  Level: undefined;
  Location: undefined;
  Equipment: undefined;
  Schedule: undefined;
  Goals: undefined;
  Measurements: undefined;
  Photo: undefined;
};

export type AnalysisStackParamList = {
  PhotoGuidance: undefined;
  Analyzing: { photoUri: string };
  BodyResult: { assessmentId: string };
};

export type MainTabParamList = {
  Home: undefined;
  Workouts: undefined;
  Progress: undefined;
};

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Analysis: NavigatorScreenParams<AnalysisStackParamList>;
  Paywall: undefined;
  CreateAccount: undefined;
  ExercisePreferences: { fromSettings?: boolean } | undefined;
  GeneratingProgram: undefined;
  Renewal: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  GuidedWorkout: { workoutDayId: string; scheduledWorkoutId: string | null };
  WorkoutComplete: { summaryId: string };
  ExerciseDetail: { exerciseId: string };
  History: undefined;
  WeeklyAssessment: undefined;
  Settings: undefined;
  SettingsProfile: undefined;
  SettingsTraining: undefined;
  SettingsGoals: undefined;
  SettingsEquipment: undefined;
  SettingsSubscription: undefined;
  SettingsPrivacy: undefined;
};

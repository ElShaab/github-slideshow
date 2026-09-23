import React, { useCallback, useMemo } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ErrorState, LoadingScreen } from '../components';
import { AnalysisFlow } from '../screens/analysis/AnalysisFlow';
import { HistoryScreen } from '../screens/history/HistoryScreen';
import { WeeklyAssessmentScreen } from '../screens/history/WeeklyAssessmentScreen';
import { HomeScreen } from '../screens/main/HomeScreen';
import { ProgressScreen } from '../screens/main/ProgressScreen';
import { WorkoutsScreen } from '../screens/main/WorkoutsScreen';
import { CreateAccountScreen } from '../screens/membership/CreateAccountScreen';
import { PaywallScreen, RenewalScreen } from '../screens/membership/PaywallScreen';
import { BasicsScreen } from '../screens/onboarding/BasicsScreen';
import { EquipmentScreen } from '../screens/onboarding/EquipmentScreen';
import { GoalsScreen } from '../screens/onboarding/GoalsScreen';
import { LevelScreen } from '../screens/onboarding/LevelScreen';
import { LocationScreen } from '../screens/onboarding/LocationScreen';
import { MeasurementsScreen } from '../screens/onboarding/MeasurementsScreen';
import { PhotoScreen } from '../screens/onboarding/PhotoScreen';
import { ScheduleScreen } from '../screens/onboarding/ScheduleScreen';
import { SignInScreen } from '../screens/onboarding/SignInScreen';
import { WelcomeScreen } from '../screens/onboarding/WelcomeScreen';
import { ExercisePreferencesScreen } from '../screens/preferences/ExercisePreferencesScreen';
import { GeneratingProgramScreen } from '../screens/preferences/GeneratingProgramScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import {
  SettingsEquipmentScreen,
  SettingsGoalsScreen,
  SettingsPrivacyScreen,
  SettingsProfileScreen,
  SettingsSubscriptionScreen,
  SettingsTrainingScreen,
} from '../screens/settings/SettingsDetailScreens';
import { DisclaimerScreen } from '../screens/settings/DisclaimerScreen';
import { ExerciseDetailScreen } from '../screens/workout/ExerciseDetailScreen';
import { GuidedWorkoutScreen } from '../screens/workout/GuidedWorkoutScreen';
import { WorkoutCompleteScreen } from '../screens/workout/WorkoutCompleteScreen';
import { useSession } from '../state/SessionProvider';
import { isBlocked } from '../state/sessionRecovery';
import { useTheme } from '../theme';
import { BottomNavigation } from './BottomNavigation';
import type { MainTabParamList, OnboardingStackParamList, RootStackParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

function OnboardingNavigator(): React.ReactElement {
  return (
    <OnboardingStack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <OnboardingStack.Screen name="Welcome" component={WelcomeScreen} />
      <OnboardingStack.Screen name="SignIn" component={SignInScreen} />
      <OnboardingStack.Screen name="Basics" component={BasicsScreen} />
      <OnboardingStack.Screen name="Level" component={LevelScreen} />
      <OnboardingStack.Screen name="Location" component={LocationScreen} />
      <OnboardingStack.Screen name="Equipment" component={EquipmentScreen} />
      <OnboardingStack.Screen name="Schedule" component={ScheduleScreen} />
      <OnboardingStack.Screen name="Goals" component={GoalsScreen} />
      <OnboardingStack.Screen name="Measurements" component={MeasurementsScreen} />
      <OnboardingStack.Screen name="Photo" component={PhotoScreen} />
    </OnboardingStack.Navigator>
  );
}

function MainTabs(): React.ReactElement {
  return (
    <Tabs.Navigator
      tabBar={(props) => <BottomNavigation {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Tabs.Screen name="Workouts" component={WorkoutsScreen} options={{ title: 'Workouts' }} />
      <Tabs.Screen name="Progress" component={ProgressScreen} options={{ title: 'Progress' }} />
    </Tabs.Navigator>
  );
}

/**
 * The root navigator switches on the session stage, so the user is always in
 * exactly the right place: onboarding → analysis → paywall → account →
 * preferences → program → the app. An expired membership replaces the whole
 * app with the renewal screen, which is what keeps paid features gated.
 */
export function RootNavigator(): React.ReactElement {
  const { isDark, colors } = useTheme();
  const session = useSession();

  const navigationTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.background,
        card: colors.backgroundElevated,
        text: colors.text,
        border: colors.divider,
      },
    };
  }, [colors, isDark]);

  const PaywallRoute = useCallback(() => <PaywallScreen variant="paywall" />, []);
  const RenewalRoute = useCallback(() => <RenewalScreen />, []);
  const PreferencesRoute = useCallback(
    () => <ExercisePreferencesScreen onDone={session.markPreferencesComplete} />,
    [session.markPreferencesComplete],
  );
  const GeneratingRoute = useCallback(
    () => <GeneratingProgramScreen onComplete={session.markProgramReady} />,
    [session.markProgramReady],
  );

  // A session that could not be resolved used to set an error nothing read,
  // leaving a spinner that never resolved. It gets a screen and a retry.
  if (isBlocked(session.stage, session.error)) {
    return (
      <ErrorState
        message={session.error ?? 'GetFit could not start.'}
        onRetry={() => void session.refresh()}
      />
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <RootStack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {session.stage === 'loading' ? (
          <RootStack.Screen name="Main" component={LoadingScreen} />
        ) : session.stage === 'onboarding' ? (
          <RootStack.Screen name="Onboarding" component={OnboardingNavigator} />
        ) : session.stage === 'analysis' ? (
          <RootStack.Screen name="Analysis" component={AnalysisFlow} />
        ) : session.stage === 'paywall' ? (
          <RootStack.Screen name="Paywall" component={PaywallRoute} />
        ) : session.stage === 'expired' ? (
          // Subscription-gated functionality stays blocked until it is restored.
          <RootStack.Screen name="Renewal" component={RenewalRoute} />
        ) : session.stage === 'account' ? (
          <RootStack.Screen name="CreateAccount" component={CreateAccountScreen} />
        ) : session.stage === 'preferences' ? (
          <RootStack.Screen name="ExercisePreferences" component={PreferencesRoute} />
        ) : session.stage === 'program' ? (
          <RootStack.Screen name="GeneratingProgram" component={GeneratingRoute} />
        ) : (
          <RootStack.Group>
            <RootStack.Screen name="Main" component={MainTabs} />
            <RootStack.Screen
              name="GuidedWorkout"
              component={GuidedWorkoutScreen}
              options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
            />
            <RootStack.Screen
              name="WorkoutComplete"
              component={WorkoutCompleteScreen}
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            <RootStack.Screen
              name="ExerciseDetail"
              component={ExerciseDetailScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
            <RootStack.Screen name="History" component={HistoryScreen} />
            <RootStack.Screen name="WeeklyAssessment" component={WeeklyAssessmentScreen} />
            <RootStack.Screen name="Settings" component={SettingsScreen} />
            <RootStack.Screen name="SettingsProfile" component={SettingsProfileScreen} />
            <RootStack.Screen name="SettingsTraining" component={SettingsTrainingScreen} />
            <RootStack.Screen name="SettingsGoals" component={SettingsGoalsScreen} />
            <RootStack.Screen name="SettingsEquipment" component={SettingsEquipmentScreen} />
            <RootStack.Screen name="SettingsSubscription" component={SettingsSubscriptionScreen} />
            <RootStack.Screen name="SettingsPrivacy" component={SettingsPrivacyScreen} />
            <RootStack.Screen name="SettingsDisclaimer" component={DisclaimerScreen} />
            <RootStack.Screen name="ExercisePreferences" component={PreferencesFromSettings} />
          </RootStack.Group>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

/** Preferences reached from Settings: saving rebuilds future training. */
function PreferencesFromSettings({
  navigation,
}: {
  navigation: { goBack: () => void };
}): React.ReactElement {
  return (
    <ExercisePreferencesScreen
      fromSettings
      onDone={navigation.goBack}
      onCancel={navigation.goBack}
    />
  );
}

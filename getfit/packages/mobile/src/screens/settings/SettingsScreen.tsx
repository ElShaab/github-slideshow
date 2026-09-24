import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  GOAL_LABELS,
  LEVEL_LABELS,
  formatHeight,
  formatMass,
  planForProduct,
  planPricing,
} from '@getfit/shared';
import {
  ErrorState,
  LegalLinks,
  LoadingScreen,
  Screen,
  SettingsGroup,
  SettingsRow,
  Text,
} from '../../components';
import { ApiError } from '../../api/client';
import { authApi, settingsApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useSession } from '../../state/SessionProvider';
import { useUnits } from '../../state/UnitsProvider';
import { useTheme } from '../../theme';
import { appVersion } from '../../config/appInfo';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

/**
 * Settings, reached from the small icon on Home — there is no Profile tab.
 * Changes that affect programming rebuild future training; history is kept.
 */
export function SettingsScreen({ navigation }: Props): React.ReactElement {
  const { spacing, reduceMotion, setReduceMotionOverride } = useTheme();
  const { units, setUnits } = useUnits();
  const { signOut, isGuest, email } = useSession();
  const settings = useAsync(() => settingsApi.load(), [], 'settingsApi.load');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      settings.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const confirmSignOut = useCallback(() => {
    Alert.alert(
      'Sign out?',
      'Your program, assessments and training history are removed from this phone. ' +
        'They stay in your account, and come back when you sign in again. ' +
        'Progress photos are only on this phone and will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  }, [signOut]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your profile, assessments, photos and training history — from this phone and from your GetFit account. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Are you sure?', 'This is your last chance to keep your data.', [
              { text: 'Keep my account', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  setBusy(true);
                  void authApi
                    .deleteAccount()
                    .then(() => signOut())
                    .catch((error: unknown) => {
                      // Deliberately explicit: the account's data is still
                      // there. Saying only "something went wrong" would leave
                      // someone believing they had deleted it.
                      Alert.alert(
                        'Your account was not deleted.',
                        error instanceof ApiError
                          ? error.message
                          : 'Nothing was removed. Check your connection and try again.',
                      );
                    })
                    .finally(() => setBusy(false));
                },
              },
            ]);
          },
        },
      ],
    );
  }, [signOut]);

  if (settings.loading && !settings.data) return <LoadingScreen message="Loading settings…" />;
  if (!settings.data) return <ErrorState
        message={settings.error ?? undefined}
        detail={settings.detail}
        onRetry={settings.reload}
      />;

  const { profile, goals, equipment, preferences, entitlement } = settings.data;
  const plan = planForProduct(entitlement.productId);
  // The detail screen asks the store for the exact localized figure; this row
  // only needs to name the plan, so it uses the bundled price.
  const pricing = plan ? planPricing(plan) : null;

  const membershipLabel = {
    active: 'Active',
    restored: 'Active',
    cancelled: 'Cancels at period end',
    expired: 'Expired',
    failed: 'Payment failed',
    pending: 'Pending',
    none: 'Not subscribed',
  }[entitlement.status];

  return (
    <Screen onRefresh={settings.reload} refreshing={settings.refreshing}>
      <Text variant="title" accessibilityRole="header">
        Settings
      </Text>

      <SettingsGroup title="Personal information">
        <SettingsRow
          label="Age"
          value={profile ? `${profile.age}` : '—'}
          onPress={() => navigation.navigate('SettingsProfile')}
        />
        <SettingsRow
          label="Sex"
          value={profile ? (profile.sex === 'male' ? 'Male' : 'Female') : '—'}
          onPress={() => navigation.navigate('SettingsProfile')}
        />
        <SettingsRow
          label="Height"
          value={formatHeight(profile?.heightCm, units)}
          onPress={() => navigation.navigate('SettingsProfile')}
        />
        <SettingsRow
          label="Weight"
          value={formatMass(profile?.weightKg, units)}
          onPress={() => navigation.navigate('SettingsProfile')}
          last
        />
      </SettingsGroup>

      <SettingsGroup title="Training">
        <SettingsRow
          label="Level"
          value={profile ? LEVEL_LABELS[profile.trainingLevel] : '—'}
          onPress={() => navigation.navigate('SettingsTraining')}
        />
        <SettingsRow
          label="Location"
          value={profile ? (profile.trainingLocation === 'home' ? 'Home' : 'Gym') : '—'}
          onPress={() => navigation.navigate('SettingsTraining')}
        />
        <SettingsRow
          label="Equipment"
          value={
            profile?.trainingLocation === 'gym'
              ? 'Full gym'
              : `${equipment.length} item${equipment.length === 1 ? '' : 's'}`
          }
          onPress={() => navigation.navigate('SettingsEquipment')}
        />
        <SettingsRow
          label="Training days"
          value={profile ? `${profile.trainingDays} per week` : '—'}
          onPress={() => navigation.navigate('SettingsTraining')}
        />
        <SettingsRow
          label="Session duration"
          value={profile ? `${profile.sessionDurationMinutes} min` : '—'}
          onPress={() => navigation.navigate('SettingsTraining')}
          last
        />
      </SettingsGroup>

      <SettingsGroup title="Goals">
        <SettingsRow
          label="Your goals"
          value={goals.map((goal) => GOAL_LABELS[goal.goalType]).join(', ') || 'None'}
          description="Changing these rebuilds your future training."
          onPress={() => navigation.navigate('SettingsGoals')}
          last
        />
      </SettingsGroup>

      <SettingsGroup title="Exercises">
        <SettingsRow
          label="Exercise preferences"
          value={`${preferences.reduce((sum, p) => sum + p.exerciseIds.length, 0)} selected`}
          description="Pick exactly which exercises the AI may program."
          onPress={() => navigation.navigate('ExercisePreferences', { fromSettings: true })}
          last
        />
      </SettingsGroup>

      <SettingsGroup title="Subscription">
        {/* The plan the user bought, not whichever one happens to be first. */}
        <SettingsRow
          label="Membership"
          value={pricing && plan ? `${pricing.price} / ${plan.period}` : 'Not subscribed'}
        />
        <SettingsRow
          label="Status"
          value={membershipLabel}
          description={
            entitlement.expiresAt
              ? `${entitlement.active ? 'Renews' : 'Ended'} ${new Date(
                  entitlement.expiresAt,
                ).toLocaleDateString()}`
              : undefined
          }
          onPress={() => navigation.navigate('SettingsSubscription')}
          last
        />
      </SettingsGroup>

      {isGuest ? (
        <SettingsGroup title="Account">
          {/* The way in for anyone who postponed it after paying. Without this,
              "later" would depend on the app happening to ask again. */}
          <SettingsRow
            label="Create your account"
            description="Keeps your program and history if you lose this phone."
            onPress={() => navigation.navigate('CreateAccount')}
            last
          />
        </SettingsGroup>
      ) : null}

      <SettingsGroup title="App">
        <SettingsRow
          label="Reduce motion"
          description="Turns off hologram rotation and screen animations."
          toggle={{ value: reduceMotion, onChange: setReduceMotionOverride }}
        />
        <SettingsRow
          label="Imperial units"
          description="Feet, inches and pounds instead of centimetres and kilograms. Changes what you read, never what is stored."
          toggle={{
            value: units === 'imperial',
            onChange: (value) => setUnits(value ? 'imperial' : 'metric'),
          }}
          last
        />
      </SettingsGroup>

      <SettingsGroup title="Privacy">
        <SettingsRow
          label="Your data and photos"
          onPress={() => navigation.navigate('SettingsPrivacy')}
        />
        {/* Only when there is something to sign out of. Signing out takes the
            local copy with it — on a shared phone the next person must not be
            served the previous account's body figures off disk — so offering it
            to someone with no account would be a button that only destroys. */}
        {email === null ? null : <SettingsRow label="Sign out" onPress={confirmSignOut} />}
        <SettingsRow
          label={busy ? 'Deleting…' : 'Delete account'}
          destructive
          onPress={busy ? undefined : confirmDelete}
          last
        />
      </SettingsGroup>

      <SettingsGroup title="About">
        <SettingsRow
          label="Health disclaimer"
          description="GetFit gives estimates, not medical advice."
          onPress={() => navigation.navigate('SettingsDisclaimer')}
          last
        />
      </SettingsGroup>

      <View style={{ marginTop: spacing.xl, alignItems: 'center' }}>
        <LegalLinks includeSupport align="center" />
      </View>

      <View style={{ height: spacing.xxl }} />
      <Text variant="caption" color="muted" align="center">
        GetFit {appVersion()}
      </Text>
    </Screen>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  EQUIPMENT,
  GOAL_DESCRIPTIONS,
  GOAL_LABELS,
  LEVEL_DESCRIPTIONS,
  LEVEL_LABELS,
  SESSION_DURATIONS,
  displayBounds,
  displayStep,
  massUnit,
  planForProduct,
  planPricing,
  TRAINING_DAY_OPTIONS,
  type EquipmentId,
  type GoalType,
  type SessionDuration,
  type TrainingDays,
  type TrainingLevel,
  type TrainingLocation,
} from '@getfit/shared';
import {
  Choice,
  ChoicePill,
  ErrorState,
  GlassCard,
  LegalLinks,
  LoadingScreen,
  NumberField,
  PrimaryButton,
  HeightField,
  Screen,
  SecondaryButton,
  Text,
  WEIGHT_BOUNDS_KG,
  openExternal,
} from '../../components';
import { ApiError } from '../../api/client';
import { legal } from '../../config/legal';
import { createStoreProvider } from '../../state/billing';
import { useStorePrices } from '../../state/useStorePrices';
import { settingsApi, subscriptionApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsProvider';
import { cmToHeightText, heightToCm, kgToMassText, massToKg } from '../../utils/units';
import type { RootStackParamList } from '../../navigation/types';

/** Shared banner explaining that a change reshapes future training only. */
function RegenerationNotice(): React.ReactElement {
  const { spacing } = useTheme();
  return (
    <GlassCard style={{ marginTop: spacing.xl }} emphasis="soft">
      <Text variant="caption" color="muted">
        Saving rebuilds your upcoming training around the change. Your completed
        workouts, personal records and assessment history are never altered.
      </Text>
    </GlassCard>
  );
}

/* ---------------------- Personal information ---------------------- */

export function SettingsProfileScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SettingsProfile'>): React.ReactElement {
  const { spacing } = useTheme();
  const { units } = useUnits();
  const weightBounds = displayBounds(WEIGHT_BOUNDS_KG, units, 'mass');
  const settings = useAsync(() => settingsApi.load(), []);
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const profile = settings.data?.profile;
    if (!profile) return;
    setAge(String(profile.age));
    setHeight(cmToHeightText(profile.heightCm, units));
    setWeight(kgToMassText(profile.weightKg, units));
    setSex(profile.sex);
  }, [settings.data, units]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await settingsApi.updateProfile({
        age: Number.parseInt(age, 10),
        // Typed in the user's units; stored, as always, in metric.
        heightCm: heightToCm(height, units) ?? Number.NaN,
        weightKg: massToKg(weight, units) ?? Number.NaN,
        sex: sex ?? undefined,
      });
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [age, height, navigation, sex, units, weight]);

  if (settings.loading && !settings.data) return <LoadingScreen />;
  if (!settings.data) return <ErrorState
        message={settings.error ?? undefined}
        detail={settings.detail}
        onRetry={settings.reload}
      />;

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.md }}>
          {error ? (
            <Text variant="caption" color="danger" align="center">
              {error}
            </Text>
          ) : null}
          <PrimaryButton label="Save" onPress={() => void save()} loading={busy} />
        </View>
      }
    >
      <Text variant="title" accessibilityRole="header">
        Personal information
      </Text>

      <View style={{ marginTop: spacing.xxl, gap: spacing.xl }}>
        <NumberField label="Age" value={age} onChange={setAge} unit="years" min={13} max={100} />
        <HeightField value={height} onChange={setHeight} units={units} />
        <NumberField
          label="Weight"
          value={weight}
          onChange={setWeight}
          unit={massUnit(units)}
          min={weightBounds.min}
          max={weightBounds.max}
          step={displayStep('mass', units)}
          decimal
          hint="Updating your weight also updates future starting loads."
        />
      </View>

      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.xxl }}>
        Sex
      </Text>
      <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
        <Choice label="Male" selected={sex === 'male'} onPress={() => setSex('male')} />
        <Choice label="Female" selected={sex === 'female'} onPress={() => setSex('female')} />
      </View>

      <RegenerationNotice />
    </Screen>
  );
}

/* ---------------------------- Training ---------------------------- */

export function SettingsTrainingScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SettingsTraining'>): React.ReactElement {
  const { spacing } = useTheme();
  const settings = useAsync(() => settingsApi.load(), []);
  const [level, setLevel] = useState<TrainingLevel | null>(null);
  const [location, setLocation] = useState<TrainingLocation | null>(null);
  const [days, setDays] = useState<TrainingDays | null>(null);
  const [duration, setDuration] = useState<SessionDuration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const profile = settings.data?.profile;
    if (!profile) return;
    setLevel(profile.trainingLevel);
    setLocation(profile.trainingLocation);
    setDays(profile.trainingDays);
    setDuration(profile.sessionDurationMinutes);
  }, [settings.data]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await settingsApi.updateProfile({
        trainingLevel: level ?? undefined,
        trainingLocation: location ?? undefined,
        trainingDays: days ?? undefined,
        sessionDurationMinutes: duration ?? undefined,
      });
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [days, duration, level, location, navigation]);

  if (settings.loading && !settings.data) return <LoadingScreen />;
  if (!settings.data) return <ErrorState
        message={settings.error ?? undefined}
        detail={settings.detail}
        onRetry={settings.reload}
      />;

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.md }}>
          {error ? (
            <Text variant="caption" color="danger" align="center">
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            label="Save and rebuild program"
            onPress={() => void save()}
            loading={busy}
          />
        </View>
      }
    >
      <Text variant="title" accessibilityRole="header">
        Training
      </Text>

      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.xxl }}>
        Level
      </Text>
      <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
        {(['beginner', 'intermediate', 'advanced'] as TrainingLevel[]).map((option) => (
          <Choice
            key={option}
            label={LEVEL_LABELS[option]}
            description={LEVEL_DESCRIPTIONS[option]}
            selected={level === option}
            onPress={() => setLevel(option)}
          />
        ))}
      </View>

      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.xxl }}>
        Location
      </Text>
      <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
        <Choice label="Home" selected={location === 'home'} onPress={() => setLocation('home')} />
        <Choice label="Gym" selected={location === 'gym'} onPress={() => setLocation('gym')} />
      </View>

      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.xxl }}>
        Training days
      </Text>
      <View style={[styles.grid, { marginTop: spacing.sm, gap: spacing.sm }]}>
        {TRAINING_DAY_OPTIONS.map((option) => (
          <ChoicePill
            key={option}
            label={`${option}`}
            selected={days === option}
            onPress={() => setDays(option)}
            style={styles.smallPill}
          />
        ))}
      </View>

      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.xxl }}>
        Session duration
      </Text>
      <View style={[styles.grid, { marginTop: spacing.sm, gap: spacing.sm }]}>
        {SESSION_DURATIONS.map((option) => (
          <ChoicePill
            key={option}
            label={`${option} min`}
            selected={duration === option}
            onPress={() => setDuration(option)}
            style={styles.mediumPill}
          />
        ))}
      </View>

      <RegenerationNotice />
    </Screen>
  );
}

/* ------------------------------ Goals ----------------------------- */

export function SettingsGoalsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SettingsGoals'>): React.ReactElement {
  const { spacing } = useTheme();
  const settings = useAsync(() => settingsApi.load(), []);
  const [selected, setSelected] = useState<GoalType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setSelected(settings.data.goals.map((goal) => goal.goalType));
  }, [settings.data]);

  const toggle = useCallback((goal: GoalType) => {
    setSelected((current) =>
      current.includes(goal) ? current.filter((g) => g !== goal) : [...current, goal],
    );
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await settingsApi.updateGoals(selected);
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [navigation, selected]);

  if (settings.loading && !settings.data) return <LoadingScreen />;
  if (!settings.data) return <ErrorState
        message={settings.error ?? undefined}
        detail={settings.detail}
        onRetry={settings.reload}
      />;

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.md }}>
          {error ? (
            <Text variant="caption" color="danger" align="center">
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            label="Save and rebuild program"
            onPress={() => void save()}
            loading={busy}
            disabled={selected.length === 0}
          />
        </View>
      }
    >
      <Text variant="title" accessibilityRole="header">
        Goals
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
        Choose as many as you like — each one is tracked separately.
      </Text>

      <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
        {(Object.keys(GOAL_LABELS) as GoalType[]).map((goal) => (
          <Choice
            key={goal}
            multi
            label={GOAL_LABELS[goal]}
            description={GOAL_DESCRIPTIONS[goal]}
            selected={selected.includes(goal)}
            onPress={() => toggle(goal)}
          />
        ))}
      </View>

      <RegenerationNotice />
    </Screen>
  );
}

/* ---------------------------- Equipment --------------------------- */

export function SettingsEquipmentScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SettingsEquipment'>): React.ReactElement {
  const { spacing } = useTheme();
  const settings = useAsync(() => settingsApi.load(), []);
  const [selected, setSelected] = useState<EquipmentId[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setSelected(settings.data.equipment);
  }, [settings.data]);

  const toggle = useCallback((item: EquipmentId) => {
    setSelected((current) =>
      current.includes(item) ? current.filter((e) => e !== item) : [...current, item],
    );
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await settingsApi.updateEquipment(selected);
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [navigation, selected]);

  if (settings.loading && !settings.data) return <LoadingScreen />;
  if (!settings.data) return <ErrorState
        message={settings.error ?? undefined}
        detail={settings.detail}
        onRetry={settings.reload}
      />;

  const isGym = settings.data.profile?.trainingLocation === 'gym';

  return (
    <Screen
      footer={
        isGym ? (
          <SecondaryButton label="Back" onPress={navigation.goBack} />
        ) : (
          <View style={{ gap: spacing.md }}>
            {error ? (
              <Text variant="caption" color="danger" align="center">
                {error}
              </Text>
            ) : null}
            <PrimaryButton
              label="Save and rebuild program"
              onPress={() => void save()}
              loading={busy}
              disabled={selected.length === 0}
            />
          </View>
        )
      }
    >
      <Text variant="title" accessibilityRole="header">
        Equipment
      </Text>

      {isGym ? (
        <GlassCard style={{ marginTop: spacing.xl }}>
          <Text variant="body" color="secondary">
            You train at a gym, so GetFit assumes full access to barbells, dumbbells,
            machines, cables and cardio equipment. Switch to Home training to choose
            specific equipment.
          </Text>
        </GlassCard>
      ) : (
        <>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
            The AI will only ever prescribe exercises you can do with these.
          </Text>
          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            {EQUIPMENT.filter((item) => item.selectable).map((item) => (
              <Choice
                key={item.id}
                multi
                label={item.name}
                selected={selected.includes(item.id)}
                onPress={() => toggle(item.id)}
              />
            ))}
          </View>
          <RegenerationNotice />
        </>
      )}
    </Screen>
  );
}

/* -------------------------- Subscription -------------------------- */

export function SettingsSubscriptionScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SettingsSubscription'>): React.ReactElement {
  const { spacing } = useTheme();
  const { refresh } = useSession();
  const entitlement = useAsync(() => subscriptionApi.entitlement(), []);
  const [busy, setBusy] = useState(false);

  // Show what the store charges this customer, not a hardcoded dollar figure.
  const store = useMemo(() => createStoreProvider({ mockAvailable: false }), []);
  const plan = planForProduct(entitlement.data?.productId);
  const { prices } = useStorePrices(
    store,
    useMemo(() => (plan ? [plan.productId] : []), [plan]),
  );

  /**
   * Cancellation belongs to whoever takes the money.
   *
   * Apple and Google own the billing relationship for a store purchase, and
   * nothing this app or its server writes stops the next charge. So the button
   * opens the store's own subscription settings rather than pretending to
   * cancel — the server refuses a store cancel for the same reason.
   */
  const manageInStore = useCallback(() => {
    const url =
      Platform.OS === 'ios' ? legal.manageSubscriptionUrl.ios : legal.manageSubscriptionUrl.android;
    void openExternal(url, 'your subscription settings');
  }, []);

  /** Only reachable for the development mock store, which has no such page. */
  const cancelDevelopmentMembership = useCallback(() => {
    Alert.alert(
      'Cancel membership?',
      'You keep full access until the end of the period you have already paid for.',
      [
        { text: 'Keep membership', style: 'cancel' },
        {
          text: 'Cancel membership',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void subscriptionApi
              .cancel()
              .then(() => refresh())
              .then(() => entitlement.reload())
              .catch((error: unknown) =>
                Alert.alert(
                  'Something went wrong.',
                  error instanceof ApiError ? error.message : 'Please try again.',
                ),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }, [entitlement, refresh]);

  if (entitlement.loading && !entitlement.data) return <LoadingScreen />;
  if (!entitlement.data) {
    return <ErrorState
        message={entitlement.error ?? undefined}
        detail={entitlement.detail}
        onRetry={entitlement.reload}
      />;
  }

  const data = entitlement.data;
  const storeManaged = data.platform === 'apple' || data.platform === 'google';
  const pricing = plan ? planPricing(plan, prices[plan.productId]) : null;

  return (
    <Screen footer={<SecondaryButton label="Back" onPress={navigation.goBack} />}>
      <Text variant="title" accessibilityRole="header">
        Membership
      </Text>

      <GlassCard accented style={{ marginTop: spacing.xl }}>
        <Text variant="micro" color="accent" uppercase>
          GetFit Membership
        </Text>
        <Text variant="display" style={{ marginTop: spacing.sm }}>
          {pricing?.price ?? '—'}
          <Text variant="subheading" color="muted">
            {' '}
            / {plan?.period ?? 'month'}
          </Text>
        </Text>

        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          <Row label="Status" value={data.active ? 'Active' : 'Inactive'} />
          <Row label="State" value={data.status} />
          {data.platform ? <Row label="Billed through" value={storeLabel(data.platform)} /> : null}
          {data.expiresAt ? (
            <Row
              label={data.active ? 'Renews' : 'Ended'}
              value={new Date(data.expiresAt).toLocaleDateString()}
            />
          ) : null}
        </View>
      </GlassCard>

      <Text variant="caption" color="muted" style={{ marginTop: spacing.lg }}>
        Your membership state is verified on our servers, so it stays correct on every
        device you sign in to.
      </Text>

      {data.active && data.status !== 'cancelled' ? (
        storeManaged ? (
          <View style={{ marginTop: spacing.xxl }}>
            <SecondaryButton
              label={`Manage or cancel in ${storeLabel(data.platform ?? '')}`}
              onPress={manageInStore}
            />
            <Text variant="caption" color="muted" style={{ marginTop: spacing.md }}>
              {storeLabel(data.platform ?? '')} handles the billing, so cancelling happens
              there. Your access continues until{' '}
              {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : 'the end of the period you paid for'}.
            </Text>
          </View>
        ) : (
          <SecondaryButton
            label={busy ? 'Cancelling…' : 'Cancel membership'}
            onPress={cancelDevelopmentMembership}
            disabled={busy}
            style={{ marginTop: spacing.xxl }}
          />
        )
      ) : null}

      <View style={{ marginTop: spacing.xxl }}>
        <LegalLinks includeSupport />
      </View>
    </Screen>
  );
}

function storeLabel(platform: string): string {
  if (platform === 'apple') return 'the App Store';
  if (platform === 'google') return 'Google Play';
  return 'Development store';
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text variant="body" color="muted">
        {label}
      </Text>
      <Text variant="bodyStrong" style={{ textTransform: 'capitalize' }}>
        {value}
      </Text>
    </View>
  );
}

/* ----------------------------- Privacy ---------------------------- */

export function SettingsPrivacyScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SettingsPrivacy'>): React.ReactElement {
  const { spacing } = useTheme();

  return (
    <Screen footer={<SecondaryButton label="Back" onPress={navigation.goBack} />}>
      <Text variant="title" accessibilityRole="header">
        Your data
      </Text>

      <GlassCard accented style={{ marginTop: spacing.xl }}>
        <Text variant="subheading">Nothing is sent to an AI service</Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
          Your body composition is calculated on our own server from the measurements
          you enter, using published formulas. No third party receives your
          measurements, your photos or your training data, and none of it is used to
          train any model.
        </Text>
      </GlassCard>

      <GlassCard style={{ marginTop: spacing.lg }}>
        <Text variant="subheading">Progress photos are optional and private</Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
          A photo is never required, and it is never analysed — it is kept only so you
          have a before-and-after to look back on. Photos are stored in private,
          authenticated storage that only your account can read. There are no public
          links, no sharing and no community feed, and Progress and History show your
          figure and your numbers rather than the photograph.
        </Text>
      </GlassCard>

      <GlassCard style={{ marginTop: spacing.lg }}>
        <Text variant="subheading">What GetFit stores</Text>
        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          {[
            'Your profile, goals, equipment and exercise preferences',
            'Your program, scheduled and completed workouts',
            'Every set you log, and your personal records',
            'Your tape measurements and your body assessments',
            'Your subscription state',
          ].map((item) => (
            <Text key={item} variant="body" color="secondary">
              · {item}
            </Text>
          ))}
        </View>
      </GlassCard>

      <GlassCard style={{ marginTop: spacing.lg }}>
        <Text variant="subheading">Deleting your account</Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
          Deleting your account removes all of the above, including your stored
          photos. It is permanent and cannot be undone. You can do it from the
          Privacy section of Settings.
        </Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
          Deleting your GetFit account does not cancel your subscription — the App
          Store or Google Play owns that. Cancel it there first, or you will keep
          being billed.
        </Text>
      </GlassCard>

      <View style={{ marginTop: spacing.xxl, alignItems: 'center' }}>
        <LegalLinks includeSupport align="center" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  smallPill: { minWidth: '12%', flexGrow: 1 },
  mediumPill: { minWidth: '22%', flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

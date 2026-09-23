import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatMass, formatRepRange, type ProgramDay } from '@getfit/shared';
import {
  ErrorState,
  ExerciseIllustration,
  GlassButton,
  GlassCard,
  LoadingScreen,
  NumberField,
  PrimaryButton,
  RestTimer,
  Screen,
  SecondaryButton,
  Text,
  WorkoutSetCard,
} from '../../components';
import { ApiError } from '../../api/client';
import { programApi, workoutApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsProvider';
import { kgToMassText, massToKg } from '../../utils/units';
import { MIN_TOUCH_TARGET } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';
import { useWorkoutSession } from './useWorkoutSession';

type Props = NativeStackScreenProps<RootStackParamList, 'GuidedWorkout'>;

/** Loads the day, then hands off to the guided runner. */
export function GuidedWorkoutScreen({ route, navigation }: Props): React.ReactElement {
  const { workoutDayId, scheduledWorkoutId } = route.params;
  const day = useAsync(() => programApi.day(workoutDayId), [workoutDayId]);

  if (day.loading) return <LoadingScreen message="Loading your workout…" />;
  if (!day.data?.day) return <ErrorState message={day.error ?? undefined} onRetry={day.reload} />;

  return (
    <GuidedWorkoutRunner
      day={day.data.day}
      scheduledWorkoutId={scheduledWorkoutId}
      navigation={navigation}
    />
  );
}

/**
 * The guided workout runner.
 *
 * One exercise and one set at a time: log weight and reps, rest, move on. The
 * prescribed weight is pre-filled and fully editable — whatever is actually
 * lifted is what gets stored and what drives the next progression.
 */
function GuidedWorkoutRunner({
  day,
  scheduledWorkoutId,
  navigation,
}: {
  day: ProgramDay;
  scheduledWorkoutId: string | null;
  navigation: Props['navigation'];
}): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
  const { units } = useUnits();
  const session = useWorkoutSession(day);
  // Held in the user's units; converted to kilograms when the set is logged.
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill each set from the prescription so the common case is one tap.
  useEffect(() => {
    const set = session.currentSet;
    if (!set) return;
    setWeight(set.prescribedWeight !== null ? kgToMassText(set.prescribedWeight, units) : '');
    setReps(String(set.prescribedRepsMax));
  }, [session.currentSet, units]);

  const confirmExit = useCallback(() => {
    Alert.alert('Leave this workout?', 'Sets you have already logged will not be saved.', [
      { text: 'Keep training', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  }, [navigation]);

  const finish = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = session.buildPayload(scheduledWorkoutId);
      if (payload.exercises.length === 0) {
        setError('Log at least one set before finishing.');
        setSubmitting(false);
        return;
      }
      const result = await workoutApi.complete(payload);
      navigation.replace('WorkoutComplete', { summaryId: result.summary.id });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }, [navigation, scheduledWorkoutId, session]);

  const progress =
    session.totalSets > 0 ? Math.round((session.completedSets / session.totalSets) * 100) : 0;

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={confirmExit}
        accessibilityRole="button"
        accessibilityLabel="Leave workout"
        hitSlop={10}
        style={({ pressed }) => [
          styles.closeButton,
          { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text variant="bodyStrong" color="secondary">
          ✕
        </Text>
      </Pressable>

      <View style={styles.headerCenter}>
        <Text variant="micro" color="muted" uppercase>
          {day.focus}
        </Text>
        <Text variant="caption" color="accent" tabular>
          {session.completedSets} / {session.totalSets} sets
        </Text>
      </View>

      <View style={styles.closeButton} />
    </View>
  );

  const progressBar = (
    <View
      style={[styles.track, { backgroundColor: colors.glassBorder, marginTop: spacing.md }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: progress }}
      accessibilityLabel="Workout progress"
    >
      <View style={[styles.fill, { width: `${progress}%`, backgroundColor: colors.accent }]} />
    </View>
  );

  /* ------------------------------ REST ------------------------------ */
  if (session.phase === 'rest' && session.currentSet) {
    const isLastSetOfExercise =
      session.position.setIndex >= (session.currentProgramExercise?.prescribedSets.length ?? 1) - 1;
    const nextLabel = isLastSetOfExercise
      ? 'Next exercise'
      : `Set ${session.currentSet.setNumber + 1} of ${session.currentProgramExercise?.prescribedSets.length ?? 0}`;

    return (
      <Screen scroll={false} contentStyle={styles.centeredFill}>
        {header}
        {progressBar}
        <View style={styles.restBody}>
          <RestTimer
            seconds={session.currentSet.restSeconds}
            nextLabel={nextLabel}
            onComplete={session.advanceAfterRest}
            onSkip={session.advanceAfterRest}
          />
        </View>
      </Screen>
    );
  }

  /* ---------------------------- EXERCISE ---------------------------- */
  if (session.phase === 'exercise' && session.currentExercise && session.currentProgramExercise) {
    const exercise = session.currentExercise;
    const programExercise = session.currentProgramExercise;

    return (
      <Screen footer={<PrimaryButton label="Start first set" onPress={() => session.setPhase('set')} />}>
        {header}
        {progressBar}

        <View style={[styles.exerciseIntro, { marginTop: spacing.xxl }]}>
          <View style={[styles.bigIllustration, { backgroundColor: colors.stage, borderColor: colors.glassBorder, borderRadius: radius.lg }]}>
            <ExerciseIllustration illustration={exercise.illustration} size={130} />
          </View>

          <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.xl }}>
            Exercise {session.position.exerciseIndex + 1} of {session.exercises.length} ·{' '}
            {exercise.primaryMuscle}
          </Text>
          <Text variant="title" style={{ marginTop: spacing.xs }} accessibilityRole="header">
            {exercise.name}
          </Text>
          <Text variant="heading" color="accent" style={{ marginTop: spacing.md }} tabular>
            {programExercise.sets} × {formatRepRange(programExercise.repsMin, programExercise.repsMax)}
            {programExercise.startingWeight
              ? `  ·  ${formatMass(programExercise.startingWeight, units)}`
              : ''}
          </Text>
        </View>

        <GlassCard style={{ marginTop: spacing.xl }}>
          <Text variant="micro" color="muted" uppercase>
            Setup
          </Text>
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            {exercise.setup.map((item) => (
              <Text key={item} variant="body" color="secondary">
                · {item}
              </Text>
            ))}
          </View>

          <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.lg }}>
            Execution
          </Text>
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            {exercise.execution.map((item) => (
              <Text key={item} variant="body" color="secondary">
                · {item}
              </Text>
            ))}
          </View>

          <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.lg }}>
            Avoid
          </Text>
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            {exercise.commonMistakes.map((item) => (
              <Text key={item} variant="body" style={{ color: colors.warning }}>
                · {item}
              </Text>
            ))}
          </View>
        </GlassCard>

        <GlassButton
          label="Skip this exercise"
          onPress={session.skipExercise}
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
      </Screen>
    );
  }

  /* ------------------------------ CARDIO ----------------------------- */
  if (session.phase === 'cardio' && day.cardio) {
    return (
      <Screen footer={<PrimaryButton label="Finish workout" onPress={() => session.setPhase('review')} />}>
        {header}
        {progressBar}

        <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.xxl }}>
          Finisher
        </Text>
        <Text variant="title" style={{ marginTop: spacing.xs }} accessibilityRole="header">
          {day.cardio.type}
        </Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
          {day.cardio.minutes} minutes at a steady, controlled pace.
        </Text>

        <GlassCard style={{ marginTop: spacing.xl }}>
          <NumberField
            label="Minutes completed"
            value={String(session.cardioMinutes)}
            onChange={(value) => session.setCardioMinutes(Number.parseInt(value, 10) || 0)}
            unit="min"
            min={0}
            max={15}
            hint="Log what you actually did — the AI adjusts your cardio as your body fat changes."
          />
        </GlassCard>

        <GlassButton
          label="Skip cardio"
          onPress={() => {
            session.setCardioMinutes(0);
            session.setPhase('review');
          }}
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
      </Screen>
    );
  }

  /* ------------------------------ REVIEW ----------------------------- */
  if (session.phase === 'review') {
    return (
      <Screen
        footer={
          <View style={{ gap: spacing.md }}>
            {error ? (
              <Text variant="caption" color="danger" align="center" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <PrimaryButton label="Save workout" onPress={() => void finish()} loading={submitting} />
          </View>
        }
      >
        {header}
        <Text variant="title" style={{ marginTop: spacing.xxl }} accessibilityRole="header">
          Review your session
        </Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
          Everything you logged, ready to save.
        </Text>

        <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
          {session.exercises.map((entry, index) => {
            const sets = session.logged[index] ?? [];
            if (sets.length === 0) return null;
            const exercise = entry.exercise;

            return (
              <GlassCard key={entry.id ?? entry.exerciseId} padded={false} contentStyle={{ padding: spacing.lg }}>
                <Text variant="subheading">{exercise?.name ?? entry.exerciseId}</Text>
                <View style={{ marginTop: spacing.sm, gap: 2 }}>
                  {sets.map((set) => (
                    <View key={set.setNumber} style={styles.reviewRow}>
                      <Text variant="caption" color="muted">
                        {set.isWarmup ? 'Warm-up' : `Set ${set.setNumber}`}
                      </Text>
                      <Text variant="caption" tabular>
                        {set.actualWeight !== null ? `${formatMass(set.actualWeight, units)} × ` : ''}
                        {set.actualReps ?? 0}
                        {/* A changed weight is called out so nothing is silent. */}
                        {set.actualWeight !== null &&
                        set.prescribedWeight !== null &&
                        set.actualWeight !== set.prescribedWeight
                          ? `  (planned ${formatMass(set.prescribedWeight, units)})`
                          : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              </GlassCard>
            );
          })}

          {session.cardioMinutes > 0 && day.cardio ? (
            <GlassCard padded={false} contentStyle={{ padding: spacing.lg }}>
              <View style={styles.reviewRow}>
                <Text variant="subheading">{day.cardio.type}</Text>
                <Text variant="bodyStrong" tabular>
                  {session.cardioMinutes} min
                </Text>
              </View>
            </GlassCard>
          ) : null}
        </View>

        <SecondaryButton
          label="Back to training"
          onPress={() => session.setPhase('set')}
          style={{ marginTop: spacing.xl }}
        />
      </Screen>
    );
  }

  /* -------------------------------- SET ------------------------------ */
  if (!session.currentExercise || !session.currentSet || !session.currentProgramExercise) {
    return <ErrorState message="This workout is no longer available." onRetry={() => navigation.goBack()} />;
  }

  const exercise = session.currentExercise;
  const programExercise = session.currentProgramExercise;

  return (
    <Screen>
      {header}
      {progressBar}

      <View style={[styles.setHeader, { marginTop: spacing.xl }]}>
        <View style={[styles.smallIllustration, { backgroundColor: colors.stage, borderColor: colors.glassBorder, borderRadius: radius.md }]}>
          <ExerciseIllustration illustration={exercise.illustration} size={62} />
        </View>
        <View style={[styles.flex, { marginLeft: spacing.lg }]}>
          <Text variant="micro" color="muted" uppercase>
            {exercise.primaryMuscle} · Exercise {session.position.exerciseIndex + 1} of{' '}
            {session.exercises.length}
          </Text>
          <Text variant="heading" style={{ marginTop: 2 }} accessibilityRole="header">
            {exercise.name}
          </Text>
          <Text variant="caption" color="accent" style={{ marginTop: 2 }} tabular>
            {programExercise.sets} × {formatRepRange(programExercise.repsMin, programExercise.repsMax)}
            {' · rest '}
            {programExercise.restSeconds}s
          </Text>
        </View>
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <WorkoutSetCard
          setNumber={
            session.currentSet.isWarmup
              ? session.currentSet.setNumber
              : session.currentSet.setNumber - programExercise.warmupSets
          }
          totalSets={session.workingSetsForCurrentExercise}
          isWarmup={session.currentSet.isWarmup}
          prescribedWeight={session.currentSet.prescribedWeight}
          prescribedRepsMin={session.currentSet.prescribedRepsMin}
          prescribedRepsMax={session.currentSet.prescribedRepsMax}
          weight={weight}
          reps={reps}
          onWeightChange={setWeight}
          onRepsChange={setReps}
          isTimed={exercise.isTimed}
          isBodyweight={exercise.isBodyweight}
          units={units}
          onComplete={() => {
            const parsedWeight = massToKg(weight, units);
            const parsedReps = Number.parseInt(reps, 10);
            session.completeSet(
              parsedWeight,
              Number.isFinite(parsedReps) ? parsedReps : 0,
            );
          }}
        />
      </View>

      {/* Sets already logged for this exercise. */}
      {(session.logged[session.position.exerciseIndex] ?? []).length > 0 ? (
        <GlassCard style={{ marginTop: spacing.lg }} emphasis="soft">
          <Text variant="micro" color="muted" uppercase>
            Logged so far
          </Text>
          <View style={{ marginTop: spacing.sm, gap: 2 }}>
            {(session.logged[session.position.exerciseIndex] ?? []).map((set) => (
              <View key={set.setNumber} style={styles.reviewRow}>
                <Text variant="caption" color="muted">
                  {set.isWarmup ? 'Warm-up' : `Set ${set.setNumber}`}
                </Text>
                <Text variant="caption" tabular>
                  {set.actualWeight !== null ? `${formatMass(set.actualWeight, units)} × ` : ''}
                  {set.actualReps ?? 0}
                </Text>
              </View>
            ))}
          </View>
        </GlassCard>
      ) : null}

      <GlassButton
        label="Skip this exercise"
        onPress={session.skipExercise}
        fullWidth
        style={{ marginTop: spacing.lg }}
      />
      <GlassButton
        label="Finish workout early"
        onPress={() => session.setPhase('review')}
        fullWidth
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerCenter: { alignItems: 'center' },
  closeButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { height: 4, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  centeredFill: { flex: 1 },
  restBody: { flex: 1, justifyContent: 'center' },
  exerciseIntro: { alignItems: 'center' },
  bigIllustration: {
    width: 180,
    height: 180,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setHeader: { flexDirection: 'row', alignItems: 'center' },
  smallIllustration: {
    width: 76,
    height: 76,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
});

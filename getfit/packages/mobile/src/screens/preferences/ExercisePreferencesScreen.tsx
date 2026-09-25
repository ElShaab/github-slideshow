import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import {
  MAX_EXERCISES_PER_MUSCLE,
  MUSCLE_GROUPS,
  type Exercise,
  type MuscleGroup,
} from '@getfit/shared';
import {
  ErrorState,
  ExerciseIllustration,
  ExerciseSelectionCard,
  GlassCard,
  LoadingScreen,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Text,
} from '../../components';
import { ApiError } from '../../api/client';
import { exerciseApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useTheme } from '../../theme';

export interface ExercisePreferencesScreenProps {
  onDone: () => void;
  /** From Settings the save also regenerates future training. */
  fromSettings?: boolean;
  onCancel?: () => void;
}

const MUSCLE_NAMES = new Map(MUSCLE_GROUPS.map((m) => [m.id, m.name]));

/**
 * Exercise preferences.
 *
 * Four options per muscle, up to three selectable. Whatever the user picks here
 * is exactly what the AI will program — nothing is silently substituted. One
 * "Generate for me" button hands the whole decision to the AI instead.
 */
export function ExercisePreferencesScreen({
  onDone,
  fromSettings = false,
  onCancel,
}: ExercisePreferencesScreenProps): React.ReactElement {
  const { colors, spacing } = useTheme();
  const choices = useAsync(() => exerciseApi.preferenceChoices(), [], 'exerciseApi.preferenceChoices');
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Exercise | null>(null);

  useEffect(() => {
    if (!choices.data) return;
    const initial: Record<string, string[]> = {};
    for (const preference of choices.data.saved) {
      initial[preference.muscleGroup] = preference.exerciseIds;
    }
    setSelection(initial);
  }, [choices.data]);

  const toggle = useCallback((muscle: MuscleGroup, exerciseId: string) => {
    setSelection((current) => {
      const existing = current[muscle] ?? [];
      if (existing.includes(exerciseId)) {
        return { ...current, [muscle]: existing.filter((id) => id !== exerciseId) };
      }
      // The three-per-muscle limit is enforced here and again on the server.
      if (existing.length >= MAX_EXERCISES_PER_MUSCLE) return current;
      return { ...current, [muscle]: [...existing, exerciseId] };
    });
  }, []);

  const totalSelected = useMemo(
    () => Object.values(selection).reduce((sum, list) => sum + list.length, 0),
    [selection],
  );

  const generateForMe = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await exerciseApi.generatePreferences();
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [onDone]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = Object.entries(selection)
        .filter(([, ids]) => ids.length > 0)
        .map(([muscleGroup, exerciseIds]) => ({
          muscleGroup: muscleGroup as MuscleGroup,
          exerciseIds,
        }));

      if (fromSettings) await exerciseApi.applyPreferences(payload);
      else await exerciseApi.savePreferences(payload);
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [fromSettings, onDone, selection]);

  if (choices.loading) return <LoadingScreen message="Loading exercises…" />;
  if (!choices.data) return <ErrorState
        message={choices.error ?? undefined}
        detail={choices.detail}
        onRetry={choices.reload}
      />;

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.md }}>
          {error ? (
            <Text variant="caption" color="danger" align="center" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            label={totalSelected > 0 ? `Use my ${totalSelected} exercises` : 'Select exercises'}
            onPress={() => void save()}
            loading={busy}
            disabled={totalSelected === 0}
          />
          <SecondaryButton
            label="Generate for me"
            onPress={() => void generateForMe()}
            accessibilityHint="Lets the AI choose your exercises for every muscle group"
          />
          {onCancel ? (
            <SecondaryButton label="Cancel" onPress={onCancel} />
          ) : null}
        </View>
      }
    >
      <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.lg }}>
        Step 2 of 2
      </Text>
      <Text variant="title" style={{ marginTop: spacing.sm }} accessibilityRole="header">
        Pick your exercises
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
        Choose up to {MAX_EXERCISES_PER_MUSCLE} per muscle and the AI will use exactly those.
        Skip a muscle and it picks for you.
      </Text>

      {choices.data.choiceSets.map((set) => {
        const selected = selection[set.muscleGroup] ?? [];
        const atLimit = selected.length >= MAX_EXERCISES_PER_MUSCLE;

        return (
          <View key={set.muscleGroup} style={{ marginTop: spacing.xxl }}>
            <View style={styles.muscleHeader}>
              <Text variant="subheading">{MUSCLE_NAMES.get(set.muscleGroup) ?? set.muscleGroup}</Text>
              <Text
                variant="caption"
                style={{ color: atLimit ? colors.accent : colors.textMuted }}
                accessibilityLabel={`${selected.length} of ${MAX_EXERCISES_PER_MUSCLE} selected`}
              >
                {selected.length}/{MAX_EXERCISES_PER_MUSCLE}
              </Text>
            </View>

            {set.limitedByEquipment ? (
              <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
                {set.choices.length === 0
                  ? 'Your equipment does not cover this muscle directly — compound lifts will still train it.'
                  : 'Fewer options here because of the equipment you selected.'}
              </Text>
            ) : null}

            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {set.choices.map((exercise) => (
                <ExerciseSelectionCard
                  key={exercise.id}
                  exercise={exercise}
                  selected={selected.includes(exercise.id)}
                  disabled={atLimit}
                  onToggle={() => toggle(set.muscleGroup, exercise.id)}
                  onInfo={() => setDetail(exercise)}
                />
              ))}
            </View>
          </View>
        );
      })}

      <ExerciseDetailModal exercise={detail} onClose={() => setDetail(null)} />
    </Screen>
  );
}

/** Demonstration and coaching notes for a single exercise. */
export function ExerciseDetailModal({
  exercise,
  onClose,
}: {
  exercise: Exercise | null;
  onClose: () => void;
}): React.ReactElement | null {
  const { colors, spacing, radius } = useTheme();
  if (!exercise) return null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: colors.backgroundElevated,
              borderColor: colors.glassBorder,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
          ]}
        >
          <ScrollView contentContainerStyle={{ padding: spacing.xxl, paddingBottom: spacing.huge }}>
            <View style={styles.detailHeader}>
              <View style={styles.flex}>
                <Text variant="micro" color="accent" uppercase>
                  {exercise.primaryMuscle} · {exercise.isCompound ? 'Compound' : 'Isolation'}
                </Text>
                <Text variant="heading" style={{ marginTop: spacing.xs }} accessibilityRole="header">
                  {exercise.name}
                </Text>
              </View>
              <View style={[styles.illustration, { backgroundColor: colors.stage, borderColor: colors.glassBorder }]}>
                <ExerciseIllustration illustration={exercise.illustration} size={72} />
              </View>
            </View>

            <Text variant="body" color="secondary" style={{ marginTop: spacing.lg }}>
              {exercise.instructions}
            </Text>

            <GlassCard style={{ marginTop: spacing.xl }} emphasis="soft">
              <View style={styles.factRow}>
                <Fact label="Target" value={exercise.primaryMuscle} />
                <Fact label="Reps" value={`${exercise.repRangeMin}–${exercise.repRangeMax}`} />
                <Fact label="Rest" value={`${exercise.restSeconds}s`} />
              </View>
              {exercise.secondaryMuscles.length > 0 ? (
                <Text variant="caption" color="muted" style={{ marginTop: spacing.md }}>
                  Also works: {exercise.secondaryMuscles.join(', ').replace(/_/g, ' ')}
                </Text>
              ) : null}
            </GlassCard>

            <Section title="Setup" items={exercise.setup} />
            <Section title="Execution" items={exercise.execution} />
            <Section title="Common mistakes" items={exercise.commonMistakes} warning />

            <PrimaryButton label="Close" onPress={onClose} style={{ marginTop: spacing.xxl }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View>
      <Text variant="micro" color="muted" uppercase>
        {label}
      </Text>
      <Text variant="bodyStrong" style={{ marginTop: 2, textTransform: 'capitalize' }}>
        {value}
      </Text>
    </View>
  );
}

function Section({
  title,
  items,
  warning = false,
}: {
  title: string;
  items: string[];
  warning?: boolean;
}): React.ReactElement | null {
  const { colors, spacing } = useTheme();
  if (items.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.xxl }}>
      <Text variant="micro" color="muted" uppercase>
        {title}
      </Text>
      <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
        {items.map((item, index) => (
          <View key={item} style={styles.itemRow}>
            <Text
              variant="caption"
              style={{ color: warning ? colors.warning : colors.accent, width: 20 }}
            >
              {warning ? '!' : `${index + 1}.`}
            </Text>
            <Text variant="body" color="secondary" style={styles.flex}>
              {item}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  muscleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: { maxHeight: '88%', borderTopWidth: StyleSheet.hairlineWidth * 2 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  illustration: {
    width: 88,
    height: 88,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  factRow: { flexDirection: 'row', justifyContent: 'space-between' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
});

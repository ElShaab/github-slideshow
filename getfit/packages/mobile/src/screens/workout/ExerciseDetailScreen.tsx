import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EXERCISE_BY_ID } from '@getfit/shared';
import {
  ErrorState,
  ExerciseIllustration,
  GlassCard,
  PrimaryButton,
  Screen,
  Text,
} from '../../components';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ExerciseDetail'>;

/** Full exercise demonstration: illustration, target, setup, execution, mistakes. */
export function ExerciseDetailScreen({ route, navigation }: Props): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
  const exercise = EXERCISE_BY_ID[route.params.exerciseId];

  if (!exercise) {
    return <ErrorState message="That exercise is not in the library." onRetry={navigation.goBack} />;
  }

  return (
    <Screen footer={<PrimaryButton label="Close" onPress={navigation.goBack} />}>
      <View
        style={[
          styles.stage,
          {
            backgroundColor: colors.stage,
            borderColor: colors.glassBorder,
            borderRadius: radius.xl,
            marginTop: spacing.lg,
          },
        ]}
      >
        <ExerciseIllustration
          illustration={exercise.illustration}
          size={170}
          accessibilityLabel={`Illustration of ${exercise.name}`}
        />
      </View>

      <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.xl }}>
        {exercise.primaryMuscle} · {exercise.isCompound ? 'Compound' : 'Isolation'} ·{' '}
        {exercise.difficulty}
      </Text>
      <Text variant="title" style={{ marginTop: spacing.xs }} accessibilityRole="header">
        {exercise.name}
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
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
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          Equipment: {exercise.equipment.join(', ').replace(/_/g, ' ')}
        </Text>
      </GlassCard>

      <Section title="Setup" items={exercise.setup} />
      <Section title="Execution" items={exercise.execution} />
      <Section title="Common mistakes" items={exercise.commonMistakes} warning />
    </Screen>
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
            <Text variant="caption" style={{ color: warning ? colors.warning : colors.accent, width: 22 }}>
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
  stage: {
    height: 220,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  factRow: { flexDirection: 'row', justifyContent: 'space-between' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
});

import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  MeasurementsForm,
  NumberField,
  OnboardingHeader,
  PrimaryButton,
  Screen,
  Text,
  isMeasured,
} from '../../components';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';
import { stepNumber, totalSteps } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Measurements'>;

/**
 * Screen 7 — the numbers your analysis is computed from.
 *
 * Height and weight are required. The tape measurements are strongly
 * encouraged, because they are what makes the body-fat reading a measurement
 * rather than an estimate, but they are never a gate: without them GetFit falls
 * back to a height-and-weight estimate and says so on the result.
 */
export function MeasurementsScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { draft, update, updateMeasurements } = useOnboardingDraft();
  const isHome = draft.trainingLocation === 'home';

  const height = Number.parseFloat(draft.heightCm);
  const weight = Number.parseFloat(draft.weightKg);
  const valid = useMemo(
    () =>
      Number.isFinite(height) &&
      height >= 120 &&
      height <= 250 &&
      Number.isFinite(weight) &&
      weight >= 30 &&
      weight <= 300,
    [height, weight],
  );

  const measured = useMemo(
    () => isMeasured(draft.measurements, draft.sex),
    [draft.measurements, draft.sex],
  );

  const next = useCallback(() => navigation.navigate('Photo'), [navigation]);

  return (
    <Screen
      footer={
        <PrimaryButton
          label={measured ? 'Next' : 'Continue without the tape'}
          onPress={next}
          disabled={!valid}
        />
      }
    >
      <OnboardingHeader
        title="Your measurements"
        subtitle="Your body-fat estimate is calculated from these — no photo needed."
        step={stepNumber('measurements', isHome)}
        total={totalSteps(isHome)}
        onBack={navigation.goBack}
      />

      <View style={{ marginTop: spacing.xxxl, gap: spacing.xxl }}>
        <NumberField
          label="Height"
          value={draft.heightCm}
          onChange={(value) => update({ heightCm: value })}
          unit="cm"
          min={120}
          max={250}
          placeholder="180"
        />
        <NumberField
          label="Weight"
          value={draft.weightKg}
          onChange={(value) => update({ weightKg: value })}
          unit="kg"
          min={30}
          max={300}
          step={0.5}
          decimal
          placeholder="80"
        />
      </View>

      <View style={{ marginTop: spacing.xxl }}>
        <MeasurementsForm
          draft={draft.measurements}
          onChange={updateMeasurements}
          sex={draft.sex}
        />
      </View>

      <Text variant="caption" color="muted" style={{ marginTop: spacing.xxl }}>
        You can update these any time in Settings — your training adapts automatically.
      </Text>
    </Screen>
  );
}

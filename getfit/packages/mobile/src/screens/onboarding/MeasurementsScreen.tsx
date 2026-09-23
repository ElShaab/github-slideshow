import React, { useCallback, useEffect, useMemo } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { displayBounds, displayStep, massUnit, type UnitSystem } from '@getfit/shared';
import {
  HEIGHT_BOUNDS_CM,
  HeightField,
  MeasurementsForm,
  NumberField,
  OnboardingHeader,
  PrimaryButton,
  Screen,
  Text,
  UnitsToggle,
  WEIGHT_BOUNDS_KG,
  isMeasured,
} from '../../components';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useUnits } from '../../state/UnitsProvider';
import { useTheme } from '../../theme';
import { heightToCm, kgToMassText, massToKg } from '../../utils/units';
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
  const { draft, update, updateMeasurements, setUnits } = useOnboardingDraft();
  const { units, setUnits: setAppUnits } = useUnits();
  const isHome = draft.trainingLocation === 'home';

  // The draft carries its own copy of the choice so the text in it is never
  // read in the wrong system; this keeps the two in step from the first render.
  useEffect(() => {
    setUnits(units);
  }, [setUnits, units]);

  const changeUnits = useCallback(
    (next: UnitSystem) => {
      setAppUnits(next);
      setUnits(next);
    },
    [setAppUnits, setUnits],
  );

  // Validated in centimetres and kilograms, so the same body passes or fails
  // identically whichever units it was typed in.
  const heightCm = heightToCm(draft.height, draft.units);
  const weightKg = massToKg(draft.weight, draft.units);
  const valid = useMemo(
    () =>
      heightCm !== null &&
      heightCm >= HEIGHT_BOUNDS_CM.min &&
      heightCm <= HEIGHT_BOUNDS_CM.max &&
      weightKg !== null &&
      weightKg >= WEIGHT_BOUNDS_KG.min &&
      weightKg <= WEIGHT_BOUNDS_KG.max,
    [heightCm, weightKg],
  );

  const measured = useMemo(
    () => isMeasured(draft.measurements, draft.sex, draft.units),
    [draft.measurements, draft.sex, draft.units],
  );

  const weightBounds = displayBounds(WEIGHT_BOUNDS_KG, units, 'mass');

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
        <UnitsToggle units={units} onChange={changeUnits} />

        <HeightField
          value={draft.height}
          onChange={(value) => update({ height: value })}
          units={units}
        />
        <NumberField
          label="Weight"
          value={draft.weight}
          onChange={(value) => update({ weight: value })}
          unit={massUnit(units)}
          min={weightBounds.min}
          max={weightBounds.max}
          step={displayStep('mass', units)}
          decimal
          placeholder={kgToMassText(80, units)}
        />
      </View>

      <View style={{ marginTop: spacing.xxl }}>
        <MeasurementsForm
          draft={draft.measurements}
          onChange={updateMeasurements}
          sex={draft.sex}
          units={units}
        />
      </View>

      <Text variant="caption" color="muted" style={{ marginTop: spacing.xxl }}>
        You can update these any time in Settings — your training adapts automatically.
      </Text>
    </Screen>
  );
}

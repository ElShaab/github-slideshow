import React, { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { displayStep, lengthUnit, type Sex, type UnitSystem } from '@getfit/shared';
import { GlassCard } from './GlassCard';
import { NumberField } from './NumberField';
import { Text } from './Text';
import { useTheme } from '../theme';
import { boundsFor, isMeasured, type MeasurementKey, type MeasurementsDraft } from '../utils/measurements';
import { cmToLengthText } from '../utils/units';

export interface MeasurementsFormProps {
  draft: MeasurementsDraft;
  onChange: (patch: Partial<MeasurementsDraft>) => void;
  sex: Sex | null;
  units: UnitSystem;
}

interface Field {
  key: MeasurementKey;
  label: string;
  /** A typical reading in centimetres, shown in whichever units are on. */
  typicalCm: number;
  hint?: string;
}

/** The three the circumference formula needs. Hips only apply to women. */
const REQUIRED: Field[] = [
  {
    key: 'waistCm',
    label: 'Waist',
    typicalCm: 85,
    hint: 'At the narrowest point, usually just above the navel.',
  },
  {
    key: 'neckCm',
    label: 'Neck',
    typicalCm: 38,
    hint: "Just below the Adam's apple, tape sloping slightly downward.",
  },
];

const HIPS: Field = {
  key: 'hipCm',
  label: 'Hips',
  typicalCm: 95,
  hint: 'Around the widest point, feet together.',
};

/** Optional, and only feed the left/right balance score. */
const OPTIONAL: Field[] = [
  {
    key: 'shoulderCm',
    label: 'Shoulders',
    typicalCm: 120,
    hint: 'Around the widest point, arms relaxed. Sharpens your figure.',
  },
  { key: 'leftArmCm', label: 'Left arm', typicalCm: 36 },
  {
    key: 'rightArmCm',
    label: 'Right arm',
    typicalCm: 36,
    hint: 'Mid-bicep, arm relaxed at your side.',
  },
  { key: 'leftThighCm', label: 'Left thigh', typicalCm: 58 },
  {
    key: 'rightThighCm',
    label: 'Right thigh',
    typicalCm: 58,
    hint: 'Widest point, standing with weight evenly on both feet.',
  },
];

/**
 * Tape measurements.
 *
 * Waist and neck (plus hips for women) drive the body-fat reading through the
 * US Navy circumference formula. The limb pairs are genuinely optional: they
 * only add the left/right balance score, which stays unreported rather than
 * invented when they are left blank.
 *
 * Everything here is typed in whatever units the user chose and converted to
 * centimetres on submission, so the bounds and the formula never see an inch.
 */
export const MeasurementsForm = memo(function MeasurementsForm({
  draft,
  onChange,
  sex,
  units,
}: MeasurementsFormProps): React.ReactElement {
  const { colors, spacing } = useTheme();
  const [showOptional, setShowOptional] = useState(false);

  const set = useCallback(
    (key: MeasurementKey) => (value: string) => onChange({ [key]: value }),
    [onChange],
  );

  const complete = useMemo(() => isMeasured(draft, sex, units), [draft, sex, units]);
  const required = useMemo(() => (sex === 'female' ? [...REQUIRED, HIPS] : REQUIRED), [sex]);

  const field = useCallback(
    ({ key, label, typicalCm, hint }: Field) => {
      const bounds = boundsFor(key, units);
      return (
        <NumberField
          key={key}
          label={label}
          value={draft[key]}
          onChange={set(key)}
          unit={lengthUnit(units)}
          min={bounds.min}
          max={bounds.max}
          step={displayStep('length', units)}
          decimal
          placeholder={cmToLengthText(typicalCm, units)}
          hint={hint}
        />
      );
    },
    [draft, set, units],
  );

  return (
    <View style={{ gap: spacing.lg }}>
      <GlassCard accented={complete}>
        <Text variant="micro" color="accent" uppercase>
          Tape measurements
        </Text>
        <Text variant="caption" color="secondary" style={{ marginTop: spacing.sm }}>
          Measure relaxed, directly against the skin, with the tape level. These
          {sex === 'female' ? ' three' : ' two'} readings are what your body-fat
          estimate is calculated from.
        </Text>

        <View style={{ marginTop: spacing.xl, gap: spacing.xl }}>{required.map(field)}</View>
      </GlassCard>

      <GlassCard emphasis="soft">
        <Pressable
          onPress={() => setShowOptional((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showOptional }}
          accessibilityLabel={
            showOptional ? 'Hide optional measurements' : 'Show optional measurements'
          }
          style={styles.toggleRow}
        >
          <View style={{ flex: 1 }}>
            <Text variant="subheading">Left / right balance</Text>
            <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
              Optional — measure both sides to get a balance score.
            </Text>
          </View>
          <Text variant="subheading" color="accent">
            {showOptional ? '−' : '+'}
          </Text>
        </Pressable>

        {showOptional ? (
          <View style={{ marginTop: spacing.xl, gap: spacing.xl }}>{OPTIONAL.map(field)}</View>
        ) : null}
      </GlassCard>

      {!complete ? (
        <Text variant="caption" color="muted" style={{ color: colors.textMuted }}>
          No tape handy? You can continue without it — GetFit will estimate from
          your height, weight and age instead, and label the result as an
          estimate.
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
});

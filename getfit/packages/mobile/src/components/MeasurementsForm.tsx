import React, { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Sex } from '@getfit/shared';
import { GlassCard } from './GlassCard';
import { NumberField } from './NumberField';
import { Text } from './Text';
import { useTheme } from '../theme';
import {
  MEASUREMENT_BOUNDS as BOUNDS,
  isMeasured,
  type MeasurementKey,
  type MeasurementsDraft,
} from '../utils/measurements';

export interface MeasurementsFormProps {
  draft: MeasurementsDraft;
  onChange: (patch: Partial<MeasurementsDraft>) => void;
  sex: Sex | null;
}

/**
 * Tape measurements.
 *
 * Waist and neck (plus hips for women) drive the body-fat reading through the
 * US Navy circumference formula. The limb pairs are genuinely optional: they
 * only add the left/right balance score, which stays unreported rather than
 * invented when they are left blank.
 */
export const MeasurementsForm = memo(function MeasurementsForm({
  draft,
  onChange,
  sex,
}: MeasurementsFormProps): React.ReactElement {
  const { colors, spacing } = useTheme();
  const [showOptional, setShowOptional] = useState(false);

  const set = useCallback(
    (key: MeasurementKey) => (value: string) => onChange({ [key]: value }),
    [onChange],
  );

  const complete = useMemo(() => isMeasured(draft, sex), [draft, sex]);

  return (
    <View style={{ gap: spacing.lg }}>
      <GlassCard accented={complete}>
        <Text variant="micro" color="accent" uppercase>
          Tape measurements
        </Text>
        <Text variant="caption" color="secondary" style={{ marginTop: spacing.sm }}>
          Measure relaxed, directly against the skin, with the tape level. These
          three readings are what your body-fat estimate is calculated from.
        </Text>

        <View style={{ marginTop: spacing.xl, gap: spacing.xl }}>
          <NumberField
            label="Waist"
            value={draft.waistCm}
            onChange={set('waistCm')}
            unit="cm"
            min={BOUNDS.waistCm.min}
            max={BOUNDS.waistCm.max}
            step={0.5}
            decimal
            placeholder="85"
            hint="At the narrowest point, usually just above the navel."
          />
          <NumberField
            label="Neck"
            value={draft.neckCm}
            onChange={set('neckCm')}
            unit="cm"
            min={BOUNDS.neckCm.min}
            max={BOUNDS.neckCm.max}
            step={0.5}
            decimal
            placeholder="38"
            hint="Just below the Adam's apple, tape sloping slightly downward."
          />
          {sex === 'female' ? (
            <NumberField
              label="Hips"
              value={draft.hipCm}
              onChange={set('hipCm')}
              unit="cm"
              min={BOUNDS.hipCm.min}
              max={BOUNDS.hipCm.max}
              step={0.5}
              decimal
              placeholder="95"
              hint="Around the widest point, feet together."
            />
          ) : null}
        </View>
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
          <View style={{ marginTop: spacing.xl, gap: spacing.xl }}>
            <NumberField
              label="Shoulders"
              value={draft.shoulderCm}
              onChange={set('shoulderCm')}
              unit="cm"
              min={BOUNDS.shoulderCm.min}
              max={BOUNDS.shoulderCm.max}
              step={0.5}
              decimal
              placeholder="120"
              hint="Around the widest point, arms relaxed. Sharpens your figure."
            />
            <NumberField
              label="Left arm"
              value={draft.leftArmCm}
              onChange={set('leftArmCm')}
              unit="cm"
              min={BOUNDS.leftArmCm.min}
              max={BOUNDS.leftArmCm.max}
              step={0.5}
              decimal
              placeholder="36"
            />
            <NumberField
              label="Right arm"
              value={draft.rightArmCm}
              onChange={set('rightArmCm')}
              unit="cm"
              min={BOUNDS.rightArmCm.min}
              max={BOUNDS.rightArmCm.max}
              step={0.5}
              decimal
              placeholder="36"
              hint="Mid-bicep, arm relaxed at your side."
            />
            <NumberField
              label="Left thigh"
              value={draft.leftThighCm}
              onChange={set('leftThighCm')}
              unit="cm"
              min={BOUNDS.leftThighCm.min}
              max={BOUNDS.leftThighCm.max}
              step={0.5}
              decimal
              placeholder="58"
            />
            <NumberField
              label="Right thigh"
              value={draft.rightThighCm}
              onChange={set('rightThighCm')}
              unit="cm"
              min={BOUNDS.rightThighCm.min}
              max={BOUNDS.rightThighCm.max}
              step={0.5}
              decimal
              placeholder="58"
              hint="Widest point, standing with weight evenly on both feet."
            />
          </View>
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

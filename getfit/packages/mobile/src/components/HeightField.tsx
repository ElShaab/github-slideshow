import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { UnitSystem } from '@getfit/shared';
import { NumberField } from './NumberField';
import { Text } from './Text';
import { useTheme } from '../theme';
import { HEIGHT_BOUNDS_CM } from '../utils/measurements';
import { joinInches, parseField, splitInches } from '../utils/units';

/** The metric range in whole feet, widened outward so neither end is unreachable. */
const FEET_BOUNDS = { min: 3, max: 8 };

export interface HeightFieldProps {
  /** Centimetres, or whole inches — whichever `units` says, as text. */
  value: string;
  onChange: (value: string) => void;
  units: UnitSystem;
}

/**
 * Height.
 *
 * Metric is one number. Imperial is two, because nobody knows their height in
 * inches — they know it in feet and inches, and asking for 72 instead of 6′ 0″
 * is the kind of friction that makes people guess.
 *
 * The draft still holds a single total; feet and inches are this control's own
 * presentation of it, which is why they live in local state rather than being
 * split out of the prop on every keystroke.
 */
export const HeightField = memo(function HeightField({
  value,
  onChange,
  units,
}: HeightFieldProps): React.ReactElement {
  const { spacing } = useTheme();
  const total = parseField(value);
  const split = total === null ? null : splitInches(total);

  const [feet, setFeet] = useState(split ? String(split.feet) : '');
  const [inches, setInches] = useState(split ? String(split.inches) : '');

  // What this control last sent up. Re-syncing only when the incoming total is
  // something else stops a rounded echo from overwriting what is being typed.
  const emitted = useRef<string | null>(null);

  useEffect(() => {
    if (units !== 'imperial') return;
    if (emitted.current === value) return;
    emitted.current = value;
    const parts = total === null ? null : splitInches(total);
    setFeet(parts ? String(parts.feet) : '');
    setInches(parts ? String(parts.inches) : '');
  }, [units, value, total]);

  const emit = useCallback(
    (nextFeet: string, nextInches: string) => {
      const f = parseField(nextFeet);
      const i = parseField(nextInches);
      // Feet alone is a height; inches alone is not, so it counts as zero only
      // once there is a foot figure to add it to.
      const next = f === null ? '' : String(joinInches(f, i ?? 0));
      emitted.current = next;
      onChange(next);
    },
    [onChange],
  );

  if (units === 'metric') {
    return (
      <NumberField
        label="Height"
        value={value}
        onChange={onChange}
        unit="cm"
        min={HEIGHT_BOUNDS_CM.min}
        max={HEIGHT_BOUNDS_CM.max}
        placeholder="180"
      />
    );
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <NumberField
          style={{ flex: 1 }}
          label="Height"
          value={feet}
          onChange={(next) => {
            setFeet(next);
            emit(next, inches);
          }}
          unit="ft"
          min={FEET_BOUNDS.min}
          max={FEET_BOUNDS.max}
          placeholder="5"
        />
        <NumberField
          style={{ flex: 1 }}
          label=" "
          value={inches}
          onChange={(next) => {
            setInches(next);
            emit(feet, next);
          }}
          unit="in"
          min={0}
          max={11}
          placeholder="11"
        />
      </View>
      <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
        Feet and inches — 5 ft 11 in, not 71.
      </Text>
    </View>
  );
});

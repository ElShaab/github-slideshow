import React, { memo, useCallback } from 'react';
import { View } from 'react-native';
import type { UnitSystem } from '@getfit/shared';
import { Segmented } from './Choice';
import { Text } from './Text';
import { useTheme } from '../theme';

const OPTIONS = [
  { id: 'metric' as const, label: 'cm / kg' },
  { id: 'imperial' as const, label: 'ft / lb' },
];

export interface UnitsToggleProps {
  units: UnitSystem;
  onChange: (units: UnitSystem) => void;
  label?: string;
}

/**
 * Metric or imperial.
 *
 * Labelled with the units themselves rather than "Metric" and "Imperial",
 * because the words are what people have to translate and the symbols are what
 * they recognise.
 *
 * Switching converts what is already on screen rather than clearing it: nothing
 * stored changes, so a measurement typed in one system keeps meaning the same
 * thing in the other.
 */
export const UnitsToggle = memo(function UnitsToggle({
  units,
  onChange,
  label = 'Units',
}: UnitsToggleProps): React.ReactElement {
  const { spacing } = useTheme();
  const change = useCallback((id: UnitSystem) => onChange(id), [onChange]);

  return (
    <View>
      <Text variant="micro" color="muted" uppercase>
        {label}
      </Text>
      <Segmented
        options={OPTIONS}
        value={units}
        onChange={change}
        accessibilityLabel="Units"
        style={{ marginTop: spacing.sm }}
      />
    </View>
  );
});

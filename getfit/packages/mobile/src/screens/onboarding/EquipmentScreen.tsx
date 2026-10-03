import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EQUIPMENT, type EquipmentId } from '@getfit/shared';
import { Choice, OnboardingHeader, PrimaryButton, Screen, Text } from '../../components';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';
import { stepNumber, totalSteps } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Equipment'>;

const CATEGORY_LABELS: Record<string, string> = {
  bodyweight: 'Bodyweight',
  free_weights: 'Free weights',
  accessories: 'Accessories',
  machines: 'Machines',
  cardio: 'Cardio',
};

/**
 * Screen 4 — home equipment. Multi-select, and the only equipment the AI will
 * ever prescribe for a home user.
 */
export function EquipmentScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { draft, toggleEquipment } = useOnboardingDraft();

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof EQUIPMENT>();
    for (const item of EQUIPMENT.filter((e) => e.selectable)) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return [...groups.entries()];
  }, []);

  const next = useCallback(() => navigation.navigate('Schedule'), [navigation]);
  const selected = new Set<EquipmentId>(draft.equipment);

  return (
    <Screen
      footer={
        <PrimaryButton
          label="Next"
          onPress={next}
          disabled={draft.equipment.length === 0}
          accessibilityHint={
            draft.equipment.length === 0 ? 'Select at least one item to continue' : undefined
          }
        />
      }
    >
      <OnboardingHeader
        title="Your equipment"
        subtitle="Select everything you have. The AI will only prescribe these."
        step={stepNumber('equipment', true)}
        total={totalSteps(true)}
        onBack={navigation.goBack}
      />

      <Text variant="caption" color="accent" style={{ marginTop: spacing.lg }}>
        {draft.equipment.length} selected
      </Text>

      {grouped.map(([category, items]) => (
        <View key={category} style={{ marginTop: spacing.xxl }}>
          <Text variant="micro" color="muted" uppercase>
            {CATEGORY_LABELS[category] ?? category}
          </Text>
          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            {items.map((item) => (
              <Choice
                key={item.id}
                label={item.name}
                multi
                selected={selected.has(item.id)}
                onPress={() => toggleEquipment(item.id)}
              />
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

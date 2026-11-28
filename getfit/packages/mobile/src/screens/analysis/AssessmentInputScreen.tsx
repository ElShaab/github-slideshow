import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  PHOTO_INSTRUCTIONS,
  WEEKLY_PHOTO_INSTRUCTIONS,
  displayBounds,
  displayStep,
  massUnit,
  type Sex,
} from '@getfit/shared';
import {
  GlassCard,
  MeasurementsForm,
  NumberField,
  PrimaryButton,
  WEIGHT_BOUNDS_KG,
  Screen,
  SecondaryButton,
  Text,
  isMeasured,
  type MeasurementsDraft,
} from '../../components';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsProvider';
import { kgToMassText } from '../../utils/units';

export interface AssessmentInputScreenProps {
  mode: 'initial' | 'weekly';
  sex: Sex | null;
  draft: MeasurementsDraft;
  onChange: (patch: Partial<MeasurementsDraft>) => void;
  /** Weight, as text. Only collected for a weekly reassessment. */
  weight?: string;
  onWeightChange?: (value: string) => void;
  weightPlaceholder?: string;
  onSubmit: (photoUri: string | null) => void;
  onCancel?: () => void;
}

/**
 * Everything an assessment is computed from, on one screen.
 *
 * The tape measurements do the work. The photo is optional throughout — it is
 * stored privately as the user's own before/after reference and is never
 * analysed — so the primary action is always available.
 */
export function AssessmentInputScreen({
  mode,
  sex,
  draft,
  onChange,
  weight,
  onWeightChange,
  weightPlaceholder,
  onSubmit,
  onCancel,
}: AssessmentInputScreenProps): React.ReactElement {
  const { colors, spacing } = useTheme();
  const { units } = useUnits();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const instructions = mode === 'weekly' ? WEEKLY_PHOTO_INSTRUCTIONS : PHOTO_INSTRUCTIONS;
  const measured = isMeasured(draft, sex, units);
  const weightBounds = displayBounds(WEIGHT_BOUNDS_KG, units, 'mass');

  const pick = useCallback(async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Permission needed',
          source === 'camera'
            ? 'GetFit needs camera access to take your progress photo.'
            : 'GetFit needs photo access to use an existing photo.',
        );
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.85,
            });

      if (result.canceled || !result.assets?.[0]?.uri) return;
      setPhotoUri(result.assets[0].uri);
    } catch {
      setError('That photo could not be opened. Please try again.');
    }
  }, []);

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
            label={mode === 'weekly' ? 'Run this week’s analysis' : 'Analyze my body'}
            onPress={() => onSubmit(photoUri)}
          />
          {onCancel ? <SecondaryButton label="Cancel" onPress={onCancel} /> : null}
        </View>
      }
    >
      <View style={{ marginBottom: spacing.xl }}>
        <Text variant="micro" color="accent" uppercase>
          {mode === 'weekly' ? 'Weekly assessment' : 'Your analysis'}
        </Text>
        <Text variant="display" style={{ marginTop: spacing.sm }}>
          {mode === 'weekly' ? 'Measure up' : 'Your measurements'}
        </Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
          {mode === 'weekly'
            ? 'Take the same readings as last week so the comparison means something.'
            : 'These are what your body composition is calculated from.'}
        </Text>
      </View>

      <MeasurementsForm draft={draft} onChange={onChange} sex={sex} units={units} />

      {onWeightChange ? (
        <GlassCard style={{ marginTop: spacing.lg }}>
          <NumberField
            label="Current weight"
            value={weight ?? ''}
            onChange={onWeightChange}
            unit={massUnit(units)}
            min={weightBounds.min}
            max={weightBounds.max}
            step={displayStep('mass', units)}
            decimal
            placeholder={weightPlaceholder ?? kgToMassText(80, units)}
            hint="Optional — leave blank to keep your last recorded weight."
          />
        </GlassCard>
      ) : null}

      <GlassCard style={{ marginTop: spacing.lg }} emphasis="soft" accented={Boolean(photoUri)}>
        <Text variant="subheading">Progress photo</Text>
        <Text variant="caption" color="secondary" style={{ marginTop: spacing.sm }}>
          Optional. It is never analysed and never appears in your history — it is
          stored privately so you have a real before-and-after to look back on.
        </Text>

        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {instructions.map((instruction) => (
            <View key={instruction} style={styles.instructionRow}>
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              <Text variant="caption" color="muted" style={{ flex: 1, marginLeft: spacing.md }}>
                {instruction}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
          <SecondaryButton
            label={photoUri ? 'Retake photo' : 'Take photo'}
            onPress={() => void pick('camera')}
          />
          <SecondaryButton
            label={photoUri ? 'Choose a different photo' : 'Upload photo'}
            onPress={() => void pick('library')}
          />
          {photoUri ? (
            <SecondaryButton label="Remove photo" onPress={() => setPhotoUri(null)} />
          ) : null}
        </View>
      </GlassCard>

      {!measured ? (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.lg }}>
          Without a waist and neck reading your result will be a height-and-weight
          estimate, and GetFit will label it as one.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 7 },
});

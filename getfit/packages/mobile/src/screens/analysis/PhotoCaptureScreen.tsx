import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { PHOTO_INSTRUCTIONS, WEEKLY_PHOTO_INSTRUCTIONS } from '@getfit/shared';
import { GlassCard, PrimaryButton, Screen, SecondaryButton, Text } from '../../components';
import { useTheme } from '../../theme';

export interface PhotoCaptureScreenProps {
  mode: 'initial' | 'weekly';
  onCaptured: (uri: string) => void;
  onCancel?: () => void;
  children?: React.ReactNode;
}

/**
 * Photo capture for an assessment.
 *
 * Framing guidance is prominent, but never a gate: any photo the user provides
 * is accepted and analysed.
 */
export function PhotoCaptureScreen({
  mode,
  onCaptured,
  onCancel,
  children,
}: PhotoCaptureScreenProps): React.ReactElement {
  const { colors, spacing } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const instructions = mode === 'weekly' ? WEEKLY_PHOTO_INSTRUCTIONS : PHOTO_INSTRUCTIONS;

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
            ? 'GetFit needs camera access to take your body photo.'
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
      setUri(result.assets[0].uri);
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
            label="Run analysis"
            onPress={() => uri && onCaptured(uri)}
            disabled={!uri}
          />
          {onCancel ? <SecondaryButton label="Not now" onPress={onCancel} /> : null}
        </View>
      }
    >
      <Text variant="title" style={{ marginTop: spacing.xl }} accessibilityRole="header">
        {mode === 'weekly' ? 'This week’s photo' : 'Your starting photo'}
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
        {mode === 'weekly'
          ? 'Match your last photo as closely as you can so the comparison stays honest.'
          : 'One full-body photo is all the AI needs.'}
      </Text>

      {children}

      <GlassCard style={{ marginTop: spacing.xl }} accented={Boolean(uri)}>
        <Text variant="micro" color="accent" uppercase>
          Photo guidance
        </Text>
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {instructions.map((instruction) => (
            <View key={instruction} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              <Text variant="body" color="secondary" style={{ flex: 1, marginLeft: spacing.md }}>
                {instruction}
              </Text>
            </View>
          ))}
        </View>
      </GlassCard>

      {uri ? (
        <GlassCard style={{ marginTop: spacing.lg }} emphasis="strong">
          <View style={styles.readyRow}>
            <View style={styles.flex}>
              <Text variant="subheading">Photo ready</Text>
              <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
                Private to you. Never shown in Progress or History.
              </Text>
            </View>
            <Text variant="heading" color="accent">
              ✓
            </Text>
          </View>
        </GlassCard>
      ) : null}

      <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
        <SecondaryButton label={uri ? 'Retake photo' : 'Take photo'} onPress={() => void pick('camera')} />
        <SecondaryButton
          label={uri ? 'Choose a different photo' : 'Upload photo'}
          onPress={() => void pick('library')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  readyRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});

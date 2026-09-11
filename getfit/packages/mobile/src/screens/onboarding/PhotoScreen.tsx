import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PHOTO_INSTRUCTIONS } from '@getfit/shared';
import {
  GlassCard,
  OnboardingHeader,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Text,
} from '../../components';
import { onboardingApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';
import { stepNumber, totalSteps } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Photo'>;

/**
 * Screen 8 — the initial photo.
 *
 * Guidance is shown clearly, but an imperfect photo is never rejected: if the
 * user picked an image, onboarding continues and the analysis simply reports
 * lower confidence.
 */
export function PhotoScreen({ navigation }: Props): React.ReactElement {
  const { spacing, colors } = useTheme();
  const { draft, update } = useOnboardingDraft();
  const { refresh, setStage } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHome = draft.trainingLocation === 'home';

  const pick = useCallback(
    async (source: 'camera' | 'library') => {
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
            ? await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: false })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.85,
                allowsEditing: false,
              });

        if (result.canceled || !result.assets?.[0]?.uri) return;
        update({ photoUri: result.assets[0].uri });
      } catch {
        setError('That photo could not be opened. Please try again.');
      }
    },
    [update],
  );

  /** Submits onboarding, then hands off to the analysis flow. */
  const submit = useCallback(async () => {
    if (!draft.photoUri) return;
    setBusy(true);
    setError(null);

    // Every earlier screen is required, but say so plainly rather than sending
    // nulls and surfacing the server's validation error instead.
    const { sex, trainingLevel, trainingLocation, trainingDays, sessionDurationMinutes } = draft;
    if (
      sex === null ||
      trainingLevel === null ||
      trainingLocation === null ||
      trainingDays === null ||
      sessionDurationMinutes === null
    ) {
      setError('Some answers are missing. Please go back and complete every step.');
      setBusy(false);
      return;
    }

    try {
      await onboardingApi.submit({
        age: Number.parseInt(draft.age, 10),
        sex,
        heightCm: Number.parseFloat(draft.heightCm),
        weightKg: Number.parseFloat(draft.weightKg),
        trainingLevel,
        trainingLocation,
        trainingDays,
        sessionDurationMinutes,
        goals: draft.goals,
        equipment: trainingLocation === 'home' ? draft.equipment : [],
      });

      await refresh();
      setStage('analysis');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [draft, refresh, setStage]);

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
            label={draft.photoUri ? 'Analyze my body' : 'Add a photo to continue'}
            onPress={() => void submit()}
            disabled={!draft.photoUri}
            loading={busy}
          />
        </View>
      }
    >
      <OnboardingHeader
        title="Your starting photo"
        subtitle="One full-body photo is all the AI needs to estimate your composition."
        step={stepNumber('photo', isHome)}
        total={totalSteps(isHome)}
        onBack={navigation.goBack}
      />

      <GlassCard style={{ marginTop: spacing.xxl }} accented={Boolean(draft.photoUri)}>
        <Text variant="micro" color="accent" uppercase>
          For the best result
        </Text>
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {PHOTO_INSTRUCTIONS.map((instruction) => (
            <View key={instruction} style={styles.instructionRow}>
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              <Text variant="body" color="secondary" style={{ flex: 1, marginLeft: spacing.md }}>
                {instruction}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="caption" color="muted" style={{ marginTop: spacing.lg }}>
          Not perfect? That is fine — GetFit works with the photo you have.
        </Text>
      </GlassCard>

      {draft.photoUri ? (
        <GlassCard style={{ marginTop: spacing.lg }} emphasis="strong">
          <View style={styles.readyRow}>
            <View>
              <Text variant="subheading">Photo ready</Text>
              <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
                Stored privately. Never shown in your history.
              </Text>
            </View>
            <Text variant="heading" color="accent">
              ✓
            </Text>
          </View>
        </GlassCard>
      ) : null}

      <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
        <SecondaryButton
          label={draft.photoUri ? 'Retake photo' : 'Take photo'}
          onPress={() => void pick('camera')}
        />
        <SecondaryButton
          label={draft.photoUri ? 'Choose a different photo' : 'Upload photo'}
          onPress={() => void pick('library')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  readyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

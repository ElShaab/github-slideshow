import React, { useCallback, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BodyAssessment } from '@getfit/shared';
import {
  ErrorState,
  GlassCard,
  LoadingScreen,
  NumberField,
  Screen,
  Text,
} from '../../components';
import { assessmentApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useTheme } from '../../theme';
import { AnalyzingScreen } from '../analysis/AnalyzingScreen';
import { BodyResultScreen } from '../analysis/BodyResultScreen';
import { PhotoCaptureScreen } from '../analysis/PhotoCaptureScreen';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'WeeklyAssessment'>;

/**
 * The weekly reassessment.
 *
 * Availability is checked against the server, which is the only thing that can
 * unlock it — exactly seven days after the previous assessment.
 */
export function WeeklyAssessmentScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const availability = useAsync(() => assessmentApi.availability(), []);
  const latest = useAsync(() => assessmentApi.latest(), []);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState<BodyAssessment | null>(null);

  const handleComplete = useCallback((assessment: BodyAssessment) => {
    setResult(assessment);
  }, []);

  if (availability.loading) return <LoadingScreen message="Checking your assessment…" />;
  if (!availability.data) {
    return <ErrorState message={availability.error ?? undefined} onRetry={availability.reload} />;
  }

  if (result) {
    return (
      <BodyResultScreen
        assessment={result}
        previous={latest.data?.assessment ?? null}
        title="This week"
        continueLabel="Back to home"
        onContinue={() => navigation.navigate('Main', { screen: 'Home' })}
      />
    );
  }

  // The lock is enforced on the server; this is the matching in-app reminder.
  if (!availability.data.available) {
    return (
      <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: 'center' }}>
        <GlassCard accented>
          <Text variant="micro" color="accent" uppercase>
            Not yet
          </Text>
          <Text variant="heading" style={{ marginTop: spacing.sm }}>
            Next assessment available in {availability.data.daysRemaining}{' '}
            {availability.data.daysRemaining === 1 ? 'day' : 'days'}
          </Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
            A new official assessment unlocks exactly 7 days after the last one, so
            the comparison stays meaningful.
          </Text>
        </GlassCard>
      </Screen>
    );
  }

  if (photoUri) {
    return (
      <AnalyzingScreen
        photoUri={photoUri}
        mode="weekly"
        weightKg={Number.parseFloat(weight) || undefined}
        onComplete={handleComplete}
        onCancel={() => setPhotoUri(null)}
      />
    );
  }

  return (
    <PhotoCaptureScreen mode="weekly" onCaptured={setPhotoUri} onCancel={navigation.goBack}>
      <GlassCard style={{ marginTop: spacing.xl }}>
        <NumberField
          label="Current weight"
          value={weight}
          onChange={setWeight}
          unit="kg"
          min={30}
          max={300}
          step={0.5}
          decimal
          placeholder={latest.data?.assessment ? String(latest.data.assessment.weightKg) : '80'}
          hint="Optional — leave blank to keep your last recorded weight."
        />
      </GlassCard>
    </PhotoCaptureScreen>
  );
}

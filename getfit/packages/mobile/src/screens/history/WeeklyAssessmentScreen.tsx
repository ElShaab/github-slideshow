import React, { useCallback, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BodyAssessment, BodyMeasurements } from '@getfit/shared';
import {
  ErrorState,
  GlassCard,
  LoadingScreen,
  Screen,
  Text,
  draftFromMeasurements,
  toMeasurements,
  type MeasurementsDraft,
} from '../../components';
import { assessmentApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useSession } from '../../state/SessionProvider';
import { useUnits } from '../../state/UnitsProvider';
import { kgToMassText, massToKg } from '../../utils/units';
import { useTheme } from '../../theme';
import { AnalyzingScreen } from '../analysis/AnalyzingScreen';
import { AssessmentInputScreen } from '../analysis/AssessmentInputScreen';
import { BodyResultScreen } from '../analysis/BodyResultScreen';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'WeeklyAssessment'>;

interface Submission {
  measurements: BodyMeasurements;
  photoUri: string | null;
}

/**
 * The weekly reassessment.
 *
 * Availability is checked against the server, which is the only thing that can
 * unlock it — exactly seven days after the previous assessment.
 */
export function WeeklyAssessmentScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { profile } = useSession();
  const { units } = useUnits();
  const availability = useAsync(() => assessmentApi.availability(), []);
  const latest = useAsync(() => assessmentApi.latest(), []);

  const [draft, setDraft] = useState<MeasurementsDraft | null>(null);
  const [weight, setWeight] = useState('');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [result, setResult] = useState<BodyAssessment | null>(null);

  // Last week's readings are pre-filled, so the user adjusts what changed
  // rather than re-typing everything — and a forgotten field is last week's
  // number, not a blank that silently drops the measurement.
  const previous = latest.data?.assessment ?? null;
  const startingDraft = useMemo(
    () => draftFromMeasurements(previous?.measurements, units),
    [previous?.measurements, units],
  );
  const current = draft ?? startingDraft;

  const handleChange = useCallback(
    (patch: Partial<MeasurementsDraft>) => setDraft({ ...current, ...patch }),
    [current],
  );

  const handleSubmit = useCallback(
    (photoUri: string | null) => {
      setSubmission({ measurements: toMeasurements(current, units), photoUri });
    },
    [current, units],
  );

  const weightKg = massToKg(weight, units);

  if (availability.loading) return <LoadingScreen message="Checking your assessment…" />;
  if (!availability.data) {
    return <ErrorState
        message={availability.error ?? undefined}
        detail={availability.detail}
        onRetry={availability.reload}
      />;
  }

  if (result) {
    return (
      <BodyResultScreen
        assessment={result}
        previous={previous}
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

  if (submission) {
    return (
      <AnalyzingScreen
        measurements={submission.measurements}
        photoUri={submission.photoUri}
        mode="weekly"
        weightKg={weightKg ?? undefined}
        onComplete={setResult}
        onCancel={() => setSubmission(null)}
      />
    );
  }

  return (
    <AssessmentInputScreen
      mode="weekly"
      sex={profile?.sex ?? null}
      draft={current}
      onChange={handleChange}
      weight={weight}
      onWeightChange={setWeight}
      weightPlaceholder={kgToMassText(previous?.weightKg ?? 80, units)}
      onSubmit={handleSubmit}
      onCancel={navigation.goBack}
    />
  );
}

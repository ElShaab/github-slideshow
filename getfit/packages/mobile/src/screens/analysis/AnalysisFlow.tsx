import React, { useCallback, useMemo, useState } from 'react';
import type { BodyAssessment, BodyMeasurements } from '@getfit/shared';
import { LoadingScreen, toMeasurements, type MeasurementsDraft } from '../../components';
import { assessmentApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useSession } from '../../state/SessionProvider';
import { AnalyzingScreen } from './AnalyzingScreen';
import { AssessmentInputScreen } from './AssessmentInputScreen';
import { BodyResultScreen } from './BodyResultScreen';

interface Submission {
  measurements: BodyMeasurements;
  photoUri: string | null;
}

/**
 * The initial-analysis leg of onboarding: run the analysis, show the result,
 * then hand the user to the paywall. Results always come before payment.
 */
export function AnalysisFlow(): React.ReactElement {
  const { draft, updateMeasurements } = useOnboardingDraft();
  const { markAssessmentComplete, profile } = useSession();
  const [assessment, setAssessment] = useState<BodyAssessment | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);

  // If the app restarted after the analysis, pick the stored result back up.
  const existing = useAsync(() => assessmentApi.latest(), []);

  const handleComplete = useCallback((result: BodyAssessment) => {
    setAssessment(result);
  }, []);

  const handleSubmit = useCallback(
    (draftMeasurements: MeasurementsDraft, photoUri: string | null) => {
      setSubmission({ measurements: toMeasurements(draftMeasurements), photoUri });
    },
    [],
  );

  // Onboarding already collected these; they are carried straight through.
  const carried = useMemo<Submission>(
    () => ({ measurements: toMeasurements(draft.measurements), photoUri: draft.photoUri }),
    [draft.measurements, draft.photoUri],
  );

  if (existing.loading) return <LoadingScreen message="Loading your analysis…" />;

  const resolved = assessment ?? existing.data?.assessment ?? null;
  if (resolved) {
    return (
      <BodyResultScreen
        assessment={resolved}
        onContinue={markAssessmentComplete}
        continueLabel="See membership"
      />
    );
  }

  const pending = submission ?? carried;

  // The draft lives in memory, so an app restart between onboarding and the
  // analysis loses it. Ask again rather than quietly running a weaker estimate.
  if (!submission && Object.keys(carried.measurements).length === 0 && !carried.photoUri) {
    return (
      <AssessmentInputScreen
        mode="initial"
        sex={profile?.sex ?? draft.sex}
        draft={draft.measurements}
        onChange={updateMeasurements}
        onSubmit={(photoUri) => handleSubmit(draft.measurements, photoUri)}
      />
    );
  }

  return (
    <AnalyzingScreen
      measurements={pending.measurements}
      photoUri={pending.photoUri}
      mode="initial"
      onComplete={handleComplete}
    />
  );
}

import React, { useCallback, useState } from 'react';
import type { BodyAssessment } from '@getfit/shared';
import { LoadingScreen } from '../../components';
import { assessmentApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useSession } from '../../state/SessionProvider';
import { AnalyzingScreen } from './AnalyzingScreen';
import { BodyResultScreen } from './BodyResultScreen';
import { PhotoCaptureScreen } from './PhotoCaptureScreen';

/**
 * The initial-analysis leg of onboarding: run the analysis, show the result,
 * then hand the user to the paywall. Results always come before payment.
 */
export function AnalysisFlow(): React.ReactElement {
  const { draft } = useOnboardingDraft();
  const { markAssessmentComplete } = useSession();
  const [assessment, setAssessment] = useState<BodyAssessment | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(draft.photoUri);

  // If the app restarted after the analysis, pick the stored result back up.
  const existing = useAsync(() => assessmentApi.latest(), []);

  const handleComplete = useCallback((result: BodyAssessment) => {
    setAssessment(result);
  }, []);

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

  if (!photoUri) {
    return <PhotoCaptureScreen mode="initial" onCaptured={setPhotoUri} />;
  }

  return <AnalyzingScreen photoUri={photoUri} mode="initial" onComplete={handleComplete} />;
}

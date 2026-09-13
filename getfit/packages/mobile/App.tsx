import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OnboardingDraftProvider } from './src/state/OnboardingDraft';
import { SessionProvider } from './src/state/SessionProvider';
import { ThemeProvider } from './src/theme';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { releaseReadiness } from './src/config/releaseReadiness';
import { MisconfiguredScreen } from './src/screens/MisconfiguredScreen';

/**
 * GetFit.
 *
 * Providers wrap the navigator in the order they depend on each other: theme
 * first (everything renders through it), then the session, which decides which
 * part of the journey the user sees.
 */
export default function App(): React.ReactElement {
  // A release build missing its API URL or its legal links would launch and
  // then fail every request, which reads as a broken app rather than an unset
  // variable. Say so plainly instead. Development builds are exempt — the
  // localhost fallback is the point of them.
  const problems = __DEV__ ? [] : releaseReadiness();
  if (problems.length > 0) {
    return (
      <SafeAreaProvider>
        <ThemeProvider>
          <MisconfiguredScreen problems={problems} />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <SessionProvider>
            <OnboardingDraftProvider>
              <RootNavigator />
            </OnboardingDraftProvider>
          </SessionProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

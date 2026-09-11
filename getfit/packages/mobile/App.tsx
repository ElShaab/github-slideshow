import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OnboardingDraftProvider } from './src/state/OnboardingDraft';
import { SessionProvider } from './src/state/SessionProvider';
import { ThemeProvider } from './src/theme';
import { ErrorBoundary } from './src/components/ErrorBoundary';

/**
 * GetFit.
 *
 * Providers wrap the navigator in the order they depend on each other: theme
 * first (everything renders through it), then the session, which decides which
 * part of the journey the user sees.
 */
export default function App(): React.ReactElement {
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

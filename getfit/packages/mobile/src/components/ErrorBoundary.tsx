import React from 'react';
import { ErrorState } from './Screen';

interface State {
  hasError: boolean;
}

/**
 * Catches render errors anywhere in the tree and shows the app's standard
 * error surface instead of a red screen. The underlying error is logged for
 * developers but never rendered to the user.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Unhandled render error', error);
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorState
          message="Something went wrong."
          onRetry={() => this.setState({ hasError: false })}
        />
      );
    }
    return this.props.children;
  }
}

import React from 'react';
import { ErrorState } from './Screen';
import { describeError } from '../utils/describeError';

interface State {
  hasError: boolean;
  detail: string | null;
}

/**
 * Catches render errors anywhere in the tree and shows the app's standard
 * error surface instead of a red screen.
 *
 * The error is reported rather than swallowed. It used to be logged only under
 * __DEV__, which meant a release build — the only kind a tester or a reviewer
 * ever runs — turned every failure into "Something went wrong." with nothing
 * behind it, for them and for whoever had to fix it.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, detail: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, detail: describeError(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Logged on every build, so it reaches the device console. This is the
    // only record of what happened on a build nobody can attach a debugger to.
    console.error('GetFit render error:', error?.stack ?? error, info?.componentStack ?? '');
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorState
          message="Something went wrong."
          detail={this.state.detail}
          onRetry={() => this.setState({ hasError: false, detail: null })}
        />
      );
    }
    return this.props.children;
  }
}

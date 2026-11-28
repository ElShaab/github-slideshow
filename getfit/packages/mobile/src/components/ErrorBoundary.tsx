import React from 'react';
import { ErrorState } from './Screen';
import { describeError } from '../utils/describeError';
import { describeRenderFailure } from '../utils/componentStack';

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

    // The component stack only exists here, not in getDerivedStateFromError,
    // so the on-screen detail is upgraded in a second pass. Component names
    // survive minification where the error's own stack does not — this is what
    // lets a screenshot name the screen that broke.
    const named = describeRenderFailure(describeError(error), info?.componentStack);
    if (named && named !== this.state.detail) this.setState({ hasError: true, detail: named });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorState
          // Deliberately not the same sentence a failed data load shows. Two
          // different faults that print identically cost a round trip with a
          // tester every time one of them happens.
          message="GetFit hit a problem drawing this screen."
          detail={this.state.detail}
          onRetry={() => this.setState({ hasError: false, detail: null })}
        />
      );
    }
    return this.props.children;
  }
}

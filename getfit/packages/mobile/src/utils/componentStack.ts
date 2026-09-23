/**
 * Which component threw, pulled out of React's component stack.
 *
 * A release bundle is minified, so an error's own stack trace names bundle
 * offsets and nothing else. React's component stack is the exception: it is
 * built from component names, which survive minification, and its first frame
 * is the component that actually threw.
 *
 * That one name is the difference between "something in the app broke" and a
 * line to go and read, and it is the only such clue a tester holding a phone
 * can read off the screen and send back.
 */

/** Frames that name the boundary or the tree rather than the culprit. */
const UNINFORMATIVE = /^(ErrorBoundary|Suspense|Fragment|Anonymous|Unknown)$/;

/**
 * React writes frames as "\n    in ComponentName (at File.tsx:12)", and in
 * newer builds as "\n    at ComponentName". Both are read here; anything that
 * matches neither yields nothing rather than a guess.
 */
export function topComponentFrame(componentStack: string | null | undefined): string | null {
  if (typeof componentStack !== 'string' || componentStack.trim() === '') return null;

  for (const line of componentStack.split('\n')) {
    const match = /^\s*(?:in|at)\s+([A-Za-z0-9_$.]+)/.exec(line);
    if (!match) continue;

    const name = match[1];
    if (UNINFORMATIVE.test(name)) continue;
    return name;
  }

  return null;
}

/** "PaywallScreen — TypeError: undefined is not a function", when both are known. */
export function describeRenderFailure(
  cause: string | null,
  componentStack: string | null | undefined,
): string | null {
  const component = topComponentFrame(componentStack);
  if (!component) return cause;
  return cause ? `${component} — ${cause}` : `Failed while rendering ${component}`;
}

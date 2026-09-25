/**
 * The single line of a caught error worth showing someone.
 *
 * Kept away from anything that imports React Native so it can be tested
 * directly: this runs at the worst possible moment, in a build nobody can
 * attach a debugger to, and it must not be able to throw on its way out.
 *
 * A stack trace is the wrong thing to show — minified into nothing useful on a
 * release build, and it reads as a crash to the person holding the phone. The
 * constructor name and message are short, mean something to whoever fixes it,
 * and are the difference between a report that says "it broke" and one that
 * can be acted on.
 */
export function describeError(error: unknown, limit = 200): string | null {
  const clip = (text: string): string =>
    text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

  try {
    if (error instanceof Error) {
      const name = error.name || 'Error';
      const message = error.message || '';
      return clip(message ? `${name}: ${message}` : name);
    }
    if (typeof error === 'string' && error.trim() !== '') return clip(error);
    return null;
  } catch {
    // Some thrown values are hostile — a proxy, or an object whose getters
    // throw. Losing the detail is survivable; throwing from here is not.
    return null;
  }
}

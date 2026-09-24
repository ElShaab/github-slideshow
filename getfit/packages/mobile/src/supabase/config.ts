/**
 * Where the Supabase project lives.
 *
 * Read from the environment at build time, never committed: this repository is
 * public, and while the publishable key is designed to be shipped inside the
 * app — it identifies the project and grants nothing on its own, because every
 * table is row-level-secured to a signed-in user — a key sitting in public
 * source is still a key anyone can point a script at. Keeping it in the build
 * environment means it can be rotated without a commit.
 *
 * `EXPO_PUBLIC_` variables are inlined into the bundle by Expo, so this works
 * in a release build with no network configuration at runtime.
 */

export interface SupabaseConfig {
  url: string;
  /** The publishable key (sb_publishable_…), not the legacy anon JWT. */
  publishableKey: string;
}

/** The shape read out of app.json's `extra`, when the env is not set. */
interface ExtraConfig {
  supabase?: { url?: string; publishableKey?: string };
}

/**
 * The two values, already read.
 *
 * Deliberately takes them rather than the environment object. Expo inlines
 * `process.env.EXPO_PUBLIC_…` at build time by substituting that exact
 * expression in the source; handing the whole of `process.env` to a function
 * and reading a property off the parameter leaves nothing for it to
 * substitute, so the bundle ships a lookup against an object that is empty on
 * the device. This function was written that way and the result was a build
 * that could never be configured, however carefully the .env was filled in.
 */
export interface SupabaseEnv {
  url?: string;
  publishableKey?: string;
}

export function readSupabaseConfig(
  env: SupabaseEnv,
  extra: ExtraConfig | null | undefined,
): SupabaseConfig | null {
  const url = (env.url ?? extra?.supabase?.url ?? '').trim();
  const publishableKey = (env.publishableKey ?? extra?.supabase?.publishableKey ?? '').trim();

  if (!url || !publishableKey) return null;
  // Anything but https would put the user's training history on the wire in
  // clear, and App Transport Security would block it on iOS regardless.
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(url)) return null;

  return { url: url.replace(/\/$/, ''), publishableKey };
}

/**
 * True for the legacy anon key, which is a JWT.
 *
 * Both still work, but the legacy key is the one Supabase is retiring, and it
 * is the one that gets pasted in by mistake — so it is worth naming.
 */
export function isLegacyAnonKey(key: string): boolean {
  return key.startsWith('eyJ');
}

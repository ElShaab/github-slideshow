import Constants from 'expo-constants';

/**
 * The version string shown in Settings.
 *
 * Read from the build rather than typed into a screen: a hardcoded "1.0.0"
 * silently goes stale the first time the version is bumped, and a support
 * request quoting the wrong version costs more than it saves.
 */
export function appVersion(): string {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const build =
    Constants.expoConfig?.ios?.buildNumber ??
    (Constants.expoConfig?.android?.versionCode !== undefined
      ? String(Constants.expoConfig.android.versionCode)
      : undefined);
  return build ? `${version} (${build})` : version;
}

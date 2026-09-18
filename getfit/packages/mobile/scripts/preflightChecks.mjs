/**
 * The release checks themselves, separated from the CLI so they can be tested.
 *
 * Every rule here corresponds to something App Review checks, and every one of
 * them fails invisibly on the machine that builds the app and visibly on a
 * reviewer's phone — which is the worst possible order to find them in.
 */

export const isHttpsUrl = (value) =>
  typeof value === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+/.test(value);

/** A hostname nobody owns, or one that only resolves on the build machine. */
const isPlaceholderUrl = (value) =>
  /\.example($|[/:])/.test(value) || value.includes('localhost') || value.includes('10.0.2.2');

export function checkRelease({ app, eas, profile = 'production' }) {
  const problems = [];
  const warnings = [];

  // There is no API to point at: the app reads and writes local storage, so a
  // build with no network configuration is correct rather than broken.

  /* ---------------------------- legal links --------------------------- */

  const legal = app.extra?.legal ?? {};
  if (!isHttpsUrl(legal.privacyPolicyUrl) || isPlaceholderUrl(legal.privacyPolicyUrl ?? '')) {
    problems.push(
      'app.json extra.legal.privacyPolicyUrl must be a public https URL. Both stores require it, and Guideline 3.1.2 requires the link to work from inside the app.',
    );
  }
  if (!isHttpsUrl(legal.supportUrl) || isPlaceholderUrl(legal.supportUrl ?? '')) {
    problems.push(
      'app.json extra.legal.supportUrl must be a public https URL. App Store Connect requires a support URL.',
    );
  }
  if (!isHttpsUrl(legal.termsOfUseUrl)) {
    warnings.push(
      "extra.legal.termsOfUseUrl is unset, so the app links to Apple's standard EULA. That is allowed; set your own only if you have them.",
    );
  }

  /* -------------------------- store submission ------------------------ */

  const submit = eas.submit?.[profile] ?? {};
  for (const [key, value] of Object.entries(submit.ios ?? {})) {
    if (typeof value === 'string' && value.startsWith('REPLACE_WITH')) {
      problems.push(`eas.json submit.${profile}.ios.${key} is still a placeholder.`);
    }
  }

  /* ---------------------------- app config ---------------------------- */

  if (!app.version) problems.push('app.json version is required.');
  if (!app.ios?.bundleIdentifier) problems.push('app.json ios.bundleIdentifier is required.');
  if (!app.ios?.buildNumber) problems.push('app.json ios.buildNumber is required.');
  if (!app.ios?.privacyManifests) {
    problems.push(
      'app.json ios.privacyManifests is required — Apple rejects uploads without a privacy manifest.',
    );
  }
  if (app.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === undefined) {
    warnings.push(
      'ITSAppUsesNonExemptEncryption is unset, so every upload will ask for an export-compliance answer.',
    );
  }

  // A vague permission string is one of the most common rejections there is.
  for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
    const value = app.ios?.infoPlist?.[key];
    if (!value || value.length < 20) {
      problems.push(`app.json ios.infoPlist.${key} must explain, specifically, why the app asks.`);
    }
  }

  return { problems, warnings };
}

/**
 * The release checks themselves, separated from the CLI so they can be tested.
 *
 * Every rule here corresponds to something App Review checks, and every one of
 * them fails invisibly on the machine that builds the app and visibly on a
 * reviewer's phone — which is the worst possible order to find them in.
 */

import { PAGES, placeholders, renderPage } from './legalPages.mjs';

export const isHttpsUrl = (value) =>
  typeof value === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+/.test(value);

/** A hostname nobody owns, or one that only resolves on the build machine. */
const isPlaceholderUrl = (value) =>
  /\.example($|[/:])/.test(value) || value.includes('localhost') || value.includes('10.0.2.2');

export function checkRelease({
  app,
  eas,
  profile = 'production',
  dependencies = {},
  legalDocuments = {},
}) {
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

  // A privacy policy is the one link App Review always opens, and a page
  // reading "[LEGAL ENTITY NAME]" is worse than no page at all — it is a
  // binding legal document naming nobody.
  for (const page of PAGES) {
    const markdown = legalDocuments[page.source];
    if (markdown === undefined) continue;

    // Checked on the published page: the note to whoever deploys the app
    // names `[BRACKETED]` as an example and never reaches a reader.
    const missing = placeholders(renderPage(markdown, page));
    if (missing.length > 0) {
      problems.push(
        `${page.source} still has ${missing.join(', ')} to fill in, so ${page.permalink} cannot be published.`,
      );
    }
  }

  /* -------------------------- store submission ------------------------ */

  const submit = eas.submit?.[profile] ?? {};
  for (const [key, value] of Object.entries(submit.ios ?? {})) {
    if (typeof value === 'string' && value.startsWith('REPLACE_WITH')) {
      problems.push(`eas.json submit.${profile}.ios.${key} is still a placeholder.`);
    }
  }

  for (const key of ['ascAppId', 'appleTeamId']) {
    if (!submit.ios?.[key]) {
      problems.push(
        `eas.json submit.${profile}.ios.${key} is missing, and the upload cannot be addressed without it.`,
      );
    }
  }

  // Deliberately absent from a public repository: it is a personal email
  // address, and EAS takes it from the environment just as happily. Said out
  // loud so it reads as a decision rather than an oversight discovered at
  // submit time.
  if (!submit.ios?.appleId) {
    warnings.push(
      'eas.json has no submit.ios.appleId, so `eas submit` will ask for your Apple account email. Set EXPO_APPLE_ID in the environment to answer it without committing the address.',
    );
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

  // `backgroundColor` is applied by expo-system-ui and silently ignored
  // without it — prebuild says so once and is never read again, and the
  // result is a white root view flashing behind a very dark app.
  if (app.backgroundColor && !dependencies['expo-system-ui']) {
    warnings.push(
      `app.json backgroundColor is set to ${app.backgroundColor} but expo-system-ui is not installed, so it does nothing and the root view stays white.`,
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

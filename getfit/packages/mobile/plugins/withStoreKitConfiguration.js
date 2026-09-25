/**
 * Attaches `GetFit.storekit` to the generated Xcode Run scheme.
 *
 * Without this, a device or simulator build asks the real App Store for
 * `getfit_membership_monthly` and gets an empty array back — because the
 * products do not exist in App Store Connect yet, or the Paid Applications
 * agreement is not active. The paywall then fails with "That membership is not
 * available on this device", which is accurate but useless for development.
 *
 * Attaching the configuration file makes StoreKit answer locally instead: real
 * purchase sheets, real receipts, no Apple account. It is a plugin rather than
 * a note in the README because `expo prebuild` regenerates `ios/` wholesale —
 * a scheme edited by hand in Xcode survives exactly until the next prebuild.
 *
 * WHAT THIS DOES NOT TELL YOU: the file never talks to Apple. It cannot prove
 * that the products are live, that the agreement is active, or that the bundle
 * id matches. Set GETFIT_NO_STOREKIT_CONFIG=1 before prebuilding to leave the
 * scheme alone and reach the real sandbox.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

/** Xcode indents scheme XML three spaces per level. */
const INDENT = '   ';

const CONFIG_FILE = 'GetFit.storekit';

/** Matches the whole `<LaunchAction …>…</LaunchAction>` block and its indent. */
const LAUNCH_ACTION = /([ \t]*)(<LaunchAction\b[\s\S]*?)([ \t]*)<\/LaunchAction>/;

/** Matches a reference already present, in either the paired or self-closing form. */
const EXISTING_REFERENCE =
  /[ \t]*<StoreKitConfigurationFileReference\b[\s\S]*?(?:\/>|<\/StoreKitConfigurationFileReference>)[ \t]*\r?\n?/g;

function escapeAttribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Returns `xml` with the Run action pointed at `identifier`.
 *
 * `identifier` is resolved by Xcode relative to the scheme file itself, not to
 * the project or the workspace — the single most common way to get this wrong.
 *
 * Replaces an existing reference rather than adding a second one, so running
 * prebuild twice does not produce a scheme Xcode refuses to open.
 *
 * @param {string} xml contents of an .xcscheme file
 * @param {string} identifier path to the .storekit file, relative to the scheme
 * @returns {string}
 */
function attachStoreKitConfiguration(xml, identifier) {
  const match = LAUNCH_ACTION.exec(xml);
  if (!match) {
    throw new Error('This scheme has no <LaunchAction>, so there is nothing to run.');
  }

  const [block, openIndent, body, closeIndent] = match;
  const indent = closeIndent || openIndent;
  const inner = indent + INDENT;

  const reference =
    `${inner}<StoreKitConfigurationFileReference\n` +
    `${inner}${INDENT}identifier = "${escapeAttribute(identifier)}">\n` +
    `${inner}</StoreKitConfigurationFileReference>\n`;

  // Strip any earlier reference first: Xcode reads the first one and a
  // duplicate is a corrupt scheme, not a harmless leftover.
  const cleaned = body.replace(EXISTING_REFERENCE, '');
  const rebuilt = `${openIndent}${cleaned}${reference}${indent}</LaunchAction>`;

  return xml.slice(0, match.index) + rebuilt + xml.slice(match.index + block.length);
}

/** Removes the reference, leaving the scheme otherwise untouched. */
function detachStoreKitConfiguration(xml) {
  return xml.replace(EXISTING_REFERENCE, '');
}

/**
 * Every shared scheme in the generated project.
 *
 * Globbed rather than derived from the app name, because the scheme is named
 * after the Xcode project and `expo.name` is not always the same string.
 *
 * @param {string} platformProjectRoot the generated `ios/` directory
 * @returns {string[]} absolute paths to .xcscheme files
 */
function findSchemes(platformProjectRoot) {
  const entries = fs.existsSync(platformProjectRoot)
    ? fs.readdirSync(platformProjectRoot, { withFileTypes: true })
    : [];

  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.xcodeproj'))
    .flatMap((entry) => {
      const dir = path.join(platformProjectRoot, entry.name, 'xcshareddata', 'xcschemes');
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.xcscheme'))
        .map((name) => path.join(dir, name));
    });
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withStoreKitConfiguration = (config) =>
  withDangerousMod(config, [
    'ios',
    (dangerous) => {
      const { projectRoot, platformProjectRoot } = dangerous.modRequest;

      // EAS builds must reach the real sandbox — a local simulation there would
      // hide exactly the failures a preview build exists to find.
      const optedOut = process.env.GETFIT_NO_STOREKIT_CONFIG === '1';
      const onEas = process.env.EAS_BUILD === 'true';

      const source = path.join(projectRoot, CONFIG_FILE);
      if (!optedOut && !onEas && !fs.existsSync(source)) {
        throw new Error(
          `${CONFIG_FILE} is missing from ${projectRoot}. It is the simulator ` +
            'catalogue; restore it or set GETFIT_NO_STOREKIT_CONFIG=1.',
        );
      }

      const schemes = findSchemes(platformProjectRoot);
      if (schemes.length === 0) {
        console.warn(
          '  › StoreKit: no shared scheme found, so purchases will reach the real store.',
        );
        return dangerous;
      }

      for (const scheme of schemes) {
        const xml = fs.readFileSync(scheme, 'utf8');
        const identifier = path.relative(path.dirname(scheme), source);
        const updated =
          optedOut || onEas
            ? detachStoreKitConfiguration(xml)
            : attachStoreKitConfiguration(xml, identifier);
        if (updated !== xml) fs.writeFileSync(scheme, updated);
      }

      if (optedOut || onEas) {
        console.log(
          `  › StoreKit: scheme left on the real store (${
            onEas ? 'EAS build' : 'GETFIT_NO_STOREKIT_CONFIG=1'
          })`,
        );
      } else {
        console.log(`  › StoreKit: Run scheme set to ${CONFIG_FILE} — purchases run locally`);
      }

      return dangerous;
    },
  ]);

module.exports = withStoreKitConfiguration;
module.exports.attachStoreKitConfiguration = attachStoreKitConfiguration;
module.exports.detachStoreKitConfiguration = detachStoreKitConfiguration;
module.exports.findSchemes = findSchemes;

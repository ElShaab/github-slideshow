/**
 * Release preflight.
 *
 * This is the gate between "it works on my machine" and a build a reviewer
 * opens, so the checks themselves need to be right: a false pass ships a
 * rejection, and a false failure blocks a good build.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
// The build script and this test share one module, so a rule can never pass
// here while the script that gates the build uses a different one.
import { checkRelease, isHttpsUrl } from '../scripts/preflightChecks.mjs';

const root = path.resolve(__dirname, '..');
const realApp = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const realEas = JSON.parse(readFileSync(path.join(root, 'eas.json'), 'utf8'));

/**
 * A configuration with nothing wrong with it.
 *
 * Deep-cloned, because each case mutates it to break one thing — a shallow
 * spread shares `ios` between cases and lets one test's damage leak into the
 * next one's result.
 */
function readyConfig() {
  return {
    app: {
      ...structuredClone(realApp),
      extra: {
        legal: {
          privacyPolicyUrl: 'https://getfit.app/privacy',
          termsOfUseUrl: 'https://getfit.app/terms',
          supportUrl: 'https://getfit.app/support',
        },
      },
    },
    eas: {
      ...realEas,
      build: { ...realEas.build, production: { env: { EXPO_PUBLIC_API_URL: 'https://api.getfit.app' } } },
      submit: {
        production: {
          ios: { appleId: 'dev@getfit.app', ascAppId: '1234567890', appleTeamId: 'ABCDE12345' },
        },
      },
    },
    profile: 'production',
    env: {},
  };
}

const run = (mutate: (config: ReturnType<typeof readyConfig>) => void = () => {}) => {
  const config = readyConfig();
  mutate(config);
  return checkRelease(config) as { problems: string[]; warnings: string[] };
};

describe('isHttpsUrl', () => {
  test('accepts a real https URL', () => {
    assert.equal(isHttpsUrl('https://getfit.app/privacy'), true);
    assert.equal(isHttpsUrl('https://api.getfit.app'), true);
  });

  test('rejects anything that would fail on a device', () => {
    // ATS blocks cleartext, and the rest are simply not addresses.
    for (const value of ['http://getfit.app', 'getfit.app', 'https://localhost', '', undefined]) {
      assert.equal(isHttpsUrl(value), false, String(value));
    }
  });
});

describe('checkRelease', () => {
  test('a fully configured build passes', () => {
    const { problems } = run();
    assert.deepEqual(problems, []);
  });

  test('catches an unset, cleartext or placeholder API URL', () => {
    const missing = run((c) => {
      c.eas.build.production.env = {};
    });
    assert.ok(missing.problems.some((p) => p.includes('EXPO_PUBLIC_API_URL is not set')));

    const cleartext = run((c) => {
      c.eas.build.production.env.EXPO_PUBLIC_API_URL = 'http://api.getfit.app';
    });
    assert.ok(cleartext.problems.some((p) => p.includes('not https')));

    // The shipped default. Building with it produces an app that reaches
    // nothing, which reads as a broken app rather than an unset variable.
    for (const placeholder of ['https://api.getfit.example', 'https://localhost:4000']) {
      const result = run((c) => {
        c.eas.build.production.env.EXPO_PUBLIC_API_URL = placeholder;
      });
      assert.ok(
        result.problems.some((p) => p.includes('EXPO_PUBLIC_API_URL')),
        `accepted ${placeholder}`,
      );
    }
  });

  test('an env override counts as configured', () => {
    const { problems } = run((c) => {
      c.eas.build.production.env = {};
      c.env = { EXPO_PUBLIC_API_URL: 'https://api.getfit.app' };
    });
    assert.deepEqual(problems, []);
  });

  test('requires the privacy policy and support links Guideline 3.1.2 needs', () => {
    for (const field of ['privacyPolicyUrl', 'supportUrl']) {
      const blank = run((c) => {
        c.app.extra.legal[field] = '';
      });
      assert.ok(blank.problems.some((p) => p.includes(field)), `${field} was not required`);

      const placeholder = run((c) => {
        c.app.extra.legal[field] = 'https://getfit.example/x';
      });
      assert.ok(
        placeholder.problems.some((p) => p.includes(field)),
        `${field} accepted a placeholder host`,
      );
    }
  });

  test('missing terms only warns, because Apple publishes a standard EULA', () => {
    const { problems, warnings } = run((c) => {
      c.app.extra.legal.termsOfUseUrl = '';
    });
    assert.deepEqual(problems, []);
    assert.ok(warnings.some((w) => w.includes('EULA')));
  });

  test('catches unreplaced submission placeholders', () => {
    const { problems } = run((c) => {
      c.eas.submit.production.ios.ascAppId = 'REPLACE_WITH_APP_STORE_CONNECT_APP_ID';
    });
    assert.ok(problems.some((p) => p.includes('ascAppId')));
  });

  test('requires the privacy manifest Apple rejects uploads without', () => {
    const { problems } = run((c) => {
      delete c.app.ios.privacyManifests;
    });
    assert.ok(problems.some((p) => p.includes('privacyManifests')));
  });

  test('requires specific permission strings', () => {
    const { problems } = run((c) => {
      c.app.ios.infoPlist.NSCameraUsageDescription = 'Camera';
    });
    assert.ok(problems.some((p) => p.includes('NSCameraUsageDescription')));
  });

  test('the checked-in config is complete apart from what only a human can supply', () => {
    // Everything left is a credential or a hosted URL nobody can invent: the
    // API host, the two legal links, and the App Store Connect identifiers.
    const { problems } = checkRelease({
      app: structuredClone(realApp),
      eas: structuredClone(realEas),
      profile: 'production',
      env: {},
    });
    const expected = [
      'EXPO_PUBLIC_API_URL',
      'privacyPolicyUrl',
      'supportUrl',
      'appleId',
      'ascAppId',
      'appleTeamId',
    ];
    assert.equal(problems.length, expected.length, `unexpected: ${problems.join(' | ')}`);
    for (const field of expected) {
      assert.ok(problems.some((p) => p.includes(field)), `${field} was not reported`);
    }
  });
});

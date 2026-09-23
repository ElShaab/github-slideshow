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
import { PAGES } from '../scripts/legalPages.mjs';

const root = path.resolve(__dirname, '..');
const realApp = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const realEas = JSON.parse(readFileSync(path.join(root, 'eas.json'), 'utf8'));
const realDependencies = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  .dependencies as Record<string, string>;

const readDocument = (source: string): string =>
  readFileSync(path.join(root, '..', '..', source), 'utf8');

/**
 * The real legal documents with every placeholder filled in.
 *
 * The fixture is a configuration with nothing wrong with it, and the documents
 * as committed are still waiting on a decision or two. Filled generically
 * rather than by name, so this does not have to be revisited each time one of
 * them is settled.
 */
const filledDocuments = Object.fromEntries(
  PAGES.map((page) => [page.source, readDocument(page.source).replace(/\[[^\]]+\](?!\()/g, 'Example')]),
) as Record<string, string>;

/** The same documents with one detail taken back out. */
const unfilled = (source: string, placeholder: string): Record<string, string> => ({
  ...filledDocuments,
  [source]: `${filledDocuments[source]}\n\nOperated by ${placeholder}.\n`,
});

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
      build: { ...realEas.build, production: { autoIncrement: true } },
      submit: {
        production: {
          ios: { appleId: 'dev@getfit.app', ascAppId: '1234567890', appleTeamId: 'ABCDE12345' },
        },
      },
    },
    dependencies: { ...realDependencies },
    legalDocuments: { ...filledDocuments },
    profile: 'production',
  };
}

const run = (mutate: (config: ReturnType<typeof readyConfig>) => void = () => {}) => {
  const config = readyConfig();
  mutate(config);
  return checkRelease(config) as { problems: string[]; warnings: string[] };
};

describe('addressing the upload', () => {
  test('a missing app id is a problem, not a warning', () => {
    const { problems } = run((c) => {
      delete c.eas.submit.production.ios.ascAppId;
    });
    assert.ok(problems.some((p) => p.includes('ascAppId')));
  });

  test('so is a missing team id', () => {
    const { problems } = run((c) => {
      delete c.eas.submit.production.ios.appleTeamId;
    });
    assert.ok(problems.some((p) => p.includes('appleTeamId')));
  });

  test('a missing account email only warns, because it comes from the environment', () => {
    // Deliberately kept out of a public repository; EXPO_APPLE_ID supplies it.
    const { problems, warnings } = run((c) => {
      delete c.eas.submit.production.ios.appleId;
    });
    assert.ok(warnings.some((w) => w.includes('EXPO_APPLE_ID')));
    assert.ok(!problems.some((p) => p.includes('appleId')));
  });

  test('the checked-in config addresses the upload', () => {
    const ios = realEas.submit?.production?.ios ?? {};
    assert.ok(ios.ascAppId && !String(ios.ascAppId).startsWith('REPLACE_WITH'));
    assert.ok(ios.appleTeamId && !String(ios.appleTeamId).startsWith('REPLACE_WITH'));
  });
});

describe('the published legal pages', () => {
  test('a document with nothing left to fill is ready to publish', () => {
    const { problems } = run();
    assert.ok(!problems.some((p) => p.includes('to fill in')));
  });

  test('an unfilled placeholder blocks the build', () => {
    const { problems } = run((c) => {
      c.legalDocuments = unfilled('PRIVACY.md', '[LEGAL ENTITY NAME]');
    });
    assert.ok(
      problems.some((p) => p.includes('PRIVACY.md') && p.includes('[LEGAL ENTITY NAME]')),
      'a policy naming nobody must not reach a reviewer',
    );
  });

  test('every document is checked, not just the first', () => {
    const { problems } = run((c) => {
      c.legalDocuments = unfilled('SUPPORT.md', '[SUPPORT EMAIL]');
    });
    assert.ok(problems.some((p) => p.includes('SUPPORT.md')));
  });

  test('a note to whoever deploys the app blocks it too', () => {
    // Not all caps, and it would otherwise be published verbatim.
    const { problems } = run((c) => {
      c.legalDocuments = unfilled('PRIVACY.md', '[name your DPO here]');
    });
    assert.ok(problems.some((p) => p.includes('[name your DPO here]')));
  });

  test('the note to whoever deploys the app is not mistaken for a gap', () => {
    // It names `[BRACKETED]` as an example and is stripped before publishing.
    const { problems } = run();
    assert.ok(!problems.some((p) => p.includes('[BRACKETED]')));
  });

  test('documents that were not supplied are simply not checked', () => {
    const { problems } = run((c) => {
      c.legalDocuments = {};
    });
    assert.ok(!problems.some((p) => p.includes('to fill in')));
  });
});

describe('the root view background colour', () => {
  test('a colour with nothing to apply it is called out', () => {
    const { problems, warnings } = run((c) => {
      c.app.backgroundColor = '#0A3B85';
      delete c.dependencies['expo-system-ui'];
    });
    assert.ok(
      warnings.some((w) => w.includes('expo-system-ui')),
      'a background colour that silently does nothing should be reported',
    );
    // A white flash is ugly, not a rejection.
    assert.ok(!problems.some((p) => p.includes('expo-system-ui') || p.includes('backgroundColor')));
  });

  test('silent when the module that applies it is installed', () => {
    const { warnings } = run((c) => {
      c.app.backgroundColor = '#0A3B85';
      c.dependencies['expo-system-ui'] = '~4.0.9';
    });
    assert.ok(!warnings.some((w) => w.includes('expo-system-ui')));
  });

  test('no colour, nothing to warn about', () => {
    const { warnings } = run((c) => {
      delete c.app.backgroundColor;
      delete c.dependencies['expo-system-ui'];
    });
    assert.ok(!warnings.some((w) => w.includes('expo-system-ui')));
  });

  test('the real config has both, so the colour actually applies', () => {
    const { warnings } = run();
    assert.ok(
      !warnings.some((w) => w.includes('expo-system-ui')),
      'app.json sets backgroundColor but nothing installed applies it',
    );
  });
});

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

  test('no API URL is required, because there is no API', () => {
    // Every read and write is local. A build with no network configuration is
    // correct, and demanding one would block every release.
    const { problems } = run((c) => {
      c.eas.build.production.env = {};
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
    // What is left is a contact channel, which is a decision about what to
    // make public rather than a value anyone can look up.
    const { problems } = checkRelease({
      app: structuredClone(realApp),
      eas: structuredClone(realEas),
      legalDocuments: Object.fromEntries(PAGES.map((page) => [page.source, readDocument(page.source)])),
      profile: 'production',
    });
    const expected = ['PRIVACY.md', 'SUPPORT.md'];
    assert.equal(problems.length, expected.length, `unexpected: ${problems.join(' | ')}`);
    for (const field of expected) {
      assert.ok(problems.some((p) => p.includes(field)), `${field} was not reported`);
    }
  });
});

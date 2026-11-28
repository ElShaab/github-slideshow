/**
 * The privacy manifest declares what leaves the phone — no more, no less.
 *
 * Apple counts data as "collected" when it is transmitted off the device. Up
 * to build 12 the manifest got that wrong in both directions:
 *
 *   - It declared photos, purchase history and crash data, none of which ever
 *     leaves the phone. There is no photo column and no purchase table in the
 *     database, and no crash reporter in the app. Over-declaring contradicts
 *     the privacy policy, which says photos stay on the device.
 *   - It did not declare the name people give in onboarding, which syncs to
 *     their account as `profiles.display_name`. Under-declaring is the
 *     serious direction: the label says less than the app does.
 *
 * These tests read the facts from the schema and the dependency list, so a
 * migration that starts syncing something new fails here until the manifest
 * says so too.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const MOBILE = path.join(__dirname, '..');
const MIGRATIONS = path.join(MOBILE, '..', '..', 'supabase', 'migrations');

const app = JSON.parse(readFileSync(path.join(MOBILE, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(readFileSync(path.join(MOBILE, 'package.json'), 'utf8'));

interface Declared {
  NSPrivacyCollectedDataType: string;
  NSPrivacyCollectedDataTypeLinked: boolean;
  NSPrivacyCollectedDataTypeTracking: boolean;
  NSPrivacyCollectedDataTypePurposes: string[];
}

const declared: Declared[] = app.ios.privacyManifests.NSPrivacyCollectedDataTypes;
const types = new Set(declared.map((entry) => entry.NSPrivacyCollectedDataType.replace('NSPrivacyCollectedDataType', '')));

/** Every migration, as one block of SQL with comments removed. */
const schema = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(path.join(MIGRATIONS, name), 'utf8'))
  .join('\n')
  .replace(/--.*$/gm, '');

const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

describe('what leaves the phone is declared', () => {
  test('the email address, which is the account', () => {
    assert.ok(types.has('EmailAddress'));
  });

  test('the name, which syncs as profiles.display_name', () => {
    assert.match(schema, /display_name/, 'the column is gone — reconsider the declaration');
    assert.ok(types.has('Name'), 'display_name leaves the device; the manifest has to say so');
  });

  test('measurements and training, which sync to the account', () => {
    assert.match(schema, /create table if not exists public\.assessments/);
    assert.ok(types.has('HealthAndFitness'));
  });

  test('feedback, which is written to the feedback table', () => {
    assert.match(schema, /create table if not exists public\.feedback/);
    assert.ok(types.has('OtherUserContent'));
  });
});

describe('what stays on the phone is not declared', () => {
  test('photos — there is nowhere in the database to put one', () => {
    assert.ok(!/photo/i.test(schema), 'a photo column exists now; declare PhotosorVideos');
    assert.ok(!types.has('PhotosorVideos'));
  });

  test('purchase history — entitlement is read from the store on the device', () => {
    assert.ok(
      !/(purchase|subscription|transaction|receipt)/i.test(schema),
      'purchases are stored in the database now; declare PurchaseHistory',
    );
    assert.ok(!types.has('PurchaseHistory'));
  });

  test('crash data — there is no crash reporter in the app', () => {
    const reporters = dependencies.filter((name) =>
      /sentry|crashlytics|bugsnag|instabug|datadog|newrelic|appcenter|firebase/i.test(name),
    );
    assert.deepEqual(reporters, [], 'a crash reporter was added; declare CrashData');
    assert.ok(!types.has('CrashData'));
  });
});

describe('every declaration', () => {
  test('is linked to the account and never used for tracking', () => {
    for (const entry of declared) {
      assert.equal(entry.NSPrivacyCollectedDataTypeLinked, true, entry.NSPrivacyCollectedDataType);
      assert.equal(entry.NSPrivacyCollectedDataTypeTracking, false, entry.NSPrivacyCollectedDataType);
    }
    assert.equal(app.ios.privacyManifests.NSPrivacyTracking, false);
  });

  test('is for app functionality only', () => {
    for (const entry of declared) {
      assert.deepEqual(entry.NSPrivacyCollectedDataTypePurposes, [
        'NSPrivacyCollectedDataTypePurposeAppFunctionality',
      ]);
    }
  });

  test('appears once', () => {
    assert.equal(types.size, declared.length);
  });
});

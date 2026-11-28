/**
 * What stops a build from shipping.
 *
 * Written after a release build silently skipped the account step because it
 * carried no Supabase keys. Nothing failed, nothing logged: the customer paid
 * and landed in the exercise picker, and the missing configuration was
 * invisible from the machine that built it. This turns that into a sentence on
 * screen before anyone submits.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readinessProblems } from '../src/config/readiness';

const configured = { supabaseConfigured: true, missingLegalFields: [] };

describe('a build ready to submit', () => {
  test('reports nothing', () => {
    assert.deepEqual(readinessProblems(configured), []);
  });
});

describe('a build with no Supabase project', () => {
  test('is refused, because the account step would be skipped in silence', () => {
    const problems = readinessProblems({ ...configured, supabaseConfigured: false });
    assert.equal(problems.length, 1);
    assert.match(problems[0].field, /EXPO_PUBLIC_SUPABASE/);
  });

  test('says where the values go, and that the cache has to be cleared', () => {
    // They are substituted into the bundle at build time, and Metro caches the
    // transformed module by file content — which .env is not part of. Someone
    // who edits .env and rebuilds gets the old values and no warning, so the
    // message has to say so or the next build fails identically.
    const [problem] = readinessProblems({ ...configured, supabaseConfigured: false });
    assert.match(problem.detail, /\.env/);
    assert.match(problem.detail, /cache/i);
  });
});

describe('missing legal links', () => {
  test('are each reported by name', () => {
    const problems = readinessProblems({
      ...configured,
      missingLegalFields: ['extra.legal.privacyPolicyUrl', 'extra.legal.supportUrl'],
    });
    assert.deepEqual(
      problems.map((problem) => problem.field),
      ['extra.legal.privacyPolicyUrl', 'extra.legal.supportUrl'],
    );
  });
});

describe('several problems at once', () => {
  test('are all listed, so one build shows every one', () => {
    // Reporting them one at a time would mean a build, a read, a fix and
    // another build for each.
    const problems = readinessProblems({
      supabaseConfigured: false,
      missingLegalFields: ['extra.legal.supportUrl'],
    });
    assert.equal(problems.length, 2);
  });
});

#!/usr/bin/env node
/**
 * Proves the Supabase project is wired up and private, end to end.
 *
 * Not a smoke test for "does the URL respond". It creates two real accounts,
 * has one write the kinds of rows the app writes, and then checks the thing
 * that actually matters: that the second account cannot see or touch any of
 * it, and neither can an anonymous caller. Then it deletes both.
 *
 * Everything runs over plain HTTPS against the same REST and auth endpoints
 * the app uses, so a pass here means the app's path works too.
 *
 *   npm run supabase:check --workspace @getfit/mobile
 *
 * Reads EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY from
 * the environment, falling back to packages/mobile/.env.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(HERE, '..', '.env');

/** Minimal .env reader — no dependency for a script that runs once. */
function fromEnvFile(name) {
  try {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && match[1] === name) return match[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env is fine when the values come from the environment.
  }
  return undefined;
}

const URL_ = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? fromEnvFile('EXPO_PUBLIC_SUPABASE_URL') ?? '')
  .trim()
  .replace(/\/$/, '');
const KEY = (
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  fromEnvFile('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ??
  ''
).trim();

let failures = 0;
const pass = (what) => console.log(`  ok    ${what}`);
const fail = (what, detail) => {
  failures += 1;
  console.log(`  FAIL  ${what}`);
  if (detail) console.log(`        ${String(detail).slice(0, 300)}`);
};

const rand = () => Math.random().toString(36).slice(2, 10);

async function call(pathname, { token, method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, 'content-type': 'application/json' };
  // Without a user token the request is anonymous, which is what the
  // "anon is refused" checks rely on.
  if (token) headers.authorization = `Bearer ${token}`;
  if (prefer) headers.prefer = prefer;

  const response = await fetch(`${URL_}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, ok: response.ok, body: parsed };
}

/** Creates an account and returns its token and id, or explains why it could not. */
async function signUp() {
  const email = `getfit-check-${rand()}@example.com`;
  const password = `Check-${rand()}-${rand()}`;

  const result = await call('/auth/v1/signup', { method: 'POST', body: { email, password } });
  if (!result.ok) {
    return { error: result.body?.msg ?? result.body?.error_description ?? JSON.stringify(result.body) };
  }

  const token = result.body?.access_token;
  const id = result.body?.user?.id ?? result.body?.id;
  if (!token) {
    // Email confirmation is on: a user exists but has no session, so every
    // table write would be refused by row-level security until they click the
    // link. That is correct behaviour, not a failure of the wiring.
    return { needsConfirmation: true, id };
  }
  return { token, id, email };
}

console.log(`\nGetFit — Supabase check\n${'-'.repeat(40)}`);

if (!URL_ || !KEY) {
  console.log('  FAIL  no configuration found');
  console.log('        Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,');
  console.log(`        or create ${ENV_FILE} from .env.example`);
  process.exit(1);
}
if (!/^https:\/\//.test(URL_)) {
  console.log(`  FAIL  the URL is not https: ${URL_}`);
  process.exit(1);
}
if (KEY.startsWith('eyJ')) {
  console.log('  warn  that looks like the legacy anon JWT, not the sb_publishable_… key');
}
console.log(`  project ${URL_}\n`);

/* --------------------------- the project is up -------------------------- */

const health = await call('/auth/v1/health');
if (health.ok) pass('the project answers');
else fail('the project answers', `HTTP ${health.status}`);

/* ------------------ the migration ran, and anon is locked out ----------- */

const TABLES = [
  'profiles',
  'user_goals',
  'user_equipment',
  'exercise_preferences',
  'programs',
  'scheduled_workouts',
  'completed_workouts',
  'personal_records',
  'assessments',
];

const missing = [];
const readableByAnon = [];
for (const table of TABLES) {
  const result = await call(`/rest/v1/${table}?select=*&limit=1`);
  // PGRST205 is "no such table in the schema cache" — the migration never ran.
  if (result.status === 404 || result.body?.code === 'PGRST205') missing.push(table);
  else if (result.ok) readableByAnon.push(table);
}

// public.feedback (0002) is probed separately because it is shaped differently:
// nobody has select on it, so a denied read cannot tell "no such table" from
// "no permission". An insert can — PGRST205 only comes back when it is absent.
const feedbackProbe = await call('/rest/v1/feedback', {
  method: 'POST',
  body: { user_id: '00000000-0000-0000-0000-000000000000', id: 'probe', message: 'probe', written_at: new Date().toISOString() },
});
const feedbackMissing =
  feedbackProbe.status === 404 || feedbackProbe.body?.code === 'PGRST205';

if (missing.length === 0) pass(`all ${TABLES.length} tables exist`);
else fail(`all ${TABLES.length} tables exist`, `missing: ${missing.join(', ')} — run supabase/migrations/0001_user_data.sql`);

if (readableByAnon.length === 0) pass('a signed-out caller can read nothing');
else fail('a signed-out caller can read nothing', `readable without signing in: ${readableByAnon.join(', ')}`);

if (feedbackMissing) {
  fail(
    'the feedback table exists',
    'run supabase/migrations/0002_feedback.sql — or, if you already did, PostgREST is ' +
      "still serving its old schema cache: run  notify pgrst, 'reload schema';",
  );
} else {
  pass('the feedback table exists');
}

if (missing.length > 0) {
  console.log(`\n${failures} check(s) failed. Run the migration first.\n`);
  process.exit(1);
}

/* ------------------------------ two accounts ---------------------------- */

const alice = await signUp();
if (alice.error) {
  fail('an account can be created', alice.error);
  console.log('\n  Enable email sign-in: Authentication → Sign In / Providers → Email.\n');
  process.exit(1);
}
if (alice.needsConfirmation) {
  pass('an account can be created');
  console.log('\n  note  "Confirm email" is ON, so sign-up returns no session and the first');
  console.log('        sync waits for the user to click the link. That is correct, but it');
  console.log('        means someone who subscribes then signs up sees no data until they');
  console.log('        confirm. Turn it off under Authentication → Sign In / Providers →');
  console.log('        Email if you would rather they sync immediately.');
  console.log('\n  Cannot check row privacy without a session. Stopping here.\n');
  process.exit(failures > 0 ? 1 : 0);
}
pass('an account can be created and is signed in straight away');

const bob = await signUp();
if (bob.error || bob.needsConfirmation) {
  fail('a second account can be created', bob.error ?? 'no session returned');
  process.exit(1);
}

/* --------------------------- writing real data -------------------------- */

const wrote = await call('/rest/v1/profiles', {
  token: alice.token,
  method: 'POST',
  prefer: 'return=representation',
  body: {
    user_id: alice.id,
    local_user_id: 'check_script',
    age: 30,
    sex: 'male',
    height_cm: 180,
    weight_kg: 80,
    training_level: 'intermediate',
    training_location: 'gym',
    training_days: 4,
    session_duration_minutes: 60,
    onboarding_completed: true,
    units: 'metric',
  },
});
if (wrote.ok) pass('a signed-in user can store their profile');
else fail('a signed-in user can store their profile', `HTTP ${wrote.status} ${JSON.stringify(wrote.body)}`);

// 0003, checked on its own rather than folded into the write above: a missing
// column would otherwise fail the whole profile insert and report it as
// something else entirely. PGRST204 is "no such column in the schema cache".
const named = await call(`/rest/v1/profiles?user_id=eq.${alice.id}`, {
  token: alice.token,
  method: 'PATCH',
  prefer: 'return=representation',
  body: { display_name: 'Check Script' },
});
if (named.ok && Array.isArray(named.body) && named.body[0]?.display_name === 'Check Script') {
  pass('and the name they asked to be called');
} else if (named.body?.code === 'PGRST204' || named.status === 404) {
  fail('and the name they asked to be called', 'run supabase/migrations/0003_display_name.sql');
} else {
  fail('and the name they asked to be called', `HTTP ${named.status} ${JSON.stringify(named.body)}`);
}

const assessment = await call('/rest/v1/assessments', {
  token: alice.token,
  method: 'POST',
  prefer: 'return=representation',
  body: {
    user_id: alice.id,
    id: `check_${rand()}`,
    assessment_number: 1,
    assessed_at: new Date().toISOString(),
    weight_kg: 80,
    body_fat_percent: 17.6,
    estimated_muscle_mass_kg: 34.5,
    waist_body_ratio: 0.46,
    symmetry_percent: 98,
    method: 'navy',
    confidence: 0.8,
    provider: 'local',
    measurements: { waistCm: 83, neckCm: 38 },
  },
});
if (assessment.ok) pass('a signed-in user can store a body assessment');
else fail('a signed-in user can store a body assessment', `HTTP ${assessment.status} ${JSON.stringify(assessment.body)}`);

const readBack = await call('/rest/v1/assessments?select=*', { token: alice.token });
if (readBack.ok && Array.isArray(readBack.body) && readBack.body.length === 1) {
  const stored = readBack.body[0];
  if (Number(stored.body_fat_percent) === 17.6) pass('and read it back unchanged');
  else fail('and read it back unchanged', `body_fat_percent came back as ${stored.body_fat_percent}`);
} else {
  fail('and read it back unchanged', `HTTP ${readBack.status} ${JSON.stringify(readBack.body)}`);
}

/* ------------------------- the part that matters ------------------------ */

const bobSees = await call('/rest/v1/assessments?select=*', { token: bob.token });
if (bobSees.ok && Array.isArray(bobSees.body) && bobSees.body.length === 0) {
  pass("another account sees none of it");
} else {
  fail("another account sees none of it", `saw ${JSON.stringify(bobSees.body)}`);
}

const anonSees = await call('/rest/v1/assessments?select=*');
if (!anonSees.ok || (Array.isArray(anonSees.body) && anonSees.body.length === 0)) {
  pass('a signed-out caller sees none of it');
} else {
  fail('a signed-out caller sees none of it', JSON.stringify(anonSees.body));
}

const forged = await call('/rest/v1/assessments', {
  token: bob.token,
  method: 'POST',
  body: {
    user_id: alice.id,
    id: `forged_${rand()}`,
    assessment_number: 2,
    assessed_at: new Date().toISOString(),
    weight_kg: 80,
    body_fat_percent: 9,
    estimated_muscle_mass_kg: 40,
    waist_body_ratio: 0.4,
    method: 'navy',
    confidence: 0.9,
    provider: 'local',
  },
});
if (!forged.ok) pass('and cannot write into it either');
else fail('and cannot write into it either', 'the forged row was accepted');

/* -------------------------------- feedback ------------------------------ */

if (!feedbackMissing) {
  const feedbackId = `check_${rand()}`;
  const filed = await call('/rest/v1/feedback', {
    token: alice.token,
    method: 'POST',
    body: {
      user_id: alice.id,
      id: feedbackId,
      message: 'Written by npm run supabase:check — safe to delete.',
      app_version: 'check-script',
      platform: 'ios',
      written_at: new Date().toISOString(),
    },
  });
  if (filed.ok) pass('a signed-in user can file feedback');
  else fail('a signed-in user can file feedback', `HTTP ${filed.status} ${JSON.stringify(filed.body)}`);

  // Aimed at a real account, so that a refusal is the policy refusing and not
  // the foreign key rejecting an id that was never going to exist. The earlier
  // probe only had to tell "no such table" from "no permission".
  const anonFiles = await call('/rest/v1/feedback', {
    method: 'POST',
    body: {
      user_id: alice.id,
      id: `anon_${rand()}`,
      message: 'Filed by nobody',
      written_at: new Date().toISOString(),
    },
  });
  if (!anonFiles.ok) pass('a signed-out caller cannot file feedback at all');
  else fail('a signed-out caller cannot file feedback at all', 'the anonymous insert was accepted');

  // The point of the table's shape: insert and nothing else. A client that
  // could read this back could read everyone's.
  const readsItBack = await call('/rest/v1/feedback?select=*', { token: alice.token });
  if (!readsItBack.ok) {
    pass('and cannot read any of it back, not even their own');
  } else {
    // An empty array means the select privilege is still there and only row
    // level security is filtering. Supabase grants it by default on every new
    // table in public, so 0002 revokes it; an older copy of 0002 did not.
    fail(
      'and cannot read any of it back, not even their own',
      Array.isArray(readsItBack.body) && readsItBack.body.length === 0
        ? 'the read was allowed and returned nothing, rather than refused — re-run ' +
          'supabase/migrations/0002_feedback.sql, which revokes select from authenticated'
        : JSON.stringify(readsItBack.body),
    );
  }

  const forgedFeedback = await call('/rest/v1/feedback', {
    token: bob.token,
    method: 'POST',
    body: {
      user_id: alice.id,
      id: `forged_${rand()}`,
      message: 'Filed under somebody else',
      written_at: new Date().toISOString(),
    },
  });
  if (!forgedFeedback.ok) pass('and cannot file it under another account');
  else fail('and cannot file it under another account', 'the forged row was accepted');

  // The device keeps a message until it is sure it landed, so redelivery is
  // the normal path after a dropped response, not an edge case. A plain
  // insert, exactly as the app sends it: the duplicate key IS the success
  // signal, and the app reads 23505 as "already delivered". An upsert would
  // need a way to update the conflicting row, which this table does not grant.
  const redelivered = await call('/rest/v1/feedback', {
    token: alice.token,
    method: 'POST',
    body: {
      user_id: alice.id,
      id: feedbackId,
      message: 'Written by npm run supabase:check — safe to delete.',
      written_at: new Date().toISOString(),
    },
  });
  if (redelivered.body?.code === '23505') {
    pass('and redelivering it is refused as a duplicate, which the app reads as delivered');
  } else if (redelivered.ok) {
    fail('and redelivering it is refused as a duplicate', 'it was stored a second time');
  } else {
    fail(
      'and redelivering it is refused as a duplicate',
      `HTTP ${redelivered.status} ${JSON.stringify(redelivered.body)}`,
    );
  }
}

/* -------------------------------- cleanup ------------------------------- */

const deleted = await call('/rest/v1/rpc/delete_own_account', { token: alice.token, method: 'POST', body: {} });
if (deleted.ok) pass('account deletion works from the app');
else fail('account deletion works from the app', `HTTP ${deleted.status} ${JSON.stringify(deleted.body)}`);

const afterDelete = await call('/rest/v1/assessments?select=*', { token: alice.token });
if (!afterDelete.ok || (Array.isArray(afterDelete.body) && afterDelete.body.length === 0)) {
  pass('and takes the data with it');
} else {
  fail('and takes the data with it', `${afterDelete.body.length} row(s) survived`);
}

await call('/rest/v1/rpc/delete_own_account', { token: bob.token, method: 'POST', body: {} });

console.log(
  failures === 0
    ? '\nAll checks passed. Supabase is connected, storing data, and private per account.\n  Feedback filed by this script is removed with its test account.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

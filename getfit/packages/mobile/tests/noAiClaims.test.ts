/**
 * The app does not claim to be something it is not.
 *
 * Build 12 opened on "AI Personal Trainer" and told people across a dozen
 * screens that "the AI" built and adjusted their program. There is no AI in
 * GetFit: the program comes from deterministic rules in @getfit/shared — a
 * weekly volume budget, a progression service, a cardio ladder keyed to body
 * fat — and the app's own privacy screen says, correctly, "Nothing is sent to
 * an AI service". A reviewer reading both is looking at Guideline 2.3.1, and
 * so is any customer who reads both.
 *
 * The one mention allowed is that privacy statement, because it is the denial.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const SRC = path.join(__dirname, '..', 'src');

/** The sentence that says there is no AI, which is the one place it may appear. */
const ALLOWED = ['Nothing is sent to an AI service'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** True for a line that is only a comment, which a customer never reads. */
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

describe('no claim to be AI', () => {
  test('nothing a customer can read says the app is, or uses, an AI', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (isComment(line) || !/\bAI\b/.test(line)) return;
          if (ALLOWED.some((allowed) => line.includes(allowed))) return;
          offenders.push(`${path.relative(SRC, file)}:${index + 1}  ${line.trim()}`);
        });
    }
    assert.deepEqual(offenders, [], 'Say what GetFit does instead — it builds the program from rules.');
  });

  test('the privacy statement that denies it is still there', () => {
    // If this goes, the allowance above is protecting nothing.
    const privacy = readFileSync(path.join(SRC, 'screens', 'settings', 'SettingsDetailScreens.tsx'), 'utf8');
    assert.ok(privacy.includes(ALLOWED[0]));
  });
});

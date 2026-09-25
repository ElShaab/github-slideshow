/**
 * The published Privacy and Support pages.
 *
 * App Review opens both. A 404, a page still reading "[LEGAL ENTITY NAME]", or
 * a note addressed to whoever deploys the app are each a rejection, and none of
 * them is visible from inside the repo — the markdown looks fine either way.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
// The build script and this test share one module, so a page can never pass
// here while the script that writes it uses different rules.
import { PAGES, placeholders, renderPage } from '../scripts/legalPages.mjs';

/** The getfit/ directory, which holds the source documents. */
const docs = path.resolve(__dirname, '..', '..', '..');
/** The repository root, which is what GitHub Pages serves. */
const site = path.resolve(docs, '..');

const read = (name: string) => readFileSync(path.join(docs, name), 'utf8');
const privacy = PAGES.find((page) => page.source === 'PRIVACY.md');
if (!privacy) throw new Error('PRIVACY.md is no longer published, which is a rejection on its own.');

describe('finding what is still unfilled', () => {
  test('reports a placeholder', () => {
    assert.deepEqual(placeholders('operated by [LEGAL ENTITY NAME] of [REGISTERED ADDRESS]'), [
      '[LEGAL ENTITY NAME]',
      '[REGISTERED ADDRESS]',
    ]);
  });

  test('reports each one once, however often it appears', () => {
    assert.deepEqual(placeholders('[SUPPORT EMAIL] … [SUPPORT EMAIL]'), ['[SUPPORT EMAIL]']);
  });

  test('a filled document has none', () => {
    assert.deepEqual(placeholders('operated by Example Fitness Ltd of 1 Example Street'), []);
  });

  test('a note to whoever deploys the app counts too', () => {
    // Not all caps, so an all-caps rule sails past it onto the live page.
    assert.deepEqual(placeholders('[If you have a DPO, name them here.]'), [
      '[If you have a DPO, name them here.]',
    ]);
  });

  test('a markdown link is not a placeholder', () => {
    assert.deepEqual(placeholders('see the [Privacy Policy](privacy.html)'), []);
    assert.deepEqual(placeholders('[report a problem](https://apple.com)'), []);
  });
});

describe('rendering a page', () => {
  const rendered = renderPage(read(privacy.source), privacy);

  test('carries the front matter that puts it at its URL', () => {
    assert.match(rendered, /^---\n/);
    assert.match(rendered, /\nlayout: legal\n/);
    assert.match(rendered, /\npermalink: \/privacy\n/);
    assert.match(rendered, /\ntitle: Privacy Policy\n/);
  });

  test('drops the note addressed to whoever deploys the app', () => {
    assert.ok(read(privacy.source).includes('Before publishing:'), 'the source should carry it');
    assert.ok(!rendered.includes('Before publishing:'), 'a visitor must never read it');
  });

  test('drops the H1, because the layout already prints the title', () => {
    assert.ok(!rendered.includes('# GetFit Privacy Policy'));
  });

  test('keeps the policy itself', () => {
    assert.ok(rendered.includes('## What we collect'));
    assert.ok(rendered.includes('Deleting everything'));
  });

  test('says it is generated, so nobody edits the copy', () => {
    assert.match(rendered, /Do not edit/);
  });

  test('the marker is a block of its own, not glued to the first line', () => {
    // Run together, kramdown swallows the paragraph after it into the comment.
    assert.match(rendered, /-->\n\n/);
  });
});

describe('every document publishes', () => {
  for (const page of PAGES) {
    test(`${page.source} exists and renders`, () => {
      const rendered = renderPage(read(page.source), page);
      assert.ok(rendered.length > 500, `${page.source} rendered to almost nothing`);
      assert.ok(!rendered.includes('Before publishing:'));
    });
  }

  test('no two pages claim the same URL', () => {
    const permalinks = new Set(PAGES.map((page) => page.permalink));
    assert.equal(permalinks.size, PAGES.length);
  });
});

describe('links survive being served from a project site', () => {
  // The site lives at /github-slideshow/, so a root-absolute href drops that
  // prefix and 404s — which is invisible until a reviewer clicks it.
  test('no document links to an absolute path', () => {
    for (const page of PAGES) {
      const offenders = read(page.source).match(/\]\(\/[^)]*\)/g) ?? [];
      assert.deepEqual(offenders, [], `${page.source} links outside the project site`);
    }
  });

  test('the layout links relatively too', () => {
    const layout = readFileSync(path.join(site, '_layouts', 'legal.html'), 'utf8');
    assert.deepEqual(layout.match(/href="\/[^"]*"/g) ?? [], []);
    assert.match(layout, /href="privacy\.html"/);
    assert.match(layout, /href="support\.html"/);
  });
});

describe('the app points at the pages that are actually published', () => {
  const legal = JSON.parse(readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo.extra
    .legal as Record<string, string>;

  test('each configured URL matches a page this repo builds', () => {
    for (const [key, permalink] of [
      ['privacyPolicyUrl', '/privacy'],
      ['supportUrl', '/support'],
    ] as const) {
      assert.ok(PAGES.some((page) => page.permalink === permalink), `${permalink} is not built`);
      assert.ok(
        legal[key].endsWith(`${permalink}.html`),
        `${key} is ${legal[key]}, which is not the page this repo publishes`,
      );
    }
  });
});

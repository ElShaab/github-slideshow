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
import { PAGES, blocks, inline, placeholders, renderPage } from '../scripts/legalPages.mjs';

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

  test('is a complete document on its own', () => {
    // No front matter, no layout, no Jekyll. The first version needed all
    // three, and 404'd in review because the branch Pages builds from had
    // none of them. A standalone file has nothing to be missing.
    assert.match(rendered, /^<!doctype html>/);
    assert.match(rendered, /<meta name="viewport"/);
    assert.match(rendered, /<style>/);
    assert.ok(!rendered.startsWith('---'), 'front matter would make Jekyll process it');
    assert.ok(!rendered.includes('{{'), 'a Liquid tag means it still expects a layout');
  });

  test('is titled', () => {
    assert.match(rendered, /<title>GetFit — Privacy Policy<\/title>/);
  });

  test('drops the note addressed to whoever deploys the app', () => {
    assert.ok(read(privacy.source).includes('Before publishing:'), 'the source should carry it');
    assert.ok(!rendered.includes('Before publishing:'), 'a visitor must never read it');
  });

  test('keeps the policy itself', () => {
    assert.match(rendered, /<h2>What we collect<\/h2>/);
    assert.ok(rendered.includes('Deleting everything'));
  });

  test('leaves no markdown behind', () => {
    for (const page of PAGES) {
      const html = renderPage(read(page.source), page);
      assert.ok(!html.includes('**'), `${page.source} has unconverted bold`);
      assert.ok(!html.includes(']('), `${page.source} has an unconverted link`);
      assert.ok(!/^#{2,4} /m.test(html), `${page.source} has an unconverted heading`);
      assert.ok(!/^\|/m.test(html), `${page.source} has an unconverted table row`);
    }
  });

  test('says it is generated, so nobody edits the copy', () => {
    assert.match(rendered, /Do not edit/);
  });
});

describe('inline markdown', () => {
  test('bold, italic and code', () => {
    assert.equal(inline('**a** and *b* and `c`'), '<strong>a</strong> and <em>b</em> and <code>c</code>');
  });

  test('links', () => {
    assert.equal(inline('[Privacy Policy](privacy.html)'), '<a href="privacy.html">Privacy Policy</a>');
  });

  test('a bare email becomes something a reviewer can tap', () => {
    assert.equal(
      inline('write to help@example.com.'),
      'write to <a href="mailto:help@example.com">help@example.com</a>.',
    );
  });

  test('a bold email is linked too', () => {
    assert.equal(
      inline('**help@example.com**'),
      '<strong><a href="mailto:help@example.com">help@example.com</a></strong>',
    );
  });

  test('text is escaped, so a document cannot inject markup', () => {
    assert.equal(inline('a <script> & "b"'), 'a &lt;script&gt; &amp; &quot;b&quot;');
  });

  test('code is left alone inside', () => {
    assert.equal(inline('`**not bold**`'), '<code>**not bold**</code>');
  });
});

describe('block markdown', () => {
  test('headings at each level the documents use', () => {
    assert.equal(blocks('## A\n\n### B\n\n#### C'), '<h2>A</h2>\n<h3>B</h3>\n<h4>C</h4>');
  });

  test('a wrapped paragraph is one paragraph', () => {
    assert.equal(blocks('one\ntwo'), '<p>one two</p>');
  });

  test('a wrapped bullet stays one bullet', () => {
    assert.equal(blocks('- one\n  more\n- two'), '<ul>\n<li>one more</li>\n<li>two</li>\n</ul>');
  });

  test('a table, with its separator row dropped', () => {
    const html = blocks('| A | B |\n| --- | --- |\n| 1 | 2 |');
    assert.match(html, /<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/);
    assert.match(html, /<tr><td>1<\/td><td>2<\/td><\/tr>/);
    assert.ok(!html.includes('---'));
  });

  test('a rule', () => {
    assert.equal(blocks('a\n\n---\n\nb'), '<p>a</p>\n<hr>\n<p>b</p>');
  });
});

describe('every document publishes', () => {
  for (const page of PAGES) {
    test(`${page.source} exists and renders`, () => {
      const rendered = renderPage(read(page.source), page);
      assert.ok(rendered.length > 2000, `${page.source} rendered to almost nothing`);
      assert.ok(!rendered.includes('Before publishing:'));
    });

    test(`${page.output} at the site root is what ${page.source} renders to`, () => {
      // The committed page is what Pages serves. If someone edits the markdown
      // and forgets \`npm run legal\`, the live policy silently says something
      // different from the one in the repo — this is the line that notices.
      const published = readFileSync(path.join(site, page.output), 'utf8');
      assert.equal(published, renderPage(read(page.source), page), `run \`npm run legal\``);
    });
  }

  test('no two pages are written to the same file', () => {
    assert.equal(new Set(PAGES.map((page) => page.output)).size, PAGES.length);
  });

  test('the old Jekyll copies are gone, so there is one policy, not two', () => {
    // Two published copies of a legal document can disagree. These were the
    // markdown pages and their layout; the HTML above replaces all three.
    for (const stale of ['privacy.md', 'support.md', path.join('_layouts', 'legal.html')]) {
      assert.throws(() => readFileSync(path.join(site, stale)), `${stale} is still in the site`);
    }
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

  test('the page chrome links relatively too', () => {
    const rendered = renderPage(read(privacy.source), privacy);
    assert.deepEqual(rendered.match(/href="\/[^"]*"/g) ?? [], []);
    assert.match(rendered, /href="privacy\.html"/);
    assert.match(rendered, /href="support\.html"/);
  });
});

describe('the app points at the pages that are actually published', () => {
  const legal = JSON.parse(readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo.extra
    .legal as Record<string, string>;

  test('each configured URL names a file this repo writes', () => {
    // Build 12 shipped linking to privacy.html and support.html, so these are
    // the names the pages have to keep for as long as that binary is in use.
    for (const [key, output] of [
      ['privacyPolicyUrl', 'privacy.html'],
      ['supportUrl', 'support.html'],
    ] as const) {
      assert.ok(PAGES.some((page) => page.output === output), `${output} is not built`);
      assert.ok(
        legal[key].endsWith(`/${output}`),
        `${key} is ${legal[key]}, which is not a page this repo publishes`,
      );
    }
  });
});

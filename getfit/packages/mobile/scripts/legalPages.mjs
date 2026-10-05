/**
 * Turning the legal documents in this repo into the pages GitHub Pages serves.
 *
 * App Review opens the privacy and support URLs from the paywall, so they have
 * to be live before the build is submitted — and they have to say what the app
 * actually does. The markdown in the repo is the source of truth; these
 * functions derive the published page from it, so the two can never drift.
 *
 * Each page is written as one self-contained HTML file: no front matter, no
 * layout, no Jekyll. The first version leaned on all three, and the pages 404'd
 * in review because the branch GitHub Pages builds from had none of them — the
 * markdown, the layout and the config each lived somewhere the site was not.
 * A standalone file has nothing to be missing. Jekyll copies a file with no
 * front matter verbatim, and Pages serves `privacy.html` at both
 * `/privacy.html` and `/privacy`, so it works whichever way the site is built
 * and whichever URL a build happened to ship with.
 */

/** The note to the repo's owner, which no visitor should ever read. */
const EDITOR_NOTE = /^> \*\*Before publishing:\*\*[\s\S]*?(?=\n\n)/m;

/**
 * Anything still in square brackets that is not a link.
 *
 * Deliberately wider than `[LEGAL ENTITY NAME]`: a note to whoever deploys the
 * app reads as ordinary prose — "[If you have an EU/UK representative, name
 * them here]" — and an all-caps rule sails straight past it onto the live
 * page. The negative lookahead spares markdown links, which are the only
 * brackets these documents legitimately contain.
 */
const PLACEHOLDER = /\[[^\]]+\](?!\()/g;

/** Every unfilled placeholder in `markdown`, deduplicated and in order. */
export function placeholders(markdown) {
  return [...new Set(markdown.match(PLACEHOLDER) ?? [])];
}

/** The document a visitor reads: no editor's note, no H1 (the page prints it). */
export function publishedMarkdown(markdown) {
  return markdown
    .replace(EDITOR_NOTE, '')
    .replace(/^# .*\n/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One line of markdown's inline syntax, as HTML.
 *
 * Only what these documents use: code, links, bold, italic, and bare email
 * addresses, which become mailto links so a reviewer can tap the support
 * address. Text is escaped first, so nothing in a document can become markup
 * it did not ask for.
 */
export function inline(text) {
  // Code spans are set aside behind a private-use character while the rest
  // is converted, so `**` inside backticks stays literal.
  const codes = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });

  html = html
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(
      /(^|[\s>(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)(?=$|[\s<).,;:])/g,
      '$1<a href="mailto:$2">$2</a>',
    );

  return html.replace(/\uE000(\d+)\uE000/g, (_, index) => codes[Number(index)]);
}

const isRule = (line) => /^(-{3,}|\*{3,})\s*$/.test(line);
const isBullet = (line) => /^[-*] /.test(line);
const isTableRow = (line) => line.startsWith('|');
const heading = (line) => /^(#{2,4}) (.*)$/.exec(line);
const cells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

/**
 * The block structure: headings, paragraphs, flat bullet lists, tables and
 * rules. Wrapped lines join their paragraph or bullet, as markdown does.
 */
export function blocks(markdown) {
  const out = [];
  const lines = markdown.split('\n');
  let paragraph = [];
  let list = null;

  const closeParagraph = () => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) out.push(`<ul>\n${list.map((item) => `<li>${inline(item)}</li>`).join('\n')}\n</ul>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();

    if (line.trim() === '') {
      closeParagraph();
      closeList();
      continue;
    }

    if (isRule(line)) {
      closeParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }

    const h = heading(line);
    if (h) {
      closeParagraph();
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    if (isTableRow(line)) {
      closeParagraph();
      closeList();
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      i -= 1;
      const [head, , ...body] = rows;
      out.push(
        '<table>\n<thead><tr>' +
          cells(head).map((cell) => `<th>${inline(cell)}</th>`).join('') +
          '</tr></thead>\n<tbody>\n' +
          body
            .map((row) => '<tr>' + cells(row).map((cell) => `<td>${inline(cell)}</td>`).join('') + '</tr>')
            .join('\n') +
          '\n</tbody>\n</table>',
      );
      continue;
    }

    if (isBullet(line)) {
      closeParagraph();
      list ??= [];
      list.push(line.replace(/^[-*] /, ''));
      continue;
    }

    // A continuation line belongs to the bullet above it, if there is one.
    if (list) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }

    paragraph.push(line.trim());
  }

  closeParagraph();
  closeList();
  return out.join('\n');
}

/*
 * Matches the app's palette, so the page a reviewer opens from the paywall
 * does not look like it belongs to somebody else. Inline rather than a
 * stylesheet for the same reason the page is standalone: one file, nothing
 * else that has to be published alongside it.
 */
const STYLE = `
      :root {
        --bg: #062a66;
        --bg-deep: #041d49;
        --card: rgba(255, 255, 255, 0.06);
        --edge: rgba(216, 241, 255, 0.22);
        --text: #eaf4ff;
        --muted: rgba(234, 244, 255, 0.76);
        --accent: #22e3f2;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0 16px 96px;
        background: linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%);
        background-attachment: fixed;
        color: var(--text);
        font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        -webkit-text-size-adjust: 100%;
      }
      main { max-width: 46rem; margin: 0 auto; }
      header { padding: 56px 0 8px; }
      header p { color: var(--muted); margin: 4px 0 0; }
      h1 { font-size: 2rem; line-height: 1.2; margin: 0; letter-spacing: -0.01em; }
      h2 {
        font-size: 1.3rem;
        margin: 2.5rem 0 0.75rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--edge);
      }
      h3 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; color: var(--accent); }
      h4 { font-size: 1rem; margin: 1.25rem 0 0.4rem; }
      a { color: var(--accent); overflow-wrap: anywhere; }
      hr { display: none; }
      strong { color: #fff; }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 1rem 0;
        display: block;
        overflow-x: auto;
      }
      th, td {
        border: 1px solid var(--edge);
        padding: 0.6rem 0.75rem;
        text-align: left;
        vertical-align: top;
      }
      th { background: var(--card); }
      code {
        background: var(--card);
        padding: 0.1em 0.35em;
        border-radius: 4px;
        font-size: 0.9em;
      }
      footer {
        margin-top: 4rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--edge);
        color: var(--muted);
        font-size: 0.9rem;
      }`;

/**
 * The published page for one document, complete.
 *
 * @param {string} markdown the source document
 * @param {{ title: string, description: string }} page
 * @returns {string}
 */
export function renderPage(markdown, page) {
  return `<!doctype html>
<!-- Generated from the markdown in getfit/ by \`npm run legal\`. Do not edit. -->
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>GetFit — ${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}">
    <style>${STYLE}
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>GetFit</h1>
        <p>${escapeHtml(page.title)}</p>
      </header>
${blocks(publishedMarkdown(markdown))}
      <footer>
        <!-- Relative, because this is a project site served under
             /github-slideshow/ — an absolute path would miss that prefix. -->
        <a href="privacy.html">Privacy Policy</a> · <a href="support.html">Support</a>
      </footer>
    </main>
  </body>
</html>
`;
}

/** The documents published, and the file each one becomes at the site root. */
export const PAGES = [
  {
    source: 'PRIVACY.md',
    output: 'privacy.html',
    title: 'Privacy Policy',
    description: 'What GetFit collects, why, and what control you have over it.',
  },
  {
    source: 'SUPPORT.md',
    output: 'support.html',
    title: 'Support',
    description: 'How to get help with GetFit, manage a membership, or delete your data.',
  },
];

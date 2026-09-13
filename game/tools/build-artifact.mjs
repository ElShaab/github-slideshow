/**
 * Builds the single-file entry page for the Artifact build of the game.
 *
 *   node tools/build-artifact.mjs [outfile]
 *
 * The artifact platform supplies <!doctype>, <html>, <head> and <body>, and
 * the page content is inserted into the BODY. A <link rel="stylesheet"> placed
 * there is not applied, which strips the game of every layout rule -- ".hidden"
 * stops hiding, the layers stop being positioned, and all five screens stack up
 * as one long unstyled document. So the stylesheet is inlined into a <style>
 * block instead, which is what the platform documents.
 *
 * Module scripts are left as-is: those are published as supporting files and
 * load normally.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dist', 'artifact.html');

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');

const body = html.match(/<body>([\s\S]*)<\/body>/);
if (!body) throw new Error('index.html has no <body>');

const title = (html.match(/<title>([^<]*)<\/title>/) || [, 'Squad Rush'])[1];

const page = `<title>${title}</title>
<style>
/* Inlined from styles/main.css by tools/build-artifact.mjs -- an external
   stylesheet link does not apply from inside the artifact body. */
${css.trim()}

/* The artifact shell paints its own ground behind the page and sets a body
   font; the game is a full-bleed canvas, so claim the whole viewport back. */
html, body { height: 100%; margin: 0; overflow: hidden; background: var(--ink); }
</style>
${body[1].replace(/\n\s*<link rel="stylesheet"[^>]*>/g, '').trim()}
`;

writeFileSync(out, page);
console.log(`${out}  (${(page.length / 1024).toFixed(1)}kB, css inlined: ${css.length} bytes)`);

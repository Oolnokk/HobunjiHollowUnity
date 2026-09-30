// Guards the cache-bust discipline this static site depends on.
//
// docs/ is served straight to browsers, and every script is loaded with a
// ?v=<token> query string so a changed file reaches returning players. Nothing
// enforced that the token actually moved when the file did, so a change could
// ship a fresh game.js against ~20 cached modules. This walks the real diff and
// fails when a changed module's referencing URL kept its old token.
//
// Usage:
//   node scripts/check-cache-busts.js [baseRef]         report stale tokens (default base: origin/main)
//   node scripts/check-cache-busts.js --fix [baseRef]   bump every stale token for you
//
// Compares the working tree against baseRef, so it is useful before committing.
//
// --fix rewrites each stale `<file>?v=<old>` reference (in docs/, and in
// scripts/test-*.js where a test pins that same shipped token, so it keeps
// passing; placeholder tokens in test fixtures are left untouched) to a fresh
// token, then repeats: a loader whose references were just rewritten has
// itself changed, so its own references get bumped on the next pass, all the
// way up to index.html. Run it once after editing, instead of hand-bumping.
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const baseRef = args.find(arg => !arg.startsWith('--')) || 'origin/main';

// Modules reachable only from the docs/tools/ editor pages, never from
// docs/index.html — a stale token there cannot affect a player, and their
// loader chain lives entirely inside the editor tooling.
const EDITOR_ONLY = new Set([
  'interior-environment-runtime.js',
  'interior-fire-void-runtime.js',
]);

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(js|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `foo.js?v=…` but not `other-foo.js?v=…`.
function refPattern(base) {
  return new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(base)}\\?v=([A-Za-z0-9_-]+)`, 'g');
}

function findStale() {
  const changed = git('diff', '--name-only', baseRef, '--', 'docs')
    .split('\n')
    .filter(name => name.endsWith('.js'));

  // Every line ADDED by this diff. A reference whose token moved shows up here.
  const addedBlob = git('diff', baseRef, '--', 'docs', 'scripts')
    .split('\n')
    .filter(line => line.startsWith('+'))
    .map(line => line.slice(1))
    .join('\n');

  const sources = listFiles('docs').map(file => ({ file, text: fs.readFileSync(file, 'utf8') }));

  const stale = [];
  const unversioned = [];
  for (const changedFile of changed) {
    const base = path.basename(changedFile);
    if (EDITOR_ONLY.has(base)) continue;
    const pattern = refPattern(base);

    const refs = [];
    for (const { file, text } of sources) {
      for (const match of text.matchAll(pattern)) refs.push({ file, url: match[0], token: match[1] });
    }

    if (!refs.length) { unversioned.push(changedFile); continue; }
    // The reference is fresh if any of its versioned URLs appears on an added line.
    if (!refs.some(ref => addedBlob.includes(ref.url))) stale.push({ changedFile, refs });
  }
  return { changed, stale, unversioned };
}

function freshToken(file) {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 7);
  return `${date}h${hash}`;
}

function bump(stale) {
  const docsFiles = listFiles('docs');
  const testFiles = fs.readdirSync('scripts').filter(name => /^test-.*\.js$/.test(name)).map(name => path.join('scripts', name));
  for (const { changedFile, refs } of stale) {
    const base = path.basename(changedFile);
    const token = freshToken(changedFile);
    const pattern = refPattern(base);
    // Tests are only rewritten where they pin a token docs/ actually ships, so
    // fixture URLs with placeholder tokens (e.g. `?v=test`) are left alone.
    const shippedTokens = new Set(refs.map(ref => ref.token));
    for (const file of docsFiles.concat(testFiles)) {
      const isTest = !file.startsWith('docs' + path.sep);
      const text = fs.readFileSync(file, 'utf8');
      const next = text.replace(pattern, (match, oldToken) =>
        isTest && !shippedTokens.has(oldToken) ? match : `${base}?v=${token}`);
      if (next !== text) fs.writeFileSync(file, next);
    }
    console.log(`  bumped ${changedFile} -> ?v=${token}`);
  }
}

let result = findStale();
if (fix) {
  // Each pass can dirty loaders that were clean before; stop once nothing is stale.
  for (let pass = 0; result.stale.length && pass < 20; pass++) {
    bump(result.stale);
    result = findStale();
  }
}

const { changed, stale, unversioned } = result;

if (!changed.length) {
  console.log('No changed docs/ scripts to check.');
  process.exit(0);
}

if (unversioned.length) {
  console.log(`\nNote: ${unversioned.length} changed file(s) have no versioned reference (loaded another way):`);
  for (const file of unversioned) console.log(`  ${file}`);
}

if (stale.length) {
  console.error(`\nFAIL: ${stale.length} changed module(s) kept a stale cache-bust token.`);
  console.error('Returning players will run the cached old copy of these files.\n');
  for (const { changedFile, refs } of stale) {
    console.error(`  ${changedFile}`);
    for (const ref of new Set(refs.map(r => `${r.file} -> ${r.url}`))) console.error(`      ${ref}`);
  }
  console.error('\nRun `node scripts/check-cache-busts.js --fix` to bump them (and every loader');
  console.error('up the chain) automatically, then commit the result.\n');
  process.exit(1);
}

console.log(`\nOK: all ${changed.length - unversioned.length} changed docs/ module(s) carry a bumped cache-bust token.`);

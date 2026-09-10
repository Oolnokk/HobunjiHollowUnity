// Guards the cache-bust discipline this static site depends on.
//
// docs/ is served straight to browsers, and every script is loaded with a
// ?v=<token> query string so a changed file reaches returning players. Nothing
// enforced that the token actually moved when the file did, so a change could
// ship a fresh game.js against ~20 cached modules. This walks the real diff and
// fails when a changed module's referencing URL kept its old token.
//
// Usage: node scripts/check-cache-busts.js [baseRef]   (default: origin/main)
// Compares the working tree against baseRef, so it is useful before committing.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const baseRef = process.argv[2] || 'origin/main';

// Modules reachable only from the docs/tools/ editor pages, never from
// docs/index.html — a stale token there cannot affect a player, and their
// loader chain lives entirely inside the editor tooling.
const EDITOR_ONLY = new Set([
  'interior-environment-runtime.js',
  'interior-fire-void-runtime.js',
]);

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(js|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const changed = git('diff', '--name-only', baseRef, '--', 'docs')
  .split('\n')
  .filter(name => name.endsWith('.js'));

if (!changed.length) {
  console.log('No changed docs/ scripts to check.');
  process.exit(0);
}

// Every line ADDED by this diff. A reference whose token moved shows up here.
const addedLines = new Set(
  git('diff', baseRef, '--', 'docs', 'scripts')
    .split('\n')
    .filter(line => line.startsWith('+'))
    .map(line => line.slice(1))
);
const addedBlob = [...addedLines].join('\n');

const sources = listFiles('docs').map(file => ({ file, text: fs.readFileSync(file, 'utf8') }));

const stale = [];
const unversioned = [];

for (const changedFile of changed) {
  const base = path.basename(changedFile);
  if (EDITOR_ONLY.has(base)) continue;
  const pattern = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=([A-Za-z0-9_-]+)`, 'g');

  const refs = [];
  for (const { file, text } of sources) {
    for (const match of text.matchAll(pattern)) refs.push({ file, url: match[0] });
  }

  if (!refs.length) { unversioned.push(changedFile); continue; }
  // The reference is fresh if any of its versioned URLs appears on an added line.
  if (!refs.some(ref => addedBlob.includes(ref.url))) {
    stale.push({ changedFile, refs: [...new Set(refs.map(r => `${r.file} -> ${r.url}`))] });
  }
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
    for (const ref of refs) console.error(`      ${ref}`);
  }
  console.error('\nBump the ?v= token at each reference above. If a loader module itself');
  console.error('changed, its own token must be bumped too, or the new URLs never load.\n');
  process.exit(1);
}

console.log(`\nOK: all ${changed.length - unversioned.length} changed docs/ module(s) carry a bumped cache-bust token.`);

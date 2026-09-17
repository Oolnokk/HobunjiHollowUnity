#!/usr/bin/env node
'use strict';

// Stage 0 of the RAF-ownership migration described in
// docs/architecture/runtime-frame-scheduler.md: every direct
// `requestAnimationFrame(` call site in the shipped runtime dependency graph
// (docs/index.html plus everything it loads, transitively) must carry an
// explicit ownership classification in scripts/runtime-frame-ownership-exceptions.json.
// This does not ban requestAnimationFrame — it bans an UNCLASSIFIED one, so a
// small-context model or reviewer can answer "is this RAF intentional?" by
// reading one manifest entry instead of reconstructing history across the repo.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const MANIFEST_PATH = path.join(REPO_ROOT, 'scripts', 'runtime-frame-ownership-exceptions.json');

const ALLOWED_CLASSIFICATIONS = new Set([
  'scheduler', // Permanent browser-frame runtime -> RuntimeFrameScheduler candidate.
  'game-loop', // Actual gameplay simulation owned by gameLoop itself.
  'render-hook', // Final transform depends on Three.js render traversal/order (onBeforeRender territory).
  'timer-event', // Work genuinely does not need every frame; a setInterval/event candidate.
  'one-shot', // A single next-paint deferral, not a self-perpetuating loop.
  'bounded-animation', // Starts for a specific effect and stops itself; never runs forever.
  'isolated-context', // Belongs to an independent preview/editor/title-screen renderer.
  'temporary-order-exception', // A documented, deliberately-kept exception awaiting scheduler phase support.
]);
const REQUIRED_FIELDS = ['file', 'owner', 'classification', 'function', 'reason', 'migrationStage'];

// --- Shipped runtime dependency graph -------------------------------------
// Crawls from docs/index.html the same way a browser would: static
// `<script src>` tags, plus the repo's own dynamic-loading idioms
// (`document.write('<script src="...">')`, `script.src = '...'`,
// `new URL('foo.js?v=...', base)`). All of those idioms embed the target
// filename as a literal quoted `.js` string, almost always followed by the
// repo's `?v=` cache-busting query -- but not always (some helper-script
// arrays omit it), so both forms are matched. Breadcrumb comments such as
// "// now lives in js/foo.js" are never inside quotes, so they never match.
const JS_STRING_RE = /['"`]([A-Za-z0-9_.\/-]*\.js)(?:\?[^'"`]*)?['"`]/g;

function resolveJsRef(rawRef, fromDir) {
  const clean = rawRef.split('?')[0];
  const resolved = clean.startsWith('js/') || clean.startsWith('/js/')
    ? path.join(DOCS_DIR, clean.replace(/^\//, ''))
    : path.join(fromDir, clean);
  const normalized = path.normalize(resolved);
  return normalized.startsWith(DOCS_DIR) ? normalized : null;
}

function crawlShippedScripts() {
  const visited = new Set();
  const queue = [];

  const indexHtml = fs.readFileSync(path.join(DOCS_DIR, 'index.html'), 'utf8');
  const seedRe = /<script[^>]+src=["']([A-Za-z0-9_.\/-]*\.js)(?:\?[^'"]*)?["']/g;
  let match;
  while ((match = seedRe.exec(indexHtml))) {
    const resolved = resolveJsRef(match[1], DOCS_DIR);
    if (resolved) queue.push(resolved);
  }
  queue.push(path.join(DOCS_DIR, 'game.js')); // The shipped page's own inline-equivalent bootstrap.

  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const fromDir = path.dirname(file);
    const refs = new Set();
    let m;
    JS_STRING_RE.lastIndex = 0;
    while ((m = JS_STRING_RE.exec(src))) refs.add(m[1]);
    for (const ref of refs) {
      const resolved = resolveJsRef(ref, fromDir);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return Array.from(visited).filter(f => f.endsWith('.js') && fs.existsSync(f));
}

// --- Direct requestAnimationFrame call-site detection ----------------------
// Strips block comments (keeping newlines so line numbers stay accurate) and
// truncates each line at a line-comment `//` marker (guarded against
// `://` inside URLs) before searching, so a commented-out call or a
// breadcrumb mentioning the API by name is never mistaken for a live call.
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '));
}

const RAF_CALL_RE = /requestAnimationFrame\s*(?:\?\.)?\s*\(/; // Matches both a direct call and the `requestAnimationFrame?.(` optional-chaining form used by a few modules guarding against a missing global.

function findRafLines(absPath) {
  const src = stripBlockComments(fs.readFileSync(absPath, 'utf8'));
  const lines = src.split('\n');
  const hits = [];
  lines.forEach((line, index) => {
    let codePart = line;
    const commentAt = line.search(/(?<!:)\/\//);
    if (commentAt >= 0) codePart = line.slice(0, commentAt);
    if (RAF_CALL_RE.test(codePart)) hits.push(index + 1);
  });
  return hits;
}

// --- Manifest -----------------------------------------------------------
function loadManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  assert(Array.isArray(parsed), 'runtime-frame-ownership-exceptions.json must be a JSON array');
  return parsed;
}

function auditOwnership() {
  const manifest = loadManifest();
  const problems = [];

  for (const entry of manifest) {
    for (const field of REQUIRED_FIELDS) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        problems.push(`manifest entry missing required field "${field}": ${JSON.stringify(entry)}`);
      }
    }
    if (entry.classification && !ALLOWED_CLASSIFICATIONS.has(entry.classification)) {
      problems.push(`manifest entry has unknown classification "${entry.classification}" (${entry.file})`);
    }
  }
  if (problems.length) return { ok: false, problems, reachable: [], manifest }; // Malformed entries make further cross-checks meaningless.

  const seen = new Set();
  for (const entry of manifest) {
    const key = `${entry.file}::${entry.function}::${entry.line ?? ''}`;
    if (seen.has(key)) problems.push(`duplicate manifest entry: ${key}`);
    seen.add(key);
  }

  const manifestByFile = new Map();
  for (const entry of manifest) {
    const abs = path.join(REPO_ROOT, entry.file);
    if (!manifestByFile.has(abs)) manifestByFile.set(abs, []);
    manifestByFile.get(abs).push(entry);
  }

  for (const [abs, entries] of manifestByFile) {
    if (!fs.existsSync(abs)) {
      problems.push(`manifest references a file that no longer exists: ${entries[0].file}`);
      continue;
    }
    const rafLines = findRafLines(abs);
    if (!rafLines.length) {
      problems.push(`manifest classifies ${entries[0].file} but it no longer contains a direct requestAnimationFrame( call — stale entry`);
    }
  }

  const reachable = crawlShippedScripts();
  const reachableSet = new Set(reachable);
  const schedulerOwnFile = path.join(DOCS_DIR, 'js', 'runtime-frame-scheduler.js'); // The shared owner itself, not a subscriber.

  const unclassified = [];
  for (const abs of reachable) {
    if (abs === schedulerOwnFile) continue;
    const rafLines = findRafLines(abs);
    if (!rafLines.length) continue;
    if (!manifestByFile.has(abs)) {
      unclassified.push({ file: path.relative(REPO_ROOT, abs), lines: rafLines });
    }
  }
  for (const item of unclassified) {
    problems.push(`unclassified direct requestAnimationFrame( in shipped code: ${item.file} (line${item.lines.length > 1 ? 's' : ''} ${item.lines.join(', ')}) — add an entry to scripts/runtime-frame-ownership-exceptions.json`);
  }

  // Manifest entries for files that are no longer reachable from docs/index.html
  // are also stale (e.g. the file became an editor-only tool, or was deleted
  // from the shipped load path) and should be removed so the manifest keeps
  // matching reality.
  for (const [abs, entries] of manifestByFile) {
    if (fs.existsSync(abs) && !reachableSet.has(abs) && abs !== schedulerOwnFile) {
      problems.push(`manifest classifies ${entries[0].file} but it is no longer reachable from docs/index.html — stale entry`);
    }
  }

  const exceptionOnly = manifest.filter(entry => entry.classification === 'temporary-order-exception');

  return {
    ok: problems.length === 0,
    problems,
    reachable,
    manifest,
    summary: {
      reachableFileCount: reachable.length,
      classifiedRafOwners: manifest.length,
      temporaryOrderExceptions: exceptionOnly.map(entry => entry.file),
    },
  };
}

module.exports = { auditOwnership, findRafLines, crawlShippedScripts, ALLOWED_CLASSIFICATIONS };

if (require.main === module) {
  // Regression: the manifest's declared classifications must exactly cover
  // every direct RAF in the real, current shipped dependency graph.
  const result = auditOwnership();
  if (!result.ok) {
    console.error('Runtime frame ownership audit failed:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  assert(result.summary.reachableFileCount > 50, 'shipped dependency crawl should reach the great majority of docs/js (sanity floor against a broken crawl)');
  assert(result.summary.classifiedRafOwners > 0, 'the manifest should not be empty while the game still has scheduler/game-loop RAF work');
  assert(
    result.manifest.some(entry => entry.file === 'docs/game.js' && entry.classification === 'game-loop'),
    'gameLoop\'s own self-scheduling RAF must be classified as the game-loop owner',
  );
  assert.equal(
    result.summary.temporaryOrderExceptions.length,
    1,
    'exactly one documented temporary-order-exception is expected right now (Quick Attack); a second one needs its own justification, not silent growth',
  );
  assert.equal(
    result.summary.temporaryOrderExceptions[0],
    'docs/js/combat/quick-attack-bonus-indicator.js',
    'the sole temporary-order-exception should remain the one documented in docs/architecture/runtime-frame-scheduler.md',
  );

  // --- Fixture regression: prove the detector actually catches an unclassified RAF ---
  // Runs against a throwaway temp file so this proves the mechanism works
  // without depending on (or risking corrupting) real repository state.
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-ownership-fixture-'));
  try {
    const fixtureFile = path.join(tmpDir, 'fixture.js');
    fs.writeFileSync(fixtureFile, [
      '(() => {',
      '  // requestAnimationFrame( mentioned only in a comment must not count',
      '  function tick() {',
      '    requestAnimationFrame(tick); // a real, live call site',
      '  }',
      '  tick();',
      '})();',
      '',
    ].join('\n'));
    const hits = findRafLines(fixtureFile);
    assert.deepEqual(hits, [4], 'detector finds the real call site and ignores the commented-out mention');

    const fixtureNoRaf = path.join(tmpDir, 'fixture-clean.js');
    fs.writeFileSync(fixtureNoRaf, '(() => { /* requestAnimationFrame( only inside a block comment */ })();\n');
    assert.deepEqual(findRafLines(fixtureNoRaf), [], 'detector ignores a mention that only exists inside a block comment');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(
    `runtime frame ownership audit passed: ${result.summary.reachableFileCount} shipped scripts scanned, ` +
    `${result.summary.classifiedRafOwners} direct RAF owners classified, ` +
    `${result.summary.temporaryOrderExceptions.length} temporary-order-exception on file.`,
  );
}

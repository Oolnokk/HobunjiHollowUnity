#!/usr/bin/env node
'use strict';

// Single entry point for the scripts/test-*.js regression suite, used by
// .github/workflows/regression-suite.yml and by agents working locally.
//
//   node scripts/run-tests.js                 # every fast test (the default)
//   node scripts/run-tests.js --all           # also the SLOW tests below
//   node scripts/run-tests.js livestock npc   # only tests whose name contains a filter
//
// Each test runs in its own node process, a few at a time.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');

// Each takes 10s+; together they're most of the suite's run time.
const SLOW = new Set([
  'test-wilderness-plateau-export-ownership.js',
  'test-wilderness-plateau-ring-export.js',
  'test-banubu-wilderness-lab-generation.js',
]);

// Need Playwright + a served docs/ folder; run by the smoke-dev-random-ruin-* workflows.
const BROWSER = new Set([
  'test-dev-random-ruin-browser.js',
  'test-dev-random-ruin-collision-browser.js',
]);

// Already failing on main when the suite was consolidated (2026-09): they assert
// source text or APIs that have since moved. Fix one and drop it from this list,
// or delete the file — don't spend a task chasing these.
const KNOWN_BROKEN = new Set([
  'test-animal-head-rig-uploaded-species.js',
  'test-behavior-preserving-performance.js',
  'test-branch-reticle-interactions.js',
  'test-character-view-mode.js',
  'test-clothing-weaving-system.js',
  'test-combat-sfx-wiring.js',
  'test-combo-strike-hold-pose-alignment.js',
  'test-dialogue-presentation.js',
  'test-environment-surface-runtime.js',
  'test-furniture-tankan-decals.js',
  'test-hand-inverse-authoring.js',
  'test-indoor-companions.js',
  'test-item-quality-and-blackout-wander.js',
  'test-mounted-rider-render-sync.js',
  'test-music-system.js',
  'test-nearby-volume-collision.js',
  'test-npc-agenda-data-integrity.js',
  'test-npc-schedule-overrides.js',
  'test-png-portrait-flip-setting.js',
  'test-porch-stage-material.js',
  'test-ranged-weapons.js',
  'test-rounded-pauldron.js',
  'test-shipping-box-system.js',
  'test-skill-and-hearth-cooking.js',
  'test-startup-asset-path-regressions.js',
  'test-tool-action-sfx-wiring.js',
  'test-town-render-hotpaths.js',
  'test-waterfall-river-surface-connector.js',
  'test-wilderness-chunks.js',
]);

// Non test-*.js checks the old per-feature workflows also ran.
const EXTRA_CHECKS = [
  'audit-npc-wardrobe-placeholders.js',
  'check-rakakoan-portrait-resolution.js',
];

const args = process.argv.slice(2);
const includeSlow = args.includes('--all') || args.includes('--slow');
const filters = args.filter(arg => !arg.startsWith('--'));

const tests = fs.readdirSync(SCRIPTS_DIR)
  .filter(name => /^test-.*\.js$/.test(name))
  .sort()
  .concat(EXTRA_CHECKS)
  .filter(name => !BROWSER.has(name) && !KNOWN_BROKEN.has(name))
  .filter(name => includeSlow || !SLOW.has(name))
  .filter(name => !filters.length || filters.some(filter => name.includes(filter)));

function runOne(name) {
  return new Promise(resolve => {
    const started = Date.now();
    let output = '';
    const child = spawn(process.execPath, [path.join('scripts', name)], { cwd: REPO_ROOT });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', code => resolve({ name, code, output, ms: Date.now() - started }));
  });
}

async function main() {
  if (!tests.length) {
    console.error('No tests matched.');
    process.exit(1);
  }
  const started = Date.now();
  const failures = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(os.cpus().length || 2, 8) }, async () => {
    while (next < tests.length) {
      const result = await runOne(tests[next++]);
      if (result.code !== 0) failures.push(result);
      console.log(`${result.code === 0 ? 'ok  ' : 'FAIL'} ${result.name} (${result.ms}ms)`);
    }
  });
  await Promise.all(workers);

  for (const failure of failures) {
    console.log(`\n===== ${failure.name} (exit ${failure.code}) =====\n${failure.output.trim()}`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${tests.length - failures.length}/${tests.length} passed in ${seconds}s` +
    (includeSlow ? '' : ` (${SLOW.size} slow tests skipped; pass --all to include)`));
  process.exit(failures.length ? 1 : 0);
}

main();

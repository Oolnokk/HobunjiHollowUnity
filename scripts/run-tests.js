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
  'test-cloud-forest-trade-exit.js',
]);

// Need Playwright; run by their dedicated browser workflow steps.
const BROWSER = new Set([
  'test-dev-random-ruin-browser.js',
  'test-dev-random-ruin-collision-browser.js',
  'test-controller-ui-modal-pin.js',
  'test-farmwork-controller-browser.js', // Real-browser Farmwork controller and stepper test.
  'test-controller-mastery-inventory-browser.js', // Runs in the existing Chromium workflow step.
  'test-interior-editor-exit-browser.js', // Runs after Chromium installation in regression-suite.yml.
  'test-root-mechanism-runtime-browser.js', // Actual V50/root growth and gameplay collision browser regression.
  'test-stone-age-multiroom-browser.js', // Real THREE stone/UV floor, V50 cell masking and native layer preservation.
  'test-surface-foliage-styles-browser.js', // Real THREE and shared editor growth-style browser smoke.
  'test-omgurku-gameplay-browser.js', // Full game NPC spawn/transfer/despawn coverage.
  'test-omgurku-calibration-browser.js', // Runs in the existing browser workflow step.
  'test-omgurku-tribe-browser.js', // Full game Omgurku-vs-Porakaneki hostile fight and camp placement.
]);

// Tests that fail on main and are skipped until fixed. Keep this empty: a
// test that asserts moved/retired code should be updated or deleted, not
// parked here. (The 2026-09 backlog was cleared in 2026-10.)
const KNOWN_BROKEN = new Set([]);

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

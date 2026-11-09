'use strict';
// The idle stances are fetched from weapon-idle-stances.json after the game
// starts; until that fetch lands, the built-in fallbacks are what renders. If
// the fallbacks drift from the JSON, a freshly authored stance visibly pops
// from the old pose to the new one on load. Execute both modules and compare.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const config = JSON.parse(fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8'));

function run(files, extra = {}) {
  const window = { ...extra };
  const context = vm.createContext({ window, console, Math, Number, Object, JSON, Array, Map, Set, Symbol, Error });
  for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return window;
}

const close = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
function assertPoseMatches(actual, expected, label) {
  assert.ok(actual, `${label} has a built-in fallback`);
  for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']) {
    assert.ok(close(actual[key], expected[key] ?? 0), `${label}.${key}: fallback ${actual[key]} != config ${expected[key]}`);
  }
}

const runtime = run(['docs/js/combat/shared-attack-pose.js', 'docs/js/weapon-tool-stances.js']);
const poses = runtime.WeaponToolStances.poses;
for (const [key, pose] of Object.entries(config.stances)) assertPoseMatches(poses[key], pose, `WeaponToolStances.poses.${key}`);
assert.deepEqual(Object.keys(poses).sort(), Object.keys(config.stances).sort(), 'runtime and config cover the same stances');

const editorSource = fs.readFileSync('docs/js/attack-idle-stance-editor.js', 'utf8');
const fallbackMatch = editorSource.match(/const FALLBACK_CONFIG = (Object\.freeze\(\{[\s\S]*?\n  \}\));/);
assert.ok(fallbackMatch, 'idle stance editor still declares FALLBACK_CONFIG');
const editorFallback = vm.runInNewContext(`(${fallbackMatch[1]})`, { Object });
for (const [key, pose] of Object.entries(config.stances)) assertPoseMatches(editorFallback.stances[key], pose, `editor FALLBACK_CONFIG.${key}`);

console.log('weapon idle stance fallbacks match committed config');

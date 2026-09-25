#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const melee = fs.readFileSync('docs/js/combat/melee-hud-reticle.js', 'utf8'); // Used to verify melee sight suppression and visibility wiring.
const ranged = fs.readFileSync('docs/js/combat/ranged-hud-reticle.js', 'utf8'); // Used to verify ranged sight suppression and visibility wiring.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Used to verify both changed HUD modules are cache-invalidated.
const inputSettings = fs.readFileSync('docs/js/input-settings-panel.js', 'utf8'); // Used to ensure Settings cannot reload a stale unversioned ranged reticle over the parser-loaded module.

for (const [label, source] of [['melee', melee], ['ranged', ranged]]) {
  const predicate = source.match(/function gameplayReticleSuppressed\(\) \{[\s\S]*?\n  \}/)?.[0] || ''; // Checked term-by-term so declaration order inside the predicate does not matter.
  assert.ok(predicate, `${label} reticle must define gameplayReticleSuppressed()`);
  for (const [pattern, what] of [
    [/isDialogueOpen\?\.\(\)/, 'authoritative dialogue-open state'],
    [/getElementById\('npcDialogue'\)[\s\S]*classList\.contains\('open'\)/, 'visible dialogue fallback'],
    [/HOBUNJI_CHARACTER_VIEW_STATUS\?\.enabled/, 'Character View'],
    [/sitInteraction\.phase !== 'out'/, 'seated state'],
  ]) {
    assert.match(predicate, pattern, `${label} reticle must suppress itself for ${what}`);
  }
}

assert.match(
  melee,
  /const visible = !!root && meleeWeaponDrawn\(\) && !gameplayReticleSuppressed\(\);/,
  'melee reticle visibility must honor the shared suppression predicate',
);
assert.match(
  ranged,
  /const visible = rangedWeaponDrawn\(\) && !gameplayReticleSuppressed\(\);/,
  'ranged reticle visibility must honor the shared suppression predicate',
);
assert.match(index, /ranged-hud-reticle\.js\?v=20260925dialogue3/, 'ranged reticle change must be cache-invalidated');
assert.match(index, /melee-hud-reticle\.js\?v=20260925dialogue3/, 'melee reticle change must be cache-invalidated');
assert.doesNotMatch(
  inputSettings,
  /RUNTIME_HELPER_SCRIPTS[\s\S]{0,800}['"]js\/combat\/ranged-hud-reticle\.js['"]/,
  'Settings must not dynamically reload ranged-hud-reticle.js from an unversioned URL',
);

console.log('Combat reticle visibility checks passed.');

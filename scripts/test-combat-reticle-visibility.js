#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const melee = fs.readFileSync('docs/js/combat/melee-hud-reticle.js', 'utf8'); // Used to verify melee sight suppression and visibility wiring.
const ranged = fs.readFileSync('docs/js/combat/ranged-hud-reticle.js', 'utf8'); // Used to verify ranged sight suppression and visibility wiring.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Used to verify both changed HUD modules are cache-invalidated.

for (const [label, source] of [['melee', melee], ['ranged', ranged]]) {
  assert.match(
    source,
    /function gameplayReticleSuppressed\(\) \{[\s\S]{0,700}isDialogueOpen\?\.\(\)[\s\S]{0,700}HOBUNJI_CHARACTER_VIEW_STATUS\?\.enabled[\s\S]{0,700}sitInteraction\.phase !== 'out'/,
    `${label} reticle must suppress itself during dialogue, Character View, and seated states`,
  );
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
assert.match(index, /ranged-hud-reticle\.js\?v=20260924visibility1/, 'ranged reticle change must be cache-invalidated');
assert.match(index, /melee-hud-reticle\.js\?v=20260924visibility1/, 'melee reticle change must be cache-invalidated');

console.log('Combat reticle visibility checks passed.');

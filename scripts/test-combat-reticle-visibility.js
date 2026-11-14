#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const melee = fs.readFileSync('docs/js/combat/melee-hud-reticle.js', 'utf8'); // Used to verify melee sight suppression and visibility wiring.
const ranged = fs.readFileSync('docs/js/combat/ranged-hud-reticle.js', 'utf8'); // Used to verify ranged sight suppression and visibility wiring.
const index = require('./classic-script-group-index.js').expandClassicScriptGroups(); // Used to verify both changed HUD modules are cache-invalidated.
const inputSettings = fs.readFileSync('docs/js/input-settings-panel.js', 'utf8'); // Used to ensure Settings cannot reload a stale unversioned ranged reticle over the parser-loaded module.

for (const [label, source] of [['melee', melee], ['ranged', ranged]]) {
  const predicate = source.match(/function gameplayReticleSuppressed\(\) \{[\s\S]*?\n  \}/)?.[0] || ''; // Checked term-by-term so declaration order inside the predicate does not matter.
  assert.ok(predicate, `${label} reticle must define gameplayReticleSuppressed()`);
  const context={window:{AuthoredCutsceneRuntime:{isActive:()=>true}},document:{getElementById:()=>null}};
  vm.runInNewContext(predicate+'\nsuppressed=gameplayReticleSuppressed;',context);
  assert.equal(context.suppressed(),true,`${label} cutscene action cards suppress the reticle without dialogue`);
  context.window.AuthoredCutsceneRuntime.isActive=()=>false;
  context.document.getElementById=id=>id==='introductionLoadingScreen'?{}:null;
  assert.equal(context.suppressed(),true,`${label} introduction loading suppresses the reticle`);
  context.document.getElementById=()=>null;
  assert.equal(context.suppressed(),false,`${label} cleanup restores ordinary visibility`);
  context.window.MusicMinigame={state:{active:true,instrumentMode:'puzzle'}}; // Music overlay's real state getter is authoritative, even if an instrument is still drawn.
  assert.equal(context.suppressed(),true,`${label} reticle hides during the instrument's puzzle mode`);
  context.window.MusicMinigame.state={active:true,instrumentMode:'performance'};
  assert.equal(context.suppressed(),true,`${label} reticle stays hidden when switching to performance mode`);
  context.window.MusicMinigame={state:null,ambientActive:true};
  assert.equal(context.suppressed(),false,`${label} ambient NPC performances do not hide the player's combat reticle`);
  context.window.MusicMinigame.state={active:false};
  assert.equal(context.suppressed(),false,`${label} inactive music sessions restore the reticle`);
  let plateActive=true; // Test the separate timed-score ownership before the instrument interface opens.
  context.window.Combat={deps:{getCurrentArea:()=> 'puzzle-cave'}};
  context.window.MelodyCameraFraming={isPlateActive:area=>area==='puzzle-cave'&&plateActive};
  assert.equal(context.suppressed(),true,`${label} reticle hides on a timed melody plate before opening the instrument`);
  plateActive=false;
  assert.equal(context.suppressed(),false,`${label} reticle returns after stepping off the plate`);
  plateActive=true;
  context.window.Combat.deps.getCurrentArea=()=> 'farm';
  assert.equal(context.suppressed(),false,`${label} other-area melodies do not suppress the reticle`);

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
assert.match(index, /ranged-hud-reticle\.js\?v=[A-Za-z0-9_-]+/, 'ranged reticle change must be cache-invalidated');
assert.match(index, /melee-hud-reticle\.js\?v=[A-Za-z0-9_-]+/, 'melee reticle change must be cache-invalidated');
assert.doesNotMatch(
  inputSettings,
  /RUNTIME_HELPER_SCRIPTS[\s\S]{0,800}['"]js\/combat\/ranged-hud-reticle\.js['"]/,
  'Settings must not dynamically reload ranged-hud-reticle.js from an unversioned URL',
);

console.log('Combat reticle visibility checks passed.');

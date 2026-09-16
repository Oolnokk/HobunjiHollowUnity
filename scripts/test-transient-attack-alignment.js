'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const game = read('docs/game.js');
const core = read('docs/js/combat/combat-core.js');
const loader = read('docs/js/combat/combat-config-loader.js');
const input = read('docs/js/combat/combat-input.js');
const bandit = read('docs/js/combat/combat-bandit.js');
const indicator = read('docs/js/combat/quick-attack-bonus-indicator.js');
const html = read('docs/index.html');
const style = read('docs/style.css');
const bindings = read('docs/js/input-bindings.js');
const config = read('docs/config/scratchbones-config.js');
const attackValues = read('docs/config/combat/attack-values.json'); // Authored targeting policy validated separately from input configuration.

for (const path of [
  'docs/game.js',
  'docs/js/combat/combat-core.js',
  'docs/js/combat/combat-input.js',
  'docs/js/combat/combat-bandit.js',
  'docs/js/combat/quick-attack-bonus-indicator.js',
  'docs/js/input-bindings.js',
  'docs/js/arch-button-labels.js',
  'docs/js/action-arch-icons.js',
]) {
  new vm.Script(read(path), { filename: path });
}

assert.match(attackValues, /"attackAlignmentHalfConeDeg": 45/, 'shared attack/sight cone is configurable and defaults to ±45 degrees');
assert.match(attackValues, /"postAttackTurnMinMultiplier": 0\.06/, 'post-attack minimum turn speed is configurable');
assert.match(attackValues, /"playerAlignmentMinS": 0\.11[\s\S]*"playerAlignmentMaxS": 0\.22/, 'player alignment glide range is authored in combat config');
assert.match(core, /function applyTargetingConfig\(/, 'combat core owns targeting configuration');
assert.match(loader, /applyTargetingConfig\?\.\(config\.targeting\)/, 'combat config loader applies authored targeting policy');
assert.match(core, /function attackAlignmentStep\(/, 'shared alignment helper exists');
assert.match(core, /function postAttackTurnMultiplier\(/, 'shared recovery ramp exists');

assert.match(input, /runAfterAttackAlignment\(\(\) =>/, 'tap attacks wait for transient alignment when auto-target is enabled');
assert.match(input, /ability\?\.category === 'offensiveHold'/, 'offensive holds align before their windup when auto-target is enabled');
assert.match(input, /releaseQueued/, 'release input survives an alignment that spans multiple frames');
assert.match(input, /const startAttackOnce = \(\) =>/, 'windup startup is idempotent across deferred alignment release');
assert.match(input, /startAttackOnce\(\);[\s\S]{0,260}requestAnimationFrame\(\(\) => \{[\s\S]{0,360}finishAlignment\(\)/, 'windup starts before transient alignment releases on the next frame');
assert.match(input, /const AUTO_TARGET_STORAGE_KEY = 'hobunjiMeleeAutoTargetEnabled'/, 'combat input owns one persisted auto-target preference');
assert.match(input, /let autoTargetEnabled = false;/, 'auto-target is disabled by default when no preference exists');
assert.match(input, /localStorage\.getItem\(AUTO_TARGET_STORAGE_KEY\) === 'true'/, 'only an explicit persisted true enables auto-target on load');
assert.match(input, /if \(!autoTargetEnabled\) \{[\s\S]{0,320}callback\(\);[\s\S]{0,80}return null;/, 'disabled auto-target bypasses target acquisition and starts the attack directly');
assert.match(input, /id="settingMeleeAutoTarget"/, 'Settings receives a player-facing Auto-target checkbox');
assert.match(input, /autoTargetSettingsSnapshot/, 'combat input exposes mobile-readable auto-target diagnostics');

assert.match(game, /function requestMeleeAttackAlignment\(/, 'game owns a transient melee alignment request');
assert.match(game, /let meleeAttackTargetLock = null;/, 'game owns one explicit activation-scoped melee target lock');
assert.match(game, /if \(meleeAttackTargetLock\) return meleeAttackTargetLock;/, 'candidate consumers reuse the selected entity instead of rescanning a crowd');
assert.match(game, /const target = acquireMeleeAttackTargetLock\(\);/, 'each activation acquires its target exactly once');
assert.match(game, /releaseMeleeAttackTargetLock\(alignment\.target, alignment\.cancelled \? 'cancelled' : 'aligned'\)/, 'normal alignment completion releases the selected entity');
assert.match(game, /try \{[\s\S]{0,80}runAttack\(\);[\s\S]{0,80}finally \{[\s\S]{0,80}releaseMeleeAttackTargetLock\(target, 'already-aligned'\)/, 'an immediate alignment always closes its target-lock lifecycle');
assert.match(game, /targetLocked: !!meleeAttackTargetLock[\s\S]{0,180}activationSerial:/, 'mobile diagnostics expose target lock state and activation identity');
assert.match(html, /game\.js\?v=20260916survivaltent1/, 'game cache key delivers the current activation-lock and survival runtime to browsers');
assert.match(game, /playerAttackAlignmentDuration\?\.\(initialStep\?\.deltaRad\)/, 'game delegates player glide duration to shared targeting policy');
assert.match(game, /playerAttackAlignmentProgress\?\.\(progress\)/, 'game delegates player easing to shared targeting policy');
assert.doesNotMatch(game, /PLAYER_ATTACK_ALIGNMENT_(?:MIN|MAX)_S|function easedAttackAlignmentProgress/, 'game has no private alignment tuning');
assert.match(core, /configuredEase\(progress, targetingConfig\.alignmentEasing\)/, 'player alignment easing is configurable');
assert.match(core, /configuredEase\(t, targetingConfig\.postAttackTurnEasing\)/, 'post-attack recovery easing is configurable');
assert.match(game, /if \(initialStep\?\.aligned\)[\s\S]{0,180}commitMeleeAttackFacing\(initialStep\.desiredFacing\)[\s\S]{0,100}runAttack\(\)/, 'an already-aligned attack commits its heading and still begins without artificial latency');
assert.match(game, /meleeAttackAlignment = null;/, 'game retains one explicit transient-lock release point');
assert.match(game, /appliedFacing: startFacing/, 'transient alignment owns the heading it actually applies');
assert.match(game, /attackAlignmentStep\?\.\(player, target, 0, \{ facing: alignment\.appliedFacing \}\)/, 'alignment does not reread competing controller or mouse look authority each frame');
assert.match(game, /function enemyCanSeeTarget\([\s\S]{0,260}targetInsideAttackCone/, 'enemy sight uses the same shared cone');
assert.match(game, /state = 'searching'/, 'enemies search after losing sight');
assert.match(game, /function updateEnemySearch\(/, 'enemy scanning can reacquire the player');
assert.match(game, /postAttackTurnMultiplier\?\.\(player\)/, 'player look inputs are rate-scaled after attacks');
assert.match(game, /postAttackTurnMultiplier\?\.\(c\)/, 'enemy turning is rate-scaled after attacks');
assert.doesNotMatch(game, /meleeAutoTargetOn|cycleMeleeAutoTarget|tryAutoEngageMeleeTarget/, 'persistent melee lock code is gone');

const runtime = { window: {}, performance: { now: () => 1000 } }; // Minimal browser surface used to prove targeting overrides change runtime behavior.
runtime.THREE = { MathUtils: {
  degToRad: degrees => degrees * Math.PI / 180,
  radToDeg: radians => radians * 180 / Math.PI,
  clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  lerp: (from, to, amount) => from + (to - from) * amount,
} };
vm.runInNewContext(core, runtime);
runtime.window.Combat.applyTargetingConfig({
  attackAlignmentHalfConeDeg: 30,
  playerAlignmentMinS: 0.2,
  playerAlignmentMaxS: 0.4,
  alignmentEasing: 'linear',
  postAttackTurnRecoveryS: 0.5,
  postAttackTurnMinMultiplier: 0.2,
  postAttackTurnEasing: 'linear',
});
assert(Math.abs(runtime.window.Combat.ATTACK_ALIGNMENT_HALF_CONE_RAD - Math.PI / 6) < 1e-9, 'authored cone updates the shared runtime getter');
assert(Math.abs(runtime.window.Combat.playerAttackAlignmentDuration(Math.PI / 12) - 0.3) < 1e-9, 'authored glide range controls player alignment duration');
assert.equal(runtime.window.Combat.playerAttackAlignmentProgress(0.25), 0.25, 'authored alignment easing changes the live curve');
const recoveringActor = {}; // Actor timestamp verifies authored post-attack duration, floor, and easing together.
runtime.window.Combat.noteAttackFinished(recoveringActor, 1000);
assert.equal(runtime.window.Combat.postAttackTurnMultiplier(recoveringActor, 1000), 0.2, 'authored recovery floor applies immediately');
assert(Math.abs(runtime.window.Combat.postAttackTurnMultiplier(recoveringActor, 1250) - 0.6) < 1e-9, 'authored recovery duration and easing control the midpoint');

let alignmentRequests = 0; // Counts calls into the real game-owned transient target/alignment request from the input gate.
let legacyActions = 0; // Counts attacks that actually begin so both disabled and enabled paths prove they still fire.
const inputRuntime = { // Minimal DOM/browser shell used to execute combat-input.js and verify the default-off behavior.
  window: {
    Combat: {
      loadout: { getSlot: () => null },
      abilities: { get: () => null },
      deps: {
        player: {},
        fireLegacyWeaponAction: () => { legacyActions++; },
        requestMeleeAttackAlignment: callback => { alignmentRequests++; callback(); return null; },
      },
      isStaggered: () => false,
      update: () => {},
    },
    addEventListener: () => {},
    dispatchEvent: () => {},
  },
  document: {
    readyState: 'loading',
    hidden: false,
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
  },
  performance: { now: () => 1000 },
  requestAnimationFrame: callback => callback(),
  CustomEvent: function CustomEvent() {},
  console,
};
vm.runInNewContext(input, inputRuntime);
inputRuntime.window.Combat.input.fireTap(1);
assert.equal(alignmentRequests, 0, 'default-off auto-target never asks game.js to select or align a target');
assert.equal(legacyActions, 1, 'manual/default-off attacks still begin immediately');
assert.equal(inputRuntime.window.Combat.input.alignmentHandoffSnapshot().phase, 'disabled-bypass', 'diagnostics report the manual bypass path');
assert.equal(inputRuntime.window.Combat.input.autoTargetSettingsSnapshot().defaultEnabled, false, 'debug snapshot advertises the default-off contract');
inputRuntime.window.Combat.input.setAutoTargetEnabled(true, { persist: false });
inputRuntime.window.Combat.input.fireTap(1);
assert.equal(alignmentRequests, 1, 'enabling auto-target restores the existing transient target/alignment request');
assert.equal(legacyActions, 2, 'enabled auto-target hands off into the same attack path after alignment');

assert.match(bandit, /attackAlignmentStep\?\.\(c, targetPlayer, dt/, 'bandits align before attack windup');
assert.doesNotMatch(bandit, /BANDIT_LUNGE_HOMING_RATE/, 'bandits do not home after committing an attack');
assert.match(bandit, /data: \{ isBandit: true, attacker: c/, 'bandit staged actions identify their attacker for recovery');

assert.match(indicator, /Object\.entries\(rawAfflictions \|\| \{\}\)/, 'opportunity effects accept progression maps without crashing');
assert.match(indicator, /state\.root\.updateWorldMatrix\?\.\(true, true\)/, 'overlay samples the live target transform');
assert.match(indicator, /requestAnimationFrame\(frame\); \/\/ Retains its pre-gameLoop/, 'opportunity overlay retains its established ordering until scheduler phases exist');
assert.match(indicator, /try \{[\s\S]{0,180}syncReadyTarget\(nowMs\)[\s\S]{0,260}catch \(error\)/, 'one renderer exception cannot strand or leave a visible overlay');
assert.match(indicator, /else detachReticle\(\)/, 'overlay hides immediately when the bonus condition ends');
assert.match(html, /quick-attack-bonus-indicator\.js/, 'opportunity indicator is loaded by the game page');

for (const [name, source] of Object.entries({ html, style, bindings, config })) {
  assert.doesNotMatch(source, /btnMeleeAutoTarget|meleeAutoTargetToggle|meleeTargetPrev|meleeTargetNext/, name + ' has no removed toggle/cycle surface');
}

console.log('transient attack alignment regression checks passed');

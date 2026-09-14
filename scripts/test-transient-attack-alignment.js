'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const game = read('docs/game.js');
const core = read('docs/js/combat/combat-core.js');
const input = read('docs/js/combat/combat-input.js');
const bandit = read('docs/js/combat/combat-bandit.js');
const indicator = read('docs/js/combat/quick-attack-bonus-indicator.js');
const html = read('docs/index.html');
const style = read('docs/style.css');
const bindings = read('docs/js/input-bindings.js');
const config = read('docs/config/scratchbones-config.js');

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

assert.match(core, /ATTACK_ALIGNMENT_HALF_CONE_RAD = Math\.PI \/ 4/, 'shared attack/sight cone is exactly ±45 degrees');
assert.match(core, /POST_ATTACK_TURN_MIN_MULTIPLIER = 0\.06/, 'post-attack turning starts near zero without reaching zero');
assert.match(core, /function attackAlignmentStep\(/, 'shared alignment helper exists');
assert.match(core, /function postAttackTurnMultiplier\(/, 'shared recovery ramp exists');

assert.match(input, /runAfterAttackAlignment\(\(\) =>/, 'tap attacks wait for transient alignment');
assert.match(input, /ability\?\.category === 'offensiveHold'/, 'offensive holds align before their windup');
assert.match(input, /releaseQueued/, 'release input survives an alignment that spans multiple frames');

assert.match(game, /function requestMeleeAttackAlignment\(/, 'game owns a transient melee alignment request');
assert.match(game, /meleeAttackAlignment = null; \/\/ Lock is off before the attack callback creates its windup\./, 'lock clears before windup starts');
assert.match(game, /function enemyCanSeeTarget\([\s\S]{0,260}targetInsideAttackCone/, 'enemy sight uses the same shared cone');
assert.match(game, /state = 'searching'/, 'enemies search after losing sight');
assert.match(game, /function updateEnemySearch\(/, 'enemy scanning can reacquire the player');
assert.match(game, /postAttackTurnMultiplier\?\.\(player\)/, 'player look inputs are rate-scaled after attacks');
assert.match(game, /postAttackTurnMultiplier\?\.\(c\)/, 'enemy turning is rate-scaled after attacks');
assert.doesNotMatch(game, /meleeAutoTargetOn|cycleMeleeAutoTarget|tryAutoEngageMeleeTarget/, 'persistent melee lock code is gone');

assert.match(bandit, /attackAlignmentStep\?\.\(c, targetPlayer, dt/, 'bandits align before attack windup');
assert.doesNotMatch(bandit, /BANDIT_LUNGE_HOMING_RATE/, 'bandits do not home after committing an attack');
assert.match(bandit, /data: \{ isBandit: true, attacker: c/, 'bandit staged actions identify their attacker for recovery');

assert.match(indicator, /Object\.entries\(rawAfflictions \|\| \{\}\)/, 'opportunity effects accept progression maps without crashing');
assert.match(indicator, /state\.root\.updateWorldMatrix\?\.\(true, true\)/, 'overlay samples the live target transform');
assert.match(indicator, /requestAnimationFrame\(frame\); \/\/ Schedule first/, 'one renderer exception cannot strand a visible overlay');
assert.match(indicator, /else detachReticle\(\)/, 'overlay hides immediately when the bonus condition ends');
assert.match(html, /quick-attack-bonus-indicator\.js/, 'opportunity indicator is loaded by the game page');

for (const [name, source] of Object.entries({ html, style, bindings, config })) {
  assert.doesNotMatch(source, /btnMeleeAutoTarget|meleeAutoTargetToggle|meleeTargetPrev|meleeTargetNext/, name + ' has no removed toggle/cycle surface');
}

console.log('transient attack alignment regression checks passed');

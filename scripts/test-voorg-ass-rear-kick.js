#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Test root used for CI and local checkout.
const game = fs.readFileSync(path.join(ROOT, 'docs/game.js'), 'utf8'); // Checks the large closure-private combat AI integration.
const index = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8'); // Ensures the attack module is loaded before game.js.
const script = fs.readFileSync(path.join(ROOT, 'docs/js/combat/combat-voorg-ass-rear-kick.js'), 'utf8'); // Executed in isolated VM with mock combat deps.

assert.match(index, /combat-voorg-ass-rear-kick\.js/, 'index loads the named kick attack');
assert.ok(index.indexOf('combat-animal-attacks.js') < index.indexOf('combat-voorg-ass-rear-kick.js'), 'named-attack registry loads first');
assert.ok(index.indexOf('combat-voorg-ass-rear-kick.js') < index.indexOf('src="game.js'), 'kick is registered before game starts');
assert.match(game, /_voorgRearKickThreat = retaliator/, 'a struck wild Voorg-Ass targets its aggressor');
assert.match(game, /animalAttacks\?\.start\(c, 'rearKick', \{ target: prey \}\)/, 'wildlife-vs-wildlife retaliations invoke the named kick');
assert.match(game, /window\.VoorgAssRearKick\.canUse\(c\) \? 'rearKick' : 'guardCharge'/, 'companion kicks respect their own cooldown');
assert.match(game, /_voorgRearKickSpent = false/, 'wild kick re-arms after returning home');
assert.match(game, /c\.state = c\._voorgRearKickThreat \? 'fleeing-low-health' : 'idle'/, 'wildlife switches to flight if the retaliation target disappears');
assert.match(game, /c\.state = c\._voorgRearKickThreat \? 'fleeing-low-health' : 'return'/, 'wildlife escapes if the skirmish exceeds its leash');
assert.match(game, /c\._voorgRearKickSpent = true; \/\/ No Stamina/, 'wildlife escapes if it cannot afford the kick');

const log = []; // Hit and sprite calls captured to verify the actual shared damage-frame contract.
const draws = []; // Tracks use of the rigger's own separator polygons for both sprite halves.
let clock = 1000; // Deterministic simulated wall clock for the companion-only cooldown.
const frame = key => ({ width: 128, height: 75, kind: key }); // Fake native-size genotyped idle/run1 PNG canvas.
const context2d = {
  save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
  drawImage(source) { draws.push(source.kind); },
};
const windowStub = {
  Combat: {
    deps: {},
    animalAttacks: { register(id, def) { this[id] = def; } },
    meleeHit() { return true; },
    meleeAimSolution() { return { pitch: 0 }; },
  },
  AnimalShoulderSpline: {
    separatorPolygon(w, h, rest, right) {
      log.push(['polygon', right, rest.frameShiftX]); // Both sides must use the saved rigger separator.
      const split = w * rest.frameShiftX;
      return right
        ? [{ x: split, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: split, y: h }]
        : [{ x: 0, y: 0 }, { x: split, y: 0 }, { x: split, y: h }, { x: 0, y: h }];
    },
  },
  CreatureGeneticsRender: {
    headRigForKind: () => ({ shoulderRest: { frameShiftX: 0.48, separatorRotationDeg: 0 } }),
    genotypeSignature: () => 'genotype-a',
    composeFrame: async (species, key) => {
      assert.equal(species, 'voorg-ass');
      return frame(key);
    },
  },
  __farmLog(message) { log.push(['debug', message]); },
};
const sandbox = vm.createContext({
  window: windowStub, document: { createElement: () => ({
    getContext: () => context2d,
    toDataURL: () => 'data:image/png;base64,KICK_FRAME',
  }) },
  performance: { now: () => clock }, Image: function () {},
  console, Math, Map, Promise,
});
vm.runInContext(script, sandbox, { filename: 'combat-voorg-ass-rear-kick.js' });
const kick = windowStub.Combat.animalAttacks.rearKick;
assert.ok(kick && typeof kick.start === 'function', 'rear kick registers with shared named attack system');

async function settle() {
  await new Promise(resolve => setImmediate(resolve)); // Let the composite rendering promise chain settle before checking attack state.
}

async function main() {
  const player = { health: 100, maxFooting: 100, x: 35, y: 0 }; // No areaId: ordinary player damage must still connect.
  const wild = {
    id: 'wild', creatureKey: 'voorg-ass-herd-mother', def: {
      attackRangePx: 32, rearKickCooldownS: 9,
      sprites: { idle: 'idle.png', run: ['run1.png'] },
    },
    x: 0, y: 0, areaId: 'cliffs', health: 80, facing: 0,
    avatarRef: {}, isCompanion: false, state: 'chase', targetPlayer: player,
  };
  const damageCalls = [];
  const deps = {
    TILE: 32, player, players: [player],
    setCreatureFrame(...args) { log.push(['frame', ...args]); },
    damagePlayer(...args) { damageCalls.push(args); },
    playCreatureClawHit() { log.push(['sfx']); },
  };
  const state = {};
  kick.start(wild, state, { target: player }, deps);
  assert.ok(Math.abs(wild.facing - Math.PI) < 0.0001, 'animal reverses its facing toward the target');
  await settle();
  assert.ok(draws.includes('idle') && draws.includes('run1'), 'idle head and run1 hindlegs were composited');
  assert.equal(log.filter(x => x[0] === 'polygon').length, 2, 'both sides use the saved rigger split');
  kick.update(wild, state, 0.35, deps);
  kick.update(wild, state, 0.14, deps);
  assert.equal(damageCalls.length, 1, 'kick lands once after windup');
  const [damage, , , knockback, options] = damageCalls[0];
  assert.equal(damage, 1, 'almost zero Health damage');
  assert.equal(knockback, 1900, 'extreme knockback');
  assert.ok(options.footingDamageMultiplier >= 80, 'huge Footing loss uses existing stagger pipeline');
  assert.equal(options.tag, 'blunt');
  assert.ok(log.some(x => x[0] === 'frame' && x[1] === wild.avatarRef && String(x[2]).startsWith('data:image/png')), 'combined frame applied through existing sprite renderer');
  kick.update(wild, state, 0.15, deps);
  kick.update(wild, state, 0.3, deps);
  assert.equal(wild.state, 'fleeing-low-health', 'wild Voorg-Ass escapes after kicking');
  assert.equal(wild._voorgRearKickThreat, null, 'wild target cleared for retreat');
  assert.equal(wild._voorgRearKickSpent, true, 'wild kick cannot loop while escaping');

  const companion = { ...wild, id: 'companion', creatureKey: 'voorg-ass', isCompanion: true, state: 'chase', targetPlayer: null };
  const target = { health: 50, maxFooting: 40, x: 38, y: 0, areaId: 'cliffs' };
  const creatureHits = [];
  windowStub.CompanionOffense = { damageCreature(fn, source, hit, amount, x, y, speed, opts) {
    creatureHits.push([source, hit, amount, speed, opts]);
  } };
  const companionDeps = { ...deps, damageCreature() {}, player, players: [player] };
  const companionState = {};
  kick.start(companion, companionState, { target }, companionDeps);
  assert.ok(!windowStub.VoorgAssRearKick.canUse(companion), 'special cooldown begins on start');
  await settle();
  kick.update(companion, companionState, 0.35, companionDeps);
  kick.update(companion, companionState, 0.15, companionDeps);
  assert.equal(creatureHits.length, 1, 'companion kick flows through companion offense');
  kick.update(companion, companionState, 0.35, companionDeps);
  kick.update(companion, companionState, 0.3, companionDeps);
  assert.equal(companion.state, 'chase', 'companion does not flee after the kick');
  clock += 9001;
  assert.ok(windowStub.VoorgAssRearKick.canUse(companion), 'signature attack recharges independently');

  // An uncached genotype may take many real frames to composite on mobile.
  // The first hit must not fire before its combined idle-head/run1-leg pose appears.
  const slow = { ...companion, id: 'slow-genotype', genotype: { base: { color: '#2357bb' } } };
  let releaseSlowFrame = null; // Manual frame-load barrier for the delayed renderer integration regression.
  const pendingFrame = new Promise(resolve => { releaseSlowFrame = resolve; }); // Stays unresolved while the attack enters its striking stage.
  windowStub.CreatureGeneticsRender.genotypeSignature = () => 'unique-slow-genotype';
  windowStub.CreatureGeneticsRender.composeFrame = async (species, frameId) => {
    await pendingFrame;
    return frame(frameId);
  };
  const slowState = {};
  kick.start(slow, slowState, { target }, companionDeps);
  kick.update(slow, slowState, 0.35, companionDeps);
  kick.update(slow, slowState, 1.0, companionDeps);
  assert.equal(creatureHits.length, 1, 'slow composite does not land an invisible instant kick');
  assert.ok(slowState.waitedForFrame, 'slow genotype retains the windup/strike wait');
  releaseSlowFrame();
  await settle();
  kick.update(slow, slowState, 0.01, companionDeps);
  assert.equal(creatureHits.length, 1, 'newly ready pose must be displayed before the hoof hits');
  kick.update(slow, slowState, 0.14, companionDeps);
  assert.equal(creatureHits.length, 2, 'delayed composite still lands one kick after its visible strike beat');

  console.log('Voorg-Ass rear-kick split pose, delayed art, Footing, knockback, flee and companion cooldown passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

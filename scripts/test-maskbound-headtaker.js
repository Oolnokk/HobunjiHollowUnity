'use strict';
// Headtaker behavior regression: the real Combat.attach scheduler (not a reimplementation)
// must own the host, but only the host's dodge roll may interrupt the grapple.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Loads the committed game code, not fake copies.

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(p) { return this.set(p.x, p.y, p.z); }
  clone() { return new Vec3(this.x, this.y, this.z); }
}
class Quaternion {}
const player = { x: 120, y: 110, health: 200, dodging: false }; // Actual host reference used by Combat.attach.
const playerMesh = {
  userData: {}, getWorldPosition(out) { return out.set(0, 0, 0); },
  updateWorldMatrix() {}, traverse() {},
};
const attackIds = []; // Confirms the special really registers through the shared animal-attack catalog.
const neckLockEvents=[]; // Head-only action lock validation.
const directDeaths=[]; // Completed grapples must use the ordinary death callback directly, without Second Wind.
const context = {
  console, Math, performance: { now: () => 100 }, THREE: { Vector3: Vec3, Quaternion },
  Combat: {
    deps: {
      TILE: 64, player, playerMesh,
      getActorWorldY: () => 1.1,
      damagePlayer(amount) { player.health -= amount; },
      damageCreature() {},
    },
    animalAttacks: { register(id) { attackIds.push(id); } },
  },
  CharacterActionLocks: {
    acquire(options) {
      neckLockEvents.push({type:'acquire',participants:options.participants});
      return { release() { neckLockEvents.push({type:'release'}); } };
    },
  },
  BanditCombat: {
    updateCombatAI: () => 'vanilla AI', // The wrapper must preserve unchanged troop behavior.
    updateToolMesh: () => 'vanilla tool',
  },
};
context.window = context; // Both game modules expect the ordinary browser global.
vm.createContext(context);
for (const path of ['docs/js/player-downed.js', 'docs/js/combat/combat-attach.js', 'docs/js/combat/combat-maskbound-headtaker.js']) {
  vm.runInContext(read(path), context, { filename: path });
}
context.PlayerDowned.init({
  player,
  die(reason) { directDeaths.push(reason); player.health = 200; }, // Same respawn callback as the real downed module.
});
const api = context.MaskboundHeadtaker; // Mobile getDebug is the same API exposed in game.
const def = context.Combat.attach.config(api.id);
assert(attackIds.includes(api.id), 'headtaker registers as a shared attach attack');
assert.equal(def.detachOnHostDodge, true, 'only target dodge rolls interrupt');
assert.equal(def.staggerImmune, true, 'ordinary third-party damage must not interrupt');
assert.equal(def.immuneToHost, false, 'attachment does not grant immunity to all attacks');
assert.equal(api.tuning.radiusTiles, 1, 'landing hit-circle is exactly one tile');
assert.equal(api.tuning.reversiblePullS, 1.5);
assert.equal(api.tuning.repetitions, 2);
assert.equal(api.tuning.finalPullS, 3);
assert.equal(api.tuning.targetHeightFraction, .85);
assert.equal(api.tuning.attackerLeanDegrees, 15);
assert.equal(api.tuning.finalHeadPitchDegrees, 40);
assert(api.tuning.finalHeadStretch > api.tuning.neckStretch*2);
const enemy = {
  isMaskboundGuardian: true, maskboundTroop: 'headtaker', health: 300,
  x: 95, y: 100, facing: 0, attackCooldownT: 0, def: { chaseSpeed: 180 },
  avatarRef: { group: { visible: true, position: { y: 0 } } },
};
assert.equal(context.BanditCombat.updateCombatAI({}, 0, player), 'vanilla AI', 'unrelated enemies retain their AI');
context.BanditCombat.updateCombatAI(enemy, 0.016, player);
assert.equal(api.getDebug().begins, 1, 'leap begins in reach of a humanoid');
for (let n = 0; n < 14; n++) context.BanditCombat.updateCombatAI(enemy, 0.1, player);
assert.equal(enemy._attachment?.stage, 'attached', 'landing passed through shared attachment lifecycle');
assert(player._attachedBy?.has(enemy), 'host tracks attached Headtaker');
assert.equal(api.getDebug().landings, 1);
assert.equal(api.getDebug().grabs, 1);
assert.equal(neckLockEvents.length,1,'player neck-only lock acquired at contact');
assert.equal(neckLockEvents[0].participants[0].channels.join(','),'head','movement and dodge remain unlocked');
assert.equal(context.Combat.attach.suppressesStagger(enemy), true, 'ordinary hit stagger cannot detach');
player.dodging = true;
context.BanditCombat.updateCombatAI(enemy, 0.06, player);
assert.equal(enemy._attachment, null, 'dodge roll detaches');
assert.equal(player._attachedBy?.size ?? 0, 0, 'host attachment set cleaned'); // Shared detach removes an empty Set entirely (null is also clean).
assert.equal(api.getDebug().dodges, 1, 'dodge reported in mobile diagnostics');
assert.equal(neckLockEvents.at(-1).type,'release','dodge releases scripted player neck ownership');
assert(enemy.attackCooldownT >= 5, 'dodge returns attacker to cooldown');
const animal = { x: 100, y: 110, health: 100, avatarRef: {} };
enemy.attackCooldownT = 0;
context.BanditCombat.updateCombatAI(enemy, 0.05, animal);
assert.equal(api.getDebug().begins, 1, 'never jumps on an animal');
const unrelated = { maskboundTroop: 'reacher' };
assert.equal(context.BanditCombat.updateToolMesh(unrelated), 'vanilla tool', 'other troop weapons unchanged');
assert.equal(context.BanditCombat.updateToolMesh(enemy), undefined, 'Headtaker carries no weapon');
assert.equal(enemy.avatarRef.group.visible, true, 'dodge restores enemy visibility');
const evasive = {
  ...enemy, avatarRef: {group: {visible:true,position:{y:0}}},
  x:96, y:101, attackCooldownT:0, health:300,
};
player.dodging=false; player.dodgeT=0;
context.BanditCombat.updateCombatAI(evasive,.016,player);
player.dodging=true; player.dodgeT=.2;
for(let i=0;i<14;i++) context.BanditCombat.updateCombatAI(evasive,.1,player);
assert(!evasive._attachment,'dodge on the landing frame prevents any transient grapple');
assert.equal(neckLockEvents.length,2,'dodge before contact acquires no second neck lock');
assert.equal(evasive.avatarRef.group.visible,true,'failed contact restores attacker');
// Dodge during the last pull is still an escape; lethal resolution only happens after the full clock.
function headtakerAt(x, y) {
  return { ...enemy, x, y, health: 300, attackCooldownT: 0, _attachment: null,
    avatarRef: { group: { visible: true, position: { y: 0 } } } };
}
const lastSecondEscape = headtakerAt(96, 101);
player.dodging = false; player.dodgeT = 0;
context.BanditCombat.updateCombatAI(lastSecondEscape, 0.016, player);
for (let i = 0; i < 14; i++) context.BanditCombat.updateCombatAI(lastSecondEscape, 0.1, player);
assert.equal(lastSecondEscape._attachment?.stage, 'attached');
for (let i = 0; i < 70; i++) context.BanditCombat.updateCombatAI(lastSecondEscape, 0.1, player);
assert.equal(directDeaths.length, 0, 'no lethal hit before the completed pull and throw');
player.dodging = true;
context.BanditCombat.updateCombatAI(lastSecondEscape, 0.05, player);
assert.equal(lastSecondEscape._attachment, null, 'rolling late dislodges the Headtaker');
assert.equal(directDeaths.length, 0, 'late dodge prevents execution');
assert(player.health > 0, 'late dodge leaves player alive');

// The workshop can lack generated head-only canvases; combat must still resolve rather than hanging forever.
const finisher = headtakerAt(95, 99);
player.dodging = false; player.dodgeT = 0;
context.BanditCombat.updateCombatAI(finisher, 0.016, player);
for (let i = 0; i < 14; i++) context.BanditCombat.updateCombatAI(finisher, 0.1, player);
assert.equal(finisher._attachment?.stage, 'attached');
for (let i = 0; i < 90; i++) context.BanditCombat.updateCombatAI(finisher, 0.1, player);
assert.deepEqual(directDeaths, ['maskbound-headtaker'], 'completed pull executes exactly once through the death callback');
assert.equal(context.PlayerDowned.isDowned(), false, 'execution never enters Second Wind');
assert.equal(context.PlayerDowned.debugSnapshot().lastEvent.type, 'instant-death', 'mobile diagnostic identifies the fatal transition');
assert.equal(api.getDebug().instantDeaths, 1, 'Headtaker-specific instant death count is reported');
assert.equal(finisher._attachment, null, 'fatal attack cleans up the attachment');
assert.equal(player._attachedBy?.size ?? 0, 0, 'lethal cleanup clears host bookkeeping');

assert.match(read('docs/js/procedural-leg-animation.js'), /setExternalFootTargets/, 'external world-space IK coordinates wired');
assert.match(read('docs/js/creature-death.js'), /MaskboundHeadtaker\?\.cancel\?\./, 'death tears down grapples');
assert.match(read('docs/tools/enemy-loadout-editor/preview.js'), /skyfallHeadGrip/, 'workshop can preview the unique attack');
console.log('PASS Headtaker: one-tile leap, early/late dodge-only escape, instant lethal completion without Second Wind, cleanup, workshop');

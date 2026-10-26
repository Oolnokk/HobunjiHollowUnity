#!/usr/bin/env node
'use strict';

// Executes actual resource/sacred/witch/mine modules in lightweight VM contexts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Reads the shipped runtime modules, not duplicated test-only implementations.

const resourceContext = {
  console, performance: { now: () => 2000 }, Date, Math,
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  dispatchEvent: () => {},
};
resourceContext.window = resourceContext;
vm.createContext(resourceContext);
for (const path of ['docs/js/combat/resource-system.js', 'docs/js/sacred-ground.js', 'docs/js/combat/combat-corroded-health.js']) {
  vm.runInContext(read(path), resourceContext, { filename: path });
}
const rs = resourceContext.ResourceSystem; // Real resource transaction and passive tick code.
const sacred = resourceContext.HobunjiSacredGround; // Global registry consumed by Rent Health.
const makeActor = () => {
  const actor = { x: 2 * 64, y: 2 * 64, areaId: 'farm', health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100, afflictions: {} }; // Actor used across sacred-zone transitions and repeated status ticks.
  rs.initEntity(actor);
  return actor;
};
const player = makeActor(); // The live player is a separate context identity from ordinary hostiles.
let area = 'farm'; // Changes to prove sacred checks read the active map rather than a cached spawn area.
sacred.init({
  tileSize: 64, getCurrentArea: () => area, getPlayer: () => player,
  getFarmRootTotem: () => ({ x: 10, y: 10 }),
  getRootTotems: zone => zone === 'cloud-forest' ? [{ pathAnchor: { x: 14, y: 12 } }] : [],
});
assert.equal(sacred.contains(player), false, 'ordinary farm tile is not sacred');
rs.addAffliction(player, 'rentHealth', 15);
assert.equal(rs.getEffectiveMax(player, 'health'), 85, 'Rent Health reserves effective maximum Health');
assert.equal(rs.removeAffliction(player, 'rentHealth', 15), 0, 'ordinary cleansing cannot clear Rent Health');
for (let i = 0; i < 600; i++) rs.tick(player, 1 / 60);
assert.equal(rs.getAffliction(player, 'rentHealth'), 15, 'slow fallback and ordinary rest ticks never heal Rent Health');
player.x = 10.5 * 64; player.y = 10.5 * 64;
rs.tick(player, 1 / 60);
assert.equal(rs.getAffliction(player, 'rentHealth'), 0, 'approaching farm Root Totem immediately heals Rent Health');
assert.equal(rs.getEffectiveMax(player, 'health'), 100, 'maximum Health is restored on sacred ground');

player.x = 2 * 64; player.y = 2 * 64;
rs.addAffliction(player, 'rentHealth', 8);
area = 'map_i_temple';
rs.tick(player, 1 / 60);
assert.equal(rs.getAffliction(player, 'rentHealth'), 0, 'main Life Temple interior is sacred');
area = 'map_i_temple_basement';
rs.addAffliction(player, 'rentHealth', 7);
rs.tick(player, 1 / 60);
assert.equal(rs.getAffliction(player, 'rentHealth'), 7, 'temple basement is not automatically sacred');
area = 'farm';
const unregister = sacred.registerProvider('test-sanctuary', (actor, current) => current === 'farm' && actor.x === 2 * 64);
rs.tick(player, 1 / 60);
assert.equal(rs.getAffliction(player, 'rentHealth'), 0, 'additional registered sacred sources can heal Rent Health');
unregister();
rs.addAffliction(player, 'rentHealth', 7);
rs.tick(player, 1 / 60);
assert.equal(rs.getAffliction(player, 'rentHealth'), 7, 'unregistered sources no longer count as sacred');
const wildernessActor = makeActor();
wildernessActor.areaId = 'cloud-forest';
wildernessActor.x = 14.5 * 64; wildernessActor.y = 12.5 * 64;
assert.equal(sacred.contains(wildernessActor), true, 'procedural wilderness Root Totems are sacred independently of the active player map');

const mineConfig = JSON.parse(read('docs/config/town-mine.json'));
const floorTiles = [];
for (let row = 1; row <= 22; row++) for (let col = 1; col <= 22; col++) floorTiles.push([col, row]);
const mineContext = {
  console, Date, Math, setTimeout, fetch: async () => ({ ok: true, json: async () => mineConfig }),
  window: {
    WildernessMapGenerator: { makeRng: () => () => 0.18 },
    CavernGenerator: { generateCavernFloor: () => ({
      cols: 24, rows: 24, floor: floorTiles, exitTiles: [[12, 12]], exitCol: 12, exitRow: 12, mesh: {},
    }) },
  },
};
vm.createContext(mineContext);
vm.runInContext(read('docs/js/town-mine.js'), mineContext);
(async () => {
  const mine = mineContext.window.TownMine;
  mine.init({});
  const floorAt = floorNumber => mine.synthesizeFloorMapData(mine.mapIdForFloor(floorNumber)); // Exercises actual procedural placement and tier selection.
  const second = await floorAt(11);
  assert(second.mineEnemySpawns.length > 0 && second.mineEnemySpawns.every(s => s.kind === 'ghoul' && !s.rangedWeaponKey), 'Tier 2 introduces melee-only ghouls');
  const third = await floorAt(21);
  assert(third.mineEnemySpawns.some(s => s.kind === 'ghoul' && s.rangedWeaponKey === 'fishingspear'), 'Tier 3 can equip ghouls with ranged fishing spears');
  const fourth = await floorAt(31);
  assert(fourth.mineEnemySpawns.some(s => s.kind === 'ghoul-shadowknight'), 'Tier 4 can roll a lieutenant-class Shadowknight');
  assert(fourth.mineEnemySpawns.every(s => s.kind !== 'ghoul-wyrm-witch'), 'Tier 4 cannot roll witches early');
  const fifth = await floorAt(41);
  assert(fifth.mineEnemySpawns.some(s => s.kind === 'ghoul-wyrm-witch' && ['shadow-wind', 'rend-water'].includes(s.witchType)), 'Tier 5 can roll one of two Wyrm-witches');

  let activeArea = 'farm'; // Changes mid-flight to verify spells cannot cross rooms.
  const actions = []; // Captures live staged attacks so the scripted damage callbacks can be advanced explicitly.
  const hits = []; // Records damage and directional knockback issued by the actual spell implementation.
  resourceContext.GameRandom.random = () => 0.5;
  resourceContext.Combat = {
    comboData: { swingCombo: [{ lungeMul: 2, rangeMul: 1.1 }], LUNGE_SCALE: 1.5, RANGE_SCALE: 1.2 },
    meleeHit: () => true,
    beginStagedAction(options) {
      const action = { ...options, strikeFired: true, cancel() { this.cancelled = true; this.onCancel?.(this); } }; // Mirrors the cancellable staged-action contract.
      actions.push(action);
      return action;
    },
  };
  vm.runInContext(read('docs/js/combat/combat-ghoul-wyrm-witches.js'), resourceContext);
  const witches = resourceContext.GhoulWyrmWitches;
  const target = makeActor();
  target.x = 64 * 1.5; target.y = 0;
  const gameSource = read('docs/game.js'); // The actual player damage function, not a copied simplified hit resolver.
  const damageStart = gameSource.indexOf('      function damagePlayer(');
  const damageEnd = gameSource.indexOf('\n      // Closest Root Totem', damageStart);
  assert(damageStart >= 0 && damageEnd > damageStart, 'real game.js damagePlayer integration boundary exists');
  const playerDamageFunctionSource = gameSource.slice(damageStart, damageEnd); // Extract exactly one function from the game closure without launching its Three.js app.
  const liveDamageCallbacks = new WeakMap(); // Caches each target's authoritative damage function for multiple spell hits.
  const gameDamagePlayerFor = targetActor => {
    if (liveDamageCallbacks.has(targetActor)) return liveDamageCallbacks.get(targetActor);
    const callback = vm.runInNewContext(playerDamageFunctionSource + '\n damagePlayer;', {
      window: resourceContext, performance: resourceContext.performance, player: targetActor,
      hitResourceDamage: amount => ({ health: amount, footing: 0 }), // No bonus equipment protections in this targeted integration harness.
      applyKnockback: () => {}, applyHitStagger: () => {}, respawnPlayer: () => {},
      PLAYER_KNOCKBACK_PX_S: 100,
    });
    liveDamageCallbacks.set(targetActor, callback);
    return callback;
  };
  const api = { TILE: 64, canOccupyAt: () => true, moveToward: () => false, getCurrentArea: () => activeArea,
    damage: (victim, amount, fromX, fromY, knockback, options) => {
      hits.push({ victim, amount, fromX, fromY, knockback, options }); // Records the spell-to-engine handoff for collision and directional impulse assertions.
      return gameDamagePlayerFor(victim)(amount, fromX, fromY, knockback, options); // Real game.js defense, damage and ResourceSystem transaction path.
    } };
  resourceContext.Combat.tryInterceptPlayerDamage = () => api.blockDamage === true; // Real damagePlayer consumes this shared Counter Shield interception hook.
  resourceContext.Combat.cancelAllStaged = () => {}; // Normal player stagger cancellation is outside this isolated Wyrm-witch unit test.
  const mage = type => ({
    id: 'test-' + type, health: 60, mineWyrmWitchType: type, x: 0, y: 0, areaId: 'farm', facing: 0,
    def: { attackDamage: 10, attackRangePx: 70, chaseSpeed: 160, banditAbilityLoadout: { tap1: 'swingCombo' } },
    avatarRef: { group: {} }, scene: {},
  }); // Only the shared BanditCombat-facing actor fields required to cast.
  const water = mage('rend-water');
  assert.equal(witches.update(water, .016, target, 96, api)?.handled, true, 'Rend-water owns its attack AI');
  actions.at(-1).onStrike();
  assert.equal(hits.length, 1, 'Rend-water extended cone resolves one melee hit without a lunge');
  assert.equal(rs.getAffliction(target, 'rentHealth'), witches.WATER_RENT_HEALTH, 'Rend-water inflicts the sacred-only max-Health affliction');
  assert.equal(water._banditLunging, undefined, 'Rend-water never starts a melee lunge');
  assert.equal(hits[0].options?.fixedAfflictionBuildup?.rentHealth, 3, 'Rend-water queues flat Rent buildup only in accepted hit damage options');
  const blockedTarget = makeActor(); // A second target verifies a failed defensive hit cannot apply Rent outside the damage transaction.
  blockedTarget.x = target.x; blockedTarget.y = target.y;
  api.blockDamage = true;
  const blockedWater = mage('rend-water');
  witches.update(blockedWater, .016, blockedTarget, 96, api);
  actions.at(-1).onStrike();
  assert.equal(rs.getAffliction(blockedTarget, 'rentHealth'), 0, 'Blocked Rend-water damage cannot apply Rent Health');
  api.blockDamage = false;
  blockedTarget.invulnUntil = resourceContext.performance.now() + 1000; // Exercise the actual player invulnerability return before the resource transaction.
  const invulnerableWater = mage('rend-water');
  witches.update(invulnerableWater, .016, blockedTarget, 96, api);
  actions.at(-1).onStrike();
  assert.equal(rs.getAffliction(blockedTarget, 'rentHealth'), 0, 'invulnerability rejects Rent Health before ResourceSystem.applyDamage');
  blockedTarget.invulnUntil = 0;
  assert.equal(target.health, 90, 'accepted water strike passes its actual Health damage through game.js');
  assert.equal(rs.getEffectiveMax(target, 'health'), 97, 'on-hit Rent buildup reduces effective maximum Health exactly once');

  const wind = mage('shadow-wind');
  target.x = 64 * 2; target.y = 0;
  assert.equal(witches.update(wind, .016, target, 128, api)?.handled, true, 'Shadow-wind owns its ranged attack AI');
  const cloud = actions.at(-1);
  cloud.onStrike();
  cloud.onUpdate({ ...cloud, strikeFired: true, t: .43 + .35 }); // One large frame crosses more than four tiles; the sweep must not tunnel through a target two tiles away.
  assert.equal(hits.length, 4, 'short-lived fast cloud cannot tunnel through the target during a frame hitch');
  assert.equal(hits[3].knockback, witches.WIND_KNOCKBACK_PX_S, 'cloud delegates huge directional impulse to normal knockback physics');
  const wallWind = mage('shadow-wind'); // A wall on the outbound path must stop the cloud before the target.
  const wallApi = { ...api, canOccupyAt: x => x < 64 };
  witches.update(wallWind, .016, target, 128, wallApi);
  const wallCloud = actions.at(-1);
  wallCloud.onStrike();
  wallCloud.onUpdate({ ...wallCloud, strikeFired: true, t: .43 + .35 });
  assert.equal(hits.length, 4, 'a cloud cannot tunnel through cover even on a large frame step');
  const transitioningWind = mage('shadow-wind'); // A staged cast must end if the owning mine map is left during projectile flight.
  witches.update(transitioningWind, .016, target, 128, api);
  const interruptedCloud = actions.at(-1);
  interruptedCloud.onStrike();
  activeArea = 'town';
  interruptedCloud.onUpdate({ ...interruptedCloud, strikeFired: true, t: .43 + .35, cancel: () => interruptedCloud.cancel() });
  assert(interruptedCloud.cancelled, 'a Wyrm projectile must cancel when its room is no longer active');
  assert.equal(hits.length, 4, 'an unloaded-mine projectile must not damage the player in the new map');
  assert(witches.WIND_KNOCKBACK_PX_S >= 3800, 'cloud is at least twice as powerful as the existing rear kick');
  for (let i = 0; i < 40; i++) {
    const extra = mage('rend-water'); // Simulates many revisits without leaking every old witch into the mobile diagnostic cache.
    extra.id = 'debug-witch-' + i;
    extra.avatarRef.group.parent = {}; // Mark as render-live for the bounded-cache assertion.
    witches.update(extra, .016, target, 96, api);
  }
  assert(witches.debugSnapshot().active.length <= 24, 'repeated mine visits must not retain an unbounded list of old Wyrm-witch actors');
  const configText = read('docs/config/config.js'); // Ensures new sacred-only Rent Health never silently appears as a white/unknown affliction.
  assert.match(configText, /rentHealth:\s*'#[0-9a-fA-F]{6}'/, 'Rent Health has its own authored HUD ring color');
  console.log('Ghoul tier progression, Wyrm-witch attacks, map-change cancellation and sacred Rent Health checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

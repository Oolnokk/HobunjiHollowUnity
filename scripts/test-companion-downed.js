#!/usr/bin/env node
'use strict';

// Downed companion + player Second Wind + companion resilience perks.
// Executes the real modules in a VM against small stubs (no game.js).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let nowMs = 1000;
const toasts = [];
const context = {
  console,
  performance: { now: () => nowMs },
  Date,
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
const load = file => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

load('docs/config/config.js');
const makeElement = () => ({ style: {}, children: [], textContent: '', appendChild(child) { this.children.push(child); return child; } });
context.document = { addEventListener() {}, getElementById: () => null, querySelector: () => null, createElement: makeElement, body: makeElement() }; // After config.js, which installs browser-only hooks when a document exists.
context.SCRATCHBONES_CONFIG = { game: { combat: { resourceSystem: { pukeChancePerSec: 0 } } } };
load('docs/js/combat/resource-system.js');
const RS = context.ResourceSystem;

const TILE = 64;
const player = { x: 1000, y: 1000, angle: 0, health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100, areaId: 'zone', invulnUntil: 0 };
RS.initEntity(player);
const companionObjects = new Set();
const stableEntry = { id: 'wolf1', kind: 'gar-wolf', name: 'Moro', animalPerks: {} };
context.StableAnimalProgression = {
  trees: { companion: [{ id: 'keenSenses', name: 'Keen Senses', maxRank: 5, desc: '' }] },
  findStableEntry: id => (id === stableEntry.id ? stableEntry : null),
  activeEntryForRole: () => stableEntry,
  perkRank: (entry, id) => entry?.animalPerks?.[id] || 0,
};
context.Combat = { deps: { player, companionObjects }, cancelAllStaged() {}, telegraph: { cancel() {} }, animalAttacks: { cancel() {} } };
let respawns = [];
let meshUpdates = 0;

load('docs/js/combat/companion-offense.js');
load('docs/js/stable-companion-resilience.js');
load('docs/js/companion-downed.js');
load('docs/js/player-downed.js');
const { CompanionResilience: CR, CompanionDowned: CD, PlayerDowned: PD, CompanionOffense: CO } = context;

CD.init({
  player, companionObjects, TILE, showToast: message => toasts.push(message),
  getCurrentArea: () => 'zone',
  updateCreatureMesh: () => { meshUpdates++; },
  updateCreatureAnimFrame: () => {},
  canOccupyAt: () => true,
  getRootTotems: () => [{ x: 18, y: 17 }], // Tile (18,17) is ~2 tiles from the player at tile (15.6,15.6).
});
let ranged = true;
PD.init({
  player, showToast: message => toasts.push(message),
  die: reason => respawns.push(reason),
  forceRangedTool: () => ranged,
});

function makeCompanion(extra = {}) {
  const actor = {
    id: 'comp', isCompanion: true, stableRole: 'companion', stableId: 'wolf1', name: 'Moro', master: player,
    x: 1100, y: 1000, health: 40, maxHealth: 40, stamina: 50, maxStamina: 50, footing: 40, maxFooting: 40, areaId: 'zone',
    scaleY: 1, avatarRef: { group: {} }, ...extra,
  };
  RS.initEntity(actor);
  actor.health = 40;
  companionObjects.add(actor);
  return actor;
}
const setPerks = perks => { stableEntry.animalPerks = { ...perks }; };

// ── Perk definitions ──────────────────────────────────────────────
const treeIds = context.StableAnimalProgression.trees.companion.map(perk => perk.id);
for (const id of ['companionClaws', 'companionStagger', 'companionFester', 'companionHide', 'companionVigor', 'companionPoise', 'companionMending', 'companionRally', 'companionHeel', 'companionRallyAll', 'companionLastStand']) {
  assert(treeIds.includes(id), `${id} is appended to the companion training tree`);
}
assert(treeIds.includes('keenSenses'), 'existing perks stay in the tree');
assert.equal(treeIds.length, new Set(treeIds).size, 'installing twice never duplicates perks');

// ── Revive perks: cooldown and the multiplying hold perks ─────────
setPerks({});
assert.equal(CR.autoReviveMultiplier(stableEntry), 1);
setPerks({ companionRally: 5 });
assert.equal(CR.autoReviveMultiplier(stableEntry), 0.5, 'Quick Rally caps at a 50% shorter auto-revive');
setPerks({ companionHeel: 5 });
assert.equal(CR.reviveHoldMultiplier(stableEntry, true), 0.5, 'Heel to Master halves the owner hold');
assert.equal(CR.reviveHoldMultiplier(stableEntry, false), 1, 'Heel to Master never helps anyone else');
setPerks({ companionRallyAll: 5 });
assert.equal(CR.reviveHoldMultiplier(stableEntry, false), 0.5, 'Rallying Presence halves any reviver');
setPerks({ companionHeel: 5, companionRallyAll: 5 });
assert.equal(CR.reviveHoldMultiplier(stableEntry, true), 0.25, 'both perks multiply for the owner: 75% shorter');
assert.equal(CR.reviveHoldMultiplier(stableEntry, false), 0.5, 'other revivers only get the shared perk');
setPerks({ companionHeel: 99, companionRallyAll: 99 });
assert.equal(CR.reviveHoldMultiplier(stableEntry, true), 0.25, 'over-ranked data cannot exceed the 75% cap');

// ── Offense / defense perks through the shared providers ──────────
setPerks({ companionClaws: 5, companionStagger: 5, companionFester: 5 });
const companion = makeCompanion();
const mods = CO.getModifiers(companion, {});
assert(Math.abs(mods.damage - 1.3) < 1e-9 && Math.abs(mods.footing - 1.5) < 1e-9 && Math.abs(mods.affliction - 1.5) < 1e-9, 'offense perks scale damage/footing/affliction through CompanionOffense');
setPerks({ companionVigor: 5 });
assert.equal(RS.getEffectiveMax(companion, 'health'), 60, 'Hardy Constitution raises max Health through the ResourceSystem provider');
assert.equal(RS.getEffectiveMax({ ...companion, isCompanion: false, master: null }, 'health'), 40, 'non-companions are untouched');
setPerks({ companionHide: 5 });
assert(Math.abs(CR.damageTakenMultiplier(companion) - 0.7) < 1e-9, 'Thick Hide reduces damage taken');
setPerks({ companionHide: 5, companionLastStand: 3, companionClaws: 5 });
assert(Math.abs(CR.damageTakenMultiplier(companion) - 0.7) < 1e-9, 'Guardian Fury does nothing while the owner stands');
assert(Math.abs(CO.getModifiers(companion, {}).damage - 1.3) < 1e-9);

// ── Companion downed: timer and auto-revive ───────────────────────
setPerks({});
companion.health = 0;
assert.equal(CD.tryDown(companion), true, 'a lethal hit downs the player companion');
assert(companion._downed && companion.health === 0 && companion.scaleY < 1, 'downed pose: lying flat at zero Health');
assert.equal(CD.tryDown(companion), true, 'repeated lethal ticks are absorbed');
assert.equal(CD.tryDown({ ...companion, master: { x: 0, y: 0 }, _downed: false }), false, 'a companion owned by someone else still dies normally');
assert.equal(CD.tryDown({ ...companion, banditCompanion: true, _downed: false }), false, 'bandit pets are not downed');
CD.update(30);
assert(companion._downed, 'still down after 30s');
CD.update(29.9);
assert(companion._downed, 'still down just before 60s');
CD.update(0.2);
assert(!companion._downed, 'auto-revives at 60s');
assert.equal(companion.health, 20, 'revives at half Health');
const distToMaster = Math.hypot(companion.x - player.x, companion.y - player.y);
assert(distToMaster < TILE * 2, 'auto-revive reappears at the master\'s side');
assert(companion.invulnUntil > nowMs, 'brief invulnerability after getting up');

// Quick Rally halves the wait.
setPerks({ companionRally: 5 });
companion.health = 0; CD.tryDown(companion);
CD.update(29.9);
assert(companion._downed, 'Quick Rally: still down at 29.9s');
CD.update(0.2);
assert(!companion._downed, 'Quick Rally: up at 30s');

// ── Held revive ───────────────────────────────────────────────────
setPerks({});
Object.assign(companion, { x: player.x + 40, y: player.y, health: 0 });
CD.tryDown(companion);
const aimCol = Math.floor(companion.x / TILE), aimRow = Math.floor(companion.y / TILE);
const button = CD.getHoldButton(aimCol, aimRow);
assert(button && button.action === 'corpse_hold_loot' && /Revive/.test(button.label), 'a nearby downed companion offers the shared hold-interact prompt');
let hold = CD.getHoldTarget(aimCol, aimRow);
assert.equal(hold.holdSeconds, 4, 'base revive hold is 4s');
setPerks({ companionHeel: 5, companionRallyAll: 5 });
assert.equal(CD.getHoldTarget(aimCol, aimRow).holdSeconds, 1, 'both revive perks cut the hold to 25%');
const before = { x: companion.x, y: companion.y };
hold.onAction('obj_loot_corpse');
assert(!companion._downed && companion.health === 20, 'completing the hold revives at half Health');
assert.deepEqual({ x: companion.x, y: companion.y }, before, 'a held revive stands the companion up in place');
assert.equal(CD.getHoldButton(aimCol, aimRow), null, 'no prompt once nobody is down');

Object.assign(companion, { x: player.x + 600, y: player.y + 600, health: 0 }); // Far away: only the totem helps.
setPerks({});
CD.tryDown(companion);
assert.equal(CD.getHoldButton(0, 0), null, 'no prompt with no downed companion or totem in reach');
player.x = 18.5 * TILE; player.y = 18 * TILE; // Beside the totem.
const totemCol = 18, totemRow = 18;
assert(/Call Companion/.test(CD.getHoldButton(totemCol, totemRow)?.label || ''), 'a Root Totem offers recall while a companion is down');
const totemHold = CD.getHoldTarget(totemCol, totemRow);
assert.equal(totemHold.holdSeconds, 3, 'base totem hold is 3s');
totemHold.onAction('obj_loot_corpse');
assert(!companion._downed, 'Root Totem hold revives the companion');
assert(Math.hypot(companion.x - player.x, companion.y - player.y) < TILE * 2, 'and teleports it to the player');
player.x = 1000; player.y = 1000;

// ── Owner respawn / teleport revive (deferred teleport) ───────────
Object.assign(companion, { x: 5000, y: 5000, health: 0 });
CD.tryDown(companion);
assert.equal(CD.reviveAll({ reason: 'player-respawn', teleport: 'deferred' }), 1);
assert(!companion._downed && companion.x === 5000, 'deferred revive waits for the owner to finish moving');
player.x = 300; player.y = 300; // The respawn moves the player.
CD.update(0.016);
assert(Math.hypot(companion.x - player.x, companion.y - player.y) < TILE * 2, 'next frame the companion joins the owner');
player.x = 1000; player.y = 1000;

// Downed state survives an area change respawn.
companion.health = 0; CD.tryDown(companion);
companionObjects.delete(companion);
const respawned = makeCompanion({ id: 'comp2' });
CD.onCompanionSpawned(respawned);
assert(respawned._downed && respawned.health === 0, 'a freshly spawned actor of a downed companion comes back down');
CD.reviveAll({ reason: 'test' });
companionObjects.delete(respawned);
companionObjects.add(companion);

// ── Player Second Wind ────────────────────────────────────────────
assert.equal(PD.isDowned(), false);
assert.equal(PD.allowsAction('tool', 'weapon'), true);
player.health = 0;
assert.equal(PD.tryDown('damage'), true);
assert.equal(PD.isDowned(), true);
assert.equal(player.health, 1, 'Health is pinned above zero while down');
assert.equal(PD.isDowned(), true);
assert.equal(PD.allowsAction('tool', 'weapon'), false, 'melee is blocked while down');
assert.equal(PD.allowsAction('tool', 'ranged'), true, 'the ranged weapon still works while down');
assert.equal(PD.allowsAction('item', 'ranged'), false, 'held bag items are blocked while down');
assert.equal(PD.interceptDeath('kanthic-plasm'), true, 'already-down players are not killed by scripted deaths either');

// Companion perk Guardian Fury is live only while down.
setPerks({ companionHide: 5, companionLastStand: 3, companionClaws: 5 });
assert(Math.abs(CR.damageTakenMultiplier(companion) - 0.25) < 1e-9, 'Guardian Fury stacks defense while the owner is down');
assert(CO.getModifiers(companion, {}).damage > 2, 'Guardian Fury stacks damage while the owner is down');
setPerks({});

// A ranged hit focuses the companion; melee hits and companion hits do not.
const enemy = { id: 'bandit', health: 30, def: { hostile: true }, areaId: 'zone' };
PD.noteTeamHit(enemy, { ranged: true });
assert.equal(PD.getFocusTarget(), enemy, 'ranged hit while down sets the companion focus');
const other = { id: 'other', health: 30, def: { hostile: true }, areaId: 'zone' };
PD.noteTeamHit(other, { fromCompanion: companion });
assert.equal(PD.getFocusTarget(), enemy, 'companion hits do not steal the focus');
enemy.health = 0;
assert.equal(PD.getFocusTarget(), null, 'focus clears when the target dies');

// Hits only cost time; stale/unrelated kills do not count.
const timeBefore = PD.debugSnapshot().remainingS;
PD.noteHitWhileDowned();
assert.equal(PD.debugSnapshot().remainingS, timeBefore - 2, 'each hit taken costs 2 seconds of bleed-out');
PD.noteKill({ id: 'nobody-hit-this', def: { hostile: true } });
assert.equal(PD.isDowned(), true, 'a kill neither the player nor the companion caused does not count');
nowMs += 20000;
PD.noteKill(other);
assert.equal(PD.isDowned(), true, 'a stale hit (outside the credit window) does not count');
// Another actor landing the last blow takes the kill, including an NPC arrow (friendlyFire).
const stolen = { id: 'stolen', health: 30, def: { hostile: true }, areaId: 'zone' };
PD.noteTeamHit(stolen, {});
assert.equal(PD.isTeamKill(stolen), true, 'the player\'s own recent last hit owns the kill');
PD.noteTeamHit(stolen, { friendlyFire: true, factionCombat: true, attacker: { id: 'omgurku-hunter' } });
assert.equal(PD.isTeamKill(stolen), false, 'an NPC finishing the enemy off takes the credit');
PD.noteKill(stolen);
assert.equal(PD.isDowned(), true, 'someone else\'s kill does not grant Second Wind');
const arrowed = { id: 'arrowed', health: 30, def: { hostile: true }, areaId: 'zone' };
PD.noteTeamHit(arrowed, { ranged: true, friendlyFire: true });
assert.equal(PD.isTeamKill(arrowed), false, 'an attacker-less NPC arrow is never the player\'s hit');
// A burn/bleed the player started keeps credit for longer when it is what kills.
const burned = { id: 'burned', health: 30, def: { hostile: true }, areaId: 'zone' };
PD.noteTeamHit(burned, {});
nowMs += 30000;
assert.equal(PD.isTeamKill(burned), false, 'a 30s-old hit does not own an ordinary death');
burned._deathByAffliction = true;
assert.equal(PD.isTeamKill(burned), true, 'a damage-over-time death still credits the player 30s after their hit');
nowMs += 31000;
assert.equal(PD.isTeamKill(burned), false, 'the damage-over-time credit window still ends');
PD.noteTeamHit(burned, {});
PD.noteTeamHit(burned, { friendlyFire: true, attacker: { id: 'bandit' } });
assert.equal(PD.isTeamKill(burned), false, 'an NPC hitting it after the player takes even a damage-over-time kill');
const passive = { id: 'deer', def: { hostile: false }, _teamHitAt: nowMs };
PD.noteKill(passive);
assert.equal(PD.isDowned(), true, 'killing passive wildlife does not count');

// A companion kill gets the player back up at half Health.
const prey = { id: 'wolfkill', health: 30, def: { hostile: true }, areaId: 'zone' };
PD.noteTeamHit(prey, { fromCompanion: companion });
PD.noteKill(prey);
assert.equal(PD.isDowned(), false, 'a companion kill triggers Second Wind');
assert.equal(player.health, 50, 'Second Wind restores half Health');
assert(player.invulnUntil > nowMs);

// Own ranged kill does too; then bleed-out finally kills.
player.health = 0; PD.tryDown('damage');
const shot = { id: 'shot', health: 30, def: { hostile: true }, areaId: 'zone' };
PD.noteTeamHit(shot, { ranged: true });
PD.noteKill(shot);
assert.equal(PD.isDowned(), false, 'the player\'s own kill triggers Second Wind');

player.health = 0; PD.tryDown('damage');
PD.update(29.9);
assert.equal(respawns.length, 0, 'still bleeding at 29.9s');
PD.update(0.2);
assert.deepEqual(Array.from(respawns), ['bleed-out'], 'the timer running out kills through the normal respawn path');
assert.equal(PD.isDowned(), false);

// Vitals-tick deaths go down; scripted deaths do not.
player.health = 0;
assert.equal(PD.interceptDeath('kanthic-plasm'), false, 'scripted deaths still kill');
assert.equal(PD.interceptDeath('resource-tick'), true, 'bleeding/burning ticks put the player down instead');
PD.reset();
assert.equal(PD.isDowned(), false, 'respawn clears the downed state');

// Without a ranged weapon the player is told only the companion can help.
ranged = false;
toasts.length = 0;
player.health = 0; PD.tryDown('damage');
assert(toasts.some(message => /no ranged weapon/i.test(message)), 'no ranged weapon: the player is warned');
PD.reset();

console.log('companion downed / second wind: all assertions passed');

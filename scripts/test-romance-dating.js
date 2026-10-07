#!/usr/bin/env node
'use strict';

// Executes the dating / marriage / family modules and the hold-Action-1 NPC
// command wheel against stubbed game state (no browser): Romance points and
// their midnight conversion, date likes/losses, follow/wait targets, date
// expiry, the wedding → spouse routine, family case resolution, child
// lifecycle phases, and the tap-vs-hold input claim.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// ── Minimal DOM ─────────────────────────────────────────────────────────
function element(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, textContent: '', innerHTML: '', id: '',
    classList: { set: new Set(), add(...c) { c.forEach(x => this.set.add(x)); }, remove(...c) { c.forEach(x => this.set.delete(x)); }, toggle(c, on) { if (on ?? !this.set.has(c)) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute() {}, addEventListener() {}, remove() {},
    appendChild(child) { this.children.push(child); return child; },
    append(...kids) { kids.forEach(k => this.children.push(k)); },
    querySelectorAll() { return []; }, querySelector() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 340, height: 340 }; },
  };
  return el;
}
const documentStub = {
  readyState: 'complete', head: element('head'), body: element('body'),
  createElement: element, createTextNode: text => ({ text }), getElementById: () => null,
  addEventListener() {}, pointerLockElement: null,
};

// ── Controllable clock ──────────────────────────────────────────────────
const clock = { rawDay: 10, hour: 10 };
const intervals = [];
const timeouts = [];
const windowListeners = {};
const windowStub = {
  CalendarSystem: {
    timeDebugSnapshot: () => ({ rawDay: clock.rawDay, civilDay: clock.rawDay, time01: (clock.hour - 6) / 24 }),
    getHour: () => clock.hour,
    constants: { DAY_ROLLOVER_HOUR: 6, FULL_DAY_CYCLE: true },
  },
  SCRATCHBONES_CONFIG: { game: {} },
  addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
  dispatchEvent(event) { (windowListeners[event.type] || []).forEach(fn => fn(event)); },
};
windowStub.window = windowStub;

// Relationship storage used by DialogueContent / NpcRapport.
const relationships = new Map();
function relState(id) {
  if (!relationships.has(id)) relationships.set(id, { favor: 0, memory: [], visitedSeqSlots: {} });
  return relationships.get(id);
}
windowStub.DialogueContent = {
  getNpcDlgState: id => relState(id),
  npcRelationshipsSnapshot: () => Object.fromEntries([...relationships].map(([id, st]) => [id, { favor: st.favor }])),
  loadNpcRelationships: () => {},
  registerActionHandler(type, fn) { this.handlers = { ...(this.handlers || {}), [type]: fn }; return true; },
  registerTreeProvider(id, fn) { this.trees = { ...(this.trees || {}), [id]: fn }; return true; },
  recordNpcMemory() {},
};
windowStub.NpcFavorBalance = { relationshipHeartsForNpc: id => relState(id).favor / 40 };

const context = {
  window: windowStub, document: documentStub, console, Math, JSON, Date, Promise, Map, Set, WeakMap, Number, String, Object, Array,
  performance: { now: () => Date.now() },
  setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
  clearInterval() {},
  setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
  clearTimeout() {},
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
};
vm.createContext(context);
const run = file => vm.runInContext(read(file), context, { filename: file });

run('docs/js/activity-events.js');
run('docs/js/world-action-input-claims.js');
run('docs/config/romance-config.js');
run('docs/js/npc-scheduling.js');
run('docs/js/npc-social-relationship-bridge-v2.js');
run('docs/js/romance-family.js');
run('docs/js/romance-system.js');
run('docs/js/npc-command-wheel.js');

const W = windowStub;
assert.ok(W.HobunjiActivityEvents && W.RomanceSystem && W.RomanceFamily && W.NpcCommandWheel && W.NpcRapport?.adjustRomance, 'all modules install');

// ── Romance pool + midnight conversion ──────────────────────────────────
relState('tooth_hatayap').favor = 100; // 2.5 hearts
assert.equal(W.NpcRapport.adjustRomance('tooth_hatayap', 1000, 'test'), 400, 'Romance is capped at romanceMax (400)');
assert.equal(W.NpcRapport.adjustRomance('tooth_hatayap', -2000, 'test'), -500, 'Romance can fall to its -100 floor');
assert.equal(W.NpcRapport.getRomance('tooth_hatayap'), -100);
W.NpcRapport.adjustRomance('tooth_hatayap', 160, 'test'); // → 60
clock.rawDay = 11;
W.NpcRapport.get('tooth_hatayap'); // Any read settles the previous day.
assert.equal(relState('tooth_hatayap').favor, 130, '60 Romance settles into +30 Favor (5x the 10% Rapport rate)');
assert.equal(W.NpcRapport.getRomance('tooth_hatayap'), 0, 'Romance resets at midnight like Rapport');
W.NpcRapport.adjustRomance('tooth_hatayap', -40, 'test');
clock.rawDay = 12;
W.NpcRapport.get('tooth_hatayap');
assert.equal(relState('tooth_hatayap').favor, 110, 'negative Romance settles into lost Favor');

// ── Stub walkers + game deps ────────────────────────────────────────────
function makeWalker(rec, area, x, z) {
  return {
    rec, area, catchup: 1, root: { position: { x, y: 0, z }, scale: { x: 1, setScalar(v) { this.x = v; } }, rotation: { z: 0 } },
    transferToArea(nextArea, spot) { this.area = nextArea; this.root.position.x = spot.c + 0.5; this.root.position.z = spot.r + 0.5; },
  };
}
const npcWalkers = [];
const tooth = makeWalker({ id: 'tooth_hatayap', name: 'Tooth Hatayap', relationship: { canDate: true, canMarry: true }, avatarEditor: { rawExport: { appearance: { speciesId: 'engh-sho', gender: 'female', bodyColors: { A: { h: 10, s: 0, v: 0 }, B: { h: 20, s: 0, v: 0 }, C: { h: 30, s: 0, v: 0 } } } } } }, 'town', 20.5, 20.5);
const hunundi = makeWalker({ id: 'father_hunundi_hodu', name: 'Father Hunundi Hodu' }, 'map_i_temple', 5.5, 5.5);
const plain = makeWalker({ id: 'kzubug', name: 'Kzubug', relationship: { canDate: false } }, 'town', 30.5, 30.5);
npcWalkers.push(tooth, hunundi, plain);
const player = { x: 21.5, z: 20.5, area: 'town' };
const opened = [];
const toasts = [];
let nearby = tooth;
const interior = [{ id: 'bed1', key: 'doubleBed', area: 'interior', col: 4, row: 4, rotYDeg: 0 }];
W.NpcPathfinding = { isNpcTileWalkable: () => true };
W.HousePieces = { debugPieceFeatures: () => [{ id: 'house', features: [{ type: 'entrance', doorTile: '10,10', approachTile: '10,11' }] }] };
W.NpcScheduling.init({ npcWalkers, normalizeNpcArea: a => a, isBuildingArea: () => false, buildingScenes: new Map(), loadBuildingScene() {}, getSharedSchedules: () => [], getWorldNpcPaths: () => [], calendar: { day: 1, time01: 0 } });
W.__hobunjiPlayerProfile = { nickname: 'Pell', appearance: { speciesId: 'engh-sho', gender: 'male', bodyColors: { A: { h: 100, s: 0, v: 0 }, B: { h: 110, s: 0, v: 0 }, C: { h: 120, s: 0, v: 0 } } } };

W.RomanceSystem.init({
  npcWalkers,
  getNpcRecord: id => npcWalkers.find(w => w.rec.id === id)?.rec || null,
  getCurrentArea: () => player.area,
  normalizeNpcArea: a => a,
  canHostNpc: () => true,
  getPlayerTilePosition: () => ({ x: player.x, z: player.z }),
  isDialogueOpen: () => false,
  showToast: (message, good) => toasts.push({ message, good }),
  openNpcDialogue: walker => opened.push({ walker, node: null }),
  openDialogueNode: (walker, node) => { opened.push({ walker, node }); return true; },
  getInteriorFurniture: () => interior,
  furniture: { placeInteriorFixture: key => { const obj = { id: 'basket1', key, area: 'interior', col: 6, row: 6 }; interior.push(obj); return { id: obj.id, col: 6, row: 6 }; }, removeInteriorFurniture: id => { const i = interior.findIndex(o => o.id === id); if (i >= 0) interior.splice(i, 1); return i >= 0; } },
  spawnNpcRecord: async (rec, target) => { const w = makeWalker(rec, target.area, target.c + 0.5, target.r + 0.5); npcWalkers.push(w); return w; },
  saveMemberWorldData() {},
});
const tick = () => W.RomanceSystem._test.tick();
const choose = (stepIndex, choiceIndex) => W.DialogueContent.handlers.romance({ op: 'choose', step: stepIndex, choice: choiceIndex });

// ── Asking out ──────────────────────────────────────────────────────────
relState('tooth_hatayap').favor = 40; // 1 heart: not enough
assert.equal(W.RomanceSystem.askEligibility('tooth_hatayap').reason, 'hearts');
relState('tooth_hatayap').favor = 120; // 3 hearts
assert.equal(W.RomanceSystem.askEligibility('tooth_hatayap').ok, true);
assert.equal(W.RomanceSystem.askEligibility('kzubug').ok, false, 'non-romanceable NPCs cannot be asked out');
W.RomanceSystem.askOnDate(tooth);
assert.equal(opened.at(-1).node.type, 'choice', 'asking out opens a synthetic dialogue choice');
choose(0, 0); // "Follow me."
assert.equal(W.RomanceSystem.activeDate()?.npcId, 'tooth_hatayap', 'accepting starts the date');
assert.equal(W.RomanceSystem.dateHoursLeft(), 4, 'dates last the configured in-game hours');

// ── Likes / non-likes / losses ──────────────────────────────────────────
const romance = () => W.NpcRapport.getRomance('tooth_hatayap');
W.HobunjiActivityEvents.emit('fish_caught', {});
assert.equal(romance(), 14, 'a liked activity nearby grants base Romance');
W.HobunjiActivityEvents.emit('fish_caught', {});
assert.equal(romance(), 14, 'the same like is on cooldown within a few in-game minutes');
clock.hour += 0.2;
W.HobunjiActivityEvents.emit('fish_caught', {});
assert.equal(romance(), 22, 'repeats decay (14 × 0.6 ≈ 8)');
W.HobunjiActivityEvents.emit('tree_felled', {});
assert.equal(romance(), 22, 'activities the NPC does not care about change nothing');
W.HobunjiActivityEvents.emit('drink_accepted', { npcId: 'kzubug' });
assert.equal(romance(), 22, 'a drink offered to someone else is not a like');
W.HobunjiActivityEvents.emit('drink_accepted', { npcId: 'tooth_hatayap' });
assert.equal(romance(), 36, 'being offered a drink is a targeted like');
W.HobunjiActivityEvents.emit('creature_killed', { isBarbarian: true });
assert.equal(romance(), 16, 'killing a barbarian is one of Tooth\'s loss triggers (-20), not a like');
W.HobunjiActivityEvents.emit('creature_killed', { isBarbarian: false, isPredator: true });
assert.equal(romance(), 30, 'killing anything else is a like for Tooth');
player.x = 60;
clock.hour += 0.2;
W.HobunjiActivityEvents.emit('creature_killed', { isBarbarian: false });
assert.equal(romance(), 30, 'the date must be close enough to notice');
player.x = 21.5;

// ── Follow / wait ───────────────────────────────────────────────────────
let target = W.RomanceSystem._test.scheduleOverride(tooth.rec);
assert.equal(target.area, 'town');
assert.equal(target.activity, 'following you');
assert.equal(W.NpcScheduling.resolveNpcScheduleTarget(tooth.rec).overrideOwner, 'romance', 'date targets take over the NPC schedule');
player.x = 30.5; player.z = 20.5;
target = W.RomanceSystem._test.scheduleOverride(tooth.rec);
assert.ok(Math.abs(target.c + 0.5 - 30.5) <= 2.5 && target.c < 30, 'a following date stops a little behind the player');
player.area = 'farm';
tick();
assert.equal(tooth.area, 'farm', 'following dates hop areas with the player');
W.RomanceSystem.setDateMode('wait');
player.area = 'town';
target = W.RomanceSystem._test.scheduleOverride(tooth.rec);
assert.equal(target.area, 'farm');
assert.equal(target.activity, 'waiting for you');
tick();
assert.equal(tooth.area, 'farm', 'waiting dates stay put');

// ── Expiry while left waiting elsewhere ─────────────────────────────────
const beforeAbandon = romance();
clock.hour += 5;
tick();
assert.equal(W.RomanceSystem.activeDate(), null, 'the date ends when its time limit runs out');
assert.equal(romance(), beforeAbandon - 25, 'leaving them waiting elsewhere is a loss');
assert.equal(W.RomanceSystem.snapshot().dateCounts.tooth_hatayap, 1);

// ── Wheel options ───────────────────────────────────────────────────────
const ids = list => JSON.parse(JSON.stringify(list.map(o => o.id))); // Plain arrays: vm-realm arrays fail deepStrictEqual.
let options = ids(W.RomanceSystem.commandOptionsFor(tooth));
assert.deepEqual(options, ['talk', 'date'], 'off-date romanceable NPCs offer Talk + Ask on a Date');
assert.deepEqual(ids(W.RomanceSystem.commandOptionsFor(plain)), [], 'other NPCs keep plain Talk (no wheel)');
clock.rawDay = 13; clock.hour = 10;
W.RomanceSystem.startDate('tooth_hatayap');
player.area = 'farm'; player.x = 21.5; player.z = 20.5; tooth.root.position.x = 20.5; tooth.root.position.z = 20.5;
options = ids(W.RomanceSystem.commandOptionsFor(tooth));
assert.deepEqual(options, ['talk', 'follow', 'wait', 'dismiss', 'propose']);
W.RomanceSystem.dismissDate();
assert.ok(toasts.some(t => /cut the date short/.test(t.message)), 'dismissing early costs Romance');

// ── Proposal → wedding → spouse routine ─────────────────────────────────
relState('tooth_hatayap').favor = 400; // 10 hearts
W.RomanceSystem._test.getState().dateCounts.tooth_hatayap = 3;
clock.rawDay = 14;
W.RomanceSystem.startDate('tooth_hatayap');
assert.equal(W.RomanceSystem.canPropose('tooth_hatayap'), true);
W.RomanceSystem.propose(tooth);
choose(0, 0); // "Will you marry me?" → step 1
choose(1, 0); // "I'll be there."
assert.equal(W.RomanceSystem.getEngagement()?.npcId, 'tooth_hatayap');
assert.equal(W.RomanceSystem.activeDate(), null, 'getting engaged ends the date');
W.RomanceSystem.completeWedding('tooth_hatayap');
assert.equal(W.RomanceSystem.getSpouse()?.npcId, 'tooth_hatayap');
clock.hour = 23;
target = W.RomanceSystem._test.scheduleOverride(tooth.rec);
assert.equal(target.area, 'interior');
assert.equal(target.activity, 'sleeping', 'the spouse sleeps in the farmhouse bed');
W.NpcScheduling.registerNpcStations([{ id: 'chair_1', area: 'interior', c: 2, r: 2, pose: 'sit', furnitureKey: 'chairSimple', roles: ['sit'] }], 'interior');
const daytime = new Set();
for (let h = 7; h < 22; h += 0.5) { clock.hour = h; const t = W.RomanceSystem._test.scheduleOverride(tooth.rec); daytime.add(t ? t.activity : 'town'); }
assert.ok(daytime.has('relaxing at home'), 'the spouse sits in the farmhouse chairs during the day');

// ── Family ──────────────────────────────────────────────────────────────
const fam = W.RomanceFamily._test;
assert.equal(fam.resolveKind('tooth_hatayap'), 'spouse_live', 'male player + female spouse of the same species → spouse pregnancy');
W.__hobunjiPlayerProfile.appearance.speciesId = 'kenkari';
assert.equal(fam.resolveKind('tooth_hatayap'), 'adoption', 'different species → adoption dream');
W.__hobunjiPlayerProfile.appearance.speciesId = 'engh-sho';
clock.hour = 12;
W.RomanceFamily.tick();
const plan = W.RomanceFamily.snapshot().pregnancy;
assert.equal(plan.dueRawDay - plan.announceRawDay, 84, 'announcement at 3 months, birth at 6 months');
const mixed = fam.mixedColors({ A: { h: 0, s: 0, v: 0 }, B: { h: 0, s: 0, v: 0 }, C: { h: 0, s: 0, v: 0 } }, { A: { h: 200, s: 0, v: 0 }, B: { h: 200, s: 0, v: 0 }, C: { h: 200, s: 0, v: 0 } });
for (const channel of ['A', 'B', 'C']) assert.ok(Math.abs(mixed[channel].h) <= 6 || Math.abs(mixed[channel].h - 200) <= 6, 'mixed babies take each color from one parent');

const child = W.RomanceFamily.createChild({ name: 'Pip', speciesId: 'engh-sho', gender: 'female', bodyColors: mixed, origin: 'birth', otherParentId: 'tooth_hatayap' });
assert.equal(child.basketId, 'basket1', 'newborns get a baby basket in the house');
assert.equal(fam.phaseOf(child), 'basket');
assert.equal(fam.childTarget(child).activity, 'napping in the basket');
clock.rawDay += 28;
assert.equal(fam.phaseOf(child), 'toddler');
assert.equal(fam.toddlingFooting(child), 99, 'Toddling Footing starts at 99');
clock.rawDay += 70;
assert.equal(fam.toddlingFooting(child), 50, 'Toddling Footing eases toward 0 over 5 months');
W.RomanceFamily.tick();
assert.ok(!interior.some(o => o.id === 'basket1'), 'the basket is removed once the baby starts toddling');
clock.rawDay += 70;
assert.equal(fam.phaseOf(child), 'child');
assert.equal(fam.toddlingFooting(child), 0);
clock.hour = 12;
assert.equal(fam.childTarget(child).area, 'farm', 'grown children leave the house during the day');

// ── Hold-Action-1 wheel claim ───────────────────────────────────────────
W.NpcCommandWheel.init({ getNearbyNpcWalker: () => nearby, isDialogueOpen: () => false, isMenuOpen: () => false, isFarmEditMode: () => false, openNpcDialogue: walker => opened.push({ walker, node: null, tap: true }) });
W.NpcCommandWheel._test.syncClaims();
assert.equal(W.WorldActionInputClaims.claimFor('action1')?.ownerId, 'npc-command-wheel', 'facing a romanceable NPC claims Action 1');
const before = opened.length;
W.WorldActionInputClaims.dispatch('action1', 'press');
W.WorldActionInputClaims.dispatch('action1', 'release');
assert.equal(opened.length, before + 1, 'a tap still opens ordinary Talk');
assert.ok(opened.at(-1).tap);
timeouts.length = 0;
W.WorldActionInputClaims.dispatch('action1', 'press');
const holdTimer = timeouts.find(t => t.ms === W.NpcCommandWheel._test.HOLD_MS);
assert.ok(holdTimer, 'a press arms the hold timer');
holdTimer.fn();
assert.equal(W.NpcCommandWheel.isOpen(), true, 'holding opens the command wheel');
W.WorldActionInputClaims.dispatch('action1', 'release');
assert.equal(W.NpcCommandWheel.snapshot().latched, true, 'releasing with nothing selected leaves the wheel open to tap a slice');
W.NpcCommandWheel.select(0);
W.NpcCommandWheel.commit();
assert.equal(W.NpcCommandWheel.isOpen(), false);
nearby = plain;
W.NpcCommandWheel._test.syncClaims();
assert.equal(W.WorldActionInputClaims.claimFor('action1'), null, 'NPCs with no commands leave Action 1 unclaimed');

// ── Save round-trip ─────────────────────────────────────────────────────
const saved = JSON.parse(JSON.stringify(W.RomanceSystem.serialize()));
W.RomanceSystem.restore(null);
assert.equal(W.RomanceSystem.getSpouse(), null);
W.RomanceSystem.restore(saved);
assert.equal(W.RomanceSystem.getSpouse()?.npcId, 'tooth_hatayap');
assert.equal(W.RomanceFamily.snapshot().children[0]?.name, 'Pip', 'children survive a save/load');

console.log('romance dating/marriage/family tests passed');

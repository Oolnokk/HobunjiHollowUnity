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
const devPanels = new Map(); // Captures registered companion panels so timing/arrival status can be tested without opening a popup.
const windowStub = {
  DevCompanion: { registerPanel(spec) { devPanels.set(spec.id, spec); return true; } },
  __hobunjiGameStarted: true,
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
run('docs/js/npc-following.js');
run('docs/js/romance-system.js');
run('docs/js/npc-command-wheel.js');

const W = windowStub;
W.SCRATCHBONES_CONFIG.game.socialRelationships.relationships = []; // Live relation graph for newly born village children.
const socialReplies=[]; // Acceptance and refusal must use ordinary ambient chatheads without changing date eligibility.
W.AmbientDialogue={showSocialResponse:(walker,response)=>socialReplies.push({id:walker.rec.id,...response})};
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
let combatOn = false; // A live combat gate for Talk/Commands claims and active wheel cancellation.
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

const familyPanel = devPanels.get('family-arrivals'); // Actual panel registration is exercised by RomanceSystem.init.
assert.ok(familyPanel, 'family arrivals register in the existing Dev Companion Now panels');
assert.equal(familyPanel.when(), true, 'the panel is shown after game start');
assert.match(familyPanel.render().summary, /No family arrival scheduled/, 'before marriage no due date is invented');
assert.match(read('docs/index.html'), /js\/romance-family\.js\?v=[A-Za-z0-9_-]+/, 'the game loads the family module with a versioned cache token');
W.__hobunjiGameStarted = false;
assert.equal(familyPanel.when(), false, 'the Dev Companion panel is not shown before the game starts');
W.__hobunjiGameStarted = true;

// ── Asking out ──────────────────────────────────────────────────────────
relState('tooth_hatayap').favor = 40; // 1 heart: not enough
assert.equal(W.RomanceSystem.askEligibility('tooth_hatayap').reason, 'hearts');
assert.equal(W.RomanceSystem.askOnDate(tooth),false);
assert.equal(socialReplies.at(-1).accepted,false,'date refusal appears as ambient speech');
relState('tooth_hatayap').favor = 120; // 3 hearts
assert.equal(W.RomanceSystem.askEligibility('tooth_hatayap').ok, true);
assert.equal(W.RomanceSystem.askEligibility('kzubug').ok, false, 'non-romanceable NPCs cannot be asked out');
W.RomanceSystem.askOnDate(tooth);
assert.equal(opened.at(-1).node.type, 'choice', 'asking out opens a synthetic dialogue choice');
choose(0, 0); // "Follow me."
assert.equal(socialReplies.at(-1).accepted,true,'confirmed date acceptance appears as ambient speech');
assert.equal(W.RomanceSystem.activeDate()?.npcId, 'tooth_hatayap', 'accepting starts the date');
assert.equal(W.RomanceSystem.dateHoursLeft(), 4, 'dates last the configured in-game hours');
const normalDateTarget = W.NpcScheduling.resolveNpcScheduleTarget(tooth.rec); // Establish the existing dating precedence before a stage gathering begins.
assert.equal(normalDateTarget.overrideOwner,'romance','an active date supplies the normal NPC destination');
W.NpcScheduling.registerTargetOverride('test-five-blossoms-stage',rec =>
  rec.id === tooth.rec.id ? {area:'town',c:11,r:12,pose:'stand',activity:'watching the crowning'} : null,100); // Temporary ceremony must outrank earlier social providers.
assert.equal(W.NpcScheduling.resolveNpcScheduleTarget(tooth.rec).overrideOwner,'test-five-blossoms-stage','the ceremony audience overrides an active date');
W.NpcScheduling.registerTargetOverride('test-five-blossoms-stage',null);
assert.equal(W.NpcScheduling.resolveNpcScheduleTarget(tooth.rec).overrideOwner,'romance','the NPC resumes the active date when the ceremony releases them');

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

// Real deaths go through emitCreatureKilled: only the player's own kills are
// announced, and a barbarian that was hostile and attacked first is self-defense.
W.PlayerDowned = { isTeamKill: c => c.playerKill === true };
W.PorakanekiFactionRules = { killedInSelfDefense: c => c.hostileFirst === true };
clock.hour += 0.2;
assert.equal(W.HobunjiActivityEvents.emitCreatureKilled({ isTribeHunter: true, isBandit: true, playerKill: false }), false, 'an NPC battle nearby is not announced as the player\'s kill');
assert.equal(romance(), 30, 'barbarians killing each other near a date cost nothing');
W.HobunjiActivityEvents.emitCreatureKilled({ isTribeHunter: true, isBandit: true, playerKill: true, hostileFirst: true });
assert.equal(romance(), 30, 'killing a barbarian that attacked first is neither a loss nor a bandit-kill like');
W.HobunjiActivityEvents.emitCreatureKilled({ isTribeHunter: true, isBandit: true, playerKill: true });
assert.equal(romance(), 10, 'killing a barbarian unprovoked is still a loss');
delete W.PlayerDowned;
delete W.PorakanekiFactionRules;

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
assert.ok(toasts.some(t => /Life Temple from tomorrow/.test(t.message)), 'default one-day delay reads "from tomorrow"');
// Calling it off: offered on the wheel, confirmed in dialogue, costs Romance, frees the player.
assert.ok(ids(W.RomanceSystem.commandOptionsFor(tooth)).includes('break_engagement'), 'the fiancé offers Call Off Wedding');
W.RomanceSystem.commandOptionsFor(tooth).find(o => o.id === 'break_engagement').run();
choose(0, 1); // "No, forget I said anything."
assert.equal(W.RomanceSystem.getEngagement()?.npcId, 'tooth_hatayap', 'declining the confirmation keeps the engagement');
W.RomanceSystem.commandOptionsFor(tooth).find(o => o.id === 'break_engagement').run();
choose(0, 0);
assert.equal(W.RomanceSystem.getEngagement(), null, 'confirming calls off the engagement');
assert.ok(toasts.some(t => /broke off the engagement/.test(t.message)), 'calling it off costs Romance');
assert.ok(!ids(W.RomanceSystem.commandOptionsFor(tooth)).includes('break_engagement'), 'no engagement, no Call Off option');
relState('tooth_hatayap').favor = 400; // Restore hearts for the re-proposal below.
clock.rawDay = 15;
W.RomanceSystem.startDate('tooth_hatayap');
W.RomanceSystem.propose(tooth);
choose(0, 0);
choose(1, 0);
assert.equal(W.RomanceSystem.getEngagement()?.npcId, 'tooth_hatayap', 'the player may propose again after calling it off');
W.RomanceSystem.completeWedding('tooth_hatayap');
assert.equal(W.RomanceSystem.getSpouse()?.npcId, 'tooth_hatayap');
clock.hour = 23;
target = W.RomanceSystem._test.scheduleOverride(tooth.rec);
assert.equal(target.area, 'interior');
assert.equal(target.activity, 'sleeping', 'the spouse sleeps in the farmhouse bed');
assert.equal(target.pose, 'lie', 'the real spouse schedule requests the lie-down presentation');
assert.deepEqual([target.bedCol, target.bedRow], [4, 4], 'spouse sleep retains the bed origin independently of its navigation tile');
assert.equal(target.furnitureId, 'bed1', 'spouse sleep resolves the exact placed bed instance');
W.NpcScheduling.registerNpcStations([{ id: 'chair_1', area: 'interior', c: 2, r: 2, pose: 'sit', furnitureKey: 'chairSimple', roles: ['sit'] }], 'interior');
const daytime = new Set();
for (let h = 7; h < 22; h += 0.5) { clock.hour = h; const t = W.RomanceSystem._test.scheduleOverride(tooth.rec); daytime.add(t ? t.activity : 'town'); }
assert.ok(daytime.has('relaxing at home'), 'the spouse sits in the farmhouse chairs during the day');
const townCfg = W.SCRATCHBONES_CONFIG.game.romance.spouse.townAfternoon;
const oldTownMod = townCfg.daysOfWeekMod;
townCfg.daysOfWeekMod = 1; // Legacy visit cadence must not displace an actual family fieldwork shift.
clock.hour = 14;
assert.equal(W.RomanceSystem.spouseTownVisitNow('tooth_hatayap'), true, 'shared town visit eligibility is available to the Ginju work planner');
const plotTarget = { area: 'farm', c: 12, r: 14, activity: 'tilling family plot' };
let plotLookups = 0;
W.NpcFarmPlots = { targetFor(_rec, options) { plotLookups++; assert.equal(options?.familyOnly, true); return plotTarget; } };
assert.equal(W.RomanceSystem._test.scheduleOverride(tooth.rec)?.activity, plotTarget.activity, 'assigned family farmwork wins even when the old town visit cadence matches');
assert(plotLookups > 0, 'farmwork is consulted before choosing ordinary work');
assert.equal(W.RomanceSystem.spouseTownVisitNow('tooth_hatayap'), false, 'a current family job suppresses ordinary town work');
clock.hour = 11;
assert.equal(W.RomanceSystem.spouseTownVisitNow('tooth_hatayap'), false);
assert.equal(W.RomanceSystem._test.scheduleOverride(tooth.rec)?.activity, plotTarget.activity, 'morning assigned chores beat idle farm routines');
clock.hour = 23;
assert.equal(W.RomanceSystem.spouseTownVisitNow('tooth_hatayap'), false);
assert.equal(W.RomanceSystem._test.scheduleOverride(tooth.rec)?.activity, 'sleeping', 'bedtime beats assigned family plot jobs');
delete W.NpcFarmPlots;
clock.hour = 14;
assert.equal(W.RomanceSystem.spouseTownVisitNow('tooth_hatayap'), true, 'the spouse returns to their profession once the family shift finishes');
assert.equal(W.RomanceSystem._test.scheduleOverride(tooth.rec), null, 'free daytime hours release the NPC authored agenda');
townCfg.daysOfWeekMod = oldTownMod;


// ── Family ──────────────────────────────────────────────────────────────
const fam = W.RomanceFamily._test;
assert.equal(fam.resolveKind('tooth_hatayap'), 'spouse_live', 'male player + female spouse of the same species → spouse pregnancy');
W.__hobunjiPlayerProfile.appearance.speciesId = 'kenkari';
assert.equal(fam.resolveKind('tooth_hatayap'), 'adoption', 'different species → adoption dream');
W.__hobunjiPlayerProfile.appearance.speciesId = 'engh-sho';
clock.hour = 12;
W.RomanceFamily.tick();
const plan = W.RomanceFamily.snapshot().pregnancy;
assert.equal(plan.dueRawDay - plan.announceRawDay, 28, 'pregnancy lasts one 28-day month');
assert.match(familyPanel.render().summary, /Birth due in 112 game days/, 'birth countdown uses the actual wedding-based due day');
assert.match(familyPanel.render().rows.find(([key]) => key === 'Delivery trigger')[1], /Farmhouse sleep/, 'due dates never claim an automatic birth');
assert.match(familyPanel.render().rows.find(([key]) => key === 'Earliest arrival')[1], /Game day/, 'the due date also has a readable fallback when the calendar formatter is unavailable');
const actualFamilyPlan = fam.getFamily().pregnancy; // Exercise incomplete saves without changing the real pregnancy schedule after assertions.
actualFamilyPlan.kind = 'spouse_egg';
assert.match(familyPanel.render().summary, /Egg hatching due/, 'Kenkari egg hatchings are distinguished from live births');
actualFamilyPlan.kind = null;
assert.match(familyPanel.render().summary, /plan needs attention/, 'missing saved event type produces a useful diagnostic instead of throwing');
actualFamilyPlan.kind = 'spouse_live';
actualFamilyPlan.dueRawDay = null;
assert.match(familyPanel.render().summary, /date unavailable/, 'missing due day does not silently become game day zero');
actualFamilyPlan.dueRawDay = plan.dueRawDay;
clock.rawDay = plan.dueRawDay + 3;
assert.match(familyPanel.render().summary, /Birth due — sleep required/, 'overdue pregnancies remain due until farmhouse sleep');
clock.rawDay = W.RomanceSystem.getSpouse().marriedRawDay;
assert.equal(plan.dueRawDay - W.RomanceSystem.getSpouse().marriedRawDay, 112, 'first child is due four months after the wedding');
assert.equal(W.RomanceFamily.usefulnessInfo('tooth_hatayap').level, 2, 'spouse starts at usefulness rank two');
assert.equal(W.RomanceFamily.usefulnessInfo('tooth_hatayap').intelligenceMultiplier, 1, 'adult intelligence grants full XP');
const realWorkRandom = Math.random;
Math.random = () => 0.5;
assert.equal(W.RomanceFamily.rollWorkQuality('tooth_hatayap'), 2, 'spouse default harvest quality is two stars');
Math.random = realWorkRandom;
const mixed = fam.mixedColors({ A: { h: 0, s: 0, v: 0 }, B: { h: 0, s: 0, v: 0 }, C: { h: 0, s: 0, v: 0 } }, { A: { h: 200, s: 0, v: 0 }, B: { h: 200, s: 0, v: 0 }, C: { h: 200, s: 0, v: 0 } });
for (const channel of ['A', 'B', 'C']) assert.ok(Math.abs(mixed[channel].h) <= 6 || Math.abs(mixed[channel].h - 200) <= 6, 'mixed babies take each color from one parent');

const child = W.RomanceFamily.createChild({ name: 'Pip', speciesId: 'engh-sho', gender: 'female', bodyColors: mixed, origin: 'birth', otherParentId: 'tooth_hatayap' });
assert.equal(child.basketId, 'basket1', 'newborns get a baby basket in the house');
assert.ok(W.SCRATCHBONES_CONFIG.game.socialRelationships.relationships.some(link =>
  link.type === 'friend' && link.members.includes(child.id) && link.members.includes('gantami_ginju')), 'family child joins Gantami friendship network');
assert.equal(fam.phaseOf(child), 'basket');
assert.equal(W.RomanceFamily.usefulnessInfo(child.id), null, 'newborns cannot work or earn XP');
assert.equal(fam.childTarget(child).activity, 'napping in the basket');
let childRec = fam.childRecord(child);
assert.equal(childRec.role, 'child', 'family children use the shared child marker (PNGPlaneAvatar.isChildAvatar)');
assert.ok(childRec.childHeadScale > childRec.childBodyScale, 'babies: the head shrinks less than the body');
clock.rawDay += 28;
assert.equal(fam.phaseOf(child), 'toddler');
assert.equal(W.RomanceFamily.usefulnessInfo(child.id).intelligenceMultiplier, 0.25, 'toddlers gain one-quarter XP');
clock.hour = 11;
assert.equal(fam.childTarget(child).area, 'farm', 'toddlers leave the basket but never leave their farm');
assert.equal(W.RomanceFamily.rollWorkQuality(child.id), 1, 'untrained toddlers produce one-star goods');
assert.equal(W.RomanceFamily.awardWork(child.id, 'till').xp, 1.5, 'toddler work trains the one shared stat at quarter rate');
assert.equal(fam.toddlingFooting(child), 99, 'Toddling Footing starts at 99');
clock.rawDay += 70;
assert.equal(fam.toddlingFooting(child), 50, 'Toddling Footing eases toward 0 over 5 months');
W.RomanceFamily.tick();
assert.ok(!interior.some(o => o.id === 'basket1'), 'the basket is removed once the baby starts toddling');
clock.rawDay += 70;
assert.equal(fam.phaseOf(child), 'child');
assert.equal(W.RomanceFamily.usefulnessInfo(child.id).intelligenceMultiplier, 0.5, 'children gain half XP without a level reset');
assert.equal(W.RomanceFamily.awardWork(child.id, 'till').xp, 4.5, 'work gained as a toddler carries into childhood');
childRec = fam.childRecord(child);
assert.equal(childRec.childBodyScale, undefined, 'grown children use the shared config child proportions, like Gantami');
assert.equal(fam.toddlingFooting(child), 0);
clock.hour = 12;
assert.equal(fam.childTarget(child).area, 'farm', 'grown children leave the house during the day');
assert.ok(childRec.tags.includes('villager'), 'grown children participate in villager social schedules');
const townRules = W.SCRATCHBONES_CONFIG.game.romance.family.childTown; // Force deterministic town social tests without relying on day hashes.
townRules.visitPercent = 100;
townRules.peerMeetPercent = 100;
const gantami = makeWalker({ id: 'gantami_ginju', name: 'Gantami Ginju', isChild: true }, 'town', 14.5, 18.5);
npcWalkers.push(gantami);
const townTarget = fam.childTarget(child);
assert.equal(townTarget.area, 'town', 'grown children spend some afternoons in town');
assert.match(townTarget.activity, /Gantami/, 'a present Gantami is the preferred town playmate');
child.vatId = 'pending-vat-job';
assert.equal(fam.childTarget(child).area, 'farm', 'vat assignments prevent unsupervised town trips');
child.vatId = null;
townRules.visitPercent = 0; // Restore farm behavior for the rest of the test.

// ── Spouses cannot work the vat; toddlers/children still can ──────────
const vatAssignments = new Map(); // Records real assignment writes for the child's single available vat.
let childVatJob = null; // Controlled timed batch for the pre-shift and offscreen expiry tests.
W.DewVats = {
  listSqueezingVats: () => [{ id: 'child_vat', col: 10, row: 9, getJob: () => childVatJob }],
  assignedWorkerForVat: id => vatAssignments.get(id) || null,
  setExternalWorker(id, worker) {
    if (worker) vatAssignments.set(id, { ...worker, external: true });
    else vatAssignments.delete(id);
    return true;
  },
};
const childWalker = makeWalker(fam.childRecord(child), 'farm', 10.5, 10.5); // Grown child's real command path.
const vatCommand = (walker, id) => W.RomanceSystem.commandOptionsFor(walker).find(option => option.id === id); // Resolve via the production NPC wheel owner.
assert.equal(vatCommand(tooth, 'vat'), undefined, 'spouse never receives Work the Vat');
assert.equal(vatCommand(tooth, 'unvat'), undefined, 'spouse never receives Stop Vat Work');
assert.ok(W.RomanceSystem.commandOptionsFor(tooth).some(option => option.id === 'spouse_kiss'), 'removing vat work preserves spouse commands');
assert.equal(W.RomanceFamily.isAssignedToVat(tooth.rec.id), false, 'spouse cannot be classified as a vat worker');
assert.ok(vatCommand(childWalker, 'vat'), 'grown children can still accept vat assignments');
vatCommand(childWalker, 'vat').run();
assert.equal(vatAssignments.get('child_vat')?.id, child.id, 'child occupies the available vat');
assert.equal(W.RomanceFamily.isAssignedToVat(child.id), true, 'child vat work still takes priority over assigned plots');
assert.equal(socialReplies.at(-1).line, "I'll work at the squeezing vat!", 'child acceptance keeps the normal child speech');
assert.equal(vatCommand(tooth, 'vat'), undefined, 'spouse remains ineligible while a child vat is occupied');
// The real processor delegates to FarmAnimals; verify the actual child pose,
// logical pathing coordinates, and the shared cleanup route without a browser.
run('docs/js/creature-texture-cache.js');
run('docs/js/farm-animals.js');
run('docs/js/character-action-locks.js');
W.FarmAnimals.init({ animalObjects: new Set(), loadWorldLivestock: () => [] });
class VatMatrix {
  constructor(x = 0, y = 0, z = 0, sy = 1) { Object.assign(this, { x, y, z, sy }); }
  clone() { return new VatMatrix(this.x, this.y, this.z, this.sy); }
  copy(m) { Object.assign(this, m); return this; }
  invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  multiply(m) { this.x += m.x; this.y += m.y; this.z += m.z; this.sy *= m.sy; return this; }
  decompose(p, q, s) { Object.assign(p, { x: this.x, y: this.y, z: this.z }); s.y = this.sy; return this; }
  compose(p, q, s) { Object.assign(this, { x: p.x, y: p.y, z: p.z, sy: s.y }); return this; }
}
const liveChild = npcWalkers.find(w => w.rec.id === child.id) || childWalker;
const addedChild = !npcWalkers.includes(liveChild);
if (addedChild) npcWalkers.push(liveChild);
const savedRoot = liveChild.root, savedArea = liveChild.area, savedTarget = liveChild.currentScheduleTarget, savedPlayerArea = player.area;
const savedShadow = liveChild.groundShadow;
const vatTarget = fam.childTarget(child);
const savedPathfinding = W.NpcPathfinding; // Restore the normal romance stub after exercising real relocation.
run('docs/js/npc-pathfinding.js');
const vatGrid = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => ({ type: 'grass' }))); // Clear farm tiles for same-area and cross-area teleport regressions.
W.NpcPathfinding.init({
  npcGridForArea: () => vatGrid, isBuildingArea: () => false, isZoneArea: () => false,
  isSolid: () => false, TileType: { RIVER: 'river', STREAM: 'stream', TRENCH: 'trench' },
  worldObjects: new Map(), isHouseFootprint: () => false, furnitureBlocksMovementAt: () => false,
  npcMovementConfig: () => ({}), npcSurfaceY: () => 0,
});
liveChild.area = player.area = 'farm';
liveChild.currentScheduleTarget = vatTarget;
liveChild.groundShadow = { visible: true };
const logicalPosition = { x: vatTarget.c + 0.5, y: 0, z: vatTarget.r + 0.5, set(x,y,z) { Object.assign(this,{x,y,z}); }, clone() { return { x: this.x, y: this.y, z: this.z }; } };
liveChild.root = {
  position: logicalPosition, quaternion: { clone: () => ({}) },
  scale: { x: 1, y: 1, z: 1, clone() { return { x: this.x, y: this.y, z: this.z }; } },
  matrix: new VatMatrix(), matrixAutoUpdate: true, visible: true,
  parent: { matrixWorld: new VatMatrix(), updateWorldMatrix() {} },
  updateMatrix() { this.matrix = new VatMatrix(this.position.x, this.position.y, this.position.z); },
};
const vatAnchor = new VatMatrix(10.5, 1.2, 9.5, 0.2);
assert.equal(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor)?.id, child.id);
assert.equal(liveChild.root.matrixAutoUpdate, false, 'child render matrix follows the stomp point');
const childParticipant = 'npc:' + child.id; // Shared movement channel is released at the end of the animation.
assert.equal(W.CharacterActionLocks.isLocked(childParticipant, 'movement'), true);
assert.equal(W.CharacterActionLocks.isLocked(childParticipant, 'actions'), false, 'the Stop Vat Work command remains available');
assert.equal(liveChild.root.matrix.y, 1.2, 'feet follow the authored animated surface height');
assert.equal(liveChild.root.matrix.sy, 1, 'cloth squash must not shrink the child');
assert.equal(liveChild.root.position.y, 0, 'logical pathing location remains on the approach tile');
assert.equal(liveChild.groundShadow.visible, false);
assert.equal(W.RomanceFamily.snapshot().children.find(c => c.id === child.id).vatStomping, true);
W.FarmAnimals.setVatWorkerPose('child_vat', new VatMatrix(10.5, 1.4, 9.5, 0.2));
assert.equal(liveChild.root.matrix.y, 1.4, 'subsequent frames animate the same worker');
assert.equal(W.CharacterActionLocks.getDebug().filter(lock => lock.owner === 'child-vat').length, 1, 'successive frames reuse the same movement lock');
const otherPose = W.CharacterActionLocks.acquire({ owner: 'other-pose', participants: [childParticipant], channels: ['pose'] });
assert.equal(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor), null, 'a competing pose releases even an already attached child');
assert.equal(W.CharacterActionLocks.isLocked(childParticipant, 'movement'), false);
assert.equal(W.CharacterActionLocks.isLocked(childParticipant, 'pose'), true, 'the competing pose is not released by vat cleanup');
otherPose.release();
assert.ok(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor));
W.FarmAnimals.clearVatWorkerPose('child_vat');
assert.equal(liveChild.root.matrixAutoUpdate, true);
assert.equal(liveChild.root.matrix.y, 0);
assert.equal(liveChild.groundShadow.visible, true);
assert.equal(W.CharacterActionLocks.isLocked(childParticipant, 'movement'), false);
liveChild.root.position.x += 2;
liveChild._npcCliffClimb = { old: true };
assert.ok(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor), 'a distant farm child joins the active animation immediately');
assert.equal(liveChild.root.position.x, vatTarget.c + 0.5, 'the logical root lands on the safe approach tile');
assert.equal(liveChild._legsPrevX, liveChild.root.position.x, 'teleport is not mistaken for a running stride');
assert.equal(liveChild._npcCliffClimb, null);
W.FarmAnimals.clearVatWorkerPose('child_vat');
liveChild.area = 'interior';
liveChild.currentScheduleTarget = { area: 'interior', c: 4, r: 4, activity: 'sleeping' };
assert.ok(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor), 'the same child transfers from inside the farmhouse');
assert.equal(liveChild.area, 'farm');
assert.equal(liveChild.currentScheduleTarget.vatId, 'child_vat');
clock.hour = 18;
assert.equal(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor), null, 'the child is released when their shift ends');
assert.equal(liveChild.root.matrixAutoUpdate, true);
clock.hour = 6;
childVatJob = { kind: 'timed', readyAtGameHour: 7 };
const savedItemProcessing = W.ItemProcessing; // Temporary clock adapter for testing an uncollected offscreen batch.
W.ItemProcessing = { gameHour: () => clock.hour };
assert.equal(fam.childTarget(child).vatId, 'child_vat', 'a rollover batch sends the assigned child to the vat before their usual shift');
assert.ok(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor), 'an arrived child animates during a pre-shift batch');
clock.hour = 7;
assert.notEqual(fam.childTarget(child).vatId, 'child_vat', 'expired offscreen jobs do not keep the child at the vat');
assert.equal(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor), null, 'expired pre-shift batch releases the render pose');
assert.equal(liveChild.root.matrixAutoUpdate, true);
W.ItemProcessing = savedItemProcessing;
childVatJob = null;
clock.hour = 12;
assert.ok(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor));
assert.equal(W.RomanceFamily.retargetVatAssignments('child_vat', 'moved_vat'), 1, 'moving the vat changes the saved child assignment');
assert.equal(child.vatId, 'moved_vat');
assert.equal(liveChild.root.matrixAutoUpdate, true, 'moving the vat releases its old pose immediately');
assert.equal(liveChild._npcScheduleDecision, null, 'the old tile schedule lease is invalidated');
assert.equal(W.RomanceFamily.retargetVatAssignments('moved_vat', 'child_vat'), 1);
assert.ok(W.FarmAnimals.setVatWorkerPose('child_vat', vatAnchor));
vatCommand(childWalker, 'unvat').run();
assert.equal(liveChild.root.matrixAutoUpdate, true, 'cancelling assignment releases an active pose immediately');
assert.equal(W.CharacterActionLocks.getDebug().filter(lock => lock.owner === 'child-vat').length, 0, 'cancelling leaves no movement lock behind');
liveChild.root = savedRoot; liveChild.area = savedArea; liveChild.currentScheduleTarget = savedTarget;
liveChild.groundShadow = savedShadow; player.area = savedPlayerArea;
W.NpcPathfinding = savedPathfinding;
if (addedChild) npcWalkers.splice(npcWalkers.indexOf(liveChild), 1);
assert.equal(socialReplies.at(-1).line, 'Okay! Time to play!', 'child work cancellation retains child speech');
assert.equal(child.vatId, null, 'stopping child work clears its saved assignment');
assert.equal(vatAssignments.size, 0, 'child vat becomes available again');
delete W.DewVats;

const previousPregnancy = fam.getFamily().pregnancy;
previousPregnancy.born = true;
previousPregnancy.awaitingChild = true; // Pending naming must block a new plan even after older siblings exist.
W.RomanceFamily.tick();
assert.equal(fam.getFamily().pregnancy, previousPregnancy, 'pending child naming prevents duplicate pregnancies');
previousPregnancy.awaitingChild = false;
W.RomanceFamily.tick();
const siblingPlan = W.RomanceFamily.snapshot().pregnancy;
assert.equal(siblingPlan.dueRawDay, child.bornRawDay + 168, 'siblings are scheduled six months apart');
assert.equal(siblingPlan.dueRawDay - siblingPlan.announceRawDay, 28, 'later pregnancies also last one month');
const savedFamily = W.RomanceFamily.serialize();
let clearedFamilyVats = 0; // Character/world changes must not leave ghost external worker assignments behind.
W.DewVats = { clearFamilyWorkers() { clearedFamilyVats++; } };
W.RomanceFamily.restore(savedFamily);
assert.equal(clearedFamilyVats, 1, 'loading a family clears stale vat worker registrations');
assert.equal(W.RomanceFamily.snapshot().children[0].usefulness.level, 1, 'child usefulness survives a save/restore cycle');
const corrupted = W.RomanceFamily.serialize();
corrupted.children[0].usefulnessLevel = 0; corrupted.children[0].usefulnessXp = -1;
corrupted.spouseUsefulness = { npcId: 'tooth_hatayap', level: 0, xp: -1 };
W.RomanceFamily.restore(corrupted);
assert.equal(W.RomanceFamily.usefulnessInfo(corrupted.children[0].id).level, 1, 'invalid saved child level is repaired safely');
assert.equal(W.RomanceFamily.usefulnessInfo('tooth_hatayap').level, 2, 'invalid saved spouse level is repaired safely');
W.RomanceFamily.restore(savedFamily);
delete W.DewVats;
const priorPlan = fam.getFamily().pregnancy; // Save the later biological plan while exercising adoption deferrals.
const dream = { spouseId: 'tooth_hatayap', kind: 'adoption', dueRawDay: clock.rawDay, announced: true, born: false };
fam.getFamily().pregnancy = dream;
const oldArea = player.area;
player.area = 'interior';
assert.equal(fam.postponeDream(1), true);
assert.equal(dream.nextDreamRawDay, clock.rawDay + 1, 'one-day postponement persists as an absolute game day');
let beforeDreamTimers = timeouts.length;
W.dispatchEvent(new context.CustomEvent('hobunji-time-passage', { detail: { kind: 'sleep' } }));
assert.equal(timeouts.length, beforeDreamTimers, 'postponed dream does not immediately reappear on sleep');
clock.rawDay += 1;
W.dispatchEvent(new context.CustomEvent('hobunji-time-passage', { detail: { kind: 'sleep' } }));
assert.equal(timeouts.length, beforeDreamTimers + 1, 'dream is offered after the postponed day and a farmhouse sleep');
assert.equal(dream.born, false, 'the dream cannot mark an adoption complete before character creation');
assert.equal(fam.postponeDream(14), true);
assert.equal(dream.nextDreamRawDay, clock.rawDay + 14, 'two-week postponement uses fourteen game days');
assert.equal(fam.postponeDream(28), true);
assert.equal(dream.nextDreamRawDay, clock.rawDay + 28, 'one-month postponement uses the 28-day calendar');
assert.match(familyPanel.render().summary, /Adoption dream in 28 game days/, 'postponement updates the displayed arrival countdown');
const beforeDreamCountdownCheck = clock.rawDay; // Restores the same simulated day after checking the overdue dream state.
clock.rawDay = dream.nextDreamRawDay + 1;
assert.match(familyPanel.render().summary, /Adoption dream eligible/, 'the panel distinguishes a ready dream from an arriving visitor');
clock.rawDay = beforeDreamCountdownCheck;
fam.getFamily().pendingAdoption = { spouseId: 'tooth_hatayap' }; // A finished dream queues Father Hunundi without an exact timestamp.
assert.match(familyPanel.render().summary, /Adoption visit queued/, 'finished dream reports the queued doorstep visit');
assert.match(familyPanel.render().note, /Exit the farmhouse/, 'the visitor depends on a farmhouse exit');
W.DoorstepVisits = {
  activeVisitKey: () => null,
  debugSnapshot: () => ({ lastSpawnAttempt: { key: 'romance_adoption', reason: 'No valid farmhouse entrance was found.' } }),
}; // The real doorstep system stores matching failed attempts so mobile tests can inspect the blocker.
assert.match(familyPanel.render().rows.find(([key]) => key === 'Last spawn attempt')[1], /No valid farmhouse entrance/, 'the real failure reason is visible on the family panel');
W.DoorstepVisits.debugSnapshot = () => ({ lastSpawnAttempt: { key: 'unrelated_visit', reason: 'Other failure' } });
assert.ok(!familyPanel.render().rows.some(([key]) => key === 'Last spawn attempt'), 'an unrelated visitor failure is not attributed to the adoption');
W.DoorstepVisits.activeVisitKey = () => 'romance_adoption'; // Tests the already-spawned visitor separately from merely scheduled visits.
assert.match(familyPanel.render().summary, /visitor at farmhouse/, 'a spawned visitor is visibly distinct from a pending one');
assert.ok(!familyPanel.render().rows.some(([key]) => key === 'Last spawn attempt'), 'active doorstep visitors never display a stale spawn failure');
delete W.DoorstepVisits;
fam.getFamily().pendingAdoption = null;
fam.getFamily().pendingBaby = { origin: 'adopted', bornRawDay: clock.rawDay - 2 }; // An interrupted naming prompt must outrank later plans.
assert.match(familyPanel.render().summary, /Adopted baby arrived/, 'pending naming reports the child already arrived');
assert.match(familyPanel.render().rows.find(([key]) => key === 'Status')[1], /Awaiting newborn naming/);
fam.getFamily().pendingBaby.bornRawDay = null; // A malformed legacy save must not imply a child arrived on raw day zero.
assert.equal(familyPanel.render().rows.find(([key]) => key === 'Arrival date')[1], 'Not recorded');
fam.getFamily().pendingBaby = null;
fam.getFamily().pregnancy = priorPlan;
player.area = oldArea;

// Deferred naming uses the real birth/arrival day, even across a long save/reload delay.
const actualBirthDay = clock.rawDay - 35; // A child named 35 days late is already a toddler.
const furnitureCountBeforeLateNaming = interior.length; // Delayed naming must not needlessly displace house furniture for a baby basket.
const lateNamed = W.RomanceFamily.createChild({
  name: 'Late arrival', speciesId: 'engh-sho', gender: 'female',
  bodyColors: mixed, origin: 'birth', otherParentId: 'tooth_hatayap', bornRawDay: actualBirthDay,
});
assert.equal(lateNamed.bornRawDay, actualBirthDay, 'the naming date never overwrites a saved birthday');
assert.equal(lateNamed.basketId, null, 'a child already old enough to toddle does not receive a baby basket');
assert.equal(interior.length, furnitureCountBeforeLateNaming, 'delayed naming does not move or remove farmhouse furniture');
assert.equal(fam.phaseOf(lateNamed), 'toddler', 'growth is based on birth, not delayed naming');
W.RomanceFamily.restore(W.RomanceFamily.serialize());
assert.equal(W.RomanceFamily.snapshot().children.find(c => c.id === lateNamed.id)?.ageDays, 35,
  'the original birth day survives save and reload');

// ── Hold-Action-1 wheel claim ───────────────────────────────────────────
W.NpcCommandWheel.init({ getNearbyNpcWalker: () => nearby, isCombatActive: () => combatOn, isDialogueOpen: () => false, isMenuOpen: () => false, isFarmEditMode: () => false, openNpcDialogue: walker => opened.push({ walker, node: null, tap: true }) });
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
assert.equal(W.WorldActionInputClaims.claimFor('action1')?.ownerId, 'npc-command-wheel', 'friendly nonromance NPCs now offer ordinary Follow commands');
assert(W.NpcCommandWheel.optionsFor(plain).some(option=>option.id==='follow'));
nearby=null;W.NpcCommandWheel._test.syncClaims();
assert.equal(W.WorldActionInputClaims.claimFor('action1'),null,'looking away releases the Talk input claim');
nearby = plain;
W.NpcCommandWheel._test.syncClaims();
assert.equal(W.WorldActionInputClaims.claimFor('action1')?.ownerId, 'npc-command-wheel');
combatOn = true;
W.NpcCommandWheel._test.syncClaims();
assert.equal(W.WorldActionInputClaims.claimFor('action1'), null, 'combat cancels claims for all NPC social commands');
assert.equal(W.NpcCommandWheel.open(plain), false, 'Follow/Wait and other commands cannot open in combat');
combatOn = false;
nearby = null;
W.NpcCommandWheel._test.syncClaims();

// ── Save round-trip ─────────────────────────────────────────────────────
const saved = JSON.parse(JSON.stringify(W.RomanceSystem.serialize()));
W.RomanceSystem.restore(null);
assert.equal(W.RomanceSystem.getSpouse(), null);
W.RomanceSystem.restore(saved);
assert.equal(W.RomanceSystem.getSpouse()?.npcId, 'tooth_hatayap');
assert.equal(W.RomanceFamily.snapshot().children[0]?.name, 'Pip', 'children survive a save/load');

// ── Legacy saves: retire spouse vat shifts without touching children or livestock ──
const legacyFamily = W.RomanceFamily.serialize(); // Old saves may retain a spouse vat assignment with or without an explicit owner.
legacyFamily.children[0].vatId = 'child_vat'; // Children's existing work must survive adult vat retirement.
const externalWorkers = new Map([
  ['spouse_vat', { id: tooth.rec.id, familyWorker: true }],
  ['livestock_vat', { id: 'livestock_1', familyWorker: false }],
]); // Simulate loaded runtime assignments so only family entries are discarded.
const cleanedVats = []; // Tracks the existing DewVats.clearFamilyWorkers save-bound cleanup path.
const squeezedVats = []; // Verifies day-rollover processing never processes a retired spouse assignment.
W.DewVats = {
  clearFamilyWorkers() {
    cleanedVats.push(true);
    for (const [vatId, worker] of externalWorkers) if (worker.familyWorker) externalWorkers.delete(vatId);
  },
  listSqueezingVats: () => [{ id: 'spouse_vat' }, { id: 'child_vat' }],
  assignedWorkerForVat: id => externalWorkers.get(id) || null,
  setExternalWorker(id, worker) {
    if (worker) externalWorkers.set(id, worker);
    else externalWorkers.delete(id);
    return true;
  },
  squeezePileWithExternalWorker(id) { squeezedVats.push(id); return 'started'; },
};
for (const legacyOwner of [null, tooth.rec.id]) {
  const previousCleanups = cleanedVats.length; // Checks every legacy migration reruns the save-bound family-worker cleanup.
  W.RomanceFamily.restore({ ...legacyFamily, spouseVatId: 'spouse_vat', spouseVatWorkerId: legacyOwner });
  assert.equal(cleanedVats.length, previousCleanups + 1, 'legacy family workers are cleared on each restore');
  assert.equal(Object.hasOwn(W.RomanceFamily.serialize(), 'spouseVatId'), false, 'retired spouse vat is excluded from future saves');
  assert.equal(Object.hasOwn(W.RomanceFamily.serialize(), 'spouseVatWorkerId'), false, 'retired spouse vat owner is excluded from future saves');
  assert.equal(W.RomanceFamily.snapshot().children[0].vatId, 'child_vat', 'existing child vat assignments are retained');
  assert.equal(W.RomanceFamily.isAssignedToVat(tooth.rec.id), false, 'restored spouse is not a vat worker');
  assert.equal(vatCommand(tooth, 'vat'), undefined, 'legacy saves cannot re-enable spouse vat commands');
  assert.equal(vatCommand(tooth, 'unvat'), undefined, 'legacy saves cannot re-enable spouse vat cancellation');
  assert.equal(externalWorkers.has('spouse_vat'), false, 'old spouse worker is released from the physical vat');
  assert.equal(externalWorkers.get('livestock_vat')?.id, 'livestock_1', 'non-family livestock vat assignments survive loading');
  W.RomanceFamily.tick(); // Child worker registrations still proceed after the save migration.
  assert.equal(externalWorkers.get('child_vat')?.id, child.id, 'child vat assignment rehydrates normally');
  clock.rawDay += 1;
  W.RomanceFamily.tick();
  assert.ok(squeezedVats.every(id => id === 'child_vat'), 'day-rollover squeezing never uses a retired spouse job');
  assert.ok(squeezedVats.includes('child_vat'), 'the child continues to squeeze at day rollover');
  assert.notEqual(W.RomanceFamily.spouseTargetOverride(tooth.rec)?.activity, 'working the squeezing vat', 'the spouse cannot be sent to a vat by scheduling');
}
delete W.DewVats;

console.log('romance dating/marriage/family tests passed');

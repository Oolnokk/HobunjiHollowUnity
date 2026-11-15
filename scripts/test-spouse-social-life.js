// Regression coverage for state-aware spouse speech, work, outings and marriage-derived kinship.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sourceFile = path => fs.readFileSync(path, 'utf8');

const index = sourceFile('docs/index.html'); // Verifies real parser order instead of assuming this new content module is loaded.
const socialTag = 'data-classic-group="spouse-social"'; // The stable manifest owns social dialogue's versioned child URL.
assert.equal(index.split(socialTag).length - 1, 1, 'spouse-social manifest appears exactly once');
assert(index.indexOf(socialTag) < index.indexOf('data-classic-group="romance-runtime"'),
  'spouse dialogue context must load before the RomanceSystem module');
const writes = []; // Captures actual parser-time expansion without a browser.
vm.runInNewContext(sourceFile('docs/js/bootstrap/classic-groups/spouse-social.js'),
  { document: { readyState: 'loading', write: html => writes.push(html) } });
assert.equal(writes.length, 1, 'spouse-social manifest emits its child script once');
assert.match(writes[0], /js\/spouse-social-life\.js\?v=[A-Za-z0-9_-]+/, 'shipped advice module has a versioned URL');

const clock = { hour: 10, day: 8, weekday: 'Hronu' }; // Drives prayer/festival/hour-window cases deterministically.
const active = { kissHours: 0, food: true, rested: true, prayer: false, festival: null, festivalHours: false, harvest: 0, job: null }; // Drives live signal and farmwork stubs.
const graph = [ // Real social-relationship edges, including a partner of a direct family member.
  { type: 'family', members: ['aliri_ginju', 'gorobi_ginju'] },
  { type: 'family', members: ['aliri_ginju', 'gikali_ginju'] },
  { type: 'family', members: ['nashka_khibu', 'dzahiri_khibu'] },
  { type: 'family', members: ['nashka_khibu', 'kaboku_kunji'] },
  { type: 'partner', members: ['kaboku_kunji', 'kinami_kunji'] },
  { type: 'family', members: ['sloomi', 'kzubug'] },
  { type: 'family', members: ['namui_u_hakaru', 'takua_ao_hakaru'] },
];
const contexts = new Map(); // Captures DialogueContent's real feature-owned context registration.
const actions = new Map(); // Captures dialogue actions so accepting an invitation executes game logic.
const w = {
  SCRATCHBONES_CONFIG: { game: {
    romance: { spouse: { sleepHours: { start: 22, end: 7 }, dialogue: {
      greetings: ['Hello, {targetName}.'], byNpc: {} } } },
    socialRelationships: { relationships: graph }
  } },
  __hobunjiPlayerProfile: { nickname: 'Nima', appearance: { gender: 'female' } },
  CharacterNicknames: { forRelationship: () => 'Nimy' },
  CalendarSystem: {
    getHour: () => clock.hour, currentWeekdayName: () => clock.weekday,
    timeDebugSnapshot: () => ({ rawDay: clock.day })
  },
  CookingSystem: { foodBuffEntries: () => active.food ? [{ sourceLabel: 'Food' }] : [] },
  TemplePrayerRestBlessings: { isWellRested: () => active.rested, activePrayer: () => active.prayer ? { id: 'naoine' } : null },
  FestivalCalendar: { current: () => active.festival },
  FestivalSystem: { festivalHours: () => active.festivalHours, activityProps: () => [{ area: 'town', col: 20, row: 20 }] },
  FarmEditor: { unassignedReadyHarvestCount: () => active.harvest },
  NpcFarmPlots: { targetFor: () => active.job },
  NpcScheduling: {
    findStationsByRole: (role, { area }) => [{ area, c: 9, r: 9, role, pose: 'sit', stationId: role + '_seat' }],
    resolveNpcStationTarget: () => ({ area: 'map_i_carpenters', c: 13, r: 10, pose: 'sit' })
  },
  DialogueContent: {
    registerContextProvider: (id, provider) => contexts.set(id, provider),
    registerActionHandler: (id, handler) => actions.set(id, handler),
    getNpcDlgState: () => ({ favor: 0 }),
    recordNpcMemory() {}
  },
  NpcFollowing: { clear() {} }
};
const context = vm.createContext({ window: w, console, setInterval() {}, clearInterval() {} });
vm.runInContext(sourceFile('docs/js/spouse-social-life.js'), context, { filename: 'spouse-social-life.js' });
vm.runInContext(sourceFile('docs/js/romance-system.js'), context, { filename: 'romance-system.js' });
const social = w.SpouseSocialLife, romance = w.RomanceSystem; // Actual shipped feature objects, not mocked implementations.
romance.init({ getInteriorFurniture: () => [{ key: 'doubleBed', area: 'interior', col: 4, row: 5 }] }); // A real bed exposes the overnight sleep-vs-Communion conflict.
const state = romance._test.getState(); // Controls the real serializable marriage state without a cutscene.
const married = id => { state.spouse = { npcId: id, marriedRawDay: 1 }; state.outing = null; };
const setCommon = () => {
  clock.hour = 10; clock.day = 8; clock.weekday = 'Hronu';
  active.kissHours = 0; active.food = true; active.rested = true;
  active.prayer = false; active.festival = null; active.festivalHours = false; active.harvest = 0; active.job = null;
  state.kissBuff = null;
};
assert(contexts.has('spouse-social-life') && actions.has('spouse-social-life'), 'dialogue and action providers are registered');

for (const id of ['tooth_hatayap', 'aliri_ginju', 'nashka_khibu', 'namui_u_hakaru',
  'sloomi', 'foroji_funji', 'oddclaw_unumanuk', 'takua_ao_hakaru', 'jubmir']) {
  setCommon(); married(id);
  const advice = social.selectAdvice(id);
  assert(advice?.line && advice.kind === 'kiss', id + ' notices the absent kiss buff in a unique voice');
  assert.equal(romance.spouseDialogueFor(id).greetings[0], advice.line, 'ambient and dialogue share the same event-time line');
}
married('tooth_hatayap');
assert.match(social.selectAdvice('tooth_hatayap').line, /dumb-dumb.*kiss/i, 'Tooth asks bluntly for a kiss');
state.kissBuff = { npcId: 'tooth_hatayap', expiresAtHour: 2000 };
assert.match(social.selectAdvice('tooth_hatayap').line, /hold me extra close/i, 'Tooth responds to Well Rested');
active.rested = false; active.food = false;
social.selectAdvice('tooth_hatayap');
assert(social.diagnostics().available.includes('food'), 'absent food buff becomes eligible');
social.selectAdvice('tooth_hatayap');
assert(social.diagnostics().available.includes('tired'), 'absent Well Rested becomes eligible');
active.harvest = 3;
assert.match(social.selectAdvice('tooth_hatayap').line, /3 ripe crops/i, 'ripe and unassigned harvest enters the actual line');

setCommon(); married('aliri_ginju'); clock.weekday = 'Anan';
assert.equal(social.selectAdvice('aliri_ginju').kind, 'prayer', 'weekly prayer is high priority only on Anan when absent');
assert.equal(social.destinationFor('prayer').area, 'map_i_temple', 'accepted prayer resolves to an existing temple location');
active.prayer = true;
assert.equal(social.outingAvailable('prayer'), false, 'an already-active weekly prayer is not suggested');
clock.hour = 1;
assert.equal(social.selectAdvice('aliri_ginju').kind, 'communion', 'communion invitation is night-only on Anan');
assert.equal(romance._test.scheduleOverride({ id: 'aliri_ginju' }).activity, 'sleeping', 'spouse has a real bed without an outing');
const communionTarget = social.destinationFor('communion'); // The actual nighttime station is used by the tested schedule override.
assert.equal(romance.startSpouseOuting('communion', communionTarget), true);
assert.equal(romance._test.scheduleOverride({ id: 'aliri_ginju' }).activity, 'attending Spirit Communion with you',
  'an accepted midnight invitation takes precedence over ordinary sleep');
romance.endSpouseOuting();
clock.hour = 2.99;
assert.equal(social.outingAvailable('communion'), true, 'communion remains available before its authored 03:00 close');
clock.hour = 3;
assert.equal(social.outingAvailable('communion'), false, 'communion closes when the temple switches away from the night layout');
clock.hour = 2.5;
assert.equal(romance.startSpouseOuting('communion', social.destinationFor('communion')), true);
clock.hour = 3;
assert.equal(romance.activeSpouseOuting(), null, 'a Communion outing ends when the event closes, without waiting four hours');
assert.equal(romance._test.scheduleOverride({ id: 'aliri_ginju' })?.activity, 'sleeping', 'spouse leaves the closed temple for bed');
romance.endSpouseOuting();
clock.hour = 9; clock.weekday = 'Hronu';
assert.equal(social.outingAvailable('communion'), false, 'ordinary days do not offer communion');

setCommon(); married('nashka_khibu'); clock.hour = 17;
active.festival = { id: 'gorkunash', name: 'Gorkunash' };
assert.equal(social.outingAvailable('festival'), false, 'festival invitation respects the actual gathering schedule');
active.festivalHours = true;
assert.equal(social.selectAdvice('nashka_khibu').kind, 'festival', 'spouse sees the live festival');
clock.hour = 0.5;
assert.equal(social.outingAvailable('festival'), true, 'late-night festival remains eligible until the real close');
clock.hour = 23;
assert.equal(romance._test.scheduleOverride({ id: 'nashka_khibu' }), null, 'married residents attend festivals past normal bedtime');
married('jubmir');
assert.equal(romance._test.scheduleOverride({ id: 'jubmir' })?.area, 'town', 'married Jubmir attends festivals despite former visitor absence');
married('nashka_khibu');
active.festivalHours = false;
assert.equal(romance._test.scheduleOverride({ id: 'nashka_khibu' })?.activity, 'sleeping', 'normal bedtime resumes when the gathering ends');
active.festivalHours = true;
clock.hour = 17;
const festivalTree = contexts.get('spouse-social-life').treeFor({ id: 'nashka_khibu' }, { defaultTree: { id: 'tree_nashka_khibu_fallback' } });
assert.equal(festivalTree.nodes[0].type, 'choice', 'outing invitation offers a real decision');
assert.equal(festivalTree.nodes[0].choices[1].label, 'Maybe later.', 'declining does not automatically follow');
const accepted = actions.get('spouse-social-life')({ op: 'outing', kind: 'festival' }, { npc: { id: 'nashka_khibu' } });
assert.equal(accepted.ok, true, 'accepting starts an actual persisted spouse outing');
assert.equal(romance.activeSpouseOuting().kind, 'festival');
assert.equal(romance._test.scheduleOverride({ id: 'nashka_khibu' }).area, 'town', 'the spouse heads to the event');
active.festivalHours = false;
assert.equal(romance.activeSpouseOuting(), null, 'the festival outing ends as soon as the gathering closes');
active.festivalHours = true;
assert.equal(romance.endSpouseOuting(), true, 'the command-wheel return-home path can stop the outing');
assert.equal(romance.activeSpouseOuting(), null);
assert.equal(contexts.get('spouse-social-life').treeFor({ id: 'nashka_khibu' },
  { defaultTree: { id: 'important_quest' } }), null, 'authored quests always win');

setCommon(); married('tooth_hatayap');
active.job = { area: 'farm', c: 4, r: 5, activity: 'harvesting' };
assert.equal(romance._test.scheduleOverride({ id: 'tooth_hatayap' }).activity, 'harvesting', 'family jobs win over normal daytime work');
active.job = null;
assert.equal(romance._test.scheduleOverride({ id: 'tooth_hatayap' }), null, 'free workday returns to the NPC authored occupation');
assert.equal(romance.spouseTownVisitNow('tooth_hatayap'), true, 'the original town field is available when family job ends');
clock.hour = 19;
assert.equal(romance.spouseTownVisitNow('tooth_hatayap'), false, 'spouses stop taking ordinary work after work hours');

married('nashka_khibu');
assert.equal(social.relationshipFor('nashka_khibu'), 'Spouse');
assert.equal(social.relationshipFor('dzahiri_khibu'), 'Mother-in-law');
assert.equal(social.relationshipFor('kaboku_kunji'), 'Family-in-law');
assert.equal(social.relationshipFor('kinami_kunji'), 'Family-in-law', 'partners of direct family are included');
assert(social.relatedNpcIds().includes('kinami_kunji'));
assert.match(social.greetingFor({ id: 'dzahiri_khibu' }, { targetName: 'Nima' }), /family/i, 'family acknowledges marriage');
married('aliri_ginju');
assert.equal(social.relationshipFor('gorobi_ginju'), 'Father-in-law');
assert.equal(social.relationshipFor('gikali_ginju'), 'Mother-in-law');
assert.equal(social.relationshipFor('dzahiri_khibu'), null, 'previous spouse family does not leak into new marriage');
// Exercise the actual family farmwork planner, not a stub: an existing claim must be released for an outing.
vm.runInContext(sourceFile('docs/js/npc-farm-plots.js'), context, { filename: 'npc-farm-plots.js' });
const farm = w.NpcFarmPlots; // The real planner's availability checks cover in-flight work claims.
farm.init({ farmTileInfo: () => ({ canTill: true, tilled: false, ready: false }), getCurrentArea: () => 'farm' });
farm.registerFarmPlots([{ id: 'family-field', kind: 'till', tiles: [[2, 2]], workers: ['tooth_hatayap'], hours: [8, 17] }]);
setCommon(); married('tooth_hatayap'); clock.hour = 11;
assert.equal(farm.targetFor({ id: 'tooth_hatayap' }, { familyOnly: true })?.activity, 'tilling the soil', 'family worker has a real farm claim');
clock.weekday = 'Anan';
assert.equal(romance.startSpouseOuting('prayer', social.destinationFor('prayer')), true, 'a consenting spouse may interrupt fieldwork');
assert.equal(farm.targetFor({ id: 'tooth_hatayap' }, { familyOnly: true }), null, 'active outing releases the farm claim');
romance.endSpouseOuting();
assert.equal(farm.targetFor({ id: 'tooth_hatayap' }, { familyOnly: true })?.activity, 'tilling the soil', 'fieldwork resumes after outing');
w.RomanceFamily = { spouseHoldingEgg: () => true, isAssignedToVat: () => false };
assert.equal(farm.targetFor({ id: 'tooth_hatayap' }, { familyOnly: true }), null, 'egg care suspends active farm claims');
assert.equal(romance.startSpouseOuting('prayer', social.destinationFor('prayer')), false, 'egg care prevents a false outing acceptance');
w.RomanceFamily = { spouseHoldingEgg: () => false, isAssignedToVat: () => true };
assert.equal(romance.startSpouseOuting('prayer', social.destinationFor('prayer')), false, 'assigned vat work prevents a false outing acceptance');
delete w.RomanceFamily;

romance.restore({ spouse: { npcId: 'aliri_ginju' }, outing: { npcId: 'nashka_khibu', endHour: 3000, target: { area: 'town' } } });
assert.equal(romance.activeSpouseOuting(), null, 'incompatible saved outings are rejected during restore');

console.log('Spouse social life: live buff checks, voiced advice, invitations, work priority, kinship and restoration passed.');

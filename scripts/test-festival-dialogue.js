#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(`docs/js/${name}.js`, 'utf8');
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json'));
const npcs = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json')).npcs;
let hour = 17, civilDay = 120, species = 'mashtzarr';
const walkers = [];
const window = { CalendarSystem: { isInitialized: () => true, getHour: () => hour,
  monthNumber: () => Math.floor((civilDay - 1) / 28) + 1, dayOfMonth: () => (civilDay - 1) % 28 + 1,
  currentWeekdayName: () => 'Anan', aotYearNumber: () => 1155 } };
const context = vm.createContext({ window, console, document: { getElementById: () => null }, performance: { now: () => 0 } });
const load = name => vm.runInContext(read(name), context, { filename: name });
const documentStub = context.document; delete context.document;
load('condition-registry'); context.document = documentStub;
// Expose the real private selectors in this isolated test only; no WebGL/UI startup or duplicate selection logic.
vm.runInContext(read('dialogue-content').replace('  window.DialogueContent = {',
  '  window.DialogueContent = { testPick: _pickDialogueTree, testTokens: _resolveTokens,'), context);
load('npc-scheduling'); load('festival-calendar'); load('festival-system'); load('festival-dialogue');
vm.runInContext(read('ambient-dialogue').replace('  window.AmbientDialogue = api;',
  '  api.testTemplate = templateLine; window.AmbientDialogue = api;'), context);
const dialogue = window.DialogueContent, scheduling = window.NpcScheduling, festival = window.FestivalSystem;
scheduling.init({ normalizeNpcArea: area => area, npcWalkers: walkers, calendar: { get time01() { return hour / 24; } },
  getWorldNpcPaths: () => [], getSharedSchedules: () => [], isBuildingArea: () => false });
dialogue.init({ currentWeekdayName: () => 'Anan', currentSeason: () => ({ name: 'Stormtide' }), calendar: { weather: 'sunny' },
  fishingTimeOfDay: () => 'evening', getCurrentArea: () => 'town', getDialogueWalker: () => null,
  normalizeStationLabel: label => label, getPlayerData: () => ({ nickname: 'Tomo', appearance: { speciesId: species } }),
  canAccessContent: () => true });
festival.init({ getTownMap: () => town, getNpcs: () => npcs, getWalkers: () => walkers });
const npc = id => { const rec = npcs.find(npc => npc.id === id); assert(rec, id); return rec; };
const dzibim = npc('dzibim_khibu'), kinami = npc('kinami_kunji'), hunundi = npc('father_hunundi_hodu');
const pick = rec => dialogue.testPick(rec);
const text = tree => tree.nodes.map(node => node.text || '').join('\n');
for (const id of ['mashtzarr', 'mammakh', 'mammakhbuur', 'Mammakh']) {
  species = id;
  const tree = pick(dzibim);
  assert.match(text(tree), /our people took back/);
  assert.doesNotMatch(text(tree), /you folks are blessed too/);
  assert.match(text(tree), /Any Omgurku will tell you/);
}
for (const id of ['mao-ao', 'tletingan', 'nuhongan', '']) {
  species = id;
  assert.match(text(pick(dzibim)), /my people took back/);
  assert.match(text(pick(dzibim)), /you folks are blessed too/);
}
dialogue.getNpcDlgState(dzibim.id).localNickname = 'Little Sprout';
assert.match(dialogue.testTokens(text(pick(dzibim)), dzibim), /Little Sprout\. We should be helping them/);
assert(pick(dzibim).nodes.some(node => node.text === '*cries*' && node.expression === 'frown'));
for (const id of ['dzibim_khibu', 'foroji_funji', 'hreesh', 'kzubug', 'dzahiri_khibu', 'kinami_kunji', 'kaboku_kunji']) {
  const tree = pick(npc(id));
  assert(tree.id.startsWith('gorkunash_'), id);
  const ids = new Set(tree.nodes.map(node => node.id));
  for (const node of tree.nodes) {
    if (node.next) assert(ids.has(node.next));
    for (const choice of node.choices || []) if (choice.next) assert(ids.has(choice.next));
  }
}
const kinamiTree = pick(kinami), choice = kinamiTree.nodes.find(node => node.type === 'choice');
assert.equal(kinamiTree.nodes[0].text, '{{pool:Kinami Greetings}}');
assert.equal(choice.choices[0].label, "Why aren't you at the festival?");
assert.match(text(kinamiTree), /Omgurku Exodus/);
assert.match(text(pick(npc('kzubug'))), /Inishka/);
assert.match(text(pick(npc('foroji_funji'))), /5 to 1/);
assert(!pick(hunundi).id.startsWith('gorkunash_'));
const standard = { standardGreeting: 'Hello, Sprout!', targetName: 'Sprout', day: 1 };
for (const id of ['kinami_kunji', 'father_hunundi_hodu']) assert.equal(dialogue.contextGreeting(npc(id), standard), standard.standardGreeting);
const greetings = new Set();
for (let day = 0; day < 3; day++) {
  const greeting = dialogue.contextGreeting(dzibim, { ...standard, day });
  greetings.add(greeting); assert.match(greeting, /Gorkunash/); assert.match(greeting, /Sprout/);
  assert.doesNotMatch(dialogue.contextGreeting(dzibim, { ...standard, standardGreeting: 'Hello!', day, omitTargetName: true }), /Sprout/);
}
assert.equal(greetings.size, 3);
assert.match(window.AmbientDialogue.testTemplate('Sprout', dzibim.id, 'player', 1, { walker: { rec: dzibim } }), /Gorkunash/);
assert.doesNotMatch(window.AmbientDialogue.testTemplate('Sprout', dzibim.id, 'other_npc', 1, { walker: { rec: dzibim } }), /Gorkunash/);
// Queued cutscenes, feature quest providers and ordinary authored story trees retain priority.
const quest = { id: 'quest', entryNode: 'n0', nodes: [{ id: 'n0', text: 'Quest.' }] };
dialogue.queueConversationTree(dzibim.id, quest); assert.equal(pick(dzibim), quest);
dialogue.registerTreeProvider(dzibim.id, () => quest); assert.equal(pick(dzibim), quest);
dialogue.registerTreeProvider(dzibim.id, () => null);
assert.equal(pick({ ...dzibim, dialogueTrees: [quest] }), quest);
for (const boundary of [1, 8, 14.999]) {
  hour = boundary; assert.equal(window.FestivalDialogue.active(), false);
  assert.equal(pick(dzibim).id, dzibim.dialogueTrees[0].id);
  assert.equal(dialogue.contextGreeting(dzibim, standard), standard.standardGreeting);
}
for (const boundary of [0, 0.999, 15, 23.999]) { hour = boundary; assert.equal(window.FestivalDialogue.active(), true); }
for (const day of [119, 127]) {
  civilDay = day; assert.equal(window.FestivalDialogue.active(), false);
  assert.equal(dialogue.contextGreeting(dzibim, standard), standard.standardGreeting);
}
// Presence uses the same schedule authority as weekly visitors and only departs after a walker exists.
civilDay = 120; hour = 14;
window.FestivalDialogue.init({ getTownMap: () => town });
assert.equal(scheduling.getVisitorPresence(hunundi), null, 'normal startup keeps his normal schedule');
assert(scheduling.hasPresenceSchedule(hunundi));
hour = 17;
assert.equal(scheduling.resolveNpcScheduleTarget(hunundi), null, 'do not spawn an absent resident');
walkers.push({ rec: hunundi, area: 'town' });
const departure = scheduling.resolveNpcScheduleTarget(hunundi);
assert(departure.visitorDeparture); assert.equal(departure.c, 30); assert.equal(departure.r, 1);
walkers.length = 0; hour = 1;
assert(scheduling.resolveNpcScheduleTarget(hunundi).visitorArrival, 'return through the same exit');
hour = 17;
const home = scheduling.resolveNpcScheduleTarget(kinami);
assert.equal(home.area, kinami.scheduleHooks.defaultPosition.area);
assert(!home.visitorDeparture);
console.log('Festival dialogue: authored branches, Oliphanti ancestry, nickname tokens, choices, greeting hooks, quest priority, exact hours, home and departure/return passed.');

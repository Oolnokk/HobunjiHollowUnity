'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const callbacks = new Map(); // Explicit timers make batch/cancel assertions deterministic.
let timerId = 0; // Unique handles for the event-driven batching timer.
const window = {}; // Runs the actual popup owner without a browser renderer.
const context = vm.createContext({ window, console, setTimeout(fn) { callbacks.set(++timerId, fn); return timerId; }, clearTimeout(id) { callbacks.delete(id); }, queueMicrotask() {} });
vm.runInContext(fs.readFileSync('docs/js/world-popup-text.js', 'utf8'), context);
const api = window.WorldPopupText; // Real public gain API and mobile-readable snapshot.
for (const value of [0, -1, NaN, Infinity, '4']) assert.equal(api.queueSocialGain('rapport', value, 'a'), false);
assert.equal(api.queueSocialGain('unknown', 2), false);
assert.equal(callbacks.size, 0);
api.queueSocialGain('rapport', 1.25, 'a'); api.queueSocialGain('rapport', 2.5, 'a');
api.queueSocialGain('festivalFun', 15, 'a'); api.queueSocialGain('festivalFun', 15, 'b');
api.queueSocialGain('romance', 0.025, 'a'); api.queueSocialGain('livestockFavor', 0.2, 'Bessie'); api.queueSocialGain('favor', 2, 'a');
assert.equal(callbacks.size, 1, 'continuous/multi-NPC rewards share one event timer');
const flush = [...callbacks.values()][0]; callbacks.clear(); flush();
const gains = api.debugSnapshot().lastSocialGains; // Records the exact text sent to the existing reward list.
assert.equal(gains.length, 5);
assert.equal(gains.find(g => g.kind === 'rapport').amount, 3.75);
assert.equal(gains.find(g => g.kind === 'festivalFun').text, '2 recipients: +30 Festival Fun');
assert.equal(gains.find(g => g.kind === 'livestockFavor').text, 'Bessie: +0.2 Livestock Favor');
assert.equal(gains.find(g => g.kind === 'romance').text, 'a: +0.03 Romance');
api.queueSocialGain('favor', 1, 'a'); api.clear();
assert.equal(callbacks.size, 0, 'clearing the old scene cancels delayed gains');
assert.equal(api.debugSnapshot().pendingSocialGainKinds.length, 0);

const relations = new Map(); // Actual rapport mutation/settlement paths use these ordinary relationship records.
window.DialogueContent = { getNpcDlgState(id) { if (!relations.has(id)) relations.set(id, { favor: 0, rapport: 99, romance: 399, rapportDay: 0, memory: [] }); return relations.get(id); } };
window.CalendarSystem = { getHour: () => 12, timeDebugSnapshot: () => ({ rawDay: 0, time01: 0.5 }) };
window.addEventListener = () => {};
vm.runInContext(fs.readFileSync('docs/js/npc-social-relationship-bridge-v2.js', 'utf8'), context);
assert.equal(window.NpcRapport.adjust('a', 5), 1);
assert.equal(window.NpcRapport.adjust('a', 5), 0);
assert.equal(window.NpcRapport.adjustRomance('a', 5), 1);
assert.equal(window.NpcRapport.adjustRomance('a', 5), 0);
const socialFlush = [...callbacks.values()][0]; callbacks.clear(); socialFlush();
const applied = api.debugSnapshot().lastSocialGains; // Feedback must use actual clamped amounts and emit nothing at the cap.
assert.equal(applied.find(g => g.kind === 'rapport').amount, 1);
assert.equal(applied.find(g => g.kind === 'romance').amount, 1);
console.log('Social gain batching, labels, clearing and clamped mutation feedback passed.');

// Daily care reports only the applied heart increase, including the partial cap step.
window.CreatureTextureCache = { create: () => ({}) };
vm.runInContext(fs.readFileSync('docs/js/farm-animals.js', 'utf8'), context);
const livestock = [
  { kind: 'uumkaoii', name: 'Bessie', barnId: 'b', troughIndex: 0, heartLevel: 4.9 },
  { kind: 'uumkaoii', name: 'Full', barnId: 'b', troughIndex: 1, heartLevel: 5 },
  { kind: 'uumkaoii', name: 'Unfed', barnId: 'b', troughIndex: 2, heartLevel: 2 },
]; // One nearly full, one full, and one unfed animal exercise every notification boundary.
const barn = { id: 'b', kind: 'barn', tier: 'small', troughs: [{ slots: ['plantFodder'] }, { slots: ['plantFodder'] }, { slots: [] }] }; // Daily care consumes the same real trough slots as gameplay.
window.FarmAnimals.init({ loadWorldLivestock: () => livestock, getFarmBuildings: () => [barn], getBarnTiers: () => ({ small: { slots: 3 } }), saveWorldLivestock() {}, saveFarmLayout() {} });
window.FarmAnimals.tickHearts();
const careFlush = [...callbacks.values()][0]; callbacks.clear(); careFlush();
const care = api.debugSnapshot().lastSocialGains.find(g => g.kind === 'livestockFavor'); // Capped and unfed animals must never claim positive progress.
assert(Math.abs(care.amount - 0.1) < 1e-9);
assert.equal(care.text, 'Bessie: +0.1 Livestock Favor');
assert.equal(livestock[2].heartLevel, 1.8);

const festivalSource = fs.readFileSync('docs/js/festival-system.js', 'utf8'); // Executes the actual Festival Fun mutation without loading festival scenery.
const funBody = festivalSource.slice(festivalSource.indexOf('  function addFestivalFun('), festivalSource.indexOf('  function settleFestivalFun('));
const festivalState = { festivalFun: {} }; // Minimal authoritative member-state shape.
const addFun = new Function('window', 'state', funBody + '; return addFestivalFun;')(window, festivalState);
addFun('a', 25); addFun('a', -4); addFun('a', Infinity);
assert.equal(festivalState.festivalFun.a, 25);
const funFlush = [...callbacks.values()][0]; callbacks.clear(); funFlush();
assert.equal(api.debugSnapshot().lastSocialGains.find(g => g.kind === 'festivalFun').amount, 25);
console.log('Livestock care caps and Festival Fun mutation feedback passed.');

api.queueSocialGain('livestockFavor', 0.2, 'Uumkao’ii', 'animal-a');
api.queueSocialGain('livestockFavor', 0.2, 'Uumkao’ii', 'animal-b');
api.queueSocialGain('livestockFavor', 0.1, 'Uumkao’ii', 'animal-a');
const sameNameFlush = [...callbacks.values()][0]; callbacks.clear(); sameNameFlush(); // Repeated care for the same record shares one recipient; another identically named record remains separate.
const sameNameGain = api.debugSnapshot().lastSocialGains.find(g => g.kind === 'livestockFavor');
assert.equal(sameNameGain.text, '2 recipients: +0.5 Livestock Favor');
assert.deepEqual(Array.from(sameNameGain.recipients), ['animal-a', 'animal-b']);
const settings = JSON.parse(fs.readFileSync('docs/config/ui/world-popup-settings.json', 'utf8')); // Authored defaults are used by both gameplay and the mobile editor.
const editor = fs.readFileSync('docs/tools/world-popup-editor/index.html', 'utf8'); // Execute the editor event-label table so new kinds cannot silently vanish from its controls.
const labelStart = editor.indexOf('const EVENT_LABELS=');
const editorLabels = new Function(editor.slice(labelStart, editor.indexOf(';', labelStart) + 1) + ';return EVENT_LABELS;')();
for (const kind of ['favor', 'rapport', 'romance', 'festivalFun', 'livestockFavor']) {
  assert.equal(settings.assignments[kind], api.defaults.assignments[kind]);
  assert.equal(settings.colors[kind], api.defaults.colors[kind]);
  assert(editorLabels[kind], `${kind} has an editor control`);
}
console.log('Same-named livestock identities and social popup editor configuration passed.');

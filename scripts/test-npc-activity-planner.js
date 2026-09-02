#!/usr/bin/env node
'use strict';

// Integration tests for the NPC Agenda + Activity Planner redesign:
// js/npc-agenda.js + npc-activities.js + npc-social-stimuli.js +
// npc-activity-planner.js loaded together in one sandbox, driven the same
// way npc-scheduling.js's resolveNpcScheduleTarget bridge and game.js's
// makeNpcWalker actually call them. Covers the invariants the design doc's
// own "Validation / Tests" section calls out: a broken/missing destination
// never freezes an already-spawned NPC, a not-yet-loaded area is treated
// differently from genuinely invalid content, breaks route through free
// time, relationship-aware `socialize` picks correctly, station/opportunity
// choices are deterministic (not flickering frame to frame), and a strong
// nearby social stimulus can pull a `duty` activity away but never a
// `critical` one.
//
// World/station knowledge is faked with plain Maps/arrays rather than the
// real npc-scheduling.js station registry — these modules only need the
// shape (resolveNpcStationTarget/findStationsByRole's contract), not the
// real map data, and faking it keeps this test fast and self-contained.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let mockHour = 10, mockWeekday = 'Anan', mockNowMs = 1000;
const loggedMessages = [];
const sandbox = {
  console,
  performance: { now: () => mockNowMs },
  window: {
    CalendarSystem: { getHour: () => mockHour, currentWeekdayName: () => mockWeekday },
    __farmLog: (msg, level) => loggedMessages.push({ msg, level: level || 'info' }),
    MusicMinigame: { state: null },
  },
};
vm.createContext(sandbox);
for (const f of ['docs/js/npc-agenda.js', 'docs/js/npc-activities.js', 'docs/js/npc-social-stimuli.js', 'docs/js/npc-activity-planner.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
}
const { NpcAgenda: Agenda, NpcActivities: Activities, NpcSocialStimuli: Stimuli, NpcActivityPlanner: Planner } = sandbox.window;
const plain = x => JSON.parse(JSON.stringify(x));

// ── fake world: stations, building-scene loading, walkers ──────────────
const stationsById = new Map();
function resolveNpcStationTarget(id) { const s = stationsById.get(id); return s ? { ...s, stationId: s.id } : null; }
function findStationsByRole(role, { area } = {}) {
  const out = [];
  for (const s of stationsById.values()) {
    if (!s.roles?.includes(role)) continue;
    if (area && s.area !== area) continue;
    out.push({ ...s, stationId: s.id });
  }
  return out;
}
function isBuildingArea(area) { return /^map_i_/.test(area || ''); }
const loadedBuildingAreas = new Set();
const loadBuildingSceneCalls = [];
function loadBuildingScene(area) { loadBuildingSceneCalls.push(area); }
function normalizeNpcArea(area) { return area || 'town'; }
const buildingScenes = { has: area => loadedBuildingAreas.has(area) };

let walkers = [];
function findNpcWalker(id) { return walkers.find(w => w.rec?.id === id) || null; }
function listNpcWalkersInArea(area) { return walkers.filter(w => w.area === area); }
function makeWalker(rec, area, x, z, extra) {
  return { rec, area, root: { position: { x, z } }, currentScheduleTarget: null, ...extra };
}

Activities.init({ resolveNpcStationTarget, findStationsByRole, isBuildingArea, buildingScenes, loadBuildingScene, normalizeNpcArea, findNpcWalker, listNpcWalkersInArea });
Planner.init({ calendar: { day: 14, time01: 0.5 }, getCurrentArea: () => mockCurrentArea, findNpcWalker, listNpcWalkersInArea, findStationsByRole });
Stimuli.init({ getPlayerPosition: () => mockPlayerPos, getCurrentArea: () => mockCurrentArea });
let mockCurrentArea = 'town';
let mockPlayerPos = { x: 0, z: 0 };

// ── A: no-agenda NPC, pre-spawn, working legacy schedule → passes straight through ──
{
  const rec = { id: 'plain_npc' };
  const legacyTarget = { area: 'town', c: 5, r: 5, activity: 'idle' };
  const result = Planner.resolveNpcTarget(rec, { legacyResolve: () => legacyTarget, hasExistingWalker: false });
  assert.equal(result, legacyTarget, 'no agenda + pre-spawn just returns whatever the legacy resolver says, unmodified');
}

// ── B: genuinely no schedule content at all, never spawned → stays null (dormant/quest-gated NPCs must not start spawning) ──
{
  const rec = { id: 'dormant_npc' };
  const result = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: false });
  assert.equal(result, null, 'pre-spawn + legacy resolver has nothing → null, exactly like today (spawnScheduledNpcs keeps deferring/never spawns)');
}

// ── C: an already-spawned NPC whose legacy schedule momentarily matches nothing → never freezes ──
{
  const rec = { id: 'gap_npc' };
  walkers.push(makeWalker(rec, 'town', 10.5, 10.5));
  mockCurrentArea = 'somewhere-else'; // off-screen: exercises the cheap wander-only free-time path
  const result = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  assert(result, 'an existing walker must always get a non-null target, even with no agenda and a legacy-schedule gap');
  assert.equal(result.area, 'town', 'free time never relocates an NPC to a different area');
  assert.equal(result.plannerSource, 'activity-failure-fallback');
  assert.equal(result.obligation, 'leisure');
}

// ── D: authored destinationRole with no matching station anywhere → logs loudly, still never freezes ──
{
  const rec = { id: 'kzubug_broken_role_test', agenda: [{ id: 'work', activity: 'work', obligation: 'duty', window: ['00:00', '23:59'], destinationRole: 'bronzeworks-anvil' }] };
  walkers.push(makeWalker(rec, 'smithy_area', 3.5, 3.5));
  mockCurrentArea = 'elsewhere';
  const before = loggedMessages.length;
  const result = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  assert(result, 'a missing destinationRole must fall through to free-time/wander, never a bare null');
  assert.equal(result.area, 'smithy_area');
  assert.equal(result.plannerSource, 'activity-failure-fallback');
  const newLogs = loggedMessages.slice(before);
  assert(newLogs.some(l => l.level === 'warn' && /ACTIVITY_UNAVAILABLE/.test(l.msg) && /bronzeworks-anvil/.test(l.msg)),
    'the exact design-doc Kzubug/bronzeworks-anvil scenario logs a loud, specific diagnostic — ' + JSON.stringify(newLogs));
}

// ── E: destinationRole with a real matching station → READY at that station ──
{
  stationsById.set('bench_1', { id: 'bench_1', label: 'Bench', area: 'town', c: 20, r: 20, pose: 'sit', roles: ['sit'] });
  const rec = { id: 'sitter', agenda: [{ id: 'sitbeat', activity: 'goToRole', obligation: 'plan', window: ['00:00', '23:59'], destinationRole: 'sit', destinationArea: 'town' }] };
  walkers.push(makeWalker(rec, 'town', 1, 1));
  const result = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  assert.equal(result.stationId, 'bench_1');
  assert.equal(result.plannerStatus, 'READY');
  assert.equal(result.plannerSource, 'agenda');
  assert.equal(result.obligation, 'plan');
}

// ── F: WAITING_FOR_WORLD vs pre-spawn null — the same unloaded-area beat behaves differently depending on hasExistingWalker ──
{
  const rec = { id: 'waiter', agenda: [{ id: 'w', activity: 'goToRole', obligation: 'duty', window: ['00:00', '23:59'], destinationRole: 'anvil', destinationArea: 'map_i_unloaded' }] };
  const liveResult = (() => {
    walkers.push(makeWalker(rec, 'town', 1, 1));
    mockCurrentArea = 'elsewhere';
    return Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  })();
  assert(liveResult, 'an existing walker keeps a valid position while waiting for the world to load');
  assert(loadBuildingSceneCalls.includes('map_i_unloaded'), 'the unloaded area gets warmed up, same as the legacy resolver already did for missing stationIds');
  assert(loggedMessages.some(l => l.level === 'info' && /WAITING_FOR_WORLD/.test(l.msg)), 'WAITING_FOR_WORLD logs at info, not warn — it is not an authoring bug');

  const preSpawnResult = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: false });
  assert.equal(preSpawnResult, null, 'pre-spawn: still null, letting spawnScheduledNpcs/_retrySpawnDeferredNpcs keep retrying instead of popping in at a wander tile');
}

// ── G: break → free time, always resolves to a recognizable, valid opportunity ──
{
  stationsById.set('smithy_bench', { id: 'smithy_bench', label: 'Bench', area: 'smithy', c: 9, r: 9, pose: 'sit', roles: ['sit'] });
  const sloomiRec = { id: 'sloomi' };
  walkers.push(makeWalker(sloomiRec, 'smithy', 9.2, 8.8, { currentScheduleTarget: { obligation: 'plan' } }));
  const rec = { id: 'kzubug_break_test', agenda: [{ id: 'lunch-break', activity: 'break', obligation: 'leisure', window: ['00:00', '23:59'] }] };
  walkers.push(makeWalker(rec, 'smithy', 8.5, 8.5));
  mockCurrentArea = 'smithy'; // visible — exercises the full sit/chat/wander scoring, not just the cheap off-screen path
  const result = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  assert.equal(result.plannerStatus, 'READY');
  assert.equal(result.beatId, 'lunch-break');
  assert.equal(result.obligation, 'leisure');
  const looksLikeSit = result.stationId === 'smithy_bench';
  const looksLikeChat = result.id === 'chat-with-sloomi';
  const looksLikeWander = result.id === 'freetime-wander';
  assert(looksLikeSit || looksLikeChat || looksLikeWander, `break resolved to an unrecognized target: ${JSON.stringify(result)}`);
}

// ── H: socialize — relationship-aware live scoring (replaces the old presenceChoices precompiled-rule hack) ──
{
  stationsById.set('family_stool', { id: 'family_stool', label: 'Family Stool', area: 'carpenters', c: 13, r: 9, pose: 'sit', roles: [] });
  stationsById.set('inn_stool', { id: 'inn_stool', label: 'Inn Stool', area: 'inn', c: 16, r: 9, pose: 'sit', roles: [] });
  const prefs = { preferNpcIds: ['dzahiri'], preferArea: 'carpenters', preferStationId: 'family_stool', avoidNpcIds: ['kinami'], fallbackStationId: 'inn_stool', fallbackArea: 'inn' };
  const kabokuRec = { id: 'kaboku_test', agenda: [{ id: 'social', activity: 'socialize', obligation: 'plan', window: ['00:00', '23:59'], preferences: prefs }] };
  walkers.push(makeWalker(kabokuRec, 'carpenters', 1, 1));
  const dzahiriWalker = makeWalker({ id: 'dzahiri' }, 'carpenters', 0, 0);
  walkers.push(dzahiriWalker);

  const withFamily = Planner.resolveNpcTarget(kabokuRec, { legacyResolve: () => null, hasExistingWalker: true });
  assert.equal(withFamily.stationId, 'family_stool', 'family present → visits them');
  assert.equal(withFamily.plannerReason, 'preferred company present');

  walkers.splice(walkers.indexOf(dzahiriWalker), 1); // family leaves
  const withoutFamily = Planner.resolveNpcTarget(kabokuRec, { legacyResolve: () => null, hasExistingWalker: true });
  assert.equal(withoutFamily.stationId, 'inn_stool', 'family absent → falls back to the inn, exactly like the old presenceChoices hack, but decided live instead of precompiled per-weekday');
  assert.equal(withoutFamily.plannerReason, 'preferred company absent');
}

// ── I: deterministic choice among several equally-valid stations (no tick-to-tick flicker) ──
{
  stationsById.set('bench_a', { id: 'bench_a', area: 'town', c: 1, r: 1, pose: 'sit', roles: ['sit'] });
  stationsById.set('bench_b', { id: 'bench_b', area: 'town', c: 2, r: 2, pose: 'sit', roles: ['sit'] });
  const rec = { id: 'determ_npc', agenda: [{ id: 'sitbeat', activity: 'goToRole', obligation: 'plan', window: ['00:00', '23:59'], destinationRole: 'sit', destinationArea: 'town' }] };
  walkers.push(makeWalker(rec, 'town', 0, 0));
  const r1 = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  const r2 = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  const r3 = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  assert.equal(r1.stationId, r2.stationId);
  assert.equal(r2.stationId, r3.stationId, 'the same day always picks the same station among ties, instead of re-rolling every planner tick');
}

// ── J: critical obligation is never interrupted by even a very strong, point-blank stimulus ──
{
  Stimuli.emit({ id: 'test-music-critical', type: 'music', area: 'critical_area', x: 5, z: 5, radius: 10, strength: 1, durationMs: 60000 });
  const rec = { id: 'critical_npc', agenda: [{ id: 'quest', activity: 'idle', obligation: 'critical', window: ['00:00', '23:59'] }] };
  walkers.push(makeWalker(rec, 'critical_area', 5, 5));
  mockCurrentArea = 'critical_area';
  const result = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  assert.notEqual(result.plannerSource, 'stimulus-interrupt', 'critical progression-tied activities must never be pulled away by ordinary distraction');
  assert.equal(result.obligation, 'critical');
}

// ── K: a duty-level activity CAN be pulled away by a strong nearby stimulus, using the normal watchPerformance activity ──
{
  Stimuli.emit({ id: 'test-music-duty', type: 'music', area: 'duty_area', x: 8.5, z: 8.5, radius: 10, strength: 1, durationMs: 60000 });
  const rec = { id: 'duty_npc', agenda: [{ id: 'work', activity: 'idle', obligation: 'duty', window: ['00:00', '23:59'] }] };
  walkers.push(makeWalker(rec, 'duty_area', 8.5, 8.5));
  mockCurrentArea = 'duty_area';
  const result = Planner.resolveNpcTarget(rec, { legacyResolve: () => null, hasExistingWalker: true });
  assert.equal(result.plannerSource, 'stimulus-interrupt', 'a strong point-blank stimulus should pull a duty-level activity away');
  const snap = Planner.debugSnapshot('duty_npc');
  assert.equal(snap.suspendedBeatId, 'work', 'the debug panel reports what got suspended');
}

// ── L: Kurraya poll wires the player's own performance into a real stimulus, no bespoke NPC-facing hack ──
{
  sandbox.window.MusicMinigame.state = { active: true, area: 'town', npcId: null };
  mockPlayerPos = { x: 12, z: 34 };
  mockCurrentArea = 'town';
  Stimuli.pollPlayerMusic();
  const active = Stimuli.getActive('town');
  const musicStim = active.find(s => s.id === 'player-kurraya');
  assert(musicStim, 'playing Kurraya surfaces a real stimulus for NPCs to react to');
  assert.equal(musicStim.type, 'music');
  assert.equal(plain({ x: musicStim.x, z: musicStim.z }).x, 12);
  assert.equal(musicStim.sourceIsPlayer, true);
  sandbox.window.MusicMinigame.state = null;
  Stimuli.pollPlayerMusic();
  assert(!Stimuli.getActive('town').some(s => s.id === 'player-kurraya'), 'stimulus clears once the player stops playing');
}

// ── M: authoring mistakes are caught explicitly, not silently swallowed ──
{
  const res1 = Activities.resolveDestination({ id: 'x', activity: 'not-a-real-activity' }, { npcId: 'n', rec: {}, walker: null, now: { day: 1 } });
  assert.equal(res1.status, 'INVALID_CONTENT');
  const res2 = Activities.resolveDestination({ id: 'x', activity: 'work' }, { npcId: 'n', rec: {}, walker: null, now: { day: 1 } });
  assert.equal(res2.status, 'INVALID_CONTENT', 'work with neither destinationStationId nor destinationRole is an authoring error, not a silent no-op');
}

console.log('npc activity planner tests passed');

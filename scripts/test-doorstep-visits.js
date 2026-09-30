#!/usr/bin/env node
'use strict';

// Runs the real shared doorstep-visit runtime (docs/js/doorstep-visits.js)
// with its two providers (weapon trust gifts, tutorial unlock notices) and the
// login-in-the-farmhouse helper, against minimal stand-ins for the game.js
// singletons they hook (NpcScheduling, BanditCombat, DialogueContent,
// HousePieces, NpcPathfinding).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

function makeContext() {
  const timers = [];
  const intervals = [];
  const elements = { npcDialogueText: { textContent: '' } };
  const events = [];
  const clock = { now: 0 };
  const window = {
    location: { pathname: '/index.html' },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    __farmLog() {},
  };
  const document = {
    readyState: 'complete',
    addEventListener() {},
    dispatchEvent(event) { events.push(event); },
    getElementById: id => elements[id] || null,
  };
  const context = vm.createContext({
    window, document, console, JSON, Math, Number, String, Object, Array, Map, Set, WeakSet, Proxy, Reflect, Date,
    performance: { now: () => clock.now },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  });
  const run = rel => vm.runInContext(read(rel), context, { filename: rel });
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  const tick = () => intervals.forEach(entry => entry.fn());
  return { window, document, context, run, flushTimers, tick, clock, elements, events, intervals };
}

// A THREE-ish object just rich enough for cloneVisitorRoot.
function fakeObject3D(name) {
  const node = {
    name, children: [], parent: null, userData: {}, visible: true,
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    add(child) { child.parent = node; node.children.push(child); },
    remove(child) { const i = node.children.indexOf(child); if (i >= 0) node.children.splice(i, 1); child.parent = null; },
    traverse(fn) { fn(node); node.children.forEach(child => child.traverse(fn)); },
    clone() {
      const copy = fakeObject3D(node.name);
      copy.userData = { ...node.userData };
      node.children.forEach(child => copy.add(child.clone()));
      return copy;
    },
  };
  return node;
}

function installWorld(ctx, { npcIds }) {
  const { window } = ctx;
  const farmScene = fakeObject3D('farmScene');
  const walkers = npcIds.map(id => {
    const root = fakeObject3D(`npc_${id}`);
    root.add(fakeObject3D('avatar'));
    return { rec: { id, dialogueTrees: [] }, root, avatarGroup: root.children[0], area: 'town' };
  });
  const state = { area: 'farm' };
  window.HousePieces = {
    debugPieceFeatures: () => [{ id: 'starter', stage: 'built', features: [
      { type: 'entrance', side: 'south', doorTile: '27,6', approachTile: '27,7', hasDoorObj: true, invalid: false },
    ] }],
  };
  window.NpcPathfinding = { isNpcTileWalkable: () => true };
  window.NpcScheduling = { init() {} };
  window.NpcScheduling.init({ npcWalkers: walkers, getCurrentArea: () => state.area });
  window.BanditCombat = { init(deps) { this.deps = deps; } };
  window.BanditCombat.init({
    getActiveScene: () => farmScene,
    getActiveGrid: () => null,
    getPlayerFaceTarget: () => ({ x: 27.5, z: 7.5 }),
    getCurrentArea: () => state.area,
    HELD_SHAPE_DEFS: { hatchet: { slots: ['weapon'] }, notInBanditPool: { slots: ['weapon'] } },
  });
  const dialogue = { begun: [], advanced: 0 };
  window.DialogueContent = {
    init(deps) { this.deps = deps; },
    beginNpcConversation(rec) { dialogue.begun.push(rec); },
    advanceNpcDialogue() { dialogue.advanced++; },
    getNpcDlgState: () => ({ favor: 0, memory: [] }),
    recordNpcMemory() {},
  };
  const closed = [];
  window.DialogueContent.init({
    closeNpcDialogue() { closed.push('close'); },
    fishingTimeOfDay: () => 'dawn',
    getPlayerData: () => ({ appearance: { gender: 'female' } }),
  });
  return { walkers, farmScene, state, dialogue, closed };
}

function goOutside(ctx, world) {
  world.state.area = 'interior';
  ctx.clock.now += 10; ctx.tick();
  world.state.area = 'farm';
  ctx.clock.now += 10; ctx.tick();
}

function talkThrough(ctx, world, { naturalEnd }) {
  const visitor = world.walkers.find(walker => walker._doorstepVisitor);
  ctx.window.DialogueContent.beginNpcConversation(visitor.rec);
  const tree = visitor.rec.dialogueTrees[0];
  const last = tree.nodes[tree.nodes.length - 1];
  ctx.elements.npcDialogueText.textContent = last.text;
  if (naturalEnd) ctx.window.DialogueContent.advanceNpcDialogue();
  ctx.window.DialogueContent.deps.closeNpcDialogue();
  ctx.flushTimers();
}

// ── Shared runtime: area watch, spawn, natural end vs. Escape, flags ──────
{
  const ctx = makeContext();
  ctx.run('docs/js/doorstep-visits.js');
  const world = installWorld(ctx, { npcIds: ['friend'] });
  const api = ctx.window.DoorstepVisits;
  assert.equal(ctx.intervals.length, 1, 'area watch runs on one 100ms interval, not a per-frame loop');
  assert.equal(ctx.intervals[0].ms, 100);

  const completed = [];
  let syncs = 0;
  let pending = true;
  api.registerProvider({
    id: 'test', priority: 1,
    sync() { syncs++; },
    next: () => pending ? {
      key: 'test:hello', npcId: 'friend',
      tree: { id: 't', entryNode: 'a', nodes: [
        { id: 'a', type: 'text', text: 'Good {{timeOfDay}}, {{playerHonorific}}.', next: 'b' },
        { id: 'b', type: 'text', text: 'Bye.', next: null },
      ] },
    } : null,
    onComplete(visit) { completed.push(visit.key); pending = false; return true; },
  });

  // Farm -> town without going through the farmhouse spawns nothing.
  ctx.tick();
  assert.equal(world.walkers.some(walker => walker._doorstepVisitor), false);

  goOutside(ctx, world);
  const visitor = world.walkers.find(walker => walker._doorstepVisitor);
  assert(visitor, 'leaving the farmhouse spawns the pending visitor');
  assert.equal(visitor.rec.doorstepVisitKey, 'test:hello');
  assert.equal(visitor.area, 'farm');
  assert.equal(visitor.root.parent, world.farmScene, 'visitor is added to the active farm scene');
  assert.deepEqual({ x: visitor.root.position.x, z: visitor.root.position.z }, { x: 27.5, z: 9.5 }, 'visitor stands 3 tiles out from the door');
  const tree = visitor.rec.dialogueTrees[0];
  assert.equal(tree.nodes[0].text, 'Good morning, Miss.', 'greeting tokens resolve from live player/world data');
  assert(tree.nodes[1].text.endsWith(api.NATURAL_END_MARKER), 'terminal line carries the natural-end marker');
  assert.equal(api.debugSnapshot().activeProviderId, 'test');

  // Escape / Leave: no completion, visitor stays.
  talkThrough(ctx, world, { naturalEnd: false });
  assert.deepEqual(completed, []);
  assert(world.walkers.includes(visitor), 'leaving mid-conversation keeps the visitor waiting');

  // Walking away removes them; the next exit brings them back.
  world.state.area = 'town'; ctx.tick();
  assert.equal(world.walkers.some(walker => walker._doorstepVisitor), false, 'leaving the farm removes the visitor');
  goOutside(ctx, world);
  assert(world.walkers.some(walker => walker._doorstepVisitor), 'an unfinished visit reappears on the next farmhouse exit');

  // Natural end: provider completes, visitor goes home.
  talkThrough(ctx, world, { naturalEnd: true });
  assert.deepEqual(completed, ['test:hello']);
  assert.equal(world.walkers.some(walker => walker._doorstepVisitor), false, 'a completed visitor is removed');
  assert(ctx.events.some(event => event.type === 'hobunji-doorstep-visit-complete' && event.detail.key === 'test:hello'));
  goOutside(ctx, world);
  assert.equal(world.walkers.some(walker => walker._doorstepVisitor), false, 'nothing pending, nobody at the door');

  // 1000ms sync throttle.
  const before = syncs;
  ctx.clock.now += 500; ctx.tick();
  assert.equal(syncs, before, 'no provider sync inside the 1000ms throttle');
  ctx.clock.now += 1200; ctx.tick();
  assert.equal(syncs, before + 1, 'providers resync once the throttle elapses');

  // Flags round-trip and save through init({ save }).
  let saves = 0;
  api.init({ save: () => { saves++; } });
  api.markDone('x');
  assert.equal(api.isDone('x'), true);
  assert.equal(saves, 1);
  const saved = JSON.parse(JSON.stringify(api.serialize()));
  api.restore({});
  assert.equal(api.isDone('x'), false);
  api.restore(saved);
  assert.equal(api.isDone('x'), true);
}

// ── Which door the visitor waits at: recorded entrance, then feet-in-tiles ──
{
  const ctx = makeContext();
  ctx.run('docs/js/doorstep-visits.js');
  const world = installWorld(ctx, { npcIds: ['friend'] });
  const api = ctx.window.DoorstepVisits;
  // One house, two entrances: south door A and east door B.
  const A = { id: 'feat_south', type: 'entrance', side: 'south', doorTile: '20,6', approachTile: '20,7', hasDoorObj: true, invalid: false };
  const B = { id: 'feat_east', type: 'entrance', side: 'east', doorTile: '34,4', approachTile: '35,4', hasDoorObj: true, invalid: false };
  let entered = null;
  ctx.window.HousePieces = {
    debugPieceFeatures: () => [{ id: 'house', stage: 'built', features: [A, B] }],
    lastEnteredEntrance: () => entered,
  };
  const playerTile = { c: 0, r: 0 };
  api.init({ getPlayerTile: () => ({ ...playerTile }) });
  api.registerProvider({
    id: 'test', next: () => ({ key: 'test:door', npcId: 'friend', tree: { id: 't', nodes: [{ id: 'a', type: 'text', text: 'Hi.' }] } }),
    onComplete: () => true,
  });
  const spawnSpot = () => {
    const visitor = world.walkers.find(walker => walker._doorstepVisitor);
    return visitor && { x: visitor.root.position.x, z: visitor.root.position.z };
  };
  const nearA = { x: 20.5, z: 9.5 };  // 3 tiles south of door A
  const nearB = { x: 37.5, z: 4.5 };  // 3 tiles east of door B

  // Recorded entrance wins even when the player is standing by the other door.
  entered = { pieceId: 'house', featureId: 'feat_east' };
  Object.assign(playerTile, { c: 20.5, r: 7.5 });
  goOutside(ctx, world);
  assert.deepEqual(spawnSpot(), nearB, 'visitor waits outside the entrance the player went in by');
  entered = { pieceId: 'house', featureId: 'feat_south' };
  Object.assign(playerTile, { c: 35.5, r: 4.5 });
  goOutside(ctx, world);
  assert.deepEqual(spawnSpot(), nearA, 'switching entrances moves the visitor with it');

  // No record (legacy travel spot / teleport): nearest approach tile to the
  // player's feet, in tile units. The old pixel-vs-tile comparison always
  // picked the door with the largest coordinates (B) regardless of this.
  entered = null;
  Object.assign(playerTile, { c: 20.5, r: 7.5 });
  goOutside(ctx, world);
  assert.deepEqual(spawnSpot(), nearA, 'fallback picks the door nearest the player, not the largest coordinates');
  Object.assign(playerTile, { c: 35.5, r: 4.5 });
  goOutside(ctx, world);
  assert.deepEqual(spawnSpot(), nearB);

  // A recorded entrance that no longer exists (house rebuilt) falls back too.
  entered = { pieceId: 'house', featureId: 'feat_demolished' };
  Object.assign(playerTile, { c: 20.5, r: 7.5 });
  goOutside(ctx, world);
  assert.deepEqual(spawnSpot(), nearA, 'a stale recorded entrance falls back to proximity');
}

// ── HousePieces keeps the entrance record ────────────────────────────────
{
  const ctx = makeContext();
  ctx.run('docs/js/house-pieces-core.js');
  const pieces = ctx.window.HousePieces;
  assert.equal(pieces.lastEnteredEntrance(), null);
  pieces.recordEnteredEntrance('house', 'feat_east');
  const record = pieces.lastEnteredEntrance();
  assert.deepEqual({ ...record }, { pieceId: 'house', featureId: 'feat_east' });
  record.featureId = 'mutated';
  assert.equal(pieces.lastEnteredEntrance().featureId, 'feat_east', 'callers get a copy, not the live record');
  const doorSource = read('docs/js/house-pieces-core.js');
  assert(/recordEnteredEntrance\(entry\.id, f\.id\);\s*deps\.startSceneTransition\(\(\) => deps\.enterInterior\(entry\.id\)\)/.test(doorSource),
    'each door Enter action records its entrance before entering');
}

// ── Weapon trust gifts are a provider; both BanditCombat hooks still run ──
{
  const ctx = makeContext();
  ctx.run('docs/js/doorstep-visits.js');
  ctx.run('docs/config/weapon-trust-visits.js');
  ctx.window.NpcFavorBalance = { relationshipHeartsForNpc: () => 10 };
  ctx.run('docs/js/weapon-trust-visits.js');
  const world = installWorld(ctx, { npcIds: ['jubmir', 'kzubug'] });
  const gear = { tools: {} };
  ctx.window.MetalCraftShop = { init() {} };
  ctx.window.MetalCraftShop.init({
    UNLOCKED_TOOL_SHAPES: ['hatchet', 'bshuakauitl', 'plainsSword'],
    craftedToolItemKey: (shape, metal) => `${shape}_${metal}`,
    getGearInventory: () => gear,
    saveGearInventory() {}, saveMemberWorldData() {}, showToast() {},
  });
  const bandit = ctx.window.BanditCombat.deps;
  assert.deepEqual(Object.keys(bandit.HELD_SHAPE_DEFS), ['hatchet'], 'trust runtime still filters bandit weapon shapes');
  assert(ctx.window.DoorstepVisits.getRuntimeDeps(), 'shared runtime also captured BanditCombat deps (chained hooks)');

  const trust = ctx.window.WeaponTrustVisits;
  const first = trust.pendingGifts()[0];
  goOutside(ctx, world);
  assert.equal(trust.debugSnapshot().activeGiftId, first.id, 'first pending gift visits first');
  const visitor = world.walkers.find(walker => walker._doorstepVisitor);
  assert.equal(visitor.rec.id, `weapon_trust_visit:${first.npcId}`, 'trust visitors keep their configured id prefix');
  talkThrough(ctx, world, { naturalEnd: true });
  assert.equal(gear.tools[`${first.shapeKey}_${first.giftMetalKey}`], true, 'natural end grants the gift');
  assert.equal(trust.debugSnapshot().activeGiftId, null);
  goOutside(ctx, world);
  assert.notEqual(trust.debugSnapshot().activeGiftId, first.id, 'a completed gift does not come back');
}

// ── Tutorial unlock notices ──────────────────────────────────────────────
{
  const ctx = makeContext();
  ctx.run('docs/js/doorstep-visits.js');
  const progress = {};
  const locked = new Set(['b', 'c']);
  ctx.window.CombatTutorialContent = { NPC_ID: 'spearhead_unumanuk', quests: [
    { id: 'basics', title: 'Spearhead — First Arms', combat: 0 },
    { id: 'b', title: 'Spearhead — Reading an Opening', combat: 2, requires: 'basics' },
    { id: 'c', title: 'Spearhead — Staying on Your Feet', combat: 5, requires: 'basics' },
  ] };
  ctx.window.CombatTutorial = { gate: quest => locked.has(quest.id) ? 'locked' : '', questState: id => progress[id] || null };
  ctx.run('docs/js/tutorial-unlock-visits.js');
  const world = installWorld(ctx, { npcIds: ['spearhead_unumanuk'] });

  goOutside(ctx, world);
  assert.equal(world.walkers.some(walker => walker._doorstepVisitor), false, 'always-open lessons are never announced');

  locked.delete('b'); locked.delete('c');
  goOutside(ctx, world);
  const visitor = world.walkers.find(walker => walker._doorstepVisitor);
  assert(visitor, 'Spearhead visits once a lesson unlocks');
  const text = visitor.rec.dialogueTrees[0].nodes.map(node => node.text).join(' ');
  assert(text.includes('Reading an Opening') && text.includes('Staying on Your Feet'), 'lessons that opened together share one visit');
  talkThrough(ctx, world, { naturalEnd: true });
  assert.equal(ctx.window.DoorstepVisits.isDone('tutorial_unlock:b'), true);
  goOutside(ctx, world);
  assert.equal(world.walkers.some(walker => walker._doorstepVisitor), false, 'announced lessons are not announced again');

  progress.c = { status: 'active' };
  ctx.window.DoorstepVisits.restore({});
  assert.deepEqual(ctx.window.TutorialUnlockVisits.next().questIds, ['b'], 'lessons the player already started are skipped');
}

// ── Login lands inside the farmhouse with the front door as the way out ──
{
  const ctx = makeContext();
  ctx.run('docs/js/farmhouse-login-spawn.js');
  ctx.window.HousePieces = {
    debugPieceFeatures: () => [{ id: 'starter', stage: 'built', features: [
      { id: 'feat_front', type: 'entrance', side: 'south', doorTile: '27,6', approachTile: '27,7', hasDoorObj: true, invalid: false },
    ] }],
  };
  const recorded = [];
  ctx.window.HousePieces.recordEnteredEntrance = (pieceId, featureId) => recorded.push({ pieceId, featureId });
  const player = { x: 0, y: 0, angle: 0 };
  let facing = null;
  const entered = [];
  const ok = ctx.window.FarmhouseLoginSpawn.placeInFarmhouse({
    player, TILE: 1,
    enterInterior(pieceId) { entered.push({ pieceId, x: player.x, y: player.y, angle: player.angle }); },
    setFacingAngle(angle) { facing = angle; },
  });
  assert.equal(ok, true);
  assert.deepEqual(entered, [{ pieceId: 'starter', x: 27.5, y: 7.5, angle: -Math.PI / 2 }], 'player stands on the approach tile facing the door before entering');
  assert.equal(facing, -Math.PI / 2);
  assert.deepEqual(recorded, [{ pieceId: 'starter', featureId: 'feat_front' }], 'login records the front door as the entrance used');
}

// ── Wiring ───────────────────────────────────────────────────────────────
{
  const registry = read('docs/js/condition-registry.js');
  const doorstepAt = registry.search(/js\/doorstep-visits\.js\?v=/);
  const trustAt = registry.search(/js\/weapon-trust-visits\.js\?v=/);
  assert(doorstepAt >= 0 && doorstepAt < trustAt, 'shared runtime loads before the trust provider');
  const index = read('docs/index.html');
  const tutorialAt = index.search(/js\/combat\/combat-tutorial\.js\?v=/);
  const noticeAt = index.search(/js\/tutorial-unlock-visits\.js\?v=/);
  const loginAt = index.search(/js\/farmhouse-login-spawn\.js\?v=/);
  const gameAt = index.search(/<script src="game\.js\?v=/);
  assert(tutorialAt >= 0 && tutorialAt < noticeAt && noticeAt < gameAt && loginAt < gameAt, 'providers/login helper load after CombatTutorial and before game.js');
}

console.log('doorstep visits: ok');

'use strict';
// Isolated regression for named NPC-only wandering, mutual visibility, snow dive,
// far-away data relocation, save state, and existing-world adapter reuse.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Shared checkout used to read the exact production module and NPC composer.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('docs/js/nohuknuk-wilderness.js');
const species = JSON.parse(read('docs/config/npcs/species-overrides.json'));
const ZONE = 'map_western_slope'; // Names the existing snowy map where the old shrine is already located.
const TILE = 55; // Real game.js tile-to-pixel units used by the sight adapter.

class Group {
  constructor() {
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.userData = {};
    this.position = { x: 0, y: 0, z: 0, set(x, y, z) {
      this.x = x; this.y = y; this.z = z;
    } };
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = { x: 1, y: 1, z: 1, set(x, y, z) {
      this.x = x; this.y = y; this.z = z;
    } };
  }
  add(child) {
    child.parent?.remove(child);
    this.children.push(child);
    child.parent = this;
    return this;
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
    return this;
  }
}

function makeWalker(id, c = 30, r = 20, extras = {}) {
  const worldScene = new Group();
  const actorRoot = new Group();
  const body = new Group();
  const avatarGroup = new Group();
  const groundShadow = new Group();
  avatarGroup.userData = { bipedalMonster: id === 'nohuknuk' };
  actorRoot.position.set(c + 0.5, 0, r + 0.5);
  actorRoot.add(body);
  actorRoot.add(groundShadow);
  body.add(avatarGroup);
  worldScene.add(actorRoot);
  return {
    rec: { id, ...extras.rec },
    root: actorRoot, avatarGroup, groundShadow,
    _npcCharacterRigRoot: body, area: ZONE, animalKind: extras.animalKind ?? null,
    avatarHeight: 1.19, _legsPrevX: c + 0.5, _legsPrevZ: r + 0.5,
    routeResets: 0, originalUpdates: 0,
    resetRouteState() { this.routeResets++; },
    update() { this.originalUpdates++; },
  };
}

function environment(options = {}) {
  let clockMs = 0; // Supplies deterministic performance time for throttling/diagnostic checks.
  let rngCounter = 0; // Samples distinct map cells for the far-relocation proof.
  let visibleFrom = options.visibleFrom || (() => true); // Test-controlled *directional* LOS.
  let activeArea = options.area || ZONE;
  let walkable = options.walkable || (() => true);
  const tracks = { snow: [], damage: [], los: [], overrides: new Map() }; // Captures integration effects without real rendering.
  const player = { x: 32.5 * TILE, y: 20.5 * TILE, health: 100 };
  if (options.playerFar) { player.x = 2 * TILE; player.y = 2 * TILE; }
  const named = makeWalker('nohuknuk');
  named.rec.wildernessRoaming = species.npcs.nohuknuk.wildernessRoaming;
  const walkers = [named, ...(options.walkers || [])];
  const hostiles = options.hostiles || [];
  const zoneLayout = { cols: 50, rows: 40, tiles: [{ c: 29, r: 20, type: 'grass' }, { c: 34, r: 18, type: 'river' }] };
  const window = {
    location: { search: '' },
    THREE: { Group },
    GameRandom: { random() { rngCounter++; return (rngCounter * 73 % 997) / 997; } },
    NpcScheduling: { registerTargetOverride(id, provider) { tracks.overrides.set(id, provider); } },
    NpcPathfinding: {
      isNpcTileWalkable(area, c, r) { return area === ZONE && walkable(c, r); },
      findNpcPath() { return []; },
      canNpcBeeline() { return true; },
    },
    RangedWeapons: { hasLineOfSight(observer, target) {
      tracks.los.push([observer, target]);
      return visibleFrom(observer, target, player);
    } },
    WildBerries: { nearestAvailableBerry() { return null; }, removeBerryBush() { return true; } },
    WildlifeFoodWeb: { emitDig(actor, substrate, tile) {
      tracks.snow.push({ substrate, tile, actorX: actor.x, root: actor.root });
    } },
    HobunjiGrehlrBurrow: { sampleForagingDivePose(t) {
      const eased = 1 - Math.pow(1 - t, 3);
      return { progress: eased, pitchRad: 66 * Math.PI / 180 * eased, scaleY: 1 - 0.94 * eased };
    } },
  };
  const sandbox = { window, document: { body: null }, performance: { now: () => clockMs },
    URLSearchParams, console, Math };
  vm.runInNewContext(source, sandbox, { filename: 'nohuknuk-wilderness.js' });
  const api = window.NohuknukWilderness;
  const deps = {
    TILE, player, npcWalkers: walkers, hostileObjects: hostiles,
    EXTERIOR_ZONES: { [ZONE]: { cols: 50, rows: 40 } },
    getCurrentArea() { return activeArea; },
    getZoneLayout(area) { return area === ZONE ? zoneLayout : null; },
    getNpcRecord(id) { return walkers.find(x => x.rec.id === id)?.rec; },
    npcSurfaceY() { return 0.23; },
    damageCreature(...args) { tracks.damage.push(args); return true; },
  };
  api.init(deps);
  return {
    api, named, player, window, tracks, walkers, hostiles,
    attach() { api.update(0.51); },
    step(seconds) { clockMs += seconds * 1000; named.update(seconds); },
    setArea(next) { activeArea = next; },
    setVisibility(next) { visibleFrom = next; },
    setWalkable(next) { walkable = next; },
  };
}

{
  const e = environment({ visibleFrom: (observer, target, player) => observer !== player });
  const override = e.tracks.overrides.get('nohuknuk-wilderness');
  assert.equal(typeof override, 'function', 'Existing NPC schedule hook owns all destinations');
  assert.equal(override({ id: 'other' }), null, 'All other named NPC schedules remain untouched');
  const target = override(e.named.rec);
  assert.equal(target.area, ZONE);
  assert(target.c >= 2 && target.c <= 47, 'NPC destinations span the whole Western Slope');
  assert.equal(e.api.__test.validTile(2, 20), true,
    'The western snowfields must be eligible for roaming, fishing, hunting and relocation');
  assert.equal(e.api.__test.validTile(25, 20), true, 'Central snowfields remain eligible');
  assert.equal(e.api.__test.validTile(47, 20), true, 'Eastern snowfields remain eligible');
  assert.equal(e.api.__test.validTile(1, 20), false, 'Standard edge clearance remains intact');
  e.attach();
  e.step(0.26);
  assert.equal(e.api.debugSnapshot().flees, 0, 'One-way sight is not mutual visibility');
  assert(e.tracks.los.length >= 2, 'Both observer-to-target and target-to-observer rays are queried');
  e.setVisibility(() => false);
  e.step(0.26);
  assert.equal(e.api.debugSnapshot().flees, 0, 'Occluded terrain must hide the observer both ways');
  e.setVisibility(() => true);
  e.step(0.26);
  assert.equal(e.api.debugSnapshot().phase, 'flee');
  assert.equal(e.tracks.overrides.get('nohuknuk-wilderness')(e.named.rec).activity, 'taking cover');
  assert.equal(e.tracks.overrides.get('nohuknuk-wilderness')(e.named.rec).run, true,
    'Escape uses the existing NPC running mode, not a separate movement implementation');
  assert(e.named.originalUpdates >= 3, 'The normal walker still owns pathing and gait each frame');
}

{
  const creature = { creatureKey: 'nelk', health: 50, areaId: ZONE, x: 32 * TILE, y: 20 * TILE };
  const animalNpc = makeWalker('banubu', 33, 20, { animalKind: 'grehlr', rec: { kind: 'animal' } });
  const e = environment({ playerFar: true, hostiles: [creature], walkers: [animalNpc] });
  e.attach();
  e.step(0.3);
  assert.equal(e.api.debugSnapshot().flees, 0, 'Wild animals and animal NPCs must not frighten the Bigfoot NPC');
}

for (const [kind, setup] of [
  ['bandit', { hostiles: [{ isBandit: true, areaId: ZONE, health: 60, x: 31 * TILE, y: 20 * TILE }] }],
  ['barbarian', { hostiles: [{ isBarbarian: true, areaId: ZONE, health: 60, x: 31 * TILE, y: 20 * TILE }] }],
  ['trader', { walkers: [makeWalker('travelling_trader', 31, 20)] }],
]) {
  const e = environment({ playerFar: true, ...setup });
  e.attach();
  e.step(0.3);
  assert.equal(e.api.debugSnapshot().phase, 'flee', kind + ' should trigger sight-based flight');
}

{
  const e = environment();
  e.attach();
  e.step(0.26);
  assert.equal(e.api.debugSnapshot().phase, 'flee');
  const chaseTarget = e.tracks.overrides.get('nohuknuk-wilderness')(e.named.rec);
  e.named.root.position.set(chaseTarget.c + 0.5, 0.23, chaseTarget.r + 0.5);
  const before = { x: e.named.root.position.x, z: e.named.root.position.z };
  e.step(0.02);
  assert.equal(e.api.debugSnapshot().phase, 'dig', 'Flee destination transitions to an animated snow dive');
  assert.equal(e.tracks.snow.length, 1, 'Dig begins with shared WildlifeFoodWeb snow clods');
  assert.equal(e.tracks.snow[0].substrate, 'snow');
  assert(e.named._npcCharacterRigRoot.parent?.name === 'nohuknuk_burrow_visual',
    'The original NPC rig is reparented, never cloned');
  const visual = e.named._npcCharacterRigRoot.parent;
  assert(visual.scale.y < 1 && visual.rotation.x > 0, 'The existing Grehlr dive tilts and sinks the entire NPC body');
  for (let i = 0; i < 30 && e.api.debugSnapshot().phase !== 'roam'; i++) e.step(0.025);
  const snapshot = e.api.debugSnapshot();
  assert.equal(snapshot.phase, 'roam', 'A successful dive completes with unseen far-side relocation');
  assert.equal(snapshot.relocations, 1);
  assert(Math.hypot(snapshot.x - before.x, snapshot.z - before.z) >=
    species.npcs.nohuknuk.wildernessRoaming.relocationMinTiles,
    'Every landing must honor the full authored 17-tile minimum, without a shorter fallback');
  assert.equal(visual.visible, true);
  assert.equal(visual.rotation.x, 0);
  assert.equal(visual.scale.y, 1);
  assert.equal(e.named.groundShadow.visible, true);
  assert.equal(e.named._legsPrevX, e.named.root.position.x, 'No huge cross-map foot stride is accumulated');
  const save = e.api.serialize();
  assert.equal(save.version, 1);
  assert.equal(save.area, ZONE);
  assert.equal(save.hidden, false, 'Successful relocation saves a visible roaming NPC');
  const next = environment({ playerFar: true });
  assert.equal(next.api.restore(save), true);
  next.attach();
  assert.equal(next.named.root.position.x, save.x);
  assert.equal(next.named.root.position.z, save.z);
  assert.equal(next.api.debugSnapshot().relocations, 1);
}

{
  let checks = 0; // NPC walkability cannot be queried while the distant zone scene is still deferred.
  const e = environment({ walkable: () => { checks++; return false; }, area: 'town' });
  e.named.root._pendingZoneAdd = ZONE;
  e.attach();
  for (let i = 0; i < 10; i++) e.step(0.2);
  assert.equal(checks, 0, 'Deferred zone walkers may not query an unavailable pathfinding grid');
  assert.equal(e.api.debugSnapshot().phase, 'roam',
    'An unloaded Western Slope cannot force a perfectly safe NPC to burrow into nonexistent ground');
  e.named.root._pendingZoneAdd = null; // The game clears this marker after mounting the actual zone scene.
  e.setWalkable(() => true);
  e.setArea(ZONE);
  e.step(0.1);
  assert.equal(e.api.debugSnapshot().phase, 'roam', 'A mounted zone resumes the ordinary NPC schedule');
}

{
  const e = environment({ visibleFrom: () => false });
  e.named.root.position.set(1.5, 0, 1.5); // A Tothal Shift put his old saved home outside walkable bounds.
  e.attach();
  e.step(0.1);
  const state = e.api.debugSnapshot();
  assert.equal(state.phase, 'roam', 'A blocked starting tile is repaired even while the player is in-zone');
  assert.equal(state.relocations, 1, 'Spawn repair uses the existing hidden relocation instead of a visible teleport');
  assert(e.api.__test.validTile(Math.floor(state.x), Math.floor(state.z)), 'The repaired tile must be NPC-walkable');
  assert(Math.hypot(state.x - 1.5, state.z - 1.5) >= species.npcs.nohuknuk.wildernessRoaming.relocationMinTiles,
    'Spawn repair must not visibly jump to a nearby snowfield');
  assert(e.named.groundShadow.visible, 'A successful repair reveals the original NPC shadow at its safe location');
}

{
  let tileChecks = 0; // Verifies that an obstructed world's failed landing search cannot run every frame.
  const e = environment({ walkable: () => { tileChecks++; return false; }, visibleFrom: () => false });
  e.named.root.position.set(1.5, 0, 1.5);
  e.attach();
  e.step(0.1);
  assert.equal(e.api.debugSnapshot().phase, 'hidden');
  const afterFirstSearch = tileChecks;
  for (let i = 0; i < 35; i++) e.step(0.016);
  assert.equal(tileChecks, afterFirstSearch, 'A hidden NPC must wait between expensive failed landing checks');
  assert.equal(e.named.groundShadow.visible, false, 'Blocked spawn must hide the shadow as well as the body');
  assert.equal(e.named._npcCharacterRigRoot.parent.visible, false);
  const saved = e.api.serialize();
  assert.equal(saved.hidden, true, 'An unlanded NPC must stay buried across save/load');
  const resumed = environment({ walkable: () => false, visibleFrom: () => false });
  assert.equal(resumed.api.restore(saved), true);
  resumed.attach();
  assert.equal(resumed.api.debugSnapshot().phase, 'hidden');
  assert.equal(resumed.named._npcCharacterRigRoot.parent.visible, false,
    'A restored underground NPC may not flash visibly before the next update');
  assert.equal(resumed.named.groundShadow.visible, false);
}

{
  const e = environment({ walkable: () => false });
  e.attach();
  e.step(0.26);
  e.step(0.1);
  for (let i = 0; i < 100 && e.api.debugSnapshot().phase !== 'hidden'; i++) e.step(0.05);
  assert.equal(e.api.debugSnapshot().phase, 'hidden', 'No safe landing means remaining hidden, not teleporting into a wall');
  assert.equal(e.api.debugSnapshot().relocations, 0);
}

{
  const e = environment({ area: 'town' });
  e.attach();
  e.step(1);
  assert.equal(e.api.debugSnapshot().flees, 0, 'No psychic threat sensing across maps');
  e.window.RangedWeapons = null;
  e.setArea(ZONE);
  e.step(0.3);
  assert.equal(e.api.debugSnapshot().flees, 0, 'Missing LOS API is fail-closed, never omniscient');
}

const game = read('docs/game.js');
const index = read('docs/index.html');
const grehlr = read('docs/js/combat/combat-grehlr-burrow.js');
const food = read('docs/js/wildlife-food-web.js');
const composer = read('docs/js/local-db-overrides.js');
assert(index.includes('js/nohuknuk-wilderness.js'), 'Main game loads new module before initializing the NPC roster');
assert(game.includes('window.NohuknukWilderness?.init?.('), 'Game passes existing NPC actors, generated terrain, and combat adapters');
assert(game.includes('window.NohuknukWilderness?.update?.(dt)'), 'Normal NPC loop attaches exactly one AI wrapper');
assert(game.includes('member.nohuknukWildernessState = window.NohuknukWilderness?.serialize?.()'), 'Member save persists his location');
assert(game.includes('window.NohuknukWilderness?.restore?.(playerData.nohuknukWildernessState)'), 'Save load restores his location');
assert(grehlr.includes('sampleForagingDivePose'), 'Grehlr exposes its identical dive easing for the NPC');
assert(food.includes('npcWalkerStrike, emitDig,'), 'Snow burrow uses existing globally capped particle simulation');
assert(composer.includes('npc.wildernessRoaming = JSON.parse(JSON.stringify(override.wildernessRoaming))'),
  'All NPC database sources receive the authored Nohuknuk-only roaming settings');
assert.equal(species.npcs.nohuknuk.wildernessRoaming.sightRadiusTiles, 9);
assert.equal(species.npcs.nohuknuk.wildernessRoaming.zoneId, ZONE);
assert.equal(species.npcs.nohuknuk.wildernessRoaming.region, 'western-slope');
assert.equal(Object.hasOwn(species.npcs.nohuknuk.wildernessRoaming, 'eastMinFraction'), false,
  'No accidental eastern-half restriction may return via authored NPC settings');
assert.equal(Object.hasOwn(environment().api.DEFAULTS, 'eastMinFraction'), false,
  'Runtime bounds must not silently reinstate the deleted east-only limit');
console.log('Nohuknuk wilderness: mutual LOS, actor filters, run, shared snow dive, distant relocation and save/restore passed.');

'use strict';
const assert = require('node:assert/strict'); // Behavioral checks run the production controller.
const fs = require('node:fs'); // Loads production source and authored config.
const vm = require('node:vm'); // Isolates browser-shaped game hosts.
const source = fs.readFileSync('docs/js/harlyao-night-march-runtime.js', 'utf8'); // Runtime under test.
const config = JSON.parse(fs.readFileSync('docs/config/harlyao-night-march.json', 'utf8')); // Authored settings.
const flush = () => new Promise(resolve => setImmediate(resolve)); // Resolves asynchronous avatar completion.
function position() { return { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } }; }
function scene() { return { children: new Set(), add(root) { root.parent = this; this.children.add(root); }, remove(root) { this.children.delete(root); root.parent = null; } }; }
async function host(options = {}) {
  let hour = 0, day = 1, area = 'town', paused = false; // Mutable game lifecycle controls.
  const world = scene(); // Tracks live versus parked render roots.
  const grid = Array.from({ length: 200 }, () => Array.from({ length: 200 }, () => ({ surfaceY: 7 }))); // Raised terrain detects placement bugs.
  const made = [], discarded = [], subscriptions = new Map(), restored = []; // Entity lifecycle and scheduler evidence.
  const player = { x: 0, y: 0 }; // Pixel-space player.
  const deps = { TILE: 64, player, hostileObjects: new Set(), zoneLayouts: new Map([['map_northern_cliffs', { cols: 200, rows: 200 }]]), getCurrentArea: () => area, getActiveScene: () => world, getActiveGrid: () => grid, getActiveCols: () => 200, getActiveRows: () => 200, tileSurfaceYInArea: tile => tile.surfaceY, isPaused: () => paused, creatureCanEnterTile: options.canEnter }; // Real dependency contracts include Set storage.
  const combat = {
    init() {}, async loadGangConfig() { return {}; },
    async makeEntity(_cfg, _rank, _tier, x, y, opts) {
      if (options.buildGate) await options.buildGate;
      const group = { visible: true, position: position(), traverse() {} }; // Minimal avatar root.
      const c = { id: `entity-${made.length}`, x, y, homeX: x, homeY: y, health: 40, maxHealth: 40, halfHeight: 0.5, def: { aggroRangePx: 384, moveSpeed: 118 }, areaId: opts.zoneId, areaGrid: grid, areaCols: 200, areaRows: 200, avatarRef: { group, dispose() { c.disposeCalls = (c.disposeCalls || 0) + 1; } }, rosterRecord: opts.rosterOverride, weaponShape: opts.defOverride.weaponShapeKey, ...opts.extra }; // Unique per-instance definition.
      made.push(c); world.add(group); return c;
    },
    discardEntity(c) { discarded.push(c); c.avatarRef.dispose(); c.avatarRef.group.parent?.remove(c.avatarRef.group); deps.hostileObjects.delete(c); },
  }; // Shared humanoid construction/disposal authority.
  const window = { BanditCombat: combat, BanditCamps: { updateCampBanners() {} }, CalendarSystem: { getHour: () => hour, timeDebugSnapshot: () => ({ rawDay: day }) }, RuntimeFrameScheduler: { register(id, callback, opts) { subscriptions.set(id, { callback, opts }); } }, Ghostify: { apply() {}, restore(root) { restored.push(root); }, registerGlowSource() {} }, requestAnimationFrame: callback => callback() }; // Browser-shaped production integration.
  const sharedContext = { window }; // Use real skeleton equipment generation when materializing ghost soldiers.
  for (const file of ['metal-armor-system.js', 'combat/combat-minion.js']) vm.runInNewContext(fs.readFileSync('docs/js/' + file, 'utf8'), sharedContext);
  vm.runInNewContext(source, { window, fetch: async () => ({ ok: true, json: async () => structuredClone(config) }), performance, Date });
  await flush(); combat.init(deps);
  return { api: window.HarlyaoNightMarch, made, discarded, deps, subscriptions, world, window, restored,
    setHour(value) { hour = value; }, setDay(value) { day = value; }, setArea(value) { area = value; }, setPaused(value) { paused = value; },
    tick(dt = 0.2) { window.HarlyaoNightMarch.update(dt); },
    movePlayer(x, y) { player.x = x * 64; player.y = y * 64; },
  };
}
(async () => {
  const h = await host(); // Offscreen agents should exist without avatars.
  assert.equal(h.subscriptions.get('harlyao-night-march').opts.phase, 'pre-game');
  h.tick();
  let d = h.api.debugSnapshot(); // Start at the route entrance, irrespective of night hour.
  assert.equal(d.membersAlive, 20); assert.equal(d.membersCached, 0); assert.equal(h.made.length, 0);
  const initialX = d.commander.x; // Continuous simulated position baseline.
  for (let i = 0; i < 50; i++) h.tick();
  d = h.api.debugSnapshot();
  assert(d.commander.x > initialX && d.commander.x < initialX + 13, 'offscreen speed follows elapsed seconds');
  const beforeJump = d.commander.x; // Game-hour changes must not interpolate toward an endpoint.
  h.setHour(5.5); h.tick();
  assert(Math.abs(h.api.commanderTarget().x - beforeJump) < 1.2, 'no clock-driven chunk teleport');
  assert(h.api.commanderTarget().x < 40, 'late night does not force journey completion');
  h.setPaused(true); for (let i = 0; i < 10; i++) h.tick();
  assert.equal(h.api.commanderTarget().x, beforeJump, 'paused game does not advance abstract travel');
  h.setPaused(false);

  const target = h.api.commanderTarget(); // Enter the bubble around the existing data-only army.
  h.setArea(target.zoneId); h.movePlayer(target.x, target.z);
  for (let i = 0; i < 24; i++) { h.tick(); await flush(); }
  d = h.api.debugSnapshot();
  assert.equal(h.made.length, 20); assert.equal(h.deps.hostileObjects.size, 20);
  assert.equal(d.detailedMembers, 20);
  assert.deepEqual([...new Set(h.made.map(c => c.weaponShape))].sort(), Array.from(h.window.MinionCombat.defaultWeaponShapes).sort(), 'army covers the complete skeleton melee pool');
  for (const c of h.made) {
    assert.equal(c.rosterRecord.appearance.speciesId, 'harlyao');
    assert.equal(c.rosterRecord.appearance.gender, 'male');
    assert.deepEqual(Array.from(c.rosterRecord.metalArmorItems, item => h.window.MetalArmorSystem.baseCosmeticId(item)).sort(), ['rounded_pauldron', 'tangedcirclet']);
    assert(c.rosterRecord.metalArmorItems.every(item => item.temperXp === h.window.MetalArmorSystem.MAX_TEMPER_XP));
  }

  for (const c of h.made) {
    assert.equal(c.state, 'return', 'native travel state owns detailed movement');
    assert.equal(c.avatarRef.group.position.y, 7.5, 'first materialization samples current terrain');
    assert.equal(c.def.aggroRangePx, 0); assert(c.def.moveSpeed > 0);
  }
  const leader = h.made.find(c => c.harlyaoArmyIndex === 0); // Commander identity must survive differing visible order.
  const lagger = h.made.find(c => c.harlyaoArmyIndex === 19); // Stalled follower exercises regrouping.
  lagger.x = leader.x - 12 * 64; lagger.y = leader.y;
  h.tick();
  assert.equal(h.api.debugSnapshot().regrouping, true);
  assert.equal(leader.homeX, leader.x, 'commander waits for the lagging follower');
  assert.equal(lagger.homeX, leader.x, 'straggler paths to the actual commander');
  for (const c of h.made) if (c !== leader) { c.x = leader.x - 2 * 64; c.y = leader.y; }
  h.tick();
  assert.equal(h.api.debugSnapshot().regrouping, false); assert(leader.homeX > leader.x);
  leader.x += 0.3 * 64;
  assert.equal(h.api.commanderTarget().x, leader.x / 64, 'beacon accessor follows native position between planner ticks');

  h.movePlayer(leader.x / 64 + 19, leader.y / 64); h.tick();
  assert.equal(leader.areaId, target.zoneId, 'release hysteresis keeps a nearby actor visible past the entry radius');
  h.setArea('town'); h.tick();
  assert.notEqual(leader.areaId, target.zoneId); assert.equal(leader.avatarRef.group.parent, null, 'parked avatar detaches from scene');
  const identity = h.api.commanderTarget().id; // Dormant retirement preserves identity and progress.
  for (let i = 0; i < 20; i++) h.tick();
  assert.equal(h.deps.hostileObjects.size, 0); assert.equal(h.api.commanderTarget().id, identity);
  const returning = h.api.commanderTarget(); // Re-entry rematerializes from the simulated position, not a chunk center.
  h.setArea(target.zoneId); h.movePlayer(returning.x, returning.z);
  for (let i = 0; i < 24; i++) { h.tick(); await flush(); }
  const successorVictim = [...h.deps.hostileObjects].find(c => c.harlyaoArmyIndex === 0); // Kill current commander to exercise stable succession.
  successorVictim.health = 0; h.tick();
  assert.equal(h.api.debugSnapshot().membersAlive, 19); assert.notEqual(h.api.commanderTarget().id, identity);
  assert.equal(h.api.debugSnapshot().provoked, true);
  for (const c of h.deps.hostileObjects) if (c.health > 0) assert.equal(c.homeX, c.x, 'combat is leashed to the engagement rather than a remote march endpoint');
  h.setHour(6); h.tick();
  assert.equal(h.api.commanderTarget(), null); assert.equal(h.deps.hostileObjects.size, 0);
  assert.equal(h.api.debugSnapshot().membersCached, 0);

  let release; // Delayed avatar completion after dawn must be discarded.
  const gate = new Promise(resolve => { release = resolve; }); // Build race gate.
  const race = await host({ buildGate: gate }); // Separate lifecycle isolates the pending constructor.
  race.setArea('map_northern_cliffs'); race.movePlayer(2, 100); race.tick(); await flush();
  assert.equal(race.api.debugSnapshot().building, true);
  race.setHour(6); race.tick(); release(); await flush();
  assert.equal(race.deps.hostileObjects.size, 0); assert.equal(race.discarded.length, 1);
  assert.equal(race.api.debugSnapshot().membersCached, 0);
  const blocked = await host({ canEnter: (_def, x) => x >= 9 * 64 }); // A blocked entry must relocate onto valid native terrain.
  blocked.setArea('map_northern_cliffs'); blocked.movePlayer(2, 100); blocked.tick(); await flush();
  assert(blocked.made[0].x >= 9 * 64, 'materialization avoids blocked tiles');
  assert.equal(blocked.made[0].avatarRef.group.position.y, 7.5);
  const impassable = await host({ canEnter: () => false }); // No valid tile means no registered or visible actor.
  impassable.setArea('map_northern_cliffs'); impassable.movePlayer(2, 100); impassable.tick(); await flush();
  assert.equal(impassable.deps.hostileObjects.size, 0); assert.equal(impassable.api.debugSnapshot().membersAlive, 20);
  assert.equal(impassable.made[0].avatarRef.group.parent, null);
  for (const day of [1, 2, 3, 4]) { // All four daily directions retain a cohesive data-only army.
    const routeHost = await host(); routeHost.setDay(day); routeHost.tick();
    const start = routeHost.api.commanderTarget(); // Route-specific entry point.
    for (let i = 0; i < 500; i++) routeHost.tick();
    const end = routeHost.api.debugSnapshot(); // After one hundred real seconds of simulated travel.
    const route = config.routesClockwise[day - 1]; // Authored axis/direction.
    assert((end.commander[route.axis === 'x' ? 'x' : 'z'] - start[route.axis === 'x' ? 'x' : 'z']) * route.direction > 50);
    for (const agent of end.agents) assert(Math.hypot(agent.x - end.commander.x, agent.y - end.commander.z) < 11, 'offscreen followers stay near their commander');
    assert.equal(routeHost.made.length, 0, 'abstract travel allocates no humanoids');
  }
  const lifecycle = await host(); // Resource/appearance continuity must survive actual portrait retirement.
  lifecycle.tick();
  assert.equal(new Set(lifecycle.api.debugSnapshot().agents.map(agent => `${agent.x},${agent.y}`)).size, 20, 'entry ranks do not overlap after clamping');
  lifecycle.setArea('map_northern_cliffs');
  lifecycle.movePlayer(8, 100);
  for (let i = 0; i < 24; i++) { lifecycle.tick(); await flush(); }
  const wounded = lifecycle.made.find(c => c.harlyaoArmyIndex === 0); // Wounded commander before leaving view.
  wounded.health = 17; wounded.stamina = 9; wounded.footing = 22;
  wounded.afflictions = { bleedingHealth: 3 }; wounded.exhaustion = { active: true, blackStamina: 44 };
  wounded.rosterRecord.appearance.bodyColors = { body1: '#123456' };
  wounded._travelPath = [{ col: 1, row: 1 }]; wounded._travelPathTarget = { x: 999, y: 999 };
  lifecycle.setArea('town'); lifecycle.tick();
  lifecycle.setArea('map_northern_cliffs'); lifecycle.tick();
  assert.equal(wounded._travelPath, null, 'wake discards pre-sleep route waypoints');
  assert.equal(wounded._travelPathTarget, null);
  lifecycle.setArea('town');
  for (let i = 0; i < 20; i++) lifecycle.tick();
  assert.equal(wounded.disposeCalls, 1); assert(lifecycle.restored.includes(wounded.avatarRef.group), 'restore ghost materials before disposing their source avatar');
  const resumed = lifecycle.api.commanderTarget(); // Same commander, new representation.
  lifecycle.setArea('map_northern_cliffs'); lifecycle.movePlayer(resumed.x, resumed.z);
  for (let i = 0; i < 24; i++) { lifecycle.tick(); await flush(); }
  const rebuilt = [...lifecycle.deps.hostileObjects].find(c => c.harlyaoArmyIndex === 0); // New rig must retain logical resources and appearance.
  assert.notEqual(rebuilt, wounded); assert.equal(rebuilt.health, 17); assert.equal(rebuilt.stamina, 9); assert.equal(rebuilt.footing, 22);
  assert.equal(rebuilt.afflictions.bleedingHealth, 3); assert.equal(rebuilt.exhaustion.blackStamina, 44);
  assert.equal(rebuilt.rosterRecord.appearance.bodyColors.body1, '#123456');
  const discardedBeforeClear = lifecycle.discarded.length; // Simulate clearHostileObjects disposing all real rigs outside the planner.
  for (const c of lifecycle.deps.hostileObjects) { c.avatarRef.dispose(); c.avatarRef.group.parent?.remove(c.avatarRef.group); }
  lifecycle.deps.hostileObjects.clear(); lifecycle.tick(); await flush();
  assert.equal(lifecycle.discarded.length, discardedBeforeClear, 'world-reset detection does not dispose a rig a second time');
  for (let i = 0; i < 24; i++) { lifecycle.tick(); await flush(); }
  assert.equal(lifecycle.api.debugSnapshot().detailedMembers, 20, 'external world clear rebuilds actors rather than waking disposed geometry');
  const corpse = [...lifecycle.deps.hostileObjects].find(c => c.harlyaoArmyIndex === 0); // CreatureDeath owns bodies removed by lethal hits.
  corpse.health = 0; lifecycle.deps.hostileObjects.delete(corpse); lifecycle.tick();
  lifecycle.setHour(6); lifecycle.tick();
  assert(!lifecycle.discarded.includes(corpse), 'dawn does not double-dispose a CreatureDeath-owned corpse');
  assert.equal(lifecycle.api.debugSnapshot().membersAlive, 0);
  const frozen = await host(); frozen.tick(); const frozenX = frozen.api.commanderTarget().x; // Switchbox AI freeze must include the abstract army.
  frozen.window.DevTestingSwitchbox = { flags: { noNpcBehavior: true } };
  for (let i = 0; i < 20; i++) frozen.tick();
  assert.equal(frozen.api.commanderTarget().x, frozenX);
  console.log('Commander simulation, native travel, regrouping, LOD, retirement, succession and dawn races passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

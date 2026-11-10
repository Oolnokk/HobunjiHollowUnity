// Wilderness ruin sites: cliff-entrance locale expansion, authored pieces,
// and the game/treasure/ruin wiring that js/ruin-sites.js depends on.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const RL = require('../docs/js/ruin-site-locales.js');
const template = JSON.parse(read('docs/config/locales/locale_ruin_entrance.json'));

assert.strictEqual(template.category, 'ruin_entrance');
assert(JSON.parse(read('docs/config/locales/index.json')).locales.some(entry => entry.id === template.id), 'ruin entrance must be in the locale index');

// Four quarter turns return the authored locale exactly.
let spun = template;
for (let i = 0; i < 4; i++) spun = RL.rotateOnce(spun);
assert.deepStrictEqual(spun, template, 'rotateOnce x4 must be the identity');

// One quarter turn moves the cliff from the south edge to the west edge and faces the door east.
const east = RL.rotateToFacing(template, 'east');
const door = east.objects.find(object => object.kind === 'ruinDoor');
assert.strictEqual(door.visual.facing, 'east');
const highCells = Object.entries(east.terrainAnchors).filter(([, rule]) => rule.height?.min >= 1).map(([key]) => Number(key.split(',')[0]));
const lowCells = Object.entries(east.terrainAnchors).filter(([, rule]) => rule.terrain === 'plateauCliff' && rule.height?.max === 0).map(([key]) => Number(key.split(',')[0]));
assert(Math.max(...highCells) < Math.min(...lowCells), 'east-facing copy must keep its high cliff cells west of the mouth');
assert(Object.values(east.terrainAnchors).filter(rule => rule.terrain === 'plateauCliff').every(rule => rule.facing === 'east'));

const zones = ['map_a', 'map_b', 'map_skip'];
const expanded = RL.expandLocaleDefs([{ id:'other', category:'story_poi' }, { ...template, ruinSite:{ ...template.ruinSite, excludeZones:['map_skip'] } }], 7, zones, 'world');
assert.strictEqual(expanded[0].id, 'other', 'non-ruin locales pass through');
const copies = expanded.filter(locale => locale.templateId === template.id);
assert.strictEqual(copies.length, 2 * template.ruinSite.copiesPerZone, 'copiesPerZone per non-excluded zone');
assert(copies.every(copy => /_c7_/.test(copy.id) && copy.placement.allowedZones.length === 1 && copy.placement.allowedZones[0] !== 'map_skip'), 'copies are cycle-stamped and pinned to one zone');
for (const zone of ['map_a', 'map_b']) {
  const facings = copies.filter(copy => copy.placement.allowedZones[0] === zone).map(copy => copy.ruinSite.facing);
  assert.strictEqual(new Set(facings).size, Math.min(4, facings.length), `${zone} copies cover available cardinal facings`);
}
assert.deepStrictEqual(RL.expandLocaleDefs([template], 7, zones, 'world').map(copy => copy.id), RL.expandLocaleDefs([template], 7, zones, 'world').map(copy => copy.id), 'expansion is deterministic');

for (const key of ['ruinEntranceTunnel', 'ruinEntranceDoor', 'ruinEntranceDoorRubble', 'ruinTargetPillar', 'ruinPillarBroken', 'ruinPillarStump', 'ruinRubblePile', 'ruinBurrowHole']) {
  const piece = JSON.parse(read(`docs/config/furniture-authored/${key}.json`));
  assert.strictEqual(piece.schema, 'hobunji_furniture_authored_runtime.v1', `${key} is authored furniture`);
  assert(read('docs/js/ruin-sites.js').includes(`'${key}'`), `${key} is placed by js/ruin-sites.js`);
  assert(read('docs/tools/furniture-avatar-author/index.html').includes(`furniture-authored/${key}.json`), `${key} is importable in the Furniture Author`);
}
const doorPiece = JSON.parse(read('docs/config/furniture-authored/ruinEntranceDoor.json'));
assert(doorPiece.decals.some(decal => decal.glow?.off?.[0] === '#ff3b30' && decal.glow?.on?.[0] === '#ffffff'), 'entrance door seal glows red locked / white open');
const leafMotion = doorPiece.puzzle.motion.parts.leaf;
assert(['sx', 'sy', 'sz'].every(axis => leafMotion.off[axis] && leafMotion.on[axis]), 'motion parts carry the full rest transform so the leaf is not rescaled');
assert(JSON.parse(read('docs/config/furniture-authored/ruinTargetPillar.json')).puzzle.role === 'activator');

const game = read('docs/game.js');
assert(game.includes('window.RuinSites?.expandLocaleDefs?.(localeDefs, year'), 'Tothal Shift expands ruin-entrance templates');
assert(game.includes('window.RuinSites?.registerWorkspace?.(zoneId, workspace)'), 'placed sites are registered per zone');
assert(game.includes('window.RuinSites?.buildZoneMeshes?.(zScene, zGrid, mapId)'), 'zone builds render the sites');
assert(game.includes('window.RuinSites?.objectAt?.(currentArea, col, row)'), 'site prompts are world objects');
assert(game.includes('return window.CalendarSystem.tothalCycle(calendar.day);'), 'Tothal Shift is monthly');
assert(read('docs/js/stampable-locale-defs.js').includes("'ruin_entrance'"), 'ruin entrances are stamped');
assert(read('docs/js/wild-treasure.js').includes('window.RuinSites.openHole(mapId, placement.col, placement.row)'), 'rare treasure opens a ruin hole');
assert(read('docs/js/dev-random-ruin-sanctum.js').includes('window.RuinSites?.completeActiveRuin?.()'), 'exit ladder completes the site');
const index = read('docs/index.html');
assert(index.indexOf('js/ruin-sites.js') > 0 && index.indexOf('js/ruin-sites.js') < index.indexOf('game.js?v='), 'ruin sites load before game.js');
assert(index.indexOf('js/ruin-site-locales.js') < index.indexOf('js/ruin-sites.js'));
for (const file of ['docs/js/ruin-sites.js', 'docs/js/stampable-locale-defs.js']) new vm.Script(read(file), { filename:file });

// Monthly cycle: raw day 1 is cycle 1, day 29 starts cycle 2.
const calendarSource = read('docs/js/calendar-system.js');
const pick = pattern => { const match = calendarSource.match(pattern); assert(match, `calendar-system.js lost ${pattern}`); return match[0]; };
const calendarMath = [
  pick(/const WEEKDAY_NAMES = \[[^\]]*\];/), pick(/const DAYS_PER_WEEK = [^;]*;/), pick(/const DAYS_PER_MONTH = [^;]*;/),
  pick(/const GAME_START_MONTH_INDEX = [^;]*;/), pick(/const GAME_START_CIVIL_DAY_OFFSET = [^;]*;/),
  pick(/function civilDayOffset\(day[^)]*\) \{[^}]*\}/), pick(/function tothalCycle\(day[^)]*\) \{[^}]*\}/), pick(/function nextTothalShiftDay\(day[^)]*\) \{[^}]*\}/),
].join('\n');
const CS = vm.runInNewContext(`const deps = { calendar:{ day:1 } };\n${calendarMath}\n({ tothalCycle, nextTothalShiftDay });`);
assert.strictEqual(CS.tothalCycle(1), 1, 'raw day 1 keeps Tothal cycle 1 (existing worlds keep seed y1)');
assert.strictEqual(CS.tothalCycle(28), 1);
assert.strictEqual(CS.tothalCycle(29), 2, 'the Tothal Shift rolls every 28-day civil month');
assert.strictEqual(CS.nextTothalShiftDay(5), 29);
async function testEntranceCollision() {
  const world = {}; // Runs the real registry and ruin-site builder with minimal mesh adapters.
  class Group {
    constructor() {
      this.type = 'Group';
      this.position = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
      this.rotation = {};
      this.scale = {};
      this.userData = {};
    }
    add(group) { group.parent = this; }
    remove(group) { group.parent = null; }
    traverse() {}
    updateMatrixWorld() {}
  }
  class Box3 {
    setFromObject() { return this; }
    expandByScalar() { return this; }
  }
  Object.assign(world, {
    THREE: { Group, Box3 },
    RuinSiteLocales: RL,
    AuthoredFurniture: { load: () => Promise.resolve(), peek: key => key === 'ruinTargetPillar', buildGroup: () => new Group() },
  });
  const context = vm.createContext({ window: world, THREE: world.THREE }); // Only pillar pieces are needed for this collision fixture.
  for (const file of ['area-footprint-blockers', 'ruin-sites']) vm.runInContext(read(`docs/js/${file}.js`), context);
  const zone = 'map_cliff_collision'; // Test zone avoids story vault side effects.
  const scene = Object.assign(new Group(), { type: 'Scene' }); // Live scene used to publish and replace the runtime collision index.
  const sites = world.RuinSites; // Registers the same geometry provider as gameplay.
  const blockers = world.AreaFootprintBlockers; // Queried by movement and projectiles.
  sites.init({ getCurrentArea: () => zone, NORMAL_TOP: 0, PLATEAU_UNIT: 2.5 });
  sites.registerWorkspace(zone, { localeInstances: [{
    category: RL.CATEGORY, localeId: 'test', objects: [
      { kind: 'ruinDoor', x: 8, y: 8 },
      { kind: 'ruinSlot', id: 'edge', x: 3.6, y: 3.8 },
      { kind: 'ruinSlot', id: 'other', x: 20, y: 20 },
      { kind: 'ruinSlot', id: 'negative', x: -8, y: -8 },
    ],
  }] });
  sites.buildZoneMeshes(scene, [], zone);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(blockers.blocksBox(zone, 3.9, 4.2), true, 'a pillar spanning a cell boundary blocks a point on the far side');
  assert.equal(blockers.blocksBox(zone, 3.6, 4.3, 0.12), true, 'a body overlap survives the cell boundary');
  assert.equal(blockers.blocksBox(zone, 4.1, 4.3, 0, 3), false, 'height still clears the pillar for projectiles');
  assert.equal(blockers.blocksBox(zone, -7.5, -7.5), true, 'negative-world coordinates remain indexed');
  assert.equal(blockers.blocksBox(zone, 9, 9), false, 'empty terrain does not collide');
  assert.equal(blockers.blocksBox(zone, 9, 9, 8), true, 'wide queries retain exact overlap behavior');
  sites.registerWorkspace(zone, {});
  sites.buildZoneMeshes(scene, [], zone);
  assert.equal(blockers.blocksBox(zone, 3.9, 4.2), false, 'zone refresh drops the previous collision index');
}

testEntranceCollision().then(() => console.log('ruin sites checks passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

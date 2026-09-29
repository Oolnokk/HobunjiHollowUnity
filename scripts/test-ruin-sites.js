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
  assert.strictEqual(new Set(facings).size, facings.length, `${zone} copies use distinct facings`);
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
console.log('ruin sites checks passed');

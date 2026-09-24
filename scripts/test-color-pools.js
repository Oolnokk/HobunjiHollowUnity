const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const colorLocale = require('../docs/config/locales/locale_color_pools_cave.json');
const pedestal = require('../docs/config/furniture-authored/stonePedestal.json');

const stable = [
  {
    id: 'maxed',
    name: 'Paintable',
    kind: 'gar-wolf-alpha',
    level: 10,
    genotype: {
      base: { color: '#775533', copies: 2 },
      colorpoint: { color: '#ddaa88', copies: 1, enabled: true },
      foxtail: { color: '#eeeeee', copies: 0, enabled: false },
      mitts: { color: '#332211', copies: 1, enabled: false },
    },
  },
  { id: 'low', name: 'Too Low', kind: 'gar-wolf', level: 9, genotype: { base: { color: '#777777', copies: 2 } } },
];

const context = {
  console,
  window: null,
  KeyItemSystem: { has: id => id === 'color_pools_key' },
  StableAnimalProgression: { maxLevel: 10, stableEntries: () => stable, saveStable() {} },
  CreatureGenetics: { SPECIES_ALIAS: { 'gar-wolf-alpha': 'gar-wolf' } },
  CreatureGeneticsRender: { SPECIES: { 'gar-wolf': { patterns: ['colorpoint', 'foxtail', 'mitts'] } } },
};
context.window = context;
vm.createContext(context);
vm.runInContext(read('docs/js/color-pools-system.js'), context, { filename: 'color-pools-system.js' });

const api = context.ColorPoolsSystem;
assert(api, 'ColorPoolsSystem exports');
assert.equal(api.stableMaxLevel(), 10, 'Color Pools reads the live refined Stable level cap');
assert.deepEqual(api.eligibleStableAnimals().map(entry => entry.id), ['maxed'], 'only max-level Stable animals are eligible');
assert.deepEqual(
  JSON.parse(JSON.stringify(api.regionsFor(stable[0]))).map(region => region.id),
  ['base', 'colorpoint'],
  'paintable regions are the filled genetic base and currently expressed body-pattern layers only'
);

assert.equal(pedestal.schema, 'hobunji_furniture_authored_runtime.v1');
assert.equal(pedestal.key, 'stonePedestal');
assert.equal(pedestal.parts.length, 5, 'Color Pools altar uses the existing five-part stone pedestal asset');

const pools = colorLocale.cavern?.features?.colorPools || [];
assert.equal(pools.length, 3);
for (const pool of pools) assert.equal(pool.tiles.length, 4, pool.id + ' remains a 2x2 authored pool');

const renderer = read('docs/js/creature-genetics-render.js');
const weaving = read('docs/js/clothing-weaving-system.js');
const stableSource = read('docs/js/stable-animal-progression.js');
const furniture = read('docs/js/procedural-furniture.js');
const game = read('docs/game.js');
const index = read('docs/index.html');
const colorPoolsSource = read('docs/js/color-pools-system.js'); // Checks the picker surface against the game's page-wide absolute canvas styling.
assert.match(read('docs/style.css'), /canvas\s*\{\s*position:\s*absolute/, 'game canvas styling applies globally to the Color Pools canvas');
assert.match(colorPoolsSource, /\.cp-preview canvas\{position:static;inset:auto;[^}]*pointer-events:none/, 'the preview stays in its own panel and cannot intercept animal-picker input');

assert(renderer.includes('function applyColorPoolPaint('), 'genetic renderer owns the region-aware Color Pools paint seam');
assert(renderer.includes("applyColorPoolPaint(baseSource, genotype, 'base'"), 'base paint is applied through its dedicated region path');
assert(renderer.includes('fullBaseRecolor ? null : mask'), 'ordinary base paint is clipped by the authored genetic base mask');
assert(renderer.includes('applyColorPoolPaint(recolored, genotype, patternId, null'), 'body-pattern paint is confined by that transparent genetic overlay');
assert(renderer.includes('colorPoolPaintSignature(genotype)'), 'paint participates in genotype cache signatures');
assert(weaving.includes('applyPatternToTintedImage, // Shared motif compositor'), 'the real weaving compositor is public for Color Pools/NPC reuse');
assert(weaving.includes('pattern?.motifUrl'), 'shared compositor also accepts repo-authored motif URLs');
assert(stableSource.includes('stableEntries, // Shared live Stable collection'), 'Stable progression exposes its existing live collection instead of a duplicate store');
assert(stableSource.includes('saveStable,'), 'Color Pools persists through the Stable owner');
assert(furniture.includes('CATALOG.stonePedestal'), 'stone pedestal has a loading-race fallback matching the authored asset');
assert(game.includes("stonePedestal: { itemKey: 'colorPoolsAltarFurniture'"), 'Color Pools altar is a non-shop fixture');
assert(game.includes("colorPoolsAltarFurniture: () => window.ColorPoolsSystem?.makeAltarInteractable"), 'the authored altar opens the Color Pools workflow');
const buildingButtons = game.slice(game.indexOf('// Building interior: spot transitions require explicit input'), game.indexOf('// Procedural mine floors are building interiors'));
assert(buildingButtons.indexOf('if (bInteractable) return bInteractable.getButtons()') < buildingButtons.indexOf("heldMode === 'tool'"), 'altar prompt takes priority over cavern tool actions');
assert(game.includes('window.ColorPoolsSystem?.decorateScene?.({ THREE, scene: bScene, mapData })'), 'Color Pools feature metadata decorates the generated cave');
assert(game.includes('window.ColorPoolsSystem?.init({'), 'Color Pools receives the ordinary game movement/input lock');
assert(index.includes('js/color-pools-system.js'), 'Color Pools system loads before game.js');

console.log('Color Pools max-level Stable filtering, genetic-region paint integration, altar asset, and cave visuals checks passed');

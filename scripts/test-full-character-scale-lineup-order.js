'use strict';
// Family-order regression: Full Character Scale's scene order and chooser must share one male/female-paired order.
const assert = require('node:assert/strict'); // Validates both the production comparator and spatial Box3 layout.
const fs = require('node:fs'); // Loads actual authoring code, not a separate hand-written ordering algorithm.
const vm = require('node:vm'); // Runs private editor functions without WebGL.

const source = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Actual shipped Full Character Scale implementation.
const profiles = {}; // Intentionally scrambled insertion order catches reliance on authored registration sequence.
const species = ['mashtzarr', 'longoran', 'mao-ao', 'porakaneki', 'kenkari', 'nuhongan',
  'mammakhbuur', 'tletingan', 'harlyao', 'engh-sho', 'oliphanti'];
for (const speciesId of species) for (const gender of ['female', 'male']) {
  profiles[speciesId + '::' + gender] = { species: speciesId, gender };
}
profiles['rakakoan::male'] = { species: 'rakakoan', gender: 'male' }; // NPC aliases never duplicate an authored Kenkari.
profiles['ghoul::female'] = { species: 'ghoul', gender: 'female' }; // NPC aliases never duplicate an authored Mao'ao.
const window = { HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: profiles } }; // Real profileDescriptors reads this registry.
const context = vm.createContext({
  window, URL, console, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
  location: { href: 'https://example.test/tools/animation-author/index.html',
    pathname: '/tools/animation-author/index.html' },
  document: { currentScript: null, getElementById: () => null },
});
const testApi = [
  '  window.__lineupOrderTest = {',
  '    profileDescriptors, compareLineupEntries, lineupFamily, lineupSpacing,',
  '    arrangeEntries(list) {',
  '      THREE = { Box3: class {',
  '        setFromObject(group) { this.group = group; this.min = { z: -.2 }; this.max = { z: .2 }; return this; }',
  '        getSize(target) { target.x = this.group.width; return target; }',
  '        getCenter(target) { target.x = 0; return target; }',
  '      }, Vector3: class { constructor() { this.x = 0; } } };',
  '      entries = list; previewRoot = { updateMatrixWorld() {} }; chair = null;',
  '      layout();',
  '      return entries.map(entry => ({ key:entry.key, species:entry.species, gender:entry.gender, x:entry.group.position.x, width:entry.group.width }));',
  '    },',
  '  };',
  '})();',
].join('\n'); // Injects a seam into the actual module, without adding a test-only global to the game.
const footer = '  install();\n})();';
assert(source.includes(footer), 'author editor bootstrap footer is still available');
vm.runInContext(source.replace(footer, testApi), context);
const api = window.__lineupOrderTest;
const ordered = api.profileDescriptors(); // One list drives the progressive render loop and dropdown options.
const wantedSpecies = ['kenkari', 'tletingan', 'nuhongan', 'longoran', 'engh-sho', 'mao-ao',
  'mashtzarr', 'mammakhbuur', 'harlyao', 'oliphanti', 'porakaneki'];
const wanted = wantedSpecies.flatMap(s => [s+'::male',s+'::female']);
assert.deepEqual(Array.from(ordered, item => item.key), wanted,
  'all species, including late additions, group in user-defined family order with male/female pairs');
assert.equal(api.lineupFamily('tletingan'), api.lineupFamily('nuhongan'), 'Slagothim subspecies share a family');
assert.equal(api.lineupFamily('mashtzarr'), api.lineupFamily('mammakhbuur'), 'Oliphanti subspecies share a family');
const actual = api.arrangeEntries(ordered.map((item, index) => ({
  ...item,
  group: {
    width: index % 3 === 0 ? .55 : .72, // Simulates species-specific rendered Box3 widths.
    position: { x:0, set(x,y,z) { this.x = x; this.y=y; this.z=z; } },
    updateMatrixWorld() {},
  },
})));
function gapAt(index) {
  const left = actual[index], right = actual[index+1];
  return right.x - left.x - left.width/2 - right.width/2;
}
assert(Math.abs(gapAt(0)-.14)<1e-8,'male/female adjacent at tight spacing');
assert(Math.abs(gapAt(1)-.72)<1e-8,'Kenkari to Slagothim introduces a family boundary');
assert(Math.abs(gapAt(3)-.42)<1e-8,'two different Slagothim subspecies have a normal species gap');
assert(Math.abs(gapAt(7)-.72)<1e-8,'Slagothim to Engh-sho introduces a family boundary');
assert(Math.abs(gapAt(11)-.72)<1e-8,'Mao-ao to Oliphanti introduces a family boundary');
assert(Math.abs(gapAt(13)-.42)<1e-8,'Oliphanti subspecies stay grouped');
assert(Math.abs(gapAt(15)-.72)<1e-8,'everyone else follows after a family boundary');
assert.equal(new Set(actual.map(x=>x.key)).size, wanted.length, 'layout has no duplicate or dropped avatars');
assert.match(source, /const ordered = reps\.sort\(compareLineupEntries\)/,
  'incrementally rendered previews must retain sorted order');
assert.match(source, /chooser\.appendChild\(option\)/, 'dropdown options follow that same progressive build order');
assert.match(source, /cursor \+= lineupSpacing\(previous, entry\)/, 'family spacing applies inside visual layout');
console.log('PASS full scale lineup family order, male/female adjacency, Box3 gaps, aliases, fallback sorting and dropdown parity');

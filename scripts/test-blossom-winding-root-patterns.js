// Check that uploaded blossom and winding-root motifs are usable repo patterns in every shared tool.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const docs = path.resolve(__dirname, '../docs'); // Authoritative asset and pattern-library root for this test.
const specs = [
  ['blessed_blossom_balance', false, 'square'],
  ['blessed_blossom_potential', false, 'square'],
  ['blessed_blossom_rebirth', false, 'square'],
  ['blessed_blossom_windswept', false, 'square'],
  ['winding_roots', true, 'diamond'],
]; // Expected default placements for every newly published motif.
const index = JSON.parse(fs.readFileSync(path.join(docs, 'config/patterns/index.json'), 'utf8')); // Public catalog consumed by the tools.
const compositorSource = fs.readFileSync(path.join(docs, 'js/clothing-weaving-system.js'), 'utf8'); // One compositor owns independently tinted overpass masks.
assert(compositorSource.includes('overpassInkHex'), 'shared compositor supports an independent overpass ink color');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // Guards against accidentally registering a non-PNG file.

for (const [id, tiling, frameShape] of specs) {
  const matching = index.patterns.filter(entry => entry.id === id); // Prevents duplicate tool options and missing catalog entries.
  assert.equal(matching.length, 1, id + ': exactly one index entry');
  const file = path.join(docs, matching[0].file); // Resolved JSON definition that the loader fetches.
  const definition = JSON.parse(fs.readFileSync(file, 'utf8')); // Validates portable repo pattern schema/placement.
  assert.equal(definition.schema, 'hobunji_pattern.v1');
  assert.equal(definition.id, id);
  assert.equal(definition.collectible, false, id + ': decorative, not a ruin reward');
  assert.equal(definition.settings.tiling, tiling);
  assert.equal(definition.settings.frameShape, frameShape);
  const expected = id === 'winding_roots'
    ? { motifScale: 1.11, motifThinPx: 2, frameShape: 'diamond', frameX: -9.412844473855543,
        frameY: 7.321108098615682, frameRotationDeg: 43, frameScale: 1.5694130284370735, meshScale: 1.86 }
    : { motifScale: 1, motifThinPx: 3, frameShape: 'square', frameX: 0, frameY: 0,
        frameRotationDeg: 0, frameScale: 1, meshScale: 3.2 }; // Values match the supplied renamed exports, not invented defaults.
  for (const [field, value] of Object.entries(expected)) assert.equal(definition.settings[field], value, id + ': ' + field);
  assert.equal(definition.settings.invert, false);
  const imagePath = path.join(docs, definition.motifPng); // PNG used in preview and in-game pattern rendering.
  assert(fs.existsSync(imagePath), id + ': source artwork exists');
  assert(fs.readFileSync(imagePath).subarray(0, 8).equals(pngSignature), id + ': valid PNG header');
}

(async () => {
  const context = {
    window: {},
    document: { currentScript: { src: 'https://hobunji.test/docs/js/repo-pattern-library.js' } },
    URL,
    fetch: async url => {
      const pathname = new URL(url).pathname.replace(/^\/docs\//, ''); // Matches the loader's docs-relative fetch behavior.
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(docs, pathname), 'utf8')) };
    },
    console,
  }; // Minimal browser shims exercising the actual repository pattern loader.
  vm.runInNewContext(fs.readFileSync(path.join(docs, 'js/repo-pattern-library.js'), 'utf8'), context);
  await context.window.RepoPatternLibrary.preloadEditable().catch(async () => {
    // The editor's image hydration needs an Image/canvas; basic catalog availability only needs load().
    context.window.RepoPatternLibrary.clearCache();
    return context.window.RepoPatternLibrary.load();
  });
  const available = context.window.RepoPatternLibrary.listCached(); // Same list used by Pattern Editor and Furniture Editor selectors.
  for (const [id, tiling, frameShape] of specs) {
    assert(available.some(entry => entry.id === id), id + ': available in the repository library');
    const pattern = context.window.RepoPatternLibrary.getCachedById(id); // Tool-resolvable, portable default pattern.
    assert(pattern?.motifUrl?.endsWith('/assets/patterns/motif_' + id + '.png'));
    assert.equal(pattern.tiling, tiling);
    assert.equal(pattern.frameShape, frameShape);
  }
  console.log('Blossom and Winding Roots motifs: 5 assets, definitions and catalog entries verified');
})().catch(error => { console.error(error); process.exitCode = 1; });

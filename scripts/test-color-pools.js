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
  Combat: { deps: { companionObjects: [] } },
  Mounts: { rideEntity: null },
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  dispatchEvent() {},
};
context.window = context;
vm.createContext(context);
vm.runInContext(read('docs/js/color-pools-system.js'), context, { filename: 'color-pools-system.js' });

const api = context.ColorPoolsSystem;
assert(api, 'ColorPoolsSystem exports');
vm.runInContext(read('docs/js/voorg-ass-registration.js'), context, { filename: 'voorg-ass-registration.js' });
context.VoorgAssRegistration.ensureRendererSpecies(context.CreatureGeneticsRender.SPECIES); // Reuse the live species registration instead of duplicating its Color Pools region metadata.
context.CreatureGenetics.SPECIES_ALIAS['voorg-ass-herd-mother'] = 'voorg-ass'; // Same canonical species mapping used for adult and mother stable portraits.
for (const kind of ['voorg-ass', 'voorg-ass-herd-mother']) {
  const entry = { kind, genotype: {
    base: { color: '#4b6987', copies: 2 },
    belly: { color: '#b9a174', copies: 2, enabled: true },
  } }; // Coat-colored anatomical beard is not a separate inheritable or paintable region.
  assert.deepEqual(JSON.parse(JSON.stringify(api.regionsFor(entry).map(region => region.id))),
    ['base', 'belly'], kind + ' offers base coat and belly paint but never an independent beard/hoof selector');
}
assert.equal(api.stableMaxLevel(), 10, 'Color Pools reads the live refined Stable level cap');
assert.equal(api.overpassUnlocked(), false, 'unfinished Quest 2 cannot add an overpass');
assert.equal(api.__test.setOverpassPattern('base', 'overpass'), false, 'direct call cannot bypass quest gate');
const banubuState = { stage: 2, status: 'active' }; // Uses the real Banubu quest progression state shape.
context.BanubuQuestline = { ensureQuestState: () => banubuState };
assert.equal(api.overpassUnlocked(), false, 'accepting the Nine Leaf Tea request is not enough');
banubuState.stage = 3; banubuState.status = 'blocked';
assert.equal(api.overpassUnlocked(), true, 'turning in Quest 2 unlocks permanent second-layer paint');
banubuState.stage = 4; banubuState.status = 'active';
assert.equal(api.overpassUnlocked(), true, 'reward remains unlocked when later Banubu quests resume');
banubuState.stage = 3; banubuState.status = 'blocked';
context.PatternLibrary = { getById: id => ({ motifDataUrl: 'data:image/png;base64,AA==', repoPatternId: id }) };
api.__test.setLibraryPattern('base', 'primary');
assert.equal(api.__test.setOverpassPattern('base', 'overpass'), true);
assert.equal(api.__test.paintPatternStack({ pattern: { repoPatternId: 'primary' }, patterns: [{ repoPatternId: 'primary' }, { repoPatternId: 'overpass' }] })[1].repoPatternId, 'overpass');
context.DyeSystem = { getById: id => ({ id, hex: id === 'primary-dye' ? '#225588' : '#cc7722' }) }; // Two independently unlocked game dyes.
api.__test.setDye('base', 'primary-dye');
api.__test.setOverpassDye('base', 'second-dye');
const painted = api.__test.cleanDraft().base; // Same canonical paint snapshot written to the Stable genotype on Apply.
assert.equal(painted.dyeHex, '#225588', 'primary retains its first dye');
assert.equal(painted.patterns[1].inkColorHex, '#cc7722', 'overpass snapshot stores its independent dye');
api.__test.setLibraryPattern('base', 'new-primary');
assert.equal(api.__test.cleanDraft().base.patterns[1].inkColorHex, '#cc7722', 'replacing primary retains its independent overpass dye');
api.__test.setOverpassPattern('base', '');
assert.equal(api.__test.cleanDraft().base.patterns.length, 1, 'clearing only overpass leaves first paint intact');
assert.equal(api.__test.addFusedPattern('base', 'fuse-a'), true, 'first fused motif can share the base genetic region');
assert.equal(api.__test.addFusedPattern('base', 'fuse-b'), true, 'a third motif shares primary ink rather than occupying the overpass slot');
assert.equal(api.__test.setFusedPatternPlacement('base', 0, { repoPatternId:'fuse-a', usageOffsetX:12 }), true, 'individual fused motifs have independent placement settings');
assert.equal(api.__test.cleanDraft().base.mergedPatterns[0].usageOffsetX, 12, 'fused placement persists through Apply data normalization');
assert.equal(api.__test.cleanDraft().base.patterns.length, 1, 'fused motifs do not masquerade as an overpass in the legacy pattern stack');
api.__test.setOverpassPattern('base', 'overpass');
assert.equal(api.__test.cleanDraft().base.mergedPatterns.length, 2, 'an overpass coexists with the merged primary pattern group');
assert.equal(api.__test.cleanDraft().base.patterns[1].inkColorHex, '#cc7722', 'the distinct overpass still receives its own dye');
api.__test.setLibraryPattern('base', 'new-primary');
assert.equal(api.__test.cleanDraft().base.mergedPatterns.length, 2, 'changing primary preserves the additive fused motifs');
assert.equal(api.__test.removeFusedPattern('base', 0), true, 'a single fused motif can be removed without clearing the genetic region');
assert.equal(api.__test.cleanDraft().base.mergedPatterns.length, 1, 'only the selected fused motif was removed');
assert.equal(api.__test.removeFusedPattern('base', 0), true, 'last fused motif can be removed');
assert.equal(api.__test.cleanDraft().base.patterns[1].inkColorHex, '#cc7722', 'removing fused motifs retains the original overpass');
api.__test.setOverpassPattern('base', '');
const previewSource = { dyeHex:'#225588', pattern:{ repoPatternId:'old' }, patterns:[
  { repoPatternId:'old' }, { repoPatternId:'overpass', inkColorHex:'#cc7722' }
] }; // Simulates Color Pools' saved two-color paint before opening PatternAuthoring.
const preview = api.__test.previewPrimaryPatternPaint(previewSource, { repoPatternId:'unsaved-draft' });
assert.equal(preview.pattern.repoPatternId,'unsaved-draft','legacy primary alias shows the unsaved edit');
assert.equal(preview.patterns[0].repoPatternId,'unsaved-draft','actual two-slot compositor receives the unsaved primary edit');
assert.equal(preview.patterns[1].inkColorHex,'#cc7722','editing primary does not erase the overpass color');
assert.equal(previewSource.patterns[0].repoPatternId,'old','preview never mutates saved paint before Apply');

assert.match(read('docs/js/banubu-questline.js'), /state\.stage = 3;/, 'real Banubu second turn-in owns the saved reward state');

assert.deepEqual(api.eligibleStableAnimals().map(entry => entry.id), ['maxed'], 'only max-level Stable animals are eligible');
assert.deepEqual(
  JSON.parse(JSON.stringify(api.regionsFor(stable[0]))).map(region => region.id),
  ['base', 'colorpoint'],
  'paintable regions are the filled genetic base and currently expressed body-pattern layers only'
);

assert.equal(pedestal.schema, 'hobunji_furniture_authored_runtime.v1');
assert.equal(pedestal.key, 'stonePedestal');
assert.equal(pedestal.parts.length, 5, 'Color Pools altar uses the existing five-part stone pedestal asset');
assert.equal(colorLocale.cavern?.surfaceMaterial, 'farm-cliff', 'Color Pools cavern uses Banubu\'s proven farm-cliff surface pipeline');
assert(pedestal.parts.every(part => part.materialTexture === 'carved_smooth.png'), 'every altar stage uses the canonical carved-smooth PNG');
assert(pedestal.parts.every(part => part.materialLighting === 'unlit'), 'every altar stage keeps the canonical PNG unlit instead of Lambert-wrapping it');
assert(pedestal.parts.every(part => part.materialUvMapping === 'connected-surface-stretch'), 'every altar stage opts into the same connected-surface UV treatment that fixed Banubu\'s cave');
assert(pedestal.parts.every(part => part.materialUvMaxPatchWorldSize === 6), 'altar surface mapping uses Banubu\'s farm-scale six-world-unit patch cap');

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
const liveCompanion = { // Matching live companion used to exercise the exact Color Pools repaint invalidation path.
  genotype: stable[0].genotype,
  _genotypeReadyFrames: { stale: true },
  _genotypeLogged: new Set(['idle:old']),
  currentFrameUrl: 'old-frame.png',
  _blinkAppliedShut: true,
};
context.Combat.deps.companionObjects.push(liveCompanion);
api.__test.invalidateLiveAnimal(stable[0]);
assert.equal(typeof liveCompanion._genotypeLogged?.has, 'function', 'repaint invalidation preserves the Set-like genotype log contract used by the animation loop');
assert.equal(liveCompanion._genotypeLogged.size, 0, 'repaint invalidation clears stale genotype log entries');
assert.equal(liveCompanion._genotypeReadyFrames, null, 'repaint invalidation forces genotype frame recomposition');
assert.equal(liveCompanion.currentFrameUrl, null, 'repaint invalidation drops the stale live frame URL');
assert.equal(liveCompanion._blinkAppliedShut, null, 'repaint invalidation clears stale blink composition state');
assert(!colorPoolsSource.includes('actor._genotypeLogged = false;'), 'Color Pools must never replace the live companion genotype log Set with a boolean');

assert(renderer.includes('function applyColorPoolPaint('), 'genetic renderer owns the region-aware Color Pools paint seam');
assert(renderer.includes("applyColorPoolPaint(basePaintSource, genotype, 'base'"), 'base paint is applied through its dedicated region path');
assert(renderer.includes('fullBaseRecolor ? null : basePaintMask'), 'ordinary base paint is clipped by the authored genetic base mask');
assert(renderer.includes('applyColorPoolPaint(recolored, genotype, patternId, patternPaintMask'), 'pattern paint receives the selected overlay mask when the species needs pigment-only coverage');
assert(renderer.includes('const patternPaintMask = patternSourceKey && colorPoolPaintFor(genotype, patternId)'), 'keyed overcoat paint excludes teeth, hooves and ink; ordinary patterns retain their inherent alpha mask');
assert(renderer.includes('colorPoolPaintSignature(genotype)'), 'paint participates in genotype cache signatures');
assert(renderer.includes('fusedPrimaryCount'), 'animal renderer tells the compositor to union the same-color group before its separate overpass');
assert(renderer.includes('paint.mergedPatterns'), 'saved fused motifs survive into the runtime species renderer');
assert(weaving.includes('function fuseSampledPatternMasks('), 'shared mask combinator draws one perimeter around overlapping motifs');

assert.match(weaving, /PATTERNED_CANVAS_CACHE_LIMIT = 96/, 'raster cache has an entry bound');
assert.match(weaving, /PATTERNED_CANVAS_CACHE_BYTES = 48 \* 1024 \* 1024/, 'raster cache caps retained RGBA memory at 48 MiB');
assert.match(weaving, /pendingPatternStackCanvases\.set\(key, task\)/, 'identical concurrent frame requests share one in-flight bake');
assert.match(weaving, /finally \{ if \(pendingPatternStackCanvases\.get\(key\) === task\) pendingPatternStackCanvases\.delete\(key\); \}/, 'completed and failed bakes release their pending cache entries');
assert.match(weaving, /compactPatternCacheKey\(JSON\.stringify\(renderable\)\)/, 'long embedded motif data URLs are hashed instead of retained as cache keys');
assert.match(weaving, /\|\$\{debugLabel\}\|/, 'the cache key separates clothing and animal outlining semantics');
assert.match(weaving, /const renderableSlots = patterns\.flatMap\(/, 'source-slot identity is preserved even if some motif image references are absent');
assert.doesNotMatch(weaving, /const patternCanvases = \[\]/, 'one fused animal render does not retain every temporary motif canvas simultaneously');
assert.match(colorPoolsSource, /previewNeedsAnotherPass = true/, 'slider edits are coalesced behind the currently composing preview');
assert.match(colorPoolsSource, /previewCoalesced\+\+/, 'mobile diagnostics count prevented redundant preview renders');
const bakeCacheStart = weaving.indexOf('  function forgetPatternedCanvas(');
const bakeCacheEnd = weaving.indexOf('  const wovenIconDataUrlPromises =', bakeCacheStart);
assert(bakeCacheStart > 0 && bakeCacheEnd > bakeCacheStart, 'isolated LRU implementation found for direct testing');
const bakeCache = vm.runInNewContext(`
  const patternedCanvasCache = new Map();
  const patternedCanvasBytesByKey = new Map();
  const PATTERNED_CANVAS_CACHE_LIMIT = 96;
  const PATTERNED_CANVAS_CACHE_BYTES = 48 * 1024 * 1024;
  let patternedCanvasBytes = 0, patternedCanvasEvictions = 0, patternedCanvasEpoch = 0;
  const pendingPatternStackCanvases = new Map(), pendingPatternCanvasPromises = new Map();
  ${weaving.slice(bakeCacheStart, bakeCacheEnd)}
  ({ cachedPatternedCanvas, rememberPatternedCanvas, clearPatternedCanvases,
    pendingPatternStackCanvases, pendingPatternCanvasPromises,
    status: () => ({ count: patternedCanvasCache.size, bytes: patternedCanvasBytes, evictions: patternedCanvasEvictions, epoch: patternedCanvasEpoch }) });
`);
for (let i = 0; i < 110; i++) bakeCache.rememberPatternedCanvas('small:' + i, { width: 10, height: 10 });
assert.equal(bakeCache.status().count, 96, 'baked image cache evicts oldest entries after 96 images');
assert.equal(bakeCache.cachedPatternedCanvas('small:0'), null, 'evicted sprites are recomposed on later request');
assert(bakeCache.cachedPatternedCanvas('small:109'), 'newly painted sprites stay hot');
bakeCache.clearPatternedCanvases();
for (let i = 0; i < 20; i++) bakeCache.rememberPatternedCanvas('large:' + i, { width: 1024, height: 1024 });
assert.equal(bakeCache.status().bytes, 48 * 1024 * 1024, 'baked animal images cannot exceed their 48 MiB cache budget');
assert.equal(bakeCache.status().count, 12, 'the byte budget evicts large images well below the 96-entry cap');
const staleEpoch = bakeCache.status().epoch; // Simulates an animal bake started before a player profile/equipment reset.
bakeCache.pendingPatternStackCanvases.set('old-frame', Promise.resolve({width:10,height:10}));
bakeCache.pendingPatternCanvasPromises.set('old-woven', Promise.resolve({width:10,height:10}));
bakeCache.clearPatternedCanvases();
bakeCache.rememberPatternedCanvas('old-frame', {width:10,height:10}, staleEpoch);
assert.equal(bakeCache.status().count, 0, 'late old-appearance raster results cannot resurrect a cleared cache');
assert.equal(bakeCache.pendingPatternStackCanvases.size, 0, 'reset removes pending fused-frame work from deduplication');
assert.equal(bakeCache.pendingPatternCanvasPromises.size, 0, 'reset removes pending garment work from deduplication');
assert(bakeCache.status().epoch > staleEpoch, 'each cache reset invalidates the prior generation');
const hashStart = weaving.indexOf('  function compactPatternCacheKey(');
const hashEnd = weaving.indexOf('  function patternStackCanvasKey(', hashStart);
const compact = vm.runInNewContext('(' + weaving.slice(hashStart, hashEnd).trim() + ')');
assert.equal(compact('same'), compact('same'), 'bake cache key is stable');
assert.notEqual(compact('same'), compact('different'), 'different patterns cannot reuse stale baked pixels');
assert(compact('data:image/png;base64,' + 'A'.repeat(100000)).length < 50, 'large pattern PNG is represented by a short cache key');
const bakeWrapperStart = weaving.indexOf('  async function applyPatternStackToTintedImage(');
const bakeWrapperEnd = weaving.indexOf('  async function composePatternStackToTintedImage(', bakeWrapperStart);
assert(bakeWrapperStart > 0 && bakeWrapperEnd > bakeWrapperStart, 'async bake wrapper exists separately from the expensive raster builder');
const bakeWrapper = weaving.slice(bakeWrapperStart, bakeWrapperEnd);
let rasterCount = 0, finishRaster = null;
const renderGate = new Promise(resolve => { finishRaster = resolve; }); // Holds one fake bake open so two concurrent requests must join it.
const bakeEnvironment = { normalizePatternStack: patterns => patterns, cachedPatternedCanvas: () => null, pendingPatternStackCanvases: new Map(),
  patternStackRenderKey: () => 'same-baked-frame', composePatternStackToTintedImage: () => { rasterCount++; return renderGate; } }; // Exercises the production concurrency wrapper without needing a browser canvas.
const bakeProbe = vm.runInNewContext(`
  const { normalizePatternStack, cachedPatternedCanvas, pendingPatternStackCanvases, patternStackRenderKey, composePatternStackToTintedImage } = environment;
  let patternStackJoinCount = 0;
  ${bakeWrapper}
  ({ render: applyPatternStackToTintedImage, joinCount: () => patternStackJoinCount });
`, { environment: bakeEnvironment });
const frameStub = { width: 8, height: 8 }, patternStub = [{ motifUrl: 'motif:test' }]; // Identical frame and motif inputs used by concurrent animal requests.
const firstBake = bakeProbe.render(frameStub, patternStub, '#ffffff', 'animal:test');
const secondBake = bakeProbe.render(frameStub, patternStub, '#ffffff', 'animal:test');
assert.equal(rasterCount, 1, 'two simultaneous equivalent requests launch exactly one expensive raster bake');
assert.equal(bakeProbe.joinCount(), 1, 'duplicate requests are recorded by performance diagnostics');
finishRaster(frameStub);
Promise.all([firstBake, secondBake]).then(frames => {
  assert.equal(frames[0], frameStub, 'first caller receives the baked frame');
  assert.equal(frames[1], frameStub, 'second caller receives that same baked frame');
  assert.equal(bakeEnvironment.pendingPatternStackCanvases.size, 0, 'successful bakes release their in-flight entry');
}).catch(error => { console.error('Fused-pattern pending bake regression:', error); process.exitCode = 1; });


const fuseStart = weaving.indexOf('  function fuseSampledPatternMasks(');
const fuseEnd = weaving.indexOf('\n  function patternStackRenderKey(', fuseStart);
const fuse = vm.runInNewContext('(' + weaving.slice(fuseStart, fuseEnd).trim() + ')'); // Exercise pure intersection behavior without browser canvas.
const merged = fuse([Uint8Array.from([1,1,0,0]), Uint8Array.from([0,1,1,0])],
  [Uint8Array.from([0,1,0,0]), Uint8Array.from([0,0,1,0])], 2);
assert.deepEqual(Array.from(merged.combinedMask), [1,1,1,0], 'overlapping same-ink motifs combine into one continuous alpha silhouette');
assert.deepEqual(Array.from(merged.combinedSeparator), [0,0,1,0], 'fusion removes the internal overlap seam but retains outer motif separators');
assert(colorPoolsSource.includes('.cp-preview-column{position:sticky'), 'Color Pools preview remains pinned while scrolling many regions');
assert(colorPoolsSource.includes('data-act="add-fused"'), 'Color Pools exposes additive pattern picker and per-entry remove controls');
assert(weaving.includes('.loomcraft-preview-column{position:sticky'), 'loom pattern editing keeps the shared preview in sight');
assert(weaving.includes('applyPatternStackToTintedImage, // Shared primary+overpass and opt-in fused-primary compositor'), 'the shared compositor remains public for Color Pools/NPC reuse');
assert(weaving.includes('pattern.motifDataUrl || pattern.motifUrl'), 'shared stack compositor also accepts repo-authored motif URLs');
assert(renderer.includes('applyPatternStackToTintedImage'), 'Color Pools routes animal surface paint through the primary+overpass compositor');
assert(renderer.includes('overpass: overpass ? { clearanceMultiplier: Math.max(3, Math.min(12'), 'only the distinct overpass can expose knot-style clearance; fused motifs cannot');
assert(stableSource.includes('stableEntries, // Shared live Stable collection'), 'Stable progression exposes its existing live collection instead of a duplicate store');
assert(stableSource.includes('saveStable,'), 'Color Pools persists through the Stable owner');
assert(furniture.includes('CATALOG.stonePedestal'), 'stone pedestal has a fallback matching the authored asset');
const pedestalFallback = furniture.slice(furniture.indexOf('CATALOG.stonePedestal = ['), furniture.indexOf('CATALOG.statue = [')); // Isolates only the Color Pools fallback recipe.
assert.equal((pedestalFallback.match(/materialTexture: 'carved_smooth\.png'/g) || []).length, 5, 'all five fallback altar stages keep the stone PNG');
assert.equal((pedestalFallback.match(/materialLighting: 'unlit'/g) || []).length, 5, 'all five fallback altar stages preserve the historical Banubu unlit-material fix');
assert.equal((pedestalFallback.match(/materialUvMapping: 'connected-surface-stretch'/g) || []).length, 5, 'all five fallback altar stages preserve connected-surface mapping');
assert(game.includes("stonePedestal: { itemKey: 'colorPoolsAltarFurniture'"), 'Color Pools altar is a non-shop fixture');
assert(game.includes("colorPoolsAltarFurniture: () => window.ColorPoolsSystem?.makeAltarInteractable"), 'the authored altar opens the Color Pools workflow');
const buildingButtons = game.slice(game.indexOf('// Building interior: spot transitions require explicit input'), game.indexOf('// Procedural mine floors are building interiors'));
assert(buildingButtons.indexOf('if (bInteractable) return bInteractable.getButtons()') < buildingButtons.indexOf("heldMode === 'tool'"), 'altar prompt takes priority over cavern tool actions');
assert(game.includes('window.ColorPoolsSystem?.decorateScene?.({ THREE, scene: bScene, mapData })'), 'Color Pools feature metadata decorates the generated cave');
assert(game.includes('window.ColorPoolsSystem?.init({'), 'Color Pools receives the ordinary game movement/input lock');
assert(index.includes('js/color-pools-system.js'), 'Color Pools system loads before game.js');

console.log('Color Pools max-level Stable filtering, genetic-region paint integration, altar asset, and cave visuals checks passed');

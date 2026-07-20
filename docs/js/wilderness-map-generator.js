// Wilderness Map Generator — headless core of WildernessMapGeneratorV4412.html.
//
// This is the generation pipeline of the standalone Wilderness Map Generator
// tool (V4412), extracted verbatim minus its canvas renderer, 3D preview, and
// DOM controls, wrapped as a UMD module so it runs in the game (browser) and
// in Node for headless checks. Given a seed string it deterministically
// builds a full wilderness map (plateaus, rivers, ramps, escarpments, flora,
// fauna, caves, reachability repair) and flattens it through the tool's own
// Map Editor export path (buildHobunjiMapExport), returning the exact
// `hobunji_map_editor_workspace.v1` JSON the tool's "Export" button produces.
// The game's Tothal Shift consumes that workspace as if it had been exported
// from the tool and imported over a wilderness zone map.
//
// V4412 added a named terrain-preset system (TERRAIN_PRESETS: dramatic
// packed-bleacher plateaus, a Great Basin spoon/horseshoe basin) and a
// boundary-cliff-mode system (BOUNDARY_PLATEAU_MODES: cliffs that follow the
// scanned playable map height, or entry-side-only cliffs with a distant
// landscape filling the other sides) with a cliff height boost. Each zone in
// ZONE_CONFIG below opts into one preset/mode/boost combination; anything
// that does not opt in keeps the original custom/legacyFullRing behavior.
// V4412's post-layout tile-density pass (every generated tile becoming a
// GENERATION_TILE_SCALE x GENERATION_TILE_SCALE block) runs unconditionally,
// matching the standalone tool exactly — every zone now exports at 2x the
// width/height it generates at internally (e.g. a 100x100 zone exports as
// 200x200). This matters beyond resolution: the Map Editor submap export
// filter drops plateau groups below an absolute tile-count threshold, so
// skipping this pass (as an earlier version of this file did) silently lost
// more small plateaus' elevation than the standalone tool does.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WildernessMapGenerator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const colors = {
    groundLow: '#14391e',
    groundHigh: '#9be673',
    rampInk: 'rgba(20, 14, 7, 0.68)',
    rampGlow: 'rgba(255, 255, 210, 0.30)', 
    water: '#3b8cc4',
    waterDeep: '#236da5',
    path: '#c8ab67',
    invisiblePath: 'rgba(255,255,255,0.24)',
    den: '#4b2d18',
    denRoute: 'rgba(255, 126, 54, 0.24)',
    grid: 'rgba(0,0,0,0.20)',
    tree: '#72451e',
    log: '#8a5725',
    stump: '#7a471f',
    bush: '#39e84f',
    dig: '#ffd328',
    ore: '#c8ced3',
    boulder: '#46484d',
    pillar: '#3e4146',
    statue: '#303237',
    structure: '#8a5b2b',
    structureRoof: '#5c3522',
    cave: '#171717',
    secretCave: '#0c0f14',
    rareHerb: '#8af56b',
    fruitBush: '#7ed957',
    mushroom: '#f4f0d8',
    beehive: '#d69a26',
    preyAnimal: '#f3fff1',
    packPredator: '#ff4b4b',
    ambushPredator: '#ff9b38',
    omnivore: '#b47a38',
    animalRoute: 'rgba(255,255,255,0.28)',
    entry: '#ff6f54'
  };

  const foragePalette = ['#ff6fcf', '#ffe66a', '#6af2ff', '#b66aff', '#ff8d4b', '#ffffff'];
  const rarityPoolColors = {
    1: '#e7e7e7',
    2: '#72e27a',
    3: '#70a8ff',
    4: '#c687ff',
    5: '#ffb454'
  };
  const oreKinds = ['stone', 'copper', 'tin', 'iron', 'silver', 'gold', 'crystal'];

  // Ported from WildernessMapGeneratorV4412: named terrain presets and boundary
  // cliff modes. Only used when a caller explicitly opts in via overrides (see
  // ZONE_CONFIG below) -- anything that does not set preset/boundaryMode keeps
  // the original custom/legacyFullRing behavior.
  const MAX_VERTICAL_TIER = 32;
  // Ported from WildernessMapGeneratorV4412's post-layout density pass: every
  // generated tile becomes a GENERATION_TILE_SCALE x GENERATION_TILE_SCALE
  // block of identical tiles (a lossless upscale — verified byte-for-byte
  // identical proportions/tile-type ratios against the standalone tool for a
  // fixed seed). This isn't just cosmetic: the Map Editor submap export filter
  // (hobunjiPlateauGroupsByPaintedFootprint) drops plateau groups below an
  // absolute tile-count threshold, so skipping this pass silently drops more
  // small plateaus (and their elevation) than the standalone tool does.
  const GENERATION_TILE_SCALE = 2;
  const GREAT_BASIN_SPOON_BOWL_Y_RATIO = 0.80;
  const GREAT_BASIN_SPOON_BOWL_X_RATIO = 0.50;
  const GREAT_BASIN_SPOON_BOWL_RADIUS_RATIO = 0.34;
  const GREAT_BASIN_SPOON_BOWL_CORE_RATIO = 0.72;
  const GREAT_BASIN_SPOON_DROP_SPREAD = 2.35;
  const GREAT_BASIN_SPOON_WALL_START = 1.08;
  const GREAT_BASIN_SPOON_RIM_DISTANCE = 2.15;
  const GREAT_BASIN_SPOON_RIM_WIDTH = 1.55;
  const GREAT_BASIN_SPOON_VERTICAL_STRETCH = 1.72;
  const GREAT_BASIN_SPOON_ARC_TERRACE_WIDTH = 0.34;
  const GREAT_BASIN_SPOON_ARC_TERRACE_PULL = 0.78;
  const GREAT_BASIN_SIDE_EXTENSION_WIDTH_RATIO = 0.23;
  const GREAT_BASIN_SIDE_EXTENSION_MAX_BOOST_RATIO = 0.38;
  const GREAT_BASIN_SIDE_EXTENSION_BOWL_Y_SPREAD = 0.46;
  const GREAT_BASIN_TIER_OUTLINE_VARIATION_TILES = 9.5;
  const GREAT_BASIN_TIER_OUTLINE_FINE_VARIATION_TILES = 3.25;
  const GREAT_BASIN_TIER_OUTLINE_BAND_SALT = 100731;
  const TERRAIN_PRESETS = Object.freeze({
    custom: { id: 'custom', label: 'Custom controls', forcedEntrySide: null, dramaticPlateaus: false, highEntryCauseway: false },
    cliffs: { id: 'cliffs', label: 'A. Cliffs', forcedEntrySide: 'south', dramaticPlateaus: true, highEntryCauseway: false },
    greatBasin: { id: 'greatBasin', label: 'B. Great Basin', forcedEntrySide: 'north', dramaticPlateaus: true, highEntryCauseway: true }
  });
  const BOUNDARY_PLATEAU_MODES = Object.freeze({
    legacyFullRing: { id: 'legacyFullRing', label: 'Legacy full boundary cliff ring', entryOnly: false, followsMapHeight: false, distantNonEntryLandscape: false },
    followMapHeight: { id: 'followMapHeight', label: 'A. Follows map height', entryOnly: false, followsMapHeight: true, distantNonEntryLandscape: false },
    entrySideDistantLandscape: { id: 'entrySideDistantLandscape', label: 'B. Entry-side cliffs + distant non-entry landscape', entryOnly: true, followsMapHeight: true, distantNonEntryLandscape: true }
  });
  const STEP_CURVE_MODES = Object.freeze({
    northernCliffs: { id: 'northernCliffs', label: 'Northern Cliffs', exponent: 0.62, bleacherStyle: 'stepped' },
    greatIncline: { id: 'greatIncline', label: 'Great Incline', exponent: 3.45, bleacherStyle: 'smoothSteepNorth' }
  });

  let map = null;
  let rng = Math.random;
  // Cached active settings for the current generation run.
  let settings = null;
  // Built during reward scoring and used by line-of-sight checks to avoid repeated object searches.
  let sightBlockerKeyCache = null;
  // Human-readable validation report for the last Map Editor export.
  let lastMapEditorExportReport = '';

  // Mirrors the HTML tool's readSettings() control defaults. Callers override
  // per-zone via generateWorkspace(seed, overrides).
  function defaultSettings() {
    return {
      seed: 'wild',
      width: 100,
      height: 100,
      tileSize: 22,
      entrySide: 'random',
      // Ported from WildernessMapGeneratorV4412. 'custom'/'legacyFullRing' keep
      // the original pre-port behavior (no dramatic terrain, one unbroken
      // border cliff ring) for any caller that does not opt into a preset.
      preset: 'custom',
      presetLabel: 'Custom controls',
      boundaryMode: 'legacyFullRing',
      boundaryModeLabel: 'Legacy full boundary cliff ring',
      boundaryCliffBoost: 0,
      stepCurve: 'northernCliffs',
      stepCurveLabel: 'Northern Cliffs',
      plateaus: 76,
      maxTier: 6,
      ramps: 14,
      rampMinDiff: 1,
      rampMaxAngle: 40,
      ponds: 5,
      plateauPonds: 8,
      plateauStreams: 10,
      rivers: 2,
      pathAnchors: 4,
      animalDens: 5,
      prey: 8,
      packPredators: 5,
      ambushPredators: 3,
      omnivores: 3,
      showInvisiblePaths: false,
      animateAnimalRoutes: false,
      structures: 5,
      caves: 5,
      statues: 8,
      pillars: 15,
      trees: 130,
      logs: 30,
      bushes: 75,
      forage: 55,
      fruitBushes: 14,
      mushrooms: 18,
      beehives: 7,
      treasure: 26,
      ore: 45,
      boulders: 28,
      // hobunji_locale.v1 definitions (see docs/tools/locale-editor/) eligible
      // for stamping into this zone -- see stampLocales().
      locales: []
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashSeed(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seedText) {
    let state = hashSeed(seedText);
    return function random() {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randFloat(min, max) {
    return min + (max - min) * rng();
  }

  function randInt(min, max) {
    return Math.floor(randFloat(min, max + 1));
  }

  function chance(probability) {
    return rng() < probability;
  }

  function pick(list) {
    return list[randInt(0, list.length - 1)];
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function weightedPick(list) {
    const total = list.reduce((sum, item) => sum + item.weight, 0);
    let roll = rng() * total;
    for (const item of list) {
      roll -= item.weight;
      if (roll <= 0) return item.value;
    }
    return list[list.length - 1].value;
  }

  function rarityPoolColor(pool) {
    return rarityPoolColors[pool] || '#ffffff';
  }

  function rarityPoolForObject(type, details = {}) {
    if (type === 'foragePlant') return weightedPick([
      { value: 1, weight: 42 }, { value: 2, weight: 28 }, { value: 3, weight: 17 }, { value: 4, weight: 9 }, { value: 5, weight: 4 }
    ]);
    if (type === 'rareHerb') return weightedPick([
      { value: 3, weight: 50 }, { value: 4, weight: 34 }, { value: 5, weight: 16 }
    ]);
    if (type === 'treasureDigspot' && details.hiddenReward) return weightedPick([
      { value: 3, weight: 44 }, { value: 4, weight: 34 }, { value: 5, weight: 22 }
    ]);
    if (type === 'treasureDigspot') return weightedPick([
      { value: 1, weight: 25 }, { value: 2, weight: 30 }, { value: 3, weight: 22 }, { value: 4, weight: 15 }, { value: 5, weight: 8 }
    ]);
    if (type === 'diggableRockOre') {
      const oreKind = details.oreKind || 'stone';
      if (oreKind === 'stone') return weightedPick([
        { value: 1, weight: 55 }, { value: 2, weight: 30 }, { value: 3, weight: 12 }, { value: 4, weight: 3 }
      ]);
      if (oreKind === 'silver' || oreKind === 'gold') return weightedPick([
        { value: 2, weight: 20 }, { value: 3, weight: 35 }, { value: 4, weight: 28 }, { value: 5, weight: 17 }
      ]);
      if (oreKind === 'crystal') return weightedPick([
        { value: 3, weight: 30 }, { value: 4, weight: 38 }, { value: 5, weight: 32 }
      ]);
      return weightedPick([
        { value: 1, weight: 35 }, { value: 2, weight: 32 }, { value: 3, weight: 20 }, { value: 4, weight: 10 }, { value: 5, weight: 3 }
      ]);
    }
    if (type === 'caveOpening') return weightedPick([
      { value: 1, weight: 38 }, { value: 2, weight: 30 }, { value: 3, weight: 18 }, { value: 4, weight: 10 }, { value: 5, weight: 4 }
    ]);
    if (type === 'secretCaveOpening') return weightedPick([
      { value: 3, weight: 48 }, { value: 4, weight: 34 }, { value: 5, weight: 18 }
    ]);
    return 1;
  }

  function withRarity(object, type, details = {}) {
    const rarityPool = rarityPoolForObject(type, details);
    return {
      ...object,
      rarityPool,
      rarityColor: rarityPoolColor(rarityPool)
    };
  }

  function initMap() {
    map = {
      schema: 'tileWildernessMap',
      version: '1.44.12',
      seed: settings.seed,
      preset: settings.preset,
      presetLabel: settings.presetLabel,
      boundaryMode: settings.boundaryMode,
      boundaryModeLabel: settings.boundaryModeLabel,
      boundaryCliffBoost: settings.boundaryCliffBoost,
      stepCurve: settings.stepCurve,
      stepCurveLabel: settings.stepCurveLabel,
      greatBasinHorseshoe: false,
      greatBasinSpoon: usesGreatBasinPreset(),
      greatBasinSpoonBowlXRatio: GREAT_BASIN_SPOON_BOWL_X_RATIO,
      greatBasinSpoonBowlYRatio: GREAT_BASIN_SPOON_BOWL_Y_RATIO,
      greatBasinSpoonBowlRadiusRatio: GREAT_BASIN_SPOON_BOWL_RADIUS_RATIO,
      greatBasinSpoonBowlCoreRatio: GREAT_BASIN_SPOON_BOWL_CORE_RATIO,
      greatBasinSpoonDropSpread: GREAT_BASIN_SPOON_DROP_SPREAD,
      greatBasinSpoonWallStart: GREAT_BASIN_SPOON_WALL_START,
      greatBasinSpoonRimDistance: GREAT_BASIN_SPOON_RIM_DISTANCE,
      greatBasinSpoonRimWidth: GREAT_BASIN_SPOON_RIM_WIDTH,
      greatBasinSpoonVerticalStretch: GREAT_BASIN_SPOON_VERTICAL_STRETCH,
      greatBasinSpoonArcTerraceWidth: GREAT_BASIN_SPOON_ARC_TERRACE_WIDTH,
      greatBasinSpoonArcTerracePull: GREAT_BASIN_SPOON_ARC_TERRACE_PULL,
      greatBasinLinearHeightLerp: usesGreatBasinPreset(),
      greatBasinLateBoundarySideExtensions: usesGreatBasinPreset(),
      greatBasinSideExtensionWidthRatio: GREAT_BASIN_SIDE_EXTENSION_WIDTH_RATIO,
      greatBasinSideExtensionMaxBoostRatio: GREAT_BASIN_SIDE_EXTENSION_MAX_BOOST_RATIO,
      greatBasinTierOutlineVariationTiles: GREAT_BASIN_TIER_OUTLINE_VARIATION_TILES,
      greatBasinTierOutlineFineVariationTiles: GREAT_BASIN_TIER_OUTLINE_FINE_VARIATION_TILES,
      preselectedEntrySide: null,
      boundaryHeightScan: null,
      distantBoundaryLandscapes: [],
      width: settings.width,
      height: settings.height,
      sourceWidth: settings.width,
      sourceHeight: settings.height,
      generationScale: 1,
      scaledFrom: null,
      tileSize: settings.tileSize,
      entry: null,
      tiles: [],
      objects: [],
      rivers: [],
      ramps: [],
      paths: [],
      invisiblePaths: [],
      connectivity: null,
      rewardAnalysis: null,
      animalActivity: null,
      designAnalysis: null,
      plateauPaintGroups: [],
      debug: [],
      warnings: []
    };
    // Non-enumerable generation caches: avoids duplicating tiles/objects in native JSON export.
    Object.defineProperty(map, 'flatTiles', { value: [], writable: true, enumerable: false });
    Object.defineProperty(map, 'objectById', { value: new Map(), writable: true, enumerable: false });
    for (let y = 0; y < settings.height; y++) {
      const row = [];
      for (let x = 0; x < settings.width; x++) {
        const tile = {
          x,
          y,
          terrain: 'grass',
          elevation: 0,
          water: false,
          path: false,
          invisiblePath: false,
          invisiblePathId: null,
          denRoute: false,
          bridge: false,
          navBridge: false,
          ramp: false,
          rampId: null,
          rampProgress: null,
          rampFromTier: null,
          rampToTier: null,
          rampDirection: null,
          rampKind: null,
          rampNormal: null,
          rampLandingContact: null,
          rampSharesPlateau: false,
          rampSharedPlateauGroupId: null,
          generatedPlateauBlobId: null,
          height: 0,
          plateauGroupId: null,
          plateauRing: false,
          plateauInterior: false,
          cliffSkirt: false,
          cliffSkirtKind: null,
          cliffFromTier: null,
          cliffToTier: null,
          cliffFacing: null,
          rampSkirt: false,
          waterfall: false,
          plateauHydrology: false,
          plateauPond: false,
          plateauStream: false,
          canyonFlatBank: false,
          canyonShoulder: false,
          borderEscarpment: false,
          borderEscarpmentDepth: null,
          borderEscarpmentSide: null,
          borderEscarpmentBaseHeight: null,
          borderEscarpmentHeightBonus: null,
          distantBoundaryLandscape: false,
          distantBoundaryLandscapeSide: null,
          distantBoundaryLandscapeDepth: null,
          distantBoundarySourceHeight: null,
          distantBoundaryDisplayHeight: null,
          distantBoundaryRenderBand: null,
          designReserve: false,
          designRole: null,
          designLandmarkInfluence: 0,
          visualDeadEnd: false,
          breadcrumb: false,
          greatBasinLinearProfile: false,
          greatBasinLinearTier: null,
          greatBasinLateSideExtension: false,
          greatBasinLateSideInfluence: null,
          greatBasinLateSideBaseTier: null,
          greatBasinLateSideTargetTier: null,
          occupiedBy: null
        };
        row.push(tile);
        map.flatTiles.push(tile);
      }
      map.tiles.push(row);
    }
  }

  function logDebug(message) {
    map.debug.push(message);
  }

  function warn(message) {
    map.warnings.push(message);
    map.debug.push('WARN: ' + message);
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < settings.width && y < settings.height;
  }

  function tileAt(x, y) {
    if (!inBounds(x, y)) return null;
    return map.tiles[y][x];
  }

  function allTiles() {
    return map && map.flatTiles ? map.flatTiles : [];
  }

  function noise2(x, y, salt = 0) {
    let n = Math.imul(x + 374761393 + salt * 668265263, 668265263) ^ Math.imul(y + 2246822519, 3266489917);
    n = (n ^ (n >>> 13)) >>> 0;
    n = Math.imul(n, 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function areaFree(x, y, w = 1, h = 1, options = {}) {
    const allowWater = !!options.allowWater;
    const allowPath = !!options.allowPath;
    const allowOccupied = !!options.allowOccupied;
    const allowRamp = !!options.allowRamp;
    const allowInvisiblePath = !!options.allowInvisiblePath;
    const allowCliffSkirt = !!options.allowCliffSkirt;
    const allowPlateauRing = !!options.allowPlateauRing;
    const allowDesignReserve = !!options.allowDesignReserve;
    const allowBorderEscarpment = !!options.allowBorderEscarpment;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const tile = tileAt(xx, yy);
        if (!tile) return false;
        if (!allowWater && tile.water) return false;
        if (!allowPath && tile.path) return false;
        if (!allowRamp && tile.ramp) return false;
        if (!allowInvisiblePath && tile.invisiblePath) return false;
        if (!allowCliffSkirt && tile.cliffSkirt && !tile.ramp && !tile.waterfall) return false;
        if (!allowBorderEscarpment && tile.borderEscarpment && !tile.ramp && !tile.navRamp) return false;
        if (!allowBorderEscarpment && tile.distantBoundaryLandscape) return false;
        if (!allowPlateauRing && tile.plateauRing && !tile.ramp) return false;
        if (!allowDesignReserve && tile.designReserve) return false;
        if (!allowOccupied && tile.occupiedBy) return false;
      }
    }
    return true;
  }

  function markOccupied(object) {
    for (let yy = object.y; yy < object.y + object.h; yy++) {
      for (let xx = object.x; xx < object.x + object.w; xx++) {
        const tile = tileAt(xx, yy);
        if (tile) tile.occupiedBy = object.id;
      }
    }
  }

  function rebuildObjectCache() {
    if (!map.objectById) Object.defineProperty(map, 'objectById', { value: new Map(), writable: true, enumerable: false });
    map.objectById.clear();
    for (const object of map.objects || []) map.objectById.set(object.id, object);
  }

  function getObjectById(id) {
    if (!id) return null;
    if (map.objectById && map.objectById.has(id)) return map.objectById.get(id);
    const object = (map.objects || []).find(o => o.id === id) || null;
    if (object && map.objectById) map.objectById.set(id, object);
    return object;
  }

  function addObject(object) {
    object.id = object.id || `${object.type}_${map.objects.length + 1}`;
    object.w = object.w || 1;
    object.h = object.h || 1;
    map.objects.push(object);
    if (map.objectById) map.objectById.set(object.id, object);
    if (object.occupies !== false) markOccupied(object);
    return object;
  }

  function randomFreeArea(w = 1, h = 1, options = {}, tries = 500) {
    for (let i = 0; i < tries; i++) {
      const x = randInt(0, settings.width - w);
      const y = randInt(0, settings.height - h);
      if (!areaFree(x, y, w, h, options)) continue;
      if (typeof options.filter === 'function' && !options.filter(x, y, w, h)) continue;
      return { x, y };
    }
    return null;
  }

  function generatePlateaus() {
    const blobCount = settings.plateaus;
    if (blobCount <= 0) {
      logDebug('plateaus skipped: count set to 0');
      return;
    }

    for (const tile of allTiles()) {
      tile.elevation = 0;
      tile.height = 0;
      tile.terrain = 'grass';
      tile.generatedPlateauBlobId = null;
      tile.causewayFieldId = null;
    }

    const mapArea = settings.width * settings.height;
    const areaScale = clamp(mapArea / 10000, 0.35, 1.35);
    // Target near whole-map coverage so many larger plateaus can cluster without turning into isolated crumbs.
    // Dramatic presets are now packed like irregular bleachers: the seed blobs are dense, and a later
    // shelf-fill pass closes most remaining gaps while preserving jagged tier transitions and shared aprons.
    const targetCoverage = usesDramaticPlateauPreset()
      ? clamp(0.88 + blobCount * 0.0012, 0.90, 0.97)
      : clamp(0.74 + blobCount * 0.0024, 0.80, 0.93);
    const targetPlateauTiles = Math.round(mapArea * targetCoverage);
    // new variable: causewayFields are used by plateau center picking so blobs cluster into messy packed districts instead of scattering.
    const causewayFields = buildCausewayPlateauFields(blobCount);
    const acceptedBlobs = [];
    let changed = 0;
    let attempts = 0;
    const maxAttempts = Math.max(1100, blobCount * 210);

    while (acceptedBlobs.length < blobCount && attempts++ < maxAttempts) {
      const targetArea = choosePlateauBlobTargetArea(blobCount, areaScale);
      const center = choosePlateauBlobCenter(causewayFields, acceptedBlobs);
      if (!center) break;
      const cells = buildIrregularPlateauBlob(center.x, center.y, targetArea, center.field);
      const stats = plateauBlobStats(cells);
      if (stats.area < 14 || stats.interior < 2 || stats.width < 4 || stats.height < 4) continue;
      const tier = chooseBlobPlateauTier(acceptedBlobs.length, center.field, center.x, center.y);
      const blobId = `plateau_blob_${acceptedBlobs.length + 1}`;
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number);
        const tile = tileAt(x, y);
        if (!tile) continue;
        tile.elevation = tier;
        tile.height = tier;
        tile.terrain = 'plateau';
        tile.generatedPlateauBlobId = blobId;
        tile.causewayFieldId = center.field ? center.field.id : null;
        changed++;
      }
      acceptedBlobs.push({ id: blobId, tier, area: stats.area, interior: stats.interior, width: stats.width, height: stats.height, center: { x: center.x, y: center.y }, fieldId: center.field ? center.field.id : null });
    }

    const sharedEdgesBeforeCleanup = countPlateauSharedEdges();
    const smoothing = smoothGeneratedPlateauMasses(causewayFields);
    const rounding = roundGeneratedPlateauOutlines(causewayFields);
    const raggification = postRaggifyPlateauEdges();
    const cleanup = removeTinyGeneratedPlateauComponents();
    const packedBleachers = applyPackedDramaticBleacherTerraces();
    const gradient = enforceSouthToNorthElevationRule();
    const cleanupAfterGradient = removeTinyGeneratedPlateauComponents();
    const sharedEdgesAfterCleanup = countPlateauSharedEdges();
    changed = Math.max(0, changed + raggification.added - raggification.removed - cleanup.removedTiles - cleanupAfterGradient.removedTiles);
    logDebug(`broad causeway plateau fields: ${acceptedBlobs.length}/${blobCount} masses in ${causewayFields.length} fields, plateau tiles ${changed}/${targetPlateauTiles} target, shared edges ${sharedEdgesAfterCleanup} (${sharedEdgesBeforeCleanup} before smoothing), packed bleachers filled ${packedBleachers.filled}/retiered ${packedBleachers.retiered}/transition edges ${packedBleachers.transitionEdges}, smoothing filled ${smoothing.filled}/removed ${smoothing.removed}, outline rounding +${rounding.added}/-${rounding.removed} (${rounding.longRunsBefore}->${rounding.longRunsAfter} long straight runs, ${rounding.squareCornersBefore}->${rounding.squareCornersAfter} large square corners), post-raggification +${raggification.added}/-${raggification.removed} edge tiles (${raggification.longRunsBefore}->${raggification.longRunsAfter} long straight runs, ${raggification.squareCornersBefore}->${raggification.squareCornersAfter} large square corners), north-gradient clamped ${gradient.clamped}/lifted ${gradient.raisedNorthShoulders}, tiny crumbs removed ${cleanup.removedComponents + cleanupAfterGradient.removedComponents}/${cleanup.removedTiles + cleanupAfterGradient.removedTiles}`);
    if (acceptedBlobs.length < blobCount && changed < targetPlateauTiles * 0.90) warn(`plateaus: placed ${acceptedBlobs.length}/${blobCount}; remaining blobs could not find clustered causeway footprints`);
  }

  function removeTinyGeneratedPlateauComponents() {
    const visited = new Set();
    let removedComponents = 0;
    let removedTiles = 0;
    for (const start of allTiles()) {
      if (!start || start.elevation <= 0) continue;
      const startKey = tileKey(start.x, start.y);
      if (visited.has(startKey)) continue;
      const component = [];
      const stack = [start];
      while (stack.length) {
        const tile = stack.pop();
        if (!tile || tile.elevation !== start.elevation) continue;
        const key = tileKey(tile.x, tile.y);
        if (visited.has(key)) continue;
        visited.add(key);
        component.push(tile);
        for (const neighbor of cardinalNeighbors(tile.x, tile.y)) {
          if (neighbor && neighbor.elevation === start.elevation && !visited.has(tileKey(neighbor.x, neighbor.y))) stack.push(neighbor);
        }
      }
      const keySet = new Set(component.map(tile => tileKey(tile.x, tile.y)));
      const stats = plateauBlobStats(keySet);
      if (stats.area >= 12 && stats.interior >= 1) continue;
      for (const tile of component) {
        tile.elevation = 0;
        tile.height = 0;
        tile.terrain = 'grass';
        tile.generatedPlateauBlobId = null;
        removedTiles++;
      }
      removedComponents++;
    }
    return { removedComponents, removedTiles };
  }

  function choosePlateauBlobTargetArea(blobCount, areaScale) {
    const crowdFactor = clamp(76 / Math.max(1, blobCount), 0.74, 1.24);
    const small = Math.round(randInt(82, 155) * areaScale * crowdFactor);
    const medium = Math.round(randInt(145, 300) * areaScale * crowdFactor);
    const large = Math.round(randInt(270, 520) * areaScale * crowdFactor);
    // new variable: blobSizeRoll is used here to keep doubled plateau counts playable: each blob is still broad enough for interior walking, but overlap/edge-sharing lets coverage approach the whole map.
    const blobSizeRoll = rng();
    if (blobSizeRoll < 0.22) return clamp(small, 64, 220);
    if (blobSizeRoll < 0.82) return clamp(medium, 110, 420);
    return clamp(large, 220, 680);
  }

  function northwardTierFloatAtY(y) {
    const maxTier = Math.max(1, settings.maxTier);
    if (maxTier <= 1) return 1;
    // new variable: northRiseCurve makes elevation reliably climb as the player moves north, using the selected step curve for dramatic presets.
    const northRiseCurve = northwardRiseProgressAtY(y);
    return 1 + (maxTier - 1) * northRiseCurve;
  }

  function northwardMaxTierAtY(y) {
    if (usesDramaticPlateauPreset()) {
      // Dramatic presets allow strong east/west spikes, but the cap still rises as the map goes north.
      return clamp(Math.ceil(northwardTierFloatAtY(y) + 3), 1, Math.max(1, settings.maxTier));
    }
    return clamp(Math.round(northwardTierFloatAtY(y)), 1, Math.max(1, settings.maxTier));
  }

  function northwardPreferredPlateauTier(x, y, field = null) {
    const maxTier = Math.max(1, settings.maxTier);
    if (maxTier <= 1) return 1;
    const rowFloat = northwardTierFloatAtY(y);
    const rowCap = northwardMaxTierAtY(y);
    const blockNoise = (noise2(Math.floor(x / 9), Math.floor(y / 9), 62437) - 0.5) * (usesDramaticPlateauPreset() ? 2.3 : 1.15);
    const fieldNudge = field && Number.isFinite(field.baseTier) ? clamp(field.baseTier - rowFloat, -0.75, 0.75) : 0;
    const dramaticOffset = dramaticEastWestTierOffset(x, y);
    const rawTier = rowFloat + blockNoise + fieldNudge + dramaticOffset;
    return usesDramaticPlateauPreset()
      ? clampDramaticTierAboveSouthernTerrain(rawTier, x, y)
      : clamp(Math.round(rawTier), 1, rowCap);
  }

  function enforceSouthToNorthElevationRule() {
    let clamped = 0;
    let raisedNorthShoulders = 0;
    for (const tile of allTiles()) {
      if (!tile || tile.elevation <= 0) continue;
      const cap = northwardMaxTierAtY(tile.y);
      if (tile.elevation > cap) {
        tile.elevation = cap;
        tile.height = Math.min(tile.height || cap, cap);
        tile.terrain = tile.elevation > 0 ? 'plateau' : 'grass';
        clamped++;
      }
    }

    // Keep the broad northward read after clamping: if a raised cell directly north of a shelf is oddly lower,
    // gently lift it inside its own row cap instead of letting local jitter imply southward climbing.
    for (let y = settings.height - 2; y >= 0; y--) {
      for (let x = 0; x < settings.width; x++) {
        const tile = tileAt(x, y);
        const south = tileAt(x, y + 1);
        if (!tile || !south || tile.elevation <= 0 || south.elevation <= 0) continue;
        const cap = northwardMaxTierAtY(y);
        const desired = Math.min(cap, south.elevation + (usesDramaticPlateauPreset() ? 1 : (y < south.y ? 1 : 0)));
        if (tile.elevation < south.elevation && desired > tile.elevation) {
          tile.elevation = desired;
          tile.height = Math.max(tile.height || desired, desired);
          tile.terrain = 'plateau';
          raisedNorthShoulders++;
        }
      }
    }

    if (usesDramaticPlateauPreset()) {
      const presetLift = enforceDramaticPresetColumnClimb();
      raisedNorthShoulders += presetLift.raised;
      clamped += presetLift.lowered;
    }

    logDebug(`south-to-north elevation rule: clamped ${clamped} over-high southern tiles, lifted ${raisedNorthShoulders} northward shoulders${usesDramaticPlateauPreset() ? ` with ${settings.stepCurveLabel || 'Northern Cliffs'} parent-shelf apron shaping${usesGreatBasinPreset() ? ' and Great Basin linear lerp + late side shelves' : ''}` : ''}`);
    return { clamped, raisedNorthShoulders };
  }

  function buildCausewayPlateauFields(blobCount) {
    // More fields spread the doubled plateau count across nearly the full map instead of one tight lump.
    const fieldCount = clamp(Math.round(Math.sqrt(Math.max(1, blobCount)) * 1.02), 7, 10);
    const margin = Math.max(5, Math.round(Math.min(settings.width, settings.height) * 0.05));
    const cols = Math.ceil(Math.sqrt(fieldCount * settings.width / Math.max(1, settings.height)));
    const rows = Math.ceil(fieldCount / cols);
    const fields = [];
    for (let i = 0; i < fieldCount; i++) {
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      const cellW = Math.max(1, (settings.width - margin * 2) / Math.max(1, cols));
      const cellH = Math.max(1, (settings.height - margin * 2) / Math.max(1, rows));
      const jitterX = randFloat(-0.26, 0.26) * cellW;
      const jitterY = randFloat(-0.26, 0.26) * cellH;
      const fieldX = clamp(Math.round(margin + cellW * (gx + 0.5) + jitterX), margin, settings.width - margin - 1);
      const fieldY = clamp(Math.round(margin + cellH * (gy + 0.5) + jitterY), margin, settings.height - margin - 1);
      const baseTier = northwardPreferredPlateauTier(fieldX, fieldY, null);
      fields.push({
        id: `causeway_field_${i + 1}`,
        x: fieldX,
        y: fieldY,
        rx: randFloat(24, 38) * clamp(settings.width / 100, 0.75, 1.45),
        ry: randFloat(24, 38) * clamp(settings.height / 100, 0.75, 1.45),
        baseTier
      });
    }
    return fields;
  }

  function randomPointInCausewayField(field, radiusScale = 1) {
    const angle = randFloat(0, Math.PI * 2);
    const radius = Math.sqrt(rng()) * radiusScale;
    const wobble = randFloat(0.72, 1.18);
    return {
      x: Math.round(field.x + Math.cos(angle) * field.rx * radius * wobble),
      y: Math.round(field.y + Math.sin(angle) * field.ry * radius * randFloat(0.72, 1.18))
    };
  }

  function choosePlateauBlobCenter(causewayFields, acceptedBlobs) {
    const margin = 3;
    const hasAnyPlateau = acceptedBlobs.length > 0;
    for (let i = 0; i < 360; i++) {
      const field = pick(causewayFields);
      // Dramatic presets should feel tightly packed: seed blobs prefer edge-sharing, then the bleacher pass turns remaining gaps into shared parent shelves.
      const wantsEdgeShare = hasAnyPlateau && chance(usesDramaticPlateauPreset() ? 0.86 : 0.78);
      const point = wantsEdgeShare ? chooseSharedEdgePlateauSeed(field) : randomPointInCausewayField(field, randFloat(0.18, 1.18));
      if (!point) continue;
      const x = clamp(point.x, margin, settings.width - margin - 1);
      const y = clamp(point.y, margin, settings.height - margin - 1);
      const tile = tileAt(x, y);
      if (!tile || tile.water || tile.elevation > 0) continue;
      if (wantsEdgeShare && !hasExistingPlateauNear(x, y, 2, null)) continue;
      return { x, y, field };
    }
    return null;
  }

  function chooseSharedEdgePlateauSeed(field) {
    for (let tries = 0; tries < 180; tries++) {
      const anchor = randomPointInCausewayField(field, randFloat(0.05, 1.0));
      const ax = clamp(anchor.x, 1, settings.width - 2);
      const ay = clamp(anchor.y, 1, settings.height - 2);
      const base = tileAt(ax, ay);
      if (!base || base.elevation <= 0) continue;
      const dirs = shuffle([[1,0],[-1,0],[0,1],[0,-1]]);
      for (const [dx, dy] of dirs) {
        const nx = ax + dx;
        const ny = ay + dy;
        const tile = tileAt(nx, ny);
        if (tile && !tile.water && tile.elevation <= 0) return { x: nx, y: ny };
      }
    }
    return randomPointInCausewayField(field, randFloat(0.28, 1.24));
  }

  function buildIrregularPlateauBlob(cx, cy, targetArea, field = null) {
    const cells = new Set();
    const frontier = [];
    const addCell = (x, y) => {
      const key = tileKey(x, y);
      if (cells.has(key)) return false;
      cells.add(key);
      frontier.push({ x, y });
      return true;
    };
    addCell(cx, cy);

    const maxRadius = Math.sqrt(targetArea / Math.PI) * randFloat(1.08, 1.34);
    let safety = 0;
    while (cells.size < targetArea && frontier.length && safety++ < targetArea * 110) {
      const base = frontier[randInt(0, frontier.length - 1)];
      const dirs = shuffle([
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
        { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }
      ]);
      let grew = false;
      for (const dir of dirs) {
        const nx = base.x + dir.x;
        const ny = base.y + dir.y;
        if (!inBounds(nx, ny) || nx < 2 || ny < 2 || nx >= settings.width - 2 || ny >= settings.height - 2) continue;
        const key = tileKey(nx, ny);
        if (cells.has(key)) continue;
        const tile = tileAt(nx, ny);
        if (!tile || tile.water || tile.elevation > 0) continue;
        const adjacentExisting = countAdjacentExistingPlateau(nx, ny, cells);
        const fieldPull = field ? fieldDistanceFalloff(nx, ny, field) : 0.5;
        const dx = (nx - cx) / Math.max(1, maxRadius * randFloat(0.84, 1.14));
        const dy = (ny - cy) / Math.max(1, maxRadius * randFloat(0.78, 1.22));
        const dist = Math.hypot(dx, dy);
        const edgeNoise = noise2(nx, ny, 13091) * 0.18 + noise2(Math.floor(nx / 4), Math.floor(ny / 4), 8911) * 0.14;
        const biteNoise = noise2(nx + 31, ny - 17, 4027);
        // new variable: sharedEdgeBoost makes new blobs prefer growing against existing plateau edges, creating the packed causeway look.
        const sharedEdgeBoost = adjacentExisting > 0 ? Math.min(0.36, adjacentExisting * 0.10) : 0;
        const acceptChance = 0.84 - dist * 0.30 + edgeNoise + sharedEdgeBoost + fieldPull * 0.12 - (biteNoise > 0.91 ? 0.12 : 0);
        if (dist > 1.12 + edgeNoise * 0.22 + sharedEdgeBoost || !chance(clamp(acceptChance, 0.18, 0.96))) continue;
        addCell(nx, ny);
        grew = true;
        break;
      }
      if (!grew || chance(0.055)) frontier.splice(randInt(0, frontier.length - 1), 1);
    }

    return softenPlateauBlob(cells, cx, cy, field);
  }

  function softenPlateauBlob(cells, cx, cy, field = null) {
    const softened = new Set(cells);
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      const neighborCount = plateauBlobNeighborCount(x, y, cells);
      const existingEdge = countAdjacentExistingPlateau(x, y, cells) > 0;
      const far = Math.hypot(x - cx, y - cy);
      const fieldPull = field ? fieldDistanceFalloff(x, y, field) : 0.5;
      // new variable: edgeBite removes a few boundary cells so the generated shape reads like a hand-painted irregular plateau, not a circle.
      const edgeBite = noise2(x, y, 19087) + far * 0.005 - fieldPull * 0.05;
      if (!existingEdge && neighborCount <= 2 && edgeBite > 0.92) softened.delete(key);
      if (!existingEdge && neighborCount <= 1 && edgeBite > 0.68) softened.delete(key);
    }
    return softened;
  }

  function plateauBlobNeighborCount(x, y, cells) {
    let count = 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      if (cells.has(tileKey(x + dx, y + dy))) count++;
    }
    return count;
  }

  function countAdjacentExistingPlateau(x, y, currentCells = null) {
    let count = 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const key = tileKey(x + dx, y + dy);
      if (currentCells && currentCells.has(key)) continue;
      const tile = tileAt(x + dx, y + dy);
      if (tile && tile.elevation > 0) count++;
    }
    return count;
  }

  function smoothGeneratedPlateauMasses(causewayFields) {
    let filled = 0;
    let removed = 0;
    const fieldTierAt = (x, y) => {
      let best = null;
      let bestScore = -Infinity;
      for (const field of causewayFields || []) {
        const score = fieldDistanceFalloff(x, y, field);
        if (score > bestScore) { bestScore = score; best = field; }
      }
      return northwardPreferredPlateauTier(x, y, best);
    };

    for (let pass = 0; pass < 4; pass++) {
      const toFill = [];
      const toRemove = [];
      for (const tile of allTiles()) {
        if (!tile || tile.water || tile.occupiedBy) continue;
        const neighbors = cardinalNeighbors(tile.x, tile.y).filter(Boolean);
        const raisedNeighbors = neighbors.filter(n => n.elevation > 0);
        if (tile.elevation <= 0) {
          const sameTierCounts = new Map();
          for (const n of raisedNeighbors) sameTierCounts.set(n.elevation, (sameTierCounts.get(n.elevation) || 0) + 1);
          let bestTier = 0, bestCount = 0;
          for (const [tier, count] of sameTierCounts) if (count > bestCount) { bestTier = tier; bestCount = count; }
          const diagonalRaised = [[1,1],[-1,1],[1,-1],[-1,-1]].filter(([dx,dy]) => (tileAt(tile.x + dx, tile.y + dy)?.elevation || 0) > 0).length;
          if (bestCount >= 3 || (raisedNeighbors.length >= 3 && diagonalRaised >= 1) || (bestCount >= 2 && diagonalRaised >= 3)) toFill.push([tile, bestTier || fieldTierAt(tile.x, tile.y)]);
        } else {
          const sameOrHigher = neighbors.filter(n => n.elevation >= tile.elevation).length;
          const allRaised = raisedNeighbors.length;
          if (sameOrHigher <= 1 && allRaised <= 1) toRemove.push(tile);
        }
      }
      for (const [tile, tier] of toFill) {
        tile.elevation = clamp(Math.round(tier), 1, settings.maxTier);
        tile.height = tile.elevation;
        tile.terrain = 'plateau';
        tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || 'plateau_smoothing_fill';
        filled++;
      }
      for (const tile of toRemove) {
        tile.elevation = 0;
        tile.height = 0;
        tile.terrain = 'grass';
        tile.generatedPlateauBlobId = null;
        removed++;
      }
      if (!toFill.length && !toRemove.length) break;
    }
    return { filled, removed };
  }


  function roundGeneratedPlateauOutlines(causewayFields = []) {
    const before = measurePlateauEdgeRegularity();
    const fieldTierAt = (x, y) => {
      let best = null;
      let bestScore = -Infinity;
      for (const field of causewayFields || []) {
        const score = fieldDistanceFalloff(x, y, field);
        if (score > bestScore) { bestScore = score; best = field; }
      }
      return northwardPreferredPlateauTier(x, y, best);
    };
    let added = 0;
    let removed = 0;
    for (let pass = 0; pass < 4; pass++) {
      const stagedAdds = new Map();
      const stagedRemoves = new Map();
      for (const tile of allTiles()) {
        if (!tile || tile.water || tile.occupiedBy || tile.ramp || tile.path || tile.bridge || tile.navBridge) continue;
        const cardinals = cardinalNeighbors(tile.x, tile.y).filter(Boolean);
        const diagonals = [[1,1],[-1,1],[1,-1],[-1,-1]].map(([dx,dy]) => tileAt(tile.x + dx, tile.y + dy)).filter(Boolean);
        if (tile.elevation <= 0) {
          const tierCounts = new Map();
          for (const n of [...cardinals, ...diagonals]) {
            if (n.elevation > 0) tierCounts.set(n.elevation, (tierCounts.get(n.elevation) || 0) + 1);
          }
          let tier = 0, bestCount = 0;
          for (const [t, c] of tierCounts) if (c > bestCount) { tier = t; bestCount = c; }
          const north = tileAt(tile.x, tile.y - 1)?.elevation || 0;
          const south = tileAt(tile.x, tile.y + 1)?.elevation || 0;
          const east = tileAt(tile.x + 1, tile.y)?.elevation || 0;
          const west = tileAt(tile.x - 1, tile.y)?.elevation || 0;
          const northeast = tileAt(tile.x + 1, tile.y - 1)?.elevation || 0;
          const northwest = tileAt(tile.x - 1, tile.y - 1)?.elevation || 0;
          const southeast = tileAt(tile.x + 1, tile.y + 1)?.elevation || 0;
          const southwest = tileAt(tile.x - 1, tile.y + 1)?.elevation || 0;
          const cap = northwardMaxTierAtY(tile.y);
          const roundedCorner = (
            (north > 0 && east > 0 && northeast > 0) ||
            (north > 0 && west > 0 && northwest > 0) ||
            (south > 0 && east > 0 && southeast > 0) ||
            (south > 0 && west > 0 && southwest > 0)
          );
          if ((bestCount >= 5 || roundedCorner || cardinals.filter(n => n.elevation > 0).length >= 3) && tier > 0 && tier <= cap) {
            const key = tileKey(tile.x, tile.y);
            stagedAdds.set(key, { tile, tier: clamp(Math.round(Math.min(tier, cap || fieldTierAt(tile.x, tile.y))), 1, settings.maxTier) });
          }
        } else {
          const sameCardinal = cardinals.filter(n => n.elevation === tile.elevation).length;
          const sameDiagonal = diagonals.filter(n => n.elevation === tile.elevation).length;
          const exposed = cardinals.filter(n => n.elevation < tile.elevation).length;
          const north = tileAt(tile.x, tile.y - 1)?.elevation === tile.elevation;
          const south = tileAt(tile.x, tile.y + 1)?.elevation === tile.elevation;
          const east = tileAt(tile.x + 1, tile.y)?.elevation === tile.elevation;
          const west = tileAt(tile.x - 1, tile.y)?.elevation === tile.elevation;
          const convexCorner = ((north && east) || (east && south) || (south && west) || (west && north)) && sameCardinal <= 2 && sameDiagonal <= 1;
          const isolatedNib = sameCardinal <= 1 && sameDiagonal <= 2 && exposed >= 2;
          if ((convexCorner || isolatedNib) && !isLocalPlateauBridge(tile)) {
            const key = tileKey(tile.x, tile.y);
            stagedRemoves.set(key, { tile });
          }
        }
      }
      for (const { tile, tier } of stagedAdds.values()) {
        if (!canPostRaggifyAdd(tile, tier)) continue;
        tile.elevation = tier;
        tile.height = tier;
        tile.terrain = 'plateau';
        tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || 'plateau_outline_round';
        added++;
      }
      for (const { tile } of stagedRemoves.values()) {
        if (!canPostRaggifyRemove(tile)) continue;
        tile.elevation = 0;
        tile.height = 0;
        tile.terrain = 'grass';
        tile.generatedPlateauBlobId = null;
        removed++;
      }
      if (!stagedAdds.size && !stagedRemoves.size) break;
    }
    const after = measurePlateauEdgeRegularity();
    return {
      added,
      removed,
      longRunsBefore: before.longRuns,
      longRunsAfter: after.longRuns,
      squareCornersBefore: before.squareCorners,
      squareCornersAfter: after.squareCorners
    };
  }


  function postRaggifyPlateauEdges() {
    const before = measurePlateauEdgeRegularity();
    const stagedAdds = new Map();
    const stagedRemoves = new Map();
    const dirs = [
      { name: 'N', x: 0, y: -1, axis: 'x' }, { name: 'S', x: 0, y: 1, axis: 'x' },
      { name: 'W', x: -1, y: 0, axis: 'y' }, { name: 'E', x: 1, y: 0, axis: 'y' }
    ];
    const stageAdd = (tile, tier, reason = 'edge') => {
      if (!canPostRaggifyAdd(tile, tier)) return false;
      const cappedTier = clamp(Math.round(Math.min(tier, northwardMaxTierAtY(tile.y))), 1, settings.maxTier);
      const key = tileKey(tile.x, tile.y);
      if (stagedRemoves.has(key)) return false;
      stagedAdds.set(key, { tile, tier: cappedTier, reason });
      return true;
    };
    const stageRemove = (tile, reason = 'notch') => {
      if (!canPostRaggifyRemove(tile)) return false;
      const key = tileKey(tile.x, tile.y);
      if (stagedAdds.has(key)) return false;
      stagedRemoves.set(key, { tile, reason });
      return true;
    };

    // Break computer-straight cliff lines by adding little outdents and occasional shallow notches.
    const runs = collectPlateauEdgeRuns(7);
    for (const run of runs) {
      const interval = 4 + Math.floor(noise2(run.segments[0].x, run.segments[0].y, 74291) * 4);
      const offset = 2 + Math.floor(noise2(run.segments[0].x, run.segments[0].y, 74293) * Math.max(1, interval - 2));
      for (let i = offset; i < run.segments.length - 1; i += interval) {
        const seg = run.segments[i];
        const n = noise2(seg.x + run.dir.x * 17, seg.y + run.dir.y * 17, 75161 + i);
        const outside = tileAt(seg.x + run.dir.x, seg.y + run.dir.y);
        if (n < 0.66) {
          if (stageAdd(outside, seg.tier, 'outdent')) {
            // Occasionally make the outdent two cells wide along the cliff tangent so it reads as a rough contour, not pixel confetti.
            if (n < 0.32) {
              const sideSeg = run.segments[Math.min(run.segments.length - 1, i + 1)];
              stageAdd(tileAt(sideSeg.x + run.dir.x, sideSeg.y + run.dir.y), seg.tier, 'wide-outdent');
            }
          }
        } else if (n < 0.88) {
          stageRemove(tileAt(seg.x, seg.y), 'shallow-notch');
        }
      }
    }

    // Chip/fill square corners after the line pass. This is intentionally edge-only, so the larger interior play areas survive.
    for (const tile of allTiles()) {
      if (!tile || tile.water || tile.occupiedBy) continue;
      if (tile.elevation <= 0) {
        const raised = dirs.map(d => ({ ...d, tile: tileAt(tile.x + d.x, tile.y + d.y) })).filter(d => d.tile && d.tile.elevation > 0);
        for (let i = 0; i < raised.length; i++) {
          for (let j = i + 1; j < raised.length; j++) {
            const a = raised[i], b = raised[j];
            if (a.x + b.x === 0 && a.y + b.y === 0) continue; // opposite sides are a corridor, not a corner.
            const tier = Math.min(a.tile.elevation, b.tile.elevation);
            const cap = northwardMaxTierAtY(tile.y);
            if (tier > cap) continue;
            const fillNoise = noise2(tile.x + a.x * 9 + b.x * 17, tile.y + a.y * 11 + b.y * 19, 76333);
            if (fillNoise > 0.42) continue;
            stageAdd(tile, tier, 'corner-fill');
          }
        }
      } else {
        const lowerDirs = dirs.filter(d => {
          const n = tileAt(tile.x + d.x, tile.y + d.y);
          return !n || n.elevation < tile.elevation;
        });
        const hasSquareConvexCorner = lowerDirs.some(a => lowerDirs.some(b => a !== b && !(a.x + b.x === 0 && a.y + b.y === 0)));
        if (hasSquareConvexCorner && sameTierCardinalCount(tile.x, tile.y, tile.elevation) >= 2) {
          const chipNoise = noise2(tile.x, tile.y, 77339);
          if (chipNoise < 0.24) stageRemove(tile, 'corner-chip');
        }
      }
    }

    let added = 0;
    let removed = 0;
    for (const { tile, tier, reason } of stagedAdds.values()) {
      if (!canPostRaggifyAdd(tile, tier)) continue;
      tile.elevation = tier;
      tile.height = tier;
      tile.terrain = 'plateau';
      tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || `plateau_post_raggify_${reason}`;
      added++;
    }
    for (const { tile } of stagedRemoves.values()) {
      if (!canPostRaggifyRemove(tile)) continue;
      tile.elevation = 0;
      tile.height = 0;
      tile.terrain = 'grass';
      tile.generatedPlateauBlobId = null;
      removed++;
    }
    const after = measurePlateauEdgeRegularity();
    return {
      added,
      removed,
      longRunsBefore: before.longRuns,
      longRunsAfter: after.longRuns,
      longestRunBefore: before.longestRun,
      longestRunAfter: after.longestRun,
      squareCornersBefore: before.squareCorners,
      squareCornersAfter: after.squareCorners
    };
  }

  function collectPlateauEdgeRuns(minLength = 1) {
    const dirs = [
      { name: 'N', x: 0, y: -1, axis: 'x' }, { name: 'S', x: 0, y: 1, axis: 'x' },
      { name: 'W', x: -1, y: 0, axis: 'y' }, { name: 'E', x: 1, y: 0, axis: 'y' }
    ];
    const groups = new Map();
    for (const tile of allTiles()) {
      if (!tile || tile.elevation <= 0) continue;
      for (const dir of dirs) {
        const outside = tileAt(tile.x + dir.x, tile.y + dir.y);
        if (outside && outside.elevation >= tile.elevation) continue;
        const line = dir.axis === 'x' ? tile.y : tile.x;
        const coord = dir.axis === 'x' ? tile.x : tile.y;
        const groupKey = `${dir.name}|${tile.elevation}|${line}`;
        if (!groups.has(groupKey)) groups.set(groupKey, { dir, tier: tile.elevation, line, segments: [] });
        groups.get(groupKey).segments.push({ x: tile.x, y: tile.y, coord, tier: tile.elevation });
      }
    }
    const runs = [];
    for (const group of groups.values()) {
      group.segments.sort((a, b) => a.coord - b.coord);
      let current = [];
      let prev = null;
      const flush = () => {
        if (current.length >= minLength) runs.push({ dir: group.dir, tier: group.tier, line: group.line, segments: current.slice() });
        current = [];
      };
      for (const seg of group.segments) {
        if (prev !== null && seg.coord !== prev + 1) flush();
        current.push(seg);
        prev = seg.coord;
      }
      flush();
    }
    return runs;
  }

  function measurePlateauEdgeRegularity() {
    const runs = collectPlateauEdgeRuns(1);
    let longRuns = 0;
    let longestRun = 0;
    for (const run of runs) {
      longestRun = Math.max(longestRun, run.segments.length);
      if (run.segments.length >= 9) longRuns++;
    }
    // This is intentionally a BIG-corner metric, not a count of every tile-sized step.
    // Post-raggification is allowed to add lots of small stair-step irregularities; the ugly artifact is the broad box corner
    // where two long straight cliff edges meet like a rectangle drawn with the grid tool.
    let squareCorners = 0;
    const N = { x: 0, y: -1 }, E = { x: 1, y: 0 }, S = { x: 0, y: 1 }, W = { x: -1, y: 0 };
    const pairs = [
      { a: N, b: E, ta: W, tb: S }, { a: E, b: S, ta: N, tb: W },
      { a: S, b: W, ta: E, tb: N }, { a: W, b: N, ta: S, tb: E }
    ];
    const isLower = (tile, dir) => {
      const n = tileAt(tile.x + dir.x, tile.y + dir.y);
      return !n || n.elevation < tile.elevation;
    };
    for (const tile of allTiles()) {
      if (!tile || tile.elevation <= 0) continue;
      for (const pair of pairs) {
        if (!isLower(tile, pair.a) || !isLower(tile, pair.b)) continue;
        const armA = plateauEdgeContinuationLength(tile, pair.a, pair.ta);
        const armB = plateauEdgeContinuationLength(tile, pair.b, pair.tb);
        if (armA >= 5 && armB >= 5) squareCorners++;
      }
    }
    return { longRuns, longestRun, squareCorners };
  }

  function plateauEdgeContinuationLength(tile, outsideDir, tangentDir) {
    let length = 0;
    const tier = tile.elevation;
    let x = tile.x;
    let y = tile.y;
    while (length < 32) {
      const current = tileAt(x, y);
      if (!current || current.elevation !== tier) break;
      const outside = tileAt(x + outsideDir.x, y + outsideDir.y);
      if (outside && outside.elevation >= tier) break;
      length++;
      x += tangentDir.x;
      y += tangentDir.y;
    }
    return length;
  }

  function canPostRaggifyAdd(tile, tier) {
    if (!tile || tile.water || tile.occupiedBy || tile.ramp || tile.path || tile.bridge || tile.navBridge) return false;
    if (tile.elevation >= tier || tier <= 0) return false;
    const cappedTier = Math.min(tier, northwardMaxTierAtY(tile.y));
    if (cappedTier <= 0) return false;
    const neighbors = cardinalNeighbors(tile.x, tile.y).filter(Boolean);
    const raisedNeighbors = neighbors.filter(n => n.elevation > 0).length;
    return raisedNeighbors >= 1;
  }

  function canPostRaggifyRemove(tile) {
    if (!tile || tile.elevation <= 0 || tile.water || tile.occupiedBy || tile.ramp || tile.path || tile.bridge || tile.navBridge) return false;
    const sameCardinal = sameTierCardinalCount(tile.x, tile.y, tile.elevation);
    const sameDiagonal = [[1,1],[-1,1],[1,-1],[-1,-1]].filter(([dx,dy]) => tileAt(tile.x + dx, tile.y + dy)?.elevation === tile.elevation).length;
    // Keep broad playable shelves; only notch edge/corner cells that still have nearby same-tier support.
    return sameCardinal >= 2 && sameCardinal + sameDiagonal >= 4 && !isLocalPlateauBridge(tile);
  }

  function sameTierCardinalCount(x, y, tier) {
    return cardinalNeighbors(x, y).filter(n => n && n.elevation === tier).length;
  }

  function isLocalPlateauBridge(tile) {
    const tier = tile.elevation;
    const east = tileAt(tile.x + 1, tile.y)?.elevation === tier;
    const west = tileAt(tile.x - 1, tile.y)?.elevation === tier;
    const north = tileAt(tile.x, tile.y - 1)?.elevation === tier;
    const south = tileAt(tile.x, tile.y + 1)?.elevation === tier;
    // Do not cut the center of a one-tile-wide neck.
    return (east && west && !north && !south) || (north && south && !east && !west);
  }

  function fieldDistanceFalloff(x, y, field) {
    const dx = (x - field.x) / Math.max(1, field.rx);
    const dy = (y - field.y) / Math.max(1, field.ry);
    return clamp(1 - Math.hypot(dx, dy), 0, 1);
  }

  function countPlateauSharedEdges() {
    let shared = 0;
    for (const tile of allTiles()) {
      if (!tile || tile.elevation <= 0) continue;
      const right = tileAt(tile.x + 1, tile.y);
      const down = tileAt(tile.x, tile.y + 1);
      if (right && right.elevation > 0) shared++;
      if (down && down.elevation > 0) shared++;
    }
    return shared;
  }

  function plateauBlobStats(cells) {
    if (!cells || !cells.size) return { area: 0, interior: 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let interior = 0;
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      let isInterior = true;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
        if (!cells.has(tileKey(x + dx, y + dy))) { isInterior = false; break; }
      }
      if (isInterior) interior++;
    }
    return { area: cells.size, interior, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  function hasExistingPlateauNear(x, y, radius, currentCells) {
    for (let yy = y - radius; yy <= y + radius; yy++) {
      for (let xx = x - radius; xx <= x + radius; xx++) {
        if (!inBounds(xx, yy)) continue;
        const key = tileKey(xx, yy);
        if (currentCells && currentCells.has(key)) continue;
        const tile = tileAt(xx, yy);
        if (tile && tile.elevation > 0) return true;
      }
    }
    return false;
  }

  function chooseBlobPlateauTier(index, field = null, x = 0, y = 0) {
    const maxTier = Math.max(1, settings.maxTier);
    if (maxTier <= 1) return 1;
    const rowCap = northwardMaxTierAtY(y);
    const rowPreferred = northwardPreferredPlateauTier(x, y, field);
    const jitter = usesDramaticPlateauPreset()
      ? weightedPick([
        { value: -2, weight: 18 },
        { value: -1, weight: 20 },
        { value: 0, weight: 28 },
        { value: 1, weight: 20 },
        { value: 2, weight: 10 },
        { value: 3, weight: 4 }
      ])
      : weightedPick([
        { value: -1, weight: 18 },
        { value: 0, weight: 50 },
        { value: 1, weight: 24 },
        { value: 2, weight: 8 }
      ]);
    // new variable: northLockedTier preserves local causeway variation while preventing southern blobs from spawning as northern-height shelves.
    const northLockedTier = rowPreferred + jitter + (index % 13 === 0 && y < settings.height * 0.42 && chance(usesDramaticPlateauPreset() ? 0.52 : 0.30) ? 1 : 0);
    return clamp(northLockedTier, 1, rowCap);
  }

  function buildCameraLockedShelves(shelfCount) {
    const shelves = [];
    let tier = settings.maxTier;
    shelves.push(tier);

    while (shelves.length < shelfCount && tier > 2) {
      // new variable: tierDrop creates the bigger Pokémon-route height shifts; used to step down to the next shelf.
      const tierDrop = randInt(2, 3);
      tier -= tierDrop;
      if (tier <= 1) break;
      shelves.push(tier);
    }

    return shelves;
  }

  function buildShelfBoundaries(shelfCount) {
    const boundaries = [];
    const usefulHeight = settings.height - 1;
    const bottomReserve = Math.max(4, Math.round(settings.height * 0.16));
    const usableHeight = Math.max(8, usefulHeight - bottomReserve);

    for (let i = 0; i < shelfCount; i++) {
      const normalized = (i + 1) / (shelfCount + 1);
      // new variable: broadSpacing keeps each plateau shelf spacious; used to set this shelf's front cliff line.
      const broadSpacing = Math.pow(normalized, 0.88);
      const y = clamp(Math.round(broadSpacing * usableHeight + randFloat(-1.8, 1.8)), 2, usefulHeight - bottomReserve + i);
      boundaries.push({
        y,
        salt: randInt(1, 999999),
        wander: clamp(settings.width * 0.035 + settings.height * 0.035, 2.5, 6.5)
      });
    }

    for (let i = 1; i < boundaries.length; i++) {
      const minGap = Math.max(4, Math.round(settings.height / (boundaries.length + 3)));
      boundaries[i].y = Math.max(boundaries[i].y, boundaries[i - 1].y + minGap);
      boundaries[i].y = clamp(boundaries[i].y, 0, settings.height - bottomReserve);
    }

    return boundaries;
  }

  function shelfBoundaryWobble(x, index, salt, wander) {
    const slow = (noise2(Math.floor(x / 9), index, salt) - 0.5) * wander;
    const mid = (noise2(Math.floor(x / 4), index + 17, salt + 113) - 0.5) * wander * 0.58;
    const nick = (noise2(x, index + 31, salt + 271) - 0.5) * 0.7;
    return slow + mid + nick;
  }

  function enforceCameraLockedElevation() {
    let lowered = 0;
    for (let x = 0; x < settings.width; x++) {
      let backTier = tileAt(x, 0).elevation;
      for (let y = 1; y < settings.height; y++) {
        const tile = tileAt(x, y);
        if (tile.elevation > backTier) {
          tile.elevation = backTier;
          tile.height = Math.min(tile.height, backTier);
          tile.terrain = tile.elevation > 0 ? 'plateau' : 'grass';
          lowered++;
        }
        backTier = tile.elevation;
      }
    }
    logDebug(`camera lock visibility pass: lowered ${lowered} forward-rising tiles`);
  }


  function applyManualPlateauPaintingRules() {
    for (const tile of allTiles()) {
      tile.plateauGroupId = null;
      tile.plateauRing = false;
      tile.plateauInterior = false;
    }
    map.plateauPaintGroups = [];

    const visited = new Set();
    const colorPool = HOBUNJI_PLATEAU_COLORS || ['#f97316', '#22c55e', '#3b82f6', '#e11d48', '#a855f7', '#facc15', '#06b6d4', '#84cc16'];
    let ringTiles = 0;
    let interiorTiles = 0;

    for (const start of allTiles()) {
      if (!start || start.elevation <= 0 || start.ramp) continue;
      const startKey = tileKey(start.x, start.y);
      if (visited.has(startKey)) continue;

      const tier = start.elevation;
      const cells = collectPlateauComponent(start, tier, visited);
      if (!cells.length) continue;

      const groupIndex = map.plateauPaintGroups.length + 1;
      const id = `plat_generated_tier_${tier}_${groupIndex}`;
      const keySet = new Set(cells.map(tile => tileKey(tile.x, tile.y)));
      const ringKeys = [];
      const interiorKeys = [];
      let minC = Infinity;
      let minR = Infinity;
      let maxC = -Infinity;
      let maxR = -Infinity;
      let hasBorderEscarpment = false;

      for (const tile of cells) {
        const key = tileKey(tile.x, tile.y);
        const isRing = isManualPlateauRingTile(tile, keySet);
        tile.plateauGroupId = id;
        tile.plateauRing = isRing;
        tile.plateauInterior = !isRing;
        // distantBoundaryLandscape tiles are the other boundary-cliff-mode
        // terrain whose height varies tile-by-tile in the same way (see
        // paintDistantBoundaryLandscapeTile) and hits the same fragmentation.
        if (tile.borderEscarpment || tile.distantBoundaryLandscape) hasBorderEscarpment = true;
        if (isRing) {
          ringKeys.push(key);
          ringTiles++;
        } else {
          interiorKeys.push(key);
          interiorTiles++;
        }
        minC = Math.min(minC, tile.x);
        minR = Math.min(minR, tile.y);
        maxC = Math.max(maxC, tile.x);
        maxR = Math.max(maxR, tile.y);
      }

      map.plateauPaintGroups.push({
        id,
        number: groupIndex,
        label: `Generated Tier ${tier} Plateau ${groupIndex}`,
        elevation: tier,
        color: colorPool[(groupIndex - 1) % colorPool.length],
        tileKeys: cells.map(tile => tileKey(tile.x, tile.y)),
        ringKeys,
        interiorKeys,
        bbox: { minC, minR, maxC, maxR },
        // A boundary-cliff-mode escarpment's height varies tile-by-tile (see
        // targetBoundaryHeight's per-tile jaggedBonus/profileStep/ridgeBonus),
        // which naturally fragments a continuous cliff ring into many
        // same-tier patches far smaller than a typical interior plateau blob.
        // Flagged so the export filter never drops one as "tiny" — see
        // hobunjiPlateauGroupsByPaintedFootprint.
        hasBorderEscarpment
      });
    }

    logDebug(`manual plateau paint rules: ${map.plateauPaintGroups.length} groups, ${ringTiles} reserved ring tiles, ${interiorTiles} inset top tiles`);
  }

  function tileKey(x, y) {
    return `${x},${y}`;
  }

  function collectPlateauComponent(start, tier, visited) {
    const cells = [];
    const stack = [start];
    while (stack.length) {
      const tile = stack.pop();
      if (!tile || tile.elevation !== tier || tile.ramp) continue;
      const key = tileKey(tile.x, tile.y);
      if (visited.has(key)) continue;
      visited.add(key);
      cells.push(tile);
      for (const neighbor of cardinalNeighbors(tile.x, tile.y)) {
        if (neighbor && neighbor.elevation === tier && !neighbor.ramp && !visited.has(tileKey(neighbor.x, neighbor.y))) {
          stack.push(neighbor);
        }
      }
    }
    return cells;
  }

  function isManualPlateauRingTile(tile, componentKeys) {
    const neighbors = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];
    for (const [dx, dy] of neighbors) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (!inBounds(nx, ny) || !componentKeys.has(tileKey(nx, ny))) return true;
    }
    return false;
  }

  function rampMaxAngleDegrees() {
    return clamp(Number(settings.rampMaxAngle) || 40, 15, 60);
  }

  function minRampRunForAngle(diff) {
    const angleRadians = rampMaxAngleDegrees() * Math.PI / 180;
    return Math.max(1, Math.ceil(Math.abs(diff) / Math.tan(angleRadians)));
  }

  function rampAngleDegrees(diff, run) {
    return Math.atan(Math.abs(diff) / Math.max(1, run)) * 180 / Math.PI;
  }

  function chooseShelfTier(index) {
    if (settings.maxTier <= 1) return 1;
    const minShelf = Math.min(settings.maxTier, Math.max(2, Math.ceil(settings.maxTier * 0.48)));
    const highBias = Math.pow(rng(), 0.55);
    const tier = Math.round(minShelf + (settings.maxTier - minShelf) * highBias);
    // new variable: first plateau is biased taller so each route has one memorable high shelf.
    const flagshipBoost = index === 0 ? 1 : 0;
    return clamp(tier + flagshipBoost, minShelf, settings.maxTier);
  }

  function removeTinyElevationNoise() {
    const next = map.tiles.map(row => row.map(tile => tile.elevation));
    let flattened = 0;

    for (let y = 1; y < settings.height - 1; y++) {
      for (let x = 1; x < settings.width - 1; x++) {
        const tile = tileAt(x, y);
        if (!tile || tile.elevation <= 0) continue;
        const sameOrHigher = cardinalNeighbors(x, y).filter(n => n && n.elevation >= tile.elevation).length;
        const lowerNeighbors = cardinalNeighbors(x, y).map(n => n ? n.elevation : 0).filter(e => e < tile.elevation);
        if (sameOrHigher <= 1 && lowerNeighbors.length >= 3) {
          next[y][x] = Math.max(...lowerNeighbors);
          flattened++;
        }
      }
    }

    for (let y = 0; y < settings.height; y++) {
      for (let x = 0; x < settings.width; x++) {
        const tile = tileAt(x, y);
        tile.elevation = next[y][x];
        tile.terrain = tile.elevation > 0 ? 'plateau' : 'grass';
      }
    }
    logDebug(`pokemon-route cleanup: flattened ${flattened} isolated height freckles`);
  }

  function cardinalNeighbors(x, y) {
    return [tileAt(x + 1, y), tileAt(x - 1, y), tileAt(x, y + 1), tileAt(x, y - 1)];
  }

  function markWater(x, y, terrain = 'water', width = 1, options = {}) {
    // new variable: brushRadius converts desired river width into a softer tile brush; used so a width of 3 reads near 3 tiles, not 5.
    const brushRadius = terrain === 'river' ? 0.15 + width * 0.46 : Math.max(0.5, width / 2);
    const salt = terrain === 'river' ? 5129 : 2273;
    // new variable: carveRiverBed is used by the late-painted dramatic river pass; false paints water on top of the finished tier instead of eroding it down.
    const carveRiverBed = terrain === 'river' && options.carveRiverBed !== false;
    const isPlateauHydrology = terrain === 'stream' || terrain === 'pond';
    let changedWaterTiles = 0;
    for (let yy = Math.floor(y - brushRadius - 1); yy <= Math.ceil(y + brushRadius + 1); yy++) {
      for (let xx = Math.floor(x - brushRadius - 1); xx <= Math.ceil(x + brushRadius + 1); xx++) {
        if (!inBounds(xx, yy)) continue;
        const dist = Math.hypot(xx - x, yy - y);
        const bankNoise = terrain === 'river' ? (noise2(xx, yy, salt + Math.round(width * 41)) - 0.5) * 0.22 : 0;
        if (dist > brushRadius + bankNoise) continue;
        const tile = tileAt(xx, yy);
        const wasSameWater = tile.water && tile.terrain === terrain;
        tile.water = true;
        tile.terrain = terrain;
        if (!wasSameWater) changedWaterTiles++;
        if (terrain === 'river') {
          tile.canyonRiver = true;
          tile.canyonOriginalElevation = tile.canyonOriginalElevation ?? tile.elevation;
          tile.latePaintedRiver = options.carveRiverBed === false;
          if (carveRiverBed) {
            // new variable: riverBedTier aggressively drops broad canyon rivers so the adjacent ground can read as a real canyon floor.
            const riverBedTier = Math.max(0, Math.min(tile.elevation, Math.floor(tile.elevation * 0.12)));
            tile.elevation = riverBedTier;
          }
        }
        tile.plateauHydrology = isPlateauHydrology ? (tile.canyonRiver ? tile.plateauHydrology : true) : tile.plateauHydrology;
        tile.plateauPond = terrain === 'pond' ? true : tile.plateauPond;
        tile.plateauStream = terrain === 'stream' ? true : tile.plateauStream;
        tile.height = tile.elevation;
        tile.ramp = false;
        tile.rampId = null;
        tile.rampProgress = null;
        tile.rampFromTier = null;
        tile.rampToTier = null;
        tile.rampDirection = null;
        tile.rampKind = null;
        tile.rampNormal = null;
        tile.rampLandingContact = null;
        tile.rampSharesPlateau = false;
        tile.rampSharedPlateauGroupId = null;
      }
    }
    return changedWaterTiles;
  }

  function syncTileHeights() {
    for (const tile of allTiles()) {
      tile.height = tile.elevation;
      if (!tile.ramp) continue;
      tile.ramp = false;
      tile.rampId = null;
      tile.rampProgress = null;
      tile.rampFromTier = null;
      tile.rampToTier = null;
      tile.rampDirection = null;
      tile.rampKind = null;
      tile.rampNormal = null;
      tile.rampLandingContact = null;
      tile.rampSharesPlateau = false;
      tile.rampSharedPlateauGroupId = null;
    }
  }

  function tileHeight(tile) {
    return typeof tile.height === 'number' ? tile.height : tile.elevation;
  }



  function tileNearWaterKind(x, y, radius = 2, predicate = null) {
    const radiusSq = radius * radius;
    for (let yy = Math.max(0, y - radius); yy <= Math.min(settings.height - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(settings.width - 1, x + radius); xx++) {
        const dx = xx - x;
        const dy = yy - y;
        if (dx * dx + dy * dy > radiusSq) continue;
        const tile = tileAt(xx, yy);
        if (!tile || !tile.water) continue;
        if (!predicate || predicate(tile)) return true;
      }
    }
    return false;
  }

  function tileNearRiverCanyon(x, y, radius = 3) {
    return tileNearWaterKind(x, y, radius, tile => tile.canyonRiver || tile.terrain === 'river');
  }

  function riverCanyonInfluenceAt(x, y, radius = 5) {
    let best = 0;
    const radiusSq = radius * radius;
    for (let yy = Math.max(0, y - radius); yy <= Math.min(settings.height - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(settings.width - 1, x + radius); xx++) {
        const dx = xx - x;
        const dy = yy - y;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) continue;
        const tile = tileAt(xx, yy);
        if (!tile || !tile.canyonRiver) continue;
        const influence = 1 - Math.sqrt(distSq) / Math.max(0.001, radius);
        if (influence > best) best = influence;
      }
    }
    return clamp(best, 0, 1);
  }


  function inwardDirectionForBorderTile(x, y) {
    const distances = [
      { side: 'west', dist: x, dir: { x: 1, y: 0 } },
      { side: 'east', dist: settings.width - 1 - x, dir: { x: -1, y: 0 } },
      { side: 'north', dist: y, dir: { x: 0, y: 1 } },
      { side: 'south', dist: settings.height - 1 - y, dir: { x: 0, y: -1 } }
    ];
    distances.sort((a, b) => a.dist - b.dist);
    return distances[0];
  }

  function borderEscarpmentWidthAt(x, y) {
    const edgeDist = Math.min(x, y, settings.width - 1 - x, settings.height - 1 - y);
    const localWidth = borderEscarpmentLocalWidthAt(x, y);
    if (edgeDist < localWidth) return true;
    if (edgeDist > localWidth) return false;
    const inward = inwardDirectionForBorderTile(x, y);
    const sideIndex = borderSideIndex(inward.side);
    const tangent = inward.dir.x === 0 ? x : y;
    // new variable: shoulderNoise gives the widened border wall broken protrusions so it reads as staggered natural cliffs, not a rectangle.
    const shoulderNoise = noise2(tangent, edgeDist + sideIndex * 17, 73547);
    return shoulderNoise > 0.72;
  }

  function generateBorderEscarpments() {
    const modeConfig = activeBoundaryModeConfig();
    const scan = buildBoundaryHeightScan();
    let tiles = 0;
    let distantTiles = 0;
    let waterCuts = 0;
    let raised = 0;
    let maxHeight = 0;
    const entrySide = (map && map.preselectedEntrySide) || resolveGenerationEntrySide();
    if (map) map.preselectedEntrySide = entrySide;

    for (let y = 0; y < settings.height; y++) {
      for (let x = 0; x < settings.width; x++) {
        if (!borderEscarpmentWidthAt(x, y)) continue;
        const tile = tileAt(x, y);
        if (!tile || tile.ramp || tile.navRamp) continue;
        const edgeDist = Math.min(x, y, settings.width - 1 - x, settings.height - 1 - y);
        const inward = inwardDirectionForBorderTile(x, y);
        const localWidth = borderEscarpmentLocalWidthAt(x, y);
        resetBoundaryLandscapeFlags(tile);
        const isEntrySide = inward.side === entrySide;
        if (modeConfig.entryOnly && !isEntrySide) {
          const displayHeight = paintDistantBoundaryLandscapeTile(tile, inward.side, edgeDist, scan);
          maxHeight = Math.max(maxHeight, displayHeight);
          distantTiles++;
          continue;
        }
        const oldHeight = tileHeight(tile);
        const targetHeight = targetBoundaryHeight(tile, inward, edgeDist, localWidth, scan, modeConfig);
        const sideStat = scan && scan.sides ? scan.sides[inward.side] : null;
        const localBaseHeight = modeConfig.followsMapHeight
          ? Math.max(scan ? scan.averagePlayableHeight : 0, sideStat ? sideStat.average : 0, localBoundaryPlayableAverage(x, y, inward, scan))
          : Math.max(oldHeight || 0, northwardMaxTierAtY(y));
        // new variable: boundaryHeightCap is tied to the scanned local target instead of global maxTier+boost, preventing a uniform max-height wall around the whole map.
        const boundaryHeightCap = Math.max(1, localBaseHeight + settings.boundaryCliffBoost + (usesDramaticPlateauPreset() ? 5 : 3));
        const cappedHeight = clamp(targetHeight, 1, boundaryHeightCap);
        tile.borderEscarpment = true;
        tile.borderEscarpmentDepth = edgeDist;
        tile.borderEscarpmentSide = inward.side;
        tile.borderEscarpmentBaseHeight = Number(localBaseHeight.toFixed(2));
        tile.borderEscarpmentHeightBonus = Number((cappedHeight - tile.borderEscarpmentBaseHeight).toFixed(2));
        tile.height = cappedHeight;
        tile.elevation = settings.boundaryCliffBoost < 0 ? Math.round(cappedHeight) : Math.max(tile.elevation || 0, Math.round(cappedHeight));
        tile.terrain = 'plateau';
        tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || 'border_escarpment';
        tile.plateauGroupId = null;
        tile.plateauRing = false;
        tile.plateauInterior = false;
        tile.designReserve = true;
        tile.designRole = tile.designRole || 'borderEscarpment';
        if (tile.water) waterCuts++;
        if (cappedHeight > oldHeight) raised++;
        maxHeight = Math.max(maxHeight, cappedHeight);
        tiles++;
      }
    }
    const sideSummary = Object.values(scan.sides || {}).map(stat => `${stat.side}:${stat.average}/${stat.highAverage}`).join(', ');
    map.distantBoundaryLandscapes = Object.values(scan.sides || {}).filter(stat => modeConfig.entryOnly && stat.side !== entrySide).map(stat => ({ ...stat, source: 'non-entry side far-edge sample' }));
    logDebug(`boundary plateaus: mode ${settings.boundaryModeLabel}, entry side ${entrySide}, cliffs ${tiles}, distant landscape ${distantTiles}, raised ${raised}, water cuts ${waterCuts}, max depth ${borderEscarpmentMaxDepth()}, max height ${maxHeight.toFixed ? maxHeight.toFixed(2) : maxHeight}, playable height scan avg ${scan.averagePlayableHeight} (${sideSummary}), cliff boost ${settings.boundaryCliffBoost}`);
  }

  function generateRamps() {    if (settings.ramps <= 0) {
      logDebug('ramps skipped: ramp connections set to 0');
      return;
    }

    const candidates = collectRampCandidates();
    const acceptedCenters = [];
    let placed = 0;
    let wrapPlaced = 0;
    let curvedWrapPlaced = 0;
    let rampTurns = 0;
    let sharedTiles = 0;
    let canyonAccessPlaced = 0;
    let endpointConnectedRamps = 0;
    let horizontalLedgeRamps = 0;
    let twoTileShoulders = 0;
    let tightCornerShoulders = 0;

    const tryPlaceRampCandidate = (candidate, spacingOverride = null) => {
      if (placed >= settings.ramps) return false;
      const spacing = spacingOverride ?? (candidate.kind === 'wrap' ? (candidate.nearCanyon ? 2.4 : 3.6) : 5.5);
      if (acceptedCenters.some(p => Math.hypot(p.x - candidate.low.x, p.y - candidate.low.y) < spacing)) return false;
      const line = buildRampLine(candidate.high, candidate.low, candidate.direction, candidate.diff, candidate);
      if (!line || !rampLineIsUsable(line, candidate)) return false;
      const coreLine = rampCoreLine(line);

      const rampId = `ramp_${map.ramps.length + 1}`;
      applyRampLine(rampId, line, candidate.high.elevation, candidate.low.elevation, candidate.direction, candidate.kind, candidate.normal || null);
      const sharedCount = line.filter(p => p.sharePlateau || rampPointIsUpper(p)).length;
      sharedTiles += sharedCount;
      if (candidate.kind === 'wrap') {
        wrapPlaced++;
        const turns = countLineTurns(coreLine);
        rampTurns += turns;
        if (turns > 0) curvedWrapPlaced++;
      }
      map.ramps.push({
        id: rampId,
        fromTier: candidate.high.elevation,
        toTier: candidate.low.elevation,
        kind: candidate.kind,
        direction: { ...candidate.direction },
        normal: candidate.normal ? { ...candidate.normal } : null,
        start: { x: coreLine[0].x, y: coreLine[0].y },
        end: { x: coreLine[coreLine.length - 1].x, y: coreLine[coreLine.length - 1].y },
        tiles: line.map(p => ({
          x: p.x,
          y: p.y,
          height: Number(p.height.toFixed(2)),
          progress: Number(p.progress.toFixed(3)),
          zone: p.zone || 'slope',
          sharePlateau: !!p.sharePlateau,
          landingContact: p.landingContact || null,
          rampLane: p.rampLane || 'cliffStroke'
        })),
        fromGroupId: candidate.high.plateauGroupId || null,
        toGroupId: candidate.low.plateauGroupId || null,
        sharedPlateauGroupId: candidate.high.plateauGroupId || null,
        sharedPlateauTiles: sharedCount,
        minimumRunTiles: minRampRunForAngle(candidate.diff),
        generatedRunTiles: Math.max(1, coreLine.length - 1),
        rampWidthMode: (line.twoTileShoulders || 0) > 0 ? 'mostly-two-tile' : 'one-tile',
        twoTileShoulders: line.twoTileShoulders || 0,
        tightCornerShoulders: line.tightCornerShoulders || 0,
        maxAngleDegrees: rampMaxAngleDegrees(),
        angleDegrees: Number(rampAngleDegrees(candidate.diff, Math.max(1, coreLine.length - 1)).toFixed(2))
      });
      acceptedCenters.push({ x: candidate.low.x, y: candidate.low.y });
      placed++;
      if (candidate.nearCanyon) canyonAccessPlaced++;
      if (candidate.ledgeAxis === 'horizontal') horizontalLedgeRamps++;
      twoTileShoulders += line.twoTileShoulders || 0;
      tightCornerShoulders += line.tightCornerShoulders || 0;
      const endpoints = rampEndpointConnectivity(coreLine, candidate);
      if (endpoints.topConnected && endpoints.bottomConnected) endpointConnectedRamps++;
      return true;
    };

    for (const candidate of candidates) {
      if (placed >= settings.ramps) break;
      tryPlaceRampCandidate(candidate);
    }

    const desiredCanyonAccess = Math.max(0, Math.min(settings.ramps, settings.rivers * 2));
    if (canyonAccessPlaced < desiredCanyonAccess) {
      for (const candidate of candidates) {
        if (placed >= settings.ramps) break;
        if (!candidate.nearCanyon) continue;
        if (tryPlaceRampCandidate(candidate, 2.0) && canyonAccessPlaced >= desiredCanyonAccess) break;
      }
    }

    if (placed < settings.ramps && candidates.length) warn(`ramps: placed ${placed}/${settings.ramps}; not enough clean clustered tier-jump edges`);
    logDebug(`cliff-stroke ramps placed: ${placed}/${settings.ramps}, outline-stroke wraps ${wrapPlaced}, horizontal ledges ${horizontalLedgeRamps}, visibly curved ${curvedWrapPlaced}, canyon-access ramps ${canyonAccessPlaced}, endpoint-connected ${endpointConnectedRamps}/${placed}, two-tile shoulders ${twoTileShoulders} (${tightCornerShoulders} at tight corners), total turns ${rampTurns}, shared landing tiles ${sharedTiles}, candidates scanned: ${candidates.length}`);
  }

  function collectRampCandidates() {
    const dirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 },
      { x: 0, y: 1 }, { x: 0, y: -1 }
    ];
    const candidates = [];

    for (let y = 1; y < settings.height - 1; y++) {
      for (let x = 1; x < settings.width - 1; x++) {
        const a = tileAt(x, y);
        if (!a || a.water || a.borderEscarpment) continue;
        for (const dir of dirs) {
          const b = tileAt(x + dir.x, y + dir.y);
          if (!b || b.water || b.borderEscarpment) continue;
          const diff = Math.abs(a.elevation - b.elevation);
          if (diff < settings.rampMinDiff) continue;
          const high = a.elevation >= b.elevation ? a : b;
          const low = a.elevation >= b.elevation ? b : a;
          if (!high.plateauGroupId || !high.plateauRing) continue;
          if (low.plateauGroupId === high.plateauGroupId) continue;
          const normal = { x: low.x - high.x, y: low.y - high.y };
          // South-to-north height rule: visible ramps may climb northward or around same-latitude cliff ledges,
          // but they should not imply a higher shelf sitting south of the lower approach.
          if (high.y > low.y) continue;
          const minimumRampRun = minRampRunForAngle(diff);

          // new variable: tangents are directions running along a cliff face; used for wraparound side ramps that climb onto a plateau edge.
          const tangents = [
            { x: -normal.y, y: normal.x },
            { x: normal.y, y: -normal.x }
          ].filter(t => t.x !== 0 || t.y !== 0);

          for (const tangent of tangents) {
            const wrapLimit = Math.max(34, minimumRampRun + 30);
            const wrapRun = measureCurvedWrapRampRun(low.x, low.y, tangent.x, tangent.y, low.elevation, high.elevation, high.plateauGroupId, normal, wrapLimit);
            const highRun = measureHighRampLandingRun(high.x, high.y, -normal.x, -normal.y, high.elevation, high.plateauGroupId, 4);
            if (highRun < 2) continue;
            if (wrapRun.run < Math.max(14, minimumRampRun + 6)) continue;
            if (wrapRun.hug < Math.max(13, Math.ceil(wrapRun.run * 0.95))) continue;
            const lineLength = highRun + wrapRun.run;
            const angle = rampAngleDegrees(diff, Math.max(1, lineLength - 1));
            if (angle > rampMaxAngleDegrees()) continue;
            const edgeBonus = (high.plateauRing ? 18 : 0) + (high.plateauInterior ? 8 : 0);
            const curvePotential = Math.max(wrapRun.turns || 0, estimateRampEdgeCurve(low.x, low.y, tangent.x, tangent.y, high.elevation, high.plateauGroupId, normal, Math.min(wrapRun.run, 18)));
            const northwardClimbBonus = high.y < low.y ? 180 : 42;
            const horizontalLedgeBonus = Math.abs(tangent.x) > 0 ? 310 : -240;
            const longLedgeBonus = Math.max(0, wrapRun.run - 16) * 18;
            const raggedLedgeBonus = (wrapRun.turns || 0) * 42 + (wrapRun.normalChanges || 0) * 70;
            const strokeBonus = (wrapRun.normalChanges || 0) * 95 + (wrapRun.tightness || 0) * 30;
            const canyonAccessBonus = tileNearRiverCanyon(low.x, low.y, 6) ? 340 : 0;
            const score = 1320 + diff * 120 + wrapRun.run * 36 + wrapRun.hug * 42 + highRun * 14 + curvePotential * 145 + strokeBonus + edgeBonus + northwardClimbBonus + horizontalLedgeBonus + longLedgeBonus + raggedLedgeBonus + canyonAccessBonus + noise2(x, y, 9917) * 12;
            candidates.push({
              kind: 'wrap',
              high,
              low,
              diff,
              direction: tangent,
              normal,
              highRun,
              lowRun: wrapRun.run,
              hugRun: wrapRun.hug,
              nearCanyon: canyonAccessBonus > 0,
              ledgeAxis: Math.abs(tangent.x) > 0 ? 'horizontal' : 'vertical',
              southToNorthValid: high.y <= low.y,
              score
            });
          }

          const allowStraightFallback = false; // curved wrap ramps are preferred; emergency connectivity can still repair traversal later.
          if (allowStraightFallback) {
            const directRunLimit = Math.max(12, minimumRampRun + 7);
            const highRun = measureSameTierRun(high.x, high.y, -normal.x, -normal.y, high.elevation, directRunLimit);
            const lowRun = measureSameTierRun(low.x, low.y, normal.x, normal.y, low.elevation, directRunLimit);
            if (highRun >= 2 && lowRun >= 3 && (highRun - 1) + (lowRun - 1) >= minimumRampRun) {
              const openness = highRun + lowRun;
              const score = diff * 70 + openness * 3 + noise2(x, y, 7711) * 6;
              candidates.push({ kind: 'direct', high, low, diff, direction: normal, normal, highRun, lowRun, score });
            }
          }
        }
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  function measureSameTierRun(x, y, dx, dy, tier, limit) {
    let run = 0;
    for (let i = 0; i < limit; i++) {
      const tile = tileAt(x + dx * i, y + dy * i);
      if (!tile || tile.water || tile.borderEscarpment || tile.elevation !== tier) break;
      run++;
    }
    return run;
  }

  function measureHighRampLandingRun(x, y, dx, dy, tier, groupId, limit) {
    let run = 0;
    for (let i = 0; i < limit; i++) {
      const tile = tileAt(x + dx * i, y + dy * i);
      if (!tile || tile.water || tile.ramp || tile.occupiedBy) break;
      if (tile.elevation !== tier || tile.plateauGroupId !== groupId) break;
      run++;
    }
    return run;
  }

  function measureCurvedWrapRampRun(x, y, dx, dy, lowTier, highTier, highGroupId, normal, limit) {
    const diff = Math.max(1, Math.abs(highTier - lowTier));
    const fakeCandidate = {
      low: { x, y, elevation: lowTier },
      high: { elevation: highTier, plateauGroupId: highGroupId || null },
      direction: { x: dx, y: dy },
      normal: { ...normal },
      diff
    };
    const path = buildCurvedWrapLowPath(fakeCandidate, limit);
    if (!path) return { run: 0, hug: 0, turns: 0, normalChanges: 0, tightness: 0 };
    return { run: path.length, hug: path.length, turns: countLineTurns(path), normalChanges: path.normalChanges || 0, tightness: path.tightness || 0 };
  }

  function measureWrapRampRun(x, y, dx, dy, lowTier, highTier, normal, limit) {
    let run = 0;
    let hug = 0;
    for (let i = 0; i < limit; i++) {
      const tile = tileAt(x + dx * i, y + dy * i);
      if (!tile || tile.water || tile.occupiedBy || tile.ramp || tile.elevation !== lowTier) break;
      const highNeighbor = tileAt(tile.x - normal.x, tile.y - normal.y);
      const hugsPlateau = !!(highNeighbor && highNeighbor.elevation === highTier);
      if (hugsPlateau) hug++;
      if (i < 1 && !hugsPlateau) break;
      if (i >= 1 && hug < 2 && !hugsPlateau) break;
      run++;
    }
    return { run, hug };
  }

  function measureSideRampRun(x, y, dx, dy, lowTier, highTier, normal, limit) {
    return measureWrapRampRun(x, y, dx, dy, lowTier, highTier, normal, limit).run;
  }

  function measurePlateauHugLength(x, y, dx, dy, highTier, normal, limit) {
    let run = 0;
    for (let i = 0; i < limit; i++) {
      const tile = tileAt(x + dx * i, y + dy * i);
      if (!tile) break;
      const highNeighbor = tileAt(tile.x - normal.x, tile.y - normal.y);
      if (!highNeighbor || highNeighbor.elevation !== highTier) break;
      run++;
    }
    return run;
  }

  function rotateCliffNormal(normal, handedness = 1) {
    return handedness >= 0
      ? { x: -normal.y, y: normal.x }
      : { x: normal.y, y: -normal.x };
  }

  function cliffStrokeHandedness(direction, normal) {
    const left = rotateCliffNormal(normal, 1);
    return (direction.x === left.x && direction.y === left.y) ? 1 : -1;
  }

  function rampHighNeighborInfo(tile, highTier, highGroupId = null) {
    if (!tile) return null;
    let best = null;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const high = tileAt(tile.x - dx, tile.y - dy);
      if (!high || high.water || high.ramp || high.elevation !== highTier) continue;
      if (highGroupId) {
        if (high.plateauGroupId !== highGroupId) continue;
        if (!high.plateauRing) continue;
      } else if (!high.plateauGroupId) {
        continue;
      }
      const preferred = rotateCliffNormal({ x: dx, y: dy }, 1);
      const ringBonus = high.plateauRing ? 5 : 0;
      const interiorPenalty = high.plateauInterior ? -2 : 0;
      const score = ringBonus + interiorPenalty + (Math.abs(preferred.x) + Math.abs(preferred.y));
      if (!best || score > best.score) best = { normal: { x: dx, y: dy }, high, score };
    }
    return best;
  }

  function estimateRampEdgeCurve(x, y, dx, dy, highTier, highGroupId, normal, limit) {
    const fakeCandidate = {
      low: { x, y, elevation: tileAt(x, y)?.elevation ?? 0 },
      high: { elevation: highTier, plateauGroupId: highGroupId || null },
      direction: { x: dx, y: dy },
      normal: { ...normal },
      diff: Math.max(1, Math.abs(highTier - (tileAt(x, y)?.elevation ?? 0)))
    };
    const path = traceCliffStrokeLowPath(fakeCandidate, limit);
    return path ? path.normalChanges + countLineTurns(path) : 0;
  }

  function traceCliffStrokeLowPath(candidate, desiredLength) {
    const start = tileAt(candidate.low.x, candidate.low.y);
    if (!start || start.water || start.ramp || start.occupiedBy) return null;
    const lowTier = candidate.low.elevation;
    const highTier = candidate.high.elevation;
    const highGroupId = candidate.high.plateauGroupId || null;
    const startInfo = rampHighNeighborInfo(start, highTier, highGroupId);
    if (!startInfo) return null;

    const handedness = cliffStrokeHandedness(candidate.direction, candidate.normal);
    const path = [];
    const visited = new Set();
    let current = start;
    let currentDir = { ...candidate.direction };
    let currentNormal = { ...startInfo.normal };
    let normalChanges = 0;
    let tightness = 0;

    for (let i = 0; i < desiredLength; i++) {
      const info = rampHighNeighborInfo(current, highTier, highGroupId);
      if (!info) break;
      if (i > 0 && (info.normal.x !== currentNormal.x || info.normal.y !== currentNormal.y)) normalChanges++;
      currentNormal = { ...info.normal };
      tightness++;
      path.push({ x: current.x, y: current.y, normal: { ...info.normal }, strokeContact: true });
      visited.add(tileKey(current.x, current.y));
      if (i >= desiredLength - 1) break;

      const options = [];
      for (const [sx, sy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (sx === -currentDir.x && sy === -currentDir.y && i > 0) continue;
        const next = tileAt(current.x + sx, current.y + sy);
        if (!next || visited.has(tileKey(next.x, next.y))) continue;
        if (next.water || next.occupiedBy || next.ramp || next.path || next.elevation !== lowTier) continue;
        // A text-stroke ramp lives in the one-tile low-side lane that is directly adjacent to the cliff.
        // It may ride over a lower plateau, but it may not become part of the high plateau footprint itself.
        if (next.plateauGroupId === highGroupId) continue;
        const nextInfo = rampHighNeighborInfo(next, highTier, highGroupId);
        if (!nextInfo) continue;

        const preferred = rotateCliffNormal(nextInfo.normal, handedness);
        const followsStroke = (sx === preferred.x && sy === preferred.y) ? 1 : 0;
        const keepsHeading = (sx === currentDir.x && sy === currentDir.y) ? 1 : 0;
        const turns = (sx !== currentDir.x || sy !== currentDir.y) ? 1 : 0;
        const normalTurn = (nextInfo.normal.x !== currentNormal.x || nextInfo.normal.y !== currentNormal.y) ? 1 : 0;
        const localNoise = noise2(next.x, next.y, 62233);
        const raggedPhase = noise2(Math.floor((next.x + i) / 3), Math.floor((next.y - i) / 3), 96233);
        const highIsRing = nextInfo.high?.plateauRing ? 1 : 0;
        const horizontalLedge = sx !== 0 ? 1 : 0;
        // Text-stroke behavior: following the cliff tangent beats going straight through open terrain,
        // but a little turn/normal-change bias keeps long ledges hand-ragged instead of ruler-straight.
        const score = followsStroke * 8.5 + keepsHeading * 0.85 + turns * (0.75 + raggedPhase * 0.95) + normalTurn * 3.6 + highIsRing * 3.2 + horizontalLedge * 0.95 + nextInfo.score * 0.35 + localNoise * 0.42;
        options.push({ next, dir: { x: sx, y: sy }, normal: nextInfo.normal, score });
      }
      if (!options.length) break;
      options.sort((a, b) => b.score - a.score);
      const chosen = options[0];
      current = chosen.next;
      currentDir = chosen.dir;
      currentNormal = chosen.normal;
    }

    const minLen = Math.max(7, Math.min(desiredLength, minRampRunForAngle(candidate.diff)));
    if (path.length < minLen) return null;
    path.normalChanges = normalChanges;
    path.tightness = tightness / Math.max(1, path.length);
    return path;
  }

  function buildCurvedWrapLowPath(candidate, desiredLength) {
    return traceCliffStrokeLowPath(candidate, desiredLength);
  }

  function countLineTurns(line) {
    let turns = 0;
    let prev = null;
    for (let i = 1; i < line.length; i++) {
      const dir = { x: Math.sign(line[i].x - line[i - 1].x), y: Math.sign(line[i].y - line[i - 1].y) };
      if (!dir.x && !dir.y) continue;
      if (prev && (prev.x !== dir.x || prev.y !== dir.y)) turns++;
      prev = dir;
    }
    return turns;
  }

  function buildRampLine(high, low, direction, diff, candidate = null) {
    if (candidate && candidate.kind === 'wrap') return buildWrapRampLine(candidate);
    if (candidate && candidate.kind === 'side') return buildSideRampLine(candidate);

    const minimumRun = minRampRunForAngle(diff);
    const availableHighPad = Math.max(0, (candidate ? candidate.highRun : 4) - 1);
    const availableLowPad = Math.max(0, (candidate ? candidate.lowRun : 8) - 1);
    if (availableHighPad + availableLowPad < minimumRun) return null;

    // new variable: highPad is the same-tier landing length behind the top edge; used to keep the ramp under the max slope angle.
    let highPad = clamp(Math.ceil(diff * 0.75), 1, Math.max(1, availableHighPad));
    // new variable: lowPad is the same-tier landing length in front of the foot; used by the generated line below.
    let lowPad = Math.max(3, minimumRun - highPad);

    if (lowPad > availableLowPad) {
      highPad = Math.max(highPad, minimumRun - availableLowPad);
      if (highPad > availableHighPad) return null;
      lowPad = Math.max(1, minimumRun - highPad);
    }
    if (highPad + lowPad < minimumRun || rampAngleDegrees(diff, highPad + lowPad) > rampMaxAngleDegrees()) return null;

    const line = [];
    const firstI = -highPad;
    const lastI = lowPad;
    const totalSteps = Math.max(1, lastI - firstI);

    for (let i = firstI; i <= lastI; i++) {
      const x = high.x + direction.x * i;
      const y = high.y + direction.y * i;
      if (!inBounds(x, y)) return null;
      const progress = (i - firstI) / totalSteps;
      const height = high.elevation + (low.elevation - high.elevation) * progress;
      const tile = tileAt(x, y);
      line.push({ x, y, progress, height, zone: tile && tile.elevation === high.elevation ? 'upper' : 'slope', sharePlateau: !!(tile && tile.plateauGroupId && progress <= 0.42) });
    }
    return line;
  }

  function rampPointIsUpper(point) {
    return !!(point && typeof point.zone === 'string' && point.zone.startsWith('upper'));
  }

  function buildUpperPlateauLandingPath(candidate) {
    const normal = candidate.normal || { x: 0, y: 0 };
    if (!normal.x && !normal.y) return null;
    const high = candidate.high;
    const cells = [];
    let deepest = 0;
    for (let i = 0; i <= 3; i++) {
      const x = high.x - normal.x * i;
      const y = high.y - normal.y * i;
      const tile = tileAt(x, y);
      if (!tile || tile.water || tile.ramp || tile.occupiedBy || tile.path) break;
      if (tile.elevation !== high.elevation || tile.plateauGroupId !== high.plateauGroupId) break;
      cells.push(tile);
      deepest = i;
    }
    // The old wrap ramps could start on the non-walkable plateau ring only. Require at least one true top/walkable tile behind the ring.
    const hasInteriorLanding = cells.some((tile, index) => index > 0 && tile.plateauInterior);
    if (!hasInteriorLanding) return null;
    const maxLanding = clamp(deepest, 1, 2);
    const path = [];
    for (let i = maxLanding; i >= 0; i--) {
      const tile = tileAt(high.x - normal.x * i, high.y - normal.y * i);
      if (!tile) return null;
      path.push({
        x: tile.x,
        y: tile.y,
        zone: i > 0 ? 'upperInteriorLanding' : 'upperRingLanding',
        sharePlateau: true,
        rampNormal: { ...normal },
        landingContact: i > 0 ? 'plateauInterior' : 'plateauRing'
      });
    }
    return path;
  }

  function buildLowerExitLandingPath(lastPoint, candidate) {
    if (!lastPoint) return [];
    const normal = lastPoint.normal || candidate.normal || { x: 0, y: 0 };
    if (!normal.x && !normal.y) return [];
    const out = [];
    const lowTier = candidate.low.elevation;
    const maxLen = candidate.nearCanyon ? 4 : 3;
    let x = lastPoint.x;
    let y = lastPoint.y;
    for (let i = 1; i <= maxLen; i++) {
      const tile = tileAt(x + normal.x * i, y + normal.y * i);
      if (!tile || tile.water || tile.ramp || tile.occupiedBy || tile.path) break;
      if (tile.elevation !== lowTier) break;
      // Stop before turning the whole canyon bank into a ramp; the goal is a short, flat readable foot.
      out.push({
        x: tile.x,
        y: tile.y,
        zone: 'lowerExitLanding',
        sharePlateau: false,
        hugsPlateau: false,
        rampNormal: { ...normal },
        landingContact: 'lowerWalkableFloor'
      });
      if (out.length >= 2 && !candidate.nearCanyon) break;
      if (out.length >= 3 && candidate.nearCanyon) break;
    }
    return out;
  }

  function rampEndpointConnectivity(line, candidate) {
    if (!line || !line.length || !candidate) return { topConnected: false, bottomConnected: false };
    const topPoint = line.find(p => rampPointIsUpper(p)) || line[0];
    const bottomPoint = [...line].reverse().find(p => p.zone === 'lowerExitLanding') || line[line.length - 1];
    const topTile = tileAt(topPoint.x, topPoint.y);
    const bottomTile = tileAt(bottomPoint.x, bottomPoint.y);
    const topConnected = !!(topTile && rampPointIsUpper(topPoint) && topTile.plateauGroupId === candidate.high.plateauGroupId && topTile.elevation === candidate.high.elevation);
    const bottomConnected = !!(bottomTile && !bottomTile.water && bottomTile.elevation === candidate.low.elevation);
    return { topConnected, bottomConnected };
  }


  function rampCoreLine(line) {
    return (line || []).filter(point => !point || point.rampLane !== 'outerShoulder');
  }

  function rampOuterShoulderTile(point, candidate) {
    if (!point || rampPointIsUpper(point)) return null;
    const normal = point.rampNormal || point.normal || candidate.normal;
    if (!normal || (!normal.x && !normal.y)) return null;
    const tile = tileAt(point.x + normal.x, point.y + normal.y);
    if (!tile || tile.water || tile.ramp || tile.occupiedBy || tile.path) return null;
    if (tile.elevation !== candidate.low.elevation) return null;
    return tile;
  }

  function widenRampLineAtTightCorners(line, candidate) {
    if (!line || candidate.kind !== 'wrap') return line;
    const widened = [];
    const used = new Set();
    let shoulders = 0;
    let tightCornerShoulders = 0;
    const addPoint = (point) => {
      const key = tileKey(point.x, point.y);
      if (used.has(key)) return false;
      used.add(key);
      widened.push(point);
      return true;
    };

    for (let i = 0; i < line.length; i++) {
      const point = line[i];
      addPoint(point);
      if (!point || rampPointIsUpper(point)) continue;
      if (point.zone === 'lowerExitLanding') continue;
      const prev = i > 0 ? line[i - 1] : null;
      const next = i < line.length - 1 ? line[i + 1] : null;
      const prevDir = prev ? { x: Math.sign(point.x - prev.x), y: Math.sign(point.y - prev.y) } : null;
      const nextDir = next ? { x: Math.sign(next.x - point.x), y: Math.sign(next.y - point.y) } : null;
      const turnsHere = !!(prevDir && nextDir && (prevDir.x !== nextDir.x || prevDir.y !== nextDir.y));
      const longLedgeSpacing = i % 2 === 0 && Math.abs(candidate.direction?.x || 0) > 0;
      const shouldWiden = turnsHere || longLedgeSpacing || point.zone === 'slope';
      if (!shouldWiden) continue;
      const shoulderTile = rampOuterShoulderTile(point, candidate);
      if (!shoulderTile) continue;
      const shoulder = {
        ...point,
        x: shoulderTile.x,
        y: shoulderTile.y,
        zone: turnsHere ? 'outerCornerShoulder' : 'outerLedgeShoulder',
        sharePlateau: false,
        hugsPlateau: false,
        rampLane: 'outerShoulder',
        landingContact: turnsHere ? 'twoTileCornerSupport' : 'twoTileLedgeShoulder'
      };
      if (addPoint(shoulder)) {
        shoulders++;
        if (turnsHere) tightCornerShoulders++;
      }
    }
    widened.twoTileShoulders = shoulders;
    widened.tightCornerShoulders = tightCornerShoulders;
    widened.coreLength = line.length;
    return widened;
  }


  function buildWrapRampLine(candidate) {
    const minimumRun = minRampRunForAngle(candidate.diff);
    const upperPath = buildUpperPlateauLandingPath(candidate);
    if (!upperPath || upperPath.length < 2) return null;
    const lowerLength = Math.max(minimumRun + 10, candidate.lowRun || minimumRun);
    const lowerPath = buildCurvedWrapLowPath(candidate, lowerLength);
    if (!lowerPath) return null;
    const lowerExit = buildLowerExitLandingPath(lowerPath[lowerPath.length - 1], candidate);
    if (lowerExit.length < (candidate.nearCanyon ? 2 : 1)) return null;

    const line = [];
    for (const p of upperPath) line.push(p);
    for (const p of lowerPath) {
      line.push({
        x: p.x,
        y: p.y,
        zone: 'slope',
        sharePlateau: false,
        hugsPlateau: true,
        strokeContact: !!p.strokeContact,
        rampNormal: p.normal
      });
    }
    for (const p of lowerExit) line.push(p);

    const totalLength = line.length;
    if (totalLength < minimumRun + 3) return null;
    if (rampAngleDegrees(candidate.diff, Math.max(1, totalLength - 1)) > rampMaxAngleDegrees()) return null;

    const steps = Math.max(1, line.length - 1);
    for (let i = 0; i < line.length; i++) {
      const progress = i / steps;
      line[i].progress = progress;
      line[i].height = candidate.high.elevation + (candidate.low.elevation - candidate.high.elevation) * progress;
      line[i].rampLane = line[i].rampLane || 'cliffStroke';
      if (line[i].zone === 'lowerExitLanding') line[i].height = candidate.low.elevation;
      if (rampPointIsUpper(line[i])) line[i].height = candidate.high.elevation;
    }
    return widenRampLineAtTightCorners(line, candidate);
  }

  function buildSideRampLine(candidate) {
    const minimumLength = minRampRunForAngle(candidate.diff) + 1;
    const desiredLength = candidate.plateauHugLength
      ? Math.max(candidate.diff + 4, minimumLength, Math.min(candidate.lowRun, candidate.plateauHugLength + 2))
      : Math.max(candidate.diff + 5, minimumLength);
    const length = clamp(desiredLength, minimumLength, Math.min(Math.max(10, minimumLength), candidate.lowRun));
    if (length < minimumLength || rampAngleDegrees(candidate.diff, length - 1) > rampMaxAngleDegrees()) return null;
    const line = [];
    for (let i = 0; i < length; i++) {
      const x = candidate.low.x + candidate.direction.x * i;
      const y = candidate.low.y + candidate.direction.y * i;
      if (!inBounds(x, y)) return null;
      const progress = i / Math.max(1, length - 1);
      const height = candidate.high.elevation + (candidate.low.elevation - candidate.high.elevation) * progress;
      line.push({ x, y, progress, height, zone: 'slope', sharePlateau: false });
    }
    return line;
  }

  function rampLineIsUsable(line, candidate) {
    let dryTiles = 0;
    let sharedPlateauTiles = 0;
    let huggedTiles = 0;
    let lowerTiles = 0;
    for (const point of line) {
      const tile = tileAt(point.x, point.y);
      if (tile && tile.borderEscarpment) return false;
      if (!tile || tile.water || tile.occupiedBy || tile.ramp) return false;
      if (tile.path) return false;
      if (point.rampLane === 'outerShoulder') {
        if (tile.elevation !== candidate.low.elevation) return false;
        dryTiles++;
        continue;
      }

      if (candidate.kind === 'wrap') {
        if (rampPointIsUpper(point)) {
          if (tile.elevation !== candidate.high.elevation || tile.plateauGroupId !== candidate.high.plateauGroupId) return false;
          sharedPlateauTiles++;
        } else {
          if (tile.elevation !== candidate.low.elevation) return false;
          if (point.zone === 'lowerExitLanding') {
            // The ramp foot intentionally steps away from the cliff stroke onto flat walkable ground.
          } else {
            lowerTiles++;
            const localNormal = point.rampNormal || candidate.normal;
            const highNeighbor = tileAt(tile.x - localNormal.x, tile.y - localNormal.y);
            if (highNeighbor && highNeighbor.elevation === candidate.high.elevation) huggedTiles++;
            if (lowerTiles <= 1 && (!highNeighbor || highNeighbor.elevation !== candidate.high.elevation)) return false;
          }
        }
      } else if (candidate.kind === 'side') {
        if (tile.elevation !== candidate.low.elevation) return false;
        const localNormal = point.rampNormal || candidate.normal;
        const highNeighbor = tileAt(tile.x - localNormal.x, tile.y - localNormal.y);
        if (point.progress < 0.58 && (!highNeighbor || highNeighbor.elevation !== candidate.high.elevation)) return false;
      } else {
        const expected = point.progress < 0.44 ? candidate.high.elevation : candidate.low.elevation;
        const tolerance = point.progress > 0.38 && point.progress < 0.62 ? candidate.diff : 1;
        if (Math.abs(tile.elevation - expected) > tolerance) return false;
      }
      dryTiles++;
    }
    if (candidate.kind === 'wrap' && (sharedPlateauTiles < 2 || huggedTiles < Math.max(10, Math.ceil(lowerTiles * 0.84)))) return false;
    const coreLine = rampCoreLine(line);
    if (candidate.kind === 'wrap' && coreLine.length >= 8 && countLineTurns(coreLine) < 1) return false;
    if (candidate.kind === 'wrap' && candidate.diff >= 4 && coreLine.length >= 14 && countLineTurns(coreLine) < 1) return false;
    if (candidate.kind === 'wrap') {
      const endpoints = rampEndpointConnectivity(coreLine, candidate);
      if (!endpoints.topConnected || !endpoints.bottomConnected) return false;
    }
    return dryTiles >= 5;
  }

  function applyRampLine(rampId, line, fromTier, toTier, direction, kind = 'direct', normal = null) {
    for (const point of line) {
      const tile = tileAt(point.x, point.y);
      const sharesPlateau = !!(point.sharePlateau || rampPointIsUpper(point));
      tile.terrain = 'ramp';
      tile.ramp = true;
      tile.rampId = rampId;
      tile.rampProgress = Number(point.progress.toFixed(3));
      tile.rampFromTier = fromTier;
      tile.rampToTier = toTier;
      tile.rampDirection = { ...direction };
      tile.rampKind = kind;
      tile.rampNormal = point.rampNormal ? { ...point.rampNormal } : (normal ? { ...normal } : null);
      tile.rampLandingContact = point.landingContact || null;
      tile.rampLane = point.rampLane || 'cliffStroke';
      tile.rampWidthMode = point.rampLane === 'outerShoulder' ? 'outerTwoTileShoulder' : 'cliffStrokeCore';
      tile.rampSharesPlateau = sharesPlateau;
      tile.rampSharedPlateauGroupId = sharesPlateau ? tile.plateauGroupId : null;
      tile.height = Number(point.height.toFixed(2));
      if (!sharesPlateau) {
        tile.plateauRing = false;
        tile.plateauInterior = false;
      }
    }
  }

  function clearCliffSkirts() {
    for (const tile of allTiles()) {
      tile.cliffSkirt = false;
      tile.cliffSkirtKind = null;
      tile.cliffFromTier = null;
      tile.cliffToTier = null;
      tile.cliffFacing = null;
      tile.rampSkirt = false;
      tile.waterfall = false;
    }
  }

  function generateCliffSkirts() {
    clearCliffSkirts();
    let plateauSkirts = 0;
    let rampSkirts = 0;
    let waterfalls = 0;
    let borderEscarpments = 0;
    const dirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 },
      { x: 0, y: 1 }, { x: 0, y: -1 }
    ];

    for (const tile of allTiles()) {
      if (!tile || tile.ramp || tile.distantBoundaryLandscape) continue;
      for (const dir of dirs) {
        const neighbor = tileAt(tile.x + dir.x, tile.y + dir.y);
        if (!neighbor || neighbor.ramp || neighbor.distantBoundaryLandscape) continue;
        const diff = tileHeight(neighbor) - tileHeight(tile);
        if (diff < 0.75) continue;
        const before = tile.cliffSkirt;
        const isWaterfall = tile.water && diff >= settings.rampMinDiff;
        markCliffSkirtTile(tile, isWaterfall ? 'waterfall' : 'plateau', neighbor, diff);
        if (!before && !tile.water) plateauSkirts++;
        if (isWaterfall) waterfalls++;
      }
    }

    for (const tile of allTiles()) {
      if (!tile.ramp || tile.water) continue;
      const dir = tile.rampDirection || { x: 1, y: 0 };
      const sideDirs = dir.x === 0
        ? [{ x: 1, y: 0 }, { x: -1, y: 0 }]
        : [{ x: 0, y: 1 }, { x: 0, y: -1 }];
      for (const side of sideDirs) {
        const skirt = tileAt(tile.x + side.x, tile.y + side.y);
        if (!skirt || skirt.ramp || skirt.water || skirt.distantBoundaryLandscape) continue;
        const before = skirt.cliffSkirt;
        markCliffSkirtTile(skirt, 'ramp', tile, Math.abs(tileHeight(tile) - tileHeight(skirt)));
        skirt.rampSkirt = true;
        if (!before) rampSkirts++;
      }
    }

    logDebug(`cliff skirts: plateau/base ${plateauSkirts}, ramp-side ${rampSkirts}, waterfalls ${waterfalls}`);
  }

  function markCliffSkirtTile(tile, kind, highTile, diff) {
    if (!tile || tile.ramp) return;
    const priority = { plateau: 1, ramp: 2, cave: 3, waterfall: 4 };
    const current = priority[tile.cliffSkirtKind] || 0;
    const next = priority[kind] || 1;
    if (!tile.cliffSkirt || next >= current) {
      tile.cliffSkirt = true;
      tile.cliffSkirtKind = kind;
      tile.cliffFromTier = tile.elevation;
      tile.cliffToTier = highTile ? Number(tileHeight(highTile).toFixed(2)) : null;
      tile.cliffFacing = highTile ? { x: highTile.x - tile.x, y: highTile.y - tile.y } : null;
    }
    if (kind === 'waterfall') tile.waterfall = true;
  }

  function carveRiverCanyonShoulders() {
    const riverTiles = allTiles().filter(tile => tile && tile.canyonRiver);
    if (!riverTiles.length) return { lowered: 0, flatBanks: 0 };
    const stagedShoulders = new Map();
    const stagedFlatBanks = new Map();
    for (const river of riverTiles) {
      const sourceTier = river.canyonOriginalElevation ?? river.elevation;
      const riverBedTier = river.elevation || 0;
      const shoulderRadius = 5.4;
      const flatRadius = 3.4;
      for (let yy = Math.max(0, Math.floor(river.y - shoulderRadius)); yy <= Math.min(settings.height - 1, Math.ceil(river.y + shoulderRadius)); yy++) {
        for (let xx = Math.max(0, Math.floor(river.x - shoulderRadius)); xx <= Math.min(settings.width - 1, Math.ceil(river.x + shoulderRadius)); xx++) {
          const tile = tileAt(xx, yy);
          if (!tile || tile.water || tile.ramp || tile.occupiedBy) continue;
          const dist = Math.hypot(xx - river.x, yy - river.y);
          if (dist > shoulderRadius) continue;

          // Inner canyon banks are intentionally FLAT walkable land, not noisy broken cliff fragments.
          if (dist <= flatRadius) {
            const flatTier = dist <= 2.35 ? riverBedTier : Math.min(riverBedTier + 1, Math.max(1, sourceTier - 1));
            const key = tileKey(xx, yy);
            const prev = stagedFlatBanks.get(key);
            stagedFlatBanks.set(key, prev === undefined ? flatTier : Math.min(prev, flatTier));
            continue;
          }

          let targetMax = tile.elevation;
          if (dist <= 4.4) targetMax = Math.min(targetMax, Math.max(0, Math.floor(sourceTier * 0.58)));
          else targetMax = Math.min(targetMax, Math.max(0, Math.floor(sourceTier * 0.78)));
          const key = tileKey(xx, yy);
          if (targetMax < tile.elevation) {
            const prev = stagedShoulders.get(key);
            stagedShoulders.set(key, prev ? Math.min(prev, targetMax) : targetMax);
          }
        }
      }
    }

    let lowered = 0;
    let flatBanks = 0;
    for (const [key, targetTier] of stagedShoulders.entries()) {
      if (stagedFlatBanks.has(key)) continue;
      const [x, y] = key.split(',').map(Number);
      const tile = tileAt(x, y);
      if (!tile || tile.water || tile.ramp) continue;
      if (targetTier < tile.elevation) {
        tile.elevation = targetTier;
        tile.height = targetTier;
        tile.terrain = targetTier > 0 ? 'plateau' : 'grass';
        tile.canyonShoulder = true;
        lowered++;
      }
    }
    for (const [key, targetTier] of stagedFlatBanks.entries()) {
      const [x, y] = key.split(',').map(Number);
      const tile = tileAt(x, y);
      if (!tile || tile.water || tile.ramp) continue;
      const flatTier = clamp(Math.round(targetTier), 0, Math.max(1, settings.maxTier));
      if (tile.elevation !== flatTier || !tile.canyonFlatBank) {
        tile.elevation = flatTier;
        tile.height = flatTier;
        tile.terrain = flatTier > 0 ? 'plateau' : 'grass';
        tile.generatedPlateauBlobId = flatTier > 0 ? (tile.generatedPlateauBlobId || 'river_canyon_flat_bank') : null;
        tile.canyonFlatBank = true;
        tile.canyonShoulder = true;
        tile.plateauRing = false;
        tile.plateauInterior = false;
        tile.plateauGroupId = null;
        flatBanks++;
      }
    }
    logDebug(`river canyon sculpting: flattened ${flatBanks} solid bank tiles and lowered ${lowered} outer shoulder tiles`);
    return { lowered, flatBanks };
  }

  function generatePlateauHydrology() {
    const desiredPonds = settings.plateauPonds || 0;
    const desiredStreams = settings.plateauStreams || 0;
    if (desiredPonds <= 0 && desiredStreams <= 0) {
      logDebug('plateau hydrology skipped: plateau ponds and streams set to 0');
      return;
    }
    const pondCenters = [];
    let pondTiles = 0;
    let streamTiles = 0;
    let merges = 0;
    const choosePlateauHydrologySeed = (requireInterior = false) => randomFreeArea(1, 1, {
      allowPath: true,
      filter: (x, y) => {
        const tile = tileAt(x, y);
        if (!tile || tile.water || tile.ramp || tile.occupiedBy) return false;
        if (tile.elevation < 2) return false;
        if (requireInterior && !tile.plateauInterior) return false;
        if (tileNearWaterKind(x, y, 3)) return false;
        return true;
      }
    }, 800);

    const growPlateauPond = (center) => {
      const targetSize = randInt(6, 18);
      const cells = new Set([tileKey(center.x, center.y)]);
      const frontier = [{ x: center.x, y: center.y }];
      const baseTier = tileAt(center.x, center.y).elevation;
      let guard = 0;
      while (cells.size < targetSize && frontier.length && guard++ < targetSize * 18) {
        const base = pick(frontier);
        for (const n of shuffle([
          { x: base.x + 1, y: base.y }, { x: base.x - 1, y: base.y },
          { x: base.x, y: base.y + 1 }, { x: base.x, y: base.y - 1 }
        ])) {
          if (!inBounds(n.x, n.y)) continue;
          const tile = tileAt(n.x, n.y);
          const key = tileKey(n.x, n.y);
          if (!tile || tile.water || tile.ramp || tile.occupiedBy || cells.has(key)) continue;
          if (tile.elevation < Math.max(1, baseTier - 1) || tile.elevation > baseTier) continue;
          const edgeChance = cells.size / Math.max(1, targetSize);
          if (chance(0.76 - edgeChance * 0.24)) {
            cells.add(key);
            frontier.push(n);
            break;
          }
        }
        if (chance(0.18)) frontier.splice(randInt(0, frontier.length - 1), 1);
      }
      return [...cells].map(k => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }));
    };

    for (let i = 0; i < desiredPonds; i++) {
      const center = choosePlateauHydrologySeed(true);
      if (!center) break;
      const cells = growPlateauPond(center);
      if (!cells.length) continue;
      pondCenters.push(center);
      for (const cell of cells) {
        markWater(cell.x, cell.y, 'pond', 1);
        const tile = tileAt(cell.x, cell.y);
        tile.terrain = 'stream';
        tile.plateauHydrology = true;
        tile.plateauPond = true;
        pondTiles++;
      }
    }

    const traceStream = (source) => {
      const path = [];
      let current = tileAt(source.x, source.y);
      if (!current) return { tiles: 0, merged: false };
      const visited = new Set([tileKey(current.x, current.y)]);
      let currentDir = { x: 0, y: 1 };
      let merged = false;
      const maxLen = randInt(10, 34);
      for (let step = 0; step < maxLen; step++) {
        markWater(current.x, current.y, 'stream', 1);
        current.plateauHydrology = true;
        current.plateauStream = true;
        path.push(current);
        if (step > 2 && tileNearWaterKind(current.x, current.y, 1, tile => tile !== current && tile.water)) {
          merged = true;
          break;
        }
        const options = [];
        for (const dir of shuffle([{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }])) {
          const next = tileAt(current.x + dir.x, current.y + dir.y);
          if (!next || next.occupiedBy || next.ramp) continue;
          const key = tileKey(next.x, next.y);
          if (visited.has(key)) continue;
          if (next.elevation > current.elevation) continue;
          let score = 0;
          const drop = current.elevation - next.elevation;
          score += drop * 6.5;
          score += dir.y > 0 ? 2.6 : 0;
          score += next.water ? 12 : 0;
          score += tileNearRiverCanyon(next.x, next.y, 2) ? 7 : 0;
          score += riverCanyonInfluenceAt(next.x, next.y, 4) * 6;
          score += next.plateauRing ? 2.2 : 0;
          score += next.plateauInterior ? 0.8 : 0;
          if (dir.x === currentDir.x && dir.y === currentDir.y) score += 0.8;
          score += noise2(next.x, next.y, 88531) * 0.6;
          options.push({ next, dir, score });
        }
        if (!options.length) break;
        options.sort((a, b) => b.score - a.score);
        current = options[0].next;
        currentDir = options[0].dir;
        visited.add(tileKey(current.x, current.y));
        if (current.water && step >= 2) {
          merged = true;
          break;
        }
      }
      return { tiles: path.length, merged };
    };

    let streamCount = 0;
    for (let i = 0; i < desiredStreams; i++) {
      const source = pondCenters.length && chance(0.7)
        ? pick(pondCenters)
        : choosePlateauHydrologySeed(false);
      if (!source) break;
      const result = traceStream(source);
      if (result.tiles >= 4) {
        streamCount++;
        streamTiles += result.tiles;
        if (result.merged) merges++;
      }
    }
    logDebug(`plateau hydrology: plateau ponds ${pondCenters.length}/${desiredPonds} (${pondTiles} tiles), plateau streams ${streamCount}/${desiredStreams} (${streamTiles} stream tiles, ${merges} merges/waterfall chains)`);
  }


  function generatePonds() {
    for (let i = 0; i < settings.ponds; i++) {
      const targetSize = randInt(7, 30);
      const center = randomFreeArea(1, 1, { allowPath: true, filter: (x, y) => tileAt(x, y).elevation <= 2 }, 300);
      if (!center) {
        warn(`pond ${i + 1}: no low free starting tile`);
        continue;
      }

      const cells = new Set([`${center.x},${center.y}`]);
      const frontier = [{ x: center.x, y: center.y }];
      let safety = 0;
      while (cells.size < targetSize && frontier.length && safety++ < targetSize * 20) {
        const base = pick(frontier);
        const neighbors = shuffle([
          { x: base.x + 1, y: base.y }, { x: base.x - 1, y: base.y },
          { x: base.x, y: base.y + 1 }, { x: base.x, y: base.y - 1 }
        ]);
        for (const n of neighbors) {
          if (!inBounds(n.x, n.y)) continue;
          const key = `${n.x},${n.y}`;
          const tile = tileAt(n.x, n.y);
          const edgeChance = cells.size / targetSize;
          if (!cells.has(key) && tile.elevation <= 2 && chance(0.74 - edgeChance * 0.25)) {
            cells.add(key);
            frontier.push(n);
            break;
          }
        }
        if (chance(0.18)) frontier.splice(randInt(0, frontier.length - 1), 1);
      }

      let marked = 0;
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number);
        markWater(x, y, 'pond', 1);
        marked++;
      }
      logDebug(`pond ${i + 1}: irregular blob ${marked} tiles`);
    }
  }

  function borderPoint(side, offset = 0) {
    const sideName = side === 'random' ? pick(['north', 'east', 'south', 'west']) : side;
    if (sideName === 'north') return { x: randInt(1, settings.width - 2), y: -1 - offset, side: 'north' };
    if (sideName === 'south') return { x: randInt(1, settings.width - 2), y: settings.height + offset, side: 'south' };
    if (sideName === 'west') return { x: -1 - offset, y: randInt(1, settings.height - 2), side: 'west' };
    return { x: settings.width + offset, y: randInt(1, settings.height - 2), side: 'east' };
  }

  function oppositeOrDifferentSide(side) {
    const opposites = { north: 'south', south: 'north', east: 'west', west: 'east' };
    if (chance(0.70)) return opposites[side];
    return pick(['north', 'east', 'south', 'west'].filter(s => s !== side));
  }

  function chooseRiverBaseWidth() {
    // new variable: baseWidth is intentionally canyon-scale; rivers are broad cuts through plateau fields, not tiny streams.
    return weightedPick([{ value: 6, weight: 28 }, { value: 7, weight: 46 }, { value: 8, weight: 26 }]);
  }

  function riverWidthForStep(baseWidth, step, changeEvery, salt) {
    const segment = Math.floor(step / changeEvery);
    // new variable: widthPhase gives canyons wide/narrow reaches while staying broadly carved.
    const widthPhase = (segment + salt) % 7;
    if (widthPhase === 0) return Math.max(4, baseWidth - 1);
    if (widthPhase === 3 || widthPhase === 5) return Math.min(8, baseWidth + 1);
    return baseWidth;
  }

  function generateRivers() {
    if (usesDramaticPlateauPreset()) {
      logDebug('river canyon generation deferred: dramatic presets paint rivers late over finished plateau tiers without erosion carving');
      return;
    }
    for (let i = 0; i < settings.rivers; i++) {
      const start = borderPoint('random', 1);
      const end = borderPoint(oppositeOrDifferentSide(start.side), 1);
      const baseWidth = chooseRiverBaseWidth();
      const changeEvery = randInt(7, 14);
      const widthSalt = randInt(1, 999999);
      const points = [];
      const widthSamples = [];
      let x = start.x;
      let y = start.y;
      const maxSteps = (settings.width + settings.height) * 5;
      let wobble = randFloat(-1.1, 1.1);

      for (let step = 0; step < maxSteps; step++) {
        const currentWidth = riverWidthForStep(baseWidth, step, changeEvery, widthSalt);
        points.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), widthTiles: currentWidth });
        widthSamples.push(currentWidth);
        const dx = end.x - x;
        const dy = end.y - y;
        const dist = Math.max(0.001, Math.hypot(dx, dy));
        const nx = dx / dist;
        const ny = dy / dist;
        const px = -ny;
        const py = nx;
        wobble += randFloat(-0.26, 0.26);
        wobble *= 0.88;
        x += nx * randFloat(0.42, 0.82) + px * wobble;
        y += ny * randFloat(0.42, 0.82) + py * wobble;
        const tx = Math.round(x);
        const ty = Math.round(y);
        if (inBounds(tx, ty)) markWater(tx, ty, 'river', currentWidth);
        if (dist < 1.35 && !inBounds(tx, ty)) break;
        if (step > 8 && !inBounds(tx, ty)) {
          const leftNorth = tx < -2 || ty < -2;
          const leftSouthEast = tx > settings.width + 1 || ty > settings.height + 1;
          if (leftNorth || leftSouthEast) break;
        }
      }
      points.push({ ...end, widthTiles: widthSamples[widthSamples.length - 1] || baseWidth });
      const widthMin = Math.min(...widthSamples);
      const widthMax = Math.max(...widthSamples);
      const widthAverage = widthSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, widthSamples.length);
      map.rivers.push({
        id: `river_${i + 1}`,
        fromBorder: start.side,
        toBorder: end.side,
        widthTiles: Number(widthAverage.toFixed(2)),
        widthTilesAverage: Number(widthAverage.toFixed(2)),
        minimumWidthTiles: widthMin,
        maximumWidthTiles: widthMax,
        widthSamples,
        points
      });
      logDebug(`river canyon ${i + 1}: ${start.side} border to ${end.side} border, widths ${widthMin}-${widthMax}, avg ${widthAverage.toFixed(2)}`);
    }
    carveRiverCanyonShoulders();
  }


  function clearBorderEscarpmentTile(tile, replacementHeight = null, role = null) {
    if (!tile) return false;
    const wasBorder = !!tile.borderEscarpment;
    tile.borderEscarpment = false;
    tile.borderEscarpmentDepth = null;
    tile.borderEscarpmentSide = null;
    tile.borderEscarpmentBaseHeight = null;
    tile.borderEscarpmentHeightBonus = null;
    tile.distantBoundaryLandscape = false;
    tile.distantBoundaryLandscapeSide = null;
    tile.distantBoundaryLandscapeDepth = null;
    tile.distantBoundarySourceHeight = null;
    tile.distantBoundaryDisplayHeight = null;
    tile.distantBoundaryRenderBand = null;
    tile.cliffSkirt = false;
    tile.cliffSkirtKind = null;
    tile.cliffFromTier = null;
    tile.cliffToTier = null;
    tile.cliffFacing = null;
    if (replacementHeight !== null && replacementHeight !== undefined && Number.isFinite(replacementHeight) && !tile.water) {
      const h = Math.max(0, replacementHeight);
      tile.elevation = Math.round(h);
      tile.height = h;
      tile.terrain = h > 0 ? 'plateau' : 'grass';
    }
    if (role) {
      tile.designReserve = true;
      tile.designRole = role;
    }
    return wasBorder;
  }

  function openBorderEntryGate(entry, forcedReplacementHeight = null) {
    if (!entry) return 0;
    const inward = inwardDirectionForBorderTile(entry.x, entry.y);
    const sideAxisHorizontal = inward.dir.x === 0;
    const sideTangent = sideAxisHorizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const maxDepth = borderEscarpmentMaxDepth();
    const gateDepth = maxDepth + 5;
    const gateHalfWidth = Math.max(2, Math.round(maxDepth * 0.75));
    const replacementHeight = Number.isFinite(forcedReplacementHeight) ? forcedReplacementHeight : findEntryGateInteriorHeight(entry, inward, gateDepth);
    let cleared = 0;
    let roadTiles = 0;
    for (let d = 0; d <= gateDepth; d++) {
      const flare = d <= 1 ? 1 : 0;
      const halfWidth = gateHalfWidth + flare;
      for (let t = -halfWidth; t <= halfWidth; t++) {
        const edgeSoftener = Math.abs(t) === halfWidth && d > 2 && noise2(entry.x + t, entry.y + d, 74221) < 0.34;
        if (edgeSoftener) continue;
        const x = clamp(entry.x + sideTangent.x * t + inward.dir.x * d, 0, settings.width - 1);
        const y = clamp(entry.y + sideTangent.y * t + inward.dir.y * d, 0, settings.height - 1);
        const tile = tileAt(x, y);
        if (!tile) continue;
        if (clearBorderEscarpmentTile(tile, replacementHeight, 'borderEntryGate')) cleared++;
        tile.water = false;
        tile.terrain = replacementHeight > 0 ? 'plateau' : 'grass';
        tile.elevation = Math.round(replacementHeight);
        tile.height = replacementHeight;
        tile.path = true;
        tile.bridge = false;
        tile.ramp = false;
        tile.rampId = null;
        tile.navRamp = false;
        tile.navRampId = null;
        tile.designReserve = true;
        tile.designRole = 'borderEntryGate';
        roadTiles++;
      }
    }
    logDebug(`border entry gate: carved ${roadTiles} road-mouth tiles, cleared ${cleared} widened border escarpment tiles near ${entry.side} entry, depth ${gateDepth}, half-width ${gateHalfWidth}`);
    return cleared;
  }

  function chooseEntry() {
    const forcedSide = activePresetConfig().forcedEntrySide;
    const requested = (map && map.preselectedEntrySide) || forcedSide || (settings.entrySide === 'random' ? pick(['north', 'east', 'south', 'west']) : settings.entrySide);
    const candidates = [];
    if (requested === 'north' || requested === 'south') {
      const y = requested === 'north' ? 0 : settings.height - 1;
      const guard = borderEscarpmentMaxDepth() + 2;
      for (let x = guard; x < settings.width - guard; x++) candidates.push({ x, y, side: requested });
    } else {
      const x = requested === 'west' ? 0 : settings.width - 1;
      const guard = borderEscarpmentMaxDepth() + 2;
      for (let y = guard; y < settings.height - guard; y++) candidates.push({ x, y, side: requested });
    }
    const gateDepth = borderEscarpmentMaxDepth() + 5;
    const gateHalfWidth = Math.max(2, Math.round(borderEscarpmentMaxDepth() * 0.75));
    const center = requested === 'north' || requested === 'south' ? settings.width / 2 : settings.height / 2;
    const scored = candidates.map(candidate => {
      const axis = requested === 'north' || requested === 'south' ? candidate.x : candidate.y;
      const centerPenalty = Math.abs(axis - center) / Math.max(1, center);
      const waterPenalty = entryGateWaterCount(candidate, gateHalfWidth, gateDepth);
      const inward = inwardDirectionForBorderTile(candidate.x, candidate.y);
      const inner = tileAt(
        clamp(candidate.x + inward.dir.x * (gateDepth + 2), 0, settings.width - 1),
        clamp(candidate.y + inward.dir.y * (gateDepth + 2), 0, settings.height - 1)
      );
      const heightPenalty = inner ? Math.max(0, tileHeight(inner) - 2) * 0.08 : 1;
      return { candidate, score: -waterPenalty * 9 - centerPenalty * 4 - heightPenalty + noise2(candidate.x, candidate.y, 74231) * 0.25 };
    }).sort((a, b) => b.score - a.score);
    let chosen = scored.length ? scored[0].candidate : null;
    if (!chosen) chosen = { x: 0, y: Math.floor(settings.height / 2), side: 'west' };
    map.entry = { x: chosen.x, y: chosen.y, side: chosen.side, type: 'mapEntry' };
    const greatBasinTarget = usesGreatBasinPreset() ? highestWalkablePlateauCandidate(map.entry) : null;
    const forcedGateHeight = greatBasinTarget ? greatBasinTarget.height : null;
    openBorderEntryGate(map.entry, forcedGateHeight);
    if (greatBasinTarget) connectGreatBasinEntryToHighestPlateau(map.entry, greatBasinTarget);
    logDebug(`entry: ${map.entry.side} border at ${map.entry.x},${map.entry.y} with protected road opening${greatBasinTarget ? ` at high basin height ${greatBasinTarget.height}` : ''}`);
  }

  function placeStructures() {
    for (let i = 0; i < settings.structures; i++) {
      const w = chance(0.35) ? 3 : 2;
      const h = chance(0.35) ? 3 : 2;
      const spot = randomFreeArea(w, h, {
        filter: (x, y) => {
          const center = tileAt(x + Math.floor(w / 2), y + Math.floor(h / 2));
          return center.elevation <= 2;
        }
      }, 800);
      if (!spot) {
        warn(`structure ${i + 1}: no valid ${w}x${h} clearing`);
        continue;
      }
      addObject({
        type: 'structure',
        x: spot.x,
        y: spot.y,
        w,
        h,
        blocksMovement: true,
        pathAnchor: nearestFreeNeighbor(spot.x + Math.floor(w / 2), spot.y + h)
      });
    }
    logDebug(`structures placed: ${countObjects('structure')}`);
  }

  function cliffSkirtCaveTiles() {
    const result = [];
    for (let y = 1; y < settings.height - 1; y++) {
      for (let x = 1; x < settings.width - 1; x++) {
        const tile = tileAt(x, y);
        if (!tile || tile.water || tile.ramp || tile.occupiedBy) continue;
        if (!tile.cliffSkirt || tile.cliffSkirtKind !== 'plateau') continue;
        const facing = tile.cliffFacing || { x: 0, y: -1 };
        const frontFacingBonus = facing.y < 0 ? 3 : 0;
        const sideBonus = facing.x !== 0 ? 1 : 0;
        const score = frontFacingBonus + sideBonus + noise2(x, y, 6113);
        result.push({ x, y, score });
      }
    }
    return result.sort((a, b) => b.score - a.score);
  }

  function placeCaves() {
    const caveTiles = cliffSkirtCaveTiles();
    let cursor = 0;
    for (let i = 0; i < settings.caves; i++) {
      let spot = null;
      while (cursor < caveTiles.length && !spot) {
        const candidate = caveTiles[cursor++];
        if (areaFree(candidate.x, candidate.y, 1, 1, { allowPath: true, allowCliffSkirt: true })) spot = candidate;
      }
      if (!spot) {
        warn(`cave ${i + 1}: no valid cliff-skirt tile found`);
        continue;
      }
      const tile = tileAt(spot.x, spot.y);
      tile.cliffSkirtKind = 'cave';
      addObject(withRarity({
        type: 'caveOpening',
        x: spot.x,
        y: spot.y,
        w: 1,
        h: 1,
        blocksMovement: false,
        embeddedIn: 'cliffSkirt',
        facing: tile.cliffFacing ? { ...tile.cliffFacing } : { x: 0, y: -1 },
        pathAnchor: nearestFreeNeighbor(spot.x, spot.y),
        note: 'cave opening with a rarity-pool superscript marker'
      }, 'caveOpening'));
    }
    logDebug(`cave openings placed: ${countObjects('caveOpening')}`);
  }

  function nearestFreeNeighbor(x, y) {
    const rings = [];
    for (let r = 1; r <= 5; r++) {
      for (let yy = y - r; yy <= y + r; yy++) {
        for (let xx = x - r; xx <= x + r; xx++) {
          if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== r) continue;
          rings.push({ x: xx, y: yy });
        }
      }
    }
    const found = rings.find(p => inBounds(p.x, p.y) && areaFree(p.x, p.y, 1, 1, { allowPath: true }));
    return found || { x: clamp(x, 0, settings.width - 1), y: clamp(y, 0, settings.height - 1) };
  }

  // ── Locales: hand-authored irregular footprints stamped into the wilderness ──
  // A "locale" (see docs/tools/locale-editor/) is a small hand-painted area
  // (Leaf & Pahu's House, the Researcher's Tent, a Great Fey shrine, ...)
  // exported as hobunji_locale.v1 JSON. The caller (game.js, via
  // generateZoneWorkspace's third argument) hands in the locale definitions
  // already filtered to whichever ones are eligible for this zone; this pass
  // finds a flat, clear spot for each one, reserves it (so every later
  // placement pass -- structures/caves/dens/flora/etc -- treats it exactly
  // like any other occupied area and never overlaps it), paints its walkable/
  // path tiles into the live tile grid, and registers a normal 'structure'
  // object (with a pathAnchor) so generatePaths() naturally routes a path to
  // it like any other landmark. Runs before placeStructures() so locales get
  // first pick of open ground.
  function localeFootprintBBox(locale) {
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    for (const key of Object.keys(locale.tiles || {})) {
      const [c, r] = key.split(',').map(Number);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
    }
    if (!Number.isFinite(minC)) return null;
    return { minC, minR, w: maxC - minC + 1, h: maxR - minR + 1 };
  }

  // Exhaustive variant of randomFreeArea, scoped to [x0,x1)x[y0,y1): a small
  // rect (e.g. one of nine sectors) can hold only a handful of valid spots,
  // some in a narrow corridor a random sampler could easily whiff on entirely
  // -- scanning every candidate top-left deterministically finds one if it
  // exists at all, and (with preferPoint set) picks whichever is closest to
  // it rather than just the first hit. Used by placement.sameSectorAsEntry.
  function bestFreeAreaInRect(x0, y0, x1, y1, w, h, options = {}, preferPoint = null) {
    let best = null, bestDist = Infinity;
    for (let y = y0; y <= y1 - h; y++) {
      for (let x = x0; x <= x1 - w; x++) {
        if (!areaFree(x, y, w, h, options)) continue;
        if (typeof options.filter === 'function' && !options.filter(x, y, w, h)) continue;
        if (!preferPoint) return { x, y };
        const dist = Math.hypot((x + w / 2) - preferPoint.x, (y + h / 2) - preferPoint.y);
        if (dist < bestDist) { bestDist = dist; best = { x, y }; }
      }
    }
    return best;
  }

  function stampLocale(locale) {
    const bbox = localeFootprintBBox(locale);
    if (!bbox) { warn(`locale ${locale.id}: no footprint tiles, skipped`); return null; }
    const placement = locale.placement || {};
    const clearance = Math.max(0, Math.round(placement.clearanceTiles ?? 3));
    const requiresFlat = placement.requiresFlatGround !== false;
    const minDistFromEntry = Math.max(0, Number(placement.minDistanceFromEntry) || 0);
    const paddedW = bbox.w + clearance * 2;
    const paddedH = bbox.h + clearance * 2;
    if (paddedW > settings.width || paddedH > settings.height) {
      warn(`locale ${locale.id}: footprint + clearance (${paddedW}x${paddedH}) too big for a ${settings.width}x${settings.height} zone, skipped`);
      return null;
    }

    const placementFilter = (x, y, w, h) => {
      if (map.entry && minDistFromEntry > 0) {
        const cx = x + w / 2, cy = y + h / 2;
        const dist = Math.hypot(cx - map.entry.x, cy - map.entry.y);
        if (dist < minDistFromEntry) return false;
      }
      if (requiresFlat) {
        const centerTile = tileAt(Math.floor(x + w / 2), Math.floor(y + h / 2));
        if (!centerTile) return false;
        const targetHeight = tileHeight(centerTile);
        for (let yy = y; yy < y + h; yy++) {
          for (let xx = x; xx < x + w; xx++) {
            const t = tileAt(xx, yy);
            if (!t || Math.abs(tileHeight(t) - targetHeight) > 0.05) return false;
          }
        }
      }
      return true;
    };

    let spot = null;
    // Some locales (the Researcher's Tent, thematically camped near the
    // trailhead) need to land in the same one of nine equal sectors as the
    // zone's entry gate, wherever that ends up this shift -- rather than
    // anywhere flat and clear in the whole zone.
    if (placement.sameSectorAsEntry && map.entry) {
      const sectorW = settings.width / 3, sectorH = settings.height / 3;
      const sx = clamp(Math.floor(map.entry.x / sectorW), 0, 2);
      const sy = clamp(Math.floor(map.entry.y / sectorH), 0, 2);
      const x0 = Math.round(sx * sectorW), x1 = Math.round((sx + 1) * sectorW);
      const y0 = Math.round(sy * sectorH), y1 = Math.round((sy + 1) * sectorH);
      spot = bestFreeAreaInRect(x0, y0, x1, y1, paddedW, paddedH, { filter: placementFilter }, map.entry);
      if (!spot) {
        // That exact ninth has no room at all this shift (the terrain right
        // at a cliff-preset zone's entry corridor can be almost entirely
        // border escarpment) -- fall back to the closest valid spot
        // anywhere in the zone rather than a uniformly random one, so it
        // stays as near the entrance as the terrain actually allows.
        warn(`locale ${locale.id}: no room in the entry's sector (${x0},${y0})-(${x1},${y1}), falling back to the nearest spot in the whole zone`);
        spot = bestFreeAreaInRect(0, 0, settings.width, settings.height, paddedW, paddedH, { filter: placementFilter }, map.entry);
      }
    }
    if (!spot) spot = randomFreeArea(paddedW, paddedH, { filter: placementFilter }, 2500);
    if (!spot) { warn(`locale ${locale.id}: no valid ${paddedW}x${paddedH} clearing found`); return null; }

    const anchorX = spot.x + clearance - bbox.minC;
    const anchorY = spot.y + clearance - bbox.minR;

    // Reserve the padded area so every subsequent placement pass steers clear.
    markOccupied({ id: `locale_reserve_${locale.id}`, x: spot.x, y: spot.y, w: paddedW, h: paddedH });

    // requiresFlatGround only verified the *raw* height here was uniform --
    // it says nothing about whether these tiles carry a plateauGroupId from
    // whatever terrain existed before the locale was stamped over it, or
    // what's just outside its own edge. mergeZoneTilesInto (terrain-preview.js)
    // reclassifies a plateau-tagged tile as a sloped/incline "ring" cell at
    // scene-build time purely from adjacency to a differently-grouped (or
    // ungrouped) neighbor -- it never looks at the raw height this filter
    // checked. Left untouched, a locale placed on/against a plateau reads as
    // flat and walkable at generation time but can render (and collide) as a
    // solid cliff-wall slope later, right where a saved position could land
    // the player inside it.
    //
    // Rather than always flattening the locale to ground level (which would
    // visually sink it below a real plateau it's genuinely sitting on top
    // of), fold it into whichever plateau group already borders it: adopting
    // that group's id on every locale tile makes them all interior cells of
    // the *same* mask, so the ring boundary mergeZoneTilesInto computes
    // lands on the locale's own outer edge instead of cutting across its
    // middle. A locale author can opt out via placement.groundOnly for
    // content deliberately meant to read as a flat cut into the landscape
    // regardless of what it lands on/against.
    let adoptedPlateauGroupId = null;
    if (!placement.groundOnly) {
      const centerTile = tileAt(Math.floor(spot.x + paddedW / 2), Math.floor(spot.y + paddedH / 2));
      if (centerTile) {
        const targetHeight = tileHeight(centerTile);
        const groupVotes = new Map();
        const tallyIfMatch = (xx, yy) => {
          const t = tileAt(xx, yy);
          if (t && t.plateauGroupId && Math.abs(tileHeight(t) - targetHeight) <= 0.05) {
            groupVotes.set(t.plateauGroupId, (groupVotes.get(t.plateauGroupId) || 0) + 1);
          }
        };
        for (let xx = spot.x - 1; xx <= spot.x + paddedW; xx++) {
          tallyIfMatch(xx, spot.y - 1);
          tallyIfMatch(xx, spot.y + paddedH);
        }
        for (let yy = spot.y; yy < spot.y + paddedH; yy++) {
          tallyIfMatch(spot.x - 1, yy);
          tallyIfMatch(spot.x + paddedW, yy);
        }
        let bestVotes = 0;
        for (const [gid, votes] of groupVotes) { if (votes > bestVotes) { bestVotes = votes; adoptedPlateauGroupId = gid; } }
      }
    }

    // Paint the locale's own footprint tiles. Only path/water flags carry a
    // distinct tile type through the generator's export today (see
    // hobunjiMapTileType) -- everything else in the locale's tile palette
    // renders as plain grass for now, which is still a real, occupied,
    // walkable clearing shaped exactly like the authored footprint.
    for (const [key, tileDef] of Object.entries(locale.tiles || {})) {
      const [c, r] = key.split(',').map(Number);
      const tile = tileAt(anchorX + c, anchorY + r);
      if (!tile) continue;
      tile.plateauGroupId = adoptedPlateauGroupId;
      tile.plateauRing = false;
      tile.plateauInterior = !!adoptedPlateauGroupId;
      if (tileDef.type === 'path') { tile.path = true; }
      else if (tileDef.type === 'river' || tileDef.type === 'stream') { tile.water = true; tile.terrain = tileDef.type; }
      else if (tileDef.type === 'waterfall') { tile.waterfall = true; }
    }

    // A carrier 'structure' object per locale: gives generatePaths() a
    // pathAnchor to route toward (via buildPathTargets(), exactly like any
    // other landmark), and carries the locale's metadata (in pre-scale
    // coordinates -- see stampLocales/generateWorkspace for the post-scale
    // read-back into workspace.localeInstances).
    const structureDef = (locale.objects || []).find(o => o.kind === 'structure') || null;
    const primaryConnector = (locale.connectors || [])[0] || null;
    const carrierX = structureDef ? anchorX + structureDef.col : anchorX;
    const carrierY = structureDef ? anchorY + structureDef.row : anchorY;
    const carrierW = structureDef ? structureDef.w : 1;
    const carrierH = structureDef ? structureDef.h : 1;
    const connectorWorld = primaryConnector ? { x: anchorX + primaryConnector.col, y: anchorY + primaryConnector.row } : null;

    const carrier = addObject({
      type: 'structure',
      x: clamp(carrierX, 0, settings.width - 1),
      y: clamp(carrierY, 0, settings.height - 1),
      w: carrierW,
      h: carrierH,
      blocksMovement: !!structureDef,
      pathAnchor: connectorWorld ? nearestFreeNeighbor(connectorWorld.x, connectorWorld.y) : null,
      localeMeta: {
        localeId: locale.id,
        name: locale.name,
        category: locale.category,
        alwaysVisible: !!placement.alwaysVisibleOnMap,
        anchorX, anchorY,
        w: bbox.w, h: bbox.h,
        connectors: (locale.connectors || []).map(c => ({ col: c.col, row: c.row, side: c.side, label: c.label })),
        npcAnchors: (locale.npcAnchors || []).map(n => ({ npcId: n.npcId, name: n.name, col: n.col, row: n.row, facing: n.facing })),
        objects: (locale.objects || []).map(o => ({ id: o.id, kind: o.kind, key: o.key, label: o.label, col: o.col, row: o.row, w: o.w, h: o.h }))
      }
    });
    logDebug(`locale stamped: ${locale.id} at (${anchorX},${anchorY})`);
    return carrier;
  }

  function stampLocales() {
    const locales = (settings.locales || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const locale of locales) stampLocale(locale);
    logDebug(`locales stamped: ${locales.filter(l => (map.objects || []).some(o => o.localeMeta?.localeId === l.id)).length}/${locales.length}`);
  }

  function nearestFreeWalkableNeighbor(x, y) {
    const rings = [];
    for (let r = 1; r <= 7; r++) {
      for (let yy = y - r; yy <= y + r; yy++) {
        for (let xx = x - r; xx <= x + r; xx++) {
          if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== r) continue;
          rings.push({ x: xx, y: yy });
        }
      }
    }
    const found = rings.find(p => inBounds(p.x, p.y) && isWalkableTile(tileAt(p.x, p.y)));
    return found || nearestFreeNeighbor(x, y);
  }

  function tileBlocksMovement(tile) {
    if (!tile) return true;
    if (tile.water && !tile.bridge && !tile.navBridge) return true;
    if (tile.borderEscarpment && !tile.ramp && !tile.navRamp) return true;
    if (tile.distantBoundaryLandscape) return true;
    if (tile.cliffSkirt && !tile.ramp && !tile.navRamp) return true;
    const object = tile.occupiedBy ? getObjectById(tile.occupiedBy) : null;
    return !!(object && object.blocksMovement !== false);
  }

  function isWalkableTile(tile) {
    return !!tile && !tileBlocksMovement(tile);
  }

  function canStepBetween(fromTile, toTile) {
    if (!fromTile || !toTile || !isWalkableTile(toTile)) return false;
    const heightDiff = Math.abs(tileHeight(toTile) - tileHeight(fromTile));
    if (heightDiff >= settings.rampMinDiff && !fromTile.ramp && !toTile.ramp && !fromTile.navRamp && !toTile.navRamp) return false;
    return true;
  }

  function movementNeighbors(tile) {
    const dirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 },
      { x: 0, y: 1 }, { x: 0, y: -1 }
    ];
    const result = [];
    for (const dir of dirs) {
      const next = tileAt(tile.x + dir.x, tile.y + dir.y);
      if (canStepBetween(tile, next)) result.push(next);
    }
    return result;
  }

  function reachableFrom(start) {
    // new variable: fallbackStart avoids repeated nearest-neighbor scans when the entry tile itself is blocked.
    const fallbackStart = isWalkableTile(tileAt(start.x, start.y)) ? start : nearestFreeWalkableNeighbor(start.x, start.y);
    const origin = tileAt(fallbackStart.x, fallbackStart.y);
    const seen = new Set();
    const queue = [];
    if (origin && isWalkableTile(origin)) {
      seen.add(`${origin.x},${origin.y}`);
      queue.push(origin);
    }
    for (let i = 0; i < queue.length; i++) {
      const tile = queue[i];
      for (const next of movementNeighbors(tile)) {
        const key = `${next.x},${next.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    return seen;
  }

  function allWalkableTiles() {
    return allTiles().filter(isWalkableTile);
  }


  function reserveDesignClearing(cx, cy, radius, role = 'breathingSpace') {
    let reserved = 0;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if (!inBounds(x, y)) continue;
        const tile = tileAt(x, y);
        if (!tile || tile.water || tile.cliffSkirt || tile.ramp) continue;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > radius + noise2(x, y, 33517) * 0.45) continue;
        tile.designReserve = true;
        tile.designRole = tile.designRole || role;
        reserved++;
      }
    }
    return reserved;
  }

  function nearbyTileCount(x, y, radius, predicate) {
    let count = 0;
    for (let yy = y - radius; yy <= y + radius; yy++) {
      for (let xx = x - radius; xx <= x + radius; xx++) {
        if (!inBounds(xx, yy)) continue;
        const tile = tileAt(xx, yy);
        if (tile && predicate(tile)) count++;
      }
    }
    return count;
  }

  function straightSightScore(x, y) {
    let score = 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      let run = 0;
      let lastHeight = tileHeight(tileAt(x, y));
      for (let step = 1; step <= 14; step++) {
        const tile = tileAt(x + dx * step, y + dy * step);
        if (!tile || tile.water || tile.cliffSkirt) break;
        if (Math.abs(tileHeight(tile) - lastHeight) >= settings.rampMinDiff && !tile.ramp) break;
        run++;
        lastHeight = tileHeight(tile);
      }
      score += Math.min(6, run);
    }
    return score;
  }

  function landmarkCandidateScore(tile, sectorCenter) {
    if (!tile || !isWalkableTile(tile) || tile.water || tile.cliffSkirt || tile.ramp) return -Infinity;
    const nearCliff = nearbyTileCount(tile.x, tile.y, 4, t => !!t.cliffSkirt);
    const nearWater = nearbyTileCount(tile.x, tile.y, 5, t => !!t.water);
    const nearPath = nearbyTileCount(tile.x, tile.y, 4, t => !!t.path || !!t.invisiblePath);
    const view = straightSightScore(tile.x, tile.y);
    const sectorDist = Math.hypot(tile.x - sectorCenter.x, tile.y - sectorCenter.y);
    const entryDist = map.entry ? Math.hypot(tile.x - map.entry.x, tile.y - map.entry.y) : 0;
    const height = tileHeight(tile);
    const centerPenalty = sectorDist * 0.10;
    return height * 2.3 + Math.min(nearCliff, 9) * 0.55 + Math.min(nearWater, 14) * 0.18 + Math.min(nearPath, 8) * 0.22 + view * 0.28 + entryDist * 0.025 + noise2(tile.x, tile.y, 77171) * 2.1 - centerPenalty;
  }

  function chooseSectorLandmarkCandidate(sx, sy, sectorsX, sectorsY) {
    const xMin = Math.max(1, Math.floor(settings.width * sx / sectorsX));
    const xMax = Math.min(settings.width - 2, Math.floor(settings.width * (sx + 1) / sectorsX) - 1);
    const yMin = Math.max(1, Math.floor(settings.height * sy / sectorsY));
    const yMax = Math.min(settings.height - 2, Math.floor(settings.height * (sy + 1) / sectorsY) - 1);
    const sectorCenter = { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 };
    const candidates = [];
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const tile = tileAt(x, y);
        if (!tile || tile.designReserve || tile.occupiedBy) continue;
        const score = landmarkCandidateScore(tile, sectorCenter);
        if (Number.isFinite(score)) candidates.push({ tile, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.tile || null;
  }

  function placeVeteranLandmarkAnchors() {
    const sectorsX = 3;
    const sectorsY = 3;
    const desired = clamp(Math.round((settings.width * settings.height) / 1450), 5, 8);
    const sectorOrder = [];
    for (let sy = 0; sy < sectorsY; sy++) for (let sx = 0; sx < sectorsX; sx++) sectorOrder.push({ sx, sy, roll: noise2(sx, sy, 91777) });
    sectorOrder.sort((a, b) => a.roll - b.roll);
    let placed = 0;
    let reserved = 0;
    for (const sector of sectorOrder) {
      if (placed >= desired) break;
      const tile = chooseSectorLandmarkCandidate(sector.sx, sector.sy, sectorsX, sectorsY);
      if (!tile) continue;
      const pathAnchor = nearestFreeWalkableNeighbor(tile.x, tile.y);
      addObject({
        type: 'statue',
        x: tile.x,
        y: tile.y,
        w: 1,
        h: chance(0.34) ? 2 : 1,
        occupies: false,
        blocksMovement: false,
        mapDesignLandmark: true,
        landmarkRole: 'orientationLandmark',
        pathAnchor,
        note: 'orientation landmark from the veteran map-design pass; non-blocking and placed as a sector-readable vista/breadcrumb anchor'
      });
      tile.designLandmarkInfluence = Math.max(tile.designLandmarkInfluence || 0, 1);
      reserved += reserveDesignClearing(tile.x, tile.y, randFloat(2.2, 3.5), 'landmarkBreathingSpace');
      placed++;
    }
    map.designAnalysis = map.designAnalysis || {};
    map.designAnalysis.orientationLandmarks = placed;
    map.designAnalysis.landmarkReservedTiles = reserved;
    logDebug(`veteran design: placed ${placed} orientation landmarks and reserved ${reserved} breathing-space tiles`);
  }

  function pathTurns(path) {
    let turns = 0;
    for (let i = 2; i < path.length; i++) {
      const ax = Math.sign(path[i - 1].x - path[i - 2].x);
      const ay = Math.sign(path[i - 1].y - path[i - 2].y);
      const bx = Math.sign(path[i].x - path[i - 1].x);
      const by = Math.sign(path[i].y - path[i - 1].y);
      if (ax !== bx || ay !== by) turns++;
    }
    return turns;
  }

  function visiblePathDegreeAt(x, y) {
    let count = 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const tile = tileAt(x + dx, y + dy);
      if (tile && tile.path) count++;
    }
    return count;
  }

  function visiblePathDeadEnds() {
    return allTiles().filter(tile => tile.path && visiblePathDegreeAt(tile.x, tile.y) <= 1 && !(map.entry && tile.x === map.entry.x && tile.y === map.entry.y));
  }

  function chooseLoopAnchors() {
    const anchors = [];
    for (const object of map.objects) {
      if (!object.pathAnchor) continue;
      if (object.mapDesignLandmark || object.type === 'structure' || object.type === 'caveOpening' || object.type === 'animalDen') {
        const anchor = nearestFreeWalkableNeighbor(object.pathAnchor.x, object.pathAnchor.y);
        anchors.push({ ...anchor, id: object.id, role: object.mapDesignLandmark ? 'landmark' : object.type });
      }
    }
    const unique = [];
    const seen = new Set();
    for (const anchor of anchors) {
      const key = keyXY(anchor.x, anchor.y);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(anchor);
    }
    const cx = settings.width / 2;
    const cy = settings.height / 2;
    unique.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    return unique;
  }

  function createSwissCheeseLoopPaths() {
    const anchors = chooseLoopAnchors();
    if (anchors.length < 3) return { loops: 0, loopTiles: 0, crossLinks: 0 };
    const maxLoops = clamp(Math.round(anchors.length * 0.65), 3, 7);
    let loops = 0;
    let loopTiles = 0;
    let crossLinks = 0;
    const usedPairs = new Set();
    const connect = (a, b, reason) => {
      const pairKey = [keyXY(a.x, a.y), keyXY(b.x, b.y)].sort().join('__');
      if (usedPairs.has(pairKey)) return false;
      usedPairs.add(pairKey);
      const path = findPath(a, b, { allowWater: true }) || findPath(a, b, { allowWater: true, allowCliffSkirt: true });
      if (!path || path.length < 8) return false;
      markVisiblePath(path);
      map.paths.push({ id: `path_${map.paths.length + 1}`, from: { x: a.x, y: a.y, role: a.role }, to: { x: b.x, y: b.y, role: b.role, reason }, points: path, mapDesignLoop: true, turnCount: pathTurns(path) });
      loopTiles += path.length;
      loops++;
      return true;
    };
    const stride = Math.max(1, Math.floor(anchors.length / maxLoops));
    for (let i = 0; i < anchors.length && loops < maxLoops; i += stride) {
      const a = anchors[i];
      const b = anchors[(i + stride + 1) % anchors.length];
      connect(a, b, 'swissCheeseLoop');
    }
    for (let i = 0; i < anchors.length && crossLinks < 3; i++) {
      const a = anchors[i];
      const b = anchors[(i + Math.floor(anchors.length / 2)) % anchors.length];
      if (connect(a, b, 'crossLinkNoVisualDeadEnd')) crossLinks++;
    }
    return { loops, loopTiles, crossLinks };
  }

  function placeBreadcrumbObjectsAlongRoutes() {
    const routeTiles = [];
    for (const path of map.paths) {
      if (!path.points || path.points.length < 10) continue;
      const every = randInt(10, 15);
      for (let i = every; i < path.points.length - 3; i += every) {
        const point = path.points[i];
        const tile = tileAt(point.x, point.y);
        if (!tile || tile.water || tile.occupiedBy || tile.breadcrumb) continue;
        const bend = i > 1 && i < path.points.length - 1 && ((path.points[i].x - path.points[i - 1].x) !== (path.points[i + 1].x - path.points[i].x) || (path.points[i].y - path.points[i - 1].y) !== (path.points[i + 1].y - path.points[i].y));
        const nearCrossing = nearbyTileCount(point.x, point.y, 2, t => !!t.water) > 0;
        if (!bend && !nearCrossing && !chance(0.45)) continue;
        routeTiles.push({ x: point.x, y: point.y, score: (bend ? 2 : 0) + (nearCrossing ? 2 : 0) + noise2(point.x, point.y, 66113) });
      }
    }
    routeTiles.sort((a, b) => b.score - a.score);
    let placed = 0;
    const maxBreadcrumbs = clamp(Math.round((settings.width * settings.height) / 620), 8, 18);
    const occupied = new Set();
    for (const point of routeTiles) {
      if (placed >= maxBreadcrumbs) break;
      const key = keyXY(point.x, point.y);
      if (occupied.has(key)) continue;
      const tooClose = [...occupied].some(k => {
        const [x, y] = k.split(',').map(Number);
        return Math.abs(x - point.x) + Math.abs(y - point.y) < 7;
      });
      if (tooClose) continue;
      const tile = tileAt(point.x, point.y);
      if (!tile || tile.occupiedBy || tile.water) continue;
      addObject(withRarity({
        type: 'foragePlant',
        x: point.x,
        y: point.y,
        w: 1,
        h: 1,
        occupies: false,
        blocksMovement: false,
        color: '#facc15',
        mapDesignBreadcrumb: true,
        note: 'subtle route breadcrumb from the veteran map-design pass; placed near bends/crossings to guide attention without a hard arrow'
      }, 'foragePlant'));
      tile.breadcrumb = true;
      occupied.add(key);
      placed++;
    }
    return placed;
  }

  function reservePacingClearingsNearJunctions() {
    let reserved = 0;
    let clearings = 0;
    for (const tile of allTiles()) {
      if (!tile.path || tile.water || tile.cliffSkirt) continue;
      const degree = visiblePathDegreeAt(tile.x, tile.y);
      const nearLandmark = nearbyTileCount(tile.x, tile.y, 4, t => (t.designLandmarkInfluence || 0) > 0) > 0;
      if (degree >= 3 || nearLandmark || (degree === 2 && noise2(tile.x, tile.y, 31777) > 0.985)) {
        reserved += reserveDesignClearing(tile.x, tile.y, degree >= 3 ? 2.7 : 2.0, degree >= 3 ? 'routeJunctionBreathingSpace' : 'routePacingBreathingSpace');
        clearings++;
      }
    }
    return { clearings, reserved };
  }

  function applyVeteranMapDesignPass() {
    const loopResult = createSwissCheeseLoopPaths();
    const breadcrumbs = placeBreadcrumbObjectsAlongRoutes();
    const pacing = reservePacingClearingsNearJunctions();
    const deadEnds = visiblePathDeadEnds();
    for (const tile of deadEnds) tile.visualDeadEnd = true;
    map.designAnalysis = {
      ...(map.designAnalysis || {}),
      swissCheeseLoops: loopResult.loops,
      crossLinks: loopResult.crossLinks,
      loopTiles: loopResult.loopTiles,
      breadcrumbs,
      pacingClearings: pacing.clearings,
      pacingReservedTiles: pacing.reserved,
      visualDeadEnds: deadEnds.length,
      designSources: [
        'landmarks for orientation/readability',
        'Swiss-cheese loop paths instead of visual dead ends',
        'sector coverage so the map has goals in multiple directions',
        'breathing clearings at junctions/vistas',
        'automated dead-end/reachability-style checks'
      ]
    };
    logDebug(`veteran design pass: loops ${loopResult.loops}, cross-links ${loopResult.crossLinks}, breadcrumbs ${breadcrumbs}, pacing clearings ${pacing.clearings}, visual dead ends ${deadEnds.length}`);
  }

  function buildPathTargets() {
    const targets = [];
    for (const object of map.objects) {
      if ((object.type === 'structure' || object.type === 'caveOpening' || object.mapDesignLandmark) && object.pathAnchor) {
        targets.push({ ...object.pathAnchor, reason: object.mapDesignLandmark ? (object.landmarkRole || 'mapDesignLandmark') : object.type, targetId: object.id });
      }
    }

    // new variable: sparseTargetLimit keeps visible roads from turning the wilderness into a grid while still honoring landmark-route coverage.
    const sparseTargetLimit = settings.pathAnchors + countObjects('structure') + countObjects('caveOpening') + countObjects('statue', object => object.mapDesignLandmark);
    const sectorsX = 3;
    const sectorsY = 3;
    for (let sy = 0; sy < sectorsY; sy++) {
      for (let sx = 0; sx < sectorsX; sx++) {
        if (targets.length >= sparseTargetLimit) break;
        const xMin = Math.floor((settings.width / sectorsX) * sx);
        const xMax = Math.floor((settings.width / sectorsX) * (sx + 1)) - 1;
        const yMin = Math.floor((settings.height / sectorsY) * sy);
        const yMax = Math.floor((settings.height / sectorsY) * (sy + 1)) - 1;
        const spot = randomFreeArea(1, 1, {
          allowPath: true,
          allowInvisiblePath: true,
          filter: (x, y) => x >= xMin && x <= xMax && y >= yMin && y <= yMax && !tileAt(x, y).water
        }, 100);
        if (spot) targets.push({ ...spot, reason: 'visibleRouteReach' });
      }
    }

    let guard = 0;
    while (targets.length < sparseTargetLimit && guard++ < 200) {
      const spot = randomFreeArea(1, 1, { allowPath: true, allowInvisiblePath: true, filter: (x, y) => !tileAt(x, y).water }, 200);
      if (spot) targets.push({ ...spot, reason: 'visibleExtraReach' });
    }
    return targets;
  }

  function heapPush(heap, node) {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].f <= node.f) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = node;
  }

  function heapPop(heap) {
    if (!heap.length) return null;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      let i = 0;
      while (true) {
        let child = i * 2 + 1;
        if (child >= heap.length) break;
        const right = child + 1;
        if (right < heap.length && heap[right].f < heap[child].f) child = right;
        if (heap[child].f >= last.f) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return top;
  }

  function findPath(start, goal, options = {}) {
    const allowWater = options.allowWater !== false;
    const allowOccupied = !!options.allowOccupied;
    const allowCliffSkirt = !!options.allowCliffSkirt;
    const allowPlateauRing = !!options.allowPlateauRing;
    const preferInvisible = !!options.preferInvisible;
    const open = [];
    heapPush(open, { x: start.x, y: start.y, g: 0, f: 0, prev: null });
    const best = new Map([[tileIdXY(start.x, start.y), 0]]);
    let loops = 0;
    while (open.length && loops++ < settings.width * settings.height * 12) {
      const current = heapPop(open);
      if (current.x === goal.x && current.y === goal.y) {
        const path = [];
        let node = current;
        while (node) {
          path.push({ x: node.x, y: node.y });
          node = node.prev;
        }
        return path.reverse();
      }
      const currentTile = tileAt(current.x, current.y);
      const neighbors = [
        { x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }
      ];
      for (const next of neighbors) {
        if (!inBounds(next.x, next.y)) continue;
        const nextTile = tileAt(next.x, next.y);
        if (nextTile.borderEscarpment && !nextTile.ramp && !nextTile.navRamp) continue;
        if (nextTile.cliffSkirt && !nextTile.ramp && !nextTile.waterfall && !allowCliffSkirt) continue;
        const blockingObject = nextTile.occupiedBy ? getObjectById(nextTile.occupiedBy) : null;
        if (blockingObject && blockingObject.blocksMovement !== false && ['structure', 'caveOpening', 'animalDen'].includes(blockingObject.type)) continue;
        if (blockingObject && blockingObject.blocksMovement !== false && !allowOccupied) continue;
        if (nextTile.water && !nextTile.bridge && !nextTile.navBridge && !allowWater) continue;
        const occupiedCost = blockingObject && blockingObject.blocksMovement !== false ? 45 : 0;
        const waterCost = nextTile.water && !nextTile.bridge && !nextTile.navBridge ? 16 : 0;
        const heightDiff = Math.abs(tileHeight(nextTile) - tileHeight(currentTile));
        const usesRamp = currentTile.ramp || nextTile.ramp || currentTile.navRamp || nextTile.navRamp;
        const tierCost = heightDiff * (usesRamp ? 0.45 : 2.1);
        const cliffCost = heightDiff >= settings.rampMinDiff && !usesRamp ? heightDiff * (allowCliffSkirt ? 38 : 28) : 0;
        const existingPathBias = nextTile.path ? -0.55 : 0;
        const invisibleBias = preferInvisible && nextTile.invisiblePath ? -0.75 : 0;
        const rampBias = usesRamp ? -0.35 : 0;
        const randomBias = noise2(next.x, next.y, 1225) * 0.25;
        const g = current.g + 1 + occupiedCost + waterCost + tierCost + cliffCost + existingPathBias + invisibleBias + rampBias + randomBias;
        const k = tileIdXY(next.x, next.y);
        if (best.has(k) && best.get(k) <= g) continue;
        best.set(k, g);
        const h = Math.abs(next.x - goal.x) + Math.abs(next.y - goal.y);
        heapPush(open, { x: next.x, y: next.y, g, f: g + h, prev: current });
      }
    }
    return null;
  }

  function findGridPath(start, goal, options = {}) {
    const allowWater = !!options.allowWater;
    const allowOccupied = !!options.allowOccupied;
    const allowCliffSkirt = !!options.allowCliffSkirt;
    const allowPlateauRing = !!options.allowPlateauRing;
    const allowHeight = !!options.allowHeight;
    const startTile = tileAt(start.x, start.y);
    const goalTile = tileAt(goal.x, goal.y);
    if (!startTile || !goalTile) return null;
    const queue = [{ x: start.x, y: start.y }];
    const parent = new Map([[tileIdXY(start.x, start.y), null]]);
    const dirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 },
      { x: 0, y: 1 }, { x: 0, y: -1 }
    ];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current.x === goal.x && current.y === goal.y) {
        const path = [];
        let k = tileIdXY(current.x, current.y);
        while (k !== null && k !== undefined) {
          const x = k % settings.width;
          const y = Math.floor(k / settings.width);
          path.push({ x, y });
          k = parent.get(k);
        }
        return path.reverse();
      }
      const currentTile = tileAt(current.x, current.y);
      for (const dir of dirs) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        const nk = tileIdXY(nx, ny);
        if (!inBounds(nx, ny) || parent.has(nk)) continue;
        const nextTile = tileAt(nx, ny);
        if (nextTile.borderEscarpment && !nextTile.ramp && !nextTile.navRamp) continue;
        if (nextTile.cliffSkirt && !nextTile.ramp && !nextTile.navRamp && !allowCliffSkirt) continue;
        if (nextTile.water && !nextTile.bridge && !nextTile.navBridge && !allowWater) continue;
        const blockingObject = nextTile.occupiedBy ? getObjectById(nextTile.occupiedBy) : null;
        if (blockingObject && blockingObject.blocksMovement !== false && ['structure', 'caveOpening', 'animalDen'].includes(blockingObject.type)) continue;
        if (blockingObject && blockingObject.blocksMovement !== false && !allowOccupied) continue;
        const heightDiff = Math.abs(tileHeight(nextTile) - tileHeight(currentTile));
        if (heightDiff >= settings.rampMinDiff && !nextTile.ramp && !currentTile.ramp && !nextTile.navRamp && !currentTile.navRamp && !allowHeight) continue;
        parent.set(nk, tileIdXY(current.x, current.y));
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  function generatePaths() {
    const targets = buildPathTargets();
    let start = { x: map.entry.x, y: map.entry.y };
    let made = 0;
    for (const target of targets) {
      const path = findPath(start, target, { allowWater: true }) || findPath({ x: map.entry.x, y: map.entry.y }, target, { allowWater: true });
      if (!path) {
        logDebug(`visible path skipped from ${start.x},${start.y} to ${target.x},${target.y}; invisible nav may still connect it`);
        continue;
      }
      markVisiblePath(path);
      map.paths.push({ id: `path_${map.paths.length + 1}`, from: { ...start }, to: { x: target.x, y: target.y, reason: target.reason, targetId: target.targetId || null }, points: path });
      start = { x: target.x, y: target.y };
      made++;
    }
    logDebug(`visible paths made: ${made}, destinations attempted: ${targets.length}`);
  }

  function markVisiblePath(path) {
    for (const p of path) {
      const tile = tileAt(p.x, p.y);
      tile.path = true;
      if (tile.water) tile.bridge = true;
    }
  }

  function markInvisiblePath(path, reason, targetId = null) {
    const id = `invisible_path_${map.invisiblePaths.length + 1}`;
    let bridgeTiles = 0;
    for (const p of path) {
      const tile = tileAt(p.x, p.y);
      tile.invisiblePath = true;
      tile.invisiblePathId = id;
      if (reason === 'animalDenEscape') tile.denRoute = true;
      if (tile.water && !tile.bridge) {
        tile.navBridge = true;
        bridgeTiles++;
      }
    }
    map.invisiblePaths.push({ id, reason, targetId, points: path, bridgeTiles });
    return id;
  }

  function placeAnimalDens() {
    // new variable: placedDens counts combat-spawn anchor objects for the debug panel.
    let placedDens = 0;
    const maxTries = Math.max(300, settings.animalDens * 70);
    for (let tries = 0; tries < maxTries && placedDens < settings.animalDens; tries++) {
      const dims = chance(0.7) ? { w: 3, h: 3 } : { w: 3, h: 2 };
      const spot = randomFreeArea(dims.w, dims.h, {
        filter: (x, y, w, h) => {
          if (areaElevationSpread(x, y, w, h) > 1) return false;
          const center = tileAt(x + Math.floor(w / 2), y + Math.floor(h / 2));
          if (!center || center.elevation > Math.max(3, settings.maxTier - 1)) return false;
          const borderBias = x < settings.width * 0.18 || x > settings.width * 0.82 || y < settings.height * 0.32 || y > settings.height * 0.76;
          return borderBias || noise2(x, y, 8871) > 0.55;
        }
      }, 1);
      if (!spot) continue;
      // nearestFreeNeighbor(x,y) never checks (x,y) itself and its ring search
      // isn't direction-aware (r=1's first candidate is (x-1,y-1) by iteration
      // order, not "closest free tile south") — fine for escapeAnchor, which
      // only needs *some* nearby free tile to flee toward, but wrong for the
      // doorway anchor, which must be the exact tile south of the footprint
      // to line up with the mesh's south-facing mouth carve (see
      // buildAnimalDenMeshes) and the collision-gap cutout. Computed directly
      // here instead, clamped to map bounds; it doesn't need a walkability
      // check since it becomes the walkable doorway/transition tile itself.
      const anchor = nearestFreeNeighbor(spot.x + Math.floor(dims.w / 2), spot.y + dims.h);
      const mouthAnchor = {
        x: clamp(spot.x + Math.floor(dims.w / 2), 0, settings.width - 1),
        y: clamp(spot.y + dims.h, 0, settings.height - 1),
      };
      addObject({
        type: 'animalDen',
        x: spot.x,
        y: spot.y,
        w: dims.w,
        h: dims.h,
        blocksMovement: true,
        escapeAnchor: anchor,
        pathAnchor: anchor,
        // The den's south-facing doorway tile — see comment above.
        mouthAnchor,
        spawnRole: 'wildAnimalPackHome',
        note: 'wild animal den; low-health packs can flee toward this anchor'
      });
      placedDens++;
    }
    if (placedDens < settings.animalDens) warn(`animalDen: placed ${placedDens}/${settings.animalDens}`);
    logDebug(`animal dens placed: ${placedDens}/${settings.animalDens}`);
  }

  function buildInvisiblePathTargets() {
    const targets = [];
    for (const object of map.objects) {
      if (object.type === 'animalDen' && object.escapeAnchor) {
        targets.push({ ...object.escapeAnchor, reason: 'animalDenEscape', targetId: object.id });
      }
    }

    const sectorsX = 4;
    const sectorsY = 3;
    for (let sy = 0; sy < sectorsY; sy++) {
      for (let sx = 0; sx < sectorsX; sx++) {
        const xMin = Math.floor((settings.width / sectorsX) * sx);
        const xMax = Math.floor((settings.width / sectorsX) * (sx + 1)) - 1;
        const yMin = Math.floor((settings.height / sectorsY) * sy);
        const yMax = Math.floor((settings.height / sectorsY) * (sy + 1)) - 1;
        const spot = randomFreeArea(1, 1, {
          allowPath: true,
          allowInvisiblePath: true,
          filter: (x, y) => x >= xMin && x <= xMax && y >= yMin && y <= yMax && isWalkableTile(tileAt(x, y))
        }, 140);
        if (spot) targets.push({ ...spot, reason: 'invisibleSectorReach' });
      }
    }

    for (let i = 0; i < Math.max(6, Math.floor((settings.width * settings.height) / 260)); i++) {
      const spot = randomFreeArea(1, 1, {
        allowPath: true,
        allowInvisiblePath: true,
        filter: (x, y) => isWalkableTile(tileAt(x, y))
      }, 120);
      if (spot) targets.push({ ...spot, reason: 'invisibleWanderReach' });
    }
    return targets;
  }

  function generateInvisibleNavigation() {
    const targets = buildInvisiblePathTargets();
    const start = nearestFreeWalkableNeighbor(map.entry.x, map.entry.y);
    let made = 0;
    for (const target of targets) {
      const safeTarget = nearestFreeWalkableNeighbor(target.x, target.y);
      const path = findGridPath(start, safeTarget, { allowWater: false })
        || findGridPath(start, safeTarget, { allowWater: true })
        || findGridPath(start, safeTarget, { allowWater: true, allowCliffSkirt: true, allowHeight: true });
      if (!path) {
        warn(`invisible nav failed to ${safeTarget.x},${safeTarget.y} (${target.reason})`);
        continue;
      }
      normalizeConnectivityPath(path);
      markInvisiblePath(path, target.reason, target.targetId || null);
      made++;
    }
    logDebug(`invisible connectivity corridors made: ${made}, destinations attempted: ${targets.length}`);
  }

  function normalizeConnectivityPath(path) {
    // new variable: passId labels emergency/hidden ramps that were created only to guarantee traversal.
    const passId = `connectivity_pass_${map.ramps.length + 1}`;
    const pathHeights = path.map(point => tileHeight(tileAt(point.x, point.y))).filter(Number.isFinite);
    const lowTier = pathHeights.length ? Math.min(...pathHeights) : 0;
    const highTier = pathHeights.length ? Math.max(...pathHeights) : 0;
    const passDiff = Math.abs(highTier - lowTier);
    const passRun = Math.max(1, path.length - 1);
    if (passDiff >= settings.rampMinDiff && passRun < minRampRunForAngle(passDiff)) {
      warn(`connectivity pass skipped: path length ${passRun} would exceed ${rampMaxAngleDegrees()}° for tier jump ${passDiff.toFixed(2)}`);
      return 0;
    }
    let madeRampTiles = 0;
    for (let i = 0; i < path.length; i++) {
      const tile = tileAt(path[i].x, path[i].y);
      const prev = i > 0 ? tileAt(path[i - 1].x, path[i - 1].y) : null;
      const next = i < path.length - 1 ? tileAt(path[i + 1].x, path[i + 1].y) : null;
      const prevDiff = prev ? Math.abs(tileHeight(tile) - tileHeight(prev)) : 0;
      const nextDiff = next ? Math.abs(tileHeight(tile) - tileHeight(next)) : 0;
      const needsPassRamp = (tile.cliffSkirt && !tile.waterfall) || prevDiff >= settings.rampMinDiff || nextDiff >= settings.rampMinDiff;
      if (!needsPassRamp) continue;
      const low = Math.min(prev ? tileHeight(prev) : tileHeight(tile), tileHeight(tile), next ? tileHeight(next) : tileHeight(tile));
      const high = Math.max(prev ? tileHeight(prev) : tileHeight(tile), tileHeight(tile), next ? tileHeight(next) : tileHeight(tile));
      const from = prev || tile;
      const to = next || tile;
      // Hidden navigation repair: keep this out of visible ramp geometry. Real visible ramps are generated by generateRamps().
      tile.navRamp = true;
      tile.navRampId = passId;
      tile.navRampProgress = path.length > 1 ? Number((i / (path.length - 1)).toFixed(2)) : 0;
      if (tile.cliffSkirt) tile.cliffSkirtKind = tile.cliffSkirtKind || 'plateau';
      madeRampTiles++;
    }
    if (madeRampTiles) {
      map.hiddenNavRamps = map.hiddenNavRamps || [];
      map.hiddenNavRamps.push({
        id: passId,
        reason: 'hidden reachability/invisible navigation repair; intentionally not exported as visible ramp geometry',
        length: madeRampTiles,
        minimumRunTiles: minRampRunForAngle(passDiff),
        generatedRunTiles: passRun,
        maxAngleDegrees: rampMaxAngleDegrees(),
        angleDegrees: Number(rampAngleDegrees(passDiff, passRun).toFixed(2))
      });
    }
    return madeRampTiles;
  }

  function clearBlockingObjectsOnPath(path) {
    const protectedTypes = new Set(['structure', 'caveOpening', 'animalDen']);
    const removeIds = new Set();
    for (const p of path) {
      const tile = tileAt(p.x, p.y);
      if (!tile || !tile.occupiedBy) continue;
      const object = getObjectById(tile.occupiedBy);
      if (object && object.blocksMovement !== false && !protectedTypes.has(object.type)) removeIds.add(object.id);
    }
    if (!removeIds.size) return 0;
    map.objects = map.objects.filter(object => !removeIds.has(object.id));
    rebuildObjectCache();
    for (const tile of allTiles()) {
      if (removeIds.has(tile.occupiedBy)) tile.occupiedBy = null;
    }
    return removeIds.size;
  }

  function findRepairPath(start, goal) {
    return findGridPath(start, goal, { allowWater: false, allowOccupied: true })
      || findGridPath(start, goal, { allowWater: true, allowOccupied: true })
      || findGridPath(start, goal, { allowWater: true, allowOccupied: true, allowCliffSkirt: true, allowHeight: true });
  }

  function markHiddenNavRampTile(tile, passId, progress = 0, reason = 'hiddenReachabilityStitch') {
    if (!tile || tile.water || tile.borderEscarpment) return false;
    tile.navRamp = true;
    tile.navRampId = passId;
    tile.navRampProgress = Number(clamp(progress, 0, 1).toFixed(2));
    tile.navRampReason = reason;
    if (tile.cliffSkirt) tile.cliffSkirtKind = tile.cliffSkirtKind || 'plateau';
    return true;
  }

  function stitchReachabilityWithHiddenLedges(start, maxPasses = 420) {
    let stitchedEdges = 0;
    let hiddenTiles = 0;
    let passes = 0;
    const passId = `hidden_ledge_stitch_${(map.hiddenNavRamps || []).length + 1}`;

    const markPair = (a, b, reason) => {
      if (!a || !b || a.water || b.water || a.borderEscarpment || b.borderEscarpment) return false;
      const beforeA = !!a.navRamp;
      const beforeB = !!b.navRamp;
      markHiddenNavRampTile(a, passId, 0.35, reason);
      markHiddenNavRampTile(b, passId, 0.65, reason);
      hiddenTiles += (!beforeA ? 1 : 0) + (!beforeB ? 1 : 0);
      stitchedEdges++;
      return true;
    };

    for (let guard = 0; guard < maxPasses; guard++) {
      const reached = reachableFrom(start);
      const walkable = allWalkableTiles();
      const unreachable = walkable.filter(tile => !reached.has(keyXY(tile.x, tile.y)));
      if (!unreachable.length) break;
      let options = [];
      reached.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        const from = tileAt(x, y);
        if (!from) return;
        for (const dir of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
          const mid = tileAt(x + dir.x, y + dir.y);
          const far = tileAt(x + dir.x * 2, y + dir.y * 2);
          if (!mid || mid.water || mid.occupiedBy || mid.borderEscarpment) continue;
          const midKey = keyXY(mid.x, mid.y);
          const farKey = far ? keyXY(far.x, far.y) : null;
          const midUnreachedWalkable = isWalkableTile(mid) && !reached.has(midKey);
          const farUnreachedWalkable = far && isWalkableTile(far) && !reached.has(farKey);
          if (!midUnreachedWalkable && !(mid.cliffSkirt && farUnreachedWalkable)) continue;
          const high = farUnreachedWalkable ? (tileHeight(far) >= tileHeight(from) ? far : from) : (tileHeight(mid) >= tileHeight(from) ? mid : from);
          const low = farUnreachedWalkable ? (high === far ? from : far) : (high === mid ? from : mid);
          // Preserve the authored visual rule: prefer hidden stitches that still climb northward or run flat/sideways.
          const southToNorthScore = high.y < low.y ? 7 : (high.y === low.y ? 3 : -6);
          const horizontalLedgeScore = dir.x !== 0 ? 4 : 0;
          const cliffScore = mid.cliffSkirt ? 6 : 0;
          const heightScore = Math.abs(tileHeight(high) - tileHeight(low)) * 1.5;
          const distScore = -Math.abs((far || mid).x - start.x) * 0.01 - Math.abs((far || mid).y - start.y) * 0.01;
          options.push({ from, mid, far, farUnreachedWalkable, score: southToNorthScore + horizontalLedgeScore + cliffScore + heightScore + distScore + noise2(mid.x, mid.y, 44387) });
        }
      });
      if (!options.length) break;
      options.sort((a, b) => b.score - a.score);
      const chosen = options[0];
      if (chosen.farUnreachedWalkable && chosen.mid.cliffSkirt) {
        markHiddenNavRampTile(chosen.mid, passId, 0.5, 'hiddenCliffLedgeStitch');
        hiddenTiles++;
        markPair(chosen.from, chosen.far, 'hiddenTwoStepCliffLedgeStitch');
      } else {
        markPair(chosen.from, chosen.mid, 'hiddenAdjacentHeightLedgeStitch');
      }
      passes++;
    }

    if (stitchedEdges) {
      map.hiddenNavRamps = map.hiddenNavRamps || [];
      map.hiddenNavRamps.push({
        id: passId,
        reason: 'final hidden reachability stitch; prefers south-to-north or horizontal ledge connections and is not exported as visible ramp geometry',
        stitchedEdges,
        hiddenTiles,
        passes,
        visible: false
      });
    }
    return { stitchedEdges, hiddenTiles, passes };
  }


  function forceHiddenReachabilitySweep(start, maxAttempts = 360) {
    const passId = `hidden_connectivity_sweep_${(map.hiddenNavRamps || []).length + 1}`;
    let attempts = 0;
    let connected = 0;
    let hiddenTiles = 0;
    let bridgeTiles = 0;
    let cleared = 0;
    let lastUnreachable = Infinity;

    while (attempts < maxAttempts) {
      const reached = reachableFrom(start);
      const unreachable = allWalkableTiles().filter(tile => !reached.has(keyXY(tile.x, tile.y)));
      if (!unreachable.length) break;
      if (unreachable.length >= lastUnreachable && attempts > 0 && attempts % 24 === 0) {
        // Keep trying other samples, but avoid spending forever on one sealed pocket.
        unreachable.sort((a, b) => noise2(b.x, b.y, 55421 + attempts) - noise2(a.x, a.y, 55421 + attempts));
      } else {
        unreachable.sort((a, b) => (Math.abs(a.x - start.x) + Math.abs(a.y - start.y)) - (Math.abs(b.x - start.x) + Math.abs(b.y - start.y)));
      }
      lastUnreachable = unreachable.length;
      const target = unreachable[0];
      const path = findGridPath(start, target, { allowWater: true, allowOccupied: true, allowCliffSkirt: true, allowHeight: true });
      if (!path) break;
      const pathCleared = clearBlockingObjectsOnPath(path);
      cleared += pathCleared;
      let pathHidden = 0;
      let pathBridges = 0;
      for (let i = 0; i < path.length; i++) {
        const tile = tileAt(path[i].x, path[i].y);
        if (!tile) continue;
        if (tile.water && !tile.navBridge && !tile.bridge) {
          tile.navBridge = true;
          pathBridges++;
        }
        const prev = i > 0 ? tileAt(path[i - 1].x, path[i - 1].y) : null;
        const next = i < path.length - 1 ? tileAt(path[i + 1].x, path[i + 1].y) : null;
        const prevDiff = prev ? Math.abs(tileHeight(tile) - tileHeight(prev)) : 0;
        const nextDiff = next ? Math.abs(tileHeight(tile) - tileHeight(next)) : 0;
        if (tile.cliffSkirt || prevDiff >= settings.rampMinDiff || nextDiff >= settings.rampMinDiff) {
          const before = !!tile.navRamp;
          markHiddenNavRampTile(tile, passId, path.length > 1 ? i / (path.length - 1) : 0, 'hiddenConnectivitySweep');
          if (!before) pathHidden++;
          if (prev && prevDiff >= settings.rampMinDiff) {
            const beforePrev = !!prev.navRamp;
            markHiddenNavRampTile(prev, passId, Math.max(0, (i - 1) / Math.max(1, path.length - 1)), 'hiddenConnectivitySweepEdge');
            if (!beforePrev) pathHidden++;
          }
          if (next && nextDiff >= settings.rampMinDiff) {
            const beforeNext = !!next.navRamp;
            markHiddenNavRampTile(next, passId, Math.min(1, (i + 1) / Math.max(1, path.length - 1)), 'hiddenConnectivitySweepEdge');
            if (!beforeNext) pathHidden++;
          }
        }
      }
      if (pathHidden || pathBridges || pathCleared) {
        markInvisiblePath(path, pathCleared && !pathHidden && !pathBridges ? 'forcedHiddenObjectClearingSweep' : 'forcedHiddenReachabilitySweep', null);
        hiddenTiles += pathHidden;
        bridgeTiles += pathBridges;
        connected++;
      } else {
        // Try a different component on the next pass instead of assuming the whole repair stage is exhausted.
        attempts++;
        continue;
      }
      attempts++;
    }

    if (connected || hiddenTiles || bridgeTiles) {
      map.hiddenNavRamps = map.hiddenNavRamps || [];
      map.hiddenNavRamps.push({
        id: passId,
        reason: 'last-resort hidden sweep to guarantee reachability without creating visible straight ramps',
        connectedPaths: connected,
        hiddenTiles,
        bridgeTiles,
        attempts,
        clearedBlockingObjects: cleared,
        visible: false
      });
    }
    return { connected, hiddenTiles, bridgeTiles, attempts, cleared };
  }


  function connectedWalkableComponents() {
    const walkable = allWalkableTiles();
    const unvisited = new Set(walkable.map(tileId));
    const components = [];
    while (unvisited.size) {
      const firstId = unvisited.values().next().value;
      unvisited.delete(firstId);
      const first = tileAt(firstId % settings.width, Math.floor(firstId / settings.width));
      const queue = first ? [first] : [];
      const tiles = [];
      const ids = new Set([firstId]);
      for (let i = 0; i < queue.length; i++) {
        const tile = queue[i];
        tiles.push(tile);
        for (const next of movementNeighbors(tile)) {
          const id = tileId(next);
          if (!unvisited.has(id)) continue;
          unvisited.delete(id);
          ids.add(id);
          queue.push(next);
        }
      }
      if (tiles.length) components.push({ tiles, ids, size: tiles.length });
    }
    components.sort((a, b) => b.size - a.size);
    return components;
  }

  function componentForTile(components, tile) {
    if (!tile) return null;
    const id = tileId(tile);
    return components.find(component => component.ids.has(id)) || null;
  }

  function representativeComponentTile(component, start) {
    let best = null;
    let bestScore = Infinity;
    const stride = Math.max(1, Math.floor(component.tiles.length / 160));
    for (let i = 0; i < component.tiles.length; i += stride) {
      const tile = component.tiles[i];
      const score = Math.abs(tile.x - start.x) + Math.abs(tile.y - start.y) + Math.abs(tile.elevation) * 0.35 + noise2(tile.x, tile.y, 61729) * 0.1;
      if (score < bestScore) { bestScore = score; best = tile; }
    }
    return best || component.tiles[0];
  }

  function sampleComponentTiles(component, limit = 180) {
    const stride = Math.max(1, Math.floor(component.tiles.length / limit));
    const sample = [];
    for (let i = 0; i < component.tiles.length; i += stride) sample.push(component.tiles[i]);
    return sample;
  }

  function bestComponentConnector(main, component) {
    const mainSample = sampleComponentTiles(main, 220);
    const targetSample = sampleComponentTiles(component, 160);
    let best = null;
    let bestScore = Infinity;
    for (const a of mainSample) {
      for (const b of targetSample) {
        const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (manhattan > bestScore + 8) continue;
        const heightDelta = Math.abs(tileHeight(a) - tileHeight(b));
        const high = tileHeight(a) >= tileHeight(b) ? a : b;
        const low = high === a ? b : a;
        const northRulePenalty = high.y > low.y ? 24 : 0;
        const horizontalBonus = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? -3 : 0;
        const score = manhattan + heightDelta * 2.5 + northRulePenalty + horizontalBonus + noise2(b.x, b.y, 61931) * 0.25;
        if (score < bestScore) { bestScore = score; best = { from: a, to: b, score }; }
      }
    }
    return best;
  }

  function repairReachabilityByComponents(start, maxPasses = 18) {
    let connectors = 0;
    let hiddenTiles = 0;
    let clearedObjects = 0;
    let remainingComponents = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      const components = connectedWalkableComponents();
      remainingComponents = components.length;
      if (components.length <= 1) break;
      const startTile = tileAt(start.x, start.y);
      const main = componentForTile(components, startTile) || components[0];
      const componentIdByTile = new Map();
      components.forEach((component, index) => {
        for (const id of component.ids) componentIdByTile.set(id, index);
      });
      const mainIndex = components.indexOf(main);
      const bestByTargetComponent = new Map();
      const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
      for (const from of main.tiles) {
        for (const dir of dirs) {
          const mid = tileAt(from.x + dir.x, from.y + dir.y);
          const far = tileAt(from.x + dir.x * 2, from.y + dir.y * 2);
          const pushOption = (targetTile, bridgeTile, reason) => {
            if (!targetTile || targetTile.borderEscarpment || (bridgeTile && bridgeTile.borderEscarpment) || !isWalkableTile(targetTile)) return;
            const targetComponentIndex = componentIdByTile.get(tileId(targetTile));
            if (targetComponentIndex === undefined || targetComponentIndex === mainIndex) return;
            const high = tileHeight(from) >= tileHeight(targetTile) ? from : targetTile;
            const low = high === from ? targetTile : from;
            const northPenalty = high.y > low.y ? 18 : 0;
            const horizontalBonus = dir.x !== 0 ? -4 : 0;
            const cliffBonus = bridgeTile && bridgeTile.cliffSkirt ? -5 : 0;
            const score = Math.abs(tileHeight(from) - tileHeight(targetTile)) * 2 + northPenalty + horizontalBonus + cliffBonus + noise2(targetTile.x, targetTile.y, 65101) * 0.25;
            const current = bestByTargetComponent.get(targetComponentIndex);
            if (!current || score < current.score) bestByTargetComponent.set(targetComponentIndex, { from, targetTile, bridgeTile, score, reason });
          };
          if (mid && isWalkableTile(mid)) pushOption(mid, null, 'hiddenAdjacentComponentFrontier');
          if (mid && !isWalkableTile(mid) && !mid.water && far && isWalkableTile(far)) pushOption(far, mid, 'hiddenTwoStepComponentFrontier');
        }
      }
      const options = [...bestByTargetComponent.values()].sort((a, b) => a.score - b.score).slice(0, 24);
      if (!options.length) break;
      const passId = `component_frontier_repair_${(map.hiddenNavRamps || []).length + 1}_${pass + 1}`;
      let passHidden = 0;
      for (const option of options) {
        const beforeFrom = !!option.from.navRamp;
        const beforeTarget = !!option.targetTile.navRamp;
        markHiddenNavRampTile(option.from, passId, 0.2, option.reason);
        markHiddenNavRampTile(option.targetTile, passId, 0.8, option.reason);
        passHidden += (!beforeFrom ? 1 : 0) + (!beforeTarget ? 1 : 0);
        if (option.bridgeTile) {
          const beforeBridge = !!option.bridgeTile.navRamp;
          markHiddenNavRampTile(option.bridgeTile, passId, 0.5, option.reason);
          passHidden += !beforeBridge ? 1 : 0;
        }
        markInvisiblePath([{ x: option.from.x, y: option.from.y }, ...(option.bridgeTile ? [{ x: option.bridgeTile.x, y: option.bridgeTile.y }] : []), { x: option.targetTile.x, y: option.targetTile.y }], option.reason, null);
        connectors++;
      }
      hiddenTiles += passHidden;
      if (passHidden) {
        map.hiddenNavRamps = map.hiddenNavRamps || [];
        map.hiddenNavRamps.push({
          id: passId,
          reason: 'component frontier reachability repair; hidden nav only, prefers horizontal/north-rule ledges',
          connectorEdges: options.length,
          hiddenTiles: passHidden,
          visible: false
        });
      }
    }
    return { connectors, hiddenTiles, clearedObjects, remainingComponents };
  }


  function sealResidualUnreachableTiles(unreachable, limit = 96) {
    if (!unreachable || !unreachable.length || unreachable.length > limit) return { sealed: 0, skipped: unreachable ? unreachable.length : 0 };
    let sealed = 0;
    const protectedIds = new Set((map.objects || [])
      .filter(object => ['structure', 'caveOpening', 'secretCaveOpening', 'animalDen'].includes(object.type))
      .map(object => object.id));
    for (const tile of unreachable) {
      if (!tile) continue;
      if (tile.occupiedBy && protectedIds.has(tile.occupiedBy)) continue;
      if (tile.water) {
        tile.navBridge = false;
        tile.bridge = false;
        tile.path = false;
        tile.invisiblePath = false;
        tile.invisiblePathId = null;
        sealed++;
        continue;
      }
      if (tile.ramp) continue;
      tile.cliffSkirt = true;
      tile.cliffSkirtKind = tile.borderEscarpment ? 'borderEscarpment' : 'sealedUnreachablePocket';
      tile.cliffFromTier = tile.elevation;
      tile.cliffToTier = Math.max(tile.elevation + 1, tileHeight(tile) + 1);
      tile.cliffFacing = tile.cliffFacing || { x: 0, y: -1 };
      tile.navRamp = false;
      tile.navRampId = null;
      tile.navRampProgress = null;
      tile.path = false;
      tile.invisiblePath = false;
      tile.invisiblePathId = null;
      tile.designReserve = true;
      tile.designRole = 'sealedUnreachablePocket';
      sealed++;
    }
    if (sealed) logDebug(`sealed residual unreachable pockets: ${sealed} tiny walkable tiles converted to inaccessible rock/water edge after hidden repair`);
    return { sealed, skipped: Math.max(0, unreachable.length - sealed) };
  }

  function validateAndRepairReachability() {
    const start = nearestFreeWalkableNeighbor(map.entry.x, map.entry.y);
    // new variable: dramaticRepairBudget caps the last-resort hidden repair passes that became too expensive when Cliffs introduced extreme height fragmentation.
    const dramaticRepairBudget = usesDramaticPlateauPreset();
    const componentRepair = repairReachabilityByComponents(start, dramaticRepairBudget ? 10 : 18);
    let clearedObjects = componentRepair.clearedObjects || 0;

    let finalReachable = reachableFrom(start);
    let finalWalkable = allWalkableTiles();
    let finalUnreachable = finalWalkable.filter(tile => !finalReachable.has(keyXY(tile.x, tile.y)));
    const hiddenStitch = finalUnreachable.length ? stitchReachabilityWithHiddenLedges(start, dramaticRepairBudget ? 140 : 420) : { stitchedEdges: 0, hiddenTiles: 0, passes: 0 };
    if (hiddenStitch.stitchedEdges) {
      finalReachable = reachableFrom(start);
      finalWalkable = allWalkableTiles();
      finalUnreachable = finalWalkable.filter(tile => !finalReachable.has(keyXY(tile.x, tile.y)));
      logDebug(`hidden ledge reachability stitch: ${hiddenStitch.stitchedEdges} connector edges, ${hiddenStitch.hiddenTiles} hidden nav-ramp tiles, remaining unreachable ${finalUnreachable.length}`);
    }
    const hiddenSweep = finalUnreachable.length ? forceHiddenReachabilitySweep(start, dramaticRepairBudget ? 80 : 220) : { connected: 0, hiddenTiles: 0, bridgeTiles: 0, attempts: 0, cleared: 0 };
    if (hiddenSweep.connected || hiddenSweep.hiddenTiles || hiddenSweep.bridgeTiles) {
      clearedObjects += hiddenSweep.cleared || 0;
      finalReachable = reachableFrom(start);
      finalWalkable = allWalkableTiles();
      finalUnreachable = finalWalkable.filter(tile => !finalReachable.has(keyXY(tile.x, tile.y)));
      logDebug(`hidden reachability sweep: ${hiddenSweep.connected} forced connector paths, ${hiddenSweep.hiddenTiles} hidden nav-ramp tiles, ${hiddenSweep.bridgeTiles} hidden bridge tiles, remaining unreachable ${finalUnreachable.length}`);
    }
    const sealedResidual = finalUnreachable.length ? sealResidualUnreachableTiles(finalUnreachable, dramaticRepairBudget ? 256 : 128) : { sealed: 0, skipped: 0 };
    if (sealedResidual.sealed) {
      finalReachable = reachableFrom(start);
      finalWalkable = allWalkableTiles();
      finalUnreachable = finalWalkable.filter(tile => !finalReachable.has(keyXY(tile.x, tile.y)));
    }
    map.connectivity = {
      start,
      walkableTiles: finalWalkable.length,
      reachableTiles: finalReachable.size,
      unreachableTiles: finalUnreachable.length,
      unreachableSamples: finalUnreachable.slice(0, 16).map(tile => ({ x: tile.x, y: tile.y, elevation: tile.elevation, water: tile.water, cliffSkirt: tile.cliffSkirt, occupiedBy: tile.occupiedBy })),
      repairs: componentRepair.connectors,
      componentRepairConnectors: componentRepair.connectors,
      componentRepairHiddenTiles: componentRepair.hiddenTiles,
      componentRepairRemainingComponents: componentRepair.remainingComponents,
      hiddenLedgeStitches: hiddenStitch.stitchedEdges,
      hiddenLedgeStitchTiles: hiddenStitch.hiddenTiles,
      hiddenSweepPaths: hiddenSweep.connected,
      hiddenSweepTiles: hiddenSweep.hiddenTiles,
      hiddenSweepBridgeTiles: hiddenSweep.bridgeTiles,
      sealedResidualUnreachableTiles: sealedResidual.sealed,
      clearedBlockingObjects: clearedObjects,
      invisiblePathCount: map.invisiblePaths.length,
      rule: 'Every tile counted here excludes water without a bridge, cliff-skirt wall tiles, and blocking objects. Component-frontier repairs use hidden nav ramps/bridges; visible ramps stay authored cliff ledges; tiny residual pockets beside border escarpments may be sealed into inaccessible rock so only genuinely traversable tiles are counted.'
    };
    if (finalUnreachable.length) {
      warn(`reachability: ${finalUnreachable.length} walkable tiles still unreachable after ${componentRepair.connectors} component repair connectors`);
    } else {
      logDebug(`reachability: all ${finalWalkable.length} walkable tiles reachable; component connectors ${componentRepair.connectors}, hidden tiles ${componentRepair.hiddenTiles}, blockers cleared ${clearedObjects}`);
    }
  }


  function keyXY(x, y) {
    return `${x},${y}`;
  }

  function tileIdXY(x, y) {
    return y * settings.width + x;
  }

  function tileId(tile) {
    return tile.y * settings.width + tile.x;
  }

  function distanceFieldFrom(start) {
    const fallbackStart = isWalkableTile(tileAt(start.x, start.y)) ? start : nearestFreeWalkableNeighbor(start.x, start.y);
    const origin = tileAt(fallbackStart.x, fallbackStart.y);
    const distances = new Map();
    const queue = [];
    if (origin && isWalkableTile(origin)) {
      distances.set(keyXY(origin.x, origin.y), 0);
      queue.push(origin);
    }
    for (let i = 0; i < queue.length; i++) {
      const tile = queue[i];
      const currentDistance = distances.get(keyXY(tile.x, tile.y)) || 0;
      for (const next of movementNeighbors(tile)) {
        const nextKey = keyXY(next.x, next.y);
        if (distances.has(nextKey)) continue;
        distances.set(nextKey, currentDistance + 1);
        queue.push(next);
      }
    }
    let maxDistance = 0;
    distances.forEach(value => { if (value > maxDistance) maxDistance = value; });
    return {
      start: origin ? { x: origin.x, y: origin.y } : { x: fallbackStart.x, y: fallbackStart.y },
      distances,
      maxDistance
    };
  }

  function orthogonalNeighbors(tile) {
    return [
      tileAt(tile.x + 1, tile.y),
      tileAt(tile.x - 1, tile.y),
      tileAt(tile.x, tile.y + 1),
      tileAt(tile.x, tile.y - 1)
    ].filter(Boolean);
  }

  function objectBlocksSight(object) {
    if (!object) return false;
    // NOTE: LOS blocking is intentionally narrower than movement blocking.
    // Dense tree copses, structures, boulders, statues, and pillars block sight; dens do not.
    return ['structure', 'undiggableBoulder', 'statue', 'submergedPillar', 'copse'].includes(object.type);
  }

  function buildSightBlockerKeyCache() {
    const blockerKeys = new Set(); // used by tileBlocksSight during hidden reward line-of-sight scoring.
    for (const object of map.objects) {
      if (!objectBlocksSight(object)) continue;
      const w = object.w || 1;
      const h = object.h || 1;
      for (let yy = object.y; yy < object.y + h; yy++) {
        for (let xx = object.x; xx < object.x + w; xx++) {
          if (inBounds(xx, yy)) blockerKeys.add(keyXY(xx, yy));
        }
      }
    }
    return blockerKeys;
  }

  function tileBlocksSight(tile, startKey, endKey) {
    if (!tile) return true;
    const tileKey = keyXY(tile.x, tile.y);
    if (tileKey === startKey || tileKey === endKey) return false;
    if (tile.ramp) return true;
    if (tile.cliffSkirt && tile.cliffSkirtKind === 'plateau' && !tile.waterfall) return true;
    if (sightBlockerKeyCache) return sightBlockerKeyCache.has(tileKey);
    const object = tile.occupiedBy ? getObjectById(tile.occupiedBy) : null;
    return objectBlocksSight(object);
  }

  function hasLineOfSight(x0, y0, x1, y1) {
    const startKey = keyXY(x0, y0);
    const endKey = keyXY(x1, y1);
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (!(x === x1 && y === y1)) {
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      const tile = tileAt(x, y);
      if (tileBlocksSight(tile, startKey, endKey)) return false;
    }
    return true;
  }

  function estimateVisibleObserverCount(candidate, distanceField, options = {}) {
    // NOTE: this is a local gameplay-facing LOS estimate, not a physically perfect vision sim.
    // It intentionally samples walkable observer tiles in a radius so reward placement stays useful on mobile.
    const radius = options.radius || 14;
    const maxSamples = options.maxSamples || 360;
    const observers = [];
    distanceField.distances.forEach((distance, key) => {
      const [sx, sy] = key.split(',').map(Number);
      const manhattan = Math.abs(sx - candidate.x) + Math.abs(sy - candidate.y);
      if (manhattan === 0 || manhattan > radius) return;
      observers.push({ x: sx, y: sy, distance });
    });
    observers.sort((a, b) => a.distance - b.distance);
    const sampled = observers.slice(0, maxSamples);
    let visible = 0;
    for (const observer of sampled) {
      if (hasLineOfSight(observer.x, observer.y, candidate.x, candidate.y)) visible++;
    }
    const sampleCount = sampled.length;
    const visibilityRatio = sampleCount ? visible / sampleCount : 1;
    return {
      visibleObserverCount: visible,
      observerSampleCount: sampleCount,
      visibilityRatio,
      concealmentScore: 1 - visibilityRatio
    };
  }

  function rewardTileBaseScore(tile, distanceField) {
    const distance = distanceField.distances.get(keyXY(tile.x, tile.y));
    if (distance == null) return null;
    const neighbors = orthogonalNeighbors(tile);
    const walkableNeighbors = movementNeighbors(tile).length;
    const nearCliff = neighbors.some(next => next.cliffSkirt || Math.abs(tileHeight(next) - tileHeight(tile)) >= settings.rampMinDiff);
    const nearWater = neighbors.some(next => next.water);
    const remoteness = distanceField.maxDistance > 0 ? distance / distanceField.maxDistance : 0;
    const seclusion = (4 - walkableNeighbors) / 4;
    let score = distance + remoteness * 16 + seclusion * 4;
    if (!tile.path) score += 2.4;
    if (!tile.invisiblePath) score += 1.2;
    if (tile.invisiblePath) score += 0.8;
    if (nearCliff) score += 1.5;
    if (nearWater) score += 0.7;
    if (tile.elevation >= 2) score += 0.9;
    return {
      x: tile.x,
      y: tile.y,
      distance,
      score,
      walkableNeighbors,
      nearCliff,
      nearWater,
      visibleObserverCount: null,
      observerSampleCount: null,
      visibilityRatio: null,
      concealmentScore: null,
      tile
    };
  }

  function buildHiddenRewardCandidates(distanceField) {
    const natural = [];
    const cave = [];
    for (const tile of allTiles()) {
      if (tile.water || tile.waterfall || tile.occupiedBy) continue;

      if (isWalkableTile(tile) && !tile.path && !tile.bridge && !tile.navBridge && !tile.ramp && !tile.cliffSkirt) {
        const base = rewardTileBaseScore(tile, distanceField);
        if (base) {
          if (tile.terrain === 'grass') base.score += 0.3;
          natural.push(base);
        }
      }

      if (tile.cliffSkirt && tile.cliffSkirtKind === 'plateau' && !tile.ramp && !tile.waterfall) {
        const anchor = nearestFreeWalkableNeighbor(tile.x, tile.y);
        const anchorDistance = distanceField.distances.get(keyXY(anchor.x, anchor.y));
        if (anchorDistance == null) continue;
        const facing = tile.cliffFacing || { x: 0, y: -1 };
        const frontFacingBonus = facing.y < 0 ? 2.2 : 0.6;
        const hiddenBonus = !tile.path && !tile.invisiblePath ? 1.5 : 0.4;
        const remoteness = distanceField.maxDistance > 0 ? anchorDistance / distanceField.maxDistance : 0;
        cave.push({
          x: tile.x,
          y: tile.y,
          anchor,
          distance: anchorDistance,
          score: anchorDistance + remoteness * 14 + frontFacingBonus + hiddenBonus + noise2(tile.x, tile.y, 9411),
          facing,
          visibleObserverCount: null,
          observerSampleCount: null,
          visibilityRatio: null,
          concealmentScore: null
        });
      }
    }

    natural.sort((a, b) => b.score - a.score);
    cave.sort((a, b) => b.score - a.score);

    // new variable: losBudgetScale keeps dramatic cliff presets responsive on mobile by scoring fewer hidden-reward sightlines while preserving candidate ordering.
    const losBudgetScale = usesDramaticPlateauPreset() ? 0.45 : 1;
    const naturalLosBudget = Math.min(natural.length, Math.max(28, Math.round((settings.treasure * 2 + settings.forage) * losBudgetScale)));
    const caveLosBudget = Math.min(cave.length, Math.max(18, Math.round(settings.caves * 10 * losBudgetScale)));
    const losMaxSamples = usesDramaticPlateauPreset() ? 48 : (settings.width * settings.height >= 9000 ? 96 : 160);
    for (let i = 0; i < naturalLosBudget; i++) {
      const candidate = natural[i];
      const los = estimateVisibleObserverCount(candidate, distanceField, { radius: 12, maxSamples: losMaxSamples });
      candidate.visibleObserverCount = los.visibleObserverCount;
      candidate.observerSampleCount = los.observerSampleCount;
      candidate.visibilityRatio = los.visibilityRatio;
      candidate.concealmentScore = los.concealmentScore;
      candidate.score += los.concealmentScore * 12 - los.visibilityRatio * 6;
    }

    for (let i = 0; i < caveLosBudget; i++) {
      const candidate = cave[i];
      const los = estimateVisibleObserverCount(candidate, distanceField, { radius: 12, maxSamples: losMaxSamples });
      candidate.visibleObserverCount = los.visibleObserverCount;
      candidate.observerSampleCount = los.observerSampleCount;
      candidate.visibilityRatio = los.visibilityRatio;
      candidate.concealmentScore = los.concealmentScore;
      candidate.score += los.concealmentScore * 13 - los.visibilityRatio * 7;
    }

    natural.sort((a, b) => b.score - a.score);
    cave.sort((a, b) => b.score - a.score);
    return { natural, cave, naturalLosBudget, caveLosBudget, losMaxSamples };
  }

  function selectSpacedCandidates(candidates, count, minSpacing, occupiedKeys = new Set()) {
    const chosen = [];
    for (const candidate of candidates) {
      const candidateKey = keyXY(candidate.x, candidate.y);
      if (occupiedKeys.has(candidateKey)) continue;
      const tooClose = chosen.some(other => Math.abs(other.x - candidate.x) + Math.abs(other.y - candidate.y) < minSpacing);
      if (tooClose) continue;
      chosen.push(candidate);
      occupiedKeys.add(candidateKey);
      if (chosen.length >= count) break;
    }
    return chosen;
  }

  function placeDifficultyRewards() {
    const distanceField = distanceFieldFrom(map.entry);
    sightBlockerKeyCache = buildSightBlockerKeyCache();
    const candidates = buildHiddenRewardCandidates(distanceField);
    sightBlockerKeyCache = null;
    const occupiedRewardKeys = new Set();
    const rewardPlacements = [];

    const treasureCount = clamp(Math.round(settings.treasure * 0.12), 2, 5);
    const herbCount = clamp(Math.round(settings.forage * 0.10), 2, 5);
    const secretCaveCount = clamp(Math.round(settings.caves * 0.35), 1, 3);

    const treasureChoices = selectSpacedCandidates(candidates.natural.filter(candidate => candidate.nearCliff || candidate.distance >= distanceField.maxDistance * 0.35), treasureCount, 6, occupiedRewardKeys);
    treasureChoices.forEach((choice, index) => {
      addObject(withRarity({
        type: 'treasureDigspot',
        x: choice.x,
        y: choice.y,
        w: 1,
        h: 1,
        blocksMovement: false,
        hiddenReward: true,
        hiddenRewardKind: 'remoteTreasure',
        difficultyScore: Number(choice.score.toFixed(2)),
        visibleObserverCount: choice.visibleObserverCount,
        observerSampleCount: choice.observerSampleCount,
        visibilityRatio: choice.visibilityRatio != null ? Number(choice.visibilityRatio.toFixed(3)) : null,
        rewardId: `hidden_treasure_${index + 1}`,
        note: 'yellow X intentionally placed on a difficult-to-reach tile with low local line-of-sight exposure'
      }, 'treasureDigspot', { hiddenReward: true }));
      rewardPlacements.push({ type: 'treasureDigspot', x: choice.x, y: choice.y, score: Number(choice.score.toFixed(2)), rarityPool: map.objects[map.objects.length - 1].rarityPool, visibleObserverCount: choice.visibleObserverCount, observerSampleCount: choice.observerSampleCount, visibilityRatio: choice.visibilityRatio != null ? Number(choice.visibilityRatio.toFixed(3)) : null });
    });

    const rareHerbChoices = selectSpacedCandidates(candidates.natural.filter(candidate => candidate.nearWater || candidate.nearCliff || candidate.tile.elevation >= 2), herbCount, 5, occupiedRewardKeys);
    const rareHerbKinds = ['moonleaf', 'sunspike', 'mistblossom', 'thornmint', 'amber sage'];
    rareHerbChoices.forEach((choice, index) => {
      addObject(withRarity({
        type: 'rareHerb',
        x: choice.x,
        y: choice.y,
        w: 1,
        h: 1,
        blocksMovement: false,
        hiddenReward: true,
        hiddenRewardKind: 'rareHerb',
        herbKind: rareHerbKinds[index % rareHerbKinds.length],
        color: colors.rareHerb,
        difficultyScore: Number(choice.score.toFixed(2)),
        visibleObserverCount: choice.visibleObserverCount,
        observerSampleCount: choice.observerSampleCount,
        visibilityRatio: choice.visibilityRatio != null ? Number(choice.visibilityRatio.toFixed(3)) : null,
        note: 'rare herb intentionally placed in a difficult-to-reach area with low local line-of-sight exposure'
      }, 'rareHerb'));
      rewardPlacements.push({ type: 'rareHerb', x: choice.x, y: choice.y, score: Number(choice.score.toFixed(2)), rarityPool: map.objects[map.objects.length - 1].rarityPool, visibleObserverCount: choice.visibleObserverCount, observerSampleCount: choice.observerSampleCount, visibilityRatio: choice.visibilityRatio != null ? Number(choice.visibilityRatio.toFixed(3)) : null });
    });

    const secretCaveChoices = selectSpacedCandidates(candidates.cave, secretCaveCount, 10, occupiedRewardKeys);
    secretCaveChoices.forEach((choice, index) => {
      const tile = tileAt(choice.x, choice.y);
      if (tile) tile.cliffSkirtKind = 'secretCave';
      addObject(withRarity({
        type: 'secretCaveOpening',
        x: choice.x,
        y: choice.y,
        w: 1,
        h: 1,
        blocksMovement: false,
        embeddedIn: 'cliffSkirt',
        hiddenReward: true,
        hiddenRewardKind: 'secretCave',
        caveId: `secret_cave_${index + 1}`,
        facing: choice.facing,
        pathAnchor: choice.anchor,
        difficultyScore: Number(choice.score.toFixed(2)),
        visibleObserverCount: choice.visibleObserverCount,
        observerSampleCount: choice.observerSampleCount,
        visibilityRatio: choice.visibilityRatio != null ? Number(choice.visibilityRatio.toFixed(3)) : null,
        note: 'secret cave opening placed on a remote cliff skirt with low local line-of-sight exposure'
      }, 'secretCaveOpening'));
      rewardPlacements.push({ type: 'secretCaveOpening', x: choice.x, y: choice.y, score: Number(choice.score.toFixed(2)), rarityPool: map.objects[map.objects.length - 1].rarityPool, visibleObserverCount: choice.visibleObserverCount, observerSampleCount: choice.observerSampleCount, visibilityRatio: choice.visibilityRatio != null ? Number(choice.visibilityRatio.toFixed(3)) : null });
    });

    map.rewardAnalysis = {
      start: distanceField.start,
      maxDistance: distanceField.maxDistance,
      naturalCandidateCount: candidates.natural.length,
      caveCandidateCount: candidates.cave.length,
      naturalLosBudget: candidates.naturalLosBudget,
      caveLosBudget: candidates.caveLosBudget,
      losMaxSamples: candidates.losMaxSamples,
      placements: rewardPlacements,
      counts: {
        treasureDigspot: treasureChoices.length,
        rareHerb: rareHerbChoices.length,
        secretCaveOpening: secretCaveChoices.length
      },
      rule: 'Hidden rewards are placed after reachability repair using actual travel distance, seclusion, route visibility, and local line-of-sight observer counts so hard-to-reach areas with fewer sightlines get treasure, rare herbs, or secret caves.'
    };
    logDebug(`hidden rewards: treasure ${treasureChoices.length}, rare herbs ${rareHerbChoices.length}, secret caves ${secretCaveChoices.length}`);
  }

  function countObjects(type, predicate = null) {
    return map.objects.filter(o => o.type === type && (!predicate || predicate(o))).length;
  }

  function placeRepeated(type, count, options) {
    let placed = 0;
    const maxTries = Math.max(300, count * 40);
    for (let tries = 0; tries < maxTries && placed < count; tries++) {
      const dims = typeof options.dims === 'function' ? options.dims() : (options.dims || { w: 1, h: 1 });
      const spot = randomFreeArea(dims.w, dims.h, options.areaOptions || {}, 1);
      if (!spot) continue;
      const object = typeof options.make === 'function'
        ? options.make(spot.x, spot.y, dims.w, dims.h, placed)
        : { type, x: spot.x, y: spot.y, w: dims.w, h: dims.h };
      addObject(object);
      placed++;
    }
    if (placed < count) warn(`${type}: placed ${placed}/${count}`);
    logDebug(`${type}: placed ${placed}/${count}`);
  }

  function placeLogsAndStumps() {
    // new variable: placedLogLikeCount tracks the shared fallen-log/stump control total.
    let placedLogLikeCount = 0;
    // new variable: fallenLogCount is used for the mobile debug summary.
    let fallenLogCount = 0;
    // new variable: stumpCount is used for the mobile debug summary.
    let stumpCount = 0;
    const maxTries = Math.max(300, settings.logs * 40);

    for (let tries = 0; tries < maxTries && placedLogLikeCount < settings.logs; tries++) {
      const dims = chance(0.65)
        ? (chance(0.5) ? { w: 2, h: 1 } : { w: 1, h: 2 })
        : { w: 1, h: 1 };
      const spot = randomFreeArea(dims.w, dims.h, { filter: (x, y, w, h) => areaElevationSpread(x, y, w, h) <= 1 }, 1);
      if (!spot) continue;

      const isStump = dims.w === 1 && dims.h === 1;
      addObject({
        type: isStump ? 'stump' : 'fallenLog',
        x: spot.x,
        y: spot.y,
        w: dims.w,
        h: dims.h,
        blocksMovement: true,
        note: isStump ? 'brown cut stump, one tile' : 'brown fallen log rectangle, two tiles'
      });

      placedLogLikeCount++;
      if (isStump) stumpCount++;
      else fallenLogCount++;
    }

    if (placedLogLikeCount < settings.logs) warn(`fallenLog/stump: placed ${placedLogLikeCount}/${settings.logs}`);
    logDebug(`fallenLog/stump: placed ${placedLogLikeCount}/${settings.logs} (${fallenLogCount} logs, ${stumpCount} stumps)`);
  }

  // In the live game every one of these object types renders its tile as a
  // 'shrub' overlay (see hobunjiOverlayTypeForObject below), and in Northern
  // Cliffs / the Southern Cloud Forest a 'shrub' tile grows into a full-size
  // tree (crowned pine / shadewood — see FoliageGenerator), not a small prop.
  // So a copse tile touching a fruitBush/beehive/etc (even diagonally) is
  // just as much a tree-overlap as two copse tiles touching. Shared by
  // placeCopses/placeFloraAndResources/placeAnimalFoodSources below.
  const TREE_LIKE_OBJECT_TYPES = new Set(['copse', 'bush', 'fruitBush', 'mushroomPatch', 'beehive']);

  // Keep a full ring of non-tree tiles around every placed tree: checked
  // against both already-committed tree-like objects (tile.occupiedBy, set
  // by addObject/markOccupied) and an optional extraKeys set of positions
  // not yet committed (copse grows a whole cluster via BFS before calling
  // addObject on any of it — occupiedBy isn't set until the cluster is
  // done, so without extraKeys a cluster could otherwise pack its own tiles
  // right next to each other).
  function hasNearbyTreeObject(x, y, extraKeys) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const key = `${x + dx},${y + dy}`;
        if (extraKeys && extraKeys.has(key)) return true;
        const neighborTile = tileAt(x + dx, y + dy);
        if (!neighborTile || !neighborTile.occupiedBy) continue;
        const neighborObject = getObjectById(neighborTile.occupiedBy);
        if (neighborObject && TREE_LIKE_OBJECT_TYPES.has(neighborObject.type)) return true;
      }
    }
    return false;
  }

  function placeCopses() {
    // NOTE: copse tiles are a simplified proxy for denser forest spawning in the larger game.
    // The duplicate game should spawn slightly more trees than copse tiles where room allows,
    // so the map keeps a readable tile plan without pretending to be exact tree placement.
    const targetCopseTiles = settings.trees;
    let placedCopseTiles = 0;
    let copseClusterCount = 0;
    let shadowCopseTiles = 0;
    const maxClusterAttempts = Math.max(200, targetCopseTiles * 7);

    function copseEligible(x, y, clusterKeys) {
      const tile = tileAt(x, y);
      if (!tile) return false;
      if (tile.water || tile.river || tile.path || tile.ramp || tile.cliffSkirt || tile.waterfall) return false;
      if (tile.occupiedBy) return false;
      if (hasNearbyTreeObject(x, y, clusterKeys)) return false;
      return true;
    }

    function southFacingCliffShadowScore(x, y) {
      const tile = tileAt(x, y);
      if (!tile || !copseEligible(x, y)) return 0;
      let score = 0;
      // South-facing cliff shadow = this copse sits south/downscreen of a raised cliff face.
      const north = tileAt(x, y - 1);
      const north2 = tileAt(x, y - 2);
      const nw = tileAt(x - 1, y - 1);
      const ne = tileAt(x + 1, y - 1);
      if (north && north.cliffSkirt && north.cliffFacing && north.cliffFacing.y < 0) score += 12;
      if (north && north.elevation > tile.elevation && !north.ramp) score += 9 + Math.min(5, north.elevation - tile.elevation);
      if (north2 && north2.elevation > tile.elevation && !north2.ramp) score += 5;
      if (nw && nw.elevation > tile.elevation) score += 2;
      if (ne && ne.elevation > tile.elevation) score += 2;
      if (tile.y > settings.height * 0.46) score += 1.5; // shadows read better on the lower/southern half.
      return score;
    }

    for (let attempts = 0; attempts < maxClusterAttempts && placedCopseTiles < targetCopseTiles; attempts++) {
      const eligibleStarts = allTiles().filter(tile => copseEligible(tile.x, tile.y));
      if (!eligibleStarts.length) break;
      const weightedStarts = eligibleStarts.map(tile => {
        const shadowScore = southFacingCliffShadowScore(tile.x, tile.y);
        return { value: tile, weight: 1 + shadowScore * shadowScore * 0.9 + noise2(tile.x, tile.y, 44119) * 0.4 };
      });
      const startTile = weightedPick(weightedStarts);
      const start = { x: startTile.x, y: startTile.y };

      const remaining = targetCopseTiles - placedCopseTiles;
      const startShadowScore = southFacingCliffShadowScore(start.x, start.y);
      const desiredSize = Math.min(remaining, startShadowScore > 0 ? randInt(4, 11) : randInt(3, 7));
      const clusterId = `copse_${copseClusterCount + 1}`;
      const queue = [{ x: start.x, y: start.y }];
      const seen = new Set([`${start.x},${start.y}`]);
      const chosen = [];
      // Mirrors `chosen`, but as a key set for hasNearbyTreeObject's O(1) lookups —
      // needed because a tile only gets tile.occupiedBy (and so shows up to
      // copseEligible via that path) once the whole cluster finishes below;
      // without this a cluster could still pack its own tiles next to each
      // other while it's still being grown.
      const chosenKeys = new Set();
      // Once a tile is chosen, every tile touching it (distance 1, the ring
      // hasNearbyTreeObject now blocks) can never be chosen for this cluster — so
      // only the next ring out (distance exactly 2) is worth queueing as a
      // real candidate; still packs as tightly as the spacing rule allows,
      // just skips straight past the ring that's guaranteed to fail.
      const RING2_OFFSETS = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) RING2_OFFSETS.push([dx, dy]);
        }
      }

      while (queue.length && chosen.length < desiredSize) {
        queue.sort((a, b) => (southFacingCliffShadowScore(b.x, b.y) + noise2(b.x, b.y, 94411) * 0.25) - (southFacingCliffShadowScore(a.x, a.y) + noise2(a.x, a.y, 94411) * 0.25));
        const candidate = queue.shift();
        if (!copseEligible(candidate.x, candidate.y, chosenKeys)) continue;
        chosen.push(candidate);
        chosenKeys.add(`${candidate.x},${candidate.y}`);

        const sourceTile = tileAt(candidate.x, candidate.y);
        shuffle(RING2_OFFSETS).forEach(([dx, dy]) => {
          const nx = candidate.x + dx;
          const ny = candidate.y + dy;
          const key = `${nx},${ny}`;
          if (seen.has(key)) return;
          seen.add(key);
          const nextTile = tileAt(nx, ny);
          if (!nextTile) return;
          if (Math.abs(nextTile.elevation - sourceTile.elevation) > 1) return;
          if (!copseEligible(nx, ny, chosenKeys)) return;
          const shadowScore = southFacingCliffShadowScore(nx, ny);
          if (!shadowScore && startShadowScore > 0 && chance(0.42)) return;
          queue.push({ x: nx, y: ny });
        });
      }

      if (!chosen.length) continue;
      copseClusterCount++;
      const recommendedTreeCount = Math.max(chosen.length + 1, Math.round(chosen.length * 1.2));
      chosen.forEach(({ x, y }) => {
        const shadowScore = southFacingCliffShadowScore(x, y);
        if (shadowScore > 0) shadowCopseTiles++;
        addObject({
          type: 'copse',
          x,
          y,
          w: 1,
          h: 1,
          copseId: clusterId,
          blocksMovement: false,
          recommendedTreeCount,
          shadowSouthFacingCliffScore: shadowScore ? Number(shadowScore.toFixed(2)) : undefined,
          note: shadowScore > 0
            ? 'copse tile: simplified dense-tree zone marker biased to the shadow below a south-facing cliff; draw as two small brown circles on the tile diagonal'
            : 'copse tile: simplified dense-tree zone marker; draw as two small brown circles on the tile diagonal'
        });
        placedCopseTiles++;
      });
    }

    if (placedCopseTiles < targetCopseTiles) warn(`copse: placed ${placedCopseTiles}/${targetCopseTiles} tiles`);
    logDebug(`copse: placed ${placedCopseTiles}/${targetCopseTiles} tiles across ${copseClusterCount} clusters, south-facing cliff-shadow tiles ${shadowCopseTiles}`);
  }

  function placeFloraAndResources() {
    placeCopses();

    placeLogsAndStumps();

    placeRepeated('bush', settings.bushes, {
      // Renders as a full tree in tree zones too (see TREE_LIKE_OBJECT_TYPES) — same spacing rule as copse.
      areaOptions: { filter: (x, y) => !hasNearbyTreeObject(x, y) },
      make: (x, y) => ({ type: 'bush', x, y, w: 1, h: 1, blocksMovement: true, note: 'bright green star' })
    });

    placeRepeated('foragePlant', settings.forage, {
      make: (x, y, w, h, index) => withRarity({
        type: 'foragePlant',
        x,
        y,
        w: 1,
        h: 1,
        forageId: `wild_forage_${index + 1}`,
        color: pick(foragePalette),
        blocksMovement: false,
        note: 'colored star, forageable, with rarity-pool superscript marker'
      }, 'foragePlant')
    });

    placeRepeated('treasureDigspot', settings.treasure, {
      areaOptions: { allowPath: true, filter: (x, y) => !tileAt(x, y).water },
      make: (x, y) => withRarity({ type: 'treasureDigspot', x, y, w: 1, h: 1, blocksMovement: false, note: 'yellow X with rarity-pool superscript marker' }, 'treasureDigspot')
    });

    placeRepeated('diggableRockOre', settings.ore, {
      make: (x, y) => {
        const oreKind = pick(oreKinds);
        return withRarity({
          type: 'diggableRockOre',
          x,
          y,
          w: 1,
          h: 1,
          oreKind,
          blocksMovement: true,
          note: 'light gray hexagon, one tile, with rarity-pool superscript marker'
        }, 'diggableRockOre', { oreKind });
      }
    });

    placeRepeated('undiggableBoulder', settings.boulders, {
      dims: () => {
        const wide = chance(0.48);
        return wide ? { w: randInt(1, 3), h: randInt(1, 2) } : { w: randInt(1, 2), h: randInt(1, 3) };
      },
      areaOptions: { filter: (x, y, w, h) => areaElevationSpread(x, y, w, h) <= 2 },
      make: (x, y, w, h) => ({ type: 'undiggableBoulder', x, y, w, h, blocksMovement: true, note: 'dark gray multi-tile hexagon' })
    });
  }


  function placeAnimalFoodSources() {
    placeRepeated('fruitBush', settings.fruitBushes, {
      areaOptions: {
        // Renders as a full tree in tree zones too (see TREE_LIKE_OBJECT_TYPES) — same spacing rule as copse.
        filter: (x, y) => {
          const tile = tileAt(x, y);
          return tile && !tile.water && !tile.path && !tile.ramp && !tile.cliffSkirt && areaElevationSpread(x, y, 1, 1) <= 0 && !hasNearbyTreeObject(x, y);
        }
      },
      make: (x, y, w, h, index) => ({
        type: 'fruitBush',
        x,
        y,
        w: 1,
        h: 1,
        foodRole: 'fruit',
        foodId: `fruit_bush_${index + 1}`,
        blocksMovement: false,
        note: 'fruit bush target for prey and omnivore grazing routes'
      })
    });

    placeRepeated('mushroomPatch', settings.mushrooms, {
      areaOptions: {
        // Used to get a bonus for growing right next to a copse tile, but a
        // copse tile is now a full tree (see TREE_LIKE_OBJECT_TYPES) — right
        // next to one is exactly what the spacing rule below forbids, so
        // that bonus can never actually apply anymore; falls back to its
        // other two conditions (elevated ground / plain noise scatter).
        filter: (x, y) => {
          const tile = tileAt(x, y);
          return tile && !tile.water && !tile.path && !tile.ramp && !tile.cliffSkirt && (tile.elevation >= 1 || noise2(x, y, 7137) > 0.52) && !hasNearbyTreeObject(x, y);
        }
      },
      make: (x, y, w, h, index) => ({
        type: 'mushroomPatch',
        x,
        y,
        w: 1,
        h: 1,
        foodRole: 'mushroom',
        foodId: `mushroom_patch_${index + 1}`,
        blocksMovement: false,
        note: 'mushroom patch target for prey and omnivore routes'
      })
    });

    placeRepeated('beehive', settings.beehives, {
      areaOptions: {
        // Used to get a bonus for hiving right next to a copse tile, but a
        // copse tile is now a full tree (see TREE_LIKE_OBJECT_TYPES) — right
        // next to one is exactly what the spacing rule below forbids, so
        // that bonus can never actually apply anymore; falls back to its
        // plain noise scatter.
        filter: (x, y) => {
          const tile = tileAt(x, y);
          if (!tile || tile.water || tile.path || tile.ramp || tile.cliffSkirt) return false;
          return noise2(x, y, 8129) > 0.72 && !hasNearbyTreeObject(x, y);
        }
      },
      make: (x, y, w, h, index) => ({
        type: 'beehive',
        x,
        y,
        w: 1,
        h: 1,
        foodRole: 'hive',
        foodId: `beehive_${index + 1}`,
        blocksMovement: false,
        note: 'beehive target for prey curiosity and omnivore routes'
      })
    });
  }

  function objectsOfTypes(types) {
    const typeSet = new Set(types);
    return map.objects.filter(object => typeSet.has(object.type));
  }

  function objectAnchor(object) {
    if (!object) return nearestFreeWalkableNeighbor(map.entry.x, map.entry.y);
    if (object.escapeAnchor) return { ...object.escapeAnchor };
    if (object.pathAnchor) return { ...object.pathAnchor };
    return nearestFreeWalkableNeighbor(object.x + Math.floor((object.w || 1) / 2), object.y + Math.floor((object.h || 1) / 2));
  }

  function animalPathBetween(start, goal) {
    const safeStart = nearestFreeWalkableNeighbor(start.x, start.y);
    const safeGoal = nearestFreeWalkableNeighbor(goal.x, goal.y);
    return findGridPath(safeStart, safeGoal, { allowWater: false })
      || findGridPath(safeStart, safeGoal, { allowWater: true })
      || findGridPath(safeStart, safeGoal, { allowWater: true, allowCliffSkirt: true, allowHeight: true })
      || [safeStart, safeGoal];
  }

  function foodTargetsForPrey() {
    return objectsOfTypes(['fruitBush', 'mushroomPatch', 'beehive', 'foragePlant', 'rareHerb']);
  }

  function fruitHiveTargets() {
    return objectsOfTypes(['fruitBush', 'beehive']);
  }

  function fishingTargets() {
    const result = [];
    for (const tile of allWalkableTiles()) {
      if (tile.path || tile.ramp) continue;
      const wetNeighbor = orthogonalNeighbors(tile).find(next => next.water);
      if (!wetNeighbor) continue;
      result.push({
        type: 'fishingSpot',
        x: tile.x,
        y: tile.y,
        w: 1,
        h: 1,
        foodRole: 'fish',
        score: noise2(tile.x, tile.y, 6091)
      });
    }
    return result.sort((a, b) => b.score - a.score).slice(0, 40);
  }

  function ambushTargets() {
    const result = [];
    for (const tile of allWalkableTiles()) {
      if (tile.path || tile.water || tile.ramp) continue;
      const nearRoute = orthogonalNeighbors(tile).some(next => next.path || next.invisiblePath || next.denRoute);
      const nearFood = orthogonalNeighbors(tile).some(next => {
        const object = next.occupiedBy ? getObjectById(next.occupiedBy) : null;
        return object && ['fruitBush', 'mushroomPatch', 'beehive', 'foragePlant', 'rareHerb'].includes(object.type);
      });
      const cover = orthogonalNeighbors(tile).some(next => next.cliffSkirt || next.ramp || (() => {
        const object = next.occupiedBy ? getObjectById(next.occupiedBy) : null;
        return object && ['copse', 'undiggableBoulder', 'statue', 'structure'].includes(object.type);
      })());
      if (!nearRoute && !nearFood) continue;
      result.push({ x: tile.x, y: tile.y, score: (cover ? 3 : 0) + (nearFood ? 2 : 0) + noise2(tile.x, tile.y, 9055) });
    }
    return result.sort((a, b) => b.score - a.score).slice(0, 60);
  }

  // Groups placeCopses()'s per-tile 'copse' objects (each stamped with a
  // shared copseId) back into one foliage-patch record per cluster, for
  // consumers that need a patch as a whole rather than the lossy per-tile
  // tile-overlay fold (see hobunjiObjectOverlayByTile) — the wildlife
  // schedule AI's herbivore grazing/predator ambush stations, in particular.
  // "Rich" patches (dense enough to be worth ambushing) are the ones a
  // predator gets an ambush station for; thin patches are grazing-only.
  const RICH_FOLIAGE_TREE_COUNT_THRESHOLD = 9;
  function buildFoliagePatches() {
    const byId = new Map();
    for (const object of map.objects) {
      if (object.type !== 'copse') continue;
      let patch = byId.get(object.copseId);
      if (!patch) { patch = { id: object.copseId, tiles: [], recommendedTreeCount: object.recommendedTreeCount || 0 }; byId.set(object.copseId, patch); }
      // Each copse object's own w/h (>1x1 once scaleGeneratedTileDensity has
      // run — see scaleGeneratedObject) is its actual final-resolution
      // footprint, not just its top-left cell.
      const ow = object.w || 1, oh = object.h || 1;
      for (let dy = 0; dy < oh; dy++) for (let dx = 0; dx < ow; dx++) patch.tiles.push({ x: object.x + dx, y: object.y + dy });
      patch.recommendedTreeCount = Math.max(patch.recommendedTreeCount, object.recommendedTreeCount || 0);
    }
    return [...byId.values()].map(patch => {
      const cx = Math.round(patch.tiles.reduce((sum, t) => sum + t.x, 0) / patch.tiles.length);
      const cy = Math.round(patch.tiles.reduce((sum, t) => sum + t.y, 0) / patch.tiles.length);
      return {
        id: patch.id,
        tiles: patch.tiles,
        centroid: { x: cx, y: cy },
        rich: patch.recommendedTreeCount >= RICH_FOLIAGE_TREE_COUNT_THRESHOLD
      };
    });
  }

  // For each rich foliage patch, a handful of nearby (not inside it — that's
  // where herbivores graze) walkable tiles for a predator to stake out as an
  // ambush station, scored with the same cover-nearby heuristic ambushTargets()
  // uses, biased toward the patch's immediate ring rather than its full
  // reachable neighborhood, and spread apart so stations don't all cluster
  // on one favored tile.
  function buildAmbushStations(foliagePatches) {
    const stationsByPatch = [];
    for (const patch of foliagePatches) {
      if (!patch.rich) continue;
      const patchTileSet = new Set(patch.tiles.map(t => `${t.x},${t.y}`));
      const seen = new Set();
      const candidates = [];
      for (const anchor of patch.tiles) {
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const nx = anchor.x + dx, ny = anchor.y + dy;
          const key = `${nx},${ny}`;
          if (patchTileSet.has(key) || seen.has(key)) continue;
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          if (dist < 1 || dist > 3) continue;
          const tile = tileAt(nx, ny);
          if (!isWalkableTile(tile) || tile.water || tile.path) continue;
          seen.add(key);
          const cover = orthogonalNeighbors(tile).some(next => next.cliffSkirt || next.ramp || (() => {
            const object = next.occupiedBy ? getObjectById(next.occupiedBy) : null;
            return object && ['copse', 'undiggableBoulder', 'statue', 'structure'].includes(object.type);
          })());
          candidates.push({ x: nx, y: ny, score: (cover ? 3 : 0) + (4 - dist) + noise2(nx, ny, 27751) });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const picked = [];
      for (const c of candidates) {
        if (picked.some(p => Math.abs(p.x - c.x) <= 1 && Math.abs(p.y - c.y) <= 1)) continue;
        picked.push({ x: c.x, y: c.y });
        if (picked.length >= 4) break;
      }
      if (picked.length) stationsByPatch.push({ patchId: patch.id, points: picked });
    }
    return stationsByPatch;
  }

  function makeAnimalRoute(agentId, behavior, denAnchor, targets, options = {}) {
    const segments = [];
    const routeStops = [];
    let current = { ...denAnchor };
    const denDwell = options.denDwellMinutes || 8;
    const targetDwell = options.targetDwellMinutes || 15;
    const tileMinutes = options.tileMinutes || 1.2;

    segments.push({ kind: 'dwell', at: { ...denAnchor }, durationMinutes: denDwell, label: 'den rest' });
    routeStops.push({ kind: 'den', x: denAnchor.x, y: denAnchor.y, dwellMinutes: denDwell });

    for (const target of targets) {
      const anchor = objectAnchor(target);
      const outPath = animalPathBetween(current, anchor);
      segments.push({ kind: 'travel', path: outPath, durationMinutes: Math.max(2, outPath.length * tileMinutes), label: target.activity || behavior });
      segments.push({ kind: 'dwell', at: { x: anchor.x, y: anchor.y }, durationMinutes: targetDwell, label: target.activity || behavior });
      routeStops.push({ kind: target.type || 'target', x: anchor.x, y: anchor.y, targetId: target.id || target.foodId || null, foodRole: target.foodRole || null, dwellMinutes: targetDwell, activity: target.activity || behavior });

      const backPath = animalPathBetween(anchor, denAnchor);
      segments.push({ kind: 'travel', path: backPath, durationMinutes: Math.max(2, backPath.length * tileMinutes), label: 'return to den' });
      segments.push({ kind: 'dwell', at: { ...denAnchor }, durationMinutes: denDwell, label: 'den rest' });
      current = { ...denAnchor };
    }

    const cycleMinutes = segments.reduce((sum, segment) => sum + segment.durationMinutes, 0) || 1;
    return { id: `${agentId}_route`, behavior, cycleMinutes: Number(cycleMinutes.toFixed(2)), segments, routeStops };
  }

  function createAnimalAgent(kind, index, den, targets, options = {}) {
    const denAnchor = objectAnchor(den);
    const route = makeAnimalRoute(`${kind}_${index + 1}`, options.behavior || kind, denAnchor, targets, options);
    return {
      id: `${kind}_${index + 1}`,
      kind,
      symbol: options.symbol,
      color: options.color,
      packId: options.packId || null,
      denId: den ? den.id : null,
      denAnchor,
      behavior: options.behavior || kind,
      phaseOffsetMinutes: Number(((index * 7 + noise2(index, denAnchor.x, 4451) * route.cycleMinutes) % route.cycleMinutes).toFixed(2)),
      route
    };
  }

  function pickRotatingTargets(source, count, salt) {
    if (!source.length) return [];
    const shuffled = source.slice().sort((a, b) => noise2(a.x || 0, a.y || 0, salt) - noise2(b.x || 0, b.y || 0, salt));
    const result = [];
    for (let i = 0; i < count; i++) result.push(shuffled[i % shuffled.length]);
    return result;
  }

  function buildAnimalActivity() {
    const dens = objectsOfTypes(['animalDen']);
    const agents = [];
    const routes = [];
    const foodTargets = foodTargetsForPrey();
    const fruitHive = fruitHiveTargets();
    const fish = fishingTargets();
    const ambush = ambushTargets();
    if (!dens.length) {
      map.animalActivity = { agents: [], routes: [], resources: [], rule: 'No dens were available, so live animal routes were skipped.' };
      return;
    }

    for (let i = 0; i < settings.prey; i++) {
      const den = dens[i % dens.length];
      const targets = pickRotatingTargets(foodTargets, 2 + (i % 2), 3000 + i).map(target => ({ ...target, activity: target.foodRole === 'mushroom' ? 'look for mushrooms' : target.foodRole === 'hive' ? 'inspect beehive' : 'graze fruit/forage' }));
      const agent = createAnimalAgent('prey', i, den, targets, { symbol: '○', color: colors.preyAnimal, behavior: 'graze/forage', targetDwellMinutes: 15, tileMinutes: 1.35 });
      agents.push(agent); routes.push(agent.route);
    }

    const preyTargets = agents.filter(agent => agent.kind === 'prey').flatMap(agent => agent.route.routeStops.filter(stop => stop.kind !== 'den').map(stop => ({ ...stop, type: 'preyTrail', activity: 'hunt prey trail' })));
    for (let i = 0; i < settings.packPredators; i++) {
      const den = dens[(i + 1) % dens.length];
      const targets = pickRotatingTargets(preyTargets, 2, 4000 + i);
      const agent = createAnimalAgent('packPredator', i, den, targets, { symbol: '▲', color: colors.packPredator, behavior: 'pack hunt prey', packId: `pack_${Math.floor(i / 3) + 1}`, targetDwellMinutes: 10, tileMinutes: 1.05 });
      agents.push(agent); routes.push(agent.route);
    }

    for (let i = 0; i < settings.ambushPredators; i++) {
      const den = dens[(i + 2) % dens.length];
      const targets = pickRotatingTargets(ambush, 1, 5000 + i).map(target => ({ ...target, type: 'ambushPoint', activity: 'wait in ambush' }));
      const agent = createAnimalAgent('ambushPredator', i, den, targets, { symbol: '◆', color: colors.ambushPredator, behavior: 'solo ambush', targetDwellMinutes: 45, denDwellMinutes: 12, tileMinutes: 1.15 });
      agents.push(agent); routes.push(agent.route);
    }

    for (let i = 0; i < settings.omnivores; i++) {
      const den = dens[(i + 3) % dens.length];
      const targets = [];
      targets.push(...pickRotatingTargets(fish, 1, 6000 + i).map(target => ({ ...target, activity: 'fish at water edge' })));
      targets.push(...pickRotatingTargets(fruitHive, 1, 7000 + i).map(target => ({ ...target, activity: target.foodRole === 'hive' ? 'look for hive' : 'look for berries' })));
      targets.push(...pickRotatingTargets(preyTargets, 1, 8000 + i).map(target => ({ ...target, activity: 'fight prey if attacked' })));
      const agent = createAnimalAgent('omnivore', i, den, targets, { symbol: '⬢', color: colors.omnivore, behavior: 'omnivore forage/fish/defend', targetDwellMinutes: 15, denDwellMinutes: 14, tileMinutes: 1.25 });
      agents.push(agent); routes.push(agent.route);
    }

    map.animalActivity = {
      agents,
      routes,
      resources: objectsOfTypes(['fruitBush', 'mushroomPatch', 'beehive']).map(object => ({ id: object.id, type: object.type, x: object.x, y: object.y, foodRole: object.foodRole })),
      gameMinuteScale: '1 real second = 15 simulated minutes in the live overlay',
      grazeCycleMinutes: 15,
      rules: [
        'Prey move from dens to fruit bushes, mushrooms, beehives, and forage, then graze/inspect for 15 simulated minutes before choosing another target.',
        'Pack predators use prey route stops as hunting targets and travel in pack-colored triangle symbols.',
        'Ambush predators move alone to route/food-adjacent cover and wait there longer than other animals.',
        'Omnivores are bear-like: they fish, look for berries and hives, and visit prey-trail conflict points defensively.'
      ]
    };
    logDebug(`animal activity: ${agents.length} live symbols, ${routes.length} routes, ${map.animalActivity.resources.length} food-source targets`);
  }

  function animalPositionAt(agent, gameMinutes) {
    const route = agent.route;
    if (!route || !route.segments.length) return { x: agent.denAnchor.x + 0.5, y: agent.denAnchor.y + 0.5, label: 'idle' };
    let minute = (gameMinutes + agent.phaseOffsetMinutes) % route.cycleMinutes;
    for (const segment of route.segments) {
      if (minute > segment.durationMinutes) {
        minute -= segment.durationMinutes;
        continue;
      }
      if (segment.kind === 'dwell') return { x: segment.at.x + 0.5, y: segment.at.y + 0.5, label: segment.label };
      const path = segment.path || [];
      if (!path.length) return { x: agent.denAnchor.x + 0.5, y: agent.denAnchor.y + 0.5, label: segment.label };
      const t = segment.durationMinutes > 0 ? clamp(minute / segment.durationMinutes, 0, 1) : 0;
      const scaled = t * Math.max(0, path.length - 1);
      const idx = Math.floor(scaled);
      const nextIdx = Math.min(path.length - 1, idx + 1);
      const local = scaled - idx;
      const a = path[idx];
      const b = path[nextIdx];
      return { x: a.x + (b.x - a.x) * local + 0.5, y: a.y + (b.y - a.y) * local + 0.5, label: segment.label };
    }
    return { x: agent.denAnchor.x + 0.5, y: agent.denAnchor.y + 0.5, label: 'idle' };
  }

  function areaElevationSpread(x, y, w, h) {
    let min = Infinity;
    let max = -Infinity;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const elevation = tileAt(xx, yy).elevation;
        min = Math.min(min, elevation);
        max = Math.max(max, elevation);
      }
    }
    return max - min;
  }

  function waterTiles() {
    return allTiles().filter(t => t.water && !t.occupiedBy && !t.cliffSkirt && !t.waterfall);
  }

  function placePillarsAndStatues() {
    const wet = shuffle(waterTiles());
    let placedPillars = 0;
    for (const tile of wet) {
      if (placedPillars >= settings.pillars) break;
      if (tile.path) continue;
      addObject({ type: 'submergedPillar', x: tile.x, y: tile.y, w: 1, h: 1, blocksMovement: true, note: 'dark gray circle, partially submerged' });
      placedPillars++;
    }
    while (placedPillars < settings.pillars) {
      const spot = randomFreeArea(1, 1, { allowWater: true, filter: (x, y) => tileAt(x, y).water }, 80);
      if (!spot) break;
      addObject({ type: 'submergedPillar', x: spot.x, y: spot.y, w: 1, h: 1, blocksMovement: true, note: 'dark gray circle, partially submerged' });
      placedPillars++;
    }
    if (placedPillars < settings.pillars) warn(`submergedPillar: placed ${placedPillars}/${settings.pillars}; not enough clear water tiles`);
    logDebug(`submergedPillar: placed ${placedPillars}/${settings.pillars}`);

    placeRepeated('statue', settings.statues, {
      dims: () => chance(0.30) ? { w: 1, h: 2 } : { w: 1, h: 1 },
      areaOptions: { filter: (x, y, w, h) => areaElevationSpread(x, y, w, h) <= 1 },
      make: (x, y, w, h) => ({ type: 'statue', x, y, w, h, blocksMovement: true, note: 'dark gray obelisk/diamond statue' })
    });
  }

  function sanitizeObjectForExport(object) {
    const clean = { ...object };
    delete clean.pathAnchor;
    return clean;
  }

  const HOBUNJI_EDITOR_TILE_TYPES = new Set(['grass', 'weeds', 'tilled', 'trench', 'raised', 'paddy', 'rock', 'shrub', 'path', 'river', 'stream', 'waterfall', 'ramp']);

  const HOBUNJI_PLATEAU_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#e11d48', '#a855f7', '#facc15', '#06b6d4', '#84cc16'];

  function hobunjiMapTileType(tile) {
    if (tile.ramp) return 'ramp';
    if (tile.waterfall) return 'waterfall';
    if (tile.water) return tile.terrain === 'river' ? 'river' : 'stream';
    if (tile.path || tile.bridge || tile.navBridge) return 'path';
    if (tile.borderEscarpment && !tile.ramp) return 'rock';
    if (tile.distantBoundaryLandscape) return 'rock';
    if (tile.cliffSkirt && !tile.ramp) return 'rock';
    return 'grass';
  }

  function hobunjiOverlayTypeForObject(object) {
    if (!object) return null;
    if (object.type === 'copse' || object.type === 'bush' || object.type === 'fruitBush' || object.type === 'mushroomPatch' || object.type === 'beehive') return 'shrub';
    if (object.type === 'foragePlant' || object.type === 'rareHerb' || object.type === 'treasureDigspot') return 'weeds';
    if (object.type === 'diggableRockOre' || object.type === 'undiggableBoulder' || object.type === 'statue' || object.type === 'submergedPillar' || object.type === 'caveOpening' || object.type === 'secretCaveOpening' || object.type === 'structure' || object.type === 'animalDen') return 'rock';
    return null;
  }

  function hobunjiObjectOverlayByTile() {
    const overlays = new Map();
    for (const object of map.objects) {
      const overlayType = hobunjiOverlayTypeForObject(object);
      if (!overlayType) continue;
      for (let y = object.y; y < object.y + (object.h || 1); y++) {
        for (let x = object.x; x < object.x + (object.w || 1); x++) {
          if (!inBounds(x, y)) continue;
          const key = `${x},${y}`;
          const current = overlays.get(key);
          const priority = overlayType === 'rock' ? 3 : overlayType === 'shrub' ? 2 : 1;
          if (!current || priority > current.priority) overlays.set(key, { type: overlayType, objectId: object.id, objectType: object.type, priority });
        }
      }
    }
    return overlays;
  }

  function hobunjiPlateauGroupsByPaintedFootprint() {
    const sourceGroups = Array.isArray(map.plateauPaintGroups) ? map.plateauPaintGroups : [];
    const scored = sourceGroups.map((group, index) => ({
      group,
      index,
      interiorCount: group.interiorKeys ? group.interiorKeys.length : 0,
      ringCount: group.ringKeys ? group.ringKeys.length : 0
    }));
    const minimumInterior = 4;
    const minimumFootprint = 10;
    // Border-escarpment groups always export regardless of size: dropping one
    // as "tiny" doesn't just omit a small decorative plateau, it flattens a
    // piece of the boundary cliff ring to grass (mergeZoneTilesInto downgrades
    // an unassigned 'rock' tile to 'grass' — see its own comment), which is a
    // visible hole/gap in what's supposed to be a continuous cliff wall.
    let exportable = scored.filter(item => item.group.hasBorderEscarpment
      || (item.interiorCount >= minimumInterior && item.interiorCount + item.ringCount >= minimumFootprint));
    const droppedTiny = scored.length - exportable.length;
    const maxSubmaps = 96;
    const trimmable = exportable.filter(item => !item.group.hasBorderEscarpment);
    if (trimmable.length > maxSubmaps) {
      const keepIndices = new Set(exportable.filter(item => item.group.hasBorderEscarpment).map(item => item.index));
      for (const item of trimmable
        .sort((a, b) => (b.interiorCount + b.ringCount) - (a.interiorCount + a.ringCount))
        .slice(0, maxSubmaps)) {
        keepIndices.add(item.index);
      }
      exportable = exportable.filter(item => keepIndices.has(item.index)).sort((a, b) => a.index - b.index);
    }
    const groups = exportable.map((item, outputIndex) => {
      const group = item.group;
      return {
        id: group.id,
        number: group.number || outputIndex + 1,
        label: group.label || `Generated Plateau ${outputIndex + 1}`,
        elevation: group.elevation,
        color: group.color || HOBUNJI_PLATEAU_COLORS[outputIndex % HOBUNJI_PLATEAU_COLORS.length]
      };
    });
    if (droppedTiny || scored.length > groups.length) map.exportPlateauTinyGroupsSkipped = scored.length - groups.length;
    const byGroupId = new Map(groups.map(group => [group.id, group]));
    return { groups, byGroupId };
  }

  function hobunjiCleanTileRecord(record) {
    const clean = { ...record };
    if (!clean.crop) clean.crop = '';
    if (!HOBUNJI_EDITOR_TILE_TYPES.has(clean.type)) clean.type = 'grass';
    return clean;
  }

  function hobunjiRootTileRecord(tile, overlayByTile, plateauByGroupId) {
    const overlay = overlayByTile.get(`${tile.x},${tile.y}`);
    const output = {
      type: overlay && !tile.water && !tile.ramp && !tile.path ? overlay.type : hobunjiMapTileType(tile),
      crop: ''
    };
    const group = plateauByGroupId.get(tile.plateauGroupId);
    // A tile cannot be both editor plateau geometry and editor ramp geometry; keep plateau contact as ramp metadata only.
    if (group && !tile.ramp) output.plateau = group.id;
    // The border-entry gate corridor (openBorderEntryGate) is a deliberately
    // flattened, walkable cut through the boundary cliff ring — it needs to
    // stay IN its plateau's mask (dropping it out entirely leaves it at
    // baseTier/ground level even when it's meant to connect at the
    // surrounding terrain's real height, stranding the entry in a sunken
    // pocket below the plateau it opens onto). What it must NOT get is
    // mergeZoneTilesInto's ring classification: that marks any masked tile
    // bordering lower/unmasked terrain `incline`, and the gate's outermost
    // row is always exactly that (right at the map edge). An incline tile
    // is solid to the game's movement collision (tileSpeedAt: `if
    // (tile.incline) return null`), which would make the entrance itself
    // impassable. Flag it so the merge can force it to the group's real
    // (interior, non-incline) tier instead of computing ring-ness for it.
    if (tile.designRole === 'borderEntryGate') output.borderEntryGate = true;
    if (tile.borderEscarpment) {
      output.borderEscarpment = true;
      output.generatedBorderEscarpment = true;
      if (tile.borderEscarpmentDepth != null) output.borderEscarpmentDepth = tile.borderEscarpmentDepth;
      if (tile.borderEscarpmentSide) output.borderEscarpmentSide = tile.borderEscarpmentSide;
      if (tile.borderEscarpmentHeightBonus != null) output.borderEscarpmentHeightBonus = tile.borderEscarpmentHeightBonus;
    }
    if (tile.distantBoundaryLandscape) {
      output.distantBoundaryLandscape = true;
      if (tile.distantBoundaryLandscapeSide) output.distantBoundaryLandscapeSide = tile.distantBoundaryLandscapeSide;
      if (tile.distantBoundarySourceHeight != null) output.distantBoundarySourceHeight = tile.distantBoundarySourceHeight;
    }
    if (tile.navRamp && !tile.ramp) {
      output.navRamp = true;
      if (tile.navRampId) output.navRampId = tile.navRampId;
      if (tile.navRampProgress != null) output.navRampProgress = tile.navRampProgress;
    }
    if (tile.ramp) {
      output.rampElevation = Number(tileHeight(tile).toFixed(2));
      if (tile.rampLandingContact) output.rampLandingContact = tile.rampLandingContact;
      if (tile.rampLane) output.rampLane = tile.rampLane;
      if (tile.rampWidthMode) output.rampWidthMode = tile.rampWidthMode;
      if (tile.rampSharesPlateau) output.rampSharesPlateau = true;
      if (tile.rampSharedPlateauGroupId) output.rampSharedPlateauGroupId = tile.rampSharedPlateauGroupId;
    }
    if (overlay) {
      output.generatedObjectId = overlay.objectId;
      output.generatedObjectType = overlay.objectType;
    }
    return hobunjiCleanTileRecord(output);
  }

  function hobunjiSubmapTileRecord(tile, overlayByTile) {
    const overlay = overlayByTile.get(`${tile.x},${tile.y}`);
    const output = {
      type: overlay && !tile.water && !tile.ramp && !tile.path ? overlay.type : hobunjiMapTileType(tile),
      crop: ''
    };
    if (tile.ramp) {
      output.rampElevation = Number(tileHeight(tile).toFixed(2));
      if (tile.rampLandingContact) output.rampLandingContact = tile.rampLandingContact;
      if (tile.rampSharesPlateau) output.rampSharesPlateau = true;
      if (tile.rampSharedPlateauGroupId) output.rampSharedPlateauGroupId = tile.rampSharedPlateauGroupId;
    }
    if (overlay) {
      output.generatedObjectId = overlay.objectId;
      output.generatedObjectType = overlay.objectType;
    }
    return hobunjiCleanTileRecord(output);
  }

  function hobunjiBaseMap(id, name, cols, rows, options = {}) {
    return {
      schema: 'hobunji_map.v1',
      id,
      name,
      category: 'exterior',
      cols,
      rows,
      tiles: {},
      objects: {},
      furniture: [],
      decor: [],
      routes: [],
      rivers: [],
      npcPaths: [],
      transitions: [],
      npcStations: [],
      buildings: [],
      isSubmap: !!options.isSubmap,
      parentMapId: options.parentMapId || null,
      plateauGroupId: options.plateauGroupId || null,
      elevation: Number.isFinite(options.elevation) ? options.elevation : 0,
      audioIndex: '',
      anchorC: Number.isFinite(options.anchorC) ? options.anchorC : 0,
      anchorR: Number.isFinite(options.anchorR) ? options.anchorR : 0
    };
  }

  function hobunjiSetTile(mapOut, c, r, record) {
    if (c < 0 || r < 0 || c >= mapOut.cols || r >= mapOut.rows) return;
    mapOut.tiles[`${c},${r}`] = hobunjiCleanTileRecord(record);
  }

  function hobunjiSourcePlateauGroup(groupId) {
    return (map.plateauPaintGroups || []).find(group => group.id === groupId) || null;
  }

  function hobunjiMakeSubmapForGroup(rootId, group, overlayByTile) {
    const sourceGroup = hobunjiSourcePlateauGroup(group.id);
    const bbox = sourceGroup ? sourceGroup.bbox : null;
    if (!bbox) return null;
    const cols = Math.max(1, bbox.maxC - bbox.minC + 1 - 2);
    const rows = Math.max(1, bbox.maxR - bbox.minR + 1 - 2);
    const anchorC = bbox.minC + 1;
    const anchorR = bbox.minR + 1;
    const submap = hobunjiBaseMap(
      `map_generated_wilderness_${group.id}`,
      `Generated Wilderness — ${group.label}`,
      cols,
      rows,
      { isSubmap: true, parentMapId: rootId, plateauGroupId: group.id, elevation: group.elevation, anchorC, anchorR }
    );

    // A border-escarpment group's height varies tile-by-tile (see
    // targetBoundaryHeight), so it's frequently thin enough to be ALL ring /
    // zero interior by this system's ring-vs-interior split (isManualPlateau-
    // RingTile) — excluding ring tiles here would then paint nothing and this
    // whole group's submap comes back null, which orphans its mask in
    // mergeZoneTilesInto (the group has no matching submap, so its cells fall
    // through to plain ungraded grass instead of the raised cliff they should
    // be). A thin cliff strip has no meaningful margin-vs-top distinction
    // anyway — buildPlateauMesa computes its own outer blend band from the
    // mask regardless of this ring flag — so paint every cell for these.
    const paintRingToo = !!sourceGroup.hasBorderEscarpment;
    let paintedTiles = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sourceTile = tileAt(anchorC + c, anchorR + r);
        if (!sourceTile || sourceTile.plateauGroupId !== group.id) continue;
        if (sourceTile.plateauRing && !paintRingToo) continue;
        hobunjiSetTile(submap, c, r, hobunjiSubmapTileRecord(sourceTile, overlayByTile));
        paintedTiles++;
      }
    }
    return paintedTiles ? submap : null;
  }

  function hobunjiSimplifyNodes(points, limit = 160) {
    if (!Array.isArray(points) || !points.length) return [];
    const raw = [];
    let lastKey = '';
    for (const point of points) {
      const c = clamp(Math.round(Number(point.x)), 0, map.width - 1);
      const r = clamp(Math.round(Number(point.y)), 0, map.height - 1);
      const key = `${c},${r}`;
      if (key === lastKey) continue;
      raw.push([c, r]);
      lastKey = key;
    }
    if (raw.length <= limit) return raw;
    const simplified = [];
    const step = (raw.length - 1) / Math.max(1, limit - 1);
    for (let i = 0; i < limit; i++) simplified.push(raw[Math.round(i * step)]);
    return simplified.filter((node, index) => index === 0 || node[0] !== simplified[index - 1][0] || node[1] !== simplified[index - 1][1]);
  }

  function hobunjiBuildRoutes() {
    const routes = [];
    for (const path of map.paths) {
      const nodes = hobunjiSimplifyNodes(path.points || [], 120);
      if (nodes.length >= 2) routes.push({ id: `route_${path.id}`, label: `Visible ${path.id}`, nodes });
    }
    for (const path of map.invisiblePaths || []) {
      const nodes = hobunjiSimplifyNodes(path.points || [], 120);
      if (nodes.length >= 2) routes.push({ id: `route_${path.id}`, label: `Invisible nav ${path.id}`, nodes, hiddenInGame: true });
    }
    if (map.entry) {
      routes.unshift({ id: 'route_map_entry_marker', label: `Entry ${map.entry.side}`, nodes: [[map.entry.x, map.entry.y]] });
    }
    return routes;
  }

  function hobunjiBuildRivers() {
    return (map.rivers || []).map((river, index) => {
      const nodes = hobunjiSimplifyNodes((river.points || []).filter(point => inBounds(Math.round(point.x), Math.round(point.y))), 96);
      return {
        id: river.id || `river_${index + 1}`,
        label: `Generated river ${index + 1}`,
        kind: 'river',
        nodes,
        width: Math.max(1, Math.round(river.widthTilesAverage || river.widthTiles || 3)),
        seed: hashSeed(`${map.seed}_${river.id || index}`),
        paintTiles: false,
        widthTilesAverage: river.widthTilesAverage || river.widthTiles || 3
      };
    }).filter(river => river.nodes.length >= 2);
  }

  function hobunjiMapIdForRampEnd(tier, groupId) {
    if (tier <= 0) return 'map_generated_wilderness_root';
    const group = hobunjiSourcePlateauGroup(groupId) || (map.plateauPaintGroups || []).find(item => item.elevation === tier);
    return group ? `map_generated_wilderness_${group.id}` : 'map_generated_wilderness_root';
  }

  function hobunjiBuildWorkspaceRamps() {
    return (map.ramps || []).map((ramp, index) => {
      const nodes = hobunjiSimplifyNodes((ramp.tiles || []).map(tile => ({ x: tile.x, y: tile.y })), 64);
      return {
        id: ramp.id || `ramp_${index + 1}`,
        label: `Generated ramp ${index + 1}`,
        fromMapId: hobunjiMapIdForRampEnd(ramp.fromTier, ramp.fromGroupId),
        toMapId: hobunjiMapIdForRampEnd(ramp.toTier, ramp.toGroupId),
        nodes,
        width: Math.max(1, Math.round(ramp.widthTiles || (ramp.kind === 'wrap' ? 2 : 1))),
        paintTiles: false,
        generatedKind: ramp.kind || 'direct',
        sharedPlateauGroupId: ramp.sharedPlateauGroupId || null,
        sharedPlateauTiles: ramp.sharedPlateauTiles || 0,
        angleDegrees: ramp.angleDegrees,
        maxAngleDegrees: ramp.maxAngleDegrees
      };
    }).filter(ramp => ramp.nodes.length >= 2);
  }

  function hobunjiBuildTransitions() {
    const transitions = [];
    if (map.entry) {
      transitions.push({
        id: 'sp_generated_entry',
        label: `Entry ${map.entry.side}`,
        col: map.entry.x,
        row: map.entry.y,
        targetMapId: '',
        targetSpotId: ''
      });
    }
    for (const object of map.objects) {
      if (object.type !== 'caveOpening' && object.type !== 'secretCaveOpening') continue;
      transitions.push({
        id: `sp_${object.id}`,
        label: object.type === 'secretCaveOpening' ? 'Secret cave' : 'Cave',
        col: object.x,
        row: object.y,
        targetMapId: '',
        targetSpotId: '',
        generatedObjectId: object.id
      });
    }
    return transitions;
  }

  function hobunjiBuildNpcStations() {
    return map.objects
      .filter(object => object.type === 'animalDen')
      .map((object, index) => ({
        id: `station_${object.id}`,
        label: `Animal den ${index + 1}`,
        col: object.x,
        row: object.y,
        rotY: 0,
        pose: 'stand',
        toolKey: '',
        toolIntervalSec: 0,
        toolAnimStyle: '',
        generatedObjectId: object.id
      }));
  }

  function buildHobunjiMapExport() {
    const baseId = safeFilename(settings.seed || map.seed || 'wild_map').slice(0, 42) || 'wild_map';
    const rootId = 'map_generated_wilderness_root';
    const overlayByTile = hobunjiObjectOverlayByTile();
    const { groups: plateauGroups, byGroupId: plateauByGroupId } = hobunjiPlateauGroupsByPaintedFootprint();
    const root = hobunjiBaseMap(rootId, `Generated Wilderness — ${settings.seed || map.seed || 'Wild Map'}`, map.width, map.height);

    for (const tile of allTiles()) hobunjiSetTile(root, tile.x, tile.y, hobunjiRootTileRecord(tile, overlayByTile, plateauByGroupId));
    root.routes = hobunjiBuildRoutes();
    root.rivers = hobunjiBuildRivers();
    root.transitions = hobunjiBuildTransitions();
    root.npcStations = hobunjiBuildNpcStations();
    root.generatedFrom = {
      schema: map.schema,
      version: map.version,
      seed: map.seed,
      preset: map.preset || settings.preset,
      presetLabel: map.presetLabel || settings.presetLabel,
      boundaryMode: map.boundaryMode || settings.boundaryMode,
      boundaryModeLabel: map.boundaryModeLabel || settings.boundaryModeLabel,
      boundaryCliffBoost: Number.isFinite(map.boundaryCliffBoost) ? map.boundaryCliffBoost : settings.boundaryCliffBoost,
      stepCurve: map.stepCurve || settings.stepCurve,
      stepCurveLabel: map.stepCurveLabel || settings.stepCurveLabel,
      greatBasinHorseshoe: !!map.greatBasinHorseshoe,
      greatBasinSpoon: !!(map.greatBasinSpoon || usesGreatBasinPreset()),
      greatBasinSpoonBowlXRatio: map.greatBasinSpoonBowlXRatio || GREAT_BASIN_SPOON_BOWL_X_RATIO,
      greatBasinSpoonBowlYRatio: map.greatBasinSpoonBowlYRatio || GREAT_BASIN_SPOON_BOWL_Y_RATIO,
      greatBasinSpoonBowlRadiusRatio: map.greatBasinSpoonBowlRadiusRatio || GREAT_BASIN_SPOON_BOWL_RADIUS_RATIO,
      greatBasinSpoonBowl: map.greatBasinSpoonBowl || null,
      boundaryHeightScan: map.boundaryHeightScan || null,
      distantBoundaryLandscapes: map.distantBoundaryLandscapes || [],
      greatBasinEntry: map.greatBasinEntry || null,
      note: `Flattened from WildernessMapGeneratorV44 after ${map.generationScale || 1}x tile-density expansion. Unsupported generated object types are encoded as supported editor tile types plus generatedObject metadata. Tiny canyon-cut plateau fragments may be root-only to keep Map Editor imports lightweight.`
    };

    const submaps = [];
    for (const group of plateauGroups) {
      const submap = hobunjiMakeSubmapForGroup(rootId, group, overlayByTile);
      if (submap) submaps.push(submap);
    }

    const workspace = {
      schema: 'hobunji_map_editor_workspace.v1',
      generator: 'WildernessMapGeneratorV44',
      generatedAt: new Date().toISOString(),
      maps: [root, ...submaps],
      activeId: root.id,
      gameLink: {
        exteriorId: root.id,
        interiorId: '',
        townId: ''
      },
      generatorPreset: { id: map.preset || settings.preset, label: map.presetLabel || settings.presetLabel, stepCurve: map.stepCurve || settings.stepCurve, stepCurveLabel: map.stepCurveLabel || settings.stepCurveLabel, greatBasinHorseshoe: !!map.greatBasinHorseshoe, greatBasinSpoon: !!(map.greatBasinSpoon || usesGreatBasinPreset()), greatBasinSpoonBowlXRatio: map.greatBasinSpoonBowlXRatio || GREAT_BASIN_SPOON_BOWL_X_RATIO,
      greatBasinSpoonBowlYRatio: map.greatBasinSpoonBowlYRatio || GREAT_BASIN_SPOON_BOWL_Y_RATIO,
      greatBasinSpoonBowlRadiusRatio: map.greatBasinSpoonBowlRadiusRatio || GREAT_BASIN_SPOON_BOWL_RADIUS_RATIO,
      greatBasinSpoonBowl: map.greatBasinSpoonBowl || null, greatBasinLinearHeightLerp: !!(map.greatBasinSpoon || usesGreatBasinPreset()), greatBasinLateBoundarySideExtensions: !!(map.greatBasinSpoon || usesGreatBasinPreset()), greatBasinEntry: map.greatBasinEntry || null },
      plateauGroups,
      ramps: hobunjiBuildWorkspaceRamps(),
      importInstructions: 'Open docs/tools/map-editor/index.html, click Import, and select this JSON. The editor recognizes the workspace shape because it contains a maps array.'
    };

    lastMapEditorExportReport = buildMapEditorExportReport(workspace, baseId);
    return workspace;
  }

  function buildMapEditorExportReport(workspace, baseId) {
    const tileTypeCounts = {};
    const invalidTiles = [];
    let tileCount = 0;
    for (const editorMap of workspace.maps) {
      for (const [key, tile] of Object.entries(editorMap.tiles || {})) {
        tileCount++;
        tileTypeCounts[tile.type] = (tileTypeCounts[tile.type] || 0) + 1;
        if (!HOBUNJI_EDITOR_TILE_TYPES.has(tile.type)) invalidTiles.push(`${editorMap.id}:${key}:${tile.type}`);
      }
    }
    const root = workspace.maps[0];
    const rootKeys = Object.keys(root.tiles || {});
    const firstKey = rootKeys[0] || 'none';
    return [
      'Map Editor export:',
      `  file stem: ${baseId}_map_editor_workspace.json`,
      `  schema: ${workspace.schema}`,
      `  import preflight: ${Array.isArray(workspace.maps) && workspace.maps.length ? 'recognized workspace shape' : 'BROKEN - maps array missing'}`,
      `  maps: ${workspace.maps.length} (${workspace.maps.filter(m => m.isSubmap).length} plateau submaps)`,
      `  root: ${root.cols}x${root.rows}, zero-based first key: ${firstKey}`,
      `  source: ${map.sourceWidth || map.width}x${map.sourceHeight || map.height}, tile-density scale: ${map.generationScale || 1}x`,
      map.connectivity && map.connectivity.originalWalkableTilesBeforeDensityScale ? `  walkable source/export: ${map.connectivity.originalWalkableTilesBeforeDensityScale} -> ${map.connectivity.actualWalkableTilesAfterDensityScale}` : '  walkable source/export: not measured',
      `  tiles: ${tileCount}`,
      `  plateau groups: ${workspace.plateauGroups.length}${map.exportPlateauTinyGroupsSkipped ? ` (${map.exportPlateauTinyGroupsSkipped} tiny/root-only groups skipped)` : ''}`,
      `  manual plateau ring tiles: ${map.plateauPaintGroups.reduce((sum, group) => sum + (group.ringKeys ? group.ringKeys.length : 0), 0)}`,
      `  manual plateau interior tiles: ${map.plateauPaintGroups.reduce((sum, group) => sum + (group.interiorKeys ? group.interiorKeys.length : 0), 0)}`,
      `  border escarpment tiles: ${allTiles().filter(tile => tile.borderEscarpment).length}`,
      `  distant boundary landscape tiles: ${allTiles().filter(tile => tile.distantBoundaryLandscape).length}`,
      `  ramps: ${workspace.ramps.length} (${workspace.ramps.filter(r => r.generatedKind === 'wrap').length} wraparound, ${workspace.ramps.reduce((sum, r) => sum + (r.sharedPlateauTiles || 0), 0)} shared plateau tiles)`,
      `  routes: ${(root.routes || []).length}`,
      `  rivers: ${(root.rivers || []).length}`,
      `  transition spots: ${(root.transitions || []).length}`,
      `  animal-den stations: ${(root.npcStations || []).length}`,
      `  tile types: ${Object.entries(tileTypeCounts).map(([key, value]) => `${key}:${value}`).join(', ')}`,
      invalidTiles.length ? `  INVALID TILE TYPES: ${invalidTiles.slice(0, 12).join(', ')}` : '  invalid tile types: none'
    ].join('\n');
  }

  function buildExport() {
    const terrainRows = map.tiles.map(row => row.map(tile => ({
      x: tile.x,
      y: tile.y,
      terrain: tile.terrain,
      elevation: tile.elevation,
      height: Number(tileHeight(tile).toFixed(2)),
      plateauGroupId: tile.plateauGroupId,
      plateauRing: tile.plateauRing,
      plateauInterior: tile.plateauInterior,
      water: tile.water,
      path: tile.path,
      invisiblePath: tile.invisiblePath,
      invisiblePathId: tile.invisiblePathId,
      denRoute: tile.denRoute,
      bridge: tile.bridge,
      navBridge: tile.navBridge,
      navRamp: !!tile.navRamp,
      navRampId: tile.navRampId || null,
      navRampProgress: tile.navRampProgress,
      ramp: tile.ramp,
      rampId: tile.rampId,
      rampProgress: tile.rampProgress,
      rampFromTier: tile.rampFromTier,
      rampToTier: tile.rampToTier,
      rampDirection: tile.rampDirection,
      rampKind: tile.rampKind || null,
      rampNormal: tile.rampNormal || null,
      rampLandingContact: tile.rampLandingContact || null,
      rampSharesPlateau: !!tile.rampSharesPlateau,
      rampSharedPlateauGroupId: tile.rampSharedPlateauGroupId || null,
      cliffSkirt: tile.cliffSkirt,
      cliffSkirtKind: tile.cliffSkirtKind,
      cliffFromTier: tile.cliffFromTier,
      cliffToTier: tile.cliffToTier,
      cliffFacing: tile.cliffFacing,
      borderEscarpment: tile.borderEscarpment,
      borderEscarpmentDepth: tile.borderEscarpmentDepth,
      borderEscarpmentSide: tile.borderEscarpmentSide,
      borderEscarpmentBaseHeight: tile.borderEscarpmentBaseHeight,
      borderEscarpmentHeightBonus: tile.borderEscarpmentHeightBonus,
      distantBoundaryLandscape: !!tile.distantBoundaryLandscape,
      distantBoundaryLandscapeSide: tile.distantBoundaryLandscapeSide || null,
      distantBoundaryLandscapeDepth: tile.distantBoundaryLandscapeDepth,
      distantBoundarySourceHeight: tile.distantBoundarySourceHeight,
      distantBoundaryDisplayHeight: tile.distantBoundaryDisplayHeight,
      distantBoundaryRenderBand: tile.distantBoundaryRenderBand || null,
      greatBasinHorseshoeProfile: !!tile.greatBasinHorseshoeProfile,
      greatBasinSpoonProfile: !!tile.greatBasinSpoonProfile,
      greatBasinSpoonBowlDistance: tile.greatBasinSpoonBowlDistance,
      greatBasinSpoonRadialDistance: tile.greatBasinSpoonRadialDistance,
      greatBasinSpoonArcDistance: tile.greatBasinSpoonArcDistance,
      greatBasinSpoonCircularDistance: tile.greatBasinSpoonCircularDistance,
      greatBasinSpoonArcTerraceTier: tile.greatBasinSpoonArcTerraceTier,
      greatBasinLinearProfile: !!tile.greatBasinLinearProfile,
      greatBasinLinearTier: tile.greatBasinLinearTier,
      greatBasinLateSideExtension: !!tile.greatBasinLateSideExtension,
      greatBasinLateSideInfluence: tile.greatBasinLateSideInfluence,
      greatBasinLateSideBaseTier: tile.greatBasinLateSideBaseTier,
      greatBasinLateSideTargetTier: tile.greatBasinLateSideTargetTier,
      greatBasinCenterDistance: tile.greatBasinCenterDistance,
      rampSkirt: tile.rampSkirt,
      waterfall: tile.waterfall,
      occupiedBy: tile.occupiedBy
    })));
    const summary = summarizeMap();
    return {
      schema: map.schema,
      version: map.version,
      seed: map.seed,
      preset: map.preset || settings.preset,
      presetLabel: map.presetLabel || settings.presetLabel,
      boundaryMode: map.boundaryMode || settings.boundaryMode,
      boundaryModeLabel: map.boundaryModeLabel || settings.boundaryModeLabel,
      boundaryCliffBoost: Number.isFinite(map.boundaryCliffBoost) ? map.boundaryCliffBoost : settings.boundaryCliffBoost,
      stepCurve: map.stepCurve || settings.stepCurve,
      stepCurveLabel: map.stepCurveLabel || settings.stepCurveLabel,
      greatBasinHorseshoe: !!map.greatBasinHorseshoe,
      greatBasinSpoon: !!(map.greatBasinSpoon || usesGreatBasinPreset()),
      greatBasinSpoonBowlXRatio: map.greatBasinSpoonBowlXRatio || GREAT_BASIN_SPOON_BOWL_X_RATIO,
      greatBasinSpoonBowlYRatio: map.greatBasinSpoonBowlYRatio || GREAT_BASIN_SPOON_BOWL_Y_RATIO,
      greatBasinSpoonBowlRadiusRatio: map.greatBasinSpoonBowlRadiusRatio || GREAT_BASIN_SPOON_BOWL_RADIUS_RATIO,
      greatBasinSpoonBowl: map.greatBasinSpoonBowl || null,
      boundaryHeightScan: map.boundaryHeightScan || null,
      distantBoundaryLandscapes: map.distantBoundaryLandscapes || [],
      greatBasinEntry: map.greatBasinEntry || null,
      width: map.width,
      height: map.height,
      sourceWidth: map.sourceWidth || map.width,
      sourceHeight: map.sourceHeight || map.height,
      generationScale: map.generationScale || 1,
      entry: map.entry,
      routeStyle: 'Stardew/Pokemon-like wilderness: sparse visible roads, clustered messy Giant\'s-Causeway-like plateau fields, manual-style reserved cliff rings, wraparound ramps with shared plateau contact tiles, boundary plateau modes generated after playable terrain height scanning, cave mouths in cliff faces, wild animal dens, and invisible navigation corridors for full walkable-tile reachability',
      cameraLocked: true,
      visibilityRule: 'plateaus are generated as clustered manual-paint-style causeway cells rather than global shelves; each footprint owns its reserved outer ring and inset submap top',
      riverWidthRule: usesDramaticPlateauPreset() ? 'dramatic preset rivers are late-painted over finished terrain with no erosion carving; height breaks become waterfall tiles' : 'big canyon rivers vary along their length; each sampled width is usually 4-8 tiles and carves river beds down through raised plateau fields',
      pathingRule: 'visible paths are sparse. invisiblePaths reserve natural walkable corridors for players, NPCs, and animal escape routing without drawing extra beaten roads.',
      tileDensityRule: `Generated at source size ${map.sourceWidth || map.width}x${map.sourceHeight || map.height}, then expanded by ${map.generationScale || 1}x so every source tile becomes ${(map.generationScale || 1) * (map.generationScale || 1)} exported tiles. At scale 2, every originally walkable source tile becomes four walkable exported tiles.`,
      presetRule: `${map.presetLabel || settings.presetLabel || 'Custom'} preset. Cliffs forces a south entry and dramatic packed-bleacher plateau tiers using the ${(map.stepCurveLabel || settings.stepCurveLabel || 'Northern Cliffs')} step curve. Nearby plateaus share parent aprons, and jagged east-west variation may dip or spike without dropping below southern support terrain. A plateau-component scanner detects low child plateau bodies and raises whole components instead of row tiles; boundary mode ${(map.boundaryModeLabel || settings.boundaryModeLabel)} uses a post-playable height scan before generating the world edge. Great Basin forces a north entry, uses a linear south-to-north height lerp as the base basin floor, then late in terrain generation extends higher-tier spoon sides along the east/west boundaries before raising the post-boundary road to the highest walkable plateau it directly connects to.`,
      hiddenRewardRule: 'After reachability is finalized, difficult-to-reach areas are scored by real travel distance, seclusion, route visibility, and nearby line-of-sight observer counts, then used for extra treasure digspots, rare herbs, and secret caves.',
      animalActivityRule: 'Live animal symbols use den-based cyclic routes. Prey graze or inspect resources for 15 simulated minutes, pack predators hunt prey route stops, ambush predators wait alone near cover, and bear-like omnivores fish, forage, inspect hives, and visit prey conflict points.',
      legend: {
        elevation: 'numbered vertical tier. 0 = ground, higher numbers = plateau tiers.',
        height: 'render/traversal height. Normal tiles equal elevation; ramp tiles are fractional lerps.',
        ramp: 'designated slope tiles connecting significant tier jumps. rampProgress 0..1 lerps from rampFromTier to rampToTier.',
        pond: 'irregular water blob',
        river: usesDramaticPlateauPreset() ? 'late-painted border-crossing water with widthSamples; preserves plateau elevations and relies on waterfall tiles at tier breaks' : 'border-crossing canyon water with widthSamples; widths usually vary between 4 and 8 tiles and carve broad channels through plateau fields',
        cliffSkirt: 'reserved tile outline at the base/sides of plateaus and ramps. Normal objects cannot be placed here.',
        caveOpening: 'black cave mouth embedded into a cliff-skirt tile with rarity superscript',
        secretCaveOpening: 'hidden cave opening embedded into a remote cliff-skirt tile with rarity superscript',
        rarityPool: 'small color-coded superscript number with black stroke, shown on forageables, diggable rocks/ores, treasure digspots, and caves to indicate rarity pool',
        visibilityRatio: 'for hidden reward placements, a lower value means fewer nearby tiles have line of sight to that reward location',
        path: 'tan visible beaten path; if bridge is true, path crosses water',
        invisiblePath: 'reserved undrawn natural walkable corridor used by reachability and NPC/animal routing',
        animalDen: 'wild animal pack home with an escapeAnchor connected to invisible navigation',
        copse: 'copse tile marker. In the larger game, trees should spawn densely across connected copse tiles, usually slightly more trees than tiles where room allows.',
        fallenLog: 'brown rectangle, 2 tiles',
        stump: 'brown cut stump, 1 tile',
        bush: 'bright green star',
        foragePlant: 'colored star with rarity superscript',
        rareHerb: 'bright green star placed as a deliberate hidden reward',
        fruitBush: 'fruit bush food target for live animal routes',
        mushroomPatch: 'mushroom food target for live animal routes',
        beehive: 'hive food target for live animal routes',
        treasureDigspot: 'yellow X with rarity superscript',
        diggableRockOre: 'light gray hexagon, 1 tile, with rarity superscript',
        undiggableBoulder: 'dark gray hexagon, variable dimensions',
        submergedPillar: 'dark gray circle in water',
        statue: 'dark gray obelisk/diamond shape'
      },
      summary,
      tiles: terrainRows,
      rivers: map.rivers,
      ramps: map.ramps,
      plateauPaintGroups: map.plateauPaintGroups,
      paths: map.paths,
      invisiblePaths: map.invisiblePaths,
      connectivity: map.connectivity,
      rewardAnalysis: map.rewardAnalysis,
      animalActivity: map.animalActivity,
      objects: map.objects.map(sanitizeObjectForExport),
      warnings: map.warnings
    };
  }


  function tierAreaCounts() {
    const counts = {};
    for (const tile of allTiles()) {
      const key = String(tile.elevation);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  function summarizeMap() {
    const terrainCounts = {};
    let highestTier = 0;
    let water = 0;
    let path = 0;
    let bridges = 0;
    let navBridges = 0;
    let invisiblePaths = 0;
    let denRouteTiles = 0;
    let ramps = 0;
    let sharedRampPlateauTiles = 0;
    let cliffSkirts = 0;
    let plateauRingTiles = 0;
    let plateauInteriorTiles = 0;
    let waterfalls = 0;
    let borderEscarpments = 0;
    let distantBoundaryLandscapes = 0;
    for (const tile of allTiles()) {
      terrainCounts[tile.terrain] = (terrainCounts[tile.terrain] || 0) + 1;
      highestTier = Math.max(highestTier, tile.elevation);
      if (tile.water) water++;
      if (tile.path) path++;
      if (tile.bridge) bridges++;
      if (tile.navBridge) navBridges++;
      if (tile.invisiblePath) invisiblePaths++;
      if (tile.denRoute) denRouteTiles++;
      if (tile.ramp) ramps++;
      if (tile.rampSharesPlateau) sharedRampPlateauTiles++;
      if (tile.cliffSkirt) cliffSkirts++;
      if (tile.plateauRing) plateauRingTiles++;
      if (tile.plateauInterior) plateauInteriorTiles++;
      if (tile.waterfall) waterfalls++;
      if (tile.borderEscarpment) borderEscarpments++;
      if (tile.distantBoundaryLandscape) distantBoundaryLandscapes++;
    }
    const objectCounts = {};
    for (const object of map.objects) objectCounts[object.type] = (objectCounts[object.type] || 0) + 1;
    return { terrainCounts, objectCounts, highestTier, waterTiles: water, pathTiles: path, invisiblePathTiles: invisiblePaths, denRouteTiles, bridgeTiles: bridges, navBridgeTiles: navBridges, hiddenNavRamps: map.hiddenNavRamps ? map.hiddenNavRamps.length : 0, rampTiles: ramps, rampConnections: map.ramps.length, sharedRampPlateauTiles, cliffSkirtTiles: cliffSkirts, plateauRingTiles, plateauInteriorTiles, plateauPaintGroups: map.plateauPaintGroups.length, waterfallTiles: waterfalls, borderEscarpmentTiles: borderEscarpments, distantBoundaryLandscapeTiles: distantBoundaryLandscapes, animalDens: countObjects('animalDen'), animalSymbols: map.animalActivity ? map.animalActivity.agents.length : 0, animalFoodSources: map.animalActivity ? map.animalActivity.resources.length : 0, unreachableTiles: map.connectivity ? map.connectivity.unreachableTiles : null, tierAreas: tierAreaCounts() };
  }

  function safeFilename(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'wild_map';
  }

  // Per-zone generation overrides. entrySide always matches Hobunji Hollow's
  // side of that zone (the cliffs sit north of town, so their entry opens
  // south, and so on) — that authored orientation is never affected by the
  // preset choice (see the entrySide-precedence comment on
  // resolveGenerationEntrySide). preset/boundaryMode/boundaryCliffBoost pick
  // the WildernessMapGeneratorV4412 terrain-preset + boundary-cliff-mode
  // combination each zone renders with; everything else is the tool's own
  // default (see defaultSettings).
  const ZONE_CONFIG = {
    map_northern_cliffs: { entrySide: 'south', preset: 'cliffs', boundaryMode: 'followMapHeight', boundaryCliffBoost: 5 },
    map_southern_cloud_forest: { entrySide: 'north', preset: 'greatBasin', boundaryMode: 'entrySideDistantLandscape', boundaryCliffBoost: 0 },
    map_western_slope: { entrySide: 'east', preset: 'cliffs', boundaryMode: 'entrySideDistantLandscape', boundaryCliffBoost: 0 },
    map_eastern_mire: { entrySide: 'west', preset: 'greatBasin', boundaryMode: 'followMapHeight', boundaryCliffBoost: 2 },
  };

  // ---------------------------------------------------------------------
  // Ported from WildernessMapGeneratorV4412: the post-layout tile-density
  // pass. Runs unconditionally (matching the standalone tool), turning every
  // generated tile into a GENERATION_TILE_SCALE x GENERATION_TILE_SCALE block
  // of identical tiles and rescaling every coordinate-bearing piece of
  // generated data (objects, rivers, ramps, paths, plateau groups, reward/
  // design analysis, connectivity stats) to match.
  // ---------------------------------------------------------------------
  function clonePlain(value) {
    if (value == null || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function scaleScalar(value, scale, digits = 3) {
    if (!Number.isFinite(value)) return value;
    const scaled = value * scale;
    return Number.isInteger(value) && Number.isInteger(scale) ? scaled : Number(scaled.toFixed(digits));
  }

  function scaleTileKey(key, scale) {
    const [x, y] = String(key).split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const scaled = [];
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) scaled.push(tileKey(x * scale + dx, y * scale + dy));
    }
    return scaled;
  }

  function scalePointCoordinate(value, scale, offset = 0) {
    return Number.isFinite(value) ? Math.round(value * scale + offset) : value;
  }

  function scaleMapPoint(point, scale, offsets = {}) {
    if (!point || typeof point !== 'object') return point;
    const output = clonePlain(point);
    if (Number.isFinite(point.x)) output.x = scalePointCoordinate(point.x, scale, offsets.x || 0);
    if (Number.isFinite(point.y)) output.y = scalePointCoordinate(point.y, scale, offsets.y || 0);
    if (Number.isFinite(point.col)) output.col = scalePointCoordinate(point.col, scale, offsets.x || 0);
    if (Number.isFinite(point.row)) output.row = scalePointCoordinate(point.row, scale, offsets.y || 0);
    if (Number.isFinite(point.widthTiles)) output.widthTiles = scaleScalar(point.widthTiles, scale, 2);
    if (Number.isFinite(point.widthTilesAverage)) output.widthTilesAverage = scaleScalar(point.widthTilesAverage, scale, 2);
    if (Number.isFinite(point.minimumWidthTiles)) output.minimumWidthTiles = scaleScalar(point.minimumWidthTiles, scale, 2);
    if (Number.isFinite(point.maximumWidthTiles)) output.maximumWidthTiles = scaleScalar(point.maximumWidthTiles, scale, 2);
    return output;
  }

  function scaledBlockPointsFromPoint(point, scale) {
    const points = [];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return points;
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        points.push(scaleMapPoint(point, scale, { x: dx, y: dy }));
      }
    }
    return points;
  }

  function scalePolylinePoints(points, scale) {
    return (points || []).map(point => scaleMapPoint(point, scale));
  }

  function scaleBBox(bbox, scale) {
    if (!bbox) return bbox;
    return {
      minC: scalePointCoordinate(bbox.minC, scale),
      minR: scalePointCoordinate(bbox.minR, scale),
      maxC: scalePointCoordinate(bbox.maxC, scale, scale - 1),
      maxR: scalePointCoordinate(bbox.maxR, scale, scale - 1)
    };
  }

  function scaleEntryPoint(entry, scale, originalWidth, originalHeight) {
    if (!entry) return entry;
    const offsets = { x: 0, y: 0 };
    if (entry.side === 'east') offsets.x = scale - 1;
    if (entry.side === 'south') offsets.y = scale - 1;
    const output = scaleMapPoint(entry, scale, offsets);
    output.sourceX = entry.x;
    output.sourceY = entry.y;
    output.sourceWidth = originalWidth;
    output.sourceHeight = originalHeight;
    return output;
  }

  function scaleGeneratedObject(object, scale) {
    const output = clonePlain(object);
    output.x = scalePointCoordinate(object.x, scale);
    output.y = scalePointCoordinate(object.y, scale);
    output.w = Math.max(1, scaleScalar(object.w || 1, scale, 0));
    output.h = Math.max(1, scaleScalar(object.h || 1, scale, 0));
    if (object.pathAnchor) output.pathAnchor = scaleMapPoint(object.pathAnchor, scale);
    if (object.escapeAnchor) output.escapeAnchor = scaleMapPoint(object.escapeAnchor, scale);
    if (object.mouthAnchor) output.mouthAnchor = scaleMapPoint(object.mouthAnchor, scale);
    if (object.anchor) output.anchor = scaleMapPoint(object.anchor, scale);
    return output;
  }

  function scaleGeneratedRivers(scale) {
    map.rivers = (map.rivers || []).map(river => ({
      ...clonePlain(river),
      widthTiles: scaleScalar(river.widthTiles, scale, 2),
      widthTilesAverage: scaleScalar(river.widthTilesAverage, scale, 2),
      minimumWidthTiles: scaleScalar(river.minimumWidthTiles, scale, 2),
      maximumWidthTiles: scaleScalar(river.maximumWidthTiles, scale, 2),
      widthSamples: (river.widthSamples || []).map(width => scaleScalar(width, scale, 2)),
      points: scalePolylinePoints(river.points || [], scale)
    }));
  }

  function scaleGeneratedRamps(scale) {
    map.ramps = (map.ramps || []).map(ramp => {
      const scaledTiles = [];
      for (const tile of ramp.tiles || []) scaledTiles.push(...scaledBlockPointsFromPoint(tile, scale));
      return {
        ...clonePlain(ramp),
        widthTiles: scaleScalar(ramp.widthTiles || (ramp.kind === 'wrap' ? 2 : 1), scale, 0),
        start: scaleMapPoint(ramp.start, scale),
        end: scaleMapPoint(ramp.end, scale),
        tiles: scaledTiles,
        sharedPlateauTiles: scaleScalar(ramp.sharedPlateauTiles || 0, scale * scale, 0)
      };
    });
  }

  function scaleGeneratedPaths(scale) {
    map.paths = (map.paths || []).map(path => ({
      ...clonePlain(path),
      from: scaleMapPoint(path.from, scale),
      to: scaleMapPoint(path.to, scale),
      points: scalePolylinePoints(path.points || [], scale)
    }));
    map.invisiblePaths = (map.invisiblePaths || []).map(path => ({
      ...clonePlain(path),
      points: scalePolylinePoints(path.points || [], scale),
      bridgeTiles: scaleScalar(path.bridgeTiles || 0, scale * scale, 0)
    }));
  }

  function scaleGeneratedPlateauGroups(scale) {
    map.plateauPaintGroups = (map.plateauPaintGroups || []).map(group => ({
      ...clonePlain(group),
      tileKeys: (group.tileKeys || []).flatMap(key => scaleTileKey(key, scale)),
      ringKeys: (group.ringKeys || []).flatMap(key => scaleTileKey(key, scale)),
      interiorKeys: (group.interiorKeys || []).flatMap(key => scaleTileKey(key, scale)),
      bbox: scaleBBox(group.bbox, scale)
    }));
  }

  function scaleGeneratedRewardAnalysis(scale) {
    if (!map.rewardAnalysis) return;
    map.rewardAnalysis = {
      ...clonePlain(map.rewardAnalysis),
      start: scaleMapPoint(map.rewardAnalysis.start, scale),
      maxDistance: scaleScalar(map.rewardAnalysis.maxDistance || 0, scale, 0),
      placements: (map.rewardAnalysis.placements || []).map(placement => scaleMapPoint(placement, scale))
    };
  }

  function scaleGeneratedDesignAnalysis(scale) {
    if (!map.designAnalysis) return;
    const output = clonePlain(map.designAnalysis);
    if (Array.isArray(output.landmarks)) output.landmarks = output.landmarks.map(item => scaleMapPoint(item, scale));
    if (Array.isArray(output.loops)) output.loops = output.loops.map(loop => ({ ...loop, points: scalePolylinePoints(loop.points || [], scale) }));
    map.designAnalysis = output;
  }

  function scaleHiddenNavRampStats(scale) {
    map.hiddenNavRamps = (map.hiddenNavRamps || []).map(item => ({
      ...clonePlain(item),
      length: scaleScalar(item.length || 0, scale, 0),
      minimumRunTiles: scaleScalar(item.minimumRunTiles || 0, scale, 0),
      generatedRunTiles: scaleScalar(item.generatedRunTiles || 0, scale, 0)
    }));
  }

  function refreshConnectivityAfterTileScale(previousConnectivity, originalWalkableTiles, scale) {
    const start = nearestFreeWalkableNeighbor(map.entry.x, map.entry.y);
    const reached = reachableFrom(start);
    const walkable = allWalkableTiles();
    const unreachable = walkable.filter(tile => !reached.has(keyXY(tile.x, tile.y)));
    map.connectivity = {
      ...(previousConnectivity || {}),
      start,
      walkableTiles: walkable.length,
      reachableTiles: reached.size,
      unreachableTiles: unreachable.length,
      unreachableSamples: unreachable.slice(0, 16).map(tile => ({ x: tile.x, y: tile.y, elevation: tile.elevation, water: tile.water, cliffSkirt: tile.cliffSkirt, occupiedBy: tile.occupiedBy })),
      originalWalkableTilesBeforeDensityScale: originalWalkableTiles,
      expectedWalkableTilesAfterDensityScale: originalWalkableTiles * scale * scale,
      actualWalkableTilesAfterDensityScale: walkable.length,
      walkableTileScaleRatio: originalWalkableTiles ? Number((walkable.length / originalWalkableTiles).toFixed(3)) : null,
      generationScale: scale,
      rule: `${previousConnectivity && previousConnectivity.rule ? previousConnectivity.rule + ' ' : ''}duplicates every generated source tile into a ${scale}x${scale} block, so walkable/non-walkable footprints preserve the original route graph while quadrupling walkable tile count at scale 2.`
    };
  }

  function scaleGeneratedTileDensity(scale = GENERATION_TILE_SCALE) {
    if (!Number.isFinite(scale) || scale <= 1 || !map || map.generationScale === scale) return;
    const originalWidth = settings.width;
    const originalHeight = settings.height;
    const originalWalkableTiles = allWalkableTiles().length;
    const previousConnectivity = clonePlain(map.connectivity);
    const newWidth = originalWidth * scale;
    const newHeight = originalHeight * scale;
    const scaledRows = [];
    const scaledFlatTiles = [];

    for (let y = 0; y < newHeight; y++) scaledRows.push([]);
    for (let y = 0; y < originalHeight; y++) {
      for (let x = 0; x < originalWidth; x++) {
        const sourceTile = tileAt(x, y);
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const clone = clonePlain(sourceTile);
            clone.x = x * scale + dx;
            clone.y = y * scale + dy;
            clone.occupiedBy = null;
            scaledRows[clone.y][clone.x] = clone;
            scaledFlatTiles.push(clone);
          }
        }
      }
    }

    map.tiles = scaledRows;
    map.flatTiles = scaledFlatTiles;
    map.width = newWidth;
    map.height = newHeight;
    map.sourceWidth = originalWidth;
    map.sourceHeight = originalHeight;
    map.generationScale = scale;
    map.scaledFrom = { width: originalWidth, height: originalHeight, walkableTiles: originalWalkableTiles };
    settings.width = newWidth;
    settings.height = newHeight;
    settings.sourceWidth = originalWidth;
    settings.sourceHeight = originalHeight;

    map.entry = scaleEntryPoint(map.entry, scale, originalWidth, originalHeight);
    map.objects = (map.objects || []).map(object => scaleGeneratedObject(object, scale));
    rebuildObjectCache();
    for (const tile of allTiles()) tile.occupiedBy = null;
    for (const object of map.objects) if (object.occupies !== false) markOccupied(object);

    scaleGeneratedRivers(scale);
    scaleGeneratedRamps(scale);
    scaleGeneratedPaths(scale);
    scaleGeneratedPlateauGroups(scale);
    if (map.greatBasinEntry && map.greatBasinEntry.target) map.greatBasinEntry.target = scaleMapPoint(map.greatBasinEntry.target, scale);
    scaleGeneratedRewardAnalysis(scale);
    scaleGeneratedDesignAnalysis(scale);
    scaleHiddenNavRampStats(scale);
    refreshConnectivityAfterTileScale(previousConnectivity, originalWalkableTiles, scale);

    const scaledWalkableTiles = map.connectivity ? map.connectivity.walkableTiles : allWalkableTiles().length;
    logDebug(`tile density scale ${scale}x: ${originalWidth}x${originalHeight} -> ${newWidth}x${newHeight}; walkable ${originalWalkableTiles} -> ${scaledWalkableTiles} (target ${originalWalkableTiles * scale * scale})`);
    if (scaledWalkableTiles !== originalWalkableTiles * scale * scale) warn(`tile density scale expected ${originalWalkableTiles * scale * scale} walkable tiles, got ${scaledWalkableTiles}; scaled blockers/water may have changed occupancy.`);
  }

  // ---------------------------------------------------------------------
  // Ported from WildernessMapGeneratorV4412: terrain-preset system (dramatic
  // packed-bleacher plateaus, Great Basin spoon/horseshoe basin, step curves),
  // the boundary-cliff-mode system (follow-map-height / entry-side-cliffs +
  // distant landscape), and the northward plateau-component scanner + late-
  // painted dramatic rivers those presets rely on. Inert unless a callers
  // settings.preset/boundaryMode opt in (see ZONE_CONFIG below).
  // ---------------------------------------------------------------------
  function activeBoundaryModeConfig() {
    return BOUNDARY_PLATEAU_MODES[(settings && settings.boundaryMode) || 'entrySideDistantLandscape'] || BOUNDARY_PLATEAU_MODES.entrySideDistantLandscape;
  }

  function activePresetConfig() {
    return TERRAIN_PRESETS[(settings && settings.preset) || 'custom'] || TERRAIN_PRESETS.custom;
  }

  function activeStepCurveConfig() {
    return STEP_CURVE_MODES[(settings && settings.stepCurve) || 'northernCliffs'] || STEP_CURVE_MODES.northernCliffs;
  }

  function applyGreatBasinBoundarySideExtensions() {
    if (!usesGreatBasinPreset()) return { raised: 0, sideTiles: 0, maxSideTier: 0 };
    let raised = 0;
    let sideTiles = 0;
    let maxSideTier = 0;
    let skipped = 0;
    for (let y = 1; y < settings.height - 1; y++) {
      for (let x = 1; x < settings.width - 1; x++) {
        const tile = tileAt(x, y);
        if (!tile || !usesGreatBasinPreset()) continue;
        if (tile.distantBoundaryLandscape || tile.borderEscarpment || tile.ramp || tile.navRamp || tile.bridge || tile.navBridge || tile.water || tile.waterfall || tile.occupiedBy) {
          skipped++;
          continue;
        }
        const metrics = greatBasinBoundarySideMetrics(x, y);
        if (metrics.sideInfluence <= 0.02) continue;
        const oldTier = tile.elevation || 0;
        const targetTier = greatBasinBoundarySideTargetTier(tile);
        if (targetTier <= oldTier) continue;
        tile.terrain = 'plateau';
        tile.water = false;
        tile.elevation = targetTier;
        tile.height = targetTier;
        tile.generatedPlateauBlobId = `great_basin_late_boundary_side_tier_${targetTier}`;
        tile.greatBasinLateSideExtension = true;
        tile.greatBasinLateSideInfluence = Number(metrics.sideInfluence.toFixed(3));
        tile.greatBasinLateSideBaseTier = greatBasinLinearTierAtTile(x, y);
        tile.greatBasinLateSideTargetTier = targetTier;
        raised++;
        sideTiles++;
        maxSideTier = Math.max(maxSideTier, targetTier);
      }
    }
    if (map.greatBasinSpoonBowl) {
      map.greatBasinSpoonBowl.sideExtensions = {
        raised,
        sideTiles,
        maxSideTier,
        widthRatio: GREAT_BASIN_SIDE_EXTENSION_WIDTH_RATIO,
        maxBoostRatio: GREAT_BASIN_SIDE_EXTENSION_MAX_BOOST_RATIO,
        bowlYSpread: GREAT_BASIN_SIDE_EXTENSION_BOWL_Y_SPREAD
      };
    }
    logDebug(`Great Basin late spoon-side boundary extensions: raised ${raised} tiles, max side tier ${maxSideTier}, width ${(Math.min(settings.width, settings.height) * GREAT_BASIN_SIDE_EXTENSION_WIDTH_RATIO).toFixed(1)} tiles, skipped protected ${skipped}`);
    return { raised, sideTiles, maxSideTier };
  }

  function applyGreatBasinHorseshoeProfile() {
    if (!usesGreatBasinPreset()) return { raised: 0, lowered: 0, filled: 0, linearRows: 0 };
    let raised = 0;
    let lowered = 0;
    let filled = 0;
    let linearRows = 0;
    let variedTiles = 0;
    let largestOffset = 0;
    const tierCoverage = new Map();
    for (let y = 2; y < settings.height - 2; y++) {
      const rowTier = greatBasinLinearBaseTierAtY(y);
      linearRows++;
      for (let x = 2; x < settings.width - 2; x++) {
        const tile = tileAt(x, y);
        if (!canRewriteGreatBasinHorseshoeTile(tile)) continue;
        const oldTier = tile.elevation || 0;
        const tierOutlineOffset = greatBasinTierOutlineRowOffset(x, y);
        const targetTier = greatBasinLinearTierAtTile(x, y);
        largestOffset = Math.max(largestOffset, Math.abs(tierOutlineOffset));
        if (targetTier !== rowTier) variedTiles++;
        tierCoverage.set(targetTier, (tierCoverage.get(targetTier) || 0) + 1);
        if (!targetTier || oldTier === targetTier) continue;
        if (oldTier <= 0) filled++;
        else if (targetTier > oldTier) raised++;
        else lowered++;
        const bowlMetrics = greatBasinSpoonBowlMetrics(x, y);
        tile.water = false;
        tile.terrain = 'plateau';
        tile.elevation = targetTier;
        tile.height = targetTier;
        tile.generatedPlateauBlobId = `great_basin_linear_lerp_tier_${targetTier}`;
        tile.dramaticBleacherShelf = true;
        tile.dramaticBleacherTier = targetTier;
        tile.greatBasinHorseshoeProfile = false;
        tile.greatBasinSpoonProfile = false;
        tile.greatBasinLinearProfile = true;
        tile.greatBasinLinearTier = targetTier;
        tile.greatBasinLinearRowTier = rowTier;
        tile.greatBasinTierOutlineOffset = Number(tierOutlineOffset.toFixed(2));
        tile.greatBasinSpoonBowlDistance = Number(bowlMetrics.bowlBandDistance.toFixed(3));
        tile.greatBasinSpoonRadialDistance = Number(bowlMetrics.radialDistance.toFixed(3));
        tile.greatBasinSpoonArcDistance = Number(bowlMetrics.arcDistance.toFixed(3));
        tile.greatBasinSpoonCircularDistance = Number(bowlMetrics.circularDistance.toFixed(3));
        tile.greatBasinSpoonArcTerraceTier = null;
        tile.greatBasinCenterDistance = Number(clamp(Math.abs((tile.x / Math.max(1, settings.width - 1)) - GREAT_BASIN_SPOON_BOWL_X_RATIO) * 2, 0, 1).toFixed(3));
      }
    }
    const bowlX = greatBasinSpoonBowlCenterX();
    const bowlY = greatBasinSpoonBowlCenterY();
    const bowlRadius = greatBasinSpoonBowlRadius();
    map.greatBasinSpoonBowl = {
      center: { x: Number(bowlX.toFixed(2)), y: Number(bowlY.toFixed(2)) },
      radiusTiles: Number(bowlRadius.toFixed(2)),
      coreRadiusTiles: Number((bowlRadius * GREAT_BASIN_SPOON_BOWL_CORE_RATIO).toFixed(2)),
      xRatio: GREAT_BASIN_SPOON_BOWL_X_RATIO,
      yRatio: GREAT_BASIN_SPOON_BOWL_Y_RATIO,
      radiusRatio: GREAT_BASIN_SPOON_BOWL_RADIUS_RATIO,
      linearHeightLerp: true,
      sideExtensionsAppliedLate: true,
      sideExtensionWidthTiles: Number((Math.min(settings.width, settings.height) * GREAT_BASIN_SIDE_EXTENSION_WIDTH_RATIO).toFixed(2)),
      sideExtensionMaxBoost: Number((settings.maxTier * GREAT_BASIN_SIDE_EXTENSION_MAX_BOOST_RATIO).toFixed(2)),
      tierOutlineVariationTiles: GREAT_BASIN_TIER_OUTLINE_VARIATION_TILES,
      tierOutlineFineVariationTiles: GREAT_BASIN_TIER_OUTLINE_FINE_VARIATION_TILES,
      variedLinearTierTiles: variedTiles,
      largestTierOutlineOffset: Number(largestOffset.toFixed(2)),
      tierCoverage: Object.fromEntries(Array.from(tierCoverage.entries()).sort((a, b) => a[0] - b[0]))
    };
    logDebug(`Great Basin linear height lerp: filled ${filled}, raised ${raised}, lowered ${lowered}, rows ${linearRows}, varied tier-outline tiles ${variedTiles}, largest boundary offset ${largestOffset.toFixed(1)} rows, south tier ${greatBasinLinearBaseTierAtY(settings.height - 1)}, north tier ${greatBasinLinearBaseTierAtY(0)}, spoon-side shelves deferred to late boundary extension pass`);
    return { raised, lowered, filled, linearRows, variedTiles, largestOffset: Number(largestOffset.toFixed(2)) };
  }

  function applyGreatInclineMountainsideProfile() {
    if (!usesDramaticPlateauPreset() || !usesGreatInclineStepCurve() || usesGreatBasinPreset()) return { filled: 0, raised: 0, lowered: 0, peakTier: 0 };
    let filled = 0;
    let raised = 0;
    let lowered = 0;
    let peakTier = 0;
    for (let y = 2; y < settings.height - 2; y++) {
      for (let x = 2; x < settings.width - 2; x++) {
        const tile = tileAt(x, y);
        if (!canRewriteGreatInclineMountainsideTile(tile)) continue;
        const oldTier = tile.elevation || 0;
        const targetTier = greatInclineMountainsideTargetTier(x, y);
        peakTier = Math.max(peakTier, targetTier);
        if (oldTier === targetTier && tile.terrain === 'plateau') continue;
        if (oldTier <= 0) filled++;
        else if (targetTier > oldTier) raised++;
        else lowered++;
        tile.water = false;
        tile.terrain = 'plateau';
        tile.elevation = targetTier;
        tile.height = targetTier;
        tile.generatedPlateauBlobId = `great_incline_mountainside_tier_${targetTier}`;
        tile.dramaticBleacherShelf = false;
        tile.greatInclineMountainsideProfile = true;
      }
    }
    logDebug(`Great Incline mountainside profile: filled ${filled}, raised ${raised}, lowered ${lowered}, peak tier ${peakTier}/${settings.maxTier}, curve uses full max-tier range`);
    return { filled, raised, lowered, peakTier };
  }

  function applyPackedDramaticBleacherTerraces() {
    if (!usesDramaticPlateauPreset()) return { filled: 0, retiered: 0, transitionEdges: 0, shelves: 0, shelfDepth: 0 };
    let filled = 0;
    let retiered = 0;
    const shelfDepth = dramaticBleacherShelfDepth();

    // South-to-north assignment means every generated shelf can compare against the already-solved parent terrain below it.
    for (let y = settings.height - 3; y >= 2; y--) {
      for (let x = 2; x < settings.width - 2; x++) {
        const tile = tileAt(x, y);
        if (!canPackDramaticBleacherTile(tile)) continue;
        let targetTier = dramaticBleacherTargetTier(x, y);
        // new variable: southernSupportTier keeps the bleacher climb local: this tile may equal or rise above nearby southern terrain, but never dip below it.
        let southernSupportTier = 0;
        for (let dx = -1; dx <= 1; dx++) {
          const south = tileAt(x + dx, y + 1);
          if (!south || south.borderEscarpment || south.ramp || south.navRamp) continue;
          southernSupportTier = Math.max(southernSupportTier, south.elevation || 0);
        }
        if (usesGreatInclineStepCurve()) {
          // new variable: limitedSouthernSupport prevents one accidental high southern cliff from dragging the entire Great Incline northward into gentle same-height shelves.
          const limitedSouthernSupport = Math.min(southernSupportTier, targetTier + 1);
          targetTier = clamp(Math.max(targetTier, limitedSouthernSupport), 1, settings.maxTier);
        } else {
          targetTier = clamp(Math.max(targetTier, southernSupportTier), 1, settings.maxTier);
        }
        const oldTier = tile.elevation || 0;
        const wasPlateau = tile.terrain === 'plateau' && oldTier > 0;
        if (!wasPlateau) filled++;
        else if (oldTier !== targetTier) retiered++;
        tile.water = false;
        tile.terrain = 'plateau';
        tile.elevation = targetTier;
        tile.height = targetTier;
        tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || `dramatic_bleacher_shelf_${targetTier}`;
        tile.dramaticBleacherShelf = true;
        tile.dramaticBleacherTier = targetTier;
      }
    }

    const shelfTiers = new Set();
    let transitionEdges = 0;
    for (const tile of allTiles()) {
      if (!tile || tile.elevation <= 0 || tile.borderEscarpment) continue;
      shelfTiers.add(tile.elevation);
      const east = tileAt(tile.x + 1, tile.y);
      const south = tileAt(tile.x, tile.y + 1);
      if (east && east.elevation > 0 && east.elevation !== tile.elevation) transitionEdges++;
      if (south && south.elevation > 0 && south.elevation !== tile.elevation) transitionEdges++;
    }
    logDebug(`packed dramatic bleachers: filled ${filled} gaps, retiered ${retiered} existing tiles, step curve ${settings.stepCurveLabel || 'Northern Cliffs'},${usesGreatBasinPreset() ? ' Great Basin linear lerp + late side shelves active,' : ''} shelf depth ${shelfDepth}, active tiers ${shelfTiers.size}, irregular transition edges ${transitionEdges}`);
    return { filled, retiered, transitionEdges, shelves: shelfTiers.size, shelfDepth };
  }

  function borderEscarpmentLocalWidthAt(x, y) {
    const inward = inwardDirectionForBorderTile(x, y);
    const sideIndex = borderSideIndex(inward.side);
    const tangent = inward.dir.x === 0 ? x : y;
    const maxDepth = borderEscarpmentMaxDepth();
    const slowShelfNoise = noise2(Math.floor(tangent / 12), sideIndex, 73511);
    const midShelfNoise = noise2(Math.floor(tangent / 5), sideIndex, 73529);
    const cornerSpan = maxDepth * 3;
    const nearCorner = x < cornerSpan || y < cornerSpan || x > settings.width - 1 - cornerSpan || y > settings.height - 1 - cornerSpan;
    let localWidth = maxDepth;
    if (slowShelfNoise > 0.55) localWidth += 1;
    if (slowShelfNoise > 0.82) localWidth += 1;
    if (midShelfNoise < 0.16) localWidth -= 1;
    if (usesDramaticPlateauPreset() && slowShelfNoise > 0.34) localWidth += 1;
    if (usesDramaticPlateauPreset() && midShelfNoise > 0.72) localWidth += 1;
    if (nearCorner) localWidth += 1;
    return clamp(localWidth, usesDramaticPlateauPreset() ? 4 : 2, maxDepth + (usesDramaticPlateauPreset() ? 4 : 2));
  }

  function borderEscarpmentMaxDepth() {
    // new variable: maxDepth scales the border wall footprint; used by the boundary plateau pass and the entry gate cutter.
    const factor = usesDramaticPlateauPreset() ? 0.072 : 0.045;
    const maxDepth = Math.round(Math.min(settings.width, settings.height) * factor);
    return usesDramaticPlateauPreset() ? clamp(maxDepth, 5, 9) : clamp(maxDepth, 3, 6);
  }

  function borderSideIndex(side) {
    return { north: 0, east: 1, south: 2, west: 3 }[side] || 0;
  }

  function boundarySideSampleStart(side, depth) {
    if (side === 'north') return { x0: depth, x1: settings.width - 1 - depth, y0: depth, y1: depth, tangentAxis: 'x' };
    if (side === 'south') return { x0: depth, x1: settings.width - 1 - depth, y0: settings.height - 1 - depth, y1: settings.height - 1 - depth, tangentAxis: 'x' };
    if (side === 'west') return { x0: depth, x1: depth, y0: depth, y1: settings.height - 1 - depth, tangentAxis: 'y' };
    return { x0: settings.width - 1 - depth, x1: settings.width - 1 - depth, y0: depth, y1: settings.height - 1 - depth, tangentAxis: 'y' };
  }

  function breakWideDramaticBleacherRows() {
    if (!usesDramaticPlateauPreset()) return { lowered: 0, rows: 0 };
    let lowered = 0;
    let rows = 0;
    const threshold = usesGreatBasinPreset() ? 0.58 : 0.56;
    for (let pass = 0; pass < 4; pass++) {
      let passLowered = 0;
      for (let y = 3; y < settings.height - 3; y++) {
        const counts = new Map();
        let eligible = 0;
        for (let x = 2; x < settings.width - 2; x++) {
          const tile = tileAt(x, y);
          if (!tile || tile.elevation <= 1 || tile.borderEscarpment || tile.water || tile.ramp || tile.navRamp) continue;
          eligible++;
          counts.set(tile.elevation, (counts.get(tile.elevation) || 0) + 1);
        }
        let dominantTier = 0;
        let dominantCount = 0;
        for (const [tier, count] of counts) if (count > dominantCount) { dominantTier = tier; dominantCount = count; }
        if (!dominantTier || dominantCount / Math.max(1, eligible || settings.width) < threshold) continue;
        rows++;
        const lowerTier = dominantTier - 1;
        const spacing = clamp(Math.round(settings.width / 10), 7, 13);
        const offset = Math.floor(noise2(y, dominantTier, 94103 + pass) * spacing);
        for (let x = 2 + offset; x < settings.width - 2; x += spacing) {
          const biteHalf = 2 + Math.floor(noise2(x, y, 94129 + pass) * 3);
          const biteDepth = 4 + Math.floor(noise2(x, y, 94153 + pass) * 6);
          for (let yy = y; yy < Math.min(settings.height - 2, y + biteDepth); yy++) {
            for (let xx = x - biteHalf; xx <= x + biteHalf; xx++) {
              const tile = tileAt(xx, yy);
              if (!tile || tile.elevation !== dominantTier) continue;
              if (!canLowerDramaticBleacherBreak(tile, lowerTier)) continue;
              tile.elevation = lowerTier;
              tile.height = lowerTier;
              tile.terrain = 'plateau';
              tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || `dramatic_bleacher_break_${lowerTier}`;
              tile.dramaticBleacherBreak = true;
              tile.dramaticShelfApron = true;
              tile.dramaticShelfParentTier = lowerTier;
              tile.dramaticShelfChildTier = dominantTier;
              lowered++;
              passLowered++;
            }
          }
        }
      }
      if (!passLowered) break;
    }
    if (lowered) logDebug(`packed bleacher row breaks: lowered ${lowered} tiles across ${rows} wide shelf rows without dropping below southern support`);
    return { lowered, rows };
  }

  function buildBoundaryHeightScan() {
    const maxDepth = borderEscarpmentMaxDepth();
    const scanDepth = maxDepth + 7;
    const sideStats = {};
    for (const side of ['north', 'east', 'south', 'west']) {
      const samples = [];
      const start = boundarySideSampleStart(side, scanDepth);
      if (side === 'north' || side === 'south') {
        for (let x = start.x0; x <= start.x1; x++) {
          for (let off = -2; off <= 2; off++) {
            const tile = tileAt(clamp(x + off, 0, settings.width - 1), start.y0);
            if (canSamplePlayableHeight(tile)) samples.push(tileHeight(tile));
          }
        }
      } else {
        for (let y = start.y0; y <= start.y1; y++) {
          for (let off = -2; off <= 2; off++) {
            const tile = tileAt(start.x0, clamp(y + off, 0, settings.height - 1));
            if (canSamplePlayableHeight(tile)) samples.push(tileHeight(tile));
          }
        }
      }
      const average = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
      const sorted = samples.slice().sort((a, b) => a - b);
      const highIndex = sorted.length ? Math.min(sorted.length - 1, Math.floor(sorted.length * 0.86)) : 0;
      sideStats[side] = {
        side,
        samples: samples.length,
        average: Number(average.toFixed(2)),
        highAverage: Number((sorted[highIndex] || average || 0).toFixed(2)),
        maximum: Number((sorted[sorted.length - 1] || average || 0).toFixed(2)),
        scanDepth
      };
    }
    const totalSamples = Object.values(sideStats).reduce((sum, stat) => sum + stat.samples, 0);
    const weightedAverage = totalSamples
      ? Object.values(sideStats).reduce((sum, stat) => sum + stat.average * stat.samples, 0) / totalSamples
      : 0;
    const result = {
      mode: settings.boundaryMode,
      modeLabel: settings.boundaryModeLabel,
      cliffBoost: settings.boundaryCliffBoost,
      scanDepth,
      totalSamples,
      averagePlayableHeight: Number(weightedAverage.toFixed(2)),
      sides: sideStats
    };
    map.boundaryHeightScan = result;
    return result;
  }

  function canLowerDramaticBleacherBreak(tile, lowerTier) {
    if (!tile || !usesDramaticPlateauPreset()) return false;
    if (!canRewriteDramaticShelfApron(tile)) return false;
    if (tile.water || tile.path || tile.invisiblePath || tile.denRoute || tile.occupiedBy) return false;
    if (tile.elevation <= lowerTier || lowerTier < 1) return false;
    let southernSupportTier = 0;
    for (let dx = -1; dx <= 1; dx++) {
      const south = tileAt(tile.x + dx, tile.y + 1);
      if (!south || south.borderEscarpment || south.water || south.ramp || south.navRamp) continue;
      southernSupportTier = Math.max(southernSupportTier, south.elevation || 0);
    }
    return southernSupportTier <= lowerTier;
  }

  function canPackDramaticBleacherTile(tile) {
    if (!tile || !usesDramaticPlateauPreset()) return false;
    // Leave the map border to the dedicated boundary escarpment pass, and do not rewrite protected/generated routes if this pass is reused later.
    const margin = 2;
    if (tile.x < margin || tile.y < margin || tile.x >= settings.width - margin || tile.y >= settings.height - margin) return false;
    if (tile.designReserve || tile.borderEscarpment || tile.distantBoundaryLandscape || tile.ramp || tile.navRamp || tile.bridge || tile.navBridge || tile.occupiedBy) return false;
    return true;
  }

  function canRewriteDramaticShelfApron(tile) {
    if (!tile) return false;
    // Keep later protected corridors, manual-looking boundaries, ramps, and waterways intact.
    if (tile.designReserve || tile.borderEscarpment || tile.distantBoundaryLandscape || tile.ramp || tile.navRamp || tile.bridge || tile.navBridge || tile.waterfall) return false;
    return true;
  }

  function canRewriteGreatBasinHorseshoeTile(tile) {
    if (!tile || !usesGreatBasinPreset()) return false;
    if (!canPackDramaticBleacherTile(tile)) return false;
    if (tile.water || tile.plateauPond || tile.plateauStream || tile.waterfall) return false;
    if (tile.path || tile.invisiblePath || tile.denRoute || tile.occupiedBy) return false;
    return true;
  }

  function canRewriteGreatInclineMountainsideTile(tile) {
    if (!tile || !usesDramaticPlateauPreset() || !usesGreatInclineStepCurve() || usesGreatBasinPreset()) return false;
    if (!canPackDramaticBleacherTile(tile)) return false;
    if (tile.water || tile.plateauPond || tile.plateauStream || tile.waterfall) return false;
    if (tile.path || tile.invisiblePath || tile.denRoute || tile.occupiedBy) return false;
    return true;
  }

  function canSamplePlayableHeight(tile) {
    if (!tile || tile.water || tile.borderEscarpment || tile.distantBoundaryLandscape || tile.cliffSkirt) return false;
    if (tile.ramp || tile.navRamp) return false;
    return true;
  }

  function choosePaintedRiverBaseWidth() {
    // new variable: paintedWidth keeps dramatic rivers readable without carving huge canyon trenches into the terrain.
    return weightedPick([{ value: 4, weight: 36 }, { value: 5, weight: 46 }, { value: 6, weight: 18 }]);
  }

  function clampDramaticTierAboveSouthernTerrain(rawTier, x, y) {
    if (!usesDramaticPlateauPreset()) return rawTier;
    const southernFloor = dramaticSouthernTerrainFloorTier(x, y);
    const localCap = clamp(Math.max(northwardMaxTierAtY(y), southernFloor + 1), 1, settings.maxTier);
    return clamp(Math.max(Math.round(rawTier), southernFloor + 1), 1, localCap);
  }

  function collectScannerPlateauBody(start) {
    const tiles = [];
    const keys = new Set();
    const stack = [start];
    while (stack.length) {
      const tile = stack.pop();
      if (!sameScannerPlateauBody(start, tile)) continue;
      const key = tileKey(tile.x, tile.y);
      if (keys.has(key)) continue;
      keys.add(key);
      tiles.push(tile);
      for (const neighbor of cardinalNeighbors(tile.x, tile.y)) {
        if (neighbor && sameScannerPlateauBody(start, neighbor) && !keys.has(tileKey(neighbor.x, neighbor.y))) stack.push(neighbor);
      }
    }
    return { tiles, keys, startTier: start.elevation, startGroupId: start.plateauGroupId || null };
  }

  function connectGreatBasinEntryToHighestPlateau(entry, targetInfo) {
    if (!entry || !targetInfo || !targetInfo.tile) return { painted: 0, height: 0, target: null };
    const inward = inwardDirectionForBorderTile(entry.x, entry.y);
    const gateDepth = borderEscarpmentMaxDepth() + 6;
    const start = {
      x: clamp(entry.x + inward.dir.x * gateDepth, 0, settings.width - 1),
      y: clamp(entry.y + inward.dir.y * gateDepth, 0, settings.height - 1)
    };
    const target = { x: targetInfo.tile.x, y: targetInfo.tile.y };
    const height = targetInfo.height;
    const radius = Math.max(2, Math.round(borderEscarpmentMaxDepth() * 0.38));
    let painted = 0;
    let x = start.x;
    let y = start.y;
    painted += paintHighEntryRoadTile(x, y, height, radius, 'greatBasinHighEntryRoad');

    // new variable: verticalFirst keeps the north-entry road visibly continuing inward before it bends toward the high basin plateau.
    const verticalFirst = inward.dir.x === 0;
    const stepToward = (axis) => {
      if (axis === 'x' && x !== target.x) x += Math.sign(target.x - x);
      if (axis === 'y' && y !== target.y) y += Math.sign(target.y - y);
      painted += paintHighEntryRoadTile(x, y, height, radius, 'greatBasinHighEntryRoad');
    };
    let safety = settings.width + settings.height + 60;
    while (safety-- > 0 && (x !== target.x || y !== target.y)) {
      const dx = Math.abs(target.x - x);
      const dy = Math.abs(target.y - y);
      if (verticalFirst && y !== target.y && (dy > 4 || dx < 6)) stepToward('y');
      else if (!verticalFirst && x !== target.x && (dx > 4 || dy < 6)) stepToward('x');
      else if (dx >= dy && x !== target.x) stepToward('x');
      else if (y !== target.y) stepToward('y');
      else if (x !== target.x) stepToward('x');
    }

    for (let yy = target.y - radius - 1; yy <= target.y + radius + 1; yy++) {
      for (let xx = target.x - radius - 1; xx <= target.x + radius + 1; xx++) {
        if (inBounds(xx, yy)) painted += paintHighEntryRoadTile(xx, yy, height, Math.max(1, radius - 1), 'greatBasinHighPlateauJoin');
      }
    }
    map.greatBasinEntry = { target: { x: target.x, y: target.y }, height, paintedTiles: painted };
    logDebug(`Great Basin preset: north entry road raised to highest walkable plateau height ${height}, connected to ${target.x},${target.y}, painted ${painted} high-road tiles`);
    return { painted, height, target };
  }

  function considerScannerSupport(best, candidate, reason) {
    if (candidate === null || candidate === undefined) return best;
    if (!best || candidate.height > best.height) return { height: candidate.height, reason };
    return best;
  }

  function dramaticBleacherShelfDepth() {
    // new variable: dramaticBleacherShelfDepth controls the north/south runway depth of each shared parent shelf.
    const mapMin = Math.min(settings.width, settings.height);
    return clamp(Math.round(mapMin / Math.max(7, settings.maxTier + 1)), 6, 11);
  }

  function dramaticBleacherTargetTier(x, y) {
    let baseTier;
    if (usesGreatInclineStepCurve()) {
      // new variable: inclineWave keeps Great Incline from becoming a perfectly straight contour map while preserving the smooth south-to-north steepening.
      const inclineWave = dramaticBleacherWaveOffset(x, y) / Math.max(16, settings.height * 0.95);
      baseTier = Math.round(1 + (settings.maxTier - 1) * clamp(northwardRiseProgressAtY(y) + inclineWave * 0.35, 0, 1));
    } else {
      // new variable: southToNorthRank is where this tile sits in the bleacher climb, with larger values farther north.
      const southToNorthRank = (settings.height - 1 - y) + dramaticBleacherWaveOffset(x, y);
      const shelfDepth = dramaticBleacherShelfDepth();
      baseTier = 1 + Math.floor(southToNorthRank / Math.max(1, shelfDepth));
    }
    // new variable: sideVariation gives east/west shelves dramatic local spikes and troughs, including the Great Basin linear lerp + late side shelves sides, while the later support clamp prevents dips below southern support terrain.
    const sideVariationScale = usesGreatInclineStepCurve() ? 0.42 : 0.52;
    const sideVariation = Math.round(dramaticEastWestTierOffset(x, y) * sideVariationScale);
    return clamp(baseTier + sideVariation, 1, settings.maxTier);
  }

  function dramaticBleacherWaveOffset(x, y) {
    // new variable: dramaticBleacherWaveOffset staggers bleacher step lines so they climb clearly northward without becoming straight cake bands.
    const nx = x / Math.max(1, settings.width - 1);
    const broad = Math.sin(nx * Math.PI * 6.6 + noise2(Math.floor(y / 13), 0, 93101) * Math.PI * 2) * 8.0;
    const regional = (noise2(Math.floor(x / 10), Math.floor(y / 9), 93133) - 0.5) * 10.0;
    const local = (noise2(Math.floor(x / 4), Math.floor(y / 5), 93169) - 0.5) * 3.0;
    return broad + regional + local;
  }

  function dramaticEastWestTierOffset(x, y) {
    if (!usesDramaticPlateauPreset()) return 0;
    const w = Math.max(1, settings.width - 1);
    const h = Math.max(1, settings.height - 1);
    const nx = x / w;
    const ny = y / h;
    // new variable: ridgeWave creates broad east/west height ridges and troughs; used by dramatic presets before the southern-floor clamp keeps troughs above the approach shelf.
    const ridgeWave = usesGreatBasinPreset() ? 0 : Math.sin(nx * Math.PI * 4.35 + noise2(Math.floor(y / 11), 0, 87131) * Math.PI * 2) * 1.45;
    const regionalScale = usesGreatBasinPreset() ? 1.25 : 4.25;
    const localScale = usesGreatBasinPreset() ? 0.75 : 1.35;
    const diagonalScale = usesGreatBasinPreset() ? 0.32 : 0.85;
    const regional = (noise2(Math.floor(x / 14), Math.floor(y / 11), 87151) - 0.5) * regionalScale;
    const local = (noise2(Math.floor(x / 5), Math.floor(y / 5), 87179) - 0.5) * localScale;
    const diagonal = Math.sin((nx * 2.1 - ny * 1.35) * Math.PI * 2.0) * diagonalScale;
    // Great Basin now applies its spoon-side shelves in a later boundary-side pass, so the early east/west jitter stays decorative only.
    return ridgeWave + regional + local + diagonal;
  }

  function dramaticShelfApronLength() {
    // new variable: dramaticShelfApronLength is used by Cliffs/Great Basin to reserve lower walkable shelf space south of each child plateau face.
    const mapMin = Math.min(settings.width, settings.height);
    return clamp(Math.round(mapMin * 0.075), 6, 12);
  }

  function dramaticSouthernTerrainFloorTier(x, y) {
    if (!usesDramaticPlateauPreset()) return 0;
    // new variable: floorSampleY represents the parent terrain south of this potential child plateau; used so east-west troughs remain above the approach shelf instead of sinking into it.
    const floorSampleY = clamp(Math.round(y + dramaticShelfApronLength()), 0, settings.height - 1);
    const rowFloor = Math.floor(northwardTierFloatAtY(floorSampleY));
    // new variable: southernBandDip lets the parent floor inherit a little broad east-west valley/ridge character without ever outranking the child plateau minimum.
    const southernBandDip = Math.floor(Math.min(0, dramaticEastWestTierOffset(x, floorSampleY)) * 0.28);
    return clamp(rowFloor + southernBandDip, 0, Math.max(0, settings.maxTier - 1));
  }

  function enforceDramaticPlateauTroughFloors() {
    if (!usesDramaticPlateauPreset()) return { raised: 0, checked: 0 };
    let raised = 0;
    let checked = 0;
    for (const tile of allTiles()) {
      if (!tile || tile.elevation <= 0 || tile.dramaticShelfApron) continue;
      if (!canRewriteDramaticShelfApron(tile)) continue;
      const minimumTier = clampDramaticTierAboveSouthernTerrain(tile.elevation, tile.x, tile.y);
      checked++;
      if (minimumTier > tile.elevation) {
        tile.elevation = minimumTier;
        tile.height = Math.max(tile.height || minimumTier, minimumTier);
        tile.terrain = 'plateau';
        tile.dramaticSouthernFloorClamp = true;
        raised++;
      }
    }
    if (raised) logDebug(`dramatic east-west trough clamp: raised ${raised}/${checked} non-apron plateau tiles above their southern parent terrain floor`);
    return { raised, checked };
  }

  function enforceDramaticPresetColumnClimb() {
    // This used to raise whole north/south columns, which made Cliffs/Great Basin look like giant slices of cake.
    // V42 keeps only the broad northward climb, then carves/paints lower parent-shelf aprons south of higher child plateaus; the final scanner is local/segmented so it cannot erase those shelves into cake bands.
    let raised = 0;
    let lowered = 0;
    let childEdges = 0;
    let apronTiles = 0;
    let openedCakeRows = 0;
    const apronLength = dramaticShelfApronLength();

    for (const tile of allTiles()) {
      if (!tile || tile.elevation <= 0) continue;
      const cap = northwardMaxTierAtY(tile.y);
      if (tile.elevation > cap) {
        tile.elevation = cap;
        tile.height = Math.min(tile.height || cap, cap);
        tile.terrain = tile.elevation > 0 ? 'plateau' : 'grass';
        lowered++;
      }
    }

    const southFacingChildEdges = [];
    for (const tile of allTiles()) {
      if (!tile || tile.elevation < 2) continue;
      const south = tileAt(tile.x, tile.y + 1);
      if (!south || south.elevation >= tile.elevation) continue;
      southFacingChildEdges.push(tile);
    }

    // South-to-north order makes the first approach shelf win before higher/northern children add their own shelves.
    southFacingChildEdges.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const edge of southFacingChildEdges) {
      const childTier = edge.elevation;
      const parentTier = Math.max(1, childTier - 1);
      const baseRadius = 2 + Math.floor(noise2(edge.x, edge.y, 91307) * 3);
      childEdges++;
      for (let dy = 1; dy <= apronLength; dy++) {
        const yy = edge.y + dy;
        if (!inBounds(edge.x, yy)) break;
        const taper = dy > apronLength * 0.66 ? 1 : 0;
        const radius = Math.max(1, baseRadius - taper);
        for (let xx = edge.x - radius; xx <= edge.x + radius; xx++) {
          if (!inBounds(xx, yy)) continue;
          const lateral = Math.abs(xx - edge.x);
          if (lateral > radius) continue;
          const raggedKeep = lateral === radius && noise2(xx, yy, 91331 + childTier) < 0.36;
          if (raggedKeep) continue;
          const target = tileAt(xx, yy);
          if (!target) continue;
          // Higher tiers south of this child are exactly the cake-slice problem; lower them into the parent shelf.
          // Empty or too-low cells are lifted so the shelf is actually walkable room, not a moat/gap.
          if (target.elevation >= childTier || target.elevation < parentTier || target.terrain !== 'plateau') {
            if (paintDramaticShelfApronTile(target, parentTier, childTier)) {
              apronTiles++;
              if ((target.elevation || 0) > (target.dramaticShelfParentTier || parentTier)) raised++;
            }
          }
        }
      }
    }

    // Last light touch: if one dramatic tier spans almost the whole row, lower a few ragged vertical bites
    // back to its parent tier so the map reads as nested mesas with side valleys instead of a full-width cake layer.
    const minTierForBites = 3;
    const rowThreshold = usesGreatBasinPreset() ? 0.76 : 0.70;
    for (let y = 2; y < settings.height - 2; y++) {
      const counts = new Map();
      for (let x = 0; x < settings.width; x++) {
        const t = tileAt(x, y);
        if (t && t.elevation >= minTierForBites && !t.borderEscarpment) counts.set(t.elevation, (counts.get(t.elevation) || 0) + 1);
      }
      for (const [tier, count] of counts) {
        if (count / Math.max(1, settings.width) < rowThreshold) continue;
        const spacing = clamp(Math.round(settings.width / 7), 10, 18);
        for (let x = Math.floor(noise2(y, tier, 91421) * spacing); x < settings.width; x += spacing) {
          const biteHalf = 1 + Math.floor(noise2(x, y, 91439) * 2);
          const biteDepth = 2 + Math.floor(noise2(x, y, 91457) * 4);
          for (let yy = y; yy < Math.min(settings.height - 1, y + biteDepth); yy++) {
            for (let xx = x - biteHalf; xx <= x + biteHalf; xx++) {
              const t = tileAt(xx, yy);
              if (!t || t.elevation !== tier || !canRewriteDramaticShelfApron(t)) continue;
              if (paintDramaticShelfApronTile(t, tier - 1, tier)) { apronTiles++; openedCakeRows++; }
            }
          }
        }
      }
    }

    const troughFloorClamp = enforceDramaticPlateauTroughFloors();
    raised += troughFloorClamp.raised;
    logDebug(`dramatic parent-shelf aprons: ${apronTiles} tiles painted from ${childEdges} child south edges, apron length ${apronLength}, cake-row bites ${openedCakeRows}, east-west trough floor raises ${troughFloorClamp.raised}`);
    return { raised, lowered, apronTiles, childEdges, openedCakeRows, troughFloorRaises: troughFloorClamp.raised };
  }

  function enforceNorthwardRowScanner() {
    if (!usesDramaticPlateauPreset()) {
      logDebug('northward plateau-component scanner: skipped for custom preset');
      return { raisedTiles: 0, raisedComponents: 0, violationsDetected: 0, waterfallCandidates: 0, skippedBoundarySources: 0, protectedAprons: 0, worstSameTierRowShare: 0 };
    }

    let raisedTiles = 0;
    let raisedComponents = 0;
    let violationsDetected = 0;
    let skippedBoundarySources = 0;
    let cappedTargets = 0;
    const beforeCake = measureMaxSameTierRowShare();
    const maxPasses = Math.max(4, Math.min(14, settings.maxTier + 3));

    for (let pass = 0; pass < maxPasses; pass++) {
      let passRaisedComponents = 0;
      const seen = new Set();
      for (let y = settings.height - 2; y >= 0; y--) {
        for (let x = 0; x < settings.width; x++) {
          const tile = tileAt(x, y);
          if (!tile) continue;
          if (tile.borderEscarpment && !tile.water) { skippedBoundarySources++; continue; }
          if (!scannerTileCanBePlateauCandidate(tile)) continue;
          const key = tileKey(tile.x, tile.y);
          if (seen.has(key)) continue;
          const body = collectScannerPlateauBody(tile);
          for (const bodyKey of body.keys) seen.add(bodyKey);
          const supportHeight = scannerSouthernSupportForBody(body);
          if (supportHeight === null || body.startTier >= supportHeight) continue;
          violationsDetected++;
          const targetHeight = Math.min(settings.maxTier, supportHeight);
          if (targetHeight < supportHeight) cappedTargets++;
          const bodyRaisedTiles = raiseScannerPlateauBody(body, targetHeight);
          if (bodyRaisedTiles > 0) {
            raisedTiles += bodyRaisedTiles;
            raisedComponents++;
            passRaisedComponents++;
          }
        }
      }
      if (!passRaisedComponents) break;
    }

    const rowBreaks = breakWideDramaticBleacherRows();
    const afterCake = measureMaxSameTierRowShare();
    logDebug(`northward plateau-component scanner: detected ${violationsDetected} low child-plateau bodies, raised ${raisedComponents} whole plateau bodies / ${raisedTiles} tiles, capped ${cappedTargets} targets at max tier, ignored ${skippedBoundarySources} boundary-wall sources, row-break lowered ${rowBreaks.lowered} tiles, worst same-tier row ${Math.round(beforeCake.worstShare * 100)}% -> ${Math.round(afterCake.worstShare * 100)}%`);
    return { raisedTiles, raisedComponents, violationsDetected, waterfallCandidates: 0, skippedBoundarySources, protectedAprons: rowBreaks.lowered, worstSameTierRowShare: afterCake.worstShare };
  }

  function entryGateWaterCount(candidate, halfWidth, gateDepth) {
    const inward = inwardDirectionForBorderTile(candidate.x, candidate.y);
    const sideTangent = inward.dir.x === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
    let water = 0;
    let invalid = 0;
    for (let t = -halfWidth; t <= halfWidth; t++) {
      for (let d = 0; d <= gateDepth; d++) {
        const x = candidate.x + sideTangent.x * t + inward.dir.x * d;
        const y = candidate.y + sideTangent.y * t + inward.dir.y * d;
        if (!inBounds(x, y)) { invalid++; continue; }
        const tile = tileAt(x, y);
        if (!tile || tile.water) water++;
      }
    }
    return water + invalid * 2;
  }

  // WildernessMapGeneratorV4412 samples a single straight-ahead tile here, so
  // the whole gate corridor (openBorderEntryGate flattens every tile in it to
  // this one value) can land on top of a random dramatic-preset spike a few
  // tiles past the gate — the entry becomes a flat shelf perched on a
  // plateau instead of stepping onto low ground. Sample across the gate's
  // full width over the same depth band and take a low-percentile height
  // instead of one straight-ahead point, so a single stray spike can't
  // dictate the whole entrance while still tracking genuinely low interior
  // terrain (not necessarily the literal minimum, which could be a canyon or
  // pond edge).
  function findEntryGateInteriorHeight(entry, inward, gateDepth) {
    const tangent = inward.dir.x === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const halfWidth = Math.max(2, Math.round(borderEscarpmentMaxDepth() * 0.75));
    const samples = [];
    for (let d = gateDepth + 1; d <= gateDepth + 10; d++) {
      for (let t = -halfWidth; t <= halfWidth; t++) {
        const x = clamp(entry.x + inward.dir.x * d + tangent.x * t, 0, settings.width - 1);
        const y = clamp(entry.y + inward.dir.y * d + tangent.y * t, 0, settings.height - 1);
        const tile = tileAt(x, y);
        if (tile && !tile.water && !tile.borderEscarpment) samples.push(tileHeight(tile));
      }
    }
    if (!samples.length) return 0;
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length * 0.15)];
  }

  function generateLatePaintedRivers() {
    if (!usesDramaticPlateauPreset()) {
      logDebug('late painted rivers: skipped for custom preset; canyon rivers already generated');
      return { rivers: 0, tiles: 0 };
    }
    if (settings.rivers <= 0) {
      logDebug('late painted rivers: skipped because river count is 0');
      return { rivers: 0, tiles: 0 };
    }

    let paintedTiles = 0;
    for (let i = 0; i < settings.rivers; i++) {
      const start = borderPoint('random', 1);
      const end = borderPoint(oppositeOrDifferentSide(start.side), 1);
      const baseWidth = choosePaintedRiverBaseWidth();
      const changeEvery = randInt(8, 15);
      const widthSalt = randInt(1, 999999);
      const points = [];
      const widthSamples = [];
      let x = start.x;
      let y = start.y;
      const maxSteps = (settings.width + settings.height) * 5;
      let wobble = randFloat(-0.85, 0.85);

      for (let step = 0; step < maxSteps; step++) {
        const currentWidth = riverWidthForStep(baseWidth, step, changeEvery, widthSalt);
        points.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), widthTiles: currentWidth });
        widthSamples.push(currentWidth);
        const dx = end.x - x;
        const dy = end.y - y;
        const dist = Math.max(0.001, Math.hypot(dx, dy));
        const nx = dx / dist;
        const ny = dy / dist;
        const px = -ny;
        const py = nx;
        wobble += randFloat(-0.18, 0.18);
        wobble *= 0.90;
        x += nx * randFloat(0.54, 0.92) + px * wobble;
        y += ny * randFloat(0.54, 0.92) + py * wobble;
        const tx = Math.round(x);
        const ty = Math.round(y);
        if (inBounds(tx, ty)) {
          paintedTiles += markWater(tx, ty, 'river', currentWidth, { carveRiverBed: false }) || 0;
        }
        if (dist < 1.35 && !inBounds(tx, ty)) break;
        if (step > 8 && !inBounds(tx, ty)) {
          const leftNorth = tx < -2 || ty < -2;
          const leftSouthEast = tx > settings.width + 1 || ty > settings.height + 1;
          if (leftNorth || leftSouthEast) break;
        }
      }
      points.push({ ...end, widthTiles: widthSamples[widthSamples.length - 1] || baseWidth });
      const widthMin = Math.min(...widthSamples);
      const widthMax = Math.max(...widthSamples);
      const widthAverage = widthSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, widthSamples.length);
      map.rivers.push({
        id: `river_${i + 1}`,
        fromBorder: start.side,
        toBorder: end.side,
        widthTiles: Number(widthAverage.toFixed(2)),
        widthTilesAverage: Number(widthAverage.toFixed(2)),
        minimumWidthTiles: widthMin,
        maximumWidthTiles: widthMax,
        widthSamples,
        points,
        paintedLate: true,
        carving: false
      });
      logDebug(`late painted river ${i + 1}: ${start.side} border to ${end.side} border, widths ${widthMin}-${widthMax}, avg ${widthAverage.toFixed(2)}, no erosion carving`);
    }
    logDebug(`late painted rivers: ${settings.rivers} rivers painted over finished tiers, ${paintedTiles} new river tiles; waterfalls are assigned by cliff-skirt height breaks`);
    return { rivers: settings.rivers, tiles: paintedTiles };
  }

  function greatBasinBoundarySideMetrics(x, y) {
    const widthTiles = Math.max(3, Math.min(settings.width, settings.height) * GREAT_BASIN_SIDE_EXTENSION_WIDTH_RATIO);
    // new variable: sideDistance is the closest east/west boundary distance; used by the late spoon-side extension pass.
    const sideDistance = Math.min(x, Math.max(0, settings.width - 1 - x));
    // new variable: sideInfluence is strongest along the east/west boundaries and eases toward the basin center.
    const sideInfluence = Math.pow(clamp(1 - sideDistance / widthTiles, 0, 1), 1.18);
    const bowlY = greatBasinSpoonBowlCenterY();
    const ySpread = Math.max(4, settings.height * GREAT_BASIN_SIDE_EXTENSION_BOWL_Y_SPREAD);
    // new variable: bowlLatitudeInfluence keeps the side shelves most obvious around the southern spoon bowl, then lets them fade into the northward incline.
    const bowlLatitudeInfluence = Math.pow(clamp(1 - Math.abs(y - bowlY) / ySpread, 0, 1), 0.72);
    const northness = normalizedNorthnessAtY(y);
    // new variable: northFade prevents already-high northern rows from being crushed into one max-height wall by the side-extension boost.
    const northFade = clamp(1 - northness * 0.48, 0.42, 1);
    // new variable: southLipInfluence adds a small cup-lip rise close to the south edge without forming a full surrounding wall.
    const southLipInfluence = Math.pow(clamp(1 - y / Math.max(1, settings.height * 0.28), 0, 1), 1.8) * 0.24;
    return { widthTiles, sideDistance, sideInfluence, bowlLatitudeInfluence, northFade, southLipInfluence };
  }

  function greatBasinBoundarySideTargetTier(tile) {
    if (!tile || !usesGreatBasinPreset()) return 0;
    const baseTier = greatBasinLinearTierAtTile(tile.x, tile.y);
    const metrics = greatBasinBoundarySideMetrics(tile.x, tile.y);
    const maxBoost = Math.max(1, settings.maxTier * GREAT_BASIN_SIDE_EXTENSION_MAX_BOOST_RATIO);
    // new variable: sideBoost raises the late spoon sides from the already-solved linear basin terrain.
    const sideBoost = Math.round(maxBoost * metrics.sideInfluence * (0.34 + metrics.bowlLatitudeInfluence * 0.66) * metrics.northFade + maxBoost * metrics.southLipInfluence * metrics.sideInfluence);
    const noisyEdge = Math.round((noise2(Math.floor(tile.x / 7), Math.floor(tile.y / 11), 99631) - 0.5) * metrics.sideInfluence * 1.2);
    return clamp(baseTier + sideBoost + noisyEdge, 1, settings.maxTier);
  }

  function greatBasinHorseshoeTierOffset(x, y) {
    return greatBasinSpoonTierOffset(x, y);
  }

  function greatBasinLinearBaseTierAtY(y) {
    if (!usesGreatBasinPreset()) return 0;
    // new variable: linearProgress is the Great Basin's direct south-to-north height lerp, independent of the dramatic Step Curve selector.
    const linearProgress = normalizedNorthnessAtY(y);
    return clamp(Math.round(1 + (settings.maxTier - 1) * linearProgress), 1, settings.maxTier);
  }

  function greatBasinLinearTierAtTile(x, y) {
    if (!usesGreatBasinPreset()) return 0;
    // new variable: shiftedSampleY preserves the linear south-to-north height range while changing where each tier boundary crosses this local area.
    const shiftedSampleY = clamp(y + greatBasinTierOutlineRowOffset(x, y), 0, settings.height - 1);
    return greatBasinLinearBaseTierAtY(shiftedSampleY);
  }

  function greatBasinSpoonBowlCenterX() {
    return (settings.width - 1) * GREAT_BASIN_SPOON_BOWL_X_RATIO;
  }

  function greatBasinSpoonBowlCenterY() {
    return (settings.height - 1) * GREAT_BASIN_SPOON_BOWL_Y_RATIO;
  }

  function greatBasinSpoonBowlMetrics(x, y) {
    // new variable: bowlCenterX is used by Great Basin radial bowl shaping and tile/debug metadata.
    const bowlCenterX = greatBasinSpoonBowlCenterX();
    // new variable: bowlCenterY is used by Great Basin radial bowl shaping and tile/debug metadata.
    const bowlCenterY = greatBasinSpoonBowlCenterY();
    // new variable: bowlRadiusTiles is used to normalize circular distance from the spoon bowl center.
    const bowlRadiusTiles = greatBasinSpoonBowlRadius();
    // new variable: bowlDx measures horizontal tile distance from the circular bowl center for the radial spoon profile.
    const bowlDx = (x - bowlCenterX) / bowlRadiusTiles;
    // new variable: bowlDy measures vertical tile distance from the circular bowl center for the radial spoon profile.
    const bowlDy = (y - bowlCenterY) / bowlRadiusTiles;
    // new variable: circularDistance preserves true round distance for debug comparison after the spoon drop is stretched.
    const circularDistance = Math.sqrt(bowlDx * bowlDx + bowlDy * bowlDy);
    // new variable: stretchedBowlDy compresses north/south distance so the Great Basin drop becomes long spoon arcs rather than a tight round pit.
    const stretchedBowlDy = bowlDy / GREAT_BASIN_SPOON_VERTICAL_STRETCH;
    // new variable: arcDistance is the wide-terrace distance used by Great Basin height shaping; equal-height bands become long elliptical arcs of land.
    const arcDistance = Math.sqrt(bowlDx * bowlDx + stretchedBowlDy * stretchedBowlDy);
    // new variable: radialDistance is kept as the shaping/debug distance expected by older exports, now mapped to the stretched arc distance.
    const radialDistance = arcDistance;
    // new variable: normalizedY is used by Great Basin to fade the circular bowl influence north/south.
    const normalizedY = y / Math.max(1, settings.height - 1);
    // new variable: bowlBandDistance measures how far this tile is from the bowl's north/south latitude.
    const bowlBandDistance = Math.abs(normalizedY - GREAT_BASIN_SPOON_BOWL_Y_RATIO);
    // new variable: bowlBandInfluence keeps the circular cup strongest near its southern bowl latitude, now with a wider north/south spread so the spoon drop is not over-centralized.
    const bowlBandInfluence = Math.pow(clamp(1 - bowlBandDistance / 0.56, 0, 1), 0.82);
    return { bowlCenterX, bowlCenterY, bowlRadiusTiles, bowlDx, bowlDy, circularDistance, stretchedBowlDy, arcDistance, radialDistance, normalizedY, bowlBandDistance, bowlBandInfluence };
  }

  function greatBasinSpoonBowlRadius() {
    // new variable: bowlRadiusTiles converts the configured radius ratio into actual source-map tiles for the circular Great Basin bowl.
    const bowlRadiusTiles = Math.max(4, Math.min(settings.width, settings.height) * GREAT_BASIN_SPOON_BOWL_RADIUS_RATIO);
    return bowlRadiusTiles;
  }

  function greatBasinSpoonTierOffset(x, y) {
    if (!usesGreatBasinPreset()) return 0;
    const metrics = greatBasinSpoonBowlMetrics(x, y);
    const ny = metrics.normalizedY;
    // new variable: southBowlInfluence keeps the circular rim sharp near the southern bowl and gradually calmer to the north.
    const southBowlInfluence = smoothstep(clamp((ny - 0.18) / 0.62, 0, 1));
    // new variable: northHandleFade weakens radial side-rise as the spoon stretches north into a subtler handle.
    const northHandleFade = clamp((ny - 0.18) / Math.max(0.01, GREAT_BASIN_SPOON_BOWL_Y_RATIO - 0.18), 0, 1);
    // new variable: tierScale makes the spoon walls and circular bowl depression stay visible when max vertical tier is raised for Great Incline.
    const tierScale = clamp(settings.maxTier / 9, 1, 3.2);
    // new variable: circularCoreDip creates a wider flattish low circle so the spoon has a basin floor, not a pinpoint pit.
    const circularCoreDip = Math.pow(clamp(1 - metrics.radialDistance / GREAT_BASIN_SPOON_BOWL_CORE_RATIO, 0, 1), 0.78);
    // new variable: circularCupDip stretches the depression far beyond the core so the drop is gradual across the spoon cup.
    const circularCupDip = Math.pow(clamp(1 - metrics.radialDistance / GREAT_BASIN_SPOON_DROP_SPREAD, 0, 1), 1.05);
    // new variable: stretchedCupShoulderDip adds a shallow middle shelf between the basin floor and outer rim.
    const stretchedCupShoulderDip = Math.pow(clamp(1 - metrics.radialDistance / (GREAT_BASIN_SPOON_DROP_SPREAD * 1.28), 0, 1), 1.85);
    // new variable: radialWallRise raises terrain by circular distance from the bowl center, delayed so the widened low basin can stretch before climbing.
    const radialWallRise = Math.pow(smoothstep(clamp((metrics.radialDistance - GREAT_BASIN_SPOON_WALL_START) / 1.36, 0, 1)), 0.95);
    // new variable: circularRimRise emphasizes a broad outer lip instead of a tight bullseye ring around the low cup.
    const circularRimRise = Math.pow(clamp(1 - Math.abs(metrics.radialDistance - GREAT_BASIN_SPOON_RIM_DISTANCE) / GREAT_BASIN_SPOON_RIM_WIDTH, 0, 1), 0.92);
    // new variable: sideRiseStrength controls how strongly radial distance raises the basin walls near the circular bowl.
    const sideRiseStrength = tierScale * (0.35 + 2.55 * metrics.bowlBandInfluence) * (0.42 + 0.78 * northHandleFade);
    // new variable: sideRise raises terrain in every direction away from the circular bowl center, but starts later to keep the drop stretched.
    const sideRise = radialWallRise * sideRiseStrength;
    // new variable: rimRise adds a rounded cup lip around the widened depression.
    const rimRise = circularRimRise * metrics.bowlBandInfluence * tierScale * (0.75 + 0.45 * southBowlInfluence);
    // new variable: bowlDip lowers the round spoon bottom across a broad area instead of concentrating the full drop near the exact center.
    const bowlDip = (circularCoreDip * 0.66 + circularCupDip * 1.28 + stretchedCupShoulderDip * 0.74) * metrics.bowlBandInfluence * tierScale * 1.72;
    // new variable: southLipRise lifts the southern rim behind the bowl gently, so the cup edge does not become a steep central wall.
    const southLipRise = Math.pow(clamp((y - metrics.bowlCenterY) / Math.max(1, settings.height - 1 - metrics.bowlCenterY), 0, 1), 1.35) * (1 - clamp(metrics.radialDistance * 0.22, 0, 0.66)) * tierScale * 0.88;
    // new variable: asymmetricRaggedness prevents the circular spoon bowl from becoming a mathematically perfect bullseye.
    const asymmetricRaggedness = (noise2(Math.floor(x / 10), Math.floor(y / 10), 97241) - 0.5) * 0.22 * (0.35 + metrics.bowlBandInfluence);
    return sideRise + rimRise + southLipRise - bowlDip + asymmetricRaggedness;
  }

  function greatBasinTierOutlineRowOffset(x, y) {
    if (!usesGreatBasinPreset()) return 0;
    const width = Math.max(1, settings.width - 1);
    const height = Math.max(1, settings.height - 1);
    const nx = x / width;
    const ny = y / height;
    // new variable: broadShelfWobble is used by Great Basin's gentle slope to push whole tier boundaries north/south in wide arcs without changing the total south-to-north height range.
    const broadShelfWobble = (noise2(Math.floor(x / 12), Math.floor(y / 16), GREAT_BASIN_TIER_OUTLINE_BAND_SALT) - 0.5) * 2;
    // new variable: regionalBite adds medium-sized missing/fat areas to each tier's footprint; used only as a row-sample offset, not as direct height noise.
    const regionalBite = (noise2(Math.floor(x / 6), Math.floor(y / 9), GREAT_BASIN_TIER_OUTLINE_BAND_SALT + 37) - 0.5) * 2;
    // new variable: sideArcSweep makes tier coverage bulge into long spoon-like arcs from the side boundaries toward the basin center.
    const sideArcSweep = Math.sin(nx * Math.PI * 2.0 + noise2(Math.floor(y / 14), 0, GREAT_BASIN_TIER_OUTLINE_BAND_SALT + 71) * Math.PI * 2) * 0.62;
    // new variable: latitudeMask keeps the footprint variation visible through the gentle south/mid slope while calming the very north so the high rim still reads cleanly.
    const latitudeMask = 0.62 + 0.38 * (1 - smoothstep(clamp((ny - 0.08) / 0.78, 0, 1)));
    const broadOffset = (broadShelfWobble * 0.82 + sideArcSweep * 0.74) * GREAT_BASIN_TIER_OUTLINE_VARIATION_TILES;
    const fineOffset = regionalBite * GREAT_BASIN_TIER_OUTLINE_FINE_VARIATION_TILES;
    return (broadOffset + fineOffset) * latitudeMask;
  }

  function greatInclineMountainsideTargetTier(x, y) {
    // new variable: baseInclineTier is the direct south-to-north Great Incline profile before slight contour wobble.
    const baseInclineTier = 1 + (settings.maxTier - 1) * northwardRiseProgressAtY(y);
    // new variable: contourWobble keeps the mountainside organic without stealing the max-tier range from the north edge.
    const contourWobble = (noise2(Math.floor(x / 9), Math.floor(y / 7), 98617) - 0.5) * Math.max(0.55, settings.maxTier * 0.035);
    return clamp(Math.round(baseInclineTier + contourWobble), 1, settings.maxTier);
  }

  function greatInclineRiseProgressFromNorthness(northness) {
    // new variable: earlyRamp gives the southern map a small readable grade before the northern curve starts climbing hard.
    const earlyRamp = northness * 0.06;
    // new variable: normalizedNorthWall lets the highest playable rows reach the requested max tier even when boundary landscape consumes the literal map edge.
    const normalizedNorthWall = clamp(northness / 0.92, 0, 1);
    // new variable: northernSurge is the main mountainside curve; it stays low through the south/mid-map and spends most of the tier range in the north.
    const northernSurge = Math.pow(normalizedNorthWall, 3.1) * 0.60;
    // new variable: finalWallBoost spends the last part of the tier range near the north edge so high max-tier values become visibly huge before the inaccessible border starts.
    const finalWallBoost = smoothstep(clamp((northness - 0.55) / 0.37, 0, 1)) * 0.34;
    return clamp(earlyRamp + northernSurge + finalWallBoost, 0, 1);
  }

  function highestWalkablePlateauCandidate(entry = null) {
    let best = null;
    for (const tile of allTiles()) {
      if (!tile || tile.water || tile.borderEscarpment || tile.distantBoundaryLandscape || tile.ramp || tile.navRamp || tile.cliffSkirt || tile.occupiedBy) continue;
      if (tile.designRole && String(tile.designRole).includes('distant')) continue;
      if ((tile.elevation || 0) <= 0) continue;
      const h = tileHeight(tile);
      const entryDist = entry ? Math.hypot(tile.x - entry.x, tile.y - entry.y) : 0;
      const northBias = usesGreatBasinPreset() ? (settings.height - tile.y) * 0.35 : 0;
      const score = h * 100000 + northBias - entryDist;
      if (!best || score > best.score) best = { tile, height: h, score };
    }
    return best;
  }

  function localBoundaryPlayableAverage(x, y, inward, scan) {
    const sideStat = scan && scan.sides ? scan.sides[inward.side] : null;
    const fallback = sideStat ? sideStat.average : 0;
    const samples = [];
    const tangent = inward.dir.x === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const startDepth = borderEscarpmentMaxDepth() + 2;
    const endDepth = borderEscarpmentMaxDepth() + 9;
    for (let d = startDepth; d <= endDepth; d++) {
      for (let t = -3; t <= 3; t++) {
        const sx = clamp(x + inward.dir.x * d + tangent.x * t, 0, settings.width - 1);
        const sy = clamp(y + inward.dir.y * d + tangent.y * t, 0, settings.height - 1);
        const sample = tileAt(sx, sy);
        if (canSamplePlayableHeight(sample)) samples.push(tileHeight(sample));
      }
    }
    if (!samples.length) return fallback;
    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
  }

  function localNorthwardScannerSupport(tile) {
    if (!tileCanReceiveLocalNorthwardRaise(tile)) return null;
    let best = null;

    // A 1-row scanner still reads the row immediately south, but only through nearby support,
    // not through a whole-column "highest so far" memory. This keeps the northward climb readable
    // without turning every column into a wall from the first high tile it ever saw.
    for (let dx = -1; dx <= 1; dx++) {
      const south = tileAt(tile.x + dx, tile.y + 1);
      const southHeight = northwardRowScannerSourceHeight(south);
      if (southHeight === null) continue;
      if (tile.water) {
        // Water follows its own course first, then may borrow adjacent terrain height at crossings.
        if (south.water || south.plateauStream || south.waterfall || tileIsRaisedScannerTerrain(south)) {
          best = considerScannerSupport(best, { height: southHeight }, south.water ? 'south-water' : 'south-terrain-crossing');
        }
      } else if (tileIsRaisedScannerTerrain(tile) || tile.path || tile.invisiblePath || tile.denRoute) {
        // Raised terrain only inherits from raised terrain or route support, never from a visual boundary wall.
        if (tileIsRaisedScannerTerrain(south) || south.path || south.invisiblePath || south.denRoute) {
          best = considerScannerSupport(best, { height: southHeight }, 'south-local-terrain');
        }
      }
    }

    if (tile.water) {
      // Let rivers/streams climb when they physically cross a plateau face. This is intentionally local:
      // a nearby plateau can raise a water tile into a waterfall, but it cannot lift the whole row.
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const neighbor = tileAt(tile.x + dx, tile.y + dy);
        if (!neighbor || neighbor.water || neighbor.borderEscarpment || neighbor.ramp || neighbor.navRamp) continue;
        if (!tileIsRaisedScannerTerrain(neighbor) && !neighbor.path && !neighbor.invisiblePath) continue;
        const neighborHeight = northwardRowScannerSourceHeight(neighbor);
        if (neighborHeight === null) continue;
        best = considerScannerSupport(best, { height: neighborHeight }, 'local-waterfall-crossing');
      }
    }

    return best;
  }

  function markNorthwardScannerWaterfalls() {
    let waterfallCandidates = 0;
    const dirs = [
      { x: 0, y: -1 }, { x: 0, y: 1 },
      { x: 1, y: 0 }, { x: -1, y: 0 }
    ];
    for (const tile of allTiles()) {
      tile.northwardScannerWaterfallCandidate = false;
      if (!tile.water) continue;
      for (const dir of dirs) {
        const neighbor = tileAt(tile.x + dir.x, tile.y + dir.y);
        if (!neighbor || neighbor.borderEscarpment) continue;
        const diff = Math.abs(tileHeight(neighbor) - tileHeight(tile));
        if (diff >= Math.max(1, settings.rampMinDiff || 1)) {
          tile.waterfall = true;
          tile.northwardScannerWaterfallCandidate = true;
          waterfallCandidates++;
          break;
        }
      }
    }
    return waterfallCandidates;
  }

  function measureMaxSameTierRowShare() {
    let worstShare = 0;
    let worstTier = 0;
    let worstRow = -1;
    for (let y = 0; y < settings.height; y++) {
      const counts = new Map();
      let eligible = 0;
      for (let x = 0; x < settings.width; x++) {
        const tile = tileAt(x, y);
        if (!tile || tile.borderEscarpment || tile.ramp || tile.navRamp || tile.bridge || tile.navBridge) continue;
        if (tile.elevation <= 0) continue;
        eligible++;
        counts.set(tile.elevation, (counts.get(tile.elevation) || 0) + 1);
      }
      for (const [tier, count] of counts) {
        const share = count / Math.max(1, settings.width);
        if (share > worstShare) { worstShare = share; worstTier = tier; worstRow = y; }
      }
    }
    return { worstShare, worstTier, worstRow };
  }

  function normalizedNorthnessAtY(y) {
    return clamp(1 - (y / Math.max(1, settings.height - 1)), 0, 1);
  }

  function northwardRiseProgressAtY(y) {
    const northness = normalizedNorthnessAtY(y);
    const curve = activeStepCurveConfig();
    if (usesDramaticPlateauPreset() && curve.id === 'greatIncline') return greatInclineRiseProgressFromNorthness(northness);
    // new variable: curveExponent is used by northwardRiseProgressAtY to preserve the old northern-cliff profile when Great Incline is not selected.
    const curveExponent = usesDramaticPlateauPreset() ? curve.exponent : 0.86;
    return Math.pow(northness, curveExponent);
  }

  function northwardRowScannerSourceHeight(tile) {
    if (!northwardRowScannerTouchesTile(tile)) return null;
    // Cliff skirts are side faces. Water is allowed through because rivers/streams need to climb locally instead of route around plateaus.
    if (tile.cliffSkirt && !tile.water) return null;
    return tileHeight(tile);
  }

  function northwardRowScannerTouchesTile(tile) {
    if (!tile) return false;
    // Boundary escarpments are visual/world-edge walls, not the walkable terrain floor that should propagate north.
    if (tile.borderEscarpment && !tile.water) return false;
    if (tile.ramp || tile.navRamp || tile.bridge || tile.navBridge) return false;
    // Intentional parent shelves are the anti-cake feature; never let the scanner raise them back into full-width bands.
    if (tile.dramaticShelfApron && !tile.water) return false;
    return true;
  }

  function paintDistantBoundaryLandscapeTile(tile, side, edgeDist, scan) {
    // WildernessMapGeneratorV4412 anchors every distant-landscape tile on one
    // flat scalar per side (the side's whole-scan average/highAverage), so
    // the backdrop reads as a single flat shelf no matter where the real
    // playable edge is taller or shorter at that point. Anchor on this tile's
    // own nearby playable height instead (the same local sample
    // generateBorderEscarpments' cliff mode already uses), then layer the
    // farm/town border landscape's rolling-hill variation (buildBorderTerrain
    // in game.js grows random plateau blobs over a flat base) as a
    // low-frequency noise bump on top, so the backdrop blends into whatever
    // height the adjoining tiles actually are instead of a flat plane.
    const inward = inwardDirectionForBorderTile(tile.x, tile.y);
    const localHeight = localBoundaryPlayableAverage(tile.x, tile.y, inward, scan);
    const sideStat = scan && scan.sides ? scan.sides[side] : null;
    const fallbackHeight = sideStat ? Math.max(sideStat.average, sideStat.highAverage) : 0;
    const sourceHeight = Number.isFinite(localHeight) ? localHeight : fallbackHeight;
    const localWidth = borderEscarpmentLocalWidthAt(tile.x, tile.y);
    const depthRatio = clamp(1 - edgeDist / Math.max(1, localWidth), 0, 1);
    const regionalNoise = noise2(Math.floor(tile.x / 7), Math.floor(tile.y / 7), 78241 + borderSideIndex(side));
    const rollingHillBump = Math.max(0, regionalNoise - 0.42) * 4.2;
    const ridgeNoise = noise2(tile.x, tile.y, 78241 + borderSideIndex(side));
    const displayHeight = Math.max(0, sourceHeight + depthRatio * 1.6 + rollingHillBump + (ridgeNoise > 0.72 ? 1 : 0));
    tile.borderEscarpment = false;
    tile.borderEscarpmentDepth = null;
    tile.borderEscarpmentSide = null;
    tile.borderEscarpmentBaseHeight = null;
    tile.borderEscarpmentHeightBonus = null;
    tile.distantBoundaryLandscape = true;
    tile.distantBoundaryLandscapeSide = side;
    tile.distantBoundaryLandscapeDepth = edgeDist;
    tile.distantBoundarySourceHeight = Number(sourceHeight.toFixed(2));
    tile.distantBoundaryDisplayHeight = Number(displayHeight.toFixed(2));
    tile.distantBoundaryRenderBand = ridgeNoise > 0.68 ? 'ridge' : 'farField';
    tile.height = displayHeight;
    tile.elevation = Math.round(displayHeight);
    tile.water = false;
    tile.bridge = false;
    tile.navBridge = false;
    tile.ramp = false;
    tile.rampId = null;
    tile.navRamp = false;
    tile.navRampId = null;
    tile.terrain = 'distantLandscape';
    tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || 'distant_boundary_landscape';
    tile.plateauGroupId = null;
    tile.plateauRing = false;
    tile.plateauInterior = false;
    tile.cliffSkirt = false;
    tile.cliffSkirtKind = null;
    tile.designReserve = true;
    tile.designRole = 'distantBoundaryLandscape';
    return displayHeight;
  }

  function paintDramaticShelfApronTile(tile, tier, sourceTier) {
    if (!canRewriteDramaticShelfApron(tile)) return false;
    const cappedTier = clamp(Math.round(Math.min(tier, northwardMaxTierAtY(tile.y))), 1, settings.maxTier);
    const oldTier = tile.elevation || 0;
    if (oldTier === cappedTier && tile.terrain === 'plateau') return false;
    tile.water = false;
    tile.terrain = 'plateau';
    tile.elevation = cappedTier;
    tile.height = cappedTier;
    tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || 'dramatic_parent_shelf_apron';
    tile.dramaticShelfApron = true;
    tile.dramaticShelfParentTier = cappedTier;
    tile.dramaticShelfChildTier = sourceTier;
    return true;
  }

  function paintHighEntryRoadTile(x, y, height, radius, role = 'greatBasinHighEntryRoad') {
    let painted = 0;
    for (let yy = y - radius; yy <= y + radius; yy++) {
      for (let xx = x - radius; xx <= x + radius; xx++) {
        if (!inBounds(xx, yy)) continue;
        if (Math.hypot(xx - x, yy - y) > radius + 0.36) continue;
        const tile = tileAt(xx, yy);
        if (!tile) continue;
        clearBorderEscarpmentTile(tile, height, role);
        tile.water = false;
        tile.terrain = height > 0 ? 'plateau' : 'grass';
        tile.elevation = Math.round(height);
        tile.height = height;
        tile.path = true;
        tile.bridge = false;
        tile.ramp = false;
        tile.rampId = null;
        tile.navRamp = false;
        tile.navRampId = null;
        tile.cliffSkirt = false;
        tile.cliffSkirtKind = null;
        tile.waterfall = false;
        tile.designReserve = true;
        tile.designRole = role;
        painted++;
      }
    }
    return painted;
  }

  function raiseScannerPlateauBody(body, targetHeight) {
    let raisedTiles = 0;
    const cappedTarget = clamp(Math.round(targetHeight), 1, settings.maxTier);
    for (const tile of body.tiles) {
      if (!scannerTileCanBePlateauCandidate(tile)) continue;
      if (tile.elevation >= cappedTarget) continue;
      tile.northwardScannerRaised = true;
      tile.northwardScannerPreviousHeight = tile.elevation;
      tile.northwardScannerRaisedAsComponent = true;
      tile.elevation = cappedTarget;
      tile.height = cappedTarget;
      tile.terrain = 'plateau';
      tile.generatedPlateauBlobId = tile.generatedPlateauBlobId || 'northward_component_scanner_raise';
      raisedTiles++;
    }
    return raisedTiles;
  }

  function resetBoundaryLandscapeFlags(tile) {
    if (!tile) return;
    tile.distantBoundaryLandscape = false;
    tile.distantBoundaryLandscapeSide = null;
    tile.distantBoundaryLandscapeDepth = null;
    tile.distantBoundarySourceHeight = null;
    tile.distantBoundaryDisplayHeight = null;
    tile.distantBoundaryRenderBand = null;
  }

  function resolveGenerationEntrySide() {
    // An explicit entrySide (anything but 'random') always wins over a
    // preset's forcedEntrySide: the standalone tool's presets assume a human
    // is choosing the entry side to match their orientation, but zones here
    // (see ZONE_CONFIG) always specify the side that faces Hobunji Hollow, and
    // that authored orientation must not be silently overridden by picking a
    // preset for its terrain shape (dramaticPlateaus/highEntryCauseway).
    if (settings.entrySide !== 'random') return settings.entrySide;
    const forcedSide = activePresetConfig().forcedEntrySide;
    return forcedSide || pick(['north', 'east', 'south', 'west']);
  }

  function sameScannerPlateauBody(start, candidate) {
    if (!start || !candidate || !scannerTileCanBePlateauCandidate(candidate)) return false;
    if (usesDramaticPlateauPreset()) {
      // new variable: scannerChunkSize splits synthetic bleacher shelves into authored-looking bodies, so a support correction raises the local plateau it belongs to rather than an entire world-width shelf row.
      const scannerChunkSize = clamp(Math.round(Math.min(settings.width, settings.height) * 0.12), 8, 16);
      const startId = start.generatedPlateauBlobId || '';
      const candidateId = candidate.generatedPlateauBlobId || '';
      const startSynthetic = start.dramaticBleacherShelf || startId.startsWith('dramatic_bleacher_shelf');
      const candidateSynthetic = candidate.dramaticBleacherShelf || candidateId.startsWith('dramatic_bleacher_shelf');
      if (startId && candidateId && startId === candidateId && !startSynthetic && !candidateSynthetic) return candidate.elevation === start.elevation;
      const sameChunk = Math.floor(candidate.x / scannerChunkSize) === Math.floor(start.x / scannerChunkSize)
        && Math.floor(candidate.y / scannerChunkSize) === Math.floor(start.y / scannerChunkSize);
      return candidate.elevation === start.elevation && sameChunk;
    }
    if (start.plateauGroupId) return candidate.plateauGroupId === start.plateauGroupId;
    return candidate.elevation === start.elevation;
  }

  function scannerSouthernSupportForBody(body) {
    let supportHeight = -Infinity;
    let supportTiles = 0;
    for (const tile of body.tiles) {
      for (let dx = -1; dx <= 1; dx++) {
        const south = tileAt(tile.x + dx, tile.y + 1);
        if (!south || body.keys.has(tileKey(south.x, south.y))) continue;
        if (!scannerTileCanSupportPlateau(south)) continue;
        const southHeight = tileHeight(south);
        if (southHeight > supportHeight) supportHeight = southHeight;
        supportTiles++;
      }
    }
    return supportTiles ? supportHeight : null;
  }

  function scannerTileCanBePlateauCandidate(tile) {
    if (!tile || tile.water || tile.borderEscarpment || tile.ramp || tile.navRamp || tile.bridge || tile.navBridge) return false;
    // Intentional parent-shelf aprons are the southern room around child plateaus; they can support a child, but should not be raised as the child.
    if (tile.dramaticShelfApron) return false;
    if (tile.cliffSkirt && !tile.plateauGroupId && !tile.plateauInterior && !tile.plateauRing) return false;
    return tile.elevation > 0 && (tile.terrain === 'plateau' || tile.plateauGroupId || tile.plateauInterior || tile.plateauRing || tile.generatedPlateauBlobId);
  }

  function scannerTileCanSupportPlateau(tile) {
    if (!tile || tile.water || tile.borderEscarpment || tile.ramp || tile.navRamp || tile.bridge || tile.navBridge) return false;
    if (tile.cliffSkirt && !tile.plateauGroupId && !tile.plateauInterior && !tile.plateauRing) return false;
    return tile.elevation > 0;
  }

  function smoothNumberList(values, passes = 1) {
    let smoothed = values.slice();
    for (let pass = 0; pass < passes; pass++) {
      const next = smoothed.slice();
      for (let i = 0; i < smoothed.length; i++) {
        const prev = smoothed[Math.max(0, i - 1)];
        const here = smoothed[i];
        const nextValue = smoothed[Math.min(smoothed.length - 1, i + 1)];
        next[i] = prev * 0.25 + here * 0.5 + nextValue * 0.25;
      }
      smoothed = next;
    }
    return smoothed;
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function targetBoundaryHeight(tile, inward, edgeDist, localWidth, scan, modeConfig) {
    const oldHeight = tileHeight(tile);
    const sideStat = scan && scan.sides ? scan.sides[inward.side] : null;
    const localAverage = localBoundaryPlayableAverage(tile.x, tile.y, inward, scan);
    // new variable: basePlayableHeight is the post-playable-map feedback height that the boundary cliff sits above.
    const basePlayableHeight = modeConfig.followsMapHeight
      ? Math.max(
        scan ? scan.averagePlayableHeight : 0,
        sideStat ? sideStat.average : 0,
        localAverage
      )
      : Math.max(oldHeight || 0, northwardMaxTierAtY(tile.y));
    const depthRatio = clamp(1 - edgeDist / Math.max(1, localWidth), 0, 1);
    // new variable: cliffBoost is the user-facing boundary lift; the profile below keeps it from stacking with too many other bonuses and becoming a max-height wall.
    const cliffBoost = settings.boundaryCliffBoost;
    const sideIndex = borderSideIndex(inward.side);
    // new variable: profileStep makes the outer edge slightly taller than the inner shoulder without turning the whole border into an identical sheer curtain.
    const profileStep = Math.round(depthRatio * (usesDramaticPlateauPreset() ? 2.5 : 1.8));
    // new variable: jaggedBonus breaks the skyline in small chunks; it is intentionally small because the cliff boost already supplies the dramatic height.
    const jaggedBonus = Math.round(noise2(Math.floor(tile.x / 3), Math.floor(tile.y / 3), 73613 + sideIndex) * (usesDramaticPlateauPreset() ? 2 : 1));
    const ridgeBonus = usesDramaticPlateauPreset() && noise2(tile.x, tile.y, 73517) > 0.82 ? 1 : 0;
    const target = basePlayableHeight + cliffBoost + profileStep + jaggedBonus + ridgeBonus;
    // Negative boundary boosts are deliberate: let them lower/soften the boundary instead of forcing every border tile above its old generated height.
    return cliffBoost >= 0 ? Math.max(oldHeight + 1, target) : target;
  }

  function tileCanReceiveLocalNorthwardRaise(tile) {
    if (!northwardRowScannerTouchesTile(tile)) return false;
    if (tile.cliffSkirt && !tile.water) return false;
    if (tile.dramaticShelfApron && !tile.water) return false;
    // Do not convert whole lowland rows into plateaus. Only existing raised terrain, explicit routes, and water can climb.
    return tile.water || tileIsRaisedScannerTerrain(tile) || tile.path || tile.invisiblePath || tile.denRoute;
  }

  function tileIsRaisedScannerTerrain(tile) {
    return !!tile && (tile.elevation > 0 || tile.terrain === 'plateau' || tile.plateauGroupId || tile.plateauInterior || tile.plateauRing);
  }

  function usesDramaticPlateauPreset() {
    return !!activePresetConfig().dramaticPlateaus;
  }

  function usesGreatBasinPreset() {
    return !!activePresetConfig().highEntryCauseway;
  }

  function usesGreatInclineStepCurve() {
    return activeStepCurveConfig().id === 'greatIncline';
  }

  // Headless equivalent of WildernessMapGeneratorV4412's generate() → Export
  // flow: run the full pipeline (minus canvas rendering, the 3D preview, and
  // the tile-density-doubling pass those need) and return the Map Editor
  // workspace JSON buildHobunjiMapExport() produces.
  function generateWorkspace(seedText, overrides = {}) {
    const merged = { ...defaultSettings(), ...overrides, seed: String(seedText ?? 'wild') || 'wild' };
    const preset = TERRAIN_PRESETS[merged.preset] || TERRAIN_PRESETS.custom;
    const boundaryModeConfig = BOUNDARY_PLATEAU_MODES[merged.boundaryMode] || BOUNDARY_PLATEAU_MODES.legacyFullRing;
    const stepCurveConfig = STEP_CURVE_MODES[merged.stepCurve] || STEP_CURVE_MODES.northernCliffs;
    // Dramatic presets need a tall enough maxTier to read as dramatic — same
    // floor the standalone tool applies the moment a preset is selected.
    const dramaticMinimumTier = stepCurveConfig.id === 'greatIncline' ? 16 : 9;
    const resolvedMaxTier = preset.dramaticPlateaus ? Math.max(merged.maxTier, dramaticMinimumTier) : merged.maxTier;
    settings = {
      ...merged,
      preset: preset.id,
      presetLabel: preset.label,
      boundaryMode: boundaryModeConfig.id,
      boundaryModeLabel: boundaryModeConfig.label,
      stepCurve: stepCurveConfig.id,
      stepCurveLabel: stepCurveConfig.label,
      maxTier: resolvedMaxTier,
      generationScale: GENERATION_TILE_SCALE
    };
    rng = makeRng(settings.seed);
    sightBlockerKeyCache = null;
    initMap();
    generatePlateaus();
    applyManualPlateauPaintingRules();
    generatePonds();
    generateRivers();
    generatePlateauHydrology();
    applyManualPlateauPaintingRules(); // refresh painting after canyon cuts
    syncTileHeights();
    enforceNorthwardRowScanner(); // post-playable plateau height scanner
    applyManualPlateauPaintingRules(); // refresh painting after playable scanner
    syncTileHeights();
    enforceNorthwardRowScanner(); // boundary-feedback plateau height scanner
    syncTileHeights();
    applyGreatInclineMountainsideProfile();
    applyGreatBasinHorseshoeProfile(); // Great Basin linear height lerp
    syncTileHeights();
    map.preselectedEntrySide = resolveGenerationEntrySide();
    generateBorderEscarpments();
    generateRamps();
    applyGreatBasinBoundarySideExtensions(); // late boundary side shelves
    syncTileHeights();
    generateCliffSkirts();
    chooseEntry();
    if (usesGreatBasinPreset()) generateCliffSkirts(); // refresh after Great Basin entry road
    generateLatePaintedRivers();
    generateCliffSkirts(); // refresh after late-painted rivers
    applyManualPlateauPaintingRules(); // refresh after late-painted rivers
    stampLocales(); // hand-authored locales get first pick of open ground
    placeStructures();
    placeCaves();
    placeAnimalDens();
    placeVeteranLandmarkAnchors();
    generatePaths();
    applyVeteranMapDesignPass();
    generateInvisibleNavigation();
    placePillarsAndStatues();
    placeFloraAndResources();
    placeAnimalFoodSources();
    validateAndRepairReachability();
    placeDifficultyRewards();
    markNorthwardScannerWaterfalls(); // marks late-painted river waterfalls
    scaleGeneratedTileDensity(settings.generationScale);
    buildAnimalActivity();
    const workspace = buildHobunjiMapExport();
    workspace.entry = map.entry ? { col: map.entry.x, row: map.entry.y, side: map.entry.side } : null;
    workspace.warnings = map.warnings.slice();
    // Raw animal-den footprints (root-map tile coords, already tile-density-
    // scaled — see scaleGeneratedTileDensity/scaleGeneratedObject above),
    // exposed separately from buildHobunjiMapExport()'s tile stream because
    // that export only encodes a den's *presence* as a generic 'rock'-style
    // overlay on its footprint tiles (see hobunjiObjectOverlayByTile) — real
    // consumers that need to know *where the dens actually are* (e.g. the
    // game's own wild-pack spawner, den mesh/collision builder, and cavern
    // entrance) read this instead of trying to recover positions from the
    // lossy tile overlay. x,y is the footprint's top-left tile; mouthAnchor
    // is the walkable tile just south of the footprint (the den's doorway).
    workspace.animalDens = (map.objects || [])
      .filter(object => object.type === 'animalDen')
      .map(object => ({
        id: object.id,
        x: object.x,
        y: object.y,
        w: object.w || 1,
        h: object.h || 1,
        mouthAnchor: object.mouthAnchor ? { x: object.mouthAnchor.x, y: object.mouthAnchor.y } : null,
      }));
    // Foliage patches (grouped copse clusters — see buildFoliagePatches) and,
    // for the dense/"rich" ones, a handful of nearby ambush-station points
    // (see buildAmbushStations) — the wildlife schedule AI's herbivore
    // grazing targets and predator stakeout points. Same reasoning as
    // animalDens above: buildHobunjiMapExport()'s tile stream only encodes a
    // copse tile's presence, not the cluster it belongs to.
    const foliagePatches = buildFoliagePatches();
    workspace.foliagePatches = foliagePatches;
    workspace.ambushStations = buildAmbushStations(foliagePatches);
    // Placed locale instances (see stampLocales/stampLocale). Pulled from
    // map.objects post-scale (scaleGeneratedTileDensity already ran by this
    // point, so object.x/y/w/h are final) -- localeMeta itself is stored in
    // the carrier object's *pre-scale* coordinates (scaleGeneratedObject
    // clones unknown fields verbatim without scaling them), so it's scaled
    // by settings.generationScale here instead.
    const localeScale = settings.generationScale || 1;
    workspace.localeInstances = (map.objects || [])
      .filter(object => object.localeMeta)
      .map(object => {
        const meta = object.localeMeta;
        const toWorld = (col, row) => ({
          x: Math.round((meta.anchorX + col) * localeScale),
          y: Math.round((meta.anchorY + row) * localeScale)
        });
        return {
          localeId: meta.localeId,
          name: meta.name,
          category: meta.category,
          alwaysVisible: !!meta.alwaysVisible,
          x: Math.round(meta.anchorX * localeScale),
          y: Math.round(meta.anchorY * localeScale),
          w: meta.w * localeScale,
          h: meta.h * localeScale,
          connectors: (meta.connectors || []).map(c => ({ ...toWorld(c.col, c.row), side: c.side, label: c.label })),
          npcAnchors: (meta.npcAnchors || []).map(n => ({ npcId: n.npcId, name: n.name, ...toWorld(n.col, n.row), facing: n.facing })),
          objects: (meta.objects || []).map(o => ({
            id: o.id, kind: o.kind, key: o.key, label: o.label, ...toWorld(o.col, o.row),
            w: o.w * localeScale, h: o.h * localeScale
          }))
        };
      });
    return workspace;
  }

  // The Tothal Shift's whole generation step: a random seed and the zone's
  // own ZONE_CONFIG (entry side, terrain preset, boundary cliff mode/boost),
  // otherwise the tool's stock defaults — no post-processing. Whatever
  // buildHobunjiMapExport() produces is handed to the game's fold exactly as
  // if it had been exported from the standalone tool and imported into the
  // Map Editor by hand.
  function generateZoneWorkspace(zoneMapId, seedText, locales = []) {
    const zone = ZONE_CONFIG[zoneMapId];
    const eligible = (locales || []).filter(l => {
      const allowed = l?.placement?.allowedZones;
      return !Array.isArray(allowed) || allowed.length === 0 || allowed.includes(zoneMapId);
    });
    return generateWorkspace(seedText, { ...(zone ? { ...zone } : { entrySide: 'random' }), locales: eligible });
  }

  return {
    generateWorkspace,
    generateZoneWorkspace,
    defaultSettings,
    zoneMapIds: () => Object.keys(ZONE_CONFIG),
    hashSeed,
    makeRng,
    lastReport: () => lastMapEditorExportReport
  };
});

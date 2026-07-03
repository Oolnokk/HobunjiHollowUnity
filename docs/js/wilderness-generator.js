// docs/js/wilderness-generator.js
// Headless procedural wilderness generator — port of WildernessMapGeneratorV32
// (the standalone canvas prototype) with the rendering/UI stripped and three
// game-critical fixes:
//   1. Ramp steepness math now accounts for the game's vertical scale: one
//      elevation tier is PLATEAU_UNIT (2.5) world units tall while one tile is
//      1 world unit wide, so a "1 tier over 2 tiles" ramp the prototype called
//      27° is really 51° in-game. minRampRunForAngle/rampAngleDegrees include
//      that factor, so max-angle settings now describe real in-game slopes.
//   2. Bridges export as walkable 'path' tiles instead of being swallowed by
//      the water check (the prototype exported every bridge as river/stream,
//      which the game blocks like a wall).
//   3. A final enforceGameReachability() pass replays the game's own merge
//      semantics (docs/game.js mergeZoneTiles: auto-incline plateau rings,
//      rock cliff skirts, blocked waterways) and repairs anything the game
//      would actually seal off — carving real slope-compliant ramp tiles
//      where the prototype only stamped "hidden nav ramp" metadata the game
//      never reads, and hard-sealing any leftover pocket as rock so no
//      walkable-but-unreachable tile survives into the export.
//
// The public API is WildernessGenerator.generate(options) → {
//   workspace,   // hobunji_map_editor_workspace.v1 (root map + plateau submaps)
//   objects,     // sanitized generated object list (plants/caves/dens/etc for placeholder props)
//   entry,       // { x, y, side } map entry tile
//   summary,     // stat summary (tier areas, object counts, reachability)
//   connectivity,      // prototype-rule reachability report
//   gameConnectivity,  // game-rule reachability report (what the game actually merges)
//   warnings, debug,
// }
// Options mirror the prototype's control panel; all optional (see DEFAULT_SETTINGS).
(function (globalScope) {
  'use strict';

  // How many world-Y units one elevation tier rises in the game renderer
  // (docs/game.js PLATEAU_UNIT) per one tile (1 world unit) of horizontal run.
  // Every slope/angle computation in this file uses real in-game rise:run.
  const GAME_TIER_RISE = 2.5;

  const DEFAULT_SETTINGS = {
    seed: 'wild',
    width: 100,
    height: 100,
    // Every generator tile becomes a gameplayScale × gameplayScale block of
    // gameplay tiles (the model upscales after placement, before the
    // reachability passes — so all guarantees hold at gameplay resolution).
    // The exported map is (width·scale) × (height·scale).
    gameplayScale: 1,
    entrySide: 'south',
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
  };

  // Object-count settings that scale with map area when the caller only
  // provides width/height (defaults were tuned for a 100x100 map).
  const AREA_SCALED_SETTINGS = [
    'plateaus', 'ramps', 'ponds', 'plateauPonds', 'plateauStreams', 'pathAnchors',
    'animalDens', 'prey', 'packPredators', 'ambushPredators', 'omnivores',
    'structures', 'caves', 'statues', 'pillars', 'trees', 'logs', 'bushes',
    'forage', 'fruitBushes', 'mushrooms', 'beehives', 'treasure', 'ore', 'boulders',
  ];

  const SETTING_LIMITS = {
    width: [20, 120], height: [16, 100], gameplayScale: [1, 4], plateaus: [0, 180], maxTier: [1, 9],
    ramps: [0, 260], rampMinDiff: [1, 8], rampMaxAngle: [15, 60],
    ponds: [0, 24], plateauPonds: [0, 32], plateauStreams: [0, 40], rivers: [0, 8],
    pathAnchors: [0, 24], animalDens: [0, 18], prey: [0, 40], packPredators: [0, 40],
    ambushPredators: [0, 40], omnivores: [0, 40], structures: [0, 18], caves: [0, 18],
    statues: [0, 40], pillars: [0, 60], trees: [0, 500], logs: [0, 120], bushes: [0, 300],
    forage: [0, 240], fruitBushes: [0, 160], mushrooms: [0, 160], beehives: [0, 80],
    treasure: [0, 160], ore: [0, 220], boulders: [0, 120],
  };

  function normalizeSettings(options = {}) {
    const out = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (options[key] === undefined || options[key] === null) continue;
      out[key] = key === 'seed' || key === 'entrySide' ? options[key] : Number(options[key]);
    }
    out.seed = String(out.seed || 'wild').trim() || 'wild';
    if (!['north', 'south', 'east', 'west'].includes(out.entrySide)) out.entrySide = 'south';
    for (const [key, [min, max]] of Object.entries(SETTING_LIMITS)) {
      if (!Number.isFinite(out[key])) out[key] = DEFAULT_SETTINGS[key];
      out[key] = clamp(Math.round(out[key]), min, max);
    }
    // Scale density-style counts by the GENERATION area unless the caller
    // pinned them. Placement happens at generation resolution, and after a
    // gameplay upscale every object's footprint inflates by scale² — so
    // generation-area counts keep the same fraction of the shipped map
    // covered as the prototype's tuned 100x100 defaults.
    const areaScale = (out.width * out.height) / (DEFAULT_SETTINGS.width * DEFAULT_SETTINGS.height);
    if (areaScale < 0.999 || areaScale > 1.001) {
      // Structural features keep a floor: linear area scaling starved small
      // zone maps down to 1 designed ramp and a handful of plateau blobs, so
      // almost all connectivity came from straight repair carves and the
      // terrain read as one big incline instead of plateaus with climbs.
      const STRUCTURAL_FLOORS = { plateaus: 16, ramps: 8, animalDens: 2, caves: 2, pathAnchors: 2 };
      for (const key of AREA_SCALED_SETTINGS) {
        if (options[key] !== undefined && options[key] !== null) continue;
        const [min, max] = SETTING_LIMITS[key];
        const floor = areaScale < 1 ? (STRUCTURAL_FLOORS[key] || 0) : 0;
        out[key] = clamp(Math.max(floor, Math.round(DEFAULT_SETTINGS[key] * areaScale)), min, max);
      }
    }
    return out;
  }

  // Palette entries kept from the prototype: generated objects carry display
  // colors so the placeholder props / dev tooling can color-code them.
  const colors = {
    den: '#4b2d18',
    rareHerb: '#8af56b',
    preyAnimal: '#f3fff1',
    packPredator: '#ff4b4b',
    ambushPredator: '#ff9b38',
    omnivore: '#b47a38',
  };
  const foragePalette = ['#ff6fcf', '#ffe66a', '#6af2ff', '#b66aff', '#ff8d4b', '#ffffff'];
  const rarityPoolColors = { 1: '#e7e7e7', 2: '#72e27a', 3: '#70a8ff', 4: '#c687ff', 5: '#ffb454' };
  const oreKinds = ['stone', 'copper', 'tin', 'iron', 'silver', 'gold', 'crystal'];

  let map = null;
  let rng = Math.random;
  let settings = { ...DEFAULT_SETTINGS };
  let sightBlockerKeyCache = null;
  let lastMapEditorExportReport = '';
  // How many gameplay tiles one CURRENT-model tile will ship as: equals
  // settings.gameplayScale during coarse design, then 1 once
  // upscaleModelForGameplay has inflated the model — slope math and river
  // widths consult this so "run" and "width" always mean gameplay tiles.
  let _gameplayTilesPerModelTile = 1;

  function safeFilename(name) {
    return String(name || 'wild').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
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
      version: '1.32.0',
      seed: settings.seed,
      width: settings.width,
      height: settings.height,
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
          designReserve: false,
          designRole: null,
          designLandmarkInfluence: 0,
          visualDeadEnd: false,
          breadcrumb: false,
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
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const tile = tileAt(xx, yy);
        if (!tile) return false;
        if (!allowWater && tile.water) return false;
        if (!allowPath && tile.path) return false;
        if (!allowRamp && tile.ramp) return false;
        if (!allowInvisiblePath && tile.invisiblePath) return false;
        if (!allowCliffSkirt && tile.cliffSkirt && !tile.ramp && !tile.waterfall) return false;
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
    const targetCoverage = clamp(0.74 + blobCount * 0.0024, 0.80, 0.93);
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
    const gradient = enforceSouthToNorthElevationRule();
    const cleanupAfterGradient = removeTinyGeneratedPlateauComponents();
    const sharedEdgesAfterCleanup = countPlateauSharedEdges();
    changed = Math.max(0, changed + raggification.added - raggification.removed - cleanup.removedTiles - cleanupAfterGradient.removedTiles);
    logDebug(`broad causeway plateau fields: ${acceptedBlobs.length}/${blobCount} masses in ${causewayFields.length} fields, plateau tiles ${changed}/${targetPlateauTiles} target, shared edges ${sharedEdgesAfterCleanup} (${sharedEdgesBeforeCleanup} before smoothing), smoothing filled ${smoothing.filled}/removed ${smoothing.removed}, outline rounding +${rounding.added}/-${rounding.removed} (${rounding.longRunsBefore}->${rounding.longRunsAfter} long straight runs, ${rounding.squareCornersBefore}->${rounding.squareCornersAfter} large square corners), post-raggification +${raggification.added}/-${raggification.removed} edge tiles (${raggification.longRunsBefore}->${raggification.longRunsAfter} long straight runs, ${raggification.squareCornersBefore}->${raggification.squareCornersAfter} large square corners), north-gradient clamped ${gradient.clamped}/lifted ${gradient.raisedNorthShoulders}, tiny crumbs removed ${cleanup.removedComponents + cleanupAfterGradient.removedComponents}/${cleanup.removedTiles + cleanupAfterGradient.removedTiles}`);
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
    const northness = clamp(1 - (y / Math.max(1, settings.height - 1)), 0, 1);
    // new variable: northRiseCurve makes elevation reliably climb as the player moves north, while keeping low southern shelves playable.
    const northRiseCurve = Math.pow(northness, 0.86);
    return 1 + (maxTier - 1) * northRiseCurve;
  }

  function northwardMaxTierAtY(y) {
    return clamp(Math.round(northwardTierFloatAtY(y)), 1, Math.max(1, settings.maxTier));
  }

  function northwardPreferredPlateauTier(x, y, field = null) {
    const maxTier = Math.max(1, settings.maxTier);
    if (maxTier <= 1) return 1;
    const rowFloat = northwardTierFloatAtY(y);
    const rowCap = northwardMaxTierAtY(y);
    const blockNoise = (noise2(Math.floor(x / 9), Math.floor(y / 9), 62437) - 0.5) * 1.15;
    const fieldNudge = field && Number.isFinite(field.baseTier) ? clamp(field.baseTier - rowFloat, -0.75, 0.75) : 0;
    return clamp(Math.round(rowFloat + blockNoise + fieldNudge), 1, rowCap);
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
        const desired = Math.min(cap, south.elevation + (y < south.y ? 1 : 0));
        if (tile.elevation < south.elevation && desired > tile.elevation) {
          tile.elevation = desired;
          tile.height = Math.max(tile.height || desired, desired);
          tile.terrain = 'plateau';
          raisedNorthShoulders++;
        }
      }
    }

    logDebug(`south-to-north elevation rule: clamped ${clamped} over-high southern tiles, lifted ${raisedNorthShoulders} northward shoulders`);
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
      const wantsEdgeShare = hasAnyPlateau && chance(0.78);
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
    for (let pass = 0; pass < 3; pass++) {
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
    const jitter = weightedPick([
      { value: -1, weight: 18 },
      { value: 0, weight: 50 },
      { value: 1, weight: 24 },
      { value: 2, weight: 8 }
    ]);
    // new variable: northLockedTier preserves local causeway variation while preventing southern blobs from spawning as northern-height shelves.
    const northLockedTier = rowPreferred + jitter + (index % 13 === 0 && y < settings.height * 0.42 && chance(0.30) ? 1 : 0);
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

      for (const tile of cells) {
        const key = tileKey(tile.x, tile.y);
        const isRing = isManualPlateauRingTile(tile, keySet);
        tile.plateauGroupId = id;
        tile.plateauRing = isRing;
        tile.plateauInterior = !isRing;
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
        bbox: { minC, minR, maxC, maxR }
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

  // FIXED vs the prototype: slope math must use the game's real vertical
  // scale. One elevation tier rises GAME_TIER_RISE (2.5) world units while a
  // tile is 1 world unit of run, so `diff / run` alone understates the true
  // angle by 2.5x — ramps the prototype called 27° were 51° cliffs in-game.
  function minRampRunForAngle(diff) {
    const angleRadians = rampMaxAngleDegrees() * Math.PI / 180;
    // One model tile of run is _gameplayTilesPerModelTile gameplay tiles
    // (each 1 world unit), so a coarse-designed ramp needs proportionally
    // fewer model tiles for the same real slope.
    return Math.max(1, Math.ceil((Math.abs(diff) * GAME_TIER_RISE) / (Math.tan(angleRadians) * _gameplayTilesPerModelTile)));
  }

  function rampAngleDegrees(diff, run) {
    return Math.atan((Math.abs(diff) * GAME_TIER_RISE) / Math.max(1, run * _gameplayTilesPerModelTile)) * 180 / Math.PI;
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

  function markWater(x, y, terrain = 'water', width = 1) {
    // new variable: brushRadius converts desired river width into a softer tile brush; used so a width of 3 reads near 3 tiles, not 5.
    const brushRadius = terrain === 'river' ? 0.15 + width * 0.46 : Math.max(0.5, width / 2);
    const salt = terrain === 'river' ? 5129 : 2273;
    const isPlateauHydrology = terrain === 'stream' || terrain === 'pond';
    for (let yy = Math.floor(y - brushRadius - 1); yy <= Math.ceil(y + brushRadius + 1); yy++) {
      for (let xx = Math.floor(x - brushRadius - 1); xx <= Math.ceil(x + brushRadius + 1); xx++) {
        if (!inBounds(xx, yy)) continue;
        const dist = Math.hypot(xx - x, yy - y);
        const bankNoise = terrain === 'river' ? (noise2(xx, yy, salt + Math.round(width * 41)) - 0.5) * 0.22 : 0;
        if (dist > brushRadius + bankNoise) continue;
        const tile = tileAt(xx, yy);
        tile.water = true;
        tile.terrain = terrain;
        if (terrain === 'river') {
          tile.canyonRiver = true;
          tile.canyonOriginalElevation = tile.canyonOriginalElevation ?? tile.elevation;
          // new variable: riverBedTier aggressively drops broad canyon rivers so the adjacent ground can read as a real canyon floor.
          const riverBedTier = Math.max(0, Math.min(tile.elevation, Math.floor(tile.elevation * 0.12)));
          tile.elevation = riverBedTier;
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
        if (!a || a.water) continue;
        for (const dir of dirs) {
          const b = tileAt(x + dir.x, y + dir.y);
          if (!b || b.water) continue;
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
            // Run/hug gates are authored in GAMEPLAY tiles — during coarse
            // design one model tile ships as _designScale() gameplay tiles,
            // so the required cliff-ledge lengths shrink accordingly (a
            // 30x25 coarse map simply has no 14-model-tile cliff runs, which
            // silently zeroed out every designed ramp).
            const ds = _designScale();
            const wrapLimit = Math.max(Math.ceil(34 / ds), minimumRampRun + Math.ceil(30 / ds));
            const wrapRun = measureCurvedWrapRampRun(low.x, low.y, tangent.x, tangent.y, low.elevation, high.elevation, high.plateauGroupId, normal, wrapLimit);
            const highRun = measureHighRampLandingRun(high.x, high.y, -normal.x, -normal.y, high.elevation, high.plateauGroupId, 4);
            if (highRun < 2) continue;
            if (wrapRun.run < Math.max(Math.ceil(14 / ds), minimumRampRun + Math.ceil(6 / ds))) continue;
            if (wrapRun.hug < Math.max(Math.ceil(13 / ds), Math.ceil(wrapRun.run * 0.95))) continue;
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

          // Curved wrap ramps are preferred, but on coarse zone-scale maps
          // their landing/exit requirements rarely fit — allow the simple
          // straight fallback so zones still get DESIGNED climbs (they fuse
          // and cliff-tint like everything else) instead of relying almost
          // entirely on repair carves.
          const allowStraightFallback = _designScale() > 1;
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
      if (!tile || tile.water || tile.elevation !== tier) break;
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

    // Authored in gameplay tiles — shrink by the design scale (a coarse
    // model tile ships as _designScale() gameplay tiles).
    const minLen = Math.max(Math.ceil(7 / _designScale()), Math.min(desiredLength, minRampRunForAngle(candidate.diff)));
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
    const lowerLength = Math.max(minimumRun + Math.ceil(10 / _designScale()), candidate.lowRun || minimumRun);
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
    const dirs = [
      { x: 1, y: 0 }, { x: -1, y: 0 },
      { x: 0, y: 1 }, { x: 0, y: -1 }
    ];

    for (const tile of allTiles()) {
      if (!tile || tile.ramp) continue;
      for (const dir of dirs) {
        const neighbor = tileAt(tile.x + dir.x, tile.y + dir.y);
        if (!neighbor || neighbor.ramp) continue;
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
        if (!skirt || skirt.ramp || skirt.water) continue;
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

  // River widths are authored in GAMEPLAY tiles (broad 4-8 tile canyons);
  // during coarse design each generator tile ships as gameplayScale tiles,
  // so the carved width must shrink accordingly — otherwise a "7-wide"
  // canyon on a 30-tile-wide coarse map is really 14 gameplay tiles and two
  // of them flatten a third of the zone, shredding every plateau.
  function _designScale() {
    return Math.max(1, Math.round(_gameplayTilesPerModelTile));
  }

  function chooseRiverBaseWidth() {
    // new variable: baseWidth is intentionally canyon-scale; rivers are broad cuts through plateau fields, not tiny streams.
    const gameplayWidth = weightedPick([{ value: 6, weight: 28 }, { value: 7, weight: 46 }, { value: 8, weight: 26 }]);
    return Math.max(2, Math.round(gameplayWidth / _designScale()));
  }

  function riverWidthForStep(baseWidth, step, changeEvery, salt) {
    const segment = Math.floor(step / changeEvery);
    const minW = Math.max(2, Math.round(4 / _designScale()));
    const maxW = Math.max(minW + 1, Math.round(8 / _designScale()));
    // new variable: widthPhase gives canyons wide/narrow reaches while staying broadly carved.
    const widthPhase = (segment + salt) % 7;
    if (widthPhase === 0) return Math.max(minW, baseWidth - 1);
    if (widthPhase === 3 || widthPhase === 5) return Math.min(maxW, baseWidth + 1);
    return baseWidth;
  }

  function generateRivers() {
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

  function chooseEntry() {
    const requested = settings.entrySide === 'random' ? pick(['north', 'east', 'south', 'west']) : settings.entrySide;
    const candidates = [];
    if (requested === 'north' || requested === 'south') {
      const y = requested === 'north' ? 0 : settings.height - 1;
      for (let x = 1; x < settings.width - 1; x++) candidates.push({ x, y, side: requested });
    } else {
      const x = requested === 'west' ? 0 : settings.width - 1;
      for (let y = 1; y < settings.height - 1; y++) candidates.push({ x, y, side: requested });
    }
    const shuffled = shuffle(candidates);
    let chosen = shuffled.find(p => !tileAt(p.x, p.y).water) || shuffled[0];
    if (!chosen) chosen = { x: 0, y: Math.floor(settings.height / 2), side: 'west' };
    map.entry = { x: chosen.x, y: chosen.y, side: chosen.side, type: 'mapEntry' };
    logDebug(`entry: ${map.entry.side} border at ${map.entry.x},${map.entry.y}`);
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
      const dims = chance(0.7) ? { w: 2, h: 2 } : { w: 2, h: 1 };
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
      const anchor = nearestFreeNeighbor(spot.x + Math.floor(dims.w / 2), spot.y + dims.h);
      addObject({
        type: 'animalDen',
        x: spot.x,
        y: spot.y,
        w: dims.w,
        h: dims.h,
        blocksMovement: true,
        escapeAnchor: anchor,
        pathAnchor: anchor,
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
    if (!tile || tile.water) return false;
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
      if (!a || !b || a.water || b.water) return false;
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
          if (!mid || mid.water || mid.occupiedBy) continue;
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
      cleared += clearBlockingObjectsOnPath(path);
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
      if (pathHidden || pathBridges) {
        markInvisiblePath(path, 'forcedHiddenReachabilitySweep', null);
        hiddenTiles += pathHidden;
        bridgeTiles += pathBridges;
        connected++;
      } else {
        break;
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
            if (!targetTile || !isWalkableTile(targetTile)) return;
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

  function validateAndRepairReachability() {
    const start = nearestFreeWalkableNeighbor(map.entry.x, map.entry.y);
    const componentRepair = repairReachabilityByComponents(start);
    let clearedObjects = componentRepair.clearedObjects || 0;

    let finalReachable = reachableFrom(start);
    let finalWalkable = allWalkableTiles();
    let finalUnreachable = finalWalkable.filter(tile => !finalReachable.has(keyXY(tile.x, tile.y)));
    const hiddenStitch = finalUnreachable.length ? stitchReachabilityWithHiddenLedges(start) : { stitchedEdges: 0, hiddenTiles: 0, passes: 0 };
    if (hiddenStitch.stitchedEdges) {
      finalReachable = reachableFrom(start);
      finalWalkable = allWalkableTiles();
      finalUnreachable = finalWalkable.filter(tile => !finalReachable.has(keyXY(tile.x, tile.y)));
      logDebug(`hidden ledge reachability stitch: ${hiddenStitch.stitchedEdges} connector edges, ${hiddenStitch.hiddenTiles} hidden nav-ramp tiles, remaining unreachable ${finalUnreachable.length}`);
    }
    const hiddenSweep = finalUnreachable.length ? forceHiddenReachabilitySweep(start, 120) : { connected: 0, hiddenTiles: 0, bridgeTiles: 0, attempts: 0, cleared: 0 };
    if (hiddenSweep.connected || hiddenSweep.hiddenTiles || hiddenSweep.bridgeTiles) {
      clearedObjects += hiddenSweep.cleared || 0;
      finalReachable = reachableFrom(start);
      finalWalkable = allWalkableTiles();
      finalUnreachable = finalWalkable.filter(tile => !finalReachable.has(keyXY(tile.x, tile.y)));
      logDebug(`hidden reachability sweep: ${hiddenSweep.connected} forced connector paths, ${hiddenSweep.hiddenTiles} hidden nav-ramp tiles, ${hiddenSweep.bridgeTiles} hidden bridge tiles, remaining unreachable ${finalUnreachable.length}`);
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
      clearedBlockingObjects: clearedObjects,
      invisiblePathCount: map.invisiblePaths.length,
      rule: 'Every tile counted here excludes water without a bridge, cliff-skirt wall tiles, and blocking objects. Component-frontier repairs use hidden nav ramps/bridges; visible ramps stay authored cliff ledges.'
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

    const naturalLosBudget = Math.min(natural.length, Math.max(70, settings.treasure * 2 + settings.forage));
    const caveLosBudget = Math.min(cave.length, Math.max(45, settings.caves * 10));
    const losMaxSamples = settings.width * settings.height >= 9000 ? 96 : 160;
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

  function placeCopses() {
    // NOTE: copse tiles are a simplified proxy for denser forest spawning in the larger game.
    // The duplicate game should spawn slightly more trees than copse tiles where room allows,
    // so the map keeps a readable tile plan without pretending to be exact tree placement.
    const targetCopseTiles = settings.trees;
    let placedCopseTiles = 0;
    let copseClusterCount = 0;
    let shadowCopseTiles = 0;
    const maxClusterAttempts = Math.max(200, targetCopseTiles * 7);

    function copseEligible(x, y) {
      const tile = tileAt(x, y);
      if (!tile) return false;
      if (tile.water || tile.river || tile.path || tile.ramp || tile.cliffSkirt || tile.waterfall) return false;
      if (tile.occupiedBy) return false;
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

      while (queue.length && chosen.length < desiredSize) {
        queue.sort((a, b) => (southFacingCliffShadowScore(b.x, b.y) + noise2(b.x, b.y, 94411) * 0.25) - (southFacingCliffShadowScore(a.x, a.y) + noise2(a.x, a.y, 94411) * 0.25));
        const candidate = queue.shift();
        if (!copseEligible(candidate.x, candidate.y)) continue;
        chosen.push(candidate);

        const sourceTile = tileAt(candidate.x, candidate.y);
        shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]).forEach(([dx, dy]) => {
          const nx = candidate.x + dx;
          const ny = candidate.y + dy;
          const key = `${nx},${ny}`;
          if (seen.has(key)) return;
          seen.add(key);
          const nextTile = tileAt(nx, ny);
          if (!nextTile) return;
          if (Math.abs(nextTile.elevation - sourceTile.elevation) > 1) return;
          if (!copseEligible(nx, ny)) return;
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
        filter: (x, y) => {
          const tile = tileAt(x, y);
          return tile && !tile.water && !tile.path && !tile.ramp && !tile.cliffSkirt && areaElevationSpread(x, y, 1, 1) <= 0;
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
        filter: (x, y) => {
          const tile = tileAt(x, y);
          const nearCopse = orthogonalNeighbors(tile).some(next => {
            const object = next.occupiedBy ? getObjectById(next.occupiedBy) : null;
            return object && object.type === 'copse';
          });
          return tile && !tile.water && !tile.path && !tile.ramp && !tile.cliffSkirt && (nearCopse || tile.elevation >= 1 || noise2(x, y, 7137) > 0.52);
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
        filter: (x, y) => {
          const tile = tileAt(x, y);
          if (!tile || tile.water || tile.path || tile.ramp || tile.cliffSkirt) return false;
          const nearCopse = orthogonalNeighbors(tile).some(next => {
            const object = next.occupiedBy ? getObjectById(next.occupiedBy) : null;
            return object && object.type === 'copse';
          });
          return nearCopse || noise2(x, y, 8129) > 0.72;
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
    // FIXED vs the prototype: bridges must win over water, or every bridge
    // exports as river/stream — which the game blocks like a wall, stranding
    // whole regions the generator considered connected.
    if (tile.path || tile.bridge || tile.navBridge) return 'path';
    if (tile.water) return tile.terrain === 'river' ? 'river' : 'stream';
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
    let exportable = scored.filter(item => item.interiorCount >= minimumInterior && item.interiorCount + item.ringCount >= minimumFootprint);
    const droppedTiny = scored.length - exportable.length;
    const maxSubmaps = 96;
    if (exportable.length > maxSubmaps) {
      exportable = exportable
        .sort((a, b) => (b.interiorCount + b.ringCount) - (a.interiorCount + a.ringCount))
        .slice(0, maxSubmaps)
        .sort((a, b) => a.index - b.index);
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
    // A reachability seal is absolute — no object overlay may soften it back
    // into a walkable weeds/shrub tile, and it must NOT keep its plateau tag
    // (the merge ignores a plateau-tagged tile's own type, so a sealed cell
    // on the footprint's bbox edge would be staked walkable again). Dropping
    // the tag exports it as plain solid rock; hobunjiMakeSubmapForGroup
    // excludes sealed cells from the mask the same way.
    if (tile.cliffSkirtKind === 'sealedUnreachable') {
      return hobunjiCleanTileRecord({ type: 'rock', crop: '' });
    }
    const overlay = overlayByTile.get(`${tile.x},${tile.y}`);
    const output = {
      type: overlay && !tile.water && !tile.ramp && !tile.path ? overlay.type : hobunjiMapTileType(tile),
      crop: ''
    };
    const group = plateauByGroupId.get(tile.plateauGroupId);
    // A tile cannot be both editor plateau geometry and editor ramp geometry; keep plateau contact as ramp metadata only.
    if (group && !tile.ramp) output.plateau = group.id;
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
    // Same rule as hobunjiRootTileRecord: a reachability seal is absolute.
    if (tile.cliffSkirtKind === 'sealedUnreachable') {
      return hobunjiCleanTileRecord({ type: 'rock', crop: '' });
    }
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
      // Generated rock tiles are real cliff-skirt walls/seals, not the
      // decorative rocks the game demotes to grass on authored zone maps —
      // mergeZoneTiles must keep them solid (see docs/game.js).
      keepRockTiles: true,
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

  // REWORKED vs the prototype: the game merge (docs/game.js mergeZoneTiles)
  // computes the plateau footprint from the EXPORTED mask (plateau-tagged
  // root tiles, i.e. this group's cells minus ramp cuts) and stakes its own
  // auto-incline ring with a 4-neighbor lower-support rule — while the
  // prototype's `plateauRing` flag uses an 8-neighbor rule. Cells that
  // disagreed were staked walkable by the game with nothing re-stamping
  // them: phantom walkable tiles no repair could reach or seal. This builds
  // the submap from the exact mask + ring rule the game will apply, and
  // opens ramp-mouth landings the same way authored submaps do — by
  // re-stamping the mask cell beside a flush ramp tile as walkable top.
  function hobunjiMakeSubmapForGroup(rootId, group, overlayByTile, plateauByGroupId) {
    const toTier = group.elevation || 0;
    const mask = new Set();
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const tile of allTiles()) {
      if (tile.plateauGroupId !== group.id || tile.ramp) continue;
      if (tile.cliffSkirtKind === 'sealedUnreachable') continue; // exported as plain rock, not part of the footprint
      mask.add(`${tile.x},${tile.y}`);
      if (tile.x < minC) minC = tile.x;
      if (tile.x > maxC) maxC = tile.x;
      if (tile.y < minR) minR = tile.y;
      if (tile.y > maxR) maxR = tile.y;
    }
    if (!mask.size) return null;
    const cols = Math.max(1, maxC - minC + 1 - 2);
    const rows = Math.max(1, maxR - minR + 1 - 2);
    const anchorC = minC + 1;
    const anchorR = minR + 1;
    const submap = hobunjiBaseMap(
      `map_generated_wilderness_${group.id}`,
      `Generated Wilderness — ${group.label}`,
      cols,
      rows,
      { isSubmap: true, parentMapId: rootId, plateauGroupId: group.id, elevation: toTier, anchorC, anchorR }
    );

    // A flush ramp mouth: a cardinal neighbor that is a ramp tile whose lerp
    // has (almost) reached this tier — the landing cell beside it must be
    // stamped walkable or the game's auto-incline ring walls the ramp off.
    const flushRampMouth = (x, y) => {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = tileAt(x + dx, y + dy);
        if (n && n.ramp && tileHeight(n) >= toTier - 0.21) return true;
      }
      return false;
    };

    // Stamp only the prototype's own interior (8-neighbor ring excluded) —
    // this matches the standalone generator's manual map-editor export, so
    // the mesa's smooth blend band renders every edge alone. Stamping the
    // wider merge-rule interior put flat floor tiles inside the sloped blend
    // band, which read as segmented/topless plateau edge tiles. Edge cells
    // the game stakes walkable but nothing stamps stay mesa-covered and are
    // reachability-EXEMPT (see enforceGameReachability). Flush ramp mouths
    // are the one exception — they must stamp open or the ramp is walled.
    let paintedTiles = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = anchorC + c, y = anchorR + r;
        if (!mask.has(`${x},${y}`)) continue;
        const sourceTile = tileAt(x, y);
        if (!sourceTile) continue;
        if (sourceTile.plateauRing && !flushRampMouth(x, y)) continue;
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
        width: ramp.kind === 'wrap' ? 2 : 1,
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
      note: 'Flattened from WildernessMapGeneratorV32. Unsupported generated object types are encoded as supported editor tile types plus generatedObject metadata. Tiny canyon-cut plateau fragments may be root-only to keep Map Editor imports lightweight.'
    };

    const submaps = [];
    for (const group of plateauGroups) {
      const submap = hobunjiMakeSubmapForGroup(rootId, group, overlayByTile, plateauByGroupId);
      if (submap) submaps.push(submap);
    }

    const workspace = {
      schema: 'hobunji_map_editor_workspace.v1',
      generator: 'WildernessMapGeneratorV32',
      generatedAt: new Date().toISOString(),
      maps: [root, ...submaps],
      activeId: root.id,
      gameLink: {
        exteriorId: root.id,
        interiorId: '',
        townId: ''
      },
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
      `  tiles: ${tileCount}`,
      `  plateau groups: ${workspace.plateauGroups.length}${map.exportPlateauTinyGroupsSkipped ? ` (${map.exportPlateauTinyGroupsSkipped} tiny/root-only groups skipped)` : ''}`,
      `  manual plateau ring tiles: ${map.plateauPaintGroups.reduce((sum, group) => sum + (group.ringKeys ? group.ringKeys.length : 0), 0)}`,
      `  manual plateau interior tiles: ${map.plateauPaintGroups.reduce((sum, group) => sum + (group.interiorKeys ? group.interiorKeys.length : 0), 0)}`,
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
      rampSkirt: tile.rampSkirt,
      waterfall: tile.waterfall,
      occupiedBy: tile.occupiedBy
    })));
    const summary = summarizeMap();
    return {
      schema: map.schema,
      version: map.version,
      seed: map.seed,
      width: map.width,
      height: map.height,
      entry: map.entry,
      routeStyle: 'Stardew/Pokemon-like wilderness: sparse visible roads, clustered messy Giant\'s-Causeway-like plateau fields, manual-style reserved cliff rings, wraparound ramps with shared plateau contact tiles, cave mouths in cliff faces, wild animal dens, and invisible navigation corridors for full walkable-tile reachability',
      cameraLocked: true,
      visibilityRule: 'plateaus are generated as clustered manual-paint-style causeway cells rather than global shelves; each footprint owns its reserved outer ring and inset submap top',
      riverWidthRule: 'big canyon rivers vary along their length; each sampled width is usually 4-8 tiles and carves river beds down through raised plateau fields',
      pathingRule: 'visible paths are sparse. invisiblePaths reserve natural walkable corridors for players, NPCs, and animal escape routing without drawing extra beaten roads.',
      hiddenRewardRule: 'After reachability is finalized, difficult-to-reach areas are scored by real travel distance, seclusion, route visibility, and nearby line-of-sight observer counts, then used for extra treasure digspots, rare herbs, and secret caves.',
      animalActivityRule: 'Live animal symbols use den-based cyclic routes. Prey graze or inspect resources for 15 simulated minutes, pack predators hunt prey route stops, ambush predators wait alone near cover, and bear-like omnivores fish, forage, inspect hives, and visit prey conflict points.',
      legend: {
        elevation: 'numbered vertical tier. 0 = ground, higher numbers = plateau tiers.',
        height: 'render/traversal height. Normal tiles equal elevation; ramp tiles are fractional lerps.',
        ramp: 'designated slope tiles connecting significant tier jumps. rampProgress 0..1 lerps from rampFromTier to rampToTier.',
        pond: 'irregular water blob',
        river: 'border-crossing canyon water with widthSamples; widths usually vary between 4 and 8 tiles and carve broad channels through plateau fields',
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
    }
    const objectCounts = {};
    for (const object of map.objects) objectCounts[object.type] = (objectCounts[object.type] || 0) + 1;
    return { terrainCounts, objectCounts, highestTier, waterTiles: water, pathTiles: path, invisiblePathTiles: invisiblePaths, denRouteTiles, bridgeTiles: bridges, navBridgeTiles: navBridges, hiddenNavRamps: map.hiddenNavRamps ? map.hiddenNavRamps.length : 0, rampTiles: ramps, rampConnections: map.ramps.length, sharedRampPlateauTiles, cliffSkirtTiles: cliffSkirts, plateauRingTiles, plateauInteriorTiles, plateauPaintGroups: map.plateauPaintGroups.length, waterfallTiles: waterfalls, animalDens: countObjects('animalDen'), animalSymbols: map.animalActivity ? map.animalActivity.agents.length : 0, animalFoodSources: map.animalActivity ? map.animalActivity.resources.length : 0, unreachableTiles: map.connectivity ? map.connectivity.unreachableTiles : null, tierAreas: tierAreaCounts() };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Game-rule reachability enforcement
  //
  //  Everything above validates reachability under the PROTOTYPE's movement
  //  model, whose repair passes lean on "hidden nav ramp" tiles — metadata
  //  the game never reads. The game builds its walkability from the merged
  //  workspace instead (docs/game.js mergeZoneTiles + tileSpeedAt):
  //    · every exported plateau footprint gets an auto-incline ring that is
  //      always impassable except where an explicit ramp tile cuts it,
  //    · cliff-skirt tiles export as solid rock,
  //    · rivers/streams/waterfalls block movement (bridges export as path),
  //    · object overlays of rock/shrub are solid.
  //  This pass replays those exact semantics, BFS-floods from the map entry
  //  with a real climb limit (rise per tile ≤ tan(rampMaxAngle), using the
  //  game's 2.5-world-unit tier height), then repairs what the game would
  //  seal off: first by carving real slope-compliant ramp lines through
  //  plateau rings/skirts, and as a last resort by sealing leftover pockets
  //  into rock so no walkable-but-unreachable tile survives into the export.
  // ═══════════════════════════════════════════════════════════════════════

  // Faithful replay of the game's zone merge (docs/game.js mergeZoneTiles)
  // over an exported workspace, reduced to what walkability needs: type,
  // elevTier, incline and rampElevation per world cell. Keeping this in
  // lock-step with the game is what makes the reachability guarantee real —
  // scripts/check-wilderness-generator.js re-verifies the same semantics.
  function mergeWorkspaceForGame(workspace) {
    const maps = workspace.maps;
    const root = maps[0];
    const childByParentGroup = new Map();
    for (const m of maps) {
      if (m.isSubmap && m.parentMapId && m.plateauGroupId) {
        childByParentGroup.set(`${m.parentMapId}__${m.plateauGroupId}`, m);
      }
    }
    const plateauElevById = new Map((workspace.plateauGroups || []).map(g => [g.id, g.elevation || 0]));
    const outTiles = new Map();

    function mergeOne(m, offsetC, offsetR, baseTier) {
      const groupMask = new Map();
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        const plateauId = m.tiles?.[`${c},${r}`]?.plateau;
        if (!plateauId) continue;
        let mask = groupMask.get(plateauId);
        if (!mask) { mask = new Set(); groupMask.set(plateauId, mask); }
        mask.add(`${c},${r}`);
      }
      const tierAt = (c, r) => {
        const pid = m.tiles?.[`${c},${r}`]?.plateau;
        return pid ? (plateauElevById.get(pid) || 0) : baseTier;
      };
      const children = [];
      for (const [gid, mask] of groupMask) {
        const child = childByParentGroup.get(`${m.id}__${gid}`);
        if (!child) continue;
        const toTier = plateauElevById.get(gid) || 0;
        let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
        for (const k of mask) { const [c, r] = k.split(',').map(Number); if (c < minC) minC = c; if (c > maxC) maxC = c; if (r < minR) minR = r; if (r > maxR) maxR = r; }
        for (let pass = 0; pass < 8; pass++) {
          let filled = false;
          for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
            const k = `${c},${r}`;
            if (mask.has(k) || m.tiles?.[k]) continue;
            const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => mask.has(`${c + dc},${r + dr}`)).length;
            if (n >= 3) { mask.add(k); filled = true; }
          }
          if (!filled) break;
        }
        for (const k of mask) {
          const [lc, lr] = k.split(',').map(Number);
          const c = lc + offsetC, r = lr + offsetR;
          let ringTier = null;
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (mask.has(`${lc + dc},${lr + dr}`)) continue;
            const supportTier = tierAt(lc + dc, lr + dr);
            if (supportTier < toTier) ringTier = ringTier === null ? supportTier : Math.min(ringTier, supportTier);
          }
          const onRing = ringTier !== null;
          // `staked: true` = written by footprint staking, nothing stamped it
          // — the game renders it via the mesa (skipFloor), it's cosmetic
          // plateau-edge cover, and reachability treats it as exempt.
          outTiles.set(`${c},${r}`, { type: 'grass', elevTier: onRing ? ringTier : toTier, rampElevation: 0, incline: onRing, staked: true });
        }
        children.push({ child, childOffsetC: offsetC + minC + 1, childOffsetR: offsetR + minR + 1, toTier });
      }
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        const t = m.tiles?.[`${c},${r}`];
        const key = `${c + offsetC},${r + offsetR}`;
        if (!t || t.plateau) {
          if (!outTiles.has(key)) outTiles.set(key, { type: 'grass', elevTier: baseTier, rampElevation: 0, incline: false });
          continue;
        }
        let type = t.type || 'grass';
        if (!t.plateau && type === 'rock' && !m.keepRockTiles) type = 'grass';
        outTiles.set(key, {
          type, elevTier: baseTier,
          rampElevation: type === 'ramp' ? (t.rampElevation || 0) : 0, incline: false,
        });
      }
      for (const { child, childOffsetC, childOffsetR, toTier } of children) {
        mergeOne(child, childOffsetC, childOffsetR, toTier);
      }
    }

    mergeOne(root, 0, 0, 0);
    return outTiles;
  }

  const GAME_SOLID_TYPES = new Set(['rock', 'shrub', 'river', 'stream', 'waterfall']);

  // Exports the current tile model and merges it exactly the way the game
  // will, yielding a flat per-cell view: { blocked, tier (in elevation
  // tiers, ramps fractional), ramp }.
  function buildGameMergedView() {
    const workspace = buildHobunjiMapExport();
    const width = settings.width, height = settings.height;
    const merged = mergeWorkspaceForGame(workspace);
    const view = new Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = merged.get(`${x},${y}`) || { type: 'grass', elevTier: 0, rampElevation: 0, incline: false };
        const isRamp = t.type === 'ramp';
        view[y * width + x] = {
          // Staked plateau-edge cover (no stamped floor — the mesa's cliff
          // blend is all that renders there) is SOLID in-game (see
          // tileSpeedAt's skipFloor rule), so it is blocked here too; every
          // non-colliding tile stays under the full reachability guarantee.
          blocked: !!t.incline || !!t.staked || GAME_SOLID_TYPES.has(t.type),
          tier: isRamp ? (t.rampElevation || 0) : (t.elevTier || 0),
          ramp: isRamp,
          staked: !!t.staked,
        };
      }
    }
    // Ramp curtains (docs/game.js buildZoneScene): any non-ramp tile beside a
    // ramp tile whose surface differs by ≥ RAMP_FLUSH_EPS (0.5 world-Y) is
    // folded into the ramp's cliff skirt and becomes fully solid. The
    // comparison is done in WORLD units with the exact same arithmetic as
    // the game — comparing in tier units flips borderline cases through
    // float rounding (0.19999…·2.5 = 0.50000…4).
    const RAMP_FLUSH_EPS_WORLD = 0.5;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const here = view[y * width + x];
        if (!here.ramp) continue;
        const rampY = here.tier * GAME_TIER_RISE;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = view[ny * width + nx];
          if (n.ramp || n.blocked) continue;
          if (Math.abs(rampY - n.tier * GAME_TIER_RISE) >= RAMP_FLUSH_EPS_WORLD) n.blocked = true;
        }
      }
    }
    return view;
  }

  // Max climbable rise per one-tile step, in TIER units. tan(maxAngle) gives
  // world-Y per tile; divide by the game's tier height. Small tolerance so a
  // ramp whose lerp lands within rounding of the limit still connects.
  function gameMaxStepTiers() {
    const angleRadians = rampMaxAngleDegrees() * Math.PI / 180;
    return (Math.tan(angleRadians) * 1.08) / GAME_TIER_RISE;
  }

  function gameReachableSet(view, start) {
    const width = settings.width, height = settings.height;
    const maxStep = gameMaxStepTiers();
    const seen = new Set();
    const queue = [];
    const startIdx = start.y * width + start.x;
    if (view[startIdx] && !view[startIdx].blocked) {
      seen.add(startIdx);
      queue.push(startIdx);
    }
    for (let i = 0; i < queue.length; i++) {
      const idx = queue[i];
      const x = idx % width, y = Math.floor(idx / width);
      const here = view[idx];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (seen.has(nIdx)) continue;
        const next = view[nIdx];
        if (!next || next.blocked) continue;
        if (Math.abs(next.tier - here.tier) > maxStep) continue;
        seen.add(nIdx);
        queue.push(nIdx);
      }
    }
    return seen;
  }

  // Finds the game-rule entry tile: nearest tile to map.entry that the merged
  // view considers walkable.
  function gameStartTile(view) {
    const width = settings.width, height = settings.height;
    const ex = map.entry ? map.entry.x : Math.floor(width / 2);
    const ey = map.entry ? map.entry.y : height - 1;
    let best = null, bestDist = Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (view[y * width + x].blocked) continue;
        const d = Math.abs(x - ex) + Math.abs(y - ey);
        if (d < bestDist) { bestDist = d; best = { x, y }; }
        if (d === 0) return best;
      }
    }
    return best;
  }

  // Stamps a straight, slope-compliant ramp line into the real tile model.
  // Cells become ordinary ramp tiles (exported as type 'ramp' with lerped
  // rampElevation), so the game renders a walkable slope and its ramp-curtain
  // pass walls off the sides automatically.
  function stampGameRepairRamp(cells, fromTier, toTier, rampId) {
    const run = cells.length;
    clearBlockingObjectsOnPath(cells);
    cells.forEach((cell, index) => {
      const tile = tileAt(cell.x, cell.y);
      if (!tile) return;
      // Widened carves carry per-cell progress; fall back to index order for
      // plain single-lane lines.
      const t = Number.isFinite(cell.t) ? cell.t : (run > 1 ? index / (run - 1) : 1);
      tile.ramp = true;
      tile.rampId = rampId;
      tile.rampProgress = Number(t.toFixed(3));
      tile.rampFromTier = fromTier;
      tile.rampToTier = toTier;
      tile.rampDirection = null;
      tile.rampKind = 'gameRepair';
      // 2 decimals: matches the export's rampElevation precision exactly.
      tile.height = Number((fromTier + (toTier - fromTier) * t).toFixed(2));
      tile.water = false;
      tile.waterfall = false;
      tile.bridge = false;
      tile.navBridge = false;
      tile.cliffSkirt = false;
      tile.cliffSkirtKind = null;
      tile.rampSkirt = false;
      tile.path = false;
    });
    map.ramps.push({
      id: rampId,
      fromTier,
      toTier,
      kind: 'gameRepair',
      tiles: cells.map(cell => ({ x: cell.x, y: cell.y })),
      angleDegrees: Number(rampAngleDegrees(Math.abs(toTier - fromTier), Math.max(1, cells.length - 1)).toFixed(1)),
      maxAngleDegrees: rampMaxAngleDegrees(),
      note: 'carved by enforceGameReachability to reconnect a region the game merge would seal off',
    });
  }

  // Scans the frontier between the reached set and everything else for
  // straight carves: a line from a reached tile, across blocked cells, into
  // an unreached walkable tile, extended (into either side's open ground)
  // until the slope satisfies the max climb angle. Returns candidates
  // { cells, fromTier, toTier, score } sorted best-first.
  function findGameRepairCarves(view, reached) {
    const width = settings.width, height = settings.height;
    const maxSpan = 18;             // longest straight carve we will attempt
    const maxBlockedGap = 6;        // widest wall of blocked cells to tunnel through
    const candidates = [];

    const viewAt = (x, y) => (x < 0 || y < 0 || x >= width || y >= height) ? null : view[y * width + x];
    const carvable = (x, y) => {
      const tile = tileAt(x, y);
      if (!tile) return false;
      // Never carve through open water/waterfalls (a ramp floating across a
      // river reads wrong) — those crossings belong to bridges.
      if ((tile.water || tile.waterfall) && !tile.bridge && !tile.navBridge) return false;
      // Don't drive a ramp through a structure/cave/den — those objects are
      // protected from clearBlockingObjectsOnPath and would sit on the ramp.
      if (tile.occupiedBy) {
        const object = getObjectById(tile.occupiedBy);
        if (object && object.blocksMovement !== false &&
            (object.type === 'structure' || object.type === 'caveOpening' || object.type === 'animalDen')) return false;
      }
      return true;
    };

    for (const idx of reached) {
      const x0 = idx % width, y0 = Math.floor(idx / width);
      const fromTier = view[idx].tier;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        // March forward over blocked cells until we hit unreached walkable.
        let gap = 0, tx = x0 + dx, ty = y0 + dy, found = null;
        while (gap < maxBlockedGap) {
          const v = viewAt(tx, ty);
          if (!v) break;
          if (!v.blocked) {
            const tIdx = ty * width + tx;
            if (!reached.has(tIdx)) found = { x: tx, y: ty, tier: v.tier };
            break;
          }
          if (!carvable(tx, ty)) break;
          gap++;
          tx += dx; ty += dy;
        }
        if (!found || gap === 0) continue;

        const toTier = found.tier;
        const diff = Math.abs(toTier - fromTier);
        const runNeeded = diff > 0 ? minRampRunForAngle(diff) : 0;
        // Total carve = start anchor + gap + landing, extended on both open
        // ends until the slope is legal.
        let cells = [{ x: x0, y: y0 }];
        for (let g = 1; g <= gap; g++) cells.push({ x: x0 + dx * g, y: y0 + dy * g });
        cells.push({ x: found.x, y: found.y });
        let extendLow = { x: x0 - dx, y: y0 - dy };
        let extendHigh = { x: found.x + dx, y: found.y + dy };
        let guard = 0;
        while (cells.length - 1 < runNeeded && guard++ < maxSpan) {
          const lowV = viewAt(extendLow.x, extendLow.y);
          const highV = viewAt(extendHigh.x, extendHigh.y);
          if (highV && !highV.blocked && Math.abs(highV.tier - toTier) < 0.01 && carvable(extendHigh.x, extendHigh.y)) {
            cells.push({ x: extendHigh.x, y: extendHigh.y });
            extendHigh = { x: extendHigh.x + dx, y: extendHigh.y + dy };
          } else if (lowV && !lowV.blocked && Math.abs(lowV.tier - fromTier) < 0.01 && carvable(extendLow.x, extendLow.y)) {
            cells.unshift({ x: extendLow.x, y: extendLow.y });
            extendLow = { x: extendLow.x - dx, y: extendLow.y - dy };
          } else {
            break;
          }
        }
        if (cells.length - 1 < runNeeded) continue;
        if (cells.some(cell => !carvable(cell.x, cell.y))) continue;

        // Each cell carries its own progress along the climb so widened
        // lanes (below) inherit the same lerp as their primary-lane cell.
        const runLen = Math.max(1, cells.length - 1);
        cells = cells.map((cell, i) => ({ ...cell, t: i / runLen }));
        // Carves run at gameplay resolution, AFTER the upscale — widen the
        // line to gameplayScale lanes so repair inclines match the "1
        // generator tile = scale×scale gameplay tiles" chunkiness instead of
        // shipping as 1-tile-wide strips. Each extra lane is added only
        // where every one of its cells is carvable.
        const laneCount = Math.max(1, Math.round(settings.gameplayScale || 1));
        if (laneCount > 1) {
          const primary = cells.slice();
          for (const side of [[dy, dx], [-dy, -dx]]) {
            if (cells.length >= primary.length * laneCount) break;
            for (let k = 1; k < laneCount; k++) {
              const lane = primary.map(cell => ({ x: cell.x + side[0] * k, y: cell.y + side[1] * k, t: cell.t }));
              const laneOk = lane.every(cell => {
                const v = viewAt(cell.x, cell.y);
                return v && carvable(cell.x, cell.y);
              });
              if (!laneOk) break;
              cells = cells.concat(lane);
            }
          }
        }

        // Prefer short walls, small climbs, and reconnections near the entry.
        const score = gap * 2 + diff * 3 + cells.length * 0.25
          + (map.entry ? (Math.abs(found.x - map.entry.x) + Math.abs(found.y - map.entry.y)) * 0.01 : 0);
        candidates.push({ cells, fromTier, toTier, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Gameplay upscale — 1 generator tile → scale×scale gameplay tiles
  //
  //  The generator designs at a coarse resolution, then the whole tile
  //  model inflates so every coarse cell becomes a scale×scale block of
  //  gameplay tiles: corridors, inclines, plateaus, and rivers all get
  //  proportionally wider, and a ramp's climb spreads over scale× the run
  //  (fuseRampInclines smooths the duplicated staircase heights right
  //  after). Runs BEFORE sanitation/reachability so every guarantee is
  //  enforced at the resolution the game actually plays.
  // ═══════════════════════════════════════════════════════════════════════
  function upscaleModelForGameplay(scale) {
    if (!Number.isFinite(scale) || scale <= 1) return;
    const coarseW = settings.width, coarseH = settings.height;
    const fineW = coarseW * scale, fineH = coarseH * scale;
    const coarseTiles = map.tiles;

    settings.width = fineW;
    settings.height = fineH;
    map.width = fineW;
    map.height = fineH;
    map.tiles = [];
    map.flatTiles = [];
    for (let y = 0; y < fineH; y++) {
      const row = [];
      for (let x = 0; x < fineW; x++) {
        const src = coarseTiles[Math.floor(y / scale)][Math.floor(x / scale)];
        const tile = { ...src, x, y };
        row.push(tile);
        map.flatTiles.push(tile);
      }
      map.tiles.push(row);
    }

    const half = Math.floor(scale / 2);
    const scalePoint = (p) => ({ ...p, x: p.x * scale + half, y: p.y * scale + half });
    if (map.entry) map.entry = scalePoint(map.entry);
    for (const object of map.objects) {
      object.x = (object.x || 0) * scale;
      object.y = (object.y || 0) * scale;
      object.w = (object.w || 1) * scale;
      object.h = (object.h || 1) * scale;
      if (object.escapeAnchor) object.escapeAnchor = scalePoint(object.escapeAnchor);
    }
    rebuildObjectCache();
    for (const path of [...(map.paths || []), ...(map.invisiblePaths || [])]) {
      if (Array.isArray(path.points)) path.points = path.points.map(scalePoint);
    }
    for (const river of map.rivers || []) {
      if (Array.isArray(river.points)) river.points = river.points.map(scalePoint);
      if (Number.isFinite(river.widthTiles)) river.widthTiles *= scale;
      if (Number.isFinite(river.widthTilesAverage)) river.widthTilesAverage *= scale;
      if (Array.isArray(river.widthSamples)) {
        river.widthSamples = river.widthSamples.map(s =>
          Number.isFinite(s) ? s * scale : (Number.isFinite(s?.width) ? { ...s, width: s.width * scale } : s));
      }
    }
    for (const ramp of map.ramps || []) {
      if (Array.isArray(ramp.tiles)) ramp.tiles = ramp.tiles.map(t => ({ x: t.x * scale + half, y: t.y * scale + half }));
    }
    // From here on the model IS at gameplay resolution.
    _gameplayTilesPerModelTile = 1;
    logDebug(`gameplay upscale: ${coarseW}x${coarseH} generator tiles → ${fineW}x${fineH} gameplay tiles (1 → ${scale}x${scale})`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Ramp fusion — "ramps" become "inclines"
  //
  //  Individually authored ramps that run near each other (parallel lanes,
  //  switchbacks, a repair carve stamped beside an authored ramp) read as
  //  separate strips with hard height mismatches at their shared edges.
  //  This pass fuses them: any cell wedged between ramp tiles becomes ramp
  //  too, then every connected ramp cluster relaxes into one smooth incline
  //  surface (a harmonic blend), with tiles that sit flush against walkable
  //  ground pinned there so the incline still lands exactly on the terrain
  //  it connects.
  // ═══════════════════════════════════════════════════════════════════════
  const RAMP_FLUSH_TIERS = 0.5 / GAME_TIER_RISE; // the game's RAMP_FLUSH_EPS (0.5 world-Y) in tier units

  function _rampGapCellFillable(tile) {
    if (!tile || tile.ramp) return false;
    if (tile.cliffSkirtKind === 'sealedUnreachable') return false; // a seal is absolute — never fuse it back open
    if ((tile.water || tile.waterfall) && !tile.bridge && !tile.navBridge) return false;
    if (tile.occupiedBy) {
      const object = getObjectById(tile.occupiedBy);
      if (object && object.blocksMovement !== false &&
          (object.type === 'structure' || object.type === 'caveOpening' || object.type === 'animalDen')) return false;
    }
    return true;
  }

  function fuseRampInclines() {
    // 1. Gap fill: a non-ramp cell wedged BETWEEN lanes — ramp neighbors on
    //    opposite sides (left+right or up+down) — gets absorbed so the lanes
    //    become one surface. Iterates to convergence (a fixed 2 passes left
    //    holes that rendered as stone squares punched through the incline's
    //    grass), but requiring an opposite pair keeps concave corners from
    //    flood-filling whole pockets into one giant incline.
    let filled = 0;
    for (let pass = 0; pass < 12; pass++) {
      let passFilled = 0;
      for (const tile of allTiles()) {
        if (!_rampGapCellFillable(tile)) continue;
        const left = tileAt(tile.x - 1, tile.y), right = tileAt(tile.x + 1, tile.y);
        const up = tileAt(tile.x, tile.y - 1), down = tileAt(tile.x, tile.y + 1);
        // Only true between-lanes wedges (opposite-side ramp pairs) are
        // absorbed — corner/elbow rules cascade into flood-filling whole
        // pockets (57% of a zone became one giant incline). Leftover bend
        // notches render as curtained stone nooks or flush grass pockets.
        if (!((left?.ramp && right?.ramp) || (up?.ramp && down?.ramp))) continue;
        const rampNeighbors = cardinalNeighbors(tile.x, tile.y).filter(n => n && n.ramp);
        clearBlockingObjectsOnPath([{ x: tile.x, y: tile.y }]);
        tile.ramp = true;
        tile.rampId = 'fused_incline';
        tile.rampKind = 'fused';
        tile.height = rampNeighbors.reduce((sum, n) => sum + tileHeight(n), 0) / rampNeighbors.length;
        tile.water = false;
        tile.waterfall = false;
        tile.cliffSkirt = false;
        tile.cliffSkirtKind = null;
        tile.rampSkirt = false;
        tile.path = false;
        passFilled++;
      }
      filled += passFilled;
      if (!passFilled) break;
    }

    // 2. Relaxation: per 4-connected cluster, each tile's height becomes the
    //    mean of its ramp neighbors, with flush ground contacts (within the
    //    game's flush epsilon at the start of the pass) pinned as anchors.
    const rampTiles = allTiles().filter(t => t.ramp);
    if (!rampTiles.length) return;
    const anchors = new Map(); // tile -> anchored ground height
    for (const tile of rampTiles) {
      let sum = 0, n = 0;
      for (const nb of cardinalNeighbors(tile.x, tile.y)) {
        if (!nb || nb.ramp) continue;
        if ((nb.water || nb.waterfall) && !nb.bridge && !nb.navBridge) continue;
        if (nb.cliffSkirt) continue;
        const groundH = nb.elevation || 0;
        if (Math.abs(tileHeight(tile) - groundH) <= RAMP_FLUSH_TIERS + 0.05) { sum += groundH; n++; }
      }
      if (n) anchors.set(tile, sum / n);
    }
    for (let iter = 0; iter < 200; iter++) {
      let maxDelta = 0;
      for (const tile of rampTiles) {
        let sum = 0, n = 0;
        for (const nb of cardinalNeighbors(tile.x, tile.y)) {
          if (nb && nb.ramp) { sum += tileHeight(nb); n++; }
        }
        const anchor = anchors.get(tile);
        if (anchor !== undefined) { sum += anchor * 2; n += 2; }
        if (!n) continue;
        const next = sum / n;
        maxDelta = Math.max(maxDelta, Math.abs(next - tileHeight(tile)));
        tile.height = next;
      }
      if (maxDelta < 0.002) break;
    }
    // Quantize to the EXPORT's precision (rampElevation is written at 2
    // decimals) so every flush/curtain comparison the model makes matches
    // what the game will compute from the exported value exactly.
    for (const tile of rampTiles) tile.height = Number(tileHeight(tile).toFixed(2));
    if (filled) logDebug(`ramp fusion: absorbed ${filled} wedged cells into inclines (${rampTiles.length + filled} incline tiles total)`);
  }

  // Nothing may sit on an incline's mouth: wherever a ramp tile meets ground
  // flush (the walk-on/walk-off cells), clear water (bridged into a path
  // crossing), orphaned skirt rock, and blocking objects so the incline's
  // beginning/end is always open.
  function clearRampMouths() {
    let clearedWater = 0, clearedSkirts = 0, clearedObjects = 0;
    for (const tile of allTiles()) {
      if (!tile.ramp) continue;
      for (const nb of cardinalNeighbors(tile.x, tile.y)) {
        if (!nb || nb.ramp) continue;
        const groundH = nb.elevation || 0;
        if (Math.abs(tileHeight(tile) - groundH) > RAMP_FLUSH_TIERS) continue; // side wall — curtained by the game, not a mouth
        if ((nb.water || nb.waterfall) && !nb.bridge && !nb.navBridge) {
          nb.bridge = true; // exports as a walkable path crossing
          nb.waterfall = false;
          clearedWater++;
        }
        if (nb.cliffSkirt && nb.cliffSkirtKind !== 'sealedUnreachable') {
          nb.cliffSkirt = false;
          nb.cliffSkirtKind = null;
          nb.rampSkirt = false;
          clearedSkirts++;
        }
        if (nb.occupiedBy) clearedObjects += clearBlockingObjectsOnPath([{ x: nb.x, y: nb.y }]);
      }
    }
    if (clearedWater || clearedSkirts || clearedObjects) {
      logDebug(`incline mouths: bridged ${clearedWater} water cells, cleared ${clearedSkirts} skirt tiles + ${clearedObjects} blocking objects at flush ramp ends`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Export-shape sanitation
  //
  //  The prototype paints Giant's-Causeway-style plateau fields: ragged
  //  edges, scattered fragment cells, 1-2 tile fingers. Its flat 2D renderer
  //  reads those as texture, but the game's mesa renderer gives every masked
  //  cell a full-height cliff face — a lone fragment or 1-wide finger at
  //  tier 5 becomes a ~12-world-unit topless green blade, and every fragment
  //  grows a rock cliff-skirt ring, carpeting the ground in stone mounds.
  //  Before export: morphologically open (erode then dilate) each plateau
  //  mask so only bodies at least ~3 tiles wide survive, drop groups left
  //  without a real walkable top, and keep only the rock skirts that still
  //  hug a surviving cliff base.
  // ═══════════════════════════════════════════════════════════════════════
  function sanitizeMasksForGameExport() {
    const groups = map.plateauPaintGroups || [];
    const stripTile = (tile) => {
      tile.plateauGroupId = null;
      tile.plateauRing = false;
      tile.plateauInterior = false;
      tile.elevation = 0;
      if (!tile.ramp) tile.height = 0;
      if (tile.terrain === 'plateau') tile.terrain = 'grass';
      if (tile.cliffSkirt) { tile.cliffSkirt = false; tile.cliffSkirtKind = null; }
    };
    let strippedCells = 0, droppedGroups = 0, clearedSkirts = 0;
    for (const group of groups) {
      const cells = allTiles().filter(t => t.plateauGroupId === group.id && !t.ramp);
      if (!cells.length) continue;
      const mask = new Set(cells.map(t => `${t.x},${t.y}`));
      const fullyMasked3x3 = (x, y) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!mask.has(`${x + dx},${y + dy}`)) return false;
          }
        }
        return true;
      };
      const eroded = new Set();
      for (const t of cells) if (fullyMasked3x3(t.x, t.y)) eroded.add(`${t.x},${t.y}`);
      // Dilate the eroded core back out by one cell, but only into cells the
      // original mask painted — blades and fragments never rejoin.
      const opened = new Set(eroded);
      if (eroded.size) {
        for (const t of cells) {
          const key = `${t.x},${t.y}`;
          if (opened.has(key)) continue;
          let touchesCore = false;
          for (let dy = -1; dy <= 1 && !touchesCore; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (eroded.has(`${t.x + dx},${t.y + dy}`)) { touchesCore = true; break; }
            }
          }
          if (touchesCore) opened.add(key);
        }
      }
      // A surviving group needs a real top: cells whose 4 cardinal neighbors
      // are all still masked (the game merge's interior rule).
      let interiorCount = 0;
      for (const key of opened) {
        const [x, y] = key.split(',').map(Number);
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => opened.has(`${x + dx},${y + dy}`))) interiorCount++;
      }
      const keep = interiorCount >= 4 ? opened : new Set();
      if (!keep.size) droppedGroups++;
      for (const t of cells) {
        if (keep.has(`${t.x},${t.y}`)) continue;
        stripTile(t);
        strippedCells++;
      }
    }
    // Rock skirts only survive where they still hug a surviving cliff base.
    for (const tile of allTiles()) {
      if (!tile.cliffSkirt) continue;
      const nearCliff = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const n = tileAt(tile.x + dx, tile.y + dy);
        return !!(n && n.plateauGroupId && !n.ramp);
      });
      if (!nearCliff) {
        tile.cliffSkirt = false;
        tile.cliffSkirtKind = null;
        tile.rampSkirt = false;
        clearedSkirts++;
      }
    }
    logDebug(`export sanitation: stripped ${strippedCells} blade/fragment plateau cells, dropped ${droppedGroups} topless groups, cleared ${clearedSkirts} orphaned cliff-skirt tiles`);
  }

  function enforceGameReachability() {
    // Budget scales with map area; carves are batched (disjoint straight
    // lines per re-merge) so the expensive export+merge replay runs a
    // bounded number of times.
    const maxCarves = Math.max(48, Math.round((settings.width * settings.height) / 40));
    const maxCarvesPerPass = 8;
    let carves = 0;
    let sealed = 0;
    let view, start, reached;

    // Every re-verify first re-fuses ramp clusters (repair carves stamped
    // last pass join their neighbors' incline surface) and re-opens incline
    // mouths, THEN replays the export+merge — so what the BFS sees is what
    // the game will render.
    const refresh = () => {
      fuseRampInclines();
      clearRampMouths();
      view = buildGameMergedView();
      start = gameStartTile(view);
      reached = gameReachableSet(view, start);
    };
    refresh();
    if (!start) {
      warn('game-rule reachability: no walkable tile in merged view');
      return;
    }

    const carveUntilStuck = () => {
      while (carves < maxCarves) {
        let anyUnreachable = false;
        for (let i = 0; i < view.length; i++) {
          if (!view[i].blocked && !reached.has(i)) { anyUnreachable = true; break; }
        }
        if (!anyUnreachable) return;
        const candidates = findGameRepairCarves(view, reached);
        if (!candidates.length) return;
        const used = new Set();
        let stamped = 0;
        for (const carve of candidates) {
          if (carves + stamped >= maxCarves || stamped >= maxCarvesPerPass) break;
          // Keep this pass's carves well apart so they can't interact before
          // the next re-merge verifies them.
          const touchesUsed = carve.cells.some(cell => {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (used.has(`${cell.x + dx},${cell.y + dy}`)) return true;
              }
            }
            return false;
          });
          if (touchesUsed) continue;
          stamped++;
          stampGameRepairRamp(carve.cells, carve.fromTier, carve.toTier, `game_repair_ramp_${carves + stamped}`);
          for (const cell of carve.cells) used.add(`${cell.x},${cell.y}`);
        }
        if (!stamped) return;
        carves += stamped;
        refresh();
      }
    };

    // Seals whatever is currently unreachable into solid rock so the game
    // never shows a walkable tile the player cannot legally reach. Returns
    // how many tiles it sealed.
    const sealedSamples = [];
    const sealUnreachable = () => {
      let roundSealed = 0;
      for (let i = 0; i < view.length; i++) {
        if (view[i].blocked || reached.has(i)) continue;
        const x = i % settings.width, y = Math.floor(i / settings.width);
        const tile = tileAt(x, y);
        if (!tile) continue;
        tile.cliffSkirt = true;
        tile.cliffSkirtKind = 'sealedUnreachable';
        tile.water = false;
        tile.waterfall = false;
        // Strip every flag that outranks rock in hobunjiMapTileType, or the
        // seal would still export as a walkable path/ramp tile.
        tile.path = false;
        tile.bridge = false;
        tile.navBridge = false;
        tile.ramp = false;
        roundSealed++;
        if (sealedSamples.length < 12) sealedSamples.push({ x, y, tier: view[i].tier });
      }
      sealed += roundSealed;
      return roundSealed;
    };

    // Carve+seal runs in rounds: a seal drops its cell out of the plateau
    // mask, which can turn neighboring interior cells into auto-incline ring
    // cells — so each round re-merges and re-verifies until an audit comes
    // back clean. Sealing is monotone (it only ever blocks), so this
    // converges.
    const maxRounds = 8;
    for (let round = 0; round < maxRounds; round++) {
      carveUntilStuck();
      if (!sealUnreachable()) break; // nothing left unreachable — clean
      refresh();
    }
    let walkable = 0, unreachable = 0;
    for (let i = 0; i < view.length; i++) {
      if (view[i].blocked) continue;
      walkable++;
      if (!reached.has(i)) unreachable++;
    }
    // Steepness audit: no reachable adjacent pair may exceed the climb limit
    // unless the merge blocks it (which the BFS already enforces); count any
    // ramp tile whose own slope exceeds the limit as a defect.
    let steepRampEdges = 0;
    const maxStep = gameMaxStepTiers();
    for (let i = 0; i < view.length; i++) {
      if (view[i].blocked || !view[i].ramp) continue;
      const x = i % settings.width, y = Math.floor(i / settings.width);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= settings.width || ny >= settings.height) continue;
        const n = view[ny * settings.width + nx];
        if (!n || n.blocked || !n.ramp) continue;
        if (Math.abs(n.tier - view[i].tier) > maxStep) steepRampEdges++;
      }
    }

    map.gameConnectivity = {
      rule: 'reachability replayed under the game merge semantics (auto-incline plateau rings, rock skirts, blocked waterways) with climb limited to tan(rampMaxAngle) world-units per tile at ' + GAME_TIER_RISE + ' world-units per tier',
      start,
      walkableTiles: walkable,
      unreachableTiles: unreachable,
      carvedRepairRamps: carves,
      sealedTiles: sealed,
      sealedSamples,
      steepRampEdges,
      maxStepTiers: Number(maxStep.toFixed(3)),
    };
    if (unreachable) warn(`game-rule reachability: ${unreachable} walkable tiles still unreachable after ${carves} carves + ${sealed} seals`);
    if (steepRampEdges) warn(`game-rule steepness: ${steepRampEdges} ramp edges exceed the max climb angle`);
    logDebug(`game-rule reachability: ${walkable} walkable, ${unreachable} unreachable, ${carves} carved repair ramps, ${sealed} sealed tiles`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════════════════════════

  function generate(options = {}) {
    settings = normalizeSettings(options);
    rng = makeRng(settings.seed);
    sightBlockerKeyCache = null;
    lastMapEditorExportReport = '';
    _gameplayTilesPerModelTile = Math.max(1, Math.round(settings.gameplayScale || 1));

    initMap();
    generatePlateaus();
    applyManualPlateauPaintingRules();
    generatePonds();
    generateRivers();
    generatePlateauHydrology();
    applyManualPlateauPaintingRules();
    syncTileHeights();
    generateRamps();
    generateCliffSkirts();
    fuseRampInclines();
    clearRampMouths();
    chooseEntry();
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
    // Inflate to gameplay resolution (1 generator tile → scale×scale
    // gameplay tiles), then re-fuse so the duplicated staircase ramp
    // heights relax into smooth inclines at the new resolution.
    upscaleModelForGameplay(settings.gameplayScale);
    fuseRampInclines();
    clearRampMouths();
    // Clean the causeway-texture masks into game-renderable mesa shapes
    // BEFORE any reachability work, so every pass below sees final terrain.
    sanitizeMasksForGameExport();
    validateAndRepairReachability();
    placeDifficultyRewards();
    buildAnimalActivity();
    // Must run LAST: later passes may add blocking objects, and the export
    // below has to reflect the carves/seals this pass makes.
    enforceGameReachability();

    const workspace = buildHobunjiMapExport();
    return {
      workspace,
      objects: map.objects.map(sanitizeObjectForExport),
      entry: map.entry,
      summary: summarizeMap(),
      connectivity: map.connectivity,
      gameConnectivity: map.gameConnectivity,
      warnings: map.warnings.slice(),
      debug: map.debug.slice(),
      report: lastMapEditorExportReport,
      settings: { ...settings },
    };
  }

  const api = { generate, DEFAULT_SETTINGS, GAME_TIER_RISE };
  globalScope.WildernessGenerator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

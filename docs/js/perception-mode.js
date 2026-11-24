// Perception Mode — an "eagle vision" sense the player toggles on and off at
// will (rebindable 'perceptionMode' input action, default B). While it is on:
//   • nearby things are tinted by category and visible through walls/terrain
//     (a depth-test-free silhouette mask, then a glow/fill composite):
//       red    — hostiles (aggressive wildlife, bandits, hostile Porakaneki)
//       yellow — prey and non-hostile barbarians (neutral Porakaneki hunters)
//       green  — interactible objects (world objects, lootable corpses,
//                harvest-ready crops)
//       white  — NPCs, the animal companion, livestock, and growing crops
//                that cannot be harvested yet
//   • crops and livestock close to the player get an info list beside them,
//     drawn by WorldPopupText.syncInfoLists in the loot-list style but on
//     the opposite side;
//   • the player (and their mount) moves at half speed (speedMultiplier()).
// Ordinary objects use RANGE_TILES. Cave/camp landmarks and cliff-door/herb
// landmarks have independent discovery ranges; active Perception food and
// alchemy buffs multiply each radius without changing its base. There is no cooldown.
//
// Wired from game.js with one init(deps) call; game.js calls renderOverlay()
// from renderWorldPasses and update() from gameLoop. Sources are read through
// deps getters so this module never owns or mutates gameplay registries.
(() => {
  'use strict';

  const RANGE_TILES = 14; // Highlight radius for ordinary actors and interactables.
  const LANDMARK_RANGE_TILES = Object.freeze({ caves: 24, camps: 24, cliffDoors: 12, herbClusters: 12 }); // Distinct radii used by collectTargets for discoverable wilderness features.
  const REFRESH_MS = 150; // Target re-collection cadence; the render pass itself runs every frame.
  const INFO_REFRESH_MS = 400;
  const MAX_INTERACTABLE_SIZE_TILES = 3.5; // Whole buildings/walls stay unlit; their doors are separate small objects.
  const SPEED_MULTIPLIER = 0.5;
  const COLORS = Object.freeze({
    hostile: '#ff2f2a',
    neutral: '#ffd43a',
    interact: '#3dff6e',
    friendly: '#ffffff',
    landmark: '#6ab69e', // Bronze verdigris: shared perception silhouette for caves, camps, cliff doors, and mini-cliff herbs.
    farmSelected: '#35dcff', // Farmwork uses the same mask/glow with its own color language.
    farmAssignable: '#b58aff',
    blossomStart: '#ffffff', // Live blossom swatch overrides the neutral fallback per target.
  });
  let deps = null;
  let active = false;
  let lastRefreshAt = -Infinity;
  let lastInfoAt = -Infinity;
  let targets = []; // [{ root, category, meshes }]
  const meshCache = new WeakMap(); // root -> { at, meshes }
  const sizeCache = new WeakMap(); // root -> largest horizontal extent (tiles)
  let overlayEl = null;
  let lastStats = { targets: 0, meshes: 0, infoLists: 0, rendered: 0 };

  // ── Helpers ──────────────────────────────────────────────────────────
  const THREE = () => deps?.THREE || window.THREE;
  const maskRenderer = window.PerceptionMaskRenderer.create(THREE, COLORS); // Shared, lazily allocated GPU overlay for Perception and Farmwork.
  const infoLists = window.PerceptionInfoLists; // Presentation-only formatting and popup sync.

  function rangeMultiplier() {
    const rawFoodStacks = Number(window.CookingSystem?.getFoodEffectStacks?.('perception')); // Active Perception food (including registered external providers) expands Sense Mode ranges.
    const foodStacks = Number.isFinite(rawFoodStacks) ? Math.max(0, rawFoodStacks) : 0; // Keep missing or malformed food data at the unbuffed baseline.
    const foodMultiplier = 1 + Math.min(0.5, foodStacks * 0.02); // Match Perception food's existing +2% per stack, +50% cap used by SkillSystem.
    const rawAlchemyMultiplier = Number(window.AlchemySystem?.getPerceptionMultiplier?.()); // Existing Perception potion magnitude also expands Sense Mode.
    const alchemyMultiplier = Number.isFinite(rawAlchemyMultiplier) ? Math.max(1, rawAlchemyMultiplier) : 1; // An absent/invalid buff must not shorten detection.
    return foodMultiplier * alchemyMultiplier;
  }

  function effectiveRangeTiles(baseRangeTiles) {
    const base = Number(baseRangeTiles); // A shared conversion keeps special creature and landmark base radii intact.
    return Number.isFinite(base) ? Math.max(0, base) * rangeMultiplier() : 0;
  }

  function rootOf(obj) {
    if (!obj) return null;
    return obj.avatarRef?.group || obj.promptRoot || obj.root || obj.group || obj.mesh || null;
  }

  // Area filter: only roots that are actually in the scene being rendered.
  function sceneOf(object) {
    let node = object;
    while (node?.parent) {
      if (node.visible === false) return null;
      node = node.parent;
    }
    return node?.isScene ? node : null;
  }

  const _pos = { v: null };
  function worldPos(root) {
    if (!_pos.v) _pos.v = new (THREE().Vector3)();
    root.getWorldPosition(_pos.v);
    return _pos.v;
  }

  function horizontalSize(root) {
    let size = sizeCache.get(root);
    if (size !== undefined) return size;
    try {
      const box = new (THREE().Box3)().setFromObject(root);
      size = box.isEmpty() ? 0 : Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    } catch (_) { size = 0; }
    sizeCache.set(root, size);
    return size;
  }

  function isMaskableMesh(mesh) {
    if (!(mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh)) return false;
    if (mesh.renderOrder >= 1200) return false; // World popup/dialogue text.
    if (/shadow/i.test(mesh.name || '')) return false; // Ground-shadow blobs.
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.some(m => m && m.visible !== false && m.colorWrite !== false && !(m.transparent && m.opacity < 0.05));
  }

  function meshesOf(root, now) {
    const cached = meshCache.get(root);
    // Visual LOD / respawn can rebuild a root's children; drop the cache as soon as any cached mesh is detached.
    if (cached && now - cached.at < 1000 && cached.meshes.every(mesh => mesh.parent)) return cached.meshes;
    const meshes = [];
    root.traverse(child => { if (isMaskableMesh(child)) meshes.push(child); });
    meshCache.set(root, { at: now, meshes });
    return meshes;
  }

  // ── Classification ───────────────────────────────────────────────────
  function creatureCategory(c) {
    if (c.isCompanion) return 'friendly';
    if (c.isDenMother) return 'hostile'; // A guarding Den-Mother stays a threat even when its base species is prey.
    if (c.isTribeHunter || c.isPorakanekiHunter) return c._porakanekiPlannerControlled === true ? 'neutral' : 'hostile';
    if (c.isBandit || c.banditCompanion) return 'hostile';
    const territorial = c._territorialBehavior?.phase;
    if (territorial === 'warning' || territorial === 'fight') return 'hostile';
    if (c.def?.hostile === false) return 'neutral';
    return 'hostile';
  }

  function isAliveCreature(c) {
    return c && !(c.health <= 0) && c.state !== 'dying' && c.state !== 'corpse';
  }

  const LANDMARK_CACHE_TTL_MS = 1000; // Rechecks changing provider membership while standing still (harvested herbs, new camps, streaming chunks).
  const LANDMARK_MARGIN_TILES = 1; // A tile-center prefilter includes every position reachable within that tile before the next event.
  let landmarkCache = { scene: null, col: NaN, row: NaN, multiplier: NaN, at: -Infinity, candidates: [] }; // Holds only nearby stationary landmark roots, not moving actors.
  let landmarkRebuilds = 0; // Dev/mobile counter for static provider rescans.
  let landmarkReuses = 0; // Dev/mobile counter for static provider scans avoided.
  let unsubscribeTileEvents = null; // Prevents duplicate listeners if PerceptionMode is initialized again.

  function invalidateLandmarkCache() {
    landmarkCache.at = -Infinity; // Forces the next active Sense scan to consult scene owners again.
  }

  function releaseLandmarkCache() {
    // A cached scene owns its full terrain and attached entities; release it
    // immediately when Sense is disabled or re-initialized, rather than retaining
    // an old wilderness zone until the next successful target scan.
    landmarkCache = { scene: null, col: NaN, row: NaN, multiplier: NaN, at: -Infinity, candidates: [] };
  }

  function nearbyLandmarks(scene, player, now, senseRangeMultiplier) {
    const col = Math.floor(player.x); // Uses the same world-tile coordinates as the central player transition event.
    const row = Math.floor(player.z); // Used to reuse source enumeration while the player remains in this tile.
    if (landmarkCache.scene === scene && landmarkCache.col === col && landmarkCache.row === row &&
        landmarkCache.multiplier === senseRangeMultiplier && now >= landmarkCache.at &&
        now - landmarkCache.at < LANDMARK_CACHE_TTL_MS) {
      landmarkReuses++;
      return landmarkCache.candidates;
    }

    // Scene owners retain authority; never cache whole-scene traversals or moving actors.
    const denEntrances = scene.children?.find(root => root.name === 'animalDenEntrances');
    const sources = {
      caves: (denEntrances?.children || []).filter(root => root.userData?.denCaveEntrance || root.userData?.localeCave),
      camps: [
        ...(window.BanditCamps?.senseTargets?.(scene) || []),
        ...(window.PorakanekiCamps?.senseTargets?.(scene) || []),
        ...(window.OmgurkuCamps?.senseTargets?.(scene) || []),
      ],
      cliffDoors: window.PuzzleCaveEntrances?.senseTargets?.(scene) || [],
      herbClusters: window.CliffRouteNetwork?.senseTargets?.(scene) || [],
    };
    lastStats.landmarkSources = Object.fromEntries(Object.entries(sources).map(([kind, roots]) => [kind, roots.length]));
    const candidates = []; // Only stationary landmark geometry near this tile remains in the 150ms live distance checks.
    for (const [kind, roots] of Object.entries(sources)) for (const entry of roots) {
      const root = entry?.root || entry;
      if (!root || sceneOf(root) !== scene) continue;
      const anchor = entry?.anchor; // Site-center override supplied by camp owners, if any.
      const p = Number.isFinite(anchor?.x) && Number.isFinite(anchor?.z) ? anchor : worldPos(root);
      const rangeTiles = LANDMARK_RANGE_TILES[kind]; // Preserves category-specific discovery distances.
      const maxDist = rangeTiles * senseRangeMultiplier + LANDMARK_MARGIN_TILES; // Includes borderline targets as the player moves within one tile.
      if (Math.hypot(p.x - (col + 0.5), p.z - (row + 0.5)) <= maxDist) {
        candidates.push({ root, anchor, rangeTiles });
      }
    }
    landmarkCache = { scene, col, row, multiplier: senseRangeMultiplier, at: now, candidates };
    landmarkRebuilds++;
    return candidates;
  }

  function collectTargets(now) {
    const scene = deps.getActiveScene?.();
    const player = deps.getPlayerTile?.();
    if (!scene || !Number.isFinite(player?.x) || !Number.isFinite(player?.z)) {
      releaseLandmarkCache(); // Loading/retiring a scene must not keep the old wilderness in memory during an active Sense transition.
      return [];
    }
    const out = [];
    if (window.FarmworkUI?.isOpen?.()) {
      for (const { root, category } of window.FarmworkUI.glowTargets()) {
        if (root && sceneOf(root) === scene) out.push({ root, category, meshes: meshesOf(root, now) });
      }
      return out;
    }
    const senseRangeMultiplier = rangeMultiplier(); // Capture active food/potion strength once per 150-ms target scan; all categories use the same bonus.
    const seenRoots = new Set();
    const rejected = { noRoot: 0, offScene: 0, outOfRange: 0 }; // Diagnostics only (debugSnapshot).
    const consider = (root, category, extra, rangeTiles = RANGE_TILES, anchor = null) => {
      if (!root) { rejected.noRoot++; return; }
      if (seenRoots.has(root)) return;
      if (sceneOf(root) !== scene) { rejected.offScene++; return; }
      const p = Number.isFinite(anchor?.x) && Number.isFinite(anchor?.z) ? anchor : worldPos(root); // Camp sites use their actual center rather than each individual tent's position.
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      if (dist > rangeTiles * senseRangeMultiplier) { rejected.outOfRange++; return; }
      seenRoots.add(root);
      out.push({ root, category, dist, ...extra });
    };

    // Only stationary landmark providers are cached. Every candidate's precise
    // distance, scene ownership and visibility are still checked live below.
    for (const entry of nearbyLandmarks(scene, player, now, senseRangeMultiplier)) {
      consider(entry.root, 'landmark', undefined, entry.rangeTiles, entry.anchor);
    }

    const sources = deps.getSources();
    const count = list => (list ? (list.size ?? list.length ?? 0) : 0);
    lastStats.sources = Object.fromEntries(Object.entries(sources).map(([key, list]) => [key, count(list)]));
    lastStats.rejected = rejected;
    for (const c of sources.companions || []) if (isAliveCreature(c)) consider(rootOf(c), 'friendly');
    for (const c of sources.creatures || []) if (isAliveCreature(c)) consider(rootOf(c), creatureCategory(c), { creature: c }, Number(c.senseRangeTiles) || RANGE_TILES); // Ruin bombers roost far above the player; they publish a longer reveal radius.
    for (const walker of sources.npcs || []) consider(walker?.root || rootOf(walker), 'friendly');
    for (const animal of sources.livestock || []) consider(rootOf(animal), 'friendly', { livestockId: animal.livestockId || null });
    for (const c of sources.corpses || []) consider(rootOf(c), 'interact');
    for (const root of sources.oreRocks || []) consider(root, 'interact'); // Indexed wild, mine and cavern ore mounds near the player.
    for (const obj of sources.interactables || []) {
      if (!obj || obj.type === 'animal' || obj.livestockId) continue;
      const root = rootOf(obj);
      if (!root || horizontalSize(root) > MAX_INTERACTABLE_SIZE_TILES) continue;
      consider(root, 'interact');
    }
    // Independent scene owners expose small, live targets without forcing game.js
    // to copy their registries or traversing the whole cave every 150 ms.
    const specialSources = { // Provider counts are visible in debugSnapshot for mobile diagnosis.
      oreRocks: window.CavernOreRocks?.senseTargets?.(scene) || [],
      shattercasks: window.Shattercasks?.senseTargets?.(scene) || [],
      nests: window.DenNestSystem?.senseTargets?.(scene) || [],
      hives: window.HoneyfuzzleHives?.senseTargets?.(scene) || [],
      caveFeatures: window.CaveSiteSystem?.senseTargets?.(scene) || [],
      shaftLadders: [ ...(window.RuinReachingObelisks?.senseTargets?.(scene) || []), ...(window.ShaftHub?.senseTargets?.(scene) || []) ], // Both moving obelisks and fixed buttresses show only their real V50 ladder meshes.
      blossomStarts: window.FestivalBlossomStartCue?.senseTargets?.(scene) || [], // Just the verified quest start in the current chunk.
    };
    lastStats.specialSources = Object.fromEntries(Object.entries(specialSources).map(([name, roots]) => [name, roots.length]));
    for (const [kind, roots] of Object.entries(specialSources)) for (const entry of roots) {
      if (kind === 'blossomStarts') consider(entry.root, 'blossomStart', { color: entry.color }, Math.SQRT2 * (Number(window.WildernessChunks?.constants?.CHUNK_TILES) || 16) + 2); // All positions in the same streaming chunk remain discoverable.
      else consider(entry, 'interact');
    }
    for (const crop of sources.crops || []) {
      consider(crop.root, crop.tile?.cropReady ? 'interact' : 'friendly', { crop });
    }
    for (const target of out) target.meshes = meshesOf(target.root, now);
    return out;
  }

  function refreshInfoLists() {
    const count = infoLists.refreshInfoLists(targets, deps.getActiveScene?.()); // Preserve the last count when no popup provider is available.
    if (count !== undefined) lastStats.infoLists = count;
  }

  function renderOverlay(renderer, scene, camera) {
    lastStats.rendered = 0;
    if ((!active && !window.FarmworkUI?.isOpen?.()) || !targets.length || !renderer || !scene || !camera) return;
    lastStats.rendered = maskRenderer.renderOverlay(renderer, scene, camera, targets);
  }

  // ── Screen tint / indicator (DOM touched only on toggle) ──────────────
  function ensureOverlayEl() {
    if (overlayEl || typeof document === 'undefined' || !document.body) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'perceptionModeOverlay';
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.innerHTML = '<div class="perception-mode-label">Perception</div>';
    (document.getElementById('canvasWrap') || document.body).appendChild(overlayEl);
    return overlayEl;
  }

  // ── Public API ───────────────────────────────────────────────────────
  let buttonEl = null; // #btnPerceptionMode (touch/mouse toggle on the outer action ring).
  function bindButton() {
    if (buttonEl || typeof document === 'undefined') return;
    buttonEl = document.getElementById('btnPerceptionMode');
    buttonEl?.addEventListener('pointerdown', event => {
      event.preventDefault();
      toggle();
    });
  }

  function setActive(next) {
    next = !!next;
    if (next && window.FarmworkUI?.isOpen?.()) window.FarmworkUI.close(); // The two world overlays are mutually exclusive.
    if (next === active) return active;
    active = next;
    ensureOverlayEl()?.classList.toggle('active', active);
    if (buttonEl) {
      buttonEl.classList.toggle('active', active);
      buttonEl.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    lastRefreshAt = -Infinity;
    lastInfoAt = -Infinity;
    invalidateLandmarkCache(); // Toggling Sense must not retain a stale static provider snapshot.
    if (!active) {
      targets = [];
      releaseLandmarkCache(); // Do not retain unloaded zones through stationary landmark roots.
      window.WorldPopupText?.clearInfoLists?.();
      lastStats = { targets: 0, meshes: 0, infoLists: 0, rendered: 0 };
    }
    deps?.onToggle?.(active);
    return active;
  }

  function toggle() { return setActive(!active); }

  function update(now = performance.now()) {
    const farmwork = window.FarmworkUI?.isOpen?.();
    if (farmwork) window.FarmworkUI.updateVisuals(now);
    if ((!active && !farmwork) || !deps) { if (targets.length) targets = []; return; }
    if (now - lastRefreshAt >= REFRESH_MS) {
      lastRefreshAt = now;
      targets = collectTargets(now);
      lastStats.targets = targets.length;
      lastStats.meshes = targets.reduce((n, t) => n + (t.meshes?.length || 0), 0);
    }
    if (!farmwork && now - lastInfoAt >= INFO_REFRESH_MS) {
      lastInfoAt = now;
      refreshInfoLists();
    }
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    unsubscribeTileEvents?.();
    unsubscribeTileEvents = window.PlayerTileEvents?.subscribe?.(invalidateLandmarkCache) || null; // Central tile/area event invalidates only stationary discovery.
    releaseLandmarkCache(); // A fresh runtime cannot reuse the previous game's scene roots.
    bindButton();
    return api;
  }

  const api = {
    init,
    toggle,
    setActive,
    isActive: () => active,
    speedMultiplier: () => (active ? SPEED_MULTIPLIER : 1),
    update,
    renderOverlay,
    COLORS,
    RANGE_TILES,
    LANDMARK_RANGE_TILES,
    rangeMultiplier,
    effectiveRangeTiles,
    debugSnapshot: () => ({
      active,
      ...lastStats,
      landmarkCache: { rebuilds: landmarkRebuilds, reuses: landmarkReuses, candidates: landmarkCache.candidates.length, ttlMs: LANDMARK_CACHE_TTL_MS, holdingScene: !!landmarkCache.scene }, // Visible through PerceptionMode.debugSnapshot on mobile.
      landmarkRanges: LANDMARK_RANGE_TILES, // Unbuffed base radii remain available for mobile debugging.
      rangeMultiplier: rangeMultiplier(), // Current food/potion multiplier is visible without browser devtools.
      ordinaryRangeTiles: effectiveRangeTiles(RANGE_TILES), // Current regular silhouette reveal radius in tiles.
      effectiveLandmarkRanges: Object.fromEntries(Object.entries(LANDMARK_RANGE_TILES).map(([kind, radius]) => [kind, effectiveRangeTiles(radius)])), // Current per-landmark radii in tiles.
      byCategory: targets.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + 1; return acc; }, {}),
    }),
    debugMaskCoverage: () => maskRenderer.debugMaskCoverage(targets),
    __test: Object.freeze({ creatureCategory, cropRows: infoLists.cropRows, livestockRows: infoLists.livestockRows, lerpHex: infoLists.lerpHex }),
  };
  window.PerceptionMode = api;
})();

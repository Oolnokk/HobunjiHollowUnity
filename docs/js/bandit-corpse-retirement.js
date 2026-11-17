// Lightweight settled-corpse presentation retirement for humanoids and wildlife.
//
// Death animations keep their authored rigs. Once a corpse settles, its data,
// position, loot and interaction remain canonical, but its ~50-draw-call bandit
// rig (or animal rig) can become one normal-depth world sprite. Loot/revival
// exceptions retain their rigs. This reuses the existing bandit retirement
// integration in game.js instead of adding a second per-frame corpse updater.
//
// SCRATCHBONES_CONFIG.game.banditCorpseRetire remains the configuration key
// for compatibility with saved Scratchbones settings and existing tests.
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,
    keepFull: 0,       // No corpse remains fully rigged merely for being new.
    nearTiles: 0,      // Standing beside a corpse no longer preserves its rig.
    farTiles: 0,       // The universal settled-corpse rule makes this redundant.
    minSettledS: 0,    // Fall animation determines eligibility, not a timer.
    perTick: 4,        // Bound heavy disposals if multiple actors die together.
    intervalMs: 80,    // Near-immediate retirement without scanning all bodies every frame.
  });

  let deps = null;
  let lastRunAt = -Infinity;
  let markerGeometry = null;
  let markerMaterial = null;
  const stats = { retired: 0, wildlifeRetired: 0, runs: 0, lastRetired: null }; // Read by mobile diagnostics and regression tests.

  function config() {
    const override = window.SCRATCHBONES_CONFIG?.game?.banditCorpseRetire;
    return override && typeof override === 'object' ? { ...DEFAULTS, ...override } : DEFAULTS;
  }

  function init(injected) { deps = injected; }

  function isRetirable(c, currentArea) {
    return !!c && c.state === 'corpse' && !(c.health > 0)
      && !c._banditCorpseRetired && !c.avatarRef?.isCorpseMarker && !c.corpseLooted
      && !c.keepCorpseAfterLoot && !(Number(c.lootHoldSeconds) > 0)
      && !c.isCompanion && !c.isAmphibiousFishCorpse && !c.tzatzulCapturedBy
      && c.areaId === currentArea && !!c.avatarRef?.group;
  }

  function markerParts() {
    if (!markerGeometry) {
      markerGeometry = new window.THREE.CircleGeometry(0.5, 16);
      markerGeometry.rotateX(-Math.PI / 2);
      markerMaterial = new window.THREE.MeshBasicMaterial({
        color: 0x2b1814, transparent: true, opacity: 0.8,
        depthTest: true, depthWrite: true, // Corpses obey ordinary world depth.
      });
    }
    return { geometry: markerGeometry, material: markerMaterial };
  }

  // Retain the last animal/portrait body image where a straightforward
  // front-plane texture exists. The 256px frozen copy is deliberately
  // independent of the old animated rig's texture and disposal lifecycle.
  // Compound humanoid rigs may have no single assembled body image; they
  // safely fall back to the existing one-draw silhouette.
  function spriteSnapshot(rig, width, c) {
    const THREE = window.THREE;
    if (typeof document === 'undefined' || !THREE?.CanvasTexture || !THREE?.PlaneGeometry) return null;
    const root = rig?.frontPlane;
    if (!root) return null;
    let best = null; // Largest source body image found under the canonical front plane.
    const consider = node => {
      if (!node?.isMesh || node.visible === false) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        const map = material?.map;
        const image = map?.image;
        const w = Number(image?.naturalWidth || image?.videoWidth || image?.width);
        const h = Number(image?.naturalHeight || image?.videoHeight || image?.height);
        if (w > 0 && h > 0 && (!best || w * h > best.pixels)) best = { image, w, h, material, map, mesh: node, pixels: w * h };
      }
    };
    if (root.traverse) root.traverse(consider);
    else consider(root);
    if (!best) return null;
    let canvas, texture, geometry, material;
    try {
      const ratio = Math.min(1, 256 / Math.max(best.w, best.h));
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(best.w * ratio));
      canvas.height = Math.max(1, Math.round(best.h * ratio));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(best.image, 0, 0, canvas.width, canvas.height);
      texture = new THREE.CanvasTexture(canvas);
      if (best.map.colorSpace !== undefined) texture.colorSpace = best.map.colorSpace;
      texture.magFilter = THREE.NearestFilter || texture.magFilter;
      texture.minFilter = THREE.LinearFilter || texture.minFilter;
      // Preserve the authored plane proportions rather than treating the
      // source PNG's transparent padding/aspect as physical body dimensions.
      const authoredWidth = Number(best.mesh.geometry?.parameters?.width) || Number(rig.modelWidth) || width; // Original sprite width for static scaling.
      const authoredHeight = Number(best.mesh.geometry?.parameters?.height) || Number(rig.modelHeight) || Number(c.visualModelHeight) || authoredWidth; // Original portrait height for the corpse proxy.
      const length = Math.max(width * 0.5, Math.min(4, width * authoredHeight / Math.max(0.1, authoredWidth)));
      geometry = new THREE.PlaneGeometry(width, length);
      geometry.rotateX(-Math.PI / 2);
      material = new THREE.MeshBasicMaterial({
        map: texture, color: best.material.color?.clone?.() || 0xffffff,
        transparent: true, alphaTest: 0.15, side: THREE.DoubleSide,
        depthTest: true, depthWrite: true,
      });
      return { mesh: new THREE.Mesh(geometry, material), dispose() {
        geometry.dispose?.();
        material.dispose?.();
        texture.dispose?.();
      } };
    } catch (_) {
      geometry?.dispose?.();
      material?.dispose?.();
      texture?.dispose?.();
      return null;
    }
  }

  function retire(c) {
    const currentArea = deps?.getCurrentArea?.();
    if (!deps || !isRetirable(c, currentArea)) return false;
    const rig = c.avatarRef;
    const tile = deps.getTile();
    const grid = c.areaGrid;
    const col = Math.floor(c.x / tile), row = Math.floor(c.y / tile);
    const surfaceY = grid?.[row]?.[col] ? deps.tileSurfaceYInArea(grid[row][col], c.areaId) : rig.group.position.y;
    const width = Math.max(0.55, Number(c.visualModelWidth) || Number(c.def?.modelWidth) || 0.8);

    const group = new window.THREE.Group();
    group.name = c.isBandit ? 'bandit_corpse_marker' : 'wildlife_corpse_marker';
    group.userData ||= {};
    group.userData.corpseNoSecondaryPasses = true; // Score-actor masks do not need a dead actor.
    group.userData.noOutline = true;
    const snapshot = spriteSnapshot(rig, width, c); // May be null for compound rigs or absent Canvas support.
    const sprite = snapshot?.mesh || (() => {
      const { geometry, material } = markerParts();
      const fallback = new window.THREE.Mesh(geometry, material);
      fallback.scale.set(width, 1, width * 0.55);
      return fallback;
    })();
    sprite.userData ||= {};
    sprite.userData.noOutline = true;
    sprite.layers?.set?.(0); // Base pass only: no shell, target, PNG depth, mist or x-ray layers.
    group.add(sprite);
    group.rotation.y = Number(c.deathRestRotY) || 0;
    group.position.set(c.x / tile, surfaceY + 0.03, c.y / tile);

    // The hazard is entity-owned, but its particle presenter belongs to the
    // old rig. Dispose/reparent that presenter before dropping the old root.
    window.BurningAfflictionVfx?.disposeEntity?.(c);
    deps.disposeCreaturePresentation(c);
    c.groundShadow = null;
    c._impactRagdollPlayback = null;
    c._deathRecordedThrow = null;
    c._deathScorch = null;
    c._carriedBabyVisuals = null;
    (c.scene || deps.getDefaultScene()).add(group);
    c.avatarRef = {
      group, frontPlane: null, backPlane: null, isCorpseMarker: true,
      dispose() {
        group.parent?.remove?.(group);
        snapshot?.dispose?.(); // Shared fallback marker resources must not be disposed per corpse.
      },
    };
    c._banditCorpseRetired = true; // Existing actor occlusion and retirement consumers recognize this flag.
    c._corpseVisualRetired = true; // Generic wildlife/humanoid marker for other corpse consumers.
    c._wildlifeVisualLodHidden = false; // A retired marker must not retain its former hidden-rig state.
    c._wildlifeDormantSinceMs = null; // The wildlife streamer no longer owns this settled presentation.
    window.BurningAfflictionVfx?.syncEntity?.(c, group); // Keep finite corpse flames alive above the new body.
    stats.retired++;
    if (!c.isBandit) stats.wildlifeRetired++;
    stats.lastRetired = c.id || c.creatureKey || c.def?.label || 'corpse';
    return true;
  }

  // Called from the existing game.js corpse tick, after death animation
  // advances. The old far/near/newest knobs remain overrideable.
  function tick(now) {
    if (!deps) return 0;
    const cfg = config();
    if (!cfg.enabled || now - lastRunAt < Math.max(0, Number(cfg.intervalMs) || 0)) return 0;
    lastRunAt = now;
    stats.runs++;
    const currentArea = deps.getCurrentArea();
    const budget = Math.max(1, Math.floor(Number(cfg.perTick) || 1));
    let retired = 0;

    // Default fast path: no distance checks, sorting or per-body timer state.
    if (Number(cfg.keepFull) <= 0 && Number(cfg.nearTiles) <= 0 && Number(cfg.minSettledS) <= 0) {
      for (const c of deps.corpseObjects) {
        if (retired >= budget) break;
        if (isRetirable(c, currentArea) && retire(c)) retired++;
      }
      return retired;
    }

    const candidates = [];
    for (const c of deps.corpseObjects) {
      if (!isRetirable(c, currentArea)) continue;
      if (c._corpseSettledAt == null) c._corpseSettledAt = now;
      candidates.push(c);
    }
    if (!candidates.length) return 0;
    const player = deps.getPlayer();
    const tile = deps.getTile();
    const farPx = Number(cfg.farTiles) > 0 ? cfg.farTiles * tile : Infinity;
    if (farPx !== Infinity) {
      for (const c of candidates) {
        if (retired >= budget) break;
        if (now - c._corpseSettledAt < Number(cfg.minSettledS) * 1000) continue;
        if (Math.hypot(player.x - c.x, player.y - c.y) < farPx) continue;
        if (retire(c)) retired++;
      }
    }
    const remaining = candidates.filter(c => !c._banditCorpseRetired);
    if (remaining.length <= Number(cfg.keepFull)) return retired;
    remaining.sort((a, b) => b._corpseSettledAt - a._corpseSettledAt);
    const nearPx = Number(cfg.nearTiles) * tile;
    for (let i = remaining.length - 1; i >= Number(cfg.keepFull) && retired < budget; i--) {
      const c = remaining[i];
      if (now - c._corpseSettledAt < Number(cfg.minSettledS) * 1000) continue;
      if (Math.hypot(player.x - c.x, player.y - c.y) < nearPx) continue;
      if (retire(c)) retired++;
    }
    return retired;
  }

  window.BanditCorpseRetirement = {
    init, tick, retire, isRetirable, config, defaults: DEFAULTS,
    get stats() { return { ...stats }; },
  };
})();

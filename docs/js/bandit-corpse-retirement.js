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
  const stats = { retired: 0, wildlifeRetired: 0, portraitPlanes: 0, fallbackMarkers: 0, posedPantsBaked: 0, posedPantsDeferred: 0, imagesDeferred: 0, runs: 0, lastRetired: null }; // Counts actual static portrait replacements versus fallback markers in mobile diagnostics.

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
      && !c.avatarRef?.riderMount // A mounted bandit owns rider AND animal card; a single rider portrait would erase the mount.
      && !(Number(c._corpseSnapshotRetryAfter) > (typeof performance !== 'undefined' ? Number(performance.now()) || 0 : 0))
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

  // Freeze the composed humanoid frontCanvas (appearance, dyed clothing, hair
  // and face) into one static portrait. The corpse-only compositor then paints
  // the final posed pants through a compact grid rather than copying their
  // jumping-jack source texture. Living avatars and their rigs are untouched.
  // Ordinary animals use their finished front-plane map.
  function spriteSnapshot(rig, width, c) {
    const THREE = window.THREE;
    if (typeof document === 'undefined' || !THREE?.CanvasTexture || !THREE?.PlaneGeometry) return null;
    const root = rig?.frontPlane;
    if (!root) return null;
    const composed = rig?.frontCanvas; // Humanoid bandits already render their full authored portrait into this canvas.
    const hasComposed = Number(composed?.width) > 0 && Number(composed?.height) > 0;
    let best = hasComposed
      ? { image: composed, w: composed.width, h: composed.height, material: null, map: null,
          mesh: null, pixels: composed.width * composed.height }
      : null; // A normal humanoid must not accidentally snapshot only its head/eye mesh.
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
    if (!hasComposed) { // Wildlife retains its live genotype-composited body map.
      if (root.traverse) root.traverse(consider);
      else consider(root);
    }
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
      const posedPants = hasComposed && rig?.legs?.pants
        ? window.CorpsePosedPantsSnapshot?.capture?.(canvas, rig) || null : null; // One-time, corpse-only painting of final deformed cloth.
      // The fall's fire-scorch effect darkens rig materials instead of the
      // authored portrait canvas. Bake the same settled tint before disposal.
      if (c.deathCause === 'fire' && typeof context.fillRect === 'function') {
        context.globalCompositeOperation = 'source-atop';
        context.fillStyle = 'rgba(0, 0, 0, 0.94)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.globalCompositeOperation = 'source-over';
      }
      texture = new THREE.CanvasTexture(canvas);
      // Live PNGPlaneAvatar mirrors the front texture with UV repeat/offset.
      // Mirror this finished corpse portrait too; its pants were baked into
      // original canvas coordinates by CorpsePosedPantsSnapshot.
      if (hasComposed && window.PNGPlaneAvatar?.getPortraitsFlipped?.() === true) {
        texture.wrapS = THREE.RepeatWrapping;
        if (texture.repeat) texture.repeat.x = -1;
        if (texture.offset) texture.offset.x = 1;
      }
      if (best.map?.colorSpace !== undefined) texture.colorSpace = best.map.colorSpace;
      else if (THREE.SRGBColorSpace !== undefined) texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter || texture.magFilter;
      texture.minFilter = THREE.LinearFilter || texture.minFilter;
      // Preserve the authored plane proportions rather than treating the
      // source PNG's transparent padding/aspect as physical body dimensions.
      const authoredWidth = Number(best.mesh?.geometry?.parameters?.width) || Number(rig.modelWidth) || width; // Composed portrait width when geometry is already gone.
      const authoredHeight = Number(best.mesh?.geometry?.parameters?.height) || Number(rig.modelHeight) || Number(c.visualModelHeight) || authoredWidth; // Authored vertical proportions, not PNG padding.
      const length = Math.max(width * 0.5, Math.min(4, width * authoredHeight / Math.max(0.1, authoredWidth)));
      geometry = new THREE.PlaneGeometry(width, length);
      geometry.rotateX(-Math.PI / 2);
      material = new THREE.MeshBasicMaterial({
        map: texture, color: best.material?.color?.clone?.() || 0xffffff,
        transparent: true, alphaTest: 0.15, side: THREE.DoubleSide,
        depthTest: true, depthWrite: true,
      });
      return { mesh: new THREE.Mesh(geometry, material), posedPants, dispose() {
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

  // The authored breakThrow can rotate an impact pivot independently of the
  // original group. Project the LAST rendered portrait Y axis onto the ground
  // rather than assuming every death clip ends at the fallback +90-degree roll.
  // The flattened plane's long axis points toward local -Z after rotateX(-PI/2).
  function settledBodyYaw(rig, c) {
    const fallback = (Number(c.deathRestRotY) || 0) + Math.PI / 2;
    const face = rig?.frontPlane;
    try {
      face?.updateWorldMatrix?.(true, false);
      const e = face?.matrixWorld?.elements;
      const x = Number(e?.[4]), z = Number(e?.[6]); // Transformed local portrait-up axis, before rig retirement.
      if (Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x, z) > 1e-4) return Math.atan2(-x, -z);
    } catch (_) { /* The plain old fallback remains safe without a world matrix. */ }
    return fallback;
  }

  function retire(c) {
    const currentArea = deps?.getCurrentArea?.();
    if (!deps || !isRetirable(c, currentArea)) return false;
    const rig = c.avatarRef;
    const tile = deps.getTile();
    const grid = c.areaGrid;
    const col = Math.floor(c.x / tile), row = Math.floor(c.y / tile);
    const surfaceY = Number.isFinite(c.deathSurfaceY) ? c.deathSurfaceY
      : grid?.[row]?.[col] ? deps.tileSurfaceYInArea(grid[row][col], c.areaId) : rig.group.position.y; // Retirement must not change the corpse's story.
    const width = Math.max(0.55, Number(c.visualModelWidth) || Number(c.def?.modelWidth) || 0.8);

    const group = new window.THREE.Group();
    group.name = c.isBandit ? 'bandit_corpse_marker' : 'wildlife_corpse_marker';
    group.userData ||= {};
    group.userData.corpseNoSecondaryPasses = true; // Score-actor masks do not need a dead actor.
    group.userData.noOutline = true;
    const snapshot = spriteSnapshot(rig, width, c); // May be null for compound rigs or absent Canvas support.
    // A failed image/pants capture must never permanently replace an animal's
    // patterned body or a humanoid's final fitted garment with a brown disc.
    // Keep the old rig until its source art can actually be frozen.
    if (!snapshot && typeof document !== 'undefined' && rig.frontPlane) {
      c._corpseSnapshotRetryAfter = (typeof performance !== 'undefined' ? Number(performance.now()) || 0 : 0) + 1000;
      stats.imagesDeferred++;
      return false;
    }
    if (rig?.legs?.pants && snapshot?.posedPants?.ok !== true) {
      snapshot?.dispose?.(); // Preserve the final visible trousers rather than discarding an incomplete snapshot.
      c._corpseSnapshotRetryAfter = (typeof performance !== 'undefined' ? Number(performance.now()) || 0 : 0) + 1000; // Retry once the async cloth canvas becomes available.
      stats.posedPantsDeferred++;
      return false;
    }
    c._corpseSnapshotRetryAfter = null;
    const sprite = snapshot?.mesh || (() => {
      const { geometry, material } = markerParts();
      const fallback = new window.THREE.Mesh(geometry, material);
      fallback.scale.set(width, 1, width * 0.55);
      return fallback;
    })();
    sprite.userData ||= {};
    sprite.userData.noOutline = true;
    sprite.layers?.set?.(0); // Base pass only: no shell, target, PNG depth, mist or x-ray layers.
    if (snapshot) {
      // The live character fell with root.rotation.z = +PI/2: its original
      // portrait Y axis therefore lies toward -X, not the new plane's -Z.
      // Capturing the final body axis below also handles recorded death
      // clips whose pivot differs from the 90-degree fallback fall.
      const oldScale = rig.group?.scale; // Preserve authored species proportions after the expensive rig is disposed.
      // Each front card rotates +90 degrees about Y: its horizontal
      // width belongs to the old group's Z axis, not its X/normal axis.
      if (Number(oldScale?.z) > 0) sprite.scale.x = oldScale.z;
      if (Number(oldScale?.y) > 0) sprite.scale.z = oldScale.y;
    }
    group.add(sprite);
    group.rotation.y = snapshot ? settledBodyYaw(rig, c) : (Number(c.deathRestRotY) || 0);
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
    if (snapshot) stats.portraitPlanes++; else stats.fallbackMarkers++;
    if (snapshot?.posedPants?.ok) stats.posedPantsBaked++;
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
      let posedPantsBakes = 0; // One canvas-intensive deformed-cloth bake per retirement pass on mobile.
      for (const c of deps.corpseObjects) {
        if (retired >= budget) break;
        const hasPosedPants = !!c?.avatarRef?.legs?.pants; // Ordinary wildlife and pantless corpses may still use the full batch budget.
        if (hasPosedPants && posedPantsBakes >= 1) continue;
        if (isRetirable(c, currentArea) && retire(c)) {
          retired++;
          if (hasPosedPants) posedPantsBakes++;
        }
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

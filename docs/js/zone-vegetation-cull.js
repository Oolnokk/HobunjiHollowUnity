// Wilderness vegetation corridor cull + tree occlusion fade targets
// (window.ZoneVegetationCull), extracted from game.js.
//
// Camera-aligned view-corridor culling for dense zone vegetation — ports the
// standalone foliage tool's updateForestGeometryCulling. Toggling .visible on
// whole tree/bush/stump groups (bounding sphere precomputed once at build
// time, see cullSphere tagging in game.js's _buildZoneFloorMeshes) is far
// cheaper than every group's own per-object frustum test every frame, and this
// corridor can hide far more than frustum culling would (behind the camera,
// wide off to the sides) — the "1-2 tile gaps throughout" density this exists
// to support can put thousands of these groups in one zone.
//
// It runs ~7 times a second (tick) and owns three things per cullable:
//   * visibility (the corridor test, with hysteresis),
//   * the tree's occlusion-fade target (js/zone-tree-fade.js animates it),
//   * whether its meshes stay on the SHELL_OUTLINE layer.
// The same corridor gates js/cloud-forest-tree-batcher.js's baked chunks
// (isChunkInView) and js/terrain-geometry.js's path-brick culling (CORRIDOR).
//
// Other wilderness render-only culls live in js/world-render-pipeline.js's
// render scopes (distance cull, prop batches, NPC/instanced view culls).
(() => {
  'use strict';

  if (window.ZoneVegetationCull) return;

  const CORRIDOR = Object.freeze({
    FORWARD_TILES: 42,
    WIDTH_TILES: 30,
    REAR_TILES: 2,
    HYSTERESIS_TILES: 1,
  });
  const TICK_INTERVAL_S = 0.14;

  // Keep the player (and anyone/anything else) visible when foliage is
  // between them and the camera. A tree flagged as blocking the camera-player
  // sightline fades its own opacity down — and zone-tree-fade.js drops its
  // depthWrite while it is transparent, so ANYTHING behind it (player,
  // companion, wild animal, a bandit's weapon) shows through via ordinary
  // alpha blending — no per-target ghost mesh, no stencil buffer.
  const TREE_FADE_OPACITY = 0.25;
  const TREE_FADE_LERP_PER_SEC = 6;
  // Sideways tolerance for the camera-player occlusion line test, as a
  // fraction of a tree's own horizontal footprint radius (cullSphere's
  // xzRadius) — halved so only trees whose trunk is genuinely close to
  // dead-center on the sightline count as blocking.
  const OCCLUSION_XZ_RADIUS_MUL = 0.5;

  const SHELL_LAYER = globalThis.HobunjiRenderLayers?.SHELL_OUTLINE ?? 1;

  let deps = null;
  let accum = 999; // Forces a real pass on the first tick.
  const stats = { updates: 0, lastCullables: 0, lastVisible: 0, lastFadedOutHidden: 0 };
  // A tree the corridor-edge fade has taken fully to opacity 0 drew no
  // colour, only depth: four or so draws per pass (and again in every
  // held/x-ray replay) whose only visible effect was a ghost silhouette — the
  // mist stopped at it and the edge-ink composite outlined it. In the user's
  // Cloud Forest view that was 73 trees / 222 draws a frame. Such a tree is
  // left undrawn until its fade target rises again (the fade then starts from
  // 0, so it reappears smoothly). A/B: ZoneVegetationCull.setHideFadedOut(false).
  let hideFadedOut = true;

  // deps: { camera, getCamTargetX, getCamTargetZ, getCurrentArea, isZoneArea,
  //         getZoneScene(area), exteriorZones, getPlayerTile(out),
  //         companionObjects, isShoulderSurf, clamp,
  //         settings: { shortCloudForestCull, cloudForestCullRadiusTiles,
  //                     cloudForestFadeStartFrac, cloudForestOutlineFrac } }
  function init(injectedDeps) {
    deps = injectedDeps;
    window.ZoneTreeFade?.init?.({ lerpPerSec: TREE_FADE_LERP_PER_SEC });
  }

  // The Cloud Forest's corridor-edge outline budget can toggle just the
  // outline layer without touching depthWrite/occlusion fade. Cached on
  // userData._outlineEnabled so the (traverse-heavy) toggle only runs on a
  // real transition, not every update for every visible tree.
  function setTreeOutlineEnabled(vegGroup, enabled) {
    if (vegGroup.userData._outlineEnabled === enabled) return;
    vegGroup.userData._outlineEnabled = enabled;
    vegGroup.traverse(child => {
      if (!child.isMesh || child.userData.noOutline) return;
      if (enabled) child.layers.enable(SHELL_LAYER); else child.layers.disable(SHELL_LAYER);
    });
  }

  // One scratch record shared with the baked-tree chunk culler; no per-tree
  // allocations.
  const basisScratch = {
    camX: 0, camZ: 0, viewX: 0, viewZ: 1, rightX: 1, rightZ: 0,
    forwardRange: CORRIDOR.FORWARD_TILES, rearRange: CORRIDOR.REAR_TILES,
    halfWidth: CORRIDOR.WIDTH_TILES * 0.5, shortCloudForest: false,
  };

  function cullBasis() {
    const basis = basisScratch;
    const camera = deps.camera;
    basis.camX = camera.position.x;
    basis.camZ = camera.position.z;
    let vx = deps.getCamTargetX() - basis.camX, vz = deps.getCamTargetZ() - basis.camZ;
    let viewLen = Math.hypot(vx, vz);
    if (viewLen < 1e-5) { vx = 0; vz = 1; viewLen = 1; }
    basis.viewX = vx / viewLen;
    basis.viewZ = vz / viewLen;
    basis.rightX = basis.viewZ;
    basis.rightZ = -basis.viewX;
    const settings = deps.settings;
    basis.shortCloudForest = !!deps.exteriorZones[deps.getCurrentArea()]?.cloudForest && !!settings.shortCloudForestCull();
    const configuredReach = Number(settings.cloudForestCullRadiusTiles());
    const reach = Number.isFinite(configuredReach) ? Math.max(5, configuredReach) : 30;
    // At the default 30-tile slider: 21 tiles forward by 19.2 wide, rather
    // than the normal 42 forward by 30 wide. Both keep a 2-tile rear strip
    // and conservative XZ canopy/chunk overlap.
    basis.forwardRange = basis.shortCloudForest ? Math.min(CORRIDOR.FORWARD_TILES, reach * 0.70) : CORRIDOR.FORWARD_TILES;
    basis.halfWidth = basis.shortCloudForest ? Math.min(CORRIDOR.WIDTH_TILES * 0.5, reach * 0.32) : CORRIDOR.WIDTH_TILES * 0.5;
    basis.rearRange = CORRIDOR.REAR_TILES;
    return basis;
  }

  function corridorContains(s, wasVisible, basis) {
    if (!s) return true; // Unknown bounds must fail open, not drop authored scenery.
    const dx = s.x - basis.camX, dz = s.z - basis.camZ;
    const along = dx * basis.viewX + dz * basis.viewZ;
    const side = Math.abs(dx * basis.rightX + dz * basis.rightZ);
    // For the Cloud Forest, use horizontal coverage. A tall canopy's 3D
    // bounding sphere must not inflate the short corridor by its height.
    const radius = basis.shortCloudForest ? (s.xzRadius ?? s.radius) : s.radius;
    const expanded = Math.max(0, Number(radius) || 0) + (wasVisible ? CORRIDOR.HYSTERESIS_TILES : 0);
    return along >= -(basis.rearRange + expanded) && along <= basis.forwardRange + expanded
      && side <= basis.halfWidth + expanded;
  }

  // Reused reveal targets: the player plus any companion in this area.
  const revealTargets = [];
  let revealCount = 0;
  function revealTarget(index) {
    if (!revealTargets[index]) revealTargets[index] = { x: 0, z: 0 };
    return revealTargets[index];
  }
  function collectRevealTargets(area) {
    deps.getPlayerTile(revealTarget(0));
    revealCount = 1;
    for (const c of deps.companionObjects) {
      // Include companions behind the same trunk, even when the camera-player
      // line itself misses that tree.
      if (c.areaId !== area) continue;
      const target = revealTarget(revealCount++);
      target.x = c.x / deps.TILE;
      target.z = c.y / deps.TILE;
    }
  }

  function update(force = false) {
    const area = deps.getCurrentArea();
    if (!deps.isZoneArea(area)) return;
    const cullables = deps.getZoneScene(area)?.cullables;
    if (!cullables || !cullables.length) return;
    const basis = cullBasis();
    const camX = basis.camX, camZ = basis.camZ;
    collectRevealTargets(area);
    const treeFade = window.ZoneTreeFade;
    const shoulderSurf = deps.isShoulderSurf();
    const fadeStartFrac = deps.settings.cloudForestFadeStartFrac();
    const outlineFrac = deps.settings.cloudForestOutlineFrac();
    let visibleCount = 0, fadedOutHidden = 0;
    for (const obj of cullables) {
      const s = obj.userData.cullSphere;
      const isGrassChunk = obj.userData.isWildernessGrassChunk === true;
      // Hysteresis: a drawn tree was in the corridor, and so was one this
      // cull left undrawn only because it is faded out (flag below).
      const wasInCorridor = obj.visible === true || obj.userData._vegetationFadedOutHidden === true;
      const show = corridorContains(s, wasInCorridor, basis);
      if (show) visibleCount++;
      if (isGrassChunk) {
        if (force || show !== obj.visible) obj.visible = show;
        continue;
      }

      if (show) {
        const occlusionRadius = (s.xzRadius ?? s.radius) * OCCLUSION_XZ_RADIUS_MUL;
        let blocking = false;
        if (!shoulderSurf && !obj.userData.skipOcclusionFade) {
          for (let i = 0; i < revealCount && !blocking; i++) {
            const t = revealTargets[i];
            blocking = treeFade.isBetweenCameraAndPlayer2D(s.x, s.z, camX, camZ, t.x, t.z, occlusionRadius);
          }
        }
        let target = blocking ? TREE_FADE_OPACITY : 1;
        let outlineAllowed = true;
        // Fade toward the camera corridor's *forward and side* edges, not an
        // unrelated circle around the player. The outline budget follows the
        // same tighter envelope.
        if (basis.shortCloudForest) {
          const dx = s.x - camX, dz = s.z - camZ;
          const along = dx * basis.viewX + dz * basis.viewZ;
          const side = Math.abs(dx * basis.rightX + dz * basis.rightZ);
          const edge = Math.max(0, along / Math.max(0.001, basis.forwardRange),
            side / Math.max(0.001, basis.halfWidth));
          if (edge > fadeStartFrac) {
            const span = Math.max(0.001, 1 - fadeStartFrac);
            target = Math.min(target, deps.clamp((1 - edge) / span, 0, 1));
          }
          outlineAllowed = edge <= outlineFrac;
        }
        treeFade.setTarget(obj, target, blocking);
        setTreeOutlineEnabled(obj, !blocking && outlineAllowed);
      } else {
        treeFade.reset(obj);
      }
      const fadedOut = show && hideFadedOut && treeFade.isFadedOut?.(obj) === true;
      if (fadedOut) fadedOutHidden++;
      obj.userData._vegetationFadedOutHidden = fadedOut;
      const drawn = show && !fadedOut;
      if (force || drawn !== obj.visible) obj.visible = drawn;
    }
    stats.updates++;
    stats.lastCullables = cullables.length;
    stats.lastVisible = visibleCount;
    stats.lastFadedOutHidden = fadedOutHidden;
  }

  // Throttled to ~7 Hz from gameLoop; drives the tree-fade targets (opacity
  // and, while a tree is actually blocking, depthWrite).
  function tick(dt) {
    accum += dt;
    if (accum < TICK_INTERVAL_S) return;
    const force = accum >= 900; // First tick after script load.
    accum = 0;
    update(force);
  }

  window.ZoneVegetationCull = Object.freeze({
    CORRIDOR,
    TREE_FADE_OPACITY,
    init,
    tick,
    update,
    cullBasis,
    corridorContains,
    isChunkInView: (sphere, wasVisible) => corridorContains(sphere, wasVisible, cullBasis()),
    setTreeOutlineEnabled,
    setHideFadedOut: value => { hideFadedOut = value !== false; accum = 999; return hideFadedOut; }, // accum: re-evaluate on the next tick.
    // The current zone's cullable trees/bushes/grass chunks (js/wilderness-tree-instancer.js batches the drawn trees).
    currentCullables: () => {
      const area = deps?.getCurrentArea?.();
      return area && deps.isZoneArea(area) ? deps.getZoneScene(area)?.cullables || null : null;
    },
    snapshot: () => ({ ...stats, hideFadedOut }),
  });
})();

(() => {
  'use strict';

  // Standalone helpers for the Cutscene Director preview handoff, extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as js/dye-system.js. The big stateful runner itself
  // (runCutscenePreview and its nested openLine/closeLine/showChoiceOptions/
  // runStage/runMove/runAnimation/runTurn/runCombat/runFade/runZoom/
  // cutsceneRotationTick) stays in game.js — those are nested closures over
  // *per-run* state (actorStates, dialogueOpen, speakerEntity, ...), not
  // reusable module-level helpers, and need their own state-object design
  // before they can move. Everything here is self-contained and only ever
  // called from within that runner.
  //
  // TILE/TileType/isSolid/npcSurfaceY/sceneForNpcArea/npcGridForArea/
  // characterGroundShadowSurfaceOffset are game.js `const`/`function`
  // declarations, never reassigned, so direct references are safe.
  // _zoneScenes/_zoneLayouts are `const` Maps mutated in place.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function cutscenePreviewBanner(text, isError) {
    let el = document.getElementById('cutscenePreviewBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cutscenePreviewBanner';
      el.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:99999;'
        + 'padding:8px 16px;border-radius:10px;font:600 14px/1.3 system-ui,sans-serif;color:#fff;'
        + 'background:rgba(20,14,10,.86);border:2px solid #f2b755;box-shadow:0 6px 18px rgba(0,0,0,.4);'
        + 'display:flex;gap:10px;align-items:center;pointer-events:auto;';
      const label = document.createElement('span');
      label.id = 'cutscenePreviewBannerLabel';
      el.appendChild(label);
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Exit preview';
      closeBtn.style.cssText = 'font:600 12px system-ui,sans-serif;padding:4px 8px;border-radius:6px;'
        + 'border:1px solid #f2b755;background:#3a2c22;color:#fff;cursor:pointer;';
      // A plain reload is enough to leave preview mode cleanly: the
      // handoff key is one-shot (already consumed) and the ephemeral
      // profile only ever lived in window.__hobunjiPlayerProfile, never
      // written to the real hobunjiPlayerProfile/hobunjiSaveMeta keys.
      closeBtn.addEventListener('click', () => location.reload());
      el.appendChild(closeBtn);
      document.body.appendChild(el);
    }
    el.style.borderColor = isError ? '#d66b68' : '#f2b755';
    document.getElementById('cutscenePreviewBannerLabel').textContent = text;
  }

  function cutscenePreviewFadeEl() {
    let el = document.getElementById('cutscenePreviewFade');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cutscenePreviewFade';
      el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#000;opacity:0;'
        + 'pointer-events:none;transition:opacity 1s linear;';
      document.body.appendChild(el);
    }
    return el;
  }

  async function cutscenePreviewWaitForArea(area, timeoutMs, predicate) {
    const check = predicate || (() => !!(deps.sceneForNpcArea(area) && deps.npcGridForArea(area)));
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (check()) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  // Scans a generated wilderness zone's real tile grid for a clear, flat
  // w×h rectangle to drop an authored scene's whole local footprint onto
  // — same tile-level exclusion checklist wilderness-map-generator.js's
  // own areaFree/randomFreeArea use (uniform elevation tier, no incline/
  // ramp/water/solid tiles), plus building/decor/furniture/den occupancy
  // that live outside the tile grid itself (see buildZoneScene /
  // _spawnZoneDecorFurniture / performTothalShift's `dens`). Searches
  // outward in Chebyshev rings from the zone's center so a found spot is
  // never farther from the middle of the map than it has to be.
  function findZonePlacementFootprint(area, w, h) {
    const zi = deps._zoneScenes.get(area);
    const grid = zi?.grid;
    if (!grid) return null;
    const cols = zi.cols, rows = zi.rows;
    const zoneData = deps._zoneLayouts.get(area);
    const occupied = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const markOccupied = (col, row, ow, oh) => {
      for (let r = Math.max(0, row); r < Math.min(rows, row + oh); r++)
        for (let c = Math.max(0, col); c < Math.min(cols, col + ow); c++) occupied[r][c] = true;
    };
    for (const b of (zoneData?.buildings || [])) markOccupied(b.gridX || 0, b.gridZ || 0, b.footprintW ?? b.w ?? 1, b.footprintD ?? b.h ?? 1);
    for (const d of (zoneData?.dens || [])) markOccupied(d.x, d.y, d.w || 1, d.h || 1);
    for (const d of (zoneData?.decor || [])) markOccupied(d.col, d.row, 1, 1);
    for (const f of (zoneData?.furniture || [])) markOccupied(f.col, f.row, 1, 1);

    function rectOk(col, row) {
      if (col < 1 || row < 1 || col + w > cols - 1 || row + h > rows - 1) return false; // stay off the border terrain skirt
      let elevTier = null;
      for (let r = row; r < row + h; r++) {
        for (let c = col; c < col + w; c++) {
          if (occupied[r][c]) return false;
          const tile = grid[r][c];
          if (!tile) return false;
          if (tile.water) return false;
          if (tile.incline) return false;
          if (tile.type === deps.TileType.RAMP) return false;
          if (deps.isSolid(tile.type)) return false;
          const tier = tile.elevTier || 0;
          if (elevTier === null) elevTier = tier;
          else if (tier !== elevTier) return false;
        }
      }
      return true;
    }

    const centerCol = Math.floor((cols - w) / 2), centerRow = Math.floor((rows - h) / 2);
    const maxRadius = Math.max(cols, rows);
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // ring only — interior already checked at smaller radii
          const col = centerCol + dc, row = centerRow + dr;
          if (rectOk(col, row)) return { col, row };
        }
      }
    }
    return null;
  }

  // Freeform ("custom") actors, and any actor whose real NPC/creature
  // spawn failed, fall back to a plain placeholder mesh — same
  // graceful-degradation policy the Cutscene Director tool's own
  // standalone preview uses for the same cases.
  function cutscenePreviewMakePlaceholder(actor, area, targetScene) {
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: actor.color || '#cccccc' });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.85, 10), mat);
    body.position.y = 0.28 + 0.85 / 2;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat);
    head.position.y = 0.28 + 0.85 + 0.18;
    group.add(head);
    const surfY = deps.npcSurfaceY(area, actor.worldC, actor.worldR);
    group.position.set(actor.worldC + 0.5, surfY, actor.worldR + 0.5);
    group.rotation.y = THREE.MathUtils.degToRad(actor.rotation || 0);
    targetScene.add(group);
    return { kind: 'placeholder', root: group };
  }

  const cutscenePreviewAngleToward = (from, to) => (((-Math.atan2(to.r - from.r, to.c - from.c) * 180 / Math.PI + 90) % 360) + 360) % 360;

  function cutscenePreviewApplyState(entity, area, st, dt = 1 / 60, seatOverride) {
    const surfY = deps.npcSurfaceY(area, Math.round(st.c), Math.round(st.r));
    if (entity.kind === 'creature') {
      const c = entity.creature;
      c.x = (st.c + 0.5) * deps.TILE; c.y = (st.r + 0.5) * deps.TILE;
      c.avatarRef.group.position.set(st.c + 0.5, surfY + (c.groundLift ?? c.halfHeight), st.r + 0.5);
      c.avatarRef.group.rotation.y = THREE.MathUtils.degToRad(st.rotation);
      // Seeds groupRot/pngRot to match so cutsceneRotationTick's first
      // real tick (see below) starts an angleDiff of exactly 0 instead
      // of smoothly sweeping in from wherever makeCreatureEntity's
      // groupRot:0 default left them.
      c.groupRot = c.pngRot = THREE.MathUtils.degToRad(st.rotation);
      c.groundShadow?.position.set(st.c + 0.5, surfY + deps.characterGroundShadowSurfaceOffset(), st.r + 0.5);
      c.avatarRef.group.scale.setScalar(st.pose === 'prone' ? 0.6 : 1);
    } else if (entity.kind === 'npc') {
      entity.walker._cinematicPose = st.pose; // Held stance yaw must respect the same seated/prone pose as the legs.
      const seatTransform = st.pose === 'sit' ? (seatOverride || deps.npcSeatTransformForTarget?.(st.seatTarget)) : null; // Reuses the exact normal-NPC furniture seat anchor for authored seated cutscene actors.
      const seatCol = seatTransform ? Math.floor(seatTransform.x) : Math.round(st.c); // Selects the floor tile beneath an authored seat for building-height lookup.
      const seatRow = seatTransform ? Math.floor(seatTransform.z) : Math.round(st.r); // Selects the floor tile beneath an authored seat for building-height lookup.
      const npcSurfY = deps.npcSurfaceY(area, seatCol, seatRow); // Keeps chairs on raised/interior surfaces while their local seat Y bends only the legs.
      const actorRot = seatTransform?.facingRad ?? THREE.MathUtils.degToRad(st.rotation); // Makes a seated actor face the chair's authored yaw while normalDeg remains reserved for seat-surface pitch/roll.
      if (!Number.isFinite(entity.walker.rot)) entity.walker.rot = actorRot;
      const standingPosteriorY = Number(entity.walker.legs?.standingPosteriorY); // Normal schedule seating lowers the entire avatar to put its posterior on the seat.
      const seatSink = seatTransform ? (Number.isFinite(standingPosteriorY) ? seatTransform.y - standingPosteriorY : -0.32) : 0;
      entity.root.position.set(seatTransform?.x ?? (st.c + 0.5), npcSurfY + seatSink, seatTransform?.z ?? (st.r + 0.5));
      entity.root.rotation.y = entity.walker.rot;
      entity.root.scale.setScalar(1);
      if (st.pose === 'prone' || st.proneBlend > 0) window.ImpactRagdollPlayback?.holdHumanoidProne?.(entity.walker, 'front', st.proneBlend ?? 1); // Reuses the exact combat knockdown tail, including torso and both recorded leg poses.
      else window.ImpactRagdollPlayback?.clearHumanoidProne?.(entity.walker);
      if (seatTransform && entity.walker.legs) {
        const seatedPose = { // Feeds the normal procedural-leg seated solver so cutscene chairs do not leave standing legs through the furniture.
          seatY: seatTransform.y,
          normalDeg: seatTransform.normalDeg,
          footprintHalfDepth: seatTransform.footprintHalfDepth,
          anchorZ: seatTransform.anchorZ,
        };
        entity.walker.legs.update(dt > 0 ? dt : 1 / 60, 0, false, seatedPose);
      } else if (st.pose !== 'prone' && !(st.proneBlend > 0)) entity.walker.legs?.update(dt > 0 ? dt : 1 / 60, 0, false);
    } else {
      entity.root.position.set(st.c + 0.5, surfY, st.r + 0.5);
      entity.root.rotation.y = THREE.MathUtils.degToRad(st.rotation);
      entity.root.scale.setScalar(st.pose === 'prone' ? 0.6 : 1);
    }
  }

  window.CutscenePreviewHelpers = {
    init,
    cutscenePreviewBanner, cutscenePreviewFadeEl, cutscenePreviewWaitForArea,
    findZonePlacementFootprint, cutscenePreviewMakePlaceholder,
    cutscenePreviewAngleToward, cutscenePreviewApplyState,
  };
})();

(() => {
  'use strict';

  // Uumkao'ii dew piles + livestock-to-vat assignment (farm-only). A dew
  // pile is tile data (grid[r][c].dewPile = a color string like 'blue'),
  // the same way a crop is tile data — not a worldObjects entry — because
  // it needs to participate in the shovel dig/fill/raise gate exactly like
  // WEEDS/SHRUB/ROCK already do. dewPileMeshes tracks the purely-visual
  // translucent boulder cluster per tile in parallel, the same "tile data
  // now, mesh separately" split game.js's saveFarmLayout/applyFarmLayoutObjects
  // use for crops vs. their procedural meshes. Assigning a housed uumkao'ii
  // to a placed squeezing vat redirects its dew straight into squeezed
  // milk/curds every cooldown cycle instead of dropping a pile that has to
  // be dug up — see assignToVat/autoSqueezeAtVat.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/bounty-board.js and
  // js/alchemy-system.js. `grid` is reassigned wholesale on zone/farm
  // transitions (see game.js's own `let grid`), so it's threaded through
  // as a getter rather than a captured reference, same reasoning as
  // js/dye-system.js's gearInventory getter. The rest of the farm-animal
  // system (barn/wander AI, the animal factories, breeding) stays in
  // game.js for now and calls into this module for dew/vat behavior.
  // COLS/ROWS/TileType are static level-geometry constants, not per-farm
  // state, so (unlike grid) they're captured once at init() rather than
  // read through a getter every call.
  let deps = null, COLS, ROWS, TileType;
  const DEW_SHOVEL_SFX_URL = 'assets/audio/sfx/sfx_shovel_dew.mp3'; // Used instead of the ordinary dirt-dig cue while the live shovel reticle is on Uumkao'ii dew.
  const DEW_ROCK_OPACITY = 0.45; // Used by dew-only rock materials so the boulders read as translucent condensed dew instead of ordinary stone.
  const DEW_WAVY_TEXTURE = 'assets/textures/wavy_surface.png'; // Used by the fallback renderer and diagnostics; the normal path reaches the same texture through the existing trunk natural-surface style.
  let dewShovelSfxPreload = null; // Retains one eagerly loaded element so repeated held-action thrusts start immediately.
  let lastDewShovelSfxDebug = null; // Mobile-readable diagnostic exported below.
  let dewFallbackWavyTexture = null; // Shared only if NaturalSurfaceMaterials is unavailable, avoiding one TextureLoader allocation per pile.

  function init(injectedDeps) {
    deps = injectedDeps;
    COLS = deps.COLS; ROWS = deps.ROWS; TileType = deps.TileType;
    _preloadDewShovelSfx();
    _installDewShovelSfxOverride();
    _pruneInvalidVatAssignments();
    _installSqueezingVatStartGuards();
  }

  function _preloadDewShovelSfx() {
    if (dewShovelSfxPreload || typeof Audio !== 'function') return;
    const snd = new Audio();
    snd.preload = 'auto';
    snd.src = DEW_SHOVEL_SFX_URL;
    snd.load?.();
    dewShovelSfxPreload = snd;
  }

  function _targetedDewPile() {
    const debug = window.__hobunjiFurnitureDebug; // Existing always-on game-state bridge; keeps this module from duplicating game.js's private targeting state.
    if (!debug || debug.getCurrentArea?.() !== 'farm') return null;
    const playerState = debug.playerState; // Used to reproduce getReticleTile's authored 0.62-tile ground probe.
    const angleDeg = Number(debug.targetAimAngleDeg); // Uses the same targetAimAngle that desktop mouse, controller look, and mobile action drag update.
    if (![playerState?.x, playerState?.y, angleDeg].every(Number.isFinite)) return null;
    const orbitRadiusTiles = Number(window.SCRATCHBONES_CONFIG?.game?.input?.targeting?.orbitRadiusTiles);
    const orbit = Number.isFinite(orbitRadiusTiles) ? orbitRadiusTiles : 0.62;
    const angle = angleDeg * Math.PI / 180;
    const tileSize = 64; // Player positions in this bridge are world pixels; farm tile size is the game's canonical 64 px.
    const col = Math.max(0, Math.min(COLS - 1, Math.floor((playerState.x + Math.cos(angle) * tileSize * orbit) / tileSize)));
    const row = Math.max(0, Math.min(ROWS - 1, Math.floor((playerState.y + Math.sin(angle) * tileSize * orbit) / tileSize)));
    const tile = debug.farmGridTileAt?.(col, row);
    return tile?.dewPile ? { col, row, colorKey: tile.dewPile } : null;
  }

  function _playDewShovelSfx(volumeScale = 1, pitch = 1) {
    const audioCfg = window.AudioSystem?.gameAudioConfig?.() || {};
    if (audioCfg.enabled === false) return false;
    const snd = dewShovelSfxPreload?.cloneNode?.(true) || (typeof Audio === 'function' ? new Audio(DEW_SHOVEL_SFX_URL) : null);
    if (!snd) return false;
    snd.volume = Math.max(0, Math.min(1, 0.9 * Math.max(0, Number(audioCfg.sfxVolume) || 1) * Math.max(0, Number(volumeScale) || 0)));
    snd.playbackRate = Math.max(0.3, Number(pitch) || 1);
    snd.play().catch(() => {});
    const target = _targetedDewPile();
    lastDewShovelSfxDebug = {
      atMs: Math.round(performance.now()),
      target,
      url: DEW_SHOVEL_SFX_URL,
      readyState: dewShovelSfxPreload?.readyState ?? null,
    };
    window.__farmLog?.(`[dew-sfx] shovelDew at ${target ? `${target.col},${target.row}` : '?'} ready=${lastDewShovelSfxDebug.readyState ?? '?'}`, 'audio');
    return true;
  }

  function _installDewShovelSfxOverride() {
    const audio = window.AudioSystem;
    if (!audio?.playObjectSfxKey || audio.__hobunjiDewShovelSfxOverride) return false;
    const originalPlayObjectSfxKey = audio.playObjectSfxKey.bind(audio); // Preserves every existing keyed cue unchanged outside dew digging.
    audio.playObjectSfxKey = function dewAwareObjectSfxKey(key, volumeScale = 1, pitch = 1) {
      if (key === 'dig' && _targetedDewPile()) return _playDewShovelSfx(volumeScale, pitch);
      return originalPlayObjectSfxKey(key, volumeScale, pitch);
    };
    audio.__hobunjiDewShovelSfxOverride = true;
    return true;
  }

  function dewShovelSfxDebugSnapshot() {
    return lastDewShovelSfxDebug ? { ...lastDewShovelSfxDebug } : null;
  }

  // ── Dew piles ──────────────────────────────────────────────────────
  const dewPileMeshes = new Map(); // "col,row" -> THREE.Group containing the dew boulder cluster for that tile.

  function canPlaceAt(col, row) {
    const grid = deps.getGrid();
    const tile = grid[row]?.[col];
    if (!tile || tile.dewPile || tile.crop) return false;
    if (![TileType.GRASS, TileType.TILLED, TileType.RAISED].includes(tile.type)) return false;
    if (deps.getWorldObjectAt(col, row)) return false;
    if (deps.isHouseFootprint(col, row)) return false;
    return true;
  }

  function _fallbackWavyTexture() {
    if (dewFallbackWavyTexture) return dewFallbackWavyTexture;
    const tex = new THREE.TextureLoader().load(DEW_WAVY_TEXTURE);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if ('colorSpace' in tex && THREE.SRGBColorSpace != null) tex.colorSpace = THREE.SRGBColorSpace;
    else if ('encoding' in tex && THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    tex.userData = Object.assign({}, tex.userData, { uumkaoiiDewSharedWavyTexture: true });
    dewFallbackWavyTexture = tex;
    return tex;
  }

  function _restoreDewShellOutline(mesh) {
    if (!mesh?.isMesh) return;
    mesh.userData = Object.assign({}, mesh.userData, {
      uumkaoiiDewRock: true,
      shellOutlineRetainedForDew: true,
    });
    delete mesh.userData.noOutline;
    delete mesh.userData.facetedSurfaceTextureOutline;
    delete mesh.userData.shellOutlineDisabledReason;
    mesh.layers?.enable(1);
  }

  // Reuses the game's actual deterministic ROCK-tile boulder cluster, then
  // swaps only this dew instance onto the existing wavy_surface natural-
  // surface treatment. Using the "trunks" style is deliberate: it is the
  // canonical wavy_surface + body-sprite-tint path, while a planar mapping
  // override keeps that texture stretched across rock faces instead of
  // cylindrical wrapping. The ordinary boulder wrapper initially marks the
  // geometry as a faceted ROCK and suppresses its shell; dew immediately
  // clears those suppression flags and re-enables layer 1 after restyling.
  function _styleDewBoulder(root, colorHex) {
    let styledMeshes = 0;
    root?.traverse?.(mesh => {
      if (!mesh?.isMesh) return;
      const source = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: DEW_ROCK_OPACITY,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide,
      });
      mesh.material = source;

      const naturalSurfaces = window.NaturalSurfaceMaterials;
      if (naturalSurfaces?.naturalizeMesh) {
        naturalSurfaces.naturalizeMesh(mesh, 'trunks', 'planar-stretch');
        if (mesh.material !== source) source.dispose();
      } else {
        mesh.material = new THREE.MeshBasicMaterial({
          map: _fallbackWavyTexture(),
          color: colorHex,
          transparent: true,
          opacity: DEW_ROCK_OPACITY,
          depthWrite: false,
          depthTest: true,
          side: THREE.FrontSide,
        });
        source.dispose();
      }

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const dewMaterials = materials.map(material => {
        const clone = material.clone();
        clone.transparent = true;
        clone.opacity = DEW_ROCK_OPACITY;
        clone.depthWrite = false;
        clone.userData = Object.assign({}, clone.userData, {
          uumkaoiiDewRockMaterial: true,
          uumkaoiiDewTexture: DEW_WAVY_TEXTURE,
        });
        clone.needsUpdate = true;
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? dewMaterials : dewMaterials[0];
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      _restoreDewShellOutline(mesh);
      styledMeshes++;
    });
    return styledMeshes;
  }

  function spawnMesh(col, row, colorKey) {
    const grid = deps.getGrid();
    const tile = grid[row]?.[col];
    if (!tile) return;
    const key = col + ',' + row;
    removeMesh(col, row);

    const group = window.FoliageGenerator?.buildBoulderMesh?.(col, row);
    if (!group) {
      window.__farmLog?.(`[dew-render] unable to build existing ROCK geometry at ${key}; FoliageGenerator.buildBoulderMesh unavailable`, 'render');
      return;
    }

    const colorHex = deps.ITEM_DEFS[deps.dewItemKey(colorKey)]?.spriteColor ?? 0x3F8FE0;
    const styledMeshes = _styleDewBoulder(group, colorHex);
    group.position.set(col + 0.5, deps.tileSurfaceY(tile.type), row + 0.5);
    group.userData = Object.assign({}, group.userData, {
      uumkaoiiDewRock: true,
      dewColorKey: colorKey,
      dewStyledMeshCount: styledMeshes,
    });
    deps.getScene().add(group);
    dewPileMeshes.set(key, group);
  }

  // Retained as a public per-frame hook because game.js already calls it.
  // Dew is now true 3D boulder geometry, so unlike the old billboard sprite
  // it must remain world-oriented and no camera-facing rotation is required.
  function updateMeshRotations(dt) {
    void dt;
  }

  function dewVisualDebugSnapshot() {
    let meshes = 0;
    let shellOutlined = 0;
    for (const group of dewPileMeshes.values()) {
      group.traverse?.(child => {
        if (!child?.isMesh) return;
        meshes++;
        if ((child.layers?.mask & (1 << 1)) !== 0 && !child.userData?.noOutline) shellOutlined++;
      });
    }
    return {
      mode: 'translucent-existing-rocks',
      piles: dewPileMeshes.size,
      meshes,
      shellOutlined,
      opacity: DEW_ROCK_OPACITY,
      texture: DEW_WAVY_TEXTURE,
      fallbackTextureLoaded: !!dewFallbackWavyTexture,
    };
  }

  function removeMesh(col, row) {
    const key = col + ',' + row;
    const group = dewPileMeshes.get(key);
    if (!group) return;
    deps.getScene().remove(group);
    group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
      for (const material of materials) material.dispose?.();
      // Material maps come from NaturalSurfaceMaterials' shared texture cache
      // (or _fallbackWavyTexture), so only the per-pile material clones are
      // disposed here; disposing their map would break every other user.
    });
    dewPileMeshes.delete(key);
  }

  function rebuildMeshesFromGrid() {
    const grid = deps.getGrid();
    [...dewPileMeshes.keys()].forEach(key => {
      const [c, r] = key.split(',').map(Number);
      removeMesh(c, r);
    });
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r]?.[c]?.dewPile) spawnMesh(c, r, grid[r][c].dewPile);
      }
    }
  }

  // Places a persistent dew pile on an open tile — see game.js's
  // makeUumkaoiiAnimal's tick(), which calls this on the tile a farm
  // uumkao'ii just vacated once its dew cooldown is ready. Returns false
  // (no state change) if the tile isn't a valid spot, so the caller can
  // leave dewReady set and simply retry on a later successful move.
  function drop(col, row, colorKey) {
    if (!canPlaceAt(col, row)) return false;
    const grid = deps.getGrid();
    grid[row][col].dewPile = colorKey;
    spawnMesh(col, row, colorKey);
    deps.saveFarmLayout();
    return true;
  }

  // Scans the whole farm grid for dropped-but-uncollected dew piles — the
  // Farm tab's Dew section uses this to show the player where to go dig,
  // instead of them having to spot a tiny sprite while wandering the farm.
  function listPiles() {
    const grid = deps.getGrid();
    const piles = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const colorKey = grid[r]?.[c]?.dewPile;
        if (colorKey) piles.push({ col: c, row: r, colorKey });
      }
    }
    return piles;
  }

  // Used when a dew cooldown lands while the player isn't on the farm to
  // see the animal wander and drop it naturally (see game.js's
  // tickLivestockResources) — picks blindly rather than tracking actual
  // open tiles since the farm grid is small and open ground is the common
  // case; a few missed rolls on a crowded farm just cost a handful of
  // cheap canPlaceAt checks.
  function dropOnRandomOpenTile(colorKey, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      const col = Math.floor(deps.rnd() * COLS);
      const row = Math.floor(deps.rnd() * ROWS);
      if (drop(col, row, colorKey)) return true;
    }
    return false;
  }

  // ── Livestock-to-vat assignment (Small livestock working a squeezing vat) ──
  function vatCanAccept(kind, genotype) {
    return window.CreatureGenetics?.creatureSizeClass?.(kind, genotype) === 'small';
  }
  function _workerCanOperate(rec) {
    return !!rec?.barnId && vatCanAccept(rec.kind, rec.genotype); // Used to keep stasis/unhoused livestock from satisfying the live squeezing-vat worker requirement.
  }
  function _pruneInvalidVatAssignments() {
    const list = deps.loadWorldLivestock(); // Used to migrate stale non-Small or unhoused vat assignments from older saves.
    let changed = false; // Used to avoid unnecessary save writes when every assignment is already valid.
    for (const rec of list) {
      if (!rec.assignedVatId || _workerCanOperate(rec)) continue;
      rec.assignedVatId = null;
      changed = true;
    }
    if (changed) {
      deps.saveWorldLivestock(list);
      window.__farmLog?.('[squeezing-vat] cleared stale non-Small/unhoused livestock assignments', 'livestock');
    }
  }
  function assignedWorkerForVat(vatId, list = deps.loadWorldLivestock()) {
    return list.find(rec => rec.assignedVatId === vatId && _workerCanOperate(rec)) || null;
  }
  function findVatById(vatId) {
    for (const obj of deps.processingFurnitureObjects) if (obj.id === vatId) return obj;
    return null;
  }
  function _workerRequiredResult() {
    return { ok: false, workerRequired: true, message: 'Assign housed Small livestock to this squeezing vat before starting it.' };
  }
  function _guardSqueezingVatStart(vat) {
    if (!vat || vat.__smallWorkerStartGuard) return;
    if (deps.PROCESSING_FURNITURE_DEFS[vat.furnitureKey]?.method !== 'squeezing') return;
    const originalOnAction = vat.onAction; // Used to block manual inputs before game.js consumes the selected ingredient.
    if (typeof originalOnAction === 'function') {
      vat.onAction = function guardedSqueezingAction(action) {
        if (action === 'obj_process_' + vat.furnitureKey && !vat.getJob?.() && !assignedWorkerForVat(vat.id)) {
          window.__farmLog?.(`[squeezing-vat] blocked manual start without housed Small livestock worker vat=${vat.id}`, 'livestock');
          return _workerRequiredResult();
        }
        return originalOnAction.call(vat, action);
      };
    }
    const originalStartTimedJob = vat.startTimedJob; // Used to protect livestock/other programmatic starts through the public processor API.
    if (typeof originalStartTimedJob === 'function') {
      vat.startTimedJob = function guardedTimedSqueezingStart(options) {
        if (!vat.getJob?.() && !assignedWorkerForVat(vat.id)) {
          window.__farmLog?.(`[squeezing-vat] blocked timed start without housed Small livestock worker vat=${vat.id}`, 'livestock');
          return _workerRequiredResult();
        }
        return originalStartTimedJob.call(vat, options);
      };
    }
    vat.__smallWorkerStartGuard = true;
  }
  function _installSqueezingVatStartGuards() {
    const processors = deps.processingFurnitureObjects; // Shared Set used to guard existing and newly placed squeezing vats without coupling the rule back into game.js.
    if (!processors) return;
    for (const obj of processors) _guardSqueezingVatStart(obj);
    if (processors.__smallWorkerAddGuard || typeof processors.add !== 'function') return;
    const originalAdd = processors.add; // Used to install the same start gate on processors restored/placed after DewVats.init().
    processors.add = function guardedProcessorAdd(obj) {
      _guardSqueezingVatStart(obj);
      return originalAdd.call(this, obj);
    };
    processors.__smallWorkerAddGuard = true;
  }
  function assignToVat(livestockId, vatId) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    const list = deps.loadWorldLivestock();
    const rec = list.find(l => l.id === livestockId);
    if (!rec) return { ok: false, message: 'Livestock not found.' };
    if (!rec.barnId) return { ok: false, message: `${rec.name} must be housed in a barn first.` };
    if (!vatCanAccept(rec.kind, rec.genotype)) return { ok: false, message: `${rec.name} is not Small; only Small livestock can work a squeezing vat.` };
    const vat = findVatById(vatId);
    if (!vat || deps.PROCESSING_FURNITURE_DEFS[vat.furnitureKey]?.method !== 'squeezing') return { ok: false, message: 'That is not a squeezing vat.' };
    if (list.some(l => l.assignedVatId === vatId && l.id !== livestockId && _workerCanOperate(l))) return { ok: false, message: 'That vat already has livestock assigned to it.' };
    const oldVatId = rec.assignedVatId; // Used to release a live pose when transferring a worker between vats.
    rec.assignedVatId = vatId;
    deps.saveWorldLivestock(list);
    _guardSqueezingVatStart(vat);
    if (oldVatId && oldVatId !== vatId) window.FarmAnimals?.clearVatWorkerPose?.(oldVatId);
    return { ok: true, message: `${rec.name} assigned to ${vat.label}.` };
  }
  function unassignFromVat(livestockId) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    const list = deps.loadWorldLivestock();
    const rec = list.find(l => l.id === livestockId);
    if (!rec) return { ok: false, message: 'Livestock not found.' };
    const oldVatId = rec.assignedVatId; // Used to release a live stomp pose if this worker is unassigned mid-process.
    rec.assignedVatId = null;
    deps.saveWorldLivestock(list);
    if (oldVatId) window.FarmAnimals?.clearVatWorkerPose?.(oldVatId);
    return { ok: true, message: `${rec.name} unassigned from its vat.` };
  }
  function retargetAssignments(oldVatId, newVatId = null) {
    const list = deps.loadWorldLivestock();
    let changed = 0;
    for (const rec of list) {
      if (rec.assignedVatId !== oldVatId) continue;
      rec.assignedVatId = newVatId;
      changed++;
    }
    if (changed) deps.saveWorldLivestock(list);
    if (changed) window.FarmAnimals?.clearVatWorkerPose?.(oldVatId);
    return changed;
  }
  // Starts the vat's real authored squeezing job for raw dew (bypassing the
  // dig-up-a-pile step). Returns 'started', 'busy', or false when the vat no
  // longer exists; the farm-animal day tick uses that distinction so a busy
  // vat never accidentally clears its valid livestock assignment.
  function autoSqueezeAtVat(vatId, colorKey) {
    const vat = findVatById(vatId);
    if (!vat || !assignedWorkerForVat(vatId)) return false;
    _guardSqueezingVatStart(vat);
    const outputs = deps.getProcessingOutputs('squeezing', deps.dewItemKey(colorKey));
    if (!outputs) return false;
    const stars = deps.rollItemStars('farming'); // Used to make automatically squeezed animal goods inherit Farming-driven quality.
    const result = vat.startTimedJob?.({ outputs, inputStars: stars, inputLabel: `${colorKey} dew`, source: 'livestock' });
    if (result?.busy) return 'busy';
    return result?.ok ? 'started' : false;
  }

  window.DewVats = {
    init,
    canPlaceAt,
    spawnMesh,
    updateMeshRotations,
    removeMesh,
    rebuildMeshesFromGrid,
    listPiles,
    drop,
    dropOnRandomOpenTile,
    vatCanAccept,
    assignedWorkerForVat,
    findVatById,
    assignToVat,
    unassignFromVat,
    retargetAssignments,
    autoSqueezeAtVat,
    dewShovelSfxDebugSnapshot,
    dewVisualDebugSnapshot,
  };
})();
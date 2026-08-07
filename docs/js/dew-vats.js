(() => {
  'use strict';

  // Uumkao'ii dew piles + livestock-to-vat assignment (farm-only). A dew
  // pile is tile data (grid[r][c].dewPile = a color string like 'blue'),
  // the same way a crop is tile data — not a worldObjects entry — because
  // it needs to participate in the shovel dig/fill/raise gate exactly like
  // WEEDS/SHRUB/ROCK already do. dewPileMeshes tracks the purely-visual
  // billboard per tile in parallel, the same "tile data now, mesh
  // separately" split game.js's saveFarmLayout/applyFarmLayoutObjects use
  // for crops vs. their procedural meshes. Assigning a housed uumkao'ii to
  // a placed squeezing vat redirects its dew straight into squeezed
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
  function init(injectedDeps) {
    deps = injectedDeps;
    COLS = deps.COLS; ROWS = deps.ROWS; TileType = deps.TileType;
  }

  // ── Dew piles ──────────────────────────────────────────────────────
  const dewPileMeshes = new Map(); // "col,row" -> THREE.Group

  function canPlaceAt(col, row) {
    const grid = deps.getGrid();
    const tile = grid[row]?.[col];
    if (!tile || tile.dewPile || tile.crop) return false;
    if (![TileType.GRASS, TileType.TILLED, TileType.RAISED].includes(tile.type)) return false;
    if (deps.getWorldObjectAt(col, row)) return false;
    if (deps.isHouseFootprint(col, row)) return false;
    return true;
  }

  // Tinted-and-faded cheese.png canvas for a given dew color, cached by
  // color so multiple piles sharing a color (the common case — every
  // uumkao'ii on a farm today drops the same UUMKAOII_DEFAULT_DEW_COLOR)
  // only pay the load/recolor cost once. Recolored via
  // CreatureGeneticsRender's own shade-fill tint (the same technique
  // that colors gar-wolf/dabinggi-hound fur patterns), not
  // SpriteRecolor's HSV replace, per spec — then every non-outline
  // pixel is faded to 20% opacity (80% transparency) so it reads as a
  // glassy dew droplet rather than a flat opaque sticker, while the
  // outline ink itself (recolorPixels' own near-black protection
  // threshold) stays fully opaque so the shape still reads clearly.
  const _dewSpriteTintCache = new Map(); // colorHex(number) -> Promise<{canvas, bottomRatio}>
  function _tintedDewSpriteCanvas(colorHex) {
    if (_dewSpriteTintCache.has(colorHex)) return _dewSpriteTintCache.get(colorHex);
    const promise = new Promise((resolve, reject) => {
      if (!window.CreatureGeneticsRender) { reject(new Error('CreatureGeneticsRender unavailable')); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, c.width, c.height);
        const px = imgData.data;
        const rgb = window.CreatureGeneticsRender.hexToRgb('#' + colorHex.toString(16).padStart(6, '0'));
        window.CreatureGeneticsRender.recolorPixels(px, rgb, null);
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] === 0) continue;
          const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
          if (lum <= 0.08) continue; // outline ink stays fully opaque
          px[i + 3] = Math.round(px[i + 3] * 0.2);
        }
        ctx.putImageData(imgData, 0, 0);
        const bounds = window.PNGPlaneAvatar?.scanOpaqueVerticalBoundsOfImage?.(img);
        const bottomRatio = bounds ? (bounds.bottom + 1) / img.naturalHeight : 1;
        resolve({ canvas: c, bottomRatio });
      };
      img.onerror = () => reject(new Error('Failed to load cheese.png'));
      img.src = 'assets/objectsprites/cheese.png';
    });
    _dewSpriteTintCache.set(colorHex, promise);
    return promise;
  }

  // Rendered as a single upright plane (front-facing convention, like a
  // character/NPC — cheese.png is a single icon-style sprite, not a
  // side-view creature profile) rather than the animal system's crossed
  // front/back planes, camera-relative dead-zone rotated the same way
  // (perpClamp/cameraRelativePerps) since it's static — never moving, so
  // there's no "oscillate while moving" case to handle, just settle
  // broadside and freeze like an idle character. Grounded so the
  // sprite's own lowest opaque pixel (not the raw image rectangle's
  // bottom edge) sits exactly on the tile surface, the same
  // opaque-bounds-scan technique creature planes use.
  function spawnMesh(col, row, colorKey) {
    const grid = deps.getGrid();
    const key = col + ',' + row;
    removeMesh(col, row);
    const group = new THREE.Group();
    group.position.set(col + 0.5, deps.tileSurfaceY(grid[row][col].type), row + 0.5);
    group.userData.perpState = {};
    deps.getScene().add(group);
    dewPileMeshes.set(key, group);
    const colorHex = deps.ITEM_DEFS[deps.dewItemKey(colorKey)]?.spriteColor ?? 0x3F8FE0;
    _tintedDewSpriteCanvas(colorHex).then(({ canvas, bottomRatio }) => {
      if (dewPileMeshes.get(key) !== group) return; // tile changed/pile dug up while this was loading
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const targetH = 0.7; // large enough to read clearly on a tile
      const targetW = targetH * (canvas.width / canvas.height);
      const geo = new THREE.PlaneGeometry(targetW, targetH);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = targetH / 2 + deps.creaturePlaneGroundOffset(targetH, bottomRatio);
      group.add(mesh);
    }).catch(() => {});
  }

  // Called every frame (farm only — dew piles only ever exist there) to
  // keep every standing dew sprite broadside to the camera within its
  // own dead-zone-freeze state, exactly like an idle character.
  function updateMeshRotations(dt) {
    for (const group of dewPileMeshes.values()) {
      const lookTarget = deps.nearestAngleAmong(group.rotation.y, deps.cameraRelativePerps());
      const { effectiveTarget, snapTo } = deps.perpClamp(group.userData.perpState, lookTarget, deps.cameraRelativePerps());
      if (snapTo !== null) group.rotation.y = effectiveTarget;
      else group.rotation.y += deps.angleDiff(effectiveTarget, group.rotation.y) * 0.18;
    }
  }

  function removeMesh(col, row) {
    const key = col + ',' + row;
    const group = dewPileMeshes.get(key);
    if (!group) return;
    deps.getScene().remove(group);
    group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) { if (child.material.map) child.material.map.dispose(); child.material.dispose(); }
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

  // ── Livestock-to-vat assignment (small livestock working a squeezer) ──
  function vatCanAccept(kind) {
    return kind === 'uumkaoii'; // the only kind with a squeezable resource today
  }
  function findVatById(vatId) {
    for (const obj of deps.processingFurnitureObjects) if (obj.id === vatId) return obj;
    return null;
  }
  function assignToVat(livestockId, vatId) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    const list = deps.loadWorldLivestock();
    const rec = list.find(l => l.id === livestockId);
    if (!rec) return { ok: false, message: 'Livestock not found.' };
    if (!rec.barnId) return { ok: false, message: `${rec.name} must be housed in a barn first.` };
    if (!vatCanAccept(rec.kind)) return { ok: false, message: `${rec.name} has nothing a vat can process.` };
    const vat = findVatById(vatId);
    if (!vat || deps.PROCESSING_FURNITURE_DEFS[vat.furnitureKey]?.method !== 'squeezing') return { ok: false, message: 'That is not a squeezing vat.' };
    if (list.some(l => l.assignedVatId === vatId && l.id !== livestockId)) return { ok: false, message: 'That vat already has livestock assigned to it.' };
    rec.assignedVatId = vatId;
    deps.saveWorldLivestock(list);
    return { ok: true, message: `${rec.name} assigned to ${vat.label}.` };
  }
  function unassignFromVat(livestockId) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    const list = deps.loadWorldLivestock();
    const rec = list.find(l => l.id === livestockId);
    if (!rec) return { ok: false, message: 'Livestock not found.' };
    rec.assignedVatId = null;
    deps.saveWorldLivestock(list);
    return { ok: true, message: `${rec.name} unassigned from its vat.` };
  }
  // Runs the squeezing recipe for a raw dew color directly into inventory
  // (bypassing the dig-up-a-pile step) and plays the vat's own processing
  // VFX burst. Returns false (no state change) if the vat no longer
  // exists — game.js's tickLivestockResources clears the stale assignment
  // in that case and falls back to the ordinary pile-drop.
  function autoSqueezeAtVat(vatId, colorKey) {
    const vat = findVatById(vatId);
    if (!vat) return false;
    const outputs = deps.getProcessingOutputs('squeezing', deps.dewItemKey(colorKey));
    if (!outputs) return false;
    outputs.forEach(o => { deps.ensureProcessedItemDef(o); deps.inventory[o.key] = Math.min(99, (deps.inventory[o.key] || 0) + 1); });
    window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig()[deps.PROCESSING_SFX_KEY[vat.furnitureKey]]);
    vat.triggerVfx && vat.triggerVfx();
    return true;
  }

  window.DewVats = {
    init,
    canPlaceAt,
    spawnMesh,
    updateMeshRotations,
    removeMesh,
    rebuildMeshesFromGrid,
    drop,
    dropOnRandomOpenTile,
    vatCanAccept,
    findVatById,
    assignToVat,
    unassignFromVat,
    autoSqueezeAtVat,
  };
})();

(() => {
  'use strict';

  // The Farm tab's identity/progression hub (header, top-down status
  // glance, buildings list, processor status tiles, livestock roster +
  // breeding pairs, farm↔personal-stable transfers, farm storage
  // deposit/withdraw, farmhand permission grants) and the Stable tab
  // (personal companion/mount/shoulder-pet roster). Extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern as
  // its sibling systems.
  //
  // Reads deps.getGrid()/deps.worldObjects/deps.animalObjects directly
  // (not through getActiveGrid()/getWorldObjectAt(), which are area-gated)
  // since those bare game.js variables are always the farm's own state
  // regardless of which area the player currently stands in — same
  // reasoning the original code's own comment gave.
  //
  // farmBuildings/stable/activeMountId/activeShoulderPetId/activeCompanionId/
  // BARN_TIERS are threaded as getter/setter pairs since they're plain
  // `let`s reassigned elsewhere in game.js (world load, companion sync,
  // shop-stock config load).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // Keyed by `${source}:${id}` so a world-livestock id and a stable id
  // never collide. Values are the ref objects setBreedingPair() expects.
  let farmPairPicks = new Map();

  // Farm tab "move/place" state — armed by a button in renderFarmBuildings(),
  // consumed by the farmGlanceCanvas click handler set up in
  // renderFarmGridGlance(). null when nothing is being moved/placed.
  let _farmPlacementMode = null; // { type: 'move', buildingId } | { type: 'place', tier } — barns only; house-piece move/place lives in the House Layout modal's own _houseLayoutPlacementMode below

  function renderFarmPanel() {
    if (!document.getElementById('mpFarm')) return;
    renderFarmHeader();
    renderFarmGridGlance();
    renderFarmBuildings();
    renderFarmProcessors();
    renderFarmDew();
    renderFarmFurniture();
    renderFarmLivestock();
    renderFarmStoragePane();
    renderFarmhandsSection();

    const addLivestockBtn = document.getElementById('farmAddLivestockBtn');
    if (addLivestockBtn) addLivestockBtn.onclick = () => {
      const picker = document.getElementById('farmAddLivestockPicker');
      if (!picker) return;
      if (!picker.hidden) { picker.hidden = true; return; }
      renderFarmAddLivestockPicker();
      picker.hidden = false;
    };
    const pairBtn = document.getElementById('farmPairBtn');
    if (pairBtn) pairBtn.onclick = () => {
      const [a, b] = [...farmPairPicks.values()];
      if (a && b) setBreedingPair(a, b);
      farmPairPicks.clear();
      renderFarmLivestock();
    };
    const addFarmhandBtn = document.getElementById('farmAddFarmhandBtn');
    if (addFarmhandBtn) addFarmhandBtn.onclick = () => {
      const id = document.getElementById('farmAddFarmhandSelect')?.value;
      if (!id) return;
      window.__hobunjiAddFarmhand(id, {});
      renderFarmhandsSection();
    };
  }

  function renderFarmHeader() {
    const input = document.getElementById('farmNameInput');
    const saveBtn = document.getElementById('farmNameSaveBtn');
    const ownerSpan = document.getElementById('farmOwnerName');
    const owner = deps.isFarmOwner();
    if (input) { input.value = deps.getFarmName(); input.disabled = !owner; }
    if (saveBtn) {
      saveBtn.hidden = !owner;
      saveBtn.onclick = () => { deps.setFarmName(input.value); renderFarmHeader(); deps.showToast('Farm renamed.', true); };
    }
    if (ownerSpan) ownerSpan.textContent = deps.getFarmOwnerName();
  }

  const FARM_GLANCE_PX = 10;

  // Flat marker colors for worldObjects types on the Layout glance
  // canvas, keyed by the same `type` tag each object carries (see
  // farm-buildings.js's _makeWorldObject, game.js's registerSitWorldObject/
  // makeSellCrate/makeSupplyBox). Processing furniture is excluded here —
  // it gets its live status color instead (see farmProcessorStatus).
  const WORLD_OBJECT_TYPE_COLORS = {
    barn: 'rgba(200,80,60,0.9)',
    house_piece: 'rgba(120,90,60,0.9)',
    house_entrance: 'rgba(120,90,60,0.9)',
    sell_crate: 'rgba(230,190,80,0.9)',
    supply_box: 'rgba(230,190,80,0.9)',
    decorative_furniture: 'rgba(150,100,220,0.9)',
    default: 'rgba(200,80,60,0.9)',
  };

  // Shared by the whole-farm glance canvas and the House Layout editor's
  // own zoomed-in canvas (see renderHouseLayout below) — keyed by
  // deps.TileType, built lazily since TileType isn't available until init().
  let _farmGlanceTileColors = null;
  function _tileColors() {
    if (_farmGlanceTileColors) return _farmGlanceTileColors;
    const TileType = deps.TileType;
    _farmGlanceTileColors = {
      [TileType.GRASS]: '#3c6e3f', [TileType.WEEDS]: '#4f5c2e', [TileType.TILLED]: '#6b4a30',
      [TileType.TRENCH]: '#25445c', [TileType.RAISED]: '#8a6a3d', [TileType.PADDY]: '#2f6a63',
      [TileType.ROCK]: '#6b6b6f', [TileType.SHRUB]: '#2e4a2c', [TileType.PATH]: '#8f8672',
      [TileType.RIVER]: '#2c6fa8', [TileType.STREAM]: '#3a83bd', [TileType.RAMP]: '#7a7a68', [TileType.WATERFALL]: '#4ea0d6',
    };
    return _farmGlanceTileColors;
  }

  // Read-only top-down status glance — modeled on the map-editor's canvas2d
  // cell-fill approach, but simplified: no camera controls, no editing,
  // just "what does the farm look like right now."
  function renderFarmGridGlance() {
    const canvas = document.getElementById('farmGlanceCanvas');
    if (!canvas) return;
    const FARM_GLANCE_TILE_COLORS = _tileColors();
    canvas.width = deps.COLS * FARM_GLANCE_PX;
    canvas.height = deps.ROWS * FARM_GLANCE_PX;
    const ctx = canvas.getContext('2d');
    const PX = FARM_GLANCE_PX;
    const grid = deps.getGrid();
    for (let r = 0; r < deps.ROWS; r++) {
      for (let c = 0; c < deps.COLS; c++) {
        const tile = grid[r]?.[c];
        ctx.fillStyle = tile ? (FARM_GLANCE_TILE_COLORS[tile.type] || '#3c6e3f') : '#1a1a1a';
        ctx.fillRect(c * PX, r * PX, PX, PX);
        if (tile?.crop) {
          ctx.fillStyle = tile.cropReady ? '#f9e28a' : '#8fd66b';
          ctx.fillRect(c * PX + 2, r * PX + 2, PX - 4, PX - 4);
        }
        if (deps.isHouseFootprint(c, r)) {
          ctx.fillStyle = 'rgba(120,90,60,0.9)';
          ctx.fillRect(c * PX, r * PX, PX, PX);
        }
        // Dew piles are tile data, not a worldObjects entry (see
        // dew-vats.js), so they'd otherwise never show up on this map at
        // all — drawn as a small droplet marker instead of a flat fill so
        // it doesn't get confused with a tile-type color underneath it.
        if (tile?.dewPile) {
          ctx.fillStyle = '#5fc9f5';
          ctx.beginPath();
          ctx.arc(c * PX + PX / 2, r * PX + PX / 2, PX * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Buildings / furniture / crates — everything occupying a farm tile
    // that isn't an animal (animals get their own marker below).
    // Processing furniture gets its actual status color (see
    // farmProcessorStatus, shared with the Processors tile grid below);
    // every other object type gets its own flat color so barns, crates,
    // and placed decorative furniture read as distinct at a glance.
    const _glanceLivestock = deps.processingFurnitureObjects.size ? deps._loadWorldLivestock() : null;
    deps.worldObjects.forEach((obj, key) => {
      if (!obj || obj.type === 'animal') return;
      const [c, r] = key.split(',').map(Number);
      ctx.fillStyle = obj.type === 'processing_furniture' ? FARM_PROCESSOR_STATUS_COLORS[farmProcessorStatus(obj, _glanceLivestock).status]
        : WORLD_OBJECT_TYPE_COLORS[obj.type] || WORLD_OBJECT_TYPE_COLORS.default;
      ctx.fillRect(c * PX, r * PX, PX, PX);
    });
    // Livestock
    deps.animalObjects.forEach(a => {
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.arc(a.col * PX + PX / 2, a.row * PX + PX / 2, PX * 0.35, 0, Math.PI * 2);
      ctx.fill();
    });

    const legend = document.getElementById('farmGridLegend');
    if (legend && !legend.dataset.built) {
      legend.dataset.built = '1';
      legend.innerHTML = [
        ['#3c6e3f', 'Grass'], ['#6b4a30', 'Tilled'], ['#25445c', 'Trench'],
        ['#8fd66b', 'Growing crop'], ['#f9e28a', 'Ready crop'],
        [WORLD_OBJECT_TYPE_COLORS.barn, 'Barn'], [WORLD_OBJECT_TYPE_COLORS.sell_crate, 'Crate/box'],
        [WORLD_OBJECT_TYPE_COLORS.decorative_furniture, 'Furniture'], ['#5fc9f5', 'Dew pile'],
        ['#6b6b6f', 'Rock/obstruction'],
        ['#ffd27a', 'Livestock'],
        [FARM_PROCESSOR_STATUS_COLORS.idle, 'Processor: idle'],
        [FARM_PROCESSOR_STATUS_COLORS.working, 'Processor: working'],
        [FARM_PROCESSOR_STATUS_COLORS.ready, 'Processor: ready'],
        [FARM_PROCESSOR_STATUS_COLORS.livestock, 'Processor: livestock-worked'],
      ].map(([color, label]) => `<span><i style="background:${color}"></i>${deps.esc(label)}</span>`).join('');
    }

    // Click-to-move/place — only active while _farmPlacementMode is armed
    // (see renderFarmBuildings()'s Move/Place buttons). Bound once; reads
    // _farmPlacementMode fresh on every click rather than being rebuilt.
    if (!canvas.dataset.clickBound) {
      canvas.dataset.clickBound = '1';
      canvas.addEventListener('click', (e) => {
        if (!_farmPlacementMode || !deps.hasFarmPermission('alterFarm')) return;
        const rect = canvas.getBoundingClientRect();
        const col = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width) / PX);
        const row = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height) / PX);
        const mode = _farmPlacementMode;
        const result = mode.type === 'move' ? window.FarmBuildings.move(mode.buildingId, col, row)
          : window.FarmBuildings.placePlan(mode.tier, col, row);
        deps.showToast(result.message, result.ok);
        if (result.ok) _farmPlacementMode = null;
        renderFarmPanel();
      });
    }
    canvas.style.cursor = _farmPlacementMode ? 'crosshair' : '';
  }

  // "Buildings" section of the Farm tab: one consolidated "House" row
  // (every piece counts as a single entry here — see openHouseLayoutModal
  // for per-piece move/place/build/demolish) plus every barn with a Move
  // button (owner/alterFarm-gated), plus any owned-but-unplaced barn plans
  // with a Place button. All arm _farmPlacementMode and wait for a click
  // on the glance canvas above (see renderFarmGridGlance()'s click
  // handler).
  function renderFarmBuildings() {
    const list = document.getElementById('farmBuildingsList');
    const note = document.getElementById('farmBuildingsNote');
    const cancelBtn = document.getElementById('farmCancelPlacementBtn');
    if (!list) return;
    const canAlter = deps.hasFarmPermission('alterFarm');
    const BARN_TIERS = deps.getBarnTiers();
    list.innerHTML = '';

    if (note) {
      note.textContent = !canAlter ? "Only the farm's owner (or a granted farmhand) can move or build here."
        : _farmPlacementMode
          ? (_farmPlacementMode.type === 'move' ? 'Click a tile on the map above to move it there.'
            : `Click a tile above to place the ${BARN_TIERS[_farmPlacementMode.tier].label} foundation.`)
          : 'Move a barn, or place an owned barn plan, by clicking the map above. Open House Layout to edit your house.';
    }
    if (cancelBtn) {
      cancelBtn.hidden = !_farmPlacementMode;
      cancelBtn.onclick = () => { _farmPlacementMode = null; renderFarmBuildings(); };
    }

    const addRow = (label, w, h, onMove) => {
      const row = document.createElement('div');
      row.className = 'farm-row';
      row.innerHTML = `<span class="farm-row-name">${deps.esc(label)}</span><span class="farm-note">${w}×${h}</span>`;
      if (canAlter && onMove) {
        const btn = document.createElement('button');
        btn.className = 'settings-small-btn';
        btn.textContent = 'Move';
        btn.addEventListener('click', onMove);
        row.appendChild(btn);
      }
      list.appendChild(row);
    };

    const pieces = deps.getHousePieces();
    if (pieces.length) {
      const built = pieces.filter(p => p.stage === 'built').length;
      const foundations = pieces.length - built;
      const row = document.createElement('div');
      row.className = 'farm-row';
      const status = foundations
        ? `${pieces.length} room${pieces.length === 1 ? '' : 's'} (${foundations} unbuilt)`
        : `${pieces.length} room${pieces.length === 1 ? '' : 's'}`;
      row.innerHTML = `<span class="farm-row-name">🏠 House</span><span class="farm-note">${deps.esc(status)}</span>`;
      const btn = document.createElement('button');
      btn.className = 'settings-small-btn';
      btn.textContent = 'Edit Layout';
      btn.addEventListener('click', () => openHouseLayoutModal());
      row.appendChild(btn);
      list.appendChild(row);
    }

    deps.getFarmBuildings().filter(b => b.kind === 'barn').forEach(b => {
      const tier = BARN_TIERS[b.tier];
      addRow(`🏚 ${tier.label}${b.stage === 'foundation' ? ' (foundation)' : ''}`, b.w, b.h,
        () => { _farmPlacementMode = { type: 'move', buildingId: b.id }; renderFarmBuildings(); });
    });

    if (canAlter) {
      Object.entries(BARN_TIERS).forEach(([tier, def]) => {
        const owned = deps.inventory[def.planItem] || 0;
        if (owned < 1) return;
        const row = document.createElement('div');
        row.className = 'farm-row';
        row.innerHTML = `<span class="farm-row-name">📜 ${deps.esc(def.label)} Plan</span><span class="farm-note">${owned} owned</span>`;
        const btn = document.createElement('button');
        btn.className = 'settings-small-btn';
        btn.textContent = 'Place';
        btn.addEventListener('click', () => { _farmPlacementMode = { type: 'place', tier }; renderFarmBuildings(); });
        row.appendChild(btn);
        list.appendChild(row);
      });
    }
  }

  // ── House Layout editor ─────────────────────────────────────────────
  // A full-screen "hidden tab" opened from the consolidated "House" row's
  // Edit Layout button — not a small popup. Mirrors the reference
  // hobunji_modular_farmhouse_join_demo's own Exterior 3D viewport: a
  // locked (no orbit/rotate) top-down orthographic camera over the live
  // farm scene, and you MOVE a piece by dragging it directly in that
  // viewport instead of arming a mode and clicking a separate flat 2D map.
  // Actions with no natural drag gesture (select/build/demolish/rotate a
  // piece, place a new owned deed) live in the side panel instead.
  let _houseLayoutSelectedId = null;         // piece id whose actions show in the side panel
  let _houseLayoutPlacementMode = null;      // { type: 'placeHouseDeed', pieceKey } — armed by a Deeds Place button, consumed by the next plain (non-drag) tap
  let _houseLayoutDrag = null;               // { entry, moved, grabDX, grabDZ, candidateCol, candidateRow, isWholeHouse } while a pointer is down on a piece
  let _houseLayoutFeatureMode = null;        // 'entrance' | 'chimney' | 'remove' — armed by an Architecture toggle button, consumed by the next plain (non-drag) tap; stays armed across multiple taps (unlike deed placement) so placing several fixtures doesn't need re-arming each time
  const HOUSE_LAYOUT_MARGIN = 2;

  function openHouseLayoutModal() {
    const modal = document.getElementById('houseLayoutModal');
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('houseLayoutClose');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', closeHouseLayoutModal);
    }
    if (!window.__houseLayoutResizeBound) {
      window.__houseLayoutResizeBound = true;
      window.addEventListener('resize', () => {
        if (document.getElementById('houseLayoutModal')?.classList.contains('open')) _renderHouseLayout3d();
      });
    }
    renderHouseLayoutModal();
    if (_houseLayoutRafId === null) _houseLayoutTick();
  }
  function closeHouseLayoutModal() {
    const modal = document.getElementById('houseLayoutModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    _houseLayoutPlacementMode = null;
    _houseLayoutFeatureMode = null;
    _houseLayoutDrag = null;
    _houseLayoutSelectedId = null;
    _hideGhost();
    if (_houseLayoutRafId !== null) { cancelAnimationFrame(_houseLayoutRafId); _houseLayoutRafId = null; }
  }

  // House pieces' own bounding box (every current piece, foundation or
  // built) plus a fixed margin, clamped to the farm's own bounds — defines
  // the 3D camera's framing.
  function _houseLayoutViewBounds() {
    const pieces = deps.getHousePieces();
    if (!pieces.length) return { col: 0, row: 0, w: Math.min(deps.COLS, 10), h: Math.min(deps.ROWS, 10) };
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    pieces.forEach(p => {
      minC = Math.min(minC, p.col); minR = Math.min(minR, p.row);
      maxC = Math.max(maxC, p.col + p.w); maxR = Math.max(maxR, p.row + p.h);
    });
    const col = Math.max(0, minC - HOUSE_LAYOUT_MARGIN);
    const row = Math.max(0, minR - HOUSE_LAYOUT_MARGIN);
    const w = Math.min(deps.COLS, maxC + HOUSE_LAYOUT_MARGIN) - col;
    const h = Math.min(deps.ROWS, maxR + HOUSE_LAYOUT_MARGIN) - row;
    return { col, row, w, h };
  }

  // Locked-camera top-down orthographic view of the live farm scene, framed
  // on the house's current bounding box — reuses the same scene every other
  // farm/house rendering already lives in (deps.scene), so lighting,
  // terrain, and every other piece/building show up exactly as they do in
  // the real 3D world. Renderer/camera/overlay scene (for the drag-ghost
  // and selection outline — kept out of the real scene so they never affect
  // normal gameplay rendering) are created once and reused across opens.
  let _houseLayout3d = null;
  function _ensureHouseLayout3d() {
    if (_houseLayout3d) return _houseLayout3d;
    const canvas = document.getElementById('houseLayout3dCanvas');
    if (!canvas || !deps.scene || typeof THREE === 'undefined') return null;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.autoClear = false; // manual clear() once per frame, see _renderHouseLayout3d — lets the overlay scene draw over the real one without a second clear
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    camera.up.set(0, 0, -1); // straight down would leave the default (0,1,0) up parallel to the view direction

    const overlayScene = new THREE.Scene();
    const ghostMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xf9e28a, transparent: true, opacity: 0.4, depthTest: false })
    );
    ghostMesh.visible = false;
    overlayScene.add(ghostMesh);
    const selectBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })
    );
    selectBox.visible = false;
    overlayScene.add(selectBox);

    // House pieces render with plain MeshLambertMaterial (see HousePieceGen.js)
    // and no emissive boost — the same "reads as a solid black blob under
    // anything but bright light" issue game.js's own floorMat() comment
    // documents for rock tiles, just never patched for house roofs/walls
    // since nobody used to stare at one from directly overhead for long.
    // Rather than touching that shared material (also used for every barn,
    // NPC house, and the real player house — changing it would restyle the
    // whole game), add a strong flat fill light scoped to just this editor's
    // own snapshot: added to deps.scene immediately before this renderer's
    // own render() call and removed immediately after (see
    // _renderHouseLayout3d), synchronously, so the main render loop never
    // observes it and gameplay lighting/mood is untouched.
    const fillLight = new THREE.AmbientLight(0xffffff, 1.1);

    _houseLayout3d = { renderer, camera, overlayScene, ghostMesh, selectBox, fillLight };
    return _houseLayout3d;
  }
  // Sizes the renderer to the viewport container's actual CSS size and
  // frames the locked top-down camera on the house's bounding box, fit to
  // whichever axis (width/height) is tighter for the container's aspect
  // ratio so the house is never cropped.
  function _resizeAndFrameHouseLayout3d() {
    const ctx3d = _ensureHouseLayout3d();
    if (!ctx3d) return null;
    const canvas = document.getElementById('houseLayout3dCanvas');
    const wrap = canvas?.parentElement;
    if (!wrap) return null;
    const w = Math.max(50, wrap.clientWidth), h = Math.max(50, wrap.clientHeight);
    if (canvas.width !== w || canvas.height !== h) ctx3d.renderer.setSize(w, h, false);
    const bounds = _houseLayoutViewBounds();
    const cx = bounds.col + bounds.w / 2, cz = bounds.row + bounds.h / 2;
    const aspect = w / h;
    let halfH = Math.max(3, bounds.h / 2 + 1), halfW = halfH * aspect;
    if (halfW < bounds.w / 2 + 1) { halfW = Math.max(3, bounds.w / 2 + 1); halfH = halfW / aspect; }
    const { camera } = ctx3d;
    camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
    camera.position.set(cx, 30, cz);
    camera.lookAt(cx, 0, cz);
    camera.updateProjectionMatrix();
    return bounds;
  }
  function _renderHouseLayout3d() {
    const ctx3d = _ensureHouseLayout3d();
    if (!ctx3d) return;
    _resizeAndFrameHouseLayout3d();
    const { renderer, camera, overlayScene, selectBox, fillLight } = ctx3d;
    const selected = deps.getHousePieces().find(p => p.id === _houseLayoutSelectedId);
    if (selected) {
      selectBox.visible = true;
      selectBox.geometry.dispose();
      selectBox.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(selected.w, 1.6, selected.h));
      selectBox.position.set(selected.col + selected.w / 2, 0.8, selected.row + selected.h / 2);
    } else {
      selectBox.visible = false;
    }
    // Also skip fog for this pass: it's tuned for a close-up player-eye-level
    // camera, and this locked top-down one sits ~30 units above everything,
    // putting the whole house at roughly the same (fairly heavy) fog depth.
    // Both changes are undone synchronously right after this render call,
    // before any other code — including the main render loop's own frame —
    // can run, so neither the added light nor the disabled fog ever affects
    // the actual player view.
    const savedFog = deps.scene.fog;
    deps.scene.fog = null;
    deps.scene.add(fillLight);
    renderer.clear();
    renderer.render(deps.scene, camera);
    deps.scene.remove(fillLight);
    deps.scene.fog = savedFog;
    renderer.render(overlayScene, camera);
  }
  let _houseLayoutRafId = null;
  function _houseLayoutTick() {
    _renderHouseLayout3d();
    _houseLayoutRafId = requestAnimationFrame(_houseLayoutTick);
  }

  function _updateGhost(drag) {
    const ctx3d = _ensureHouseLayout3d();
    if (!ctx3d) return;
    let gw = drag.entry.w, gh = drag.entry.h, gCol = drag.candidateCol, gRow = drag.candidateRow;
    if (drag.isWholeHouse) {
      // Dragging any starter-tagged piece previews the WHOLE house cluster's
      // move (matches moveHouse, which relocates every starter piece
      // together), not just the one piece the pointer happens to be over.
      const dCol = drag.candidateCol - drag.entry.col, dRow = drag.candidateRow - drag.entry.row;
      let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
      deps.getHousePieces().filter(p => p.pieceKey === 'starter').forEach(p => {
        minC = Math.min(minC, p.col); minR = Math.min(minR, p.row);
        maxC = Math.max(maxC, p.col + p.w); maxR = Math.max(maxR, p.row + p.h);
      });
      gCol = minC + dCol; gRow = minR + dRow; gw = maxC - minC; gh = maxR - minR;
    }
    const { ghostMesh } = ctx3d;
    ghostMesh.geometry.dispose();
    ghostMesh.geometry = new THREE.BoxGeometry(gw, 0.2, gh);
    ghostMesh.position.set(gCol + gw / 2, 1.7, gRow + gh / 2);
    ghostMesh.visible = true;
    // Tint green/red for whether THIS exact drop would actually succeed —
    // reuses movePiece's own validity check (not a separate, looser
    // approximation) so the ghost's color can never disagree with what
    // releasing the pointer here actually does. Whole-house drags skip the
    // tint (stay gold) since there's no cheap non-mutating moveHouse check.
    if (!drag.isWholeHouse) {
      const valid = deps.canMovePieceTo(drag.entry.id, drag.candidateCol, drag.candidateRow);
      ghostMesh.material.color.set(valid ? 0x8ef98a : 0xf95a5a);
    } else {
      ghostMesh.material.color.set(0xf9e28a);
    }
  }
  function _hideGhost() {
    if (_houseLayout3d) _houseLayout3d.ghostMesh.visible = false;
  }

  // Locked orthographic top-down camera: any (ndcX,ndcY) unprojects to the
  // same world (X,Z) regardless of depth (parallel projection), so this is
  // an exact screen->ground conversion with no raycasting against real
  // geometry needed at all.
  function _screenToWorldXZ(clientX, clientY) {
    const ctx3d = _ensureHouseLayout3d();
    const canvas = document.getElementById('houseLayout3dCanvas');
    if (!ctx3d || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const world = new THREE.Vector3(ndcX, ndcY, 0).unproject(ctx3d.camera);
    return { x: world.x, z: world.z };
  }
  function _housePieceAt(worldX, worldZ) {
    const pieces = deps.getHousePieces();
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (worldX >= p.col && worldX < p.col + p.w && worldZ >= p.row && worldZ < p.row + p.h) return p;
    }
    return null;
  }

  function _bindHouseLayoutPointer() {
    const canvas = document.getElementById('houseLayout3dCanvas');
    if (!canvas || canvas.dataset.pointerBound) return;
    canvas.dataset.pointerBound = '1';
    let ptrId = null, startX = 0, startY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      if (ptrId !== null) return;
      ptrId = e.pointerId; startX = e.clientX; startY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_e) { /* degrade gracefully */ }
      if (_houseLayoutPlacementMode || _houseLayoutFeatureMode || !deps.hasFarmPermission('alterFarm')) return;
      const world = _screenToWorldXZ(e.clientX, e.clientY);
      const piece = world && _housePieceAt(world.x, world.z);
      if (!piece) return;
      _houseLayoutDrag = {
        entry: piece, moved: false,
        grabDX: world.x - piece.col, grabDZ: world.z - piece.row,
        candidateCol: piece.col, candidateRow: piece.row,
        // Only the main starter room (the house's fixed anchor) drags the
        // whole cluster — every other piece, including the starter annex,
        // moves independently (still validated to end up touching the rest
        // of the house, same as any bought piece).
        isWholeHouse: piece.id === 'house_starter',
      };
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== ptrId || !_houseLayoutDrag) return;
      if (!_houseLayoutDrag.moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
      _houseLayoutDrag.moved = true;
      const world = _screenToWorldXZ(e.clientX, e.clientY);
      if (!world) return;
      _houseLayoutDrag.candidateCol = Math.round(world.x - _houseLayoutDrag.grabDX);
      _houseLayoutDrag.candidateRow = Math.round(world.z - _houseLayoutDrag.grabDZ);
      _updateGhost(_houseLayoutDrag);
    });

    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerId !== ptrId) return;
      ptrId = null;
      const drag = _houseLayoutDrag; _houseLayoutDrag = null;
      _hideGhost();
      if (drag && drag.moved) {
        let result;
        if (drag.isWholeHouse) {
          // drag.candidateCol/Row track whichever starter-tagged piece was
          // actually grabbed (main room or annex) — moveHouse always wants
          // the MAIN room's new position, so translate by the same delta
          // _updateGhost already uses for the preview, not the raw grabbed
          // piece's own candidate position.
          const dCol = drag.candidateCol - drag.entry.col, dRow = drag.candidateRow - drag.entry.row;
          const starter = deps.getHousePieces().find(p => p.id === 'house_starter');
          result = starter ? deps.moveHouse(starter.col + dCol, starter.row + dRow) : { ok: false, message: 'House not found.' };
        } else {
          result = deps.movePiece(drag.entry.id, drag.candidateCol, drag.candidateRow);
        }
        deps.showToast(result.message, result.ok);
        renderHouseLayoutModal();
        renderFarmBuildings(); // keep the main list's room-count note in sync
        return;
      }
      // A plain tap (no meaningful drag): commit an armed deed placement or
      // architecture-feature action, or select whatever piece (if any) sits
      // under the tap.
      const world = _screenToWorldXZ(e.clientX, e.clientY);
      if (!world) return;
      if (_houseLayoutPlacementMode?.type === 'placeHouseDeed') {
        if (!deps.hasFarmPermission('alterFarm')) return;
        const result = deps.placeHouseDeed(_houseLayoutPlacementMode.pieceKey, Math.floor(world.x), Math.floor(world.z));
        deps.showToast(result.message, result.ok);
        if (result.ok) _houseLayoutPlacementMode = null;
        renderHouseLayoutModal();
        renderFarmBuildings();
        return;
      }
      if (_houseLayoutFeatureMode) {
        if (!deps.hasFarmPermission('alterFarm')) return;
        const col = Math.floor(world.x), row = Math.floor(world.z);
        const result = _houseLayoutFeatureMode === 'remove'
          ? deps.removeHouseFeatureAt(col, row)
          : deps.placeHouseFeature(col, row, world.x, world.z, _houseLayoutFeatureMode);
        deps.showToast(result.message, result.ok);
        // Stays armed on success too — placing/removing several fixtures in
        // a row shouldn't need re-toggling the mode each time; only a
        // failure or the explicit toggle button clears it.
        renderHouseLayoutModal();
        return;
      }
      const piece = _housePieceAt(world.x, world.z);
      _houseLayoutSelectedId = piece ? piece.id : null;
      renderHouseLayoutModal();
    });

    canvas.addEventListener('pointercancel', (e) => {
      if (e.pointerId !== ptrId) return;
      ptrId = null; _houseLayoutDrag = null; _hideGhost();
    });
  }

  function _renderHouseLayoutHint() {
    const hint = document.getElementById('houseLayoutHint');
    if (!hint) return;
    const HOUSE_PIECE_CATALOG = deps.getHousePieceCatalog();
    const featureHints = {
      entrance: 'Tap an outer wall tile to place an entrance. Tap an existing one to swap it there instead.',
      chimney: 'Tap an outer wall tile to place a chimney — it derives a hearth on the wall behind it.',
      remove: 'Tap an entrance or chimney to remove it and store it for later.',
    };
    hint.textContent = !deps.hasFarmPermission('alterFarm') ? "Only the farm's owner (or a granted farmhand) can edit the house."
      : _houseLayoutPlacementMode ? `Tap where the ${HOUSE_PIECE_CATALOG[_houseLayoutPlacementMode.pieceKey]?.label || 'piece'} should go.`
      : _houseLayoutFeatureMode ? featureHints[_houseLayoutFeatureMode]
      : 'Drag a room to move it. Tap a room to select it and see its options.';
  }

  function _renderHouseLayoutPieceList() {
    const list = document.getElementById('houseLayoutPieceList');
    if (!list) return;
    list.innerHTML = '';
    deps.getHousePieces().forEach(p => {
      const row = document.createElement('div');
      row.className = 'house-layout-piece-row' + (p.id === _houseLayoutSelectedId ? ' selected' : '');
      const nameText = deps.housePieceLabel(p) + (p.stage === 'foundation' ? ' (foundation)' : '');
      row.innerHTML = `<span class="name">🏠 ${deps.esc(nameText)}</span><span class="size">${p.w}×${p.h}</span>`;
      row.addEventListener('click', () => { _houseLayoutSelectedId = p.id; renderHouseLayoutModal(); });
      list.appendChild(row);
    });
  }

  function _renderHouseLayoutSelectedActions() {
    const wrap = document.getElementById('houseLayoutSelectedActions');
    if (!wrap) return;
    wrap.innerHTML = '';
    const entry = deps.getHousePieces().find(p => p.id === _houseLayoutSelectedId);
    if (!entry || !deps.hasFarmPermission('alterFarm')) return;
    const mk = (text, onClick) => {
      const btn = document.createElement('button');
      btn.className = 'settings-small-btn';
      btn.textContent = text;
      btn.addEventListener('click', onClick);
      wrap.appendChild(btn);
    };
    const afterAction = (result) => {
      deps.showToast(result.message, result.ok);
      renderHouseLayoutModal();
      renderFarmBuildings();
    };
    if (entry.stage === 'foundation') {
      mk('Build', () => afterAction(deps.buildHousePiece(entry.id)));
      mk('Demolish', () => { _houseLayoutSelectedId = null; afterAction(deps.demolishHousePiece(entry.id)); });
      return;
    }
    // Roof rotation is separate from footprint rotation (Rotate 90° below):
    // it never touches col/row/w/h, so it can't fail a clear-ground/
    // touching check and works on every built piece — including the main
    // starter room, which footprint rotation (and moving on its own)
    // explicitly refuses. A piece's rotated roof is pinned from then on and
    // won't be pulled back by some OTHER piece moving nearby (see
    // house-pieces.js's _roofAxisDecision) — the main room is pinned to its
    // natural axis from the moment the farm is created, for the same reason.
    mk('Rotate Roof', () => afterAction(deps.rotateHouseRoof(entry.id)));
    if (entry.id === 'house_starter') {
      // The main starter room anchors the whole house — it (and every other
      // piece touching it) can only move together, via a drag starting from
      // any of them. Explain that instead of a dead Move/Rotate-footprint
      // button, so selecting it doesn't look broken/do-nothing.
      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:var(--muted);line-height:1.4;margin-top:4px;';
      note.textContent = 'This room anchors the house — drag it (or any attached room) to move the whole house together.';
      wrap.appendChild(note);
    } else {
      // Every other piece — including the starter annex — can be moved and
      // rotated independently, as long as it stays touching some other
      // piece afterward (movePiece/rotatePiece both enforce that). Only
      // non-starter (bought) pieces can be demolished; the starter annex is
      // part of the free starting house and can't be removed, just
      // repositioned.
      mk('Rotate 90°', () => afterAction(deps.rotateHousePiece(entry.id)));
      if (entry.pieceKey !== 'starter') {
        mk('Demolish', () => { _houseLayoutSelectedId = null; afterAction(deps.demolishHousePiece(entry.id)); });
      }
    }
  }

  function _renderHouseLayoutDeeds() {
    const wrap = document.getElementById('houseLayoutDeeds');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!deps.hasFarmPermission('alterFarm')) return;
    const HOUSE_PIECE_CATALOG = deps.getHousePieceCatalog();
    const owned = Object.entries(HOUSE_PIECE_CATALOG).filter(([, def]) => def.deedItem && (deps.inventory[def.deedItem] || 0) > 0);
    if (!owned.length) return;
    const title = document.createElement('div');
    title.className = 'house-layout-section-title';
    title.textContent = 'Deeds';
    wrap.appendChild(title);
    owned.forEach(([pieceKey, def]) => {
      const count = deps.inventory[def.deedItem] || 0;
      const armed = _houseLayoutPlacementMode?.type === 'placeHouseDeed' && _houseLayoutPlacementMode.pieceKey === pieceKey;
      const row = document.createElement('div');
      row.className = 'farm-row';
      row.innerHTML = `<span class="farm-row-name">📜 ${deps.esc(def.label)}</span><span class="farm-note">${count} owned</span>`;
      const btn = document.createElement('button');
      btn.className = 'settings-small-btn';
      btn.textContent = armed ? 'Cancel' : 'Place';
      btn.addEventListener('click', () => {
        _houseLayoutPlacementMode = armed ? null : { type: 'placeHouseDeed', pieceKey };
        renderHouseLayoutModal();
      });
      row.appendChild(btn);
      wrap.appendChild(row);
    });
  }

  // Entrance/chimney placement toggles + the recovered-fixture inventory —
  // separate from per-piece Rooms/Deeds since a feature belongs to the
  // house as a whole (tap any exposed exterior tile, not a specific
  // selected room) rather than to whichever piece happens to be selected.
  function _renderHouseLayoutArchitecture() {
    const wrap = document.getElementById('houseLayoutArchitecture');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!deps.hasFarmPermission('alterFarm')) return;
    const title = document.createElement('div');
    title.className = 'house-layout-section-title';
    title.textContent = 'Architecture';
    wrap.appendChild(title);
    const toggles = document.createElement('div');
    toggles.className = 'house-layout-actions';
    [['entrance', '🚪 Entrance'], ['chimney', '🧱 Chimney'], ['remove', '🗑 Remove']].forEach(([mode, label]) => {
      const btn = document.createElement('button');
      btn.className = 'settings-small-btn';
      const armed = _houseLayoutFeatureMode === mode;
      btn.textContent = armed ? 'Cancel' : label;
      btn.addEventListener('click', () => {
        _houseLayoutFeatureMode = armed ? null : mode;
        renderHouseLayoutModal();
      });
      toggles.appendChild(btn);
    });
    wrap.appendChild(toggles);
    const fixtures = deps.getHouseFixtureInventory();
    if (fixtures.length) {
      const entranceCount = fixtures.filter(f => f.type === 'entrance').length;
      const chimneyCount = fixtures.filter(f => f.type === 'chimney').length;
      const note = document.createElement('div');
      note.className = 'farm-note';
      note.style.cssText = 'padding:4px 2px;';
      const parts = [];
      if (entranceCount) parts.push(`${entranceCount} entrance${entranceCount === 1 ? '' : 's'}`);
      if (chimneyCount) parts.push(`${chimneyCount} chimney${chimneyCount === 1 ? '' : 's'}`);
      note.textContent = `📦 In storage: ${parts.join(', ')} — placed first the next time you place that type.`;
      wrap.appendChild(note);
    }
  }

  function renderHouseLayoutModal() {
    _bindHouseLayoutPointer();
    _renderHouseLayoutHint();
    _renderHouseLayoutPieceList();
    _renderHouseLayoutSelectedActions();
    _renderHouseLayoutArchitecture();
    _renderHouseLayoutDeeds();
  }

  // Builds one pickable livestock/stable row. `ref` identifies it for
  // breeding-pair selection. `onRename`/`onSell` are omitted (null) for
  // stable entries — untradeable, and renamed from the Stable tab instead;
  // this is a breeding-only view of the stable.
  function _buildStablePickRow(entry, ref, pairs, canManage, onRename, onSell) {
    const hasGenotype = !!(entry.genotype?.fur || entry.genotype?.base);
    const value = hasGenotype ? window.CreatureGenetics.sellValueFor(entry.genotype, entry.kind) : null;
    const pending = pairs.some(p => window.FarmAnimals.refsEqual(p.parentA, ref) || window.FarmAnimals.refsEqual(p.parentB, ref));
    const pickKey = `${ref.source}:${ref.id}`;
    const row = document.createElement('div');
    row.className = 'farm-row livestock-trait-row';
    row.innerHTML =
      (canManage ? `<input type="checkbox" class="farm-pick" ${farmPairPicks.has(pickKey) ? 'checked' : ''} ${pending ? 'disabled' : ''}>` : '') +
      `<span class="farm-row-icon">${STABLE_KIND_ICONS[entry.kind] || '🦆'}</span>` +
      (onRename
        ? `<input class="farm-row-name" value="${deps.esc(entry.name || window.CreatureGenetics.defaultLivestockName(entry.kind))}" ${canManage ? '' : 'disabled'} maxlength="30">`
        : `<span class="farm-row-name" style="padding:2px 4px">${deps.esc(entry.name || window.CreatureGenetics.defaultLivestockName(entry.kind))}</span>`) +
      `<span class="farm-row-value${value ? ' tier-' + deps.esc(value.tier) : ''}">${value ? `${value.amount}g · ${deps.esc(value.tier)}` : 'Companion'}${pending ? ' · breeding…' : ''}</span>` +
      (onSell ? `<button class="settings-small-btn farm-sell-btn">Sell</button>` : '') +
      _livestockTraitsHtml(entry.genotype, entry.kind);
    if (canManage) {
      if (onRename) row.querySelector('.farm-row-name').addEventListener('change', e => onRename(e.target.value));
      row.querySelector('.farm-pick').addEventListener('change', e => {
        if (e.target.checked) {
          farmPairPicks.set(pickKey, ref);
          if (farmPairPicks.size > 2) farmPairPicks.delete(farmPairPicks.keys().next().value);
        } else farmPairPicks.delete(pickKey);
        renderFarmLivestock();
      });
    }
    if (onSell) row.querySelector('.farm-sell-btn').addEventListener('click', onSell);
    return row;
  }

  // ── Farm tab: processing-station status tiles ──────────────────
  // Color-coded by the same job state makeProcessingFurniture already
  // tracks — no separate status system, this just reads getJob()/
  // AGING_METHODS the same way its own getButtons() does, plus whether a
  // squeezing vat has livestock assigned (see assignLivestockToVat).
  const FARM_PROCESSOR_STATUS_COLORS = {
    idle: '#8f8878', working: '#c9a227', ready: '#5fbf6b', livestock: '#4a90d9',
  };
  // Shared by the Processors tile grid and the Layout glance canvas marker
  // — one status computation, read from the same job state
  // makeProcessingFurniture's own getButtons() already uses.
  function farmProcessorStatus(obj, livestock) {
    const def = deps.PROCESSING_FURNITURE_DEFS[obj.furnitureKey];
    if (!def) return { status: 'idle', label: 'Idle' };
    const isAging = deps.AGING_METHODS.has(def.method);
    const job = obj.getJob ? obj.getJob() : null;
    const list = livestock || (def.method === 'squeezing' ? deps._loadWorldLivestock() : null);
    const worker = def.method === 'squeezing' && list ? list.find(l => l.assignedVatId === obj.id && window.DewVats.vatCanAccept(l.kind, l.genotype)) : null;
    if (job?.kind === 'timed') {
      const secondsLeft = Math.max(0, Math.ceil((Number(job.readyAtMs) - Date.now()) / 1000)); // Used to mirror the live authored-process countdown shown at the vat.
      return { status: 'working', label: `Squeezing — ${secondsLeft}s${worker ? ` · ${worker.name}` : ''}`, worker };
    }
    if (isAging && job) {
      const daysLeft = Math.max(0, job.readyDay - deps.calendar.day);
      return daysLeft > 0 ? { status: 'working', label: `Aging — ${daysLeft}d left` } : { status: 'ready', label: 'Ready to collect' };
    }
    if (worker) return { status: 'livestock', label: `Worked by ${worker.name}`, worker };
    return { status: 'idle', label: 'Idle' };
  }
  function renderFarmProcessors() {
    const grid = document.getElementById('farmProcessorsGrid');
    const note = document.getElementById('farmProcessorsNote');
    const summary = document.getElementById('farmProcessorsSummary');
    if (!grid) return;
    const processors = [...deps.processingFurnitureObjects];
    if (note) note.textContent = processors.length ? '' : 'No processing stations placed yet.';
    const livestock = deps._loadWorldLivestock();
    grid.innerHTML = '';
    const counts = { idle: 0, working: 0, ready: 0, livestock: 0 };
    processors.forEach(obj => {
      const def = deps.PROCESSING_FURNITURE_DEFS[obj.furnitureKey];
      if (!def) return;
      const { status, label, worker } = farmProcessorStatus(obj, livestock);
      counts[status] = (counts[status] || 0) + 1;
      const tile = document.createElement('div');
      tile.className = 'farm-processor-tile';
      tile.style.borderLeftColor = FARM_PROCESSOR_STATUS_COLORS[status];
      tile.innerHTML = `
        <div class="fp-top"><span class="fp-icon">${def.icon}</span><span class="fp-name">${def.name}</span></div>
        <div class="fp-status" style="color:${FARM_PROCESSOR_STATUS_COLORS[status]}">${label}</div>
        <div class="fp-loc">at (${obj.col}, ${obj.row})</div>
      `;
      if (status === 'ready' && deps.hasFarmPermission('alterFarm')) {
        const btn = document.createElement('button');
        btn.className = 'settings-small-btn';
        btn.textContent = 'Collect';
        btn.addEventListener('click', () => {
          const result = obj.onAction('obj_process_' + obj.furnitureKey);
          deps.showToast(result.message, result.ok);
          renderFarmProcessors(); renderFarmGridGlance();
        });
        tile.appendChild(btn);
      }
      if (worker && deps.hasFarmPermission('livestock')) {
        const btn = document.createElement('button');
        btn.className = 'settings-small-btn';
        btn.textContent = 'Unassign';
        btn.addEventListener('click', () => {
          const result = window.DewVats.unassignFromVat(worker.id);
          deps.showToast(result.message, result.ok);
          renderFarmProcessors(); renderFarmLivestock();
        });
        tile.appendChild(btn);
      }
      grid.appendChild(tile);
    });
    if (summary) {
      summary.textContent = processors.length
        ? `${counts.working} working · ${counts.ready} ready to collect · ${counts.livestock} livestock-worked · ${counts.idle} idle`
        : '';
    }
  }

  // ── Farm tab: dropped dew piles ─────────────────────────────────
  // A dew pile is tile data, not a worldObjects entry (see dew-vats.js),
  // so it never shows up anywhere else in the menu — this is the only
  // place a player can see where their uumkao'ii dropped one without
  // having to walk the whole farm looking for a small sprite.
  function renderFarmDew() {
    const note = document.getElementById('farmDewNote');
    const list = document.getElementById('farmDewList');
    if (!list || !window.DewVats) return;
    const piles = window.DewVats.listPiles();
    if (note) note.textContent = piles.length ? `${piles.length} dew pile${piles.length === 1 ? '' : 's'} waiting to be dug up:` : 'No dew piles on the ground right now.';
    list.innerHTML = '';
    piles.forEach(p => {
      const def = deps.ITEM_DEFS[deps.dewItemKey(p.colorKey)];
      const row = document.createElement('div');
      row.className = 'farm-row';
      row.innerHTML =
        `<span class="farm-row-icon">${def?.icon || '💧'}</span>` +
        `<span class="farm-row-name" style="padding:2px 4px">${deps.esc(def?.label || (p.colorKey + ' dew'))}</span>` +
        `<span class="farm-note">at (${p.col}, ${p.row})</span>`;
      list.appendChild(row);
    });
  }

  // ── Farm tab: placed interactive furniture ──────────────────────
  // Decorative furniture placed directly on the farm (sittable pieces
  // register a worldObject; anything else — a statue, a crate stack —
  // only ever lived in interiorFurnitureObjects and otherwise never
  // appeared anywhere in the menu at all). Processing furniture already
  // gets its own dedicated section above, so it's left out here to avoid
  // listing every station twice.
  function renderFarmFurniture() {
    const note = document.getElementById('farmFurnitureNote');
    const list = document.getElementById('farmFurnitureList');
    if (!list) return;
    const pieces = deps.interiorFurnitureObjects.filter(o => o.area === 'farm');
    if (note) note.textContent = pieces.length ? '' : 'No furniture placed on the farm yet.';
    list.innerHTML = '';
    pieces.forEach(o => {
      const def = deps.DECORATIVE_FURNITURE_DEFS[o.key];
      if (!def) return;
      const row = document.createElement('div');
      row.className = 'farm-row';
      row.innerHTML =
        `<span class="farm-row-icon">${def.icon}</span>` +
        `<span class="farm-row-name" style="padding:2px 4px">${deps.esc(def.name)}</span>` +
        (def.sit ? `<span class="farm-note">Sittable</span>` : '') +
        `<span class="farm-note">at (${o.col}, ${o.row})</span>`;
      list.appendChild(row);
    });
  }

  // ── Farm tab: "Add Livestock" item picker ───────────────────────
  // Replaces the old "grab whichever LIVESTOCK_ITEM_KINDS key happens to
  // come first and the player owns at least 1 of" auto-pick with an
  // explicit list of every livestock crate/egg/baby actually in the bag,
  // so a player carrying more than one kind chooses which one hatches.
  function renderFarmAddLivestockPicker() {
    const list = document.getElementById('farmAddLivestockPicker');
    if (!list) return;
    const owned = Object.keys(deps.LIVESTOCK_ITEM_KINDS).filter(k => (deps.inventory[k] || 0) > 0);
    list.innerHTML = '';
    if (!owned.length) {
      list.appendChild(Object.assign(document.createElement('div'), { className: 'farm-note', textContent: 'No livestock crates, eggs, or babies in your bag.' }));
      return;
    }
    owned.forEach(key => {
      const def = deps.ITEM_DEFS[key];
      const row = document.createElement('div');
      row.className = 'farm-row';
      row.innerHTML =
        `<span class="farm-row-icon">${def?.icon || '📦'}</span>` +
        `<span class="farm-row-name" style="padding:2px 4px">${deps.esc(def?.label || key)}</span>` +
        `<span class="farm-note">×${deps.inventory[key]}</span>` +
        `<button class="settings-small-btn">Add</button>`;
      row.querySelector('button').addEventListener('click', () => {
        const result = window.FarmAnimals.addFromItem(key);
        deps.showToast(result.message, result.ok);
        if (result.ok) {
          renderFarmLivestock(); renderFarmGridGlance(); deps.buildInventoryGrid(); deps.refreshActionBar();
          renderFarmAddLivestockPicker();
        }
      });
      list.appendChild(row);
    });
  }

  function renderFarmLivestock() {
    const list = document.getElementById('farmLivestockList');
    if (!list) return;
    const livestock = deps._loadWorldLivestock();
    const pairs = deps._loadWorldBreedingPairs();
    const canManage = deps.hasFarmPermission('livestock');
    const BARN_TIERS = deps.getBarnTiers();
    const farmBuildings = deps.getFarmBuildings();
    const stable = deps.getStable();

    const owner = deps.isFarmOwner();
    list.innerHTML = '';
    if (!livestock.length) list.appendChild(Object.assign(document.createElement('div'), { className: 'farm-note', textContent: 'No livestock on the farm yet.' }));
    livestock.forEach(entry => {
      const row = _buildStablePickRow(
        entry, { source: 'world', id: entry.id }, pairs, canManage,
        name => renameLivestock(entry.id, name), () => sellLivestock(entry.id)
      );

      // Ownership-transfer / marketplace row — owner gets move/stable-able/
      // offer-for-sale controls; a visiting farmhand gets Buy (if priced)
      // and Take to Stable (if the owner flagged this one stable-able).
      const extra = document.createElement('div');
      extra.className = 'farm-row-extra';
      if (canManage) {
        const housingSelect = document.createElement('select');
        housingSelect.className = 'settings-select farm-barn-select';
        housingSelect.title = 'Assign to a barn to bring it out onto the farm — unassigned livestock stay in stasis (hidden, cooldown paused).';
        const stasisOpt = document.createElement('option');
        stasisOpt.value = ''; stasisOpt.textContent = '🚫 Stasis (no barn)';
        housingSelect.appendChild(stasisOpt);
        farmBuildings.filter(b => b.kind === 'barn' && b.stage === 'built').forEach(b => {
          const tier = BARN_TIERS[b.tier];
          const occupants = livestock.filter(l => l.barnId === b.id).length;
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = `${tier.label} (${occupants}/${tier.slots})`;
          opt.disabled = occupants >= tier.slots && entry.barnId !== b.id;
          housingSelect.appendChild(opt);
        });
        housingSelect.value = entry.barnId || '';
        housingSelect.addEventListener('change', () => {
          const result = housingSelect.value ? window.FarmAnimals.assignToBarn(entry.id, housingSelect.value) : window.FarmAnimals.unassignFromBarn(entry.id);
          deps.showToast(result.message, result.ok);
          renderFarmLivestock(); renderFarmGridGlance();
        });
        extra.appendChild(housingSelect);
        if (entry.resourceReady) {
          const readyBadge = document.createElement('span');
          readyBadge.className = 'farm-note';
          readyBadge.textContent = '✅ Ready to collect — visit it on the farm';
          extra.appendChild(readyBadge);
        }
        // Squeezing-vat assignment — only meaningful for a housed Small
        // Uumkao'ii with a squeezable resource (see DewVats.vatCanAccept),
        // and only once it's actually housed (same gate as the cooldowns).
        if (entry.barnId && window.DewVats.vatCanAccept(entry.kind, entry.genotype)) {
          const vats = [...deps.processingFurnitureObjects].filter(o => deps.PROCESSING_FURNITURE_DEFS[o.furnitureKey]?.method === 'squeezing');
          const vatSelect = document.createElement('select');
          vatSelect.className = 'settings-select farm-barn-select';
          vatSelect.title = 'Assign this Small Uumkao’ii to a placed squeezing vat — its dew is squeezed into milk/curds automatically each cooldown instead of dropping a pile to dig up.';
          const noneOpt = document.createElement('option');
          noneOpt.value = ''; noneOpt.textContent = '🚫 No vat (drops a pile)';
          vatSelect.appendChild(noneOpt);
          vats.forEach(v => {
            const takenBy = livestock.find(l => l.assignedVatId === v.id && window.DewVats.vatCanAccept(l.kind, l.genotype));
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.label + (takenBy && takenBy.id !== entry.id ? ` (worked by ${takenBy.name})` : '');
            opt.disabled = !!(takenBy && takenBy.id !== entry.id);
            vatSelect.appendChild(opt);
          });
          vatSelect.value = entry.assignedVatId || '';
          vatSelect.addEventListener('change', () => {
            const result = vatSelect.value ? window.DewVats.assignToVat(entry.id, vatSelect.value) : window.DewVats.unassignFromVat(entry.id);
            deps.showToast(result.message, result.ok);
            renderFarmLivestock(); renderFarmProcessors();
          });
          extra.appendChild(vatSelect);
        }
      }
      if (owner) {
        const moveBtn = document.createElement('button');
        moveBtn.className = 'settings-small-btn';
        moveBtn.textContent = '→ My Stable';
        moveBtn.title = 'Move into your personal stable (untradeable, leaves this farm)';
        moveBtn.addEventListener('click', () => moveLivestockToStable(entry.id));
        extra.appendChild(moveBtn);

        const stableableLabel = document.createElement('label');
        stableableLabel.className = 'farm-stableable-toggle';
        stableableLabel.innerHTML = `<input type="checkbox" ${entry.stableable ? 'checked' : ''}> Stable-able`;
        stableableLabel.querySelector('input').addEventListener('change', e => setLivestockStableable(entry.id, e.target.checked));
        extra.appendChild(stableableLabel);

        if (entry.forSale) {
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'settings-small-btn';
          cancelBtn.textContent = `For Sale: ${entry.forSale.price}g (Cancel)`;
          cancelBtn.addEventListener('click', () => setLivestockForSale(entry.id, null));
          extra.appendChild(cancelBtn);
        } else {
          const priceInput = document.createElement('input');
          priceInput.type = 'number'; priceInput.min = '1'; priceInput.placeholder = 'Price';
          priceInput.className = 'farm-price-input';
          const offerBtn = document.createElement('button');
          offerBtn.className = 'settings-small-btn';
          offerBtn.textContent = 'Offer for Sale';
          offerBtn.addEventListener('click', () => {
            const price = Math.max(1, Math.round(Number(priceInput.value) || 0));
            if (!price) { deps.showToast('Enter a price first.', false); return; }
            setLivestockForSale(entry.id, price);
          });
          extra.appendChild(priceInput);
          extra.appendChild(offerBtn);
        }
      } else {
        if (entry.forSale) {
          const buyBtn = document.createElement('button');
          buyBtn.className = 'settings-small-btn';
          buyBtn.textContent = `Buy for ${entry.forSale.price}g`;
          buyBtn.addEventListener('click', () => buyLivestock(entry.id));
          extra.appendChild(buyBtn);
        }
        if (entry.stableable) {
          const takeBtn = document.createElement('button');
          takeBtn.className = 'settings-small-btn';
          takeBtn.textContent = 'Take to My Stable';
          takeBtn.addEventListener('click', () => takeStableableLivestock(entry.id));
          extra.appendChild(takeBtn);
        }
      }
      if (extra.children.length) row.appendChild(extra);
      list.appendChild(row);
    });

    // Your own stable, offered as breeding-pair candidates on this farm —
    // untradeable, so no rename/Sell controls here (see the Stable tab).
    if (canManage && stable.length) {
      const charId = window.FarmAnimals.currentCharacterId();
      const header = document.createElement('div');
      header.className = 'farm-note';
      header.style.marginTop = '4px';
      header.textContent = 'Your stable (breeding only — untradeable):';
      list.appendChild(header);
      stable.forEach(entry => {
        list.appendChild(_buildStablePickRow(
          entry, { source: 'stable', id: entry.id, characterId: charId }, pairs, canManage, null, null
        ));
      });
    }

    const addBtn = document.getElementById('farmAddLivestockBtn');
    if (addBtn) addBtn.disabled = !canManage;
    const pairBtn = document.getElementById('farmPairBtn');
    if (pairBtn) {
      pairBtn.disabled = !canManage || farmPairPicks.size !== 2;
      pairBtn.textContent = farmPairPicks.size === 2 ? 'Set Breeding Pair' : 'Set Breeding Pair (select 2)';
    }
    const note = document.getElementById('farmBreedingPairsNote');
    if (note) note.textContent = pairs.length ? `${pairs.length} pair${pairs.length === 1 ? '' : 's'} currently breeding:` : '';
    renderFarmBreedingPairsList(pairs, livestock);
  }

  // Per-pair breeding detail — which two animals, and how many days until
  // the litter/clutch resolves (see tickBreeding's readyDay). Previously
  // this was just an aggregate "N pairs breeding" count with no way to
  // tell which animals were paired or how much longer to wait.
  function _pairParentLabel(ref, livestock) {
    const entry = window.FarmAnimals.resolveBreedingParent(ref, livestock);
    if (!entry) return '❓ (removed)';
    const icon = STABLE_KIND_ICONS[entry.kind] || '🦆';
    return `${icon} ${deps.esc(entry.name || window.CreatureGenetics.defaultLivestockName(entry.kind))}`;
  }
  function renderFarmBreedingPairsList(pairs, livestock) {
    const list = document.getElementById('farmBreedingPairsList');
    if (!list) return;
    list.innerHTML = '';
    pairs.forEach(pair => {
      const daysLeft = Math.max(0, pair.readyDay - deps.calendar.day);
      const row = document.createElement('div');
      row.className = 'farm-row';
      row.innerHTML =
        `<span class="farm-row-name" style="padding:2px 4px">${_pairParentLabel(pair.parentA, livestock)} × ${_pairParentLabel(pair.parentB, livestock)}</span>` +
        `<span class="farm-note">${daysLeft > 0 ? `${daysLeft}d left` : 'Ready — resolves tonight'}</span>`;
      list.appendChild(row);
    });
  }

  function renameLivestock(id, name) {
    if (!deps.hasFarmPermission('livestock')) return;
    const trimmed = String(name || '').trim().slice(0, 30);
    if (!trimmed) return;
    const livestock = deps._loadWorldLivestock();
    const entry = livestock.find(l => l.id === id);
    if (!entry) return;
    entry.name = trimmed;
    deps._saveWorldLivestock(livestock);
  }

  function sellLivestock(id) {
    if (!deps.hasFarmPermission('livestock')) return;
    const entry = _removeWorldLivestockAndCleanup(id);
    if (!entry) return;
    const value = window.CreatureGenetics.sellValueFor(entry.genotype, entry.kind);
    deps.inventory.gold = (deps.inventory.gold || 0) + value.amount;
    deps.saveMemberWorldData();
    deps.showToast(`Sold ${entry.name || window.CreatureGenetics.defaultLivestockName(entry.kind)} for ${value.amount}g`, true);
    refreshGoldHud();
    renderFarmLivestock(); renderFarmGridGlance();
  }

  function setBreedingPair(refA, refB) {
    if (!deps.hasFarmPermission('livestock') || !refA || !refB || window.FarmAnimals.refsEqual(refA, refB)) return;
    const pairs = deps._loadWorldBreedingPairs();
    pairs.push({ id: 'pair_' + Math.random().toString(36).slice(2, 10), parentA: refA, parentB: refB, startedDay: deps.calendar.day, readyDay: deps.calendar.day + window.FarmAnimals.GESTATION_DAYS });
    deps._saveWorldBreedingPairs(pairs);
    deps.showToast(`Breeding pair set — check back in ${window.FarmAnimals.GESTATION_DAYS} days.`, true);
  }

  // ── Farm livestock <-> personal stable transfers ────────────────────
  // Three ways a farm animal leaves world.livestock and becomes a
  // personal, untradeable stable companion: the owner moves their own
  // animal directly, a visiting farmhand buys one the owner priced for
  // sale, or a visiting farmhand takes one the owner flagged stable-able
  // (free). All three converge on the same removal + stabling shape.
  function _removeWorldLivestockAndCleanup(id) {
    const livestock = deps._loadWorldLivestock();
    const idx = livestock.findIndex(l => l.id === id);
    if (idx < 0) return null;
    const [entry] = livestock.splice(idx, 1);
    deps._saveWorldLivestock(livestock);
    const ref = { source: 'world', id };
    deps._saveWorldBreedingPairs(deps._loadWorldBreedingPairs().filter(p => !window.FarmAnimals.refsEqual(p.parentA, ref) && !window.FarmAnimals.refsEqual(p.parentB, ref)));
    removeLiveAnimalEntity(id);
    return entry;
  }
  function removeLiveAnimalEntity(livestockId) {
    const animal = [...deps.animalObjects].find(a => a.livestockId === livestockId);
    if (animal) {
      deps.worldObjects.delete(animal.col + ',' + animal.row);
      animal.reset && animal.reset();
      deps.animalObjects.delete(animal);
    }
  }
  function refreshGoldHud() {
    if (deps.spGold) deps.spGold.textContent = '💰 ' + deps.inventory.gold + 'g';
  }
  function _stableEntryFromLivestock(entry) {
    return {
      id: 'stable_' + Math.random().toString(36).slice(2, 10), kind: entry.kind, name: entry.name,
      genotype: entry.genotype, aiType: deps.companionAiTypeForKind(entry.kind), level: 0, stabledAt: Date.now(),
    };
  }
  function _addToOwnStable(stabledEntry) {
    deps.getStable().push(stabledEntry);
    deps._autoAssignStableRole(stabledEntry);
    deps.saveStable();
  }

  function moveLivestockToStable(id) {
    if (!deps.isFarmOwner()) return;
    const entry = _removeWorldLivestockAndCleanup(id);
    if (!entry) return;
    _addToOwnStable(_stableEntryFromLivestock(entry));
    deps.showToast(`${entry.name} moved to your stable.`, true);
    renderFarmLivestock(); renderFarmGridGlance();
  }

  function setLivestockStableable(id, val) {
    if (!deps.isFarmOwner()) return;
    const livestock = deps._loadWorldLivestock();
    const entry = livestock.find(l => l.id === id);
    if (!entry) return;
    entry.stableable = !!val;
    deps._saveWorldLivestock(livestock);
    renderFarmLivestock();
  }

  function setLivestockForSale(id, price) {
    if (!deps.isFarmOwner()) return;
    const livestock = deps._loadWorldLivestock();
    const entry = livestock.find(l => l.id === id);
    if (!entry) return;
    entry.forSale = price ? { price } : null;
    deps._saveWorldLivestock(livestock);
    deps.showToast(price ? `${entry.name} offered for sale at ${price}g.` : `${entry.name} no longer for sale.`, true);
    renderFarmLivestock();
  }

  // Credits gold straight into the owner's per-world save data, even
  // though they aren't the one currently playing — everything lives in
  // one shared local save file, so this is the closest local simulation
  // of a real sale completing (see saveMemberWorldData's shape).
  function creditOwnerGold(amount) {
    const worldId = deps._tothalWorldId();
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const world = (meta?.worlds || []).find(w => w.id === worldId);
      if (!world) return;
      const ownerId = world.ownerCharacterId;
      if (!world.members) world.members = {};
      if (!world.members[ownerId]) world.members[ownerId] = deps.defaultWorldMemberState();
      const memberInv = world.members[ownerId].nonGearInventory || (world.members[ownerId].nonGearInventory = {});
      memberInv.gold = (memberInv.gold || 0) + amount;
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    } catch {}
  }

  function buyLivestock(id) {
    const livestock = deps._loadWorldLivestock();
    const target = livestock.find(l => l.id === id);
    if (!target?.forSale) return;
    const price = target.forSale.price;
    if ((deps.inventory.gold || 0) < price) { deps.showToast(`Not enough gold (need ${price}g).`, false); return; }
    const entry = _removeWorldLivestockAndCleanup(id);
    if (!entry) return;
    deps.inventory.gold -= price;
    creditOwnerGold(price);
    _addToOwnStable(_stableEntryFromLivestock(entry));
    deps.saveMemberWorldData();
    deps.showToast(`Bought ${entry.name} for ${price}g!`, true);
    refreshGoldHud();
    renderFarmLivestock(); renderFarmGridGlance();
  }

  // Free transfer of an owner-flagged "stable-able" animal into a
  // farmhand's own stable — gated purely by that per-animal flag rather
  // than the general 'livestock' permission, since the owner already
  // opted this specific animal in.
  function takeStableableLivestock(id) {
    const livestock = deps._loadWorldLivestock();
    const target = livestock.find(l => l.id === id);
    if (!target?.stableable) return;
    const entry = _removeWorldLivestockAndCleanup(id);
    if (!entry) return;
    _addToOwnStable(_stableEntryFromLivestock(entry));
    deps.showToast(`${entry.name} moved to your stable.`, true);
    renderFarmLivestock(); renderFarmGridGlance();
  }

  function renderFarmStoragePane() {
    const locked = document.getElementById('farmStorageLocked');
    const body = document.getElementById('farmStorageBody');
    const canAccess = deps.hasFarmPermission('storage');
    if (locked) locked.hidden = canAccess;
    if (body) body.hidden = !canAccess;
    if (!canAccess) return;

    const store = deps._loadWorldStorage();
    const bagList = document.getElementById('farmStorageBagList');
    if (bagList) {
      const keys = Object.keys(deps.inventory).filter(k => k !== 'gold' && deps.ITEM_DEFS[k] && (deps.inventory[k] || 0) > 0);
      bagList.innerHTML = keys.length ? '' : '<div class="farm-note">Bag is empty.</div>';
      keys.forEach(k => {
        const def = deps.ITEM_DEFS[k];
        const row = document.createElement('div');
        row.className = 'farm-storage-row';
        row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-value">${deps.esc(def.label)} ×${deps.inventory[k]}</span><button class="settings-small-btn">Store</button>`;
        row.querySelector('button').addEventListener('click', () => depositToFarmStorage(k, 1));
        bagList.appendChild(row);
      });
    }
    const boxList = document.getElementById('farmStorageBoxList');
    if (boxList) {
      const keys = Object.keys(store).filter(k => (store[k] || 0) > 0);
      boxList.innerHTML = keys.length ? '' : '<div class="farm-note">Storage is empty.</div>';
      keys.forEach(k => {
        const def = deps.ITEM_DEFS[k] || { icon: '📦', label: k };
        const row = document.createElement('div');
        row.className = 'farm-storage-row';
        row.innerHTML = `<span class="farm-row-icon">${def.icon}</span><span class="farm-row-value">${deps.esc(def.label)} ×${store[k]}</span><button class="settings-small-btn">Take</button>`;
        row.querySelector('button').addEventListener('click', () => withdrawFromFarmStorage(k, 1));
        boxList.appendChild(row);
      });
    }
  }

  function depositToFarmStorage(key, amount) {
    if (!deps.hasFarmPermission('storage')) return;
    const n = Math.min(amount, deps.inventory[key] || 0);
    if (n <= 0) return;
    deps.inventory[key] -= n;
    deps.clampInventoryStack(key);
    const store = deps._loadWorldStorage();
    store[key] = (store[key] || 0) + n;
    deps._saveWorldStorage(store);
    deps.saveMemberWorldData();
    renderFarmStoragePane(); deps.buildInventoryGrid(); deps.refreshActionBar();
  }

  function withdrawFromFarmStorage(key, amount) {
    if (!deps.hasFarmPermission('storage')) return;
    const store = deps._loadWorldStorage();
    const n = Math.min(amount, store[key] || 0);
    if (n <= 0) return;
    store[key] -= n;
    if (store[key] <= 0) delete store[key];
    deps._saveWorldStorage(store);
    deps.inventory[key] = (deps.inventory[key] || 0) + n;
    deps.saveMemberWorldData();
    renderFarmStoragePane(); deps.buildInventoryGrid(); deps.refreshActionBar();
  }

  const FARMHAND_PERM_LABELS = { storage: 'Storage', plant: 'Plant', harvest: 'Harvest', placeFurniture: 'Furniture', alterFarm: 'Till/Dig', livestock: 'Livestock' };

  // Owner-only: manage farmhand grants. Reads hobunjiSaveMeta directly
  // (like _loadWorldLivestock() etc.) since farmhands/characters live
  // there, not on any live in-memory state.
  function renderFarmhandsSection() {
    const section = document.getElementById('farmhandsSection');
    if (!section) return;
    const owner = deps.isFarmOwner();
    section.hidden = !owner;
    if (!owner) return;

    let meta = null;
    try { meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null'); } catch {}
    const world = (meta?.worlds || []).find(w => w.id === deps._tothalWorldId());
    if (!world) return;

    const list = document.getElementById('farmhandsList');
    if (list) {
      const farmhands = world.farmhands || [];
      list.innerHTML = farmhands.length ? '' : '<div class="farm-note">No farmhands yet.</div>';
      farmhands.forEach(fh => {
        const char = (meta.characters || []).find(c => c.id === fh.characterId);
        const wrap = document.createElement('div');
        wrap.className = 'farm-row';
        wrap.style.flexWrap = 'wrap';
        wrap.innerHTML = `<span class="farm-row-value" style="flex:1 0 100%;font-size:12px;color:var(--text)">${deps.esc(char?.nickname || 'Unknown')}</span>`;
        Object.entries(FARMHAND_PERM_LABELS).forEach(([key, label]) => {
          const cell = document.createElement('div');
          cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';
          cell.innerHTML =
            `<label class="settings-toggle" style="width:auto"><input type="checkbox" ${fh.permissions?.[key] ? 'checked' : ''}><span class="toggle-slider"></span></label>` +
            `<span style="font-size:9px;color:var(--muted)">${deps.esc(label)}</span>`;
          cell.querySelector('input').addEventListener('change', e => window.__hobunjiAddFarmhand(fh.characterId, { [key]: e.target.checked }));
          wrap.appendChild(cell);
        });
        const removeBtn = document.createElement('button');
        removeBtn.className = 'settings-small-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => { window.__hobunjiRemoveFarmhand(fh.characterId); renderFarmhandsSection(); });
        wrap.appendChild(removeBtn);
        list.appendChild(wrap);
      });
    }

    const select = document.getElementById('farmAddFarmhandSelect');
    if (select) {
      const existingIds = new Set((world.farmhands || []).map(f => f.characterId));
      const candidates = (meta.characters || []).filter(c => c.id !== world.ownerCharacterId && !existingIds.has(c.id));
      select.innerHTML = candidates.length
        ? candidates.map(c => `<option value="${deps.esc(c.id)}">${deps.esc(c.nickname || 'Unnamed')}</option>`).join('')
        : '<option value="">No other characters</option>';
      select.disabled = !candidates.length;
    }
  }

  const STABLE_KIND_ICONS = { 'dabinggi-hound': '🐕', 'gar-wolf': '🐺', uumkaoii: '🦆', grehlr: '🦨', drenkirra: '🪿' };

  // Which of the stable's 3 equip slots a given stable-entry role occupies,
  // and the icon/label its row button shows — see stableEntryRole.
  const STABLE_ROLE_META = {
    mount: { icon: '🐴', label: 'Mount' },
    companion: { icon: '🐕', label: 'Companion' },
    shoulderPet: { icon: '🐿️', label: 'Shoulder pet' },
  };
  function activeStableIdForRole(role) {
    return role === 'mount' ? deps.getActiveMountId() : role === 'shoulderPet' ? deps.getActiveShoulderPetId() : deps.getActiveCompanionId();
  }
  function setActiveStableIdForRole(role, id) {
    if (role === 'mount') deps.setActiveMountId(id);
    else if (role === 'shoulderPet') deps.setActiveShoulderPetId(id);
    else deps.setActiveCompanionId(id);
  }

  function _safeTraitColor(value) {
    const normalized = String(value || '').trim(); // Used only in trait-chip swatch backgrounds.
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : '#777777';
  }

  // Full trait strip shared by farm livestock, breeding-only stable entries,
  // and the personal Stable tab. This intentionally keeps inheritance data
  // visible on mobile rather than hiding it in hover-only titles.
  function _livestockTraitsHtml(genotype, kind) {
    const traits = window.CreatureGenetics.genotypeTraits(kind, genotype); // Single normalized view of size/color/pattern genes.
    const size = traits.size; // Drives the prominent class/role badge.
    const sizeHtml = `<div class="farm-size-trait size-${deps.esc(size.sizeClass)}"><span class="farm-size-name">${deps.esc(size.label)}</span><span>${deps.esc(size.roleLabel)}</span>${size.isNonDefault ? '<b>Rare size</b>' : ''}</div>`; // Authored scale values stay behind the scenes; players only see the three size classes.
    const colorHtml = traits.colors.map(trait => {
      const color = _safeTraitColor(trait.color); // Validated before use in an inline background.
      return `<div class="farm-trait-chip"><i style="background:${color}"></i><span><strong>${deps.esc(trait.label)}</strong><small>${deps.esc(trait.colorName)}</small></span></div>`;
    }).join(''); // All permanent/base color regions remain individually named.
    const patternHtml = traits.patterns.map(trait => {
      const color = _safeTraitColor(trait.color); // Validated before use in an inline background.
      const copyText = `${trait.copies} cop${trait.copies === 1 ? 'y' : 'ies'} · ${trait.inheritance}`; // Exposes breeding behavior without a tooltip.
      const heading = trait.carrier ? `Carries ${trait.label}` : trait.label; // Distinguishes hidden recessive genes from visible masks.
      return `<div class="farm-trait-chip pattern${trait.carrier ? ' carrier' : ''}"><i style="background:${color}"></i><span><strong>${deps.esc(heading)}</strong><small>${deps.esc(trait.colorName)} · ${deps.esc(copyText)}</small></span></div>`;
    }).join(''); // Shows every expressed pattern and every hidden carrier.
    const plainHtml = genotype?.base && !traits.patterns.length ? '<div class="farm-trait-plain">No visible or carried patterns</div>' : ''; // Makes a plain coat explicit.
    return `<div class="farm-traits">${sizeHtml}<div class="farm-color-traits">${colorHtml}${patternHtml}${plainHtml}</div></div>`;
  }

  // Your personal companion collection — character-scoped, untradeable,
  // never tied to any farm. Rename, set the active occupant of whichever
  // of the 3 equip slots (mount/companion/shoulder pet) its Size makes it
  // eligible for (spawned via syncCompanionFromWhistle/updateCompanions
  // like the starter dabinggi-hound always has been), and see the level
  // stub for later.
  function renderStablePanel() {
    const list = document.getElementById('stableList');
    if (!list) return;
    const stable = deps.getStable();
    list.innerHTML = stable.length ? '' : '<div class="farm-note">Your stable is empty. Add an undeployed creature item from the Inventory tab.</div>';
    stable.forEach(entry => {
      const role = window.CreatureGenetics.stableEntryRole(entry);
      const roleMeta = STABLE_ROLE_META[role];
      const isActive = entry.id === activeStableIdForRole(role);
      const row = document.createElement('div');
      row.className = 'farm-row livestock-trait-row';
      row.innerHTML =
        `<button class="settings-small-btn farm-companion-btn${isActive ? ' active' : ''}" title="${isActive ? `Active ${roleMeta.label.toLowerCase()}` : `Set as ${roleMeta.label.toLowerCase()}`}">${roleMeta.icon}</button>` +
        `<span class="farm-row-icon">${STABLE_KIND_ICONS[entry.kind] || '🐾'}</span>` +
        `<input class="farm-row-name" value="${deps.esc(entry.name || window.CreatureGenetics.defaultLivestockName(entry.kind))}" maxlength="30">` +
        `<span class="farm-row-value">${deps.esc(roleMeta.label)} · Lv. ${entry.level || 0} <span style="opacity:.6">(leveling coming soon)</span></span>` +
        _livestockTraitsHtml(entry.genotype, entry.kind);
      row.querySelector('.farm-companion-btn').addEventListener('click', () => {
        setActiveStableIdForRole(role, isActive ? null : entry.id);
        deps.saveStable();
        renderStablePanel();
      });
      row.querySelector('.farm-row-name').addEventListener('change', e => {
        const trimmed = e.target.value.trim().slice(0, 30);
        if (!trimmed) return;
        entry.name = trimmed;
        deps.saveStable();
      });
      list.appendChild(row);
    });
  }

  window.FarmPanel = {
    init,
    render: renderFarmPanel,
    renderStablePanel,
    renderFarmProcessors,
    activeStableIdForRole,
  };
})();

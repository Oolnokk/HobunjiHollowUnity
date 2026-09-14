(() => {
  'use strict';

  // Wilderness den teleport (Dev Tools + Wildlife panel) and Den-Mother
  // nest hold-to-take egg/baby interaction. Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // sibling js/dev-spawner.js, which does near-identical zone-teleport
  // work — same deps.playerMesh/toolHolder/reticle* scene-add bundle, same
  // getCurrentArea/setCurrentArea + setCurrentBuildingMapId getter/setter
  // pair for the `let`s reassigned all over game.js's area-transition code.
  //
  // Audited every reference before extracting: player/inventory/_zoneLayouts/
  // _buildingScenes/_denNests are all `const`s only ever mutated in place
  // (never reassigned), so they're passed by direct reference. currentArea
  // and _currentBuildingMapId are the only two `let`s this cluster itself
  // reassigns (inside a scene-transition callback) — threaded as the same
  // setCurrentArea/setCurrentBuildingMapId setters dev-spawner.js already
  // uses. s_showInteractionRaycast/activeAction/actionHeldDown are `let`s
  // reassigned elsewhere but only ever read here, so plain getters suffice.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function _addPlayerToScene(toScene) {
    if (!toScene) return;
    toScene.add(deps.playerMesh); toScene.add(deps.playerGroundShadow);
    toScene.add(deps.toolHolder); toScene.add(deps.reticleMesh);
    toScene.add(deps.reticleCircleMesh); toScene.add(deps.reticleRingMesh);
    toScene.add(deps.reticleWavyGroup);
  }

  // Cycles through a zone's dens in a shuffled, non-repeating order (per
  // zone) instead of an independent random pick every press — with only a
  // handful of dens per zone, plain Math.random() made it easy to land on
  // the same 1-2 dens over and over by chance. Reshuffles whenever the den
  // count changes (e.g. after a Tothal Shift), so a full lap always visits
  // every den on the map exactly once before any repeat.
  const _denTeleportCycle = new Map(); // zoneId -> { order: number[], idx: number, length: number }
  function _pickCycledDen(zoneId, dens) {
    let state = _denTeleportCycle.get(zoneId);
    if (!state || state.length !== dens.length) {
      const order = dens.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(window.GameRandom.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      state = { order, idx: 0, length: dens.length };
      _denTeleportCycle.set(zoneId, state);
      window.__farmLog?.(`[wildlife] den teleport cycle rebuilt for ${zoneId}: ${dens.length} dens, order [${order.join(',')}]`, 'wildlife');
    }
    const den = dens[state.order[state.idx]];
    window.__farmLog?.(`[wildlife] den teleport ${zoneId}: picking cycle slot ${state.idx + 1}/${state.order.length} -> den ${den.id}`, 'wildlife');
    state.idx = (state.idx + 1) % state.order.length;
    return den;
  }

  // Dev Tools: warp to a den's mouth on the CURRENT map only — no
  // zone-switching, since the request is specifically "does this map have
  // one" (farm/town/buildings never do; a wilderness zone does once its
  // Tothal Shift has run — see _zoneLayouts' `dens` field).
  function teleportToRandomDen() {
    // Called from inside a den's own cavern (dark, no landmarks, and
    // "no dens on this map" made no sense there since a cavern's own
    // _zoneLayouts entry doesn't exist) — resolve the exterior zone this
    // cavern belongs to (see _denCavernZoneOf) and warp there, landing at a
    // den mouth like the zone-side path below instead of requiring a
    // separate exit step first.
    if (deps._isCavernBuildingArea(deps.getCurrentArea())) {
      const zoneId = window.WildlifeSpawn.denCavernZoneOf(deps.getCurrentArea());
      const dens = zoneId ? deps._zoneLayouts.get(zoneId)?.dens : null;
      if (!zoneId || !dens || !dens.length) {
        deps.showToast("No dens found for this burrow's map.", false);
        return;
      }
      const den = _pickCycledDen(zoneId, dens);
      const anchor = den.mouthAnchor || { x: den.x + (den.w || 1) / 2, y: den.y + (den.h || 1) / 2 };
      deps.startSceneTransition(() => {
        const fromScene = deps._buildingScenes.get(deps.getCurrentArea())?.scene || null;
        if (fromScene) { fromScene.remove(deps.playerMesh); fromScene.remove(deps.playerGroundShadow); }
        deps.setCurrentBuildingMapId(null);
        deps.setCurrentArea(zoneId);
        deps.player.x = (anchor.x + 0.5) * deps.TILE;
        deps.player.y = (anchor.y + 0.5) * deps.TILE;
        deps.player.vx = 0; deps.player.vy = 0;
        deps._snapCameraTarget();
        _addPlayerToScene(deps.buildZoneScene(zoneId, anchor.x, anchor.y)?.scene);
        deps.refreshActionBar();
        deps.showToast(`Teleported to a den (${dens.length} on this map).`, true);
        deps.closeMenu();
      });
      return;
    }
    const dens = deps._zoneLayouts.get(deps.getCurrentArea())?.dens;
    if (!dens || !dens.length) {
      deps.showToast('No dens on this map.', false);
      return;
    }
    const den = _pickCycledDen(deps.getCurrentArea(), dens);
    const anchor = den.mouthAnchor || { x: den.x + (den.w || 1) / 2, y: den.y + (den.h || 1) / 2 };
    deps.player.x = (anchor.x + 0.5) * deps.TILE;
    deps.player.y = (anchor.y + 0.5) * deps.TILE;
    deps.player.vx = 0; deps.player.vy = 0;
    deps._snapCameraTarget();
    window.WildernessChunks?.primeZone(deps.getCurrentArea(), anchor.x, anchor.y);
    deps.showToast(`Teleported to a den (${dens.length} on this map).`, true);
    deps.closeMenu();
  }

  // Warps the player straight to a specific den's mouth on its own zone,
  // from anywhere (farm, town, another zone, or inside any
  // building/cavern) — used by the Wildlife panel's per-den Teleport
  // button. Unlike teleportToRandomDen (which only ever targets "whichever
  // map you're currently on"), this always resolves the exact zone the
  // picked den belongs to and does a full scene swap if that's not where
  // the player already is.
  function warpToDenAnchor(zoneId, den) {
    const anchor = den.mouthAnchor || { x: den.x + (den.w || 1) / 2, y: den.y + (den.h || 1) / 2 };
    const land = () => {
      deps.player.x = (anchor.x + 0.5) * deps.TILE;
      deps.player.y = (anchor.y + 0.5) * deps.TILE;
      deps.player.vx = 0; deps.player.vy = 0;
      deps._snapCameraTarget();
      window.WildernessChunks?.primeZone(zoneId, anchor.x, anchor.y);
    };
    if (deps.getCurrentArea() === zoneId) {
      land();
      deps.showToast(`Teleported to den ${den.id}.`, true);
      deps.closeMenu();
      return;
    }
    deps.startSceneTransition(() => {
      const fromScene = deps.getActiveScene();
      if (fromScene) { fromScene.remove(deps.playerMesh); fromScene.remove(deps.playerGroundShadow); }
      if (deps._isBuildingArea(deps.getCurrentArea())) deps.setCurrentBuildingMapId(null);
      deps.setCurrentArea(zoneId);
      land();
      _addPlayerToScene(deps.buildZoneScene(zoneId, anchor.x, anchor.y)?.scene);
      deps.refreshActionBar();
      deps.showToast(`Teleported to den ${den.id}.`, true);
      deps.closeMenu();
    });
  }

  // ── Den-Mother nests: visible individual eggs/babies ──────────────────
  // `remaining` stays the authoritative persistent clutch count so existing
  // saves, genotype queues, and companion-XP wrappers keep working. The
  // individual world objects below are session-only visual/interaction
  // children whose count mirrors that number.
  const NEST_TAKE_HOLD_S = 5;
  const NEST_CONTENT_ALPHA_THRESHOLD = 16;
  const NEST_CONTENT_MAX_RAY_DISTANCE = 24;
  const NEST_CONTENT_SPACING = 0.22;
  const NEST_EGG_HEIGHT = 0.34;
  const NEST_BABY_BASKET_LIFT = 0.10;
  const NEST_CONTENT_OFFSETS = [
    [0, -0.10], [-0.22, 0.10], [0.22, 0.10], [0, 0.25],
  ];
  const _nestContentStates = new WeakMap(); // Nest -> session-only rendered clutch records used by per-item raycast interaction.
  const _activeNestContentStates = new Set(); // Enumerable companion to the WeakMap, used to clean scene-local visuals on map/chunk changes.
  const _alphaCanvasCache = new WeakMap(); // Canvas -> cached ImageData used by opaque-pixel ray hits without repeated readback.
  let _nestContentSerial = 0; // Used to give every visible egg/baby a stable session id for hold-target tracking and debug output.
  let _nestTakeHudEl = null, _nestTakeLabelEl = null, _nestTakeFillEl = null;
  let _activeNestContentHoldId = null; // Used to reset the hold if the reticle moves from one clutch member to another.
  let _lastFocusedNestContent = null; // Used by mobile-visible diagnostics and the interaction-ray overlay.
  const _nestContentDebug = {
    lastChange: 'Individual nest contents ready.',
    renderedNests: 0,
    renderedContents: 0,
    eggContents: 0,
    babyContents: 0,
    pngEggs: 0,
    emojiEggs: 0,
    alphaAccepts: 0,
    alphaRejects: 0,
    babyBuildAttempts: 0,
    babyBuildFailures: 0,
    lastBabyBuildStage: null,
    lastBabyKind: null,
    lastBabyRecordId: null,
    lastFocusedId: null,
    lastFocusedType: null,
    lastFocusedAlpha: null,
    lastError: null,
  }; // Mobile-friendly summary exposed through DenNestSystem.debugSnapshot().

  function isPlayerNearDenNest(nest) {
    const cx = (nest.col + nest.w / 2) * deps.TILE, cy = (nest.row + nest.h / 2) * deps.TILE;
    return Math.hypot(deps.player.x - cx, deps.player.y - cy) <= deps.TILE * 1.6;
  }

  function _itemSpritePath(def) {
    const raw = def?.spritePath || def?.spriteIcon;
    if (!raw) return null;
    if (/^(?:https?:|data:|blob:|\/)/i.test(raw) || raw.includes('/')) return raw;
    return `assets/objectsprites/${raw}`;
  }

  function _makeEmojiCanvas(icon) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '96px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.fillText(icon || '🥚', canvas.width / 2, canvas.height / 2 + 2);
    return canvas;
  }

  function _loadImageCanvas(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const width = Math.max(1, image.naturalWidth || image.width || 1);
          const height = Math.max(1, image.naturalHeight || image.height || 1);
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, width, height);
          resolve(canvas);
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error(`Failed to load nest item sprite ${src}`));
      image.src = src;
    });
  }

  async function _itemCanvasForNest(nest) {
    const def = deps.ITEM_DEFS?.[nest.itemKey] || {};
    const spritePath = _itemSpritePath(def);
    if (spritePath) {
      try {
        if (Number.isFinite(Number(def.spriteColor)) && window.SpriteRecolor?.getRecoloredCanvas) {
          const recolored = await window.SpriteRecolor.getRecoloredCanvas(
            spritePath, Number(def.spriteColor), def.spriteMode || 'direct');
          if (recolored) return { canvas: recolored, source: 'png' };
        }
        return { canvas: await _loadImageCanvas(spritePath), source: 'png' };
      } catch (error) {
        _nestContentDebug.lastError = String(error?.message || error);
        window.__farmLog?.(`[nest-content] ${nest.itemKey} sprite failed; using emoji fallback: ${_nestContentDebug.lastError}`, 'warn');
      }
    }
    const fallbackIcon = def.icon || deps.itemIconForKey?.(nest.itemKey) || '🥚';
    return { canvas: _makeEmojiCanvas(fallbackIcon), source: 'emoji' };
  }

  function _canvasTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    return texture;
  }

  function _tagAlphaPlane(mesh, canvas, mirrorX = false) {
    if (!mesh?.userData || !canvas) return;
    mesh.userData.nestContentAlphaCanvas = canvas;
    mesh.userData.nestContentAlphaMirrorX = !!mirrorX;
  }

  function _disposeTextureMaterial(material) {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      entry?.map?.dispose?.();
      entry?.dispose?.();
    }
  }

  function _disposeContentRecord(record) {
    if (!record || record.disposed) return;
    record.disposed = true;
    record.root?.parent?.remove?.(record.root);
    if (record.avatarRef?.dispose) {
      try { record.avatarRef.dispose(); } catch (_) {}
    } else {
      record.root?.traverse?.(child => {
        child.geometry?.dispose?.();
        _disposeTextureMaterial(child.material);
      });
    }
    record.root = null;
    record.hitPlanes = [];
  }

  function _disposeNestContentState(state) {
    if (!state) return;
    for (const record of state.records) _disposeContentRecord(record);
    state.records.length = 0;
    _activeNestContentStates.delete(state);
  }

  function _nestContentState(nest, scene, mode, branch = null) {
    let state = _nestContentStates.get(nest);
    if (!state) {
      state = { nest, scene, mode, branch, records: [] };
      _nestContentStates.set(nest, state);
    } else if (state.scene !== scene) {
      for (const record of state.records) _disposeContentRecord(record);
      state.records.length = 0;
      state.scene = scene;
    }
    _activeNestContentStates.add(state); // A previously disposed session state can be revisited on the same nest object.
    state.mode = mode;
    state.branch = branch;
    state.seen = true;
    return state;
  }

  function _nestBasePosition(state) {
    const nest = state.nest;
    if (state.mode === 'branch') {
      const branch = state.branch;
      const fallbackY = branch ? (Number(branch.baseWorldY || 0) + Number(branch.tipWorldY || 0)) / 2 : 0;
      const y = Number.isFinite(Number(nest.worldY)) ? Number(nest.worldY) : fallbackY;
      return { x: nest.x / deps.TILE, y, z: nest.y / deps.TILE };
    }
    const x = nest.col + nest.w / 2, z = nest.row + nest.h / 2;
    return { x, y: deps.activeSurfaceYAtWorld(x, z), z };
  }

  function _contentOffset(index, count) {
    if (count <= NEST_CONTENT_OFFSETS.length) return NEST_CONTENT_OFFSETS[index] || [0, 0];
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const radius = NEST_CONTENT_SPACING * Math.max(1, Math.ceil(count / 4));
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }

  function _layoutNestContent(state) {
    const base = _nestBasePosition(state);
    const count = state.records.length;
    for (let index = 0; index < count; index++) {
      const record = state.records[index];
      if (!record.root) continue;
      const [ox, oz] = _contentOffset(index, count);
      const lift = Number(record.groundLift) || 0.06;
      record.root.position.set(base.x + ox, base.y + lift, base.z + oz);
      if (record.type === 'egg') {
        const playerX = deps.player.x / deps.TILE, playerZ = deps.player.y / deps.TILE;
        record.root.rotation.y = Math.atan2(playerX - record.root.position.x, playerZ - record.root.position.z);
      }
    }
  }

  async function _buildEggContent(state, record) {
    const art = await _itemCanvasForNest(state.nest);
    if (record.disposed || state.scene !== record.scene || !art?.canvas) return;
    const aspect = Math.max(0.2, Math.min(3, art.canvas.width / Math.max(1, art.canvas.height)));
    const width = NEST_EGG_HEIGHT * aspect;
    const geometry = new THREE.PlaneGeometry(width, NEST_EGG_HEIGHT);
    const material = new THREE.MeshBasicMaterial({
      map: _canvasTexture(art.canvas), color: 0xffffff, transparent: true,
      alphaTest: NEST_CONTENT_ALPHA_THRESHOLD / 255, side: THREE.DoubleSide, depthWrite: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `nest_${record.id}_egg`;
    mesh.castShadow = false; mesh.receiveShadow = false;
    _tagAlphaPlane(mesh, art.canvas, false);
    record.root = mesh;
    record.hitPlanes = [mesh];
    record.alphaSource = art.canvas;
    record.artSource = art.source;
    record.groundLift = NEST_EGG_HEIGHT / 2 + 0.035;
    state.scene.add(mesh);
    if (art.source === 'png') _nestContentDebug.pngEggs++;
    else _nestContentDebug.emojiEggs++;
    _layoutNestContent(state);
  }

  function _babyKindForNest(nest) {
    const configuredKind = window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.[nest.itemKey]; // Preferred canonical item -> animal mapping shared with FarmAnimals.
    if (configuredKind) return configuredKind;
    const compactItemKey = String(nest.itemKey || '').toLowerCase().replace(/[^a-z0-9]/g, ''); // Used only as a forward-compatible fallback for newly authored live-birth item keys.
    return Object.keys(window.CreatureGeneticsRender?.SPECIES || {}).find(kind => {
      const compactKind = String(kind).toLowerCase().replace(/[^a-z0-9]/g, '');
      return compactKind.length >= 4 && compactItemKey.includes(compactKind);
    }) || null;
  }

  function _applyBabyGenotypeCanvas(record, canvas) {
    if (!record?.root || !canvas) return false;
    const front = _canvasTexture(canvas);
    const back = _canvasTexture(canvas);
    back.wrapS = THREE.RepeatWrapping; back.repeat.set(-1, 1); back.offset.set(1, 0);
    const hitPlanes = [];
    record.root.traverse(child => {
      if (!child?.material) return;
      const name = String(child.name || '');
      if (name.endsWith('_front_plane')) {
        child.material.map?.dispose?.();
        child.material.map = front;
        child.material.needsUpdate = true;
        _tagAlphaPlane(child, canvas, false);
        hitPlanes.push(child);
      } else if (name.endsWith('_back_plane')) {
        child.material.map?.dispose?.();
        child.material.map = back;
        child.material.needsUpdate = true;
        _tagAlphaPlane(child, canvas, true);
        hitPlanes.push(child);
      }
    });
    record.alphaSource = canvas;
    record.hitPlanes = hitPlanes;
    record.alphaReady = hitPlanes.length > 0;
    if (!record.alphaReady) {
      front.dispose?.(); back.dispose?.();
      _nestContentDebug.lastError = `Baby ${record.id} had no front/back sprite planes to target.`;
      return false;
    }
    return true;
  }

  function _babyBuildFailure(record, stage, error) {
    const message = String(error?.message || error || 'Unknown baby-render failure');
    record.building = false;
    record.retryAt = performance.now() + 750;
    record.buildStage = `failed:${stage}`;
    _nestContentDebug.babyBuildFailures++;
    _nestContentDebug.lastBabyBuildStage = record.buildStage;
    _nestContentDebug.lastBabyKind = record.kind || null;
    _nestContentDebug.lastBabyRecordId = record.id;
    _nestContentDebug.lastError = message;
    window.__farmLog?.(`[nest-content] baby build failed stage=${stage} id=${record.id} kind=${record.kind || 'unknown'}: ${message}`, 'error');
  }

  async function _buildBabyContent(state, record) {
    if (record.disposed || record.root || record.building) return;
    record.building = true;
    record.buildStage = 'resolve';
    _nestContentDebug.babyBuildAttempts++;
    _nestContentDebug.lastBabyBuildStage = record.buildStage;
    _nestContentDebug.lastBabyRecordId = record.id;
    let avatarRef = null;
    try {
      const nest = state.nest;
      const kind = _babyKindForNest(nest);
      record.kind = kind;
      _nestContentDebug.lastBabyKind = kind;
      const renderer = window.CreatureGeneticsRender;
      const avatarApi = window.PNGPlaneAvatar;
      const idleUrl = renderer?.SPECIES?.[kind]?.base?.idle;
      if (!kind || !renderer || !avatarApi?.buildAnimalPlaneAvatarModel || !idleUrl) {
        record.building = false;
        record.retryAt = performance.now() + 500;
        record.buildStage = 'waiting-metadata';
        _nestContentDebug.lastBabyBuildStage = record.buildStage;
        _nestContentDebug.lastError = `Waiting for nursery renderer metadata for ${nest.itemKey} (kind=${kind || 'unresolved'}).`;
        return;
      }

      const babyScale = Number(window.LivestockNursery?.constants?.BABY_SCALE)
        || Number(window.BARN_INCUBATOR_CONFIG?.visuals?.babyScale) || 0.3125;
      const sleepScaleY = Number(window.BARN_INCUBATOR_CONFIG?.visuals?.sleepScaleY) || 0.5;
      const speciesDef = window.CREATURE_DB?.[kind] || {};
      const configuredWidths = window.SCRATCHBONES_CONFIG?.game?.livestock?.animalWidths || {};
      const adultWidth = kind === 'uumkaoii' ? 1.275 : (Number(configuredWidths[kind]) || 1.7);
      const spriteAspect = Number(speciesDef.spriteAspect) || (600 / 1375);
      const sizeScale = window.CreatureGenetics?.creatureSizeScale?.(kind, nest.genotype) || { x: 1, y: 1 };
      const modelWidth = adultWidth * babyScale;
      const modelHeight = adultWidth * spriteAspect * babyScale;

      record.buildStage = 'avatar';
      _nestContentDebug.lastBabyBuildStage = record.buildStage;
      avatarRef = avatarApi.buildAnimalPlaneAvatarModel(THREE, idleUrl, {
        modelWidth, modelHeight, name: `nest_sleep_${record.id}`, creatureId: kind,
        headRig: renderer.headRigForKind?.(kind) || undefined,
      });
      if (!avatarRef?.group || record.disposed || state.scene !== record.scene) {
        record.building = false;
        record.retryAt = performance.now() + 500;
        record.buildStage = 'avatar-unavailable';
        _nestContentDebug.lastBabyBuildStage = record.buildStage;
        try { avatarRef?.dispose?.(); } catch (_) {}
        return;
      }

      record.buildStage = 'place';
      _nestContentDebug.lastBabyBuildStage = record.buildStage;
      window.CreatureGenetics?.applyCreatureBillboardScale?.(avatarRef.group, sizeScale);
      avatarRef.group.scale.y *= sleepScaleY;
      const authoredGroundOffset = window.CreatureGenetics?.creatureGroundOffset?.(kind, nest.genotype);
      const uprightGroundLift = Number.isFinite(authoredGroundOffset)
        ? Math.max(0.03, authoredGroundOffset * babyScale)
        : Math.max(0.03, modelHeight * (Number(sizeScale.y) || 1) / 2);
      record.root = avatarRef.group;
      record.avatarRef = avatarRef;
      record.groundLift = Math.max(0.02, uprightGroundLift * sleepScaleY) + NEST_BABY_BASKET_LIFT;
      record.root.rotation.y = (record.serial % 4) * Math.PI / 2;
      state.scene.add(record.root);
      _layoutNestContent(state);

      record.buildStage = 'compose';
      _nestContentDebug.lastBabyBuildStage = record.buildStage;
      let canvas = null;
      try {
        canvas = await renderer.composeFrame(kind, 'idle', nest.genotype, false);
      } catch (composeError) {
        _nestContentDebug.lastError = String(composeError?.message || composeError);
        window.__farmLog?.(`[nest-content] baby genotype compose failed for ${kind}; using raw idle art: ${_nestContentDebug.lastError}`, 'warn');
      }
      if (!canvas) {
        record.buildStage = 'fallback-art';
        _nestContentDebug.lastBabyBuildStage = record.buildStage;
        canvas = await _loadImageCanvas(idleUrl);
      }
      if (record.disposed || state.scene !== record.scene) return;

      record.buildStage = 'target-planes';
      _nestContentDebug.lastBabyBuildStage = record.buildStage;
      if (!_applyBabyGenotypeCanvas(record, canvas)) throw new Error(_nestContentDebug.lastError || 'Baby sprite planes were not targetable.');
      record.buildStage = 'ready';
      record.building = false;
      record.retryAt = 0;
      _nestContentDebug.lastBabyBuildStage = record.buildStage;
      _nestContentDebug.lastError = null;
    } catch (error) {
      if (record.root && record.avatarRef === avatarRef) {
        record.root.parent?.remove?.(record.root);
        try { avatarRef?.dispose?.(); } catch (_) {}
        record.root = null;
        record.avatarRef = null;
        record.hitPlanes = [];
        record.alphaReady = false;
      }
      _babyBuildFailure(record, record.buildStage || 'unknown', error);
    }
  }

  function _queueBabyBuild(state, record) {
    Promise.resolve(_buildBabyContent(state, record)).catch(error => {
      _babyBuildFailure(record, record.buildStage || 'promise', error);
    });
  }

  function _createContentRecord(state) {
    const serial = ++_nestContentSerial;
    const type = state.nest.liveBirth ? 'baby' : 'egg';
    const record = {
      id: `${state.nest.id || deps.getCurrentArea()}:${type}:${serial}`,
      serial,
      type,
      scene: state.scene,
      root: null,
      hitPlanes: [],
      disposed: false,
      alphaReady: type === 'egg',
      building: false,
      buildStage: type === 'baby' ? 'queued' : 'egg',
      retryAt: 0,
      groundLift: 0.06,
    }; // Session object backing exactly one visible/collectible clutch member.
    state.records.push(record);
    if (type === 'baby') {
      _nestContentDebug.babyContents++;
      _queueBabyBuild(state, record);
    } else {
      _nestContentDebug.eggContents++;
      _buildEggContent(state, record);
    }
    return record;
  }

  function _removeContentRecord(state, record) {
    const index = state.records.indexOf(record);
    if (index >= 0) state.records.splice(index, 1);
    _disposeContentRecord(record);
    _layoutNestContent(state);
  }

  function _syncOneNest(nest, scene, mode, branch = null) {
    if (!nest || !scene) return null;
    const state = _nestContentState(nest, scene, mode, branch);
    const targetCount = Math.max(0, Math.floor(Number(nest.remaining) || 0));
    while (state.records.length > targetCount) _disposeContentRecord(state.records.pop());
    while (state.records.length < targetCount) _createContentRecord(state);
    for (const record of state.records) {
      if (record.type === 'baby' && !record.root && !record.disposed && !record.building
        && performance.now() >= (Number(record.retryAt) || 0)) _queueBabyBuild(state, record);
    }
    _layoutNestContent(state);
    return state;
  }

  function _syncCurrentNestContents() {
    const activeScene = deps.getActiveScene?.() || null;
    for (const state of _activeNestContentStates) state.seen = false;

    const area = deps.getCurrentArea();
    const cavernNest = deps._denNests.get(area);
    if (cavernNest && activeScene) _syncOneNest(cavernNest, activeScene, 'cavern');

    const branches = window.ClimbSystem?.debugBranchesFor?.(area) || [];
    for (const branch of branches) {
      const nest = branch?.nest;
      const nestScene = nest?.mesh?.parent || null;
      if (nest && nestScene) _syncOneNest(nest, nestScene, 'branch', branch);
    }

    for (const state of [..._activeNestContentStates]) {
      if (!state.seen || !state.scene || (state.mode === 'cavern' && state.scene !== activeScene)) _disposeNestContentState(state);
    }

    let renderedNests = 0, renderedContents = 0, eggContents = 0, babyContents = 0, pngEggs = 0, emojiEggs = 0;
    for (const state of _activeNestContentStates) {
      const live = state.records.filter(record => !record.disposed && record.root);
      if (live.length) renderedNests++;
      renderedContents += live.length;
      for (const record of live) {
        if (record.type === 'baby') babyContents++;
        else {
          eggContents++;
          if (record.artSource === 'png') pngEggs++;
          else if (record.artSource === 'emoji') emojiEggs++;
        }
      }
    }
    Object.assign(_nestContentDebug, { renderedNests, renderedContents, eggContents, babyContents, pngEggs, emojiEggs });
  }

  function _alphaDataForCanvas(canvas) {
    if (!canvas || typeof canvas !== 'object') return null;
    const cached = _alphaCanvasCache.get(canvas);
    if (cached && cached.width === canvas.width && cached.height === canvas.height) return cached;
    try {
      const ctx = canvas.getContext?.('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const record = { width: canvas.width, height: canvas.height, data: image.data };
      _alphaCanvasCache.set(canvas, record);
      return record;
    } catch (error) {
      _nestContentDebug.lastError = String(error?.message || error);
      return null;
    }
  }

  function _alphaAtIntersection(hit) {
    const object = hit?.object;
    const canvas = object?.userData?.nestContentAlphaCanvas;
    const uv = hit?.uv;
    if (!canvas || !uv) return null;
    const image = _alphaDataForCanvas(canvas);
    if (!image?.data?.length) return null;
    let u = Math.max(0, Math.min(1, Number(uv.x) || 0));
    const v = Math.max(0, Math.min(1, Number(uv.y) || 0));
    if (object.userData.nestContentAlphaMirrorX) u = 1 - u;
    const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
    const y = Math.min(image.height - 1, Math.max(0, Math.floor((1 - v) * image.height)));
    return image.data[(y * image.width + x) * 4 + 3];
  }

  function _interactionRaycaster() {
    const ray = deps.currentPlayerInteractionRay?.() || deps.getPlayerInteractionRay?.() || deps.getPlayerAimRay?.();
    if (!ray?.origin || !ray?.direction) return null;
    const origin = ray.origin.clone ? ray.origin.clone() : new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z);
    const direction = ray.direction.clone ? ray.direction.clone() : new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z);
    if (direction.lengthSq() <= 0.000001) return null;
    direction.normalize();
    return new THREE.Raycaster(origin, direction, 0, NEST_CONTENT_MAX_RAY_DISTANCE);
  }

  function _nearestOpaqueContent(state) {
    if (!state?.records?.length) return null;
    const raycaster = _interactionRaycaster();
    if (!raycaster) return null;
    let best = null;
    for (const record of state.records) {
      if (!record.root || record.disposed || (record.type === 'baby' && !record.alphaReady)) continue;
      const hitPlanes = (record.hitPlanes || []).filter(plane => plane?.parent && plane.visible !== false);
      if (!hitPlanes.length) continue;
      record.root.updateWorldMatrix?.(true, true);
      let hits = [];
      try {
        hits = raycaster.intersectObjects(hitPlanes, false);
      } catch (error) {
        _nestContentDebug.lastError = `Nest ${record.type} raycast failed (${record.id}): ${String(error?.message || error)}`;
        window.__farmLog?.(`[nest-content] ${_nestContentDebug.lastError}`, 'error');
        continue;
      }
      for (const hit of hits) {
        const alpha = _alphaAtIntersection(hit);
        if (alpha == null) continue;
        if (alpha < NEST_CONTENT_ALPHA_THRESHOLD) {
          _nestContentDebug.alphaRejects++;
          continue;
        }
        _nestContentDebug.alphaAccepts++;
        if (!best || hit.distance < best.hit.distance) best = { record, hit, alpha };
        break;
      }
    }
    if (!best) return null;
    const hostile = window.RangedWeapons?.focusedHostile?.(NEST_CONTENT_MAX_RAY_DISTANCE);
    if (hostile && hostile.distanceWorld <= best.hit.distance + 0.05) return null;
    return best;
  }

  function _focusNestState(state) {
    const opaque = _nearestOpaqueContent(state);
    if (!opaque) return null;
    const { record, hit, alpha } = opaque;
    const candidate = {
      type: 'nest-content', id: record.id, data: state.nest,
      box: new THREE.Box3().setFromObject(record.root),
    };
    const focus = { candidate, point: hit.point, distanceWorld: hit.distance };
    window.DebugHitboxes?.noteInteractionFocus?.(focus);
    _lastFocusedNestContent = { nest: state.nest, state, record, hit };
    _nestContentDebug.lastFocusedId = record.id;
    _nestContentDebug.lastFocusedType = record.type;
    _nestContentDebug.lastFocusedAlpha = alpha;
    return _lastFocusedNestContent;
  }

  function _currentAimedNestContent() {
    _syncCurrentNestContents();
    _lastFocusedNestContent = null;
    _nestContentDebug.lastFocusedId = null;
    _nestContentDebug.lastFocusedType = null;
    _nestContentDebug.lastFocusedAlpha = null;

    const branch = deps.player?.onBranch;
    const branchNest = branch?.nest;
    if (branchNest && branchNest.remaining > 0 && branchNest.areaId === deps.getCurrentArea()
      && Math.hypot(deps.player.x - branchNest.x, deps.player.y - branchNest.y) <= deps.TILE * 1.6) {
      const branchState = _nestContentStates.get(branchNest);
      const focused = _focusNestState(branchState);
      if (focused) return focused;
    }

    const cavernNest = deps._denNests.get(deps.getCurrentArea());
    if (cavernNest && cavernNest.remaining > 0 && isPlayerNearDenNest(cavernNest)) {
      return _focusNestState(_nestContentStates.get(cavernNest));
    }
    return null;
  }

  function aimedCavernNest(nest) {
    if (!nest || nest.remaining <= 0 || !isPlayerNearDenNest(nest)) return null;
    _syncCurrentNestContents();
    return _focusNestState(_nestContentStates.get(nest))?.nest || null;
  }

  function currentAimedNest() {
    return _currentAimedNestContent()?.nest || null;
  }

  function refreshInteractionFocusDebug() {
    if (!deps.getShowInteractionRaycast()) return;
    // Match computeActionButtons priority: an opaque egg/baby pixel owns the
    // shared input before branch climbing is considered. The decorative nest
    // itself is never an interaction target now.
    if (currentAimedNest()) return;
    if (deps._isZoneArea(deps.getCurrentArea()) && !deps.player.climbing) window.ClimbSystem?.getClimbTarget?.();
  }

  function updateNestInteraction(dt) {
    if (!_nestTakeHudEl) {
      _nestTakeHudEl = document.getElementById('nestTakeHud');
      _nestTakeLabelEl = document.getElementById('nestTakeLabel');
      _nestTakeFillEl = document.getElementById('nestTakeFill');
    }
    const focused = _currentAimedNestContent();
    const nest = focused?.nest || null;
    const content = focused?.record || null;
    const contentId = content?.id || null;
    const taking = nest && content && deps.getActiveAction() === 'nest_take' && deps.getActionHeldDown();
    deps.player._nestTakeActive = !!taking;

    if (!taking || (_activeNestContentHoldId && _activeNestContentHoldId !== contentId)) {
      if (deps.getNestHoldT() > 0) deps.setNestHoldT(0);
      if (_nestTakeHudEl?.classList.contains('visible')) _nestTakeHudEl.classList.remove('visible');
      _activeNestContentHoldId = taking ? contentId : null;
      if (!taking) return;
    }
    _activeNestContentHoldId = contentId;

    const nestHoldT = deps.getNestHoldT() + dt;
    deps.setNestHoldT(nestHoldT);
    if (_nestTakeLabelEl) _nestTakeLabelEl.textContent = nest.liveBirth ? 'Taking Baby...' : 'Taking Egg...';
    if (_nestTakeFillEl) _nestTakeFillEl.style.width = Math.min(100, (nestHoldT / NEST_TAKE_HOLD_S) * 100) + '%';
    _nestTakeHudEl?.classList.add('visible');
    if (nestHoldT >= NEST_TAKE_HOLD_S) {
      deps.setNestHoldT(0);
      deps.player._nestTakeActive = false;
      _activeNestContentHoldId = null;
      _nestTakeHudEl?.classList.remove('visible');
      const state = focused.state;
      _removeContentRecord(state, content);
      nest.remaining = Math.max(0, Number(nest.remaining) - 1);
      deps.inventory[nest.itemKey] = Math.min(99, (deps.inventory[nest.itemKey] || 0) + 1);
      window.FarmAnimals.queueItemGenotype(nest.itemKey, nest.genotype);
      deps.clampInventoryStack(nest.itemKey);
      deps.buildInventoryGrid(); deps.refreshItemScroll(); deps.refreshActionBar();
      deps.saveMemberWorldData();
      _nestContentDebug.lastChange = `Took ${content.type} ${content.id}; ${nest.remaining} clutch members remain.`;
      deps.showToast(`${deps.itemIconForKey(nest.itemKey)} Took ${deps.ITEM_DEFS[nest.itemKey]?.label || nest.itemKey}${nest.remaining > 0 ? ` (${nest.remaining} left)` : ''}`, true);
    }
  }

  function debugSnapshot() {
    _syncCurrentNestContents();
    const babyRecords = [];
    for (const state of _activeNestContentStates) {
      for (const record of state.records) {
        if (record.type !== 'baby') continue;
        babyRecords.push({
          id: record.id,
          kind: record.kind || null,
          stage: record.buildStage || null,
          building: !!record.building,
          hasRoot: !!record.root,
          alphaReady: !!record.alphaReady,
          hitPlanes: record.hitPlanes?.length || 0,
          groundLift: Number(record.groundLift) || 0,
          retryInMs: Math.max(0, Math.round((Number(record.retryAt) || 0) - performance.now())),
        });
      }
    }
    return {
      ..._nestContentDebug,
      area: deps?.getCurrentArea?.() || null,
      alphaThreshold: NEST_CONTENT_ALPHA_THRESHOLD,
      holdSeconds: NEST_TAKE_HOLD_S,
      activeHoldContentId: _activeNestContentHoldId,
      focusedContentId: _lastFocusedNestContent?.record?.id || null,
      focusedItemKey: _lastFocusedNestContent?.nest?.itemKey || null,
      babyRecords,
      nurseryBabyScale: Number(window.LivestockNursery?.constants?.BABY_SCALE)
        || Number(window.BARN_INCUBATOR_CONFIG?.visuals?.babyScale) || 0.3125,
      barnSleepScaleY: Number(window.BARN_INCUBATOR_CONFIG?.visuals?.sleepScaleY) || 0.5,
      nestBabyBasketLift: NEST_BABY_BASKET_LIFT,
    };
  }

  // Delegated so it keeps working across every re-render of the Wildlife
  // panel's den list (container.innerHTML replacement would otherwise drop
  // per-button listeners each time).
  function _bindListeners() {
    document.getElementById('devTeleportDenBtn')?.addEventListener('click', teleportToRandomDen);
    document.getElementById('wildlifeDenList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.wildlife-den-teleport-btn');
      if (!btn) return;
      const zoneId = btn.dataset.zone, denId = btn.dataset.den;
      const den = deps._zoneLayouts.get(zoneId)?.dens?.find(d => d.id === denId);
      if (!den) { deps.showToast('That den no longer exists on the current map.', false); return; }
      warpToDenAnchor(zoneId, den);
    });
  }

  window.DenNestSystem = {
    init: (injectedDeps) => { init(injectedDeps); _bindListeners(); },
    teleportToRandomDen, warpToDenAnchor,
    isPlayerNearDenNest, aimedCavernNest, currentAimedNest,
    refreshInteractionFocusDebug, updateNestInteraction, debugSnapshot,
  };
  window.__denNestContentDebug = { snapshot: debugSnapshot };
})();

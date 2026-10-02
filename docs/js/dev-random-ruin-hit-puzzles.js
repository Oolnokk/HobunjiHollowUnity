// Dev Random Test Ruin — V50 hit-driven puzzle runtime, batch 2.
//
// Owns only the puzzle interactions that must be physical rather than ordinary
// Interact prompts: projectile glyphs and temporary carried torches/braziers.
// It loads before the base ruin adapter so its pre-render pass can publish
// mechanism signal proxies before the adapter resolves moving geometry. A
// second, delayed post-render-prep pass runs after the base/prototype adapters
// to own the temporary-torch prompt and suppress their old DEV shortcuts.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  if (!DS) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const CONTROL_RANGE = 1.65;
  const TORCH_BURN_MS = 12000;
  const TORCH_SPRITE = 'assets/toolsprites/harpoon_fishingmace.png';
  const TORCH_PLANE_WIDTH = 0.50 * 1.15; // Fishing-mace baseline weapon scale.
  const TORCH_HEAD_RADIUS = 0.11;
  const SIGNAL_SPEED = 1.8;
  const GLYPH_HITBOX_PAD = 0.045;
  const TORCH_SWING_SECONDS = 0.50;
  const TORCH_ABILITY_ID = 'ruinTorchSwing';

  // Exact Fishing Mace sweep preset from the Attack Animation Editor. Keeping
  // this here means the temporary torch uses the same neutral reach and spin
  // as the mace sprite it visually reuses instead of inventing a dev-only pose.
  const TORCH_SWEEP_POSE = Object.freeze({
    neutral: Object.freeze({ x:0, y:0, z:0.16, pitch:0, yaw:0, bodyYaw:0, roll:0 }),
    windup: Object.freeze({ x:0, y:0, z:0.16, pitch:0, yaw:0, bodyYaw:0, roll:-126.05 }),
    strike: Object.freeze({ x:0, y:0, z:0.16, pitch:0, yaw:0, bodyYaw:0, roll:121.49 }),
  });

  let devDeps = null;
  let actionDeps = null;
  let equipmentDeps = null;
  let combatDeps = null;
  let root = null;
  let generatorApi = null;
  let glyphTargets = [];
  let ignitionTargets = [];
  let torchSources = [];
  let ladders = [];
  let mechanismRoots = new Map();
  let mechanismSignals = new Map();
  let temporaryTorches = [];
  let carriedTorch = null;
  let activeSwing = null;
  let promptOwned = false;
  let controllerInteractDown = false;
  let suppressedBaseInteract = false;
  let lastFrameMs = performance.now();
  let hitSerial = 0;
  let installedInputBindingGuard = false;
  let installedRangedHook = false;
  let installedCombatAbility = false;
  let hiddenWeaponMeshes = new Map();

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  // Capture the same private game dependencies the existing modules already
  // receive. These wrappers are installed parser-time, before game.js calls
  // any init(), and always delegate to whatever wrapper was present before us.
  function wrapInit(api, capture) {
    if (!api || typeof api.init !== 'function') return;
    const previous = api.init;
    if (previous.__devRandomRuinHitPuzzleWrapped) return;
    const wrapped = function (...args) {
      if (args[0]) capture(args[0]);
      return previous.apply(this, args);
    };
    wrapped.__devRandomRuinHitPuzzleWrapped = true;
    api.init = wrapped;
  }
  wrapInit(window.DevSpawner, deps => { devDeps = deps; });
  wrapInit(window.ActionArcUI, deps => { actionDeps = deps; });
  wrapInit(window.EquipmentPanel, deps => { equipmentDeps = deps; });
  wrapInit(window.Combat, deps => { combatDeps = deps; });

  function currentArea() {
    return devDeps?.getCurrentArea?.() || combatDeps?.getCurrentArea?.() || null;
  }
  function currentScene() {
    return devDeps?.getActiveScene?.() || null;
  }
  function currentPlayerWorld() {
    const deps = devDeps || combatDeps;
    if (!deps?.player || !deps?.TILE) return null;
    return { x: deps.player.x / deps.TILE, z: deps.player.y / deps.TILE };
  }
  function currentSupportY() {
    const p = currentPlayerWorld();
    if (!p) return 0;
    const meshY = Number(devDeps?.playerMesh?.position?.y);
    if (Number.isFinite(meshY)) return meshY;
    return DS.sampleSupport(p.x, p.z, { minY:-8, maxY:12, pad:.02 })?.y || 0;
  }
  function boxFor(object) {
    if (!object) return null;
    object.updateWorldMatrix?.(true, true);
    object.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(object);
    return box.isEmpty() ? null : box;
  }
  function centerFor(object) {
    return boxFor(object)?.getCenter(new THREE.Vector3()) || new THREE.Vector3();
  }
  function worldDistanceTo(object) {
    const p = currentPlayerWorld();
    if (!p || !object) return Infinity;
    const c = centerFor(object);
    return Math.hypot(c.x - p.x, c.z - p.z);
  }
  function rootContainsActivatorDescendant(object, type) {
    let found = false;
    for (const child of object.children || []) {
      child.traverse?.(node => {
        if (node !== object && node.userData?.activatorType === type) found = true;
      });
      if (found) break;
    }
    return found;
  }
  function inheritedData(object, key) {
    let current = object;
    while (current && current !== root?.parent) {
      const value = current.userData?.[key];
      if (value != null) return value;
      if (current === root) break;
      current = current.parent;
    }
    return null;
  }
  function apiNow() {
    if (generatorApi?.applyProgress) return generatorApi;
    const frame = document.getElementById('devRandomRuinGeneratorFrame');
    const api = frame?.contentWindow?.DebrisifierV50;
    if (api?.applyProgress) generatorApi = api;
    return generatorApi;
  }

  function activeGeneratedRoot() {
    if (currentArea() !== MAP_ID) return null;
    const scene = currentScene();
    return scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  function makeSignalProxy(mechanismId, mechanismRoot) {
    const proxy = { userData:{ solveProgress:0, __devRuinHitSignal:true, mechanismId } };
    const originalLinkedCube = mechanismRoot.userData?.linkedCubePuzzleRoot || null;
    mechanismRoot.userData.__devRuinHitOriginalLinkedCube = originalLinkedCube;
    mechanismRoot.userData.linkedCubePuzzleRoot = proxy;
    return {
      mechanismId,
      root:mechanismRoot,
      proxy,
      originalLinkedCube,
      progress:0,
      target:0,
      glyphRequired:0,
      glyphTargets:[],
      ignitionTargets:[],
    };
  }

  function signalFor(mechanismId) {
    if (!mechanismId) return null;
    let state = mechanismSignals.get(mechanismId);
    if (state) return state;
    const mechanismRoot = mechanismRoots.get(mechanismId);
    if (!mechanismRoot) return null;
    // Pressure-plate and linked-cube mechanisms already have a legitimate
    // continuous signal source. Batch 2 never steals those mechanisms.
    if (mechanismRoot.userData?.linkedPressurePlateRoot || mechanismRoot.userData?.linkedCubePuzzleRoot) return null;
    state = makeSignalProxy(mechanismId, mechanismRoot);
    mechanismSignals.set(mechanismId, state);
    return state;
  }

  function deepestGlyphNodes() {
    const candidates = [];
    root?.traverse?.(object => {
      if (object.userData?.activatorType !== 'glyphObelisk') return;
      if (rootContainsActivatorDescendant(object, 'glyphObelisk')) return;
      const mechanismId = inheritedData(object, 'linkedMechanismId');
      if (!mechanismId) return;
      candidates.push({ object, mechanismId });
    });
    return candidates;
  }

  function buildForRoot(nextRoot) {
    clearRuntimeObjects(true);
    root = nextRoot;
    generatorApi = null;
    mechanismRoots = new Map();
    mechanismSignals = new Map();
    glyphTargets = [];
    ignitionTargets = [];
    torchSources = [];
    ladders = [];

    root.traverse(object => {
      const data = object.userData || {};
      if (data.mechanismId && data.previewMotion?.type) mechanismRoots.set(data.mechanismId, object);
      if (data.generatedAccessType === 'stoneLadder') ladders.push(object);
      if (data.alwaysLit || data.activatorType === 'alwaysLitTorch') torchSources.push(object);
    });

    for (const entry of deepestGlyphNodes()) {
      const required = Math.max(1, finite(inheritedData(entry.object, 'requiredTriggers'), 1));
      const state = signalFor(entry.mechanismId);
      if (!state) continue;
      const target = {
        id:`glyph-${entry.object.id}`,
        kind:'glyph',
        object:entry.object,
        mechanismId:entry.mechanismId,
        active:false,
        required,
      };
      glyphTargets.push(target);
      state.glyphTargets.push(target);
      state.glyphRequired = Math.max(state.glyphRequired, required);
    }

    root.traverse(object => {
      const type = object.userData?.activatorType;
      if (type !== 'brazier' && type !== 'torch') return;
      const mechanismId = inheritedData(object, 'linkedMechanismId');
      if (!mechanismId) return;
      // Nested helper nodes may copy the same activator type. Keep the outer
      // physical prop, not a child with the same semantic target.
      if (object.parent?.userData?.activatorType === type && inheritedData(object.parent, 'linkedMechanismId') === mechanismId) return;
      const state = signalFor(mechanismId);
      if (!state) return;
      const target = {
        id:`ignite-${object.id}`,
        kind:type,
        object,
        mechanismId,
        lit:false,
      };
      ignitionTargets.push(target);
      state.ignitionTargets.push(target);
    });

    // Source stations contain an always-lit torch child. Collapse duplicates
    // when an outer station and its torch both carry source metadata.
    const uniqueSources = [];
    const seenSourceCenters = [];
    for (const object of torchSources) {
      const c = centerFor(object);
      if (seenSourceCenters.some(other => other.distanceToSquared(c) < .03*.03)) continue;
      seenSourceCenters.push(c);
      uniqueSources.push(object);
    }
    torchSources = uniqueSources;
    lastFrameMs = performance.now();
    window.__farmLog?.(`[random-ruin-hit] glyphs=${glyphTargets.length} ignition=${ignitionTargets.length} torchSources=${torchSources.length}`, 'world');
  }

  function restoreSignalLinks() {
    for (const state of mechanismSignals.values()) {
      if (state.root?.userData?.linkedCubePuzzleRoot === state.proxy) {
        if (state.originalLinkedCube) state.root.userData.linkedCubePuzzleRoot = state.originalLinkedCube;
        else delete state.root.userData.linkedCubePuzzleRoot;
      }
      if (state.root?.userData) delete state.root.userData.__devRuinHitOriginalLinkedCube;
    }
  }

  function disposeTorchVisual(record) {
    if (!record?.group) return;
    record.group.parent?.remove(record.group);
    record.group.traverse?.(child => {
      child.geometry?.dispose?.();
      if (child.material?.map && child.material.map !== record.texture) child.material.map.dispose?.();
      child.material?.dispose?.();
    });
    record.texture?.dispose?.();
  }

  function restoreUnderlyingWeaponVisuals() {
    for (const [mesh, visible] of hiddenWeaponMeshes) if (mesh) mesh.visible = visible;
    hiddenWeaponMeshes = new Map();
  }

  function clearRuntimeObjects(restoreHeld = true) {
    restoreSignalLinks();
    if (carriedTorch && restoreHeld) restoreHeldState(carriedTorch);
    for (const record of temporaryTorches) disposeTorchVisual(record);
    temporaryTorches = [];
    carriedTorch = null;
    activeSwing = null;
    restoreUnderlyingWeaponVisuals();
    glyphTargets = [];
    ignitionTargets = [];
    torchSources = [];
    ladders = [];
    mechanismRoots = new Map();
    mechanismSignals = new Map();
    generatorApi = null;
    root = null;
    suppressedBaseInteract = false;
    controllerInteractDown = false;
    if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
    promptOwned = false;
  }

  function segmentBoxInterval(start, end, rawBox, radius = 0) {
    if (!rawBox) return null;
    const box = rawBox.clone();
    box.expandByScalar(Math.max(0, radius));
    let enter = 0, exit = 1;
    for (const axis of ['x','y','z']) {
      const delta = end[axis] - start[axis];
      const min = box.min[axis], max = box.max[axis];
      if (Math.abs(delta) < 1e-9) {
        if (start[axis] < min || start[axis] > max) return null;
        continue;
      }
      let a = (min - start[axis]) / delta;
      let b = (max - start[axis]) / delta;
      if (a > b) [a,b] = [b,a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
    return exit >= 0 && enter <= 1 ? { enter:clamp(enter,0,1), exit:clamp(exit,0,1) } : null;
  }

  function glyphProjectileHit(start, end, radius) {
    if (!root || currentArea() !== MAP_ID) return null;
    let nearest = null;
    for (const target of glyphTargets) {
      const box = target.hitBox || boxFor(target.object); // hitBox (js/dev-random-ruin-glyph-circuits.js) reaches the visible rune marker on the room-facing side, so a glyph carved inside a pillar is hit before the pillar's own footprint.
      if (!box) continue;
      const interval = segmentBoxInterval(start, end, box, Math.max(GLYPH_HITBOX_PAD, radius));
      if (!interval || (nearest && interval.enter >= nearest.t)) continue;
      nearest = { target, t:interval.enter, box };
    }
    return nearest;
  }

  function activateGlyph(target) {
    if (!target || target.active) return false;
    target.active = true;
    hitSerial++;
    const state = mechanismSignals.get(target.mechanismId);
    const active = state?.glyphTargets.filter(entry => entry.active).length || 0;
    const required = state?.glyphRequired || target.required || 1;
    if (state && active >= required && state.target < 1) { state.target = 1; window.AudioSystem?.playObjectSfxKey?.('puzzleComplete'); }
    const circuit = target.circuitName ? `${target.circuitName} ` : '';
    devDeps?.showToast?.(active >= required ? `${circuit}glyph circuit complete (${active}/${required}) — its mechanism is moving.` : `${circuit}glyph struck (${active}/${required}).`, true);
    window.__farmLog?.(`[random-ruin-hit] projectile glyph ${target.id} ${active}/${required}`, 'world');
    return true;
  }

  function installRangedProjectileHook() {
    if (installedRangedHook || !window.RangedWeapons?.update || !window.NearbyVolumeCollision?.segmentHit) return false;
    const ranged = window.RangedWeapons;
    const cover = window.NearbyVolumeCollision;
    const nativeUpdate = ranged.update;
    const nativeSegmentHit = cover.segmentHit;
    let projectileUpdateDepth = 0;
    ranged.update = function (...args) {
      projectileUpdateDepth++;
      try { return nativeUpdate.apply(this, args); }
      finally { projectileUpdateDepth--; }
    };
    cover.segmentHit = function (start, end, radiusWorld = 0) {
      const ordinary = nativeSegmentHit.call(this, start, end, radiusWorld);
      if (projectileUpdateDepth <= 0 || currentArea() !== MAP_ID || !root) return ordinary;
      const glyph = glyphProjectileHit(start, end, radiusWorld);
      if (!glyph || (ordinary && finite(ordinary.t, Infinity) <= glyph.t)) return ordinary;
      activateGlyph(glyph.target);
      return {
        t:glyph.t,
        distanceWorld:start.distanceTo?.(end) * glyph.t || 0,
        object:glyph.target.object,
        kind:'ruinGlyph',
        key:glyph.target.id,
        point:start.clone?.().lerp ? start.clone().lerp(end, glyph.t) : null,
      };
    };
    installedRangedHook = true;
    return true;
  }

  function updateSignalState(dt) {
    for (const state of mechanismSignals.values()) {
      if (state.glyphTargets.length) {
        const active = state.glyphTargets.filter(target => target.active).length;
        state.target = active >= Math.max(1, state.glyphRequired) ? 1 : 0;
      }
      if (state.ignitionTargets.length && state.ignitionTargets.some(target => target.lit)) state.target = 1;
      const step = SIGNAL_SPEED * dt;
      state.progress += clamp(state.target - state.progress, -step, step);
      if (Math.abs(state.target-state.progress) < .001) state.progress = state.target;
      state.proxy.userData.solveProgress = state.progress;
    }
  }

  function applyActivatorVisuals() {
    const api = apiNow();
    if (!api?.applyProgress) return;
    for (const target of glyphTargets) api.applyProgress(target.object, target.active ? 1 : 0);
    for (const target of ignitionTargets) api.applyProgress(target.object, target.lit ? 1 : 0);
  }

  function updateFlameVisual(record) {
    if (!record) return;
    const lit = !!record.lit;
    if (record.flame) record.flame.visible = lit;
    if (record.light) record.light.intensity = lit ? 2.4 : 0;
  }

  function createTorchVisual() {
    const group = new THREE.Group();
    group.name = 'DevRuinTemporaryTorch';
    const texture = new THREE.TextureLoader().load(TORCH_SPRITE, tex => {
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.NearestFilter;
      const image = tex.image;
      if (!image?.width || !image?.height || !group.userData.plane) return;
      const height = TORCH_PLANE_WIDTH * image.height / image.width;
      const plane = group.userData.plane;
      plane.geometry?.dispose?.();
      plane.geometry = new THREE.PlaneGeometry(TORCH_PLANE_WIDTH, height);
      group.userData.headAnchor.position.y = height * .43;
    });
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.NearestFilter;
    const material = new THREE.MeshBasicMaterial({ map:texture, transparent:true, alphaTest:.08, side:THREE.DoubleSide, depthWrite:false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(TORCH_PLANE_WIDTH, TORCH_PLANE_WIDTH * 1.8), material);
    plane.name = 'DevRuinTorchMacePlane';
    group.add(plane);
    const headAnchor = new THREE.Object3D();
    headAnchor.name = 'DevRuinTorchHead';
    headAnchor.position.set(0, TORCH_PLANE_WIDTH*.78, .015);
    group.add(headAnchor);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), new THREE.MeshBasicMaterial({ color:0xff8c33, transparent:true, opacity:.92, depthWrite:false }));
    flame.position.set(0,0,.01);
    headAnchor.add(flame);
    const light = new THREE.PointLight(0xff8c33, 2.4, 4.2, 2);
    headAnchor.add(light);
    group.userData.plane = plane;
    group.userData.headAnchor = headAnchor;
    return { group, plane, headAnchor, flame, light, texture };
  }

  function getHeldMode() { return actionDeps?.getHeldMode?.() ?? combatDeps?.getHeldMode?.() ?? null; }
  function getActiveTool() { return actionDeps?.getActiveTool?.() ?? equipmentDeps?.getActiveTool?.() ?? combatDeps?.getActiveTool?.() ?? null; }
  function setActiveTool(value) {
    if (typeof actionDeps?.setActiveTool === 'function') return actionDeps.setActiveTool(value);
    if (typeof equipmentDeps?.setActiveTool === 'function') return equipmentDeps.setActiveTool(value);
    return undefined;
  }

  function heldSignature() {
    const mode = getHeldMode();
    const activeTool = getActiveTool();
    const weapon = actionDeps?.equipmentSlots?.weapon ?? equipmentDeps?.equipmentSlots?.weapon ?? combatDeps?.currentWeaponKey?.() ?? null;
    const ranged = actionDeps?.equipmentSlots?.ranged ?? window.RangedWeapons?.equippedRangedKey?.() ?? null;
    return `${mode}|${activeTool}|${weapon}|${ranged}`;
  }

  function forceTorchWeaponMode(record) {
    record.restoreState = {
      heldMode:getHeldMode(),
      activeTool:getActiveTool(),
      lastHeldFarmTool:actionDeps?.getLastHeldFarmTool?.() ?? null,
    };
    actionDeps?.setHeldMode?.('tool');
    actionDeps?.setLastHeldFarmTool?.('weapon');
    setActiveTool('weapon');
    actionDeps?.refreshActionBar?.();
    devDeps?.refreshActionBar?.();
    record.expectedSignature = heldSignature();
    record.ignoreSwitchUntil = performance.now() + 180;
  }

  function restoreHeldState(record) {
    const restore = record?.restoreState;
    if (!restore || !actionDeps) return;
    if (restore.heldMode != null) actionDeps.setHeldMode?.(restore.heldMode);
    if (restore.lastHeldFarmTool != null) actionDeps.setLastHeldFarmTool?.(restore.lastHeldFarmTool);
    if (restore.activeTool != null) setActiveTool(restore.activeTool);
    actionDeps.refreshActionBar?.();
    devDeps?.refreshActionBar?.();
  }

  function hideUnderlyingWeaponVisual() {
    const mesh = equipmentDeps?.toolMeshMap?.weapon || null;
    if (!mesh || mesh === carriedTorch?.group) return;
    if (!hiddenWeaponMeshes.has(mesh)) hiddenWeaponMeshes.set(mesh, mesh.visible);
    mesh.visible = false;
  }

  function resolvedToolHolder() {
    const equipmentHolder = equipmentDeps?.toolHolder;
    if (equipmentHolder) return equipmentHolder;
    const combatHolder = combatDeps?.toolHolder;
    if (typeof combatHolder === 'function') return combatHolder();
    return combatHolder || devDeps?.toolHolder || null;
  }

  function attachTorchToHand(record) {
    const holder = resolvedToolHolder();
    if (!holder || !record?.group) return false;
    record.group.parent?.remove(record.group);
    holder.add(record.group);
    record.group.position.set(0,0,0);
    record.group.rotation.set(0,0,0);
    record.group.scale.setScalar(1);
    record.status = 'held';
    carriedTorch = record;
    hideUnderlyingWeaponVisual();
    updateFlameVisual(record);
    return true;
  }

  function dropTorch(record, reason = 'dropped', options = {}) {
    if (!record || record.status !== 'held') return false;
    const p = currentPlayerWorld();
    const scene = currentScene();
    if (!p || !scene) return false;
    record.group.parent?.remove(record.group);
    scene.add(record.group);
    record.group.position.set(p.x, currentSupportY() + .045, p.z);
    record.group.rotation.set(-Math.PI/2, 0, finite(devDeps?.player?.angle ?? combatDeps?.player?.angle, 0));
    record.group.scale.setScalar(1);
    record.status = 'dropped';
    record.expectedSignature = null;
    if (carriedTorch === record) carriedTorch = null;
    activeSwing = null;
    restoreUnderlyingWeaponVisuals();
    if (options.restoreHeld) restoreHeldState(record);
    devDeps?.refreshActionBar?.();
    if (reason && reason !== 'area-exit') devDeps?.showToast?.(`Torch ${reason}.`, true);
    return true;
  }

  function setTorchLit(record, lit, resetTimer = false) {
    if (!record) return;
    record.lit = !!lit;
    if (record.lit && resetTimer) record.burnUntil = performance.now() + TORCH_BURN_MS;
    if (!record.lit) record.burnUntil = 0;
    updateFlameVisual(record);
  }

  function spawnSourceTorch(sourceObject) {
    if (carriedTorch) return false;
    const visual = createTorchVisual();
    const record = {
      id:`temp-torch-${Date.now().toString(36)}-${temporaryTorches.length}`,
      sourceObject,
      ...visual,
      status:'held',
      lit:true,
      burnUntil:performance.now()+TORCH_BURN_MS,
      restoreState:null,
      expectedSignature:null,
      ignoreSwitchUntil:0,
    };
    temporaryTorches.push(record);
    forceTorchWeaponMode(record);
    attachTorchToHand(record);
    devDeps?.showToast?.('Picked up a lit ruin torch — 12 seconds of burn time.', true);
    return true;
  }

  function pickupDroppedTorch(record) {
    if (!record || record.status !== 'dropped' || carriedTorch) return false;
    forceTorchWeaponMode(record);
    attachTorchToHand(record);
    const left = record.lit ? Math.max(0, (record.burnUntil-performance.now())/1000) : 0;
    devDeps?.showToast?.(record.lit ? `Picked up torch — ${left.toFixed(1)}s burn left.` : 'Picked up an extinguished torch.', true);
    return true;
  }

  function nearestPickupControl() {
    if (carriedTorch || !root) return null;
    const p = currentPlayerWorld();
    if (!p) return null;
    let nearest = null;
    let best = CONTROL_RANGE*CONTROL_RANGE;
    for (const source of torchSources) {
      const c = centerFor(source), d=(c.x-p.x)**2+(c.z-p.z)**2;
      if (d <= best) { best=d; nearest={kind:'torchSource',object:source,label:'Take Lit Torch',onPress:()=>spawnSourceTorch(source)}; }
    }
    for (const record of temporaryTorches) {
      if (record.status !== 'dropped') continue;
      const c = centerFor(record.group), d=(c.x-p.x)**2+(c.z-p.z)**2;
      if (d <= best) { best=d; nearest={kind:'droppedTorch',object:record.group,label:record.lit?'Pick Up Lit Torch':'Pick Up Torch',onPress:()=>pickupDroppedTorch(record)}; }
    }
    return nearest;
  }

  function nearestLadderDistance() {
    let best = Infinity;
    for (const ladder of ladders) best = Math.min(best, worldDistanceTo(ladder));
    return best;
  }
  function nearestHitDrivenDistance() {
    let best = Infinity;
    for (const target of glyphTargets) best = Math.min(best, worldDistanceTo(target.object));
    for (const target of ignitionTargets) best = Math.min(best, worldDistanceTo(target.object));
    return best;
  }

  function updateInteractionSuppression() {
    const blocksHitShortcut = nearestHitDrivenDistance() <= CONTROL_RANGE;
    const blocksLadder = !!carriedTorch && nearestLadderDistance() <= CONTROL_RANGE;
    suppressedBaseInteract = currentArea() === MAP_ID && (blocksHitShortcut || blocksLadder);
  }

  function installInputBindingGuard() {
    if (installedInputBindingGuard || !window.InputBindings?.getCurrentBindings) return false;
    const api = window.InputBindings;
    const nativeGet = api.getCurrentBindings.bind(api);
    api.__devRuinHitPuzzleNativeGetBindings = nativeGet;
    api.getCurrentBindings = function (...args) {
      const current = nativeGet(...args);
      if (!suppressedBaseInteract || !current) return current;
      return {
        ...current,
        desktop:{ ...(current.desktop||{}), interact:'__DevRuinHitDriven__' },
        controller:{ ...(current.controller||{}), interact:'Button999' },
      };
    };
    installedInputBindingGuard = true;
    return true;
  }

  function rawBindings() {
    return window.InputBindings?.__devRuinHitPuzzleNativeGetBindings?.() || window.InputBindings?.getCurrentBindings?.() || null;
  }

  function interactionCode(binding) {
    return String(binding || '').split('+').pop().trim();
  }

  // This listener is registered before prototype-hooks/base-adapter listeners
  // because this script is parser-loaded before them. It blocks only hit-driven
  // props and torch+ladder attempts; ordinary doors/cubes/push blocks continue.
  document.addEventListener('keydown', event => {
    if (currentArea() !== MAP_ID || !root) return;
    const raw = rawBindings()?.desktop?.interact;
    if (!raw || interactionCode(raw) !== event.code) return;
    const pickup = nearestPickupControl();
    if (pickup) {
      event.preventDefault(); event.stopImmediatePropagation(); pickup.onPress?.(); return;
    }
    if (carriedTorch && nearestLadderDistance() <= CONTROL_RANGE) {
      event.preventDefault(); event.stopImmediatePropagation();
      devDeps?.showToast?.('You cannot climb a ladder while carrying the torch.', false);
      return;
    }
    if (nearestHitDrivenDistance() <= CONTROL_RANGE) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);

  function installCombatAbility() {
    if (installedCombatAbility || !window.Combat?.abilities?.register || !window.Combat?.loadout) return false;
    const combat = window.Combat;
    combat.abilities.register(TORCH_ABILITY_ID, {
      label:'Torch Sweep', slotFamily:'tap', category:'combo',
      onTap:() => beginTorchSwing(),
    });
    const loadout = combat.loadout;
    const nativeGetSlot = loadout.getSlot.bind(loadout);
    const nativeGet = loadout.get.bind(loadout);
    loadout.getSlot = function (slotId) {
      if (carriedTorch && currentArea() === MAP_ID) return slotId === 'tap1' ? TORCH_ABILITY_ID : null;
      return nativeGetSlot(slotId);
    };
    loadout.get = function () {
      const value = nativeGet();
      if (!carriedTorch || currentArea() !== MAP_ID) return value;
      return { ...value, tap1:TORCH_ABILITY_ID, tap2:null, hold1:null, hold2:null };
    };
    installedCombatAbility = true;
    return true;
  }

  function beginTorchSwing() {
    if (!carriedTorch || currentArea() !== MAP_ID) return false;
    const now = performance.now();
    if (activeSwing && now < activeSwing.endsAt) return false;
    hideUnderlyingWeaponVisual();
    combatDeps?.triggerWeaponSwingVisual?.(TORCH_SWING_SECONDS, {
      anim:'sweep', dirSign:1,
      windupFrac:.16, strikeFrac:.28,
      power:1, pose:TORCH_SWEEP_POSE, holdS:0,
      coneRangePx:0, coneHalfConeRad:0,
    });
    activeSwing = {
      startedAt:now,
      endsAt:now + TORCH_SWING_SECONDS*1000,
      lastHead:null,
      hitIds:new Set(),
    };
    return true;
  }

  function targetContactBox(target) {
    if (!target?.object) return null;
    const box = boxFor(target.object);
    return box?.clone?.().expandByScalar(TORCH_HEAD_RADIUS) || box;
  }

  function transferFire(target) {
    if (!carriedTorch || !target) return false;
    if (target.kind === 'source') {
      if (!carriedTorch.lit) {
        setTorchLit(carriedTorch, true, true);
        devDeps?.showToast?.('The permanent flame relights the torch.', true);
        return true;
      }
      return false;
    }
    if (carriedTorch.lit && !target.lit) {
      target.lit = true;
      const state = mechanismSignals.get(target.mechanismId);
      if (state && state.target < 1) { state.target = 1; window.AudioSystem?.playObjectSfxKey?.('puzzleComplete'); }
      devDeps?.showToast?.(target.kind === 'brazier' ? 'Brazier lit.' : 'Ruin torch lit.', true);
      window.__farmLog?.(`[random-ruin-hit] lit ${target.kind} ${target.id}`, 'world');
      return true;
    }
    if (!carriedTorch.lit && target.lit) {
      setTorchLit(carriedTorch, true, true);
      devDeps?.showToast?.('The lit brazier relights your torch.', true);
      return true;
    }
    return false;
  }

  function updateTorchSwing(now) {
    if (!activeSwing || !carriedTorch?.headAnchor) return;
    if (now > activeSwing.endsAt) { activeSwing = null; return; }
    carriedTorch.group.updateWorldMatrix?.(true, true);
    const head = carriedTorch.headAnchor.getWorldPosition(new THREE.Vector3());
    const previous = activeSwing.lastHead;
    activeSwing.lastHead = head.clone();
    if (!previous) return;

    const contacts = ignitionTargets.map(target => ({ ...target, contactKind:'ignition' }));
    for (const source of torchSources) contacts.push({ id:`source-${source.id}`, kind:'source', object:source, lit:true, contactKind:'source' });
    let nearest = null;
    for (const target of contacts) {
      if (activeSwing.hitIds.has(target.id)) continue;
      const box = targetContactBox(target);
      const interval = segmentBoxInterval(previous, head, box, 0);
      if (!interval || (nearest && interval.enter >= nearest.t)) continue;
      nearest = { target, t:interval.enter };
    }
    if (!nearest) return;
    activeSwing.hitIds.add(nearest.target.id);
    transferFire(nearest.target);
  }

  function updateTorchTimers(now) {
    for (const record of temporaryTorches) {
      if (record.lit && record.burnUntil > 0 && now >= record.burnUntil) {
        setTorchLit(record, false, false);
        if (record.status === 'held') devDeps?.showToast?.('The ruin torch burns out.', false);
      }
      if (record.status === 'held') hideUnderlyingWeaponVisual();
    }
  }

  function updateCarrySwitchDetection(now) {
    if (!carriedTorch || now < carriedTorch.ignoreSwitchUntil) return;
    const signature = heldSignature();
    if (signature === carriedTorch.expectedSignature) return;
    dropTorch(carriedTorch, 'dropped as you switched what you were holding');
  }

  function pollController(control) {
    const raw = rawBindings()?.controller?.interact;
    const down = !!raw && !!window.ControllerInput?.frame?.()?.isDown?.(raw); // Shared per-frame snapshot: honors the active pad and menu/title suspension instead of polling every pad directly.
    if (down && !controllerInteractDown) control?.onPress?.();
    controllerInteractDown = down;
  }

  function updatePromptAfterBase() {
    if (!root || currentArea() !== MAP_ID) {
      if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
      promptOwned = false;
      controllerInteractDown = false;
      return;
    }
    const pickup = nearestPickupControl();
    if (pickup) {
      window.ActionPromptUI?.showActionPrompt?.({ actionId:'interact', touchIcon:'🔥', verb:pickup.label, onPress:pickup.onPress, statusText:'DEV RUIN · temporary world torch', statusType:'' });
      promptOwned = true;
      pollController(pickup);
      return;
    }
    if (carriedTorch && nearestLadderDistance() <= CONTROL_RANGE) {
      const blocked = { onPress:() => devDeps?.showToast?.('You cannot climb a ladder while carrying the torch.', false) };
      window.ActionPromptUI?.showActionPrompt?.({ actionId:'interact', touchIcon:'🚫', verb:'Cannot Climb With Torch', onPress:blocked.onPress, statusText:'DEV RUIN · torch carry route forbids ladders', statusType:'' });
      promptOwned = true;
      pollController(blocked);
      return;
    }
    const status = document.getElementById('apStatus')?.textContent || '';
    if (status === 'DEV RUIN · glyphObelisk' || status === 'DEV RUIN · brazier' || status === 'DEV RUIN · torch') {
      window.ActionPromptUI?.hideActionPrompt?.();
    }
    promptOwned = false;
    controllerInteractDown = false;
  }

  function updateCarryVisual() {
    if (!carriedTorch) return;
    const holder = resolvedToolHolder();
    if (holder && carriedTorch.group.parent !== holder) holder.add(carriedTorch.group);
    carriedTorch.group.position.set(0,0,0);
    carriedTorch.group.rotation.set(0,0,0);
    carriedTorch.group.scale.setScalar(1);
    updateFlameVisual(carriedTorch);
  }

  function preBaseFrame() {
    const inRuin = currentArea() === MAP_ID;
    if (!inRuin) {
      if (root) clearRuntimeObjects(true);
      return;
    }
    const activeRoot = activeGeneratedRoot();
    if (activeRoot && activeRoot !== root) buildForRoot(activeRoot);
    if (!root) return;
    const now = performance.now();
    const dt = clamp((now-lastFrameMs)/1000, 0, .05);
    lastFrameMs = now;
    updateCarrySwitchDetection(now);
    updateTorchTimers(now);
    updateCarryVisual();
    updateTorchSwing(now);
    updateSignalState(dt);
    updateInteractionSuppression();
  }

  function postBaseFrame() {
    if (!root || currentArea() !== MAP_ID) return;
    applyActivatorVisuals();
    updatePromptAfterBase();
  }

  // Pre-base registration is intentional: the base adapter's own frame client
  // is added later in the next parser-time script. Its collision/reconcile pass
  // therefore sees the signal proxy value and the correct physical door/bridge
  // state on the same frame.
  DS.addBeforeRenderClient(preBaseFrame);

  // Install global seams that are harmless outside the dev ruin. Input binding
  // guard must exist before prototype-hooks starts polling controller Interact.
  installInputBindingGuard();
  installRangedProjectileHook();
  installCombatAbility();

  // Some APIs finish loading after this parser-time module in unusual debug
  // pages. Retry briefly without ever blocking game boot.
  let installAttempts = 0;
  const retryInstall = () => {
    installAttempts++;
    installInputBindingGuard();
    installRangedProjectileHook();
    installCombatAbility();
    if ((!installedInputBindingGuard || !installedRangedHook || !installedCombatAbility) && installAttempts < 120) setTimeout(retryInstall, 25);
  };
  setTimeout(retryInstall, 0);

  // Register the prompt/visual correction after prototype-hooks' own delayed
  // client. Two timers are deliberate: our script loads before it so one timer
  // would otherwise still register first and let its structural prompt win.
  setTimeout(() => setTimeout(() => DS.addBeforeRenderClient(postBaseFrame), 0), 0);

  window.DevRandomRuinHitPuzzles = Object.freeze({
    isCarryingTorch:() => !!carriedTorch,
    dropTorch:() => carriedTorch ? dropTorch(carriedTorch, 'dropped') : false,
    debugActivateGlyph(object = null) {
      const target = glyphTargets.find(entry => object ? entry.object === object : !entry.active) || null; // Used by browser/mobile diagnostics to exercise the authoritative projectile-hit state transition without synthesizing a weapon shot.
      return target ? activateGlyph(target) : false;
    },
    getGlyphCircuits:() => [...mechanismSignals.values()].filter(state => state.glyphTargets.length).map(state => ({
      mechanismId:state.mechanismId,
      mechanismRoot:state.root,
      required:Math.max(1, state.glyphRequired),
      targets:state.glyphTargets, // Live target records: the circuit visuals read .active and may set .hitBox/.circuitName.
    })),
    getRoot:() => root,
    snapshot:() => ({
      active:!!root,
      rootName:root?.name || null,
      glyphs:{ total:glyphTargets.length, active:glyphTargets.filter(target => target.active).length },
      ignitionTargets:ignitionTargets.map(target => ({ id:target.id, kind:target.kind, mechanismId:target.mechanismId, lit:target.lit })),
      torchSources:torchSources.length,
      temporaryTorches:temporaryTorches.map(record => ({ id:record.id, status:record.status, lit:record.lit, burnMs:record.lit?Math.max(0,Math.round(record.burnUntil-performance.now())):0 })),
      carryingTorch:carriedTorch?.id || null,
      activeSwing:!!activeSwing,
      signalStates:[...mechanismSignals.values()].map(state => ({ mechanismId:state.mechanismId, progress:state.progress, target:state.target, glyphRequired:state.glyphRequired, glyphActive:state.glyphTargets.filter(target=>target.active).length, ignitionLit:state.ignitionTargets.some(target=>target.lit) })),
      suppressedBaseInteract,
      hitSerial,
      hooks:{ inputBindingGuard:installedInputBindingGuard, rangedProjectile:installedRangedHook, combatAbility:installedCombatAbility },
    }),
    clear:() => clearRuntimeObjects(true),
  });
})();

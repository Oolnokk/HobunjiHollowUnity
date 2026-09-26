(() => {
  'use strict';
  if (window.WildernessBoat) return;

  const CONFIG_URL = 'config/vehicles/vehicles.json'; // Used to load editor-authored vehicle presets at runtime.
  const DEFAULT_PRESET_ID = 'kenkari_rivership'; // Used when the utility menu summons the currently authored boat.
  const WATER_TYPES = new Set(['river', 'stream', 'waterfall']); // Permanent navigable water shared by wilderness waterways and Hobunji's town river.
  const DEBUG_HISTORY_LIMIT = 32; // Used to keep mobile-visible diagnostics bounded.
  const WALK_SUPPORT_ID = 'wilderness_boat_walkable_deck'; // Used to replace the same moving deck support each frame.

  let deps = null; // Campfire-compatible dependency bag used for area, player, scenes, transition, toast, and save access.
  let configPromise = null; // Shared fetch so editor-authored vehicle JSON is loaded only once per page.
  let presetMap = new Map(); // Used to resolve saved preset ids after config has loaded.
  let preset = null; // Active runtime preset matching state.presetId.
  let state = null; // Persistent {presetId,mapId,x,y,z,ry,speed} in one-world-unit-per-tile scene space.
  let group = null; // Live THREE.Group attached to the active wilderness scene.
  let modelRoot = null; // Centered/scaled cloned GLB content inside group.
  let modelSourcePromise = null; // Cached pristine GLTF scene for the current preset model URL.
  const materialTextureCache = new Map(); // Shared loaded vehicle textures keyed by docs-relative URL.
  let materialTextureStats = { configured:0, matched:0, missing:[] }; // Exposed through mobile-visible boat diagnostics.
  let visualArea = null; // Map id whose scene currently owns group.
  let walkableDeckLocal = null; // Local authored deck AABB derived only from selected walkable triangle ids.
  let steering = false; // True while player input owns boat throttle/turn and the player is pinned at the helm.
  let throttleInput = 0; // -1..1 current forward/reverse request from keyboard/controller/touch.
  let turnInput = 0; // -1..1 current left/right steering request.
  let keyThrottle = 0; // Keyboard contribution, recomputed from held keys.
  let keyTurn = 0; // Keyboard contribution, recomputed from held keys.
  let touchThrottle = 0; // Touch joystick contribution while steering.
  let touchTurn = 0; // Touch joystick contribution while steering.
  let bounceCooldown = 0; // Seconds before another shoreline reverse impulse may fire.
  let returnPending = false; // True when Return to Boat first has to load another wilderness zone.
  let lastPromptNear = false; // Used to avoid stale boat prompt state when the player leaves the helm trigger.
  let utilityProviderInstalled = false; // Guards registration with ActionArcUI's shared Utilities extension point.
  let inputInstalled = false; // Guards global keyboard/touch listeners.
  let lastControllerInteract = false; // Used for rising-edge detection of the rebound controller Interact button while near the helm.
  let lastDebug = null; // Most recent concise diagnostic snapshot shown through window.__hobunjiBoatDebug.
  const debugHistory = []; // Used for mobile-friendly event history without DevTools.
  const heldKeys = new Set(); // Used to resolve simultaneous WASD/arrow steering inputs.

  function debugLog(message, level = 'info', details = null) {
    const line = `[boat] ${message}`; // Shared prefix used by the existing in-game Debug log filters.
    try {
      if (typeof window.__farmLog === 'function') window.__farmLog(line, level, 'world');
      else if (level === 'warn') console.warn(line, details || '');
      else console.log(line, details || '');
    } catch (_) {}
    const entry = { at: Date.now(), message, level, details: details || null }; // Used by debugState() history.
    debugHistory.push(entry);
    while (debugHistory.length > DEBUG_HISTORY_LIMIT) debugHistory.shift();
  }

  function finite(value, fallback = 0) {
    const number = Number(value); // Used to normalize authored JSON and save payload numeric fields.
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function isPermanentWaterTile(tile) {
    return WATER_TYPES.has(String(tile?.type ?? '').toLowerCase());
  }

  function activeGrid() {
    try { return window.GridTileAccessors?.getActiveGrid?.() || null; }
    catch (_) { return null; }
  }

  function activeCols() {
    try { return window.GridTileAccessors?.getActiveCols?.() || activeGrid()?.[0]?.length || 0; }
    catch (_) { return activeGrid()?.[0]?.length || 0; }
  }

  function activeRows() {
    try { return window.GridTileAccessors?.getActiveRows?.() || activeGrid()?.length || 0; }
    catch (_) { return activeGrid()?.length || 0; }
  }

  function playerTilePosition() {
    const player = deps?.getPlayer?.(); // Used to convert the game player's pixel coordinates into one-unit-per-tile scene coordinates.
    const tile = finite(deps?.TILE, 16) || 16;
    return player ? { x: finite(player.x) / tile, z: finite(player.y) / tile } : null;
  }

  function playerWaterTile() {
    const pos = playerTilePosition(); // Used to gate free summon to exactly a permanent navigable water tile under the player.
    const grid = activeGrid();
    if (!pos || !grid) return null;
    const col = Math.floor(pos.x), row = Math.floor(pos.z);
    const tile = grid[row]?.[col];
    return isPermanentWaterTile(tile) ? { col, row, tile, x: pos.x, z: pos.z } : null;
  }

  function supportsArea(area = deps?.getCurrentArea?.()) {
    return area === 'town' || !!(area && deps?.isZoneArea?.(area)); // Hobunji's permanent town river is the one non-wilderness navigation area.
  }

  function canSummonHere() {
    return supportsArea() && !!playerWaterTile();
  }

  async function loadConfig() {
    if (!configPromise) configPromise = fetch(CONFIG_URL, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); // Used as the editor/runtime shared vehicle definition database.
      presetMap = new Map((data.presets || []).map(record => [record.id, record]));
      return data;
    }).catch(error => {
      configPromise = null;
      debugLog(`vehicle config failed: ${error?.message || error}`, 'warn');
      throw error;
    });
    return configPromise;
  }

  async function resolvePreset(id = state?.presetId || DEFAULT_PRESET_ID) {
    await loadConfig();
    preset = presetMap.get(id) || presetMap.get(DEFAULT_PRESET_ID) || null;
    if (!preset) throw new Error(`Unknown boat preset: ${id}`);
    return preset;
  }

  function surfaceYAt(x, z) {
    const sampled = Number(deps?.surfaceYAt?.(x, z)); // Used as the water/terrain baseline already trusted by campfire placement.
    return Number.isFinite(sampled) ? sampled : 0;
  }

  function waterVisualY(x, z, record = preset) {
    return surfaceYAt(x, z) + finite(record?.waterline?.heightAboveWater, 0); // Editor-authored model-origin lift above the sampled water surface.
  }

  function cloneMaterials(root) {
    root?.traverse?.(object => {
      if (!object?.isMesh) return;
      if (Array.isArray(object.material)) object.material = object.material.map(material => material?.clone?.() || material);
      else if (object.material?.clone) object.material = object.material.clone();
    });
    return root;
  }

  function loadMaterialTexture(texturePath) {
    if (!materialTextureCache.has(texturePath)) {
      const texture = new THREE.TextureLoader().load(texturePath, undefined, undefined, error => {
        debugLog(`vehicle texture failed: ${texturePath} (${error?.message || 'unknown error'})`, 'warn');
      });
      texture.flipY = false;
      if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
      materialTextureCache.set(texturePath, texture);
    }
    return materialTextureCache.get(texturePath);
  }

  function applyMaterialTextures(root, record) {
    const mappings = record?.materialTextures || {}; // Uses the same exact GLB material-name mapping consumed by the Vehicle Editor.
    const names = Object.keys(mappings);
    const matched = new Set();
    root?.traverse?.(mesh => {
      if (!mesh?.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(material => {
        const texturePath = mappings[material?.name];
        if (!texturePath) return;
        material.map = loadMaterialTexture(texturePath);
        material.color?.set?.(record?.materialColors?.[material.name] || '#ffffff');
        material.needsUpdate = true;
        matched.add(material.name);
      });
    });
    materialTextureStats = { configured:names.length, matched:matched.size, missing:names.filter(name => !matched.has(name)) };
    if (materialTextureStats.missing.length) debugLog(`vehicle material mapping missed: ${materialTextureStats.missing.join(', ')}`, 'warn');
    return materialTextureStats;
  }

  function loadModelSource(record) {
    const url = String(record?.modelUrl || ''); // Used as the editor-authored GLB path.
    if (!url) return Promise.reject(new Error('Boat preset has no modelUrl.'));
    if (!modelSourcePromise || modelSourcePromise.__url !== url) {
      const loader = new THREE.GLTFLoader(); // Used to load the exact GLB produced by the rivership asset workflow.
      const promise = new Promise((resolve, reject) => loader.load(url, gltf => resolve(gltf.scene), undefined, reject));
      promise.__url = url;
      modelSourcePromise = promise;
    }
    return modelSourcePromise;
  }

  function triangleLocalBounds(root, selectedIds) {
    if (!root || !selectedIds?.size || !window.THREE?.Box3) return null;
    const box = new THREE.Box3(); // Used to derive deck support exclusively from editor-selected walkable faces.
    box.makeEmpty();
    let globalTriangle = 0; // Global source triangle id, shared with the Vehicle Editor across all traversed mesh primitives.
    root.updateMatrixWorld?.(true);
    root.traverse?.(mesh => {
      if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) return;
      const geometry = mesh.geometry; // Used to read authored source triangle vertices without modifying the visible geometry.
      const position = geometry.attributes.position;
      const index = geometry.index;
      const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
      for (let triangle = 0; triangle < triangleCount; triangle++, globalTriangle++) {
        if (!selectedIds.has(globalTriangle)) continue;
        for (let corner = 0; corner < 3; corner++) {
          const sourceIndex = index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner;
          const point = new THREE.Vector3().fromBufferAttribute(position, sourceIndex); // Used as one selected face corner.
          point.applyMatrix4(mesh.matrix); // Mesh-local -> model-root local; parent root transforms are intentionally excluded.
          box.expandByPoint(point);
        }
      }
    });
    return box.isEmpty() ? null : box;
  }

  function fitModel(root, record) {
    const rawBox = new THREE.Box3().setFromObject(root); // Used to normalize the arbitrary authored GLB units into tile dimensions.
    const rawSize = rawBox.getSize(new THREE.Vector3()); // Used to preserve model aspect ratio while fitting the declared footprint.
    const width = Math.max(0.05, finite(record?.tileSize?.width, 1));
    const length = Math.max(0.05, finite(record?.tileSize?.length, 1));
    const sx = rawSize.x > 1e-6 ? width / rawSize.x : 1;
    const sz = rawSize.z > 1e-6 ? length / rawSize.z : 1;
    const scale = Math.min(sx, sz); // Uniform scaling avoids distorting the authored hull merely to fill both footprint axes exactly.
    const center = rawBox.getCenter(new THREE.Vector3()); // Used to make state.x/z the vehicle pivot rather than the GLB's imported origin.
    root.position.set(-center.x * scale, 0, -center.z * scale);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    return { scale, rawBox, center };
  }

  function removeWalkSupport() {
    try { window.HobunjiWalkableElevation?.unregister?.(WALK_SUPPORT_ID); } catch (_) {}
  }

  function removeVisual() {
    removeWalkSupport();
    if (group) group.parent?.remove?.(group);
    group = null;
    modelRoot = null;
    visualArea = null;
    walkableDeckLocal = null;
  }

  async function spawnVisual() {
    removeVisual();
    if (!state || state.mapId !== deps?.getCurrentArea?.()) return;
    const targetScene = deps?.getActiveScene?.(); // Used to attach the boat to the same scene the current wilderness chunk set renders into.
    if (!targetScene?.add) return;
    const record = await resolvePreset(state.presetId);
    const source = await loadModelSource(record);
    if (!state || state.mapId !== deps?.getCurrentArea?.()) return;
    const root = cloneMaterials(source.clone(true)); // Per-boat clone so editor/running instance materials/transforms stay isolated.
    applyMaterialTextures(root, record);
    const fit = fitModel(root, record); // Used before walkable bounds so selected face coordinates match the scaled visible hull.
    const selected = new Set((record?.surfaceDetection?.walkableTriangleIds || []).map(Number)); // Used to derive the actual authored deck support.
    const rawDeck = triangleLocalBounds(root, selected);
    if (rawDeck) {
      // triangleLocalBounds sees root's fitted child transforms but not root.scale/position itself; convert its raw local coordinates now.
      walkableDeckLocal = new THREE.Box3(
        rawDeck.min.clone().multiplyScalar(fit.scale).add(new THREE.Vector3(-fit.center.x * fit.scale, 0, -fit.center.z * fit.scale)),
        rawDeck.max.clone().multiplyScalar(fit.scale).add(new THREE.Vector3(-fit.center.x * fit.scale, 0, -fit.center.z * fit.scale)),
      );
    }
    const boat = new THREE.Group(); // Runtime pivot used for persisted x/z/yaw and shoreline motion.
    boat.name = `vehicle_${record.id}`;
    boat.userData.vehicleId = record.id;
    boat.userData.vehicleType = 'boat';
    boat.add(root);
    modelRoot = root;
    group = boat;
    visualArea = state.mapId;
    targetScene.add(boat);
    syncVisualTransform();
    updateWalkableSupport();
    debugLog(`spawned ${record.label || record.id}; walkable faces=${selected.size}`);
    if (returnPending) returnToBoat();
  }

  function ensureVisualForCurrentArea() {
    if (!state || state.mapId !== deps?.getCurrentArea?.()) {
      if (group) removeVisual();
      return;
    }
    const scene = deps?.getActiveScene?.();
    if (group && group.parent === scene && visualArea === state.mapId) return;
    if (group) removeVisual();
    spawnVisual().catch(error => debugLog(`boat visual failed: ${error?.message || error}`, 'warn'));
  }

  function syncVisualTransform() {
    if (!group || !state) return;
    group.position.set(state.x, state.y, state.z);
    group.rotation.y = state.ry + THREE.MathUtils.degToRad(finite(preset?.modelYawOffsetDeg, 0));
    group.updateMatrixWorld?.(true);
  }

  function rotatedLocalToWorld(localX, localZ, x = state?.x || 0, z = state?.z || 0, ry = state?.ry || 0) {
    const c = Math.cos(ry), s = Math.sin(ry); // Used to rotate authored local X/Z offsets around the boat pivot.
    return { x: x + localX * c + localZ * s, z: z - localX * s + localZ * c };
  }

  function worldToBoatLocalAt(worldX, worldZ, x, z, ry) {
    const dx = worldX - x, dz = worldZ - z; // Used to inverse-rotate a player/grid point into authored vehicle local space at a specific saved transform.
    const c = Math.cos(ry), s = Math.sin(ry);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }

  function worldToBoatLocal(worldX, worldZ) {
    if (!state) return { x: Infinity, z: Infinity };
    return worldToBoatLocalAt(worldX, worldZ, state.x, state.z, state.ry);
  }

  function updateWalkableSupport() {
    removeWalkSupport();
    if (!group || !walkableDeckLocal || !state || state.mapId !== deps?.getCurrentArea?.()) return;
    const corners = [
      [walkableDeckLocal.min.x, walkableDeckLocal.min.z], [walkableDeckLocal.min.x, walkableDeckLocal.max.z],
      [walkableDeckLocal.max.x, walkableDeckLocal.min.z], [walkableDeckLocal.max.x, walkableDeckLocal.max.z],
    ].map(([x, z]) => rotatedLocalToWorld(x, z)); // Used to conservatively enclose a rotated authored deck in the axis-aligned support registry.
    const minX = Math.min(...corners.map(point => point.x));
    const maxX = Math.max(...corners.map(point => point.x));
    const minZ = Math.min(...corners.map(point => point.z));
    const maxZ = Math.max(...corners.map(point => point.z));
    const baseY = surfaceYAt(state.x, state.z); // Existing terrain/water baseline the player movement compositor already understands.
    const topY = state.y + walkableDeckLocal.max.y; // Selected deck face height, not the hull's full model height.
    if (!(topY > baseY + 1e-4)) return;
    window.HobunjiWalkableElevation?.registerBox?.({ minX, maxX, minZ, maxZ, baseY, topY }, {
      id: WALK_SUPPORT_ID, kind: 'vehicle-deck', area: state.mapId, sourceId: state.presetId, owner: group,
    });
  }

  function pointWithinAuthoredDeck(worldX, worldZ) {
    if (!walkableDeckLocal) return false;
    const local = worldToBoatLocal(worldX, worldZ); // Used to reject the extra corners introduced by the AABB support approximation above.
    return local.x >= walkableDeckLocal.min.x - 0.03 && local.x <= walkableDeckLocal.max.x + 0.03
      && local.z >= walkableDeckLocal.min.z - 0.03 && local.z <= walkableDeckLocal.max.z + 0.03;
  }

  function inSteerTrigger() {
    if (!state || !preset || state.mapId !== deps?.getCurrentArea?.()) return false;
    const playerPos = playerTilePosition(); // Used to test the player against the editor-authored invisible steer volume.
    if (!playerPos) return false;
    const local = worldToBoatLocal(playerPos.x, playerPos.z);
    const center = preset.steerTrigger?.center || [0, 0, 0];
    const size = preset.steerTrigger?.size || [1, 1, 1];
    return Math.abs(local.x - finite(center[0])) <= Math.max(0.05, finite(size[0], 1)) * 0.5
      && Math.abs(local.z - finite(center[2])) <= Math.max(0.05, finite(size[2], 1)) * 0.5;
  }

  function helmWorldPosition() {
    const center = preset?.steerTrigger?.center || [0, 0, 0]; // Used as the authored standing position while steering.
    return rotatedLocalToWorld(finite(center[0]), finite(center[2]));
  }

  function pinPlayerToHelm() {
    if (!steering || !state) return;
    const player = deps?.getPlayer?.();
    if (!player) return;
    const helm = helmWorldPosition(); // Used to prevent normal walking input from moving the helmsman independently of the boat.
    const tile = finite(deps?.TILE, 16) || 16;
    player.x = helm.x * tile;
    player.y = helm.z * tile;
    player.vx = 0;
    player.vy = 0;
    player.angle = state.ry;
  }

  function carryDeckPassenger(localPosition) {
    if (!localPosition || steering || !state) return;
    const player = deps?.getPlayer?.(); // Passenger whose current deck-relative X/Z is preserved while the hull translates/rotates.
    if (!player) return;
    const world = rotatedLocalToWorld(localPosition.x, localPosition.z);
    const tile = finite(deps?.TILE, 16) || 16;
    player.x = world.x * tile;
    player.y = world.z * tile;
  }

  function startSteering() {
    if (!inSteerTrigger()) return { ok: false, message: 'Stand at the helm to steer the boat.' };
    steering = true;
    heldKeys.clear();
    keyThrottle = keyTurn = touchThrottle = touchTurn = 0;
    debugLog('steering started');
    return { ok: true, message: 'Steering rivership.' };
  }

  function stopSteering(reason = 'manual', save = true) {
    if (!steering) return false;
    steering = false;
    heldKeys.clear();
    throttleInput = turnInput = keyThrottle = keyTurn = touchThrottle = touchTurn = 0;
    if (save) deps?.persist?.(); // Discrete helm release uses the game's canonical member save path.
    debugLog(`steering stopped (${reason})`);
    return true;
  }

  function toggleSteering() {
    const result = steering ? (stopSteering('toggle'), { ok: true, message: 'You let go of the helm.' }) : startSteering();
    deps?.showToast?.(result.message, result.ok);
    return result;
  }

  function sampleFootprint(x, z, ry, record = preset) {
    const width = Math.max(0.2, finite(record?.tileSize?.width, 1));
    const length = Math.max(0.2, finite(record?.tileSize?.length, 1));
    const inset = clamp(finite(record?.handling?.collisionInsetTiles, 0.1), 0, Math.min(width, length) * 0.45);
    const hx = Math.max(0.05, width * 0.5 - inset), hz = Math.max(0.05, length * 0.5 - inset);
    const localPoints = [
      [0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz], [0, -hz], [0, hz], [-hx, 0], [hx, 0],
    ]; // Center/corners/edge-midpoints catch shoreline overlap without mesh physics.
    return localPoints.map(([lx, lz]) => rotatedLocalToWorld(lx, lz, x, z, ry));
  }

  function footprintIsWater(x, z, ry, record = preset) {
    const grid = activeGrid(); // Used as the simple water-vs-ground collision field.
    if (!grid) return false;
    const cols = activeCols(), rows = activeRows();
    for (const point of sampleFootprint(x, z, ry, record)) {
      const col = Math.floor(point.x), row = Math.floor(point.z);
      if (col < 0 || row < 0 || col >= cols || row >= rows || !isPermanentWaterTile(grid[row]?.[col])) return false;
    }
    return true;
  }

  function approach(value, target, amount) {
    if (value < target) return Math.min(target, value + amount);
    if (value > target) return Math.max(target, value - amount);
    return target;
  }

  function updateInputs() {
    if (!steering) { throttleInput = 0; turnInput = 0; return; }
    keyThrottle = (heldKeys.has('w') || heldKeys.has('arrowup') ? 1 : 0) - (heldKeys.has('s') || heldKeys.has('arrowdown') ? 1 : 0);
    keyTurn = (heldKeys.has('d') || heldKeys.has('arrowright') ? 1 : 0) - (heldKeys.has('a') || heldKeys.has('arrowleft') ? 1 : 0);
    let controllerThrottle = 0, controllerTurn = 0; // Used to read the shared ControllerInput left-stick snapshot without polling the Gamepad API here.
    try {
      const controllerFrame = window.ControllerInput?.frame?.(); // Shared per-frame input authority used by every gameplay controller consumer.
      if (controllerFrame?.pad) {
        controllerTurn = finite(controllerFrame.move?.x);
        controllerThrottle = -finite(controllerFrame.move?.y);
        const interactBinding = window.InputBindings?.getCurrentBindings?.()?.controller?.interact || 'Button0'; // Rebound controller Interact action.
        const pressed = !!controllerFrame.isDown?.(interactBinding); // Rising edge below keeps one helm toggle per physical press.
        if (pressed && !lastControllerInteract && (steering || inSteerTrigger())) toggleSteering();
        lastControllerInteract = pressed;
      } else lastControllerInteract = false;
    } catch (_) { lastControllerInteract = false; }
    throttleInput = clamp(Math.abs(touchThrottle) > Math.abs(keyThrottle) ? touchThrottle : Math.abs(controllerThrottle) > Math.abs(keyThrottle) ? controllerThrottle : keyThrottle, -1, 1);
    turnInput = clamp(Math.abs(touchTurn) > Math.abs(keyTurn) ? touchTurn : Math.abs(controllerTurn) > Math.abs(keyTurn) ? controllerTurn : keyTurn, -1, 1);
  }

  function updateMotion(dt) {
    if (!state || !preset || state.mapId !== deps?.getCurrentArea?.()) return;
    const handling = preset.handling || {};
    const maxForward = Math.max(0, finite(handling.maxForwardTilesPerSecond, 2));
    const maxReverse = Math.max(0, finite(handling.maxReverseTilesPerSecond, 0.6));
    const accel = Math.max(0, finite(handling.accelerationTilesPerSecond2, 0.7));
    const reverseAccel = Math.max(0, finite(handling.reverseAccelerationTilesPerSecond2, 0.6));
    const decel = Math.max(0, finite(handling.decelerationTilesPerSecond2, 0.24));
    const turnRate = THREE.MathUtils.degToRad(Math.max(0, finite(handling.turnRateDegPerSecond, 38)));
    const highSpeedTurn = clamp(finite(handling.highSpeedTurnMultiplier, 0.48), 0.05, 1);
    const passengerPos = !steering ? playerTilePosition() : null; // Current walkable-deck passenger position before this frame changes the boat transform.
    const passengerLocal = passengerPos && pointWithinAuthoredDeck(passengerPos.x, passengerPos.z)
      ? worldToBoatLocalAt(passengerPos.x, passengerPos.z, state.x, state.z, state.ry) : null; // Used to carry a walking passenger through residual momentum/turning.

    if (steering && throttleInput > 0.01) state.speed = approach(state.speed, maxForward * throttleInput, accel * dt);
    else if (steering && throttleInput < -0.01) state.speed = approach(state.speed, -maxReverse * Math.abs(throttleInput), reverseAccel * dt);
    else state.speed = approach(state.speed, 0, decel * dt);

    const speedFraction = maxForward > 1e-6 ? clamp(Math.abs(state.speed) / maxForward, 0, 1) : 0;
    const turnMultiplier = 1 + (highSpeedTurn - 1) * speedFraction; // Faster motion reduces voluntary yaw response like mounts, only more strongly.
    if (steering && Math.abs(turnInput) > 0.01) {
      const direction = state.speed < -0.03 ? -1 : 1; // Reversing naturally flips steering direction.
      state.ry += turnInput * direction * turnRate * turnMultiplier * dt;
    }

    bounceCooldown = Math.max(0, bounceCooldown - dt);
    if (Math.abs(state.speed) > 1e-5) {
      const oldX = state.x, oldZ = state.z;
      const nextX = oldX + Math.cos(state.ry) * state.speed * dt;
      const nextZ = oldZ + Math.sin(state.ry) * state.speed * dt;
      if (footprintIsWater(nextX, nextZ, state.ry, preset)) {
        state.x = nextX;
        state.z = nextZ;
        state.y = waterVisualY(state.x, state.z, preset);
      } else {
        state.x = oldX;
        state.z = oldZ;
        if (bounceCooldown <= 0) {
          const bounce = Math.max(0, finite(handling.shoreBounceSpeedTilesPerSecond, 0.78));
          state.speed = state.speed >= 0 ? -bounce : bounce;
          bounceCooldown = Math.max(0, finite(handling.shoreBounceCooldownSeconds, 0.32));
          debugLog('shoreline bounce reverse impulse');
        }
      }
    }
    syncVisualTransform();
    updateWalkableSupport();
    if (steering) pinPlayerToHelm();
    else carryDeckPassenger(passengerLocal);

  }

  function summonAtPlayer(presetId = DEFAULT_PRESET_ID) {
    const water = playerWaterTile(); // Used to require the player to already be standing on the water tile receiving the free summon.
    if (!supportsArea()) return { ok: false, message: 'Boats can only be summoned in wilderness waterways or the town river.' };
    if (!water) return { ok: false, message: 'Stand on a river, stream, or waterfall tile to summon your boat.' };
    return resolvePreset(presetId).then(record => {
      const x = water.col + 0.5, z = water.row + 0.5;
      const ry = finite(deps?.getFacingAngle?.(), finite(deps?.getPlayer?.()?.angle, 0));
      // The summon gate is deliberately only the water tile under the player, matching the utility-menu rule;
      // if the large hull starts near shore, the normal shoreline reverse impulse resolves it once steering begins.
      stopSteering('resummon', false);
      removeVisual();
      state = { presetId: record.id, mapId: deps.getCurrentArea(), x, y: waterVisualY(x, z, record), z, ry, speed: 0 };
      preset = record;
      returnPending = false;
      deps?.persist?.(); // Summon/relocate is a discrete ownership change, so persist it through the canonical member save.
      ensureVisualForCurrentArea();
      debugLog(`summoned ${record.id} free at ${state.mapId}@${x.toFixed(1)},${z.toFixed(1)}`);
      return { ok: true, message: '🛶 Boat summoned. Your previous boat has been replaced.' };
    }).catch(error => ({ ok: false, message: `Boat summon failed: ${error?.message || error}` }));
  }

  function clear(reason = 'explicit') {
    if (!state) return false;
    stopSteering(reason, false);
    state = null;
    preset = null;
    returnPending = false;
    removeVisual();
    deps?.persist?.(); // Clearing the owned boat is persisted by the same member save as inventory/camp state.
    debugLog(`boat cleared (${reason})`);
    return true;
  }

  function isHere() { return !!(state && state.mapId === deps?.getCurrentArea?.()); }

  function returnToBoat() {
    if (!isHere()) return { ok: false, message: 'Your boat is in another wilderness area.' };
    const player = deps?.getPlayer?.();
    if (!player) return { ok: false, message: 'Player is unavailable.' };
    const tile = finite(deps?.TILE, 16) || 16;
    const localDeck = walkableDeckLocal ? {
      x: (walkableDeckLocal.min.x + walkableDeckLocal.max.x) * 0.5,
      z: (walkableDeckLocal.min.z + walkableDeckLocal.max.z) * 0.5,
    } : { x: 0, z: 0 };
    const landing = rotatedLocalToWorld(localDeck.x, localDeck.z); // Used to land on the authored walkable deck rather than in the hull center.
    player.x = landing.x * tile;
    player.y = landing.z * tile;
    player.vx = 0;
    player.vy = 0;
    returnPending = false;
    return { ok: true, message: 'You return to your boat.' };
  }

  function requestReturnToBoat() {
    if (!state) return null;
    returnPending = true;
    return serialize();
  }

  function restore(saved) {
    stopSteering('restore', false);
    removeVisual();
    state = saved?.mapId && saved?.presetId ? {
      presetId: String(saved.presetId),
      mapId: String(saved.mapId),
      x: finite(saved.x),
      y: finite(saved.y),
      z: finite(saved.z),
      ry: finite(saved.ry),
      speed: finite(saved.speed),
    } : null; // Canonical member-save payload restored by game.js after the active world/member is selected.
    preset = null;
    returnPending = false;
    bounceCooldown = 0;
    if (state) {
      resolvePreset(state.presetId)
        .then(() => ensureVisualForCurrentArea())
        .catch(error => debugLog(`restored boat preset failed: ${error?.message || error}`, 'warn'));
    }
    debugLog(state ? `restored ${state.presetId} in ${state.mapId}` : 'restored with no owned boat');
    return serialize();
  }

  function serialize() {
    return state ? {
      presetId: state.presetId, mapId: state.mapId, x: state.x, y: state.y, z: state.z, ry: state.ry, speed: state.speed,
    } : null;
  }

  function utilityEntries() {
    const boat = serialize(); // Used to label/enable Return to Boat without duplicating ActionArcUI's built-in utility entries.
    const summonAllowed = canSummonHere(); // Used to gate summon/relocate to permanent wilderness water or Hobunji's town river.
    return [
      {
        id: 'summon-boat', icon: '🛶', label: summonAllowed ? (boat ? 'Move Boat Here' : 'Summon Boat') : 'Boat: Stand on Water',
        disabled: !summonAllowed,
        onSelect: async () => {
          const result = await summonAtPlayer(); // Result drives the ordinary game toast after async config/model-independent state placement.
          deps?.showToast?.(result.message, result.ok);
          deps?.refreshActionBar?.();
        },
      },
      {
        id: 'return-boat', icon: '⛵', label: boat ? 'Return to Boat' : 'No Boat Summoned', disabled: !boat,
        onSelect: () => {
          if (!boat) return;
          if (boat.mapId === deps?.getCurrentArea?.()) {
            const result = returnToBoat(); // Same-zone return is immediate and does not wait for the GLB.
            deps?.showToast?.(result.message, result.ok);
            deps?.refreshActionBar?.();
            return;
          }
          requestReturnToBoat();
          deps?.startSceneTransition?.(() => deps?.enterZone?.(boat.mapId, Math.floor(boat.x), Math.floor(boat.z)));
        },
      },
    ];
  }

  function installUtilityProvider() {
    if (utilityProviderInstalled) return;
    const register = window.ActionArcUI?.registerUtilityEntries; // Shared extension API keeps desktop/controller/touch Utilities on one code path.
    if (typeof register !== 'function') return;
    utilityProviderInstalled = register.call(window.ActionArcUI, 'wilderness-boat', utilityEntries) !== false;
    if (utilityProviderInstalled) debugLog('utility menu provider installed');
  }

  function refreshPrompt() {
    const near = inSteerTrigger();
    lastPromptNear = near;
    if (!near || !window.ActionPromptUI?.showActionPrompt) return;
    window.ActionPromptUI.showActionPrompt({
      actionId: 'interact', touchIcon: '🛶', verb: steering ? 'Stop Steering' : 'Steer Rivership', onPress: toggleSteering,
      statusText: steering ? 'W/S throttle · A/D steer · momentum continues after release' : null,
    });
  }

  function installInputs() {
    if (inputInstalled) return;
    document.addEventListener('keydown', event => {
      const key = String(event.key || '').toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && steering) {
        heldKeys.add(key); event.preventDefault(); event.stopPropagation();
      }
      const interactBinding = window.InputBindings?.getCurrentBindings?.()?.desktop?.interact || 'KeyE'; // Rebound desktop Interact action.
      if ((event.code === interactBinding || (interactBinding === 'Enter' && key === 'enter')) && (steering || inSteerTrigger())) {
        toggleSteering(); event.preventDefault(); event.stopPropagation();
      }
      if (key === 'escape' && steering) { stopSteering('escape'); event.preventDefault(); event.stopPropagation(); }
    }, true);
    document.addEventListener('keyup', event => {
      const key = String(event.key || '').toLowerCase();
      if (heldKeys.delete(key) && steering) { event.preventDefault(); event.stopPropagation(); }
    }, true);
    const joystick = document.getElementById('joystickZone'); // Existing mobile movement stick doubles as throttle/rudder while steering.
    if (joystick) {
      const updateTouch = event => {
        if (!steering) return;
        const rect = joystick.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5, cy = rect.top + rect.height * 0.5;
        const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
        touchTurn = clamp((event.clientX - cx) / radius, -1, 1);
        touchThrottle = clamp((cy - event.clientY) / radius, -1, 1);
      };
      joystick.addEventListener('pointerdown', updateTouch, true);
      joystick.addEventListener('pointermove', updateTouch, true);
      const release = () => { if (steering) { touchTurn = 0; touchThrottle = 0; } };
      joystick.addEventListener('pointerup', release, true);
      joystick.addEventListener('pointercancel', release, true);
    }
    inputInstalled = true;
  }

  function debugState() {
    const pos = playerTilePosition();
    lastDebug = {
      state: serialize(),
      presetId: preset?.id || null,
      hasVisual: !!group,
      visualArea,
      steering,
      speed: state?.speed || 0,
      throttleInput,
      turnInput,
      bounceCooldown,
      canSummonHere: canSummonHere(),
      playerTile: pos,
      nearSteerTrigger: inSteerTrigger(),
      overAuthoredDeck: pos ? pointWithinAuthoredDeck(pos.x, pos.z) : false,
      walkableDeckLocal: walkableDeckLocal ? { min: walkableDeckLocal.min.toArray(), max: walkableDeckLocal.max.toArray() } : null,
      utilityProviderInstalled,
      materialTextures: { configured:materialTextureStats.configured, matched:materialTextureStats.matched, missing:materialTextureStats.missing.slice() },
      history: debugHistory.slice(),
    };
    return lastDebug;
  }

  function update(dt) {
    installUtilityProvider();
    installInputs();
    if (state && !preset) resolvePreset(state.presetId).catch(() => {});
    ensureVisualForCurrentArea();
    if (!state || state.mapId !== deps?.getCurrentArea?.()) {
      if (steering) stopSteering('left-area');
      return;
    }
    updateInputs();
    updateMotion(Math.min(0.1, Math.max(0, finite(dt))));
    refreshPrompt();
    if (returnPending) returnToBoat(); // Travel completion must not depend on the GLB asset finishing its asynchronous load.
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    loadConfig().then(() => state && resolvePreset(state.presetId)).catch(() => {});
    installUtilityProvider();
    installInputs();
    window.__hobunjiBoatDebug = debugState;
    debugLog('runtime initialized; navigable areas=wilderness+town river; permanent water types=river/stream/waterfall');
  }

  window.WildernessBoat = {
    init, update, supportsArea, canSummonHere, summonAtPlayer, clear, isHere, returnToBoat, requestReturnToBoat,
    serialize, restore, startSteering, stopSteering, toggleSteering, inSteerTrigger, footprintIsWater, debugState,
    __test: { isPermanentWaterTile, sampleFootprint, approach },
  };
})();

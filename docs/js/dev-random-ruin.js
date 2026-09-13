// Dev Random Test Ruin — session-only seeded ruin playground for validating
// animated walkable geometry before the production locale runtime owns it.
// Loaded before game.js so it can capture DevSpawner.init(deps) and install a
// pre-render reconciliation pass through DynamicSurfaces.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  const DevSpawner = window.DevSpawner;
  if (!DS || !DevSpawner) {
    console.warn('[Random Test Ruin] requires DynamicSurfaces + DevSpawner');
    return;
  }

  const SCOPE = 'dev-random-ruin';
  const ARENA_ID = DevSpawner.DEV_ARENA_ZONE_ID || 'map_dev_arena';
  const PLAYER_RADIUS_TILES = 0.28;
  const MAX_STEP_HEIGHT = 0.42;
  const FALL_MS = 650;

  let deps = null;
  let ruin = null;
  let pendingSeed = null;
  let currentControl = null;
  let promptOwned = false;
  let previousControllerInteractDown = false;
  let frameLastMs = performance.now();
  let removeFrameClient = null;

  function devModeEnabled() {
    try { return localStorage.getItem('hobunjiDevMode') === '1'; } catch (_) { return false; }
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    try {
      const data = new Uint32Array(1);
      crypto.getRandomValues(data);
      return data[0] >>> 0;
    } catch (_) {
      return ((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0);
    }
  }

  function shuffle(list, rnd) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function disposeObject(root) {
    if (!root) return;
    root.traverse?.(obj => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(mat => mat?.dispose?.());
      else obj.material?.dispose?.();
    });
    root.parent?.remove(root);
  }

  function clearRuin() {
    if (ruin?.group) disposeObject(ruin.group);
    DS.clearScope(SCOPE);
    if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
    promptOwned = false;
    currentControl = null;
    ruin = null;
    const badge = document.getElementById('devRandomRuinBadge');
    if (badge) badge.style.display = 'none';
  }

  function mat(color, extra = {}) {
    return new THREE.MeshLambertMaterial({ color, ...extra });
  }

  function box(group, x, y, z, w, h, d, material, name = '') {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (name) mesh.name = name;
    group.add(mesh);
    return mesh;
  }

  function bounds(minX, maxX, minZ, maxZ) { return { minX, maxX, minZ, maxZ }; }

  function registerWall(id, minX, maxX, minZ, maxZ) {
    DS.registerBlocker({ id, scope: SCOPE, bounds: () => bounds(minX, maxX, minZ, maxZ) });
  }

  function worldFromLocal(localX, localZ) {
    return { x: ruin.originX + localX, z: ruin.originZ + localZ };
  }

  function addOuterWalls(group, width, depth, stoneMat) {
    const wallH = 1.15;
    const wallT = 0.35;
    box(group, width / 2, wallH / 2, wallT / 2, width, wallH, wallT, stoneMat, 'ruin_wall_north');
    box(group, width / 2, wallH / 2, depth - wallT / 2, width, wallH, wallT, stoneMat, 'ruin_wall_south');
    box(group, wallT / 2, wallH / 2, depth / 2, wallT, wallH, depth - 2.2, stoneMat, 'ruin_wall_west');
    box(group, width - wallT / 2, wallH / 2, depth / 2, wallT, wallH, depth - 2.2, stoneMat, 'ruin_wall_east');

    const o = worldFromLocal(0, 0);
    registerWall('ruin-wall-n', o.x, o.x + width, o.z, o.z + wallT);
    registerWall('ruin-wall-s', o.x, o.x + width, o.z + depth - wallT, o.z + depth);
    registerWall('ruin-wall-w', o.x, o.x + wallT, o.z + 1.1, o.z + depth - 1.1);
    registerWall('ruin-wall-e', o.x + width - wallT, o.x + width, o.z + 1.1, o.z + depth - 1.1);
  }

  function addFloor(group, x0, x1, z0, z1, floorMat, y = -0.04) {
    box(group, (x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, 0.08, z1 - z0, floorMat, 'ruin_floor');
  }

  function addControl(group, localX, localZ, label, onPress, accentMat) {
    const p = worldFromLocal(localX, localZ);
    const root = new THREE.Group();
    root.position.set(localX, 0, localZ);
    box(root, 0, 0.35, 0, 0.65, 0.7, 0.65, accentMat, 'ruin_control_pedestal');
    const cap = box(root, 0, 0.76, 0, 0.42, 0.12, 0.42, accentMat, 'ruin_control_cap');
    cap.rotation.y = Math.PI / 4;
    group.add(root);
    ruin.controls.push({ x: p.x, z: p.z, label, onPress, mesh: root });
    return root;
  }

  function addBridgeModule(group, module, materials) {
    const { x0, x1, z0, z1, id } = module;
    const pitWorld = worldFromLocal(x0 + 0.45, z0 + 1.35);
    const pitWidth = x1 - x0 - 0.9;
    const pitDepth = z1 - z0 - 2.7;
    const state = { progress: 0.12, target: 0.12 };
    const localStartX = x0 + 0.45;
    const localEndX = x1 - 0.45;
    const centerZ = (z0 + z1) / 2;
    const fullLength = localEndX - localStartX;
    const bridgeMesh = box(group, localStartX + fullLength * state.progress / 2, 0.06, centerZ,
      fullLength, 0.12, pitDepth * 0.72, materials.moving, `bridge_${id}`);
    bridgeMesh.scale.x = Math.max(0.01, state.progress);
    box(group, localStartX + fullLength / 2, -0.045, centerZ, fullLength, 0.03, pitDepth, materials.pit, `pit_${id}`);

    DS.registerPit({ id: `${id}-pit`, scope: SCOPE, bounds: () => bounds(pitWorld.x, pitWorld.x + pitWidth, pitWorld.z, pitWorld.z + pitDepth) });
    DS.registerSurface({
      id: `${id}-surface`, scope: SCOPE,
      bounds: () => {
        const start = worldFromLocal(localStartX, centerZ);
        return bounds(start.x, start.x + fullLength * state.progress,
          start.z - pitDepth * 0.36, start.z + pitDepth * 0.36);
      },
      topY: () => 0.12,
      enabled: () => state.progress > 0.015,
    });

    ruin.mechanisms.push({
      id, type: 'bridge', state,
      update(dt) {
        state.progress += clamp(state.target - state.progress, -dt * 0.65, dt * 0.65);
        const len = fullLength * state.progress;
        bridgeMesh.scale.x = Math.max(0.01, state.progress);
        bridgeMesh.position.x = localStartX + len / 2;
      },
    });
    addControl(group, x0 + 0.75, z0 + 0.75, 'Extending Bridge', () => { state.target = state.target > 0.5 ? 0.08 : 1; }, materials.control);
  }

  function addShrinkingModule(group, module, materials) {
    const { x0, x1, z0, z1, id } = module;
    const laneZ = (z0 + z1) / 2;
    const fullW = x1 - x0 - 0.9;
    const fullD = z1 - z0 - 2.5;
    const state = { progress: 1, target: 1 };
    const pit = worldFromLocal(x0 + 0.45, z0 + 1.25);
    const mesh = box(group, (x0 + x1) / 2, 0.055, laneZ, fullW, 0.11, fullD, materials.moving, `shrinker_${id}`);
    box(group, (x0 + x1) / 2, -0.045, laneZ, fullW, 0.03, fullD, materials.pit, `pit_${id}`);

    DS.registerPit({ id: `${id}-pit`, scope: SCOPE, bounds: () => bounds(pit.x, pit.x + fullW, pit.z, pit.z + fullD) });
    DS.registerSurface({
      id: `${id}-surface`, scope: SCOPE,
      bounds: () => {
        const center = worldFromLocal((x0 + x1) / 2, laneZ);
        const w = fullW * state.progress;
        const d = fullD * state.progress;
        return bounds(center.x - w / 2, center.x + w / 2, center.z - d / 2, center.z + d / 2);
      },
      topY: () => 0.11,
      enabled: () => state.progress > 0.06,
    });

    ruin.mechanisms.push({
      id, type: 'shrinker', state,
      update(dt) {
        state.progress += clamp(state.target - state.progress, -dt * 0.55, dt * 0.55);
        mesh.scale.set(Math.max(0.04, state.progress), 1, Math.max(0.04, state.progress));
      },
    });
    addControl(group, x0 + 0.8, z1 - 0.75, 'Shrinking Platform', () => { state.target = state.target > 0.5 ? 0.08 : 1; }, materials.control);
  }

  function addDaisModule(group, module, materials) {
    const { x0, x1, z0, z1, id } = module;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = Math.min(2.8, x1 - x0 - 1.1);
    const d = Math.min(2.8, z1 - z0 - 2.0);
    const state = { progress: 0, target: 0 };
    const mesh = box(group, cx, 0.08, cz, w, 0.16, d, materials.moving, `dais_${id}`);
    const world = worldFromLocal(cx, cz);

    DS.registerSurface({
      id: `${id}-surface`, scope: SCOPE,
      bounds: () => bounds(world.x - w / 2, world.x + w / 2, world.z - d / 2, world.z + d / 2),
      topY: () => 0.16 + state.progress * 1.35,
    });

    ruin.mechanisms.push({
      id, type: 'dais', state,
      update(dt) {
        state.progress += clamp(state.target - state.progress, -dt * 0.45, dt * 0.45);
        mesh.position.y = 0.08 + state.progress * 1.35;
      },
    });
    addControl(group, x0 + 0.75, z0 + 0.75, 'Moving Dais', () => { state.target = state.target > 0.5 ? 0 : 1; }, materials.control);
  }

  function addStairsModule(group, module, materials) {
    const { x0, x1, z0, z1, id } = module;
    const treadCount = 5;
    const start = x0 + 0.5;
    const end = x1 - 0.5;
    const treadW = (end - start) / treadCount;
    const depth = z1 - z0 - 2.6;
    const centerZ = (z0 + z1) / 2;
    const state = { progress: 1, target: 1 };
    const treadMeshes = [];
    const pit = worldFromLocal(start, z0 + 1.3);
    DS.registerPit({ id: `${id}-pit`, scope: SCOPE, bounds: () => bounds(pit.x, pit.x + end - start, pit.z, pit.z + depth) });
    box(group, (start + end) / 2, -0.045, centerZ, end - start, 0.03, depth, materials.pit, `pit_${id}`);

    for (let i = 0; i < treadCount; i++) {
      const lx = start + treadW * (i + 0.5);
      const restY = 0.08 + i * 0.16;
      const mesh = box(group, lx, restY / 2, centerZ, treadW * 0.96, restY, depth * 0.82, materials.moving, `stairs_${id}_${i}`);
      treadMeshes.push({ mesh, restY, lx });
      const world = worldFromLocal(lx, centerZ);
      DS.registerSurface({
        id: `${id}-tread-${i}`, scope: SCOPE,
        bounds: () => bounds(world.x - treadW * 0.48, world.x + treadW * 0.48,
          world.z - depth * 0.41, world.z + depth * 0.41),
        topY: () => -0.55 + state.progress * (0.55 + restY),
        enabled: () => (-0.55 + state.progress * (0.55 + restY)) > -0.04,
      });
    }

    ruin.mechanisms.push({
      id, type: 'stairs', state,
      update(dt) {
        state.progress += clamp(state.target - state.progress, -dt * 0.7, dt * 0.7);
        for (const tread of treadMeshes) {
          const top = -0.55 + state.progress * (0.55 + tread.restY);
          const h = Math.max(0.05, top + 0.55);
          tread.mesh.position.y = -0.55 + h / 2;
          tread.mesh.scale.y = h / tread.restY;
        }
      },
    });
    addControl(group, x0 + 0.75, z1 - 0.75, 'Collapsing Stairs', () => { state.target = state.target > 0.5 ? 0 : 1; }, materials.control);
  }

  function addDoorBetween(group, localX, depth, id, materials, rnd) {
    const gapZ = depth / 2;
    const state = { progress: 0, target: 0 };
    const doorW = 0.34;
    const doorD = 2.45;
    const doorH = 1.65;
    const mesh = box(group, localX, doorH / 2, gapZ, doorW, doorH, doorD, materials.door, `door_${id}`);
    const world = worldFromLocal(localX, gapZ);
    DS.registerBlocker({
      id: `${id}-blocker`, scope: SCOPE,
      bounds: () => bounds(world.x - doorW / 2, world.x + doorW / 2, world.z - doorD / 2, world.z + doorD / 2),
      blocksAt: (_x, _z, actorHeight) => state.progress * doorH < Math.max(0.55, actorHeight * 0.82),
    });
    ruin.mechanisms.push({
      id, type: 'door', state,
      update(dt) {
        state.progress += clamp(state.target - state.progress, -dt * 0.8, dt * 0.8);
        mesh.position.y = doorH / 2 + state.progress * doorH;
      },
    });
    const controlZ = rnd() < 0.5 ? 1.0 : depth - 1.0;
    addControl(group, localX - 0.9, controlZ, 'Stone Door', () => { state.target = state.target > 0.5 ? 0 : 1; }, materials.control);
  }

  function addRubble(group, width, depth, rnd, rubbleMat) {
    const count = 8 + Math.floor(rnd() * 9);
    for (let i = 0; i < count; i++) {
      const x = 1 + rnd() * (width - 2);
      const z = 0.6 + (rnd() < 0.5 ? rnd() * 0.65 : depth - 1.25 + rnd() * 0.65);
      const s = 0.12 + rnd() * 0.28;
      const m = box(group, x, s * 0.45, z, s * (0.7 + rnd()), s * 0.9, s, rubbleMat, 'ruin_rubble');
      m.rotation.y = rnd() * Math.PI;
    }
  }

  function buildRuin(seed) {
    clearRuin();
    if (!deps || deps.getCurrentArea?.() !== ARENA_ID) return false;
    const scene = deps.getActiveScene?.();
    if (!scene) return false;

    const rnd = seededRandom(seed);
    const moduleTypes = shuffle(['bridge', 'shrinker', 'dais', 'stairs'], rnd);
    const moduleWidths = moduleTypes.map(() => 4.4 + rnd() * 1.3);
    const depth = 7.5 + rnd() * 1.25;
    const entryPad = 2.2;
    const exitPad = 1.5;
    const width = entryPad + moduleWidths.reduce((a, b) => a + b, 0) + exitPad;
    const cols = Number(deps.COLS) || 60;
    const rows = Number(deps.ROWS) || 50;
    const px = deps.player.x / deps.TILE;
    const pz = deps.player.y / deps.TILE;
    const originX = clamp(px - 1.5, 1.5, Math.max(1.5, cols - width - 1.5));
    const originZ = clamp(pz - depth / 2, 1.5, Math.max(1.5, rows - depth - 1.5));

    ruin = {
      seed, rnd, group: new THREE.Group(), originX, originZ, width, depth,
      controls: [], mechanisms: [], falling: null,
      lastAcceptedPx: { x: deps.player.x, y: deps.player.y },
      lastSafePx: { x: deps.player.x, y: deps.player.y },
      supportId: null, supportY: 0,
    };
    ruin.group.name = `dev_random_ruin_${seed}`;
    ruin.group.position.set(originX, 0, originZ);
    scene.add(ruin.group);

    const materials = {
      floor: mat(0x5d5a52), stone: mat(0x69645a), moving: mat(0x9b896a),
      control: mat(0x8676a8), door: mat(0x5f5548), rubble: mat(0x4c4943), pit: mat(0x171815),
    };

    addFloor(ruin.group, 0.35, width - 0.35, 0.35, depth - 0.35, materials.floor);
    addOuterWalls(ruin.group, width, depth, materials.stone);
    addRubble(ruin.group, width, depth, rnd, materials.rubble);

    let cursor = entryPad;
    for (let i = 0; i < moduleTypes.length; i++) {
      const x0 = cursor;
      const x1 = cursor + moduleWidths[i];
      const module = { x0, x1, z0: 0.45, z1: depth - 0.45, id: `m${i}-${moduleTypes[i]}` };
      if (moduleTypes[i] === 'bridge') addBridgeModule(ruin.group, module, materials);
      else if (moduleTypes[i] === 'shrinker') addShrinkingModule(ruin.group, module, materials);
      else if (moduleTypes[i] === 'dais') addDaisModule(ruin.group, module, materials);
      else addStairsModule(ruin.group, module, materials);
      cursor = x1;
      if (i < moduleTypes.length - 1 && rnd() < 0.8) addDoorBetween(ruin.group, cursor, depth, `door-${i}`, materials, rnd);
    }

    deps.player.x = (originX + 1.1) * deps.TILE;
    deps.player.y = (originZ + depth / 2) * deps.TILE;
    deps.player.vx = 0; deps.player.vy = 0;
    ruin.lastAcceptedPx = { x: deps.player.x, y: deps.player.y };
    ruin.lastSafePx = { ...ruin.lastAcceptedPx };
    deps._snapCameraTarget?.();

    updateBadge();
    const order = moduleTypes.join(' → ');
    deps.showToast?.(`Random Test Ruin #${seed} generated: ${order}.`, true);
    window.__farmLog?.(`[random-ruin] seed=${seed} modules=${order}`, 'debug');
    return true;
  }

  function updateBadge() {
    if (!ruin) return;
    let badge = document.getElementById('devRandomRuinBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'devRandomRuinBadge';
      badge.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:65;padding:6px 9px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(12,14,12,.78);color:#ddd;font:11px DM Mono,monospace;pointer-events:none;';
      document.body.appendChild(badge);
    }
    badge.textContent = `TEST RUIN seed ${ruin.seed}`;
    badge.style.display = devModeEnabled() ? '' : 'none';
  }

  function generateWhenArenaReady(seed, tries = 0) {
    if (!deps || pendingSeed !== seed) return;
    if (deps.getCurrentArea?.() === ARENA_ID && deps.getActiveScene?.()) {
      pendingSeed = null;
      buildRuin(seed);
      return;
    }
    if (tries > 180) {
      pendingSeed = null;
      deps.showToast?.('Random Test Ruin could not find the Testing Arena scene.', false);
      return;
    }
    requestAnimationFrame(() => generateWhenArenaReady(seed, tries + 1));
  }

  function launchRandomRuin() {
    if (!devModeEnabled() || !deps) return;
    const seed = randomSeed();
    pendingSeed = seed;
    if (deps.getCurrentArea?.() !== ARENA_ID) DevSpawner.teleportToDevArena();
    generateWhenArenaReady(seed);
  }

  function installSettingsButton() {
    if (!devModeEnabled()) return;
    const arenaBtn = document.getElementById('devTeleportArenaBtn');
    if (!arenaBtn || document.getElementById('devRandomTestRuinBtn')) return;
    const arenaRow = arenaBtn.closest('.settings-row');
    if (!arenaRow?.parentElement) return;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `<div class="settings-label"><div class="settings-name">Random Test Ruin</div><div class="settings-desc">Generate a fresh session-only seeded ruin in the Test Arena for animated-surface playtesting. Nothing is saved.</div></div><button type="button" id="devRandomTestRuinBtn" class="settings-small-btn">Generate</button>`;
    arenaRow.insertAdjacentElement('afterend', row);
    row.querySelector('#devRandomTestRuinBtn')?.addEventListener('click', launchRandomRuin);
  }

  function desktopInteractPressed(event) {
    const binding = window.InputBindings?.getCurrentBindings?.()?.desktop?.interact;
    if (!binding) return false;
    const parts = String(binding).split('+').map(part => part.trim()).filter(Boolean);
    const code = parts.pop();
    if (event.code !== code) return false;
    const needShift = parts.includes('Shift');
    const needCtrl = parts.includes('Ctrl') || parts.includes('Control');
    const needAlt = parts.includes('Alt');
    const needMeta = parts.includes('Meta');
    return event.shiftKey === needShift && event.ctrlKey === needCtrl && event.altKey === needAlt && event.metaKey === needMeta;
  }

  function controllerBindingDown(binding) {
    if (!binding || !String(binding).startsWith('Button')) return false;
    const index = Number(String(binding).slice(6));
    if (!Number.isInteger(index)) return false;
    const pads = navigator.getGamepads?.() || [];
    for (const pad of pads) if (pad?.buttons?.[index]?.pressed) return true;
    return false;
  }

  document.addEventListener('keydown', event => {
    if (!ruin || !currentControl || ruin.falling || !desktopInteractPressed(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    currentControl.onPress?.();
  }, true);

  function updateControlPrompt(px, pz) {
    let nearest = null;
    let bestD2 = 1.7 * 1.7;
    for (const control of ruin.controls) {
      const dx = control.x - px, dz = control.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) { bestD2 = d2; nearest = control; }
    }
    currentControl = nearest;
    if (nearest) {
      window.ActionPromptUI?.showActionPrompt?.({
        actionId: 'interact', touchIcon: '✋', verb: `Toggle ${nearest.label}`,
        onPress: () => nearest.onPress?.(),
        statusText: 'DEV RUIN · animated surface test', statusType: '',
      });
      promptOwned = true;
      const binding = window.InputBindings?.getCurrentBindings?.()?.controller?.interact;
      const down = controllerBindingDown(binding);
      if (down && !previousControllerInteractDown) nearest.onPress?.();
      previousControllerInteractDown = down;
    } else {
      previousControllerInteractDown = false;
      if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
      promptOwned = false;
    }
  }

  function candidateSupport(tileX, tileZ) {
    return DS.sampleSupport(tileX, tileZ, { minY: -0.05, maxY: 4, pad: 0.02 });
  }

  function positionInfo(px, py) {
    const tileX = px / deps.TILE;
    const tileZ = py / deps.TILE;
    const blocker = DS.blockerAt(tileX, tileZ, { radius: PLAYER_RADIUS_TILES, actorHeight: 1.25 });
    const pit = DS.pointInPit(tileX, tileZ, PLAYER_RADIUS_TILES * 0.25);
    const support = candidateSupport(tileX, tileZ);
    return { tileX, tileZ, blocker, pit, support };
  }

  function triggerFall(info, nowMs) {
    if (ruin.falling) return;
    ruin.falling = { startedAt: nowMs, x: deps.player.x, y: deps.player.y, safe: { ...ruin.lastSafePx } };
    deps.player.vx = 0; deps.player.vy = 0;
    window.ResourceSystem?.spendFooting?.(deps.player, 35, 'test ruin fall');
    deps.showToast?.('Fell from the test ruin surface.', false);
  }

  function handleFalling(nowMs) {
    const fall = ruin.falling;
    if (!fall) return false;
    deps.player.x = fall.x; deps.player.y = fall.y;
    deps.player.vx = 0; deps.player.vy = 0;
    const t = clamp((nowMs - fall.startedAt) / FALL_MS, 0, 1);
    if (deps.playerMesh?.position) deps.playerMesh.position.y = -1.8 * t;
    if (t >= 1) {
      deps.player.x = fall.safe.x; deps.player.y = fall.safe.y;
      deps.player.vx = 0; deps.player.vy = 0;
      ruin.lastAcceptedPx = { ...fall.safe };
      ruin.lastSafePx = { ...fall.safe };
      ruin.supportId = null; ruin.supportY = 0;
      ruin.falling = null;
      deps._snapCameraTarget?.();
    }
    return true;
  }

  function validCandidate(px, py, allowFall) {
    const info = positionInfo(px, py);
    if (info.blocker) return { ok: false, reason: 'blocker', info };
    if (info.pit && !info.support) return { ok: false, reason: allowFall ? 'fall' : 'pit', info };
    const nextY = info.support?.y ?? 0;
    const sameSurface = info.support?.id && info.support.id === ruin.supportId;
    if (!sameSurface && nextY - ruin.supportY > MAX_STEP_HEIGHT) return { ok: false, reason: 'step', info };
    return { ok: true, info, nextY };
  }

  function reconcilePlayer(nowMs) {
    if (handleFalling(nowMs)) return;
    const candidate = validCandidate(deps.player.x, deps.player.y, true);
    if (!candidate.ok) {
      if (candidate.reason === 'fall') {
        triggerFall(candidate.info, nowMs);
        handleFalling(nowMs);
        return;
      }
      const old = ruin.lastAcceptedPx;
      const tryX = validCandidate(deps.player.x, old.y, false);
      const tryY = validCandidate(old.x, deps.player.y, false);
      if (tryX.ok) deps.player.y = old.y;
      else if (tryY.ok) deps.player.x = old.x;
      else { deps.player.x = old.x; deps.player.y = old.y; }
    }

    const accepted = positionInfo(deps.player.x, deps.player.y);
    if (accepted.pit && !accepted.support) {
      triggerFall(accepted, nowMs);
      handleFalling(nowMs);
      return;
    }
    ruin.lastAcceptedPx = { x: deps.player.x, y: deps.player.y };
    if (!accepted.pit || accepted.support) ruin.lastSafePx = { ...ruin.lastAcceptedPx };
    ruin.supportId = accepted.support?.id || null;
    ruin.supportY = accepted.support?.y || 0;

    if (accepted.support && deps.playerMesh?.position) deps.playerMesh.position.y = accepted.support.y;
    if (accepted.support && deps.playerGroundShadow?.position) deps.playerGroundShadow.position.y = accepted.support.y + 0.012;
    updateControlPrompt(accepted.tileX, accepted.tileZ);
  }

  function updateMechanisms(dt) {
    for (const mechanism of ruin.mechanisms) mechanism.update?.(dt);
  }

  function beforeRender() {
    if (!deps || !ruin) return;
    if (deps.getCurrentArea?.() !== ARENA_ID) { clearRuin(); return; }
    const nowMs = performance.now();
    const dt = clamp((nowMs - frameLastMs) / 1000, 0, 0.05);
    frameLastMs = nowMs;
    updateMechanisms(dt);
    reconcilePlayer(nowMs);
  }

  function captureDeps(injectedDeps) {
    deps = injectedDeps;
    installSettingsButton();
    if (!removeFrameClient) removeFrameClient = DS.addBeforeRenderClient(beforeRender);
  }

  const nativeInit = DevSpawner.init;
  DevSpawner.init = function (injectedDeps) {
    captureDeps(injectedDeps);
    return nativeInit.call(this, injectedDeps);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSettingsButton, { once: true });
  else installSettingsButton();

  window.DevRandomRuin = Object.freeze({
    generate: seed => buildRuin((Number(seed) >>> 0) || randomSeed()),
    reroll: launchRandomRuin,
    clear: clearRuin,
    getState: () => ruin ? {
      seed: ruin.seed,
      originX: ruin.originX, originZ: ruin.originZ,
      supportId: ruin.supportId, supportY: ruin.supportY,
      falling: !!ruin.falling,
      mechanisms: ruin.mechanisms.map(m => ({ id: m.id, type: m.type, progress: m.state.progress, target: m.state.target })),
      dynamic: DS.debugSnapshot(),
    } : null,
  });
})();

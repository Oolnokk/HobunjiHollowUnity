// Dev Random Test Ruin — session-only playtest of the exact Debris-ifier V50
// interior generator. V50 owns the generated geometry/assets; this adapter only
// places that scene graph in the Testing Arena and gives its moving geometry
// gameplay support/blocker semantics through DynamicSurfaces.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  const DevSpawner = window.DevSpawner;
  if (!DS || !DevSpawner) {
    console.warn('[Random Test Ruin] requires DynamicSurfaces + DevSpawner');
    return;
  }

  const SCOPE = 'dev-random-ruin-v50';
  const ARENA_ID = DevSpawner.DEV_ARENA_ZONE_ID || 'map_dev_arena';
  const SOURCE_SHA = '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40';
  const PLAYER_RADIUS_TILES = 0.28;
  const MAX_STEP_HEIGHT = 0.42;
  const FALL_MS = 650;
  const CONTROL_RANGE = 1.65;

  let deps = null;
  let ruin = null;
  let pendingSeed = null;
  let generatorFrame = null;
  let generatorApi = null;
  let currentControl = null;
  let promptOwned = false;
  let previousControllerInteractDown = false;
  let frameLastMs = performance.now();
  let removeFrameClient = null;

  function devModeEnabled() {
    try { return localStorage.getItem('hobunjiDevMode') === '1'; }
    catch (_) { return false; }
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function randomSeed() {
    try {
      const data = new Uint32Array(1);
      crypto.getRandomValues(data);
      return data[0] >>> 0;
    } catch (_) {
      return ((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0);
    }
  }

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function removeGeneratorFrame() {
    generatorApi = null;
    if (generatorFrame) generatorFrame.remove();
    generatorFrame = null;
  }

  function clearRuin() {
    if (ruin?.localeRoot) ruin.localeRoot.removeFromParent?.();
    if (ruin?.particleRoot) ruin.particleRoot.removeFromParent?.();
    DS.clearScope(SCOPE);
    if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
    promptOwned = false;
    currentControl = null;
    ruin = null;
    removeGeneratorFrame();
    const badge = document.getElementById('devRandomRuinBadge');
    if (badge) badge.style.display = 'none';
  }

  async function ensureGeneratorFrame() {
    if (generatorApi && generatorFrame?.isConnected) return generatorApi;
    removeGeneratorFrame();

    const frame = document.createElement('iframe');
    frame.id = 'devRandomRuinGeneratorFrame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Keep the frame laid out (rather than display:none) so V50 can initialize its
    // renderer/canvas normally, while keeping the generator completely invisible.
    frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:16px;height:16px;opacity:0;pointer-events:none;border:0;z-index:-1;';
    frame.src = `tools/debris-ifier/index.html?devRuntime=1&t=${Date.now()}`;
    document.body.appendChild(frame);
    generatorFrame = frame;

    const started = performance.now();
    while (performance.now() - started < 15000) {
      try {
        const api = frame.contentWindow?.DebrisifierV50;
        if (api?.sourceSha256 === SOURCE_SHA) {
          generatorApi = api;
          return api;
        }
        const debug = frame.contentDocument?.getElementById('debug')?.textContent || '';
        if (/FAILED/i.test(debug)) throw new Error(debug);
      } catch (error) {
        if (/FAILED/i.test(String(error?.message || error))) throw error;
      }
      await wait(25);
    }
    throw new Error('Timed out while loading the exact Debris-ifier V50 runtime.');
  }

  function boxFor(object) {
    if (!object) return null;
    object.updateWorldMatrix?.(true, true);
    object.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    return box;
  }

  function xzBoundsFor(object) {
    const box = boxFor(object);
    if (!box) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  }

  function centerFor(object) {
    const box = boxFor(object);
    if (!box) return object?.getWorldPosition?.(new THREE.Vector3()) || new THREE.Vector3();
    return box.getCenter(new THREE.Vector3());
  }

  function topYFor(object) {
    return boxFor(object)?.max.y ?? 0;
  }

  function registerSurfaceForObject(id, object, options = {}) {
    DS.registerSurface({
      id, scope: SCOPE,
      bounds: () => xzBoundsFor(object),
      topY: () => topYFor(object),
      enabled: () => object.visible !== false && (options.enabled ? options.enabled() : true),
      priority: options.priority ?? 5,
    });
  }

  function registerBlockerForObject(id, object, options = {}) {
    DS.registerBlocker({
      id, scope: SCOPE,
      bounds: () => xzBoundsFor(object),
      enabled: () => object.visible !== false && (options.enabled ? options.enabled() : true),
      blocksAt: (_x, _z, actorHeight) => {
        const box = boxFor(object);
        if (!box) return false;
        if (options.clearanceAware) {
          const floorY = ruin?.supportY ?? 0;
          return box.min.y < floorY + actorHeight - 0.04;
        }
        return box.max.y - box.min.y > 0.12;
      },
    });
  }

  function floorCellBounds(meta, c, r) {
    const cs = Number(meta.cellSize) || 0.5;
    const ox = ruin.localeRoot.position.x - Number(meta.worldWidth || 0) / 2;
    const oz = ruin.localeRoot.position.z - Number(meta.worldDepth || 0) / 2;
    return {
      minX: ox + c * cs,
      maxX: ox + (c + 1) * cs,
      minZ: oz + r * cs,
      maxZ: oz + (r + 1) * cs,
    };
  }

  function registerFloorAndVoid(meta) {
    let floorMesh = null;
    ruin.localeRoot.traverse(object => {
      if (!floorMesh && object.userData?.wallBuilderRecipe === 'wallrecipe2.json') floorMesh = object;
    });
    const levelByCell = floorMesh?.userData?.plateauModel?.levelByCell || {};
    const stepHeight = Number(floorMesh?.userData?.plateauModel?.stepHeight ?? meta.plateauModel?.stepHeight ?? 0.42);
    const floorY = Number(meta.floorSurfaceY) || 0;
    const floorKeys = new Set();

    for (const pair of meta.floorCells || []) {
      const c = Number(pair?.[0]);
      const r = Number(pair?.[1]);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      const key = `${c},${r}`;
      floorKeys.add(key);
      const level = Number(levelByCell[key] || 0);
      DS.registerSurface({
        id: `v50-floor-${key}`, scope: SCOPE,
        bounds: () => floorCellBounds(meta, c, r),
        topY: floorY + level * stepHeight,
        priority: 1,
      });
    }

    // Anything inside V50's interior grid that is not part of its generated floor
    // is actual void. Wall omissions therefore cannot become accidental shortcuts.
    const cols = Number(meta.gridCols) || 0;
    const rows = Number(meta.gridRows) || 0;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const key = `${c},${r}`;
      if (floorKeys.has(key)) continue;
      DS.registerPit({ id: `v50-void-${key}`, scope: SCOPE, bounds: () => floorCellBounds(meta, c, r) });
    }
  }

  function findMechanismsAndCollision() {
    const mechanisms = new Map();
    const activators = [];
    const pushBlocks = [];
    const furnitureBlockers = [];
    const movingStairTreads = new Set();

    ruin.localeRoot.traverse(object => {
      const data = object.userData || {};
      const motion = data.previewMotion?.type;
      const mechanismId = data.mechanismId;
      if (mechanismId && ['bridge', 'bridgeSequence', 'stoneDoor', 'movingDais', 'collapsingStairs'].includes(motion)) {
        mechanisms.set(mechanismId, { id: mechanismId, root: object, type: motion, progress: 0, target: 0 });
      }
      if (data.linkedMechanismId && data.activatorType) activators.push(object);
      if (data.pushable && motion === 'pushPuzzleBlock') pushBlocks.push(object);
      if (data.immovable || data.pushPuzzleStopper) furnitureBlockers.push(object);

      if (data.ruinInteriorWall) registerBlockerForObject(`v50-wall-${object.id}`, object);
      const role = String(data.interiorRuinRole || '');
      if (/ceiling support pillar|doorway flank pillar|sunken centerpiece|wall display artifice/i.test(role)) {
        furnitureBlockers.push(object);
      }

      if (data.generatedAccessType === 'stoneStair') {
        for (const tread of data.stairTreads || object.children || []) {
          if (!tread?.isObject3D || movingStairTreads.has(tread)) continue;
          movingStairTreads.add(tread);
          registerSurfaceForObject(`v50-stair-${tread.id}`, tread, { priority: 7 });
        }
      }
    });

    for (const [id, mechanism] of mechanisms) {
      const { root, type } = mechanism;
      if (type === 'bridge' || type === 'bridgeSequence') {
        registerSurfaceForObject(`v50-mech-surface-${id}`, root, { priority: 10 });
      } else if (type === 'movingDais') {
        const platform = root.userData.movingDaisPlatform || root;
        registerSurfaceForObject(`v50-mech-surface-${id}`, platform, { priority: 12 });
      } else if (type === 'collapsingStairs') {
        for (const tread of root.userData.stairTreads || []) {
          if (movingStairTreads.has(tread)) continue;
          movingStairTreads.add(tread);
          registerSurfaceForObject(`v50-mech-stair-${id}-${tread.id}`, tread, { priority: 12 });
        }
      } else if (type === 'stoneDoor') {
        registerBlockerForObject(`v50-mech-door-${id}`, root, { clearanceAware: true });
      }
    }

    for (const object of furnitureBlockers) {
      if (object.userData.__devRuinBlockerId) continue;
      const id = `v50-solid-${object.id}`;
      object.userData.__devRuinBlockerId = id;
      registerBlockerForObject(id, object);
    }

    for (const block of pushBlocks) {
      const id = `v50-push-${block.id}`;
      block.userData.__devRuinBlockerId = id;
      registerBlockerForObject(id, block);
    }

    ruin.mechanisms = mechanisms;
    ruin.activators = activators;
    ruin.pushBlocks = pushBlocks;
    buildActualInteractionControls();
  }

  function isNestedActivatorDuplicate(object) {
    return object.children?.some(child => child.userData?.linkedMechanismId === object.userData?.linkedMechanismId
      && child.userData?.activatorType === object.userData?.activatorType);
  }

  function buildActualInteractionControls() {
    ruin.controls.length = 0;

    // Linked cube controls use the four actual rotating V50 cubes, not a proxy switch.
    ruin.localeRoot.traverse(object => {
      if (object.userData?.activatorType !== 'linkedCubePillars' || !object.userData?.interactive3D) return;
      const labels = object.userData.labels || ['A', 'B', 'C', 'D'];
      for (const entry of object.userData.rotatingSegments || []) {
        if (!entry?.segment) continue;
        ruin.controls.push({
          kind: 'linkedCube', object: entry.segment,
          label: `Rotate Cube ${labels[entry.controlIndex] || entry.controlIndex + 1}`,
          onPress: () => ruin.api.rotateLinkedCube(object, entry.controlIndex, 1),
        });
      }
    });

    for (const activator of ruin.activators) {
      const type = activator.userData.activatorType;
      if (type === 'linkedCubePillars' || type === 'pressurePlate' || isNestedActivatorDuplicate(activator)) continue;
      const mechanismId = activator.userData.linkedMechanismId;
      const mechanism = ruin.mechanisms.get(mechanismId);
      if (!mechanism) continue;
      const properVerb = type === 'stackedObelisk' ? 'Turn Obelisk'
        : type === 'brazier' ? 'DEV Ignite Brazier'
        : type === 'glyphObelisk' ? 'DEV Trigger Glyph'
        : type === 'torch' ? 'DEV Toggle Torch'
        : `Activate ${type}`;
      ruin.controls.push({
        kind: type, object: activator, label: properVerb,
        onPress: () => {
          mechanism.target = mechanism.target > 0.5 ? 0 : 1;
          activator.userData.__devActivationTarget = mechanism.target;
        },
      });
    }

    for (const block of ruin.pushBlocks) {
      ruin.controls.push({ kind: 'pushBlock', object: block, label: 'Push Stone Block', onPress: () => pushBlockAwayFromPlayer(block) });
    }
  }

  function inferPushStep(block) {
    const path = block.userData?.pushPath;
    if (Array.isArray(path) && path.length > 1) {
      let best = Infinity;
      for (let i = 1; i < path.length; i++) {
        const d = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
        if (d > 0.05) best = Math.min(best, d);
      }
      if (Number.isFinite(best)) return best;
    }
    return Number(ruin.meta.cellSize) || 0.5;
  }

  function pushBlockAwayFromPlayer(block) {
    if (!ruin || ruin.falling) return false;
    const center = centerFor(block);
    const px = deps.player.x / deps.TILE;
    const pz = deps.player.y / deps.TILE;
    const dx = center.x - px;
    const dz = center.z - pz;
    let dirX = 0, dirZ = 0;
    if (Math.abs(dx) >= Math.abs(dz)) dirX = Math.sign(dx) || 1;
    else dirZ = Math.sign(dz) || 1;
    const step = inferPushStep(block);
    const destX = center.x + dirX * step;
    const destZ = center.z + dirZ * step;
    const support = DS.sampleSupport(destX, destZ, { minY: -4, maxY: 5, pad: 0.02 });
    if (!support) { deps.showToast?.('The block cannot be pushed there.', false); return false; }
    const hereSupport = DS.sampleSupport(center.x, center.z, { minY: -4, maxY: 5, pad: 0.02 });
    if (hereSupport && Math.abs(support.y - hereSupport.y) > 0.08) {
      deps.showToast?.('The push block needs a flat tier.', false); return false;
    }
    const blocked = DS.blockerAt(destX, destZ, { radius: 0.06, actorHeight: 1 });
    if (blocked && blocked.id !== block.userData.__devRuinBlockerId) {
      deps.showToast?.('Something blocks the stone block.', false); return false;
    }
    block.position.x += dirX * step;
    block.position.z += dirZ * step;
    block.updateMatrixWorld?.(true);
    ruin.api.syncPressurePlates(ruin.localeRoot);
    return true;
  }

  function entranceLocalPoint(meta) {
    const e = meta.entrance;
    if (!e) return { x: 0, z: 0, side: 'south' };
    const cs = Number(meta.cellSize) || 0.5;
    const ox = -Number(meta.worldWidth || 0) / 2;
    const oz = -Number(meta.worldDepth || 0) / 2;
    if (e.axis === 'x') return { x: Number(e.boundary) * cs + ox, z: Number(e.center) * cs + oz, side: e.side };
    return { x: Number(e.center) * cs + ox, z: Number(e.boundary) * cs + oz, side: e.side };
  }

  function spawnInsideEntrance(meta) {
    const local = entranceLocalPoint(meta);
    const inward = {
      north: { x: 0, z: 1 }, south: { x: 0, z: -1 },
      west: { x: 1, z: 0 }, east: { x: -1, z: 0 },
    }[local.side] || { x: 0, z: 1 };
    const inset = Math.max(0.7, (Number(meta.cellSize) || 0.5) * 1.5);
    return {
      x: ruin.localeRoot.position.x + local.x + inward.x * inset,
      z: ruin.localeRoot.position.z + local.z + inward.z * inset,
    };
  }

  function placeGeneratedRoot(meta) {
    const cols = Number(deps.COLS) || 60;
    const rows = Number(deps.ROWS) || 50;
    const halfW = Number(meta.worldWidth || 1) / 2;
    const halfD = Number(meta.worldDepth || 1) / 2;
    const playerX = deps.player.x / deps.TILE;
    const playerZ = deps.player.y / deps.TILE;
    const margin = 1.5;
    const minX = halfW + margin, maxX = cols - halfW - margin;
    const minZ = halfD + margin, maxZ = rows - halfD - margin;
    ruin.localeRoot.position.set(
      minX <= maxX ? clamp(playerX, minX, maxX) : cols / 2,
      0,
      minZ <= maxZ ? clamp(playerZ, minZ, maxZ) : rows / 2
    );
    ruin.localeRoot.updateMatrixWorld?.(true);
  }

  async function buildRuin(seed) {
    const scene = deps?.getActiveScene?.();
    if (!scene || deps.getCurrentArea?.() !== ARENA_ID) return false;
    clearRuin();

    const button = document.getElementById('devRandomTestRuinBtn');
    if (button) { button.disabled = true; button.textContent = 'Generating…'; }
    try {
      const api = await ensureGeneratorFrame();
      const generated = await api.generateInteriorLocale({
        seed: `dev-${seed.toString(36)}`,
        size: 'medium', density: 62, roomMin: 3, roomMax: 6,
      });
      const meta = generated.locale?.meta?.interiorShell;
      if (!meta) throw new Error('V50 generated no interiorShell metadata.');

      // Freeze V50's global all-mechanisms preview driver before moving its exact
      // scene graph into the game. Runtime updates below drive each mechanism.
      api.snapMechanismState(0);
      api.pausePreviewLoop();
      const roots = api.takePreviewRoots();

      ruin = {
        seed, sourceSeed: generated.seed, api,
        locale: generated.locale, meta,
        localeRoot: roots.localeRoot, particleRoot: roots.particleRoot,
        controls: [], activators: [], pushBlocks: [], mechanisms: new Map(),
        falling: null, supportId: null, supportY: 0,
        lastAcceptedPx: { x: deps.player.x, y: deps.player.y },
        lastSafePx: { x: deps.player.x, y: deps.player.y },
      };

      ruin.localeRoot.name = `dev_v50_ruin_${seed}`;
      scene.add(ruin.localeRoot);
      // V50 particles are emitted at host WORLD coordinates, so their root remains
      // at game-scene origin rather than inheriting the ruin's translation twice.
      ruin.particleRoot.position.set(0, 0, 0);
      scene.add(ruin.particleRoot);
      placeGeneratedRoot(meta);
      registerFloorAndVoid(meta);
      findMechanismsAndCollision();

      const spawn = spawnInsideEntrance(meta);
      deps.player.x = spawn.x * deps.TILE;
      deps.player.y = spawn.z * deps.TILE;
      deps.player.vx = 0;
      deps.player.vy = 0;
      const startSupport = DS.sampleSupport(spawn.x, spawn.z, { minY: -4, maxY: 5, pad: 0.02 });
      ruin.supportId = startSupport?.id || null;
      ruin.supportY = startSupport?.y || 0;
      ruin.lastAcceptedPx = { x: deps.player.x, y: deps.player.y };
      ruin.lastSafePx = { ...ruin.lastAcceptedPx };
      if (deps.playerMesh?.position) deps.playerMesh.position.y = ruin.supportY;
      deps._snapCameraTarget?.();
      updateBadge();

      const movingCount = ruin.mechanisms.size;
      deps.showToast?.(`V50 Random Test Ruin #${seed} · ${meta.rooms?.length || 0} rooms · ${movingCount} mechanisms.`, true);
      window.__farmLog?.(`[random-ruin:v50] seed=${seed} source=${generated.seed} rooms=${meta.rooms?.length || 0} mechanisms=${movingCount} sourceSha=${SOURCE_SHA}`, 'debug');
      return true;
    } catch (error) {
      console.error('[Random Test Ruin] V50 generation failed', error);
      deps?.showToast?.(`Random Test Ruin failed: ${error.message}`, false);
      clearRuin();
      return false;
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Generate'; }
    }
  }

  function updateBadge() {
    if (!ruin) return;
    let badge = document.getElementById('devRandomRuinBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'devRandomRuinBadge';
      badge.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:65;padding:6px 9px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(12,14,12,.82);color:#ddd;font:11px DM Mono,monospace;pointer-events:none;max-width:min(560px,calc(100vw - 20px));';
      document.body.appendChild(badge);
    }
    badge.textContent = `V50 TEST RUIN · seed ${ruin.seed} · ${ruin.meta.rooms?.length || 0} rooms · ${ruin.mechanisms.size} mechanisms · exact source ${SOURCE_SHA.slice(0, 8)}`;
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
    row.innerHTML = `<div class="settings-label"><div class="settings-name">Random Test Ruin</div><div class="settings-desc">Generate the exact Debris-ifier V50 interior in the Test Arena from a fresh session-only seed. Uses V50 repo furniture, architecture, debris and puzzle assets; nothing is saved.</div></div><button type="button" id="devRandomTestRuinBtn" class="settings-small-btn">Generate</button>`;
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

  function controlPoint(control) { return centerFor(control.object); }

  function updateControlPrompt(px, pz) {
    let nearest = null;
    let bestD2 = CONTROL_RANGE * CONTROL_RANGE;
    for (const control of ruin.controls) {
      const point = controlPoint(control);
      const dx = point.x - px, dz = point.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) { bestD2 = d2; nearest = control; }
    }
    currentControl = nearest;
    if (nearest) {
      window.ActionPromptUI?.showActionPrompt?.({
        actionId: 'interact', touchIcon: '✋', verb: nearest.label,
        onPress: () => nearest.onPress?.(),
        statusText: `DEV V50 RUIN · ${nearest.kind}`,
        statusType: '',
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
    return DS.sampleSupport(tileX, tileZ, { minY: -4, maxY: 5, pad: 0.02 });
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
    deps.player.vx = 0;
    deps.player.vy = 0;
    window.ResourceSystem?.spendFooting?.(deps.player, 35, 'V50 test ruin fall');
    deps.showToast?.('Fell from the test ruin.', false);
  }

  function handleFalling(nowMs) {
    const fall = ruin.falling;
    if (!fall) return false;
    deps.player.x = fall.x;
    deps.player.y = fall.y;
    deps.player.vx = 0;
    deps.player.vy = 0;
    const t = clamp((nowMs - fall.startedAt) / FALL_MS, 0, 1);
    if (deps.playerMesh?.position) deps.playerMesh.position.y = ruin.supportY - 1.8 * t;
    if (t >= 1) {
      deps.player.x = fall.safe.x;
      deps.player.y = fall.safe.y;
      ruin.lastAcceptedPx = { ...fall.safe };
      ruin.lastSafePx = { ...fall.safe };
      ruin.supportId = null;
      ruin.supportY = 0;
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
    ruin.api.syncPressurePlates(ruin.localeRoot);
    ruin.api.tickRuntime(dt);
    for (const mechanism of ruin.mechanisms.values()) {
      const linkedPlate = mechanism.root.userData?.linkedPressurePlateRoot;
      const linkedCube = mechanism.root.userData?.linkedCubePuzzleRoot;
      if (!linkedPlate && !linkedCube) {
        const maxStep = dt * 1.55;
        mechanism.progress += clamp(mechanism.target - mechanism.progress, -maxStep, maxStep);
      }
      ruin.api.applyProgress(mechanism.root, mechanism.progress);
    }
    for (const activator of ruin.activators) {
      const id = activator.userData?.linkedMechanismId;
      const mechanism = ruin.mechanisms.get(id);
      if (!mechanism || ['pressurePlate', 'linkedCubePillars'].includes(activator.userData?.activatorType)) continue;
      ruin.api.applyProgress(activator, mechanism.progress);
    }
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
      sourceSeed: ruin.sourceSeed,
      sourceSha256: SOURCE_SHA,
      localeId: ruin.locale?.id || null,
      rooms: ruin.meta.rooms?.length || 0,
      supportId: ruin.supportId,
      supportY: ruin.supportY,
      falling: !!ruin.falling,
      controls: ruin.controls.length,
      mechanisms: [...ruin.mechanisms.values()].map(m => ({ id: m.id, type: m.type, progress: m.progress, target: m.target })),
      dynamic: DS.debugSnapshot(),
    } : null,
  });
})();

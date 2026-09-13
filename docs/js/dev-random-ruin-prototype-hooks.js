// Dev Random Test Ruin — V50 prototype hook coverage, batch 1.
// Loaded after DynamicSurfaces and before dev-random-ruin-interior-map.js so
// keyboard interaction priority can be claimed for prototype-only controls,
// while the frame client is installed later (after the base adapter) and can
// present its prompt last. This module deliberately augments the base adapter
// instead of duplicating its linked-cube/mechanism/push-block implementation.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  const DevSpawner = window.DevSpawner;
  if (!DS || !DevSpawner) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const SCOPE = 'dev-random-ruin-prototype-hooks';
  const CONTROL_RANGE = 1.65;
  const DOOR_OPEN_SPEED = 3.6;
  const DOOR_AUTO_CLOSE_DISTANCE = 1.05;
  const LADDER_SAMPLE_OFFSETS = [0.34, 0.52, 0.72, 0.92];
  const KNOWN_MOTIONS = new Set([
    'bridge', 'bridgeSequence', 'stoneDoor', 'movingDais', 'collapsingStairs',
    'pushPuzzleBlock', 'elevatorPushBlock', 'pressurePlate', 'torch', 'brazier',
    'signalObelisk', 'rotatingObelisk', 'linkedCubePair',
  ]);
  const KNOWN_ACTIVATORS = new Set([
    'pressurePlate', 'torch', 'brazier', 'glyphObelisk', 'stackedObelisk', 'linkedCubePillars',
  ]);

  let deps = null;
  let root = null;
  let extraControls = [];
  let transitDoors = [];
  let ladders = [];
  let audit = emptyAudit();
  let nearestExtraControl = null;
  let promptOwned = false;
  let previousControllerInteractDown = false;
  let frameClientInstalled = false;
  let wrapperInstalled = false;
  let buildSerial = 0;

  function emptyAudit() {
    return {
      seed: null,
      rootName: null,
      discovered: {},
      handled: [],
      pendingBatches: [],
      unhandled: [],
      surfacesAdded: 0,
      blockersAdded: 0,
      controlsAdded: 0,
      builtAt: 0,
    };
  }

  function captureDeps(injectedDeps) { deps = injectedDeps; }
  const nativeDevInit = DevSpawner.init;
  DevSpawner.init = function (injectedDeps) {
    captureDeps(injectedDeps);
    return nativeDevInit.call(this, injectedDeps);
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
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
  function boundsFor(object) {
    const box = boxFor(object);
    return box ? { minX:box.min.x, maxX:box.max.x, minZ:box.min.z, maxZ:box.max.z }
      : { minX:0, maxX:0, minZ:0, maxZ:0 };
  }
  function currentPlayerWorld() {
    if (!deps?.player || !deps?.TILE) return null;
    return { x: deps.player.x / deps.TILE, z: deps.player.y / deps.TILE };
  }
  function currentSupportY() {
    const p = currentPlayerWorld();
    if (!p) return 0;
    return Number(deps?.playerMesh?.position?.y ?? DS.sampleSupport(p.x, p.z, { minY:-8, maxY:12, pad:.02 })?.y ?? 0);
  }
  function recordCount(key) {
    audit.discovered[key] = (audit.discovered[key] || 0) + 1;
  }
  function recordHandled(key) {
    if (!audit.handled.includes(key)) audit.handled.push(key);
  }
  function recordPending(key) {
    if (!audit.pendingBatches.includes(key)) audit.pendingBatches.push(key);
  }
  function recordUnhandled(object, reason) {
    const d = object?.userData || {};
    const item = {
      objectName: object?.name || `object-${object?.id ?? '?'}`,
      reason,
      previewMotion: d.previewMotion?.type || null,
      activatorType: d.activatorType || null,
      mechanismId: d.mechanismId || null,
      linkedMechanismId: d.linkedMechanismId || null,
      generatedAccessType: d.generatedAccessType || null,
    };
    if (!audit.unhandled.some(entry => JSON.stringify(entry) === JSON.stringify(item))) audit.unhandled.push(item);
  }

  function registerSurface(id, object, priority = 8) {
    DS.registerSurface({ id, scope:SCOPE, bounds:() => boundsFor(object), topY:() => boxFor(object)?.max.y ?? 0,
      enabled:() => object.visible !== false, priority });
    audit.surfacesAdded++;
  }
  function registerBlocker(id, object, blocksAt = null) {
    DS.registerBlocker({ id, scope:SCOPE, bounds:() => boundsFor(object), enabled:() => object.visible !== false,
      ...(blocksAt ? { blocksAt } : {}) });
    audit.blockersAdded++;
  }
  function addControl(control) {
    extraControls.push(control);
    audit.controlsAdded++;
    return control;
  }

  function nearestSurfaceCandidate(x, z, currentY, preferUp) {
    const samples = [];
    const tryPoint = (sx, sz) => {
      const high = DS.sampleSupport(sx, sz, { minY:currentY + 0.12, maxY:currentY + 4.5, pad:.03 });
      const low = DS.sampleSupport(sx, sz, { minY:currentY - 4.5, maxY:currentY - 0.12, pad:.03 });
      if (high) samples.push({ ...high, x:sx, z:sz, delta:high.y-currentY });
      if (low) samples.push({ ...low, x:sx, z:sz, delta:low.y-currentY });
    };
    tryPoint(x, z);
    if (!samples.length) return null;
    const desired = samples.filter(item => preferUp ? item.delta > 0 : item.delta < 0);
    const pool = desired.length ? desired : samples;
    pool.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return pool[0] || null;
  }

  function ladderSideSamples(ladder) {
    const center = centerFor(ladder);
    const box = boxFor(ladder);
    if (!box) return [];
    // Stone ladders are very thin along local X and broad along local Z. After
    // rotation, the thinner world axis is the wall-normal direction. Sample
    // both sides of that normal so a ladder works regardless of authored yaw.
    const widthX = box.max.x - box.min.x;
    const widthZ = box.max.z - box.min.z;
    const normal = widthX <= widthZ ? { x:1, z:0 } : { x:0, z:1 };
    const out = [];
    for (const distance of LADDER_SAMPLE_OFFSETS) {
      out.push({ x:center.x + normal.x*distance, z:center.z + normal.z*distance });
      out.push({ x:center.x - normal.x*distance, z:center.z - normal.z*distance });
    }
    return out;
  }

  function climbLadder(ladder) {
    if (!deps?.player || !deps?.TILE) return false;
    const p = currentPlayerWorld();
    const currentY = currentSupportY();
    const ladderBox = boxFor(ladder);
    if (!p || !ladderBox) return false;
    const midY = (ladderBox.min.y + ladderBox.max.y) * .5;
    const preferUp = currentY <= midY;
    let best = null;
    for (const sample of ladderSideSamples(ladder)) {
      const candidate = nearestSurfaceCandidate(sample.x, sample.z, currentY, preferUp);
      if (!candidate) continue;
      const horizontal = Math.hypot(sample.x - p.x, sample.z - p.z);
      const score = Math.abs(candidate.delta) * 4 - horizontal;
      if (!best || score > best.score) best = { ...candidate, score };
    }
    if (!best) {
      deps.showToast?.('No valid landing surface was found for this ladder.', false);
      return false;
    }
    deps.player.x = best.x * deps.TILE;
    deps.player.y = best.z * deps.TILE;
    deps.player.vx = 0;
    deps.player.vy = 0;
    if (deps.playerMesh?.position) deps.playerMesh.position.y = best.y;
    deps._snapCameraTarget?.();
    deps.showToast?.(best.delta > 0 ? 'Climbed the stone ladder.' : 'Climbed down the stone ladder.', true);
    return true;
  }

  function doorNormal(door) {
    const q = door.getWorldQuaternion?.(new THREE.Quaternion()) || new THREE.Quaternion();
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    normal.y = 0;
    return normal.lengthSq() > .0001 ? normal.normalize() : new THREE.Vector3(0, 0, 1);
  }
  function playerDoorSide(door) {
    const p = currentPlayerWorld();
    if (!p) return 0;
    const c = centerFor(door), n = doorNormal(door);
    return Math.sign((p.x-c.x)*n.x + (p.z-c.z)*n.z) || 1;
  }
  function toggleTransitDoor(state) {
    state.targetOpen = state.targetOpen > .5 ? 0 : 1;
    if (state.targetOpen) {
      state.openedFromSide = playerDoorSide(state.root);
      state.openedAt = performance.now();
    }
  }
  function updateTransitDoor(state, dt) {
    const step = clamp(dt * DOOR_OPEN_SPEED, 0, 1);
    state.open += (state.targetOpen - state.open) * step;
    if (Math.abs(state.open-state.targetOpen) < .002) state.open = state.targetOpen;
    state.root.scale.y = state.fullScaleY * (1 - state.open * .94);
    state.root.updateMatrixWorld?.(true);
    if (state.targetOpen < .5 || state.open < .85 || !deps?.player || !deps?.TILE) return;
    const c = centerFor(state.root);
    const p = currentPlayerWorld();
    const distance = Math.hypot(p.x-c.x, p.z-c.z);
    const side = playerDoorSide(state.root);
    if ((state.openedFromSide && side !== state.openedFromSide && distance > .42) || distance > DOOR_AUTO_CLOSE_DISTANCE) {
      state.targetOpen = 0;
    }
  }

  function installStoneStair(stair) {
    const motion = stair.userData?.previewMotion?.type;
    if (motion === 'collapsingStairs') {
      recordHandled('moving/collapsing stone stairs (base adapter)');
      return;
    }
    let treadCount = 0;
    for (const child of stair.children || []) {
      if (!child?.isMesh) continue;
      registerSurface(`devruin-static-stair-${stair.id}-${child.id}`, child, 9);
      treadCount++;
    }
    if (!treadCount) registerSurface(`devruin-static-stair-${stair.id}`, stair, 9);
    recordCount('stoneStair');
    recordHandled('static stone stairs');
  }

  function installStoneLadder(ladder) {
    ladders.push(ladder);
    recordCount('stoneLadder');
    recordHandled('stone ladders / recovery ladders');
    addControl({ kind:'ladder', object:ladder, label:'Climb Stone Ladder', onPress:() => climbLadder(ladder) });
  }

  function installTransitDoor(door) {
    const state = {
      root:door,
      open:0,
      targetOpen:0,
      fullScaleY:Number(door.scale?.y) || 1,
      openedFromSide:0,
      openedAt:0,
    };
    door.userData.__devRuinTransitDoorState = state;
    transitDoors.push(state);
    recordCount('transitDoor');
    recordHandled('plain hallway transit doors');
    recordPending('transit-door passage reset semantics (combat/puzzle reset audit, later batch)');
    registerBlocker(`devruin-transit-door-${door.id}`, door, () => state.open < .78);
    addControl({ kind:'transitDoor', object:door,
      get label() { return state.targetOpen > .5 ? 'Close Stone Door' : 'Open Stone Door'; },
      onPress:() => toggleTransitDoor(state) });
  }

  function installStaticDais(dais) {
    recordCount('staticPuzzleDais');
    recordHandled('static puzzle dais support');
    const mesh = (dais.children || []).find(child => child?.isMesh) || dais;
    registerSurface(`devruin-static-dais-${dais.id}`, mesh, 9);
  }

  function installElevatorSocket(socket) {
    recordCount('elevatorWellSocket');
    recordHandled('elevator well/socket structure');
    // The socket is a rim/shaft wall, not one giant support plane. Each mesh
    // is a blocker; the moving dais itself remains the support surface.
    for (const child of socket.children || []) if (child?.isMesh)
      registerBlocker(`devruin-elevator-socket-${socket.id}-${child.id}`, child);
  }

  function installElevatorPushBlock(block) {
    recordCount('elevatorPushBlock');
    recordHandled('elevator-riding push block discovery');
    registerBlocker(`devruin-elevator-push-${block.id}`, block);
    recordPending('moving-platform rider transfer for elevator push blocks (batch 3)');
  }

  function classifyKnownPrototype(object) {
    const d = object.userData || {};
    const motion = d.previewMotion?.type || null;
    const activator = d.activatorType || null;
    let handled = false;

    if (d.generatedAccessType === 'stoneStair') { installStoneStair(object); handled = true; }
    if (d.generatedAccessType === 'stoneLadder') { installStoneLadder(object); handled = true; }
    if (d.transitDoor) { installTransitDoor(object); handled = true; }
    if (d.staticPuzzleDais) { installStaticDais(object); handled = true; }
    if (d.elevatorWellSocket) { installElevatorSocket(object); handled = true; }
    if (motion === 'elevatorPushBlock') { installElevatorPushBlock(object); handled = true; }

    if (motion && KNOWN_MOTIONS.has(motion)) {
      recordCount(`motion:${motion}`);
      recordHandled(`motion:${motion}`);
      handled = true;
      if (['bridge','bridgeSequence','stoneDoor','movingDais','collapsingStairs'].includes(motion))
        recordPending('continuous dynamic-surface/blocker + rider pass (batch 3)');
      if (['torch','brazier'].includes(motion)) recordPending('torch/brazier physical ignition pass (batch 2)');
    }
    if (activator && KNOWN_ACTIVATORS.has(activator)) {
      recordCount(`activator:${activator}`);
      recordHandled(`activator:${activator}`);
      handled = true;
      if (activator === 'glyphObelisk') recordPending('projectile-only glyph hit pass (batch 2)');
      if (activator === 'brazier' || activator === 'torch') recordPending('torch/brazier physical ignition pass (batch 2)');
    }
    if (d.mechanismId || d.linkedMechanismId) handled = true; // Base adapter owns mechanism linkage today.

    const gameplayTagged = !!(
      motion || activator || d.mechanismId || d.linkedMechanismId || d.pushable || d.solutionBlock ||
      d.generatedAccessType || d.transitDoor || d.staticPuzzleDais || d.elevatorWellSocket ||
      d.carriesActorsAndPushBlocks || d.groundedToMovingPlatform
    );
    if (gameplayTagged && !handled) recordUnhandled(object, 'runtime-tagged V50 object has no batch-1 hook');
  }

  function buildAuditForRoot(nextRoot) {
    clearHookState(false);
    root = nextRoot;
    audit = emptyAudit();
    audit.rootName = root?.name || null;
    const baseState = window.DevRandomRuin?.getState?.();
    audit.seed = baseState?.seed ?? null;
    root?.traverse?.(classifyKnownPrototype);
    audit.builtAt = Date.now();
    updateBadge();
    reportAudit();
  }

  function reportAudit() {
    const summary = `[Random Test Ruin hooks] ${audit.handled.length} hook classes; ${audit.surfacesAdded} surfaces; ${audit.blockersAdded} blockers; ${audit.controlsAdded} controls; ${audit.unhandled.length} unhandled.`;
    window.__farmLog?.(summary, audit.unhandled.length ? 'warn' : 'world');
    if (audit.unhandled.length) {
      console.warn(summary, audit.unhandled);
      deps?.showToast?.(`Ruin prototype audit found ${audit.unhandled.length} unhandled runtime-tagged object${audit.unhandled.length===1?'':'s'}.`, false);
    } else {
      console.info(summary, audit);
    }
  }

  function updateBadge() {
    const badge = document.getElementById('devRandomRuinBadge');
    if (!badge || !root) return;
    const base = badge.dataset.prototypeHookBase || badge.textContent;
    badge.dataset.prototypeHookBase = base;
    badge.textContent = `${base} · hooks ${audit.controlsAdded}/${audit.surfacesAdded}/${audit.blockersAdded} · unhandled ${audit.unhandled.length}`;
  }

  function clearHookState(resetAudit = true) {
    DS.clearScope(SCOPE);
    root = null;
    extraControls = [];
    transitDoors = [];
    ladders = [];
    nearestExtraControl = null;
    previousControllerInteractDown = false;
    if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
    promptOwned = false;
    if (resetAudit) audit = emptyAudit();
  }

  function controlPoint(control) {
    return centerFor(control.object);
  }
  function updateExtraPrompt() {
    if (!root || deps?.getCurrentArea?.() !== MAP_ID || !deps?.player || !deps?.TILE) {
      nearestExtraControl = null;
      return;
    }
    const p = currentPlayerWorld();
    let nearest = null;
    let best = CONTROL_RANGE * CONTROL_RANGE;
    for (const control of extraControls) {
      const point = controlPoint(control);
      const distanceSq = (point.x-p.x)**2 + (point.z-p.z)**2;
      if (distanceSq <= best) { best = distanceSq; nearest = control; }
    }
    nearestExtraControl = nearest;
    if (!nearest) {
      if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
      promptOwned = false;
      previousControllerInteractDown = false;
      return;
    }
    const label = typeof nearest.label === 'function' ? nearest.label() : nearest.label;
    window.ActionPromptUI?.showActionPrompt?.({
      actionId:'interact', touchIcon:'✋', verb:label, onPress:nearest.onPress,
      statusText:`DEV RUIN · ${nearest.kind}`, statusType:'',
    });
    promptOwned = true;

    const bind = window.InputBindings?.getCurrentBindings?.()?.controller?.interact;
    const index = String(bind || '').startsWith('Button') ? Number(String(bind).slice(6)) : NaN;
    let down = false;
    if (Number.isInteger(index)) for (const pad of navigator.getGamepads?.() || [])
      if (pad?.buttons?.[index]?.pressed) down = true;
    if (down && !previousControllerInteractDown) nearest.onPress?.();
    previousControllerInteractDown = down;
  }

  // Registered before the base adapter's own capture listener. We only stop
  // propagation when one of our genuinely-extra controls is focused; all base
  // linked-cube/push-block/activator interactions continue to its listener.
  document.addEventListener('keydown', event => {
    if (!nearestExtraControl || deps?.getCurrentArea?.() !== MAP_ID) return;
    const bind = window.InputBindings?.getCurrentBindings?.()?.desktop?.interact;
    if (!bind || String(bind).split('+').pop().trim() !== event.code) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    nearestExtraControl.onPress?.();
  }, true);

  function frameUpdate() {
    if (!root || deps?.getCurrentArea?.() !== MAP_ID) return;
    const now = performance.now();
    const last = frameUpdate._last || now;
    const dt = clamp((now-last)/1000, 0, .05);
    frameUpdate._last = now;
    for (const door of transitDoors) updateTransitDoor(door, dt);
    updateExtraPrompt(); // Installed after the base adapter so our prompt wins only for extra controls.
  }

  async function waitForGeneratedRoot(serial) {
    const started = performance.now();
    while (serial === buildSerial && performance.now() - started < 4500) {
      if (deps?.getCurrentArea?.() === MAP_ID) {
        const scene = deps.getActiveScene?.();
        let found = null;
        scene?.traverse?.(object => { if (!found && String(object.name || '').startsWith('dev_v50_ruin_')) found = object; });
        if (found) return found;
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return null;
  }

  async function attachAfterGenerate() {
    const serial = ++buildSerial;
    const found = await waitForGeneratedRoot(serial);
    if (!found || serial !== buildSerial) return false;
    buildAuditForRoot(found);
    return true;
  }

  function wrapDevRuin() {
    if (wrapperInstalled || !window.DevRandomRuin) return false;
    const base = window.DevRandomRuin;
    const wrappedGenerate = async (...args) => {
      clearHookState();
      const result = await base.generate(...args);
      if (result) attachAfterGenerate();
      return result;
    };
    const wrappedReroll = async (...args) => {
      clearHookState();
      const result = await base.reroll(...args);
      if (result) attachAfterGenerate();
      return result;
    };
    window.DevRandomRuin = Object.freeze({
      ...base,
      generate: wrappedGenerate,
      reroll: wrappedReroll,
      clear: (...args) => { clearHookState(); return base.clear(...args); },
      leave: (...args) => { clearHookState(); return base.leave(...args); },
      getState: () => {
        const state = base.getState?.();
        return state ? { ...state, prototypeHooks: snapshot() } : null;
      },
    });
    wrapperInstalled = true;
    return true;
  }

  function snapshot() {
    return {
      active: !!root,
      rootName: root?.name || null,
      extraControls: extraControls.map(control => ({ kind:control.kind, object:control.object?.name || control.object?.id || null })),
      transitDoors: transitDoors.length,
      ladders: ladders.length,
      audit: JSON.parse(JSON.stringify(audit)),
    };
  }

  // The base adapter is the next parser-time script. Delay installation so it
  // has already registered its DynamicSurfaces frame client; ours then runs
  // afterward and can add only the missing prototype behaviors.
  setTimeout(() => {
    let attempts = 0;
    const install = () => {
      attempts++;
      if (wrapDevRuin()) {
        if (!frameClientInstalled) {
          DS.addBeforeRenderClient(frameUpdate);
          frameClientInstalled = true;
        }
        return;
      }
      if (attempts < 100) setTimeout(install, 25);
      else console.warn('[Random Test Ruin hooks] DevRandomRuin never became available.');
    };
    install();
  }, 0);

  window.DevRandomRuinPrototypeHooks = Object.freeze({
    rebuild: () => { if (root) buildAuditForRoot(root); },
    snapshot,
    clear: () => clearHookState(),
  });
})();

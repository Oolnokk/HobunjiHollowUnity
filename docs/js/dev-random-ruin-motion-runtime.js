// Random Test Ruin motion/egress integration — batch 3 + audit bridge.
// Runs after the base V50 interior adapter so it can reconcile physical riders,
// elevator blocks, and missing recovery access against the real rendered scene.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  const DevSpawner = window.DevSpawner;
  if (!DS || !DevSpawner) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const CONTROL_RANGE = 1.65;
  const PUSH_RADIUS = .08;
  const PLAYER_PLATFORM_EPS = .28;
  const BLOCK_PLATFORM_EPS = .34;
  const EGRESS_NEAR_LOCAL = .72;

  let deps = null;
  let root = null;
  let meta = null;
  let daises = [];
  let pushBlocks = [];
  let elevatorBlocks = [];
  let repairedEgress = [];
  let nearestElevatorBlock = null;
  let promptOwned = false;
  let controllerInteractDown = false;
  let frameInstalled = false;

  const previousDevInit = DevSpawner.init;
  DevSpawner.init = function (...args) {
    if (args[0]) deps = args[0];
    return previousDevInit.apply(this, args);
  };

  function currentArea() { return deps?.getCurrentArea?.() || null; }
  function activeRoot() {
    if (currentArea() !== MAP_ID) return null;
    let found = null;
    deps?.getActiveScene?.()?.traverse?.(object => {
      if (!found && String(object.name || '').startsWith('dev_v50_ruin_')) found = object;
    });
    return found;
  }
  function generatorApi() {
    return document.getElementById('devRandomRuinGeneratorFrame')?.contentWindow?.DebrisifierV50 || null;
  }
  function generatorMeta() {
    return generatorApi()?.getState?.()?.locale?.meta?.interiorShell || null;
  }
  function boxFor(object) {
    if (!object) return null;
    object.updateWorldMatrix?.(true, true);
    object.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(object);
    return box.isEmpty() ? null : box;
  }
  function centerFor(object) { return boxFor(object)?.getCenter(new THREE.Vector3()) || new THREE.Vector3(); }
  function playerWorld() {
    if (!deps?.player || !deps?.TILE) return null;
    return { x:deps.player.x/deps.TILE, z:deps.player.y/deps.TILE, y:Number(deps.playerMesh?.position?.y)||0 };
  }
  function insideXZ(box, point, pad = 0) {
    return !!box && point.x >= box.min.x-pad && point.x <= box.max.x+pad && point.z >= box.min.z-pad && point.z <= box.max.z+pad;
  }
  function localPointForWorld(object, worldPoint) {
    const out = worldPoint.clone();
    object.worldToLocal(out);
    return out;
  }
  function supportAt(x, z) {
    return DS.sampleSupport(x, z, { minY:-12, maxY:18, pad:.025 }) || null;
  }

  function discover(nextRoot) {
    root = nextRoot;
    meta = generatorMeta();
    daises = [];
    pushBlocks = [];
    elevatorBlocks = [];
    repairedEgress = [];

    root.traverse(object => {
      const d = object.userData || {};
      const motion = d.previewMotion?.type;
      if (motion === 'movingDais' && d.movingDaisPlatform) {
        const box = boxFor(d.movingDaisPlatform);
        daises.push({
          id:d.mechanismId || `dais-${object.id}`,
          root:object, platform:d.movingDaisPlatform,
          lastCenter:box?.getCenter(new THREE.Vector3()) || centerFor(d.movingDaisPlatform),
          lastTopY:box?.max.y ?? 0,
        });
      }
      if (d.pushable || motion === 'pushPuzzleBlock' || motion === 'elevatorPushBlock') {
        pushBlocks.push(object);
        if (motion === 'elevatorPushBlock' || d.ridesMovingDais) elevatorBlocks.push(object);
      }
    });

    ensureSunkenEgress();
    if (repairedEgress.length) setTimeout(() => window.DevRandomRuinPrototypeHooks?.rebuild?.(), 0);
    updateBadge();
  }

  function floorLevelMap() {
    const raw = meta?.plateauModel?.levelByCell || {};
    const map = new Map();
    for (const [key, value] of Object.entries(raw)) map.set(key, Number(value) || 0);
    for (const pair of meta?.floorCells || []) {
      const key = `${Number(pair[0])},${Number(pair[1])}`;
      if (!map.has(key)) map.set(key, 0);
    }
    return map;
  }
  function exactLevelComponents(levels) {
    const remaining = new Set([...levels.entries()].filter(([,level]) => level < 0).map(([key]) => key));
    const components = [];
    while (remaining.size) {
      const first = remaining.values().next().value;
      const level = levels.get(first) || 0;
      const stack = [first], cells = [];
      remaining.delete(first);
      while (stack.length) {
        const key = stack.pop();
        const [c,r] = key.split(',').map(Number);
        cells.push({ c, r, key });
        for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nk = `${c+dc},${r+dr}`;
          if (remaining.has(nk) && (levels.get(nk) || 0) === level) {
            remaining.delete(nk);
            stack.push(nk);
          }
        }
      }
      components.push({ level, cells });
    }
    return components;
  }
  function existingLaddersLocal() {
    const out = [];
    root.updateWorldMatrix?.(true, true);
    root.traverse(object => {
      if (object.userData?.generatedAccessType !== 'stoneLadder') return;
      const world = object.getWorldPosition(new THREE.Vector3());
      const local = localPointForWorld(root, world);
      out.push({ object, local, height:Number(object.userData?.ladderHeight)||0 });
    });
    return out;
  }
  function ensureSunkenEgress() {
    if (!root || !meta) return;
    const api = generatorApi();
    if (!api?.createRuntimeStoneLadder) return;
    const levels = floorLevelMap();
    const components = exactLevelComponents(levels);
    const cellSize = Number(meta.cellSize) || .5;
    const worldWidth = Number(meta.worldWidth) || (Number(meta.gridCols)||0)*cellSize;
    const worldDepth = Number(meta.worldDepth) || (Number(meta.gridRows)||0)*cellSize;
    const ox = -worldWidth/2, oz = -worldDepth/2;
    const step = Number(meta.plateauModel?.stepHeight) || .38;
    const floorSurfaceY = Number(meta.floorSurfaceY) || .06;
    const ladders = existingLaddersLocal();

    const cellCenter = (c,r) => ({ x:ox+(c+.5)*cellSize, z:oz+(r+.5)*cellSize });
    for (const component of components) {
      let best = null;
      for (const cell of component.cells) {
        for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nk = `${cell.c+dc},${cell.r+dr}`;
          if (!levels.has(nk)) continue;
          const highLevel = levels.get(nk) || 0;
          if (highLevel <= component.level) continue;
          const a = cellCenter(cell.c, cell.r), b = cellCenter(cell.c+dc, cell.r+dr);
          const candidate = {
            low:cell, high:{ c:cell.c+dc, r:cell.r+dr },
            highLevel, x:(a.x+b.x)/2, z:(a.z+b.z)/2, dx:dc, dz:dr,
          };
          if (!best || candidate.highLevel > best.highLevel) best = candidate;
        }
      }
      if (!best) {
        const cell = component.cells[0], p = cellCenter(cell.c, cell.r);
        best = { low:cell, high:null, highLevel:0, x:p.x, z:p.z, dx:1, dz:0, emergency:true };
      }
      const height = Math.max(.5, (best.highLevel-component.level)*step);
      const already = ladders.some(entry =>
        Math.hypot(entry.local.x-best.x, entry.local.z-best.z) <= EGRESS_NEAR_LOCAL &&
        entry.height >= height*.68
      );
      if (already) continue;

      const ladder = api.createRuntimeStoneLadder(height, Math.max(.68, cellSize*.96), .12);
      ladder.position.set(best.x, floorSurfaceY + best.highLevel*step, best.z);
      ladder.rotation.y = Math.atan2(best.dz, -best.dx);
      ladder.userData.runtimeRecoveryEgress = true;
      ladder.userData.runtimeRecoveryFromLevel = component.level;
      ladder.userData.runtimeRecoveryToLevel = best.highLevel;
      root.add(ladder);
      root.updateMatrixWorld?.(true);
      ladders.push({ object:ladder, local:new THREE.Vector3(best.x, ladder.position.y, best.z), height });
      repairedEgress.push({
        fromLevel:component.level, toLevel:best.highLevel,
        cell:[best.low.c,best.low.r], emergency:!!best.emergency,
      });
    }
  }

  function platformState(record) {
    const box = boxFor(record.platform);
    if (!box) return null;
    return { box, center:box.getCenter(new THREE.Vector3()), topY:box.max.y };
  }
  function blockBottomY(block) { return boxFor(block)?.min.y ?? centerFor(block).y; }
  function localWorldDelta(delta) {
    const sx = Math.abs(Number(root?.scale?.x)) || 1;
    const sy = Math.abs(Number(root?.scale?.y)) || 1;
    const sz = Math.abs(Number(root?.scale?.z)) || 1;
    return { x:delta.x/sx, y:delta.y/sy, z:delta.z/sz };
  }

  function carryMovingDaisRiders() {
    const player = playerWorld();
    for (const record of daises) {
      const state = platformState(record);
      if (!state) continue;
      const delta = state.center.clone().sub(record.lastCenter);
      const hadMotion = delta.lengthSq() > 1e-10 || Math.abs(state.topY-record.lastTopY) > 1e-6;

      if (hadMotion && record.playerRiding && player && deps?.player) {
        deps.player.x += delta.x * deps.TILE;
        deps.player.y += delta.z * deps.TILE;
        if (deps.playerMesh?.position) deps.playerMesh.position.y = state.topY;
      }

      for (const block of elevatorBlocks) {
        const center = centerFor(block);
        const bottom = blockBottomY(block);
        const riding = block.userData.__devRuinRideDaisId === record.id ||
          (insideXZ({ min:{x:record.lastCenter.x-(record.lastHalfX||0),z:record.lastCenter.z-(record.lastHalfZ||0)},
                      max:{x:record.lastCenter.x+(record.lastHalfX||0),z:record.lastCenter.z+(record.lastHalfZ||0)} }, center, .08)
            && Math.abs(bottom-record.lastTopY) <= BLOCK_PLATFORM_EPS);
        if (!riding) continue;
        if (hadMotion) {
          const localDelta = localWorldDelta(delta);
          block.position.x += localDelta.x;
          block.position.y += localDelta.y;
          block.position.z += localDelta.z;
          block.updateMatrixWorld?.(true);
        }
        block.userData.__devRuinRideDaisId = record.id;
      }

      const pNow = playerWorld();
      record.playerRiding = !!(pNow && insideXZ(state.box, pNow, .025) && Math.abs((pNow.y||0)-state.topY) <= PLAYER_PLATFORM_EPS);
      record.lastCenter.copy(state.center);
      record.lastTopY = state.topY;
      record.lastHalfX = (state.box.max.x-state.box.min.x)/2;
      record.lastHalfZ = (state.box.max.z-state.box.min.z)/2;

      for (const block of elevatorBlocks) {
        if (block.userData.__devRuinRideDaisId !== record.id) continue;
        const center = centerFor(block), bottom = blockBottomY(block);
        if (!insideXZ(state.box, center, .06) || Math.abs(bottom-state.topY) > BLOCK_PLATFORM_EPS) {
          delete block.userData.__devRuinRideDaisId;
        }
      }
    }
  }

  function snapLoosePushBlocksToSupport() {
    for (const block of pushBlocks) {
      if (block.userData.__devRuinRideDaisId) continue;
      const center = centerFor(block);
      const support = supportAt(center.x, center.z);
      if (!support) continue;
      const box = boxFor(block);
      if (!box) continue;
      const deltaY = support.y - box.min.y;
      if (Math.abs(deltaY) > .005 && Math.abs(deltaY) < 1.75) {
        block.position.y += deltaY / (Math.abs(Number(root?.scale?.y)) || 1);
        block.updateMatrixWorld?.(true);
      }
    }
  }

  function pushElevatorBlock(block) {
    const p = playerWorld();
    const center = centerFor(block);
    if (!p || !deps?.TILE) return false;
    const dx = center.x-p.x, dz = center.z-p.z;
    let sx = 0, sz = 0;
    if (Math.abs(dx) >= Math.abs(dz)) sx = Math.sign(dx) || 1;
    else sz = Math.sign(dz) || 1;

    const worldStep = (Number(meta?.cellSize) || .5) * (Math.abs(Number(root.scale.x)) || 2);
    const nx = center.x + sx*worldStep, nz = center.z + sz*worldStep;
    const support = supportAt(nx, nz);
    if (!support) {
      deps.showToast?.('The stone block would fall there.', false);
      return false;
    }
    const hit = DS.blockerAt(nx, nz, { radius:PUSH_RADIUS, actorHeight:1 });
    if (hit && !String(hit.id || '').includes(String(block.id))) {
      deps.showToast?.('Something blocks the stone block.', false);
      return false;
    }

    const localStepX = sx*worldStep/(Math.abs(Number(root.scale.x))||1);
    const localStepZ = sz*worldStep/(Math.abs(Number(root.scale.z))||1);
    block.position.x += localStepX;
    block.position.z += localStepZ;
    block.updateMatrixWorld?.(true);
    const after = boxFor(block);
    if (after) block.position.y += (support.y-after.min.y)/(Math.abs(Number(root.scale.y))||1);
    block.updateMatrixWorld?.(true);
    delete block.userData.__devRuinRideDaisId;
    generatorApi()?.syncPressurePlates?.(root);
    return true;
  }

  function nearestElevatorControl() {
    const p = playerWorld();
    if (!p) return null;
    let nearest = null, best = CONTROL_RANGE*CONTROL_RANGE;
    for (const block of elevatorBlocks) {
      const c = centerFor(block), d = (c.x-p.x)**2 + (c.z-p.z)**2;
      if (d <= best) { best=d; nearest=block; }
    }
    return nearest;
  }
  function pollController(block) {
    const bind = window.InputBindings?.getCurrentBindings?.()?.controller?.interact;
    const index = String(bind||'').startsWith('Button') ? Number(String(bind).slice(6)) : NaN;
    let down = false;
    if (Number.isInteger(index)) for (const pad of navigator.getGamepads?.() || [])
      if (pad?.buttons?.[index]?.pressed) down = true;
    if (down && !controllerInteractDown) pushElevatorBlock(block);
    controllerInteractDown = down;
  }
  function updatePrompt() {
    nearestElevatorBlock = nearestElevatorControl();
    if (!nearestElevatorBlock) {
      controllerInteractDown = false;
      if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
      promptOwned = false;
      return;
    }
    window.ActionPromptUI?.showActionPrompt?.({
      actionId:'interact', touchIcon:'✋', verb:'Push Stone Block',
      onPress:() => pushElevatorBlock(nearestElevatorBlock),
      statusText:'DEV RUIN · elevator block', statusType:'',
    });
    promptOwned = true;
    pollController(nearestElevatorBlock);
  }

  document.addEventListener('keydown', event => {
    if (!nearestElevatorBlock || currentArea() !== MAP_ID) return;
    const bind = window.InputBindings?.getCurrentBindings?.()?.desktop?.interact;
    if (!bind || String(bind).split('+').pop().trim() !== event.code) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pushElevatorBlock(nearestElevatorBlock);
  }, true);

  function updateBadge() {
    const badge = document.getElementById('devRandomRuinBadge');
    if (!badge || !root) return;
    const base = badge.dataset.motionBase || badge.textContent;
    badge.dataset.motionBase = base;
    badge.textContent = `${base} · motion ${daises.length}/${elevatorBlocks.length} · egress +${repairedEgress.length}`;
  }

  function clear() {
    root = null; meta = null; daises = []; pushBlocks = []; elevatorBlocks = []; repairedEgress = [];
    nearestElevatorBlock = null; controllerInteractDown = false;
    if (promptOwned) window.ActionPromptUI?.hideActionPrompt?.();
    promptOwned = false;
    const badge = document.getElementById('devRandomRuinBadge');
    if (badge) delete badge.dataset.motionBase;
  }

  function frameUpdate() {
    if (currentArea() !== MAP_ID) {
      if (root) clear();
      return;
    }
    const nextRoot = activeRoot();
    if (nextRoot && nextRoot !== root) discover(nextRoot);
    if (!root) return;
    carryMovingDaisRiders();
    snapLoosePushBlocksToSupport();
    updatePrompt();
    const badge = document.getElementById('devRandomRuinBadge');
    if (badge && !badge.dataset.motionBase) updateBadge();
  }

  async function auditSeeds(count = 12) {
    const frame = document.createElement('iframe');
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden','true');
    frame.style.cssText = 'position:fixed;left:-12000px;top:-12000px;width:16px;height:16px;opacity:0;pointer-events:none;border:0;z-index:-1';
    frame.src = `tools/debris-ifier/index.html?devRuntime=1&audit=${Date.now()}`;
    document.body.appendChild(frame);
    try {
      const started = performance.now();
      let api = null;
      while (performance.now()-started < 15000) {
        api = frame.contentWindow?.DebrisifierV50;
        if (api?.auditInteriorSeeds) break;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      if (!api?.auditInteriorSeeds) throw new Error('Timed out loading V50 audit runtime.');
      const result = await api.auditInteriorSeeds({ count, seedPrefix:'runtime-hook-audit' });
      console.info('[Random Test Ruin multi-seed audit]', result);
      if (result.aggregate?.unknown?.length) {
        deps?.showToast?.(`Ruin audit found ${result.aggregate.unknown.length} unknown runtime tag(s).`, false);
      } else {
        deps?.showToast?.(`Ruin audit passed ${result.count} seeds with no unknown runtime tags.`, true);
      }
      return result;
    } finally {
      frame.remove();
    }
  }

  setTimeout(() => setTimeout(() => {
    if (!frameInstalled) {
      DS.addBeforeRenderClient(frameUpdate);
      frameInstalled = true;
    }
  }, 0), 0);

  window.DevRandomRuinMotionRuntime = Object.freeze({
    snapshot:() => ({
      active:!!root,
      daises:daises.length,
      pushBlocks:pushBlocks.length,
      elevatorBlocks:elevatorBlocks.length,
      repairedEgress:repairedEgress.map(entry => ({...entry})),
    }),
    auditSeeds,
    rebuild:() => { const next = activeRoot(); if (next) discover(next); },
  });
})();

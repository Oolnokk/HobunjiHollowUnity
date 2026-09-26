// Generation-time solvability audit for the dev Random Test Ruin.
// Runs only while a candidate ruin is being generated; no per-frame work.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  if (!DS || !window.THREE) return;

  const RANGED_RANGE = 9;
  const SUPPORT_EPSILON = .06;
  const keyFor = (col, row) => `${col},${row}`;
  const parseKey = key => key.split(',').map(Number);

  function objectBox(object) {
    if (!object) return null;
    object.updateWorldMatrix?.(true, true);
    object.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(object);
    return box.isEmpty() ? null : box;
  }

  function objectCenter(object) {
    return objectBox(object)?.getCenter(new THREE.Vector3()) || new THREE.Vector3();
  }

  function audit(ruin, options = {}) {
    const meta = ruin?.meta;
    if (!ruin?.occupancy || !ruin?.api || !meta) return { ok:false, failures:['missing runtime audit dependencies'], rooms:[], solvedMechanisms:[] };

    const scope = String(options.scope || 'dev-random-ruin-interior');
    const pad = Number(options.pad) || 0;
    const tileScale = Number(options.tileScale) || 1;
    const controlRange = Number(options.controlRange) || 1.65;
    const maxStepHeight = Number(options.maxStepHeight) || .42;
    const localCell = Number(meta.cellSize) || .5;
    const worldCell = localCell * tileScale;
    const entranceRoomId = String(meta.progression?.entranceRoomId || meta.entrance?.roomId || meta.rooms?.[0]?.id || '');
    const rooms = Array.isArray(meta.rooms) ? meta.rooms : [];
    const doorways = Array.isArray(meta.doorways) ? meta.doorways : [];
    const mechanisms = [...(ruin.mechanisms?.values?.() || [])];
    const activators = Array.isArray(ruin.activators) ? ruin.activators : [];
    const pushBlocks = Array.isArray(ruin.pushBlocks) ? ruin.pushBlocks : [];
    const solved = new Set();
    const solveLog = [];
    const lastReason = new Map();

    const originalBlocks = new Map(pushBlocks.map(block => [block, block.position.clone()]));
    const originalBypass = new Map(mechanisms.map(mechanism => [
      mechanism.root,
      {
        had:Object.prototype.hasOwnProperty.call(mechanism.root.userData || {}, 'runtimePuzzleBypass'),
        value:mechanism.root.userData?.runtimePuzzleBypass,
        reason:mechanism.root.userData?.runtimePuzzleBypassReason,
      },
    ]));

    function worldFromRootPoint(point) {
      const v = new THREE.Vector3(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0);
      return ruin.localeRoot.localToWorld(v);
    }

    function worldFromBlockPoint(block, point) {
      const v = new THREE.Vector3(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0);
      return block.parent?.localToWorld ? block.parent.localToWorld(v) : v;
    }

    function tileKeyAtPoint(point) {
      return keyFor(Math.floor(Number(point?.x) || 0), Math.floor(Number(point?.z) || 0));
    }

    function tileCenter(key) {
      const [col, row] = parseKey(key);
      return { x:col + .5, z:row + .5 };
    }

    function roomBounds(room) {
      return {
        minX:pad + Number(room.col) * worldCell,
        maxX:pad + (Number(room.col) + Number(room.w)) * worldCell,
        minZ:pad + Number(room.row) * worldCell,
        maxZ:pad + (Number(room.row) + Number(room.h)) * worldCell,
      };
    }

    function roomForPoint(point) {
      let best = null;
      for (const room of rooms) {
        const b = roomBounds(room);
        const inside = point.x >= b.minX - .15 && point.x <= b.maxX + .15 && point.z >= b.minZ - .15 && point.z <= b.maxZ + .15;
        if (!inside) continue;
        if (!best || Number(room.progressionDepth || 0) > Number(best.progressionDepth || 0)) best = room;
      }
      return best;
    }

    function roomForMechanism(mechanism) {
      const doorwayId = String(mechanism.root?.userData?.doorwayId || '');
      if (doorwayId) {
        const door = doorways.find(entry => `${entry.from}->${entry.to}` === doorwayId);
        const room = door && rooms.find(entry => entry.id === door.from);
        if (room) return room;
      }
      return roomForPoint(objectCenter(mechanism.root));
    }

    function sameRoomSolvedType(point, types) {
      const room = roomForPoint(point);
      if (!room) return false;
      return mechanisms.some(mechanism => solved.has(mechanism.id) && types.includes(mechanism.type) && roomForMechanism(mechanism)?.id === room.id);
    }

    function supportAtKey(key, cache) {
      if (cache.has(key)) return cache.get(key);
      const p = tileCenter(key);
      const support = DS.sampleSupport(p.x, p.z, { minY:-12, maxY:18, pad:.015, scope });
      const value = support ? Number(support.y) : null;
      cache.set(key, Number.isFinite(value) ? value : null);
      return cache.get(key);
    }

    function ladderLinks(floorSet, supportCache) {
      const groups = [];
      ruin.localeRoot.traverse?.(object => {
        if (object.userData?.generatedAccessType !== 'stoneLadder') return;
        const center = objectCenter(object);
        const keys = [];
        for (const key of floorSet) {
          const p = tileCenter(key);
          if (Math.hypot(p.x - center.x, p.z - center.z) > 1.35) continue;
          if (supportAtKey(key, supportCache) == null) continue;
          keys.push(key);
        }
        if (keys.length > 1) groups.push(new Set(keys));
      });
      return groups;
    }

    function sourceBlocks(sources, ignoreSources) {
      if (!sources?.length) return false;
      return sources.some(source => !String(source).startsWith('transit-door:') && !ignoreSources.has(String(source)));
    }

    function flood(startPoint, options = {}) {
      const snapshot = ruin.occupancy.snapshot();
      const floorSet = new Set(snapshot?.floor || []);
      const sources = snapshot?.sources || {};
      const ignoreSources = new Set(options.ignoreSources || []);
      const virtualBlockKey = options.virtualBlockKey || null;
      const supportCache = new Map();
      const ladders = ladderLinks(floorSet, supportCache);

      function walkable(key) {
        if (!floorSet.has(key) || key === virtualBlockKey) return false;
        if (sourceBlocks(sources[key] || [], ignoreSources)) return false;
        return supportAtKey(key, supportCache) != null;
      }

      function ladderAllows(a, b) {
        return ladders.some(group => group.has(a) && group.has(b));
      }

      let startKey = tileKeyAtPoint(startPoint);
      if (!walkable(startKey)) {
        const [c, r] = parseKey(startKey);
        const nearby = [];
        for (let radius = 1; radius <= 2; radius++) {
          for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) nearby.push(keyFor(c + dx, r + dz));
        }
        startKey = nearby.find(walkable) || '';
      }
      if (!startKey) return new Set();

      const visited = new Set([startKey]);
      const queue = [startKey];
      while (queue.length) {
        const current = queue.shift();
        const [col, row] = parseKey(current);
        const currentY = supportAtKey(current, supportCache);
        for (const next of [keyFor(col + 1, row), keyFor(col - 1, row), keyFor(col, row + 1), keyFor(col, row - 1)]) {
          if (visited.has(next) || !walkable(next)) continue;
          const nextY = supportAtKey(next, supportCache);
          if (nextY == null || currentY == null) continue;
          if ((nextY - currentY) > maxStepHeight + SUPPORT_EPSILON && !ladderAllows(current, next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }
      return visited;
    }

    function reachableNearPoint(point, reachable, range = controlRange) {
      for (const key of reachable) {
        const p = tileCenter(key);
        if (Math.hypot(p.x - point.x, p.z - point.z) <= range) return true;
      }
      return false;
    }

    function lineClear(from, target) {
      const snapshot = ruin.occupancy.snapshot();
      const sources = snapshot?.sources || {};
      const distance = Math.hypot(target.x - from.x, target.z - from.z);
      const steps = Math.max(2, Math.ceil(distance / .22));
      for (let i = 1; i < steps - 2; i++) {
        const t = i / steps;
        const key = keyFor(Math.floor(THREE.MathUtils.lerp(from.x, target.x, t)), Math.floor(THREE.MathUtils.lerp(from.z, target.z, t)));
        if (sourceBlocks(sources[key] || [], new Set())) return false;
      }
      return true;
    }

    function canShoot(object, reachable) {
      const target = objectCenter(object);
      for (const key of reachable) {
        const p = tileCenter(key);
        if (Math.hypot(p.x - target.x, p.z - target.z) > RANGED_RANGE) continue;
        if (lineClear(p, target)) return true;
      }
      return false;
    }

    function physicalGlyphTargets(list) {
      const targets = new Set(); // Includes individually linked glyphs plus children of V50's linked glyph-set wrapper.
      for (const object of list) {
        let nested = false;
        object.traverse?.(child => {
          if (child === object || child.userData?.activatorType !== 'glyphObelisk') return;
          nested = true;
          if (child.children?.some(grandchild => grandchild.isMesh) || child.userData?.shortHiddenObelisk || child.userData?.hiddenActivatorMount || child.userData?.concealedStoneFinish) targets.add(child);
        });
        if (nested) continue;
        const d = object.userData || {};
        if (d.shortHiddenObelisk || d.hiddenActivatorMount || d.concealedStoneFinish || d.heightBand || object.children?.some(child => child.isMesh)) targets.add(object);
      }
      return [...targets];
    }

    function canSolveGlyphGroup(mechanism, list, reachable) {
      const targets = physicalGlyphTargets(list);
      const declaredRequired = Number(mechanism.root?.userData?.requiredGlyphTriggers) || 0;
      const required = Math.max(1, declaredRequired, ...targets.map(target => Number(target.userData?.requiredTriggers) || 1));
      const hitCount = targets.filter(target => canShoot(target, reachable)).length;
      return { ok:hitCount >= required, reason:`projectile glyphs reachable ${hitCount}/${required}` };
    }

    function canSolveBrazier(object, reachable) {
      const route = object.userData?.torchCarryRoute;
      if (!route) return { ok:reachableNearPoint(objectCenter(object), reachable), reason:'brazier has no authored carry route' };
      if (route.prerequisiteGateId && !solved.has(route.prerequisiteGateId)) return { ok:false, reason:`torch prerequisite ${route.prerequisiteGateId} unsolved` };
      const source = worldFromRootPoint(route.source);
      if (!reachableNearPoint(source, reachable, 1.55)) return { ok:false, reason:'torch source unreachable' };
      for (const node of route.route || []) {
        const point = worldFromRootPoint(node);
        if (!reachable.has(tileKeyAtPoint(point)) && !reachableNearPoint(point, reachable, .8)) return { ok:false, reason:'torch carry route crosses unreachable floor' };
      }
      const burnSeconds = Number(route.burnSeconds) || 0;
      const estimated = Number(route.estimatedSeconds) || 0;
      if (burnSeconds > 0 && estimated >= burnSeconds) return { ok:false, reason:'torch route exceeds burn duration' };
      return { ok:true, reason:'torch source and carry route reachable' };
    }

    function destinationBlockInfo(key, ignoreSource) {
      const snapshot = ruin.occupancy.snapshot(); // Exact aggregate occupancy used by gameplay collision for this candidate.
      const floor = new Set(snapshot.floor || []);
      const ignore = new Set(ignoreSource ? [ignoreSource] : []);
      const sources = (snapshot.sources?.[key] || []).filter(source => !ignore.has(String(source)));
      return { blocked:!floor.has(key) || sourceBlocks(sources, new Set()), floor:floor.has(key), sources };
    }

    function expandedWorldPath(block, rawPath) {
      const points = rawPath.map(point => worldFromBlockPoint(block, point));
      if (!points.length) return [];
      const expanded = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = expanded[expanded.length - 1], b = points[i];
        const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
        if (distance < .08) { expanded.push(b); continue; }
        const steps = Math.max(1, Math.round(distance / Math.max(.5, worldCell)));
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          expanded.push(new THREE.Vector3(THREE.MathUtils.lerp(a.x, b.x, t), THREE.MathUtils.lerp(a.y, b.y, t), THREE.MathUtils.lerp(a.z, b.z, t)));
        }
      }
      return expanded;
    }

    function canSolvePressurePlate(plate) {
      const block = plate.userData?.linkedWeightBlock;
      if (!block) return { ok:false, reason:'pressure plate has no linked weight block' };
      const blockPoint = objectCenter(block);
      const data = block.userData || {};
      if (data.supportedByBridgeUntilDrop && !sameRoomSolvedType(blockPoint, ['bridge','bridgeSequence'])) return { ok:false, reason:'block-drop bridge not solved yet' };
      if (data.previewMotion?.type === 'elevatorPushBlock' && !sameRoomSolvedType(blockPoint, ['movingDais'])) return { ok:false, reason:'block elevator not solved yet' };

      const rawPath = Array.isArray(data.pushPath) && data.pushPath.length ? data.pushPath : [data.pushStart, data.pushTarget].filter(Boolean);
      if (rawPath.length < 2) return { ok:false, reason:'push block has no authored solution path' };
      const sourceId = String(data.__devRuinOccupancySource || `push:${block.id}`);

      // Put elevator-carried blocks at the first authored traversal point once
      // their dais prerequisite is solved. Ordinary blocks already start here.
      const first = rawPath[0];
      block.position.set(Number(first.x) || 0, Number(first.y) || block.position.y, Number(first.z) || 0);
      block.updateMatrixWorld?.(true);
      ruin.api.syncPressurePlates(ruin.localeRoot);
      ruin.occupancy.refresh();

      function reachablePushSide(center, desiredX, desiredZ, reachable) {
        const offsets = [[0,0],[.28,0],[-.28,0],[0,.28],[0,-.28],[.28,.28],[.28,-.28],[-.28,.28],[-.28,-.28]];
        for (const key of reachable) {
          const base = tileCenter(key);
          for (const [ox, oz] of offsets) {
            const player = { x:base.x+ox, z:base.z+oz };
            const distance = Math.hypot(center.x-player.x, center.z-player.z);
            if (distance > controlRange+.12 || distance < .28) continue;
            const dx = center.x-player.x, dz = center.z-player.z;
            let sx = 0, sz = 0;
            if (Math.abs(dx) >= Math.abs(dz)) sx = Math.sign(dx) || 1;
            else sz = Math.sign(dz) || 1;
            if (sx === desiredX && sz === desiredZ) return player;
          }
        }
        return null;
      }

      let playerPoint = { x:ruin.spawn.x, z:ruin.spawn.z }; // Used to preserve the player's connected pocket between sequential simulated pushes.
      for (let i = 1; i < rawPath.length; i++) {
        const current = worldFromBlockPoint(block, rawPath[i-1]);
        const next = worldFromBlockPoint(block, rawPath[i]);
        const deltaX = next.x-current.x, deltaZ = next.z-current.z;
        const horizontalDistance = Math.hypot(deltaX, deltaZ);

        // Bridge-drop puzzles end with a vertical drop after the OFF/reset action,
        // which the bridge-sequence prerequisite has already proven reachable.
        if (horizontalDistance <= .05) {
          block.position.set(Number(rawPath[i].x) || 0, Number(rawPath[i].y) || block.position.y, Number(rawPath[i].z) || 0);
          block.updateMatrixWorld?.(true);
          ruin.api.syncPressurePlates(ruin.localeRoot);
          ruin.occupancy.refresh();
          continue;
        }

        let desiredX = 0, desiredZ = 0;
        if (Math.abs(deltaX) >= Math.abs(deltaZ)) desiredX = Math.sign(deltaX) || 1;
        else desiredZ = Math.sign(deltaZ) || 1;

        const reachable = flood(playerPoint);
        const center = objectCenter(block);
        const pushSide = reachablePushSide(center, desiredX, desiredZ, reachable);
        if (!pushSide) return { ok:false, reason:`player cannot reach a legal push side for step ${i}/${rawPath.length-1}` };

        const nextKey = tileKeyAtPoint(next);
        const blockInfo = destinationBlockInfo(nextKey, sourceId); // Surface exact blocker ids in rejected-seed diagnostics.
        if (blockInfo.blocked) return { ok:false, reason:`push destination ${nextKey} is blocked (${blockInfo.floor?'floor':'no-floor'}; ${blockInfo.sources.join(',')||'no source'})` };
        if (!DS.sampleSupport(next.x, next.z, { minY:-12, maxY:18, pad:.02, scope })) return { ok:false, reason:`push destination ${nextKey} has no support` };

        // Advance exactly to the generator-authored next push point. Gameplay's
        // push handler now derives the same step spacing from this pushPath.
        block.position.set(Number(rawPath[i].x) || 0, Number(rawPath[i].y) || block.position.y, Number(rawPath[i].z) || 0);
        block.updateMatrixWorld?.(true);
        ruin.api.syncPressurePlates(ruin.localeRoot);
        ruin.occupancy.refresh();
        playerPoint = pushSide; // Runtime pushing leaves the player here; subsequent walking must start from this region.
      }

      ruin.api.syncPressurePlates(ruin.localeRoot);
      ruin.occupancy.refresh();
      if (!plate.userData?.weightActive) return { ok:false, reason:'authored push route does not actually depress its pressure plate' };
      return { ok:true, reason:'authored push route is executable from reachable interaction sides' };
    }

    function activatorsFor(mechanismId) {
      return activators.filter(object => String(object.userData?.linkedMechanismId || '') === String(mechanismId));
    }

    function canUseSimpleActivator(object, reachable) {
      const type = object.userData?.activatorType;
      if (type === 'glyphObelisk') return canShoot(object, reachable);
      return reachableNearPoint(objectCenter(object), reachable);
    }

    function canSolveMechanism(mechanism, reachable) {
      if (mechanism.root?.userData?.runtimePuzzleBypass) return { ok:true, reason:'generation option bypass' };
      const list = activatorsFor(mechanism.id);
      const commandActivators = list.filter(object => object.userData?.bridgeCommand);
      if (mechanism.type === 'bridgeSequence' && commandActivators.length) {
        const on = commandActivators.filter(object => object.userData.bridgeCommand === 'ON');
        const off = commandActivators.filter(object => object.userData.bridgeCommand === 'OFF');
        if (!on.some(object => canUseSimpleActivator(object, reachable))) return { ok:false, reason:'bridge ON control unreachable' };
        ruin.api.applyProgress(mechanism.root, .5);
        ruin.occupancy.refresh();
        const extendedReachable = flood(ruin.spawn);
        const offReachable = off.some(object => canUseSimpleActivator(object, extendedReachable));
        if (!offReachable) {
          ruin.api.applyProgress(mechanism.root, 0);
          ruin.occupancy.refresh();
          return { ok:false, reason:'bridge OFF/reset control unreachable after extension' };
        }
        return { ok:true, reason:'bridge ON/OFF sequence reachable in order' };
      }

      const plates = list.filter(object => object.userData?.activatorType === 'pressurePlate');
      for (const plate of plates) {
        const result = canSolvePressurePlate(plate);
        if (result.ok) return result;
        lastReason.set(mechanism.id, result.reason);
      }

      const cubes = list.filter(object => object.userData?.activatorType === 'linkedCubePillars');
      if (cubes.some(object => reachableNearPoint(objectCenter(object), reachable))) return { ok:true, reason:'linked-cube controls reachable' };

      const braziers = list.filter(object => object.userData?.activatorType === 'brazier');
      for (const brazier of braziers) {
        const result = canSolveBrazier(brazier, reachable);
        if (result.ok) return result;
        lastReason.set(mechanism.id, result.reason);
      }

      const glyphs = list.filter(object => object.userData?.activatorType === 'glyphObelisk');
      if (glyphs.length) {
        const result = canSolveGlyphGroup(mechanism, glyphs, reachable);
        if (result.ok) return result;
        lastReason.set(mechanism.id, result.reason);
      }

      const simple = list.filter(object => ['stackedObelisk','torch'].includes(object.userData?.activatorType));
      if (simple.some(object => reachableNearPoint(objectCenter(object), reachable))) return { ok:true, reason:'direct activator reachable' };

      return { ok:false, reason:lastReason.get(mechanism.id) || (list.length ? 'no linked activator is reachable' : 'mechanism has no linked activator') };
    }

    function forceMechanismSolved(mechanism) {
      mechanism.root.userData.runtimePuzzleBypass = true;
      mechanism.root.userData.runtimePuzzleBypassReason = 'solvability-audit';
      const solvedProgress = mechanism.type === 'bridgeSequence' ? .5 : 1; // Sequence bridges are physically extended at their authored middle state.
      ruin.api.applyProgress(mechanism.root, solvedProgress);
      ruin.occupancy.refresh();
    }

    function entryPointForRoom(room) {
      if (room.id === entranceRoomId) return { x:ruin.spawn.x, z:ruin.spawn.z };
      const door = doorways.find(entry => String(entry.from || '').startsWith('hall_') && entry.to === room.id);
      if (!door) return null;
      const doorway = door.axis === 'x'
        ? { x:pad + Number(door.boundary) * worldCell, z:pad + Number(door.center) * worldCell }
        : { x:pad + Number(door.center) * worldCell, z:pad + Number(door.boundary) * worldCell };
      const bounds = roomBounds(room);
      const roomCenter = { x:(bounds.minX + bounds.maxX) * .5, z:(bounds.minZ + bounds.maxZ) * .5 };
      const dx = Math.sign(roomCenter.x - doorway.x), dz = Math.sign(roomCenter.z - doorway.z);
      return { x:doorway.x + dx * worldCell * .65, z:doorway.z + dz * worldCell * .65 };
    }

    function roomEntryReached(entry, reachable) {
      if (!entry) return false;
      const key = tileKeyAtPoint(entry);
      if (reachable.has(key)) return true;
      return reachableNearPoint(entry, reachable, .8);
    }

    try {
      ruin.api.snapMechanismState(0);
      ruin.api.syncPressurePlates(ruin.localeRoot);
      ruin.occupancy.refresh();

      let iterations = 0;
      while (iterations++ < mechanisms.length + 4) {
        const reachable = flood(ruin.spawn);
        let progressed = false;
        const candidates = mechanisms
          .filter(mechanism => !solved.has(mechanism.id))
          .sort((a, b) => Number(roomForMechanism(a)?.progressionDepth || 0) - Number(roomForMechanism(b)?.progressionDepth || 0));
        for (const mechanism of candidates) {
          const result = canSolveMechanism(mechanism, reachable);
          lastReason.set(mechanism.id, result.reason);
          if (!result.ok) continue;
          forceMechanismSolved(mechanism);
          solved.add(mechanism.id);
          solveLog.push({ id:mechanism.id, type:mechanism.type, roomId:roomForMechanism(mechanism)?.id || null, reason:result.reason });
          progressed = true;
        }
        if (!progressed) break;
      }

      const reachable = flood(ruin.spawn);
      const roomResults = rooms.map(room => {
        const entry = entryPointForRoom(room);
        return {
          roomId:room.id,
          depth:Number(room.progressionDepth) || 0,
          entrance:room.id === entranceRoomId,
          core:!!room.isCoreTreasureRoom,
          entry:entry ? { x:+entry.x.toFixed(3), z:+entry.z.toFixed(3) } : null,
          reachable:roomEntryReached(entry, reachable),
        };
      });
      const unsolved = mechanisms
        .filter(mechanism => !solved.has(mechanism.id) && !mechanism.root?.userData?.runtimePuzzleBypass)
        .map(mechanism => ({
          id:mechanism.id,
          type:mechanism.type,
          roomId:roomForMechanism(mechanism)?.id || null,
          reason:lastReason.get(mechanism.id) || 'no reachable solution',
        }));
      const failures = [];
      if (!roomEntryReached(ruin.spawn, reachable)) failures.push('spawn tile is not reachable');
      for (const room of roomResults) if (!room.reachable) failures.push(`room ${room.roomId} entry is unreachable`);
      for (const mechanism of unsolved) failures.push(`${mechanism.id} (${mechanism.type}): ${mechanism.reason}`);

      return {
        ok:failures.length === 0,
        entranceRoomId,
        rooms:roomResults,
        solvedMechanisms:solveLog,
        unsolvedMechanisms:unsolved,
        reachableTileCount:reachable.size,
        failures,
      };
    } finally {
      for (const [block, position] of originalBlocks) {
        block.position.copy(position);
        block.updateMatrixWorld?.(true);
      }
      for (const [root, saved] of originalBypass) {
        if (saved.had) root.userData.runtimePuzzleBypass = saved.value;
        else delete root.userData.runtimePuzzleBypass;
        if (saved.reason == null) delete root.userData.runtimePuzzleBypassReason;
        else root.userData.runtimePuzzleBypassReason = saved.reason;
      }
      ruin.api.syncPressurePlates(ruin.localeRoot);
      ruin.api.snapMechanismState(0);
      ruin.occupancy.refresh();
    }
  }

  window.DevRandomRuinSolvability = Object.freeze({ audit });
})();

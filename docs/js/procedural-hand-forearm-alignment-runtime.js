// Late free-hand forearm alignment for procedural hand GLBs.
//
// The ordinary no-tool hand pose remains the reference. If a later presentation
// layer (currently social dancing) moves a free hand after the normal hand driver,
// rotate the hand by exactly the change in shoulder->hand direction while keeping
// the baseline wrist/palm quaternion relationship intact. This is intentionally
// generic: it does not know about a particular dance style or NPC.
(function (global) {
  'use strict';

  if (global.ProceduralHandForearmAlignment?.installed) return;
  const THREE = global.THREE;
  if (!THREE) return;

  const records = new Set();
  let alignApplications = 0;
  let missingShoulders = 0;

  function cfgNumber(key, fallback, lo = -Infinity, hi = Infinity) {
    const value = Number(global.SCRATCHBONES_CONFIG?.game?.socialActions?.[key]);
    return Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
  }

  function normalizeGender(value) {
    const g = String(value || '').trim().toLowerCase();
    return g === 'female' || g === 'f' ? 'female' : 'male';
  }

  function socketFor(record, side) {
    return record.rig?.group?.getObjectByName?.(`${side}_hand_socket`) || null;
  }

  function profileShoulder(record, side) {
    const rig = record.rig;
    const key = `${rig?.speciesId || record.options.speciesId || ''}::${normalizeGender(rig?.gender || record.options.gender)}`;
    const anchorName = side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder';
    const p = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[key]?.anchors?.[anchorName]?.position;
    if ([p?.x, p?.y, p?.z].every(value => Number.isFinite(Number(value)))) {
      record.shoulderSource[side] = 'attachment-rig-profile';
      return new THREE.Vector3(Number(p.x), Number(p.y), Number(p.z));
    }

    // Legacy authored 200x200 shoulder points use the same conversion as the
    // existing shoulder-compass runtime. This keeps older species functional
    // without inventing a second anatomical constant.
    const points = global.HobunjiHandShoulderPoints;
    const point = points?.pointFor?.(rig?.speciesId || record.options.speciesId, rig?.gender || record.options.gender, side);
    if (point && points?.isAuthored?.(point)) {
      const avatarRoot = record.avatarRoot;
      const parent = rig?.parent || avatarRoot?.parent;
      if (avatarRoot && parent) {
        const modelWidth = Number(avatarRoot.userData?.portraitModelWidth) || Number(record.options.modelHeight) || 0.9;
        const modelHeight = Number(avatarRoot.userData?.portraitModelHeight) || Number(record.options.modelHeight) || 0.9;
        const placementRatio = Number(avatarRoot.userData?.portraitVerticalPlacementRatio);
        const assemblyY = ((Number.isFinite(placementRatio) ? placementRatio : 0.5) - 0.5) * modelHeight;
        const local = new THREE.Vector3(
          -modelWidth / 2 + (Number(point.x) || 0) / 200 * modelWidth,
          assemblyY + modelHeight / 2 - (Number(point.y) || 0) / 200 * modelHeight,
          0,
        );
        avatarRoot.updateWorldMatrix?.(true, false);
        avatarRoot.localToWorld(local);
        parent.updateWorldMatrix?.(true, false);
        parent.worldToLocal(local);
        record.shoulderSource[side] = 'manual-portrait-200px';
        return local;
      }
    }

    record.shoulderSource[side] = 'missing';
    return null;
  }

  function captureSide(record, side) {
    if (!record.free[side]) return false;
    const socket = socketFor(record, side);
    const shoulder = profileShoulder(record, side);
    if (!socket || !shoulder) {
      record.baseline[side] = null;
      return false;
    }
    const direction = shoulder.clone().sub(socket.position);
    if (direction.lengthSq() < 1e-10) {
      record.baseline[side] = null;
      return false;
    }
    direction.normalize();
    record.baseline[side] = {
      position: socket.position.clone(),
      quaternion: socket.quaternion.clone().normalize(),
      direction,
    };
    return true;
  }

  function captureFree(record) {
    captureSide(record, 'left');
    captureSide(record, 'right');
  }

  function alignSide(record, side) {
    if (!record.free[side]) return false;
    const base = record.baseline[side];
    const socket = socketFor(record, side);
    if (!base || !socket) return false;
    const epsilon = cfgNumber('freeHandForearmMoveEpsilon', 0.00001, 0, 0.05);
    if (socket.position.distanceToSquared(base.position) <= epsilon * epsilon) return false;

    const shoulder = profileShoulder(record, side);
    if (!shoulder) {
      missingShoulders++;
      return false;
    }
    const currentDirection = shoulder.sub(socket.position);
    if (currentDirection.lengthSq() < 1e-10) return false;
    currentDirection.normalize();

    const delta = new THREE.Quaternion().setFromUnitVectors(base.direction, currentDirection).normalize();
    socket.quaternion.copy(delta.multiply(base.quaternion)).normalize();
    socket.updateMatrix?.();
    socket.updateMatrixWorld?.(true);
    record.alignments[side]++;
    alignApplications++;
    return true;
  }

  function alignFree(record, renderScene) {
    // Outline/material-id passes must replay the already aligned visible hand,
    // not solve another orientation during the secondary pass.
    if (renderScene?.overrideMaterial) return;
    alignSide(record, 'left');
    alignSide(record, 'right');
  }

  function installSentinel(record) {
    const parent = record.rig?.parent || record.rig?.group?.parent;
    if (!parent || record.sentinel) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      0.0001, 0, 0,
      0, 0.0001, 0,
    ], 3));
    const material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    material.colorWrite = false;
    const sentinel = new THREE.Mesh(geometry, material);
    sentinel.name = `${record.options.name || record.rig?.speciesId || 'avatar'}_free_hand_forearm_align`;
    sentinel.frustumCulled = false;
    // Normal hand sync: -100000. Dance translation: -99990. Forearm orientation
    // must happen after both and before the visible hand is drawn.
    sentinel.renderOrder = cfgNumber('freeHandForearmAlignmentRenderOrder', -99980, -99989, -1000);
    sentinel.onBeforeRender = (_renderer, renderScene) => alignFree(record, renderScene);
    parent.add(sentinel);
    record.sentinel = sentinel;
  }

  function disposeSentinel(record) {
    const sentinel = record?.sentinel;
    if (!sentinel) return;
    sentinel.parent?.remove?.(sentinel);
    sentinel.geometry?.dispose?.();
    sentinel.material?.dispose?.();
    record.sentinel = null;
  }

  function installRig(rig, options = {}) {
    if (!rig || rig.__hobunjiForearmAlignmentRecord) return rig;
    const record = {
      rig,
      options,
      avatarRoot: options.avatarRoot || rig.avatarRoot || null,
      free: { left: true, right: true },
      baseline: { left: null, right: null },
      shoulderSource: { left: null, right: null },
      alignments: { left: 0, right: 0 },
      sentinel: null,
    };
    Object.defineProperty(rig, '__hobunjiForearmAlignmentRecord', { value: record, configurable: true });
    records.add(record);

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function forearmAlignedIdleBoth(...args) {
        const result = originalUseIdlePose(...args);
        record.free.left = true;
        record.free.right = true;
        captureFree(record);
        return result;
      };
    }

    const originalSetSideIdle = rig.setSideIdle?.bind(rig);
    if (originalSetSideIdle) {
      rig.setSideIdle = function forearmAlignedIdleSide(side, ...args) {
        const result = originalSetSideIdle(side, ...args);
        if (side === 'left' || side === 'right') {
          record.free[side] = true;
          captureSide(record, side);
        }
        return result;
      };
    }

    const originalPlaceHandWorld = rig.placeHandWorld?.bind(rig);
    if (originalPlaceHandWorld) {
      rig.placeHandWorld = function forearmAlignedHeldSide(side, ...args) {
        const result = originalPlaceHandWorld(side, ...args);
        if (side === 'left' || side === 'right') {
          record.free[side] = false;
          record.baseline[side] = null;
        }
        return result;
      };
    }

    // Public per-rig hooks are useful to any later presentation layer that moves
    // a free hand outside the normal hand driver.
    rig.captureFreeHandForearmBaseline = side => side ? captureSide(record, side) : (captureFree(record), true);
    rig.realignFreeHandToForearm = side => side ? alignSide(record, side) : (alignSide(record, 'left') || alignSide(record, 'right'));

    const originalDebug = rig.getDebug?.bind(rig);
    if (originalDebug) {
      rig.getDebug = function forearmAlignmentDebug() {
        return {
          ...originalDebug(),
          freeHandForearmAlignment: {
            sentinelRenderOrder: record.sentinel?.renderOrder ?? null,
            free: { ...record.free },
            shoulderSource: { ...record.shoulderSource },
            hasBaseline: { left: !!record.baseline.left, right: !!record.baseline.right },
            alignments: { ...record.alignments },
          },
        };
      };
    }

    const originalDispose = rig.dispose?.bind(rig);
    if (originalDispose) {
      rig.dispose = function forearmAlignmentDispose(...args) {
        disposeSentinel(record);
        records.delete(record);
        return originalDispose(...args);
      };
    }

    installSentinel(record);
    captureFree(record);
    return rig;
  }

  function patchHands(api) {
    if (!api?.attach || api.attach.__hobunjiForearmAlignmentWrapped) return;
    const originalAttach = api.attach.bind(api);
    const wrapped = function forearmAlignmentAttach(THREEArg, parent, options = {}) {
      const rig = originalAttach(THREEArg, parent, options);
      return rig ? installRig(rig, options) : rig;
    };
    wrapped.__hobunjiForearmAlignmentWrapped = true;
    wrapped.__hobunjiForearmAlignmentOriginal = originalAttach;
    api.attach = wrapped;
  }

  function chainGlobal(name, patcher) {
    const current = global[name];
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current;
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(global) : stored; },
        set(value) {
          if (oldSet) oldSet.call(global, value);
          else stored = value;
          const resolved = oldGet ? oldGet.call(global) : stored;
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  chainGlobal('ProceduralHandAttachments', patchHands);
  global.setInterval?.(() => patchHands(global.ProceduralHandAttachments), 500);

  global.ProceduralHandForearmAlignment = Object.freeze({
    installed: true,
    installRig,
    getDebug() {
      return {
        activeRigs: records.size,
        alignApplications,
        missingShoulders,
        rigs: [...records].map(record => ({
          name: record.options.name || null,
          speciesId: record.rig?.speciesId || null,
          gender: record.rig?.gender || null,
          free: { ...record.free },
          shoulderSource: { ...record.shoulderSource },
          alignments: { ...record.alignments },
          sentinelRenderOrder: record.sentinel?.renderOrder ?? null,
        })),
      };
    },
  });
})(window);

// Scale-aware world/local bridge for procedural hands.
//
// Three.js getWorldQuaternion() decomposes matrixWorld. That is unsafe for the
// player rig because portrait/facing transforms can contain a negative scale;
// the reflection can be folded into the decomposed quaternion as a false 180°
// rotation. Positions still deliberately use matrixWorld so mirrored offsets
// remain correct. Rotations use only the Object3D quaternion hierarchy.
//
// Character attachment profiles are authored in adult species/gender space,
// while individual avatars may add another actor-only scale (currently the
// shared child multiplier). The posterior already derives from the rendered
// portrait height, but absolute hand-shoulder targets do not. This bridge keeps
// the stored adult profile untouched and presents actor-scaled shoulder targets
// to the later shoulder-aim wrapper during each synchronous hand solve.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  if (!hands?.attach || hands.attach.__hobunjiScaleFreeWorldWrapped) return;

  const originalAttach = hands.attach.bind(hands);

  function hierarchyWorldQuaternion(THREE, node, target = new THREE.Quaternion()) {
    const chain = []; // Used below to compose local quaternions parent-first.
    for (let cursor = node; cursor?.isObject3D; cursor = cursor.parent) chain.push(cursor);
    target.identity();
    for (let i = chain.length - 1; i >= 0; i -= 1) target.multiply(chain[i].quaternion);
    return target.normalize();
  }

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  }

  function characterProfileForRig(rig) {
    const speciesId = typeof global.hobunjiTransformSpeciesId === 'function'
      ? global.hobunjiTransformSpeciesId(rig?.speciesId)
      : normalizeKey(rig?.speciesId);
    const gender = normalizeGender(rig?.gender);
    const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return characters[`${speciesId}::${gender}`] || characters[`${normalizeKey(rig?.speciesId)}::${gender}`] || null;
  }

  function effectiveCharacterAnchorScale(rig, avatarRoot = rig?.avatarRoot) {
    const renderedScale = Number(avatarRoot?.userData?.portraitScaleMultiplier);
    const authoredScale = Number(characterProfileForRig(rig)?.anatomy?.portraitScale);
    if (!(renderedScale > 0) || !(authoredScale > 0)) return 1;
    const scale = renderedScale / authoredScale;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function scaledPosition(position, scale) {
    if (!position) return null;
    return {
      x: Number(position.x) * scale,
      y: Number(position.y) * scale,
      z: Number(position.z) * scale,
    };
  }

  function withActorScaledShoulderProfile(rig, callback) {
    const profile = characterProfileForRig(rig);
    const scale = effectiveCharacterAnchorScale(rig);
    if (!profile || Math.abs(scale - 1) <= 1e-9) return callback();
    const names = ['leftHandShoulder', 'rightHandShoulder'];
    const originals = [];
    try {
      for (const name of names) {
        const position = profile?.anchors?.[name]?.position;
        if (!position || !['x', 'y', 'z'].every(axis => Number.isFinite(Number(position[axis])))) continue;
        originals.push([position, Number(position.x), Number(position.y), Number(position.z)]);
        position.x *= scale;
        position.y *= scale;
        position.z *= scale;
      }
      return callback();
    } finally {
      for (const [position, x, y, z] of originals) {
        position.x = x;
        position.y = y;
        position.z = z;
      }
    }
  }

  function effectiveShoulderDebug(rig) {
    const profile = characterProfileForRig(rig);
    const scale = effectiveCharacterAnchorScale(rig);
    return {
      factor: scale,
      coordinateSpace: 'adult-profile-position × renderedPortraitScale/authoredPortraitScale',
      renderedPortraitScale: Number(rig?.avatarRoot?.userData?.portraitScaleMultiplier) || null,
      authoredPortraitScale: Number(profile?.anatomy?.portraitScale) || null,
      left: scaledPosition(profile?.anchors?.leftHandShoulder?.position, scale),
      right: scaledPosition(profile?.anchors?.rightHandShoulder?.position, scale),
    };
  }

  function installScaleFreePlacement(THREE, rig) {
    const parent = rig?.parent;
    if (!parent?.isObject3D || rig.__hobunjiScaleFreeWorldPlacement) return rig;

    const parentWorldQuaternion = new THREE.Quaternion(); // Reused by placeHandWorld; avoids per-frame allocation for the parent basis.
    const localQuaternion = new THREE.Quaternion(); // Reused by placeHandWorld to convert the desired world orientation into parent-local space.

    rig.placeHandWorld = function scaleFreePlaceHandWorld(side, worldPosition, worldQuaternion) {
      const socket = rig.group?.getObjectByName?.(`${side}_hand_socket`);
      if (!socket || !worldPosition || !worldQuaternion) return false;

      // Position conversion intentionally keeps the real matrix hierarchy because
      // reflected scale must mirror attachment offsets just like the body artwork.
      parent.updateWorldMatrix?.(true, false);
      const localPosition = worldPosition.clone();
      parent.worldToLocal(localPosition);

      // Orientation conversion deliberately ignores scale/reflection. This is the
      // same convention used by PlayerBodyTransformComposer and WeaponToolStances.
      hierarchyWorldQuaternion(THREE, parent, parentWorldQuaternion);
      localQuaternion.copy(parentWorldQuaternion).invert().multiply(worldQuaternion).normalize();

      socket.position.copy(localPosition);
      socket.quaternion.copy(localQuaternion);
      socket.visible = true;
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
      return true;
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function scaleFreeHandDebug() {
      return {
        ...(originalDebug?.() || {}),
        worldQuaternionBasis: 'scale-free-hierarchy',
      };
    };

    Object.defineProperty(rig, '__hobunjiScaleFreeWorldPlacement', { value: true, configurable: true });
    return rig;
  }

  const wrappedAttach = function scaleFreeHandAttach(THREE, parent, options = {}) {
    return installScaleFreePlacement(THREE, originalAttach(THREE, parent, options));
  };
  wrappedAttach.__hobunjiScaleFreeWorldWrapped = true;

  // The shoulder-aim module loads immediately after this one and replaces
  // hands.attach. Intercept that one assignment so every finished shoulder-aim
  // rig receives the actor-scale adapter after (not before) its own method
  // wrappers. This preserves the normal hand bootstrap order without a new file.
  let activeAttach = wrappedAttach;
  function installActorScaleAdapter(nextAttach) {
    if (typeof nextAttach !== 'function' || nextAttach.__hobunjiCharacterAnchorScaleWrapped) return nextAttach;
    if (!nextAttach.__hobunjiShoulderAimWrapped) return nextAttach;
    const adapted = function actorScaledShoulderAttach(THREE, parent, options = {}) {
      const rig = nextAttach.call(this, THREE, parent, options);
      if (!rig || rig.__hobunjiCharacterAnchorScaleRigWrapped) return rig;

      const wrapSolveMethod = name => {
        const original = rig[name]?.bind(rig);
        if (!original) return;
        rig[name] = function actorScaledShoulderSolve() {
          const args = arguments;
          return withActorScaledShoulderProfile(rig, () => original(...args));
        };
      };
      wrapSolveMethod('setSideIdle');
      wrapSolveMethod('useIdlePose');
      wrapSolveMethod('placeHandWorld');

      const originalDebug = rig.getDebug?.bind(rig);
      rig.getDebug = function actorScaledShoulderDebug() {
        return {
          ...(originalDebug?.() || {}),
          characterAnchorScale: effectiveShoulderDebug(rig),
        };
      };
      Object.defineProperty(rig, '__hobunjiCharacterAnchorScaleRigWrapped', { value: true, configurable: true });
      return rig;
    };
    adapted.__hobunjiShoulderAimWrapped = true;
    adapted.__hobunjiCharacterAnchorScaleWrapped = true;
    return adapted;
  }

  try {
    Object.defineProperty(hands, 'attach', {
      configurable: true,
      enumerable: true,
      get() { return activeAttach; },
      set(nextAttach) { activeAttach = installActorScaleAdapter(nextAttach); },
    });
  } catch (_) {
    hands.attach = wrappedAttach;
  }

  global.HobunjiCharacterAnchorScale = Object.freeze({
    factorForRig: effectiveCharacterAnchorScale,
    effectiveShouldersForRig: effectiveShoulderDebug,
    mode: 'rendered-portrait-scale / authored-profile-scale',
  });
  global.ProceduralHandScaleFreeWorld = Object.freeze({
    mode: 'scale-free-quaternion-hierarchy + actor-scaled-character-shoulders',
  });
})(window);

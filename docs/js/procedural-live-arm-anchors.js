// Shared live shoulder/hand coordinate bridge for Procedural Animation Editor arm modes.
// Ground/Rest, Carry and future procedural arm overlays must resolve shoulders through
// the same attachment-rig + portrait-binding coordinate system as the normal hand runtime.
(function (global) {
  'use strict';

  if (global.HobunjiProceduralArmAnchors?.version >= 1) return;

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const valueKey = String(value || '').trim().toLowerCase();
    return valueKey === 'female' || valueKey === 'f' ? 'female' : 'male';
  }

  function finitePosition(value) {
    const source = value?.position || value || {};
    if (![source.x, source.y, source.z].every(axis => Number.isFinite(Number(axis)))) return null;
    return { x: Number(source.x), y: Number(source.y), z: Number(source.z) };
  }

  function rigFor(model) {
    return model?.userData?.proceduralHandRig || null;
  }

  function identityFor(model) {
    const selected = global.HobunjiGameplayBackdrop?.getSelectedNpc?.() || {};
    const appearance = selected.appearance || selected.profile?.appearance || {};
    const rig = rigFor(model);
    return {
      speciesId: normalizeKey(rig?.speciesId || appearance.speciesId || appearance.species || model?.userData?.speciesId || 'mao-ao'),
      gender: normalizeGender(rig?.gender || appearance.gender || model?.userData?.gender),
    };
  }

  function profileFor(model) {
    const identity = identityFor(model);
    const transformed = normalizeKey(typeof global.hobunjiTransformSpeciesId === 'function'
      ? global.hobunjiTransformSpeciesId(identity.speciesId)
      : identity.speciesId === 'rakakoan' ? 'kenkari' : identity.speciesId === 'ghoul' ? 'mao-ao' : identity.speciesId);
    const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return {
      identity,
      profile: characters[`${transformed}::${identity.gender}`]
        || characters[`${identity.speciesId}::${identity.gender}`]
        || null,
    };
  }

  function handParentFor(model) {
    const rig = rigFor(model);
    return rig?.parent || model?.userData?.proceduralHandParent || model?.parent || null;
  }

  function parentPointToModel(THREE, model, parent, source) {
    const point = source.clone ? source.clone() : new THREE.Vector3(Number(source.x) || 0, Number(source.y) || 0, Number(source.z) || 0);
    if (!model || !parent || parent === model) return point;
    parent.updateWorldMatrix?.(true, false);
    model.updateWorldMatrix?.(true, false);
    parent.localToWorld(point);
    model.worldToLocal(point);
    return point;
  }

  function legacyPortraitShoulder(THREE, model, side, identity) {
    const points = global.HobunjiHandShoulderPoints;
    const point = points?.pointFor?.(identity.speciesId, identity.gender, side);
    if (!point || !points?.isAuthored?.(point)) return null;
    const width = Math.max(0.05, Number(model?.userData?.portraitModelWidth) || 0.9);
    const height = Math.max(0.05, Number(model?.userData?.portraitModelHeight) || width);
    const placementRatio = Number(model?.userData?.portraitVerticalPlacementRatio);
    const assemblyY = ((Number.isFinite(placementRatio) ? placementRatio : 0.5) - 0.5) * height;
    return {
      position: new THREE.Vector3(
        -width / 2 + (Number(point.x) || 0) / 200 * width,
        assemblyY + height / 2 - (Number(point.y) || 0) / 200 * height,
        0,
      ),
      source: 'manual-portrait-200px',
    };
  }

  function resolveShoulderInModel(THREE, model, side) {
    if (!THREE || !model || (side !== 'left' && side !== 'right')) return null;
    const { identity, profile } = profileFor(model);
    const anchorName = side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder';
    const anchorSpace = global.HobunjiCharacterPortraitAnchorSpace;
    const metrics = profile && anchorSpace?.metricsForAvatarRoot?.(model, profile);
    const resolved = profile && metrics && anchorSpace?.resolveAnchor
      ? anchorSpace.resolveAnchor(profile, anchorName, metrics)
      : profile?.anchors?.[anchorName]?.position;
    const position = finitePosition(resolved);
    if (position) {
      const parent = handParentFor(model);
      return {
        position: parentPointToModel(THREE, model, parent, new THREE.Vector3(position.x, position.y, position.z)),
        source: anchorSpace?.resolveAnchor ? 'portrait-bound-attachment-rig-profile' : 'attachment-rig-profile',
        identity,
      };
    }

    const legacy = legacyPortraitShoulder(THREE, model, side, identity);
    if (legacy) return { ...legacy, identity };

    // Last-resort compatibility only. New authored species should never need this;
    // it deliberately avoids the old *0.62/+10% invented shoulder transform.
    const width = Math.max(0.05, Number(model?.userData?.portraitModelWidth) || 0.9);
    const height = Math.max(0.05, Number(model?.userData?.portraitModelHeight) || width);
    const handAttachX = Number(model?.userData?.handAttachX);
    const handAttachY = Number(model?.userData?.handAttachY);
    return {
      position: new THREE.Vector3(
        Number.isFinite(handAttachX) ? (side === 'left' ? -handAttachX : handAttachX) : (side === 'left' ? -width * 0.22 : width * 0.22),
        Number.isFinite(handAttachY) ? handAttachY : height * 0.45,
        0,
      ),
      source: 'legacy-hand-attach-fallback',
      identity,
    };
  }

  function handNodeFor(model, side) {
    const rig = rigFor(model);
    const socket = rig?.group?.getObjectByName?.(`${side}_hand_socket`) || null;
    if (socket) return socket;
    return model?.getObjectByName?.(`${model.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Hand`) || null;
  }

  function nodePositionInModel(THREE, model, node) {
    if (!THREE || !model || !node) return null;
    node.updateWorldMatrix?.(true, false);
    model.updateWorldMatrix?.(true, false);
    const point = node.getWorldPosition?.(new THREE.Vector3()) || node.position?.clone?.();
    if (!point) return null;
    if (node.getWorldPosition) model.worldToLocal(point);
    return point;
  }

  function setNodePositionFromModel(THREE, model, node, targetModel) {
    if (!THREE || !model || !node?.parent || !targetModel) return false;
    model.updateWorldMatrix?.(true, false);
    node.parent.updateWorldMatrix?.(true, false);
    const target = model.localToWorld(targetModel.clone());
    node.parent.worldToLocal(target);
    node.position.copy(target);
    node.updateMatrix?.();
    node.updateMatrixWorld?.(true);
    return true;
  }

  function captureHand(THREE, model, side) {
    const node = handNodeFor(model, side);
    if (!node) return null;
    const rig = rigFor(model);
    rig?.captureFreeHandForearmBaseline?.(side);
    return {
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
      modelPosition: nodePositionInModel(THREE, model, node),
    };
  }

  function restoreHand(record) {
    if (!record?.node) return false;
    record.node.position.copy(record.position);
    record.node.quaternion.copy(record.quaternion);
    record.node.scale.copy(record.scale);
    record.node.updateMatrix?.();
    record.node.updateMatrixWorld?.(true);
    return true;
  }

  function applyHandTarget(THREE, model, side, targetModel, jointModel = null) {
    const node = handNodeFor(model, side);
    if (!setNodePositionFromModel(THREE, model, node, targetModel)) return false;
    const rig = rigFor(model);
    if (rig?.realignFreeHandToForearm?.(side)) return true;
    if (!jointModel || !node?.parent) return true;

    // Fallback orientation for previews that do not have the generic late
    // forearm-alignment runtime loaded yet. Convert both solved points into the
    // actual hand parent before deriving the forearm direction.
    const joint = model.localToWorld(jointModel.clone());
    const target = model.localToWorld(targetModel.clone());
    node.parent.worldToLocal(joint);
    node.parent.worldToLocal(target);
    const direction = target.sub(joint);
    if (direction.lengthSq() > 1e-10) {
      node.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction.normalize());
      node.updateMatrix?.();
      node.updateMatrixWorld?.(true);
    }
    return true;
  }

  global.HobunjiProceduralArmAnchors = Object.freeze({
    version: 1,
    identityFor,
    profileFor,
    rigFor,
    handParentFor,
    resolveShoulderInModel,
    handNodeFor,
    nodePositionInModel,
    setNodePositionFromModel,
    captureHand,
    restoreHand,
    applyHandTarget,
  });
})(window);

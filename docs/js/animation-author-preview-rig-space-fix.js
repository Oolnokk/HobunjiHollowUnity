// Animation Author preview-space parity repair.
//
// Character attachment coordinates are authored in the same floor-relative
// player/body space consumed by gameplay. They must NOT inherit the editor's
// visual-only preview carrier (`actor.visualOffset`), because that carrier is
// allowed to receive body-scale and presentation corrections. Creature
// saddle/grip anchors intentionally keep their creature size-scale ancestry.
//
// This file is loaded only by Animation Author through hand-shoulder-points.js.
(() => {
  'use strict';

  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname || '')) return;

  const PATCH_ID = 'animation-author-character-rig-floor-space-v1';
  const CHARACTER_ANCHORS = Object.freeze([
    'posterior', 'shoulderPerch', 'leftHandShoulder', 'rightHandShoulder',
  ]);

  function isNpcActor(actor) {
    return actor?.source?.type === 'npc';
  }

  function copyLocalTransform(object) {
    if (!object) return null;
    return {
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z, order: object.rotation.order },
      scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
    };
  }

  function restoreLocalTransform(object, snapshot) {
    if (!object || !snapshot) return;
    object.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    object.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z, snapshot.rotation.order || 'XYZ');
    object.scale.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
    object.updateMatrix?.();
    object.updateMatrixWorld?.(true);
  }

  function reparentPreservingLocal(object, parent) {
    if (!object || !parent || object.parent === parent) return false;
    const local = copyLocalTransform(object);
    object.removeFromParent?.();
    parent.add(object);
    restoreLocalTransform(object, local);
    return true;
  }

  function ensureCharacterRigFloorRoot(actor) {
    if (!isNpcActor(actor) || !actor.attachmentAlignment) return null;
    let root = actor.characterRigFloorRoot;
    if (!root) {
      const THREE = window.THREE || globalThis.THREE || actor.root?.position?.constructor?.prototype?.isVector3 && null;
      const GroupCtor = actor.root?.constructor;
      if (!GroupCtor) return null;
      root = new GroupCtor();
      root.name = `CharacterRigFloorRoot_${String(actor.id || 'actor')}`;
      actor.attachmentAlignment.add(root);
      actor.characterRigFloorRoot = root;
    } else if (root.parent !== actor.attachmentAlignment) {
      reparentPreservingLocal(root, actor.attachmentAlignment);
    }

    // This root is the player's canonical floor/body frame, not a presentation
    // correction. Keeping it identity is the entire coordinate-space contract.
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);

    for (const name of CHARACTER_ANCHORS) {
      const anchor = actor.rigAnchors?.[name];
      if (anchor) reparentPreservingLocal(anchor, root);
    }

    // Direct hands/feet are also floor-relative consumers. Their geometry is
    // already species/gender scaled by their own runtimes; inheriting an extra
    // preview carrier scale makes their shoulder/ground relationship drift.
    if (actor.model?.userData) actor.model.userData.proceduralHandParent = root;
    if (actor.rigFeetPreview?.group) reparentPreservingLocal(actor.rigFeetPreview.group, root);

    root.updateMatrixWorld?.(true);
    return root;
  }

  function install() {
    // These identifiers are global lexical/function bindings declared by the
    // classic Animation Author script. Poll until the final wrapper chain has
    // installed so this patch remains the outermost coordinate-space guard.
    if (typeof createAnimationActorShell !== 'function'
      || typeof applyAttachmentRigProfileToActor !== 'function'
      || typeof actorRigAnchorLocalMatrix !== 'function') return false;
    if (window.__hobunjiAnimationAuthorCharacterRigFloorSpace === PATCH_ID) return true;

    const previousCreateActorShell = createAnimationActorShell;
    createAnimationActorShell = function previewRigSpaceCreateActorShell(args) {
      const actor = previousCreateActorShell.apply(this, arguments);
      ensureCharacterRigFloorRoot(actor);
      return actor;
    };

    const previousApplyRigProfile = applyAttachmentRigProfileToActor;
    applyAttachmentRigProfileToActor = function previewRigSpaceApplyRigProfile(actor) {
      ensureCharacterRigFloorRoot(actor);
      const result = previousApplyRigProfile.apply(this, arguments);
      ensureCharacterRigFloorRoot(actor);
      return result;
    };

    const previousRigAnchorMatrix = actorRigAnchorLocalMatrix;
    actorRigAnchorLocalMatrix = function previewRigSpaceAnchorMatrix(actor, anchorName) {
      if (isNpcActor(actor) && CHARACTER_ANCHORS.includes(anchorName)) {
        ensureCharacterRigFloorRoot(actor);
        const anchor = actor?.rigAnchors?.[anchorName];
        if (anchor && typeof transformMatrixFromSnapshot === 'function' && typeof transformSnapshot === 'function') {
          // Gameplay composes the character anchor directly through playerMesh.
          // attachmentAlignment is already the actor/body root here, so no
          // visualOffset scale/translation/rotation belongs in this matrix.
          return transformMatrixFromSnapshot(transformSnapshot(anchor));
        }
      }
      return previousRigAnchorMatrix.apply(this, arguments);
    };

    if (typeof installShoulderRigFeetPreviewV1529 === 'function') {
      const previousInstallFeet = installShoulderRigFeetPreviewV1529;
      installShoulderRigFeetPreviewV1529 = function previewRigSpaceInstallFeet(actor) {
        const result = previousInstallFeet.apply(this, arguments);
        ensureCharacterRigFloorRoot(actor);
        return result;
      };
    }

    // V15.35 deliberately scales visualOffset for live body-scale preview.
    // Anchors no longer live below it, so preserve that visual behavior while
    // guaranteeing the canonical rig floor root remains identity afterwards.
    if (typeof previewRigActorBodyScaleV1531 === 'function') {
      const previousPreviewScale = previewRigActorBodyScaleV1531;
      previewRigActorBodyScaleV1531 = function previewRigSpaceBodyScale(actor) {
        const result = previousPreviewScale.apply(this, arguments);
        ensureCharacterRigFloorRoot(actor);
        return result;
      };
    }

    // Repair actors that were restored/created before this late-loaded guard.
    try {
      for (const actor of animationAuthor?.actors || []) {
        ensureCharacterRigFloorRoot(actor);
        if (isNpcActor(actor)) previousApplyRigProfile(actor);
      }
      updateAnimationSelectionBox?.();
      attachAnimationGizmo?.();
    } catch (error) {
      console.warn('[animation-author-preview-rig-space] existing actor migration failed:', error);
    }

    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.previewCoordinateSpace = 'character-anchors-on-floor-root; visualOffset-presentation-only';
    window.__hobunjiAnimationAuthorCharacterRigFloorSpace = PATCH_ID;
    console.info('[animation-author-preview-rig-space] character anchors detached from visualOffset preview corrections');
    return true;
  }

  function installWhenReady() {
    if (install()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (install() || ++attempts >= 240) clearInterval(timer);
    }, 50);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  } else {
    installWhenReady();
  }
})();

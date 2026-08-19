// Preserves held-object registry ownership when a procedural hand Mesh is
// replaced by a SkinnedMesh by the two-bone hand/forearm converter.
//
// Outline/x-ray setup runs before the two-bone conversion and tags the static
// hand mesh for the held overlay. The converter copies those tags/layers onto a
// NEW SkinnedMesh object. HeldObjectRenderOrder's registry is object-identity
// based, though, so copying the tag is not enough: without adopting the new
// object, it can render once in the normal base pass and again in the held
// overlay. This bridge transfers that registration as soon as the replacement
// SkinnedMesh is added, without treating ordinary character skins as held items.
(function (global) {
  'use strict';

  if (/\/tools\/attack-animation-editor\//.test(global.location?.pathname || '')) return;

  const objectProto = global.THREE?.Object3D?.prototype;
  if (!objectProto || typeof objectProto.add !== 'function') return;
  if (objectProto.add.__hobunjiSkinnedHandHeldRegistrationWrapped) return;

  const pending = new Set(); // Tagged replacement skins waiting for HeldObjectRenderOrder to finish loading.
  const adopted = new WeakSet(); // Prevents diagnostic counters from growing when a skin is reparented.
  let adoptedCount = 0; // Number of replacement SkinnedMesh identities explicitly entered into the held registry.
  let inheritedTagCount = 0; // Adopted skins that arrived carrying the old mesh's held-registration marker.
  let flushTimer = 0; // Deferred retry while the held-object renderer is not available yet.

  function isProceduralHandSkin(object) {
    if (!object?.isSkinnedMesh) return false;
    const data = object.userData || {};
    return data.hobunjiProceduralHand === true || data.hobunjiHeldObjectPlane === true;
  }

  function scheduleFlush() {
    if (flushTimer || !pending.size) return;
    flushTimer = global.setTimeout(() => {
      flushTimer = 0;
      flushPending();
      if (pending.size) scheduleFlush();
    }, 50);
  }

  function adopt(object) {
    if (!isProceduralHandSkin(object)) return false;

    const held = global.HeldObjectRenderOrder;
    if (!held?.installed || typeof held.markHeldPlane !== 'function') {
      pending.add(object);
      scheduleFlush();
      return false;
    }

    const inheritedHeldTag = object.userData?.__hobunjiHandHeldXray === true
      || object.userData?.hobunjiHeldObjectPlane === true;

    // markHeldPlane always adds this exact object to HeldObjectRenderOrder's
    // iterable registry, even when the copied hobunjiHeldObjectPlane tag means
    // its boolean return value says the semantic tag was already present.
    held.markHeldPlane(object);
    pending.delete(object);
    object.userData = object.userData || {};
    object.userData.__hobunjiHandHeldXray = true;
    object.userData.hobunjiSkinnedHeldRegistryAdopted = true;

    if (!adopted.has(object)) {
      adopted.add(object);
      adoptedCount += 1;
      if (inheritedHeldTag) inheritedTagCount += 1;
    }
    return true;
  }

  function inspectTree(root) {
    if (!root) return;
    adopt(root);
    root.traverse?.(child => {
      if (child !== root) adopt(child);
    });
  }

  function flushPending() {
    for (const object of [...pending]) {
      if (!object?.isObject3D) {
        pending.delete(object);
        continue;
      }
      adopt(object);
    }
  }

  const previousAdd = objectProto.add;
  function skinnedHandHeldAwareAdd(...objects) {
    const result = previousAdd.apply(this, objects);
    for (const object of objects) inspectTree(object);
    return result;
  }
  skinnedHandHeldAwareAdd.__hobunjiSkinnedHandHeldRegistrationWrapped = true;
  skinnedHandHeldAwareAdd.__hobunjiSkinnedHandHeldRegistrationOriginal = previousAdd;
  objectProto.add = skinnedHandHeldAwareAdd;

  global.ProceduralHandSkinnedHeldRegistration = Object.freeze({
    adopt,
    flushPending,
    getDebug() {
      return {
        adopted: adoptedCount,
        inheritedTags: inheritedTagCount,
        pending: pending.size,
        heldRendererReady: !!global.HeldObjectRenderOrder?.installed,
      };
    },
  });
})(window);

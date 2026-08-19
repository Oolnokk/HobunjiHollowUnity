// Applies authored semantic weapon/tool basis to the player's visible tool plane.
//
// game.js may keep writing its legacy raw-PNG rotations for backwards compatibility.
// Immediately before rendering an authored tool, this layer replaces those raw sprite
// assumptions with the shared semantic basis, then restores game state afterward.
// Unauthored tools never enter this path and retain the exact legacy presentation.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const basisApi = global.HobunjiHandToolSemanticBasis;
  if (!hands || !basisApi || global.SemanticToolBasisRuntime) return;

  const hookedPlanes = new Set(); // Tool planes with render-bound semantic correction installed.
  let appliedFrames = 0; // Pixel-Probe/debug-friendly count proving semantic correction actually rendered.
  let lastToolKey = null;
  let lastSource = 'none';
  let lastDynamicTwistDeg = 0;

  function wrapPi(value) {
    let angle = Number(value) || 0;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function currentSnapshot() {
    return global.WeaponToolStances?.debugSnapshot?.() || null;
  }

  function currentToolKey() {
    const snapshot = currentSnapshot();
    return basisApi.toolBasisKeyFor?.(snapshot?.itemKey || snapshot?.shape || '') || null;
  }

  function findPlayerToolPlane() {
    const holder = hands.gameDeps?.toolHolder || null;
    if (!holder?.traverse) return null;
    let plane = null;
    holder.traverse(node => {
      if (!plane && node?.userData?.toolPlane?.isObject3D) plane = node.userData.toolPlane;
    });
    return plane;
  }

  function semanticStateForPlane(plane) {
    const key = currentToolKey();
    const basis = key ? basisApi.toolBasisFor?.(key) : null;
    const correction = key ? basisApi.toolEngineQuaternionFor?.(key) : null;
    if (!basis?.complete || !correction) return null;

    // game.js's -90° Z for sweep is a raw-PNG orientation assumption. Remove
    // only that fixed base and preserve any additional per-frame twist as a
    // semantic-plane-normal rotation. For the approved hatchet this is normally 0.
    const snapshot = currentSnapshot();
    const anim = String(snapshot?.combatAnim || snapshot?.sourceAnimStyle || '').toLowerCase();
    const legacyBaseZ = anim === 'sweep' ? -Math.PI / 2 : 0;
    const dynamicTwist = wrapPi((Number(plane.rotation?.z) || 0) - legacyBaseZ);
    return { key, basis, correction, dynamicTwist };
  }

  function applyBeforeRender(plane) {
    const state = semanticStateForPlane(plane);
    if (!state) return null;

    const saved = {
      x: plane.quaternion.x,
      y: plane.quaternion.y,
      z: plane.quaternion.z,
      w: plane.quaternion.w,
    };
    plane.quaternion.set(
      state.correction.x,
      state.correction.y,
      state.correction.z,
      state.correction.w,
    );
    if (Math.abs(state.dynamicTwist) > 1e-8) {
      const half = state.dynamicTwist * 0.5;
      plane.quaternion.multiply({ x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) }).normalize();
    }
    plane.updateMatrix?.();
    plane.updateMatrixWorld?.(true);

    appliedFrames += 1;
    lastToolKey = state.key;
    lastSource = state.basis.source || 'semantic';
    lastDynamicTwistDeg = state.dynamicTwist * 180 / Math.PI;
    return saved;
  }

  function restoreAfterRender(plane, saved) {
    if (!saved) return;
    plane.quaternion.set(saved.x, saved.y, saved.z, saved.w);
    plane.updateMatrix?.();
    plane.updateMatrixWorld?.(true);
  }

  function hookPlane(plane) {
    if (!plane?.isObject3D || hookedPlanes.has(plane)) return false;
    hookedPlanes.add(plane);
    plane.userData = plane.userData || {};
    const previousBefore = typeof plane.onBeforeRender === 'function' ? plane.onBeforeRender : null;
    const previousAfter = typeof plane.onAfterRender === 'function' ? plane.onAfterRender : null;
    let savedQuaternion = null; // Per-render-pass legacy quaternion restored immediately after the draw.

    plane.onBeforeRender = function semanticToolBasisBeforeRender(...args) {
      previousBefore?.apply(this, args);
      savedQuaternion = applyBeforeRender(this);
    };
    plane.onAfterRender = function semanticToolBasisAfterRender(...args) {
      restoreAfterRender(this, savedQuaternion);
      savedQuaternion = null;
      return previousAfter?.apply(this, args);
    };
    plane.userData.hobunjiSemanticToolBasisHook = true;
    return true;
  }

  function frame() {
    for (const plane of [...hookedPlanes]) {
      if (!plane?.parent) hookedPlanes.delete(plane);
    }
    hookPlane(findPlayerToolPlane());
    global.requestAnimationFrame(frame);
  }
  global.requestAnimationFrame(frame);

  global.SemanticToolBasisRuntime = Object.freeze({
    refresh() { return hookPlane(findPlayerToolPlane()); },
    getDebug() {
      const key = currentToolKey();
      const basis = key ? basisApi.toolBasisFor?.(key) : null;
      return {
        currentToolKey: key,
        currentBasisSource: basis?.source || 'none',
        currentBasisComplete: basis?.complete === true,
        hookedPlanes: hookedPlanes.size,
        appliedFrames,
        lastToolKey,
        lastSource,
        lastDynamicTwistDeg,
      };
    },
  });
})(window);

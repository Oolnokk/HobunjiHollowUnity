(() => {
  'use strict';

  const activeTrees = new Set(); // Only trees whose opacity is still changing.
  const fadeByTree = new WeakMap(); // Reuses fade materials while a tree stays loaded.
  let lerpPerSec = 6; // Opacity units per second.

  function init(deps) {
    if (Number.isFinite(deps.lerpPerSec)) lerpPerSec = deps.lerpPerSec;
  }

  function createFade(tree) {
    const materials = []; // Records each source material so it can rejoin the opaque render queue.
    for (const child of tree.children) {
      const original = child.material; // Only direct tree meshes participated in the legacy fade.
      if (!original?.clone) continue;
      const faded = original.clone();
      faded.transparent = true;
      materials.push({ child, original, faded });
    }
    if (!materials.length) return null;
    const state = { materials, opacity: 1, target: 1, applied: false, blocking: false };
    fadeByTree.set(tree, state);
    return state;
  }

  function reset(tree) {
    activeTrees.delete(tree);
    const state = fadeByTree.get(tree);
    if (!state?.applied) return;
    for (const { child, original, faded } of state.materials) {
      if (child.material === faded) child.material = original;
    }
    state.applied = false;
  }

  function forget(tree) {
    reset(tree);
    const state = fadeByTree.get(tree);
    if (!state) return;
    for (const { faded } of state.materials) faded.dispose();
    fadeByTree.delete(tree);
  }

  function setTarget(tree, target, blocking) {
    const state = fadeByTree.get(tree) || (target < 1 ? createFade(tree) : null);
    if (!state) return;
    if (!state.applied) {
      if (target === 1) return;
      // A tree just entering the fade band starts at its target instead of flashing opaque.
      state.applied = true;
      state.target = state.opacity = target;
      state.blocking = blocking;
      for (const { child, original, faded } of state.materials) {
        faded.opacity = target;
        faded.depthWrite = !blocking && original.depthWrite;
        child.material = faded;
      }
      return;
    }
    if (state.blocking !== blocking) {
      state.blocking = blocking;
      for (const { original, faded } of state.materials) faded.depthWrite = !blocking && original.depthWrite;
    }
    if (state.target === target) return;
    state.target = target;
    if (state.opacity !== target) activeTrees.add(tree);
    else if (target === 1) reset(tree);
    else activeTrees.delete(tree);
  }

  function updateAnimation(dt) {
    const step = lerpPerSec * dt; // Maximum opacity change this frame.
    if (!(step > 0)) return;
    for (const tree of activeTrees) {
      const state = fadeByTree.get(tree);
      const delta = state.target - state.opacity; // Signed distance to the current fade target.
      state.opacity = Math.abs(delta) <= step ? state.target : state.opacity + Math.sign(delta) * step;
      for (const { faded } of state.materials) faded.opacity = state.opacity;
      if (state.opacity !== state.target) continue;
      if (state.target === 1) reset(tree);
      else activeTrees.delete(tree);
    }
  }

  // Is (px,pz) actually BETWEEN (ax,az) [camera] and (bx,bz) [player],
  // within `radius` of that line? Unlike a plain point-to-segment
  // distance, this rejects anything whose projection falls outside the
  // segment (t outside [0,1]) instead of clamping to the nearest
  // endpoint — clamping was the bug: a tree sitting right next to the
  // player but on the far side (behind them, from the camera's view)
  // has an unclamped t > 1, but clamping snapped that to the player's
  // own endpoint and reported it as "on the line" merely for being near
  // the player, faded/ghosted every tree behind the player as well as
  // the ones actually in front. Trees genuinely off to either side stay
  // correctly unaffected either way since `side` (perpendicular
  // distance) is unaffected by the clamp — only the "how far along" axis
  // was the problem.
  function isBetweenCameraAndPlayer2D(px, pz, ax, az, bx, bz, radius) {
    const abx = bx - ax, abz = bz - az;
    const abLenSq = abx * abx + abz * abz;
    if (abLenSq < 1e-9) return false;
    const t = ((px - ax) * abx + (pz - az) * abz) / abLenSq;
    if (t <= 0 || t >= 1) return false;
    const cx = ax + abx * t, cz = az + abz * t;
    return Math.hypot(px - cx, pz - cz) < radius;
  }

  // True once a tree's fade has settled fully transparent and is meant to
  // stay there (the corridor-edge fade at its far end). It draws no colour
  // then, only depth. ZoneVegetationCull stops drawing it until the target
  // rises again.
  function isFadedOut(tree) {
    const state = fadeByTree.get(tree);
    return !!state?.applied && state.opacity === 0 && state.target === 0;
  }

  window.ZoneTreeFade = {
    init, setTarget, reset, forget, updateAnimation, isBetweenCameraAndPlayer2D, isFadedOut,
    snapshot: () => ({ animating: activeTrees.size }),
  };
})();

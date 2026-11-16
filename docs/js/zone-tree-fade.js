(() => {
  'use strict';

  // Wilderness tree occlusion fade: the per-frame opacity ease for trees that
  // updateZoneVegetationCulling (game.js) has flagged as blocking the camera's
  // view of the player or a companion, plus the sightline test it uses.
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its siblings: game.js still owns the fade targets,
  // the material setup (ensureTreeFadeMaterials) and the set of trees
  // mid-fade, and hands that Set in through init().
  let treeFadeActive = null; // vegGroup refs currently mid-fade (game.js _treeFadeActive).
  let lerpPerSec = 6; // Opacity units per second (game.js TREE_FADE_LERP_PER_SEC).

  function init(deps) {
    treeFadeActive = deps.treeFadeActive;
    if (Number.isFinite(deps.lerpPerSec)) lerpPerSec = deps.lerpPerSec;
  }

  function updateAnimation(dt) {
    if (!treeFadeActive?.size) return;
    const step = lerpPerSec * dt;
    for (const vegGroup of treeFadeActive) {
      const target = vegGroup.userData._fadeTarget ?? 1;
      let opacity = vegGroup.userData._fadeOpacity ?? 1;
      if (Math.abs(opacity - target) <= step) opacity = target;
      else opacity += Math.sign(target - opacity) * step;
      vegGroup.userData._fadeOpacity = opacity;
      for (const m of vegGroup.userData._fadeMaterials || []) m.opacity = opacity;
      if (opacity === target && target >= 1) treeFadeActive.delete(vegGroup);
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

  window.ZoneTreeFade = { init, updateAnimation, isBetweenCameraAndPlayer2D };
})();

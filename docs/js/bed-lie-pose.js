// Shared player sleep pose: flatten the live portrait across the authored mattress, then advance the normal day.
// The gameplay owner injects its player transform/calendar callbacks; this module owns only presentation.
(() => {
  'use strict';

  const CHANNEL = 'bed-lie-pose'; // Composer channel reserved for the sleep animation, cleared before waking.
  const LIE_DURATION = 1.9; // Seconds to reach the bed before the existing sleep/day transition runs.
  const HOLD_DURATION = 0.55; // Brief fully-flat hold lets the pose read before the next morning.
  const XRAY_ORDER = 900; // Only the sleeping avatar's FRONT material bypasses depth during this short animation.
  let deps = null; // Live game adapters for the player, avatar, calendar and bed scene.
  let active = null; // Current sleep's immutable start/target points and mutable elapsed time.
  let xray = []; // Temporary material overrides to restore in all exit paths.
  const diagnostics = { begins: 0, completed: 0, cancelled: 0, last: null }; // Mobile/Pixel Probe-style sleep-pose telemetry.

  const clamp01 = number => Math.max(0, Math.min(1, Number(number) || 0));
  const smooth = number => { const t = clamp01(number); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  function clearFrontXray() {
    for (const entry of xray) {
      if (entry.node?.material === entry.material || (Array.isArray(entry.node?.material) && entry.node.material[0] === entry.cloned)) {
        entry.node.material = entry.material;
        entry.node.renderOrder = entry.order;
      }
      entry.cloned.dispose?.();
    }
    xray = [];
  }

  function applyFrontXray() {
    const avatar = deps?.playerRoot?.()?.children?.find(node => node.name === 'player_avatar'); // Avoid touching tools, garments or NPC portraits.
    if (!avatar) return;
    if (xray.length) { // Other game systems sometimes refresh the portrait render order; the sleeping overlay must win.
      for (const entry of xray) entry.node.renderOrder = XRAY_ORDER;
      return;
    }
    avatar.traverse(node => {
      const isSkinnedFront = node.isSkinnedMesh && Array.isArray(node.material) && node.material.length >= 2;
      const isRigidFront = node.name === 'npc_avatar_front_plane' && !!node.material?.clone;
      if (!isSkinnedFront && !isRigidFront) return;
      const previous = node.material; // Restored once the morning/day rollover completes.
      const front = isSkinnedFront ? previous[0] : previous;
      if (!front?.clone) return;
      const overlay = front.clone(); // Per-mesh clone prevents changing shared portrait materials elsewhere.
      overlay.depthTest = false; overlay.depthWrite = false; overlay.transparent = true;
      node.material = isSkinnedFront ? [overlay, ...previous.slice(1)] : overlay;
      xray.push({ node, material: previous, order: node.renderOrder, cloned: overlay }); // Complete cleanup across both rigid and skinned paths.
      node.renderOrder = XRAY_ORDER;
    });
  }

  function clear(reason, restorePosition = true) {
    const prior = active; // Original tile coordinates ensure waking never leaves the player stuck inside the bed collider.
    if (!prior) return;
    window.PlayerBodyTransformComposer?.clearChannel?.(CHANNEL);
    clearFrontXray();
    if (restorePosition) {
      const player = deps?.player?.();
      if (player) { player.x = prior.startX; player.y = prior.startY; player.vx = 0; player.vy = 0; }
    }
    active = null;
    diagnostics.last = { ...diagnostics.last, reason }; // Last reported state stays available after the animation ends.
  }

  function begin(furniture) {
    if (active) return { ok: false, message: 'Already getting into bed.' };
    if (!deps?.player?.() || !deps.playerRoot?.() || !deps?.sleep || !window.PlayerBodyTransformComposer?.setChannel)
      return { ok: false, message: 'The bed animation is not ready.' };
    if (!furniture?.mesh?.parent || !/^(basicBed|doubleBed|bedroll)$/.test(furniture.key))
      return { ok: false, message: 'This bed is not available.' };
    const THREE = deps.THREE; // Uses Three's actual furniture-local-to-world transform, including room placement and rotation.
    const authored = window.AuthoredFurniture?.peek?.(furniture.key);
    const height = window.AuthoredFurniture?.sleepSurfaceHeight?.(authored);
    if (!THREE || !Number.isFinite(height)) return { ok: false, message: 'Cannot find the mattress surface.' };
    furniture.mesh.updateWorldMatrix(true, false);
    const contact = furniture.mesh.localToWorld(new THREE.Vector3(0, height, 0)); // Mattress top; child guide geometry never controls placement.
    if (![contact.x, contact.y, contact.z].every(Number.isFinite)) return { ok: false, message: 'Invalid mattress position.' };
    const player = deps.player();
    const tileSize = deps.tileSize(); // Game coordinates use pixels while the avatar/furniture scene uses world tiles.
    active = {
      furniture, area: deps.area(), elapsed: 0,
      startX: player.x, startY: player.y,
      targetX: contact.x * tileSize, targetY: contact.z * tileSize,
      surfaceY: contact.y, yaw: furniture.mesh.rotation.y,
    }; // Keeps the exact original standing position for safe restoration.
    // The furniture is tile-aligned and currently rotated around the world-up Y axis.
    diagnostics.begins++;
    diagnostics.last = { key: furniture.key, surfaceY: contact.y, elapsed: 0, phase: 'approach' };
    return { ok: true, message: 'You lie down on the bed.' };
  }

  function update(dt) {
    if (!active) return;
    if (deps.area() !== active.area || !active.furniture.mesh.parent || !deps.playerRoot()) {
      diagnostics.cancelled++;
      clear('area-changed');
      return;
    }
    if (deps.isPaused?.()) return;
    const elapsed = active.elapsed = Math.min(LIE_DURATION + HOLD_DURATION, active.elapsed + Math.max(0, Math.min(0.1, Number(dt) || 0)));
    const approach = smooth(elapsed / 1.25); // Travel to the center of the bed before rotating the portrait.
    const flatten = smooth((elapsed - 0.35) / (LIE_DURATION - 0.35)); // Whole avatar rotates upright->flat around the posterior, not scaled down.
    const player = deps.player();
    const root = deps.playerRoot();
    player.x = lerp(active.startX, active.targetX, approach);
    player.y = lerp(active.startY, active.targetY, approach);
    player.vx = player.vy = 0;
    const hips = Number(deps.playerLegs?.()?.standingPosteriorY); // The current species' own posterior height, not a hardcoded human hip.
    const posterior = Number.isFinite(hips) ? hips : (Number(window.PlayerBodyTransformComposer?.getPosteriorY?.()) || 0.3);
    const surfaceLift = active.surfaceY + 0.035 - root.position.y - posterior; // Keeps the horizontal plane slightly above the mattress's actual top.
    window.PlayerBodyTransformComposer.setChannel(CHANNEL, {
      priority: 950, absoluteYaw: active.yaw, rotation: { pitch: -Math.PI / 2 * flatten },
      translation: { y: surfaceLift * flatten }, includeExternal: false,
    }); // Render-time pose leaves physics, weapon and original movement transforms untouched.
    if (flatten > 0.35) applyFrontXray();
    diagnostics.last = { key: active.furniture.key, surfaceY: active.surfaceY, elapsed, phase: elapsed < LIE_DURATION ? 'flattening' : 'lying-flat', flatten, xrayMeshes: xray.length };
    if (elapsed >= LIE_DURATION + HOLD_DURATION) {
      clear('slept');
      diagnostics.completed++;
      const result = deps.sleep(); // Existing day-rollover, crops, health/stamina and save behavior stay authoritative.
      deps.showToast?.(result.message, result.ok);
    }
  }

  function init(adapters) { deps = adapters; }
  function cancel(reason = 'cancelled') { if (active) { diagnostics.cancelled++; clear(reason); } }
  function debug() {
    return { active: !!active, elapsed: active?.elapsed || 0, xrayMeshes: xray.length, ...diagnostics };
  }
  window.BedLiePose = { init, begin, update, cancel, isActive: () => !!active, debug };
})();

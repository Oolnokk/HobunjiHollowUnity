// Enforces lifecycle ownership for procedural hand rigs.
//
// PNG avatar rebuilds are not all guaranteed to call PNGPlaneAvatar.disposeAvatarModel;
// some game paths remove/replace the old avatar group directly. The hand frame driver
// used to keep that old rig alive because avatarRoot.userData still existed, leaving
// one stale pair on playerMesh before the replacement avatar received another pair.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  if (!hands?.attach || hands.attach.__hobunjiHandLifecycleGuardWrapped) return;

  const tracked = new Set(); // Live rigs returned through the fully wrapped hand attachment chain.
  let staleDetachedPruned = 0; // Detached/reparented avatar rigs removed by the sweep below.
  let duplicatePlayerPruned = 0; // Older simultaneous hand rigs removed from playerMesh.
  let lastPruneReason = 'none'; // Mobile/debug-readable reason for the most recent cleanup.
  let serial = 0; // Monotonic attachment order used to keep the newest player rig during overlap.

  function clearAvatarOwnership(rig) {
    const avatarRoot = rig?.avatarRoot;
    if (avatarRoot?.userData?.proceduralHandRig === rig) avatarRoot.userData.proceduralHandRig = null;
  }

  function disposeTrackedRig(rig, reason) {
    if (!rig || !tracked.has(rig)) return false;
    tracked.delete(rig);
    clearAvatarOwnership(rig);
    try { rig.dispose?.(); } catch (error) {
      console.warn('[ProceduralHandLifecycleGuard] rig disposal failed:', error);
    }
    lastPruneReason = reason || 'lifecycle cleanup';
    return true;
  }

  function pruneDetached() {
    for (const rig of [...tracked]) {
      const avatarRoot = rig?.avatarRoot;
      if (!avatarRoot) continue; // Editor-only/custom rigs may intentionally have no avatar owner.
      const groupParent = rig.group?.parent || null;
      const avatarParent = avatarRoot.parent || null;
      const expectedParent = rig.parent || null;
      if (groupParent && avatarParent === expectedParent && groupParent === expectedParent) continue;
      if (disposeTrackedRig(rig, 'avatar detached/reparented')) staleDetachedPruned += 1;
    }
  }

  function pruneDuplicatePlayerRigs() {
    const playerMesh = hands.gameDeps?.playerMesh || null;
    if (!playerMesh) return;
    const playerRigs = [...tracked]
      .filter(rig => rig?.parent === playerMesh && rig?.group?.parent === playerMesh)
      .sort((a, b) => (Number(a.__hobunjiLifecycleSerial) || 0) - (Number(b.__hobunjiLifecycleSerial) || 0));
    if (playerRigs.length <= 1) return;

    // During avatar replacement there can briefly be two still-parented avatar roots.
    // Keep only the newest hand rig; the old pair must never survive on playerMesh.
    for (const rig of playerRigs.slice(0, -1)) {
      if (disposeTrackedRig(rig, 'duplicate player hand rig')) duplicatePlayerPruned += 1;
    }
  }

  function sweep() {
    pruneDetached();
    pruneDuplicatePlayerRigs();
  }

  const originalAttach = hands.attach;
  const wrappedAttach = function lifecycleGuardedHandAttach(...args) {
    const rig = originalAttach.apply(this, args);
    if (!rig) return rig;
    if (!tracked.has(rig)) {
      tracked.add(rig);
      Object.defineProperty(rig, '__hobunjiLifecycleSerial', {
        value: ++serial,
        configurable: true,
      });

      const originalDispose = typeof rig.dispose === 'function' ? rig.dispose.bind(rig) : null;
      if (originalDispose && !rig.__hobunjiLifecycleDisposeWrapped) {
        rig.dispose = function lifecycleTrackedDispose(...disposeArgs) {
          tracked.delete(rig);
          clearAvatarOwnership(rig);
          return originalDispose(...disposeArgs);
        };
        Object.defineProperty(rig, '__hobunjiLifecycleDisposeWrapped', { value: true, configurable: true });
      }
    }
    sweep();
    return rig;
  };
  wrappedAttach.__hobunjiHandLifecycleGuardWrapped = true;
  wrappedAttach.__hobunjiHandLifecycleGuardOriginal = originalAttach;
  hands.attach = wrappedAttach;

  function frame() {
    sweep();
    global.requestAnimationFrame(frame);
  }
  global.requestAnimationFrame(frame);

  global.ProceduralHandLifecycleGuard = Object.freeze({
    sweep,
    getDebug() {
      const playerMesh = hands.gameDeps?.playerMesh || null;
      return {
        trackedRigs: tracked.size,
        playerRigs: playerMesh
          ? [...tracked].filter(rig => rig?.parent === playerMesh && rig?.group?.parent === playerMesh).length
          : 0,
        staleDetachedPruned,
        duplicatePlayerPruned,
        lastPruneReason,
      };
    },
  });
})(window);

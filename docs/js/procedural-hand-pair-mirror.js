// Applies an optional pair-wide horizontal reflection to procedural hand visuals.
//
// model.mirrorX describes the handedness of the SOURCE GLB and is consumed by
// procedural-hand-attachments.js when deriving left vs right. horizontalMirrorX is
// deliberately separate: it flips both already-derived sides across their own local X.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralHandAttachments;
  if (!profiles || !hands?.attach || hands.attach.__hobunjiPairMirrorWrapped) return;

  const activeRigs = new Set(); // Used to refresh every live editor/game hand pair after profile changes.

  function modelForRig(rig) {
    return profiles.modelForSpecies?.(rig?.speciesId) || null;
  }

  function applyVisual(rig, side) {
    const visual = rig?.group?.getObjectByName?.(`${side}_hand_visual`);
    if (!visual) return false;

    if (!Number.isFinite(Number(visual.userData?.hobunjiPairMirrorBaseScaleX))) {
      visual.userData = visual.userData || {};
      visual.userData.hobunjiPairMirrorBaseScaleX = Number(visual.scale?.x) || 1;
    }

    const baseScaleX = Number(visual.userData.hobunjiPairMirrorBaseScaleX) || 1;
    const enabled = modelForRig(rig)?.horizontalMirrorX === true;
    visual.scale.x = baseScaleX * (enabled ? -1 : 1);
    visual.userData.hobunjiPairMirrorX = enabled;
    visual.updateMatrix?.();
    visual.updateMatrixWorld?.(true);
    return true;
  }

  function applyRig(rig) {
    if (!rig) return false;
    const left = applyVisual(rig, 'left');
    const right = applyVisual(rig, 'right');
    return left || right;
  }

  function refreshAll() {
    let changed = 0;
    for (const rig of [...activeRigs]) {
      if (!rig?.group?.parent) {
        activeRigs.delete(rig);
        continue;
      }
      if (applyRig(rig)) changed += 1;
    }
    return changed;
  }

  // Hand rigs subscribe to profile mutations after this module loads. Wrap those
  // subscriptions so the pair reflection is re-applied after async GLB replacement,
  // not just to the synchronous fallback mesh installed at refresh start.
  const originalSubscribe = profiles.subscribe?.bind(profiles);
  if (originalSubscribe && !profiles.__hobunjiPairMirrorSubscribeWrapped) {
    profiles.subscribe = function pairMirrorAwareSubscribe(listener) {
      return originalSubscribe(data => {
        let result;
        try { result = listener(data); }
        finally {
          global.requestAnimationFrame?.(refreshAll);
        }
        Promise.resolve(result).finally(() => {
          refreshAll();
          global.requestAnimationFrame?.(refreshAll);
        });
        return result;
      });
    };
    Object.defineProperty(profiles, '__hobunjiPairMirrorSubscribeWrapped', { value: true, configurable: true });
  }

  const originalAttach = hands.attach;
  const wrappedAttach = function pairMirrorHandAttach(...args) {
    const rig = originalAttach.apply(this, args);
    if (!rig) return rig;

    activeRigs.add(rig);
    applyRig(rig);

    const originalRefresh = typeof rig.refreshModelProfile === 'function'
      ? rig.refreshModelProfile.bind(rig)
      : null;
    if (originalRefresh) {
      rig.refreshModelProfile = function pairMirrorRefresh(...refreshArgs) {
        const result = originalRefresh(...refreshArgs);
        Promise.resolve(result).finally(() => applyRig(rig));
        return result;
      };
    }

    const originalDebug = typeof rig.getDebug === 'function' ? rig.getDebug.bind(rig) : null;
    if (originalDebug) {
      rig.getDebug = function pairMirrorDebug() {
        const left = rig.group?.getObjectByName?.('left_hand_visual');
        const right = rig.group?.getObjectByName?.('right_hand_visual');
        return {
          ...originalDebug(),
          horizontalMirrorX: modelForRig(rig)?.horizontalMirrorX === true,
          pairMirrorApplied: {
            left: left?.userData?.hobunjiPairMirrorX === true,
            right: right?.userData?.hobunjiPairMirrorX === true,
          },
        };
      };
    }

    const originalDispose = typeof rig.dispose === 'function' ? rig.dispose.bind(rig) : null;
    if (originalDispose) {
      rig.dispose = function pairMirrorDispose(...disposeArgs) {
        activeRigs.delete(rig);
        return originalDispose(...disposeArgs);
      };
    }

    return rig;
  };

  wrappedAttach.__hobunjiPairMirrorWrapped = true;
  wrappedAttach.__hobunjiPairMirrorOriginal = originalAttach;
  hands.attach = wrappedAttach;

  global.ProceduralHandPairMirror = Object.freeze({
    refreshAll,
    getDebug() {
      return {
        activeRigs: activeRigs.size,
        rigs: [...activeRigs].map(rig => ({
          speciesId: rig?.speciesId || null,
          modelKey: profiles.modelKeyForSpecies?.(rig?.speciesId) || null,
          horizontalMirrorX: modelForRig(rig)?.horizontalMirrorX === true,
          leftApplied: rig?.group?.getObjectByName?.('left_hand_visual')?.userData?.hobunjiPairMirrorX === true,
          rightApplied: rig?.group?.getObjectByName?.('right_hand_visual')?.userData?.hobunjiPairMirrorX === true,
        })),
      };
    },
  });
})(window);

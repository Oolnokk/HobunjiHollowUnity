// Applies optional pair-wide local-axis reflections to procedural hand visuals.
//
// model.mirrorX describes the handedness of the SOURCE GLB and is consumed by
// procedural-hand-attachments.js when deriving left vs right. model.mirrorAxes
// is deliberately separate: it reflects both already-derived sides across any
// combination of their own local X/Y/Z axes. Legacy horizontalMirrorX is read
// only when mirrorAxes has not been authored yet.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const hands = global.ProceduralHandAttachments;
  if (!profiles || !hands?.attach || hands.attach.__hobunjiPairMirrorWrapped) return;

  const activeRigs = new Set(); // Used to refresh every live editor/game hand pair after profile changes.
  const AXES = Object.freeze(['x', 'y', 'z']);

  function modelForRig(rig) {
    return profiles.modelForSpecies?.(rig?.speciesId) || null;
  }

  // Explicit mirrorAxes is authoritative. horizontalMirrorX exists only so old
  // saved hand profiles retain their previous X reflection until re-authored.
  function axesForModel(model) {
    const explicit = model?.mirrorAxes;
    if (explicit && typeof explicit === 'object') {
      return {
        x: explicit.x === true,
        y: explicit.y === true,
        z: explicit.z === true,
      };
    }
    return {
      x: model?.horizontalMirrorX === true,
      y: false,
      z: false,
    };
  }

  function ensureBaseScale(visual) {
    visual.userData = visual.userData || {};
    if (!visual.userData.hobunjiPairMirrorBaseScale) {
      visual.userData.hobunjiPairMirrorBaseScale = {
        x: Number(visual.scale?.x) || 1,
        y: Number(visual.scale?.y) || 1,
        z: Number(visual.scale?.z) || 1,
      };
    }
    return visual.userData.hobunjiPairMirrorBaseScale;
  }

  function applyVisual(rig, side) {
    const visual = rig?.group?.getObjectByName?.(`${side}_hand_visual`);
    if (!visual) return false;

    const base = ensureBaseScale(visual);
    const axes = axesForModel(modelForRig(rig));
    visual.scale.set(
      base.x * (axes.x ? -1 : 1),
      base.y * (axes.y ? -1 : 1),
      base.z * (axes.z ? -1 : 1),
    );
    visual.userData.hobunjiPairMirrorAxes = { ...axes };
    // Legacy diagnostic alias; no runtime logic reads it as authority.
    visual.userData.hobunjiPairMirrorX = axes.x;
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

  function settle(result, callback) {
    // Reapply after either successful or failed async model refresh without creating
    // an extra unhandled rejection branch solely for mirror bookkeeping.
    Promise.resolve(result).then(callback, callback);
  }

  // Hand rigs subscribe to profile mutations after this module loads. Wrap those
  // subscriptions so pair reflections are re-applied after async GLB replacement,
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
        settle(result, () => {
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
        settle(result, () => applyRig(rig));
        return result;
      };
    }

    const originalDebug = typeof rig.getDebug === 'function' ? rig.getDebug.bind(rig) : null;
    if (originalDebug) {
      rig.getDebug = function pairMirrorDebug() {
        const left = rig.group?.getObjectByName?.('left_hand_visual');
        const right = rig.group?.getObjectByName?.('right_hand_visual');
        const axes = axesForModel(modelForRig(rig));
        return {
          ...originalDebug(),
          mirrorAxes: axes,
          pairMirrorApplied: {
            left: { ...(left?.userData?.hobunjiPairMirrorAxes || {}) },
            right: { ...(right?.userData?.hobunjiPairMirrorAxes || {}) },
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
    axesForModel,
    refreshAll,
    getDebug() {
      return {
        activeRigs: activeRigs.size,
        rigs: [...activeRigs].map(rig => {
          const axes = axesForModel(modelForRig(rig));
          const left = rig?.group?.getObjectByName?.('left_hand_visual')?.userData?.hobunjiPairMirrorAxes || {};
          const right = rig?.group?.getObjectByName?.('right_hand_visual')?.userData?.hobunjiPairMirrorAxes || {};
          return {
            speciesId: rig?.speciesId || null,
            modelKey: profiles.modelKeyForSpecies?.(rig?.speciesId) || null,
            mirrorAxes: axes,
            leftApplied: Object.fromEntries(AXES.map(axis => [axis, left[axis] === true])),
            rightApplied: Object.fromEntries(AXES.map(axis => [axis, right[axis] === true])),
          };
        }),
      };
    },
  });
})(window);

// Debris-ifier V50 interior walls are structural geometry, not an optional
// preview layer. Keep every generated wall mesh enabled for collision/source
// transforms; the main-game render proxy owns the visible parent-realm draw.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  if (!GridTileAccessors || !DS) return;

  let appliedRoot = null;

  function activeRuinRoot() {
    if (GridTileAccessors.getCurrentArea?.() !== MAP_ID) return null;
    const scene = GridTileAccessors.getActiveScene?.();
    return scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  function applyToRoot(root) {
    if (!root?.traverse) return { count:0, meshVisible:0 };
    let count = 0;
    let meshVisible = 0;
    root.traverse(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      count++;
      object.visible = true;
      object.userData.runtimeWallPlaneVisualEnabled = true;
      object.userData.runtimeWallPlaneStructural = true;
      if (object.visible !== false) meshVisible++;
    });
    appliedRoot = root;
    return { count, meshVisible };
  }

  function apply() {
    const root = activeRuinRoot();
    if (!root) {
      appliedRoot = null;
      return { count:0, meshVisible:0 };
    }
    if (root !== appliedRoot) return applyToRoot(root);
    return { count:null, meshVisible:null, unchanged:true }; // Same root already applied; skip the per-frame full traverse (snapshot() stays available for diagnostics).
  }

  function snapshot(root = activeRuinRoot()) {
    if (!root?.traverse) return { enabled:true, count:0, meshVisible:0, blockerCount:0 };
    let count = 0;
    let meshVisible = 0;
    root.traverse(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      count++;
      if (object.visible !== false) meshVisible++;
    });
    const blockerCount = DS.debugSnapshot?.().blockers?.filter(record => String(record.id || '').startsWith('devruin-wall-')).length || 0;
    return { enabled:true, count, meshVisible, blockerCount };
  }

  function removeObsoleteToggle() {
    document.getElementById('devRandomRuinWallPlanesRow')?.remove?.();
    try { localStorage.removeItem('hobunjiDevRandomRuinWallPlanes'); } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removeObsoleteToggle, { once:true });
  else removeObsoleteToggle();

  DS.addBeforeRenderClient(() => apply()); // removeObsoleteToggle runs once at load; calling it per render hit localStorage every frame for every player.

  window.DevRandomRuinWallPlanes = Object.freeze({
    setVisible:() => apply(),
    isVisible:() => true,
    apply,
    snapshot:() => snapshot(),
  });
})();

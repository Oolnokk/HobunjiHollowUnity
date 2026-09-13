// Optional rendering control for Debris-ifier V50 interior wall planes.
// The exact V50 meshes stay in the scene and keep their collision blockers even
// when hidden; only their materials are toggled for visual comparison/debugging.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const STORAGE_KEY = 'hobunjiDevRandomRuinWallPlanes';
  const GridTileAccessors = window.GridTileAccessors;
  const DevSpawner = window.DevSpawner;
  const DS = window.DynamicSurfaces;
  if (!GridTileAccessors || !DevSpawner || !DS) return;

  let enabled = readEnabled();
  let appliedRoot = null;
  let appliedEnabled = null;

  function readEnabled() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw == null ? true : raw !== '0';
    } catch (_) {
      return true;
    }
  }

  function writeEnabled(value) {
    try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (_) {}
  }

  function activeRuinRoot() {
    if (GridTileAccessors.getCurrentArea?.() !== MAP_ID) return null;
    const scene = GridTileAccessors.getActiveScene?.();
    return scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  function wallMaterials(object) {
    if (!object?.material) return [];
    return Array.isArray(object.material) ? object.material.filter(Boolean) : [object.material];
  }

  function applyToRoot(root, visible = enabled) {
    if (!root?.traverse) return { count:0, renderVisible:0, meshVisible:0 };
    let count = 0;
    let renderVisible = 0;
    let meshVisible = 0;
    root.traverse(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      count++;
      // Keep mesh.visible true so DynamicSurfaces blockers registered by the
      // interior adapter remain active. Material visibility controls rendering.
      object.visible = true;
      const materials = wallMaterials(object);
      for (const material of materials) {
        material.visible = !!visible;
        material.needsUpdate = true;
      }
      if (materials.length && materials.every(material => material.visible !== false)) renderVisible++;
      if (object.visible !== false) meshVisible++;
      object.userData.runtimeWallPlaneVisualEnabled = !!visible;
    });
    appliedRoot = root;
    appliedEnabled = !!visible;
    return { count, renderVisible, meshVisible };
  }

  function apply() {
    const root = activeRuinRoot();
    if (!root) {
      appliedRoot = null;
      appliedEnabled = null;
      return { count:0, renderVisible:0, meshVisible:0 };
    }
    if (root !== appliedRoot || appliedEnabled !== enabled) return applyToRoot(root, enabled);
    return snapshot(root);
  }

  function snapshot(root = activeRuinRoot()) {
    if (!root?.traverse) return { enabled, count:0, renderVisible:0, meshVisible:0, blockerCount:0 };
    let count = 0, renderVisible = 0, meshVisible = 0;
    root.traverse(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      count++;
      const materials = wallMaterials(object);
      if (materials.length && materials.every(material => material.visible !== false)) renderVisible++;
      if (object.visible !== false) meshVisible++;
    });
    const blockerCount = DS.debugSnapshot?.().blockers?.filter(record => String(record.id || '').startsWith('devruin-wall-')).length || 0;
    return { enabled, count, renderVisible, meshVisible, blockerCount };
  }

  function setVisible(value, persist = true) {
    enabled = !!value;
    if (persist) writeEnabled(enabled);
    const checkbox = document.getElementById('settingDevRandomRuinWallPlanes');
    if (checkbox) checkbox.checked = enabled;
    appliedEnabled = null;
    return apply();
  }

  function installSettingsToggle() {
    if (document.getElementById('settingDevRandomRuinWallPlanes')) return;
    const generateButton = document.getElementById('devRandomTestRuinBtn');
    const generateRow = generateButton?.closest?.('.settings-row');
    if (!generateRow?.parentNode) return;

    const row = document.createElement('label');
    row.className = 'settings-row';
    row.id = 'devRandomRuinWallPlanesRow';
    row.innerHTML = `
      <div class="settings-label">
        <div class="settings-name">Prototype Wall Planes</div>
        <div class="settings-desc">Render the carved-smooth wall planes produced by Debris-ifier V50. Collision stays active when the planes are hidden.</div>
      </div>
      <span class="settings-toggle"><input type="checkbox" id="settingDevRandomRuinWallPlanes"><span class="toggle-slider"></span></span>`;
    generateRow.insertAdjacentElement('afterend', row);
    const checkbox = row.querySelector('#settingDevRandomRuinWallPlanes');
    checkbox.checked = enabled;
    checkbox.addEventListener('change', () => setVisible(checkbox.checked));
  }

  const nativeDevInit = DevSpawner.init;
  DevSpawner.init = function (...args) {
    const result = nativeDevInit.apply(this, args);
    installSettingsToggle();
    return result;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSettingsToggle, { once:true });
  } else {
    installSettingsToggle();
  }

  DS.addBeforeRenderClient(() => {
    installSettingsToggle();
    apply();
  });

  window.DevRandomRuinWallPlanes = Object.freeze({
    setVisible,
    isVisible:() => enabled,
    apply,
    snapshot:() => snapshot(),
  });
})();

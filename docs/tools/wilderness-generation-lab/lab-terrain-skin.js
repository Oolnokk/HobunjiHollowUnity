(() => {
  'use strict';

  const Preview = window.WildernessLabPreview;
  if (!Preview || Preview.__wildernessLabTerrainSkin || typeof Preview.renderWorkspace !== 'function') return;
  Preview.__wildernessLabTerrainSkin = true;

  function reskinGreatBasinRampField(merged, winterSettings) {
    if (!merged?.wildernessLabTerrainReports?.basin?.applied) return false;
    const scenes = [...(window.__wildernessLabScenes || [])]; // Captured by lab-features' renderer wrapper; normally contains exactly the active preview scene.
    let grassMaterial = null;
    for (const scene of scenes) {
      scene.traverse?.(node => {
        if (grassMaterial || !node?.isMesh) return;
        if (node.material?.userData?.terrainKey === 'grass' && node.name !== 'ramps') grassMaterial = node.material;
      });
      if (grassMaterial) break;
    }
    if (!grassMaterial) return false;

    let changed = false;
    for (const scene of scenes) {
      scene.traverse?.(node => {
        if (!node?.isMesh || node.name !== 'ramps') return;
        node.material = grassMaterial;
        node.userData.terrainKey = 'grass';
        changed = true;
      });
    }
    if (changed && winterSettings?.enabled && typeof Preview.rebuildWinter === 'function') Preview.rebuildWinter(winterSettings); // Winter targeting runs again after the basin ramp mesh becomes grass.
    return changed;
  }

  const previousRenderWorkspace = Preview.renderWorkspace.bind(Preview); // Loaded after cube markers so both marker attachment and base rendering remain intact.
  Preview.renderWorkspace = (workspace, rootId, winterSettings) => {
    const merged = previousRenderWorkspace(workspace, rootId, winterSettings);
    reskinGreatBasinRampField(merged, winterSettings);
    return merged;
  };
})();
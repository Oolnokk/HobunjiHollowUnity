// Reusable festival dressings on ordinary editable furniture. No collision or exit changes.
(() => {
  'use strict';
  const dressingKeys = Object.freeze({
    'road-arch': 'festivalArch', bandstand: 'festivalStage', dancefloor: 'festivalDanceFloor',
    gifts: 'festivalGifts', ancestors: 'festivalAncestors', blossoms: 'festivalBlossoms',
    feast: 'festivalFeast', sweets: 'festivalSweets', masks: 'festivalMasks', bunting: 'festivalBunting',
  }); // Maps event dressings to the same editable JSON files used by ordinary furniture.
  const structureDressings = Object.freeze({festivalArch:'road-arch',festivalStage:'bandstand',festivalDanceFloor:'dancefloor'}); // Fresh editor placements have no explicit event dressing field.
  function refreshFeast() { window.FurnitureTableSystem?.refreshServices?.(); }
  function onAuthoredFurnitureReady(root) {
    const span = root?.userData?.festivalArchSpan; // Set by decorate; the shared furniture builder notifies us after a cold upgrade installs meshById.
    if (!span || root.userData.authoredFurnitureDisposed) return;
    for (const mesh of root.userData.meshById?.values?.() || []) if (mesh.parent !== span) span.add(mesh);
    root.updateMatrixWorld?.(true);
  }
  function decorate(root, record) {
    const THREE = window.THREE; // Same renderer used by game and editor preview.
    const dressing = record.festivalDecoration || structureDressings[record.key]; // Standalone structural furniture also participates in festival setup/disposal without event-only metadata.
    if (!THREE || (!dressing && !record.activity)) return;
    const group = new THREE.Group(); // Owned by the prop; rebuilding/disposal follows its normal lifecycle.
    group.name = 'festival-dressing';
    if (structureDressings[record.key]) root.userData.festivalStructure = true; // Structural materials/geometries are instance-owned and follow the same festival disposal lifecycle.
    if (record.key === 'festivalArch') {
      const span = new THREE.Group(); // Intrinsic clear-span scaling stays separate from the editor's placement/gizmo scale.
      span.name = 'festival-arch-span';
      span.scale.x = Math.max(2, Math.min(9, Number(record.festivalArchWidth) || 4)) / 4;
      root.add(span);
      root.userData.festivalArchSpan = span; // Retained across an in-place authored upgrade; root placement transforms remain unchanged.
      onAuthoredFurnitureReady(root);
    }
    const color = record.festivalColor || '#caa45c'; // Used by the optional activity sign.
    const furnitureKey = dressingKeys[dressing]; // Shared authored assembly, also listed in the furniture editor.
    if (furnitureKey && !structureDressings[record.key]) {
      const addDressing = data => {
        if (!data || group.userData.festivalDisposed) return;
        const visual = window.AuthoredFurniture.buildGroup(data, color); // Uses permanent furniture's PNG/stretch material and geometry pipeline.
        group.add(visual);
        window.FurnitureTableSystem?.refreshServices?.();
      }; // Only dressing assemblies are appended; structural furniture already comes through the normal furniture builder.
      const data = window.AuthoredFurniture?.peek?.(furnitureKey); // Avoids asynchronous work when preload has completed.
      if (data) addDressing(data);
      else window.AuthoredFurniture?.load?.(furnitureKey).then(addDressing);
    }
    group.userData.festivalMaterials = []; // Sign materials are owned here; authored dressing materials are disposed below.
    if (record.activity && record.showActivitySign !== false && !['road-arch', 'bandstand', 'dancefloor', 'six-pot-feast'].includes(dressing) && window.HobunjiSpritePngSurface) {
      const canvas = document.createElement('canvas'); // Text is generated locally, so no external texture/CORS request is needed.
      canvas.width = 512; canvas.height = 96;
      const context = canvas.getContext('2d');
      context.fillStyle = '#17241fed'; context.fillRect(0, 0, 512, 96);
      context.strokeStyle = color; context.lineWidth = 6; context.strokeRect(3, 3, 506, 90);
      context.fillStyle = '#fff5dc'; context.font = 'bold 28px ' + getComputedStyle(document.body).fontFamily; // Festival sign labels use the gameplay typeface, not canvas's default sans-serif.
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(record.activity.label || window.FestivalCalendar?.activityLabels[record.activity.type] || record.activity.type, 256, 48, 480);
      const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, 'festival-sign');
      const surface = window.HobunjiSpritePngSurface.makeMaterial(THREE, texture, 'festival-sign', { side: THREE.DoubleSide });
      group.userData.festivalMaterials.push(surface);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .34), surface);
      sign.position.set(0, 1.45, .06);
      const parentRotation = new THREE.Quaternion(); // Reused at render time to keep the sign readable despite authored prop rotation.
      sign.onBeforeRender = (_renderer, _scene, camera) => { group.getWorldQuaternion(parentRotation); sign.quaternion.copy(parentRotation.invert()).multiply(camera.quaternion); };
      group.add(sign);
      group.userData.festivalTexture = texture;
    }
    root.add(group);
  }
  function dispose(root) {
    const materials = new Set(), textures = new Set(), geometries = new Set(); // Prevents duplicate disposal when structural roots also contain a dressing/sign group.
    root?.traverse?.(object => {
      if (!object.userData?.festivalStructure && object.name !== 'festival-dressing') return;
      if (object.userData.festivalDisposed) return;
      object.userData.festivalDisposed = true; // Cancels pending dressing loads when a scene/layout is replaced.
      if (object.userData.festivalStructure) object.userData.authoredFurnitureDisposed = true; // Prevents the normal async furniture upgrade from rebuilding a removed structure.
      object.traverse(child => {
        if (child.geometry && !geometries.has(child.geometry)) { geometries.add(child.geometry); child.geometry.dispose?.(); }
        const childMaterials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : []; // Only these festival-owned assemblies are traversed; host tables keep their own lifecycle.
        for (const material of childMaterials) {
          if (materials.has(material)) continue;
          materials.add(material);
          if (material.map && !textures.has(material.map)) { textures.add(material.map); material.map.dispose?.(); }
          material.dispose?.();
        }
      });
      object.userData.festivalMaterials = null;
      object.userData.festivalTexture = null;
    });
  }
  window.FestivalProps = { decorate, dispose, refreshFeast, dressingKeys, onAuthoredFurnitureReady };
})();

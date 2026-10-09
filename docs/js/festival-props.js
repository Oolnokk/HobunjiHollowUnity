// Reusable festival dressings on ordinary editable furniture. No collision or exit changes.
(() => {
  'use strict';
  function decorate(root, record) {
    const THREE = window.THREE; // Same renderer used by game and editor preview.
    const dressing = record.festivalDecoration; // Optional per-placement ornament preset, independent of the furniture key.
    if (!THREE || (!dressing && !record.activity)) return;
    const group = new THREE.Group(); // Owned by the prop; rebuilding/disposal follows its normal lifecycle.
    group.name = 'festival-dressing';
    const color = record.festivalColor || '#caa45c'; // Authored accent, editable without changing shared furniture definitions.
    const material = new THREE.MeshLambertMaterial({ color }); // These are solid 3D placeholder objects, not PNG surfaces.
    const wood = new THREE.MeshLambertMaterial({ color: '#906344' });
    group.userData.festivalMaterials = [material, wood]; // Only these materials belong to this dressing; furniture materials may be shared.
    function box(x, y, z, w, h, d, mat = material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); // Small geometry per ornament, created only when a layout is built.
      mesh.position.set(x, y, z); group.add(mesh); return mesh;
    }
    if (dressing === 'gifts') {
      for (let i = 0; i < 3; i++) { const x = (i - 1) * .28; box(x, .82, 0, .22, .23, .22); box(x, .95, 0, .25, .035, .055, wood); }
    } else if (dressing === 'ancestors') {
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * .16; // Five little carved ancestors on the shrine table.
        box(x, .83, 0, .08, .19, .07, wood);
        const head = new THREE.Mesh(new THREE.SphereGeometry(.055, 5, 4), wood);
        head.position.set(x, .965, 0); group.add(head);
      }
    } else if (dressing === 'blossoms') {
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5; // Five petals make the placeholder recognizable from a distance.
        const petal = new THREE.Mesh(new THREE.SphereGeometry(.13, 6, 4), material);
        petal.scale.y = .4; petal.position.set(Math.cos(angle) * .2, .81, Math.sin(angle) * .2); group.add(petal);
      }
      box(0, .7, 0, .12, .2, .12, wood);
    } else if (dressing === 'feast' || dressing === 'sweets') {
      for (let i = 0; i < 3; i++) {
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.12, .08, .1, 8), material);
        bowl.position.set((i - 1) * .26, .79, 0); group.add(bowl);
      }
    } else if (dressing === 'masks') {
      for (let i = 0; i < 3; i++) { const x = (i - 1) * .27; box(x, .83, 0, .2, .22, .07); box(x - .07, .97, 0, .06, .1, .06); box(x + .07, .97, 0, .06, .1, .06); }
    } else if (dressing === 'bunting') {
      box(-.36, .8, 0, .04, 1.6, .04, wood); box(.36, .8, 0, .04, 1.6, .04, wood); box(0, 1.55, 0, .76, .025, .025, wood);
      for (let i = 0; i < 5; i++) {
        const flag = new THREE.Mesh(new THREE.ConeGeometry(.075, .2, 3), material);
        flag.rotation.z = Math.PI; flag.position.set((i - 2) * .15, 1.42, 0); group.add(flag);
      }
    }
    if (record.activity && window.HobunjiSpritePngSurface) {
      const canvas = document.createElement('canvas'); // Text is generated locally, so no external texture/CORS request is needed.
      canvas.width = 512; canvas.height = 96;
      const context = canvas.getContext('2d');
      context.fillStyle = '#17241fed'; context.fillRect(0, 0, 512, 96);
      context.strokeStyle = color; context.lineWidth = 6; context.strokeRect(3, 3, 506, 90);
      context.fillStyle = '#fff5dc'; context.font = 'bold 28px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
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
    root?.traverse?.(object => {
      if (!object.userData?.festivalMaterials) return;
      for (const material of object.userData.festivalMaterials) material.dispose();
      object.userData.festivalMaterials = null;
      object.userData.festivalTexture?.dispose();
      object.userData.festivalTexture = null;
    });
  }
  window.FestivalProps = { decorate, dispose };
})();

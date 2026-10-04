// Shared Director/game furniture animation; existing cutscene ticks supply elapsed time.
(() => {
  'use strict';
  function create(scene) {
    const records = new Map(); // Cached roots and authored transforms avoid scene scans during playback.
    scene?.traverse(node => {
      const id = node.userData?.mapEditorRef?.kind === 'furniture' ? node.userData.mapEditorRef.id : node.userData?.cutsceneFurnitureId;
      if (!id || records.has(id)) return;
      node.updateMatrix();
      records.set(id, { node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), rotationY: node.rotation.y, inverse: node.matrix.clone().invert(), motion: null });
    });
    const seatPoint = new THREE.Vector3(); // Reused by transformed seat-anchor projection each frame.
    const rotation = new THREE.Euler(); // Converts authored degree offsets before each card starts.
    function set(stage) {
      const rec = records.get(stage.furnitureId); // Furniture is addressed by the same stable instance id as the Map Editor.
      if (!rec) return false;
      const transform = stage.transform || {}; // Offsets are always relative to the map-authored pose, preventing cumulative drift.
      const position = rec.position.clone();
      for (const axis of ['x','y','z']) position[axis] += Number(transform.translation?.[axis]) || 0;
      rotation.set(...['x','y','z'].map(axis => (Number(transform.rotationDeg?.[axis]) || 0) * Math.PI / 180));
      const quaternion = rec.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(rotation));
      const scale = rec.scale.clone();
      for (const axis of ['x','y','z']) scale[axis] *= Math.max(.01, Number(transform.scale?.[axis]) || 1);
      rec.motion = { fromPosition: rec.node.position.clone(), fromQuaternion: rec.node.quaternion.clone(), fromScale: rec.node.scale.clone(), position, quaternion, scale, elapsed: 0, duration: Math.max(0, Number(stage.duration) || 0) };
      if (!rec.motion.duration) update(0);
      return true;
    }
    function update(dt) {
      for (const rec of records.values()) {
        const motion = rec.motion; // Only active cards do interpolation work.
        if (!motion) continue;
        motion.elapsed += Math.max(0, Number(dt) || 0);
        const t = motion.duration ? Math.min(1, motion.elapsed / motion.duration) : 1;
        const eased = t * t * (3 - 2 * t); // Smooth arrival and departure for repeated furniture transforms.
        rec.node.position.copy(motion.fromPosition).lerp(motion.position, eased);
        rec.node.quaternion.copy(motion.fromQuaternion).slerp(motion.quaternion, eased);
        rec.node.scale.copy(motion.fromScale).lerp(motion.scale, eased);
        rec.node.updateMatrix();
        if (t === 1) rec.motion = null;
      }
    }
    function seat(id, baseline) {
      const rec = records.get(id); // Actors bound to a chair follow its actual animated anchor, including translation and scale.
      if (!rec || !baseline) return baseline;
      rec.node.updateMatrix();
      seatPoint.set(baseline.x, rec.position.y + baseline.y, baseline.z).applyMatrix4(rec.inverse).applyMatrix4(rec.node.matrix);
      return { ...baseline, x: seatPoint.x, y: seatPoint.y - rec.position.y, z: seatPoint.z, facingRad: baseline.facingRad - (rec.node.rotation.y - rec.rotationY) };
    }
    function restore() {
      for (const rec of records.values()) { rec.node.position.copy(rec.position); rec.node.quaternion.copy(rec.quaternion); rec.node.scale.copy(rec.scale); rec.node.updateMatrix(); rec.motion = null; }
    }
    return { set, update, seat, restore, ids: () => [...records.keys()] };
  }
  window.CutsceneFurnitureRuntime = { create };
})();

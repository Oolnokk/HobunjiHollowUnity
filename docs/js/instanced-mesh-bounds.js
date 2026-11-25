// InstancedMeshBounds — one authority for "where are this InstancedMesh's
// instances". Three r128 bounds an InstancedMesh by its base geometry only,
// so it can neither frustum-cull one nor skip it in a scissored replay.
// Meshes tagged here (userData.hobunjiInstanceBounds) get a sphere around
// every instance, cached until the instance matrices or count change.
//
// Consumers: WallBuilder's raycast early-out, InstancedMeshViewCull (camera
// pass), HeldObjectRenderOrder's replay cull, GrassBillboardRenderChunks.
(function (root) {
  'use strict';

  const THREE = root.THREE;
  if (!THREE) { console.error('InstancedMeshBounds: window.THREE not found — load three.js first'); return; }

  const PAD = 0.5; // World units; covers brick jitter, grass sway and shader-side elevation nudges.
  const box = new THREE.Box3(), instBox = new THREE.Box3(), matrix = new THREE.Matrix4();
  const cache = new WeakMap(); // InstancedMesh -> { key, sphere } in mesh-local space.
  const tracked = []; // WeakRef<InstancedMesh> for the camera-pass cull; pruned while iterating.
  const trackedSet = new WeakSet(); // Deduplicate retagging when a batch refreshes its bounds.
  const bricks = []; // Brick-only iteration; grass and forest instances never enter this list.
  const brickSet = new WeakSet(); // Deduplicate brick enrollment without retaining disposed meshes.
  const trackedRefs = new WeakMap(); // Reuse the same weak reference in scene buckets.
  const sceneBuckets = new WeakMap(); // Scene -> weak tracked/brick membership and queued subtree attachments.
  let sceneScopedEnabled = true; // A/B fallback retains the global registry.
  const sceneStats = { initialScans:0, incrementalRoots:0, scopedVisits:0, staleEntries:0, globalFallbacks:0 }; // On-demand Pixel Probe.

  // Mesh-local sphere around every instance, or null when nothing finite.
  function localSphere(mesh) {
    const geo = mesh?.geometry;
    if (!geo || !mesh.instanceMatrix || !(mesh.count > 0)) return null;
    const key = mesh.instanceMatrix.version + ':' + mesh.count;
    let entry = cache.get(mesh);
    if (!entry || entry.key !== key) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      box.makeEmpty();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        instBox.copy(geo.boundingBox).applyMatrix4(matrix);
        // An instance with a NaN matrix can never draw or be hit, but would poison the union.
        if (Number.isFinite(instBox.min.x + instBox.min.y + instBox.min.z +
            instBox.max.x + instBox.max.y + instBox.max.z)) box.union(instBox);
      }
      entry = { key, sphere: box.isEmpty() ? null : box.getBoundingSphere(new THREE.Sphere()) };
      cache.set(mesh, entry);
    }
    return entry.sphere;
  }

  // Padded world-space sphere, only for tagged meshes (untagged instanced
  // meshes keep Three's default "never cull" behaviour everywhere).
  function worldSphere(mesh, target) {
    if (!mesh?.isInstancedMesh || mesh.userData?.hobunjiInstanceBounds !== true || !target) return null;
    const sphere = localSphere(mesh);
    if (!sphere) return null;
    target.copy(sphere).applyMatrix4(mesh.matrixWorld);
    target.radius += PAD;
    return Number.isFinite(target.radius + target.center.x + target.center.y + target.center.z) ? target : null;
  }

  // track:true also enrols the mesh in the camera-pass cull. Use track:false
  // for meshes Three already culls by authored bounds (only the replay cull
  // needs the tag) or whose instances are scattered too widely to help.
  function tag(mesh, { track = true } = {}) {
    if (!mesh?.isInstancedMesh) return mesh;
    const alreadyTagged = mesh.userData.hobunjiInstanceBounds === true; // Preserve the original replay-only enrollment contract.
    mesh.userData.hobunjiInstanceBounds = true;
    if (track && typeof WeakRef === 'function') {
      if (!alreadyTagged && !trackedSet.has(mesh)) {
        const ref = new WeakRef(mesh);
        trackedSet.add(mesh); trackedRefs.set(mesh, ref); tracked.push(ref);
      }
      if (trackedSet.has(mesh) && mesh.userData.hobunjiBrickLod === true && !brickSet.has(mesh)) {
        brickSet.add(mesh); bricks.push(trackedRefs.get(mesh));
      }
      // A late tag on an already-attached instance must be visible immediately.
      if (trackedSet.has(mesh)) {
        const scene = owningScene(mesh);
        const bucket = scene && sceneBuckets.get(scene);
        if (bucket) enroll(bucket, mesh);
      }
    }
    return mesh;
  }

  function visitTracked(list, callback) {
    let kept = 0;
    for (let i = 0; i < list.length; i++) {
      const ref = list[i], mesh = ref.deref();
      if (!mesh) continue;
      list[kept++] = ref;
      callback(mesh);
    }
    list.length = kept;
  }

  function forEachTracked(callback) { visitTracked(tracked, callback); }
  function forEachTrackedBrick(callback) { visitTracked(bricks, callback); }

  function owningScene(object) {
    for (let node=object; node; node=node.parent) if (node.isScene) return node;
    return null;
  }

  function enroll(bucket, mesh) {
    const ref = trackedRefs.get(mesh); // Replay-only tags never enter this registry.
    if (!ref) return;
    bucket.all.add(ref);
    if (brickSet.has(mesh)) bucket.bricks.add(ref);
  }

  // Called by the existing scene-structure add hook (no extra prototype
  // wrapper). Only scenes already indexed need incremental maintenance.
  function noteSceneAttachment(scene, objects) {
    const bucket = sceneBuckets.get(scene);
    if (!bucket) return;
    for (const object of objects) {
      if (!object?.isObject3D || (!trackedSet.has(object) && !object.children?.length) || owningScene(object) !== scene) continue;
      if (trackedSet.has(object)) enroll(bucket, object);
      if (object.children?.length && !bucket.queued.has(object)) {
        bucket.queued.add(object);
        bucket.pending.push(new WeakRef(object)); // An inactive scene cannot pin detached NPC/prop subtrees.
      }
    }
  }

  function bucketFor(scene) {
    let bucket = sceneBuckets.get(scene);
    if (!bucket) {
      bucket = { all:new Set(), bricks:new Set(), pending:[], queued:new WeakSet() };
      sceneBuckets.set(scene,bucket);
      visitTracked(tracked, mesh => { if (owningScene(mesh) === scene) enroll(bucket,mesh); });
      sceneStats.initialScans++;
    }
    // Coalesce parent/child attachment notifications in the same turn.
    if (bucket.pending.length) {
      const pending=bucket.pending;
      const queued=bucket.queued;
      bucket.pending=[]; bucket.queued=new WeakSet();
      for (const ref of pending) {
        const object=ref.deref();
        if (!object || owningScene(object)!==scene) continue;
        let covered=false;
        for(let parent=object.parent;parent&&parent!==scene;parent=parent.parent) {
          if(queued.has(parent)){covered=true;break;}
        }
        if(covered)continue;
        object.traverse?.(mesh=>{if(trackedSet.has(mesh))enroll(bucket,mesh);});
        sceneStats.incrementalRoots++;
      }
    }
    return bucket;
  }

  function visitScene(scene, callback, bricksOnly) {
    // Old isolated editors without the existing scene-structure hook keep
    // their original global iteration. No assumption about their add/remove.
    if (!sceneScopedEnabled || !scene?.isScene || root.OutlineRenderPerformance?.sceneAttachmentNotifications !== true || typeof WeakRef !== 'function') {
      sceneStats.globalFallbacks++;
      return visitTracked(bricksOnly ? bricks : tracked,callback);
    }
    const bucket=bucketFor(scene);
    for(const ref of (bricksOnly?bucket.bricks:bucket.all)){
      const mesh=ref.deref();
      // Reparenting/detachment is checked live, not inferred from visibility.
      if(!mesh || owningScene(mesh)!==scene){
        bucket.all.delete(ref); bucket.bricks.delete(ref);
        sceneStats.staleEntries++;
        continue;
      }
      sceneStats.scopedVisits++;
      callback(mesh);
    }
  }

  function forEachTrackedInScene(scene, callback) { visitScene(scene,callback,false); }
  function forEachTrackedBrickInScene(scene, callback) { visitScene(scene,callback,true); }

  root.InstancedMeshBounds = Object.freeze({
    localSphere, worldSphere, tag, forEachTracked, forEachTrackedBrick,
    forEachTrackedInScene, forEachTrackedBrickInScene, noteSceneAttachment,
    setSceneScopedEnabled(value){sceneScopedEnabled=value!==false;return sceneScopedEnabled;},
    snapshot:()=>({...sceneStats,sceneScopedEnabled}),
    PAD
  });
})(typeof window !== 'undefined' ? window : globalThis);

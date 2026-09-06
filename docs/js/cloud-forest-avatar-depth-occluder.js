(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE || window.CloudForestAvatarDepthOccluder?.installed) return;

  const DEPTH_RENDER_ORDER = 889; // Used to write attached-avatar cutouts after the visible player/pet stack but immediately before mist layers 890-892.
  const MIST_GROUP_NAME = 'cloud_forest_mist_cylinders'; // Used to activate helpers only while the Cloud Forest mist group is actually attached.
  // The visible portrait/creature materials use an extremely permissive
  // alphaTest (0.001) so their own anti-aliased/soft-glow edge pixels don't
  // look jagged. Copying that same threshold into the depth-only occluder
  // let faint near-transparent fringe pixels well outside the visually solid
  // silhouette pass the test and punch depth, cutting a hole in the mist
  // noticeably bigger than the character actually looks -- raise the floor
  // here so only meaningfully-opaque pixels count as "this is really there."
  const DEPTH_OCCLUDER_MIN_ALPHA_TEST = 0.5;
  const records = new Map(); // Owns one reusable depth helper for the player and each attached shoulder-pet portrait face.
  let mistGroup = null;
  let lastMistSearchScene = null;

  function materialsOf(mesh) {
    if (!mesh?.material) return [];
    return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
  }

  function playerRoot() {
    return window.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || window.ProceduralHandAttachments?.gameDeps?.playerMesh
      || null;
  }

  function belongsToScene(object, scene) {
    for (let node = object; node; node = node.parent) if (node === scene) return true;
    return false;
  }

  let cachedPlayerRoot = null; // Player root this sync() saw last call — a full rig traverse only reruns when it changes.
  let cachedPlayerMesh = null; // Portrait mesh found under cachedPlayerRoot, reused while still attached there.

  function playerPortraitMesh() {
    const root = playerRoot();
    if (!root?.traverse) {
      cachedPlayerRoot = null;
      cachedPlayerMesh = null;
      return null;
    }
    // The scored mesh's identity is stable frame to frame — only the root
    // being rebuilt (a new root object) or the cached mesh being detached
    // from it invalidates the cache. Runs once per frame from sync(); without
    // this, every frame re-traversed and re-scored the entire player rig
    // just to usually land on the exact same mesh again.
    if (root === cachedPlayerRoot && cachedPlayerMesh && belongsToScene(cachedPlayerMesh, root)) {
      return cachedPlayerMesh;
    }
    let best = null;
    let bestScore = -1;
    root.traverse(object => {
      if ((!object?.isMesh && !object?.isSkinnedMesh) || object.userData?.cloudForestAvatarDepthOccluder) return;
      const mats = materialsOf(object);
      if (!mats.length) return;
      let score = 0;
      for (const material of mats) {
        const name = String(material?.name || '');
        if (name.includes('npc_avatar_skinned_')) score += 8;
        else if (name.includes('npc_avatar_')) score += 4;
        if (material?.map) score += 1;
      }
      if (score > bestScore) {
        best = object;
        bestScore = score;
      }
    });
    cachedPlayerRoot = root;
    cachedPlayerMesh = bestScore > 0 ? best : null;
    return cachedPlayerMesh;
  }

  function activeShoulderPet(activeScene) {
    const companions = window.Combat?.deps?.companionObjects;
    if (!companions || !activeScene) return null;
    for (const companion of companions) {
      const group = companion?.avatarRef?.group;
      if (
        companion?.health > 0
        && companion.stableRole === 'shoulderPet'
        && group?.visible !== false
        && belongsToScene(group, activeScene)
      ) return companion;
    }
    return null;
  }

  function disposeRecord(key) {
    const record = records.get(key);
    if (!record) return;
    record.depthMesh?.parent?.remove(record.depthMesh);
    for (const material of materialsOf(record.depthMesh)) material.dispose?.();
    records.delete(key);
  }

  function disposeAll() {
    for (const key of [...records.keys()]) disposeRecord(key);
  }

  function makeDepthMaterial(source) {
    const material = source.clone(); // Preserves each portrait's map, alphaTest, side and skinning-compatible material type.
    material.name = `${source.name || 'avatar'}_cloud_forest_depth_occluder`;
    material.transparent = true; // Keeps this draw in the transparent queue where renderOrder 889 can place it after player/pet colour draws.
    material.opacity = 1;
    material.colorWrite = false;
    material.depthWrite = true;
    material.depthTest = true;
    material.fog = false;
    material.blending = THREE.NoBlending;
    material.needsUpdate = true;
    return material;
  }

  function buildRecord(key, source) {
    disposeRecord(key);
    if (!source?.geometry) return null;

    const sourceMaterials = materialsOf(source);
    if (!sourceMaterials.length) return null;
    const depthMaterials = sourceMaterials.map(makeDepthMaterial);
    const assignedMaterial = Array.isArray(source.material) ? depthMaterials : depthMaterials[0];
    const helper = source.isSkinnedMesh
      ? new THREE.SkinnedMesh(source.geometry, assignedMaterial)
      : new THREE.Mesh(source.geometry, assignedMaterial);

    if (source.isSkinnedMesh) {
      helper.skeleton = source.skeleton; // Shares the live portrait bones so the invisible silhouette follows body/head deformation exactly.
      helper.bindMode = source.bindMode;
      helper.bindMatrix.copy(source.bindMatrix);
      helper.bindMatrixInverse.copy(source.bindMatrixInverse);
    }

    helper.name = `cloud_forest_${key}_depth_occluder`;
    helper.userData.cloudForestAvatarDepthOccluder = true;
    helper.userData.noOutline = true;
    helper.renderOrder = DEPTH_RENDER_ORDER;
    helper.frustumCulled = false;
    helper.castShadow = false;
    helper.receiveShadow = false;
    helper.visible = false;
    helper.layers.mask = source.layers.mask;
    source.add(helper); // Identity child transform keeps the helper on the exact visible portrait carrier transform.

    const record = { source, sourceMaterials, depthMesh: helper }; // Reused on later frames until this avatar or its materials are rebuilt.
    records.set(key, record);
    return record;
  }

  function sameMaterials(record, source) {
    const current = materialsOf(source);
    return current.length === record.sourceMaterials.length
      && current.every((material, index) => material === record.sourceMaterials[index]);
  }

  function syncRecord(key, source) {
    if (!source) {
      disposeRecord(key);
      return;
    }
    let record = records.get(key);
    if (!record || record.source !== source || !sameMaterials(record, source)) record = buildRecord(key, source);
    if (!record?.depthMesh) return;

    const originals = materialsOf(source);
    const depthMaterials = materialsOf(record.depthMesh);
    for (let i = 0; i < Math.min(originals.length, depthMaterials.length); i++) {
      const original = originals[i];
      const depth = depthMaterials[i];
      if (depth.map !== original.map) {
        depth.map = original.map;
        depth.needsUpdate = true;
      }
      // Raised, not simply copied: see DEPTH_OCCLUDER_MIN_ALPHA_TEST above.
      depth.alphaTest = Math.max(Number(original.alphaTest) || 0, DEPTH_OCCLUDER_MIN_ALPHA_TEST);
      depth.side = original.side;
    }
    // Normal avatars already write depth themselves. Submit the extra draw only while another layering mode intentionally disabled normal depth writes.
    record.depthMesh.visible = source.visible !== false && originals.some(material => material.depthWrite === false);
  }

  function activeMistScene() {
    const activeScene = window.GridTileAccessors?.getActiveScene?.();
    if (!activeScene) return null;
    if (mistGroup?.parent === activeScene) return mistGroup.visible === false ? null : activeScene;

    // Search only when the active scene changes. CloudForestFog.update attaches
    // its group before this sync runs, so entering the biome resolves it on the
    // first frame without an always-on scene traversal outside the biome.
    if (activeScene !== lastMistSearchScene) {
      lastMistSearchScene = activeScene;
      mistGroup = activeScene.children?.find?.(child => child?.name === MIST_GROUP_NAME)
        || activeScene.getObjectByName?.(MIST_GROUP_NAME)
        || null;
    }
    return mistGroup?.parent === activeScene && mistGroup.visible !== false ? activeScene : null;
  }

  function hideAll() {
    for (const record of records.values()) if (record.depthMesh) record.depthMesh.visible = false;
  }

  function sync() {
    const activeScene = activeMistScene();
    if (!activeScene) {
      hideAll();
      return;
    }

    syncRecord('player', playerPortraitMesh());

    const pet = activeShoulderPet(activeScene); // Combat exposes the same live companion collection already used by PNG-plane shoulder-pet facing code.
    syncRecord('shoulder_pet_front', pet?.avatarRef?.frontPlane || null);
    syncRecord('shoulder_pet_back', pet?.avatarRef?.backPlane || null);
  }

  function install() {
    const fog = window.CloudForestFog;
    if (!fog?.update || fog.update.__cloudForestAvatarDepthWrapped) return false;
    const priorUpdate = fog.update;
    const wrappedUpdate = function (dt) {
      const result = priorUpdate.call(this, dt);
      sync(); // CloudForestFog.update runs immediately before the scene render, so helper visibility/materials are current for this frame.
      return result;
    };
    wrappedUpdate.__cloudForestAvatarDepthWrapped = true;
    fog.update = wrappedUpdate;

    if (typeof fog.setEnabled === 'function') {
      const priorSetEnabled = fog.setEnabled;
      fog.setEnabled = function (enabled) {
        const result = priorSetEnabled.call(this, enabled);
        if (!enabled) hideAll();
        return result;
      };
    }
    return true;
  }

  const api = window.CloudForestAvatarDepthOccluder = {
    installed: true,
    install,
    sync,
    dispose: disposeAll,
    snapshot() {
      const detail = {};
      for (const [key, record] of records) {
        detail[key] = {
          source: record.source?.name || null,
          sourceDepthWrite: record.sourceMaterials.map(material => material?.depthWrite),
          helperVisible: !!record.depthMesh?.visible,
          helperRenderOrder: record.depthMesh?.renderOrder ?? null,
        };
      }
      return {
        hooked: !!window.CloudForestFog?.update?.__cloudForestAvatarDepthWrapped,
        mistActive: !!activeMistScene(),
        records: detail,
      };
    },
  };

  const installWhenReady = () => {
    if (!api.install()) setTimeout(api.install, 0);
  };
  if (document.readyState === 'complete') installWhenReady();
  else window.addEventListener('load', installWhenReady, { once: true });
})();

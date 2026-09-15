// Reuses the proven procedural-foot GLB material-slot mapping for hand GLBs
// exported from the same source projects. The live foot config is authoritative;
// the fallback table mirrors it for nested tools, while handExportAliases maps the
// actual hand-export material names onto those same source-project slots.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const feet = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.species || {};
  if (!profiles?.data?.models) return;

  const correspondingFootSpecies = {
    pachyderm: 'mashtzarr',
    sloth: 'tletingan',
    feline: 'mao-ao',
  };
  const fallbackRoles = {
    pachyderm: { 'Mat 1': 'bone', 'Mat 2': 'body' },
    sloth: { 'Mat 1': 'bone', 'Mat 2': 'body' },
    feline: { 'Mat 1': 'body' },
  };

  // These are the material names currently present in the hand GLB exports.
  // The hands were exported from the same source projects as the corresponding
  // feet, so preserve slot meaning rather than the old provisional role guesses:
  // slot 1 = bone and slot 2 = body for pachyderm/sloth, slot 1 = body for feline.
  const handExportAliases = {
    pachyderm: {
      MAT_None_7a4e2e: 'bone',
      MAT_EyeSurface_0c0c0c: 'body',
    },
    sloth: {
      MAT_None_7a4e2e: 'bone',
      MAT_EyeSurface_0c0c0c: 'body',
    },
    feline: {
      MAT_None_7a4e2e: 'body',
    },
    parrot: {
      MAT_None_7a4e2e: 'keratin',
      MAT_EyeSurface_0c0c0c: 'body',
    },
  };

  profiles.mutate(data => {
    for (const [modelKey, speciesId] of Object.entries(correspondingFootSpecies)) {
      const model = data.models?.[modelKey];
      if (!model) continue;
      const footRoles = feet?.[speciesId]?.materialRoles || fallbackRoles[modelKey];
      model.materialRoles = {
        ...(model.materialRoles || {}),
        ...(footRoles || {}),
        ...(handExportAliases[modelKey] || {}),
      };
    }

    // Kenkari-family feet are procedural rather than GLB-backed, so there is no
    // foot GLB table to inherit. Their two parrot-hand slots are intentionally
    // flipped here: slot 1/None uses keratin, while slot 2/EyeSurface is the
    // body-colored wing continuation that the portrait clothing layer occludes.
    const parrot = data.models?.parrot;
    if (parrot) {
      parrot.materialRoles = {
        ...(parrot.materialRoles || {}),
        'Mat 1': 'keratin',
        'Mat 2': 'body',
        ...handExportAliases.parrot,
      };
    }
  });

  const BONE_ROLE = 'bone'; // Used to target only the intentionally unrecolored claw/nail material on hands and feet.
  const wrappedAddOwners = new WeakSet(); // Used to intercept later async GLB swaps only inside an attached hand/foot rig, never scene-wide.
  const pendingMeshes = new Set(); // Used when an attachment is created before the farm surface mapper has finished loading.
  const surfaceStats = {
    wrappedApis: 0,
    observedTrees: 0,
    mappedMeshes: 0,
    mappedMaterialSlots: 0,
    pendingMeshes: 0,
    mapperMisses: 0,
    errors: 0,
    recent: [],
  }; // Used by surfaceUvSnapshot() so mobile/debug builds can verify mappings without DevTools.

  function materialRole(material) {
    return material?.userData?.hobunjiHandRole || material?.userData?.hobunjiFootRole || null;
  }

  function rememberSurfaceResult(mesh, label, boneSlots) {
    const report = mesh?.geometry?.userData?.hobunjiSurfaceStretch || null;
    const perimeter = mesh?.geometry?.userData?.hobunjiSurfacePerimeterFrame || null;
    mesh.userData = Object.assign({}, mesh.userData || {}, {
      hobunjiHandFootBoneSurfaceUv: {
        version: 1,
        mapper: 'HobunjiSurfaceStretchUV',
        method: 'farm-cliff-detected-surface-jigsaw-stretch',
        role: BONE_ROLE,
        materialSlots: boneSlots.slice(),
        patchCount: report?.patchCount ?? null,
        boundaryLoopCount: report?.boundaryLoopCount ?? null,
        perimeterFrameApplied: !!perimeter,
      },
    });
    const entry = {
      label,
      slots: boneSlots.slice(),
      patchCount: report?.patchCount ?? null,
      perimeterFrameApplied: !!perimeter,
    };
    surfaceStats.recent.push(entry);
    while (surfaceStats.recent.length > 12) surfaceStats.recent.shift();
  }

  function mapBoneSurfaceMesh(mesh, label = 'hand-foot-bone') {
    if (!mesh?.isMesh || !mesh.geometry) return false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const boneSlots = [];
    for (let index = 0; index < materials.length; index++) {
      if (materialRole(materials[index]) === BONE_ROLE) boneSlots.push(index);
    }
    if (!boneSlots.length) return false;

    const mapper = global.HobunjiSurfaceStretchUV;
    if (typeof mapper?.mapGeometry !== 'function') {
      pendingMeshes.add(mesh);
      surfaceStats.pendingMeshes = pendingMeshes.size;
      surfaceStats.mapperMisses++;
      return false;
    }

    try {
      let geometry = mesh.geometry;
      for (const materialIndex of boneSlots) {
        const options = { label: `${label}:bone-slot-${materialIndex}` };
        // A one-material GLTF primitive is entirely bone. Multi-material meshes
        // pass the real group/material slot so body-colored UVs remain untouched.
        if (materials.length > 1) options.materialIndex = materialIndex;
        const mapped = mapper.mapGeometry(geometry, options);
        if (mapped) geometry = mapped;
      }
      mesh.geometry = geometry;
      pendingMeshes.delete(mesh);
      surfaceStats.pendingMeshes = pendingMeshes.size;
      surfaceStats.mappedMeshes++;
      surfaceStats.mappedMaterialSlots += boneSlots.length;
      rememberSurfaceResult(mesh, label, boneSlots);
      return true;
    } catch (error) {
      surfaceStats.errors++;
      console.warn('[ProceduralHandFootMaterialRoles] farm-cliff surface mapping failed; keeping existing UVs:', error);
      return false;
    }
  }

  function flushPendingMeshes() {
    if (typeof global.HobunjiSurfaceStretchUV?.mapGeometry !== 'function') return false;
    for (const mesh of Array.from(pendingMeshes)) mapBoneSurfaceMesh(mesh, 'hand-foot-bone:deferred');
    surfaceStats.pendingMeshes = pendingMeshes.size;
    return pendingMeshes.size === 0;
  }

  function observeRigTree(root, label) {
    if (!root) return;
    surfaceStats.observedTrees++;
    const visit = object => {
      if (!object) return;
      if (object.isMesh) mapBoneSurfaceMesh(object, label);
      if (!wrappedAddOwners.has(object) && typeof object.add === 'function') {
        wrappedAddOwners.add(object);
        const originalAdd = object.add;
        object.add = function (...children) {
          const result = originalAdd.apply(this, children);
          for (const child of children) observeRigTree(child, `${label}:async-add`);
          flushPendingMeshes();
          return result;
        };
      }
    };
    if (typeof root.traverse === 'function') root.traverse(visit);
    else visit(root);
    flushPendingMeshes();
  }

  function wrapAttachmentApi(api, apiName) {
    if (!api || typeof api.attach !== 'function' || api.attach.__hobunjiBoneSurfaceJigsawWrapped) return false;
    const originalAttach = api.attach;
    function wrappedAttach(...args) {
      const handle = originalAttach.apply(this, args);
      if (handle?.group) observeRigTree(handle.group, apiName);
      return handle;
    }
    wrappedAttach.__hobunjiBoneSurfaceJigsawWrapped = true;
    wrappedAttach.__hobunjiBoneSurfaceJigsawOriginal = originalAttach;
    api.attach = wrappedAttach;
    surfaceStats.wrappedApis++;
    return true;
  }

  function wrapApiWhenAssigned(globalName) {
    const existing = global[globalName];
    if (existing) {
      wrapAttachmentApi(existing, globalName);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(global, globalName);
    if (descriptor && descriptor.configurable === false) return;
    Object.defineProperty(global, globalName, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return undefined; },
      set(value) {
        Object.defineProperty(global, globalName, {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
        wrapAttachmentApi(value, globalName);
      },
    });
  }

  // This bridge loads before both attachment implementations in gameplay and
  // nested authoring tools. Catch their one-time global assignment instead of
  // polling or scanning the scene every frame. Async GLB swaps are then caught
  // only by the add() methods inside each returned hand/foot rig tree.
  wrapApiWhenAssigned('ProceduralHandAttachments');
  wrapApiWhenAssigned('ProceduralLegAnimation');
  global.addEventListener?.('DOMContentLoaded', flushPendingMeshes, { once: true });
  global.addEventListener?.('load', flushPendingMeshes, { once: true });

  global.ProceduralHandFootMaterialRoles = Object.freeze({
    correspondingFootSpecies: { ...correspondingFootSpecies },
    fallbackRoles: JSON.parse(JSON.stringify(fallbackRoles)),
    handExportAliases: JSON.parse(JSON.stringify(handExportAliases)),
    mapBoneSurfaceMesh,
    flushPendingMeshes,
    surfaceUvSnapshot() {
      return Object.assign({}, surfaceStats, {
        pendingMeshes: pendingMeshes.size,
        recent: surfaceStats.recent.map(entry => Object.assign({}, entry, { slots: entry.slots.slice() })),
      });
    },
  });
})(window);

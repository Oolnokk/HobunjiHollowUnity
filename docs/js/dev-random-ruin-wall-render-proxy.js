// Native-source rendering verifier for Debris-ifier V50 ruin geometry.
// Embedded V50 now constructs every object with parent.THREE, so copying walls,
// doors, arches, and activators into a second game-realm proxy graph is both
// redundant and expensive. This module keeps the old diagnostic API name for
// Pixel Probe/tests, but visible geometry remains the authoritative V50 source.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  if (!window.THREE || !GridTileAccessors || !DS) return;

  let preparedRoot = null; // Last V50 root normalized for direct native rendering.
  let preparedScene = null; // Last active game scene paired with preparedRoot.

  function activeScene() {
    if (GridTileAccessors.getCurrentArea?.() !== MAP_ID) return null;
    return GridTileAccessors.getActiveScene?.() || null;
  }

  function activeRoot(scene = activeScene()) {
    if (!scene) return null;
    return scene.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  function sourceMaterials(mesh) {
    if (!mesh?.material) return [];
    return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
  }

  function sourceHierarchyVisible(sourceObject, root) {
    for (let object = sourceObject; object; object = object.parent) {
      if (object.visible === false) return false;
      if (object === root) break;
    }
    return true;
  }

  function normalizeDoorAssemblies(root) {
    const arches = [], doors = [];
    root?.traverse?.(object => {
      if (object.userData?.archFootprint) arches.push(object);
      if (object.userData?.transitDoor || (object.userData?.mechanismId && object.userData?.previewMotion?.type === 'stoneDoor')) doors.push(object);
    });
    for (const door of doors) {
      if (door.userData?.devRuinDoorAssemblyNormalized) continue;
      const arch = arches
        .map(candidate => ({ candidate, distance:(Number(candidate.position?.x)-Number(door.position?.x))**2 + (Number(candidate.position?.z)-Number(door.position?.z))**2 }))
        .filter(entry => entry.distance < .08 ** 2)
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (!arch) continue;
      const panel = (door.children || []).find(child => child?.isMesh && child.geometry);
      panel?.geometry?.computeBoundingBox?.();
      const panelHeight = panel?.geometry?.boundingBox
        ? panel.geometry.boundingBox.max.y - panel.geometry.boundingBox.min.y
        : 1.9;
      door.position.y = Number(arch.position?.y) + panelHeight;
      door.rotation.y = Number(arch.rotation?.y) || 0;
      door.userData.devRuinDoorAssemblyNormalized = true;
      door.userData.devRuinDoorArch = arch;
      arch.userData.devRuinDoorArch = true;
      arch.userData.devRuinDoorRoot = door;
    }
  }

  // V50 placeholders that DevRandomRuinFurniturePieces swapped for authored
  // furniture and hid on purpose (mountGlyphPlaques marks the decal,
  // skinDisplays marks the display object). Their visibility is judged by
  // the authored stand-in that renders in their place.
  function renderedStandIn(mesh) {
    if (mesh.userData?.devRuinGlyphPlaque) return mesh.userData.devRuinGlyphPlaque;
    if (mesh.visible === false) {
      for (let node = mesh.parent; node; node = node.parent) if (node.userData?.devRuinDisplaySkin) return node.userData.devRuinDisplaySkin;
    }
    return mesh;
  }

  function collectRenderSources(root) {
    const candidates = new Map(); // One source mesh only; overlapping semantic tags resolve to the strongest structural kind.
    const rank = { activator:1, door:2, doorArch:3, wall:4 };
    const add = (mesh, kind, owner) => {
      if (!mesh?.isMesh || !mesh.geometry) return;
      const prior = candidates.get(mesh);
      if (!prior || rank[kind] > rank[prior.kind]) candidates.set(mesh, { mesh, kind, owner });
    };
    root?.traverse?.(object => {
      const data = object.userData || {};
      if (data.ruinInteriorWall) add(object, 'wall', object);
      if (data.archFootprint) object.traverse?.(mesh => add(mesh, 'doorArch', object));
      if (data.mechanismId && data.previewMotion?.type === 'stoneDoor') object.traverse?.(mesh => add(mesh, 'door', object));
      if (data.linkedMechanismId && data.activatorType) object.traverse?.(mesh => add(mesh, 'activator', object));
    });
    return [...candidates.values()];
  }

  function prepare(root = null) {
    const scene = activeScene(); // Direct source meshes already belong to this THREE realm.
    const resolvedRoot = root || activeRoot(scene);
    if (!scene || !resolvedRoot) {
      preparedRoot = null;
      preparedScene = null;
      return null;
    }
    if (resolvedRoot === preparedRoot && scene === preparedScene) return null;

    normalizeDoorAssemblies(resolvedRoot);
    for (const source of collectRenderSources(resolvedRoot)) {
      const mesh = source.mesh;
      mesh.frustumCulled = true; // Ruins are room-and-hallway interiors; off-camera structural pieces should leave the draw list normally.
      if (!mesh.geometry?.boundingSphere) mesh.geometry?.computeBoundingSphere?.();
      mesh.userData.runtimeRuinRenderRealm = 'game-scene-source';
      mesh.userData.devRuinNativeRenderKind = source.kind;
      if (source.kind === 'wall') {
        mesh.visible = true;
        mesh.userData.runtimeWallPlaneRenderRealm = 'game-scene-source';
      }
    }
    preparedRoot = resolvedRoot;
    preparedScene = scene;
    return null;
  }

  function isLitMaterial(material) {
    return !!(material?.lights === true || material?.isMeshLambertMaterial || material?.isMeshPhongMaterial ||
      material?.isMeshToonMaterial || material?.isMeshStandardMaterial || material?.isMeshPhysicalMaterial);
  }

  function snapshot(root = activeRoot(), scene = activeScene()) {
    if (root && scene && (root !== preparedRoot || scene !== preparedScene)) prepare(root);
    const sources = collectRenderSources(root);
    const byKind = kind => sources.filter(source => source.kind === kind);
    const walls = byKind('wall'), doors = byKind('door'), arches = byKind('doorArch'), activators = byKind('activator');
    const visibleCount = list => list.filter(source => sourceHierarchyVisible(renderedStandIn(source.mesh), root)).length;
    let normalizedDoorAssemblies = 0;
    root?.traverse?.(object => { if (object.userData?.devRuinDoorAssemblyNormalized) normalizedDoorAssemblies++; });

    const allMaterials = sources.flatMap(source => sourceMaterials(source.mesh));
    return {
      active: !!root && !!scene,
      enabled: true,
      sourceWalls: walls.length,
      sourceDoorMeshes: doors.length,
      sourceDoorArchMeshes: arches.length,
      sourceActivatorMeshes: activators.length,
      visibleWallSources: visibleCount(walls),
      visibleDoorSources: visibleCount(doors),
      visibleDoorArchSources: visibleCount(arches),
      visibleActivatorSources: visibleCount(activators),
      normalizedDoorAssemblies,
      nativeSourceMeshCount: sources.length,
      frustumCulledSources: sources.filter(source => source.mesh.frustumCulled !== false).length,
      allNativeMainRealmMaterials: sources.filter(source => {
        const materials = sourceMaterials(source.mesh);
        return materials.length > 0 && materials.every(material => material instanceof THREE.Material);
      }).length,
      litSourceMaterials: allMaterials.filter(isLitMaterial).length,
      glyphDecalSourceCount: activators.filter(source => sourceMaterials(source.mesh).some(material => !!material?.userData?.decalImagePath)).length,
      glowingGlyphDecalSourceCount: activators.filter(source => sourceMaterials(source.mesh).some(material => material?.userData?.devRuinGlyphGlow === true || material?.blending === THREE.AdditiveBlending)).length,
      renderProxyCount: 0,
      totalProxyCount: 0,
      proxyRootAttached: false,
      blockerCount: DS.debugSnapshot?.().blockers?.filter(record => String(record.id || '').startsWith('devruin-wall-')).length || 0,
    };
  }

  function clear() {
    preparedRoot = null;
    preparedScene = null;
  }

  DS.addBeforeRenderClient(() => {
    const scene = activeScene(); // Cheap identity check only; no scene-wide matrix walk remains on the render hot path.
    const root = activeRoot(scene);
    if (root !== preparedRoot || scene !== preparedScene) prepare(root);
  });

  window.DevRandomRuinWallRenderProxy = Object.freeze({ prepare, snapshot, clear });
})();

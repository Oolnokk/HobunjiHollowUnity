// Reusable outward-facing material covering for static Three.js mesh geometry.

// The shell is a separate child overlay, not a replacement for or mutation of
// the source geometry/material. Each overlay follows its source mesh's complete
// transform chain automatically. Thickness is measured in that mesh's local
// geometry units and therefore follows the source mesh's scale.

// Public API:
//   const cover = SubstanceCoverShell.create(object3D, {
//     thickness: 0.08, opacity: 0.55, map: texture, color: 0x9ddfff,
//   });
//   cover.setThickness(0.12).setOpacity(0.7);
//   cover.dispose();

// Only static Mesh/BufferGeometry sources are accepted. Rebuild after deliberate
// source-geometry edits with refresh(); skinned, instanced and morph geometry is
// rejected because a static offset would otherwise drift from its deformation.
(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE?.Group || !THREE?.Mesh || typeof THREE?.FrontSide !== 'number') {
    window.SubstanceCoverShell = {
      available: false,
      reason: 'SubstanceCoverShell requires Three.js r128 Object3D, Group, Mesh and FrontSide support.',
    };
    return;
  }

  const DEFAULT_THICKNESS = 0.025; // Local-space outward offset applied to every supported source mesh.
  const DEFAULT_OPACITY = 0.45; // Translucent default; consumers can set any opacity from 0 to 1.
  const DEFAULT_RENDER_ORDER_OFFSET = 0.01; // Lets the overlay sort just after its source when both are transparent.
  const FALLBACK_MATERIAL_KEY = {}; // Stable cache key for meshes without an authored material.
  const EMPTY_OPTIONS = Object.freeze({});
  const clamp01 = value => Math.max(0, Math.min(1, value));
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError('SubstanceCoverShell ' + label + ' must be a finite number.');
    return number;
  }

  function normalizeOptions(options) {
    const input = options && typeof options === 'object' ? options : EMPTY_OPTIONS;
    const materialOptions = input.materialOptions && typeof input.materialOptions === 'object'
      ? input.materialOptions
      : EMPTY_OPTIONS;
    const rawOpacity = hasOwn(input, 'opacity')
      ? input.opacity
      : (hasOwn(materialOptions, 'opacity') ? materialOptions.opacity : DEFAULT_OPACITY);
    const opacity = clamp01(finiteNumber(rawOpacity, 'opacity'));
    const transparent = hasOwn(input, 'transparent')
      ? !!input.transparent
      : (hasOwn(materialOptions, 'transparent') ? !!materialOptions.transparent : opacity < 1);
    const depthWrite = hasOwn(input, 'depthWrite')
      ? !!input.depthWrite
      : (hasOwn(materialOptions, 'depthWrite') ? !!materialOptions.depthWrite : !transparent);
    const thickness = hasOwn(input, 'thickness')
      ? finiteNumber(input.thickness, 'thickness')
      : DEFAULT_THICKNESS;
    const renderOrderOffset = hasOwn(input, 'renderOrderOffset')
      ? finiteNumber(input.renderOrderOffset, 'renderOrderOffset')
      : DEFAULT_RENDER_ORDER_OFFSET;
    if (thickness < 0) throw new RangeError('SubstanceCoverShell thickness cannot be negative.');
    if (input.material && typeof input.material.clone !== 'function') {
      throw new TypeError('SubstanceCoverShell material must be a Three.js material with clone().');
    }
    return {
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Substance Cover Shell',
      thickness,
      opacity,
      transparent,
      depthWrite,
      renderOrderOffset,
      material: input.material || null,
      materialOptions,
      side: hasOwn(input, 'side') ? input.side : (hasOwn(materialOptions, 'side') ? materialOptions.side : THREE.FrontSide),
      hasMap: hasOwn(input, 'map') || hasOwn(materialOptions, 'map'),
      map: hasOwn(input, 'map') ? input.map : materialOptions.map,
      hasColor: hasOwn(input, 'color') || hasOwn(materialOptions, 'color'),
      color: hasOwn(input, 'color') ? input.color : materialOptions.color,
      hasRoughness: hasOwn(input, 'roughness') || hasOwn(materialOptions, 'roughness'),
      roughness: hasOwn(input, 'roughness') ? input.roughness : materialOptions.roughness,
      hasMetalness: hasOwn(input, 'metalness') || hasOwn(materialOptions, 'metalness'),
      metalness: hasOwn(input, 'metalness') ? input.metalness : materialOptions.metalness,
      visible: input.visible !== false,
      scale: [1, 1, 1],
    };
  }

  function collectSourceMeshes(source) {
    if (!source || typeof source.add !== 'function' || !Array.isArray(source.children)) {
      throw new TypeError('SubstanceCoverShell.create requires a Three.js Object3D source.');
    }
    const meshes = [];
    function visit(node) {
      if (!node || node.userData?.hobunjiSubstanceCoverShell === true) return;
      if (node.isMesh === true) {
        if (node.isSkinnedMesh === true || node.skeleton) {
          throw new TypeError('SubstanceCoverShell does not support SkinnedMesh: ' + (node.name || 'unnamed mesh'));
        }
        if (node.isInstancedMesh === true) {
          throw new TypeError('SubstanceCoverShell does not support InstancedMesh: ' + (node.name || 'unnamed mesh'));
        }
        const morphAttributes = node.geometry?.morphAttributes || {};
        if (node.morphTargetInfluences || Object.values(morphAttributes).some(list => Array.isArray(list) && list.length)) {
          throw new TypeError('SubstanceCoverShell does not support morph-target geometry: ' + (node.name || 'unnamed mesh'));
        }
        if (!node.geometry || typeof node.geometry.clone !== 'function') {
          throw new TypeError('SubstanceCoverShell source mesh has no cloneable BufferGeometry: ' + (node.name || 'unnamed mesh'));
        }
        meshes.push(node);
      }
      for (const child of node.children || []) visit(child);
    }
    visit(source);
    if (!meshes.length) throw new Error('SubstanceCoverShell source contains no supported Mesh geometry.');
    return meshes;
  }

  function readAttribute(attribute, index) {
    return [attribute.getX(index), attribute.getY(index), attribute.getZ(index)];
  }

  function buildExpandedGeometry(sourceMesh, thickness) {
    const geometry = sourceMesh.geometry.clone();
    try {
      const position = geometry.getAttribute ? geometry.getAttribute('position') : geometry.attributes?.position;
      if (!position || position.itemSize < 3 || !Number.isInteger(position.count) || position.count < 3
        || typeof position.setXYZ !== 'function' || typeof position.getX !== 'function'
        || typeof position.getY !== 'function' || typeof position.getZ !== 'function') {
        throw new TypeError('SubstanceCoverShell requires a writable BufferGeometry position attribute on ' + (sourceMesh.name || 'unnamed mesh'));
      }

      let normal = geometry.getAttribute ? geometry.getAttribute('normal') : geometry.attributes?.normal;
      if (!normal && typeof geometry.computeVertexNormals === 'function') {
        geometry.computeVertexNormals();
        normal = geometry.getAttribute ? geometry.getAttribute('normal') : geometry.attributes?.normal;
      }
      if (!normal || normal.itemSize < 3 || typeof normal.getX !== 'function'
        || typeof normal.getY !== 'function' || typeof normal.getZ !== 'function' || normal.count !== position.count) {
        throw new TypeError('SubstanceCoverShell requires one vertex normal per position on ' + (sourceMesh.name || 'unnamed mesh'));
      }

      const vertexCount = position.count;
      const basePositions = new Float64Array(vertexCount * 3);
      const unitNormals = new Float64Array(vertexCount * 3);
      for (let index = 0; index < vertexCount; index++) {
        const p = readAttribute(position, index);
        const n = readAttribute(normal, index);
        const normalLength = Math.hypot(n[0], n[1], n[2]);
        if (![...p, ...n].every(Number.isFinite) || !Number.isFinite(normalLength)) {
          throw new TypeError('SubstanceCoverShell found a non-finite vertex or normal at index ' + index + ' on ' + (sourceMesh.name || 'unnamed mesh'));
        }
        const normalScale = normalLength > 1e-8 ? 1 / normalLength : 0;
        const offset = index * 3;
        basePositions[offset] = p[0];
        basePositions[offset + 1] = p[1];
        basePositions[offset + 2] = p[2];
        unitNormals[offset] = n[0] * normalScale;
        unitNormals[offset + 1] = n[1] * normalScale;
        unitNormals[offset + 2] = n[2] * normalScale;
      }

      function applyThickness(value) {
        for (let index = 0; index < vertexCount; index++) {
          const offset = index * 3;
          position.setXYZ(
            index,
            basePositions[offset] + unitNormals[offset] * value,
            basePositions[offset + 1] + unitNormals[offset + 1] * value,
            basePositions[offset + 2] + unitNormals[offset + 2] * value,
          );
        }
        position.needsUpdate = true;
        geometry.computeBoundingBox?.();
        geometry.computeBoundingSphere?.();
      }

      applyThickness(thickness);
      return { geometry, applyThickness };
    } catch (error) {
      geometry.dispose?.();
      throw error;
    }
  }

  function assignMaterialProperty(material, key, value) {
    if (key === 'color' || key === 'emissive') {
      if (material[key]?.set) material[key].set(value);
      else material[key] = value;
      return;
    }
    material[key] = value;
  }

  function createShellMaterial(sourceMaterial, config, materialCache, ownedMaterials) {
    const template = config.material || sourceMaterial || FALLBACK_MATERIAL_KEY;
    if (materialCache.has(template)) return materialCache.get(template);

    let material;
    if (template === FALLBACK_MATERIAL_KEY) {
      if (typeof THREE.MeshStandardMaterial !== 'function') {
        throw new Error('SubstanceCoverShell needs MeshStandardMaterial when a source mesh has no material.');
      }
      material = new THREE.MeshStandardMaterial();
    } else {
      material = template.clone();
    }

    for (const [key, value] of Object.entries(config.materialOptions)) {
      if (key === 'opacity' || key === 'transparent' || key === 'depthWrite' || key === 'side' || key === 'map' || key === 'color' || key === 'roughness' || key === 'metalness') continue;
      assignMaterialProperty(material, key, value);
    }
    if (config.hasMap) material.map = config.map;
    if (config.hasColor) assignMaterialProperty(material, 'color', config.color);
    if (config.hasRoughness) material.roughness = config.roughness;
    if (config.hasMetalness) material.metalness = config.metalness;
    material.opacity = config.opacity;
    material.transparent = config.transparent;
    material.depthWrite = config.depthWrite;
    material.side = config.side;
    material.needsUpdate = true;

    materialCache.set(template, material);
    ownedMaterials.add(material);
    return material;
  }

  function makeBundle(source, config) {
    const sourceMeshes = collectSourceMeshes(source);
    const entries = [];
    const geometries = new Set();
    const materials = new Set();
    const materialCache = new Map();
    try {
      for (const sourceMesh of sourceMeshes) {
        const expanded = buildExpandedGeometry(sourceMesh, config.thickness);
        geometries.add(expanded.geometry);
        const sourceMaterials = Array.isArray(sourceMesh.material)
          ? sourceMesh.material
          : [sourceMesh.material || null];
        const shellMaterials = sourceMaterials.map(sourceMaterial =>
          createShellMaterial(sourceMaterial, config, materialCache, materials));
        const group = new THREE.Group();
        group.name = config.name + ' · ' + (sourceMesh.name || 'Mesh');
        group.userData = group.userData || {};
        group.userData.hobunjiSubstanceCoverShell = true;
        group.userData.hobunjiNonInteractive = true;
        group.visible = config.visible;
        group.scale.set(config.scale[0], config.scale[1], config.scale[2]);

        const shellMesh = new THREE.Mesh(expanded.geometry, Array.isArray(sourceMesh.material) ? shellMaterials : shellMaterials[0]);
        shellMesh.name = config.name + ' Surface · ' + (sourceMesh.name || 'Mesh');
        shellMesh.userData = shellMesh.userData || {};
        shellMesh.userData.hobunjiSubstanceCoverShell = true;
        shellMesh.userData.hobunjiNonInteractive = true;
        shellMesh.layers?.set?.(0); // Draw in the ordinary world pass only, never in outline/occluder-only passes.
        shellMesh.castShadow = false;
        shellMesh.receiveShadow = false;
        shellMesh.frustumCulled = sourceMesh.frustumCulled !== false;
        shellMesh.renderOrder = (Number(sourceMesh.renderOrder) || 0) + config.renderOrderOffset;
        shellMesh.raycast = function ignoreSubstanceCoverRaycast() {}; // A visual covering must never steal gameplay interaction rays.
        group.add(shellMesh);

        entries.push({ sourceMesh, group, mesh: shellMesh, geometry: expanded.geometry, applyThickness: expanded.applyThickness });
      }
      return { entries, geometries, materials };
    } catch (error) {
      for (const geometry of geometries) geometry.dispose?.();
      for (const material of materials) material.dispose?.();
      throw error;
    }
  }

  function disposeBundle(bundle) {
    for (const geometry of bundle.geometries) geometry.dispose?.();
    for (const material of bundle.materials) material.dispose?.();
  }

  function create(source, options = {}) {
    const inputOptions = options && typeof options === 'object' ? options : EMPTY_OPTIONS;
    const config = normalizeOptions(inputOptions);
    let bundle = makeBundle(source, config);
    let disposed = false;
    let attached = false;

    function assertAlive() {
      if (disposed) throw new Error('SubstanceCoverShell controller has been disposed.');
    }
    function attachEntries(entries) {
      for (const entry of entries) {
        if (entry.group.parent !== entry.sourceMesh) entry.sourceMesh.add(entry.group);
      }
    }
    function removeEntries(entries) {
      for (const entry of entries) {
        if (entry.group.parent) entry.group.parent.remove(entry.group);
      }
    }

    try {
      attachEntries(bundle.entries);
      attached = true;
    } catch (error) {
      removeEntries(bundle.entries);
      disposeBundle(bundle);
      throw error;
    }

    const controller = {
      get source() { return source; },
      get meshes() { return bundle.entries.map(entry => entry.mesh); },
      get groups() { return bundle.entries.map(entry => entry.group); },
      get disposed() { return disposed; },
      get attached() { return attached; },
      setThickness(value) {
        assertAlive();
        const next = finiteNumber(value, 'thickness');
        if (next < 0) throw new RangeError('SubstanceCoverShell thickness cannot be negative.');
        config.thickness = next;
        for (const entry of bundle.entries) entry.applyThickness(next);
        return controller;
      },
      setOpacity(value) {
        assertAlive();
        const next = clamp01(finiteNumber(value, 'opacity'));
        config.opacity = next;
        if (!hasOwn(inputOptions, 'transparent') && !hasOwn(config.materialOptions, 'transparent')) config.transparent = next < 1;
        if (!hasOwn(inputOptions, 'depthWrite') && !hasOwn(config.materialOptions, 'depthWrite')) config.depthWrite = !config.transparent;
        for (const material of bundle.materials) {
          material.opacity = next;
          material.transparent = config.transparent;
          material.depthWrite = config.depthWrite;
          material.needsUpdate = true;
        }
        return controller;
      },
      setColor(value) {
        assertAlive();
        for (const material of bundle.materials) assignMaterialProperty(material, 'color', value);
        config.hasColor = true;
        config.color = value;
        return controller;
      },
      setMap(texture) {
        assertAlive();
        for (const material of bundle.materials) {
          material.map = texture;
          material.needsUpdate = true;
        }
        config.hasMap = true;
        config.map = texture;
        return controller;
      },
      setVisible(value) {
        assertAlive();
        config.visible = !!value;
        for (const entry of bundle.entries) entry.group.visible = config.visible;
        return controller;
      },
      setScale(x, y, z) {
        assertAlive();
        const sx = finiteNumber(x, 'scale');
        const sy = y === undefined ? sx : finiteNumber(y, 'scale.y');
        const sz = z === undefined ? sx : finiteNumber(z, 'scale.z');
        if (sx < 0 || sy < 0 || sz < 0) throw new RangeError('SubstanceCoverShell scale cannot be negative.');
        config.scale = [sx, sy, sz];
        for (const entry of bundle.entries) entry.group.scale.set(sx, sy, sz);
        return controller;
      },
      remove() {
        assertAlive();
        removeEntries(bundle.entries);
        attached = false;
        return controller;
      },
      attach() {
        assertAlive();
        attachEntries(bundle.entries);
        attached = true;
        return controller;
      },
      refresh() {
        assertAlive();
        const wasAttached = attached; // Keep remove()/attach() state stable while rebuilding changed source geometry.
        const next = makeBundle(source, config); // Build first so unsupported new source parts cannot destroy the current working cover.
        const previous = bundle;
        try {
          if (wasAttached) attachEntries(next.entries);
        } catch (error) {
          removeEntries(next.entries);
          disposeBundle(next);
          throw error;
        }
        removeEntries(previous.entries);
        bundle = next;
        attached = wasAttached;
        disposeBundle(previous);
        return controller;
      },
      dispose() {
        if (disposed) return false;
        removeEntries(bundle.entries);
        disposeBundle(bundle);
        attached = false;
        disposed = true;
        return true;
      },
      snapshot() {
        return {
          available: true,
          disposed,
          attached,
          sourceMeshCount: bundle.entries.length,
          shellMeshCount: bundle.entries.length,
          geometryCount: bundle.geometries.size,
          materialCount: bundle.materials.size,
          thickness: config.thickness,
          opacity: config.opacity,
          transparent: config.transparent,
          depthWrite: config.depthWrite,
          scale: config.scale.slice(),
          visible: config.visible,
        };
      },
    };
    return controller;
  }

  window.SubstanceCoverShell = Object.freeze({
    available: true,
    version: '1.0.0',
    create,
  });
})();
// Shared pre-stone-redesign ore look for surface mines, town mines, and caves.
(() => {
  'use strict';
  const SOURCE = 'assets/textures/carved_smooth.png'; // The original mine-rock recolor sprite.
  const materials = new Map(); // Shared material for every instance of one ore type.
  const states = new Map(); // Copyable mobile debug information by ore type.
  const uvStats = { originalUvs: 0 }; // Tracks meshes retaining their authored continuous UVs.
  let stoneMap = null; // Shared map for stone rocks and pending recolors.

  function setOriginalTextureOptions(texture, THREE) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.7, 0.7); // Original ore-rock texture scale; never repeat an entire PNG on each tiny facet.
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding; // Three r128 support.
    return texture;
  }

  function baseStone(THREE) {
    if (!stoneMap) stoneMap = setOriginalTextureOptions(new THREE.TextureLoader().load(SOURCE), THREE);
    return stoneMap;
  }

  function seedOf(key) {
    let seed = 2166136261; // Per-ore deterministic patina layout from the earlier mine renderer.
    for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    return seed >>> 0;
  }

  function recolorOptions(ore, key) {
    return {
      sourceHex: '#635544', // Key original rock pigment so the body becomes metal instead of plain stone.
      targetHex: ore.rockMetalHex || ore.hex,
      verdigrisHex: ore.verdigrisHex || null,
      oxidationAmount: ore.verdigrisHex ? (ore.oxidationAmount > 0 ? ore.oxidationAmount : 0.58) : 0, // Bronze ores also receive markings, not a solid patina fill.
      hueToleranceDeg: 8,
      saturationTolerance: 0.12,
      outlineWidth: 1,
      seed: seedOf(key),
    };
  }

  function materialFor(THREE, oreKey, oreDefs) {
    const key = oreDefs?.[oreKey] ? oreKey : 'stone'; // Only valid ore keys can affect the rock.
    if (materials.has(key)) return materials.get(key);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: baseStone(THREE), roughness: 0.94,
    }); // Original lit metal-like rock treatment, before the stone-island redesign.
    material.userData.sharedOreRockMaterial = true; // Removing one cave rock must not dispose shared resources.
    materials.set(key, material);
    states.set(key, key === 'stone' ? 'stone' : 'loading');

    if (key !== 'stone') {
      const recolorer = window.ToolMetalRecolor; // Already loaded earlier in docs/index.html.
      if (typeof recolorer?.getRecoloredCanvas !== 'function') {
        states.set(key, 'stone fallback (recolor unavailable)');
        window.__farmLog?.('[ore rocks] Missing metal recolorer: ' + key, 'warn', 'assets');
      } else {
        Promise.resolve().then(() => recolorer.getRecoloredCanvas(SOURCE, recolorOptions(oreDefs[key], key))).then(canvas => {
          const texture = setOriginalTextureOptions(new THREE.CanvasTexture(canvas), THREE);
          texture.needsUpdate = true;
          material.map = texture;
          material.needsUpdate = true;
          states.set(key, 'ready');
        }).catch(error => {
          states.set(key, 'stone fallback');
          window.__farmLog?.('[ore rocks] ' + key + ': ' + (error?.message || error), 'warn', 'assets');
        });
      }
    }
    return material;
  }

  // Modern callers still invoke this helper. Do not run the rejected per-face
  // cliff nine-slice mapping: the pre-redesign rock kept continuous world UVs.
  function fitRockMesh(mesh) {
    if (!mesh?.geometry) return false;
    mesh.userData ||= {}; // Marks the farm post-pass as completed without reallocating geometry every frame.
    if (!mesh.userData.oreRockSurfaceMapped) uvStats.originalUvs++;
    mesh.userData.oreRockSurfaceMapped = true; // Existing farm code uses this as its one-time processed flag.
    mesh.userData.terrainJigsawIgnore = true; // Preserve original, continuous rock texture coordinates.
    mesh.userData.naturalSurfaceUvOwner = 'legacy-continuous-rock-uv'; // Pixel Probe tells the two UV modes apart.
    return true;
  }

  window.OreRockTextures = {
    materialFor, fitRockMesh,
    debugSnapshot: () => ({ ...Object.fromEntries(states), _surfaceMapping: { mode: 'legacy continuous UV', ...uvStats } }),
  };
})();

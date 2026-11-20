// Shared pre-stone-redesign ore look for surface mines, town mines, and caves.
(() => {
  'use strict';
  const SOURCE = 'assets/textures/carved_smooth.png'; // The original mine-rock recolor sprite.
  const materials = new Map(); // Shared material for every instance of one ore type.
  const states = new Map(); // Copyable mobile debug information by ore type.
  const uvStats = { originalUvs: 0 }; // Tracks meshes retaining their authored continuous UVs.
  let stoneMap = null; // Shared map for stone rocks and pending recolors.
  let smallStone = null; // Shared closed rock geometry and material for cairns and blast rubble.

  function setOriginalTextureOptions(texture, THREE) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.7, 0.7); // Original ore-rock texture scale; never repeat an entire PNG on each tiny facet.
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding; // Three r128 support.
    return texture;
  }

  function sourceUrl() {
    const base = String(window.OreRockTexturesAssetBase || '').trim(); // Standalone author tools can resolve the same texture from their nested URL.
    return base ? base.replace(/\/?$/, '/') + SOURCE.replace(/^\/+/, '') : SOURCE;
  }

  function baseStone(THREE) {
    if (!stoneMap) stoneMap = setOriginalTextureOptions(new THREE.TextureLoader().load(sourceUrl()), THREE);
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

  // Faceted rocks (js/faceted-rocks.js) map the whole PNG onto each flat face,
  // so their map is used once per face (repeat 1, clamped) instead of the
  // mounds' 0.7 world tiling; the drawn border must reach every face edge.
  function setFacetTextureOptions(texture, THREE) {
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding; // Three r128 support.
    return texture;
  }
  let facetStoneMap = null; // Shared once-per-face stone map.
  function facetStone(THREE) {
    if (!facetStoneMap) facetStoneMap = setFacetTextureOptions(new THREE.TextureLoader().load(sourceUrl()), THREE);
    return facetStoneMap;
  }

  function materialFor(THREE, oreKey, oreDefs, options = {}) {
    const faceted = options.faceted === true;
    const key = oreDefs?.[oreKey] ? oreKey : 'stone'; // Only valid ore keys can affect the rock.
    const cacheKey = faceted ? 'faceted:' + key : key;
    if (materials.has(cacheKey)) return materials.get(cacheKey);
    const textureOptions = faceted ? setFacetTextureOptions : setOriginalTextureOptions;
    // Faceted rocks are unlit like the cliffs: each face shows the PNG's own
    // drawn shading and border at the same brightness from any side, so the
    // faces read through their inked edges rather than through lighting.
    const material = faceted
      ? new THREE.MeshBasicMaterial({ color: 0xffffff, map: facetStone(THREE) })
      : new THREE.MeshStandardMaterial({ color: 0xffffff, map: baseStone(THREE), roughness: 0.94 }); // Original lit metal-like rock treatment, before the stone-island redesign.
    material.userData.sharedOreRockMaterial = true; // Removing one cave rock must not dispose shared resources.
    if (faceted) material.userData.facetedRockMaterial = true;
    materials.set(cacheKey, material);
    states.set(cacheKey, key === 'stone' ? 'stone' : 'loading');

    if (key !== 'stone') {
      const recolorer = window.ToolMetalRecolor; // Already loaded earlier in docs/index.html.
      if (typeof recolorer?.getRecoloredCanvas !== 'function') {
        states.set(cacheKey, 'stone fallback (recolor unavailable)');
        window.__farmLog?.('[ore rocks] Missing metal recolorer: ' + key, 'warn', 'assets');
      } else {
        Promise.resolve().then(() => recolorer.getRecoloredCanvas(sourceUrl(), recolorOptions(oreDefs[key], key))).then(canvas => {
          const texture = textureOptions(new THREE.CanvasTexture(canvas), THREE);
          texture.needsUpdate = true;
          material.map = texture;
          material.needsUpdate = true;
          states.set(cacheKey, 'ready');
        }).catch(error => {
          states.set(cacheKey, 'stone fallback');
          window.__farmLog?.('[ore rocks] ' + key + ': ' + (error?.message || error), 'warn', 'assets');
        });
      }
    }
    return material;
  }

  function smallStoneArt(THREE) {
    if (smallStone) return smallStone;
    // A closed, broad-faced blank lets stacked stones overlap through their faces.
    const blank = new THREE.CylinderGeometry(.46, .5, 1, 6);
    try {
      const geometry = window.ProceduralFurniture.createRockGeometry(blank, {
        seed: 'small-loose-stone', roughness: .55, contactArea: 1,
        contactFaces: [-1, 1].map(direction => ({
          source: 'body', normal: [0, direction, 0], offset: .5,
          min: [-.26, direction * .5, -.26], max: [.26, direction * .5, .26],
        })), // Keep a small bearing face on top and bottom while roughening the edges.
      });
      smallStone = { geometry, material: materialFor(THREE) };
      return smallStone;
    } finally {
      blank.dispose();
    }
  }

  // Modern callers still invoke this helper. Do not run the rejected per-face
  // cliff nine-slice mapping: the pre-redesign rock kept continuous world UVs.
  function fitRockMesh(mesh) {
    if (!mesh?.geometry) return false;
    mesh.userData ||= {}; // Marks the farm post-pass as completed without reallocating geometry every frame.
    if (!mesh.userData.oreRockSurfaceMapped) uvStats.originalUvs++;
    mesh.userData.oreRockSurfaceMapped = true; // Farm post-pass relies on this one-time processed marker.
    if (!mesh.userData.farmLooseRockMound) {
      mesh.userData.terrainJigsawIgnore = true; // Mineable ore keeps its original world UVs instead of facet re-baking.
      mesh.userData.naturalSurfaceUvOwner = 'legacy-continuous-rock-uv'; // Pixel Probe identifies the ore rollback.
    } // Plain farm rocks retain NaturalSurfaceMaterials' existing UV ownership without ore-specific overrides.
    return true;
  }

  window.OreRockTextures = {
    materialFor, fitRockMesh, smallStoneArt,
    facetedMaterialFor: (THREE, oreKey, oreDefs) => materialFor(THREE, oreKey, oreDefs, { faceted: true }),
    debugSnapshot: () => ({ ...Object.fromEntries(states), _surfaceMapping: { mode: 'legacy continuous UV', ...uvStats } }),
  };
})();

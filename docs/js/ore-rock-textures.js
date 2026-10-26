// One natural-stone/mineral renderer for surface rocks, mines and random caves.
(() => {
  'use strict';
  const SOURCE = 'assets/textures/carved_smooth.png'; // Carved-stone image used by every mineable ore mesh.
  const materials = new Map(); // Shared materials avoid one canvas or mesh material per rock.
  const states = new Map(); // Mobile-visible loading/fallback diagnostics per ore type.
  let stoneMap = null; // Natural stone fallback while masked ore textures load.
  let imagePromise = null; // Single source-image read, reused for all ore colors.
  const surfaceStats = { mapped: 0, unmapped: 0, surfaces: 0, fallbacks: 0 }; // Mobile Pixel Probe reports whether low-poly ore faces really use the cliff-style UV solver.

  function baseStone(THREE) {
    if (!stoneMap) {
      stoneMap = new THREE.TextureLoader().load(SOURCE);
      stoneMap.wrapS = stoneMap.wrapT = THREE.RepeatWrapping;
      stoneMap.repeat.set(1, 1); // The temporary stone map must show the same full PNG UV domain as the finished ore canvas.
      if ('colorSpace' in stoneMap && THREE.SRGBColorSpace) stoneMap.colorSpace = THREE.SRGBColorSpace;
      else if (THREE.sRGBEncoding != null) stoneMap.encoding = THREE.sRGBEncoding; // Three r128 uses encoding, not colorSpace.
    }
    return stoneMap;
  }

  function sourceImage() {
    if (!imagePromise) imagePromise = new Promise((resolve, reject) => {
      const image = new Image(); // Browser decode exposes the stone pixels for selective recoloring.
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load ' + SOURCE));
      image.src = SOURCE;
    });
    return imagePromise;
  }

  function seedOf(key) {
    let seed = 2166136261; // Stable ore-specific random seed, independent of render order.
    for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    return seed >>> 0;
  }

  function lattice(x, y, seed) {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed; // Stable irregular patch field.
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function noise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y); // Lattice corner for smoothly connected ore islands.
    const u = x - ix, v = y - iy; // Local interpolation distances.
    const sx = u * u * (3 - 2 * u), sy = v * v * (3 - 2 * v);
    const top = lattice(ix, iy, seed) * (1 - sx) + lattice(ix + 1, iy, seed) * sx;
    const bottom = lattice(ix, iy + 1, seed) * (1 - sx) + lattice(ix + 1, iy + 1, seed) * sx;
    return top * (1 - sy) + bottom * sy;
  }

  function mineralCanvas(image, ore, key) {
    const canvas = document.createElement('canvas'); // Original stone PNG with mineral islands occupying only the vein mask.
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); // Stone pixels remain untouched wherever the mask is absent.
    const rgba = pixels.data;
    const mineralHex = ore.verdigrisHex || ore.hex; // Exposed veins use the ore's verdigris tint when one exists; other ores keep their own color.
    const tint = [1, 3, 5].map(offset => parseInt(mineralHex.slice(offset, offset + 2), 16)); // Applied only inside the irregular mineral mask.
    const seed = seedOf(key);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (rgba[i + 3] < 16) continue;
      const u = x / canvas.width, v = y / canvas.height;
      const mask = noise(u * 4.2 + 3, v * 4.2 + 5, seed) * 0.7
        + noise(u * 11.7 + 7, v * 11.7 + 9, seed ^ 0x9e3779b9) * 0.3;
      if (mask <= 0.53) continue; // Non-ore portions must stay ordinary stone, with original color and shading.
      const brightness = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / (3 * 255);
      const shade = 0.78 + brightness * 0.56; // Keep the source relief shading but let oxidation read clearly against dark stone.
      for (let channel = 0; channel < 3; channel++) rgba[i + channel] = Math.min(255, Math.round(tint[channel] * shade));
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  function materialFor(THREE, oreKey, oreDefs) {
    const key = oreDefs?.[oreKey] ? oreKey : 'stone'; // Ordinary/unknown rocks use pure stone.
    if (materials.has(key)) return materials.get(key);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: baseStone(THREE),
    }); // Matches the authored unlit cliff/rock texture treatment, so verdigris stays visible in shaded caves.
    material.userData.sharedOreRockMaterial = true;
    materials.set(key, material);
    states.set(key, key === 'stone' ? 'stone' : 'loading');
    if (key !== 'stone') {
      sourceImage().then(image => {
        const texture = new THREE.CanvasTexture(mineralCanvas(image, oreDefs[key], key)); // Ore-specific tint only in the verdigris-shaped mask.
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1); // Each UV island samples one complete stone/mineral PNG rather than an arbitrary 70% crop.
        if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding; // Required by the game's Three r128.
        texture.needsUpdate = true;
        material.map = texture;
        material.needsUpdate = true;
        states.set(key, 'ready');
      }).catch(error => {
        states.set(key, 'stone fallback');
        window.__farmLog?.('[ore rocks] ' + key + ': ' + (error?.message || error), 'warn', 'assets');
      });
    }
    return material;
  }

  function fitRockMesh(mesh, label = 'rock') {
    const mapper = window.HobunjiSurfaceStretchUV; // Reuses the existing cliff surface-island nine-slice solver after the rock's final displacement.
    if (!mesh?.geometry || typeof mapper?.mapMesh !== 'function') { surfaceStats.unmapped++; return false; }
    const previousGeometry = mesh.geometry; // Used to release the indexed mound after the mapper clones it into independently UV-seamed facets.
    const report = mapper.mapMesh(mesh, {
      label: 'ore-rock:' + label,
      angleToleranceDeg: 24, // The same face split threshold as cliff surfaces, now useful on coarser rock geometry.
      preserveQuadPairs: true, // Keep both triangles of each actual heightfield quad together so its four corners receive a full nine-slice PNG domain.
      edgeSourceFraction: 0.32, // Preserve the black/pale edge bands of the authored stone PNG around each face.
      edgeReferenceWorldSize: 1, // A mineable mound is about one tile wide, not a six-tile cliff wall.
      avoidCollapsedUvs: true,
    });
    if (!report) { surfaceStats.unmapped++; return false; }
    if (mesh.geometry !== previousGeometry) previousGeometry.dispose?.(); // Grass and stone use distinct Geometry objects, so disposing this old GPU object leaves the grass rim intact.
    mesh.userData ||= {}; // The UV ownership markers below persist until the rock is mined or its chunk is disposed.
    mesh.userData.terrainJigsawIgnore = true; // Prevent TerrainJigsawUV from replacing the protected-edge ore-rock UV solution.
    mesh.userData.naturalSurfaceUvOwner = 'HobunjiSurfaceStretchUV'; // Pixel Probe can identify the canonical mapper as the final UV authority.
    surfaceStats.mapped++;
    surfaceStats.surfaces += report.patchCount || 0;
    surfaceStats.fallbacks += report.fallbackCount || 0;
    mesh.userData.oreRockSurfaceMapped = true; // Used by Pixel Probe to distinguish a successfully fitted rock from the fallback tiled texture.
    return true;
  }

  window.OreRockTextures = { materialFor, fitRockMesh, debugSnapshot: () => ({ ...Object.fromEntries(states), _surfaceMapping: { ...surfaceStats } }) };
})();

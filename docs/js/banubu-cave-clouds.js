// Low, softly luminous cloud PNGs for Banubu's authored cavern.
(() => {
  'use strict';

  const CAVE_ID = 'map_i_den_banubu'; // Limits the atmosphere to Banubu's own cave.
  const BANUBU_CLOUD_FILL_HEX = '#c3e3e9'; // Used by textureFor() so every cave-cloud interior exactly matches Banubu's authored coloredstripe.
  const CLOUDS = [
    // North pocket — dense, but leaves the 5–8 × 4–7 dialogue/sleep center open.
    [3.2, 3.2, 0.45, 'cloud1.png', 0.0],
    [4.4, 2.7, 0.85, 'cloud4.png', 0.7],
    [5.6, 2.4, 0.35, 'cloud7.png', 1.4],
    [6.8, 2.3, 0.65, 'cloud1.png', 2.1],
    [8.0, 2.5, 1.05, 'cloud4.png', 2.8],
    [9.2, 3.0, 0.45, 'cloud7.png', 3.5],
    [10.1, 3.6, 0.85, 'cloud1.png', 4.2],

    // West wall pocket.
    [2.0, 4.3, 0.35, 'cloud4.png', 4.9],
    [1.8, 5.4, 0.65, 'cloud7.png', 5.6],
    [1.9, 6.5, 1.05, 'cloud1.png', 0.4],
    [2.2, 7.5, 0.45, 'cloud4.png', 1.1],

    // East wall pocket.
    [10.8, 4.4, 0.85, 'cloud7.png', 1.8],
    [11.0, 5.5, 0.35, 'cloud1.png', 2.5],
    [10.9, 6.6, 0.65, 'cloud4.png', 3.2],
    [10.5, 7.6, 1.05, 'cloud7.png', 3.9],

    // South pocket.
    [3.0, 8.0, 0.45, 'cloud1.png', 4.6],
    [3.8, 8.7, 0.85, 'cloud4.png', 5.3],
    [5.0, 9.1, 0.35, 'cloud7.png', 6.0],
    [6.2, 9.4, 0.65, 'cloud1.png', 0.8],
    [7.4, 9.2, 1.05, 'cloud4.png', 1.6],
    [8.6, 8.8, 0.45, 'cloud7.png', 2.4],
    [9.6, 8.1, 0.85, 'cloud1.png', 3.2],
  ]; // Original cloud rendering/height behavior retained; only population is expanded into a perimeter ring with the cave center deliberately clear.
  const textureCache = new Map(); // Reuses recolored PNG canvases across cave reloads.
  let lastCloudGroup = null; // Read by Pixel Probe so cloud and cave-floor heights can be compared without devtools.
  const TEXTURE_SLOTS = ['map', 'specularMap', 'displacementMap', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap', 'aoMap', 'lightMap']; // Material maps whose UV transforms Three.js reads during a cave render.

  function validateCaveMaterials({ THREE, scene, mapData }) {
    if (mapData?.id !== CAVE_ID || !THREE || !scene) return 0;
    let repairs = 0; // Counts malformed cave texture slots so the existing render log can identify this failure without frame-spamming.
    scene.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material]; // Covers groups with more than one authored surface.
      for (const material of materials) {
        if (!material) continue;
        for (const slot of TEXTURE_SLOTS) {
          const texture = material[slot];
          if (!texture) continue;
          if (!texture.isTexture) {
            material[slot] = null;
            material.needsUpdate = true;
          } else if (!texture.matrix?.elements) {
            texture.matrix = new THREE.Matrix3();
            texture.matrixAutoUpdate = false;
          } else continue;
          repairs++;
          window.__farmLog?.(`[banubu-clouds] repaired ${object.name || object.type}.${slot} texture UV transform`, 'render');
        }
      }
    });
    return repairs;
  }

  function textureFor(THREE, filename) {
    if (textureCache.has(filename)) return textureCache.get(filename);
    const canvas = document.createElement('canvas'); // Recolors the surviving authored cloud pixels to Banubu's stripe hex while retaining the existing cave-cloud alpha treatment.
    const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, `banubu_cloud_${filename}`);
    const image = new Image(); // Loaded with CORS so readback and WebGL upload remain valid under GitHack.
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const fillRgb = Number.parseInt(BANUBU_CLOUD_FILL_HEX.slice(1), 16); // Used below to apply the exact authored stripe color without maintaining a second RGB constant.
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) / 255;
        pixels.data[i] = (fillRgb >> 16) & 255;
        pixels.data[i + 1] = (fillRgb >> 8) & 255;
        pixels.data[i + 2] = fillRgb & 255;
        pixels.data[i + 3] = Math.round(pixels.data[i + 3] * Math.max(0, (value - 0.08) / 0.75) * 0.67);
      }
      context.putImageData(pixels, 0, 0);
      texture.needsUpdate = true;
    };
    image.onerror = () => window.__farmLog?.(`[banubu-clouds] missing ${filename}`, 'render');
    image.src = `assets/sky_sprites/${filename}`;
    textureCache.set(filename, texture);
    return texture;
  }

  function decorate({ THREE, scene, mapData }) {
    if (mapData?.id !== CAVE_ID || !THREE || !scene) return;
    const fallbackSurface = Number(mapData.floorSurfaceY) || 0; // Used when a cloud has no authored floor tile directly beneath it.
    const group = new THREE.Group(); // Keeps cave-specific meshes and lights together for scene disposal.
    group.name = 'banubu_silvery_clouds';
    const geometry = new THREE.PlaneGeometry(3.6, 1.2); // Shared geometry keeps the denser perimeter cloud ring inexpensive.
    CLOUDS.forEach(([x, z, height, filename, phase], index) => {
      const sampledSurface = Number(mapData.floorSurfaceByTile?.[`${Math.floor(x)},${Math.floor(z)}`]); // Uses the same corrected local cave floor sample as character grounding.
      const surface = Number.isFinite(sampledSurface) ? sampledSurface : fallbackSurface; // Prevents a missing tile sample from putting one cloud underground.
      const material = window.HobunjiSpritePngSurface.makeMaterial(THREE, textureFor(THREE, filename), `banubu_cloud_${index}`, {
        transparent: true, alphaTest: 0.01, depthWrite: false, side: THREE.DoubleSide,
      }); // Uses the canonical authored PNG-plane texture and material settings.
      const cloud = new THREE.Mesh(geometry, material);
      cloud.name = `banubu_cloud_${index}`;
      cloud.userData.banubuFloorY = surface; // Records the local tile sample used for this cloud's fixed altitude.
      cloud.position.set(x, surface + height, z);
      cloud.frustumCulled = false;
      cloud.renderOrder = 45;
      cloud.onBeforeRender = (_renderer, _scene, camera) => {
        const elapsed = performance.now() * 0.00013; // Slow drift in X/Z only; altitude is constant.
        cloud.position.x = x + Math.sin(elapsed + phase) * 0.32;
        cloud.position.z = z + Math.cos(elapsed * 0.7 + phase) * 0.19;
        cloud.quaternion.copy(camera.quaternion);
      };
      group.add(cloud);
      if (index % 2 === 0) {
        const light = new THREE.PointLight(0x8dbbdf, 0.45, 3.8, 2); // Soft local light that follows its cloud, rather than brightening the entire cave.
        light.position.set(0, 0, -0.1);
        cloud.add(light);
      }
    });
    scene.add(group);
    lastCloudGroup = group;
    group.userData.banubuCloudFloorY = fallbackSurface; // Exposed to Pixel Probe to compare the cloud plane with the standing surface on mobile.
    window.__farmLog?.(`[banubu-clouds] ${CLOUDS.length} original-style fixed-height cloud PNGs around the perimeter`, 'render');
  }

  function debugSnapshot() {
    return lastCloudGroup?.children.map(cloud => ({ name: cloud.name, floorY: cloud.userData.banubuFloorY, y: cloud.position.y })) || []; // Used only on demand by Pixel Probe.
  }

  window.BanubuCaveClouds = { decorate, validateCaveMaterials, debugSnapshot };
})();

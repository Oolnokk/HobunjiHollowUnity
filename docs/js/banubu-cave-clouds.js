// Low, softly luminous cloud PNGs for Banubu's authored cavern.
(() => {
  'use strict';

  const CAVE_ID = 'map_i_den_banubu'; // Limits the atmosphere to Banubu's own cave.
  const CLOUDS = [
    [3.5, 4.5, 1.45, 'cloud1.png', 0.0],
    [8.5, 3.7, 1.85, 'cloud4.png', 1.7],
    [4.2, 7.3, 1.35, 'cloud7.png', 3.1],
    [8.8, 7.5, 1.65, 'cloud1.png', 4.6],
    [6.2, 3.3, 2.05, 'cloud4.png', 2.2],
  ]; // Fixed heights keep all animation horizontal without vertical bob.
  const textureCache = new Map(); // Reuses recolored PNG canvases across cave reloads.

  function textureFor(THREE, filename) {
    if (textureCache.has(filename)) return textureCache.get(filename);
    const canvas = document.createElement('canvas'); // Recolors authored sky PNG brightness into silvery blue and removes its heavy black silhouette.
    const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, `banubu_cloud_${filename}`);
    const image = new Image(); // Loaded with CORS so readback and WebGL upload remain valid under GitHack.
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) / 255;
        pixels.data[i] = 170 + 58 * value;
        pixels.data[i + 1] = 202 + 40 * value;
        pixels.data[i + 2] = 224 + 30 * value;
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
    const surface = Number(mapData.floorSurfaceY) || 0; // Places clouds relative to the same carved floor used for player grounding.
    const group = new THREE.Group(); // Keeps cave-specific meshes and lights together for scene disposal.
    group.name = 'banubu_silvery_clouds';
    const geometry = new THREE.PlaneGeometry(3.6, 1.2); // Shared geometry for the five small atmospheric planes.
    CLOUDS.forEach(([x, z, height, filename, phase], index) => {
      const material = window.HobunjiSpritePngSurface.makeMaterial(THREE, textureFor(THREE, filename), `banubu_cloud_${index}`, {
        transparent: true, alphaTest: 0.01, depthWrite: false, side: THREE.DoubleSide,
      }); // Uses the canonical authored PNG-plane texture and material settings.
      const cloud = new THREE.Mesh(geometry, material);
      cloud.name = `banubu_cloud_${index}`;
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
    window.__farmLog?.('[banubu-clouds] 5 fixed-height cloud PNGs and 3 local lights', 'render');
  }

  window.BanubuCaveClouds = { decorate };
})();

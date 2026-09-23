// Low, softly luminous cloud PNGs for Banubu's authored cavern.
(() => {
  'use strict';

  const CAVE_ID = 'map_i_den_banubu'; // Limits the atmosphere to Banubu's own cave.
  const CLOUDS = [
    [5.0, 2.5, 0.38, 'cloud1.png', 0.0],
    [7.2, 2.7, 0.35, 'cloud4.png', 0.7],
    [3.1, 3.5, 0.40, 'cloud7.png', 1.4],
    [5.2, 3.8, 0.34, 'cloud1.png', 2.1],
    [7.4, 3.6, 0.39, 'cloud4.png', 2.8],
    [9.5, 3.7, 0.36, 'cloud7.png', 3.5],
    [2.4, 4.9, 0.41, 'cloud4.png', 4.2],
    [4.5, 5.0, 0.35, 'cloud7.png', 4.9],
    [6.5, 4.8, 0.38, 'cloud1.png', 5.6],
    [8.5, 5.0, 0.34, 'cloud4.png', 0.4],
    [10.3, 5.2, 0.40, 'cloud7.png', 1.1],
    [2.5, 6.5, 0.37, 'cloud1.png', 1.8],
    [4.6, 6.6, 0.41, 'cloud4.png', 2.5],
    [6.7, 6.2, 0.35, 'cloud7.png', 3.2],
    [8.7, 6.5, 0.39, 'cloud1.png', 3.9],
    [10.2, 6.8, 0.34, 'cloud4.png', 4.6],
    [3.0, 7.8, 0.40, 'cloud7.png', 5.3],
    [5.1, 8.2, 0.36, 'cloud1.png', 6.0],
    [7.2, 7.8, 0.34, 'cloud4.png', 0.8],
    [9.3, 7.8, 0.39, 'cloud7.png', 1.6],
    [4.2, 9.0, 0.37, 'cloud1.png', 2.4],
    [6.4, 9.2, 0.35, 'cloud4.png', 3.2],
    [8.5, 9.0, 0.40, 'cloud7.png', 4.0],
  ]; // Dense floor-hugging layer; all authored heights stay within 0.07 tiles so the old high floaters no longer form a second level.
  const textureCache = new Map(); // Reuses recolored PNG canvases across cave reloads.
  const CLOUD_OUTLINE_VALUE_MAX = 0.24; // Used by textureFor() to preserve the authored dark/black outline pixels instead of fading them out with the luminous interior.
  const CLOUD_INTERIOR_ALPHA = 0.67; // Used only on non-outline cloud fill so the silvery-blue interior stays translucent while the black outline retains authored opacity.
  const CLOUD_DEPTH_EROSION_PX = 1.5; // Used by the depth-only overlap mask to sit slightly inside the visible outline and avoid clear seams between overlapping cave clouds.
  const CLOUD_DEPTH_ALPHA_CUTOFF = 0.08; // Used by the depth-only overlap mask to ignore transparent PNG fringe pixels.
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
    const canvas = document.createElement('canvas'); // Recolors only the cloud interior; authored black outline pixels keep their source RGB and alpha.
    canvas.width = canvas.height = 1;
    const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, `banubu_cloud_${filename}`);
    texture.userData = Object.assign({}, texture.userData || {}, { banubuDepthMaskTexelUniforms: [] }); // Updated after the real PNG dimensions arrive so every paired depth mask erodes by a stable pixel amount.
    const image = new Image(); // Loaded with CORS so readback and WebGL upload remain valid under GitHack.
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const sourceAlpha = pixels.data[i + 3]; // Preserved verbatim for dark authored outline pixels.
        if (!sourceAlpha) continue;
        const value = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) / 255;
        if (value <= CLOUD_OUTLINE_VALUE_MAX) {
          pixels.data[i + 3] = sourceAlpha;
          continue;
        }
        pixels.data[i] = 170 + 58 * value;
        pixels.data[i + 1] = 202 + 40 * value;
        pixels.data[i + 2] = 224 + 30 * value;
        pixels.data[i + 3] = Math.round(sourceAlpha * CLOUD_INTERIOR_ALPHA);
      }
      context.putImageData(pixels, 0, 0);
      for (const uniform of texture.userData?.banubuDepthMaskTexelUniforms || []) {
        uniform.value.set(1 / Math.max(1, canvas.width), 1 / Math.max(1, canvas.height));
      }
      texture.needsUpdate = true;
    };
    image.onerror = () => window.__farmLog?.(`[banubu-clouds] missing ${filename}`, 'render');
    image.src = `assets/sky_sprites/${filename}`;
    textureCache.set(filename, texture);
    return texture;
  }

  function makeDepthMaskMaterial(THREE, texture, index) {
    const texel = new THREE.Vector2(1, 1); // Replaced with the decoded PNG pixel size by textureFor(); shared only with this mask material.
    texture.userData?.banubuDepthMaskTexelUniforms?.push({ value: texel });
    const material = new THREE.ShaderMaterial({
      name: `banubu_cloud_depth_mask_${index}`,
      side: THREE.DoubleSide,
      colorWrite: false,
      depthTest: true,
      depthWrite: true,
      fog: false,
      blending: THREE.NoBlending,
      uniforms: {
        uMap: { value: texture },
        uTexel: { value: texel },
        uErodePx: { value: CLOUD_DEPTH_EROSION_PX },
        uCutoff: { value: CLOUD_DEPTH_ALPHA_CUTOFF },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float; uniform sampler2D uMap; uniform vec2 uTexel; uniform float uErodePx; uniform float uCutoff; varying vec2 vUv;
        void main(){
          vec2 d=uTexel*uErodePx;
          float a=texture2D(uMap,vUv).a;
          a=min(a,texture2D(uMap,vUv+vec2( d.x,0.0)).a);
          a=min(a,texture2D(uMap,vUv+vec2(-d.x,0.0)).a);
          a=min(a,texture2D(uMap,vUv+vec2(0.0, d.y)).a);
          a=min(a,texture2D(uMap,vUv+vec2(0.0,-d.y)).a);
          a=min(a,texture2D(uMap,vUv+vec2( d.x, d.y)).a);
          a=min(a,texture2D(uMap,vUv+vec2(-d.x, d.y)).a);
          a=min(a,texture2D(uMap,vUv+vec2( d.x,-d.y)).a);
          a=min(a,texture2D(uMap,vUv+vec2(-d.x,-d.y)).a);
          if(a<uCutoff) discard;
          gl_FragColor=vec4(0.0);
        }`,
    }); // Mirrors the sky cloud depth-mask technique: an inset opaque-alpha silhouette writes depth before the visible transparent PNG.
    material.userData = Object.assign({}, material.userData || {}, { hobunjiNoOutline: true, banubuCloudDepthMask: true });
    return material;
  }

  function decorate({ THREE, scene, mapData }) {
    if (mapData?.id !== CAVE_ID || !THREE || !scene) return;
    const fallbackSurface = Number(mapData.floorSurfaceY) || 0; // Used when a cloud has no authored floor tile directly beneath it.
    const group = new THREE.Group(); // Keeps cave-specific visible clouds, depth masks, and lights together for scene disposal.
    group.name = 'banubu_silvery_clouds';
    const geometry = new THREE.PlaneGeometry(3.6, 1.2); // Shared geometry keeps the denser cloud layer cheap; each cloud gets a paired depth-only mask using the same vertices.
    let lightCount = 0; // Reported in the mobile-visible render log so denser cloud authoring can be checked without DevTools.
    CLOUDS.forEach(([x, z, height, filename, phase], index) => {
      const sampledSurface = Number(mapData.floorSurfaceByTile?.[`${Math.floor(x)},${Math.floor(z)}`]); // Uses the same corrected local cave floor sample as character grounding.
      const surface = Number.isFinite(sampledSurface) ? sampledSurface : fallbackSurface; // Prevents a missing tile sample from putting one cloud underground.
      const texture = textureFor(THREE, filename); // Shared by the visible PNG and its eroded depth-only overlap mask.
      const material = window.HobunjiSpritePngSurface.makeMaterial(THREE, texture, `banubu_cloud_${index}`, {
        transparent: true, alphaTest: 0.01, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      }); // Canonical PNG-plane material; authored black outline pixels remain in the recolored texture.
      const cloud = new THREE.Mesh(geometry, material);
      cloud.name = `banubu_cloud_${index}`;
      cloud.userData.banubuCloudVisual = true;
      cloud.userData.banubuFloorY = surface; // Records the local tile sample used for this cloud's fixed altitude.
      const depthMask = new THREE.Mesh(geometry, makeDepthMaskMaterial(THREE, texture, index)); // Same silhouette/depth strategy used by the outdoor sky clouds.
      depthMask.name = `banubu_cloud_depth_mask_${index}`;
      depthMask.userData.banubuCloudDepthMask = true;
      depthMask.frustumCulled = false;
      cloud.frustumCulled = false;
      depthMask.renderOrder = 40 + index;
      cloud.renderOrder = 80 + index;

      const updatePair = (_renderer, _scene, camera) => {
        const elapsed = performance.now() * 0.00013; // Slow drift in X/Z only; altitude remains fixed relative to the sampled cave floor.
        const px = x + Math.sin(elapsed + phase) * 0.32;
        const pz = z + Math.cos(elapsed * 0.7 + phase) * 0.19;
        depthMask.position.set(px, surface + height, pz);
        cloud.position.copy(depthMask.position);
        depthMask.quaternion.copy(camera.quaternion);
        cloud.quaternion.copy(camera.quaternion);
      }; // Shared by both passes so the depth silhouette and visible sprite cannot drift apart.
      depthMask.onBeforeRender = updatePair;
      cloud.onBeforeRender = updatePair;
      depthMask.position.set(x, surface + height, z);
      cloud.position.copy(depthMask.position);
      group.add(depthMask, cloud);

      if (index % 5 === 0) {
        const light = new THREE.PointLight(0x8dbbdf, 0.45, 3.8, 2); // A few soft local lights preserve the glow without scaling point-light cost with all 23 clouds.
        light.position.set(0, 0, -0.1);
        cloud.add(light);
        lightCount++;
      }
    });
    scene.add(group);
    lastCloudGroup = group;
    group.userData.banubuCloudFloorY = fallbackSurface; // Exposed to Pixel Probe to compare the cloud plane with the standing surface on mobile.
    group.userData.banubuCloudCount = CLOUDS.length;
    group.userData.banubuCloudMasking = 'eroded-depth-mask';
    window.__farmLog?.(`[banubu-clouds] ${CLOUDS.length} floor-hugging cloud PNGs, ${lightCount} local lights, authored outlines retained, hard overlap masking active`, 'render');
  }

  function debugSnapshot() {
    return lastCloudGroup?.children.filter(cloud => cloud.userData?.banubuCloudVisual).map(cloud => ({ name: cloud.name, floorY: cloud.userData.banubuFloorY, y: cloud.position.y, masking: lastCloudGroup.userData?.banubuCloudMasking || 'none' })) || []; // Used only on demand by Pixel Probe; depth-only mask siblings are intentionally omitted.
  }

  window.BanubuCaveClouds = { decorate, validateCaveMaterials, debugSnapshot };
})();

// Shared PNG-to-single-plane avatar assembly for rough HTML demos.
// This reuses the single-plane mode from docs/references/(HA)PNGtoGLBV1.html,
// but returns live Three.js objects instead of exporting GLB files.
(function () {
  'use strict';

  function cfg() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
  }

  function makeVariantCanvas(image, options = {}) {
    const flipX = !!options.flipX;
    const blackSilhouette = !!options.blackSilhouette;
    const c = document.createElement('canvas');
    c.width = image.naturalWidth || image.videoWidth || image.width;
    c.height = image.naturalHeight || image.videoHeight || image.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    if (flipX) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(image, 0, 0, c.width, c.height);
    ctx.restore();
    if (blackSilhouette) {
      const imgData = ctx.getImageData(0, 0, c.width, c.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    return c;
  }

  function makeTextureFromCanvas(THREE, canvasEl, debugName) {
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.name = debugName;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function makeSpriteMaterial(THREE, texture, debugName) {
    return new THREE.MeshBasicMaterial({
      name: debugName,
      map: texture,
      transparent: true,
      alphaTest: cfg().alphaTest ?? 0.001,
      side: THREE.FrontSide,
      depthWrite: false,
    });
  }

  function buildTextureSet(THREE, image, backImage) {
    const rearSource = backImage || image;
    const rearOptions = backImage ? { flipX: true } : { flipX: true, blackSilhouette: true };
    return {
      frontOriginal: makeTextureFromCanvas(THREE, makeVariantCanvas(image), 'npc_avatar_front_texture'),
      backForOriginal: makeTextureFromCanvas(THREE, makeVariantCanvas(rearSource, rearOptions), backImage ? 'npc_avatar_back_assembled_texture' : 'npc_avatar_back_silhouette_texture'),
    };
  }

  function createSinglePlaneAssembly(THREE, config) {
    const group = new THREE.Group();
    group.name = config.name || 'npc_avatar_single_plane_assembly';

    const planeGeo = new THREE.PlaneGeometry(config.planeWidth, config.planeHeight);
    const frontMesh = new THREE.Mesh(planeGeo, makeSpriteMaterial(THREE, config.textures.frontOriginal, 'npc_avatar_front_material'));
    frontMesh.name = 'npc_avatar_front_plane';
    frontMesh.position.z = config.anchorZ;
    frontMesh.renderOrder = 2;
    group.add(frontMesh);

    const backMesh = new THREE.Mesh(planeGeo.clone(), makeSpriteMaterial(THREE, config.textures.backForOriginal, 'npc_avatar_back_material'));
    backMesh.name = 'npc_avatar_back_plane';
    backMesh.position.z = config.anchorZ - (cfg().backPlaneOffsetZ ?? 0.001);
    backMesh.rotation.y = Math.PI;
    backMesh.renderOrder = 2;
    group.add(backMesh);

    return group;
  }

  function buildSinglePlaneAvatarModel(THREE, sourceCanvas, options = {}) {
    if (!THREE) throw new Error('THREE is required to build an NPC plane avatar model.');
    if (!sourceCanvas) throw new Error('A source canvas or image is required to build an NPC plane avatar model.');
    const pxW = sourceCanvas.naturalWidth || sourceCanvas.width;
    const pxH = sourceCanvas.naturalHeight || sourceCanvas.height;
    const aspectHeight = pxH / Math.max(1, pxW);
    const modelWidth = options.modelWidth ?? cfg().modelWidth ?? 1;
    const modelHeight = options.modelHeight ?? modelWidth * aspectHeight;
    const anchorZ = options.anchorZ ?? cfg().anchorZ ?? 0;
    const textures = buildTextureSet(THREE, sourceCanvas, options.backCanvas || options.backImage || null);
    const root = new THREE.Group();
    root.name = options.name || 'Temporary_NPC_Portrait_Model';
    root.userData = {
      ...(options.userData || {}),
      sourceImagePixels: `${pxW}x${pxH}`,
      pngPipelineMode: 'single',
      modelRole: 'temporary-npc-demo-model',
      prismRule: options.backCanvas || options.backImage
        ? 'disabled for runtime NPC preview; a single front plane plus assembled rear portrait plane are created'
        : 'disabled for runtime NPC preview; only the single front plane plus rear silhouette are created',
    };
    root.add(createSinglePlaneAssembly(THREE, {
      planeWidth: modelWidth,
      planeHeight: modelHeight,
      anchorZ,
      textures,
      name: `${root.name}_single_plane_assembly`,
    }));
    return root;
  }

  function disposeAvatarModel(root) {
    if (!root) return;
    root.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
      for (const mat of materials) {
        if (mat.map) mat.map.dispose();
        mat.dispose?.();
      }
    });
  }

  async function loadThreeModules() {
    const c = cfg();
    const threeUrl = c.threeModuleUrl;
    const controlsUrl = c.orbitControlsModuleUrl;
    if (!threeUrl) throw new Error('Missing SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.threeModuleUrl');
    const [THREE, controlsMod] = await Promise.all([
      import(threeUrl),
      controlsUrl ? import(controlsUrl) : Promise.resolve(null),
    ]);
    return { THREE, OrbitControls: controlsMod?.OrbitControls || null };
  }

  window.PNGPlaneAvatar = {
    makeVariantCanvas,
    buildSinglePlaneAvatarModel,
    disposeAvatarModel,
    loadThreeModules,
  };
})();

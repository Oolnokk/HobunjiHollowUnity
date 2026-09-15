(() => {
  'use strict';

  const THREE = window.THREE;
  const mapper = window.HobunjiSurfaceStretchUV;
  if (!THREE?.BufferGeometry || !mapper?.mapGeometry || window.WaterCanvasStretchOverlay?.installed) return;

  const BASE_WATER_TEXTURE_URL = 'assets/textures/wavy_surface.png';
  const BANK_SOURCE_TEXTURE_URL = 'assets/textures/canvas.png';
  const PURE_BLACK_EPSILON = 1;
  const DEFAULT_SPLIT_ANGLE_DEG = 24;
  const DEFAULT_LEGACY_SOURCE_EDGE = 0.16;
  const DEFAULT_LEGACY_SURFACE_EDGE = 0.06;
  const DEBUG_HISTORY_LIMIT = 12;
  let renderer = window.MergedWaterRenderer || null;

  const state = {
    installed: true,
    rendererInstallAttempts: 0,
    rendererInstalled: false,
    lateHookInstalled: false,
    materialPatches: 0,
    fittedMeshes: 0,
    fittedVertices: 0,
    mapperFallbacks: 0,
    shaderPatchFailures: 0,
    bankMaskPixels: 0,
    genericFrameRetunes: 0,
    recent: [],
  };

  function debugLog(message, level = 'info') {
    const text = `[water-bank-outline] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function configuredSourceEdge() {
    const value = Number(window.NaturalSurfaceMaterialConfig?.perimeterFrame?.sourceEdgeFraction);
    return Number.isFinite(value) ? Math.max(0.001, Math.min(0.49, value)) : 0.45;
  }

  function replaceRequired(source, needle, replacement, label) {
    const input = String(source || '');
    if (!input.includes(needle)) throw new Error(`missing ${label} shader marker`);
    return input.replace(needle, replacement);
  }

  function transparentTexture() {
    const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  function makeOutlineOnlyTexture(sourceTexture) {
    const image = sourceTexture?.image;
    const width = image?.naturalWidth || image?.width;
    const height = image?.naturalHeight || image?.height;
    if (!width || !height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    let kept = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const alpha = pixels.data[i + 3];
      const isOutline = alpha > 0
        && pixels.data[i] <= PURE_BLACK_EPSILON
        && pixels.data[i + 1] <= PURE_BLACK_EPSILON
        && pixels.data[i + 2] <= PURE_BLACK_EPSILON;
      if (isOutline) {
        pixels.data[i] = 0;
        pixels.data[i + 1] = 0;
        pixels.data[i + 2] = 0;
        kept++;
      } else {
        pixels.data[i] = 0;
        pixels.data[i + 1] = 0;
        pixels.data[i + 2] = 0;
        pixels.data[i + 3] = 0;
      }
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    state.bankMaskPixels += kept;
    return texture;
  }

  function patchMaterial(material) {
    if (!material?.isShaderMaterial || material.userData?.waterBankOutlinePatched) return material;
    const fallback = transparentTexture();
    try {
      material.vertexShader = replaceRequired(
        material.vertexShader,
        '        attribute vec2 aFlow;\n',
        '        attribute vec2 aFlow;\n        attribute vec2 aStretchUv;\n',
        'vertex attribute',
      );
      material.vertexShader = replaceRequired(
        material.vertexShader,
        '        varying vec2 vUv;\n',
        '        varying vec2 vUv;\n        varying vec2 vBankUv;\n',
        'vertex varying',
      );
      material.vertexShader = replaceRequired(
        material.vertexShader,
        '          vUv = uv;\n',
        '          vUv = uv;\n          vBankUv = aStretchUv;\n',
        'vertex assignment',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '        uniform sampler2D uWaterTexture;\n',
        '        uniform sampler2D uWaterTexture;\n        uniform sampler2D uBankOutlineTexture;\n',
        'fragment sampler',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '        varying vec2 vUv;\n',
        '        varying vec2 vUv;\n        varying vec2 vBankUv;\n',
        'fragment varying',
      );
      material.fragmentShader = replaceRequired(
        material.fragmentShader,
        '          surfaceColor += flowSheen;\n          float alpha =',
        '          surfaceColor += flowSheen;\n\n          // Separate bank mask: only authored black edge pixels survive in this sampler.\n          // The base water UVs remain world-tiled and are never replaced by the protected-band mapping.\n          vec4 bankOutline = texture2D(uBankOutlineTexture, clamp(vBankUv, vec2(0.0), vec2(1.0)));\n          surfaceColor = mix(surfaceColor, vec3(0.0), clamp(bankOutline.a, 0.0, 1.0));\n\n          float alpha =',
        'fragment bank blend',
      );
    } catch (error) {
      fallback.dispose?.();
      state.shaderPatchFailures++;
      debugLog(`material patch skipped: ${error?.message || error}`, 'warn');
      return material;
    }

    material.uniforms.uBankOutlineTexture = { value: fallback };
    material.userData = Object.assign({}, material.userData || {}, {
      waterBankOutlinePatched: true,
      waterBankOutlineTextureUrl: BANK_SOURCE_TEXTURE_URL,
      waterBaseTextureUrl: BASE_WATER_TEXTURE_URL,
      waterBankOutlineOnly: true,
    });
    material.needsUpdate = true;
    state.materialPatches++;

    new THREE.TextureLoader().load(BANK_SOURCE_TEXTURE_URL, source => {
      try {
        const mask = makeOutlineOnlyTexture(source);
        source.dispose?.();
        if (!mask) throw new Error('canvas source had no usable image');
        const previous = material.uniforms.uBankOutlineTexture.value;
        material.uniforms.uBankOutlineTexture.value = mask;
        material.needsUpdate = true;
        if (previous && previous !== mask) previous.dispose?.();
      } catch (error) {
        debugLog(`bank-outline mask conversion failed: ${error?.message || error}`, 'warn');
      }
    }, undefined, error => debugLog(`bank-outline texture load failed: ${error?.message || error}`, 'warn'));

    return material;
  }

  function rebuiltTiledUv(position, textureTileSize) {
    const tileSize = Math.max(0.001, Number(textureTileSize) || Number(renderer?.DEFAULT_TEXTURE_TILE_SIZE) || 4);
    const uv = new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2);
    for (let index = 0; index < position.count; index++) uv.setXY(index, position.getX(index) / tileSize, position.getZ(index) / tileSize);
    return uv;
  }

  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

  function unframeCoordinate(value, sourceEdge, surfaceEdge) {
    const t = clamp01(value);
    if (t <= sourceEdge) return (t / sourceEdge) * surfaceEdge;
    if (t >= 1 - sourceEdge) return 1 - surfaceEdge + ((t - (1 - sourceEdge)) / sourceEdge) * surfaceEdge;
    return surfaceEdge + ((t - sourceEdge) / (1 - sourceEdge * 2)) * (1 - surfaceEdge * 2);
  }

  function frameCoordinate(value, sourceEdge, surfaceEdge) {
    const t = clamp01(value);
    if (t <= surfaceEdge) return (t / surfaceEdge) * sourceEdge;
    if (t >= 1 - surfaceEdge) return 1 - sourceEdge + ((t - (1 - surfaceEdge)) / surfaceEdge) * sourceEdge;
    return sourceEdge + ((t - surfaceEdge) / (1 - surfaceEdge * 2)) * (1 - sourceEdge * 2);
  }

  function retuneBankFrame(geometry, uv) {
    const report = geometry?.userData?.hobunjiSurfacePerimeterFrame || {};
    const oldSource = Math.max(0.001, Math.min(0.49, Number(report.sourceEdgeFraction) || DEFAULT_LEGACY_SOURCE_EDGE));
    const oldSurface = Math.max(0.001, Math.min(0.49, Number(report.surfaceEdgeFraction) || DEFAULT_LEGACY_SURFACE_EDGE));
    const nextSource = configuredSourceEdge();
    if (Math.abs(oldSource - nextSource) <= 1e-6 || !uv) return uv;
    for (let index = 0; index < uv.count; index++) {
      const rawU = unframeCoordinate(uv.getX(index), oldSource, oldSurface);
      const rawV = unframeCoordinate(uv.getY(index), oldSource, oldSurface);
      uv.setXY(index, frameCoordinate(rawU, nextSource, oldSurface), frameCoordinate(rawV, nextSource, oldSurface));
    }
    uv.needsUpdate = true;
    state.genericFrameRetunes++;
    return uv;
  }

  function fitBankUvs(sourceGeometry, options = {}) {
    if (!sourceGeometry?.getAttribute?.('position')) return sourceGeometry;
    const expanded = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
    const position = expanded.getAttribute('position');
    const tiledUv = expanded.getAttribute('uv')?.clone() || null;
    const originalPositions = position?.array?.slice?.() || null;
    if (!position || !originalPositions) {
      expanded.dispose?.();
      return sourceGeometry;
    }

    for (let index = 0; index < position.count; index++) position.setY(index, 0);
    position.needsUpdate = true;
    const splitAngleDeg = Number(mapper.settings?.angleToleranceDeg) || DEFAULT_SPLIT_ANGLE_DEG;
    const label = `${options.name || options.statKey || 'merged-water'}:bank-outline`;
    let mapped;
    try { mapped = mapper.mapGeometry(expanded, { angleToleranceDeg: splitAngleDeg, label }); }
    catch (error) {
      state.mapperFallbacks++;
      debugLog(`${label}: mapping failed (${error?.message || error}); bank outline skipped.`, 'warn');
      expanded.dispose?.();
      return sourceGeometry;
    }
    const mappedPosition = mapped?.getAttribute?.('position');
    const fittedUv = retuneBankFrame(mapped, mapped?.getAttribute?.('uv'));
    if (!mappedPosition || !fittedUv || mappedPosition.count !== originalPositions.length / 3 || fittedUv.count !== mappedPosition.count) {
      state.mapperFallbacks++;
      if (mapped && mapped !== expanded && mapped !== sourceGeometry) mapped.dispose?.();
      expanded.dispose?.();
      return sourceGeometry;
    }

    for (let index = 0; index < mappedPosition.count; index++) {
      const base = index * 3;
      mappedPosition.setXYZ(index, originalPositions[base], originalPositions[base + 1], originalPositions[base + 2]);
    }
    mappedPosition.needsUpdate = true;
    mapped.setAttribute('aStretchUv', fittedUv.clone());
    if (tiledUv?.count === mappedPosition.count) mapped.setAttribute('uv', tiledUv);
    else mapped.setAttribute('uv', rebuiltTiledUv(mappedPosition, options.textureTileSize));
    mapped.computeVertexNormals?.();
    mapped.computeBoundingBox?.();
    mapped.computeBoundingSphere?.();
    mapped.userData = Object.assign({}, mapped.userData || {}, {
      waterBankOutline: {
        mapper: 'HobunjiSurfaceStretchUV',
        flattenedForConnectivity: true,
        splitAngleDeg,
        baseUvMode: 'world-tiled-untouched',
        bankUvAttribute: 'aStretchUv',
        sourceEdgeFraction: configuredSourceEdge(),
      },
    });
    if (mapped !== expanded) expanded.dispose?.();
    return mapped;
  }

  function installOnRenderer(candidate) {
    state.rendererInstallAttempts++;
    if (!candidate?.createMaterial || !candidate?.createMesh) return false;
    renderer = candidate;
    if (candidate.__waterBankOutlineInstalled) {
      state.rendererInstalled = true;
      return true;
    }

    const originalCreateMaterial = candidate.createMaterial;
    candidate.createMaterial = function (ThreeArg, options = {}) {
      const nextOptions = Object.assign({}, options, { textureUrl: BASE_WATER_TEXTURE_URL });
      return patchMaterial(originalCreateMaterial.call(this, ThreeArg, nextOptions));
    };
    candidate.createMaterial.__waterBankOutlineOriginal = originalCreateMaterial;

    const originalCreateMesh = candidate.createMesh;
    candidate.createMesh = function (ThreeArg, material, cells, options = {}) {
      const mesh = originalCreateMesh.call(this, ThreeArg, material, cells, options);
      if (!mesh?.geometry || !material?.userData?.waterBankOutlinePatched) return mesh;
      const sourceGeometry = mesh.geometry;
      const fitted = fitBankUvs(sourceGeometry, options);
      if (fitted !== sourceGeometry) {
        mesh.geometry = fitted;
        sourceGeometry.dispose?.();
      }
      if (mesh.geometry?.getAttribute?.('aStretchUv')) {
        state.fittedMeshes++;
        state.fittedVertices += Number(mesh.geometry.getAttribute('position')?.count || 0);
        const key = mesh.userData?.mergedWaterStatKey || options.statKey || mesh.name || 'water';
        state.recent.push({ key, base: 'wavy_surface.png', overlay: 'outline-only', sourceEdgeFraction: configuredSourceEdge() });
        while (state.recent.length > DEBUG_HISTORY_LIMIT) state.recent.shift();
      }
      return mesh;
    };
    candidate.createMesh.__waterBankOutlineOriginal = originalCreateMesh;
    candidate.__waterBankOutlineInstalled = true;
    state.rendererInstalled = true;
    debugLog('water renderer hooked: wavy_surface.png stays world-tiled; protected UVs drive only the transparent bank-outline mask.');
    return true;
  }

  function installLateRendererHook() {
    if (installOnRenderer(window.MergedWaterRenderer)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'MergedWaterRenderer');
    if (descriptor && descriptor.configurable === false) {
      window.addEventListener?.('load', () => installOnRenderer(window.MergedWaterRenderer), { once: true });
      return;
    }
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    let value = oldGet ? oldGet.call(window) : descriptor?.value;
    Object.defineProperty(window, 'MergedWaterRenderer', {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return oldGet ? oldGet.call(window) : value; },
      set(next) {
        if (oldSet) {
          oldSet.call(window, next);
          value = oldGet ? oldGet.call(window) : next;
        } else value = next;
        installOnRenderer(value);
      },
    });
    state.lateHookInstalled = true;
  }

  window.WaterCanvasStretchOverlay = {
    installed: true,
    baseTextureUrl: BASE_WATER_TEXTURE_URL,
    bankSourceTextureUrl: BANK_SOURCE_TEXTURE_URL,
    fitStretchUvs: fitBankUvs,
    fitBankUvs,
    patchMaterial,
    installOnRenderer,
    snapshot() { return Object.assign({}, state, { recent: state.recent.slice() }); },
  };

  installLateRendererHook();
})();
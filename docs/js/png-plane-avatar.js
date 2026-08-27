// Shared PNG-to-single-plane avatar assembly for rough HTML demos.
// This reuses the single-plane mode from docs/references/(HA)PNGtoGLBV1.html,
// but returns live Three.js objects instead of exporting GLB files.
(function () {
  'use strict';

  function cfg() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
  }

  function drawVariantCanvas(targetCanvas, image, options = {}) {
    if (!targetCanvas || !image) return null;
    const flipX = !!options.flipX;
    const blackSilhouette = !!options.blackSilhouette;
    const width = image.naturalWidth || image.videoWidth || image.width;
    const height = image.naturalHeight || image.videoHeight || image.height;
    targetCanvas.width = width;
    targetCanvas.height = height;
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.save();
    if (flipX) {
      ctx.translate(targetCanvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(image, 0, 0, targetCanvas.width, targetCanvas.height);
    ctx.restore();
    if (blackSilhouette) {
      const imgData = ctx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    return targetCanvas;
  }

  function makeVariantCanvas(image, options = {}) {
    return drawVariantCanvas(document.createElement('canvas'), image, options);
  }

  // The plane is only a carrier for the authored character PNG composite.
  // The actual source of truth lives with the sprite PNG/tint pipeline in
  // portrait-utils.js so same-style PNGs used on 3D surfaces share it too.
  const spritePngSurface = window.HobunjiSpritePngSurface;

  function makeTextureFromCanvas(THREE, canvasEl, debugName) {
    if (spritePngSurface?.makeCanvasTexture) {
      return spritePngSurface.makeCanvasTexture(THREE, canvasEl, debugName);
    }
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.name = debugName;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function makeSpriteMaterial(THREE, texture, debugName) {
    if (spritePngSurface?.makeMaterial) {
      return spritePngSurface.makeMaterial(THREE, texture, debugName);
    }
    return new THREE.MeshBasicMaterial({
      name: debugName, map: texture, transparent: true,
      alphaTest: cfg().alphaTest ?? 0.001, side: THREE.FrontSide,
      depthTest: true, depthWrite: true, opacity: 1,
    });
  }

  // Compatibility alias for older callers; this is now literally the sprite
  // PNG surface API rather than an independently maintained plane-only copy.
  window.HobunjiPngPlaneUnlit = spritePngSurface || window.HobunjiPngPlaneUnlit;

  function buildTextureSet(THREE, image, backImage) {
    const rearSource = backImage || image;
    const rearOptions = backImage ? { flipX: true } : { flipX: true, blackSilhouette: true };
    return {
      frontOriginal: makeTextureFromCanvas(THREE, makeVariantCanvas(image), 'npc_avatar_front_texture'),
      backForOriginal: makeTextureFromCanvas(THREE, makeVariantCanvas(rearSource, rearOptions), backImage ? 'npc_avatar_back_assembled_texture' : 'npc_avatar_back_silhouette_texture'),
    };
  }


  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const g = String(value || '').trim().toLowerCase();
    return g === 'female' || g === 'f' ? 'female' : 'male';
  }

  function configuredParentSpecies(species) {
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {};
    return normalizeKey(speciesConfig[species]?.parentSpecies);
  }

  function placementSpeciesChain(species) {
    const chain = [];
    const seen = new Set();
    let current = normalizeKey(species);
    while (current && !seen.has(current)) {
      chain.push(current);
      seen.add(current);
      current = configuredParentSpecies(current);
    }
    return chain;
  }


  function sourceForAvatarOptions(options = {}) {
    return options.appearance || options.npcRecord?.appearance || options.profile?.appearance || options.profile?.fighter || {};
  }

  function avatarSpeciesAndGender(options = {}) {
    const source = sourceForAvatarOptions(options);
    return {
      species: normalizeKey(options.speciesId || source.speciesId || source.species || options.profile?.fighter?.speciesId),
      gender: normalizeGender(options.gender || source.gender || options.profile?.fighter?.gender),
    };
  }

  function configuredChildMarkers() {
    const markers = cfg().childMarkers || {};
    return {
      roles: new Set((markers.roles || []).map(normalizeKey).filter(Boolean)),
      tags: new Set((markers.tags || []).map(normalizeKey).filter(Boolean)),
    };
  }

  function isChildAvatar(options = {}) {
    const record = options.npcRecord || options.profile?.npcRecord || {};
    const markers = configuredChildMarkers();
    const role = normalizeKey(record.role || options.role);
    if (role && markers.roles.has(role)) return true;
    const tags = Array.isArray(record.tags) ? record.tags : Array.isArray(options.tags) ? options.tags : [];
    return tags.some(tag => markers.tags.has(normalizeKey(tag)));
  }

  function avatarScaleMultiplierFor(options = {}) {
    const { species, gender } = avatarSpeciesAndGender(options);
    const scaleBySpecies = cfg().portraitScaleBySpecies || {};
    let scale = 1;
    for (const speciesKey of placementSpeciesChain(species)) {
      if (Object.prototype.hasOwnProperty.call(scaleBySpecies, speciesKey)) {
        const configuredScale = scaleBySpecies[speciesKey]; // Supports legacy species numbers and new species/gender profile maps.
        const speciesScale = Number(configuredScale && typeof configuredScale === 'object'
          ? configuredScale[gender] ?? configuredScale.default
          : configuredScale);
        if (Number.isFinite(speciesScale) && speciesScale > 0) {
          scale = speciesScale;
          break;
        }
      }
    }
    if (isChildAvatar(options)) {
      const childScale = Number(cfg().childScaleMultiplier);
      if (Number.isFinite(childScale) && childScale > 0) scale *= childScale;
    }
    return scale;
  }

  function avatarPlacementRatioFor(options = {}) {
    const placement = cfg().portraitVerticalPlacement || {};
    const defaultRatio = Number.isFinite(Number(placement.default)) ? Number(placement.default) : 0.5;
    const { species, gender } = avatarSpeciesAndGender(options);
    for (const speciesKey of placementSpeciesChain(species)) {
      const speciesPlacement = placement[speciesKey];
      if (speciesPlacement && Object.prototype.hasOwnProperty.call(speciesPlacement, gender)) {
        const ratio = Number(speciesPlacement[gender]);
        if (Number.isFinite(ratio)) return ratio;
      }
    }
    return defaultRatio;
  }

  // Finds the topmost and bottommost opaque pixel rows actually present in the
  // canvas. Used instead of the configured portraitVerticalPlacementRatio (which
  // encodes per-species/gender padding and scale quirks tuned for a different
  // purpose — grounding the plane in world space) so the hand-height row below is
  // measured straight from the real rendered art, not inferred from that config.
  // Returns null if the canvas has no opaque pixels (or is unreadable, e.g.
  // tainted by a cross-origin image).
  function scanOpaqueVerticalBounds(canvas, alphaThreshold) {
    const w = canvas?.width, h = canvas?.height;
    if (!canvas || !w || !h) return null;
    const threshold = alphaThreshold ?? 8;
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const data = ctx.getImageData(0, 0, w, h).data;
      let top = -1, bottom = -1;
      for (let y = 0; y < h; y++) {
        const rowOffset = y * w * 4;
        for (let x = 0; x < w; x++) {
          if (data[rowOffset + x * 4 + 3] > threshold) {
            if (top === -1) top = y;
            bottom = y;
            break;
          }
        }
      }
      return top === -1 ? null : { top, bottom };
    } catch (e) {
      return null;
    }
  }

  // Scans a single canvas row from the left edge rightward for the first
  // non-transparent pixel — the right-arm sprite's outer edge at that height.
  // Returns the column index, or null if the row has no opaque pixels (or the
  // canvas is unreadable).
  function scanRowFirstOpaqueColumn(canvas, row, alphaThreshold) {
    const w = canvas?.width, h = canvas?.height;
    if (!canvas || !w || !h) return null;
    const clampedRow = Math.min(h - 1, Math.max(0, row));
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const data = ctx.getImageData(0, clampedRow, w, 1).data;
      const threshold = alphaThreshold ?? 8;
      for (let x = 0; x < w; x++) {
        if (data[x * 4 + 3] > threshold) return x;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // Public entry point for scanning a loaded (or already-decoded) image
  // directly, for callers that only have a raw <img> — e.g. animal/creature
  // avatars (buildAnimalPlaneAvatarModel), which unlike the NPC/character
  // portrait pipeline never draw their sprite to a canvas first. Draws it to
  // a scratch canvas and reuses scanOpaqueVerticalBounds above, so a sprite
  // with transparent padding around the art still reports where the actual
  // opaque pixels are instead of the raw image's full pixel bounds.
  function scanOpaqueVerticalBoundsOfImage(image, alphaThreshold) {
    if (!image || !(image.naturalWidth || image.width)) return null;
    return scanOpaqueVerticalBounds(makeVariantCanvas(image), alphaThreshold);
  }

  // Reads a canvas into an alpha mask with full bounds and centroid data.
  // This is used only to locate portrait landmarks such as the neck pivot.
  // Skin geometry deliberately ignores opacity and always covers the complete
  // rectangular PNG plane, so detached cosmetics and transparent gaps remain
  // part of the same continuously weighted surface.
  function scanOpaquePixelMask(canvas, alphaThreshold, additionalCanvas) {
    const width = canvas?.width, height = canvas?.height;
    if (!canvas || !width || !height) return null;
    const threshold = alphaThreshold ?? 12;
    let data;
    try {
      data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
      if (additionalCanvas?.getContext && additionalCanvas.width === width && additionalCanvas.height === height) {
        const additionalData = additionalCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
        const unionData = new Uint8ClampedArray(data); // Used below so rear-only opaque pixels survive front-mask cell culling.
        for (let offset = 3; offset < unionData.length; offset += 4) unionData[offset] = Math.max(unionData[offset], additionalData[offset]);
        data = unionData;
      }
    }
    catch (error) { return null; }
    const rowCounts = new Uint32Array(height);
    let top = height, bottom = -1, left = width, right = -1;
    let weightedX = 0, weightedY = 0, totalAlpha = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha <= threshold) continue;
        rowCounts[y]++;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
        weightedX += x * alpha;
        weightedY += y * alpha;
        totalAlpha += alpha;
      }
    }
    if (bottom < 0 || totalAlpha <= 0) return null;
    return {
      width, height, data, rowCounts, top, bottom, left, right, alphaThreshold: threshold,
      centroidPx: { x: weightedX / totalAlpha, y: weightedY / totalAlpha },
    };
  }

  // Finds the neck pivot pixel for a head-turn bone: the horizontal centroid
  // (alpha-weighted, so a slightly off-center head silhouette still gets an
  // accurate hinge point) of the lowest coherent run of opaque pixels — i.e.
  // where the head art visually meets the body/collar below it. Mirrors
  // docs/tools/animation-author/index.html's detectNeckAndEyePixels, trimmed
  // to just the pivot (no eye-target point — gameplay head-turns don't need
  // one). Returns null if the canvas has no readable opaque pixels.
  function detectNeckPivotPx(canvas, alphaThreshold, neckHeightFraction) {
    const w = canvas?.width, h = canvas?.height;
    if (!canvas || !w || !h) return null;
    const threshold = alphaThreshold ?? 12;
    let data;
    try { data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data; }
    catch (e) { return null; }
    const rowCounts = new Uint32Array(h);
    let top = h, bottom = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] <= threshold) continue;
        rowCounts[y]++;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (bottom < 0) return null;
    const minimumRowPixels = Math.max(2, Math.round(w * .012));
    while (bottom > top && rowCounts[bottom] < minimumRowPixels) bottom--;
    // The neck sits near the TOP of the figure (the head/shoulders
    // boundary), not its bottom edge — "bottommost opaque row" is only
    // correct for a bust/headshot crop that ends right at the neck. This
    // function's one caller (buildSkinnedSinglePlaneAssembly) instead feeds
    // it a FULL-BODY world-avatar sprite (feet included), where the
    // bottommost opaque row is the character's FEET — confirmed live: the
    // resulting neckLocal.y landed at -0.83 of a 0.9-unit-tall model, deep
    // in the legs, silently making the "head turn" pivot almost the entire
    // body from ground level instead of the head (basically invisible in
    // practice, since the skin-weight blend band sits right at the very
    // bottom edge with nothing below it to visibly hinge). Placing the
    // pivot a fixed fraction of the total opaque height down from the TOP
    // instead — ~13%, a standard human head-height proportion (head ≈
    // 1/7.5 of total height) — lands much closer to the actual neck.
    const totalHeight = Math.max(1, bottom - top);
    const fraction = Number.isFinite(neckHeightFraction) ? neckHeightFraction : 0.13;
    const neckY = Math.min(bottom, Math.round(top + totalHeight * fraction));
    const bandHalf = Math.max(1, Math.round(h * .015));
    const bandTop = Math.max(top, neckY - bandHalf), bandBottom = Math.min(bottom, neckY + bandHalf);
    let weightedX = 0, totalWeight = 0;
    for (let y = bandTop; y <= bandBottom; y++) {
      for (let x = 0; x < w; x++) {
        const alpha = data[(y * w + x) * 4 + 3];
        if (alpha <= threshold) continue;
        weightedX += x * alpha;
        totalWeight += alpha;
      }
    }
    return { x: totalWeight ? weightedX / totalWeight : w / 2, y: neckY + .5 };
  }

  // The optional head-only canvas is rendered from the fighter's base head
  // sprite. Its alpha centroid locates the actual visible head rather than
  // guessing from the full square portrait canvas; its coherent bottom edge
  // remains the physically useful rotation hinge at the neck.
  function detectHeadRigPixels(headCanvas, avatarCanvas, alphaThreshold) {
    const headMask = scanOpaquePixelMask(headCanvas, alphaThreshold);
    if (!headMask) {
      const fallbackPivot = detectNeckPivotPx(avatarCanvas, alphaThreshold);
      return fallbackPivot ? { pivotPx: fallbackPivot, centroidPx: { ...fallbackPivot }, boundsPx: null, method: 'full-avatar-fallback' } : null;
    }
    const minimumRowPixels = Math.max(2, Math.round(headMask.width * .012));
    let coherentBottom = headMask.bottom;
    while (coherentBottom > headMask.top && headMask.rowCounts[coherentBottom] < minimumRowPixels) coherentBottom--;
    return {
      pivotPx: { x: headMask.centroidPx.x, y: coherentBottom + .5 },
      centroidPx: { ...headMask.centroidPx },
      boundsPx: { top: headMask.top, bottom: coherentBottom, left: headMask.left, right: headMask.right },
      method: 'head-sprite-alpha-centroid',
    };
  }

  function smoothstep01(value) {
    const t = Math.max(0, Math.min(1, Number(value) || 0));
    return t * t * (3 - 2 * t);
  }

  // Builds the complete rectangular PNG plane as one two-sided SkinnedMesh.
  // Every grid vertex receives root/head weights regardless of the texel alpha
  // beneath it. Cosmetics, separated silhouettes, and transparent space are
  // therefore deformed by one coherent rig instead of becoming disconnected
  // alpha-shaped islands.
  function buildSkinnedPlaneGeometry(THREE, modelWidth, modelHeight, neckLocal, options = {}) {
    const segmentsX = Math.max(4, Math.round(Number(options.segmentsX) || 28));
    const segmentsY = Math.max(6, Math.round(Number(options.segmentsY) || 36));
    // A broad 30%-of-height falloff suits the painted cutout style better
    // than a narrow neck hinge: shoulders and upper torso share a diminishing
    // amount of head rotation instead of stopping abruptly at one rigid seam.
    const blendHeight = Math.max(modelHeight * .012, Number(options.blendHeight) || modelHeight * .30);
    const pixelWidth = Math.max(1, Number(options.pixelWidth) || 1); // Used below to map the overall PNG plane into model/UV space.
    const pixelHeight = Math.max(1, Number(options.pixelHeight) || 1); // Used below to map the overall PNG plane into model/UV space.
    const positions = [], normals = [], uvs = [], skinIndices = [], skinWeights = [];

    const toModelX = pixelX => -modelWidth / 2 + (pixelX / pixelWidth) * modelWidth;
    const toModelY = pixelY => modelHeight / 2 - (pixelY / pixelHeight) * modelHeight;
    const appendVertex = (pixelX, pixelY, normalZ) => {
      const x = toModelX(pixelX);
      const y = toModelY(pixelY);
      positions.push(x, y, 0);
      normals.push(0, 0, normalZ);
      uvs.push(pixelX / pixelWidth, 1 - pixelY / pixelHeight);
      const headWeight = smoothstep01((y - (neckLocal.y - blendHeight * .55)) / blendHeight);
      skinIndices.push(0, 1, 0, 0);
      skinWeights.push(1 - headWeight, headWeight, 0, 0);
    };

    const appendCell = ({ column, row }, normalZ) => {
      const x0 = column / segmentsX * pixelWidth;
      const x1 = (column + 1) / segmentsX * pixelWidth;
      const y0 = row / segmentsY * pixelHeight;
      const y1 = (row + 1) / segmentsY * pixelHeight;
      const front = [[x0, y1], [x1, y1], [x0, y0], [x1, y1], [x1, y0], [x0, y0]];
      const vertices = normalZ > 0 ? front : [...front].reverse();
      for (const [pixelX, pixelY] of vertices) appendVertex(pixelX, pixelY, normalZ);
    };
    for (let row = 0; row < segmentsY; row++) {
      for (let column = 0; column < segmentsX; column++) appendCell({ column, row }, 1);
    }
    const frontVertexCount = positions.length / 3;
    for (let row = 0; row < segmentsY; row++) {
      for (let column = 0; column < segmentsX; column++) appendCell({ column, row }, -1);
    }

    if (!frontVertexCount) {
      return null;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.name = 'npc_avatar_skinned_plane_geometry';
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.addGroup(0, frontVertexCount, 0);
    geometry.addGroup(frontVertexCount, frontVertexCount, 1);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = {
      segmentsX, segmentsY, blendHeight, neckLocal: { ...neckLocal },
      coverageMode: 'full-png-plane',
      planeBoundsPx: { left: 0, right: pixelWidth, top: 0, bottom: pixelHeight },
      planeCellCount: segmentsX * segmentsY,
    };
    return geometry;
  }

  // Builds the neck-rigged variant of the single-plane assembly: a
  // THREE.SkinnedMesh (root bone + neck bone) instead of the two rigid front/
  // back Mesh objects createSinglePlaneAssembly makes, so `neckJoint.rotation`
  // can bend just the head region of the plane. Returns null if no neck pivot
  // could be detected (e.g. an unreadable/tainted canvas) — callers should
  // fall back to the plain rigid assembly in that case.
  function buildSkinnedSinglePlaneAssembly(THREE, config) {
    const detectedHead = detectHeadRigPixels(config.headCanvas, config.sourceCanvas, config.alphaThreshold);
    if (!detectedHead) return null;
    const { pivotPx, centroidPx: headCentroidPx } = detectedHead;
    const { planeWidth: modelWidth, planeHeight: modelHeight, anchorZ, textures } = config;
    const pxW = config.sourceCanvas.width, pxH = config.sourceCanvas.height;
    // Keep the pivot in the skinned plane's own coordinates, matching the
    // working Multi-Avatar Animation Author rig. The assembly group applies
    // assemblyY later to both mesh and bone; subtracting it here a second
    // time pushed high-placement species' neck bones deep into their torsos.
    const neckLocal = {
      x: -modelWidth / 2 + (pivotPx.x / pxW) * modelWidth,
      y: modelHeight / 2 - (pivotPx.y / pxH) * modelHeight,
      z: 0,
    };
    const headCentroidLocal = {
      x: -modelWidth / 2 + (headCentroidPx.x / pxW) * modelWidth,
      y: modelHeight / 2 - (headCentroidPx.y / pxH) * modelHeight,
      z: 0,
    };
    const geometry = buildSkinnedPlaneGeometry(THREE, modelWidth, modelHeight, neckLocal, {
      pixelWidth: pxW,
      pixelHeight: pxH,
    });
    if (!geometry) return null;
    const frontMaterial = makeSpriteMaterial(THREE, textures.frontOriginal, 'npc_avatar_skinned_front_material');
    const backMaterial = makeSpriteMaterial(THREE, textures.backForOriginal, 'npc_avatar_skinned_back_material');
    // The game and Attack Animation Editor still use Three.js r128, where
    // SkinnedMesh alone does not enable USE_SKINNING in the material shader.
    // The CPU probe path always applies bones, which is why its dots moved
    // while the portrait stayed rigid. r165 infers this from isSkinnedMesh;
    // retaining the explicit flag is harmless there and keeps both paths live.
    frontMaterial.skinning = true;
    backMaterial.skinning = true;

    const torsoBone = new THREE.Bone();
    torsoBone.name = `${config.name}_torso_bone`;
    const neckJoint = new THREE.Bone();
    neckJoint.name = `${config.name}_neck_bone`;
    neckJoint.position.set(neckLocal.x, neckLocal.y, neckLocal.z);
    torsoBone.add(neckJoint);

    const skinnedPlane = new THREE.SkinnedMesh(geometry, [frontMaterial, backMaterial]);
    skinnedPlane.name = config.name || 'npc_avatar_skinned_plane_assembly';
    skinnedPlane.position.z = anchorZ;
    skinnedPlane.renderOrder = 2;
    skinnedPlane.frustumCulled = false;
    skinnedPlane.add(torsoBone);
    const skeleton = new THREE.Skeleton([torsoBone, neckJoint]);
    skinnedPlane.bind(skeleton);

    const group = new THREE.Group();
    group.name = config.name || 'npc_avatar_skinned_plane_assembly_group';
    group.add(skinnedPlane);
    return {
      group, neckJoint, torsoBone, skinnedPlane, skeleton, neckLocal, pivotPx,
      headCentroidPx, headCentroidLocal, headBoundsPx: detectedHead.boundsPx,
      detectionMethod: detectedHead.method, coverageMode: geometry.userData.coverageMode,
      planeBoundsPx: geometry.userData.planeBoundsPx,
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

  // Two-plane side-view avatar for animals.
  // The sprite is a side-on image (left edge = creature front/face).
  // frontMesh rotation.y = +PI/2 → visible from camera when group faces west (rotation.y = -PI/2).
  // backMesh  rotation.y = -PI/2 → visible from camera when group faces east (rotation.y = +PI/2).
  // Back texture is the same sprite UV-flipped horizontally; no runtime setFlipped() needed.
  // Returns { group, dispose() }.
  function buildAnimalPlaneAvatarModel(THREE, spriteUrl, options = {}) {
    if (!THREE) throw new Error('THREE is required.');
    if (!spriteUrl) throw new Error('A sprite URL is required.');
    const modelWidth  = options.modelWidth  ?? cfg().modelWidth ?? 1;
    const modelHeight = options.modelHeight ?? modelWidth;

    const loader = new THREE.TextureLoader();

    const frontTex = loader.load(spriteUrl);
    frontTex.colorSpace = THREE.SRGBColorSpace;

    const backTex = loader.load(spriteUrl);
    backTex.colorSpace = THREE.SRGBColorSpace;
    backTex.wrapS = THREE.RepeatWrapping;
    backTex.repeat.set(-1, 1);
    backTex.offset.set(1, 0);

    // See makeSpriteMaterial above for why depthWrite is true here.
    const matOpts = { transparent: true, alphaTest: cfg().alphaTest ?? 0.001, side: THREE.FrontSide, depthWrite: true };
    const frontMat = new THREE.MeshBasicMaterial({ ...matOpts, name: 'animal_front_mat', map: frontTex });
    const backMat  = new THREE.MeshBasicMaterial({ ...matOpts, name: 'animal_back_mat',  map: backTex  });

    const frontGeo = new THREE.PlaneGeometry(modelWidth, modelHeight);
    const backGeo  = frontGeo.clone();

    const frontMesh = new THREE.Mesh(frontGeo, frontMat);
    // The cards face opposite directions but occupy the same geometric plane.
    // Give them a microscopic separation along the shared plane normal so
    // depth testing cannot alternate between the two materials as the camera
    // or parent yaw changes. This is intentionally far below one world pixel.
    const faceSeparation = Number.isFinite(Number(options.faceSeparation))
      ? Math.max(0, Number(options.faceSeparation))
      : 0.0008; // Used below as a stable anti-z-fighting offset in group-local X.
    frontMesh.position.x = faceSeparation;
    frontMesh.rotation.y = Math.PI / 2;
    frontMesh.renderOrder = 2;
    frontMesh.name = (options.name || 'animal') + '_front_plane';

    const backMesh = new THREE.Mesh(backGeo, backMat);
    backMesh.position.x = -faceSeparation;
    backMesh.rotation.y = -Math.PI / 2;
    backMesh.renderOrder = 2;
    backMesh.name = (options.name || 'animal') + '_back_plane';

    const group = new THREE.Group();
    group.name = (options.name || 'animal_plane') + '_group';
    group.add(frontMesh);
    group.add(backMesh);

    // Both rendered faces share one canonical local scale. Genotype size,
    // attack squash, and shoulder attachment transforms belong on the shared
    // group; leaving a face with an independent scale makes the pet visibly
    // change size when the camera reveals the opposite card.
    const planeScale = Object.freeze({ x: 1, y: 1, z: 1 }); // Authored local face scale used by both mirrored planes.
    const syncMirroredPlaneScale = () => {
      frontMesh.scale.set(planeScale.x, planeScale.y, planeScale.z);
      backMesh.scale.set(planeScale.x, planeScale.y, planeScale.z);
      return planeScale;
    };
    syncMirroredPlaneScale();

    // Shoulder-pet planes must use the already-computed camera-relative
    // deadzone yaw in world space. Applying only local Y rotation lets the
    // player/body attachment hierarchy leak its yaw into the cards and make
    // them appear to change width as the camera catches the opposite face.
    frontMesh.userData.hobunjiPlaneFace = 'front'; // Identifies the source-facing card after head-rig replacement.
    backMesh.userData.hobunjiPlaneFace = 'back'; // Identifies the reverse-facing card after head-rig replacement.
    const applyShoulderPetWorldYaw = function () {
      const plane = this;
      const owner = [...(window.Combat?.deps?.companionObjects || [])].find(companion =>
        companion?.avatarRef?.group === group && companion.stableRole === 'shoulderPet');
      if (!owner || !Number.isFinite(owner.pngRot) || !plane.parent?.getWorldQuaternion) return;
      const parentWorld = plane.parent.getWorldQuaternion(new THREE.Quaternion()); // World rotation inherited by this plane's parent.
      const faceYaw = plane.userData.hobunjiPlaneFace === 'front' ? Math.PI / 2 : -Math.PI / 2;
      const worldYaw = owner.pngRot + faceYaw;
      // Build the desired world orientation from explicit orthogonal axes:
      // local Y is always world-up, so crossing ±180° can never select an
      // equivalent quaternion with a 180° roll/upside-down presentation.
      const worldX = new THREE.Vector3(Math.cos(worldYaw), 0, -Math.sin(worldYaw));
      const worldY = new THREE.Vector3(0, 1, 0);
      const worldZ = new THREE.Vector3(Math.sin(worldYaw), 0, Math.cos(worldYaw));
      const desiredWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(worldX, worldY, worldZ));
      plane.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
      // onBeforeRender runs after the normal scene traversal has already
      // updated matrixWorld. Rebuild both matrices now so movement cannot
      // render one frame of the previous parent/plane orientation.
      plane.updateMatrix();
      plane.updateMatrixWorld(true);
      const worldElements = plane.matrixWorld.elements;
      plane.userData.hobunjiShoulderPetRenderDebug = {
        time: performance.now(),
        pngRot: owner.pngRot,
        parentWorldQuaternion: [parentWorld.x, parentWorld.y, parentWorld.z, parentWorld.w],
        desiredWorldQuaternion: [desiredWorld.x, desiredWorld.y, desiredWorld.z, desiredWorld.w],
        localQuaternion: [plane.quaternion.x, plane.quaternion.y, plane.quaternion.z, plane.quaternion.w],
        worldQuaternion: [plane.getWorldQuaternion(new THREE.Quaternion()).x, plane.getWorldQuaternion(new THREE.Quaternion()).y, plane.getWorldQuaternion(new THREE.Quaternion()).z, plane.getWorldQuaternion(new THREE.Quaternion()).w],
        worldUp: [worldElements[4], worldElements[5], worldElements[6]],
        worldNormal: [worldElements[8], worldElements[9], worldElements[10]],
      };
    };
    frontMesh.onBeforeRender = applyShoulderPetWorldYaw;
    backMesh.onBeforeRender = applyShoulderPetWorldYaw;

    return {
      group,
      frontPlane: frontMesh,
      backPlane: backMesh,
      planeScale,
      syncMirroredPlaneScale,
      dispose() {
        frontGeo.dispose();
        backGeo.dispose();
        frontMat.dispose();
        backMat.dispose();
        frontTex.dispose();
        backTex.dispose();
      },
    };
  }

  function buildSinglePlaneAvatarModel(THREE, sourceCanvas, options = {}) {
    if (!THREE) throw new Error('THREE is required to build an NPC plane avatar model.');
    if (!sourceCanvas) throw new Error('A source canvas or image is required to build an NPC plane avatar model.');
    const pxW = sourceCanvas.naturalWidth || sourceCanvas.width;
    const pxH = sourceCanvas.naturalHeight || sourceCanvas.height;
    const aspectHeight = pxH / Math.max(1, pxW);
    const scaleMultiplier = avatarScaleMultiplierFor(options);
    const baseModelWidth = options.modelWidth ?? cfg().modelWidth ?? 1;
    const baseModelHeight = options.modelHeight ?? baseModelWidth * aspectHeight;
    const modelWidth = baseModelWidth * scaleMultiplier;
    const modelHeight = baseModelHeight * scaleMultiplier;
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
    const placementRatio = avatarPlacementRatioFor({ ...options, profile: options.profile });
    const assemblyY = (placementRatio - 0.5) * modelHeight;
    // Neck rig is opt-in (options.neckRig === true) — most callers (world
    // livestock, bandits, one-off portrait previews) have no use for a
    // head-turn bone and building one costs an extra alpha scan + a heavier
    // SkinnedMesh over the plain two-Mesh assembly. Falls back to the plain
    // rigid assembly if no neck pivot could be detected (e.g. a fully
    // transparent or tainted source canvas).
    const skinnedRig = options.neckRig === true
      ? buildSkinnedSinglePlaneAssembly(THREE, {
          planeWidth: modelWidth, planeHeight: modelHeight, anchorZ, textures, assemblyY,
          sourceCanvas, backCanvas: options.backCanvas || options.backImage || null,
          headCanvas: options.headCanvas, alphaThreshold: options.neckAlphaThreshold,
          name: `${root.name}_skinned_plane_assembly`,
        })
      : null;
    const assembly = skinnedRig ? skinnedRig.group : createSinglePlaneAssembly(THREE, {
      planeWidth: modelWidth,
      planeHeight: modelHeight,
      anchorZ,
      textures,
      name: `${root.name}_single_plane_assembly`,
    });
    assembly.position.y = assemblyY;
    root.userData.neckRig = skinnedRig
      ? {
          available: true, neckJoint: skinnedRig.neckJoint, torsoBone: skinnedRig.torsoBone,
          skinnedPlane: skinnedRig.skinnedPlane, neckLocal: skinnedRig.neckLocal,
          pivotPx: skinnedRig.pivotPx, headCentroidPx: skinnedRig.headCentroidPx,
          headCentroidLocal: skinnedRig.headCentroidLocal, headBoundsPx: skinnedRig.headBoundsPx,
          detectionMethod: skinnedRig.detectionMethod, coverageMode: skinnedRig.coverageMode,
          planeBoundsPx: skinnedRig.planeBoundsPx,
        }
      : { available: false };
    root.userData.portraitVerticalPlacementRatio = placementRatio;
    root.userData.portraitScaleMultiplier = scaleMultiplier;
    root.userData.portraitModelWidth = modelWidth;
    root.userData.portraitModelHeight = modelHeight;
    // Hand/tool attach point: find the actual vertical midpoint of the rendered
    // avatar's opaque pixels (not a row inferred from portraitVerticalPlacementRatio,
    // which encodes per-species/gender padding tuned for plane-grounding, not hand
    // height), then scan that row from the left edge for the first opaque pixel —
    // the right-arm sprite's outer edge. Gives a per-species/gender-accurate X
    // instead of the coarse -modelWidth/2 guess.
    const handAlphaThreshold = cfg().handAttachAlphaThreshold;
    const vBounds = scanOpaqueVerticalBounds(sourceCanvas, handAlphaThreshold);
    const handRow = vBounds ? Math.round((vBounds.top + vBounds.bottom) / 2) : Math.round(placementRatio * pxH);
    const handAttachCol = scanRowFirstOpaqueColumn(sourceCanvas, handRow, handAlphaThreshold);
    root.userData.handAttachX = handAttachCol != null
      ? -modelWidth / 2 + (handAttachCol / pxW) * modelWidth
      : -modelWidth / 2;
    // Hand height was previously never computed here, so every caller fell back
    // to a hardcoded guess (e.g. the editor/game use half the prism height),
    // which lands at the avatar's vertical midpoint — shoulder height — for
    // every species. Use the portrait's own lowest opaque pixel (vBounds.bottom)
    // instead, converted through the same scale/offset already applied to the
    // assembly above: avatarGroup/rig sits at modelHeight/2, the plane assembly
    // inside it is offset by (placementRatio-0.5)*modelHeight, and within the
    // plane itself row r maps to modelHeight/2 - (r/pxH)*modelHeight — summing
    // those three terms gives modelHeight*(0.5 + placementRatio - r/pxH).
    const handAttachRowY = vBounds ? vBounds.bottom : Math.round(placementRatio * pxH);
    root.userData.handAttachY = modelHeight * (0.5 + placementRatio - handAttachRowY / pxH);
    root.add(assembly);
    root.userData.sourceCanvas = sourceCanvas;
    root.userData.backCanvas = options.backCanvas || options.backImage || null;
    root.userData.frontTexture = textures.frontOriginal;
    root.userData.backTexture = textures.backForOriginal;
    root.userData.backTextureUsesSilhouette = !(options.backCanvas || options.backImage);
    return root;
  }

  function refreshSinglePlaneAvatarModel(root, sourceCanvas, options = {}) {
    if (!root?.userData?.frontTexture) return false;
    const nextSource = sourceCanvas || root.userData.sourceCanvas;
    if (!nextSource) return false;
    root.userData.sourceCanvas = nextSource;
    drawVariantCanvas(root.userData.frontTexture.image, nextSource);
    root.userData.frontTexture.needsUpdate = true;

    const nextBack = options.backCanvas || options.backImage || root.userData.backCanvas;
    if (nextBack && root.userData.backTexture) {
      root.userData.backCanvas = nextBack;
      drawVariantCanvas(root.userData.backTexture.image, nextBack, { flipX: true });
      root.userData.backTexture.needsUpdate = true;
      root.userData.backTextureUsesSilhouette = false;
    } else if (options.refreshSilhouette && root.userData.backTexture && root.userData.backTextureUsesSilhouette) {
      drawVariantCanvas(root.userData.backTexture.image, nextSource, { flipX: true, blackSilhouette: true });
      root.userData.backTexture.needsUpdate = true;
    }
    return true;
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
    refreshSinglePlaneAvatarModel,
    buildAnimalPlaneAvatarModel,
    buildSinglePlaneAvatarModel,
    avatarPlacementRatioFor,
    avatarScaleMultiplierFor,
    isChildAvatar,
    disposeAvatarModel,
    loadThreeModules,
    scanOpaqueVerticalBoundsOfImage,
  };
})();

// Optional painted-weight head rig for side-view animal planes.
// Unrigged creatures keep the exact legacy two-plane path above.
(function () {
  'use strict';

  const STORAGE_KEY = 'hobunji_animal_head_rigs_v1'; // Shared with the Animal Head Rig Author for same-origin previews.
  const DEFAULT_LIMITS = Object.freeze({ minDeg: -30, maxDeg: 30, restDeg: 0, turnSpeedDeg: 120, meshResolution: 48 }); // Used when authored rig motion/detail values are omitted.
  const RAD = Math.PI / 180; // Converts authored degrees to Three.js radians.
  const UNSET_WEIGHT = 256; // Editor-only sentinel; runtime treats unpainted cells as full body influence (head weight 0).
  let cachedStorageRaw = null; // Avoids reparsing identical localStorage data for every creature spawn.
  let cachedStorageRigs = {}; // Parsed creature-id -> headRig map matching cachedStorageRaw.

  function finite(value, fallback) {
    const parsed = Number(value); // Rejects NaN/infinite values from hand-edited JSON.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value)); // Shared bound helper for coordinates, weights, and angles.
  }

  function decodeWeightMap(raw) {
    if (!raw || !Number.isFinite(Number(raw.width)) || !Number.isFinite(Number(raw.height))) return null;
    const width = Math.max(1, Math.round(Number(raw.width))); // Painted influence-grid width used by bilinear sampling.
    const height = Math.max(1, Math.round(Number(raw.height))); // Painted influence-grid height used by bilinear sampling.
    const total = width * height;
    const values = new Uint16Array(total); // 0..255 = head weight, 256 = author-unset/body fallback.
    values.fill(UNSET_WEIGHT);
    if (raw.encoding === 'rle-u9' && Array.isArray(raw.data)) {
      let cursor = 0;
      for (let i = 0; i + 1 < raw.data.length && cursor < total; i += 2) {
        const run = Math.max(0, Math.round(finite(raw.data[i], 0))); // Number of cells in this run.
        const value = clamp(Math.round(finite(raw.data[i + 1], UNSET_WEIGHT)), 0, UNSET_WEIGHT); // Stored cell head weight or unset sentinel.
        const end = Math.min(total, cursor + run);
        values.fill(value, cursor, end);
        cursor = end;
      }
    } else if (Array.isArray(raw.data)) {
      for (let i = 0; i < total && i < raw.data.length; i++) values[i] = clamp(Math.round(finite(raw.data[i], UNSET_WEIGHT)), 0, UNSET_WEIGHT);
    } else {
      return null;
    }
    return { width, height, values };
  }

  function normalizeAnimalHeadRig(raw) {
    if (!raw || raw.enabled === false || !raw.pivot) return null;
    const minRaw = finite(raw.minDeg, DEFAULT_LIMITS.minDeg); // Authored lower angle before sorting.
    const maxRaw = finite(raw.maxDeg, DEFAULT_LIMITS.maxDeg); // Authored upper angle before sorting.
    const minDeg = Math.min(minRaw, maxRaw); // Runtime-safe lower angle.
    const maxDeg = Math.max(minRaw, maxRaw); // Runtime-safe upper angle.
    const weightMap = decodeWeightMap(raw.weightMap); // Preferred painted deformation map.
    const legacyRegion = raw.region && finite(raw.region.width, 0) > 0 && finite(raw.region.height, 0) > 0
      ? {
          x: clamp(finite(raw.region.x, 0), 0, 1),
          y: clamp(finite(raw.region.y, 0), 0, 1),
          width: clamp(finite(raw.region.width, 0), 0, 1),
          height: clamp(finite(raw.region.height, 0), 0, 1),
        }
      : null; // Old square rigs remain previewable until re-authored as painted weights.
    if (!weightMap && !legacyRegion) return null;
    return {
      enabled: true,
      coordinateSpace: 'sprite-normalized-top-left',
      pivot: {
        x: clamp(finite(raw.pivot.x, 0.5), 0, 1),
        y: clamp(finite(raw.pivot.y, 0.5), 0, 1),
      },
      weightMap,
      legacyRegion,
      minDeg,
      maxDeg,
      restDeg: clamp(finite(raw.restDeg, DEFAULT_LIMITS.restDeg), minDeg, maxDeg),
      turnSpeedDeg: Math.max(0, finite(raw.turnSpeedDeg, DEFAULT_LIMITS.turnSpeedDeg)),
      meshResolution: clamp(Math.round(finite(raw.meshResolution, DEFAULT_LIMITS.meshResolution)), 12, 72),
    };
  }

  function readSavedAnimalHeadRigs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || ''; // Serialized browser-local preview rig map.
      if (raw === cachedStorageRaw) return cachedStorageRigs;
      const parsed = raw ? JSON.parse(raw) : {}; // Parsed creature-id -> rig lookup.
      cachedStorageRaw = raw;
      cachedStorageRigs = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      return cachedStorageRigs;
    } catch (_) {
      cachedStorageRaw = null;
      cachedStorageRigs = {};
      return cachedStorageRigs;
    }
  }

  function animalIdFromOptions(options) {
    const explicit = String(options?.creatureId || options?.animalId || '').trim(); // Preferred stable id supplied by future callers.
    if (explicit) return explicit;
    const name = String(options?.name || '').trim(); // Current game names animal groups `${creatureKey}_${uniqueId}`.
    return name ? name.split('_')[0] : '';
  }

  function resolveAnimalHeadRig(options) {
    const direct = options?.headRig || options?.animal?.headRig; // Direct caller rig takes highest precedence.
    if (direct) return normalizeAnimalHeadRig(direct);
    const animalId = animalIdFromOptions(options); // Stable key for configured/browser preview rigs.
    if (!animalId) return null;
    const configured = window.SCRATCHBONES_CONFIG?.game?.animalHeadRigs?.[animalId]; // Optional source-controlled rig map.
    if (configured) return normalizeAnimalHeadRig(configured);
    return normalizeAnimalHeadRig(readSavedAnimalHeadRigs()[animalId]);
  }

  function sampleWeight(rig, u, topV) {
    if (rig.weightMap) {
      const map = rig.weightMap; // Painted grid sampled bilinearly so a modest author grid still bends smoothly.
      const fx = clamp(u, 0, 1) * Math.max(0, map.width - 1);
      const fy = clamp(topV, 0, 1) * Math.max(0, map.height - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const at = (x, y) => {
        const value = map.values[y * map.width + x];
        return (value === UNSET_WEIGHT ? 0 : value) / 255;
      };
      const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
      const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      return clamp(a * (1 - ty) + b * ty, 0, 1);
    }
    const r = rig.legacyRegion; // Binary compatibility with the superseded square-selection rig format.
    if (!r) return 0;
    return u >= r.x && u <= r.x + r.width && topV >= r.y && topV <= r.y + r.height ? 1 : 0;
  }

  function buildAnimalWeightedGeometry(THREE, sourceGeometry, rig, mirrorX, fallbackDimensions = {}) {
    const params = sourceGeometry?.parameters || {}; // Legacy PlaneGeometry dimensions used to preserve exact animal scale.
    const width = finite(params.width, finite(fallbackDimensions.width, 1));
    const height = finite(params.height, finite(fallbackDimensions.height, 1));
    const mapAspect = rig.weightMap ? rig.weightMap.width / Math.max(1, rig.weightMap.height) : width / Math.max(0.0001, height);
    const maxSeg = rig.meshResolution; // Authored/runtime mesh detail cap used for the painted deformation surface.
    const segmentsX = mapAspect >= 1 ? maxSeg : Math.max(8, Math.round(maxSeg * mapAspect));
    const segmentsY = mapAspect >= 1 ? Math.max(8, Math.round(maxSeg / mapAspect)) : maxSeg;
    const geometry = new THREE.PlaneGeometry(width, height, segmentsX, segmentsY); // Dense enough for painted blend gradients without per-pixel geometry.
    const uv = geometry.getAttribute('uv');
    const skinIndices = new Uint16Array(uv.count * 4); // Root/head bone indices for every plane vertex.
    const skinWeights = new Float32Array(uv.count * 4); // Complementary body/head weights sampled from the paint map.
    for (let i = 0; i < uv.count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i); // Reverse-facing plane samples the horizontally mirrored authored map.
      const sourceTopV = 1 - uv.getY(i); // Author coordinates start at sprite top-left; Three UVs start bottom-left.
      const headWeight = sampleWeight(rig, sourceU, sourceTopV);
      const offset = i * 4;
      skinIndices[offset] = 0;
      skinIndices[offset + 1] = 1;
      skinWeights[offset] = 1 - headWeight;
      skinWeights[offset + 1] = headWeight;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.hobunjiAnimalWeightRig = { segmentsX, segmentsY }; // Visible to debug tooling without relying on console-only state.
    return geometry;
  }

  function upgradeAnimalPlaneToWeightedSkin(THREE, plane, rig, mirrorX, fallbackDimensions = {}) {
    if (!plane?.isMesh || !plane.geometry || !plane.material) return null;
    const weightedGeometry = buildAnimalWeightedGeometry(THREE, plane.geometry, rig, mirrorX, fallbackDimensions); // Replacement geometry carrying painted body/head weights.
    const material = plane.material; // Reuse the exact legacy material so animation/genotype map swaps and tint updates keep working unchanged.
    material.skinning = true;
    material.needsUpdate = true;

    const torsoBone = new THREE.Bone(); // Root/body bone stays at the plane origin.
    torsoBone.name = `${plane.name}_body_bone`;
    const headBone = new THREE.Bone(); // Head bone pivots painted head influence around the authored neck point.
    headBone.name = `${plane.name}_head_bone`;
    const pivotU = mirrorX ? 1 - rig.pivot.x : rig.pivot.x;
    const params = plane.geometry.parameters || {};
    const planeWidth = finite(params.width, finite(fallbackDimensions.width, 1)); // Keeps the mirrored head pivot in the same model dimensions when cloned geometry lacks parameters.
    const planeHeight = finite(params.height, finite(fallbackDimensions.height, 1)); // Matches the front card's authored height on the reverse card.
    headBone.position.set((pivotU - 0.5) * planeWidth, (0.5 - rig.pivot.y) * planeHeight, 0);
    torsoBone.add(headBone);

    const skinned = new THREE.SkinnedMesh(weightedGeometry, material); // Drop-in replacement: SkinnedMesh still satisfies Mesh checks used elsewhere.
    skinned.name = plane.name;
    skinned.position.copy(plane.position);
    skinned.rotation.copy(plane.rotation);
    skinned.scale.copy(plane.scale);
    skinned.renderOrder = plane.renderOrder;
    skinned.visible = plane.visible;
    skinned.frustumCulled = false; // Head rotation can move weighted vertices beyond the bind-pose plane bounds.
    skinned.userData = { ...plane.userData, hobunjiAnimalHeadRig: true };
    skinned.onBeforeRender = plane.onBeforeRender; // Preserve parent-independent shoulder-pet yaw on the rigged replacement mesh.
    skinned.add(torsoBone);
    const skeleton = new THREE.Skeleton([torsoBone, headBone]);
    skinned.bind(skeleton);
    return { mesh: skinned, weightedGeometry, skeleton, headBone };
  }

  function applyAnimalHeadRig(THREE, avatarRef, rig) {
    const group = avatarRef?.group; // Legacy return object exposes front/back animal planes here.
    if (!group || group.userData?.hobunjiAnimalHeadRig) return avatarRef;
    const frontPlane = group.children?.[0];
    const backPlane = group.children?.[1];
    if (!frontPlane || !backPlane) return avatarRef;

    const sourceParams = frontPlane.geometry?.parameters || backPlane.geometry?.parameters || {};
    const canonicalDimensions = {
      width: finite(sourceParams.width, 1),
      height: finite(sourceParams.height, 1),
    }; // One explicit dimension source prevents a cloned reverse card from falling back to PlaneGeometry's 1×1 default.
    const front = upgradeAnimalPlaneToWeightedSkin(THREE, frontPlane, rig, false, canonicalDimensions); // Source-facing painted skin.
    const back = upgradeAnimalPlaneToWeightedSkin(THREE, backPlane, rig, true, canonicalDimensions); // Mirrored reverse-facing painted skin.
    if (!front || !back) return avatarRef;

    group.remove(frontPlane);
    group.remove(backPlane);
    group.add(front.mesh);
    group.add(back.mesh);

    const legacyDispose = typeof avatarRef.dispose === 'function' ? avatarRef.dispose.bind(avatarRef) : null; // Preserves legacy texture/material/old-geometry cleanup.
    const state = { rig, frontHeadBone: front.headBone, backHeadBone: back.headBone, currentDeg: rig.restDeg, targetDeg: rig.restDeg }; // Runtime rotation state shared by immediate/smoothed setters.
    group.userData.hobunjiAnimalHeadRig = state;
    avatarRef.headRig = state;

    const applyDegrees = degrees => {
      front.headBone.rotation.z = degrees * RAD;
      back.headBone.rotation.z = -degrees * RAD;
    };
    applyDegrees(rig.restDeg);

    avatarRef.setHeadRotation = degrees => {
      const target = clamp(finite(degrees, rig.restDeg), rig.minDeg, rig.maxDeg); // Immediate clamped head angle used by explicit animation/AI calls.
      state.currentDeg = target;
      state.targetDeg = target;
      applyDegrees(target);
      return target;
    };

    avatarRef.updateHeadRotation = (degrees, deltaSeconds) => {
      const target = clamp(finite(degrees, rig.restDeg), rig.minDeg, rig.maxDeg); // Smoothed target used by normal creature behavior.
      const delta = Math.max(0, finite(deltaSeconds, 0));
      const step = rig.turnSpeedDeg * delta; // Maximum authored turn distance this frame.
      const diff = target - state.currentDeg;
      state.currentDeg += clamp(diff, -step, step);
      state.targetDeg = target;
      applyDegrees(state.currentDeg);
      return state.currentDeg;
    };

    avatarRef.dispose = () => {
      front.weightedGeometry.dispose();
      back.weightedGeometry.dispose();
      front.skeleton.dispose?.();
      back.skeleton.dispose?.();
      if (legacyDispose) legacyDispose();
    };
    return avatarRef;
  }

  function installAnimalHeadRigRuntime() {
    const api = window.PNGPlaneAvatar; // Base renderer defined immediately above this extension.
    if (!api?.buildAnimalPlaneAvatarModel || api.__animalHeadRigInstalled) return false;
    const originalBuild = api.buildAnimalPlaneAvatarModel.bind(api); // Old two-plane builder remains the source of textures/materials/orientation.
    api.buildAnimalPlaneAvatarModel = function patchedAnimalPlaneAvatarModel(THREE, spriteUrl, options = {}) {
      const avatarRef = originalBuild(THREE, spriteUrl, options);
      const rig = resolveAnimalHeadRig(options);
      return rig ? applyAnimalHeadRig(THREE, avatarRef, rig) : avatarRef;
    };
    api.__animalHeadRigInstalled = true;
    return true;
  }

  window.AnimalHeadRigRuntime = {
    STORAGE_KEY,
    UNSET_WEIGHT,
    normalizeRig: normalizeAnimalHeadRig,
    readSavedRigs: readSavedAnimalHeadRigs,
    resolveRig: resolveAnimalHeadRig,
    applyRigToAvatar: applyAnimalHeadRig,
    install: installAnimalHeadRigRuntime,
  };

  installAnimalHeadRigRuntime();
})();

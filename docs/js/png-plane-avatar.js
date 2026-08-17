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
      // alphaTest already discards fully-transparent texels, so the opaque
      // sprite silhouette can safely write depth — without this, the depth
      // buffer behind the sprite still holds whatever was rendered before it
      // (e.g. a building wall), so later passes that re-test depth (like the
      // shell outline pass) draw straight through the sprite as if it weren't
      // there.
      depthWrite: true,
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
    const { species } = avatarSpeciesAndGender(options);
    const scaleBySpecies = cfg().portraitScaleBySpecies || {};
    let scale = 1;
    for (const speciesKey of placementSpeciesChain(species)) {
      if (Object.prototype.hasOwnProperty.call(scaleBySpecies, speciesKey)) {
        const speciesScale = Number(scaleBySpecies[speciesKey]);
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

  function smoothstep01(value) {
    const t = Math.max(0, Math.min(1, Number(value) || 0));
    return t * t * (3 - 2 * t);
  }

  // Builds a two-sided front+back plane as one THREE.SkinnedMesh instead of
  // two rigid Mesh objects, with per-vertex skin weights blended (via a
  // smoothstep band, no visible hinge) between a root bone and a neck bone
  // seated at `neckLocal`. Ported from docs/tools/animation-author/index.html's
  // buildTwoSidedSkinnedPlaneGeometry — same geometry/weighting approach, so a
  // rig built here plays back neckRotationDeg keyframes authored by that tool.
  function buildSkinnedPlaneGeometry(THREE, modelWidth, modelHeight, neckLocal, options = {}) {
    const segmentsX = Math.max(4, Math.round(Number(options.segmentsX) || 28));
    const segmentsY = Math.max(6, Math.round(Number(options.segmentsY) || 36));
    const blendHeight = Math.max(modelHeight * .012, Number(options.blendHeight) || modelHeight * .065);
    const source = new THREE.PlaneGeometry(modelWidth, modelHeight, segmentsX, segmentsY).toNonIndexed();
    const sourcePosition = source.getAttribute('position');
    const sourceUv = source.getAttribute('uv');
    const verticesPerFace = sourcePosition.count;
    const totalVertices = verticesPerFace * 2;
    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const uvs = new Float32Array(totalVertices * 2);
    const skinIndices = new Uint16Array(totalVertices * 4);
    const skinWeights = new Float32Array(totalVertices * 4);
    let cursor = 0;

    const appendVertex = (sourceIndex, normalZ) => {
      const x = sourcePosition.getX(sourceIndex);
      const y = sourcePosition.getY(sourceIndex);
      const z = sourcePosition.getZ(sourceIndex);
      positions[cursor * 3] = x;
      positions[cursor * 3 + 1] = y;
      positions[cursor * 3 + 2] = z;
      normals[cursor * 3] = 0;
      normals[cursor * 3 + 1] = 0;
      normals[cursor * 3 + 2] = normalZ;
      uvs[cursor * 2] = sourceUv.getX(sourceIndex);
      uvs[cursor * 2 + 1] = sourceUv.getY(sourceIndex);
      const headWeight = smoothstep01((y - (neckLocal.y - blendHeight * .55)) / blendHeight);
      skinIndices[cursor * 4] = 0;
      skinIndices[cursor * 4 + 1] = 1;
      skinWeights[cursor * 4] = 1 - headWeight;
      skinWeights[cursor * 4 + 1] = headWeight;
      cursor++;
    };

    for (let index = 0; index < verticesPerFace; index += 3) {
      appendVertex(index, 1);
      appendVertex(index + 1, 1);
      appendVertex(index + 2, 1);
    }
    const frontVertexCount = cursor;
    for (let index = 0; index < verticesPerFace; index += 3) {
      appendVertex(index + 2, -1);
      appendVertex(index + 1, -1);
      appendVertex(index, -1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.name = 'npc_avatar_skinned_plane_geometry';
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.addGroup(0, frontVertexCount, 0);
    geometry.addGroup(frontVertexCount, cursor - frontVertexCount, 1);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = { segmentsX, segmentsY, blendHeight, neckLocal: { ...neckLocal } };
    source.dispose();
    return geometry;
  }

  // Builds the neck-rigged variant of the single-plane assembly: a
  // THREE.SkinnedMesh (root bone + neck bone) instead of the two rigid front/
  // back Mesh objects createSinglePlaneAssembly makes, so `neckJoint.rotation`
  // can bend just the head region of the plane. Returns null if no neck pivot
  // could be detected (e.g. an unreadable/tainted canvas) — callers should
  // fall back to the plain rigid assembly in that case.
  function buildSkinnedSinglePlaneAssembly(THREE, config) {
    const pivotPx = detectNeckPivotPx(config.sourceCanvas, config.alphaThreshold);
    if (!pivotPx) return null;
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
    const geometry = buildSkinnedPlaneGeometry(THREE, modelWidth, modelHeight, neckLocal);
    const frontMaterial = makeSpriteMaterial(THREE, textures.frontOriginal, 'npc_avatar_skinned_front_material');
    const backMaterial = makeSpriteMaterial(THREE, textures.backForOriginal, 'npc_avatar_skinned_back_material');

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
    return { group, neckJoint, torsoBone, skinnedPlane, skeleton, neckLocal, pivotPx };
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
    frontMesh.rotation.y = Math.PI / 2;
    frontMesh.renderOrder = 2;
    frontMesh.name = (options.name || 'animal') + '_front_plane';

    const backMesh = new THREE.Mesh(backGeo, backMat);
    backMesh.rotation.y = -Math.PI / 2;
    backMesh.renderOrder = 2;
    backMesh.name = (options.name || 'animal') + '_back_plane';

    const group = new THREE.Group();
    group.name = (options.name || 'animal_plane') + '_group';
    group.add(frontMesh);
    group.add(backMesh);

    return {
      group,
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
          sourceCanvas, alphaThreshold: options.neckAlphaThreshold,
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
      ? { available: true, neckJoint: skinnedRig.neckJoint, torsoBone: skinnedRig.torsoBone, skinnedPlane: skinnedRig.skinnedPlane, neckLocal: skinnedRig.neckLocal, pivotPx: skinnedRig.pivotPx }
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

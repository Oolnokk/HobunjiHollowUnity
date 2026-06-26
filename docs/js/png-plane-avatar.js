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

  // ── Spine-aiming bend deformer ──────────────────────────────────────
  // Flat plane "avatars" have no skeleton, so aiming the face/snout at a
  // target is done by bending the (subdivided) plane geometry itself in
  // the vertex shader — via a literal rigid bone chain (default 5 bones),
  // mirroring how this would eventually be rigged with real bones: bone 0
  // is rooted at the fixed pivot (ground for bipeds, neck for creatures),
  // each subsequent bone is anchored to the end of the previous one, and
  // the total aim angle is split evenly across all bones, so the chain
  // curves into an arch rather than hinging at a single joint.
  //
  // Both helpers below inject the same general technique via
  // onBeforeCompile: the pivot→face span is divided into uBoneCount equal-
  // length segments; a vertex's bone index is selected from its *rest-pose*
  // coordinate (clamped so geometry below the pivot or above the face
  // doesn't get reassigned to a different bone), then the vertex is
  // rotated rigidly — by that bone's full cumulative angle, no blending
  // within a bone — about the bone's own start joint. `MAX_BEND_BONES` is
  // a compile-time array bound; `uBoneCount` (set from
  // cfg().bendBoneCount, default 5) is the actual live segment count, so
  // the studio can retune bone count without a shader recompile.
  //
  // Bone *lengths* are always equal, but each bone's *share of the total
  // aim angle* follows a power curve (frac(i) = ((i+1)/N)^uNeckSharpness,
  // per-bone weight = frac(i)-frac(i-1)) so the bones nearest the face
  // ("the neck") rotate much more than the ones nearest the pivot — at
  // uNeckSharpness=1 every bone gets an equal share (a plain circular
  // arch); above 1 the curve concentrates rotation at the face end, which
  // is what an actual spine/neck does when looking up or down.
  // `sign` exists because the front/back plane pair is the same body
  // mirrored via a static Y rotation, and whether that mirroring flips
  // the world-space effect of the bend depends on which local axis the
  // bend rotates: for the vertical bend (rotates the Y-Z plane), the
  // biped's 180° Y mirror negates Z, so the back mesh needs the negated
  // angle (sign=-1) to bend the same way in world space. For the nod
  // bend (rotates the X-Y plane), the creature's ±90° Y mirror leaves
  // the bend's world-Y effect unchanged between front/back, so both use
  // sign=+1 — see the matching call sites in createSinglePlaneAssembly
  // and buildAnimalPlaneAvatarModel.
  const MAX_BEND_BONES = 8;

  function attachVerticalBend(material, sign) {
    const uniforms = {
      uBendAngle: { value: 0 },
      uPivotCoord: { value: 0 },
      uFaceCoord: { value: 0 },
      uBoneCount: { value: 5 },
      uNeckSharpness: { value: 3 },
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader =
        'uniform float uBendAngle;\nuniform float uPivotCoord;\nuniform float uFaceCoord;\nuniform float uBoneCount;\nuniform float uNeckSharpness;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          const int MAX_BEND_BONES = ${MAX_BEND_BONES};
          int boneCount = clamp(int(uBoneCount + 0.5), 1, MAX_BEND_BONES);
          float bendSpan = uFaceCoord - uPivotCoord;
          bendSpan = bendSpan >= 0.0 ? max(bendSpan, 1e-5) : min(bendSpan, -1e-5);
          float boneLen = bendSpan / float(boneCount);
          float fBoneCount = float(boneCount);
          float bendT = clamp((transformed.y - uPivotCoord) / bendSpan, 0.0, 1.0);
          int boneIdx = min(int(bendT * fBoneCount), boneCount - 1);

          float jointY = uPivotCoord;
          float jointZ = 0.0;
          float cum = 0.0;
          float prevFrac = 0.0;
          for (int i = 0; i < MAX_BEND_BONES; i++) {
            if (i >= boneCount) break;
            float frac = pow(float(i + 1) / fBoneCount, uNeckSharpness);
            float boneAngle = uBendAngle * (frac - prevFrac);
            prevFrac = frac;
            cum += boneAngle;
            float c = cos(cum), s = sin(cum);
            if (i == boneIdx) {
              float boneStartY = uPivotCoord + float(i) * boneLen;
              float relY = transformed.y - boneStartY;
              float relZ = transformed.z;
              transformed.y = jointY + relY * c + relZ * s;
              transformed.z = jointZ + relZ * c - relY * s;
              break;
            }
            jointY += boneLen * c;
            jointZ -= boneLen * s;
          }
        }`
      );
    };
    material.customProgramCacheKey = () => 'spine_bend_vertical_chain';
    material.userData = material.userData || {};
    material.userData.bendUniforms = uniforms;
    material.userData.bendSign = sign;
    return uniforms;
  }

  function attachNodBend(material, sign) {
    const uniforms = {
      uBendAngle: { value: 0 },
      uPivotCoord: { value: 0 },
      uFaceCoord: { value: 0 },
      uNeckHeight: { value: 0 },
      uBoneCount: { value: 5 },
      uNeckSharpness: { value: 3 },
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader =
        'uniform float uBendAngle;\nuniform float uPivotCoord;\nuniform float uFaceCoord;\nuniform float uNeckHeight;\nuniform float uBoneCount;\nuniform float uNeckSharpness;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          const int MAX_BEND_BONES = ${MAX_BEND_BONES};
          int boneCount = clamp(int(uBoneCount + 0.5), 1, MAX_BEND_BONES);
          float bendSpan = uFaceCoord - uPivotCoord;
          bendSpan = bendSpan >= 0.0 ? max(bendSpan, 1e-5) : min(bendSpan, -1e-5);
          float boneLen = bendSpan / float(boneCount);
          float fBoneCount = float(boneCount);
          float bendT = clamp((transformed.x - uPivotCoord) / bendSpan, 0.0, 1.0);
          int boneIdx = min(int(bendT * fBoneCount), boneCount - 1);

          float jointX = uPivotCoord;
          float jointY = uNeckHeight;
          float cum = 0.0;
          float prevFrac = 0.0;
          for (int i = 0; i < MAX_BEND_BONES; i++) {
            if (i >= boneCount) break;
            float frac = pow(float(i + 1) / fBoneCount, uNeckSharpness);
            float boneAngle = uBendAngle * (frac - prevFrac);
            prevFrac = frac;
            cum += boneAngle;
            float c = cos(cum), s = sin(cum);
            if (i == boneIdx) {
              float boneStartX = uPivotCoord + float(i) * boneLen;
              float relX = transformed.x - boneStartX;
              float relY = transformed.y - uNeckHeight;
              transformed.x = jointX + relX * c + relY * s;
              transformed.y = jointY + relY * c - relX * s;
              break;
            }
            jointX += boneLen * c;
            jointY -= boneLen * s;
          }
        }`
      );
    };
    material.customProgramCacheKey = () => 'spine_bend_nod_chain';
    material.userData = material.userData || {};
    material.userData.bendUniforms = uniforms;
    material.userData.bendSign = sign;
    return uniforms;
  }

  // Smoothly drives every bend-deformed material under `root` toward
  // `targetAngleRad` (clamped to maxBendAngleDeg), applying each mesh's
  // sign so the front/back plane pair bends together in world space.
  function setAvatarAimPitch(root, targetAngleRad, dt) {
    if (!root) return;
    const maxAngle = (cfg().maxBendAngleDeg ?? 50) * Math.PI / 180;
    const clampedTarget = Math.max(-maxAngle, Math.min(maxAngle, targetAngleRad || 0));
    const lerpRate = cfg().bendPitchLerp ?? 0.15;
    const k = Number.isFinite(dt) ? Math.min(1, dt * 10) : lerpRate;
    if (!root.userData) root.userData = {};
    const current = root.userData._bendAngle ?? 0;
    const next = current + (clampedTarget - current) * k;
    root.userData._bendAngle = next;
    root.traverse(child => {
      const bend = child.material?.userData?.bendUniforms;
      if (!bend) return;
      const sign = child.material.userData.bendSign ?? 1;
      bend.uBendAngle.value = next * sign;
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
    if (Number.isFinite(Number(options.placementRatioOverride))) return Number(options.placementRatioOverride);
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

  function createSinglePlaneAssembly(THREE, config) {
    const group = new THREE.Group();
    group.name = config.name || 'npc_avatar_single_plane_assembly';

    // Face is always local_y=0 by construction (this assembly's own origin
    // is the avatar's "face center" — see buildSinglePlaneAvatarModel).
    // Pivot (ground) is supplied by the caller, derived from the species/
    // gender portraitVerticalPlacement ratio already used for placement.
    const faceLocalY = 0;
    const pivotLocalY = config.pivotLocalY ?? -config.planeHeight / 2;
    const heightSegments = Math.max(1, Math.round(cfg().bendHeightSegments ?? 16));
    const boneCount = Math.max(1, Math.min(MAX_BEND_BONES, Math.round(cfg().bendBoneCount ?? 5)));
    const neckSharpness = Math.max(0.1, Number(cfg().bendNeckSharpness ?? 3));

    const planeGeo = new THREE.PlaneGeometry(config.planeWidth, config.planeHeight, 1, heightSegments);
    const frontMat = makeSpriteMaterial(THREE, config.textures.frontOriginal, 'npc_avatar_front_material');
    const frontBend = attachVerticalBend(frontMat, 1);
    frontBend.uPivotCoord.value = pivotLocalY;
    frontBend.uFaceCoord.value = faceLocalY;
    frontBend.uBoneCount.value = boneCount;
    frontBend.uNeckSharpness.value = neckSharpness;
    const frontMesh = new THREE.Mesh(planeGeo, frontMat);
    frontMesh.name = 'npc_avatar_front_plane';
    frontMesh.position.z = config.anchorZ;
    frontMesh.renderOrder = 2;
    group.add(frontMesh);

    const backMat = makeSpriteMaterial(THREE, config.textures.backForOriginal, 'npc_avatar_back_material');
    const backBend = attachVerticalBend(backMat, -1);
    backBend.uPivotCoord.value = pivotLocalY;
    backBend.uFaceCoord.value = faceLocalY;
    backBend.uBoneCount.value = boneCount;
    backBend.uNeckSharpness.value = neckSharpness;
    const backMesh = new THREE.Mesh(planeGeo.clone(), backMat);
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

    // Spine-aiming "nod": weight ramps along local X (front-to-back axis
    // of the side profile) from a neck pivot toward the snout at the left
    // edge, rotating in the X/Y plane around a neck-height pivot — like a
    // horse lowering/raising its head, not a whole-body rotation.
    const widthSegments = Math.max(1, Math.round(cfg().bendHeightSegments ?? 16));
    const boneCount = Math.max(1, Math.min(MAX_BEND_BONES, Math.round(cfg().bendBoneCount ?? 5)));
    const neckSharpness = Math.max(0.1, Number(cfg().bendNeckSharpness ?? 3));
    const faceLocalX = -modelWidth / 2;
    const pivotLocalX = faceLocalX * (cfg().creatureNeckPivotRatio ?? 0.45);
    const snoutHeightRatio = Number.isFinite(options.snoutHeightRatio) ? options.snoutHeightRatio : (cfg().creatureSnoutHeightRatio ?? 0.68);
    const neckHeight = (snoutHeightRatio - 0.5) * modelHeight;
    const frontBend = attachNodBend(frontMat, 1);
    frontBend.uPivotCoord.value = pivotLocalX;
    frontBend.uFaceCoord.value = faceLocalX;
    frontBend.uNeckHeight.value = neckHeight;
    frontBend.uBoneCount.value = boneCount;
    frontBend.uNeckSharpness.value = neckSharpness;
    const backBend = attachNodBend(backMat, 1);
    backBend.uPivotCoord.value = pivotLocalX;
    backBend.uFaceCoord.value = faceLocalX;
    backBend.uNeckHeight.value = neckHeight;
    backBend.uBoneCount.value = boneCount;
    backBend.uNeckSharpness.value = neckSharpness;

    const frontGeo = new THREE.PlaneGeometry(modelWidth, modelHeight, widthSegments, 1);
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
    group.userData.snoutHeightRatio = snoutHeightRatio;
    group.userData.snoutLocalHeight = neckHeight;

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
    const assembly = createSinglePlaneAssembly(THREE, {
      planeWidth: modelWidth,
      planeHeight: modelHeight,
      anchorZ,
      textures,
      // Ground, expressed in the assembly's own local space (whose origin
      // is the face — see createSinglePlaneAssembly), is always at
      // -placementRatio * modelHeight: the assembly sits placementRatio*
      // modelHeight above the avatar root's ground-level parent, so this
      // is just that offset's negative, in the assembly's own coordinates.
      pivotLocalY: -placementRatio * modelHeight,
      name: `${root.name}_single_plane_assembly`,
    });
    assembly.position.y = (placementRatio - 0.5) * modelHeight;
    root.userData.portraitVerticalPlacementRatio = placementRatio;
    root.userData.portraitScaleMultiplier = scaleMultiplier;
    root.userData.portraitModelWidth = modelWidth;
    root.userData.portraitModelHeight = modelHeight;
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
    setAvatarAimPitch,
  };
})();

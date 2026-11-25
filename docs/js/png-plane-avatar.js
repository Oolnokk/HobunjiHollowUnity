// Shared PNG-to-single-plane avatar assembly for rough HTML demos.
// This reuses the single-plane mode from docs/references/(HA)PNGtoGLBV1.html,
// but returns live Three.js objects instead of exporting GLB files.
(function () {
  'use strict';

  const PORTRAIT_FLIP_STORAGE_KEY = 'hobunjiPngPortraitsFlipped'; // Persists the player-facing horizontal portrait setting across sessions.
  const trackedPortraitTextures = new Set(); // Lets the Settings toggle update already-spawned front/back character planes immediately.
  let portraitsFlipped = true; // New/default character presentation; Dev Mode can expose the opt-out checkbox below.
  try {
    const savedPortraitFlip = localStorage.getItem(PORTRAIT_FLIP_STORAGE_KEY); // Preserves an explicit older choice while treating a missing key as the new flipped default.
    if (savedPortraitFlip !== null) portraitsFlipped = savedPortraitFlip !== '0';
  } catch {}

  function cfg() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
  }

  function drawVariantCanvas(targetCanvas, image, options = {}) {
    if (!targetCanvas || !image) return null;
    const flipX = !!options.flipX;
    const blackSilhouette = !!options.blackSilhouette;
    const width = image.naturalWidth || image.videoWidth || image.width;
    const height = image.naturalHeight || image.videoHeight || image.height;
    // Assigning width/height reallocates the backing store even when the size
    // is unchanged, and the periodic world-portrait "life" refresh redraws
    // every visible avatar here several times a second; clearRect below
    // already resets the pixels when the size stays the same.
    const resized = targetCanvas.width !== width || targetCanvas.height !== height;
    if (targetCanvas.width !== width) targetCanvas.width = width;
    if (targetCanvas.height !== height) targetCanvas.height = height;
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
    if (!resized) {
      // A size assignment would also have reset the context state; do the
      // same explicitly so a same-size redraw starts from identical defaults.
      if (typeof ctx.reset === 'function') ctx.reset();
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.imageSmoothingEnabled = true;
        ctx.shadowColor = 'rgba(0, 0, 0, 0)';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
    }
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
      alphaTest: Math.max(cfg().alphaTest ?? 0.001, cfg().maskAlphaTest ?? 0.35),
      side: THREE.FrontSide, depthTest: true, depthWrite: true, opacity: 1,
    }); // Standalone editor fallback still needs the same solid-depth cutoff.
  }

  // Compatibility alias for older callers; this is now literally the sprite
  // PNG surface API rather than an independently maintained plane-only copy.
  window.HobunjiPngPlaneUnlit = spritePngSurface || window.HobunjiPngPlaneUnlit;

  function applyPortraitTextureFlip(texture) {
    const state = texture?.userData?.hobunjiPortraitFlip; // Stores the authored UV transform that this toggle mirrors/restores.
    if (!state) return;
    texture.repeat.x = portraitsFlipped ? -state.baseRepeatX : state.baseRepeatX;
    texture.offset.x = portraitsFlipped ? state.baseOffsetX + state.baseRepeatX : state.baseOffsetX;
    texture.needsUpdate = true;
    state.flipped = portraitsFlipped;
  }

  function trackPortraitTexture(THREE, texture, face) {
    if (!texture) return texture;
    texture.userData = texture.userData || {};
    texture.userData.hobunjiPortraitFlip = {
      face,
      baseRepeatX: texture.repeat.x,
      baseOffsetX: texture.offset.x,
      flipped: false,
    }; // Preserves each authored texture's original UV transform when the setting is turned back off.
    texture.wrapS = THREE.RepeatWrapping;
    trackedPortraitTextures.add(texture);
    texture.addEventListener?.('dispose', () => trackedPortraitTextures.delete(texture));
    applyPortraitTextureFlip(texture);
    return texture;
  }

  function setPortraitsFlipped(enabled, options = {}) {
    portraitsFlipped = !!enabled;
    for (const texture of trackedPortraitTextures) applyPortraitTextureFlip(texture);
    for (const root of portraitGlowModels) syncPortraitGlow(portraitThreeByRoot.get(root), root, root.userData.sourceCanvas);
    if (options.persist !== false) {
      try { localStorage.setItem(PORTRAIT_FLIP_STORAGE_KEY, portraitsFlipped ? '1' : '0'); } catch {}
    }
    return portraitsFlipped;
  }

  function wirePortraitFlipSetting() {
    const checkbox = document.getElementById('settingFlipPngPortraits'); // Owns the player-facing control without coupling the renderer to game.js startup order.
    if (!checkbox || checkbox.dataset.pngPortraitFlipWired === '1') return;
    checkbox.dataset.pngPortraitFlipWired = '1';
    checkbox.checked = portraitsFlipped;
    checkbox.addEventListener('change', event => setPortraitsFlipped(event.target.checked));
  }

  function buildTextureSet(THREE, image, backImage) {
    const rearSource = backImage || image;
    const rearOptions = backImage ? { flipX: true } : { flipX: true, blackSilhouette: true };
    return {
      frontOriginal: trackPortraitTexture(THREE, makeTextureFromCanvas(THREE, makeVariantCanvas(image), 'npc_avatar_front_texture'), 'front'),
      backForOriginal: trackPortraitTexture(THREE, makeTextureFromCanvas(THREE, makeVariantCanvas(rearSource, rearOptions), backImage ? 'npc_avatar_back_assembled_texture' : 'npc_avatar_back_silhouette_texture'), 'back'),
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

  // Child proportions: `body` is the whole-avatar multiplier (portrait, hands,
  // feet — everything below), `head` is the head's FINAL size relative to an
  // adult head. Heads shrink less than bodies, so js/character-rig-scale.js
  // re-enlarges just the head at the neck bone by head / body. A record can
  // override either (childBodyScale / childHeadScale — e.g. babies vs older
  // children from js/romance-family.js); config supplies the defaults.
  function childScaleFor(options = {}) {
    if (!isChildAvatar(options)) return null;
    const record = options.npcRecord || options.profile?.npcRecord || {};
    const positive = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
    const height = positive(record.childBodyHeightScale) ?? positive(options.childBodyHeightScale) ?? positive(record.childBodyScale) ?? positive(options.childBodyScale) ?? positive(cfg().childScaleMultiplier) ?? 1;
    const width = positive(record.childBodyWidthScale) ?? positive(options.childBodyWidthScale) ?? positive(cfg().childWidthScaleMultiplier) ?? height; // Existing saves without a width keep the historical uniform body size.
    const head = positive(record.childHeadScale) ?? positive(options.childHeadScale) ?? positive(cfg().childHeadScaleMultiplier) ?? height;
    return { body: height, height, width, head, headFactor: head / height, headFactorX: head / width }; // Head remains an independent final size in both axes.
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
    const child = childScaleFor(options);
    if (child) scale *= child.body;
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
    // The last alpha-visible pixel of this species' base head is the neck's actual top.
    // Do not substitute the full portrait's feet or a fixed human head-height fraction.
    const bottom = headMask.bottom;
    return {
      pivotPx: { x: headMask.centroidPx.x, y: bottom + .5 },
      centroidPx: { ...headMask.centroidPx },
      boundsPx: { top: headMask.top, bottom, left: headMask.left, right: headMask.right },
      method: 'head-sprite-alpha-centroid',
    };
  }

  function smoothstep01(value) {
    const t = Math.max(0, Math.min(1, Number(value) || 0));
    return t * t * (3 - 2 * t);
  }

  function neckBlendBand(neckY, modelHeight, pixelHeight) {
    const imageHeight = Number.isFinite(pixelHeight) && pixelHeight > 0 ? pixelHeight : 200; // Base portrait height maps each species' head-bottom pixel to model space.
    const safeHeight = Number.isFinite(modelHeight) && modelHeight > 0 ? modelHeight : 1; // Prevent a malformed preview model from creating a zero-width bend.
    const topPx = Math.max(0, Math.min(imageHeight - 1, (0.5 - neckY / safeHeight) * imageHeight)); // Last opaque base-head pixel, already used as the neck pivot.
    const spanPx = Math.min(imageHeight - topPx - 0.01, Math.min(3, Math.max(2, Math.round(imageHeight * .012)))); // At most three SOURCE pixels below the skull, even on high-resolution portraits; retain a tiny last body row.
    const height = spanPx / imageHeight * safeHeight; // Shared by GPU weights, CPU landmark probes, and the character-spine solver.
    return { topY: neckY, bottomY: neckY - height, height, topPx, bottomPx: topPx + spanPx };
  }

  function neckBlendWeight(y, topY, height) {
    return smoothstep01((y - (topY - height)) / height); // Full head weight at/above the skull's bottom; no head weight below the narrow neck.
  }

  function headOffsetWeightAt(y, topY, modelHeight, neckHeight) {
    const bandBottom = topY - neckHeight; // Rotation stops here; only the nonrotating head-height compensation continues below.
    const fadeHeight = Math.max(modelHeight * .24, neckHeight * 2); // Distribute up to ~12% species offset without vertically inverting cells.
    return smoothstep01((y - (bandBottom - fadeHeight)) / fadeHeight);
  }

  function neckBlendRows(segmentsY, pixelHeight, topPx, bottomPx) {
    const upperRows = Math.max(1, Math.min(segmentsY - 3, Math.round(topPx / pixelHeight * (segmentsY - 2)))); // Rows above the neck preserve approximate existing portrait mesh density.
    const bendRows = 2; // Give the short neck band a middle skin-weight row without increasing triangles per NPC.
    const lowerRows = segmentsY - upperRows - bendRows; // The rest of the grid covers the torso and legs.
    const rows = new Float32Array(segmentsY + 1); // Nonuniform UV-matched row positions used by each portrait plane's geometry.
    for (let i = 0; i <= segmentsY; i++) {
      rows[i] = i <= upperRows ? topPx * i / upperRows
        : i <= upperRows + bendRows ? topPx + (bottomPx - topPx) * (i - upperRows) / bendRows
          : bottomPx + (pixelHeight - bottomPx) * (i - upperRows - bendRows) / lowerRows;
    }
    return rows;
  }

  // 'mask' head gate: the opaque pixels of a head-only render (head sprite plus every equipped head cosmetic), box-averaged so the cutoff stays
  // smooth and slightly dilated. Averages come from an integral image (four reads per lookup). `mirror` serves the rear mesh, whose texture
  // space is flipped relative to the front render.
  function buildHeadMaskWeights(maskCanvas, mirror = false, alphaThreshold = 12) {
    const width = maskCanvas?.width, height = maskCanvas?.height;
    if (!maskCanvas || !width || !height) return null;
    let data;
    try { data = maskCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data; }
    catch (error) { return null; }
    const stride = width + 1;
    const integral = new Uint32Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > alphaThreshold) row++;
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
      }
    }
    const radius = Math.max(2, Math.round(width * .03));
    return {
      pixelWidth: width, pixelHeight: height,
      weightAtPixel(pixelX, pixelY) {
        const x = Math.round(mirror ? width - pixelX : pixelX), y = Math.round(pixelY);
        const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
        if (x1 <= x0 || y1 <= y0) return 0;
        const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
        return smoothstep01(sum / ((x1 - x0) * (y1 - y0)) / .4);
      },
    };
  }

  // Shared by rendered vertices and CPU landmarks so head scaling agrees.
  function headScaleGateAtPixel(pixelX, headBoundsPx) {
    if (!headBoundsPx) return 1;
    const halfWidth = Math.max(1, (headBoundsPx.right - headBoundsPx.left) / 2); // Bare head half-width in pixels.
    const centerX = (headBoundsPx.left + headBoundsPx.right) / 2; // Horizontal center of the detected head.
    const tight = headBoundsPx.tightGate === true; // Opt-in (Enemy Workshop "Tight head gate"): wide hoods/vests beyond the bare skull follow the body instead of the head scale.
    const inner = halfWidth * (tight ? 1 : 1.5); // Full head-scale influence includes nearby hats.
    const outer = halfWidth * (tight ? 1.3 : 2.5); // Shoulders beyond this keep rotation only.
    const dx = Math.abs(pixelX - centerX); // Distance from the head center.
    return dx <= inner ? 1 : dx >= outer ? 0
      : smoothstep01(1 - (dx - inner) / (outer - inner));
  }

  function headScaleWeightAt(y, neckY, modelHeight, pixelX, bounds, turnWeight, blendHeight = modelHeight * .012) {
    if (!bounds) return turnWeight;
    const verticalWeight = neckBlendWeight(y, neckY, blendHeight); // Head scale cannot secretly extend the neck rotation below its short species-specific bend.
    if (bounds.headMask) return verticalWeight * bounds.headMask.weightAtPixel(pixelX, (modelHeight / 2 - y) / modelHeight * bounds.headMask.pixelHeight); // Preserve painted head+cosmetics gating within the same neck band.
    return verticalWeight * headScaleGateAtPixel(pixelX, bounds); // Preserve the separate wide/tight *horizontal* head-scale gates.
  }

  // Builds the complete rectangular PNG plane as one two-sided SkinnedMesh.
  // Every grid vertex receives root/head weights regardless of the texel alpha
  // beneath it. Cosmetics, separated silhouettes, and transparent space are
  // therefore deformed by one coherent rig instead of becoming disconnected
  // alpha-shaped islands.
  // The character spline (js/character-spine.js): SPLINE_NODE_COUNT node bones from the posterior (node 0, the root) to the neck pivot (the last
  // node), chained by offset, with the head-turn bone (index NECK_BONE) and head-scale bone (HEAD_BONE) hanging off the last node. They are the
  // only body bones: no torso bone, no spine bone. Every skinned portrait carries them at rest so a hunch can be applied after build; without the
  // module they collapse to the plane origin and carry no weight.
  const SPLINE_NODE_COUNT = 7, OFFSET_BONE = SPLINE_NODE_COUNT, NECK_BONE = SPLINE_NODE_COUNT + 1, HEAD_BONE = SPLINE_NODE_COUNT + 2; // The extra nonrotating bone absorbs species head placement without widening the neck bend.
  const spineLayoutFor = (baseX, baseY, modelHeight, posteriorY, pivotX = baseX, pivotY = baseY) => window.HobunjiCharacterSpine?.layoutFor?.(baseX, baseY, modelHeight, posteriorY, pivotX, pivotY)
    || { nodes: Array.from({ length: SPLINE_NODE_COUNT }, () => ({ x: 0, y: 0, z: 0 })), offsets: Array.from({ length: SPLINE_NODE_COUNT }, () => ({ x: 0, y: 0, z: 0 })), neck: { x: pivotX, y: pivotY, z: 0 } };
  // The neck base where the spline ends (the shoulder line, not the head-turn pivot at the head's centre / chin line); the pivot itself when unknown.
  const spineNeckBase = (speciesId, gender, modelHeight, placementRatio, neck, posteriorY, pixelHeight = 200) => window.HobunjiCharacterSpine?.neckBaseLocal?.({ speciesId, gender, modelHeight, placementRatio, neckX: neck.x, neckY: neck.y, posteriorY, pixelHeight }) || { x: neck.x, y: neck.y };
  const spineShoulderLocal = (speciesId, gender, modelHeight, placementRatio, neck, posteriorY) => window.HobunjiCharacterSpine?.shoulderLocal?.({ speciesId, gender, modelHeight, placementRatio, neckX: neck.x, neckY: neck.y, posteriorY }) || { x: neck.x, y: neck.y - modelHeight * .08 }; // Original authored shoulder line only for hands and weapon orbit; never the skinned spine endpoint.
  const spineWeightScratch = { a: 0, b: 0, wb: 0 };
  const spineNodeWeightsAt = (y, neckY, modelHeight, posteriorY, out = spineWeightScratch) => window.HobunjiCharacterSpine?.nodeWeightsAt?.(y, neckY, modelHeight, posteriorY, out)
    || Object.assign(out, { a: 0, b: 0, wb: 0 }); // Skin weights of the two neighbouring spline nodes at plane-local height y.
  function makeSplineNodes(THREE, name, layout) {
    const nodes = [];
    for (let k = 0; k < SPLINE_NODE_COUNT; k++) {
      const node = new THREE.Bone();
      node.name = `${name}_spline_node_${k}`;
      const at = k === 0 ? layout.nodes[0] : layout.offsets[k]; // Node 0 sits at the posterior in the plane's frame; the rest chain by offset.
      node.position.set(at.x, at.y, at.z);
      node.userData.hobunjiSplineRest = { x: at.x, y: at.y, z: at.z };
      if (k > 0) nodes[k - 1].add(node);
      nodes.push(node);
    }
    return nodes;
  }
  // The posterior (hip) anchor in the skinned plane's frame, where the spine chain starts (js/character-spine.js); null when unknown (the spine module then estimates).
  const spinePosteriorLocalY = (speciesId, gender, modelHeight, placementRatio, handAttachY) => window.HobunjiCharacterSpine?.posteriorLocalY?.({ speciesId, gender, modelHeight, placementRatio, handAttachY }) ?? null;

  // Mesh budgets: baseline vertex limits for character and animal meshes. 'full' is the higher-detail player mode;
  // 'npc' caps town NPCs, enemies, livestock and animals. Skinned humanoid portraits additionally use the density scale below.
  // Pants grid size is read from here by js/pants-garment-renderer.js so there is one place to tune detail.
  const MESH_BUDGETS = Object.freeze({
    full: Object.freeze({ planeSegmentsX: 28, planeSegmentsY: 36, hostileMaskX: 48, hostileMaskY: 60, animalSegments: 72, pantsSegments: 64 }),
    npc: Object.freeze({ planeSegmentsX: 20, planeSegmentsY: 26, hostileMaskX: 34, hostileMaskY: 44, animalSegments: 30, pantsSegments: 32 }),
  });
  const PLAYER_BUDGET_KEY = 'hobunji_player_mesh_budget_v1'; // 'npc' | 'full'; per-device display preference, never part of a save.
  let playerBudgetMode = 'full';
  try { playerBudgetMode = window.localStorage?.getItem(PLAYER_BUDGET_KEY) === 'npc' ? 'npc' : 'full'; } catch (_) { /* storage can be blocked; default full */ }
  // Shared portrait/animal deformation density: production starts at 40%, with an optional developer A/B override. Pants meshes are independent.
  const PORTRAIT_DENSITY_MIN = 20; // Slider minimum; per-axis segments are never allowed below the skinning minimum.
  const PORTRAIT_DENSITY_DEFAULT = 40; // Production per-axis subdivision scale for player, NPC and enemy skinned portraits; dev slider may override it.
  let portraitDensityPercent = PORTRAIT_DENSITY_DEFAULT; // Current session density used by every newly built skinned humanoid portrait.
  const portraitMeshRefs = new Set(); // Weak references to live skinned portrait meshes for developer retessellation.
  const portraitMeshBuilds = new WeakMap(); // Per-mesh build recipe plus weak-ref token; only mesh owners can retain recipes.
  const portraitMeshFinalizer = typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry(ref => portraitMeshRefs.delete(ref))
    : null; // Removes dead weak-ref entries even if the developer panel is never opened again.
  let lastPortraitRebuilds = 0; // Number of live meshes actually retessellated by the latest slider change.
  let portraitWireframeEnabled = false; // Session-only diagnostic used by the game and Animation Author, never saved.
  const portraitWireframeOriginals = new WeakMap(); // Original materials/temporary diagnostic materials for registered skinned portraits.

  const wireframeAnimalMaterials = new WeakMap(); // Frame updates target the real animal material while diagnostics are drawn.

  function applyPortraitWireframe(mesh, THREE) {
    if (!mesh?.isSkinnedMesh) return;
    const previous = portraitWireframeOriginals.get(mesh);
    if (!portraitWireframeEnabled) { releasePortraitWireframe(mesh); return; }
    if (previous || !THREE?.MeshBasicMaterial) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const debugMaterials = materials.map((_, index) => new THREE.MeshBasicMaterial({
      name: `portrait_dev_wireframe_${index}`, color: 0x5cf0ff, wireframe: true,
      transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, skinning: true, toneMapped: false,
    })); // Opaque grid lines include transparent PNG areas, revealing the actual full-plane topology.
    if (mesh.userData?.hobunjiAnimalHeadRig) {
      debugMaterials.forEach((debugMaterial, index) => {
        const creatureMaterial = materials[index]; // The latest frame should be visible immediately when leaving wireframe.
        wireframeAnimalMaterials.set(debugMaterial, creatureMaterial);
        Object.defineProperty(debugMaterial, 'map', {
          get: () => null, // The diagnostic shader always draws the entire mesh.
          set(map) {
            if (!!creatureMaterial.map !== !!map) creatureMaterial.needsUpdate = true;
            creatureMaterial.map = map;
          },
        });
      });
    }
    portraitWireframeOriginals.set(mesh, { original: mesh.material, debugMaterials });
    mesh.material = Array.isArray(mesh.material) ? debugMaterials : debugMaterials[0];
  }

  function releasePortraitWireframe(mesh) {
    const previous = portraitWireframeOriginals.get(mesh);
    if (!previous) return;
    mesh.material = previous.original;
    for (const mat of previous.debugMaterials) mat.dispose?.();
    portraitWireframeOriginals.delete(mesh);
  }

  function setPortraitWireframeEnabled(enabled) {
    const next = enabled === true;
    if (portraitWireframeEnabled === next) return false;
    portraitWireframeEnabled = next;
    for (const ref of portraitMeshRefs) {
      const mesh = ref.deref();
      if (!mesh) { portraitMeshRefs.delete(ref); continue; }
      const spec = portraitMeshBuilds.get(mesh);
      if (spec) {
        applyPortraitWireframe(mesh, spec.THREE);
        try { spec.onWireframeChanged?.(next); } catch (error) { console.warn('[portrait-wireframe] custom rig sync failed', error); }
      }
    }
    try { window.dispatchEvent(new Event('hobunji:portrait-wireframe-changed')); } catch (_) { /* no DOM (tests) */ }
    return true;
  }

  function portraitGrid(mode, hostileMask = false) {
    const budget = mode === 'npc' ? MESH_BUDGETS.npc : MESH_BUDGETS.full;
    const x = hostileMask ? budget.hostileMaskX : budget.planeSegmentsX;
    const y = hostileMask ? budget.hostileMaskY : budget.planeSegmentsY;
    return {
      segmentsX: Math.max(4, Math.round(x * portraitDensityPercent / 100)),
      segmentsY: Math.max(6, Math.round(y * portraitDensityPercent / 100)),
    };
  }

  function animalGrid(authoredResolution, aspectRatio = 1) {
    const requested = Number(authoredResolution); // Original authored detail, still bounded by the existing NPC animal cap.
    const maxSeg = Math.min(MESH_BUDGETS.npc.animalSegments, Number.isFinite(requested) ? Math.max(8, Math.round(requested)) : MESH_BUDGETS.npc.animalSegments);
    const ratio = Number(aspectRatio); // Painted source-map aspect; rejects zero/invalid ratios without creating unusable geometry.
    const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    const baseX = aspect >= 1 ? maxSeg : Math.max(8, Math.round(maxSeg * aspect));
    const baseY = aspect >= 1 ? Math.max(8, Math.round(maxSeg / aspect)) : maxSeg;
    return {
      segmentsX: Math.max(4, Math.round(baseX * portraitDensityPercent / 100)),
      segmentsY: Math.max(4, Math.round(baseY * portraitDensityPercent / 100)),
    };
  }

  // Keep the authoritative rig and mesh so attachment, texture, and x-ray
  // consumers retain their existing references. Only native world draws use
  // the cached rigid geometry, and only for a supported stable pose.
  const frozenPortraits = new WeakMap(); // Mesh -> pose cache, released with its avatar.
  const sharedPortraitMaterials = new WeakSet(); // Shared visitor materials may also draw live skins in the same pass.
  const frozenCandidates = []; // Frame-local records prepared after presentation hooks.
  const frozenDraws = []; // Restored before the compositor evaluates another pass.
  const frozenMaterials = new Map(); // Material -> latest submitted skinning mode in this world frame.
  const frozenStats = { flat: 0, posed: 0, builds: 0, trianglesSaved: 0 };
  const POSE_EPSILON = 1e-6; // Avoid freezing an independently moving head or accumulating visible pose error.
  let frozenPortraitsEnabled = true; // Mobile render-optimization A/B switch.
  let frozenFrame = null; // Prevents auxiliary renders from using the world's pose snapshot.
  let frozenBuildsRemaining = 0; // Bounds one-time CPU skinning work across the visible crowd.

  function disposeFrozenPortrait(mesh) {
    const cache = frozenPortraits.get(mesh);
    if (!cache) return;
    for (const pose of cache.poses) pose.geometry.dispose();
    frozenPortraits.delete(mesh);
  }

  function visibleInPortraitScene(mesh, scene) {
    for (let node = mesh; node; node = node.parent) {
      if (!node.visible) return false;
      if (node === scene) return true;
    }
    return false;
  }

  function savePortraitPose(mesh, values) {
    let index = 0;
    for (const bone of mesh.skeleton.bones) {
      const p = bone.position, q = bone.quaternion, s = bone.scale; // Local pose is independent of actor movement and whole-body facing.
      values[index++] = p.x; values[index++] = p.y; values[index++] = p.z;
      values[index++] = q.x; values[index++] = q.y; values[index++] = q.z; values[index++] = q.w;
      values[index++] = s.x; values[index++] = s.y; values[index++] = s.z;
    }
  }

  function samePortraitPose(a, b) {
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > POSE_EPSILON) return false;
    return true;
  }

  const frozenAttributes = ['position', 'uv', 'normal', 'skinIndex', 'skinWeight']; // Inputs copied into each baked geometry.

  function frozenInputsMatch(cache, mesh) {
    const geometry = mesh.geometry; // A sprite warp or density edit can replace the source between passes.
    if (cache.source !== geometry || cache.skeleton !== mesh.skeleton ||
        cache.start !== geometry.drawRange.start || cache.count !== geometry.drawRange.count) return false;
    for (let i = 0; i < frozenAttributes.length; i++) {
      const attribute = geometry.attributes[frozenAttributes[i]];
      if (attribute !== cache.attributes[i] || attribute?.version !== cache.versions[i]) return false;
    }
    return geometry.index === cache.index && geometry.index?.version === cache.indexVersion;
  }

  function bakePortrait(THREE, mesh) {
    const source = mesh.geometry;
    const geometry = source.clone(); // Preserves face groups, UV orientation, draw range and authored custom attributes.
    const original = source.attributes.position, positions = geometry.attributes.position;
    const sourceNormals = source.attributes.normal, normals = geometry.attributes.normal;
    const weights = source.attributes.skinWeight, indices = source.attributes.skinIndex;
    const skinMatrices = mesh.skeleton.bones.map(() => new THREE.Matrix4()); // Same local matrices used by the skin-normal vertex shader.
    const point = new THREE.Vector3(); // One scratch point per bounded, transition-only bake.
    const bounds = source.boundingBox; // A quad is equivalent only for a centered, complete plane with canonical UVs.
    const width = bounds ? bounds.max.x - bounds.min.x : 0;
    const height = bounds ? bounds.max.y - bounds.min.y : 0;
    const uv = source.attributes.uv;
    let rigid = width > 0 && height > 0 && source.drawRange.start === 0 &&
      source.drawRange.count >= (source.index?.count ?? original.count) &&
      !source.getAttribute('hobunjiRigSourceUv');
    mesh.updateWorldMatrix(true, false);
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < skinMatrices.length; i++) {
      skinMatrices[i].copy(mesh.bindMatrixInverse)
        .multiply(mesh.skeleton.bones[i].matrixWorld).multiply(mesh.skeleton.boneInverses[i]).multiply(mesh.bindMatrix);
    }
    for (let i = 0; i < positions.count; i++) {
      mesh.boneTransform(i, point);
      rigid &&= Math.abs(point.x - original.getX(i)) < POSE_EPSILON &&
        Math.abs(point.y - original.getY(i)) < POSE_EPSILON && Math.abs(point.z) < POSE_EPSILON &&
        Math.abs(uv.getX(i) - (point.x / width + 0.5)) < POSE_EPSILON &&
        Math.abs(uv.getY(i) - (point.y / height + 0.5)) < POSE_EPSILON;
      positions.setXYZ(i, point.x, point.y, point.z);
      if (!sourceNormals) continue;
      const x = sourceNormals.getX(i), y = sourceNormals.getY(i), z = sourceNormals.getZ(i);
      let nx = 0, ny = 0, nz = 0; // Transform directions without each bone's translation.
      for (let axis = 0; axis < 4; axis++) {
        const slot = i * 4 + axis, weight = weights.array[slot];
        if (!weight) continue;
        const e = skinMatrices[indices.array[slot]].elements;
        nx += weight * (e[0] * x + e[4] * y + e[8] * z);
        ny += weight * (e[1] * x + e[5] * y + e[9] * z);
        nz += weight * (e[2] * x + e[6] * y + e[10] * z);
      }
      normals.setXYZ(i, nx, ny, nz);
    }
    geometry.deleteAttribute('skinIndex');
    geometry.deleteAttribute('skinWeight');
    if (rigid) {
      geometry.dispose();
      // Both portrait faces have independent material groups and opposite winding.
      const plane = new THREE.PlaneGeometry(width, height);
      if (source.groups.length < 2) return { geometry: plane, flat: true };
      const quad = plane.toNonIndexed();
      plane.dispose();
      const position = [], normal = [], uv = []; // Two triangles per face, matching the skinned portrait's local UVs.
      for (const facing of [1, -1]) {
        for (let i = 0; i < 6; i++) {
          const at = facing === 1 ? i : 5 - i;
          position.push(quad.attributes.position.getX(at), quad.attributes.position.getY(at), 0);
          normal.push(0, 0, facing);
          uv.push(quad.attributes.uv.getX(at), quad.attributes.uv.getY(at));
        }
      }
      quad.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      quad.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
      quad.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      quad.addGroup(0, 6, 0);
      quad.addGroup(6, 6, 1);
      return { geometry: quad, flat: true };
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, flat: false };
  }

  function isPortraitHeadForward(mesh, animal) {
    const bones = mesh.skeleton.bones;
    const neck = animal ? bones[1] : bones[NECK_BONE]; // Animal pitch and yaw occupy separate bones.
    if (!neck) return false;
    const forwardYaw = mesh.userData.hobunjiPortraitForwardYaw;
    const yaw = animal ? bones[2]?.rotation.y : neck.rotation.y;
    const restPitch = animal ? mesh.userData.hobunjiPortraitRestPitch : 0;
    const pitch = animal ? neck.rotation.z : neck.rotation.x;
    // An authored stance can counter-turn the neck to keep the face forward.
    return forwardYaw !== null && Math.abs(yaw - (forwardYaw ?? 0)) <= POSE_EPSILON &&
      Math.abs(pitch - restPitch) <= POSE_EPSILON && (animal || Math.abs(neck.rotation.z) <= POSE_EPSILON);
  }

  function hasLivePortraitHelper(mesh) {
    return mesh.parent?.userData?.hobunjiShoulderRest?.enabled || mesh.children.some(child => child.isMesh && child.visible);
  }

  function frozenPoseFor(mesh, spec) {
    let cache = frozenPortraits.get(mesh);
    if (cache && !frozenInputsMatch(cache, mesh)) {
      disposeFrozenPortrait(mesh);
      cache = null;
    }
    if (!isPortraitHeadForward(mesh, spec.animal)) {
      if (cache) cache.stable = 0;
      return null;
    }
    if (!cache) {
      const source = mesh.geometry;
      const attributes = frozenAttributes.map(name => source.attributes[name]);
      const size = mesh.skeleton.bones.length * 10;
      cache = {
        source, skeleton: mesh.skeleton, attributes, versions: attributes.map(attribute => attribute?.version),
        index: source.index, indexVersion: source.index?.version, start: source.drawRange.start, count: source.drawRange.count,
        poses: [], stable: 0, current: new Float64Array(size), previous: new Float64Array(size),
      };
      frozenPortraits.set(mesh, cache);
    }
    savePortraitPose(mesh, cache.current);
    for (const pose of cache.poses) if (samePortraitPose(pose.values, cache.current)) return pose;
    cache.stable = samePortraitPose(cache.current, cache.previous) ? cache.stable + 1 : 0;
    cache.previous.set(cache.current);
    if (cache.stable < 2 || frozenBuildsRemaining <= 0) return null; // Blend through live poses and cap first-use work in a crowd.
    frozenBuildsRemaining--;
    const pose = bakePortrait(spec.THREE, mesh);
    pose.values = cache.current.slice();
    if (cache.poses.length >= 6) cache.poses.shift().geometry.dispose(); // Neutral, hunch, and recurring weapon rest sides per mesh.
    cache.poses.push(pose);
    frozenStats.builds++;
    return pose;
  }

  function frozenMaterialsMatch(entry, material) {
    if (entry.originalMaterial !== material) return false;
    if (!Array.isArray(material)) return true;
    if (entry.materials.length !== material.length) return false;
    for (let i = 0; i < material.length; i++) if (entry.materials[i] !== material[i]) return false;
    return true;
  }

  function prepareFrozenPortraits(ctx) {
    frozenFrame = ctx.frame;
    frozenBuildsRemaining = 2;
    frozenStats.flat = frozenStats.posed = frozenStats.trianglesSaved = 0;
    for (const ref of portraitMeshRefs) {
      const mesh = ref.deref();
      if (!mesh) { portraitMeshRefs.delete(ref); continue; }
      const spec = portraitMeshBuilds.get(mesh);
      if (!spec?.freeze || !visibleInPortraitScene(mesh, ctx.scene)) continue;
      const originalMaterial = mesh.material; // Same live materials keep portrait alpha, tint, and replay state authoritative.
      if (Array.isArray(originalMaterial)
        ? originalMaterial.some(material => !material?.skinning || sharedPortraitMaterials.has(material))
        : !originalMaterial?.skinning || sharedPortraitMaterials.has(originalMaterial)) continue;
      // Some specialized animal portraits use live helper skins for shoulder
      // deformation. Keep their source and helper on the same representation.
      if (hasLivePortraitHelper(mesh)) continue;
      const pose = frozenPoseFor(mesh, spec);
      if (!pose) continue;
      const cache = frozenPortraits.get(mesh);
      if (!cache.draw || !frozenMaterialsMatch(cache.draw, originalMaterial)) {
        cache.draw = { mesh, cache, animal: spec.animal, originalMaterial, materials: Array.isArray(originalMaterial) ? originalMaterial.slice() : [originalMaterial] };
      }
      cache.draw.pose = pose;
      cache.draw.source = mesh.geometry;
      frozenCandidates.push(cache.draw);
      if (pose.flat) frozenStats.flat++;
      else frozenStats.posed++;
      const sourceCount = mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
      const frozenCount = pose.geometry.index?.count ?? pose.geometry.attributes.position.count;
      frozenStats.trianglesSaved += (sourceCount - frozenCount) / 3;
    }
  }

  function beginFrozenDraw(ctx) {
    // Override materials have their own skinning contract (outline/perception).
    if (ctx.scene.overrideMaterial || !ctx.camera?.layers) return;
    for (const entry of frozenCandidates) {
      const { mesh, cache, animal, pose, materials } = entry;
      if (!(mesh.layers.mask & ctx.camera.layers.mask) || !mesh.visible) continue;
      let useFrozen = frozenMaterialsMatch(entry, mesh.material) &&
        materials.every(material => material?.skinning && !sharedPortraitMaterials.has(material)) &&
        frozenInputsMatch(cache, mesh) && isPortraitHeadForward(mesh, animal) && !hasLivePortraitHelper(mesh);
      if (useFrozen) {
        savePortraitPose(mesh, cache.current);
        useFrozen = samePortraitPose(pose.values, cache.current); // A later replay may have a different presentation pose.
      }
      for (const material of materials) {
        const lastFrozen = frozenMaterials.get(material);
        if (!useFrozen && lastFrozen === undefined) continue;
        if (lastFrozen !== useFrozen) {
          material.needsUpdate = true; // r128 can reuse the wrong program unless a skinning-mode change bumps the version.
          frozenMaterials.set(material, useFrozen);
        }
        if (useFrozen) material.skinning = false;
      }
      if (!useFrozen) continue;
      mesh.geometry = pose.geometry;
      mesh.isSkinnedMesh = false;
      frozenDraws.push(entry);
    }
  }

  function endFrozenDraw() {
    for (const { mesh, source, materials } of frozenDraws) {
      mesh.geometry = source;
      delete mesh.isSkinnedMesh;
      for (const material of materials) material.skinning = true;
    }
    frozenDraws.length = 0;
  }

  window.RenderHooks?.register({
    id: 'frozen-portrait-preparation', owner: 'png-plane-avatar.js', order: 6000, scope: 'frame',
    appliesTo: ctx => frozenPortraitsEnabled && !portraitWireframeEnabled && ctx.worldScene && ctx.frame.renderer === ctx.renderer,
    before: prepareFrozenPortraits,
    after() {
      frozenStats.trianglesSaved = Math.round(frozenStats.trianglesSaved);
      for (const [material, wasFrozen] of frozenMaterials) if (wasFrozen) material.needsUpdate = true;
      frozenMaterials.clear();
      frozenCandidates.length = 0;
      frozenFrame = null;
    },
  });
  window.RenderHooks?.register({
    id: 'frozen-portrait-draw', owner: 'png-plane-avatar.js', order: 6100,
    appliesTo: ctx => frozenFrame !== null && ctx.frame === frozenFrame && ctx.worldScene && ctx.frame.renderer === ctx.renderer && ctx.depth === 0,
    before: beginFrozenDraw,
    after: endFrozenDraw,
  });

  function registerSkinnedPortrait(mesh, THREE, width, height, neckLocal, options, mode, hostileMask = false, hooks = null) {
    if (typeof WeakRef !== 'function' || !mesh) return false; // Build-time density still works if live tracking is unavailable.
    const previous = portraitMeshBuilds.get(mesh);
    if (previous) { // Re-registration updates the recipe but must not add another WeakRef for the same mesh.
      Object.assign(previous, { THREE, width, height, neckLocal, options, mode, hostileMask, ...(hooks || {}) });
      applyPortraitWireframe(mesh, THREE);
      return true;
    }
    const ref = new WeakRef(mesh); // This token never keeps a despawned avatar alive.
    portraitMeshBuilds.set(mesh, { THREE, width, height, neckLocal, options, mode, hostileMask, ref, ...(hooks || {}) });
    portraitMeshRefs.add(ref);
    portraitMeshFinalizer?.register(mesh, ref, ref);
    applyPortraitWireframe(mesh, THREE);
    return true;
  }

  function unregisterSkinnedPortrait(mesh) {
    const spec = portraitMeshBuilds.get(mesh);
    if (!spec) return false;
    disposeFrozenPortrait(mesh);
    releasePortraitWireframe(mesh); // Restore source materials before any portrait-owned disposal.
    portraitMeshBuilds.delete(mesh); // Used by avatar, hostile and cloned-visitor disposal.
    portraitMeshRefs.delete(spec.ref);
    portraitMeshFinalizer?.unregister(spec.ref);
    return true;
  }

  function trackSkinnedClone(source, clone) {
    const spec = portraitMeshBuilds.get(source);
    if (!spec || !clone?.isSkinnedMesh || clone.geometry !== source.geometry) return false;
    // Doorstep visitors share the source mesh's geometry but own separate bones;
    // both users must change to the SAME new geometry before the old buffer is freed.
    const sourceOriginal = portraitWireframeOriginals.get(source)?.original;
    for (const material of Array.isArray(sourceOriginal || source.material) ? (sourceOriginal || source.material) : [sourceOriginal || source.material]) {
      if (material) sharedPortraitMaterials.add(material);
    }
    if (sourceOriginal) clone.material = sourceOriginal; // The visitor copied a debug material; it must restore the real texture when the toggle is turned off.
    return registerSkinnedPortrait(clone, spec.THREE, spec.width, spec.height, spec.neckLocal,
      spec.options, spec.mode, spec.hostileMask);
  }

  function registerExternalSkinnedPortrait(mesh, config) {
    if (!config?.THREE || typeof config.buildGeometry !== 'function') return false;
    // Animation Author retains its own authored neck-weight builder; only the slider/wireframe lifecycle is shared.
    const registered = registerSkinnedPortrait(mesh, config.THREE, config.width, config.height, config.neckLocal,
      {}, config.mode || 'full', false,
      { buildGeometry: config.buildGeometry, resolveGrid: config.resolveGrid || null,
        afterGeometryChange: config.afterGeometryChange || null, onWireframeChanged: config.onWireframeChanged || null,
        animal: config.animal === true, freeze: config.freeze === true });
    if (registered) config.onWireframeChanged?.(portraitWireframeEnabled);
    return registered;
  }

  function portraitDensityDebug() {
    let tracked = 0, triangles = 0, animalFaces = 0; // Diagnostics distinguish the animal skins that now share the slider.
    for (const ref of portraitMeshRefs) {
      const mesh = ref.deref();
      if (!mesh) { portraitMeshRefs.delete(ref); continue; }
      if (!portraitMeshBuilds.has(mesh) || !mesh.geometry) continue;
      tracked++;
      if (portraitMeshBuilds.get(mesh)?.animal) animalFaces++;
      const geometry = mesh.geometry; // Indexed animal PlaneGeometry stores its triangle topology in the index buffer, unlike non-indexed humanoid skins.
      triangles += (geometry.getIndex?.()?.count ?? geometry.index?.count ?? geometry.getAttribute?.('position')?.count ?? 0) / 3;
    }
    return { percent: portraitDensityPercent, player: portraitGrid(playerBudgetMode), npc: portraitGrid('npc'),
      hostileMask: portraitGrid('npc', true), tracked, animalFaces, triangles, lastRebuilt: lastPortraitRebuilds,
      wireframe: portraitWireframeEnabled };
  }

  function setPortraitDensityPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return false;
    const next = Math.max(PORTRAIT_DENSITY_MIN, Math.min(100, Math.round(number)));
    if (next === portraitDensityPercent) return false;
    portraitDensityPercent = next;
    let rebuilt = 0;
    const replacements = new Map(); // One new BufferGeometry for every distinct old geometry; doorstep clones share the replacement.
    const updated = []; // Notify custom author rigs after all skinned meshes have switched to the new geometry.
    for (const ref of portraitMeshRefs) {
      const mesh = ref.deref();
      if (!mesh) { portraitMeshRefs.delete(ref); continue; }
      const spec = portraitMeshBuilds.get(mesh);
      if (!spec || !mesh.geometry) continue;
      const target = spec.resolveGrid?.() || portraitGrid(spec.mode, spec.hostileMask); // Animal head rigs supply aspect-correct geometry rather than humanoid grid dimensions.
      const old = mesh.geometry;
      if (old.userData?.segmentsX === target.segmentsX && old.userData?.segmentsY === target.segmentsY) continue;
      let nextGeometry = replacements.get(old);
      if (!nextGeometry) {
        nextGeometry = spec.buildGeometry
          ? spec.buildGeometry(target)
          : buildSkinnedPlaneGeometry(spec.THREE, spec.width, spec.height, spec.neckLocal, {
              ...spec.options, ...target,
            });
        if (!nextGeometry) continue;
        // Hostile front/back meshes each use one material and one face of the shared topology.
        if (spec.options.frontOnly) nextGeometry.setDrawRange(0, nextGeometry.groups[0].count);
        replacements.set(old, nextGeometry);
      }
      disposeFrozenPortrait(mesh); // Retire bakes even if the actor is currently hidden or turning.
      mesh.geometry = nextGeometry; // Swap every live user before disposing its shared old GPU buffer.
      if (spec.afterGeometryChange) updated.push({ spec, mesh, nextGeometry });
      rebuilt++;
    }
    for (const old of replacements.keys()) old.dispose();
    for (const item of updated) {
      try { item.spec.afterGeometryChange(item.nextGeometry, item.mesh); }
      catch (error) { console.warn('[portrait-density] author rig refresh failed', error); }
    }
    lastPortraitRebuilds = rebuilt;
    try { window.dispatchEvent(new Event('hobunji:portrait-density-changed')); } catch (_) { /* tests/no DOM */ }
    return true;
  }

  const meshBudget = {
    table: MESH_BUDGETS,
    resolve: mode => (mode === 'npc' ? MESH_BUDGETS.npc : MESH_BUDGETS.full),
    forPlayer: () => playerBudgetMode, // Mode name handed to avatar/pants builders for the player rig.
    playerMode: () => playerBudgetMode,
    portraitGrid,
    animalGrid,
    defaultPortraitDensityPercent: PORTRAIT_DENSITY_DEFAULT,
    portraitDensityPercent: () => portraitDensityPercent,
    setPortraitDensityPercent,
    portraitDensityDebug,
    // One-time copy of a live skinned portrait's posed pixels for lightweight physical carryables.
    // The caller owns the returned geometry; the NPC still owns its skeleton and textures.
    bakeStaticPortraitForCarry(THREE, mesh) {
      if (!THREE || !mesh?.isSkinnedMesh || !mesh.skeleton?.bones?.length
          || !mesh.geometry?.attributes?.skinIndex || !mesh.geometry?.attributes?.skinWeight) return null;
      return bakePortrait(THREE, mesh);
    },
    frozenSnapshot: () => ({ enabled: frozenPortraitsEnabled, ...frozenStats }),
    setFrozenEnabled(value) { frozenPortraitsEnabled = value !== false; return frozenPortraitsEnabled; },
    wireframeEnabled: () => portraitWireframeEnabled,
    originalPortraitMaterial: mesh => portraitWireframeOriginals.get(mesh)?.original || mesh?.material, // Split animal overlay clones need the real texture even if their source is temporarily wireframed.
    setPortraitWireframeEnabled,
    registerExternalSkinnedPortrait,
    invalidateFrozenPortrait: disposeFrozenPortrait,
    trackSkinnedClone,
    unregisterSkinnedPortrait,
    setPlayerMode(mode) {
      const next = mode === 'npc' ? 'npc' : 'full';
      if (next === playerBudgetMode) return false;
      playerBudgetMode = next;
      try { window.localStorage?.setItem(PLAYER_BUDGET_KEY, next); } catch (_) { /* preference just won't persist */ }
      try { window.dispatchEvent(new Event('hobunji:player-mesh-budget-changed')); } catch (_) { /* no DOM events (tests) */ }
      return true;
    },
  };
  function buildSkinnedPlaneGeometry(THREE, modelWidth, modelHeight, neckLocal, options = {}) {
    const segmentsX = Math.max(4, Math.round(Number(options.segmentsX) || 28));
    const segmentsY = Math.max(6, Math.round(Number(options.segmentsY) || 36));
    const pixelWidth = Math.max(1, Number(options.pixelWidth) || 1); // Used below to map the overall PNG plane into model/UV space.
    const pixelHeight = Math.max(1, Number(options.pixelHeight) || 1); // Used below to map the overall PNG plane into model/UV space.
    const band = neckBlendBand(neckLocal.y, modelHeight, pixelHeight); // Species-specific bottom of its actual base-head sprite anchors the two-pixel neck transition.
    const blendHeight = band.height; // Shared by the two skin weights and the CPU world-pixel resolver.
    const rowPixels = neckBlendRows(segmentsY, pixelHeight, band.topPx, band.bottomPx); // Reserve two mesh cells at the tiny neck strip without growing the mesh.
    // The head turns only in the narrow sprite-bottom band. Head *position*
    // must continue blending farther down: authored offsets of ~10% of body height
    // would invert a 2px triangle strip if they were applied to the rotation bone.
    // A separate nonrotating placement bone supplies that broad compensation;
    // the head-scale bone retains the established horizontal width gate.
    const headBoundsPx = options.headBoundsPx || null;
    const positions = [], normals = [], uvs = [], skinIndices = [], skinWeights = [];

    const toModelX = pixelX => -modelWidth / 2 + (pixelX / pixelWidth) * modelWidth;
    const toModelY = pixelY => modelHeight / 2 - (pixelY / pixelHeight) * modelHeight;
    const appendVertex = (pixelX, pixelY, normalZ) => {
      const x = toModelX(pixelX);
      const y = toModelY(pixelY);
      positions.push(x, y, 0);
      normals.push(0, 0, normalZ);
      uvs.push(pixelX / pixelWidth, 1 - pixelY / pixelHeight);
      const turnWeight = neckBlendWeight(y, neckLocal.y, blendHeight); // Short neck rotation ends just below the painted head.
      if (turnWeight > 0) {
        const scaleWeight = headScaleWeightAt(y, neckLocal.y, modelHeight, pixelX, headBoundsPx, turnWeight, blendHeight); // Head-scaling gate is independent of the placement fade.
        skinIndices.push(OFFSET_BONE, NECK_BONE, HEAD_BONE, 0);
        skinWeights.push(1 - turnWeight, turnWeight - scaleWeight, scaleWeight, 0); // All three upper bones inherit the head placement shift.
      } else {
        const spline = spineNodeWeightsAt(y, Number.isFinite(options.spineBaseY) ? options.spineBaseY : neckLocal.y, modelHeight, options.posteriorY); // Entire torso-to-neck area belongs to the actual seven-node spline.
        skinIndices.push(spline.a, spline.b, 0, 0);
        skinWeights.push(1 - spline.wb, spline.wb, 0, 0); // No broad head-offset skinning: the huge pseudo-neck was created by this 24%-height fade.
      }
    };

    const appendCell = ({ column, row }, normalZ) => {
      const x0 = column / segmentsX * pixelWidth;
      const x1 = (column + 1) / segmentsX * pixelWidth;
      const y0 = rowPixels[row];
      const y1 = rowPixels[row + 1];
      const front = [[x0, y1], [x1, y1], [x0, y0], [x1, y1], [x1, y0], [x0, y0]];
      const vertices = normalZ > 0 ? front : [...front].reverse();
      for (const [pixelX, pixelY] of vertices) appendVertex(pixelX, pixelY, normalZ);
    };
    for (let row = 0; row < segmentsY; row++) {
      for (let column = 0; column < segmentsX; column++) appendCell({ column, row }, 1);
    }
    const frontVertexCount = positions.length / 3;
    if (!options.frontOnly) for (let row = 0; row < segmentsY; row++) {
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
    if (!options.frontOnly) geometry.addGroup(frontVertexCount, frontVertexCount, 1);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = {
      segmentsX, segmentsY, blendHeight, neckLocal: { ...neckLocal }, neckBandPx: { top: band.topPx, bottom: band.bottomPx }, spinePosteriorY: Number.isFinite(options.posteriorY) ? options.posteriorY : null, spineBaseY: Number.isFinite(options.spineBaseY) ? options.spineBaseY : null,
      coverageMode: 'full-png-plane',
      planeBoundsPx: { left: 0, right: pixelWidth, top: 0, bottom: pixelHeight },
      planeCellCount: segmentsX * segmentsY,
    };
    return geometry;
  }

  // Builds the neck-rigged variant of the single-plane assembly: a
  // THREE.SkinnedMesh (root, neck, and independent head-scale bones) instead of the two rigid front/
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
    const gatedHeadBounds = headGateBounds(detectedHead.boundsPx, config.headGate, config.speciesId, null, false, config.cosmeticIds); // Species-aware head gate (player and NPC avatars).
    const posteriorY = spinePosteriorLocalY(config.speciesId, config.gender, modelHeight, config.placementRatio, config.handAttachY);
    const spineBase = spineNeckBase(config.speciesId, config.gender, modelHeight, config.placementRatio, neckLocal, posteriorY, pxH); // The last spine node is 2.5 original portrait pixels below the real head bottom.
    const shoulderLocal = spineShoulderLocal(config.speciesId, config.gender, modelHeight, config.placementRatio, neckLocal, posteriorY); // Keep the original hand/weapon attachment line independently of skinning.
    const geometry = buildSkinnedPlaneGeometry(THREE, modelWidth, modelHeight, neckLocal, {
      pixelWidth: pxW,
      pixelHeight: pxH,
      headBoundsPx: gatedHeadBounds,
      posteriorY,
      spineBaseY: spineBase.y,
      ...portraitGrid(config.meshBudget), // Developer slider scales the player/NPC grid without changing the skinning rules.
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

    const layout = spineLayoutFor(spineBase.x, spineBase.y, modelHeight, posteriorY, neckLocal.x, neckLocal.y);
    const splineNodes = makeSplineNodes(THREE, config.name, layout);
    const headOffsetJoint = new THREE.Bone(); // The authored species head-height compensation operates without rotating the upper torso.
    headOffsetJoint.name = `${config.name}_head_offset_bone`;
    headOffsetJoint.position.set(layout.neck.x, layout.neck.y, layout.neck.z); // Rest pivot still comes from the actual bottom of the base head sprite.
    splineNodes[SPLINE_NODE_COUNT - 1].add(headOffsetJoint);
    const neckJoint = new THREE.Bone();
    neckJoint.name = `${config.name}_neck_bone`;
    headOffsetJoint.add(neckJoint); // Rotate the head *after* nonrotating offset compensation.
    // Child of neckJoint, not a spline sibling: it inherits head-turn
    // rotation for free, while its OWN local scale/position (untouched by
    // rotation) is what HobunjiCharacterRigScale's head scale/offset drives —
    // see applyHeadCompensation in character-rig-scale.js. Only vertices
    // buildSkinnedPlaneGeometry actually classified as head pixels (via the
    // headCanvas alpha sample above) are weighted to it at all, so scale/
    // offset can never drag nearby torso or overwear along with the head.
    const headScaleJoint = new THREE.Bone();
    headScaleJoint.name = `${config.name}_head_scale_bone`;
    neckJoint.add(headScaleJoint);

    const skinnedPlane = new THREE.SkinnedMesh(geometry, [frontMaterial, backMaterial]);
    skinnedPlane.name = config.name || 'npc_avatar_skinned_plane_assembly';
    skinnedPlane.position.z = anchorZ;
    skinnedPlane.renderOrder = 2;
    skinnedPlane.frustumCulled = false;
    skinnedPlane.add(splineNodes[0]);
    const skeleton = new THREE.Skeleton([...splineNodes, headOffsetJoint, neckJoint, headScaleJoint]);
    skinnedPlane.bind(skeleton);
    registerSkinnedPortrait(skinnedPlane, THREE, modelWidth, modelHeight, neckLocal, {
      pixelWidth: pxW, pixelHeight: pxH, headBoundsPx: gatedHeadBounds, posteriorY, spineBaseY: spineBase.y,
    }, config.meshBudget === 'npc' ? 'npc' : 'full', false, { freeze: config.freezePortrait === true });

    const group = new THREE.Group();
    group.name = config.name || 'npc_avatar_skinned_plane_assembly_group';
    group.add(skinnedPlane);
    return {
      group, headOffsetJoint, neckJoint, headScaleJoint, splineNodes, spinePosteriorY: posteriorY, spineBase, shoulderLocalY: shoulderLocal.y, skinnedPlane, skeleton, neckLocal, pivotPx,
      headCentroidPx, headCentroidLocal, headBoundsPx: gatedHeadBounds,
      detectionMethod: detectedHead.method, coverageMode: geometry.userData.coverageMode,
      planeBoundsPx: geometry.userData.planeBoundsPx,
    };
  }

  // Auto-neck variant of the painted Animal Head Rig's
  // upgradeAnimalPlaneToWeightedSkin (see the extension IIFE below) for a
  // rigid two-Mesh humanoid plane pair (e.g. a bandit's frontMesh/backMesh)
  // that has no authored weight map — the head/body blend is instead a
  // smoothstep falloff purely from the neck pivot Y, the same technique
  // buildSkinnedPlaneGeometry above already uses for player/NPC walkers.
  // Deliberately upgrades only the two Mesh objects passed in, leaving
  // whatever Group parents them untouched, so a caller that wraps its own
  // pivot Groups around these meshes (see combat-bandit.js's buildBanditAvatar,
  // which needs its front/back "planes" to stay the exact rigid Group
  // objects updateCreatureMesh/beginCreatureDeath/updateCorpses rotate)
  // keeps that structure fully intact — only the mesh's own internal
  // geometry/skeleton changes.
  function buildAutoNeckWeightedGeometry(THREE, sourceGeometry, pivotLocalY, blendHeight) {
    const geometry = sourceGeometry.clone();
    const pos = geometry.getAttribute('position');
    const count = pos.count;
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const headWeight = neckBlendWeight(pos.getY(i), pivotLocalY, blendHeight);
      skinIndices[i * 4] = 0; skinIndices[i * 4 + 1] = 1;
      skinWeights[i * 4] = 1 - headWeight; skinWeights[i * 4 + 1] = headWeight;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  // Head-gate modes: 'tight' (head scale ends just below the skull, so a wide hood, shoulders and vest follow body width/height), 'legacy'
  // (the original wide box with a long fade) and 'mask' (opt-in: the head plus its equipped head cosmetics, from a head-only render).
  // Player, civilian and hostile portraits share the original wide/long-fade legacy gate.
  // Harlyao skeletons retain their tight default; oversized binding masks can still override it.
  const LEGACY_HEAD_GATE_COSMETICS = [/binding_mask/i]; // Clothing whose bulk needs the wide gate: extend this list to override the species rule per piece.
  function defaultHeadGateFor(speciesId, cosmeticIds = []) {
    if ((cosmeticIds || []).some(id => LEGACY_HEAD_GATE_COSMETICS.some(pattern => pattern.test(String(id || ''))))) return 'legacy';
    const species = String(speciesId || '').trim().toLowerCase().replace(/_/g, '-'); // Used to preserve the Harlyao skeleton exception for every avatar path.
    return species === 'harlyao-skeleton' ? 'tight' : 'legacy';
  }
  function npcHeadGateFor(speciesId, authoredGate = null) {
    if (authoredGate) return authoredGate; // Explicit workshop modes remain available, notably for Harlyao skeletons.
    const species = String(speciesId || '').trim().toLowerCase().replace(/_/g, '-'); // Used to keep Harlyao skeletons on their original head-scale gate.
    return species === 'harlyao-skeleton' ? undefined : 'legacy';
  }
  function headGateBounds(bounds, mode, speciesId, maskCanvas = null, mirror = false, cosmeticIds = []) {
    if (!bounds) return bounds;
    const gate = mode || defaultHeadGateFor(speciesId, cosmeticIds);
    if (gate === 'mask') {
      const headMask = buildHeadMaskWeights(maskCanvas, mirror);
      return headMask ? { ...bounds, headMask } : { ...bounds, tightGate: true }; // An unreadable mask render falls back to the tight box.
    }
    return gate === 'tight' ? { ...bounds, tightGate: true } : bounds; // The mode rides on the bounds so the renderer and every landmark resolver agree.
  }

  function upgradePlaneToAutoNeckSkin(THREE, plane, pivotNormalized, mirrorX, fallbackDimensions = {}) {
    if (!plane?.isMesh || !plane.geometry || !plane.material || !pivotNormalized) return null;
    const params = plane.geometry.parameters || {};
    const planeWidth = Number(params.width) || Number(fallbackDimensions.width) || 1;
    const planeHeight = Number(params.height) || Number(fallbackDimensions.height) || 1;
    const pivotU = mirrorX ? 1 - pivotNormalized.x : pivotNormalized.x;
    const pivotLocalX = (pivotU - 0.5) * planeWidth;
    const pivotLocalY = (0.5 - pivotNormalized.y) * planeHeight;
    const sourceCanvas = fallbackDimensions.sourceCanvas;
    const detectedHead = sourceCanvas ? detectHeadRigPixels(fallbackDimensions.headCanvas, sourceCanvas, 12) : null;
    const headBounds = headGateBounds(detectedHead?.boundsPx, fallbackDimensions.headGate, fallbackDimensions.speciesId, fallbackDimensions.headMaskCanvas, mirrorX, fallbackDimensions.cosmeticIds);
    const pixelWidth = sourceCanvas?.width || 1;
    const posteriorY = spinePosteriorLocalY(fallbackDimensions.speciesId, fallbackDimensions.gender, planeHeight, fallbackDimensions.placementRatio, fallbackDimensions.handAttachY);
    const spineBase = spineNeckBase(fallbackDimensions.speciesId, fallbackDimensions.gender, planeHeight, fallbackDimensions.placementRatio, { x: pivotLocalX, y: pivotLocalY }, posteriorY, sourceCanvas?.height || 200); // Hostile portrait shares the same short spine-to-head gap.
    const shoulderLocal = spineShoulderLocal(fallbackDimensions.speciesId, fallbackDimensions.gender, planeHeight, fallbackDimensions.placementRatio, { x: pivotLocalX, y: pivotLocalY }, posteriorY); // Weapon orbit retains the authored shoulder pose, separate from the extended spine.
    const hostileMode = fallbackDimensions.meshBudget === 'full' ? 'full' : 'npc'; // Enemies default to the NPC budget.
    const hostileMasked = !!headBounds?.headMask; // Preserve the finer masked-head grid at every density.
    const neckLocal = { x: pivotLocalX, y: pivotLocalY, z: 0 };
    const skinOptions = {
      frontOnly: true, posteriorY, spineBaseY: spineBase.y, pixelWidth, pixelHeight: sourceCanvas?.height || 1,
      headBoundsPx: headBounds && mirrorX ? { ...headBounds, left: pixelWidth - headBounds.right, right: pixelWidth - headBounds.left } : headBounds,
    };
    const weightedGeometry = buildSkinnedPlaneGeometry(THREE, planeWidth, planeHeight, neckLocal, {
      ...skinOptions, ...portraitGrid(hostileMode, hostileMasked),
    });
    // The converted hostile keeps separate front/rear meshes. Reuse the exact
    // player skin grid/weights, drawing just its front half on each mesh.
    weightedGeometry.setDrawRange(0, weightedGeometry.groups[0].count);
    const material = plane.material; // Reused so cosmetic/texture updates keep working unchanged.
    material.skinning = true;
    material.needsUpdate = true;

    const layout = spineLayoutFor(spineBase.x, spineBase.y, planeHeight, posteriorY, pivotLocalX, pivotLocalY);
    const splineNodes = makeSplineNodes(THREE, plane.name, layout);
    const headOffsetBone = new THREE.Bone(); // A separate nonrotating bone preserves large authored hostile head-height offsets.
    headOffsetBone.name = `${plane.name}_head_offset_bone`;
    headOffsetBone.position.set(layout.neck.x, layout.neck.y, layout.neck.z);
    splineNodes[SPLINE_NODE_COUNT - 1].add(headOffsetBone);
    const neckBone = new THREE.Bone();
    neckBone.name = `${plane.name}_neck_bone`;
    headOffsetBone.add(neckBone);
    const headScaleBone = new THREE.Bone();
    headScaleBone.name = `${plane.name}_head_scale_bone`;
    neckBone.add(headScaleBone);

    const skinned = new THREE.SkinnedMesh(weightedGeometry, material);
    skinned.name = plane.name;
    skinned.position.copy(plane.position);
    skinned.rotation.copy(plane.rotation);
    skinned.scale.copy(plane.scale);
    skinned.renderOrder = plane.renderOrder;
    skinned.visible = plane.visible;
    skinned.frustumCulled = false;
    skinned.userData = { ...plane.userData };
    skinned.onBeforeRender = plane.onBeforeRender;
    skinned.add(splineNodes[0]);
    const skeleton = new THREE.Skeleton([...splineNodes, headOffsetBone, neckBone, headScaleBone]);
    skinned.bind(skeleton);
    registerSkinnedPortrait(skinned, THREE, planeWidth, planeHeight, neckLocal, skinOptions, hostileMode, hostileMasked, { freeze: fallbackDimensions.freezePortrait === true });
    // Keep the disposer bound to the current geometry after a developer slider retessellation.
    return { mesh: skinned, get weightedGeometry() { return skinned.geometry; }, skeleton, headOffsetBone, neckBone, headScaleBone, splineNodes, spinePosteriorY: posteriorY, spineBase, shoulderLocalY: shoulderLocal.y, neckLocal };
  }

  function createSinglePlaneAssembly(THREE, config) {
    const group = new THREE.Group();
    group.name = config.name || 'npc_avatar_single_plane_assembly';

    const planeGeo = new THREE.PlaneGeometry(config.planeWidth, config.planeHeight);
    const frontMesh = new THREE.Mesh(planeGeo, makeSpriteMaterial(THREE, config.textures.frontOriginal, 'npc_avatar_front_material'));
    frontMesh.name = 'npc_avatar_front_plane';
    frontMesh.userData.noOutline = true; // The portrait PNG owns the character body's silhouette ink.
    frontMesh.position.z = config.anchorZ;
    frontMesh.renderOrder = 2;
    group.add(frontMesh);

    const backMesh = new THREE.Mesh(planeGeo.clone(), makeSpriteMaterial(THREE, config.textures.backForOriginal, 'npc_avatar_back_material'));
    backMesh.name = 'npc_avatar_back_plane';
    backMesh.userData.noOutline = true; // Only the separate volumetric hands and feet need generated outlines.
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
  const animalSourceTextures = new Map(); // Native sprite pairs shared by live animal avatars; zero-owner pairs are removed immediately.
  // Shared-face mirroring: a back plane's material can mirror the front
  // texture in its own vertex shader, so both cards sample ONE texture (one
  // GPU upload) instead of a second, horizontally pre-mirrored copy of the
  // same image. The mirror only engages when the bound map is a texture
  // registered here as a shared front face; any caller that still assigns a
  // pre-mirrored back texture (repeat.x = -1) renders exactly as before.
  const sharedFaceTextures = new WeakSet(); // Front textures handed to mirror-capable back materials.
  const sharedFaceMirrorMaterials = new WeakSet(); // Back materials whose shader mirrors shared-face maps.
  const SHARED_FACE_UV_VERTEX = [
    '#ifdef USE_UV',
    '\tvUv = ( uvTransform * vec3( mix( uv.x, 1.0 - uv.x, hobunjiSharedFaceMirror ), uv.y, 1.0 ) ).xy;',
    '#endif',
  ].join('\n');
  function enableSharedFaceMirror(material) {
    if (!material || sharedFaceMirrorMaterials.has(material)) return material;
    sharedFaceMirrorMaterials.add(material);
    const previousOnBeforeCompile = material.onBeforeCompile; // Chained so later/earlier shader customizations keep working.
    material.onBeforeCompile = function sharedFaceMirrorCompile(shader, renderer) {
      previousOnBeforeCompile?.call(this, shader, renderer);
      const owner = this; // Clones compile with their own map binding.
      shader.uniforms.hobunjiSharedFaceMirror = { get value() { return sharedFaceTextures.has(owner.map) ? 1 : 0; } }; // Read on every uniform upload, same cadence as the map itself.
      shader.vertexShader = 'uniform float hobunjiSharedFaceMirror;\n'
        + shader.vertexShader.replace('#include <uv_vertex>', SHARED_FACE_UV_VERTEX);
    };
    const previousCacheKey = material.customProgramCacheKey;
    material.customProgramCacheKey = function sharedFaceMirrorCacheKey() {
      return 'hobunji-shared-face-mirror|' + (previousCacheKey ? previousCacheKey.call(this) : '');
    };
    const baseClone = material.clone; // Material.copy drops onBeforeCompile, so clones (fades, depth occluders) re-enable it.
    if (typeof baseClone === 'function') material.clone = function sharedFaceMirrorClone() { return enableSharedFaceMirror(baseClone.call(this)); };
    return material;
  }
  // The map a back-plane material should bind for a {front, back} pair.
  function backMapFor(material, pair) {
    if (!pair) return null;
    const textureMaterial = wireframeAnimalMaterials.get(material) || material; // Preserve the rear shader mirror for frame swaps during wireframe.
    if (pair.front && sharedFaceMirrorMaterials.has(textureMaterial)) {
      sharedFaceTextures.add(pair.front);
      return pair.front;
    }
    return pair.back || null;
  }

  function acquireAnimalSourceTextures(THREE, spriteUrl) {
    let entry = animalSourceTextures.get(spriteUrl); // Same species art should consume one front/back GPU pair, not one pair per herd member.
    if (!entry) {
      const loader = new THREE.TextureLoader(); // Existing source-image loader and material settings stay unchanged.
      const back = new THREE.Texture(); // Pre-mirrored copy for callers without shared-face mirroring; shares the front's image and only uploads if bound.
      const front = loader.load(spriteUrl, loaded => {
        window.CreatureTextureCache?.capLoadedTexture?.(loaded); // Oversized sprites are scaled once here, so the shared back copy below gets the capped image too.
        back.image = loaded.image; back.needsUpdate = true;
      });
      front.colorSpace = back.colorSpace = THREE.SRGBColorSpace;
      back.wrapS = THREE.RepeatWrapping;
      back.repeat.set(-1, 1); back.offset.set(1, 0);
      entry = { front, back, refs: 0 };
      animalSourceTextures.set(spriteUrl, entry);
    }
    entry.refs++;
    return entry;
  }
  function releaseAnimalSourceTextures(spriteUrl, entry) {
    if (--entry.refs > 0) return; // Surviving animals keep their shared maps intact.
    if (animalSourceTextures.get(spriteUrl) === entry) animalSourceTextures.delete(spriteUrl);
    entry.front.dispose(); entry.back.dispose();
  }

  function buildAnimalPlaneAvatarModel(THREE, spriteUrl, options = {}) {
    if (!THREE) throw new Error('THREE is required.');
    if (!spriteUrl) throw new Error('A sprite URL is required.');
    const modelWidth  = options.modelWidth  ?? cfg().modelWidth ?? 1;
    const modelHeight = options.modelHeight ?? modelWidth;

    const sourceTextures = acquireAnimalSourceTextures(THREE, spriteUrl); // Reference-counted source pair for the canonical animal builder.
    const frontTex = sourceTextures.front, backTex = sourceTextures.back; // Per-avatar materials can switch generated maps without mutating these textures.
    let disposed = false; // Disposal wrappers can safely call this more than once.

    // Animal front/back cards use the same sprite alpha and depth silhouette as NPCs, not a separate 0.001 cutout.
    const frontMat = makeSpriteMaterial(THREE, frontTex, 'animal_front_mat');
    const backMat  = enableSharedFaceMirror(makeSpriteMaterial(THREE, backTex, 'animal_back_mat'));
    backMat.map = backMapFor(backMat, sourceTextures) || backTex; // Mirrors the shared front texture in-shader; backTex stays for compatibility.

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
    frontMesh.userData.noOutline = true; // Animal sprites are already outlined in their art.

    const backMesh = new THREE.Mesh(backGeo, backMat);
    backMesh.position.x = -faceSeparation;
    backMesh.rotation.y = -Math.PI / 2;
    backMesh.renderOrder = 2;
    backMesh.name = (options.name || 'animal') + '_back_plane';
    backMesh.userData.noOutline = true; // Preserve inked silhouette without a generated shell.

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
      // updateShoulderPetMeshPin has already solved the root position and
      // quaternion from the same authored grip/perch pair. Replacing the
      // child plane's world matrix here would separate the visible grip pixel
      // from that solved point, so authoritative attachments inherit normally.
      if (group.userData?.hobunjiShoulderPetAttachment?.authoritativeRootTransform) {
        if (!plane.matrixAutoUpdate) {
          plane.matrixAutoUpdate = true;
          plane.updateMatrix();
          plane.matrixWorldNeedsUpdate = true;
        }
        return;
      }
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
      const localWorldCompensated = parentWorld.invert().multiply(desiredWorld);
      // The main creature loop still assigns plane.rotation.y for ordinary
      // animals. For shoulder pets, that Euler write is the wrong control
      // surface: with an attached/animated parent it can be interpreted as
      // roll when the deadzone changes during movement. Own the local matrix
      // instead, while retaining the group's position and scale.
      plane.matrixAutoUpdate = false;
      plane.matrix.compose(plane.position, localWorldCompensated, plane.scale);
      plane.matrixWorldNeedsUpdate = true;
      // onBeforeRender runs after the normal scene traversal has already
      // updated matrixWorld. Rebuild both matrices now so movement cannot
      // render one frame of the previous parent/plane orientation.
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
        if (disposed) return;
        disposed = true;
        window.CreatureTextureCache?.releaseOwner(this); // Drops shared generated-texture pins through the canonical animal disposal path.
        frontGeo.dispose();
        backGeo.dispose();
        frontMat.dispose();
        backMat.dispose();
        releaseAnimalSourceTextures(spriteUrl, sourceTextures);
      },
    };
  }

  function hasUsablePortraitRig(candidate) {
    const rig = candidate?.userData?.neckRig;
    const skinnedPlane = rig?.skinnedPlane;
    const sourceCanvas = candidate?.userData?.sourceCanvas;
    return !!(
      rig?.available
      && skinnedPlane?.isSkinnedMesh
      && skinnedPlane?.skeleton?.bones?.length
      && sourceCanvas
      && Number.isFinite(Number(candidate?.userData?.portraitModelWidth))
      && Number.isFinite(Number(candidate?.userData?.portraitModelHeight))
    );
  } // Defines the exact avatar instance data required by the authored source-pixel skinning path.

  // Callers (shoulder-pet surface sampling chief among them) often hold the
  // outer player root while the PNG avatar group carrying neckRig lives one
  // or more levels below it, and resolveSkinnedPixelWorldFrame alone re-runs
  // this resolution 5 times per call (once per tangent-frame sample) every
  // single frame while a pet is perched. Caching the resolved descendant per
  // avatarRoot turns that into an O(1) lookup instead of a full subtree
  // traverse() on every call; the cache self-heals (falls back to a fresh
  // traverse) if the cached node is ever detached or stops matching the rig
  // shape, so an avatar rebuild in place can't leave this pointing at a stale
  // node.
  const _portraitRootCache = new WeakMap(); // avatarRoot -> resolved descendant with a usable portrait rig.

  function resolveSkinnedPortraitRoot(avatarRoot) {
    if (hasUsablePortraitRig(avatarRoot)) return avatarRoot;

    const cached = _portraitRootCache.get(avatarRoot);
    if (cached && cached.parent && hasUsablePortraitRig(cached)) return cached;

    let resolved = null;
    avatarRoot?.traverse?.(candidate => {
      if (!resolved && candidate !== avatarRoot && hasUsablePortraitRig(candidate)) resolved = candidate;
    });
    if (resolved) _portraitRootCache.set(avatarRoot, resolved);
    else _portraitRootCache.delete(avatarRoot);
    return resolved;
  }

  // Resolves an authored source-pixel coordinate through the same live torso/head
  // skinning used by the portrait SkinnedMesh. This remains avatar-instance
  // data so species-level cached anchors cannot be reused for a different pose.
  let pixelPositionScratch = null; // Lazily allocated once from the active Three.js objects, including module-based editor previews.
  function resolveSkinnedPixelWorldPosition(avatarRoot, sourcePixel, out = null) {
    const portraitRoot = resolveSkinnedPortraitRoot(avatarRoot);
    if (!portraitRoot) return null;
    const rig = portraitRoot.userData.neckRig;
    const skinnedPlane = rig.skinnedPlane;
    const skeleton = skinnedPlane.skeleton;
    const sourceCanvas = portraitRoot.userData.sourceCanvas;
    const pixelWidth = Number(sourceCanvas?.naturalWidth || sourceCanvas?.width);
    const pixelHeight = Number(sourceCanvas?.naturalHeight || sourceCanvas?.height);
    const modelWidth = Number(portraitRoot.userData?.portraitModelWidth);
    const modelHeight = Number(portraitRoot.userData?.portraitModelHeight);
    const pixelX = Number(sourcePixel?.x);
    const pixelY = Number(sourcePixel?.y);
    if (![pixelWidth, pixelHeight, modelWidth, modelHeight, pixelX, pixelY].every(Number.isFinite)
      || pixelWidth <= 0 || pixelHeight <= 0 || modelWidth <= 0 || modelHeight <= 0) return null;
    const renderedPixelX = portraitsFlipped ? pixelWidth - pixelX : pixelX; // Used below so authored attachment landmarks mirror with the UV-flipped portrait.

    const localPoint = out || new THREE.Vector3(); // Optional caller-owned output avoids per-frame vector allocations.
    localPoint.set(
      -modelWidth / 2 + (renderedPixelX / pixelWidth) * modelWidth,
      modelHeight / 2 - (pixelY / pixelHeight) * modelHeight,
      0,
    );
    const authoredNeckY = Number(rig.neckLocal?.y); // The skinned geometry stores the authoritative pivot even when an editor shim only exposes the bones.
    const geometryNeckY = Number(skinnedPlane.geometry?.userData?.neckLocal?.y); // Same Y passed to buildSkinnedPlaneGeometry when the mesh was constructed.
    const neckY = Number.isFinite(authoredNeckY) ? authoredNeckY
      : Number.isFinite(geometryNeckY) ? geometryNeckY : 0; // Never silently recenter a real neck at zero because a wrapper omitted neckLocal.
    const blendHeight = Number(skinnedPlane.geometry?.userData?.blendHeight) || neckBlendBand(neckY, modelHeight, pixelHeight).height; // Exact GPU band, also across mesh-density rebuilds.
    let headWeight = neckBlendWeight(localPoint.y, neckY, blendHeight); // CPU landmarks and head attachments must follow the painted GPU neck.

    // updateMatrixWorld (not only updateWorldMatrix) is intentional here:
    // SkinnedMesh's override refreshes bindMatrixInverse in attached bind mode,
    // exactly as the renderer does before evaluating the skinning shader.
    portraitRoot.updateWorldMatrix?.(true, false); // Pose callers may have changed an ancestor facing/scale before the render traversal.
    portraitRoot.updateMatrixWorld?.(true);
    skinnedPlane.updateMatrixWorld?.(true);
    skeleton.update?.();

    pixelPositionScratch ||= { // Reused across sequential pixel queries; every caller keeps its own returned/output vector.
      bindPoint: localPoint.clone(), deformed: localPoint.clone(), bonePoint: localPoint.clone(), boneMatrix: skinnedPlane.bindMatrix.clone(),
    };
    const { bindPoint, deformed, bonePoint, boneMatrix } = pixelPositionScratch; // Shared internal scratch never escapes this resolver.
    bindPoint.copy(localPoint).applyMatrix4(skinnedPlane.bindMatrix);
    deformed.set(0, 0, 0);
    const splineLayout = skeleton.bones.length > 8; // Seven spine bones, then optionally a separate nonrotating head-placement bone.
    const splitOffset = !!rig.headOffsetJoint && skeleton.bones.length > 9; // Current gameplay portrait has 10 bones; older 2/9-bone fixtures still work.
    const authorOffset = !!rig.headOffsetJoint && skeleton.bones.length === 3; // Animation Author: root(0), head placement(1), rotating neck(2).
    const hasPlacement = splitOffset || authorOffset; // CPU landmarks must follow whichever actual GPU weight indices the portrait uses.
    const offsetBone = splitOffset ? 7 : authorOffset ? 1 : -1;
    const neckBone = splitOffset ? 8 : authorOffset ? 2 : splineLayout ? 7 : 1;
    const headBone = splitOffset ? 9 : authorOffset ? 2 : splineLayout ? 8 : 2;
    const headScaleWeight = rig.headScaleJoint && skeleton.bones.length > headBone
      ? headScaleWeightAt(localPoint.y, neckY, modelHeight, renderedPixelX, rig.headBoundsPx, headWeight, blendHeight) : 0; // Same horizontal head gate as GPU.
    const spline = pixelPositionScratch.spline ||= { a: 0, b: 0, wb: 0 }; // Reusable CPU scratch, keeping mobile shoulder-pet probes allocation-free.
    spline.a = 0; spline.b = 0; spline.wb = 0;
    if (splineLayout) (typeof window !== 'undefined' ? window.HobunjiCharacterSpine : null)?.nodeWeightsAt?.(localPoint.y, Number.isFinite(rig.spineBase?.y) ? rig.spineBase.y : neckY, modelHeight, rig.spinePosteriorY, spline);
    const offsetWeight = hasPlacement ? (headWeight > 0
      ? 1 - headWeight : authorOffset ? headOffsetWeightAt(localPoint.y, neckY, modelHeight, blendHeight) : 0) : 0; // The shared 10-bone GPU gives the entire torso-to-neck region to the spine; preserve the legacy author's separate 3-bone broad placement.
    headWeight = hasPlacement ? headWeight : Math.max(headWeight, headScaleWeight); // Legacy meshes retain their original two/three-bone projection.
    const bodyWeight = 1 - headWeight - offsetWeight;
    for (let i = 0; i < Math.min(headBone + 1, skeleton.bones.length); i++) {
      const weight = hasPlacement && i === offsetBone ? offsetWeight
        : i === neckBone ? headWeight - headScaleWeight : i === headBone ? headScaleWeight
          : (i === spline.a ? bodyWeight * (1 - spline.wb) : 0) + (i === spline.b ? bodyWeight * spline.wb : 0); // Pixel probes reproduce whichever four GPU influences this vertex has.
      if (!weight) continue;
      if (skeleton.boneMatrices?.length >= (i + 1) * 16) {
        boneMatrix.fromArray(skeleton.boneMatrices, i * 16);
      } else {
        const bone = skeleton.bones[i];
        const boneInverse = skeleton.boneInverses?.[i];
        if (!bone || !boneInverse) continue;
        bone.updateWorldMatrix?.(true, false);
        boneMatrix.multiplyMatrices(bone.matrixWorld, boneInverse);
      }
      bonePoint.copy(bindPoint).applyMatrix4(boneMatrix);
      deformed.addScaledVector(bonePoint, weight);
    }
    localPoint.copy(deformed).applyMatrix4(skinnedPlane.bindMatrixInverse);
    return skinnedPlane.localToWorld(localPoint);
  }

  // Builds the live local frame at an authored portrait pixel by sampling
  // neighboring pixels through the exact same CPU skinning path. This keeps
  // shoulder-pet orientation consistent with the deformed PNG surface rather
  // than assuming the neck bone is the whole attachment frame.
  function resolveSkinnedPixelWorldFrame(avatarRoot, sourcePixel) {
    const center = resolveSkinnedPixelWorldPosition(avatarRoot, sourcePixel);
    if (!center) return null;
    const pixelX = Number(sourcePixel?.x);
    const pixelY = Number(sourcePixel?.y);
    if (![pixelX, pixelY].every(Number.isFinite)) return null;
    const sample = (x, y) => resolveSkinnedPixelWorldPosition(avatarRoot, { x, y });
    const left = sample(pixelX - 1, pixelY);
    const right = sample(pixelX + 1, pixelY);
    const down = sample(pixelX, pixelY + 1);
    const up = sample(pixelX, pixelY - 1);
    if (!left || !right || !down || !up) return null;

    const tangent = right.clone().sub(left);
    const vertical = up.clone().sub(down);
    if (tangent.lengthSq() < 1e-10 || vertical.lengthSq() < 1e-10) return null;
    tangent.normalize();
    vertical.addScaledVector(tangent, -vertical.dot(tangent));
    if (vertical.lengthSq() < 1e-10) return null;
    vertical.normalize();
    const normal = tangent.clone().cross(vertical).normalize();
    const basis = new THREE.Matrix4().makeBasis(tangent, vertical, normal);
    return {
      position: center,
      quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
      tangent,
      vertical,
      normal,
    };
  }

  // Authored luminous pixels are baked through the canonical portrait pipeline.
  // Their small fake-light data source follows the same neck/head transform;
  // no animation loop or real WebGL lighting is introduced.
  const portraitThreeByRoot = new WeakMap();
  const portraitGlowModels = new Set();
  const portraitGlowAttachments = new WeakMap();
  function syncPortraitGlow(THREE, root, sourceCanvas) {
    const glows = sourceCanvas?.hobunjiPortraitGlows || (sourceCanvas?.hobunjiPortraitGlow ? [sourceCanvas.hobunjiPortraitGlow] : []); // One per glowing mass (each eye).
    let lights = root.userData.portraitGlowLights || (root.userData.portraitGlowLights = []);
    while (lights.length > glows.length) { const extra = lights.pop(); extra.parent?.remove(extra); extra.dispose?.(); }
    if (!glows.length) {
      root.userData.portraitGlowLight = null;
      portraitGlowModels.delete(root);
      return;
    }
    const width = root.userData.portraitModelWidth;
    const height = root.userData.portraitModelHeight;
    const assemblyY = root.userData.visualCentroidLocalY || 0;
    const anchorZ = root.userData.visualCentroidLocalZ || 0;
    const rig = root.userData.neckRig;
    const attachment = portraitGlowAttachments.get(root);
    portraitGlowModels.add(root);
    glows.forEach((glow, index) => {
      let light = lights[index];
      if (!light) {
        light = new THREE.PointLight(glow.color, glow.intensity || 3.5, glow.radius || 0.65);
        light.name = index ? `Portrait_Dye3_Mote_Light_${index + 1}` : 'Portrait_Dye3_Mote_Light';
        light.userData.furnitureLightMask = true;
        light.userData.intentionalFakeLightSource = true;
        light.layers.set(31); // Also stays overlay-only in editors without the registry bridge.
        light.castShadow = false;
        lights[index] = light;
      }
      light.userData.emissiveOrb = { radius: 0.085 * (glow.orbScale || 1) }; // Also drawn as a glowing circle above darkness and fog (js/emissive-light-orbs.js); the fake-light aura around it is unchanged.
      light.color.set(glow.color);
      light.intensity = glow.intensity || 3.5;
      light.distance = glow.radius || 0.65;
      const x = ((portraitsFlipped ? 1 - glow.x : glow.x) - 0.5) * width;
      if (attachment) {
        attachment.parent.add(light);
        light.position.set(x - attachment.offset.x, assemblyY + (0.5 - glow.y) * height - attachment.offset.y, anchorZ - attachment.offset.z);
      } else if (rig?.available) {
        rig.headScaleJoint.add(light);
        light.position.set(x - rig.neckLocal.x, (0.5 - glow.y) * height - rig.neckLocal.y, anchorZ - rig.neckLocal.z);
      } else {
        root.add(light);
        light.position.set(x, assemblyY + (0.5 - glow.y) * height, anchorZ);
      }
      window.FurnitureLightRegistry?.register(light);
    });
    root.userData.portraitGlowLight = lights[0] || null; // First mass, kept for callers that expect one light.
  }

  function setPortraitGlowAttachment(root, parent, offset = {x:0,y:0,z:0}) {
    if(!root)return;
    if(parent)portraitGlowAttachments.set(root,{parent,offset:{...offset}});
    else portraitGlowAttachments.delete(root);
    syncPortraitGlow(portraitThreeByRoot.get(root),root,root.userData.sourceCanvas);
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
    const childDimensions = childScaleFor(options); // A vertical height factor still owns the original shared portrait scale.
    const modelWidth = baseModelWidth * scaleMultiplier * (childDimensions ? childDimensions.width / childDimensions.height : 1); // Independently widen/narrow children without changing floor-to-head height.
    const modelHeight = baseModelHeight * scaleMultiplier;
    const legacyConfiguredArmLength = Number(options.armLength ?? options.profile?.fighter?.armLength); // Retained only as a fallback for old profiles that predate attachment-rig anatomy.
    const legacyArmLength = Number.isFinite(legacyConfiguredArmLength) && legacyConfiguredArmLength > 0 ? legacyConfiguredArmLength : null;
    const speciesId = options.speciesId ?? options.profile?.fighter?.speciesId ?? avatarSpeciesAndGender(options).species ?? null;
    const gender = options.gender ?? options.profile?.fighter?.gender ?? null;
    const headGate = (options.npcRecord || options.profile?.npcRecord)
      ? npcHeadGateFor(speciesId, options.headGate)
      : options.headGate; // NPC-specific overrides remain intact; players now receive the same legacy default via defaultHeadGateFor.
    const orbitScaler = window.HobunjiSpeciesPoseScale;
    const configuredOrbit = options.poseOrbitScale ?? options.profile?.fighter?.poseOrbitScale; // A number, or per-axis { x, y, z }.
    const fallbackOrbit = legacyArmLength ? legacyArmLength / 0.558 : 1;
    // Explicit species+gender weapon orbit is independent from anatomy; old armLength is only a fallback.
    const poseOrbitAxes = orbitScaler?.axesFromValue?.(configuredOrbit)
      ?? orbitScaler?.resolveAxes?.(speciesId, gender, legacyArmLength)
      ?? { x: fallbackOrbit, y: fallbackOrbit, z: fallbackOrbit };
    const poseOrbitScale = poseOrbitAxes.x; // Scalar compatibility view of the authoring orbit; numeric values are spherical on all axes.
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
    const handAlphaThreshold = cfg().handAttachAlphaThreshold;
    const vBounds = scanOpaqueVerticalBounds(sourceCanvas, handAlphaThreshold); // Scanned before the skin so the spine chain can start at the same posterior the legs use (it needs the hand anchor below).
    const handAttachRowY = vBounds ? vBounds.bottom : Math.round(placementRatio * pxH);
    const handAttachYEarly = modelHeight * (0.5 + placementRatio - handAttachRowY / pxH);
    // Neck rig is opt-in (options.neckRig === true) — most callers (world
    // livestock, bandits, one-off portrait previews) have no use for a
    // head-turn bone and building one costs an extra alpha scan + a heavier
    // SkinnedMesh over the plain two-Mesh assembly. Falls back to the plain
    // rigid assembly if no neck pivot could be detected (e.g. a fully
    // transparent or tainted source canvas).
    const skinnedRig = options.neckRig === true
      ? buildSkinnedSinglePlaneAssembly(THREE, {
          planeWidth: modelWidth, planeHeight: modelHeight, anchorZ, textures, assemblyY, gender, placementRatio, handAttachY: handAttachYEarly,
          sourceCanvas, backCanvas: options.backCanvas || options.backImage || null,
          headCanvas: options.headCanvas, alphaThreshold: options.neckAlphaThreshold,
          speciesId, headGate,
          cosmeticIds: options.cosmeticIds || ['mask', 'hat', 'hood', 'upperFace', 'facialHair'].map(key => options.profile?.[key]?.id).filter(Boolean), // Worn pieces that can override the species head gate.
          name: `${root.name}_skinned_plane_assembly`, meshBudget: options.meshBudget, freezePortrait: !!(options.npcRecord || options.profile?.npcRecord),
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
          available: true, headOffsetJoint: skinnedRig.headOffsetJoint, neckJoint: skinnedRig.neckJoint, headScaleJoint: skinnedRig.headScaleJoint, splineNodes: skinnedRig.splineNodes, spinePosteriorY: skinnedRig.spinePosteriorY, spineBase: skinnedRig.spineBase, shoulderLocalY: skinnedRig.shoulderLocalY,
          skinnedPlane: skinnedRig.skinnedPlane, neckLocal: skinnedRig.neckLocal,
          pivotPx: skinnedRig.pivotPx, headCentroidPx: skinnedRig.headCentroidPx,
          headCentroidLocal: skinnedRig.headCentroidLocal, headBoundsPx: skinnedRig.headBoundsPx,
          detectionMethod: skinnedRig.detectionMethod, coverageMode: skinnedRig.coverageMode,
          planeBoundsPx: skinnedRig.planeBoundsPx,
        }
      : { available: false };
    root.userData.portraitVerticalPlacementRatio = placementRatio;
    root.userData.portraitScaleMultiplier = scaleMultiplier;
    root.userData.childBodyAxes = childDimensions ? { width: childDimensions.width, height: childDimensions.height } : null; // Readable mobile diagnostic, not another frame update.
    root.userData.portraitModelWidth = modelWidth;
    root.userData.portraitModelHeight = modelHeight;
    root.userData.speciesId = speciesId;
    root.userData.headGate = headGate || defaultHeadGateFor(speciesId); // Mobile debug inspection of the head-scale mode selected at build time.
    root.userData.gender = gender;
    root.userData.armLength = legacyArmLength; // Replaced below after handAttachY exists and rigger-derived anatomy can resolve.
    root.userData.scaledArmLength = legacyArmLength; // Same temporary fallback; concrete gameplay-space reach must not be height-scaled a second time.
    root.userData.poseOrbitAxes = poseOrbitAxes; // Per-axis { x, y, z } orbit: what pose consumers should pass to HobunjiSpeciesPoseScale.
    root.userData.poseOrbitScale = poseOrbitScale; // Explicit species+gender weapon pose radius multiplier authored independently from anatomy.
    root.userData.visualCentroidLocalX = 0; // Visible portrait-plane centroid inside this root.
    root.userData.visualCentroidLocalY = assemblyY; // Root zero is not generally the visual centroid because the assembly is vertically shifted.
    root.userData.visualCentroidLocalZ = anchorZ;
    root.userData.poseCentroidX = 0; // Floor-relative body-frame centroid for tool pose consumers.
    root.userData.poseCentroidY = modelHeight * 0.5 + assemblyY;
    root.userData.poseCentroidZ = anchorZ;
    // Hand/tool attach point: find the actual vertical midpoint of the rendered
    // avatar's opaque pixels (not a row inferred from portraitVerticalPlacementRatio,
    // which encodes per-species/gender padding tuned for plane-grounding, not hand
    // height), then scan that row from the left edge for the first opaque pixel —
    // the right-arm sprite's outer edge. Gives a per-species/gender-accurate X
    // instead of the coarse -modelWidth/2 guess.
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
    root.userData.handAttachY = handAttachYEarly;
    const rigProfile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${speciesId}::${gender}`] || null;
    const rigMath = window.HOBUNJI_ATTACHMENT_RIG_MATH;
    const rigArmLength = rigMath?.characterArmLength?.(rigProfile, modelHeight, root.userData.handAttachY, null, scaleMultiplier, placementRatio);
    const leftArmLength = rigMath?.characterArmLength?.(rigProfile, modelHeight, root.userData.handAttachY, 'left', scaleMultiplier, placementRatio);
    const rightArmLength = rigMath?.characterArmLength?.(rigProfile, modelHeight, root.userData.handAttachY, 'right', scaleMultiplier, placementRatio);
    const resolvedArmLength = Number.isFinite(rigArmLength) && rigArmLength > 0 ? rigArmLength : legacyArmLength;
    root.userData.armLength = resolvedArmLength; // Character-rig-derived rendered reach; old species JSON is fallback only.
    root.userData.scaledArmLength = resolvedArmLength; // Already in this avatar's local rendered coordinate space.
    root.userData.armLengthBySide = {
      left: Number.isFinite(leftArmLength) && leftArmLength > 0 ? leftArmLength : resolvedArmLength,
      right: Number.isFinite(rightArmLength) && rightArmLength > 0 ? rightArmLength : resolvedArmLength,
    };
    root.userData.armLengthSource = Number.isFinite(rigArmLength) && rigArmLength > 0 ? 'attachment-rig-shoulder-to-resting-wrist' : 'legacy-species-config';
    root.add(assembly);
    root.userData.sourceCanvas = sourceCanvas;
    root.userData.backCanvas = options.backCanvas || options.backImage || null;
    root.userData.frontTexture = textures.frontOriginal;
    root.userData.backTexture = textures.backForOriginal;
    root.userData.backTextureUsesSilhouette = !(options.backCanvas || options.backImage);
    portraitThreeByRoot.set(root, THREE);
    syncPortraitGlow(THREE, root, sourceCanvas);
    return root;
  }

  function refreshSinglePlaneAvatarModel(root, sourceCanvas, options = {}) {
    if (!root?.userData?.frontTexture) return false;
    const nextSource = sourceCanvas || root.userData.sourceCanvas;
    if (!nextSource) return false;
    root.userData.sourceCanvas = nextSource;
    drawVariantCanvas(root.userData.frontTexture.image, nextSource);
    root.userData.frontTexture.needsUpdate = true;
    syncPortraitGlow(portraitThreeByRoot.get(root), root, nextSource);

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
    portraitGlowModels.delete(root);
    for (const glowLight of root.userData?.portraitGlowLights || []) { glowLight.parent?.remove(glowLight); glowLight.dispose?.(); }
    if (root.userData) { root.userData.portraitGlowLights = []; root.userData.portraitGlowLight = null; }
    root.traverse(child => {
      unregisterSkinnedPortrait(child); // Disposed preview/player rigs leave the live-density registry immediately.
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
    setPortraitGlowAttachment,
    PORTRAIT_FLIP_STORAGE_KEY,
    backMapFor,
    enableSharedFaceMirror,
    makeVariantCanvas,
    refreshSinglePlaneAvatarModel,
    buildAnimalPlaneAvatarModel,
    animalSourceTextureSnapshot: () => {
      let avatars = 0; // Counts live references without retaining an avatar registry.
      for (const entry of animalSourceTextures.values()) avatars += entry.refs;
      return { sourcePairs: animalSourceTextures.size, avatars };
    },
    buildSinglePlaneAvatarModel,
    avatarPlacementRatioFor,
    avatarScaleMultiplierFor,
    isChildAvatar,
    childScaleFor,
    disposeAvatarModel,
    loadThreeModules,
    scanOpaqueVerticalBoundsOfImage,
    detectNeckPivotPx,
    detectHeadRigPixels,
    neckBlendBand,
    neckBlendWeight,
    headOffsetWeightAt,
    neckBlendRows,
    upgradePlaneToAutoNeckSkin,
    meshBudget,
    headScaleGateAtPixel,
    headScaleWeightAt,
    headGateBounds,
    defaultHeadGateFor,
    npcHeadGateFor,
    resolveSkinnedPortraitRoot,
    resolveSkinnedPixelWorldPosition,
    resolveSkinnedPixelWorldFrame,
    trackPortraitTexture,
    getPortraitsFlipped: () => portraitsFlipped,
    setPortraitsFlipped,
    getPortraitFlipDebugState: () => ({ enabled: portraitsFlipped, trackedTextureCount: trackedPortraitTextures.size }),
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wirePortraitFlipSetting, { once: true });
    } else {
      wirePortraitFlipSetting();
    }
  }
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

  // Turn the entire sprite region forward of the authored neck pivot as one
  // rigid paper flap. Yaw membership follows the vertical neck fold, not
  // irregular head Influence/Compressibility/Stretchability paint. Painted
  // weights continue to control pitch; the rear/body region stays unturned.
  // Keep two existing mesh columns near the vertical hinge without adding vertices.
  function alignAnimalYawFoldColumns(geometry, pivotU, mirrorX, segmentsX, segmentsY, width) {
    const position = geometry.getAttribute('position'); // Columns are moved to the crisp crease without allocating another mesh.
    const uv = geometry.getAttribute('uv'); // Keep texture coordinates aligned with the displaced columns.
    if (!position?.setX || !uv?.setX || segmentsX < 3) return;
    const pivot = clamp(pivotU, 0.001, 0.999); // Both faces divide columns in the same source sprite space.
    const halfWidth = Math.min(0.003, pivot * 0.25, (1 - pivot) * 0.25); // A nearly one-pixel-wide narrow fold.
    const leftColumn = clamp(Math.round(pivot * (segmentsX - 1)), 1, segmentsX - 2); // Face-side column of the crease.
    for (let col = 0; col <= segmentsX; col++) {
      const sourceCol = mirrorX ? segmentsX - col : col; // Reverse the same grid so rounding cannot shift the back face's crease.
      const sourceU = sourceCol <= leftColumn
        ? (pivot - halfWidth) * sourceCol / leftColumn
        : pivot + halfWidth + (1 - pivot - halfWidth) * (sourceCol - leftColumn - 1) / (segmentsX - leftColumn - 1);
      const u = mirrorX ? 1 - sourceU : sourceU; // Local UV and position for the current face.
      for (let row = 0; row <= segmentsY; row++) {
        const index = row * (segmentsX + 1) + col;
        position.setX(index, (u - 0.5) * width);
        uv.setX(index, u);
      }
    }
    position.needsUpdate = true;
    uv.needsUpdate = true;
  }

  function buildAnimalWeightedGeometry(THREE, sourceGeometry, rig, mirrorX, fallbackDimensions = {}, gridOverride = null, spriteWarp = null) {
    const params = sourceGeometry?.parameters || {}; // Legacy PlaneGeometry dimensions used to preserve exact animal scale.
    const width = finite(params.width, finite(fallbackDimensions.width, 1));
    const height = finite(params.height, finite(fallbackDimensions.height, 1));
    const mapAspect = rig.weightMap ? rig.weightMap.width / Math.max(1, rig.weightMap.height) : width / Math.max(0.0001, height);
    const grid = gridOverride || window.PNGPlaneAvatar?.meshBudget?.animalGrid?.(rig.meshResolution, mapAspect); // The same per-axis density is used at spawn and by live developer retessellation.
    const maxSeg = Math.min(rig.meshResolution, window.PNGPlaneAvatar?.meshBudget?.table?.npc?.animalSegments ?? 30); // Legacy standalone preview fallback when the shared budget has not loaded.
    const segmentsX = grid?.segmentsX ?? (mapAspect >= 1 ? maxSeg : Math.max(8, Math.round(maxSeg * mapAspect)));
    const segmentsY = grid?.segmentsY ?? (mapAspect >= 1 ? Math.max(8, Math.round(maxSeg / mapAspect)) : maxSeg);
    const geometry = new THREE.PlaneGeometry(width, height, segmentsX, segmentsY); // Paint and shoulder maps sample unchanged normalized UVs at the smaller grid.
    const renderedPivot = spriteWarp?.destinationFor?.(rig.pivot) || rig.pivot; // Baby/Small sprite warp moves the fold with the visible head.
    const pivotU = clamp(finite(renderedPivot.x, rig.pivot.x), 0, 1); // Source-side neck X, not the painted head silhouette.
    alignAnimalYawFoldColumns(geometry, pivotU, mirrorX, segmentsX, segmentsY, width);
    const indices = geometry.index?.array; // Mirror the quad diagonals along with UVs so both faces interpolate the same skin.
    if (mirrorX && indices) {
      for (let i = 0; i < indices.length; i += 6) {
        const a = indices[i], c = indices[i + 4]; // Three PlaneGeometry emits [a,b,d, b,c,d].
        indices[i + 2] = c;
        indices[i + 3] = a;
      }
    }
    const uv = geometry.getAttribute('uv');
    const skinIndices = new Uint16Array(uv.count * 4); // Root/pitch/yaw/combined bone indices for every plane vertex.
    const skinWeights = new Float32Array(uv.count * 4); // Graded Influence controls pitch; the neck-forward half-plane controls yaw.
    const sourceCoordinates = spriteWarp ? new Float32Array(uv.count * 2) : null; // Keep original rig-paint UVs alongside the rendered sprite UVs.
    const source = {}; // Reused for each vertex when sampling the baby pixel warp.
    for (let i = 0; i < uv.count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i); // Reverse-facing plane samples the horizontally mirrored authored map.
      const sourceTopV = 1 - uv.getY(i); // Author coordinates start at sprite top-left; Three UVs start bottom-left.
      if (sourceCoordinates) {
        spriteWarp.sourceAt(sourceU, sourceTopV, source);
        sourceCoordinates[i * 2] = source.x;
        sourceCoordinates[i * 2 + 1] = source.y;
      }
      const headWeight = sampleWeight(rig, sourceCoordinates ? source.x : sourceU, sourceCoordinates ? source.y : sourceTopV); // Irregular Influence remains pitch-only.
      const yawWeight = sourceU < pivotU ? 1 : 0; // Rendered-space neck seam stays rigid, including mirrored and baby-warped art; paint is pitch-only.
      const offset = i * 4;
      skinIndices[offset] = 0;
      skinIndices[offset + 1] = 1;
      skinIndices[offset + 2] = 2;
      skinIndices[offset + 3] = 3;
      skinWeights[offset] = (1 - headWeight) * (1 - yawWeight); // Unturned body, no pitch.
      skinWeights[offset + 1] = headWeight * (1 - yawWeight); // Authored pitch outside the yaw fold.
      skinWeights[offset + 2] = (1 - headWeight) * yawWeight; // Rigid yaw for head-owned pixels, including pitch-neutral pixels.
      skinWeights[offset + 3] = headWeight * yawWeight; // Combined yaw then authored pitch, retaining nods.
    }
    if (sourceCoordinates) geometry.setAttribute('hobunjiRigSourceUv', new THREE.Float32BufferAttribute(sourceCoordinates, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.segmentsX = segmentsX; geometry.userData.segmentsY = segmentsY; // Shared density controller compares actual live geometry without a duplicate animal-specific rule.
    geometry.userData.hobunjiAnimalWeightRig = { segmentsX, segmentsY }; // Visible to debug tooling without relying on console-only state.
    geometry.userData.hobunjiAnimalYawFold = true; // Material-response adapter must preserve the separate yaw skin weights.
    geometry.userData.hobunjiAnimalYawMask = 'neck-forward-card'; // Debug identifies the paint-independent vertical hinge across the entire forward sprite region.
    geometry.userData.hobunjiAnimalYawFoldPivotX = pivotU; // Pixel Probe/debugging can inspect the neck hinge on warped sprites.
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
    const headBone = new THREE.Bone(); // Pitch only: authored irregular weight map still controls nods.
    headBone.name = `${plane.name}_head_bone`;
    const yawBone = new THREE.Bone(); // Rigid card fold: only head-owned pixels rotate around the neck's vertical hinge.
    yawBone.name = `${plane.name}_yaw_bone`;
    const combinedBone = new THREE.Bone(); // Yaw applied after pitch preserves both motions on shared vertices.
    combinedBone.name = `${plane.name}_pitch_yaw_bone`;
    const pivotU = mirrorX ? 1 - rig.pivot.x : rig.pivot.x;
    const params = plane.geometry.parameters || {};
    const planeWidth = finite(params.width, finite(fallbackDimensions.width, 1)); // Keeps the mirrored head pivot in the same model dimensions when cloned geometry lacks parameters.
    const planeHeight = finite(params.height, finite(fallbackDimensions.height, 1)); // Matches the front card's authored height on the reverse card.
    headBone.position.set((pivotU - 0.5) * planeWidth, (0.5 - rig.pivot.y) * planeHeight, 0);
    yawBone.position.copy(headBone.position);
    combinedBone.position.copy(headBone.position);
    torsoBone.add(headBone);
    torsoBone.add(yawBone);
    torsoBone.add(combinedBone);

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
    const skeleton = new THREE.Skeleton([torsoBone, headBone, yawBone, combinedBone]);
    skinned.bind(skeleton);
    return { mesh: skinned, weightedGeometry, skeleton, headBone, yawBone, combinedBone };
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
    // The compositor, mist-depth occluder and mobile Pixel Probe must address
    // the visible skinned cards, not the rigid meshes removed from this group.
    avatarRef.frontPlane = front.mesh;
    avatarRef.backPlane = back.mesh;

    const legacyDispose = typeof avatarRef.dispose === 'function' ? avatarRef.dispose.bind(avatarRef) : null; // Preserves legacy texture/material/old-geometry cleanup.
    const state = {
      rig, frontHeadBone: front.headBone, backHeadBone: back.headBone,
      frontYawBone: front.yawBone, backYawBone: back.yawBone,
      frontCombinedBone: front.combinedBone, backCombinedBone: back.combinedBone,
      yawMode: 'paper-fold', // Mobile diagnostics and corpse rendering identify the independent yaw axis.
      yawMask: 'neck-forward-card', // The forward side of the authored neck pivot rotates together, independent of all painted material maps.
      currentDeg: rig.restDeg, targetDeg: rig.restDeg, additiveDeg: 0, appliedDeg: rig.restDeg,
      currentYawDeg: 0, targetYawDeg: 0,
    }; // Runtime rotation state shared by base-pose setters, additive animation layers, and the yaw axis.
    group.userData.hobunjiAnimalHeadRig = state;
    avatarRef.headRig = state;

    const applyDegrees = degrees => {
      const composedDeg = clamp(degrees + state.additiveDeg, rig.minDeg, rig.maxDeg); // Keeps additive nods inside the authored neck's safe range.
      state.appliedDeg = composedDeg;
      // This rig's own actual convention (confirmed via the vocalization
      // head-nod, animal-vocalizations.js's VOCAL_NOD_UP_DEG = -10 through
      // an always-non-negative envelope, i.e. always a negative
      // additiveDeg, and it visibly nods UP) is negative degrees = up,
      // positive = down. The look-at-player pitch callers in game.js and
      // grehlr's own authored eating/fishing pitch constants were written
      // assuming the opposite, so they render backwards — fixed at each of
      // those call sites instead of here, since flipping the sign in this
      // shared function would also flip the nod, which is correct as-is.
      front.headBone.rotation.z = composedDeg * RAD;
      back.headBone.rotation.z = -composedDeg * RAD;
      front.combinedBone.rotation.z = front.headBone.rotation.z;
      back.combinedBone.rotation.z = back.headBone.rotation.z;
      return composedDeg;
    };
    applyDegrees(rig.restDeg);
    front.mesh.userData.hobunjiPortraitRestPitch = rig.restDeg * RAD;
    back.mesh.userData.hobunjiPortraitRestPitch = -rig.restDeg * RAD;

    // Yaw ("shaking its head" side-to-side) is a separate axis from the
    // pitch/nod bone rotation.z above — the yaw bone's local Y, which
    // (since the plane itself is already rotated ±90° about Y to face the
    // camera) reads on-screen as a left/right turn rather than an up/down
    // nod. NOT mirrored between front/back the way applyDegrees' pitch is:
    // pitch is an in-plane roll (rotation about the card's own normal),
    // which reverses handedness under the back card's horizontal UV flip
    // (backTex.repeat.set(-1,1)), so mirroring the sign is what keeps a nod
    // reading as the same real-world up/down direction from either card.
    // Yaw has no such reversal — front and back share the same world-space
    // vertical (Y) rotation axis regardless of which card is currently
    // camera-facing — so driving both with the SAME sign is what keeps them
    // turning in tandem instead of away from each other.
    // No authored yawMinDeg/yawMaxDeg exists on the rig today, so this
    // reuses the same authored minDeg/maxDeg magnitude (already tuned per
    // species for a readable head motion) rather than inventing a second range.
    const yawLimitDeg = Math.max(Math.abs(rig.minDeg), Math.abs(rig.maxDeg));
    const applyYawDegrees = degrees => {
      front.yawBone.rotation.y = degrees * RAD;
      back.yawBone.rotation.y = degrees * RAD;
      front.combinedBone.rotation.y = degrees * RAD;
      back.combinedBone.rotation.y = degrees * RAD;
    };

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

    avatarRef.updateHeadYaw = (degrees, deltaSeconds) => {
      const target = clamp(finite(degrees, 0), -yawLimitDeg, yawLimitDeg); // Smoothed yaw target, same turn-speed budget as the pitch axis.
      const delta = Math.max(0, finite(deltaSeconds, 0));
      const step = rig.turnSpeedDeg * delta;
      const diff = target - state.currentYawDeg;
      state.currentYawDeg += clamp(diff, -step, step);
      state.targetYawDeg = target;
      applyYawDegrees(state.currentYawDeg);
      return state.currentYawDeg;
    };

    avatarRef.setHeadAdditiveRotation = degrees => {
      state.additiveDeg = finite(degrees, 0); // Consumed by applyDegrees on top of whichever AI/attack/idle neck pose is current.
      return applyDegrees(state.currentDeg);
    };

    let disposed = false; // A creature can be retired by both the wildlife despawner and the save/load teardown.
    let spriteWarp = null; // Per-avatar mapping, activated only when warped artwork is bound.
    let pivotTranslation; // Updates the stored inverse bind without resetting animated head angles.
    function refreshDependentGeometry() {
      avatarRef.refreshShoulderRestGeometry?.();
      avatarRef.refreshHeadMaterialGeometry?.();
    }
    function rebuildFace(sourcePlane, mirrorX, grid) {
      return buildAnimalWeightedGeometry(THREE, sourcePlane.geometry, rig, mirrorX, canonicalDimensions, grid, spriteWarp);
    }
    avatarRef.setAnimalSpriteWarp = warp => {
      const next = warp || null;
      if (spriteWarp === next || disposed) return false;
      spriteWarp = next;
      const pivot = next?.destinationFor(rig.pivot) || rig.pivot;
      pivotTranslation ||= new THREE.Matrix4();
      state.spritePivot = next ? pivot : null; // Head material response uses the current rendered pivot for pitch.
      for (const [face, sourcePlane, mirrorX] of [[front, frontPlane, false], [back, backPlane, true]]) {
        const x = ((mirrorX ? 1 - pivot.x : pivot.x) - 0.5) * canonicalDimensions.width;
        const y = (0.5 - pivot.y) * canonicalDimensions.height;
        for (const [index, bone] of [[1, face.headBone], [2, face.yawBone], [3, face.combinedBone]]) {
          face.skeleton.boneInverses[index].premultiply(pivotTranslation.makeTranslation(bone.position.x - x, bone.position.y - y, 0));
          bone.position.set(x, y, 0); // All three bones must follow the baby warp's visible hinge, not just pitch.
        }
        const previous = face.mesh.geometry;
        meshBudget?.invalidateFrozenPortrait?.(face.mesh); // A hidden warped sprite can still own old baked GPU buffers.
        face.mesh.geometry = rebuildFace(sourcePlane, mirrorX, resolveGrid());
        previous.dispose();
      }
      refreshDependentGeometry();
      return true;
    };

    const meshBudget = window.PNGPlaneAvatar?.meshBudget; // Shared developer density and weak tracking also own the animal head-rig mesh lifecycle.
    const sourceAspect = rig.weightMap ? rig.weightMap.width / Math.max(1, rig.weightMap.height)
      : canonicalDimensions.width / Math.max(0.0001, canonicalDimensions.height); // Same source aspect used by buildAnimalWeightedGeometry.
    const resolveGrid = () => meshBudget?.animalGrid?.(rig.meshResolution, sourceAspect); // Recomputed when the slider changes, without reauthoring the rig.
    meshBudget?.registerExternalSkinnedPortrait?.(front.mesh, {
      THREE, width: canonicalDimensions.width, height: canonicalDimensions.height, animal: true, freeze: true, resolveGrid,
      buildGeometry: grid => rebuildFace(frontPlane, false, grid),
      afterGeometryChange: refreshDependentGeometry,
      onWireframeChanged(enabled) { avatarRef.refreshAnimalWireframe?.(enabled); },
    });
    meshBudget?.registerExternalSkinnedPortrait?.(back.mesh, {
      THREE, width: canonicalDimensions.width, height: canonicalDimensions.height, animal: true, freeze: true, resolveGrid,
      buildGeometry: grid => rebuildFace(backPlane, true, grid),
    });
    avatarRef.dispose = () => {
      if (disposed) return;
      disposed = true;
      meshBudget?.unregisterSkinnedPortrait?.(front.mesh);
      meshBudget?.unregisterSkinnedPortrait?.(back.mesh);
      front.mesh.geometry.dispose(); // Dispose the CURRENT geometry, not the original buffer retired by a live slider change.
      back.mesh.geometry.dispose();
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

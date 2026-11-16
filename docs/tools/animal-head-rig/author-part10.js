'use strict';

// Baby head proportions are authored per species, but only the live preview art is warped.
// The source paint, head-rig weight maps, adult sprites, and normal game saves stay unchanged.
const babyHeadScaleSlider = $('babyHeadScale'); // Percentage slider placed next to the animal picker for mobile and desktop.
const babyHeadScaleLabel = $('babyHeadScaleLabel'); // Shows saved override vs inherited Nursery default.
const babyHeadCompareButton = $('babyHeadCompare'); // Before/after comparison without changing the authored value.
const babyHeadPreviewState = $('babyHeadPreviewState'); // Mobile-readable preview state and missing-frame explanation.
const babyHeadWarp = window.BabyAnimalHeadWarp; // Reuses the baby's exact nearest-neighbor runtime pixel warp.
const babyPreviewTextureCache = new WeakMap(); // Reuses one warped raster per source, frame and scale across thousands of mesh triangles.
const prewarpedSplitLayers = new WeakSet(); // Already resized and then clipped; avoids applying the warp a second time after splitting.
const babyPreviewSplitCache = new WeakMap(); // Stores the most recent shoulder split per idle image and source/angle.
const babyPixelDeltaCache = new WeakMap(); // Counts truly modified opaque head pixels once per generated enlarged canvas.
const babyHeadComparisonCanvas = $('babyHeadComparisonCanvas'); // On-screen rig-independent original versus enlarged pixel proof.
const babyHeadPixelDelta = $('babyHeadPixelDelta'); // Reports actual pixel changes so mobile testing never relies on the console.
const babyHeadDebug = { hits: 0, misses: 0, lastSpecies: null, lastError: null, splitsAfterWarp: 0, comparisonPixelChanges: 0 }; // Captured by the in-editor mobile diagnostics.
let authoredBabyHeadScale = null; // Null inherits the Nursery's experimental global default.
let babyPreviewFrame = null; // Frame resolved once per editor draw, not once per mesh triangle.
let babyPreviewFrameSource = 'none'; // Helps distinguish authored chathead boxes from painted-head fallbacks.
let comparingBabyOriginal = false; // Temporary visual toggle; never enters exported rig data.
function readableBabyError(error) {
  const reason = String(error?.message || error || 'unknown pixel-read failure'); // Diagnostic from either local preview or swallowed runtime warp errors.
  return /taint|cross.origin|securityerror/i.test(reason)
    ? 'Sprite pixels are blocked by cross-origin image loading. Reload this updated rigger; if the image host denies CORS, use Choose image to import its PNG locally. (' + reason + ')'
    : reason;
}

function syncBabyHeadScaleControl() {
  const inherited = babyHeadWarp?.getScale?.() || 1.32; // Universal 132% for species without explicit overrides.
  const percent = Math.round((authoredBabyHeadScale ?? inherited) * 100);
  babyHeadScaleSlider.value = String(percent);
  babyHeadScaleLabel.textContent = percent + '%' + (authoredBabyHeadScale == null ? ' · inherited default' : ' · species override');
}

function setAuthoredBabyHeadScale(raw) {
  const percent = Number(raw); // UI percentages are converted to the runtime's unit multiplier.
  authoredBabyHeadScale = Number.isFinite(percent) ? clamp(percent / 100, 1, babyHeadWarp?.MAX_SCALE || 1.45) : null;
  syncBabyHeadScaleControl();
}

function paintedBabyHeadFrame() {
  const bounds = state.weights && headBounds(); // The existing painter already finds its painted Head influence cells.
  if (!bounds || !state.weights) return null;
  const width = state.weights.width, height = state.weights.height;
  const pad = 0.035; // Mirrors AnimalChatheadFrame's existing automatic head-box padding.
  const x0 = clamp(bounds.minX / width - pad, 0, 1);
  const y0 = clamp(bounds.minY / height - pad, 0, 1);
  const x1 = clamp((bounds.maxX + 1) / width + pad, x0, 1);
  const y1 = clamp((bounds.maxY + 1) / height + pad, y0, 1);
  return x1 > x0 && y1 > y0 ? {
    x: x0, y: y0, width: x1 - x0, height: y1 - y0,
    coordinateSpace: 'sprite-normalized-top-left',
  } : null;
}

function resolveBabyPreviewFrame() {
  const species = String($('animalId').value || '').trim().toLowerCase().replace(/_/g, '-'); // Species whose source image is loaded in the editor.
  const chathead = babyHeadWarp?.validateFrame?.(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[species]?.chatheadFrame);
  if (chathead) return { frame: chathead, source: 'opaque idle pixels inside chathead frame' }; // Actual mask excludes transparent cells, even within the box.
  const painted = paintedBabyHeadFrame(); // Custom species without a chathead box may use their authored Head paint fallback.
  if (painted) return { frame: painted, source: 'painted Head influence fallback' };
  const fromRig = babyHeadWarp?.frameForKind?.(species);
  if (fromRig) return { frame: fromRig, source: 'saved/fallback head frame' };
  return { frame: null, source: 'none' };
}

function updateBabyPreviewFeedback() {
  const species = String($('animalId').value || '').trim();
  const percent = Number(babyHeadScaleSlider.value);
  const original = comparingBabyOriginal || percent <= 100;
  const message = !babyHeadWarp
    ? 'The baby head warp script is missing.'
    : !state.image
      ? 'Load an animal sprite to see the effect.'
      : !babyPreviewFrame
        ? 'No head frame: paint Head influence first.'
        : comparingBabyOriginal
          ? 'Showing original · tap again to see the enlarged head.'
          : percent <= 100
            ? 'Showing unmodified 100% artwork.'
            : 'Showing ' + percent + '% baby head · ' + babyPreviewFrameSource + '.';
  babyHeadPreviewState.textContent = message;
  babyHeadCompareButton.textContent = comparingBabyOriginal ? 'Show enlarged version' : 'Show original for comparison';
  babyHeadCompareButton.setAttribute('aria-pressed', String(comparingBabyOriginal));
  $('previewBadge').textContent = Math.round(numberOr($('previewAngle').value, 0)) + '° · ' + (original ? 'Original' : 'Baby ' + percent + '%');
  if (!species && state.image) babyHeadPreviewState.textContent = 'Enter an animal ID to preview this head.';
}

const loadRecordBeforeBabyHead = applyRecord;
applyRecord = function applyRecordWithBabyHeadScale(record, index = -1) {
  const result = loadRecordBeforeBabyHead(record, index);
  const id = String(record?.id || '').trim(); // Key for same-origin saved per-species preview rigs.
  const saved = id ? readPreviewRigs()?.[id] : null;
  const configured = saved?.babyHeadScale ?? record?.headRig?.babyHeadScale;
  authoredBabyHeadScale = typeof configured === 'number' && Number.isFinite(configured)
    ? clamp(configured, 1, babyHeadWarp?.MAX_SCALE || 1.45) : null;
  comparingBabyOriginal = false;
  syncBabyHeadScaleControl();
  requestDraw(); // Update both the enlarged sprite and the comparison status when species changes.
  return result;
};

const exportRigBeforeBabyHead = normalizedRig;
normalizedRig = function normalizedRigWithBabyHeadScale() {
  const rig = exportRigBeforeBabyHead();
  if (!rig) return rig;
  if (authoredBabyHeadScale != null) {
    rig.babyHeadScale = authoredBabyHeadScale; // A per-species value is included in normal exports and Save rig for game preview.
    const species = String($('animalId').value || '').trim().toLowerCase().replace(/_/g, '-');
    const paintedFrame = paintedBabyHeadFrame(); // Preserve the live painted head crop for baby size even when an older dialogue crop exists.
    const savedFrame = state.baseRecord?.headRig?.babyHeadFrame;
    const frame = paintedFrame || babyHeadWarp?.validateFrame?.(savedFrame);
    if (frame) rig.babyHeadFrame = frame;
  } else {
    delete rig.babyHeadScale;
    delete rig.babyHeadFrame; // Unedited species inherit the game's existing authored chathead frame.
  }
  return rig;
};

const captureHistoryBeforeBabyHead = captureHistoryState;
captureHistoryState = function captureHistoryWithBabyHeadScale() {
  return { ...captureHistoryBeforeBabyHead(), babyHeadScale: authoredBabyHeadScale };
};
const historySignatureBeforeBabyHead = historySignature;
historySignature = function historySignatureWithBabyHeadScale(snapshot) {
  return historySignatureBeforeBabyHead(snapshot) + '|babyHeadScale=' + (snapshot?.babyHeadScale ?? 'inherit');
};
const restoreHistoryBeforeBabyHead = restoreHistoryState;
restoreHistoryState = function restoreHistoryWithBabyHeadScale(snapshot) {
  authoredBabyHeadScale = snapshot?.babyHeadScale ?? null;
  syncBabyHeadScaleControl();
  return restoreHistoryBeforeBabyHead(snapshot);
};

// Both classic neck and shoulder-spline preview triangles call this exact texture adapter.
previewImageForAnimal = function previewImageWithBabyHeadScale(image, forceComparison = false) {
  if (!image || !babyHeadWarp || prewarpedSplitLayers.has(image) || (comparingBabyOriginal && !forceComparison)) return image;
  const species = String($('animalId').value || '').trim(); // Species key for the cache and debug feedback.
  const amount = Number(babyHeadScaleSlider.value) / 100;
  if (!species || amount <= 1 || !babyPreviewFrame) return image;
  const width = Math.floor(Number(image.naturalWidth || image.width));
  const height = Math.floor(Number(image.naturalHeight || image.height));
  if (!(width > 0 && height > 0)) return image;
  const frameKey = [babyPreviewFrame.x, babyPreviewFrame.y, babyPreviewFrame.width, babyPreviewFrame.height]
    .map(value => value.toFixed(5)).join(',');
  const cacheKey = species + ':' + amount.toFixed(2) + ':' + width + 'x' + height + ':' + frameKey;
  const cached = babyPreviewTextureCache.get(image);
  const idleMask = babyHeadWarp?.maskForKind?.(species, babyPreviewFrame); // Reimporting idle art changes the silhouette even at the same head percentage.
  if (cached?.key === cacheKey && cached?.mask === idleMask) { babyHeadDebug.hits++; return cached.image; }
  try {
    const source = document.createElement('canvas'); // Copies the original image/split layer without touching editable paint pixels.
    source.width = width;
    source.height = height;
    source.getContext('2d').drawImage(image, 0, 0, width, height);
    const warped = babyHeadWarp.applyToCanvas(source, species, amount, babyPreviewFrame);
    if (warped === source) throw new Error(babyHeadWarp.debugSnapshot?.()?.lastError || 'Baby head warp returned the original pixels.');
    babyPreviewTextureCache.set(image, { key: cacheKey, mask: idleMask, image: warped });
    babyHeadDebug.misses++;
    babyHeadDebug.lastSpecies = species;
    babyHeadDebug.lastError = null;
    return warped;
  } catch (error) {
    babyHeadDebug.lastError = readableBabyError(error); // Do not cache failed/tainted textures as if enlargement succeeded.
    return image;
  }
};


previewSplitLayerCanvases = function splitBabyPreviewAfterEnlarging() {
  if (!state.image) return null;
  const rawRight = rightShoulderSource() || state.image; // The second source may be run1, not the original idle sprite.
  const leftSource = previewImageForAnimal(state.image);
  const rightSource = previewImageForAnimal(rawRight);
  if (leftSource === state.image && rightSource === rawRight) return splitLayerCanvases(); // Fully original presentation is unchanged.
  const { width, height } = sourceSize();
  const shift = shoulderFrameShiftValue(), rotation = shoulderSeparatorRotationValue(); // Same authored diagonal separator as the normal shoulder rig.
  const prior = babyPreviewSplitCache.get(state.image);
  if (prior && prior.leftSource === leftSource && prior.rightSource === rightSource
      && prior.shift === shift && prior.rotation === rotation
      && prior.width === width && prior.height === height) return prior.layers;
  const left = document.createElement('canvas'), right = document.createElement('canvas'); // Never touch the underlying paint source or regular split cache.
  left.width = right.width = width;
  left.height = right.height = height;
  drawSeparatorSide(left.getContext('2d'), leftSource, width, height, false);
  drawSeparatorSide(right.getContext('2d'), rightSource, width, height, true);
  prewarpedSplitLayers.add(left);
  prewarpedSplitLayers.add(right); // Triangle compositor receives finalized split textures, with no second warp or seam re-cut.
  const layers = { left, right, width, height };
  babyPreviewSplitCache.set(state.image, { layers, leftSource, rightSource, shift, rotation, width, height });
  babyHeadDebug.splitsAfterWarp++;
  return layers;
};

function drawBabyHeadTextureComparison() {
  const canvas = babyHeadComparisonCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width, height = canvas.height, half = width / 2;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#23272d';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#b5bdca';
  ctx.font = '17px system-ui';
  if (!state.image) {
    ctx.fillText('Load an animal sprite above', 15, height / 2);
    babyHeadPixelDelta.textContent = 'Load a sprite to inspect the source pixels.';
    babyHeadDebug.comparisonPixelChanges = 0;
    return;
  }
  if (!babyPreviewFrame) {
    ctx.fillText('Paint Head influence or choose', 15, height / 2 - 12);
    ctx.fillText('a species with a head frame', 15, height / 2 + 12);
    babyHeadPixelDelta.textContent = 'No head frame. The baby head effect cannot run for this sprite yet.';
    babyHeadDebug.comparisonPixelChanges = 0;
    return;
  }
  const source = state.image, enlarged = previewImageForAnimal(source, true); // Prove the warp independent of head and shoulder mesh transforms.
  const { width: artW, height: artH } = sourceSize();
  const frame = babyPreviewFrame;
  const left = clamp(Math.floor((frame.x - frame.width * .45) * artW), 0, artW - 1);
  const top = clamp(Math.floor((frame.y - frame.height * .45) * artH), 0, artH - 1);
  const right = clamp(Math.ceil((frame.x + frame.width * 1.45) * artW), left + 1, artW);
  const bottom = clamp(Math.ceil((frame.y + frame.height * 1.45) * artH), top + 1, artH);
  const cropW = right - left, cropH = bottom - top;
  const scale = Math.min((half - 14) / cropW, (height - 14) / cropH);
  const drawW = cropW * scale, drawH = cropH * scale;
  ctx.imageSmoothingEnabled = false; // Exactly the same pixel-art sampling as the source game textures.
  ctx.drawImage(source, left, top, cropW, cropH, (half - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  ctx.drawImage(enlarged, left, top, cropW, cropH, half + (half - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  ctx.fillStyle = '#d6dbde';
  ctx.fillRect(half - 1, 0, 2, height);
  let count = 0; // Number of actually changed visible RGBA pixels in the exact shown head crop, not theoretical geometry.
  if (babyHeadDebug.lastError && enlarged === source && Number(babyHeadScaleSlider.value) > 100) {
    babyHeadDebug.comparisonPixelChanges = 0;
    babyHeadPixelDelta.textContent = babyHeadDebug.lastError; // The runtime compositor swallowed a security error; never report false "0 pixels".
    return;
  }
  try {
    if (enlarged !== source) {
      const cached = babyPixelDeltaCache.get(enlarged);
      if (cached && cached.cropX === left && cached.cropY === top && cached.cropW === cropW && cached.cropH === cropH) {
        count = cached.count;
      } else {
        const original = document.createElement('canvas');
        original.width = artW; original.height = artH;
        const octx = original.getContext('2d', { willReadFrequently: true });
        octx.drawImage(source, 0, 0, artW, artH);
        const before = octx.getImageData(left, top, cropW, cropH).data;
        const after = enlarged.getContext('2d', { willReadFrequently: true }).getImageData(left, top, cropW, cropH).data;
        for (let index = 0; index < before.length; index += 4) {
          if ((before[index + 3] || after[index + 3]) &&
              (before[index] !== after[index] || before[index + 1] !== after[index + 1]
                || before[index + 2] !== after[index + 2] || before[index + 3] !== after[index + 3])) count++;
        }
        babyPixelDeltaCache.set(enlarged, { cropX: left, cropY: top, cropW, cropH, count });
      }
    }
    babyHeadDebug.comparisonPixelChanges = count;
    babyHeadPixelDelta.textContent = count
      ? count.toLocaleString() + ' head-region pixels actually changed. Right preview is the enlarged source, before either rig can deform it.'
      : '0 visible pixels changed. Check that the frame encloses the actual head, or increase the slider toward 145%.';
  } catch (error) {
    babyHeadDebug.comparisonPixelChanges = 0;
    babyHeadDebug.lastError = 'Pixel comparison: ' + readableBabyError(error);
    babyHeadPixelDelta.textContent = babyHeadDebug.lastError; // An inaccessible source is a loading problem, not a zero-pixel enlargement.
  }
}

const drawGuidesBeforeBabyHead = drawGuides;
drawGuides = function drawGuidesWithBabyHeadFrame(fit) {
  drawGuidesBeforeBabyHead(fit);
  if (!babyPreviewFrame || !state.image) return;
  paintCtx.save();
  paintCtx.strokeStyle = '#f9e89a';
  paintCtx.lineWidth = Math.max(1.5, window.devicePixelRatio || 1);
  paintCtx.setLineDash([7, 4]);
  paintCtx.strokeRect(
    fit.x + babyPreviewFrame.x * fit.width,
    fit.y + babyPreviewFrame.y * fit.height,
    babyPreviewFrame.width * fit.width,
    babyPreviewFrame.height * fit.height,
  ); // Overlay only: outlines the exact art pixels that can be enlarged, never modifies the source.
  paintCtx.restore();
};

const updateStatusBeforeBabyHead = updateStatus;
updateStatus = function updateStatusWithBabyHeadScale() {
  updateStatusBeforeBabyHead();
  const notice = babyHeadDebug.lastError ? '\nBaby preview error: ' + babyHeadDebug.lastError : '';
  $('status').textContent += '\nBaby head: ' + babyHeadScaleLabel.textContent
    + ' | ' + (babyPreviewFrame ? babyPreviewFrameSource : 'missing frame') + notice;
};

const drawBeforeBabyHead = draw;
draw = function drawWithBabyHeadPreview() {
  const resolved = resolveBabyPreviewFrame(); // Resolve painted bounds once per redraw; mesh triangles reuse the frame.
  babyPreviewFrame = resolved.frame;
  babyPreviewFrameSource = resolved.source;
  if (state.image && babyPreviewFrame) babyHeadWarp?.primeIdleMask?.($('animalId').value, state.image, babyPreviewFrame); // Mask is authored ONLY from the loaded idle sprite; never sample run1.
  drawBeforeBabyHead();
  updateBabyPreviewFeedback(); // Original draw sets the angle badge; append baby scale afterward.
  drawBabyHeadTextureComparison(); // Two head crops bypass all head/shoulder poses and confirm actual changed RGBA pixels.
};

babyHeadScaleSlider?.addEventListener('pointerdown', () => checkpointHistory());
babyHeadScaleSlider?.addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) checkpointHistory();
});
babyHeadScaleSlider?.addEventListener('input', () => {
  setAuthoredBabyHeadScale(babyHeadScaleSlider.value);
  comparingBabyOriginal = false; // Moving the slider always previews the enlarged result immediately.
  requestDraw();
});
babyHeadCompareButton?.addEventListener('click', () => {
  comparingBabyOriginal = !comparingBabyOriginal; // Comparison never changes the stored scale or head-rig JSON.
  requestDraw();
});
window.__animalHeadRigBabyPreview = Object.freeze({
  debugSnapshot: () => ({
    ...babyHeadDebug, species: String($('animalId').value || ''),
    scale: Number(babyHeadScaleSlider.value) / 100, explicit: authoredBabyHeadScale !== null,
    comparingOriginal: comparingBabyOriginal, frame: babyPreviewFrame, frameSource: babyPreviewFrameSource,
    idleMaskPixels: babyHeadWarp?.maskForKind?.($('animalId').value, babyPreviewFrame)?.opaquePixels || 0,
  }),
});
syncBabyHeadScaleControl();
requestDraw();

'use strict';

// Baby head proportions are authored per species, but only the live preview art is warped.
// The source paint, head-rig weight maps, adult sprites, and normal game saves stay unchanged.
const babyHeadScaleSlider = $('babyHeadScale'); // Percentage slider placed next to the animal picker for mobile and desktop.
const babyHeadScaleLabel = $('babyHeadScaleLabel'); // Shows saved override vs inherited Nursery default.
const babyHeadCompareButton = $('babyHeadCompare'); // Before/after comparison without changing the authored value.
const babyHeadPreviewState = $('babyHeadPreviewState'); // Mobile-readable preview state and missing-frame explanation.
const babyHeadWarp = window.BabyAnimalHeadWarp; // Reuses the baby's exact nearest-neighbor runtime pixel warp.
const babyPreviewTextureCache = new WeakMap(); // Reuses one warped raster per source, frame and scale across thousands of mesh triangles.
const babyHeadDebug = { hits: 0, misses: 0, lastSpecies: null, lastError: null }; // Captured by the in-editor mobile diagnostics.
let authoredBabyHeadScale = null; // Null inherits the Nursery's experimental global default.
let babyPreviewFrame = null; // Frame resolved once per editor draw, not once per mesh triangle.
let babyPreviewFrameSource = 'none'; // Helps distinguish authored chathead boxes from painted-head fallbacks.
let comparingBabyOriginal = false; // Temporary visual toggle; never enters exported rig data.

function syncBabyHeadScaleControl() {
  const inherited = babyHeadWarp?.getScale?.() || 1.22; // Current Nursery default when the animal has no explicit scale.
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
  const canonical = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[species]?.chatheadFrame;
  const authored = babyHeadWarp?.validateFrame?.(canonical); // Existing manually authored chathead frame always wins.
  if (authored) return { frame: authored, source: 'authored chathead frame' };
  const painted = paintedBabyHeadFrame(); // Newly authored or custom species use the rigger's existing painted head region.
  if (painted) return { frame: painted, source: 'painted Head influence' };
  const saved = babyHeadWarp?.frameForKind?.(species); // Allows previewing earlier custom exports without repainting.
  if (saved) return { frame: saved, source: 'saved custom head frame' };
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
    const canonical = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[species]?.chatheadFrame;
    if (!babyHeadWarp?.validateFrame?.(canonical)) {
      const paintedFrame = paintedBabyHeadFrame(); // Custom animals must export a usable frame, not just a scale.
      const savedFrame = state.baseRecord?.headRig?.babyHeadFrame;
      const frame = paintedFrame || babyHeadWarp?.validateFrame?.(savedFrame);
      if (frame) rig.babyHeadFrame = frame;
    }
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
previewImageForAnimal = function previewImageWithBabyHeadScale(image) {
  if (!image || !babyHeadWarp || comparingBabyOriginal) return image;
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
  if (cached?.key === cacheKey) { babyHeadDebug.hits++; return cached.image; }
  try {
    const source = document.createElement('canvas'); // Copies the original image/split layer without touching editable paint pixels.
    source.width = width;
    source.height = height;
    source.getContext('2d').drawImage(image, 0, 0, width, height);
    const warped = babyHeadWarp.applyToCanvas(source, species, amount, babyPreviewFrame);
    babyPreviewTextureCache.set(image, { key: cacheKey, image: warped });
    babyHeadDebug.misses++;
    babyHeadDebug.lastSpecies = species;
    babyHeadDebug.lastError = null;
    return warped;
  } catch (error) {
    babyHeadDebug.lastError = String(error?.message || error); // Mobile users can read this in the status panel.
    return image;
  }
};

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
  drawBeforeBabyHead();
  updateBabyPreviewFeedback(); // Original draw sets the angle badge; append baby scale afterward.
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
  }),
});
syncBabyHeadScaleControl();
requestDraw();

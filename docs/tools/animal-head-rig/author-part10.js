'use strict';

// Optional authoring layer: baby head proportions are part of the exported species head rig.
// Only the live preview receives enlarged pixels; the painting canvas and source art stay intact.
const babyHeadScaleSlider = $('babyHeadScale'); // Touch/keyboard slider for the selected species' baby-only sprite enlargement.
const babyHeadScaleLabel = $('babyHeadScaleLabel'); // Shows explicit authoring vs inherited global fallback.
const babyHeadWarp = window.BabyAnimalHeadWarp; // The exact same native-pixel compositor used by Nursery, nests, and incubators.
const babyPreviewTextureCache = new WeakMap(); // One last warped preview per source image/scale/species; avoids reprocessing each mesh triangle.
let authoredBabyHeadScale = null; // Null means inherit the existing global Nursery default rather than silently authoring an override.
const babyHeadDebug = { hits: 0, misses: 0, lastSpecies: null, lastError: null }; // Mobile-visible preview cache/authoring diagnostics.

function syncBabyHeadScaleControl() {
  const inherited = babyHeadWarp?.getScale?.() || 1.22; // Current global default, preserved if this rig has no explicit setting.
  const percentage = Math.round((authoredBabyHeadScale ?? inherited) * 100);
  babyHeadScaleSlider.value = String(percentage);
  babyHeadScaleLabel.textContent = percentage + '%' + (authoredBabyHeadScale == null ? ' · inherited default' : ' · species override');
}

function setAuthoredBabyHeadScale(raw) {
  const numeric = Number(raw); // Input is percentages, unlike the runtime's 1.00–1.45 multiplier.
  authoredBabyHeadScale = Number.isFinite(numeric) ? clamp(numeric / 100, 1, babyHeadWarp?.MAX_SCALE || 1.45) : null;
  syncBabyHeadScaleControl();
}

const loadRecordBeforeBabyHead = applyRecord;
applyRecord = function applyRecordWithBabyHeadScale(record, index = -1) {
  const result = loadRecordBeforeBabyHead(record, index);
  const id = String(record?.id || '').trim(); // Selected species for preview-rig overrides.
  const saved = id ? readPreviewRigs()?.[id] : null; // Same-origin Save Preview Rig has precedence over committed exported rig.
  const configured = saved?.babyHeadScale ?? record?.headRig?.babyHeadScale;
  authoredBabyHeadScale = typeof configured === 'number' && Number.isFinite(configured)
    ? clamp(configured, 1, babyHeadWarp?.MAX_SCALE || 1.45) : null;
  syncBabyHeadScaleControl();
  requestDraw();
  return result;
};

const exportRigBeforeBabyHead = normalizedRig;
normalizedRig = function normalizedRigWithBabyHeadScale() {
  const rig = exportRigBeforeBabyHead();
  if (!rig) return rig;
  if (authoredBabyHeadScale != null) rig.babyHeadScale = authoredBabyHeadScale; // Exported JSON and Save rig for game preview share one per-species value.
  else delete rig.babyHeadScale; // An unchanged species inherits the global experimental setting.
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

previewImageForAnimal = function previewImageWithBabyHeadScale(image) {
  if (!image || !babyHeadWarp) return image;
  const species = String($('animalId').value || '').trim(); // Current preview species, independent of its 3D head-rig pivot.
  const amount = Number(babyHeadScaleSlider.value) / 100; // The slider always displays the exact preview strength.
  if (!species || amount <= 1) return image;
  const width = Math.floor(Number(image.naturalWidth || image.width));
  const height = Math.floor(Number(image.naturalHeight || image.height));
  if (!(width > 0 && height > 0)) return image;
  const key = species + ':' + amount.toFixed(2) + ':' + width + 'x' + height; // Changes in source, species or scale invalidate this source's cache.
  const cached = babyPreviewTextureCache.get(image);
  if (cached?.key === key) { babyHeadDebug.hits++; return cached.image; }
  if (!babyHeadWarp.frameForKind(species)) return image; // Probe authored head bounds only on cache misses, not for every mesh triangle.
  try {
    const source = document.createElement('canvas'); // Canvas snapshot of the idle/run/split layer before baby-only pixel deformation.
    source.width = width;
    source.height = height;
    source.getContext('2d').drawImage(image, 0, 0, width, height);
    const warped = babyHeadWarp.applyToCanvas(source, species, amount); // Does NOT change global Nursery preference or saved adult art.
    babyPreviewTextureCache.set(image, { key, image: warped });
    babyHeadDebug.misses++;
    babyHeadDebug.lastSpecies = species;
    babyHeadDebug.lastError = null;
    return warped;
  } catch (error) {
    babyHeadDebug.lastError = String(error?.message || error); // Exposed in the existing on-screen status for mobile use.
    return image;
  }
};

const updateStatusBeforeBabyHead = updateStatus;
updateStatus = function updateStatusWithBabyHeadScale() {
  updateStatusBeforeBabyHead();
  const species = String($('animalId').value || '').trim(); // Species whose chathead bounds determine the warp center.
  const frame = babyHeadWarp?.frameForKind?.(species);
  const source = frame ? 'authored chathead frame' : 'no authored chathead frame';
  const text = babyHeadScaleLabel.textContent + ' | ' + source;
  const notice = babyHeadDebug.lastError ? '\nBaby preview error: ' + babyHeadDebug.lastError : '';
  $('status').textContent += '\nBaby head: ' + text + notice;
};

babyHeadScaleSlider?.addEventListener('pointerdown', () => checkpointHistory()); // One undo checkpoint per mobile gesture.
babyHeadScaleSlider?.addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) checkpointHistory();
});
babyHeadScaleSlider?.addEventListener('input', () => {
  setAuthoredBabyHeadScale(babyHeadScaleSlider.value);
  requestDraw(); // Coalesce native pixel recomposition to one preview render per animation frame.
});
window.__animalHeadRigBabyPreview = Object.freeze({
  debugSnapshot: () => ({ ...babyHeadDebug, species: String($('animalId').value || ''), scale: Number(babyHeadScaleSlider.value) / 100, explicit: authoredBabyHeadScale !== null }),
});
syncBabyHeadScaleControl();
requestDraw();

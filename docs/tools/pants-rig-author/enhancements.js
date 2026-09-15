(() => {
'use strict';

const DEFAULT_GARMENT_ID = 'pants_basic'; // Used as the repository-backed starter garment when no authored garment was selected yet.
const DEFAULT_RUNTIME_PATH = 'assets/cosmetics/clothes/legs/pants_basic.png'; // Used by game/runtime consumers after the author exports the rig.
const DEFAULT_IMAGE_URL = new URL('../../assets/cosmetics/clothes/legs/pants_basic.png', window.location.href).href; // Used by this tool to preview the committed pants asset directly.
const CHANNEL_COLORS = Object.freeze({ // Used by the editor-only paint overlay; none of these colors are baked into exports.
  belt: '#9cff00',
  leftThigh: '#18e7ef',
  leftCalf: '#ff00a9',
  rightThigh: '#18e7ef',
  rightCalf: '#ff00a9',
});
const embedded = new URLSearchParams(window.location.search).get('embedded') === '1'; // Used to compact the author when it is hosted inside Procedural Animation.
let overlayCanvas = null; // Draws an unmistakable editor-only weight visualization above the base pants canvas.
let overlayFrameQueued = false; // Coalesces pointer/input events into one overlay redraw per frame.
let lastBrushCanvasPoint = null; // Used to show the current brush footprint directly over the pants workspace.

function debugApi() {
  return window.__pantsRigAuthorDebug || null;
}

function editorState() {
  return debugApi()?.state?.() || null;
}

function waitForReady(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      const state = editorState();
      if (state?.project && document.getElementById('pantsCanvas') && document.getElementById('garmentId')) {
        resolve(state);
        return;
      }
      if (performance.now() - started > timeoutMs) {
        reject(new Error('Pants author did not finish booting.'));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function normalizeSpecies(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function normalizeGender(value) {
  return String(value || '').trim().toLowerCase();
}

function applyEmbeddedLayout() {
  if (!embedded || document.getElementById('pantsRigEmbeddedStyles')) return;
  document.documentElement.classList.add('pantsRigEmbedded');
  const style = document.createElement('style'); // Keeps the full author usable inside the procedural editor's docked modal on desktop and mobile.
  style.id = 'pantsRigEmbeddedStyles';
  style.textContent = `
html.pantsRigEmbedded,html.pantsRigEmbedded body{min-height:0!important;overflow:auto!important}
html.pantsRigEmbedded .app{display:flex!important;flex-direction:column!important;gap:7px!important;padding:6px!important;min-height:0!important}
html.pantsRigEmbedded .panel{border-radius:9px!important;padding:7px!important}
html.pantsRigEmbedded .workspace{order:-1!important;min-height:0!important}
html.pantsRigEmbedded .canvasPair{min-height:610px!important;grid-template-rows:350px 245px!important;gap:6px!important}
html.pantsRigEmbedded .canvasWrap{min-height:0!important}
html.pantsRigEmbedded canvas.author{max-height:100%!important}
html.pantsRigEmbedded .controls,html.pantsRigEmbedded .inspect{max-height:none!important;overflow:visible!important}
html.pantsRigEmbedded h1{font-size:16px!important}
`;
  document.head.appendChild(style);
}

function renameStarterGarmentIfNeeded(state) {
  const input = document.getElementById('garmentId');
  if (!input || state.garmentId !== 'pants_1') return;
  const oldGarment = state.project?.garments?.pants_1;
  const alreadyAuthored = oldGarment?.image || oldGarment?.sourceSize?.width || oldGarment?.weightMap;
  if (alreadyAuthored) return;
  input.value = DEFAULT_GARMENT_ID;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function loadDefaultPantsAsset() {
  const state = await waitForReady();
  renameStarterGarmentIfNeeded(state);
  const current = editorState();
  if (!current || current.sourceImage) return true;
  const image = new Image(); // Decodes the repository's committed pants_basic.png without asking for a local upload.
  image.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Could not load ${DEFAULT_RUNTIME_PATH}`));
    image.src = DEFAULT_IMAGE_URL;
  });
  current.sourceImage = image;
  current.sourceName = 'pants_basic.png';
  if (current.garmentId === 'pants_1') current.garmentId = DEFAULT_GARMENT_ID;
  const garmentIdInput = document.getElementById('garmentId');
  if (garmentIdInput && garmentIdInput.value !== current.garmentId) garmentIdInput.value = current.garmentId;
  current.project.garments ||= {};
  current.project.garments[current.garmentId] ||= {};
  const garment = current.project.garments[current.garmentId]; // Receives the real repository source dimensions/path while retaining authored splines and weights.
  garment.image = DEFAULT_RUNTIME_PATH;
  garment.sourceSize = { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  const sourcePath = document.getElementById('sourcePath');
  if (sourcePath) {
    sourcePath.value = DEFAULT_RUNTIME_PATH;
    sourcePath.dispatchEvent(new Event('change', { bubbles: true }));
  }
  current.fitCanvas = null;
  debugApi()?.rerender?.();
  const status = document.getElementById('status');
  if (status) {
    status.textContent = `Loaded repository asset pants_basic.png (${garment.sourceSize.width}×${garment.sourceSize.height}). Editor guides remain separate from the PNG.`;
    status.dataset.kind = 'good';
  }
  return true;
}

function setCharacter(speciesId, gender) {
  const state = editorState();
  const select = document.getElementById('fighter');
  if (!state || !select) return false;
  const species = normalizeSpecies(speciesId);
  const normalizedGender = normalizeGender(gender);
  const fighter = (state.fighters || []).find(candidate =>
    normalizeSpecies(candidate?.speciesId || candidate?.id) === species
    && normalizeGender(candidate?.gender) === normalizedGender);
  if (!fighter) return false;
  if (state.fighter?.id === fighter.id) return true;
  select.value = fighter.id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function makeOverlay() {
  const pantsCanvas = document.getElementById('pantsCanvas');
  const wrap = pantsCanvas?.parentElement;
  if (!pantsCanvas || !wrap || overlayCanvas) return overlayCanvas;
  wrap.style.position = 'relative';
  overlayCanvas = document.createElement('canvas'); // Sits above the original author canvas so brush feedback stays visible even if the base renderer changes.
  overlayCanvas.id = 'pantsWeightPaintOverlay';
  overlayCanvas.width = pantsCanvas.width;
  overlayCanvas.height = pantsCanvas.height;
  Object.assign(overlayCanvas.style, {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: '12',
    imageRendering: 'auto',
  });
  wrap.appendChild(overlayCanvas);

  const recordBrushPoint = event => {
    const rect = pantsCanvas.getBoundingClientRect(); // Converts mouse/touch position into the backing 760×760 author canvas used by state.pantsImageRect.
    lastBrushCanvasPoint = {
      x: (event.clientX - rect.left) * pantsCanvas.width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * pantsCanvas.height / Math.max(1, rect.height),
    };
    queueOverlayRender();
  };
  pantsCanvas.addEventListener('pointerdown', recordBrushPoint, true);
  pantsCanvas.addEventListener('pointermove', recordBrushPoint, true);
  pantsCanvas.addEventListener('pointerleave', () => { lastBrushCanvasPoint = null; queueOverlayRender(); }, true);
  pantsCanvas.addEventListener('pointerup', () => queueOverlayRender(), true);
  for (const id of ['weightChannel', 'brushRadius', 'brushStrength', 'autoWeights', 'smoothWeights', 'resetWeights']) {
    document.getElementById(id)?.addEventListener('input', queueOverlayRender, true);
    document.getElementById(id)?.addEventListener('change', queueOverlayRender, true);
    document.getElementById(id)?.addEventListener('click', queueOverlayRender, true);
  }
  new ResizeObserver(queueOverlayRender).observe(pantsCanvas);
  return overlayCanvas;
}

function syncOverlayCss() {
  const pantsCanvas = document.getElementById('pantsCanvas');
  const overlay = makeOverlay();
  const wrap = pantsCanvas?.parentElement;
  if (!pantsCanvas || !overlay || !wrap) return;
  const canvasRect = pantsCanvas.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  overlay.style.left = `${canvasRect.left - wrapRect.left}px`;
  overlay.style.top = `${canvasRect.top - wrapRect.top}px`;
  overlay.style.width = `${canvasRect.width}px`;
  overlay.style.height = `${canvasRect.height}px`;
}

function rgb(hex) {
  const value = Number.parseInt(String(hex || '#ffffff').replace('#', ''), 16) || 0xffffff;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function renderWeightOverlay() {
  overlayFrameQueued = false;
  const state = editorState();
  const pantsCanvas = document.getElementById('pantsCanvas');
  const overlay = makeOverlay();
  if (!state || !pantsCanvas || !overlay) return;
  syncOverlayCss();
  if (overlay.width !== pantsCanvas.width || overlay.height !== pantsCanvas.height) {
    overlay.width = pantsCanvas.width;
    overlay.height = pantsCanvas.height;
  }
  const context = overlay.getContext('2d');
  context.clearRect(0, 0, overlay.width, overlay.height);
  if (state.mode !== 'weights' || !state.weightGrid || !state.pantsImageRect) return;

  const grid = state.weightGrid; // Reads the exact normalized dense grid the base author modifies during painting.
  const channel = document.getElementById('weightChannel')?.value || grid.channels?.[0];
  const channelIndex = Math.max(0, grid.channels.indexOf(channel));
  const heat = document.createElement('canvas'); // Tiny heatmap expanded into the exact pants image rectangle.
  heat.width = grid.width;
  heat.height = grid.height;
  const heatContext = heat.getContext('2d');
  const image = heatContext.createImageData(grid.width, grid.height);
  const pixels = image.data;
  const color = rgb(CHANNEL_COLORS[channel] || '#ffffff');
  for (let cell = 0; cell < grid.width * grid.height; cell++) {
    const weight = grid.data[cell * grid.channels.length + channelIndex] || 0;
    const offset = cell * 4;
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
    pixels[offset + 3] = weight > 0 ? Math.max(42, Math.round(weight * 0.88)) : 0; // Makes even a light first brush stroke visibly mark the garment.
  }
  heatContext.putImageData(image, 0, 0);
  const rect = state.pantsImageRect;
  context.save();
  context.imageSmoothingEnabled = true;
  context.drawImage(heat, rect.x, rect.y, rect.width, rect.height);
  if (state.sourceImage) {
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(state.sourceImage, rect.x, rect.y, rect.width, rect.height); // Keeps the editor tint on the PNG silhouette instead of flooding the whole preview rectangle.
  }
  context.restore();

  context.save();
  context.font = 'bold 12px system-ui';
  context.textBaseline = 'top';
  context.fillStyle = 'rgba(5,12,20,.82)';
  const label = `WEIGHT · ${String(channel).replace(/([A-Z])/g, ' $1')}`;
  const labelWidth = context.measureText(label).width + 16;
  context.fillRect(rect.x + 7, rect.y + 7, labelWidth, 24);
  context.fillStyle = CHANNEL_COLORS[channel] || '#fff';
  context.fillText(label, rect.x + 15, rect.y + 12);
  if (lastBrushCanvasPoint) {
    const radiusCells = Number(document.getElementById('brushRadius')?.value) || 7;
    const radiusX = rect.width * radiusCells / Math.max(1, grid.width - 1);
    const radiusY = rect.height * radiusCells / Math.max(1, grid.height - 1);
    const radius = (radiusX + radiusY) * 0.5;
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.arc(lastBrushCanvasPoint.x, lastBrushCanvasPoint.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = CHANNEL_COLORS[channel] || '#fff';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(lastBrushCanvasPoint.x, lastBrushCanvasPoint.y, Math.max(2, radius - 3), 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function queueOverlayRender() {
  if (overlayFrameQueued) return;
  overlayFrameQueued = true;
  requestAnimationFrame(renderWeightOverlay);
}

async function init() {
  applyEmbeddedLayout();
  await waitForReady();
  makeOverlay();
  const api = debugApi();
  api.setCharacter = setCharacter; // Used by Procedural Animation to keep the 2D author on the same species/gender as its live 3D avatar.
  api.loadDefaultPants = loadDefaultPantsAsset; // Used by mobile diagnostics and the procedural host to retry the repository source without DevTools.
  api.renderWeightOverlay = queueOverlayRender; // Used by the host after project synchronization.
  api.defaultGarmentId = DEFAULT_GARMENT_ID;
  api.defaultAssetPath = DEFAULT_RUNTIME_PATH;
  await loadDefaultPantsAsset();
  queueOverlayRender();
  setInterval(queueOverlayRender, 250); // Catches base-author repaint/undo changes that do not bubble a dedicated DOM event.
}

init().catch(error => {
  console.error('[Pants Rig Author enhancements]', error);
  const status = document.getElementById('status');
  if (status) {
    status.textContent = `Pants author enhancement failed: ${error?.message || error}`;
    status.dataset.kind = 'warn';
  }
});
})();

(() => {
'use strict';

const $ = id => document.getElementById(id); // Short DOM lookup used throughout the author.
const Core = window.HobunjiPantsRig; // Shared schema/math used by both authoring and runtime.
const STORAGE_KEY = 'hobunjiPantsRigAuthor.v1'; // Browser-local draft persistence for mobile authoring.
const WEIGHT_SIZE = 64; // Low-resolution weight field; bilinear sampling makes it smooth at runtime.
const CHANNEL_COLORS = Object.freeze({ // Overlay colors intentionally mirror the user's workspace sketch.
  belt: '#9cff00',
  leftThigh: '#18e7ef',
  leftCalf: '#ff00a9',
  rightThigh: '#18e7ef',
  rightCalf: '#ff00a9',
});
const GUIDE_COLORS = Object.freeze({ belt: '#9cff00', thigh: '#18e7ef', calf: '#ff00a9', opening: '#ffad12' }); // Canvas guide palette.
const state = { // Complete mutable authoring session; exported data is kept separately in state.project.
  project: null,
  fighters: [],
  fighter: null,
  garmentId: 'pants_1',
  sourceImage: null,
  sourceName: '',
  weightGrid: null,
  mode: 'pantsBelt',
  activeHandle: null,
  painting: false,
  undo: [],
  redo: [],
  portraitReady: false,
  renderQueued: false,
  fitCanvas: null,
  pantsImageRect: null,
  portraitImageRect: null,
};

function freshProject() {
  const authored = window.HOBUNJI_PANTS_RIGS;
  return authored && authored.schema === Core.SCHEMA
    ? JSON.parse(JSON.stringify(authored))
    : { schema: Core.SCHEMA, garments: {}, characters: {} };
}

function defaultGarment() {
  return {
    image: '',
    sourceSize: { width: 0, height: 0 },
    pantsBeltSpline: [
      { x: 0.34, y: 0.28 }, { x: 0.42, y: 0.27 }, { x: 0.50, y: 0.265 }, { x: 0.58, y: 0.27 }, { x: 0.66, y: 0.28 },
    ],
    legOpenings: {
      left: [
        { x: 0.155, y: 0.43 }, { x: 0.15, y: 0.54 }, { x: 0.19, y: 0.625 }, { x: 0.26, y: 0.675 }, { x: 0.34, y: 0.65 },
      ],
      right: [
        { x: 0.66, y: 0.65 }, { x: 0.74, y: 0.675 }, { x: 0.81, y: 0.625 }, { x: 0.85, y: 0.54 }, { x: 0.845, y: 0.43 },
      ],
    },
    legBones: {
      left: { hip: { x: 0.39, y: 0.36 }, knee: { x: 0.285, y: 0.515 }, ankle: { x: 0.17, y: 0.69 } },
      right: { hip: { x: 0.61, y: 0.36 }, knee: { x: 0.715, y: 0.515 }, ankle: { x: 0.83, y: 0.69 } },
    },
    weightMap: null,
  };
}

function freshWeightGrid() {
  const channels = [...Core.WEIGHT_CHANNELS]; // Channel order used by painting and RLE serialization.
  const data = new Uint8Array(WEIGHT_SIZE * WEIGHT_SIZE * channels.length); // Dense working bytes used only while editing.
  for (let cell = 0; cell < WEIGHT_SIZE * WEIGHT_SIZE; cell++) data[cell * channels.length] = 255;
  return { width: WEIGHT_SIZE, height: WEIGHT_SIZE, channels, data };
}

function ensureGarment() {
  const garmentId = String($('garmentId')?.value || state.garmentId || 'pants_1').trim() || 'pants_1'; // Current authored garment key.
  state.garmentId = garmentId;
  state.project.garments ||= {};
  state.project.garments[garmentId] ||= defaultGarment();
  const garment = state.project.garments[garmentId]; // Current garment record edited by the pants canvas.
  garment.pantsBeltSpline = Core.normalizeSpline(garment.pantsBeltSpline, defaultGarment().pantsBeltSpline);
  garment.legOpenings ||= {};
  garment.legOpenings.left = Core.normalizeSpline(garment.legOpenings.left, defaultGarment().legOpenings.left);
  garment.legOpenings.right = Core.normalizeSpline(garment.legOpenings.right, defaultGarment().legOpenings.right);
  garment.legBones ||= defaultGarment().legBones;
  for (const side of ['left', 'right']) {
    garment.legBones[side] ||= JSON.parse(JSON.stringify(defaultGarment().legBones[side]));
  }
  if (garment.weightMap?.encoding === 'rle8') state.weightGrid = Core.decodeWeightGridRle(garment.weightMap);
  if (!state.weightGrid || state.weightGrid.channels?.join('|') !== Core.WEIGHT_CHANNELS.join('|')) state.weightGrid = freshWeightGrid();
  return garment;
}

function fighterKey(fighter = state.fighter) {
  const species = String(fighter?.speciesId || fighter?.id || 'unknown').trim().toLowerCase().replace(/_/g, '-'); // Stable species portion of the character-fit key.
  const gender = String(fighter?.gender || 'unknown').trim().toLowerCase(); // Stable gender portion of the character-fit key.
  return `${species}::${gender}`;
}

function defaultPortraitBelt() {
  return [
    { x: 0.34, y: 0.635 }, { x: 0.42, y: 0.63 }, { x: 0.50, y: 0.628 }, { x: 0.58, y: 0.63 }, { x: 0.66, y: 0.635 },
  ];
}

function ensureCharacter() {
  if (!state.fighter) return null;
  const key = fighterKey(); // Active species+gender record key.
  state.project.characters ||= {};
  state.project.characters[key] ||= {
    species: String(state.fighter.speciesId || '').replace(/_/g, '-'),
    gender: String(state.fighter.gender || ''),
    fighterId: state.fighter.id || '',
    portraitBeltSpline: defaultPortraitBelt(),
    legThickness: 1,
  };
  const record = state.project.characters[key]; // Active per-species/gender fitting record.
  record.portraitBeltSpline = Core.normalizeSpline(record.portraitBeltSpline, defaultPortraitBelt());
  if (!(Number(record.legThickness) > 0)) record.legThickness = 1;
  return record;
}

function snapshotForUndo(label) {
  const garment = ensureGarment(); // Garment copied before a destructive edit.
  garment.weightMap = Core.encodeWeightGridRle(state.weightGrid);
  const snapshot = { label, project: JSON.stringify(state.project) }; // Compact history entry used by Undo/Redo.
  state.undo.push(snapshot);
  if (state.undo.length > 30) state.undo.shift();
  state.redo.length = 0;
  syncHistoryButtons();
}

function restoreSnapshot(snapshot) {
  if (!snapshot?.project) return;
  state.project = JSON.parse(snapshot.project);
  state.weightGrid = null;
  ensureGarment();
  ensureCharacter();
  syncControlsFromState();
  queueRender();
}

function undo() {
  if (!state.undo.length) return;
  const garment = ensureGarment(); // Current garment encoded so Redo can restore it.
  garment.weightMap = Core.encodeWeightGridRle(state.weightGrid);
  state.redo.push({ label: 'redo', project: JSON.stringify(state.project) });
  restoreSnapshot(state.undo.pop());
}

function redo() {
  if (!state.redo.length) return;
  const garment = ensureGarment(); // Current garment encoded so Undo can restore it.
  garment.weightMap = Core.encodeWeightGridRle(state.weightGrid);
  state.undo.push({ label: 'undo', project: JSON.stringify(state.project) });
  restoreSnapshot(state.redo.pop());
}

function syncHistoryButtons() {
  $('undo').disabled = state.undo.length === 0;
  $('redo').disabled = state.redo.length === 0;
}

function persistDraft() {
  const garment = ensureGarment(); // Active garment receives the dense weights before local persistence.
  garment.weightMap = Core.encodeWeightGridRle(state.weightGrid);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      project: state.project,
      garmentId: state.garmentId,
      fighterKey: fighterKey(),
      sourceName: state.sourceName,
    }));
    $('draftState').textContent = 'draft saved';
  } catch (error) {
    $('draftState').textContent = 'draft save failed';
  }
}

function restoreDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); // Last local authoring draft, if any.
    if (saved?.project?.schema === Core.SCHEMA) {
      state.project = saved.project;
      state.garmentId = saved.garmentId || state.garmentId;
      state.sourceName = saved.sourceName || '';
      return saved.fighterKey || '';
    }
  } catch (_) {}
  return '';
}

function syncControlsFromState() {
  $('garmentId').value = state.garmentId;
  const garment = ensureGarment(); // Current garment used to populate source-path metadata.
  $('sourcePath').value = garment.image || '';
  const character = ensureCharacter(); // Current character used to populate fit controls.
  if (character) {
    $('legThickness').value = String(character.legThickness);
    $('legThicknessValue').textContent = `${Number(character.legThickness).toFixed(2)}×`;
  }
  syncHistoryButtons();
  updateCompletion();
}

function status(message, kind = '') {
  const node = $('status'); // Visible mobile-friendly status surface.
  node.textContent = message;
  node.dataset.kind = kind;
}

function log(message) {
  const node = $('debug'); // Copyable in-page diagnostics log.
  const stamp = new Date().toLocaleTimeString();
  node.textContent = `[${stamp}] ${message}\n${node.textContent}`.slice(0, 12000);
}

function populateFighters(savedKey = '') {
  const select = $('fighter'); // Species/gender selector populated from the canonical portrait fighter registry.
  state.fighters = (window.getPortraitFighters?.() || []).filter(fighter =>
    fighter && fighter.speciesId && fighter.gender && Array.isArray(fighter.bodyLayers));
  const seen = new Set(); // Prevents duplicate variant entries for the same species+gender.
  state.fighters = state.fighters.filter(fighter => {
    const key = fighterKey(fighter);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  select.innerHTML = '';
  for (const fighter of state.fighters) {
    const option = document.createElement('option'); // One canonical portrait option.
    option.value = fighter.id;
    option.textContent = `${fighter.label || fighter.speciesId} — ${String(fighter.gender)}`;
    option.dataset.key = fighterKey(fighter);
    select.appendChild(option);
  }
  state.fighter = state.fighters.find(fighter => fighterKey(fighter) === savedKey) || state.fighters[0] || null;
  if (state.fighter) select.value = state.fighter.id;
  ensureCharacter();
}

function nakedProfile() {
  const none = { id: 'none', label: 'None', tintSlot: null, layers: [] }; // Empty cosmetic option used to expose the real body beltline.
  return {
    fighter: state.fighter,
    bodyColors: {},
    hair: none, hairFront: none, hairBack: none, hairSide: none, hairSideL: none,
    hood: none, eyes: none, upperFace: none, facialHair: none, pauldron: none, hat: none,
    torsoCosmetic: none, armCosmetic: none,
  };
}

async function renderPortraitSource() {
  if (!state.fighter || !window.NpcAvatarPreview?.renderProfileToCanvas) return;
  const source = $('portraitSource'); // Hidden canonical 200×200 portrait backing canvas.
  source.width = source.height = 200;
  state.portraitReady = false;
  try {
    const rendered = await window.NpcAvatarPreview.renderProfileToCanvas(source, nakedProfile(), {
      forceEyesOpen: true,
      portraitView: 'front',
    });
    if (!rendered) throw new Error('Portrait renderer returned false.');
    state.portraitReady = true;
    log(`Rendered ${fighterKey()} through NpcAvatarPreview.`);
  } catch (error) {
    log(`Portrait render failed: ${error?.message || error}`);
  }
  queueRender();
}

function sourceCanvas(maxDimension, clearEdgeBlack) {
  if (!state.sourceImage) return null;
  const sourceWidth = state.sourceImage.naturalWidth || state.sourceImage.width; // Original PNG width used for downsample ratio.
  const sourceHeight = state.sourceImage.naturalHeight || state.sourceImage.height; // Original PNG height used for downsample ratio.
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight)); // Keeps interactive preview cheap on mobile.
  const canvas = document.createElement('canvas'); // Working copy that can safely have edge background removed.
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true }); // Pixel access is needed for edge clearing and warp.
  context.drawImage(state.sourceImage, 0, 0, canvas.width, canvas.height);
  if (clearEdgeBlack) clearConnectedDarkBackground(context, canvas.width, canvas.height);
  return canvas;
}

function clearConnectedDarkBackground(context, width, height) {
  const image = context.getImageData(0, 0, width, height); // Mutable pixels used by the edge flood fill.
  const pixels = image.data; // RGBA storage for the working source.
  const visited = new Uint8Array(width * height); // Prevents flood-fill revisits.
  const queue = new Int32Array(width * height); // Fixed queue avoids allocating millions of tiny coordinate arrays.
  let head = 0; // Next queue entry to consume.
  let tail = 0; // Next queue entry to write.
  const threshold = Number($('blackThreshold').value) || 10; // Near-black cutoff for edge-connected background only.
  const enqueue = index => {
    if (index < 0 || index >= width * height || visited[index]) return;
    visited[index] = 1;
    const offset = index * 4; // Pixel byte offset tested for background darkness.
    if (pixels[offset + 3] === 0) return;
    if (pixels[offset] > threshold || pixels[offset + 1] > threshold || pixels[offset + 2] > threshold) return;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++]; // Current connected dark pixel.
    pixels[index * 4 + 3] = 0;
    const x = index % width; // Pixel x used to keep flood neighbors inside the row.
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index + width < width * height) enqueue(index + width);
  }
  context.putImageData(image, 0, 0);
}

function warpCanvas(inputCanvas, thickness) {
  const garment = ensureGarment(); // Garment control splines drive the one-time species/gender fit.
  const controls = Core.buildLegOpeningFitControls(garment, thickness); // Source/target constraints in normalized PNG space.
  const width = inputCanvas.width; // Warp output width matches the requested PNG-space source size.
  const height = inputCanvas.height; // Warp output height matches the requested PNG-space source size.
  const sourceContext = inputCanvas.getContext('2d', { willReadFrequently: true }); // Reads source pixels for inverse mapping.
  const sourceImage = sourceContext.getImageData(0, 0, width, height); // Immutable source pixel buffer.
  const sourcePixels = sourceImage.data; // Fast RGBA source lookup.
  const outputCanvas = document.createElement('canvas'); // One-time fitted PNG surface.
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true }); // Writes the fitted pixel buffer.
  const outputImage = outputContext.createImageData(width, height); // Destination RGBA buffer.
  const outputPixels = Core.warpRgbaNearest(sourcePixels, width, height, controls.source, controls.target); // Shared one-time PNG-space fit used by authoring/runtime.
  outputImage.data.set(outputPixels);
  outputContext.putImageData(outputImage, 0, 0);
  return outputCanvas;
}

function prepareFitPreview() {
  if (!state.sourceImage || !$('showFit').checked) {
    state.fitCanvas = null;
    return;
  }
  const source = sourceCanvas(360, $('clearBlack').checked); // Small live preview avoids blocking mobile input.
  const thickness = Number(ensureCharacter()?.legThickness) || 1; // Active species+gender static fit multiplier.
  state.fitCanvas = warpCanvas(source, thickness);
}

function containRect(canvas, imageWidth, imageHeight, padding = 28) {
  const availableWidth = canvas.width - padding * 2; // Drawable width after handle margin.
  const availableHeight = canvas.height - padding * 2; // Drawable height after handle margin.
  const scale = Math.min(availableWidth / Math.max(1, imageWidth), availableHeight / Math.max(1, imageHeight)); // Preserve source aspect ratio.
  const width = imageWidth * scale; // Displayed image width in author-canvas pixels.
  const height = imageHeight * scale; // Displayed image height in author-canvas pixels.
  return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height };
}

function checker(context, canvas) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  const cell = 18; // Checker tile size used to make transparency obvious.
  for (let y = 0; y < canvas.height; y += cell) {
    for (let x = 0; x < canvas.width; x += cell) {
      context.fillStyle = ((x / cell + y / cell) & 1) ? '#9ba3ab' : '#c4c9ce';
      context.fillRect(x, y, cell, cell);
    }
  }
}

function pointToCanvas(point, rect) {
  return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
}

function canvasToPoint(x, y, rect) {
  return { x: Core.clamp((x - rect.x) / rect.width), y: Core.clamp((y - rect.y) / rect.height) };
}

function drawSpline(context, points, rect, color, { dashed = false, width = 5 } = {}) {
  if (!Array.isArray(points) || !points.length) return;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash(dashed ? [10, 8] : []);
  context.beginPath();
  points.forEach((point, index) => {
    const position = pointToCanvas(point, rect); // Current spline node in display pixels.
    if (index === 0) context.moveTo(position.x, position.y);
    else context.lineTo(position.x, position.y);
  });
  context.stroke();
  context.setLineDash([]);
  for (let index = 0; index < points.length; index++) {
    const position = pointToCanvas(points[index], rect); // Node handle display position.
    context.beginPath();
    context.arc(position.x, position.y, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#06111c';
    context.font = 'bold 11px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1), position.x, position.y);
    context.fillStyle = color;
  }
  context.restore();
}

function drawBones(context, bones, rect) {
  for (const side of ['left', 'right']) {
    const bone = bones?.[side]; // Authored hip/knee/ankle triplet for this side.
    if (!bone) continue;
    const hip = pointToCanvas(bone.hip, rect); // Hip handle.
    const knee = pointToCanvas(bone.knee, rect); // Knee handle.
    const ankle = pointToCanvas(bone.ankle, rect); // Ankle handle.
    context.save();
    context.lineCap = 'round';
    context.lineWidth = 8;
    context.strokeStyle = GUIDE_COLORS.thigh;
    context.beginPath(); context.moveTo(hip.x, hip.y); context.lineTo(knee.x, knee.y); context.stroke();
    context.strokeStyle = GUIDE_COLORS.calf;
    context.beginPath(); context.moveTo(knee.x, knee.y); context.lineTo(ankle.x, ankle.y); context.stroke();
    for (const [position, color] of [[hip, GUIDE_COLORS.thigh], [knee, '#ffffff'], [ankle, GUIDE_COLORS.calf]]) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(position.x, position.y, 9, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function weightOverlayCanvas() {
  const grid = state.weightGrid; // Dense 64×64 authoring weights.
  const channelIndex = grid.channels.indexOf($('weightChannel').value); // Selected channel visualized in the overlay.
  const overlay = document.createElement('canvas'); // Small weight heatmap scaled over the garment.
  overlay.width = grid.width;
  overlay.height = grid.height;
  const context = overlay.getContext('2d'); // Weight heatmap painter.
  const image = context.createImageData(grid.width, grid.height); // RGBA heatmap pixels.
  const pixels = image.data; // Heatmap byte buffer.
  const color = hexRgb(CHANNEL_COLORS[grid.channels[channelIndex]] || '#ffffff'); // Channel color used in the mockup-style overlay.
  for (let cell = 0; cell < grid.width * grid.height; cell++) {
    const value = grid.data[cell * grid.channels.length + Math.max(0, channelIndex)] || 0; // Selected bone influence byte.
    const offset = cell * 4; // Heatmap RGBA offset.
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
    pixels[offset + 3] = Math.round(value * 0.72);
  }
  context.putImageData(image, 0, 0);
  return overlay;
}

function hexRgb(hex) {
  const clean = String(hex || '#ffffff').replace('#', ''); // Six-digit display color without hash.
  const value = Number.parseInt(clean, 16) || 0xffffff; // Numeric RGB used by ImageData overlays.
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function renderPants() {
  const canvas = $('pantsCanvas'); // Main garment authoring canvas.
  const context = canvas.getContext('2d'); // Main garment renderer.
  checker(context, canvas);
  const source = state.fitCanvas || (state.sourceImage ? sourceCanvas(720, $('clearBlack').checked) : null); // Clean or fitted preview image; guides are never baked.
  if (source) {
    const rect = containRect(canvas, source.width, source.height); // Image rectangle used for pointer normalization.
    state.pantsImageRect = rect;
    context.imageSmoothingEnabled = true;
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
    if (state.mode === 'weights') {
      context.save();
      context.globalCompositeOperation = 'source-over';
      context.imageSmoothingEnabled = true;
      context.drawImage(weightOverlayCanvas(), rect.x, rect.y, rect.width, rect.height);
      context.restore();
    }
  } else {
    state.pantsImageRect = containRect(canvas, 1, 1);
    context.fillStyle = '#18293a';
    context.font = '16px system-ui';
    context.textAlign = 'center';
    context.fillText('Upload a clean pants PNG', canvas.width / 2, canvas.height / 2);
  }
  const garment = ensureGarment(); // Garment guide data rendered over the clean PNG.
  const rect = state.pantsImageRect;
  if ($('showGuides').checked) {
    drawSpline(context, garment.pantsBeltSpline, rect, GUIDE_COLORS.belt, { width: 6 });
    drawSpline(context, garment.legOpenings.left, rect, GUIDE_COLORS.opening, { width: 5 });
    drawSpline(context, garment.legOpenings.right, rect, GUIDE_COLORS.opening, { width: 5 });
    drawBones(context, garment.legBones, rect);
    if ($('showFit').checked) {
      const fit = Core.buildLegOpeningFitControls(garment, Number(ensureCharacter()?.legThickness) || 1); // Target opening splines shown dashed during static fitting.
      drawSpline(context, fit.leftTarget, rect, '#fff2a8', { dashed: true, width: 2 });
      drawSpline(context, fit.rightTarget, rect, '#fff2a8', { dashed: true, width: 2 });
    }
  }
}

function renderPortrait() {
  const canvas = $('portraitCanvas'); // Species/gender beltline authoring canvas.
  const context = canvas.getContext('2d'); // Portrait + beltline renderer.
  checker(context, canvas);
  const source = $('portraitSource'); // Canonical 200×200 portrait rendered by NpcAvatarPreview.
  const rect = containRect(canvas, source.width || 200, source.height || 200); // Portrait rectangle used for normalized belt points.
  state.portraitImageRect = rect;
  if (state.portraitReady) context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  else {
    context.fillStyle = '#18293a';
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.fillStyle = '#cfdced';
    context.font = '14px system-ui';
    context.textAlign = 'center';
    context.fillText('Loading portrait…', canvas.width / 2, canvas.height / 2);
  }
  const character = ensureCharacter(); // Active species/gender beltline overlaid on the body portrait.
  if (character && $('showGuides').checked) drawSpline(context, character.portraitBeltSpline, rect, GUIDE_COLORS.belt, { width: 6 });
}

function updateCompletion() {
  const garment = ensureGarment(); // Garment data inspected for the mobile checklist.
  const character = ensureCharacter(); // Character data inspected for the mobile checklist.
  const validation = Core.validateProject(state.project); // Schema validation summarized in diagnostics.
  const completedCharacters = Object.values(state.project.characters || {}).filter(record => Core.validateFivePointSpline(record?.portraitBeltSpline)).length; // Count of authored species/gender beltlines.
  $('completion').innerHTML = [
    `<b>Pants source:</b> ${state.sourceImage ? `${state.sourceName || 'loaded'} (${garment.sourceSize.width}×${garment.sourceSize.height})` : 'not loaded this session'}`,
    `<b>Pants belt:</b> ${garment.pantsBeltSpline.length}/5`,
    `<b>Leg openings:</b> L ${garment.legOpenings.left.length}/5 · R ${garment.legOpenings.right.length}/5`,
    `<b>Bones:</b> hip → knee → ankle on both legs`,
    `<b>Weight grid:</b> ${state.weightGrid.width}×${state.weightGrid.height} · ${state.weightGrid.channels.join(', ')}`,
    `<b>Portrait belts:</b> ${completedCharacters} species/gender profile${completedCharacters === 1 ? '' : 's'}`,
    `<b>Current fit:</b> ${fighterKey()} · ${Number(character?.legThickness || 1).toFixed(2)}×`,
    `<b>Schema:</b> ${validation.ok ? 'valid' : `${validation.errors.length} issue(s)`}`,
  ].join('<br>');
  $('debugSnapshot').textContent = JSON.stringify(debugSnapshot(), null, 2);
}

function debugSnapshot() {
  const garment = ensureGarment(); // Garment included in copyable author diagnostics.
  const character = ensureCharacter(); // Character included in copyable author diagnostics.
  return {
    schema: state.project.schema,
    garmentId: state.garmentId,
    source: { loaded: !!state.sourceImage, name: state.sourceName, size: garment.sourceSize },
    fighter: fighterKey(),
    mode: state.mode,
    legThickness: character?.legThickness ?? null,
    splines: {
      pantsBelt: garment.pantsBeltSpline.length,
      leftOpening: garment.legOpenings.left.length,
      rightOpening: garment.legOpenings.right.length,
      portraitBelt: character?.portraitBeltSpline?.length || 0,
    },
    weights: { width: state.weightGrid.width, height: state.weightGrid.height, channel: $('weightChannel')?.value },
    fitPreview: !!state.fitCanvas,
    clearEdgeBlack: $('clearBlack')?.checked,
  };
}

function queueRender({ rebuildFit = false } = {}) {
  if (rebuildFit) state.fitCanvas = null;
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    if ($('showFit').checked && !state.fitCanvas) prepareFitPreview();
    renderPants();
    renderPortrait();
    updateCompletion();
  });
}

function pointerPosition(event, canvas) {
  const rect = canvas.getBoundingClientRect(); // CSS box used to convert touch/mouse input to backing-canvas pixels.
  return {
    x: (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height),
  };
}

function nearestSplineHandle(position, points, rect, maxDistance = 24) {
  let best = null; // Closest draggable point under the pointer.
  let bestDistance = maxDistance; // Current best hit radius.
  points.forEach((point, index) => {
    const canvasPoint = pointToCanvas(point, rect); // Candidate handle in display pixels.
    const distance = Math.hypot(position.x - canvasPoint.x, position.y - canvasPoint.y); // Pointer distance to candidate.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function pantsPointerDown(event) {
  if (!state.pantsImageRect) return;
  const canvas = $('pantsCanvas'); // Garment canvas receiving pointer input.
  const position = pointerPosition(event, canvas); // Pointer in backing-canvas pixels.
  const normalized = canvasToPoint(position.x, position.y, state.pantsImageRect); // Pointer in garment PNG normalized space.
  const garment = ensureGarment(); // Garment record edited by this pointer gesture.
  if (state.mode === 'weights') {
    snapshotForUndo('paint weights');
    state.painting = true;
    paintWeights(normalized);
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (state.mode === 'pantsBelt') {
    const index = nearestSplineHandle(position, garment.pantsBeltSpline, state.pantsImageRect); // Hit pants belt node.
    if (index != null) state.activeHandle = { type: 'pantsBelt', index };
  } else if (state.mode === 'leftOpening' || state.mode === 'rightOpening') {
    const side = state.mode === 'leftOpening' ? 'left' : 'right'; // Opening side edited by current mode.
    const index = nearestSplineHandle(position, garment.legOpenings[side], state.pantsImageRect); // Hit opening spline node.
    if (index != null) state.activeHandle = { type: 'opening', side, index };
  } else if (state.mode === 'bones') {
    let best = null; // Closest bone joint hit.
    let bestDistance = 25; // Bone joint hit radius.
    for (const side of ['left', 'right']) {
      for (const joint of ['hip', 'knee', 'ankle']) {
        const jointPosition = pointToCanvas(garment.legBones[side][joint], state.pantsImageRect); // Bone joint in display pixels.
        const distance = Math.hypot(position.x - jointPosition.x, position.y - jointPosition.y); // Pointer distance to joint.
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { type: 'bone', side, joint };
        }
      }
    }
    state.activeHandle = best;
  }
  if (state.activeHandle) {
    snapshotForUndo('move guide');
    moveActivePantsHandle(normalized);
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
}

function moveActivePantsHandle(normalized) {
  const garment = ensureGarment(); // Garment whose active guide handle is being moved.
  const handle = state.activeHandle; // Active spline/bone handle selected on pointer down.
  if (!handle) return;
  if (handle.type === 'pantsBelt') garment.pantsBeltSpline[handle.index] = normalized;
  if (handle.type === 'opening') garment.legOpenings[handle.side][handle.index] = normalized;
  if (handle.type === 'bone') garment.legBones[handle.side][handle.joint] = normalized;
  persistDraft();
  queueRender({ rebuildFit: true });
}

function pantsPointerMove(event) {
  if (!state.pantsImageRect) return;
  const canvas = $('pantsCanvas'); // Garment canvas receiving drag input.
  const position = pointerPosition(event, canvas); // Drag pointer in canvas pixels.
  const normalized = canvasToPoint(position.x, position.y, state.pantsImageRect); // Drag pointer in normalized garment space.
  if (state.painting) {
    paintWeights(normalized);
    event.preventDefault();
    return;
  }
  if (state.activeHandle) {
    moveActivePantsHandle(normalized);
    event.preventDefault();
  }
}

function pantsPointerUp(event) {
  state.painting = false;
  state.activeHandle = null;
  try { $('pantsCanvas').releasePointerCapture(event.pointerId); } catch (_) {}
  persistDraft();
}

function portraitPointerDown(event) {
  if (!state.portraitImageRect) return;
  const canvas = $('portraitCanvas'); // Portrait beltline canvas.
  const position = pointerPosition(event, canvas); // Pointer in portrait canvas pixels.
  const character = ensureCharacter(); // Per-species/gender record being edited.
  const index = nearestSplineHandle(position, character.portraitBeltSpline, state.portraitImageRect); // Hit portrait belt node.
  if (index == null) return;
  snapshotForUndo('move portrait belt');
  state.activeHandle = { type: 'portraitBelt', index };
  const normalized = canvasToPoint(position.x, position.y, state.portraitImageRect); // Pointer in normalized portrait space.
  character.portraitBeltSpline[index] = normalized;
  canvas.setPointerCapture(event.pointerId);
  persistDraft();
  queueRender();
  event.preventDefault();
}

function portraitPointerMove(event) {
  if (state.activeHandle?.type !== 'portraitBelt') return;
  const canvas = $('portraitCanvas'); // Portrait canvas receiving active belt drag.
  const position = pointerPosition(event, canvas); // Drag pointer in portrait canvas pixels.
  const normalized = canvasToPoint(position.x, position.y, state.portraitImageRect); // Drag pointer in normalized portrait space.
  ensureCharacter().portraitBeltSpline[state.activeHandle.index] = normalized;
  persistDraft();
  queueRender();
  event.preventDefault();
}

function portraitPointerUp(event) {
  if (state.activeHandle?.type === 'portraitBelt') state.activeHandle = null;
  try { $('portraitCanvas').releasePointerCapture(event.pointerId); } catch (_) {}
}

function paintWeights(point) {
  const grid = state.weightGrid; // Dense working weight field being painted.
  const channels = grid.channels; // Stable channel order.
  const selected = Math.max(0, channels.indexOf($('weightChannel').value)); // Bone/belt channel receiving paint.
  const radiusPixels = Number($('brushRadius').value) || 7; // Brush radius measured in 64×64 weight-grid cells.
  const strength = Core.clamp(Number($('brushStrength').value) || 0.3, 0.01, 1); // Blend strength for this pointer sample.
  const centerX = point.x * (grid.width - 1); // Brush center grid x.
  const centerY = point.y * (grid.height - 1); // Brush center grid y.
  const minX = Math.max(0, Math.floor(centerX - radiusPixels)); // Paint bounding-box left.
  const maxX = Math.min(grid.width - 1, Math.ceil(centerX + radiusPixels)); // Paint bounding-box right.
  const minY = Math.max(0, Math.floor(centerY - radiusPixels)); // Paint bounding-box top.
  const maxY = Math.min(grid.height - 1, Math.ceil(centerY + radiusPixels)); // Paint bounding-box bottom.
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const distance = Math.hypot(x - centerX, y - centerY); // Grid-cell distance from brush center.
      if (distance > radiusPixels) continue;
      const falloff = 1 - distance / Math.max(1, radiusPixels); // Soft circular brush falloff.
      const offset = (y * grid.width + x) * channels.length; // First byte of this weight cell.
      const current = grid.data[offset + selected]; // Current selected-channel influence.
      const next = Math.round(current + (255 - current) * strength * falloff); // New selected influence pulled toward full weight.
      const otherTotal = channels.reduce((sum, _, channelIndex) => channelIndex === selected ? sum : sum + grid.data[offset + channelIndex], 0); // Weight available to redistribute.
      const remaining = 255 - next; // Total influence left for other channels.
      grid.data[offset + selected] = next;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        if (channelIndex === selected) continue;
        grid.data[offset + channelIndex] = otherTotal > 0
          ? Math.round(grid.data[offset + channelIndex] * remaining / otherTotal)
          : 0;
      }
      Core.normalizeWeightCell(grid.data, offset, channels.length, selected);
    }
  }
  queueRender();
}

function distanceToSegment(point, a, b) {
  const vx = b.x - a.x; // Segment x direction.
  const vy = b.y - a.y; // Segment y direction.
  const wx = point.x - a.x; // Point offset x from segment start.
  const wy = point.y - a.y; // Point offset y from segment start.
  const lengthSquared = vx * vx + vy * vy; // Segment squared length.
  const t = lengthSquared > 1e-8 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared)) : 0; // Closest segment parameter.
  const px = a.x + vx * t; // Closest segment x.
  const py = a.y + vy * t; // Closest segment y.
  return Math.hypot(point.x - px, point.y - py);
}

function autoSeedWeights() {
  snapshotForUndo('auto seed weights');
  const garment = ensureGarment(); // Bone and belt guides used to seed the weight field.
  const grid = state.weightGrid; // Weight field overwritten by auto seeding.
  const channels = grid.channels; // Weight channel order.
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const point = { x: x / (grid.width - 1), y: y / (grid.height - 1) }; // Grid cell in normalized garment space.
      const leftThighDistance = distanceToSegment(point, garment.legBones.left.hip, garment.legBones.left.knee); // Left thigh proximity.
      const leftCalfDistance = distanceToSegment(point, garment.legBones.left.knee, garment.legBones.left.ankle); // Left calf proximity.
      const rightThighDistance = distanceToSegment(point, garment.legBones.right.hip, garment.legBones.right.knee); // Right thigh proximity.
      const rightCalfDistance = distanceToSegment(point, garment.legBones.right.knee, garment.legBones.right.ankle); // Right calf proximity.
      const beltDistance = Math.min(...garment.pantsBeltSpline.map(node => Math.hypot(point.x - node.x, point.y - node.y))); // Beltline proximity.
      const raw = [
        Math.exp(-(beltDistance ** 2) / 0.025),
        Math.exp(-(leftThighDistance ** 2) / 0.012),
        Math.exp(-(leftCalfDistance ** 2) / 0.012),
        Math.exp(-(rightThighDistance ** 2) / 0.012),
        Math.exp(-(rightCalfDistance ** 2) / 0.012),
      ]; // Soft initial influences; paint can refine them.
      raw[0] += Math.max(0, 0.55 - point.y) * 1.8;
      const sum = raw.reduce((total, value) => total + value, 0) || 1; // Normalization denominator.
      const offset = (y * grid.width + x) * channels.length; // First byte for this cell.
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) grid.data[offset + channelIndex] = Math.round(raw[channelIndex] * 255 / sum);
      Core.normalizeWeightCell(grid.data, offset, channels.length, 0);
    }
  }
  persistDraft();
  queueRender();
  status('Auto-seeded weights from the authored belt and leg bones. Paint to refine.', 'good');
}

function smoothWeights() {
  snapshotForUndo('smooth weights');
  const grid = state.weightGrid; // Weight grid being blurred one pass.
  const source = new Uint8Array(grid.data); // Snapshot prevents earlier cells from contaminating later blur samples.
  const channels = grid.channels.length; // Number of weight channels per cell.
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const offset = (y * grid.width + x) * channels; // Destination cell byte offset.
      for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
        let total = 0; // Blur sample sum.
        let count = 0; // Blur sample count.
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const sx = Math.max(0, Math.min(grid.width - 1, x + ox)); // Clamped source x.
            const sy = Math.max(0, Math.min(grid.height - 1, y + oy)); // Clamped source y.
            total += source[(sy * grid.width + sx) * channels + channelIndex];
            count++;
          }
        }
        grid.data[offset + channelIndex] = Math.round(total / count);
      }
      Core.normalizeWeightCell(grid.data, offset, channels, 0);
    }
  }
  persistDraft();
  queueRender();
}

function resetWeightsToBelt() {
  snapshotForUndo('reset weights');
  state.weightGrid = freshWeightGrid();
  persistDraft();
  queueRender();
}

function exportProjectObject() {
  const garment = ensureGarment(); // Current garment receives latest weights before export.
  garment.image = String($('sourcePath').value || garment.image || '').trim();
  garment.weightMap = Core.encodeWeightGridRle(state.weightGrid);
  return JSON.parse(JSON.stringify(state.project));
}

async function loadImageFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file); // Temporary local URL used only to decode the selected PNG.
  try {
    const image = new Image(); // Decoded clean pants source.
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not decode image.'));
      image.src = url;
    });
    state.sourceImage = image;
    state.sourceName = file.name;
    const garment = ensureGarment(); // Garment metadata updated from the uploaded source.
    garment.sourceSize = { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
    if (!$('sourcePath').value) $('sourcePath').value = `assets/cosmetics/pants/${file.name}`;
    garment.image = $('sourcePath').value;
    state.fitCanvas = null;
    persistDraft();
    status(`Loaded ${file.name}. Colored guides are workspace-only and will never be baked into the source.`, 'good');
    log(`Loaded pants source ${file.name} ${garment.sourceSize.width}×${garment.sourceSize.height}.`);
    queueRender({ rebuildFit: true });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function downloadFittedPng() {
  if (!state.sourceImage) {
    status('Upload a pants PNG before baking a fitted PNG.', 'warn');
    return;
  }
  status('Baking full-resolution PNG-space fit…', 'busy');
  await new Promise(resolve => setTimeout(resolve, 30));
  const maxDimension = Math.max(state.sourceImage.naturalWidth || state.sourceImage.width, state.sourceImage.naturalHeight || state.sourceImage.height); // Keeps export at original resolution.
  const source = sourceCanvas(maxDimension, $('clearBlack').checked); // Full-resolution cleaned source.
  const thickness = Number(ensureCharacter()?.legThickness) || 1; // Selected species+gender leg thickness.
  const fitted = warpCanvas(source, thickness); // One-time static PNG-space deformation.
  fitted.toBlob(blob => {
    if (!blob) {
      status('PNG export failed.', 'warn');
      return;
    }
    const url = URL.createObjectURL(blob); // Temporary browser download URL.
    const anchor = document.createElement('a'); // Programmatic fitted-PNG download link.
    anchor.href = url;
    anchor.download = `${state.garmentId}_${fighterKey().replace('::', '_')}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Baked ${anchor.download}. Rig guides were not included.`, 'good');
  }, 'image/png');
}

function downloadJson() {
  const project = exportProjectObject(); // Complete authoring project written as config-ready JSON.
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); // Download payload.
  const url = URL.createObjectURL(blob); // Temporary project download URL.
  const anchor = document.createElement('a'); // Programmatic JSON download link.
  anchor.href = url;
  anchor.download = `${state.garmentId}_pants-rig.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importProject(file) {
  if (!file) return;
  const text = await file.text(); // Imported authoring JSON text.
  const parsed = JSON.parse(text); // Imported project object.
  const validation = Core.validateProject(parsed); // Rejects malformed spline/rig exports before replacing the draft.
  if (parsed.schema !== Core.SCHEMA) throw new Error(`Expected ${Core.SCHEMA}.`);
  state.project = parsed;
  state.weightGrid = null;
  state.garmentId = Object.keys(parsed.garments || {})[0] || 'pants_1';
  ensureGarment();
  ensureCharacter();
  syncControlsFromState();
  persistDraft();
  queueRender({ rebuildFit: true });
  status(validation.ok ? 'Imported pants-rig project.' : `Imported with ${validation.errors.length} validation warning(s).`, validation.ok ? 'good' : 'warn');
}

function setMode(mode) {
  state.mode = mode;
  for (const button of document.querySelectorAll('[data-mode]')) button.classList.toggle('active', button.dataset.mode === mode);
  const labels = {
    pantsBelt: 'Drag the five lime pants-belt nodes.',
    leftOpening: 'Drag the five orange left leg-opening nodes.',
    rightOpening: 'Drag the five orange right leg-opening nodes.',
    bones: 'Drag hip, knee, and ankle joints. Cyan = thigh; magenta = calf.',
    weights: 'Paint the selected bone/belt influence over the clean pants PNG.',
  }; // Mobile instruction text for the selected workspace mode.
  $('modeHint').textContent = labels[mode] || '';
  queueRender();
}

function wire() {
  $('pantsFile').addEventListener('change', event => loadImageFile(event.target.files?.[0]).catch(error => status(error.message, 'warn')));
  $('projectFile').addEventListener('change', event => importProject(event.target.files?.[0]).catch(error => status(`Import failed: ${error.message}`, 'warn')));
  $('garmentId').addEventListener('change', () => {
    const previous = state.garmentId; // Prior garment key retained if renaming an existing record.
    const next = String($('garmentId').value || '').trim() || previous; // New garment key.
    if (next !== previous && state.project.garments?.[previous] && !state.project.garments[next]) {
      state.project.garments[next] = state.project.garments[previous];
      delete state.project.garments[previous];
    }
    state.garmentId = next;
    state.weightGrid = null;
    ensureGarment();
    persistDraft();
    syncControlsFromState();
    queueRender({ rebuildFit: true });
  });
  $('sourcePath').addEventListener('change', () => {
    ensureGarment().image = String($('sourcePath').value || '').trim();
    persistDraft();
  });
  $('fighter').addEventListener('change', async () => {
    state.fighter = state.fighters.find(fighter => fighter.id === $('fighter').value) || state.fighters[0] || null;
    ensureCharacter();
    syncControlsFromState();
    await renderPortraitSource();
    persistDraft();
    queueRender({ rebuildFit: true });
  });
  $('legThickness').addEventListener('input', () => {
    const character = ensureCharacter(); // Per-species/gender static leg fit record.
    character.legThickness = Number($('legThickness').value) || 1;
    $('legThicknessValue').textContent = `${character.legThickness.toFixed(2)}×`;
    state.fitCanvas = null;
    persistDraft();
    queueRender({ rebuildFit: true });
  });
  for (const id of ['showGuides', 'clearBlack', 'showFit']) {
    $(id).addEventListener('change', () => {
      state.fitCanvas = null;
      queueRender({ rebuildFit: true });
    });
  }
  $('blackThreshold').addEventListener('input', () => {
    $('blackThresholdValue').textContent = $('blackThreshold').value;
    state.fitCanvas = null;
    queueRender({ rebuildFit: true });
  });
  $('brushRadius').addEventListener('input', () => $('brushRadiusValue').textContent = `${$('brushRadius').value} cells`);
  $('brushStrength').addEventListener('input', () => $('brushStrengthValue').textContent = `${Math.round(Number($('brushStrength').value) * 100)}%`);
  $('weightChannel').addEventListener('change', queueRender);
  for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
  $('autoWeights').addEventListener('click', autoSeedWeights);
  $('smoothWeights').addEventListener('click', smoothWeights);
  $('resetWeights').addEventListener('click', resetWeightsToBelt);
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('downloadJson').addEventListener('click', downloadJson);
  $('copyJson').addEventListener('click', async () => {
    const text = JSON.stringify(exportProjectObject(), null, 2); // Config-ready clipboard text.
    try {
      await navigator.clipboard.writeText(text);
      status('Copied pants-rig JSON.', 'good');
    } catch (_) {
      $('jsonOutput').value = text;
      status('Clipboard unavailable; JSON is in the output box.', 'warn');
    }
  });
  $('showJson').addEventListener('click', () => $('jsonOutput').value = JSON.stringify(exportProjectObject(), null, 2));
  $('downloadFitted').addEventListener('click', downloadFittedPng);
  $('resetCharacter').addEventListener('click', () => {
    snapshotForUndo('reset character fit');
    delete state.project.characters[fighterKey()];
    ensureCharacter();
    syncControlsFromState();
    persistDraft();
    queueRender({ rebuildFit: true });
  });
  $('resetGarment').addEventListener('click', () => {
    snapshotForUndo('reset garment guides');
    const current = ensureGarment(); // Existing source metadata retained while authored guides reset.
    const replacement = defaultGarment(); // Fresh guide layout.
    replacement.image = current.image;
    replacement.sourceSize = current.sourceSize;
    state.project.garments[state.garmentId] = replacement;
    state.weightGrid = freshWeightGrid();
    persistDraft();
    queueRender({ rebuildFit: true });
  });
  $('copyDebug').addEventListener('click', async () => {
    const text = `${$('debugSnapshot').textContent}\n\n${$('debug').textContent}`; // Mobile-readable diagnostics bundle.
    try { await navigator.clipboard.writeText(text); status('Copied diagnostics.', 'good'); }
    catch (_) { status('Clipboard unavailable; diagnostics remain visible below.', 'warn'); }
  });

  const pantsCanvas = $('pantsCanvas'); // Garment canvas pointer target.
  pantsCanvas.addEventListener('pointerdown', pantsPointerDown);
  pantsCanvas.addEventListener('pointermove', pantsPointerMove);
  pantsCanvas.addEventListener('pointerup', pantsPointerUp);
  pantsCanvas.addEventListener('pointercancel', pantsPointerUp);
  const portraitCanvas = $('portraitCanvas'); // Portrait beltline pointer target.
  portraitCanvas.addEventListener('pointerdown', portraitPointerDown);
  portraitCanvas.addEventListener('pointermove', portraitPointerMove);
  portraitCanvas.addEventListener('pointerup', portraitPointerUp);
  portraitCanvas.addEventListener('pointercancel', portraitPointerUp);
}

async function boot() {
  if (!Core) {
    status('pants-rig-core.js failed to load.', 'warn');
    return;
  }
  state.project = freshProject();
  const savedFighterKey = restoreDraft(); // Species/gender selection restored after fighter discovery.
  $('garmentId').value = state.garmentId;
  ensureGarment();
  populateFighters(savedFighterKey);
  ensureCharacter();
  for (const channel of Core.WEIGHT_CHANNELS) {
    const option = document.createElement('option'); // Weight-paint channel option.
    option.value = channel;
    option.textContent = channel.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase());
    $('weightChannel').appendChild(option);
  }
  $('weightChannel').value = 'leftThigh';
  wire();
  syncControlsFromState();
  setMode('pantsBelt');
  await renderPortraitSource();
  queueRender({ rebuildFit: true });
  status('Ready. Upload the clean pants PNG; the colored splines/bones are workspace guides only.', 'good');
  log(`Pants Rig Author ready · ${state.fighters.length} canonical species/gender portraits found.`);
}

window.__pantsRigAuthorDebug = { // Mobile-accessible author diagnostics without DevTools.
  snapshot: debugSnapshot,
  exportProject: exportProjectObject,
  state: () => state,
  rerender: () => queueRender({ rebuildFit: true }),
  validate: () => Core.validateProject(exportProjectObject()),
};

boot().catch(error => {
  status(`Boot failed: ${error?.message || error}`, 'warn');
  log(`BOOT ERROR ${error?.stack || error}`);
});
})();

// Hat-attachment enhancement for docs/tools/animal-head-rig/.
// Stores hatAttachment as an ordinary creature-record field so the existing
// editor's single-record and collection export paths preserve it automatically.
(() => {
  'use strict';
  if (typeof document === 'undefined' || !/\/tools\/animal-head-rig\//.test(location.pathname || '')) return;

  const SCRIPT_URL = document.currentScript?.src || '';
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL).href : '../../';
  const STORAGE_KEY = 'hobunji_animal_head_rigs_v1'; // Same preview storage used by the base head-rig editor.
  const DEFAULT_PREVIEW_HAT = 'assets/cosmetics/clothes/hat/headband.png'; // Neutral existing hat used only to visualize attachment placement.
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, Number.isFinite(Number(v)) ? Number(v) : a));
  const $ = id => document.getElementById(id);
  const state = {
    installed: false,
    armed: false,
    image: null,
    crop: null,
    attachment: { enabled: true, coordinateSpace: 'sprite-normalized-top-left', anchor: { x: 0.5, y: 0.2 }, width: 0.34, rotationDeg: 0, flipX: false, artAnchor: { x: 0.5, y: 0.86 } },
    lastRecordSignature: '',
    stageStabilized: false,
    lastError: null,
  }; // Public debug state also drives the independent overlay canvas.

  let panel = null;
  let overlay = null;
  let debugEl = null;

  function parseJson(text, fallback = {}) {
    try { const value = JSON.parse(text || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback; }
    catch (_) { return fallback; }
  }

  function decodeWeightMap(raw) {
    if (!raw?.width || !raw?.height || !Array.isArray(raw.data)) return null;
    const width = Math.max(1, Math.round(Number(raw.width) || 1));
    const height = Math.max(1, Math.round(Number(raw.height) || 1));
    const unset = Number.isFinite(Number(raw.unsetValue)) ? Number(raw.unsetValue) : 256;
    const values = new Uint16Array(width * height); values.fill(unset);
    if (raw.encoding === 'rle-u9') {
      let cursor = 0;
      for (let i = 0; i + 1 < raw.data.length && cursor < values.length; i += 2) {
        const run = Math.max(0, Math.round(Number(raw.data[i]) || 0));
        const value = Math.max(0, Math.min(256, Math.round(Number(raw.data[i + 1]) || 0)));
        values.fill(value, cursor, Math.min(values.length, cursor + run)); cursor += run;
      }
    } else {
      for (let i = 0; i < values.length && i < raw.data.length; i += 1) values[i] = Math.max(0, Math.min(256, Math.round(Number(raw.data[i]) || 0)));
    }
    return { width, height, unset, values };
  }

  function derivedAttachmentFromRig(rig) {
    const decoded = decodeWeightMap(rig?.weightMap);
    if (decoded) {
      let minX = decoded.width, minY = decoded.height, maxX = -1, maxY = -1;
      for (let y = 0; y < decoded.height; y += 1) for (let x = 0; x < decoded.width; x += 1) {
        const value = decoded.values[y * decoded.width + x];
        if (value === decoded.unset || value < 128) continue;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (maxX >= minX) {
        return {
          ...state.attachment,
          anchor: { x: (minX + maxX + 1) / (2 * decoded.width), y: minY / decoded.height },
          width: clamp(((maxX - minX + 1) / decoded.width) * 1.35, 0.14, 0.9),
          artAnchor: { ...state.attachment.artAnchor },
        };
      }
    }
    const pivot = rig?.pivot || {};
    return { ...state.attachment, anchor: { x: clamp(pivot.x ?? 0.5), y: clamp((Number(pivot.y) || 0.38) - 0.18) }, artAnchor: { ...state.attachment.artAnchor } };
  }

  function normalizeAttachment(raw, rig) {
    const fallback = derivedAttachmentFromRig(rig);
    const anchor = raw?.anchor || {};
    const artAnchor = raw?.artAnchor || {};
    return {
      enabled: raw?.enabled !== false,
      coordinateSpace: 'sprite-normalized-top-left',
      anchor: { x: clamp(anchor.x ?? fallback.anchor.x), y: clamp(anchor.y ?? fallback.anchor.y) },
      width: clamp(raw?.width ?? fallback.width, 0.02, 2),
      rotationDeg: Math.max(-180, Math.min(180, Number(raw?.rotationDeg ?? fallback.rotationDeg) || 0)),
      flipX: raw?.flipX === true || raw?.mirrorX === true || fallback.flipX === true,
      artAnchor: { x: clamp(artAnchor.x ?? fallback.artAnchor.x), y: clamp(artAnchor.y ?? fallback.artAnchor.y) },
    };
  }

  function currentRecord() { return parseJson($('output')?.value, {}); }
  function currentExtras() { return parseJson($('extraVars')?.value, {}); }

  function writeAttachment(action = 'hat attachment updated') {
    const extrasEl = $('extraVars');
    if (!extrasEl) return;
    const extras = currentExtras();
    extras.hatAttachment = {
      enabled: !!state.attachment.enabled,
      coordinateSpace: 'sprite-normalized-top-left',
      anchor: { x: +state.attachment.anchor.x.toFixed(5), y: +state.attachment.anchor.y.toFixed(5) },
      width: +state.attachment.width.toFixed(5),
      rotationDeg: +state.attachment.rotationDeg.toFixed(3),
      flipX: !!state.attachment.flipX,
      artAnchor: { x: +state.attachment.artAnchor.x.toFixed(5), y: +state.attachment.artAnchor.y.toFixed(5) },
    }; // Top-level field survives the base editor's buildRecord() and whole-collection download paths.
    extrasEl.value = JSON.stringify(extras, null, 2);
    extrasEl.dispatchEvent(new Event('input', { bubbles: true }));
    refreshInputs(); drawOverlay(); refreshDebug(action);
  }

  function hydrateFromRecord(force = false) {
    const record = currentRecord();
    const signature = JSON.stringify([record.id || '', record.headRig?.pivot || null, record.hatAttachment || null]);
    if (!force && signature === state.lastRecordSignature) return;
    state.lastRecordSignature = signature;
    state.attachment = normalizeAttachment(record.hatAttachment, record.headRig);
    refreshInputs(); drawOverlay(); refreshDebug(record.hatAttachment ? 'loaded authored hat attachment' : 'derived hat attachment from head paint');
  }

  function refreshInputs() {
    if (!panel) return;
    $('animalHatRigEnabled').checked = !!state.attachment.enabled;
    $('animalHatRigX').value = state.attachment.anchor.x.toFixed(4);
    $('animalHatRigY').value = state.attachment.anchor.y.toFixed(4);
    $('animalHatRigWidth').value = state.attachment.width.toFixed(4);
    $('animalHatRigRotation').value = state.attachment.rotationDeg.toFixed(1);
    $('animalHatRigArtX').value = state.attachment.artAnchor.x.toFixed(4);
    $('animalHatRigArtY').value = state.attachment.artAnchor.y.toFixed(4);
    $('animalHatSetAnchor').classList.toggle('active', state.armed);
    const flipButton = $('animalHatFlipX');
    if (flipButton) {
      flipButton.classList.toggle('active', !!state.attachment.flipX);
      flipButton.setAttribute('aria-pressed', state.attachment.flipX ? 'true' : 'false');
      flipButton.textContent = state.attachment.flipX ? 'Hat flipped horizontally ✓' : 'Flip hat horizontally';
    }
  }

  function refreshDebug(action = '') {
    if (!debugEl) return;
    debugEl.textContent = `Hat rig: ${action || 'ready'} | anchor ${state.attachment.anchor.x.toFixed(3)},${state.attachment.anchor.y.toFixed(3)} | width ${state.attachment.width.toFixed(3)} | rot ${state.attachment.rotationDeg.toFixed(1)}° | flipX ${state.attachment.flipX ? 'yes' : 'no'}${state.lastError ? ` | ERROR ${state.lastError}` : ''}`;
    window.__animalHeadRigHatDebug = { ...state, attachment: JSON.parse(JSON.stringify(state.attachment)), image: state.image ? 'loaded' : null, crop: state.crop ? { width: state.crop.width, height: state.crop.height } : null };
  }

  function imageUrl(path) {
    const raw = String(path || '').trim();
    if (/^(?:data:|blob:|https?:)/i.test(raw)) return raw;
    return new URL(raw.replace(/^\.\//, ''), DOCS_BASE).href;
  }

  function loadPreviewHat() {
    const path = $('animalHatPreviewPath')?.value || DEFAULT_PREVIEW_HAT;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      state.image = img; state.lastError = null;
      const source = document.createElement('canvas'); source.width = img.naturalWidth || img.width; source.height = img.naturalHeight || img.height;
      const ctx = source.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      try {
        const data = ctx.getImageData(0, 0, source.width, source.height).data;
        let minX = source.width, minY = source.height, maxX = -1, maxY = -1;
        for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
          if (data[(y * source.width + x) * 4 + 3] < 8) continue;
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        if (maxX >= minX) {
          const w = maxX - minX + 1, h = maxY - minY + 1, crop = document.createElement('canvas'); crop.width = w; crop.height = h;
          crop.getContext('2d').drawImage(source, minX, minY, w, h, 0, 0, w, h); state.crop = { canvas: crop, width: w, height: h };
        } else state.crop = null;
      } catch (_) { state.crop = { canvas: source, width: source.width, height: source.height }; }
      drawOverlay(); refreshDebug('preview hat loaded');
    };
    img.onerror = () => { state.image = null; state.crop = null; state.lastError = `could not load ${path}`; drawOverlay(); refreshDebug('preview load failed'); };
    img.src = imageUrl(path);
  }

  function resizeOverlay() {
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect(); const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    drawOverlay();
  }

  function spriteFit() {
    if (!overlay) return null;
    const width = overlay.width, height = overlay.height;
    const aspectHW = Math.max(0.0001, Number($('spriteAspect')?.value) || 1); // Base editor stores sourceHeight/sourceWidth here.
    const sourceAspect = 1 / aspectHW;
    let drawWidth = width, drawHeight = drawWidth / sourceAspect;
    if (drawHeight > height) { drawHeight = height; drawWidth = drawHeight * sourceAspect; }
    return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
  }

  function drawOverlay() {
    if (!overlay) return;
    const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!state.crop?.canvas || !state.attachment.enabled || !$('animalHatShowPreview')?.checked) return;
    const fit = spriteFit(); if (!fit) return;
    const drawWidth = state.attachment.width * fit.width;
    const drawHeight = drawWidth * state.crop.height / Math.max(1, state.crop.width);
    const x = fit.x + state.attachment.anchor.x * fit.width, y = fit.y + state.attachment.anchor.y * fit.height;
    ctx.save(); ctx.translate(x, y); ctx.rotate(state.attachment.rotationDeg * Math.PI / 180); if (state.attachment.flipX) ctx.scale(-1, 1); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.crop.canvas, -state.attachment.artAnchor.x * drawWidth, -state.attachment.artAnchor.y * drawHeight, drawWidth, drawHeight);
    ctx.restore();
    ctx.save(); ctx.strokeStyle = '#f0c878'; ctx.lineWidth = Math.max(2, window.devicePixelRatio || 1); ctx.beginPath(); ctx.arc(x, y, 6 * (window.devicePixelRatio || 1), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  function setAnchorFromPointer(event) {
    if (!state.armed) return;
    const fit = spriteFit(), rect = overlay.getBoundingClientRect(); if (!fit || !rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) * overlay.width / rect.width, y = (event.clientY - rect.top) * overlay.height / rect.height;
    state.attachment.anchor.x = clamp((x - fit.x) / fit.width); state.attachment.anchor.y = clamp((y - fit.y) / fit.height);
    state.armed = false; overlay.style.pointerEvents = 'none'; writeAttachment('anchor placed on sprite');
  }

  function bindNumeric(id, setter) {
    $(id)?.addEventListener('change', () => { setter(Number($(id).value)); writeAttachment(`${id} changed`); });
  }

  function augmentPreviewStorage() {
    setTimeout(() => {
      const id = $('animalId')?.value?.trim(); if (!id) return;
      try {
        const rigs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (rigs?.[id]) { rigs[id].hatAttachment = JSON.parse(JSON.stringify(state.attachment)); localStorage.setItem(STORAGE_KEY, JSON.stringify(rigs)); refreshDebug('saved rig + hat attachment for game preview'); }
      } catch (error) { state.lastError = error.message; refreshDebug('preview storage update failed'); }
    }, 0);
  }

  function stabilizeStageCanvas(wrap) {
    const baseCanvas = $('canvas');
    if (!baseCanvas || !wrap) return;
    baseCanvas.style.position = 'absolute'; // Removes canvas intrinsic dimensions from grid/flex sizing so ResizeObserver backing-store writes cannot move the stage.
    baseCanvas.style.inset = '0';
    baseCanvas.style.width = '100%';
    baseCanvas.style.height = '100%';
    baseCanvas.style.maxWidth = 'none';
    baseCanvas.style.maxHeight = 'none';
    wrap.style.isolation = 'isolate';
    state.stageStabilized = true;
  }

  function install() {
    if (state.installed) return;
    const controls = document.querySelector('.panel.controls'), wrap = document.querySelector('.canvas-wrap');
    if (!controls || !wrap || !$('extraVars') || !$('output')) return setTimeout(install, 50);
    state.installed = true;
    stabilizeStageCanvas(wrap);
    panel = document.createElement('div');
    panel.innerHTML = `
      <h2>Hat attachment</h2>
      <div class="hint">Rig one species-level attachment transform; Animal/Fey NPCs can then wear any existing hat at this anchor. The transform exports as <code>hatAttachment</code> with the creature record.</div>
      <label class="row" style="justify-content:flex-start"><input id="animalHatRigEnabled" type="checkbox" checked> Enable hats for this species</label>
      <label class="row" style="justify-content:flex-start"><input id="animalHatShowPreview" type="checkbox" checked> Show preview hat</label>
      <label>Preview hat asset<input id="animalHatPreviewPath" value="${DEFAULT_PREVIEW_HAT}"></label>
      <div class="row"><button id="animalHatLoadPreview">Load preview hat</button><button id="animalHatSetAnchor">Set hat anchor on sprite</button></div>
      <div class="grid2"><label>Anchor X<input id="animalHatRigX" type="number" min="0" max="1" step=".005"></label><label>Anchor Y<input id="animalHatRigY" type="number" min="0" max="1" step=".005"></label></div>
      <div class="grid2"><label>Hat width / sprite width<input id="animalHatRigWidth" type="number" min=".02" max="2" step=".01"></label><label>Rotation °<input id="animalHatRigRotation" type="number" min="-180" max="180" step="1"></label></div>
      <div class="grid2"><label>Hat art anchor X<input id="animalHatRigArtX" type="number" min="0" max="1" step=".01"></label><label>Hat art anchor Y<input id="animalHatRigArtY" type="number" min="0" max="1" step=".01"></label></div>
      <div class="row"><button id="animalHatDeriveFromHead">Derive from painted Head</button><button id="animalHatFlipX" type="button" aria-pressed="false">Flip hat horizontally</button></div>
      <div id="animalHatRigDebug" class="hint" style="word-break:break-word"></div>`;
    const motionHeading = [...controls.querySelectorAll('h2')].find(node => node.textContent.includes('Motion'));
    controls.insertBefore(panel, motionHeading?.parentElement || controls.lastElementChild);
    debugEl = $('animalHatRigDebug');

    overlay = document.createElement('canvas'); overlay.id = 'animalHatRigOverlay';
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;touch-action:none;z-index:3'; wrap.appendChild(overlay);
    overlay.addEventListener('pointerdown', setAnchorFromPointer);
    new ResizeObserver(resizeOverlay).observe(wrap); window.addEventListener('resize', resizeOverlay);

    $('animalHatRigEnabled').addEventListener('change', () => { state.attachment.enabled = $('animalHatRigEnabled').checked; writeAttachment('hat support toggled'); });
    $('animalHatShowPreview').addEventListener('change', drawOverlay);
    $('animalHatLoadPreview').addEventListener('click', loadPreviewHat);
    $('animalHatPreviewPath').addEventListener('change', loadPreviewHat);
    $('animalHatSetAnchor').addEventListener('click', () => { state.armed = !state.armed; overlay.style.pointerEvents = state.armed ? 'auto' : 'none'; refreshInputs(); refreshDebug(state.armed ? 'tap sprite to place anchor' : 'anchor placement cancelled'); });
    $('animalHatDeriveFromHead').addEventListener('click', () => { state.attachment = normalizeAttachment(null, currentRecord().headRig); writeAttachment('derived from painted Head influence'); });
    $('animalHatFlipX').addEventListener('click', () => { state.attachment.flipX = !state.attachment.flipX; writeAttachment(state.attachment.flipX ? 'hat sprite flipped horizontally' : 'hat sprite unflipped'); });
    bindNumeric('animalHatRigX', v => state.attachment.anchor.x = clamp(v)); bindNumeric('animalHatRigY', v => state.attachment.anchor.y = clamp(v));
    bindNumeric('animalHatRigWidth', v => state.attachment.width = clamp(v, 0.02, 2)); bindNumeric('animalHatRigRotation', v => state.attachment.rotationDeg = Math.max(-180, Math.min(180, v || 0)));
    bindNumeric('animalHatRigArtX', v => state.attachment.artAnchor.x = clamp(v)); bindNumeric('animalHatRigArtY', v => state.attachment.artAnchor.y = clamp(v));
    $('savePreviewRig')?.addEventListener('click', augmentPreviewStorage);
    $('spriteAspect')?.addEventListener('input', drawOverlay); $('previewDeform')?.addEventListener('change', drawOverlay);

    hydrateFromRecord(true); loadPreviewHat(); resizeOverlay();
    setInterval(() => hydrateFromRecord(false), 250);
    refreshDebug('installed');
  }

  window.AnimalHeadRigHatAuthoring = { install, getAttachment: () => JSON.parse(JSON.stringify(state.attachment)), getDebug: () => window.__animalHeadRigHatDebug };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();

(function (global) {
  'use strict';

  // Independent pixel operations, also available to the Node regression test.
  function stem(value) {
    return String(value || '').normalize('NFKD').toLowerCase()
      .replace(/[\u0300-\u036f]/g, '').replace(/^weapon(?:head|shaft)[_-]/, '')
      .replace(/['\u2019]/g, '').replace(/[^a-z0-9_-]+/g, '_')
      .replace(/_+/g, '_').replace(/^[-_]+|[-_]+$/g, '').slice(0, 64);
  }
  function fileName(kind, name) {
    if (kind !== 'head' && kind !== 'shaft') throw new Error('Choose Head or Shaft.');
    const key = stem(name); // Safe part name used for both exported PNG types.
    if (!key) throw new Error('Enter a part name before exporting.');
    return 'weapon' + kind + '_' + key + '.png';
  }
  function applyMask(pixels, mask, mode) {
    if (!['remove', 'isolate'].includes(mode) || pixels.length !== mask.length || pixels.length % 4) {
      throw new Error('Invalid pixel selection.');
    }
    const result = new Uint8ClampedArray(pixels); // Separate RGBA buffer; inputs remain unchanged for Undo.
    let affected = 0, remaining = 0; // UI diagnostics show exactly how many opaque pixels changed/remain.
    for (let i = 0; i < result.length; i += 4) {
      const inside = mask[i + 3] >= 128; // Crisp pixel boundary: keep original RGB/alpha without antialiased recoloring.
      if ((mode === 'remove' ? inside : !inside) && result[i + 3]) {
        result[i] = result[i + 1] = result[i + 2] = result[i + 3] = 0;
        affected++;
      }
      if (result[i + 3]) remaining++;
    }
    return { pixels: result, affected, remaining };
  }
  global.ModularWeaponCutterCore = Object.freeze({ stem, fileName, applyMask });

  if (!global.document) return; // Node tests load the pure helpers without constructing an editor DOM.
  const byId = id => document.getElementById(id); // Local editor elements, unrelated to attachment-point controls.
  const canvas = byId('cut-canvas'); // Visible raster and lasso overlay; never used as the export bitmap.
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Pixel-exact working view.
  const FRAME = { width: 450, height: 1204 }; // Shared source coordinate frame used by modular composition.
  const MAX_UNDO = 8; // Bound history memory on mobile.
  const builtins = [
    ['Hatchet', 'axe_hatchet.png'], ['Pick-Shovel', 'shovel_pickshovel.png'],
    ['Hoe', 'hoe_bronzehoe.png'], ['Fishing Spear', 'harpoon_fishingspear.png'],
    ['Fishing Mace', 'harpoon_fishingmace.png'], ["B'shuakauitl", "b'shuakauitl.png"],
    ['Dagger Sword', 'dagger-sword_sweep.png'], ['Plains Sword', 'plains-sword.png'],
    ['Dagger', 'dagger.png'], ['Kylie', 'kylie.png'],
    ['War Cleaver', 'war-cleaver.png'], ['Warhammer', 'warhammer.png'],
    ['Harlyao Longsword', 'harlyao_longsword.png'],
    ['Harlyao Broadsword', 'harlyao_broadsword.png'],
    ['Crossbow', 'ranged_crossbow.png'], ['Loaded Crossbow', 'ranged_crossbow_loaded.png'],
    ['Scatterbow', 'ranged_scatterbow.png'], ['Loaded Scatterbow', 'ranged_scatterbow_loaded.png']
  ]; // Verified full-weapon sprite paths shared with the animation editor and relic definitions.
  let pixels = null; // Current editable RGBA frame, exported without the selection outline.
  let original = null; // Unmodified loaded frame used by Reset.
  let history = []; // RGBA snapshots used by Undo.
  let path = []; // Lasso vertices in original 450 x 1204 coordinates.
  let activePointer = null; // The one touch/mouse pointer currently drawing a lasso.
  let source = null; // Path/filename shown by mobile diagnostics.
  let sourceSize = null; // Native dimensions, to warn when game-frame normalization is needed.
  let renderPending = false; // RequestAnimationFrame coalesces move events while dragging.
  let loadSerial = 0; // Discard results of earlier asynchronous sprite loads.

  function status(text) { byId('cut-status').textContent = text; }
  function updateOutputName() {
    try {
      byId('cut-output').textContent = 'docs/assets/toolsprites/modular_pieces/' +
        fileName(byId('cut-kind').value, byId('cut-name').value);
    } catch (_) { byId('cut-output').textContent = 'Enter a part name.'; }
  }
  function opaqueCount(data) {
    let count = 0; // Count remaining nontransparent source pixels for diagnostics and export validation.
    if (data) for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
    return count;
  }
  function diagnostics() {
    byId('cut-debug').textContent = JSON.stringify({
      source, sourceSize, workingFrame: FRAME, selectedPoints: path.length,
      remainingOpaquePixels: opaqueCount(pixels), undoDepth: history.length,
      output: byId('cut-output').textContent
    }, null, 2);
  }
  function renderNow() {
    renderPending = false;
    ctx.clearRect(0, 0, FRAME.width, FRAME.height);
    if (pixels) ctx.putImageData(new ImageData(pixels, FRAME.width, FRAME.height), 0, 0);
    if (path.length) {
      ctx.save();
      ctx.strokeStyle = '#ffce64'; ctx.lineWidth = 3;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
      for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
      if (activePointer === null && path.length >= 3) ctx.closePath();
      ctx.stroke(); ctx.restore();
    }
    diagnostics();
  }
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(renderNow);
  }
  function pushUndo() {
    history.push(new Uint8ClampedArray(pixels)); // Snapshot before destructive edits and resets.
    if (history.length > MAX_UNDO) history.shift();
  }
  async function acceptImage(img, description, suggestedName) {
    const work = document.createElement('canvas'); // Rasterize once into the same frame the gameplay compositor uses.
    work.width = FRAME.width; work.height = FRAME.height;
    const workCtx = work.getContext('2d', { willReadFrequently: true }); // RGBA extraction also verifies CORS.
    workCtx.clearRect(0, 0, FRAME.width, FRAME.height);
    workCtx.drawImage(img, 0, 0, FRAME.width, FRAME.height);
    const next = workCtx.getImageData(0, 0, FRAME.width, FRAME.height).data;
    if (!opaqueCount(next)) throw new Error('The source image has no visible pixels.');
    original = new Uint8ClampedArray(next); pixels = new Uint8ClampedArray(next);
    source = description; sourceSize = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
    history = []; path = []; activePointer = null;
    byId('cut-name').value = stem(suggestedName);
    updateOutputName(); renderNow();
    status('Loaded ' + description + '. Draw a closed lasso, then Remove inside or Keep inside.' +
      (sourceSize.width !== FRAME.width || sourceSize.height !== FRAME.height
        ? ' Original dimensions were normalized to the game\'s 450 x 1204 frame.' : ' Source RGBA pixels are unchanged.'));
  }
  async function loadRepoSprite(asset, label) {
    const ticket = ++loadSerial; // Prevent a slow earlier request from replacing a later sprite.
    try {
      const img = await global.ModularWeapons.loadImage(asset, '../../');
      if (ticket !== loadSerial) return;
      await acceptImage(img, asset, label);
    } catch (error) { if (ticket === loadSerial) status('Unable to load sprite: ' + error.message); }
  }
  function assetPath(raw) {
    const value = String(raw || '').trim().replace(/^(?:\.\/|docs\/)+/, '');
    if (!/^assets\/toolsprites\/[a-z0-9_\/' .-]+\.png$/i.test(value) || value.includes('..')) {
      throw new Error('Enter a path under assets/toolsprites/ ending in .png.');
    }
    return value;
  }
  function pointFor(event) {
    const rect = canvas.getBoundingClientRect(); // Canvas CSS retains its native aspect ratio, including on phones.
    return {
      x: Math.max(0, Math.min(FRAME.width, (event.clientX - rect.left) * FRAME.width / rect.width)),
      y: Math.max(0, Math.min(FRAME.height, (event.clientY - rect.top) * FRAME.height / rect.height))
    };
  }
  function extend(event) {
    const point = pointFor(event); // Use subpixel vertex positions, then rasterize to an exact mask.
    const last = path[path.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1.5) {
      path.push(point); scheduleRender();
    }
  }
  canvas.addEventListener('pointerdown', event => {
    if (!pixels || activePointer !== null) return;
    event.preventDefault();
    activePointer = event.pointerId; path = [];
    canvas.setPointerCapture(event.pointerId);
    extend(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault(); extend(event);
  });
  function finish(event, cancel) {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    if (!cancel) extend(event); else path = [];
    activePointer = null; renderNow();
    if (!cancel) status(path.length >= 3
      ? 'Lasso ready. Remove inside or Keep inside; you can Undo either operation.'
      : 'Lasso too short. Drag a loop around at least three points.');
  }
  canvas.addEventListener('pointerup', event => finish(event, false));
  canvas.addEventListener('pointercancel', event => finish(event, true));
  canvas.addEventListener('lostpointercapture', event => {
    if (activePointer === event.pointerId) { activePointer = null; path = []; renderNow(); }
  });

  function commitSelection(mode) {
    if (!pixels || activePointer !== null || path.length < 3) {
      status('Load a sprite and finish a lasso first.'); return;
    }
    const maskCanvas = document.createElement('canvas'); // Scratch selection raster, separate from export.
    maskCanvas.width = FRAME.width; maskCanvas.height = FRAME.height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true }); // Alpha mask used by applyMask().
    maskCtx.fillStyle = '#fff'; maskCtx.beginPath(); maskCtx.moveTo(path[0].x, path[0].y);
    for (const point of path.slice(1)) maskCtx.lineTo(point.x, point.y);
    maskCtx.closePath(); maskCtx.fill();
    const mask = maskCtx.getImageData(0, 0, FRAME.width, FRAME.height).data;
    const outcome = applyMask(pixels, mask, mode); // Keeps RGB and alpha of surviving pixels byte-for-byte.
    pushUndo(); pixels = outcome.pixels; path = []; renderNow();
    status((mode === 'isolate' ? 'Kept lasso area.' : 'Removed lasso area.') +
      ' Deleted ' + outcome.affected + ' visible pixels; ' + outcome.remaining + ' remain.');
  }
  byId('cut-remove').onclick = () => commitSelection('remove');
  byId('cut-isolate').onclick = () => commitSelection('isolate');
  byId('cut-clear-selection').onclick = () => { path = []; activePointer = null; renderNow(); status('Selection cleared.'); };
  byId('cut-undo').onclick = () => {
    if (!history.length) { status('Nothing to undo.'); return; }
    pixels = history.pop(); path = []; renderNow(); status('Restored the previous pixel edit.');
  };
  byId('cut-reset').onclick = () => {
    if (!original) { status('Load a sprite first.'); return; }
    pushUndo(); pixels = new Uint8ClampedArray(original); path = [];
    renderNow(); status('Restored the original full sprite.');
  };
  byId('cut-kind').onchange = updateOutputName;
  byId('cut-name').oninput = updateOutputName;
  const picker = byId('cut-existing'); // Stock weapon selector; custom repo path and local files cover other PNGs.
  for (const [label, filename] of builtins) {
    const option = document.createElement('option'); // User-friendly label with the authoritative sprite basename.
    option.value = 'assets/toolsprites/' + filename; option.textContent = label;
    picker.appendChild(option);
  }
  byId('cut-load-existing').onclick = () => {
    const option = picker.options[picker.selectedIndex]; // Default export stem follows selected stock weapon's label.
    loadRepoSprite(option.value, option.textContent);
  };
  byId('cut-load-path').onclick = () => {
    try {
      const path = assetPath(byId('cut-path').value); // A hand-entered existing sprite path, not executable code.
      const name = path.split('/').pop().replace(/\.png$/i, '');
      loadRepoSprite(path, name);
    } catch (error) { status(error.message); }
  };
  byId('cut-file').onchange = async event => {
    const file = event.target.files?.[0]; // Local PNG allows newly-authored weapons not yet in the repository.
    if (!file) return;
    const ticket = ++loadSerial; // Local-file loading also supersedes pending repository requests.
    try {
      if (!/\.png$/i.test(file.name) || file.size > 30 * 1024 * 1024) throw new Error('Choose a PNG smaller than 30 MB.');
      const url = URL.createObjectURL(file); // Blob URL avoids external services and keeps artwork on-device.
      try {
        const img = new Image(); // Browser decodes user-selected artwork with transparency.
        await new Promise((resolve, reject) => {
          img.onload = resolve; img.onerror = () => reject(new Error('Could not decode PNG.')); img.src = url;
        });
        if (ticket === loadSerial) await acceptImage(img, file.name, file.name.replace(/\.png$/i, ''));
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { if (ticket === loadSerial) status('PNG import failed: ' + error.message); }
    event.target.value = '';
  };
  byId('cut-export').onclick = () => {
    try {
      if (!pixels || !opaqueCount(pixels)) throw new Error('The part has no visible pixels to export.');
      const name = fileName(byId('cut-kind').value, byId('cut-name').value); // Existing modular-pieces filename convention.
      const png = document.createElement('canvas'); // Export from data, never the drawn lasso overlay.
      png.width = FRAME.width; png.height = FRAME.height;
      png.getContext('2d').putImageData(new ImageData(pixels, FRAME.width, FRAME.height), 0, 0);
      png.toBlob(blob => {
        if (!blob) { status('PNG encoding failed.'); return; }
        const url = URL.createObjectURL(blob); // Download is supported on mobile as in the original editor.
        const anchor = document.createElement('a'); // No popup window or external image editor required.
        anchor.href = url; anchor.download = name; document.body.appendChild(anchor);
        anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
        status('Exported ' + name + '. Add it to docs/assets/toolsprites/modular_pieces/ and register its attachment data in docs/config/modular-weapons.js.');
      }, 'image/png');
    } catch (error) { status('Export failed: ' + error.message); }
  };
  updateOutputName();
  status('Choose an existing weapon, enter an asset path, or import a PNG to begin.');
  diagnostics();
})(window);

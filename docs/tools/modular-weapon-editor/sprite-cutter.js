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
      if (mode === 'remove' ? inside : !inside) {
        if (result[i + 3]) affected++; // Visible-pixel counter ignores already-transparent source pixels.
        result[i] = result[i + 1] = result[i + 2] = result[i + 3] = 0; // Clear hidden RGB too.
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
    ['Dagger Sword (sweep)', 'dagger-sword_sweep.png'], ['Dagger Sword (thrust)', 'dagger-sword_thrust.png'], ['Plains Sword', 'plains-sword.png'],
    ['Dagger', 'dagger.png'], ['Kylie', 'kylie.png'],
    ['War Cleaver', 'war-cleaver.png'], ['Work Hammer', 'work_hammer.png'],
    ['Heavy Mallet', 'heavy_mallet.png'], ['Porakaneki Greatclub', 'porakaneki_greatclub.png'],
    ["B'gungku", "b'gungku.png"], ['Round Shield', 'roundshield.png'], ['Warhammer', 'warhammer.png'],
    ['Harlyao Longsword', 'harlyao_longsword.png'],
    ['Harlyao Broadsword', 'harlyao_broadsword.png'],
    ['Crossbow', 'ranged_crossbow.png'], ['Loaded Crossbow', 'ranged_crossbow_loaded.png'],
    ['Scatterbow', 'ranged_scatterbow.png'], ['Loaded Scatterbow', 'ranged_scatterbow_loaded.png']
  ]; // Verified full-weapon sprite paths shared with the animation editor and relic definitions.
  const uploadedPartFiles = [
    "weaponhead_bshuakauitl.png",
    "weaponhead_dagger-sword.png",
    "weaponhead_dagger.png",
    "weaponhead_fishing_mace.png",
    "weaponhead_fishing_spear.png",
    "weaponhead_harlyao_broadsword.png",
    "weaponhead_harlyao_longsword.png",
    "weaponhead_hatchet.png",
    "weaponhead_hoe.png",
    "weaponhead_kylie.png",
    "weaponhead_pick-shovel_pick.png",
    "weaponhead_pickshovel_scoop.png",
    "weaponhead_plains-blade.png",
    "weaponhead_porakaneki_greatclub.png",
    "weaponhead_war-cleaver.png",
    "weaponhead_warhammer.png",
    "weaponhead_work_hammer.png",
    "weaponshaft_b'shuakauitl.png",
    "weaponshaft_bgungku.png",
    "weaponshaft_dagger-sword.png",
    "weaponshaft_dagger.png",
    "weaponshaft_fishing_mace.png",
    "weaponshaft_fishing_spear.png",
    "weaponshaft_harlyao_broadsword.png",
    "weaponshaft_harlyao_longsword.png",
    "weaponshaft_hatchet.png",
    "weaponshaft_hoe.png",
    "weaponshaft_kylie.png",
    "weaponshaft_pick-shovel.png",
    "weaponshaft_plains_sword.png",
    "weaponshaft_war-cleaver.png",
    "weaponshaft_warhammer.png"
]; // Bundled main-branch exports; refresh can discover later uploads.
  const uploadedBase = 'assets/toolsprites/modular_pieces/'; // Canonical Foundry part folder.
  const rawMainBase = 'https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/main/docs/'; // Latest artwork on main, also usable from pinned previews.
  let pixels = null; // Current editable RGBA frame, exported without the selection outline.
  let original = null; // Unmodified loaded frame used by Reset.
  let history = []; // RGBA snapshots used by Undo.
  let path = []; // Lasso vertices in original 450 x 1204 coordinates.
  let activePointer = null; // The one touch/mouse pointer currently drawing a lasso.
  let source = null; // Path/filename shown by mobile diagnostics.
  let sourceSize = null; // Native dimensions, to warn when game-frame normalization is needed.
  let renderPending = false; // RequestAnimationFrame coalesces move events while dragging.
  let loadSerial = 0; // Discard results of earlier asynchronous sprite loads.
  let brushMask = new Uint8Array(FRAME.width * FRAME.height); // Bridge brush paint, one byte per pixel; never exported directly.
  let brushPainted = false; // Skip mask compositing when nothing is painted.
  let lastBrushPoint = null; // Previous stroke point, so fast drags stay continuous.
  let hoverPoint = null; // Brush-size cursor preview position.
  let viewBuffer = null; // Reused RGBA buffer for showing the brush mask over the sprite.
  const tool = () => byId('cut-tool').value; // 'lasso', 'brush', or 'erase'.
  const brushRadius = () => Number(byId('cut-brush-radius').value) || 1;

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
  function minAlpha() {
    const input = byId('cut-min-alpha'); // One threshold shared by outline generation, cleanup and export.
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 0 || value > 255 || input.value.trim() === '')
      throw new Error('Enter a whole-number minimum alpha between 0 and 255.');
    return value;
  }
  function diagnostics() {
    byId('cut-debug').textContent = JSON.stringify({
      source, sourceSize, workingFrame: FRAME, selectedPoints: path.length,
      remainingOpaquePixels: opaqueCount(pixels), undoDepth: history.length,
      outlineThickness: Number(byId('cut-outline-thickness').value), // Last requested black-border radius.
      alphaThreshold: Number(byId('cut-min-alpha').value), // Same cutoff for outline and exported PNG.
      uploadedPart: byId('cut-uploaded').value, uploadedPartCount: byId('cut-uploaded').querySelectorAll('option').length, // Mobile diagnostics for current repo-asset browsing.
      output: byId('cut-output').textContent
    }, null, 2);
  }
  function renderNow() {
    renderPending = false;
    ctx.clearRect(0, 0, FRAME.width, FRAME.height);
    if (pixels && brushPainted) {
      if (!viewBuffer) viewBuffer = new Uint8ClampedArray(pixels.length);
      viewBuffer.set(pixels);
      for (let p = 0; p < brushMask.length; p++) if (brushMask[p]) {
        const o = p * 4; viewBuffer[o] = viewBuffer[o + 1] = viewBuffer[o + 2] = 0; viewBuffer[o + 3] = 255;
      }
      ctx.putImageData(new ImageData(viewBuffer, FRAME.width, FRAME.height), 0, 0);
    } else if (pixels) ctx.putImageData(new ImageData(pixels, FRAME.width, FRAME.height), 0, 0);
    if (hoverPoint && tool() !== 'lasso') {
      ctx.save();
      ctx.strokeStyle = tool() === 'erase' ? '#ff7a7a' : '#ffce64'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hoverPoint.x, hoverPoint.y, brushRadius(), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
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
    history = []; path = []; activePointer = null; clearBrush();
    const inputName = String(suggestedName || ''); // Keep head/shaft export type when reloading an existing part PNG.
    if (/^weaponhead[_-]/i.test(inputName)) byId('cut-kind').value = 'head';
    if (/^weaponshaft[_-]/i.test(inputName)) byId('cut-kind').value = 'shaft';
    byId('cut-name').value = stem(inputName);
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
  function clearBrush() { brushMask.fill(0); brushPainted = false; lastBrushPoint = null; }
  function paint(event) {
    const point = pointFor(event); // Bridge brush stamps discs in source-pixel space.
    global.ModularWeaponBridgeFill.stampLine(brushMask, FRAME.width, FRAME.height, lastBrushPoint, point,
      brushRadius(), tool() === 'erase' ? 0 : 1);
    lastBrushPoint = point; hoverPoint = point;
    brushPainted = tool() === 'erase' ? brushMask.includes(1) : true;
    scheduleRender();
  }
  canvas.addEventListener('pointerdown', event => {
    if (!pixels || activePointer !== null) return;
    event.preventDefault();
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    if (tool() !== 'lasso') { lastBrushPoint = null; paint(event); return; }
    path = [];
    extend(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (tool() !== 'lasso' && pixels) { hoverPoint = pointFor(event); if (activePointer === null) scheduleRender(); }
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    if (tool() !== 'lasso') paint(event); else extend(event);
  });
  canvas.addEventListener('pointerleave', () => { if (hoverPoint) { hoverPoint = null; scheduleRender(); } });
  function finish(event, cancel) {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    if (tool() !== 'lasso') {
      activePointer = null; lastBrushPoint = null; renderNow();
      status('Brush stroke painted. Hollow & fill bridge turns it into metal; Clear brush discards it.');
      return;
    }
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
  byId('cut-cull-alpha').onclick = () => {
    if (!pixels || activePointer !== null) { status('Load a sprite and finish drawing before culling.'); return; }
    try {
      const result = global.ModularWeaponOutline.cullLowAlphaPixels(pixels, minAlpha()); // Same sanitizer as outline and export.
      if (!result.removed && result.pixels.every((byte, i) => byte === pixels[i])) {
        status('No pixels below alpha ' + result.threshold + ' need culling.'); return;
      }
      pushUndo(); pixels = result.pixels; path = []; renderNow();
      status('Culled ' + result.removed + ' faint pixels. Deleted pixels are RGBA (0,0,0,0); Undo remains available.');
    } catch (error) { status('Cull failed: ' + error.message); }
  };
  byId('cut-outline').onclick = () => {
    if (!pixels || activePointer !== null) { status('Load a sprite and finish any active lasso first.'); return; }
    try {
      const thickness = Number(byId('cut-outline-thickness').value); // Black border radius in authored source pixels.
      const outcome = global.ModularWeaponOutline.outlinePixels(pixels, FRAME.width, FRAME.height, thickness, minAlpha()); // Expand into transparent areas only.
      if (!outcome.added && !outcome.edgeDarkened && !outcome.culled) { status('No transparent edges or faint pixels need cleanup.'); return; }
      pushUndo(); pixels = outcome.pixels; path = []; renderNow();
      status('Added ' + outcome.added + ' opaque black outline pixels at thickness ' + thickness +
        '; culled ' + outcome.culled + ' faint pixels' +
        (outcome.edgeDarkened ? '; blackened ' + outcome.edgeDarkened + ' colored pixels on the export-frame edge.' : '.') +
        ' Undo restores the previous image.');
    } catch (error) { status('Outline failed: ' + error.message); }
  };
  function lightDirection() {
    const value = byId('cut-bridge-light').value; // "x,y" toward the light in screen space, or "none".
    return value === 'none' ? null : value.split(',').map(Number);
  }
  byId('cut-bridge-fill').onclick = () => {
    if (!pixels || activePointer !== null) { status('Load a sprite and finish the brush stroke first.'); return; }
    try {
      const thickness = Number(byId('cut-bridge-outline').value); // Black rim width where the bridge meets empty space.
      if (!Number.isInteger(thickness) || thickness < 0 || thickness > 32) throw new Error('Bridge outline thickness must be 0–32.');
      const outcome = global.ModularWeaponBridgeFill.fillBridge(pixels, brushMask, FRAME.width, FRAME.height,
        { outlineThickness: thickness, minAlpha: minAlpha(), seed: Date.now(), lightDirection: lightDirection(),
          highlightWidth: Number(byId('cut-bridge-highlight').value) || 0 });
      pushUndo(); pixels = outcome.pixels; clearBrush(); path = []; renderNow();
      status('Bridge filled: ' + outcome.grown + ' pixels grown from ' + outcome.seeds + ' bordering metal seeds (' +
        outcome.shaded + ' shaded, ' + outcome.unshaded + ' unshaded, ' + outcome.highlighted + ' edge-highlighted), ' + outcome.rim + ' black rim pixels; kept ' + outcome.preserved + ' painted-over metal pixels' +
        (outcome.pools > 1 ? '; linked ' + outcome.poolsLinked + ' of ' + (outcome.pools - 1) + ' unshaded-pool gaps' : '') +
        '. Undo restores the previous image.');
    } catch (error) { status('Bridge fill failed: ' + error.message); }
  };
  byId('cut-bridge-clear').onclick = () => { clearBrush(); renderNow(); status('Brush cleared.'); };
  byId('cut-brush-radius').oninput = () => {
    byId('cut-brush-radius-value').textContent = byId('cut-brush-radius').value; scheduleRender();
  };
  byId('cut-tool').onchange = () => { hoverPoint = null; scheduleRender(); };
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
  const uploadedPicker = byId('cut-uploaded'); // Existing full-parts browser separate from full-weapon source selector.
  function fillUploadedParts(files) {
    const last = uploadedPicker.value; // Retain selection after a successful online refresh.
    uploadedPicker.replaceChildren();
    for (const [prefix, label] of [['weaponhead_', 'Heads'], ['weaponshaft_', 'Shafts']]) {
      const group = document.createElement('optgroup'); // Group assets by the intended modular part type.
      group.label = label;
      for (const name of files.filter(name => name.startsWith(prefix)).sort()) {
        const option = document.createElement('option'); // Filename is the exact GitHub path, not an inferred catalog ID.
        option.value = name;
        option.textContent = name.replace(/^weapon(?:head|shaft)_/, '').replace(/\.png$/i, '');
        group.appendChild(option);
      }
      uploadedPicker.appendChild(group);
    }
    const stillAvailable = Array.from(uploadedPicker.querySelectorAll('option')).some(option => option.value === last); // Avoid selecting a deleted asset.
    if (stillAvailable) uploadedPicker.value = last;
    uploadedPicker.disabled = uploadedPicker.querySelectorAll('option').length === 0;
    byId('cut-load-uploaded').disabled = uploadedPicker.disabled;
    diagnostics(); // Keep the mobile diagnostics up to date after manually refreshing uploaded assets.
  }
  fillUploadedParts(uploadedPartFiles);
  byId('cut-load-uploaded').onclick = async () => {
    const name = uploadedPicker.value; // Filename of the currently selected uploaded part.
    if (!/^weapon(?:head|shaft)_[a-z0-9_'. -]+\.png$/i.test(name) || name.includes('..')) {
      status('Select a valid uploaded modular part.'); return;
    }
    const ticket = ++loadSerial; // Protect against out-of-order loads, including local-device imports.
    try {
      const image = new Image(); // Fetch main-branch artwork even if the preview is pinned to an earlier commit.
      image.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Could not load latest main-branch sprite.'));
        image.src = rawMainBase + uploadedBase + encodeURIComponent(name);
      });
      if (ticket !== loadSerial) return;
      await acceptImage(image, 'main/' + uploadedBase + name, name.replace(/\.png$/i, ''));
    } catch (error) {
      if (ticket !== loadSerial) return;
      try {
        const image = await global.ModularWeapons.loadImage(uploadedBase + name, '../../'); // Local snapshot fallback for offline/CDN failures.
        if (ticket === loadSerial) await acceptImage(image, uploadedBase + name, name.replace(/\.png$/i, ''));
      } catch (fallbackError) {
        if (ticket === loadSerial) status('Uploaded part unavailable: ' + error.message + ' ' + fallbackError.message);
      }
    }
  };
  byId('cut-refresh-uploaded').onclick = async () => {
    const button = byId('cut-refresh-uploaded'); // Prevent repeated GitHub API requests on mobile.
    button.disabled = true;
    try {
      const response = await fetch('https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/contents/docs/assets/toolsprites/modular_pieces?ref=main', { cache: 'no-store' }); // Public listing; no authentication or user credentials.
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const entries = await response.json(); // GitHub directory listing of current uploaded PNGs.
      if (!Array.isArray(entries)) throw new Error('GitHub did not return a file list.');
      const files = entries.filter(entry => entry.type === 'file' && /^weapon(?:head|shaft)_[a-z0-9_'. -]+\.png$/i.test(entry.name)).map(entry => entry.name);
      fillUploadedParts(files);
      status('Refreshed from main: ' + files.length + ' uploaded modular sprites available.');
    } catch (error) {
      status('Could not refresh main uploads (' + error.message + '). The bundled list still works.');
    } finally { button.disabled = false; }
  };
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
      const cutoff = minAlpha(); // Export always enforces the same threshold even when manual cleanup was skipped.
      const cleaned = global.ModularWeaponOutline.cullLowAlphaPixels(pixels, cutoff); // Strip faint alpha and hidden RGB from downloaded PNG.
      if (!cleaned.remaining) throw new Error('No pixels remain above the selected alpha threshold.');
      const name = fileName(byId('cut-kind').value, byId('cut-name').value); // Existing modular-pieces filename convention.
      const png = document.createElement('canvas'); // Export from data, never the drawn lasso overlay.
      png.width = FRAME.width; png.height = FRAME.height;
      png.getContext('2d').putImageData(new ImageData(cleaned.pixels, FRAME.width, FRAME.height), 0, 0);
      png.toBlob(blob => {
        if (!blob) { status('PNG encoding failed.'); return; }
        const url = URL.createObjectURL(blob); // Download is supported on mobile as in the original editor.
        const anchor = document.createElement('a'); // No popup window or external image editor required.
        anchor.href = url; anchor.download = name; document.body.appendChild(anchor);
        anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
        status('Exported ' + name + ' after culling ' + cleaned.removed + ' pixels below alpha ' + cutoff + '. Add it to docs/assets/toolsprites/modular_pieces/ and register its attachment data in docs/config/modular-weapons.js.');
      }, 'image/png');
    } catch (error) { status('Export failed: ' + error.message); }
  };
  updateOutputName();
  status('Choose an existing weapon, enter an asset path, or import a PNG to begin.');
  diagnostics();
})(window);

(function () {
  'use strict';
  const api = window.ModularWeapons; // Runtime compositor, line transform and import validator.
  window.ModularWeaponsKeepReference = true; // compose() keeps the pre-smudge image so the revert brush can preview live.
  const SMUDGE_TOOLS = ['smudge', 'revert', 'plow', 'puff', 'clean']; // Brushes that rework metal and rebuild the outline.
  const cleanSettings = prefix => ({ smoothing: Number(document.getElementById(prefix + '-clean-smoothing').value),
    speck: Number(document.getElementById(prefix + '-clean-speck').value) });
  const toolStrength = prefix => Number(document.getElementById(prefix + '-tool-strength').value) / 100;
  const byId = id => document.getElementById(id); // Shared authoring UI lookup.
  let data = JSON.parse(JSON.stringify(api.getConfig())); // Editable copy of validated config.
  let mountIndex = 0; // Active mounting line for edits on the selected haft.
  let serial = 0; // Discard outdated async image/assembly requests.
  let drawing = null; // Active touch/mouse drag, one sprite line at a time.
  let gizmoMode = 'draw'; // Draw replaces a line; move and rotate edit its two endpoints as a whole.
  const gizmos = window.ModularMountGizmos; // Reusable line manipulation geometry, shared with regression tests.
  const cachedImages = {}; // Source images reused while dragging the arrow interactively.
  const chosenShaft = () => data.shafts[byId('shaft').value]; // Active donor haft.
  const chosenHead = () => data.heads[byId('head').value]; // Active blade/weight part.
  const msg = text => { byId('status').textContent = text; }; // Readable status without devtools.
  let bridgeView = null; // Last composed preview bitmap and its logical frame, for painting bridge strokes over it.
  let pendingStrokes = []; // Bridge stroke being drawn (applied on release), in composed-frame source-pixel coordinates.
  let pendingKey = ''; // Pair the pending strokes belong to.
  let bridgePaint = null; // Active bridge brush drag.
  let recipeDraft = null; // Box drawn on the preview for saving a recipe: {x0, y0, x1, y1} in composed-frame source pixels.
  let recipeSel = -1; // Index (in this pair's steps) of the selected placed recipe box, or -1.
  let recipeDrag = null; // Active box drag: { pointer, target: 'draft'|'op', mode: 'new'|'move'|'resize', handle, start, orig }.
  let bridgeHover = null; // Brush-size cursor over the preview.
  let plowAngle = 0; // Drag direction, which the plow blade cursor faces across.
  const neutral = { scaleX: 1, scaleY: 1, flipX: false, flipY: false, x: 0, y: 0, rotation: 0, animation: 'sweep' }; // No global transform fields.
  function options(id, entries) {
    for (const [key, record] of Object.entries(entries)) {
      const option = document.createElement('option'); // Stable catalog key is kept on import/export.
      option.value = key; option.textContent = record.label; byId(id).appendChild(option);
    }
  }
  // Undo/redo: every committed draft state (lines, corrections, layering, bridges, imports, resets) is a step.
  const undoStack = [], redoStack = [], MAX_HISTORY = 100;
  let savedState = JSON.stringify(data); // Draft as last committed, the state Undo returns from.
  function record() {
    const next = JSON.stringify(data);
    if (next === savedState) return;
    undoStack.push(savedState); if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0; savedState = next; historyButtons();
  }
  function historyButtons() {
    byId('pair-undo').disabled = !undoStack.length; byId('pair-redo').disabled = !redoStack.length;
  }
  function restore(state) {
    data = JSON.parse(JSON.stringify(api.replace(JSON.parse(state), true)));
    savedState = JSON.stringify(data); pendingStrokes = [];
    render(); syncBridgeControls(); historyButtons();
  }
  function save() {
    try {
      data = JSON.parse(JSON.stringify(api.replace(data, true))); // Persist validated line and pair data to browser draft.
      record();
      msg('Draft saved. Matching tang/eye arrows drive head rotation and size.');
      render();
    } catch (error) { msg('Save failed: ' + error.message); }
  }
  function compatible() {
    return api.matchingMounts(chosenShaft(), chosenHead()).length > 0; // Automatic, rather than hand-authored, compatibility rule.
  }
  function lineMarker(ctx, mount, selected) {
    const start = mount.start, end = mount.end; // Base of line and directed arrow tip in original sprite coordinates.
    const color = mount.type === 'tang' || mount.type === 'blade' ? '#ffcc63' : '#75e9ed'; // Gold for tang; aqua for eye.
    ctx.save(); ctx.strokeStyle = selected ? '#ffffff' : color; ctx.fillStyle = color;
    ctx.lineWidth = selected ? 7 : 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    const a = Math.atan2(end.y - start.y, end.x - start.x); // Head angle determines the arrowhead orientation.
    const size = 18; // Distinct arrow tip large enough to see on mobile.
    ctx.beginPath(); ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - Math.cos(a - 0.5) * size, end.y - Math.sin(a - 0.5) * size);
    ctx.lineTo(end.x - Math.cos(a + 0.5) * size, end.y - Math.sin(a + 0.5) * size);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(start.x, start.y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawGizmo(ctx, line) {
    if (gizmoMode === 'draw') return;
    const center = gizmos.midpoint(line); // Move handle and rotation pivot at the exact line midpoint.
    const handle = gizmoMode === 'rotate' ? gizmos.rotationHandle(line) : center; // Dedicated draggable handle for current mode.
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#142431'; ctx.lineWidth = 4;
    if (gizmoMode === 'rotate') {
      ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(center.x, center.y);
      ctx.lineTo(handle.x, handle.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(center.x, center.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(handle.x, handle.y, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); // Large explicit grab point for touch.
    ctx.beginPath();
    if (gizmoMode === 'move') {
      ctx.moveTo(handle.x - 15, handle.y); ctx.lineTo(handle.x + 15, handle.y);
      ctx.moveTo(handle.x, handle.y - 15); ctx.lineTo(handle.x, handle.y + 15);
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        ctx.moveTo(handle.x + Math.cos(angle) * 17, handle.y + Math.sin(angle) * 17);
        ctx.lineTo(handle.x + Math.cos(angle - 0.4) * 11, handle.y + Math.sin(angle - 0.4) * 11);
        ctx.moveTo(handle.x + Math.cos(angle) * 17, handle.y + Math.sin(angle) * 17);
        ctx.lineTo(handle.x + Math.cos(angle + 0.4) * 11, handle.y + Math.sin(angle + 0.4) * 11);
      }
    } else {
      ctx.arc(handle.x, handle.y, 11, -Math.PI * 0.85, Math.PI * 0.4);
      ctx.lineTo(handle.x + 12, handle.y + 2);
    }
    ctx.stroke(); ctx.restore();
  }
  function drawLines(id) {
    const image = cachedImages[id], canvas = byId(id); // Redraw the source image before overlaying edited lines.
    if (!image) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mounts = id === 'head-canvas' ? [chosenHead().mount] : chosenShaft().mounts;
    mounts.forEach((mount, i) => lineMarker(ctx, mount, id === 'head-canvas' || i === mountIndex));
    drawGizmo(ctx, id === 'head-canvas' ? chosenHead().mount : chosenShaft().mounts[mountIndex]); // Only selected line gets handles.
  }
  async function preview() {
    const ticket = ++serial, shaftKey = byId('shaft').value, headKey = byId('head').value; // Preview identity.
    const shaft = chosenShaft(), head = chosenHead();
    try {
      const [shaftImage, headImage] = await Promise.all([
        api.loadImage(shaft.sprite, '../../'), api.loadImage(head.sprite, '../../')
      ]); // Image requests are cached in runtime.
      if (ticket !== serial) return;
      cachedImages['shaft-canvas'] = shaftImage; cachedImages['head-canvas'] = headImage;
      drawLines('shaft-canvas'); drawLines('head-canvas');
      const match = api.matchingMounts(shaft, head), values = api.settings(shaftKey, headKey); // Auto-match and pair-local corrections.
      const canvas = byId('preview'), ctx = canvas.getContext('2d');
      if (match.length) {
        const composed = await api.compose(shaftKey, headKey, '../../'); // Same bitmap the real game uses.
        if (ticket !== serial) return;
        canvas.width = composed.width; canvas.height = composed.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(composed, 0, 0);
        bridgeView = { composed, frame: composed.modularFrame };
        drawBridgeOverlay();
        const matrices = match.map(mount => api.headTransform(mount, values, head.mount)); // Debug exact affine transforms used in gameplay.
        byId('debug').textContent = JSON.stringify({
          shaft: shaftKey, head: headKey, kind: head.mount.type, mounts: shaft.mounts,
          headArrow: head.mount, matchedMounts: match.length, corrections: values,
          matrices, frame: composed.modularFrame, bitmap: { width: composed.width, height: composed.height },
          disallowed: api.isDisallowed(shaftKey, headKey), gizmoMode, revision: api.diagnostics('').revision
        }, null, 2);
      } else {
        bridgeView = null;
        canvas.width = 450; canvas.height = 1204; // Incompatible pairs render the donor only.
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(shaftImage, 0, 0, 450, 1204);
        byId('debug').textContent = JSON.stringify({
          shaft: shaftKey, head: headKey, incompatibility: 'No ' + (head.mount.type === 'blade' ? 'tang' : 'eye') + ' mount on selected haft.',
          headArrow: head.mount, haftMounts: shaft.mounts
        }, null, 2);
      }
    } catch (error) { if (ticket === serial) msg('Preview failed: ' + error.message); }
  }
  function editLineNumbers() {
    const area = byId('attach-controls'); // Precise fallback when drag placement is difficult on a phone.
    area.replaceChildren();
    for (const [label, line] of [['Head', chosenHead().mount], ['Haft', chosenShaft().mounts[mountIndex]]]) {
      const group = document.createElement('div'), title = document.createElement('span'); // One length per selected arrow.
      group.className = 'line-length-field'; title.className = 'line-length-label';
      title.textContent = label + ' arrow length'; group.appendChild(title);
      const lengthInput = document.createElement('input'); // Native ↑ / ↓ spinner also works with keyboard and mobile.
      lengthInput.type = 'number'; lengthInput.min = '2'; lengthInput.step = '1';
      lengthInput.max = String(Math.floor(gizmos.maxLength(line)));
      lengthInput.value = String(Math.round(gizmos.length(line) * 100) / 100);
      lengthInput.setAttribute('aria-label', label + ' arrow origin-to-tip length (pixels)');
      function changeLength(value) {
        if (!Number.isFinite(value) || value < 2) {
          msg('Arrow length must be at least two pixels.'); return;
        }
        const next = gizmos.setLength(line, value); // Changes only the arrow tip; origin and bearing are fixed.
        if (Math.abs(gizmos.length(next) - gizmos.length(line)) < 1e-6) {
          lengthInput.value = String(Math.round(gizmos.length(line) * 100) / 100);
          if (value > gizmos.maxLength(line)) msg('Arrow tip cannot extend beyond the sprite border.');
          return;
        }
        Object.assign(line, next); save(); // Immediately updates preview and persisted draft through shared validation.
      }
      lengthInput.onchange = () => {
        if (lengthInput.value.trim() === '') { render(); return; }
        changeLength(Number(lengthInput.value));
      };
      const shorten = document.createElement('button'), extend = document.createElement('button');
      shorten.type = extend.type = 'button'; shorten.textContent = '−'; extend.textContent = '+';
      shorten.setAttribute('aria-label', 'Shorten ' + label.toLowerCase() + ' arrow by one pixel');
      extend.setAttribute('aria-label', 'Lengthen ' + label.toLowerCase() + ' arrow by one pixel');
      shorten.onclick = () => changeLength(gizmos.length(line) - 1);
      extend.onclick = () => changeLength(gizmos.length(line) + 1);
      group.append(shorten, lengthInput, extend);
      area.appendChild(group);
      for (const endpoint of ['start', 'end']) for (const axis of ['x', 'y']) {
        const wrapper = document.createElement('label'), input = document.createElement('input'); // Endpoint coordinate in the 450x1204 source frame.
        wrapper.textContent = label + ' ' + endpoint + ' ' + axis;
        input.type = 'number'; input.min = '0'; input.max = axis === 'x' ? '450' : '1204'; input.step = '1';
        input.value = String(line[endpoint][axis]);
        input.onchange = () => {
          const value = Number(input.value);
          if (!Number.isFinite(value)) { render(); return; }
          line[endpoint][axis] = Math.max(0, Math.min(axis === 'x' ? 450 : 1204, value));
          save();
        };
        wrapper.appendChild(input); area.appendChild(wrapper);
      }
    }
  }
  function render() {
    const shaft = chosenShaft(), head = chosenHead(), headKey = byId('head').value; // Active authoring context.
    const pairKey = byId('shaft').value + '|' + headKey;
    if (pairKey !== pendingKey) { pendingStrokes = []; pendingKey = pairKey; syncBridgeControls(); }
    mountIndex = Math.min(mountIndex, shaft.mounts.length - 1);
    byId('socket').replaceChildren();
    shaft.mounts.forEach((mount, index) => {
      const option = document.createElement('option'); // Multiple directed attachment lines on one shaft.
      option.value = index; option.textContent = (index + 1) + ': ' + (mount.type === 'eye' ? 'Eye/sleeve' : 'Tang');
      byId('socket').appendChild(option);
    });
    byId('socket').value = String(mountIndex);
    byId('remove').disabled = shaft.mounts.length <= 1;
    byId('add').disabled = shaft.mounts.length >= (shaft.maxAttachments || 8);
    byId('mount-kind').value = shaft.mounts[mountIndex].type;
    byId('head-kind').value = head.mount.type;
    byId('disallow').checked = shaft.overrides[headKey]?.disallow === true;
    byId('allow-shaft').checked = shaft.editorOnly !== true;
    byId('allow-shaft').disabled = shaft.sourceShape === 'bgungku'; // This special uploaded shaft has no gameplay donor definition.
    byId('allow-head').checked = head.editorOnly !== true && head.craftDisabled !== true;
    byId('allow-head').disabled = head.craftDisabled === true; // Shipped retired heads cannot be re-enabled through this editor.
    byId('head-construction-note').textContent = head.mountNote || ''; // Authoring notes for shovel scoop, transverse hoe, and pick head.
    const accepted = compatible(), needed = head.mount.type === 'blade' ? 'tang' : 'eye';
    byId('part-readiness').textContent = !accepted
      ? 'Incompatible: add a ' + needed + ' line to this haft or choose another head.'
      : shaft.sourceShape === 'bgungku' ? "B'gungku has no gameplay donor; preview/editor use only."
      : head.craftDisabled ? 'This head is retired from Foundry crafting; existing forged weapons remain usable.'
      : shaft.editorOnly || head.editorOnly ? 'One or both parts still need calibration and Foundry approval.'
      : 'Compatible directed mounts; both parts are enabled for Foundry.';
    editLineNumbers();
    byId('fields').replaceChildren();
    const pair = shaft.overrides[headKey] ||= {}; // Pair-only corrections; no shaft-global defaults.
    byId('layer-order').value = pair.layerOrder === 'head-over-haft' ? 'head-over-haft' : 'haft-over-head'; // Default: haft in the foreground.
    const values = { ...neutral, ...pair }; // Neutral values are not stored unless changed.
    for (const key of [...api.transforms, 'animation']) {
      const row = document.createElement('tr'), title = document.createElement('td'), cell = document.createElement('td'); // Per-pair correction fields.
      const input = document.createElement(key === 'animation' ? 'select' : 'input');
      const bool = key.startsWith('flip');
      title.textContent = key === 'animation' ? 'Attack animation' : key;
      input.setAttribute('aria-label', 'Pair ' + key);
      if (key === 'animation') {
        for (const value of ['sweep', 'thrust']) {
          const option = document.createElement('option'); // Same choices as existing Foundry.
          option.value = value; option.textContent = value === 'sweep' ? 'Sweep' : 'Thrust'; input.appendChild(option);
        }
        input.value = values[key];
      } else {
        input.type = bool ? 'checkbox' : 'number';
        input.step = key.startsWith('scale') ? '0.01' : '1';
        if (bool) input.checked = Boolean(values[key]); else input.value = String(values[key]);
      }
      input.onchange = () => {
        const value = bool ? input.checked : key === 'animation' ? input.value : Number(input.value);
        if (value === neutral[key]) delete pair[key]; else pair[key] = value; // Store only exceptions for this exact combination.
        save();
      };
      cell.appendChild(input); row.append(title, cell); byId('fields').appendChild(row);
    }
    syncRecipeControls();
    preview();
  }
  function pointFor(canvas, event) {
    const box = contentRect(canvas); // Pointer coordinates mapped into original source frame, past any letterboxing.
    return { x: Math.max(0, Math.min(450, Math.round((event.clientX - box.left) / box.scale))),
      y: Math.max(0, Math.min(1204, Math.round((event.clientY - box.top) / box.scale))) };
  }
  function nearHandle(canvas, event, point, radiusPx = 32) {
    const box = contentRect(canvas); // Gizmo hit target remains a comfortable CSS-pixel radius on phones.
    const x = box.left + point.x * box.scale, y = box.top + point.y * box.scale;
    return Math.hypot(event.clientX - x, event.clientY - y) <= radiusPx;
  }
  function setGizmoMode(next) {
    gizmoMode = next; // Changing modes never changes line geometry or the saved draft.
    for (const name of ['draw', 'move', 'rotate']) {
      const button = byId('gizmo-' + name); // Accessible toggle state and active CSS.
      button.setAttribute('aria-pressed', String(name === gizmoMode));
      button.classList.toggle('active', name === gizmoMode);
    }
    drawLines('shaft-canvas'); drawLines('head-canvas');
    msg(gizmoMode === 'draw' ? 'Draw: drag a new arrow from base to tip.'
      : gizmoMode === 'move' ? 'Move: drag the crosshair to move both arrow endpoints together.'
      : 'Rotate: drag the circular handle to turn the entire arrow around its midpoint.');
  }
  function gesture(id) {
    const element = byId(id); // Source sprites accept one active line/handle drag.
    function update(event) {
      if (!drawing || drawing.id !== id || drawing.pointer !== event.pointerId) return;
      const current = pointFor(element, event); // Use source-image coordinates regardless of responsive canvas size.
      if (drawing.mode === 'draw') {
        drawing.line.end = current; // Draw mode is the original base-to-tip gesture.
      } else if (drawing.mode === 'move') {
        const dx = current.x - drawing.pointerStart.x, dy = current.y - drawing.pointerStart.y;
        Object.assign(drawing.line, gizmos.move(drawing.original, dx, dy)); // No rescale or change of angle.
      } else {
        const angle = gizmos.rotationDelta(drawing.original, drawing.pointerStart, current);
        Object.assign(drawing.line, gizmos.rotate(drawing.original, angle)); // Rotation keeps its length exactly.
      }
      drawLines(id);
    }
    element.addEventListener('pointerdown', event => {
      if (drawing || !event.isPrimary) return;
      event.preventDefault();
      const line = id === 'head-canvas' ? chosenHead().mount : chosenShaft().mounts[mountIndex];
      const point = pointFor(element, event); // Always work on the currently selected line.
      const handle = gizmoMode === 'rotate' ? gizmos.rotationHandle(line) : gizmos.midpoint(line);
      if (gizmoMode !== 'draw' && !nearHandle(element, event, handle)) {
        msg(gizmoMode === 'move' ? 'Drag the crosshair handle to move the selected line.'
          : 'Drag the circular rotate handle to turn the selected line.');
        return;
      }
      drawing = { id, pointer: event.pointerId, line, mode: gizmoMode,
        pointerStart: point, original: JSON.parse(JSON.stringify(line)) }; // Restorable state for cancellations.
      if (gizmoMode === 'draw') { line.start = point; line.end = { ...point }; }
      element.setPointerCapture(event.pointerId); drawLines(id);
    });
    element.addEventListener('pointermove', event => {
      if (!drawing || drawing.id !== id || drawing.pointer !== event.pointerId) return;
      event.preventDefault(); update(event); // Live arrows and handles update without expensive image recomposition.
    });
    element.addEventListener('pointerup', event => {
      if (!drawing || drawing.id !== id || drawing.pointer !== event.pointerId) return;
      event.preventDefault(); update(event); // Apply final delta even if no pointermove preceded release.
      const last = drawing;
      const length = Math.hypot(last.line.end.x - last.line.start.x, last.line.end.y - last.line.start.y);
      const changed = JSON.stringify(last.line) !== JSON.stringify(last.original); // Skip creating browser drafts for zero movement.
      if (length < 2 || !changed) {
        Object.assign(last.line, last.original);
        if (length < 2) msg('Line must remain at least two pixels long.');
      }
      drawing = null;
      if (length >= 2 && changed) save(); else drawLines(id);
    });
    function cancel(event) {
      if (!drawing || drawing.id !== id || drawing.pointer !== event.pointerId) return;
      Object.assign(drawing.line, drawing.original); drawing = null; drawLines(id); // Never commit aborted multi-touch gestures.
    }
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('lostpointercapture', cancel);
  }
  options('shaft', data.shafts); options('head', data.heads);
  byId('random').onclick = () => {
    const pairs = []; // Draw only from compatible, allowed pairs, not every cartesian combination.
    for (const shaft of Object.keys(data.shafts)) for (const head of Object.keys(data.heads)) {
      if (!api.isDisallowed(shaft, head) && (shaft !== byId('shaft').value || head !== byId('head').value)) pairs.push({ shaft, head });
    }
    if (!pairs.length) { msg('No other compatible combinations. Add another tang or eye mount.'); return; }
    const selected = pairs[Math.floor(Math.random() * pairs.length)];
    byId('shaft').value = selected.shaft; byId('head').value = selected.head; mountIndex = 0;
    render(); msg('Compatible combination: ' + data.shafts[selected.shaft].label + ' / ' + data.heads[selected.head].label);
  };
  byId('shaft').onchange = () => { mountIndex = 0; render(); };
  byId('head').onchange = render;
  byId('socket').onchange = () => { mountIndex = Number(byId('socket').value); render(); };
  byId('head-kind').onchange = () => { chosenHead().mount.type = byId('head-kind').value; save(); };
  byId('mount-kind').onchange = () => { chosenShaft().mounts[mountIndex].type = byId('mount-kind').value; save(); };
  byId('add').onclick = () => {
    const shaft = chosenShaft();
    if (shaft.mounts.length >= (shaft.maxAttachments || 8)) return;
    const kind = byId('mount-kind').value; // Users may add a tang, eye, or both on a haft.
    const last = shaft.mounts[mountIndex]; // New line begins near the currently selected attachment.
    const origin = { ...last.start }; // Copy center for predictable placement; edit direction next.
    shaft.mounts.push({ type: kind, start: origin, end: { x: origin.x, y: Math.max(0, origin.y - 80) } });
    mountIndex = shaft.mounts.length - 1; save();
  };
  byId('remove').onclick = () => {
    if (chosenShaft().mounts.length <= 1) return;
    chosenShaft().mounts.splice(mountIndex, 1); mountIndex = 0; save();
  };
  byId('disallow').onchange = () => {
    const pair = chosenShaft().overrides[byId('head').value] ||= {}; // Explicit exclusion for this pair, beyond type gating.
    pair.disallow = byId('disallow').checked; save();
  };
  byId('allow-shaft').onchange = () => {
    if (chosenShaft().sourceShape === 'bgungku') return; // Unknown donor would copy incorrect player hand positions.
    chosenShaft().editorOnly = !byId('allow-shaft').checked; save();
  };
  byId('allow-head').onchange = () => { if (chosenHead().craftDisabled) return; chosenHead().editorOnly = !byId('allow-head').checked; save(); };
  byId('layer-order').onchange = () => {
    const pair = chosenShaft().overrides[byId('head').value] ||= {}; // Only this exact combination gets an override.
    pair.layerOrder = byId('layer-order').value === 'head-over-haft' ? 'head-over-haft' : 'haft-over-head'; // Store both explicit options so imported authored presets never override intentional editor changes.
    save(); // Validates, clears compositor cache, and refreshes assembled editor preview.
  };
  byId('reset-pair').onclick = () => {
    const old = chosenShaft().overrides[byId('head').value] || {}; // Reset local transforms while keeping authored pair exclusion.
    chosenShaft().overrides[byId('head').value] = typeof old.disallow === 'boolean' ? { disallow: old.disallow } : {};
    save();
  };
  gesture('shaft-canvas'); gesture('head-canvas');
  for (const mode of ['draw', 'move', 'rotate']) byId('gizmo-' + mode).onclick = () => setGizmoMode(mode); // Tool mode buttons.
  setGizmoMode('draw');
  byId('export').onclick = () => {
    const blob = new Blob(['// Foundry directed mount lines and per-combination corrections.\nwindow.MODULAR_WEAPON_CONFIG = ' + JSON.stringify(data, null, 2) + ';\n'], { type: 'text/javascript' }); // Drop-in source, no eval on imports.
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); // Existing mobile browser download behavior.
    anchor.href = url; anchor.download = 'modular-weapons.js'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  byId('import').onclick = () => byId('file').click();
  byId('file').onchange = async () => {
    try {
      const file = byId('file').files?.[0]; // Invalid or cancelled imports do not reset the draft.
      if (!file) return;
      const raw = await file.text(); // JSON or JS assignment exported by this tool; never eval.
      const json = raw.trim().startsWith('{') ? raw : raw.slice(raw.indexOf('=') + 1).trim().replace(/;\s*$/, '');
      data = JSON.parse(JSON.stringify(api.replace(JSON.parse(json), true)));
      record(); mountIndex = 0; render(); msg('Imported and validated directed mount config (legacy sockets are migrated).');
    } catch (error) { msg('Import failed: ' + error.message); }
    finally { byId('file').value = ''; }
  };
  byId('reset').onclick = () => {
    data = JSON.parse(JSON.stringify(api.replace(window.MODULAR_WEAPON_CONFIG, true))); // Restores shipped lines and pair corrections.
    record(); mountIndex = 0; render(); msg('Restored committed directed mount data.');
  };
  // Pair bridge brush: strokes painted on the assembled preview are stored on this pair and re-filled by
  // ModularWeapons.compose() (which the game also uses), so the preview shows exactly what gameplay renders.
  const pairOverride = () => chosenShaft().overrides[byId('head').value] ||= {};
  const bridgeRadius = () => Number(byId('pair-bridge-radius').value) || 1;
  const bridgeStatus = text => { byId('pair-bridge-status').textContent = text; };
  function bridgeSettings() {
    const light = byId('pair-bridge-light').value; // "x,y" toward the light, or "none".
    return { outline: Math.max(0, Math.min(32, Math.round(Number(byId('pair-bridge-outline').value) || 0))),
      light: light === 'none' ? null : light.split(',').map(Number),
      shade: Math.max(0, Math.min(100, Number(byId('pair-bridge-shade').value) || 0)) / 100, seed: 1 };
  }
  function syncBridgeControls() {
    const bridges = chosenShaft().overrides[byId('head').value]?.bridges; // Show this pair's saved settings.
    if (!bridges) { bridgeStatus('No bridge on this pair.'); return; }
    byId('pair-bridge-outline').value = String(bridges.outline);
    byId('pair-bridge-light').value = bridges.light ? bridges.light.join(',') : 'none';
    if (!byId('pair-bridge-light').value) byId('pair-bridge-light').value = '0,-1';
    byId('pair-bridge-shade').value = String(Math.round(bridges.shade * 100));
    bridgeStatus(bridges.strokes.length + ' applied bridge stroke(s) on this pair.');
  }
  function contentRect(canvas) {
    const rect = canvas.getBoundingClientRect(); // object-fit: contain may letterbox the bitmap inside the element.
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    return { left: rect.left + (rect.width - canvas.width * scale) / 2, top: rect.top + (rect.height - canvas.height * scale) / 2, scale };
  }
  function logicalPoint(event) {
    const canvas = byId('preview'), box = contentRect(canvas), frame = bridgeView.frame;
    const bx = (event.clientX - box.left) / box.scale, by = (event.clientY - box.top) / box.scale; // Bitmap pixels.
    return [Math.round((frame.left + bx * frame.width / canvas.width) * 2) / 2,
      Math.round((frame.top + by * frame.height / canvas.height) * 2) / 2];
  }
  function drawBridgeOverlay() {
    if (!bridgeView) return;
    const canvas = byId('preview'), ctx = canvas.getContext('2d'), frame = bridgeView.frame;
    const sx = canvas.width / frame.width, sy = canvas.height / frame.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bridgePaint?.smudge) ctx.putImageData(bridgePaint.smudge.image, 0, 0); // Live smudge on a working copy.
    else ctx.drawImage(bridgeView.composed, 0, 0);
    ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = ctx.fillStyle = '#000';
    for (const stroke of pendingStrokes) {
      const pts = stroke.points.map(([x, y]) => [(x - frame.left) * sx, (y - frame.top) * sy]);
      ctx.lineWidth = stroke.r * 2 * sx;
      ctx.beginPath(); ctx.moveTo(...pts[0]);
      for (const pt of pts.slice(1)) ctx.lineTo(...pt);
      if (pts.length === 1) { ctx.arc(pts[0][0], pts[0][1], stroke.r * sx, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
    }
    drawRecipeBoxes(ctx, sx, sy, frame);
    if (bridgeHover && byId('pair-bridge-on').checked && byId('pair-brush-mode').value === 'junction') {
      ctx.setTransform(sx, 0, 0, sy, -frame.left * sx, -frame.top * sy); // Ghost of the piece, in source pixels.
      window.ModularJunctionPicker.ghost(ctx, junctionPicker.placement(bridgeHover[0], bridgeHover[1]));
    } else if (bridgeHover && byId('pair-bridge-on').checked) {
      ctx.strokeStyle = '#ffce64'; ctx.lineWidth = 2;
      const hx = (bridgeHover[0] - frame.left) * sx, hy = (bridgeHover[1] - frame.top) * sy, r = bridgeRadius() * sx;
      if (byId('pair-brush-mode').value === 'plow') { // The blade: 2r long across the drag direction.
        const depth = Math.max(2, Math.round(bridgeRadius() / 4)) * sx;
        ctx.translate(hx, hy); ctx.rotate(plowAngle); ctx.strokeRect(-depth / 2, -r, depth, 2 * r);
      } else { ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.restore();
  }
  const previewCanvas = byId('preview');
  previewCanvas.addEventListener('pointerdown', event => {
    if (!byId('pair-bridge-on').checked || !bridgeView || bridgePaint || !event.isPrimary) return;
    event.preventDefault();
    if (byId('pair-brush-mode').value === 'recipe') { recipePointerDown(event); return; }
    if (byId('pair-brush-mode').value === 'junction') { // Position with a ghost; placed on release.
      bridgePaint = { pointer: event.pointerId, junction: true, stroke: { points: [] } };
      bridgeHover = logicalPoint(event);
    } else if (SMUDGE_TOOLS.includes(byId('pair-brush-mode').value)) {
      // Smudge-family tools work on a copy live; the saved stroke is replayed by compose() on release, through the
      // same stepper, so the result matches what was previewed.
      const mode = byId('pair-brush-mode').value, canvas = bridgeView.composed, frame = bridgeView.frame;
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const stroke = mode === 'smudge' ? { smudge: true, r: bridgeRadius(), points: [logicalPoint(event)] }
        : { tool: mode, r: bridgeRadius(), points: [logicalPoint(event)], strength: toolStrength('pair'), seed: (Math.random() * 2147483647) | 0,
          ...(mode === 'clean' ? cleanSettings('pair') : {}) };
      bridgePaint = { pointer: event.pointerId, stroke, smudge: { image, stepper: window.ModularWeaponBridgeFill.toolStepper(
        image.data, image.width, image.height, stroke, { scale: image.width / frame.width, reference: canvas.modularReference || null }) } };
    } else {
      const stroke = { r: bridgeRadius(), points: [logicalPoint(event)] };
      pendingStrokes.push(stroke); bridgePaint = { pointer: event.pointerId, stroke };
    }
    previewCanvas.setPointerCapture(event.pointerId); drawBridgeOverlay();
  });
  previewCanvas.addEventListener('pointermove', event => {
    if (recipeDrag?.pointer === event.pointerId) { event.preventDefault(); recipePointerMove(event); return; }
    if (!byId('pair-bridge-on').checked || !bridgeView) return;
    const previousHover = bridgeHover;
    bridgeHover = logicalPoint(event);
    if (previousHover && Math.hypot(bridgeHover[0] - previousHover[0], bridgeHover[1] - previousHover[1]) >= 2)
      plowAngle = Math.atan2(bridgeHover[1] - previousHover[1], bridgeHover[0] - previousHover[0]);
    if (bridgePaint?.pointer === event.pointerId && bridgePaint.junction) event.preventDefault();
    else if (bridgePaint?.pointer === event.pointerId) {
      event.preventDefault();
      const points = bridgePaint.stroke.points, last = points[points.length - 1]; // Thin stored points; the fill interpolates.
      const spacing = bridgePaint.stroke.tool === 'plow' ? Math.max(2, bridgePaint.stroke.r / 4) // Steady blade angle.
        : bridgePaint.smudge ? 1 : Math.max(1, bridgePaint.stroke.r / 3); // Smudges replay every stored step.
      if (Math.hypot(bridgeHover[0] - last[0], bridgeHover[1] - last[1]) >= spacing) {
        points.push(bridgeHover);
        if (bridgePaint.smudge) smudgeLive(last, bridgeHover);
      }
    }
    drawBridgeOverlay();
  });
  function endBridgePaint(event) {
    if (recipeDrag?.pointer === event.pointerId) { recipePointerUp(event); return; }
    if (bridgePaint?.pointer !== event.pointerId) return;
    if (bridgePaint.junction) {
      const [x, y] = logicalPoint(event);
      bridgePaint = null;
      if (event.type === 'pointercancel') { drawBridgeOverlay(); return; }
      applyStrokes([junctionPicker.placement(x, y)], 'Placed a ' + byId('pair-junction').value + ' junction.');
      return;
    }
    const points = bridgePaint.stroke.points, end = logicalPoint(event), last = points[points.length - 1];
    if (end[0] !== last[0] || end[1] !== last[1]) { points.push(end); if (bridgePaint.smudge) smudgeLive(last, end); }
    const finished = bridgePaint;
    bridgePaint = null;
    if (event.type === 'pointercancel') { pendingStrokes = []; drawBridgeOverlay(); return; }
    if (finished.smudge) {
      if (points.length === 1 && finished.stroke.tool === 'puff') smudgeLive(points[0], points[0], finished); // A tap puffs too.
      if (points.length > 1 || finished.stroke.tool === 'puff' || finished.stroke.tool === 'clean') applyStrokes([finished.stroke]); else drawBridgeOverlay();
      return;
    }
    applyStrokes(pendingStrokes);
  }
  function smudgeLive(from, to, paint = bridgePaint) {
    const { image, stepper } = paint.smudge, frame = bridgeView.frame, sx = image.width / frame.width;
    const toPixel = ([x, y]) => ({ x: (x - frame.left) * sx, y: (y - frame.top) * image.height / frame.height });
    stepper.step(toPixel(from), toPixel(to));
  }
  function applyStrokes(strokes, label = '') {
    // Try the fill on the current bitmap first: a stroke touching no metal would otherwise make compose() skip
    // every bridge on this pair.
    const canvas = bridgeView.composed, frame = bridgeView.frame, fill = window.ModularWeaponBridgeFill;
    const sx = canvas.width / frame.width, sy = canvas.height / frame.height;
    const mask = new Uint8Array(canvas.width * canvas.height);
    const toPixel = (x, y) => ({ x: (x - frame.left) * sx, y: (y - frame.top) * sy });
    const fills = strokes.filter(stroke => stroke.points && !stroke.smudge && !stroke.tool && !stroke.junction); // Only bridge fills can fail.
    for (const stroke of fills) fill.stampStroke(mask, canvas.width, canvas.height, stroke, toPixel, sx);
    if (fills.length) try {
      fill.fillBridge(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, mask, canvas.width, canvas.height,
        { outlineThickness: 0, shadeWidth: 0 });
    } catch (error) { pendingStrokes = []; drawBridgeOverlay(); bridgeStatus('Not applied: ' + error.message); return; }
    const pair = pairOverride(), previous = pair.bridges?.strokes || [];
    pair.bridges = { ...bridgeSettings(), strokes: previous.concat(strokes) }; // Replayed in order by compose().
    pendingStrokes = []; save(); syncBridgeControls();
    if (label) bridgeStatus(label + ' ' + byId('pair-bridge-status').textContent);
  }
  previewCanvas.addEventListener('pointerup', endBridgePaint);
  previewCanvas.addEventListener('pointercancel', endBridgePaint);
  previewCanvas.addEventListener('pointerleave', () => { if (bridgeHover) { bridgeHover = null; drawBridgeOverlay(); } });
  // ---- Recipe boxes: copy a manual process into a scaled box ------------------------------------------------------
  // A recipe is a named list of bridge-brush steps made inside a box. A placed recipe box is one step on a pair,
  // { recipe, box }, that the game expands by re-mapping the recipe's steps from its box into the placed box, so
  // moving or resizing the box re-runs the whole process (live here, debounced so replays never pile up).
  const recipeStatus = text => { byId('recipe-status').textContent = text; };
  const recipeFill = () => window.ModularWeaponBridgeFill;
  const placedBoxes = () => (chosenShaft().overrides[byId('head').value]?.bridges?.strokes || []).map((op, index) => ({ op, index })).filter(entry => entry.op.recipe);
  const selectedOp = () => { const op = chosenShaft().overrides[byId('head').value]?.bridges?.strokes?.[recipeSel]; return op?.recipe ? op : null; };
  function syncRecipeControls() {
    const list = byId('recipe-list'), last = list.value, names = Object.keys(data.recipes || {});
    list.replaceChildren(...names.map(name => { const o = document.createElement('option'); o.value = name; o.textContent = name + ' (' + data.recipes[name].ops.length + ' steps)'; return o; }));
    if (names.includes(last)) list.value = last;
    const placed = byId('recipe-placed');
    placed.replaceChildren(...placedBoxes().map(({ op, index }) => { const o = document.createElement('option'); o.value = String(index);
      o.textContent = op.recipe + ' — ' + Math.round(op.box.x1 - op.box.x0) + '×' + Math.round(op.box.y1 - op.box.y0); return o; }));
    if (selectedOp()) placed.value = String(recipeSel); else if (placed.options.length && recipeSel >= 0) recipeSel = -1;
    const op = selectedOp();
    byId('recipe-uniform').checked = !!op?.uniform; byId('recipe-flip').checked = !!op?.flipX;
  }
  const boxHandles = box => { const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2;
    return [[-1, -1, box.x0, box.y0], [0, -1, mx, box.y0], [1, -1, box.x1, box.y0], [-1, 0, box.x0, my], [1, 0, box.x1, my], [-1, 1, box.x0, box.y1], [0, 1, mx, box.y1], [1, 1, box.x1, box.y1]]; };
  function drawRecipeBoxes(ctx, sx, sy, frame) {
    if (byId('pair-brush-mode').value !== 'recipe' && !recipeDraft && !placedBoxes().length) return;
    const showing = byId('pair-brush-mode').value === 'recipe', scale = contentRect(byId('preview')).scale || 1, hs = 5 / scale; // Handle half-size in bitmap px.
    const rect = box => [(box.x0 - frame.left) * sx, (box.y0 - frame.top) * sy, (box.x1 - box.x0) * sx, (box.y1 - box.y0) * sy];
    ctx.save(); ctx.lineWidth = 1.5 / scale; ctx.font = (11 / scale) + 'px system-ui'; ctx.textBaseline = 'top';
    const boxes = placedBoxes().map(({ op, index }) => ({ box: op.box, label: op.recipe, selected: index === recipeSel, color: '#75e9ed' }));
    if (recipeDraft) boxes.push({ box: recipeDraft, label: 'new box', selected: recipeSel < 0, color: '#ffce64' });
    for (const entry of boxes) {
      if (!showing && !entry.selected && entry.color !== '#ffce64') continue;
      ctx.strokeStyle = entry.selected ? '#fff' : entry.color; ctx.fillStyle = entry.color; ctx.setLineDash(entry.selected ? [] : [6 / scale, 4 / scale]);
      const [x, y, w, h] = rect(entry.box); ctx.strokeRect(x, y, w, h); ctx.fillText(entry.label, x + 3 / scale, y + 3 / scale);
      if (entry.selected && showing) { ctx.setLineDash([]); ctx.fillStyle = '#fff'; for (const [, , hx, hy] of boxHandles(entry.box)) ctx.fillRect((hx - frame.left) * sx - hs, (hy - frame.top) * sy - hs, 2 * hs, 2 * hs); }
    }
    ctx.restore();
  }
  function recipeHit(point) {
    const frame = bridgeView.frame, canvas = byId('preview'), tol = 9 / ((contentRect(canvas).scale || 1) * (canvas.width / frame.width));
    const candidates = [];
    const op = selectedOp(); if (op) candidates.push({ target: 'op', index: recipeSel, box: op.box });
    if (recipeDraft && recipeSel < 0) candidates.push({ target: 'draft', box: recipeDraft });
    for (const c of candidates) for (const [hx, hy, x, y] of boxHandles(c.box)) if (Math.hypot(point[0] - x, point[1] - y) <= tol) return { ...c, mode: 'resize', handle: [hx, hy] };
    const inside = box => point[0] >= box.x0 && point[0] <= box.x1 && point[1] >= box.y0 && point[1] <= box.y1;
    for (const c of candidates) if (inside(c.box)) return { ...c, mode: 'move' };
    const placed = placedBoxes().reverse().find(({ op: o }) => inside(o.box)); // A click inside another placed box selects it.
    if (placed) return { target: 'op', index: placed.index, box: placed.op.box, mode: 'move' };
    if (recipeDraft && inside(recipeDraft)) return { target: 'draft', box: recipeDraft, mode: 'move' };
    return null;
  }
  function recipePointerDown(event) {
    if (!bridgeView || recipeDrag) return;
    const point = logicalPoint(event), hit = recipeHit(point);
    if (hit) { recipeSel = hit.target === 'op' ? hit.index : -1; recipeDrag = { pointer: event.pointerId, target: hit.target, mode: hit.mode, handle: hit.handle, start: point, orig: { ...hit.box } }; }
    else { recipeSel = -1; recipeDraft = { x0: point[0], y0: point[1], x1: point[0] + 1, y1: point[1] + 1 }; recipeDrag = { pointer: event.pointerId, target: 'draft', mode: 'new', start: point, orig: { ...recipeDraft } }; }
    previewCanvas.setPointerCapture(event.pointerId); syncRecipeControls(); drawBridgeOverlay();
  }
  function recipePointerMove(event) {
    const point = logicalPoint(event), d = recipeDrag, dx = point[0] - d.start[0], dy = point[1] - d.start[1], MIN = 8;
    let box;
    if (d.mode === 'new') box = { x0: Math.min(d.start[0], point[0]), y0: Math.min(d.start[1], point[1]), x1: Math.max(d.start[0], point[0]), y1: Math.max(d.start[1], point[1]) };
    else if (d.mode === 'move') box = { x0: d.orig.x0 + dx, x1: d.orig.x1 + dx, y0: d.orig.y0 + dy, y1: d.orig.y1 + dy };
    else {
      box = { ...d.orig };
      if (d.handle[0] < 0) box.x0 = Math.min(d.orig.x0 + dx, d.orig.x1 - MIN); else if (d.handle[0] > 0) box.x1 = Math.max(d.orig.x1 + dx, d.orig.x0 + MIN);
      if (d.handle[1] < 0) box.y0 = Math.min(d.orig.y0 + dy, d.orig.y1 - MIN); else if (d.handle[1] > 0) box.y1 = Math.max(d.orig.y1 + dy, d.orig.y0 + MIN);
    }
    if (d.target === 'draft') { recipeDraft = box; drawBridgeOverlay(); return; }
    const op = selectedOp(); if (!op) return;
    op.box = box; drawBridgeOverlay(); recipeLiveRedo(); // The recipe re-runs in the new box.
  }
  function recipePointerUp(event) {
    const d = recipeDrag; recipeDrag = null;
    if (event.type === 'pointercancel') { if (d.target === 'draft' && d.mode === 'new') recipeDraft = null; drawBridgeOverlay(); return; }
    if (d.target === 'draft') {
      if (recipeDraft && (recipeDraft.x1 - recipeDraft.x0 < 8 || recipeDraft.y1 - recipeDraft.y0 < 8)) recipeDraft = null; // A click, not a box.
      else recipeStatus('Box drawn (' + Math.round(recipeDraft.x1 - recipeDraft.x0) + '×' + Math.round(recipeDraft.y1 - recipeDraft.y0) + '). Name it and Save recipe, or drag its edges to adjust.');
      drawBridgeOverlay(); return;
    }
    clearTimeout(redoTimer); save(); syncRecipeControls(); // Commit the box: persists, records one undo step, re-renders.
    recipeStatus('Recipe re-run in the resized box.');
  }
  let redoTimer = null, redoBusy = false, redoAgain = false;
  function recipeLiveRedo() { // Debounced: replays only when the drag pauses, and never two at once.
    clearTimeout(redoTimer);
    redoTimer = setTimeout(async () => {
      if (redoBusy) { redoAgain = true; return; }
      redoBusy = true;
      try { data = JSON.parse(JSON.stringify(api.replace(data, false))); await preview(); }
      catch (error) { recipeStatus('Re-run failed: ' + error.message); }
      finally { redoBusy = false; if (redoAgain) { redoAgain = false; recipeLiveRedo(); } }
    }, 140);
  }
  // The haft's mounts that a head attaches to, as frames { x, y, ax, ay, len } (midpoint, unit direction, length),
  // ordered along the haft (rank 0 = the topmost). A recipe's box is anchored to one of these.
  function mountFrames(shaftKey, headKey) {
    const list = api.matchingMounts(data.shafts[shaftKey], data.heads[headKey]).map(mount => {
      const dx = mount.end.x - mount.start.x, dy = mount.end.y - mount.start.y, len = Math.hypot(dx, dy) || 1;
      return { x: (mount.start.x + mount.end.x) / 2, y: (mount.start.y + mount.end.y) / 2, ax: dx / len, ay: dy / len, len };
    }).sort((u, v) => u.y - v.y);
    list.forEach((frame, i) => { frame.rank = i; frame.count = list.length; });
    return list;
  }
  const slug = text => String(text || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  // The box a recipe gets on a pair: its saved box carried to the same offset from the matching haft mount (ends to
  // ends: first to first, last to last), at the same size; with no mount to go by, its own size centred on the preview.
  function defaultRecipeBox(recipe, mounts) {
    const a = recipe.anchor;
    if (a && mounts.length) {
      const to = mounts[Math.min(mounts.length - 1, a.count > 1 ? Math.round(a.rank * (mounts.length - 1) / (a.count - 1)) : 0)];
      return recipeFill().mapMountBox(recipe.box, a.mount, to);
    }
    const w = recipe.box.x1 - recipe.box.x0, h = recipe.box.y1 - recipe.box.y0, f = bridgeView?.frame || { left: 0, top: 0, width: 450, height: 1204 };
    const cx = f.left + f.width / 2, cy = f.top + f.height / 2; return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
  }
  function addPlacedOp(shaftKey, headKey, op) {
    const pair = data.shafts[shaftKey].overrides[headKey] ||= {};
    if (!pair.bridges?.strokes) pair.bridges = { ...bridgeSettings(), strokes: [] };
    pair.bridges.strokes.push(op); return pair.bridges.strokes.length - 1;
  }
  const newPlacedOp = (name, box) => ({ recipe: name, box, ...(byId('recipe-uniform').checked ? { uniform: true } : {}), ...(byId('recipe-flip').checked ? { flipX: true } : {}) });
  function saveRecipe() {
    if (!recipeDraft) { recipeStatus('Draw a box on the preview around the work first (drag in an empty spot).'); return; }
    const name = slug(byId('recipe-name').value) || 'recipe-' + (Object.keys(data.recipes || {}).length + 1);
    const pair = pairOverride(), ops = recipeFill().opsInBox(api.expandOps(pair.bridges?.strokes || []), recipeDraft);
    if (!ops.length) { recipeStatus('No bridge-brush work inside that box on this pair. Draw the box around the work you did.'); return; }
    const mounts = mountFrames(byId('shaft').value, byId('head').value), cx = (recipeDraft.x0 + recipeDraft.x1) / 2, cy = (recipeDraft.y0 + recipeDraft.y1) / 2;
    const near = mounts.slice().sort((u, v) => Math.hypot(u.x - cx, u.y - cy) - Math.hypot(v.x - cx, v.y - cy))[0];
    (data.recipes ||= {})[name] = { box: { ...recipeDraft }, ops: JSON.parse(JSON.stringify(ops)),
      ...(near ? { anchor: { rank: near.rank, count: near.count, mount: { x: near.x, y: near.y, ax: near.ax, ay: near.ay, len: near.len } } } : {}) };
    recipeDraft = null; save(); syncRecipeControls(); byId('recipe-list').value = name;
    recipeStatus('Saved recipe "' + name + '": ' + ops.length + ' steps' + (near ? ', anchored to haft mount ' + (near.rank + 1) + ' of ' + near.count : '') + '.');
  }
  function placeRecipeHere() {
    const name = byId('recipe-list').value, recipe = data.recipes?.[name];
    if (!recipe) { recipeStatus('Save a recipe first (draw a box around work, name it, Save).'); return; }
    if (!bridgeView) { recipeStatus('Choose a compatible head and haft first.'); return; }
    const mounts = mountFrames(byId('shaft').value, byId('head').value), index = addPlacedOp(byId('shaft').value, byId('head').value, newPlacedOp(name, defaultRecipeBox(recipe, mounts)));
    recipeSel = index; save(); syncRecipeControls(); recipeStatus('Placed "' + name + '". Drag its edges and corners: the recipe re-runs in the box each time.');
  }
  function placeOnAllEligible() {
    const name = byId('recipe-list').value, recipe = data.recipes?.[name];
    if (!recipe) { recipeStatus('Save a recipe first.'); return; }
    const skip = byId('recipe-skip-existing').checked; let placed = 0, skipped = 0, noEnd = 0; const done = [];
    recipeStatus('Placing "' + name + '"…');
    for (const [shaftKey, shaft] of Object.entries(data.shafts)) {
      if (!shaft.mounts.some(m => m.type === 'eye')) continue; // Only hafts authored for eye-type heads.
      for (const [headKey, head] of Object.entries(data.heads)) {
        if (head.mount.type !== 'blade' || api.isDisallowed(shaftKey, headKey)) continue; // Tang heads this haft allows.
        const pair = shaft.overrides[headKey];
        // Skipped: this recipe is already there, or (when asked) the pair has hand-made bridge work. Other recipes' boxes don't count.
        if (pair?.bridges?.strokes?.some(op => op.recipe === name) || (skip && pair?.bridges?.strokes?.some(op => !op.recipe))) { skipped++; continue; }
        const mounts = mountFrames(shaftKey, headKey);
        if (!mounts.length) { noEnd++; continue; }
        addPlacedOp(shaftKey, headKey, newPlacedOp(name, defaultRecipeBox(recipe, mounts))); placed++; done.push(shaftKey + ' + ' + headKey);
      }
    }
    save(); syncRecipeControls();
    recipeStatus('Placed "' + name + '" on ' + placed + ' pair(s)' + (skipped ? ', skipped ' + skipped + ' that already have it or have hand-made bridge work' : '') + (noEnd ? ', ' + noEnd + ' had no mount to attach to' : '') +
      '. Open any pair to rescale its box. ' + (done.length ? 'First few: ' + done.slice(0, 4).join('; ') + '.' : ''));
  }
  function deleteRecipe() {
    const name = byId('recipe-list').value; if (!data.recipes?.[name]) return;
    delete data.recipes[name];
    for (const shaft of Object.values(data.shafts)) for (const pair of Object.values(shaft.overrides || {})) if (pair.bridges?.strokes) pair.bridges.strokes = pair.bridges.strokes.filter(op => op.recipe !== name);
    recipeSel = -1; save(); syncRecipeControls(); recipeStatus('Deleted recipe "' + name + '" and every box placed from it.');
  }
  byId('recipe-save').onclick = saveRecipe;
  byId('recipe-place').onclick = placeRecipeHere;
  byId('recipe-place-all').onclick = placeOnAllEligible;
  byId('recipe-delete').onclick = deleteRecipe;
  byId('recipe-remove').onclick = () => {
    const pair = pairOverride(); if (!selectedOp()) { recipeStatus('Select a placed box first (click its edge on the preview or pick it in the list).'); return; }
    pair.bridges.strokes.splice(recipeSel, 1); if (!pair.bridges.strokes.length) pair.bridges = null; recipeSel = -1; save(); syncRecipeControls();
  };
  byId('recipe-placed').onchange = () => { recipeSel = Number(byId('recipe-placed').value); syncRecipeControls(); drawBridgeOverlay(); };
  for (const [id, key] of [['recipe-uniform', 'uniform'], ['recipe-flip', 'flipX']]) byId(id).onchange = () => {
    const op = selectedOp(); if (!op) return; if (byId(id).checked) op[key] = true; else delete op[key]; save(); syncRecipeControls();
  };
  const junctionPicker = window.ModularJunctionPicker.bind('pair', () => drawBridgeOverlay());
  byId('pair-set-revert-point').onclick = () => {
    if (!bridgeView) { bridgeStatus('Choose a compatible head and haft first.'); return; }
    applyStrokes([{ revertPoint: true }], 'Revert point set: the revert brush now eases back to this.');
  };
  byId('pair-even-outline').onclick = () => {
    if (!bridgeView) { bridgeStatus('Choose a compatible head and haft first.'); return; }
    if (!pairOverride().bridges?.strokes?.length) { bridgeStatus('Nothing to even out yet: this works on brush-worked areas.'); return; }
    applyStrokes([{ even: true, amount: Number(byId('pair-even-amount').value) / 100 }], 'Evened out the outline wobble.');
  };
  byId('pair-style-cleanup').onclick = () => {
    if (!bridgeView) { bridgeStatus('Choose a compatible head and haft first.'); return; }
    if (!pairOverride().bridges?.strokes?.length) { bridgeStatus('Nothing to clean yet: this works on brush-worked areas.'); return; }
    applyStrokes([{ style: true, amount: Number(byId('pair-even-amount').value) / 100, pool: Number(byId('pair-style-pool').value) }], 'Cleaned up to your style.');
  };
  byId('pair-clean-outline').onclick = () => {
    if (!bridgeView) { bridgeStatus('Choose a compatible head and haft first.'); return; }
    if (!pairOverride().bridges?.strokes?.length) { bridgeStatus('Nothing to clean yet: the clean-up works on brush-worked areas (use the Clean outline brush for original artwork).'); return; }
    applyStrokes([{ clean: true, ...cleanSettings('pair') }], 'Cleaned up the outline.');
  };
  byId('pair-separate-shading').onclick = () => {
    if (!bridgeView) { bridgeStatus('Choose a compatible head and haft first.'); return; }
    applyStrokes([{ shading: true, tolerance: Number(byId('pair-shading-tolerance').value) / 100, pool: Number(byId('pair-shading-pool').value) }],
      'Separated shading.');
  };
  byId('pair-brush-mode').onchange = () => {
    byId('pair-junction-controls').hidden = byId('pair-brush-mode').value !== 'junction';
    byId('recipe-controls').hidden = byId('pair-brush-mode').value !== 'recipe'; syncRecipeControls();
    drawBridgeOverlay();
  };
  byId('pair-bridge-on').onchange = () => {
    previewCanvas.style.cursor = byId('pair-bridge-on').checked ? 'crosshair' : '';
    bridgeHover = null; drawBridgeOverlay();
  };
  byId('pair-bridge-radius').oninput = () => { byId('pair-bridge-radius-value').textContent = byId('pair-bridge-radius').value; drawBridgeOverlay(); };
  byId('pair-bridge-auto').onclick = () => {
    if (!bridgeView) { bridgeStatus('This head and haft are not compatible, so there is nothing assembled to bridge.'); return; }
    const canvas = bridgeView.composed, frame = bridgeView.frame, sx = canvas.width / frame.width;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const found = window.ModularWeaponBridgeFill.autoBridgeStrokes(pixels, canvas.width, canvas.height, { radius: bridgeRadius() * sx });
    if (!found.length) { bridgeStatus('No gaps found: the head and haft already touch.'); return; }
    applyStrokes(found.map(stroke => ({ ...stroke, r: Math.round(stroke.r / sx * 2) / 2, points: stroke.points.map(([x, y]) =>
      [Math.round((frame.left + x / sx) * 2) / 2, Math.round((frame.top + y * frame.height / canvas.height) * 2) / 2]) })),
      'Auto-bridged ' + found.length + ' gap(s).');
  };
  byId('pair-bridge-undo').onclick = () => {
    const pair = pairOverride();
    if (!pair.bridges?.strokes?.length) { bridgeStatus('No applied strokes to remove.'); return; }
    pair.bridges.strokes.pop();
    if (!pair.bridges.strokes.length) pair.bridges = null; // Explicit removal survives committed defaults.
    save(); syncBridgeControls();
  };
  byId('pair-bridge-clear').onclick = () => { pairOverride().bridges = null; pendingStrokes = []; save(); syncBridgeControls(); };
  for (const id of ['pair-bridge-outline', 'pair-bridge-light', 'pair-bridge-shade']) byId(id).onchange = () => {
    const pair = pairOverride(); // Settings changes re-fill an already applied bridge immediately.
    if (pair.bridges?.strokes?.length) { Object.assign(pair.bridges, bridgeSettings()); save(); }
  };
  byId('pair-undo').onclick = () => { if (undoStack.length) { redoStack.push(savedState); restore(undoStack.pop()); msg('Undid the last change.'); } };
  byId('pair-redo').onclick = () => { if (redoStack.length) { undoStack.push(savedState); restore(redoStack.pop()); msg('Redid the change.'); } };
  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, for whichever editor (this one or the PNG cutter)
  // was used last. Text fields keep their own native undo.
  let lastPanel = 'pair';
  document.querySelector('.pair-area').addEventListener('pointerdown', () => { lastPanel = 'pair'; }, true);
  byId('sprite-cutter')?.addEventListener('pointerdown', () => { lastPanel = 'cutter'; }, true);
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target.closest?.('input,select,textarea')) return;
    const key = event.key.toLowerCase(), redo = key === 'y' || (key === 'z' && event.shiftKey);
    if (key !== 'z' && key !== 'y') return;
    const button = byId((lastPanel === 'cutter' ? 'cut-' : 'pair-') + (redo ? 'redo' : 'undo'));
    if (button && !button.disabled) { event.preventDefault(); button.click(); }
  });
  // Slider readouts for both editors' tool settings.
  for (const id of ['pair-tool-strength', 'pair-shading-tolerance', 'pair-shading-pool', 'cut-tool-strength', 'cut-shading-tolerance', 'cut-shading-pool',
    'pair-clean-smoothing', 'pair-clean-speck', 'cut-clean-smoothing', 'cut-clean-speck', 'pair-even-amount', 'cut-even-amount']) {
    const input = byId(id), readout = byId(id + '-value');
    if (input && readout) input.addEventListener('input', () => { readout.textContent = input.value; });
  }
  for (const pre of ['pair', 'cut']) { // Pool size 0 means "learn it from the art".
    const input = byId(pre + '-style-pool'), readout = byId(pre + '-style-pool-value');
    input.addEventListener('input', () => { readout.textContent = Number(input.value) ? input.value + ' px' : 'auto'; });
  }
  // Maximize: one preview fills its floating panel (the others hide); pressing again restores them.
  for (const button of document.querySelectorAll('[data-max]')) button.addEventListener('click', () => {
    const figure = button.closest('figure'), panel = button.closest('.float-panel');
    const on = !figure.classList.contains('maximized');
    for (const other of panel.querySelectorAll('figure.maximized')) other.classList.remove('maximized');
    for (const other of panel.querySelectorAll('[data-max]')) { other.setAttribute('aria-pressed', 'false'); other.textContent = '⤢ Maximize'; }
    figure.classList.toggle('maximized', on); panel.classList.toggle('has-max', on);
    button.setAttribute('aria-pressed', String(on)); button.textContent = on ? '⤡ Restore' : '⤢ Maximize';
    panel.scrollTop = 0;
  });
  // Pinned previews sit just below the sticky header (desktop); on phones the header scrolls away.
  const header = document.querySelector('header');
  function measureHeader() {
    const sticky = getComputedStyle(header).position === 'sticky';
    document.documentElement.style.setProperty('--header-h', (sticky ? header.offsetHeight : 0) + 'px');
  }
  measureHeader(); window.addEventListener('resize', measureHeader);
  if (window.ResizeObserver) new ResizeObserver(measureHeader).observe(header);
  msg('Ready. Drag arrows over head and shaft images to define matching mounting lines.');
  render();
})();
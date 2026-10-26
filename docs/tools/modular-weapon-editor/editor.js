(function () {
  'use strict';
  const api = window.ModularWeapons; // Runtime compositor, line transform and import validator.
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
  const neutral = { scaleX: 1, scaleY: 1, flipX: false, flipY: false, x: 0, y: 0, rotation: 0, animation: 'sweep' }; // No global transform fields.
  function options(id, entries) {
    for (const [key, record] of Object.entries(entries)) {
      const option = document.createElement('option'); // Stable catalog key is kept on import/export.
      option.value = key; option.textContent = record.label; byId(id).appendChild(option);
    }
  }
  function save() {
    try {
      data = JSON.parse(JSON.stringify(api.replace(data, true))); // Persist validated line and pair data to browser draft.
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
        const matrices = match.map(mount => api.headTransform(mount, values, head.mount)); // Debug exact affine transforms used in gameplay.
        byId('debug').textContent = JSON.stringify({
          shaft: shaftKey, head: headKey, kind: head.mount.type, mounts: shaft.mounts,
          headArrow: head.mount, matchedMounts: match.length, corrections: values,
          matrices, frame: composed.modularFrame, bitmap: { width: composed.width, height: composed.height },
          disallowed: api.isDisallowed(shaftKey, headKey), gizmoMode, revision: api.diagnostics('').revision
        }, null, 2);
      } else {
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
    byId('allow-head').checked = head.editorOnly !== true;
    const accepted = compatible(), needed = head.mount.type === 'blade' ? 'tang' : 'eye';
    byId('part-readiness').textContent = !accepted
      ? 'Incompatible: add a ' + needed + ' line to this haft or choose another head.'
      : shaft.sourceShape === 'bgungku' ? "B'gungku has no gameplay donor; preview/editor use only."
      : shaft.editorOnly || head.editorOnly ? 'One or both parts still need calibration and Foundry approval.'
      : 'Compatible directed mounts; both parts are enabled for Foundry.';
    editLineNumbers();
    byId('fields').replaceChildren();
    const pair = shaft.overrides[headKey] ||= {}; // Pair-only corrections; no shaft-global defaults.
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
    preview();
  }
  function pointFor(canvas, event) {
    const rect = canvas.getBoundingClientRect(); // Pointer coordinates mapped into original source frame.
    return { x: Math.max(0, Math.min(450, Math.round((event.clientX - rect.left) / rect.width * 450))),
      y: Math.max(0, Math.min(1204, Math.round((event.clientY - rect.top) / rect.height * 1204))) };
  }
  function nearHandle(canvas, event, point, radiusPx = 32) {
    const rect = canvas.getBoundingClientRect(); // Gizmo hit target remains a comfortable CSS-pixel radius on phones.
    const x = rect.left + point.x / canvas.width * rect.width;
    const y = rect.top + point.y / canvas.height * rect.height;
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
  byId('allow-head').onchange = () => { chosenHead().editorOnly = !byId('allow-head').checked; save(); };
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
      mountIndex = 0; render(); msg('Imported and validated directed mount config (legacy sockets are migrated).');
    } catch (error) { msg('Import failed: ' + error.message); }
    finally { byId('file').value = ''; }
  };
  byId('reset').onclick = () => {
    data = JSON.parse(JSON.stringify(api.replace(window.MODULAR_WEAPON_CONFIG, true))); // Restores shipped lines and pair corrections.
    mountIndex = 0; render(); msg('Restored committed directed mount data.');
  };
  msg('Ready. Drag arrows over head and shaft images to define matching mounting lines.');
  render();
})();
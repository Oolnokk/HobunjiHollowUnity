// Pants Rig Author: whole-spline transforms + upward shrinkwrap for the species portrait beltline.
// Adds a toolbar under the portrait workspace: move / scale / width / rotate the five-point torso
// belt as one shape (tap or hold, or drag the whole belt), then "Shrinkwrap up" to slide each node
// up from below the torso onto the first opaque portrait pixel. Edits go through the author's own
// state, undo history and draft persistence, and notify the Procedural Animation host.
(function () {
  'use strict';

  if (document.getElementById('pantsBeltToolsStyles')) return;

  const OPAQUE_ALPHA = 128; // 0-255; the antialiased outline counts as body from half coverage.
  const STEPS = [ // Each step level scales every transform together.
    { label: 'Fine', move: 0.004, scale: 0.01, rotate: 0.5 },
    { label: 'Medium', move: 0.012, scale: 0.03, rotate: 2 },
    { label: 'Coarse', move: 0.04, scale: 0.08, rotate: 6 },
  ];
  let stepIndex = 0;
  let dragAll = false; // "Drag all" mode: pointer drags on the portrait translate the whole belt.
  let lastSnapshotAt = 0;

  const style = document.createElement('style');
  style.id = 'pantsBeltToolsStyles';
  style.textContent = `
.pantsBeltTools{display:none;flex-wrap:wrap;align-items:center;gap:5px 10px;padding:5px 2px 2px;flex:0 0 auto}
.canvasCard.pantsEnlarged .pantsBeltTools{display:flex} /* Only in the enlarged window, so the normal portrait canvas keeps its size. */
.pantsBeltGroup{display:inline-flex;align-items:center;gap:4px}
.pantsBeltGroup>span{font-size:11px;color:#9eb2cb;margin-right:1px}
.pantsBeltTools button{flex:0 0 auto!important;min-width:34px;min-height:34px;padding:3px 8px;font-size:13px;white-space:nowrap;touch-action:manipulation;-webkit-tap-highlight-color:rgba(107,169,255,.45);user-select:none;-webkit-user-select:none}
.pantsBeltTools button:active{transform:scale(.95);background:#2a4a78!important}
@media(pointer:coarse){.pantsBeltTools button{min-width:44px;min-height:44px;padding:6px 10px;font-size:15px}}
.pantsBeltTools button[aria-pressed=true]{outline:2px solid #6ba9ff}
.pantsBeltTools .pantsShrinkwrapBtn{font-weight:700;border-color:#9cff00;color:#d8ff8a}
.pantsBeltMsg{flex:1 1 100%;min-height:15px;font-size:11px;line-height:1.35;color:#9edfbf}
.pantsBeltMsg[data-kind=warn]{color:#ffc857}
`;
  document.head.appendChild(style);

  const api = () => window.__pantsRigAuthorDebug;
  const step = () => STEPS[stepIndex];

  function spline() {
    const points = api()?.character?.()?.portraitBeltSpline;
    return Array.isArray(points) && points.length ? points : null;
  }

  function imageRect() { // Portrait image rectangle in canvas pixels; normalized belt points live inside it.
    return api()?.state?.()?.portraitImageRect || null;
  }

  const clamp01 = value => Math.max(0, Math.min(1, value));

  function say(text, kind = 'good') {
    const node = document.querySelector('.pantsBeltMsg');
    if (!node) return;
    node.textContent = text;
    node.dataset.kind = kind;
  }

  function centroid(points) {
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  }

  function beginGesture(label) { // One undo entry per burst of taps, not one per tap.
    const now = performance.now();
    if (now - lastSnapshotAt > 1500) api()?.snapshotForUndo?.(label);
    lastSnapshotAt = now;
  }

  function commit(final = true) {
    api()?.persist?.();
    api()?.rerender?.();
    if (final) api()?.notifyHostChanged?.('belt-transform');
  }

  function translate(points, dx, dy) { // Clamped as a group so the shape never squashes against an edge.
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const safeX = Math.max(-minX, Math.min(1 - maxX, dx));
    const safeY = Math.max(-minY, Math.min(1 - maxY, dy));
    for (const p of points) { p.x += safeX; p.y += safeY; }
  }

  function scaleAbout(points, kx, ky) {
    const c = centroid(points);
    for (const p of points) { p.x = clamp01(c.x + (p.x - c.x) * kx); p.y = clamp01(c.y + (p.y - c.y) * ky); }
  }

  function rotateAbout(points, degrees) { // Rotates in pixel space so the belt keeps its shape on a non-square rect.
    const rect = imageRect();
    const w = rect?.width || 1, h = rect?.height || 1;
    const c = centroid(points);
    const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
    for (const p of points) {
      const dx = (p.x - c.x) * w, dy = (p.y - c.y) * h;
      p.x = clamp01(c.x + (dx * cos - dy * sin) / w);
      p.y = clamp01(c.y + (dx * sin + dy * cos) / h);
    }
  }

  const actions = {
    left: () => { const s = spline(); if (s) translate(s, -step().move, 0); },
    right: () => { const s = spline(); if (s) translate(s, step().move, 0); },
    up: () => { const s = spline(); if (s) translate(s, 0, -step().move); },
    down: () => { const s = spline(); if (s) translate(s, 0, step().move); },
    grow: () => { const s = spline(); if (s) scaleAbout(s, 1 + step().scale, 1 + step().scale); },
    shrink: () => { const s = spline(); if (s) scaleAbout(s, 1 - step().scale, 1 - step().scale); },
    wider: () => { const s = spline(); if (s) scaleAbout(s, 1 + step().scale, 1); },
    narrower: () => { const s = spline(); if (s) scaleAbout(s, 1 - step().scale, 1); },
    rotateLeft: () => { const s = spline(); if (s) rotateAbout(s, -step().rotate); },
    rotateRight: () => { const s = spline(); if (s) rotateAbout(s, step().rotate); },
  };

  function bindRepeat(button, name, label) { // Tap once, or hold to repeat.
    let delay = null, timer = null;
    const stop = () => {
      if (delay == null && timer == null) return;
      clearTimeout(delay); clearInterval(timer); delay = timer = null;
      commit(true);
    };
    const run = () => { actions[name](); commit(false); };
    button.addEventListener('pointerdown', event => {
      if (event.button > 0) return;
      event.preventDefault();
      beginGesture(label);
      run();
      delay = setTimeout(() => { timer = setInterval(run, 70); }, 380);
      try { button.setPointerCapture(event.pointerId); } catch (_) {}
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, stop);
    button.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      beginGesture(label);
      run();
      commit(true);
    });
  }

  // Alpha of the canonical portrait the beltline is authored over (200x200, hidden #portraitSource).
  function readPortraitAlpha() {
    const source = document.getElementById('portraitSource');
    if (!source?.width || !source?.height) return null;
    try {
      const data = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
      return { width: source.width, height: source.height, data };
    } catch (error) {
      return { error: error.message };
    }
  }

  function shrinkwrapUp() {
    const points = spline();
    if (!points) { say('No beltline to shrinkwrap yet.', 'warn'); return; }
    const alpha = readPortraitAlpha();
    if (!alpha || alpha.error) { say(`Portrait pixels are not readable${alpha?.error ? `: ${alpha.error}` : ' yet'}.`, 'warn'); return; }
    const opaque = (x, y) => alpha.data[(y * alpha.width + x) * 4 + 3] >= OPAQUE_ALPHA;
    const hits = points.map(point => {
      const x = Math.max(0, Math.min(alpha.width - 1, Math.round(point.x * alpha.width - 0.5)));
      let y = Math.max(0, Math.min(alpha.height - 1, Math.round(point.y * alpha.height - 0.5)));
      if (opaque(x, y)) { // Already inside the body: settle on the lower edge of this opaque run.
        while (y + 1 < alpha.height && opaque(x, y + 1)) y++;
        return y;
      }
      for (let up = y - 1; up >= 0; up--) if (opaque(x, up)) return up; // Below the body: first opaque pixel going up.
      return null;
    });
    const found = hits.filter(value => value != null);
    if (!found.length) { say('No opaque pixels above the beltline. Move it below the torso first.', 'warn'); return; }
    const fallback = found.reduce((sum, value) => sum + value, 0) / found.length;
    api()?.snapshotForUndo?.('shrinkwrap belt'); // Its own undo step, even right after a transform burst.
    lastSnapshotAt = performance.now();
    hits.forEach((hit, index) => {
      const row = hit == null ? nearestHit(hits, index) ?? fallback : hit; // Misses follow the closest node that did land on the body.
      points[index].y = clamp01((row + 0.5) / alpha.height);
    });
    commit(true);
    const missed = hits.length - found.length;
    say(missed ? `Shrinkwrapped ${found.length} of ${hits.length} nodes; the rest follow their neighbours.` : `Shrinkwrapped all ${hits.length} nodes onto the first opaque pixels.`);
  }

  function nearestHit(hits, index) {
    for (let offset = 1; offset < hits.length; offset++) {
      if (hits[index - offset] != null) return hits[index - offset];
      if (hits[index + offset] != null) return hits[index + offset];
    }
    return null;
  }

  function installDragAll(canvas) { // Capture-phase so the author's own nearest-node drag never sees these pointers.
    let drag = null;
    const normalized = event => {
      const rect = imageRect();
      const box = canvas.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: ((event.clientX - box.left) * canvas.width / Math.max(1, box.width) - rect.x) / rect.width,
        y: ((event.clientY - box.top) * canvas.height / Math.max(1, box.height) - rect.y) / rect.height,
      };
    };
    canvas.addEventListener('pointerdown', event => {
      if (!dragAll || !spline()) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const start = normalized(event);
      if (!start) return;
      beginGesture('move belt');
      drag = { start, original: spline().map(p => ({ x: p.x, y: p.y })) };
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    }, true);
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      event.stopImmediatePropagation();
      const now = normalized(event);
      const points = spline();
      if (!now || !points) return;
      points.forEach((p, index) => { p.x = drag.original[index].x; p.y = drag.original[index].y; });
      translate(points, now.x - drag.start.x, now.y - drag.start.y);
      commit(false);
    }, true);
    const finish = event => {
      if (!drag) return;
      event.stopImmediatePropagation();
      drag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      commit(true);
    };
    canvas.addEventListener('pointerup', finish, true);
    canvas.addEventListener('pointercancel', finish, true);
  }

  function install() {
    const canvas = document.getElementById('portraitCanvas');
    const card = canvas?.closest('.canvasCard');
    if (!card || card.querySelector('.pantsBeltTools')) return;

    const tools = document.createElement('div');
    tools.className = 'pantsBeltTools';
    const group = (title, ...children) => {
      const wrap = document.createElement('span');
      wrap.className = 'pantsBeltGroup';
      const label = document.createElement('span');
      label.textContent = title;
      wrap.appendChild(label);
      for (const child of children) wrap.appendChild(child);
      tools.appendChild(wrap);
      return wrap;
    };
    const button = (text, title, extraClass = '', iconOnly = false) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `secondary ${extraClass}`.trim();
      node.textContent = text;
      node.title = title;
      if (iconOnly) node.setAttribute('aria-label', title); // Text buttons keep their visible text as the accessible name.
      return node;
    };
    const repeat = (text, title, name) => { const node = button(text, title, '', true); bindRepeat(node, name, `belt ${name}`); return node; };

    group('Move', repeat('◀', 'Move belt left', 'left'), repeat('▶', 'Move belt right', 'right'), repeat('▲', 'Move belt up', 'up'), repeat('▼', 'Move belt down', 'down'));
    const dragButton = button('✥ Drag all', 'Drag anywhere on the portrait to move the whole belt');
    dragButton.setAttribute('aria-pressed', 'false');
    dragButton.addEventListener('click', () => {
      dragAll = !dragAll;
      dragButton.setAttribute('aria-pressed', String(dragAll));
      say(dragAll ? 'Drag anywhere on the portrait to move the whole belt.' : 'Drag a node to move just that node.', 'good');
    });
    group('', dragButton);
    group('Scale', repeat('－', 'Shrink belt', 'shrink'), repeat('＋', 'Grow belt', 'grow'));
    group('Width', repeat('⇤⇥', 'Narrower', 'narrower'), repeat('⇠⇢', 'Wider', 'wider'));
    group('Rotate', repeat('↶', 'Rotate counter-clockwise', 'rotateLeft'), repeat('↷', 'Rotate clockwise', 'rotateRight'));
    const stepButton = button(`Step: ${step().label}`, 'Cycle the size of each tap: Fine, Medium, Coarse');
    stepButton.addEventListener('click', () => { stepIndex = (stepIndex + 1) % STEPS.length; stepButton.textContent = `Step: ${step().label}`; });
    group('', stepButton);
    const wrap = button('⤒ Shrinkwrap up', 'Slide each belt node up from below the torso onto the first opaque portrait pixel', 'pantsShrinkwrapBtn');
    wrap.addEventListener('click', shrinkwrapUp);
    group('', wrap);
    const message = document.createElement('div');
    message.className = 'pantsBeltMsg';
    message.textContent = 'Place the belt just below the torso, then Shrinkwrap up.';
    tools.appendChild(message);
    card.appendChild(tools);
    const enlargeButton = card.querySelector('.pantsEnlargeBtn');
    if (enlargeButton) enlargeButton.title = 'Enlarge this workspace (adds move/scale/rotate and Shrinkwrap tools for the belt). Esc exits.';
    installDragAll(canvas);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.PantsRigBeltTools = Object.freeze({
    shrinkwrapUp,
    run: name => { if (!actions[name]) return false; beginGesture(`belt ${name}`); actions[name](); commit(true); return true; },
    setStep: index => { stepIndex = Math.max(0, Math.min(STEPS.length - 1, index | 0)); },
    setDragAll: value => { dragAll = !!value; },
  });
})();

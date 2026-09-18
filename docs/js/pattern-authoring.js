// Pattern authoring — a small full-screen modal for hand-drawing a motif,
// then placing/tiling it across some other system's surface. Deliberately
// knows nothing about verdigris, metal, dye, or clothing: it just produces a
// JSON placement definition (see PATTERN_DEFAULTS below) plus a black-on-
// transparent motif image, and hands both back through onSave. The caller
// supplies a renderPreview(patternData) hook that turns that definition into
// an actual preview image on whatever surface it owns — that's the only
// coupling point, so the same editor works for the smithy's authored
// verdigris-removal patterns today (see metal-craft-shop.js) and for the
// loom's weaving patterns (see clothing-weaving-system.js). A caller that
// also passes renderPreviewBehind gets a "Behind view" toggle on the
// preview panel (see clothing-weaving-system.js's hasBehindView) — omit it
// and the toggle simply doesn't appear.
(() => {
  'use strict';

  const SKETCH_SIZE = 192; // motif working resolution, px — the marked/drawable area a brush's own input coordinate is confined to.
  // A brush stroke's rendered ink is a full-width circle/line centered on the
  // input coordinate, so a stroke aimed right at the SKETCH_SIZE edge still
  // needs BRUSH_MAX_SIZE/2 px of canvas beyond that edge to render its far
  // half without the canvas's own boundary silently clipping it. SKETCH_PAD
  // is that margin; the sketch canvas is SKETCH_SIZE + 2*SKETCH_PAD square,
  // with the inner SKETCH_SIZE region marked by a dotted line (see
  // .pa-sketchBoundary) so the bleed margin is visible instead of being an
  // unmarked dead zone. The frame canvas (see FRAME_SHAPES below) shares
  // this same size so the two tools line up pixel-for-pixel.
  const BRUSH_MAX_SIZE = 35;
  const SKETCH_PAD = Math.ceil(BRUSH_MAX_SIZE / 2) + 1;
  const SKETCH_CANVAS_SIZE = SKETCH_SIZE + SKETCH_PAD * 2;
  const UNDO_LIMIT = 20; // Sketch snapshots are ~200KB each (SKETCH_CANVAS_SIZE^2 * 4 bytes) — capped so a long session's history can't grow unbounded.

  const PATTERN_DEFAULTS = Object.freeze({
    motifScale: 1, // size of the drawn ink itself, relative to its own opaque-ink bounds
    motifRotationDeg: 0,
    tiling: true,
    invert: false, // swap which side of the motif stays vs. clears (see tool-metal-recolor.js)
    // Erodes the placed/tiled ink mask inward by this many px before the
    // outline (if any) is drawn around it — see buildPatternMask/
    // recolorAndOxidize's erodeMask call. 0 = no thinning.
    motifThinPx: 0,
    // The repeat lattice: frameShape picks a cell shape from FRAME_SHAPES,
    // and frameX/frameY/frameRotationDeg/frameScale place/rotate/size that
    // cell directly (see the frame tool below) — replaces the old auto-fit
    // triangle/grid geometry (repeatMode/trianglePadding/gridSpacing/
    // patternScale/patternRotationDeg/translateX/translateY), which used to
    // compute the tightest-fitting shape around the ink automatically
    // instead of letting the player place it themselves.
    frameShape: 'square',
    frameX: 0,
    frameY: 0,
    frameRotationDeg: 0,
    frameScale: 1,
  });

  // Mirrors clothing-weaving-system.js's/tool-metal-recolor.js's own
  // FRAME_SHAPES exactly (including the polygon clip each cell stamps
  // through) — kept in sync by hand (see this codebase's convention of
  // duplicating small algorithm tables per independent module rather than
  // cross-importing) so the outline drawn here always matches what the
  // real renderer will actually cut the ink to. The actual tiled render
  // itself is always the real caller's own renderPreview, never computed
  // in this file.
  const FRAME_SHAPES = Object.freeze({
    square: { label: 'Square', paired: false, basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }), polygon: null },
    brick: { label: 'Brick', paired: false, basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: w / 2, y: h } }), polygon: null },
    diamond: {
      label: 'Diamond', paired: false,
      basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }),
      polygon: (w, h) => [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }],
    },
    triangle: {
      label: 'Triangle', paired: true,
      basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }),
      polygon: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }],
    },
    trapezoid: {
      label: 'Trapezoid', paired: true,
      basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }),
      polygon: (w, h) => { const cutFrac = 0.25, cut = h * cutFrac; return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h - cut }, { x: 0, y: cut }]; },
    },
  });
  function frameShapeFor(id) {
    return FRAME_SHAPES[id] || FRAME_SHAPES.square;
  }

  // Patterns saved before the frame tool existed have no frameShape at all
  // — just the old repeatMode/patternScale/patternRotationDeg/translateX/Y
  // fields. Mirrors clothing-weaving-system.js's/tool-metal-recolor.js's
  // own legacyFrameFields exactly, so a pattern re-opened for editing shows
  // the same placement the real renderer already migrates it to, instead
  // of silently resetting to PATTERN_DEFAULTS' bare defaults (square,
  // centered, unscaled, unrotated) just because the old field names don't
  // exist on this object.
  function legacyFrameFields(patternDef) {
    if (!patternDef || patternDef.frameShape) return patternDef;
    return {
      ...patternDef,
      frameShape: patternDef.repeatMode === 'grid' ? 'square' : 'triangle',
      frameScale: patternDef.patternScale,
      frameRotationDeg: patternDef.patternRotationDeg,
      frameX: patternDef.translateX,
      frameY: patternDef.translateY,
    };
  }

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .pa-overlay{position:fixed;inset:0;z-index:9500;background:rgba(6,10,12,.72);display:flex;align-items:center;justify-content:center;padding:14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      .pa-modal{width:min(900px,100%);max-height:100%;overflow:auto;background:linear-gradient(180deg,#121a20,#0f161c);border:1px solid #294039;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);color:#eaf5f3}
      .pa-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
      .pa-head h2{margin:0;font-size:16px}
      .pa-close{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#eaf5f3;border-radius:10px;width:30px;height:30px;cursor:pointer;font-size:15px;line-height:1}
      .pa-body{display:grid;grid-template-columns:minmax(190px,230px) minmax(420px,1fr);gap:12px;padding:12px 14px;align-items:start}
      @media(max-width:680px){.pa-body{grid-template-columns:1fr}}
      .pa-col{min-width:0}
      .pa-rightCol{position:relative}
      .pa-stickyTop{position:sticky;top:0;z-index:3;background:linear-gradient(180deg,#121a20,#0f161c);padding-top:2px;padding-bottom:6px;margin:-2px 0 0}
      .pa-toolsRow{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}
      @media(max-width:560px){.pa-toolsRow{grid-template-columns:1fr}}
      .pa-card{background:rgba(255,255,255,.04);border:1px solid #294039;border-radius:12px;padding:8px 9px;margin-bottom:8px}
      .pa-card h3{margin:0 0 5px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#cfe9e4}
      .pa-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
      .pa-field{margin-bottom:5px}
      .pa-field label{display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:#9cb3ae;margin-bottom:2px}
      .pa-field input[type=range]{width:100%;display:block;height:16px}
      .pa-check{display:flex;align-items:center;gap:6px;color:#9cb3ae;font-size:11px;font-weight:700;margin-bottom:4px}
      .pa-check input{accent-color:#7fc7bc}
      .pa-btn{border:1px solid rgba(127,199,188,.38);background:rgba(127,199,188,.13);color:#eaf5f3;border-radius:10px;padding:6px 10px;font-weight:800;cursor:pointer;font-size:12px}
      .pa-btn.secondary{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.055)}
      .pa-btn.good{border-color:rgba(129,214,154,.42);background:rgba(129,214,154,.14)}
      .pa-btn:disabled{opacity:.4;cursor:default}
      .pa-canvasWrap{position:relative;width:100%;max-width:${SKETCH_CANVAS_SIZE}px;aspect-ratio:1/1;margin:0 auto;border-radius:12px;border:1px solid rgba(255,255,255,.12);background-image:linear-gradient(45deg,rgba(255,255,255,.06) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.06) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.06) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.06) 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
      .pa-canvasWrap canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;image-rendering:pixelated}
      .pa-sketch{cursor:crosshair}
      .pa-frameCanvas{cursor:grab}
      .pa-sketchBoundary{position:absolute;inset:calc(${SKETCH_PAD} / ${SKETCH_CANVAS_SIZE} * 100%);border:1px dashed rgba(255,255,255,.45);border-radius:2px;pointer-events:none}
      .pa-previewWrap{display:grid;place-items:center;min-height:160px;border-radius:13px;border:1px solid #294039;background:#0a0e11;background-image:linear-gradient(45deg,rgba(255,255,255,.045) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.045) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.045) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.045) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
      .pa-previewWrap canvas,.pa-previewWrap img{position:static;inset:auto;width:auto;height:auto;max-width:100%;max-height:min(220px,32vh);image-rendering:pixelated}
      .pa-hint{font-size:10px;line-height:1.35;color:#9cb3ae;margin:0 0 6px}
      .pa-libraryList{display:flex;flex-direction:column;gap:5px;max-height:130px;overflow:auto;margin-bottom:2px}
      .pa-libraryRow{display:flex;align-items:center;gap:5px}
      .pa-libraryRow .pa-libLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#eaf5f3}
      .pa-libraryRow .pa-btn{padding:4px 8px;font-size:10px}
      .pa-libraryName{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#eaf5f3;padding:5px 7px;font-size:11px}
      .pa-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.1)}
      .pa-toolToggle.active{outline:2px solid #7fc7bc;background:rgba(127,199,188,.18)!important}
      .pa-shapeToggle.active{outline:2px solid #7fc7bc;background:rgba(127,199,188,.18)!important}
      .pa-frameReadout{font-size:10px;color:#9cb3ae;text-align:center;margin-top:4px}
      .pa-behindToggle{min-height:24px;padding:3px 9px;font-size:10px;text-transform:none;letter-spacing:0;font-weight:700;border-radius:8px;border:1px solid #3a564d;background:#17232a;color:#eaf5f3;cursor:pointer}
      .pa-behindToggle.active{outline:2px solid #7fc7bc;background:rgba(127,199,188,.18)}
    `;
    document.head.appendChild(style);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Moves a freshly authored motif's pixel data out to MotifStore (see
  // docs/js/motif-store.js) so the caller's onSave gets a small
  // customMotifId reference instead of a full embedded copy — used only
  // for a per-item "Custom" pattern; a pattern saved unmodified from the
  // library is already persisted as just a patternLibraryId reference by
  // the caller, so it never reaches this. Falls back to returning `data`
  // unchanged (today's fully-embedded shape) if the store is unavailable
  // or the write fails — a motif is never lost over this optimization.
  async function offloadMotif(data) {
    if (!data?.motifDataUrl || typeof window.MotifStore?.saveMotif !== 'function') return data;
    const customMotifId = await window.MotifStore.saveMotif(data.motifDataUrl).catch(() => null);
    if (!customMotifId) return data;
    const { motifDataUrl, ...rest } = data;
    return { ...rest, customMotifId };
  }

  // Finds the ink's own tight opaque bounds on a SKETCH_CANVAS_SIZE-square
  // ImageData — same threshold (alpha>16) and shape as buildPatternMask's
  // own findOpaqueBounds, so the frame tool's reference cell size always
  // matches what the real renderer will actually use.
  function opaqueBoundsOf(imageData) {
    const { data, width, height } = imageData;
    let x0 = width, y0 = height, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] <= 16) continue;
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return count ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
  }

  function openEditor(options = {}) {
    injectStyles();
    const cfg = { ...PATTERN_DEFAULTS, ...legacyFrameFields(options.initialPattern) };
    let closed = false;
    let brushMode = 'brush'; // 'brush' | 'eraser'
    let brushSize = 30;
    let drawing = false;
    let lastPt = null;
    let previewToken = 0;
    let previewView = 'front'; // 'front' | 'behind' — only meaningful when options.renderPreviewBehind exists.
    // Tracks whether the pattern currently loaded is an UNMODIFIED library
    // entry (options.initialPatternLibraryId at open, or a "Load" click) —
    // cleared by any edit (a stroke, a placement change, reset, clear).
    // Passed as onSave's 2nd argument so a caller can store just the
    // reference instead of a full duplicate copy of the pattern; see
    // clothing-weaving-system.js/metal-craft-shop.js.
    let loadedLibraryId = options.initialPatternLibraryId || null;

    // ── Sketch undo/redo ─────────────────────────────────────────────────
    // Whole-canvas ImageData snapshots, pushed just BEFORE each mutation
    // (a stroke starting, Clear, or loading a motif) so undo restores the
    // state right before that action. Any push clears the redo stack, same
    // as every ordinary undo/redo history.
    let undoStack = [];
    let redoStack = [];

    const overlay = document.createElement('div');
    overlay.className = 'pa-overlay';
    overlay.innerHTML = `
      <div class="pa-modal" role="dialog" aria-modal="true">
        <div class="pa-head"><h2>${escapeHtml(options.title || 'Author a pattern')}</h2><button type="button" class="pa-close" aria-label="Close">✕</button></div>
        <div class="pa-body">
          <div class="pa-col pa-leftCol">
            <div class="pa-card">
              <h3>Pattern settings</h3>
              <div class="pa-check"><input type="checkbox" class="pa-in" data-field="tiling" ${cfg.tiling ? 'checked' : ''}><label>Repeat (tile the motif)</label></div>
              <div class="pa-check"><input type="checkbox" class="pa-in" data-field="invert" ${cfg.invert ? 'checked' : ''}><label>Invert pattern</label></div>
              <div class="pa-field"><label><span>Motif thinning</span><span class="pa-val" data-for="motifThinPx"></span></label><input type="range" class="pa-in" data-field="motifThinPx" min="0" max="12" step="1" value="${cfg.motifThinPx}"></div>
              <p class="pa-hint">Erodes the placed ink inward from every edge before any outline is drawn around it — like magic-wand-selecting the transparent area with this many px of expansion, then deleting the selection.</p>
            </div>
            ${options.library ? `
            <div class="pa-card">
              <h3>Library</h3>
              <p class="pa-hint">Save this pattern to reuse later, or load one you've already saved or unlocked. Loading replaces the current motif and settings.</p>
              <div class="pa-libraryList"></div>
              <div class="pa-row" style="margin-top:9px">
                <input type="text" class="pa-libraryName" placeholder="Pattern name" maxlength="60">
                <button type="button" class="pa-btn secondary" data-act="saveToLibrary">Save to library</button>
              </div>
            </div>` : ''}
          </div>
          <div class="pa-col pa-rightCol">
            <div class="pa-stickyTop">
              <div class="pa-card">
                <h3><span>Preview</span><button type="button" class="pa-behindToggle" data-act="toggleBehindView" style="display:none">Behind view</button></h3>
                <p class="pa-hint pa-previewStatus">Draw a motif to preview.</p>
                <div class="pa-previewWrap"><canvas class="pa-preview" width="1" height="1"></canvas></div>
              </div>
              <div class="pa-toolsRow">
                <div class="pa-card">
                  <h3>Motif</h3>
                  <p class="pa-hint">${escapeHtml(options.motifHint || 'Draw a solid black motif. This is the shape that gets placed and repeated.')}</p>
                  <div class="pa-canvasWrap"><canvas class="pa-sketch" width="${SKETCH_CANVAS_SIZE}" height="${SKETCH_CANVAS_SIZE}"></canvas><div class="pa-sketchBoundary"></div></div>
                  <p class="pa-hint" style="margin-top:5px">The dashed line marks where the brush's own input is confined — a stroke aimed right at that line still paints its full width, bleeding into the margin outside it instead of being clipped in half. The eraser isn't confined to it.</p>
                  <div class="pa-row" style="margin-top:9px">
                    <button type="button" class="pa-btn secondary pa-toolToggle active" data-tool="brush">Brush</button>
                    <button type="button" class="pa-btn secondary pa-toolToggle" data-tool="eraser">Eraser</button>
                    <button type="button" class="pa-btn secondary" data-act="clearSketch">Clear</button>
                  </div>
                  <div class="pa-row">
                    <button type="button" class="pa-btn secondary" data-act="undo" disabled>↶ Undo</button>
                    <button type="button" class="pa-btn secondary" data-act="redo" disabled>↷ Redo</button>
                  </div>
                  <div class="pa-field"><label><span>Brush size</span><span class="pa-brushSizeVal">${brushSize}px</span></label><input type="range" class="pa-brushSize" min="25" max="35" step="1" value="${brushSize}"></div>
                </div>
                <div class="pa-card">
                  <h3>Frame</h3>
                  <p class="pa-hint">Drag the middle to move the repeat cell, drag the corner to rotate and resize it. This is what actually tiles — pick a shape below first.</p>
                  <div class="pa-canvasWrap"><canvas class="pa-frameCanvas" width="${SKETCH_CANVAS_SIZE}" height="${SKETCH_CANVAS_SIZE}"></canvas></div>
                  <p class="pa-frameReadout" data-frame-readout></p>
                  <div class="pa-row" style="margin-top:9px">
                    ${Object.entries(FRAME_SHAPES).map(([id, shape]) => `<button type="button" class="pa-btn secondary pa-shapeToggle${cfg.frameShape === id ? ' active' : ''}" data-shape="${id}">${escapeHtml(shape.label)}</button>`).join('')}
                  </div>
                  <div class="pa-field"><label><span>Motif scale</span><span class="pa-val" data-for="motifScale"></span></label><input type="range" class="pa-in" data-field="motifScale" min="0.1" max="3" step="0.01" value="${cfg.motifScale}"></div>
                  <div class="pa-field"><label><span>Motif rotation</span><span class="pa-val" data-for="motifRotationDeg"></span></label><input type="range" class="pa-in" data-field="motifRotationDeg" min="-180" max="180" step="1" value="${cfg.motifRotationDeg}"></div>
                  <div class="pa-row">
                    <button type="button" class="pa-btn secondary" data-act="autoDetect">Auto-detect fit</button>
                    <button type="button" class="pa-btn secondary" data-act="resetPlacement">Reset placement</button>
                  </div>
                  <p class="pa-hint">Auto-detect rotates the motif to whatever angle makes its own tight bounding box smallest, then resets the frame to a centered, ungapped square at that angle — a quick starting point to drag from, not a final answer.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="pa-foot">
          <button type="button" class="pa-btn secondary" data-act="cancel">Cancel</button>
          <button type="button" class="pa-btn good" data-act="save">Save pattern</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const sketchCanvas = overlay.querySelector('.pa-sketch');
    const sketchCtx = sketchCanvas.getContext('2d');
    sketchCtx.lineCap = 'round';
    sketchCtx.lineJoin = 'round';
    const frameCanvas = overlay.querySelector('.pa-frameCanvas');
    const frameCtx = frameCanvas.getContext('2d');
    const frameReadout = overlay.querySelector('[data-frame-readout]');
    const undoBtn = overlay.querySelector('[data-act="undo"]');
    const redoBtn = overlay.querySelector('[data-act="redo"]');
    const previewCanvas = overlay.querySelector('.pa-preview');
    const previewCtx = previewCanvas.getContext('2d');
    const previewStatus = overlay.querySelector('.pa-previewStatus');
    const behindToggleBtn = overlay.querySelector('[data-act="toggleBehindView"]');
    if (typeof options.renderPreviewBehind === 'function') behindToggleBtn.style.display = '';

    function updateValLabels() {
      overlay.querySelectorAll('.pa-val').forEach(el => {
        const field = el.dataset.for;
        if (field === 'motifScale') el.textContent = `${Number(cfg[field]).toFixed(2)}×`;
        else if (field === 'motifThinPx') el.textContent = `${Number(cfg[field]).toFixed(0)}px`;
        else el.textContent = `${cfg[field]}°`;
      });
    }
    updateValLabels();

    function hasMotifInk() {
      try {
        const data = sketchCtx.getImageData(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 16) return true;
      } catch { /* ignore */ }
      return false;
    }

    function currentPatternData() {
      return {
        motifDataUrl: hasMotifInk() ? sketchCanvas.toDataURL('image/png') : null,
        motifScale: Number(cfg.motifScale),
        motifRotationDeg: Number(cfg.motifRotationDeg),
        tiling: !!cfg.tiling,
        invert: !!cfg.invert,
        motifThinPx: Number(cfg.motifThinPx) || 0,
        frameShape: FRAME_SHAPES[cfg.frameShape] ? cfg.frameShape : 'square',
        frameX: Number(cfg.frameX) || 0,
        frameY: Number(cfg.frameY) || 0,
        frameRotationDeg: Number(cfg.frameRotationDeg) || 0,
        frameScale: Number(cfg.frameScale) || 1,
      };
    }

    let previewTimer = 0;
    function schedulePreview() {
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(runPreview, 160);
    }

    async function runPreview() {
      const data = currentPatternData();
      const renderFn = previewView === 'behind' ? options.renderPreviewBehind : options.renderPreview;
      if (!data.motifDataUrl || typeof renderFn !== 'function') {
        previewStatus.textContent = data.motifDataUrl ? 'Rendering preview…' : 'Draw a motif to preview.';
        return;
      }
      const token = ++previewToken;
      previewStatus.textContent = 'Rendering preview…';
      try {
        const rendered = await renderFn(data);
        if (closed || token !== previewToken || !rendered) return;
        previewCanvas.width = rendered.width;
        previewCanvas.height = rendered.height;
        previewCtx.imageSmoothingEnabled = false;
        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewCtx.drawImage(rendered, 0, 0);
        previewStatus.textContent = '';
      } catch (err) {
        if (closed || token !== previewToken) return;
        previewStatus.textContent = 'Preview failed — see console.';
        console.error('[PatternAuthoring] preview render failed', err);
      }
    }

    behindToggleBtn.addEventListener('click', () => {
      previewView = previewView === 'behind' ? 'front' : 'behind';
      behindToggleBtn.classList.toggle('active', previewView === 'behind');
      behindToggleBtn.textContent = previewView === 'behind' ? 'Front view' : 'Behind view';
      schedulePreview();
    });

    // ── Frame tool ───────────────────────────────────────────────────────
    // Draws the current motif (dimmed, for reference) plus the chosen
    // FRAME_SHAPES cell — a parallelogram spanned by basisU/basisV sized
    // from the ink's own tight bounds, exactly like buildPatternMask itself
    // computes it — transformed by frameX/frameY/frameRotationDeg/
    // frameScale, with two drag handles: the middle dot moves it (frameX/Y),
    // the corner dot rotates+scales it (frameRotationDeg/frameScale) in one
    // gesture, same as a resize handle in most drawing/slide tools.
    const FRAME_HANDLE_RADIUS = 7;
    let frameDrag = null; // { mode: 'translate'|'transform', startX, startY, startFrameX, startFrameY, baseCorner }

    function currentBasis() {
      let bbox = null;
      try { bbox = opaqueBoundsOf(sketchCtx.getImageData(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE)); } catch { /* ignore */ }
      const w = bbox?.w || SKETCH_SIZE * 0.4, h = bbox?.h || SKETCH_SIZE * 0.4;
      const shape = frameShapeFor(cfg.frameShape);
      const { u, v } = shape.basis(w, h);
      return { shape, u, v };
    }

    function frameCenterScreen() {
      return { x: SKETCH_CANVAS_SIZE / 2 + (Number(cfg.frameX) || 0), y: SKETCH_CANVAS_SIZE / 2 + (Number(cfg.frameY) || 0) };
    }
    function rotatePoint(x, y, rad) {
      const c = Math.cos(rad), s = Math.sin(rad);
      return { x: x * c - y * s, y: x * s + y * c };
    }

    function drawFrameCanvas() {
      frameCtx.clearRect(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE);
      frameCtx.globalAlpha = 0.35;
      frameCtx.drawImage(sketchCanvas, 0, 0);
      frameCtx.globalAlpha = 1;

      const { shape, u, v } = currentBasis();
      let bbox = null;
      try { bbox = opaqueBoundsOf(sketchCtx.getImageData(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE)); } catch { /* ignore */ }
      const w = bbox?.w || SKETCH_SIZE * 0.4, h = bbox?.h || SKETCH_SIZE * 0.4;
      const scale = Math.max(0.05, Number(cfg.frameScale) || 1);
      const rad = ((Number(cfg.frameRotationDeg) || 0) * Math.PI) / 180;
      const center = frameCenterScreen();
      const toScreen = (localX, localY) => {
        const spun = rotatePoint(localX * scale, localY * scale, rad);
        return { x: center.x + spun.x, y: center.y + spun.y };
      };
      // Corners of the full basisU/basisV rectangle, centered on the
      // frame's own origin — used for the drag handles always, and (for a
      // shape with no polygon of its own, e.g. square/brick) the outline.
      const rectCorner = (bu, bv) => toScreen(u.x * bu + v.x * bv, u.y * bu + v.y * bv);
      const p11 = rectCorner(0.5, 0.5);

      function strokePolygon(points) {
        frameCtx.beginPath();
        points.forEach((p, i) => {
          const pt = toScreen(p.x - w / 2, p.y - h / 2);
          if (i === 0) frameCtx.moveTo(pt.x, pt.y); else frameCtx.lineTo(pt.x, pt.y);
        });
        frameCtx.closePath();
        frameCtx.stroke();
      }

      frameCtx.save();
      frameCtx.strokeStyle = '#7fc7bc';
      frameCtx.lineWidth = 1.5;
      frameCtx.setLineDash([4, 3]);
      const polygon = shape.polygon ? shape.polygon(w, h) : null;
      if (polygon) {
        strokePolygon(polygon);
        // The 180°-partner (paired shapes only) is this same polygon
        // rotated about the cell's own center (w/2,h/2) — mirrors exactly
        // how buildPatternMask/buildAuthoredClearedMask stamp it, so the
        // outline shown here always matches the real render.
        if (shape.paired) strokePolygon(polygon.map(p => ({ x: w - p.x, y: h - p.y })));
      } else {
        const corners = [rectCorner(-0.5, -0.5), rectCorner(0.5, -0.5), p11, rectCorner(-0.5, 0.5)];
        frameCtx.beginPath();
        corners.forEach((pt, i) => { if (i === 0) frameCtx.moveTo(pt.x, pt.y); else frameCtx.lineTo(pt.x, pt.y); });
        frameCtx.closePath();
        frameCtx.stroke();
      }
      frameCtx.restore();

      // Translate handle (center) and rotate+scale handle (far corner).
      frameCtx.fillStyle = '#7fc7bc';
      frameCtx.beginPath(); frameCtx.arc(center.x, center.y, FRAME_HANDLE_RADIUS, 0, Math.PI * 2); frameCtx.fill();
      frameCtx.fillStyle = '#e8b34a';
      frameCtx.beginPath(); frameCtx.arc(p11.x, p11.y, FRAME_HANDLE_RADIUS, 0, Math.PI * 2); frameCtx.fill();

      frameReadout.textContent = `${shape.label} · ${scale.toFixed(2)}× · ${Math.round((Number(cfg.frameRotationDeg) || 0))}°`;
    }

    function frameCanvasPoint(evt) {
      const rect = frameCanvas.getBoundingClientRect();
      return {
        x: ((evt.clientX - rect.left) / rect.width) * SKETCH_CANVAS_SIZE,
        y: ((evt.clientY - rect.top) / rect.height) * SKETCH_CANVAS_SIZE,
      };
    }

    frameCanvas.addEventListener('pointerdown', evt => {
      evt.preventDefault();
      const pt = frameCanvasPoint(evt);
      const center = frameCenterScreen();
      const { u, v } = currentBasis();
      const scale = Math.max(0.05, Number(cfg.frameScale) || 1);
      const rad = ((Number(cfg.frameRotationDeg) || 0) * Math.PI) / 180;
      const baseCorner = { x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 }; // Unrotated, unscaled — the reference the corner handle's drag is measured against.
      const cornerLocal = rotatePoint(baseCorner.x * scale, baseCorner.y * scale, rad);
      const cornerScreen = { x: center.x + cornerLocal.x, y: center.y + cornerLocal.y };
      const distTo = p => Math.hypot(pt.x - p.x, pt.y - p.y);
      try { frameCanvas.setPointerCapture?.(evt.pointerId); } catch { /* not every pointer sequence supports capture */ }
      if (distTo(cornerScreen) <= FRAME_HANDLE_RADIUS * 2.2) {
        frameDrag = { mode: 'transform', center, baseCorner };
      } else {
        frameDrag = { mode: 'translate', startPt: pt, startFrameX: Number(cfg.frameX) || 0, startFrameY: Number(cfg.frameY) || 0 };
      }
    });
    frameCanvas.addEventListener('pointermove', evt => {
      if (!frameDrag) return;
      evt.preventDefault();
      const pt = frameCanvasPoint(evt);
      loadedLibraryId = null;
      if (frameDrag.mode === 'translate') {
        cfg.frameX = frameDrag.startFrameX + (pt.x - frameDrag.startPt.x);
        cfg.frameY = frameDrag.startFrameY + (pt.y - frameDrag.startPt.y);
      } else {
        const vec = { x: pt.x - frameDrag.center.x, y: pt.y - frameDrag.center.y };
        const baseAngle = Math.atan2(frameDrag.baseCorner.y, frameDrag.baseCorner.x);
        const baseLen = Math.hypot(frameDrag.baseCorner.x, frameDrag.baseCorner.y) || 1;
        const pointerAngle = Math.atan2(vec.y, vec.x);
        cfg.frameRotationDeg = Math.round(((pointerAngle - baseAngle) * 180) / Math.PI);
        cfg.frameScale = clamp(Math.hypot(vec.x, vec.y) / baseLen, 0.1, 6);
      }
      drawFrameCanvas();
      schedulePreview();
    });
    function endFrameDrag() { frameDrag = null; }
    frameCanvas.addEventListener('pointerup', endFrameDrag);
    frameCanvas.addEventListener('pointerleave', endFrameDrag);
    frameCanvas.addEventListener('pointercancel', endFrameDrag);

    overlay.querySelectorAll('.pa-shapeToggle').forEach(btn => {
      btn.addEventListener('click', () => {
        cfg.frameShape = btn.dataset.shape;
        loadedLibraryId = null;
        overlay.querySelectorAll('.pa-shapeToggle').forEach(b => b.classList.toggle('active', b === btn));
        drawFrameCanvas();
        schedulePreview();
      });
    });

    // ── Sketch undo/redo ─────────────────────────────────────────────────
    function snapshotSketch() {
      try { return sketchCtx.getImageData(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE); } catch { return null; }
    }
    function restoreSketch(imageData) {
      if (!imageData) return;
      sketchCtx.clearRect(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE);
      sketchCtx.putImageData(imageData, 0, 0);
    }
    function updateUndoRedoButtons() {
      undoBtn.disabled = !undoStack.length;
      redoBtn.disabled = !redoStack.length;
    }
    // Called right BEFORE any sketch-mutating action so that action can be
    // undone back to this exact state.
    function pushUndo() {
      const snap = snapshotSketch();
      if (!snap) return;
      undoStack.push(snap);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack = [];
      updateUndoRedoButtons();
    }
    undoBtn.addEventListener('click', () => {
      if (!undoStack.length) return;
      const current = snapshotSketch();
      const previous = undoStack.pop();
      if (current) redoStack.push(current);
      restoreSketch(previous);
      loadedLibraryId = null;
      updateUndoRedoButtons();
      drawFrameCanvas();
      schedulePreview();
    });
    redoBtn.addEventListener('click', () => {
      if (!redoStack.length) return;
      const current = snapshotSketch();
      const next = redoStack.pop();
      if (current) undoStack.push(current);
      restoreSketch(next);
      loadedLibraryId = null;
      updateUndoRedoButtons();
      drawFrameCanvas();
      schedulePreview();
    });

    // ── Motif sketch input ──────────────────────────────────────────────
    // The brush's own input coordinate is confined to the marked inner
    // SKETCH_SIZE square (see .pa-sketchBoundary) — the rendered stroke
    // still bleeds up to SKETCH_PAD px beyond that into the margin, since
    // the canvas itself is SKETCH_CANVAS_SIZE and nothing clips it there.
    // The eraser isn't confined, so any ink that bled into the margin is
    // still reachable to clean up.
    function sketchPoint(evt) {
      const rect = sketchCanvas.getBoundingClientRect();
      let x = ((evt.clientX - rect.left) / rect.width) * SKETCH_CANVAS_SIZE;
      let y = ((evt.clientY - rect.top) / rect.height) * SKETCH_CANVAS_SIZE;
      if (brushMode !== 'eraser') {
        x = clamp(x, SKETCH_PAD, SKETCH_PAD + SKETCH_SIZE);
        y = clamp(y, SKETCH_PAD, SKETCH_PAD + SKETCH_SIZE);
      }
      return { x, y };
    }
    function strokeTo(pt) {
      sketchCtx.globalCompositeOperation = brushMode === 'eraser' ? 'destination-out' : 'source-over';
      sketchCtx.strokeStyle = '#000';
      sketchCtx.fillStyle = '#000';
      sketchCtx.lineWidth = brushSize;
      sketchCtx.beginPath();
      if (lastPt) {
        sketchCtx.moveTo(lastPt.x, lastPt.y);
        sketchCtx.lineTo(pt.x, pt.y);
        sketchCtx.stroke();
      } else {
        sketchCtx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2);
        sketchCtx.fill();
      }
      lastPt = pt;
    }
    sketchCanvas.addEventListener('pointerdown', evt => {
      evt.preventDefault();
      pushUndo();
      drawing = true;
      lastPt = null;
      try { sketchCanvas.setPointerCapture?.(evt.pointerId); } catch { /* not every pointer sequence supports capture */ }
      strokeTo(sketchPoint(evt));
    });
    sketchCanvas.addEventListener('pointermove', evt => {
      if (!drawing) return;
      evt.preventDefault();
      strokeTo(sketchPoint(evt));
      drawFrameCanvas();
    });
    function endStroke() {
      if (!drawing) return;
      drawing = false;
      lastPt = null;
      loadedLibraryId = null;
      drawFrameCanvas();
      schedulePreview();
    }
    sketchCanvas.addEventListener('pointerup', endStroke);
    sketchCanvas.addEventListener('pointerleave', endStroke);
    sketchCanvas.addEventListener('pointercancel', endStroke);

    // Shared by the initial load below and by "Load" in the Library card —
    // NOT used by "Reset placement", which deliberately leaves whatever is
    // currently drawn on the sketchpad untouched.
    function drawMotifImageIntoSketch(dataUrl) {
      pushUndo();
      sketchCtx.clearRect(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE);
      if (!dataUrl) { drawFrameCanvas(); schedulePreview(); return; }
      const img = new Image();
      img.onload = () => {
        sketchCtx.clearRect(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE);
        // Drawn at native size, centered on the canvas — a legacy SKETCH_SIZE
        // (192x192) motif from before this margin existed lands centered
        // inside the dashed boundary exactly where it always was, rather than
        // being stretched to fill the new, larger canvas.
        const w = img.naturalWidth || img.width || SKETCH_SIZE, h = img.naturalHeight || img.height || SKETCH_SIZE;
        sketchCtx.drawImage(img, (SKETCH_CANVAS_SIZE - w) / 2, (SKETCH_CANVAS_SIZE - h) / 2, w, h);
        drawFrameCanvas();
        schedulePreview();
      };
      img.src = dataUrl;
    }
    function syncInputsFromCfg() {
      overlay.querySelectorAll('.pa-in[data-field]').forEach(input => {
        const field = input.dataset.field;
        if (input.type === 'checkbox') input.checked = cfg[field];
        else input.value = cfg[field];
      });
      overlay.querySelectorAll('.pa-shapeToggle').forEach(btn => btn.classList.toggle('active', btn.dataset.shape === cfg.frameShape));
    }
    // Replaces the motif AND every placement setting with a previously
    // saved/unlocked library entry (or, at open time, this session's own
    // initialPattern) — the same merge-onto-defaults cfg already got built
    // with, so a library pattern authored before some newer field existed
    // still loads sane values for it.
    function applyPatternData(data) {
      Object.assign(cfg, PATTERN_DEFAULTS, legacyFrameFields(data) || {});
      syncInputsFromCfg();
      updateValLabels();
      drawMotifImageIntoSketch(cfg.motifDataUrl);
    }

    if (cfg.motifDataUrl) drawMotifImageIntoSketch(cfg.motifDataUrl);
    else drawFrameCanvas();
    updateUndoRedoButtons();

    overlay.querySelectorAll('.pa-toolToggle').forEach(btn => {
      btn.addEventListener('click', () => {
        brushMode = btn.dataset.tool;
        overlay.querySelectorAll('.pa-toolToggle').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
    overlay.querySelector('.pa-brushSize').addEventListener('input', evt => {
      brushSize = Number(evt.target.value) || 1;
      overlay.querySelector('.pa-brushSizeVal').textContent = `${brushSize}px`;
    });
    overlay.querySelector('[data-act="clearSketch"]').addEventListener('click', () => {
      pushUndo();
      sketchCtx.clearRect(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE);
      loadedLibraryId = null;
      drawFrameCanvas();
      schedulePreview();
    });

    overlay.querySelectorAll('.pa-in[data-field]').forEach(input => {
      input.addEventListener('input', () => {
        const field = input.dataset.field;
        if (input.type === 'checkbox') cfg[field] = input.checked;
        else if (input.tagName === 'SELECT') cfg[field] = input.value;
        else cfg[field] = Number(input.value);
        loadedLibraryId = null;
        updateValLabels();
        drawFrameCanvas();
        schedulePreview();
      });
    });

    // Finds the rotation angle (0-175°, checked every 5°) that makes the
    // ink's own axis-aligned bounding box smallest — a "rotating calipers"
    // tight fit, in spirit the same thing the old auto-fit triangle search
    // did automatically (find the orientation the ink sits most snugly at)
    // without resurrecting that convex-hull/minimum-triangle machinery.
    // Applied as motifRotationDeg (not frameRotationDeg) because that's the
    // field the bbox measurement itself is actually taken *after* applying
    // (see buildPatternMask's prepare()) — the tightest bbox at this angle
    // becomes the frame's own reference size once frameScale resets to 1.
    overlay.querySelector('[data-act="autoDetect"]').addEventListener('click', () => {
      let imageData;
      try { imageData = sketchCtx.getImageData(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE); } catch { return; }
      const { data, width, height } = imageData;
      const pts = [];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 16) pts.push({ x, y });
      if (!pts.length) return;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      let best = null;
      for (let deg = 0; deg < 180; deg += 5) {
        const rad = (deg * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of pts) {
          const dx = p.x - cx, dy = p.y - cy;
          const rx = dx * c - dy * s, ry = dx * s + dy * c; // Same forward rotation ctx.rotate(rad) applies when drawing.
          if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
          if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
        }
        const area = (maxX - minX) * (maxY - minY);
        if (!best || area < best.area) best = { deg, area };
      }
      cfg.motifRotationDeg = best.deg;
      cfg.frameShape = PATTERN_DEFAULTS.frameShape;
      cfg.frameX = PATTERN_DEFAULTS.frameX;
      cfg.frameY = PATTERN_DEFAULTS.frameY;
      cfg.frameRotationDeg = PATTERN_DEFAULTS.frameRotationDeg;
      cfg.frameScale = PATTERN_DEFAULTS.frameScale;
      loadedLibraryId = null;
      syncInputsFromCfg();
      updateValLabels();
      drawFrameCanvas();
      schedulePreview();
    });

    overlay.querySelector('[data-act="resetPlacement"]').addEventListener('click', () => {
      Object.assign(cfg, {
        motifScale: PATTERN_DEFAULTS.motifScale,
        motifRotationDeg: PATTERN_DEFAULTS.motifRotationDeg,
        frameShape: PATTERN_DEFAULTS.frameShape,
        frameX: PATTERN_DEFAULTS.frameX,
        frameY: PATTERN_DEFAULTS.frameY,
        frameRotationDeg: PATTERN_DEFAULTS.frameRotationDeg,
        frameScale: PATTERN_DEFAULTS.frameScale,
      });
      loadedLibraryId = null;
      syncInputsFromCfg();
      updateValLabels();
      drawFrameCanvas();
      schedulePreview();
    });

    // ── Library (only wired up when the caller passes options.library —
    // see pattern-library.js and metal-craft-shop.js) ───────────────────
    function renderLibraryList() {
      const container = overlay.querySelector('.pa-libraryList');
      if (!container || !options.library) return;
      const entries = options.library.list?.() || [];
      container.innerHTML = '';
      if (!entries.length) {
        container.innerHTML = '<p class="pa-hint" style="margin:0">No saved or unlocked patterns yet.</p>';
        return;
      }
      entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'pa-libraryRow';
        row.innerHTML = `
          <span class="pa-libLabel">${escapeHtml(entry.label)}${entry.source === 'catalog' ? ' 🔓' : ''}</span>
          <button type="button" class="pa-btn secondary" data-lib-load="${escapeHtml(entry.id)}">Load</button>
          ${entry.removable ? `<button type="button" class="pa-btn secondary" data-lib-remove="${escapeHtml(entry.id)}">✕</button>` : ''}
        `;
        container.appendChild(row);
      });
      container.querySelectorAll('[data-lib-load]').forEach(btn => {
        btn.addEventListener('click', () => {
          const data = options.library.get?.(btn.dataset.libLoad);
          if (data) { applyPatternData(data); loadedLibraryId = btn.dataset.libLoad; }
        });
      });
      container.querySelectorAll('[data-lib-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          options.library.remove?.(btn.dataset.libRemove);
          renderLibraryList();
        });
      });
    }
    if (options.library) {
      renderLibraryList();
      overlay.querySelector('[data-act="saveToLibrary"]')?.addEventListener('click', () => {
        const data = currentPatternData();
        if (!data.motifDataUrl) { previewStatus.textContent = 'Draw a motif before saving to the library.'; return; }
        const nameInput = overlay.querySelector('.pa-libraryName');
        const label = nameInput.value.trim() || 'Untitled pattern';
        options.library.save?.(label, data);
        nameInput.value = '';
        renderLibraryList();
      });
    }

    function close() {
      if (closed) return;
      closed = true;
      window.clearTimeout(previewTimer);
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(evt) {
      if (evt.key === 'Escape') { options.onCancel?.(); close(); }
    }
    document.addEventListener('keydown', onKeydown);

    overlay.querySelector('.pa-close').addEventListener('click', () => { options.onCancel?.(); close(); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => { options.onCancel?.(); close(); });
    overlay.addEventListener('click', evt => { if (evt.target === overlay) { options.onCancel?.(); close(); } });

    overlay.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const data = currentPatternData();
      if (!data.motifDataUrl) { previewStatus.textContent = 'Draw a motif before saving.'; return; }
      if (typeof options.onSave !== 'function') { close(); return; }
      const outgoing = loadedLibraryId ? data : await offloadMotif(data);
      const result = await options.onSave(outgoing, loadedLibraryId);
      if (result !== false) close();
    });

    schedulePreview();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  window.PatternAuthoring = { openEditor };
})();

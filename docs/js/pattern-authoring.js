// Pattern authoring — a small full-screen modal for hand-drawing a motif,
// then placing/tiling it across some other system's surface. Deliberately
// knows nothing about verdigris, metal, dye, or clothing: it just produces a
// JSON placement definition (see PATTERN_DEFAULTS below) plus a black-on-
// transparent motif image, and hands both back through onSave. The caller
// supplies a renderPreview(patternData) hook that turns that definition into
// an actual preview image on whatever surface it owns — that's the only
// coupling point, so the same editor works for the smithy's authored
// verdigris-removal patterns today (see metal-craft-shop.js) and for a
// future weaving/dye system without any change here.
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
  // unmarked dead zone.
  const BRUSH_MAX_SIZE = 35;
  const SKETCH_PAD = Math.ceil(BRUSH_MAX_SIZE / 2) + 1;
  const SKETCH_CANVAS_SIZE = SKETCH_SIZE + SKETCH_PAD * 2;

  const PATTERN_DEFAULTS = Object.freeze({
    motifScale: 1, // size of each individual stamped motif copy, relative to its own opaque-ink bounds
    patternScale: 1, // zooms the whole tiled field (repeat geometry + stamp size together), distinct from motifScale
    motifRotationDeg: 0,
    patternRotationDeg: 0, // whole-pattern (tiled field) rotation, distinct from motifRotationDeg
    translateX: 0,
    translateY: 0,
    repeatMode: 'triangle', // 'triangle' (tight fit, alternating 180°, no gaps) | 'grid' (simple rectangular repeat)
    // Repeat geometry is always clipped to the motif's own opaque ink at
    // 1x motif scale, not the full sketch canvas — these are just the
    // clearance around that tight fit. Triangle padding is a small buffer
    // (see tool-metal-recolor.js's fitGuaranteedTriangle); grid spacing is
    // an ordinary gap between copies. motifScale > 1x deliberately
    // overflows into neighboring cells rather than growing either one.
    trianglePadding: 0.5,
    gridSpacing: 6,
    tiling: true,
    invert: false, // swap which side of the motif stays vs. clears (see tool-metal-recolor.js)
    // Erodes the placed/tiled ink mask inward by this many px before the
    // outline (if any) is drawn around it — see buildPatternMask/
    // recolorAndOxidize's erodeMask call. 0 = no thinning.
    motifThinPx: 0,
  });

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .pa-overlay{position:fixed;inset:0;z-index:9500;background:rgba(6,10,12,.72);display:flex;align-items:center;justify-content:center;padding:14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      .pa-modal{width:min(920px,100%);max-height:100%;overflow:auto;background:linear-gradient(180deg,#121a20,#0f161c);border:1px solid #294039;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);color:#eaf5f3}
      .pa-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
      .pa-head h2{margin:0;font-size:16px}
      .pa-close{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#eaf5f3;border-radius:10px;width:30px;height:30px;cursor:pointer;font-size:15px;line-height:1}
      .pa-body{display:grid;grid-template-columns:minmax(200px,260px) 1fr;gap:12px;padding:12px 14px;align-items:start}
      @media(max-width:680px){.pa-body{grid-template-columns:1fr}.pa-col:last-child{position:static;max-height:none}}
      .pa-col{min-width:0}
      .pa-col:last-child{position:sticky;top:12px;align-self:start;max-height:calc(100vh - 24px);overflow:auto}
      .pa-card{background:rgba(255,255,255,.04);border:1px solid #294039;border-radius:12px;padding:8px 9px;margin-bottom:8px}
      .pa-card h3{margin:0 0 5px;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#cfe9e4}
      .pa-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
      .pa-field{margin-bottom:5px}
      .pa-field label{display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:#9cb3ae;margin-bottom:2px}
      .pa-field input[type=range]{width:100%;display:block;height:16px}
      .pa-check{display:flex;align-items:center;gap:6px;color:#9cb3ae;font-size:11px;font-weight:700;margin-bottom:4px}
      .pa-check input{accent-color:#7fc7bc}
      .pa-btn{border:1px solid rgba(127,199,188,.38);background:rgba(127,199,188,.13);color:#eaf5f3;border-radius:10px;padding:6px 10px;font-weight:800;cursor:pointer;font-size:12px}
      .pa-btn.secondary{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.055)}
      .pa-btn.good{border-color:rgba(129,214,154,.42);background:rgba(129,214,154,.14)}
      .pa-sketchWrap{position:relative;width:100%;max-width:${SKETCH_CANVAS_SIZE}px;aspect-ratio:1/1;margin:0 auto;border-radius:12px;border:1px solid rgba(255,255,255,.12);background-image:linear-gradient(45deg,rgba(255,255,255,.06) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.06) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.06) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.06) 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
      .pa-sketchWrap canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:crosshair;image-rendering:pixelated}
      .pa-sketchBoundary{position:absolute;inset:calc(${SKETCH_PAD} / ${SKETCH_CANVAS_SIZE} * 100%);border:1px dashed rgba(255,255,255,.45);border-radius:2px;pointer-events:none}
      .pa-previewWrap{display:grid;place-items:center;min-height:200px;border-radius:13px;border:1px solid #294039;background:#0a0e11;background-image:linear-gradient(45deg,rgba(255,255,255,.045) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.045) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.045) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.045) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
      .pa-previewWrap canvas,.pa-previewWrap img{position:static;inset:auto;width:auto;height:auto;max-width:100%;max-height:min(340px,50vh);image-rendering:pixelated}
      .pa-hint{font-size:10px;line-height:1.35;color:#9cb3ae;margin:0 0 6px}
      .pa-libraryList{display:flex;flex-direction:column;gap:5px;max-height:130px;overflow:auto;margin-bottom:2px}
      .pa-libraryRow{display:flex;align-items:center;gap:5px}
      .pa-libraryRow .pa-libLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#eaf5f3}
      .pa-libraryRow .pa-btn{padding:4px 8px;font-size:10px}
      .pa-libraryName{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#eaf5f3;padding:5px 7px;font-size:11px}
      .pa-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.1)}
      .pa-toolToggle.active{outline:2px solid #7fc7bc;background:rgba(127,199,188,.18)!important}
    `;
    document.head.appendChild(style);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function openEditor(options = {}) {
    injectStyles();
    const cfg = { ...PATTERN_DEFAULTS, ...(options.initialPattern || {}) };
    let closed = false;
    let brushMode = 'brush'; // 'brush' | 'eraser'
    let brushSize = 30;
    let drawing = false;
    let lastPt = null;
    let previewToken = 0;
    // Tracks whether the pattern currently loaded is an UNMODIFIED library
    // entry (options.initialPatternLibraryId at open, or a "Load" click) —
    // cleared by any edit (a stroke, a placement change, reset, clear).
    // Passed as onSave's 2nd argument so a caller can store just the
    // reference instead of a full duplicate copy of the pattern; see
    // clothing-weaving-system.js/metal-craft-shop.js.
    let loadedLibraryId = options.initialPatternLibraryId || null;

    const overlay = document.createElement('div');
    overlay.className = 'pa-overlay';
    overlay.innerHTML = `
      <div class="pa-modal" role="dialog" aria-modal="true">
        <div class="pa-head"><h2>${escapeHtml(options.title || 'Author a pattern')}</h2><button type="button" class="pa-close" aria-label="Close">✕</button></div>
        <div class="pa-body">
          <div class="pa-col">
            <div class="pa-card">
              <h3>Motif</h3>
              <p class="pa-hint">${escapeHtml(options.motifHint || 'Draw a solid black motif. This is the shape that gets placed and repeated.')}</p>
              <div class="pa-sketchWrap"><canvas class="pa-sketch" width="${SKETCH_CANVAS_SIZE}" height="${SKETCH_CANVAS_SIZE}"></canvas><div class="pa-sketchBoundary"></div></div>
              <p class="pa-hint" style="margin-top:5px">The dashed line marks where the brush's own input is confined — a stroke aimed right at that line still paints its full width, bleeding into the margin outside it instead of being clipped in half. The eraser isn't confined to it, so any stray bleed is still reachable.</p>
              <div class="pa-row" style="margin-top:9px">
                <button type="button" class="pa-btn secondary pa-toolToggle active" data-tool="brush">Brush</button>
                <button type="button" class="pa-btn secondary pa-toolToggle" data-tool="eraser">Eraser</button>
                <button type="button" class="pa-btn secondary" data-act="clearSketch">Clear</button>
              </div>
              <div class="pa-field"><label><span>Brush size</span><span class="pa-brushSizeVal">${brushSize}px</span></label><input type="range" class="pa-brushSize" min="25" max="35" step="1" value="${brushSize}"></div>
            </div>
            <div class="pa-card">
              <h3>Placement</h3>
              <div class="pa-field"><label><span>Motif scale</span><span class="pa-val" data-for="motifScale"></span></label><input type="range" class="pa-in" data-field="motifScale" min="0.1" max="3" step="0.01" value="${cfg.motifScale}"></div>
              <div class="pa-field"><label><span>Pattern scale</span><span class="pa-val" data-for="patternScale"></span></label><input type="range" class="pa-in" data-field="patternScale" min="0.1" max="3" step="0.01" value="${cfg.patternScale}"></div>
              <div class="pa-field"><label><span>Motif rotation</span><span class="pa-val" data-for="motifRotationDeg"></span></label><input type="range" class="pa-in" data-field="motifRotationDeg" min="-180" max="180" step="1" value="${cfg.motifRotationDeg}"></div>
              <div class="pa-field"><label><span>Whole-pattern rotation</span><span class="pa-val" data-for="patternRotationDeg"></span></label><input type="range" class="pa-in" data-field="patternRotationDeg" min="-180" max="180" step="1" value="${cfg.patternRotationDeg}"></div>
              <div class="pa-field"><label><span>Translate X</span><span class="pa-val" data-for="translateX"></span></label><input type="range" class="pa-in" data-field="translateX" min="-150" max="150" step="1" value="${cfg.translateX}"></div>
              <div class="pa-field"><label><span>Translate Y</span><span class="pa-val" data-for="translateY"></span></label><input type="range" class="pa-in" data-field="translateY" min="-150" max="150" step="1" value="${cfg.translateY}"></div>
              <div class="pa-check"><input type="checkbox" class="pa-in" data-field="tiling" ${cfg.tiling ? 'checked' : ''}><label>Repeat (tile the motif)</label></div>
              <div class="pa-field" data-show-for="tiling"><label><span>Repeat geometry</span></label><select class="pa-in" data-field="repeatMode"><option value="triangle" ${cfg.repeatMode === 'triangle' ? 'selected' : ''}>Triangle (alternating 180°, no gaps)</option><option value="grid" ${cfg.repeatMode === 'grid' ? 'selected' : ''}>Grid</option></select></div>
              <div class="pa-field" data-show-for="triangle"><label><span>Triangle padding</span><span class="pa-val" data-for="trianglePadding"></span></label><input type="range" class="pa-in" data-field="trianglePadding" min="0" max="8" step="0.25" value="${cfg.trianglePadding}"></div>
              <div class="pa-field" data-show-for="grid"><label><span>Grid spacing</span><span class="pa-val" data-for="gridSpacing"></span></label><input type="range" class="pa-in" data-field="gridSpacing" min="0" max="40" step="1" value="${cfg.gridSpacing}"></div>
              <div class="pa-check"><input type="checkbox" class="pa-in" data-field="invert" ${cfg.invert ? 'checked' : ''}><label>Invert pattern</label></div>
              <div class="pa-field"><label><span>Motif thinning</span><span class="pa-val" data-for="motifThinPx"></span></label><input type="range" class="pa-in" data-field="motifThinPx" min="0" max="12" step="1" value="${cfg.motifThinPx}"></div>
              <p class="pa-hint">Erodes the placed ink inward from every edge before any outline is drawn around it — like magic-wand-selecting the transparent area with this many px of expansion, then deleting the selection.</p>
              <p class="pa-hint" data-show-for="triangle">Triangle mode fits a tight triangle around your motif's own ink and tiles it edge-to-edge, alternating 180°, so neighboring copies always meet with no gaps. Motif scale above 1× deliberately overflows into neighboring copies instead of growing the fit.</p>
              <p class="pa-hint" data-show-for="grid">Grid mode repeats the motif in a simple rectangular grid, spaced from its own tight ink bounds at 1× motif scale. Motif scale above 1× deliberately overlaps into neighboring cells instead of growing the grid.</p>
              <button type="button" class="pa-btn secondary" data-act="resetPlacement">Reset placement</button>
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
          <div class="pa-col">
            <div class="pa-card" style="height:100%">
              <h3>Preview</h3>
              <p class="pa-hint pa-previewStatus">Draw a motif to preview.</p>
              <div class="pa-previewWrap"><canvas class="pa-preview" width="1" height="1"></canvas></div>
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
    const previewCanvas = overlay.querySelector('.pa-preview');
    const previewCtx = previewCanvas.getContext('2d');
    const previewStatus = overlay.querySelector('.pa-previewStatus');

    function updateValLabels() {
      overlay.querySelectorAll('.pa-val').forEach(el => {
        const field = el.dataset.for;
        if (field === 'motifScale' || field === 'patternScale') el.textContent = `${Number(cfg[field]).toFixed(2)}×`;
        else if (field === 'trianglePadding' || field === 'gridSpacing' || field === 'motifThinPx') el.textContent = `${Number(cfg[field]).toFixed(field === 'motifThinPx' ? 0 : 2)}px`;
        else if (field === 'translateX' || field === 'translateY') el.textContent = `${cfg[field]}px`;
        else el.textContent = `${cfg[field]}°`;
      });
    }
    function updateFieldVisibility() {
      overlay.querySelectorAll('[data-show-for]').forEach(el => {
        const want = el.dataset.showFor;
        const visible = want === 'tiling' ? !!cfg.tiling : (!!cfg.tiling && cfg.repeatMode === want);
        el.hidden = !visible;
      });
    }
    updateValLabels();
    updateFieldVisibility();

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
        patternScale: Number(cfg.patternScale),
        motifRotationDeg: Number(cfg.motifRotationDeg),
        patternRotationDeg: Number(cfg.patternRotationDeg),
        translateX: Number(cfg.translateX),
        translateY: Number(cfg.translateY),
        repeatMode: cfg.repeatMode === 'grid' ? 'grid' : 'triangle',
        trianglePadding: Number(cfg.trianglePadding),
        gridSpacing: Number(cfg.gridSpacing),
        tiling: !!cfg.tiling,
        invert: !!cfg.invert,
        motifThinPx: Number(cfg.motifThinPx) || 0,
      };
    }

    let previewTimer = 0;
    function schedulePreview() {
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(runPreview, 160);
    }

    async function runPreview() {
      const data = currentPatternData();
      if (!data.motifDataUrl || typeof options.renderPreview !== 'function') {
        previewStatus.textContent = data.motifDataUrl ? 'Rendering preview…' : 'Draw a motif to preview.';
        return;
      }
      const token = ++previewToken;
      previewStatus.textContent = 'Rendering preview…';
      try {
        const rendered = await options.renderPreview(data);
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
      drawing = true;
      lastPt = null;
      try { sketchCanvas.setPointerCapture?.(evt.pointerId); } catch { /* not every pointer sequence supports capture */ }
      strokeTo(sketchPoint(evt));
    });
    sketchCanvas.addEventListener('pointermove', evt => {
      if (!drawing) return;
      evt.preventDefault();
      strokeTo(sketchPoint(evt));
    });
    function endStroke() {
      if (!drawing) return;
      drawing = false;
      lastPt = null;
      loadedLibraryId = null;
      schedulePreview();
    }
    sketchCanvas.addEventListener('pointerup', endStroke);
    sketchCanvas.addEventListener('pointerleave', endStroke);
    sketchCanvas.addEventListener('pointercancel', endStroke);

    // Shared by the initial load below and by "Load" in the Library card —
    // NOT used by "Reset placement", which deliberately leaves whatever is
    // currently drawn on the sketchpad untouched.
    function drawMotifImageIntoSketch(dataUrl) {
      sketchCtx.clearRect(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE);
      if (!dataUrl) { schedulePreview(); return; }
      const img = new Image();
      img.onload = () => {
        sketchCtx.clearRect(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE);
        // Drawn at native size, centered on the canvas — a legacy SKETCH_SIZE
        // (192x192) motif from before this margin existed lands centered
        // inside the dashed boundary exactly where it always was, rather than
        // being stretched to fill the new, larger canvas.
        const w = img.naturalWidth || img.width || SKETCH_SIZE, h = img.naturalHeight || img.height || SKETCH_SIZE;
        sketchCtx.drawImage(img, (SKETCH_CANVAS_SIZE - w) / 2, (SKETCH_CANVAS_SIZE - h) / 2, w, h);
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
    }
    // Replaces the motif AND every placement setting with a previously
    // saved/unlocked library entry (or, at open time, this session's own
    // initialPattern) — the same merge-onto-defaults cfg already got built
    // with, so a library pattern authored before some newer field existed
    // still loads sane values for it.
    function applyPatternData(data) {
      Object.assign(cfg, PATTERN_DEFAULTS, data || {});
      syncInputsFromCfg();
      updateValLabels();
      updateFieldVisibility();
      drawMotifImageIntoSketch(cfg.motifDataUrl);
    }

    if (cfg.motifDataUrl) drawMotifImageIntoSketch(cfg.motifDataUrl);

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
      sketchCtx.clearRect(0, 0, SKETCH_CANVAS_SIZE, SKETCH_CANVAS_SIZE);
      loadedLibraryId = null;
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
        updateFieldVisibility();
        schedulePreview();
      });
    });

    overlay.querySelector('[data-act="resetPlacement"]').addEventListener('click', () => {
      Object.assign(cfg, PATTERN_DEFAULTS);
      loadedLibraryId = null;
      syncInputsFromCfg();
      updateValLabels();
      updateFieldVisibility();
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
      const result = await options.onSave(data, loadedLibraryId);
      if (result !== false) close();
    });

    schedulePreview();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  window.PatternAuthoring = { openEditor };
})();

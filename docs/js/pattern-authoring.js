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

  const SKETCH_SIZE = 192; // motif working resolution, px

  const PATTERN_DEFAULTS = Object.freeze({
    scale: 0.5,
    motifRotationDeg: 0,
    patternRotationDeg: 0, // whole-pattern (tiled field) rotation, distinct from motifRotationDeg
    translateX: 0,
    translateY: 0,
    spacing: 6,
    tiling: true,
    alternate: false,
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
      .pa-body{display:grid;grid-template-columns:minmax(220px,280px) 1fr;gap:14px;padding:14px 16px}
      @media(max-width:680px){.pa-body{grid-template-columns:1fr}}
      .pa-col{min-width:0}
      .pa-card{background:rgba(255,255,255,.04);border:1px solid #294039;border-radius:13px;padding:11px;margin-bottom:12px}
      .pa-card h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.3px;color:#cfe9e4}
      .pa-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      .pa-field{margin-bottom:9px}
      .pa-field label{display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:#9cb3ae;margin-bottom:4px}
      .pa-field input[type=range]{width:100%}
      .pa-check{display:flex;align-items:center;gap:7px;color:#9cb3ae;font-size:12px;font-weight:700;margin-bottom:6px}
      .pa-check input{accent-color:#7fc7bc}
      .pa-btn{border:1px solid rgba(127,199,188,.38);background:rgba(127,199,188,.13);color:#eaf5f3;border-radius:11px;padding:8px 12px;font-weight:800;cursor:pointer}
      .pa-btn.secondary{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.055)}
      .pa-btn.good{border-color:rgba(129,214,154,.42);background:rgba(129,214,154,.14)}
      .pa-sketchWrap{display:grid;place-items:center;border-radius:12px;border:1px solid rgba(255,255,255,.12);background-image:linear-gradient(45deg,rgba(255,255,255,.06) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.06) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.06) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.06) 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
      .pa-sketchWrap canvas{position:static;inset:auto;display:block;width:100%;max-width:${SKETCH_SIZE}px;height:auto;aspect-ratio:1/1;touch-action:none;cursor:crosshair;image-rendering:pixelated}
      .pa-previewWrap{display:grid;place-items:center;min-height:260px;border-radius:13px;border:1px solid #294039;background:#0a0e11;background-image:linear-gradient(45deg,rgba(255,255,255,.045) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.045) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.045) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.045) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
      .pa-previewWrap canvas,.pa-previewWrap img{position:static;inset:auto;width:auto;height:auto;max-width:100%;max-height:340px;image-rendering:pixelated}
      .pa-hint{font-size:11px;line-height:1.4;color:#9cb3ae;margin:0 0 9px}
      .pa-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid rgba(255,255,255,.1)}
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
    let brushSize = 14;
    let drawing = false;
    let lastPt = null;
    let previewToken = 0;

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
              <div class="pa-sketchWrap"><canvas class="pa-sketch" width="${SKETCH_SIZE}" height="${SKETCH_SIZE}"></canvas></div>
              <div class="pa-row" style="margin-top:9px">
                <button type="button" class="pa-btn secondary pa-toolToggle active" data-tool="brush">Brush</button>
                <button type="button" class="pa-btn secondary pa-toolToggle" data-tool="eraser">Eraser</button>
                <button type="button" class="pa-btn secondary" data-act="clearSketch">Clear</button>
              </div>
              <div class="pa-field"><label><span>Brush size</span><span class="pa-brushSizeVal">${brushSize}px</span></label><input type="range" class="pa-brushSize" min="3" max="40" step="1" value="${brushSize}"></div>
            </div>
            <div class="pa-card">
              <h3>Placement</h3>
              <div class="pa-field"><label><span>Scale</span><span class="pa-val" data-for="scale"></span></label><input type="range" class="pa-in" data-field="scale" min="0.1" max="3" step="0.01" value="${cfg.scale}"></div>
              <div class="pa-field"><label><span>Motif rotation</span><span class="pa-val" data-for="motifRotationDeg"></span></label><input type="range" class="pa-in" data-field="motifRotationDeg" min="-180" max="180" step="1" value="${cfg.motifRotationDeg}"></div>
              <div class="pa-field"><label><span>Whole-pattern rotation</span><span class="pa-val" data-for="patternRotationDeg"></span></label><input type="range" class="pa-in" data-field="patternRotationDeg" min="-180" max="180" step="1" value="${cfg.patternRotationDeg}"></div>
              <div class="pa-field"><label><span>Translate X</span><span class="pa-val" data-for="translateX"></span></label><input type="range" class="pa-in" data-field="translateX" min="-150" max="150" step="1" value="${cfg.translateX}"></div>
              <div class="pa-field"><label><span>Translate Y</span><span class="pa-val" data-for="translateY"></span></label><input type="range" class="pa-in" data-field="translateY" min="-150" max="150" step="1" value="${cfg.translateY}"></div>
              <div class="pa-field"><label><span>Repeat spacing</span><span class="pa-val" data-for="spacing"></span></label><input type="range" class="pa-in" data-field="spacing" min="0" max="40" step="1" value="${cfg.spacing}"></div>
              <div class="pa-check"><input type="checkbox" class="pa-in" data-field="tiling" ${cfg.tiling ? 'checked' : ''}><label>Repeat (tile the motif)</label></div>
              <div class="pa-check"><input type="checkbox" class="pa-in" data-field="alternate" ${cfg.alternate ? 'checked' : ''}><label>Alternate copies 180°</label></div>
              <button type="button" class="pa-btn secondary" data-act="resetPlacement">Reset placement</button>
            </div>
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
        if (field === 'scale') el.textContent = `${Number(cfg.scale).toFixed(2)}×`;
        else if (field === 'spacing') el.textContent = `${cfg.spacing}px`;
        else if (field === 'translateX' || field === 'translateY') el.textContent = `${cfg[field]}px`;
        else el.textContent = `${cfg[field]}°`;
      });
    }
    updateValLabels();

    function hasMotifInk() {
      try {
        const data = sketchCtx.getImageData(0, 0, SKETCH_SIZE, SKETCH_SIZE).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 16) return true;
      } catch { /* ignore */ }
      return false;
    }

    function currentPatternData() {
      return {
        motifDataUrl: hasMotifInk() ? sketchCanvas.toDataURL('image/png') : null,
        scale: Number(cfg.scale),
        motifRotationDeg: Number(cfg.motifRotationDeg),
        patternRotationDeg: Number(cfg.patternRotationDeg),
        translateX: Number(cfg.translateX),
        translateY: Number(cfg.translateY),
        spacing: Number(cfg.spacing),
        tiling: !!cfg.tiling,
        alternate: !!cfg.alternate,
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
    function sketchPoint(evt) {
      const rect = sketchCanvas.getBoundingClientRect();
      const x = ((evt.clientX - rect.left) / rect.width) * SKETCH_SIZE;
      const y = ((evt.clientY - rect.top) / rect.height) * SKETCH_SIZE;
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
      schedulePreview();
    }
    sketchCanvas.addEventListener('pointerup', endStroke);
    sketchCanvas.addEventListener('pointerleave', endStroke);
    sketchCanvas.addEventListener('pointercancel', endStroke);

    if (cfg.motifDataUrl) {
      const img = new Image();
      img.onload = () => { sketchCtx.drawImage(img, 0, 0, SKETCH_SIZE, SKETCH_SIZE); schedulePreview(); };
      img.src = cfg.motifDataUrl;
    }

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
      sketchCtx.clearRect(0, 0, SKETCH_SIZE, SKETCH_SIZE);
      schedulePreview();
    });

    overlay.querySelectorAll('.pa-in[data-field]').forEach(input => {
      input.addEventListener('input', () => {
        const field = input.dataset.field;
        cfg[field] = input.type === 'checkbox' ? input.checked : Number(input.value);
        updateValLabels();
        schedulePreview();
      });
    });

    overlay.querySelector('[data-act="resetPlacement"]').addEventListener('click', () => {
      Object.assign(cfg, PATTERN_DEFAULTS);
      overlay.querySelectorAll('.pa-in[data-field]').forEach(input => {
        const field = input.dataset.field;
        if (input.type === 'checkbox') input.checked = cfg[field];
        else input.value = cfg[field];
      });
      updateValLabels();
      schedulePreview();
    });

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
      const result = await options.onSave(data);
      if (result !== false) close();
    });

    schedulePreview();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  window.PatternAuthoring = { openEditor };
})();

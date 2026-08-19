// Visual semantic-basis authoring inside the Attack Editor's Hand + Tool close-up.
//
// Weapon basis is marked directly on the raw sprite (haft butt -> head/top plus
// blade/working side). Hand basis maps semantic Fingers/Thumb/Palm to signed GLB
// local axes. This intentionally authors metadata without moving the hand/tool;
// grip calibration remains visually stable while the engine gains a canonical frame.
(function (global) {
  'use strict';

  if (!/\/tools\/attack-animation-editor\//.test(location.pathname)) return;
  if (global.HobunjiAttackEditorHandToolBasisAuthor) return;

  const profiles = global.HobunjiHandModelProfiles;
  const toolGrips = global.HobunjiHandToolGrips;
  const basisApi = global.HobunjiHandToolSemanticBasis;
  const closeup = global.HobunjiAttackEditorHandToolCloseup;
  if (!profiles || !toolGrips || !basisApi || !closeup) return;

  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('../../', location.href);
  const $ = id => document.getElementById(id);
  const TOOL_SPRITES = Object.freeze({
    hatchet: 'assets/toolsprites/axe_hatchet.png',
    pickshovel: 'assets/toolsprites/shovel_pickshovel.png',
    bronzehoe: 'assets/toolsprites/hoe_bronzehoe.png',
    hoe: 'assets/toolsprites/hoe_bronzehoe.png',
    fishingspear: 'assets/toolsprites/harpoon_fishingspear.png',
    fishingmace: 'assets/toolsprites/harpoon_fishingmace.png',
    bottle: 'assets/objectsprites/bottle_wine.png',
    crossbow: 'assets/toolsprites/ranged_crossbow.png',
    crossbowloaded: 'assets/toolsprites/ranged_crossbow_loaded.png',
    scatterbow: 'assets/toolsprites/ranged_scatterbow.png',
    scatterbowloaded: 'assets/toolsprites/ranged_scatterbow_loaded.png',
  });
  const MARKER_LABELS = Object.freeze({
    butt: 'Haft butt / axis start',
    head: 'Head / top',
    working: 'Blade / working side',
  });

  let panel = null;
  let canvas = null;
  let ctx = null;
  let spriteImage = null;
  let spriteSourceKey = '';
  let pendingMarker = null;
  let toolImageBox = null; // Canvas-space bounds of the contain-fitted raw PNG.
  let lastToolValue = '';
  let lastModelKey = '';

  function currentToolValue() { return String($('toolSpriteSelect')?.value || '').trim(); }
  function currentSpecies() { return String($('avatarSpecies')?.value || '').trim(); }
  function currentModelKey() {
    return String($('handProfileSelect')?.value || profiles.modelKeyForSpecies?.(currentSpecies()) || '').trim();
  }

  function normalizeRawToolKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function spritePathForCurrentTool() {
    const raw = normalizeRawToolKey(currentToolValue());
    const basisKey = basisApi.toolBasisKeyFor(currentToolValue());
    return TOOL_SPRITES[raw] || TOOL_SPRITES[basisKey] || null;
  }

  function axisOptions(selected) {
    const options = ['','+x','-x','+y','-y','+z','-z'];
    return options.map(value => {
      const label = value ? value.toUpperCase() : '— choose —';
      return `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`;
    }).join('');
  }

  function injectUi() {
    const overlay = $('handToolCloseupViewport');
    const opener = $('handToolCloseupToggle');
    if (!overlay || !opener || $('handToolBasisToggle')) return false;

    // The opener previously sat above the whole close-up layer (8 vs 7), making
    // the Full Avatar button physically unclickable. Put the close-up above it and
    // hide the opener for the duration of the close-up instead of stacking buttons.
    overlay.style.zIndex = '9';
    const syncOpenerVisibility = () => {
      const active = overlay.style.display !== 'none';
      opener.style.visibility = active ? 'hidden' : '';
      opener.style.pointerEvents = active ? 'none' : '';
    };
    opener.addEventListener('click', () => {
      opener.style.visibility = 'hidden';
      opener.style.pointerEvents = 'none';
    });
    $('handToolCloseupBack')?.addEventListener('click', () => setTimeout(syncOpenerVisibility, 0));
    new MutationObserver(syncOpenerVisibility).observe(overlay, { attributes: true, attributeFilter: ['style'] });
    syncOpenerVisibility();

    const controls = $('handToolCloseupBack')?.parentElement;
    if (!controls) return false;
    const toggle = document.createElement('button');
    toggle.id = 'handToolBasisToggle';
    toggle.className = 'secondary';
    toggle.style.cssText = 'font-size:12px;padding:6px 9px';
    toggle.textContent = '🧭 Basis';
    controls.appendChild(toggle);

    panel = document.createElement('div');
    panel.id = 'handToolBasisPanel';
    panel.style.cssText = [
      'position:absolute','right:10px','top:52px','z-index:6','display:none',
      'width:min(340px,calc(100% - 20px))','max-height:calc(100% - 64px)','overflow:auto',
      'padding:10px','border:1px solid rgba(255,255,255,.16)','border-radius:10px',
      'background:rgba(7,10,15,.94)','box-shadow:0 8px 24px rgba(0,0,0,.35)',
      'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace','color:#e8eef7',
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px">
        <b style="font-size:12px">Semantic Basis Authoring</b>
        <button id="handToolBasisClose" class="secondary" style="font-size:11px;padding:4px 7px">Close</button>
      </div>
      <div style="color:#aebbd0;margin-bottom:10px">These markers define what the model <i>means</i>. They do not move the grip or reset this camera.</div>

      <div style="padding:8px;border:1px solid rgba(255,255,255,.10);border-radius:8px;margin-bottom:9px">
        <b>Weapon / tool basis</b>
        <div style="color:#aebbd0;margin:4px 0 7px">Mark the raw PNG: <b>butt → head/top</b> defines semantic +Y; the third point defines the <b>blade/working +X</b> side. +Z is derived from X×Y.</div>
        <canvas id="handToolBasisCanvas" width="300" height="240" style="display:block;width:100%;height:auto;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:#0b0f14;touch-action:none"></canvas>
        <div class="row" style="gap:5px;flex-wrap:wrap;margin-top:7px">
          <button class="secondary handToolBasisMarker" data-marker="butt" style="font-size:10px;padding:5px 6px">1 Butt</button>
          <button class="secondary handToolBasisMarker" data-marker="head" style="font-size:10px;padding:5px 6px">2 Head/top</button>
          <button class="secondary handToolBasisMarker" data-marker="working" style="font-size:10px;padding:5px 6px">3 Blade/working</button>
          <button id="handToolBasisClearTool" class="warn" style="font-size:10px;padding:5px 6px">Clear</button>
        </div>
        <div id="handToolBasisToolStatus" style="margin-top:6px;color:#c7d4e7"></div>
      </div>

      <div style="padding:8px;border:1px solid rgba(255,255,255,.10);border-radius:8px;margin-bottom:9px">
        <b>Hand-model axes</b>
        <div style="color:#aebbd0;margin:4px 0 7px">Tell the engine which signed <b>GLB-local</b> axes point toward the fingers, thumb, and outward palm. These three must use different X/Y/Z axes.</div>
        <label style="display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center;margin:5px 0"><span>Fingers (+Y semantic)</span><select id="handToolBasisFingers"></select></label>
        <label style="display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center;margin:5px 0"><span>Thumb (+X semantic)</span><select id="handToolBasisThumb"></select></label>
        <label style="display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center;margin:5px 0"><span>Palm facing (+Z semantic)</span><select id="handToolBasisPalm"></select></label>
        <div class="row" style="gap:5px;flex-wrap:wrap;margin-top:7px">
          <button id="handToolBasisCommitHand" class="good" style="font-size:10px;padding:5px 6px">Apply hand axes</button>
          <button id="handToolBasisClearHand" class="warn" style="font-size:10px;padding:5px 6px">Clear</button>
        </div>
        <div id="handToolBasisHandStatus" style="margin-top:6px;color:#c7d4e7"></div>
      </div>

      <div class="row" style="gap:5px;flex-wrap:wrap">
        <button id="handToolBasisSave" class="good" style="font-size:10px;padding:5px 6px">💾 Save basis draft</button>
        <button id="handToolBasisCopy" class="secondary" style="font-size:10px;padding:5px 6px">Copy current basis JSON</button>
      </div>
      <div id="handToolBasisSaveStatus" style="margin-top:6px;color:#aebbd0"></div>
    `;
    overlay.appendChild(panel);

    canvas = $('handToolBasisCanvas');
    ctx = canvas?.getContext('2d') || null;
    toggle.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      refreshAll();
    });
    $('handToolBasisClose')?.addEventListener('click', () => { panel.style.display = 'none'; });

    for (const button of panel.querySelectorAll('.handToolBasisMarker')) {
      button.addEventListener('click', () => {
        pendingMarker = button.dataset.marker || null;
        refreshMarkerButtons();
        refreshToolStatus();
      });
    }
    canvas?.addEventListener('pointerdown', authorToolPoint);
    $('handToolBasisClearTool')?.addEventListener('click', () => {
      basisApi.clearToolBasis(currentToolValue());
      pendingMarker = null;
      refreshAll();
    });

    $('handToolBasisCommitHand')?.addEventListener('click', commitHandAxes);
    $('handToolBasisClearHand')?.addEventListener('click', () => {
      basisApi.clearHandBasisForModel(currentModelKey());
      refreshHandFields();
    });
    $('handToolBasisSave')?.addEventListener('click', saveDraft);
    $('handToolBasisCopy')?.addEventListener('click', copyCurrentBasis);

    $('toolSpriteSelect')?.addEventListener('change', refreshAll);
    $('avatarSpecies')?.addEventListener('change', refreshAll);
    $('handProfileSelect')?.addEventListener('change', refreshAll);
    profiles.subscribe?.(() => refreshHandFields());
    toolGrips.subscribe?.(() => {
      refreshToolStatus();
      drawToolPreview();
    });
    return true;
  }

  function refreshMarkerButtons() {
    if (!panel) return;
    for (const button of panel.querySelectorAll('.handToolBasisMarker')) {
      const active = button.dataset.marker === pendingMarker;
      button.style.outline = active ? '2px solid #fbbf24' : '';
      button.style.outlineOffset = active ? '1px' : '';
    }
  }

  function canvasPointToUv(event) {
    if (!canvas || !toolImageBox) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width);
    const y = (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height);
    if (x < toolImageBox.x || y < toolImageBox.y || x > toolImageBox.x + toolImageBox.w || y > toolImageBox.y + toolImageBox.h) return null;
    return {
      u: (x - toolImageBox.x) / Math.max(1, toolImageBox.w),
      v: (y - toolImageBox.y) / Math.max(1, toolImageBox.h),
    };
  }

  function authorToolPoint(event) {
    if (!pendingMarker) {
      $('handToolBasisToolStatus').textContent = 'Choose Butt, Head/top, or Blade/working first.';
      return;
    }
    const uv = canvasPointToUv(event);
    if (!uv) {
      $('handToolBasisToolStatus').textContent = 'Click directly on the weapon PNG.';
      return;
    }
    basisApi.setToolMarker(currentToolValue(), pendingMarker, uv);
    const order = ['butt','head','working'];
    const nextIndex = order.indexOf(pendingMarker) + 1;
    pendingMarker = nextIndex < order.length ? order[nextIndex] : null;
    refreshAll();
  }

  function loadSpriteIfNeeded() {
    const path = spritePathForCurrentTool();
    const sourceKey = `${currentToolValue()}|${path || ''}`;
    if (sourceKey === spriteSourceKey) return;
    spriteSourceKey = sourceKey;
    spriteImage = null;
    if (!path) {
      drawToolPreview();
      return;
    }
    const image = new Image();
    image.onload = () => {
      if (sourceKey !== spriteSourceKey) return;
      spriteImage = image;
      drawToolPreview();
    };
    image.onerror = () => {
      if (sourceKey !== spriteSourceKey) return;
      spriteImage = null;
      drawToolPreview();
    };
    image.src = new URL(path, docsBase).href;
  }

  function markerCanvasPoint(marker) {
    if (!marker || !toolImageBox) return null;
    return {
      x: toolImageBox.x + marker.u * toolImageBox.w,
      y: toolImageBox.y + marker.v * toolImageBox.h,
    };
  }

  function drawArrow(from, to, stroke, width) {
    if (!ctx || !from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const head = Math.min(11, Math.max(6, length * 0.18));
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - ux * head - uy * head * 0.45, to.y - uy * head + ux * head * 0.45);
    ctx.lineTo(to.x - ux * head + uy * head * 0.45, to.y - uy * head - ux * head * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawMarker(point, label, fill) {
    if (!ctx || !point) return;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = '#05070a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px ui-monospace,monospace';
    ctx.fillText(label, point.x + 9, point.y - 8);
    ctx.restore();
  }

  function drawToolPreview() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    toolImageBox = null;

    if (!spriteImage?.naturalWidth || !spriteImage?.naturalHeight) {
      ctx.fillStyle = '#8fa0b7';
      ctx.font = '12px ui-monospace,monospace';
      ctx.fillText(spriteSourceKey ? 'Loading / unavailable sprite…' : 'No sprite selected.', 12, 22);
      return;
    }

    const pad = 12;
    const scale = Math.min((canvas.width - pad * 2) / spriteImage.naturalWidth, (canvas.height - pad * 2) / spriteImage.naturalHeight);
    const w = spriteImage.naturalWidth * scale;
    const h = spriteImage.naturalHeight * scale;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;
    toolImageBox = { x, y, w, h };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spriteImage, x, y, w, h);

    const basis = basisApi.toolBasisFor(currentToolValue());
    const butt = markerCanvasPoint(basis.markers?.butt);
    const head = markerCanvasPoint(basis.markers?.head);
    const working = markerCanvasPoint(basis.markers?.working);
    if (butt && head) drawArrow(butt, head, '#60a5fa', 3);
    if (butt && working) drawArrow(butt, working, '#f87171', 2);
    drawMarker(butt, 'BUTT', '#60a5fa');
    drawMarker(head, 'HEAD/+Y', '#34d399');
    drawMarker(working, 'WORK/+X', '#f87171');
  }

  function refreshToolStatus() {
    const status = $('handToolBasisToolStatus');
    if (!status) return;
    const basis = basisApi.toolBasisFor(currentToolValue());
    const marked = ['butt','head','working'].filter(key => basis.markers?.[key]).map(key => MARKER_LABELS[key]);
    const pending = pendingMarker ? ` · CLICK FOR: ${MARKER_LABELS[pendingMarker]}` : '';
    if (basis.complete) {
      const x = basis.axes.x;
      const y = basis.axes.y;
      status.textContent = `${basis.key}: COMPLETE · +Y haft (${y.x.toFixed(3)},${y.y.toFixed(3)}) · +X working (${x.x.toFixed(3)},${x.y.toFixed(3)}) · +Z sign ${basis.axes.zSign > 0 ? '+' : '-'}${pending}`;
      status.style.color = '#86efac';
    } else {
      status.textContent = `${basis.key || 'tool'}: ${marked.length}/3 marked · ${basis.error || 'incomplete'}${pending}`;
      status.style.color = '#fbbf24';
    }
  }

  function refreshHandFields() {
    const fingers = $('handToolBasisFingers');
    const thumb = $('handToolBasisThumb');
    const palm = $('handToolBasisPalm');
    const status = $('handToolBasisHandStatus');
    if (!fingers || !thumb || !palm || !status) return;
    const modelKey = currentModelKey();
    const basis = basisApi.handBasisForModel(modelKey);
    fingers.innerHTML = axisOptions(basis.axes?.fingers || '');
    thumb.innerHTML = axisOptions(basis.axes?.thumb || '');
    palm.innerHTML = axisOptions(basis.axes?.palm || '');
    if (basis.valid) {
      status.textContent = `${modelKey}: COMPLETE · Fingers ${basis.axes.fingers.toUpperCase()} · Thumb ${basis.axes.thumb.toUpperCase()} · Palm ${basis.axes.palm.toUpperCase()} · ${basis.handedness}`;
      status.style.color = '#86efac';
    } else {
      status.textContent = `${modelKey || 'hand model'}: ${basis.error || 'Axes not authored yet.'}`;
      status.style.color = '#fbbf24';
    }
  }

  function commitHandAxes() {
    const raw = {
      fingers: $('handToolBasisFingers')?.value || '',
      thumb: $('handToolBasisThumb')?.value || '',
      palm: $('handToolBasisPalm')?.value || '',
    };
    const result = basisApi.setHandAxesForModel(currentModelKey(), raw);
    const status = $('handToolBasisHandStatus');
    if (!result?.valid) {
      if (status) {
        status.textContent = result?.error || 'Invalid hand axes.';
        status.style.color = '#fb7185';
      }
      return;
    }
    refreshHandFields();
  }

  function saveDraft() {
    const status = $('handToolBasisSaveStatus');
    try {
      profiles.saveLocal?.();
      toolGrips.saveLocal?.();
      if (status) {
        status.textContent = 'Saved hand-model and tool-basis drafts locally.';
        status.style.color = '#86efac';
      }
    } catch (error) {
      if (status) {
        status.textContent = `Save failed: ${error?.message || error}`;
        status.style.color = '#fb7185';
      }
    }
  }

  async function copyCurrentBasis() {
    const status = $('handToolBasisSaveStatus');
    const payload = {
      tool: basisApi.toolBasisFor(currentToolValue()),
      hand: basisApi.handBasisForModel(currentModelKey()),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      if (status) {
        status.textContent = 'Copied current semantic basis JSON.';
        status.style.color = '#86efac';
      }
    } catch (error) {
      if (status) {
        status.textContent = `Copy failed: ${error?.message || error}`;
        status.style.color = '#fb7185';
      }
    }
  }

  function refreshAll() {
    if (!panel) return;
    const toolValue = currentToolValue();
    const modelKey = currentModelKey();
    if (toolValue !== lastToolValue) {
      lastToolValue = toolValue;
      pendingMarker = null;
      spriteSourceKey = '';
    }
    if (modelKey !== lastModelKey) lastModelKey = modelKey;
    loadSpriteIfNeeded();
    refreshMarkerButtons();
    refreshToolStatus();
    refreshHandFields();
    drawToolPreview();
  }

  function boot() {
    if (injectUi()) {
      refreshAll();
      global.HobunjiAttackEditorHandToolBasisAuthor = Object.freeze({
        refresh: refreshAll,
        getDebug() {
          return {
            tool: basisApi.toolBasisFor(currentToolValue()),
            hand: basisApi.handBasisForModel(currentModelKey()),
            pendingMarker,
            panelVisible: panel?.style.display !== 'none',
            closeupLayerZ: Number($('handToolCloseupViewport')?.style.zIndex) || null,
            openerHidden: $('handToolCloseupToggle')?.style.visibility === 'hidden',
          };
        },
      });
      return;
    }
    global.requestAnimationFrame(boot);
  }

  boot();
})(window);

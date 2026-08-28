(() => {
  'use strict';

  const ANALYSIS_PANEL_ID = 'animalVoiceAnalysisPanel';
  const CLIP_CALL_PANEL_ID = 'animalVoiceCallClipPanel';
  const CALL_KINDS = Object.freeze(['chatter', 'warning', 'growl']);
  const CALL_LABELS = Object.freeze({ chatter: 'Chatter', warning: 'Warning', growl: 'Growl' });
  const MAX_AUTO_SHIFT_ST = 6;
  const resultsBySpecies = new Map();
  let installed = false;

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function hz(value) { return Number.isFinite(value) ? `${Math.round(value)} Hz` : '—'; }
  function percent(value) { return Number.isFinite(value) ? `${Math.round(value)}%` : '—'; }
  function signed(value, digits = 2) {
    if (!Number.isFinite(value)) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
  }
  function weightedGeometricMean(rows) {
    let weightedLog = 0, weightTotal = 0;
    for (const row of rows) {
      if (!row.result?.pitchReliable || !(row.result.f0MedianHz > 0)) continue;
      const weight = Math.max(0.05, row.result.voicedPercent / 100 * Math.max(0.1, row.result.pitchConfidence));
      weightedLog += Math.log(row.result.f0MedianHz) * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? Math.exp(weightedLog / weightTotal) : null;
  }
  function clipName(url) {
    return window.AnimalVoiceIndependentPlayback?.clipKey?.(url)
      || String(url || '').split('/').pop().toLowerCase();
  }
  function currentOffset(id, url) {
    const key = clipName(url);
    const common = state.config?.animalVocalizations?.default?.clipPitchSemitones;
    const own = state.config?.animalVocalizations?.[id]?.clipPitchSemitones;
    return finite(own?.[key] ?? common?.[key], 0);
  }
  function refreshNormalizationProfiles() {
    window.AnimalVoiceIndependentPlayback?.setNormalizationProfiles?.(state.config?.animalVocalizations || {});
  }
  function setOffset(id, url, semitones) {
    const own = ensureAnimalOverride(id);
    own.clipPitchSemitones ||= {};
    own.clipPitchSemitones[clipName(url)] = Number(clamp(finite(semitones, 0), -12, 12).toFixed(2));
    refreshNormalizationProfiles();
    mark();
  }
  function clearOffsets(id, clips) {
    const own = ensureAnimalOverride(id);
    if (!own.clipPitchSemitones) return;
    for (const url of clips) delete own.clipPitchSemitones[clipName(url)];
    if (!Object.keys(own.clipPitchSemitones).length) delete own.clipPitchSemitones;
    refreshNormalizationProfiles();
    mark();
  }

  function effectiveAllowedNames(id, kind, clips) {
    const configured = mergeAnimalProfile(id)?.[kind]?.allowedClips;
    const allNames = clips.map(clipName);
    if (!Array.isArray(configured)) return new Set(allNames);
    const requested = new Set(configured.map(clipName));
    return new Set(allNames.filter(name => requested.has(name)));
  }
  function setAllowedNames(id, kind, names, clips) {
    const own = ensureAnimalOverride(id);
    own[kind] ||= {};
    const requested = new Set((names || []).map(clipName));
    own[kind].allowedClips = clips.map(clipName).filter(name => requested.has(name));
    mark();
  }
  function setClipAllowed(id, kind, url, enabled, clips) {
    const names = effectiveAllowedNames(id, kind, clips);
    const key = clipName(url);
    if (enabled) names.add(key); else names.delete(key);
    setAllowedNames(id, kind, [...names], clips);
  }
  function callClipMatrixHtml(id, clips) {
    if (!clips.length) return '<div class="muted">No recorded voice pool exists for this species yet.</div>';
    const allowedByKind = Object.fromEntries(CALL_KINDS.map(kind => [kind, effectiveAllowedNames(id, kind, clips)]));
    const header = `<div class="voiceCallClipLegend"><span>Recording</span>${CALL_KINDS.map(kind => `<span>${CALL_LABELS[kind]}</span>`).join('')}</div>`;
    const rows = clips.map(url => {
      const name = clipName(url);
      return `<div class="voiceCallClipRow"><div><b>${esc(name)}</b></div>${CALL_KINDS.map(kind => `<label class="voiceCallToggle"><input type="checkbox" data-call-clip-kind="${kind}" data-call-clip-url="${esc(url)}"${allowedByKind[kind].has(name) ? ' checked' : ''}> allowed</label>`).join('')}</div>`;
    }).join('');
    const buttons = `<div class="voiceCallClipBulk">${CALL_KINDS.map(kind => `<span><b>${CALL_LABELS[kind]}</b> <button class="subtle" data-call-clip-all="${kind}">All</button> <button class="subtle" data-call-clip-none="${kind}">None</button></span>`).join('')}</div>`;
    return `${buttons}${header}${rows}`;
  }
  function bindClipPanel(id, clips) {
    const panel = document.getElementById(CLIP_CALL_PANEL_ID);
    if (!panel) return;
    panel.querySelectorAll('[data-call-clip-kind]').forEach(input => {
      input.addEventListener('change', () => {
        setClipAllowed(id, input.dataset.callClipKind, input.dataset.callClipUrl, input.checked, clips);
      });
    });
    panel.querySelectorAll('[data-call-clip-all]').forEach(button => {
      button.addEventListener('click', () => {
        setAllowedNames(id, button.dataset.callClipAll, clips.map(clipName), clips);
        mountClipPanel();
      });
    });
    panel.querySelectorAll('[data-call-clip-none]').forEach(button => {
      button.addEventListener('click', () => {
        setAllowedNames(id, button.dataset.callClipNone, [], clips);
        mountClipPanel();
      });
    });
  }
  function mountClipPanel() {
    if (typeof state === 'undefined' || state.mode !== 'animal') return;
    const animal = selectedRecord?.();
    if (!animal || !document.getElementById('editor')) return;
    document.getElementById(CLIP_CALL_PANEL_ID)?.remove();
    const clips = VOICE_CLIPS[voiceKey(animal.id)] || [];
    const panel = document.createElement('div');
    panel.id = CLIP_CALL_PANEL_ID;
    panel.className = 'card';
    panel.innerHTML = `<div class="row"><h3>Call recording assignments</h3><span class="pill">per call type</span></div><div class="muted">Choose exactly which source recordings each call may randomly use. No saved allowlist means legacy “all clips”; explicitly unchecking every clip makes that call type silent.</div>${callClipMatrixHtml(animal.id, clips)}`;
    const firstCard = document.getElementById('editor').querySelector('.card');
    if (firstCard?.nextSibling) firstCard.parentNode.insertBefore(panel, firstCard.nextSibling);
    else document.getElementById('editor').appendChild(panel);
    bindClipPanel(animal.id, clips);
  }

  function normalizedBand(rows) {
    const lows = [], highs = [];
    for (const row of rows) {
      if (!row.result?.pitchReliable) continue;
      const ratio = Math.pow(2, row.recommendedShiftSt / 12);
      lows.push(row.result.f0LowHz * ratio);
      highs.push(row.result.f0HighHz * ratio);
    }
    return lows.length ? { low: Math.min(...lows), high: Math.max(...highs) } : null;
  }
  function renderRows(id, clips, analysis) {
    if (!analysis?.rows?.length) {
      return clips.map(url => `
        <div class="voiceAnalysisRow" data-analysis-url="${esc(url)}">
          <div><b>${esc(clipName(url))}</b><div class="muted">Not analyzed yet</div></div>
          <div class="muted">F0 —</div><div class="muted">Voiced —</div><div class="muted">Centroid —</div>
          <label class="field">Baseline correction (st)<input type="number" step=".1" min="-12" max="12" data-clip-offset="${esc(url)}" value="${esc(currentOffset(id, url))}"></label>
        </div>`).join('');
    }
    return analysis.rows.map(row => {
      const r = row.result;
      const pitch = r.pitchReliable ? `${hz(r.f0LowHz)}–${hz(r.f0HighHz)} · median ${hz(r.f0MedianHz)}` : 'Unpitched / unreliable';
      const confidence = r.pitchReliable
        ? `${percent(r.voicedPercent)} voiced · ${percent(r.pitchConfidence * 100)} confidence`
        : `${percent(r.voicedPercent)} voiced · do not normalize by pitch`;
      const recommendation = r.pitchReliable
        ? `${signed(row.recommendedShiftSt)} st${Math.abs(row.rawShiftSt) > MAX_AUTO_SHIFT_ST ? ' (safe-limit)' : ''}`
        : 'unchanged';
      return `
        <div class="voiceAnalysisRow" data-analysis-url="${esc(row.url)}">
          <div><b>${esc(row.result.clipKey)}</b><div class="muted">${r.durationS.toFixed(2)} s</div></div>
          <div><b>${pitch}</b><div class="muted">recommended ${recommendation}</div></div>
          <div>${confidence}</div>
          <div>Centroid <b>${hz(r.spectralCentroidHz)}</b></div>
          <label class="field">Baseline correction (st)<input type="number" step=".1" min="-12" max="12" data-clip-offset="${esc(row.url)}" value="${esc(currentOffset(id, row.url))}"></label>
        </div>`;
    }).join('');
  }
  function panelHtml(id, clips, analysis) {
    const band = analysis?.band;
    const target = analysis?.targetF0;
    const summary = analysis
      ? target
        ? `Species center <b>${hz(target)}</b> · normalized voiced band <b>${hz(band?.low)}–${hz(band?.high)}</b>. Corrections are applied before chatter/warning/growl and size pitch.`
        : 'No reliable voiced fundamental was detected in this pool. Noise/huffs are left unnormalized.'
      : 'Measures each recording directly. Reliable voiced sections use YIN fundamental-frequency tracking; noisy/unpitched sections are excluded instead of being forced to a pitch. Spectral centroid is shown as a rough brightness/timbre reference.';
    return `
      <div class="row"><h3>Voice-pool frequency analysis</h3><button id="analyzeVoicePool" class="subtle"${clips.length ? '' : ' disabled'}>Analyze & apply normalization</button><button id="clearVoiceNormalization" class="subtle"${clips.length ? '' : ' disabled'}>Clear clip normalization</button></div>
      <div id="voiceAnalysisSummary" class="muted">${summary}</div>
      <div class="voiceAnalysisLegend"><span>Recording</span><span>Fundamental pitch</span><span>Voicing</span><span>Spectrum</span><span>Applied baseline</span></div>
      <div id="voiceAnalysisRows">${renderRows(id, clips, analysis)}</div>
      <div class="muted" style="margin-top:8px">Automatic correction is capped at ±${MAX_AUTO_SHIFT_ST} semitones. A larger required shift is a source-recording mismatch worth reviewing rather than disguising with extreme processing.</div>`;
  }
  function bindPanel(id, clips) {
    const panel = document.getElementById(ANALYSIS_PANEL_ID);
    if (!panel) return;
    panel.querySelector('#analyzeVoicePool')?.addEventListener('click', () => analyzePool(id, clips));
    panel.querySelector('#clearVoiceNormalization')?.addEventListener('click', () => {
      clearOffsets(id, clips);
      resultsBySpecies.delete(id);
      mountPanel();
    });
    panel.querySelectorAll('[data-clip-offset]').forEach(input => {
      input.addEventListener('change', () => setOffset(id, input.dataset.clipOffset, input.value));
    });
  }
  function mountPanel() {
    if (typeof state === 'undefined' || state.mode !== 'animal') return;
    const animal = selectedRecord?.();
    if (!animal || !document.getElementById('editor')) return;
    document.getElementById(ANALYSIS_PANEL_ID)?.remove();
    const clips = VOICE_CLIPS[voiceKey(animal.id)] || [];
    const panel = document.createElement('div');
    panel.id = ANALYSIS_PANEL_ID;
    panel.className = 'card';
    panel.innerHTML = panelHtml(animal.id, clips, resultsBySpecies.get(animal.id));
    const firstCard = document.getElementById('editor').querySelector('.card');
    if (firstCard?.nextSibling) firstCard.parentNode.insertBefore(panel, firstCard.nextSibling);
    else document.getElementById('editor').appendChild(panel);
    bindPanel(animal.id, clips);
  }
  async function analyzePool(id, clips) {
    const panel = document.getElementById(ANALYSIS_PANEL_ID), button = panel?.querySelector('#analyzeVoicePool'), summary = panel?.querySelector('#voiceAnalysisSummary');
    if (!clips.length || !window.AnimalVoiceIndependentPlayback?.analyzeClip) return;
    button.disabled = true;
    const rows = [];
    try {
      window.AnimalVoiceIndependentPlayback.primeAudioContext?.();
      for (let index = 0; index < clips.length; index++) {
        summary.textContent = `Analyzing ${index + 1}/${clips.length}: ${clipName(clips[index])}…`;
        const result = await window.AnimalVoiceIndependentPlayback.analyzeClip(clips[index]);
        rows.push({ url: clips[index], result });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const reliable = rows.filter(row => row.result.pitchReliable);
      const targetF0 = weightedGeometricMean(reliable);
      for (const row of rows) {
        if (!targetF0 || !row.result.pitchReliable) {
          row.rawShiftSt = 0;
          row.recommendedShiftSt = currentOffset(id, row.url);
          continue;
        }
        row.rawShiftSt = 12 * Math.log2(targetF0 / row.result.f0MedianHz);
        row.recommendedShiftSt = clamp(row.rawShiftSt, -MAX_AUTO_SHIFT_ST, MAX_AUTO_SHIFT_ST);
        setOffset(id, row.url, row.recommendedShiftSt);
      }
      const band = normalizedBand(rows);
      resultsBySpecies.set(id, { rows, targetF0, band, analyzedAt: Date.now() });
      mountPanel();
      $('status').textContent = targetF0
        ? `Analyzed ${clips.length} clips · normalized toward ${Math.round(targetF0)} Hz`
        : `Analyzed ${clips.length} clips · no reliable F0 normalization applied`;
    } catch (error) {
      summary.textContent = `Analysis failed: ${error?.message || error}`;
      $('status').textContent = 'Voice analysis failed';
      button.disabled = false;
    }
  }

  function injectStyles() {
    if (document.getElementById('animalVoiceAnalysisStyles')) return;
    const style = document.createElement('style');
    style.id = 'animalVoiceAnalysisStyles';
    style.textContent = `
      .voiceCallClipBulk{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.voiceCallClipBulk span{display:flex;gap:4px;align-items:center}.voiceCallClipBulk button{padding:4px 7px}
      .voiceCallClipLegend,.voiceCallClipRow{display:grid;grid-template-columns:minmax(180px,1.8fr) repeat(3,minmax(105px,.7fr));gap:8px;align-items:center}
      .voiceCallClipLegend{padding:0 7px 5px;color:var(--muted);font-size:11px;font-weight:800;border-bottom:1px solid var(--line)}
      .voiceCallClipRow{padding:8px 7px;border-bottom:1px solid var(--line)}.voiceCallToggle{display:flex;gap:6px;align-items:center}.voiceCallToggle input{width:auto}
      .voiceAnalysisLegend,.voiceAnalysisRow{display:grid;grid-template-columns:minmax(120px,1.15fr) minmax(170px,1.6fr) minmax(120px,1fr) minmax(110px,.9fr) minmax(145px,1fr);gap:8px;align-items:center}
      .voiceAnalysisLegend{margin-top:10px;padding:0 7px 5px;color:var(--muted);font-size:11px;font-weight:800;border-bottom:1px solid var(--line)}
      .voiceAnalysisRow{padding:8px 7px;border-bottom:1px solid var(--line);min-width:0}.voiceAnalysisRow>*{min-width:0;overflow-wrap:anywhere}
      @media(max-width:720px){.voiceCallClipLegend{grid-template-columns:minmax(115px,1.3fr) repeat(3,minmax(70px,.7fr))}.voiceCallClipRow{grid-template-columns:minmax(115px,1.3fr) repeat(3,minmax(70px,.7fr));font-size:11px}.voiceCallToggle{flex-direction:column;align-items:flex-start;gap:2px}.voiceAnalysisLegend{display:none}.voiceAnalysisRow{grid-template-columns:1fr 1fr}.voiceAnalysisRow .field{grid-column:1/-1}.voiceAnalysisRow>div:first-child{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (installed) return;
    let ready = false;
    try {
      ready = typeof renderAnimal === 'function' && typeof previewAnimalSound === 'function'
        && typeof VOICE_CLIPS === 'object' && typeof state === 'object' && typeof ensureAnimalOverride === 'function';
    } catch (_) {}
    if (!ready) { setTimeout(install, 50); return; }
    installed = true;
    injectStyles();

    const originalPreviewAnimalSound = previewAnimalSound;
    previewAnimalSound = function previewAnimalSoundWithAllowedClips(id, kind) {
      const key = voiceKey(id);
      const fullPool = VOICE_CLIPS[key] || [];
      const configured = mergeAnimalProfile(id)?.[kind]?.allowedClips;
      if (!Array.isArray(configured)) return originalPreviewAnimalSound(id, kind);
      const allowed = effectiveAllowedNames(id, kind, fullPool);
      const filtered = fullPool.filter(url => allowed.has(clipName(url)));
      if (!filtered.length) {
        stopPreview?.();
        $('status').textContent = `No recordings enabled for ${kind}`;
        return;
      }
      VOICE_CLIPS[key] = filtered;
      try {
        return originalPreviewAnimalSound(id, kind);
      } finally {
        VOICE_CLIPS[key] = fullPool;
      }
    };

    const originalRenderAnimal = renderAnimal;
    renderAnimal = function renderAnimalWithVoiceAnalysis() {
      originalRenderAnimal();
      refreshNormalizationProfiles();
      mountPanel();
      mountClipPanel();
    };
    refreshNormalizationProfiles();
    mountPanel();
    mountClipPanel();
  }
  install();
})();

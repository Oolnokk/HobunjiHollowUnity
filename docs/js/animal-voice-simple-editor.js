(() => {
  'use strict';

  const CALLS = Object.freeze([
    ['chatter', 'Passive chatter'],
    ['warning', 'Warning / discovery'],
    ['growl', 'Threat growl'],
  ]);
  const DEFAULT_SIZE_PITCH = Object.freeze({ small: 2.5, medium: 0, large: -2.5 });
  const DEFAULT_CALLS = Object.freeze({
    chatter: Object.freeze({ intervalMs: 180, utterances: Object.freeze([{ tempo: 1, pitchSemitones: 0 }, { tempo: 1, pitchSemitones: 0 }, { tempo: 1, pitchSemitones: 0 }]) }),
    warning: Object.freeze({ intervalMs: 420, utterances: Object.freeze([{ tempo: 1, pitchSemitones: 0 }, { tempo: 1, pitchSemitones: 0 }, { tempo: 1, pitchSemitones: 0 }]) }),
    growl: Object.freeze({ intervalMs: 0, utterances: Object.freeze([{ tempo: 1, pitchSemitones: 0 }]) }),
  });
  let installed = false;
  let previewTimers = [];

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clipName(url) {
    return window.AnimalVoiceIndependentPlayback?.clipKey?.(url)
      || String(url || '').split('/').pop().toLowerCase();
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function animalOverride(id) { return ensureAnimalOverride(id); }
  function defaultOverride() {
    state.config.animalVocalizations ||= {};
    return state.config.animalVocalizations.default || (state.config.animalVocalizations.default = {});
  }
  function globalSizePitch() {
    const map = state.config?.animalVocalizations?.default?.sizePitchSemitones || {};
    return {
      small: clamp(finite(map.small, DEFAULT_SIZE_PITCH.small), -12, 12),
      medium: clamp(finite(map.medium, DEFAULT_SIZE_PITCH.medium), -12, 12),
      large: clamp(finite(map.large, DEFAULT_SIZE_PITCH.large), -12, 12),
    };
  }
  function effectiveCall(id, kind) {
    const common = state.config?.animalVocalizations?.default?.[kind] || {};
    const own = state.config?.animalVocalizations?.[id]?.[kind] || {};
    const base = DEFAULT_CALLS[kind];
    const utterances = Array.isArray(own.utterances)
      ? own.utterances
      : Array.isArray(common.utterances)
        ? common.utterances
        : base.utterances;
    return {
      ...base,
      ...common,
      ...own,
      utterances: (utterances || []).map(value => ({
        tempo: clamp(finite(value?.tempo, 1), 0.35, 2),
        pitchSemitones: clamp(finite(value?.pitchSemitones, 0), -12, 12),
      })),
    };
  }
  function effectiveClipTuning(id, url) {
    const key = clipName(url);
    const common = state.config?.animalVocalizations?.default?.clipTuning?.[key];
    const own = state.config?.animalVocalizations?.[id]?.clipTuning?.[key];
    const value = own || common || {};
    return {
      tempo: clamp(finite(value.tempo ?? value.speed, 1), 0.35, 2),
      pitchSemitones: clamp(finite(value.pitchSemitones ?? value.pitch, 0), -12, 12),
    };
  }
  function effectiveAllowed(id, kind, clips) {
    const own = state.config?.animalVocalizations?.[id]?.[kind];
    const common = state.config?.animalVocalizations?.default?.[kind];
    const configured = Array.isArray(own?.allowedClips)
      ? own.allowedClips
      : Array.isArray(common?.allowedClips)
        ? common.allowedClips
        : null;
    const all = clips.map(clipName);
    if (!configured) return new Set(all);
    const wanted = new Set(configured.map(clipName));
    return new Set(all.filter(name => wanted.has(name)));
  }
  function setAllowed(id, kind, clips, names) {
    const own = animalOverride(id);
    own[kind] ||= {};
    const wanted = new Set(names);
    own[kind].allowedClips = clips.map(clipName).filter(name => wanted.has(name));
    mark();
  }
  function selectedSizeClass(animal) {
    const picker = document.getElementById('simpleVoicePreviewSize');
    if (picker) return picker.value;
    return ['small', 'medium', 'large'].includes(animal?.defaultSizeClass) ? animal.defaultSizeClass : 'medium';
  }
  function sizePitchFor(animal) { return globalSizePitch()[selectedSizeClass(animal)] || 0; }

  function stopPreview() {
    for (const timer of previewTimers) clearTimeout(timer);
    previewTimers = [];
    window.AnimalVoiceIndependentPlayback?.stopAllPreviews?.();
  }
  function previewOne(animal, url, utterance = { tempo: 1, pitchSemitones: 0 }) {
    const clip = effectiveClipTuning(animal.id, url);
    const tempo = clamp(clip.tempo * clamp(finite(utterance.tempo, 1), 0.35, 2), 0.35, 2);
    const pitchSemitones = clamp(clip.pitchSemitones + finite(utterance.pitchSemitones, 0) + sizePitchFor(animal), -12, 12);
    return window.AnimalVoiceIndependentPlayback?.preview?.(url, { tempo, pitchSemitones, volume: 0.8 });
  }
  function previewCall(animal, kind, clips) {
    stopPreview();
    const call = effectiveCall(animal.id, kind);
    const allowed = effectiveAllowed(animal.id, kind, clips);
    const pool = clips.filter(url => allowed.has(clipName(url)));
    if (!pool.length || !call.utterances.length) return;
    call.utterances.forEach((utterance, index) => {
      previewTimers.push(setTimeout(() => {
        const url = pool[Math.floor(Math.random() * pool.length)];
        previewOne(animal, url, utterance);
      }, Math.max(0, finite(call.intervalMs, 0)) * index));
    });
  }

  function recordingRows(animal, clips) {
    if (!clips.length) return '<div class="muted">No recorded voice pool exists for this species yet.</div>';
    return clips.map(url => {
      const tuning = effectiveClipTuning(animal.id, url);
      return `<div class="simpleVoiceRecordingRow">
        <b>${esc(clipName(url))}</b>
        <label class="field">Base speed ×<input type="number" step=".01" min=".35" max="2" data-clip-speed="${esc(url)}" value="${esc(tuning.tempo)}"></label>
        <label class="field">Base pitch (st)<input type="number" step=".1" min="-12" max="12" data-clip-pitch="${esc(url)}" value="${esc(tuning.pitchSemitones)}"></label>
        <button class="subtle" data-preview-clip="${esc(url)}">▶ Preview</button>
      </div>`;
    }).join('');
  }

  function callCard(animal, kind, label, clips) {
    const call = effectiveCall(animal.id, kind);
    const allowed = effectiveAllowed(animal.id, kind, clips);
    const assignments = clips.length
      ? clips.map(url => `<label class="simpleVoiceCheck"><input type="checkbox" data-call-clip="${kind}" data-call-url="${esc(url)}"${allowed.has(clipName(url)) ? ' checked' : ''}> ${esc(clipName(url))}</label>`).join('')
      : '<span class="muted">No recordings.</span>';
    const utterances = call.utterances.map((utterance, index) => `<div class="simpleUtteranceRow">
      <b>#${index + 1}</b>
      <label class="field">Tempo ×<input type="number" step=".01" min=".35" max="2" data-utterance-kind="${kind}" data-utterance-index="${index}" data-utterance-field="tempo" value="${esc(utterance.tempo)}"></label>
      <label class="field">Pitch (st)<input type="number" step=".1" min="-12" max="12" data-utterance-kind="${kind}" data-utterance-index="${index}" data-utterance-field="pitchSemitones" value="${esc(utterance.pitchSemitones)}"></label>
      <button class="subtle" data-remove-utterance="${kind}" data-remove-index="${index}">Remove</button>
    </div>`).join('');
    return `<div class="card soundCard simpleCallCard">
      <div class="sectionHead"><h3>${esc(label)}</h3><button class="subtle" data-preview-call="${kind}">▶ Preview response</button></div>
      <div class="muted">Pick which recordings this response may use. Each vocal beat below has one exact tempo and pitch.</div>
      <div class="simpleVoiceAssignments">${assignments}</div>
      <div class="row" style="margin:10px 0"><label class="field" style="max-width:190px">Gap between utterances (ms)<input type="number" min="0" step="10" data-call-gap="${kind}" value="${esc(call.intervalMs)}"></label><button class="subtle" data-add-utterance="${kind}">Add utterance</button></div>
      <div>${utterances || '<div class="muted">No utterances: this response is silent.</div>'}</div>
    </div>`;
  }

  function renderSimpleAnimal() {
    if (typeof state === 'undefined' || state.mode !== 'animal') return;
    const animal = selectedRecord?.();
    const editor = document.getElementById('editor');
    if (!animal || !editor) return;
    stopPreview();
    const clips = VOICE_CLIPS[voiceKey(animal.id)] || [];
    const size = globalSizePitch();
    const treasure = state.config.companionTreasureLines?.[animal.id] || [];
    const discovery = state.config.animalVocalizations?.[animal.id]?.discoveryText || {};
    const defaultSize = ['small', 'medium', 'large'].includes(animal.defaultSizeClass) ? animal.defaultSizeClass : 'medium';

    editor.innerHTML = `<div class="card">
      <div class="row"><h2>${esc(animal.label || animal.id)}</h2><span class="pill">${esc(animal.id)}</span></div>
      <div class="muted">Simple voice model: response chooses a recording → recording base speed/pitch → exact utterance tempo/pitch → one global size-class pitch offset. Nothing else modulates the voice.</div>
      <div class="subhead">Global size pitch · shared by every species</div>
      <div class="grid">
        <label class="field">Small (st)<input type="number" step=".1" min="-12" max="12" data-global-size="small" value="${esc(size.small)}"></label>
        <label class="field">Medium (st)<input type="number" step=".1" min="-12" max="12" data-global-size="medium" value="${esc(size.medium)}"></label>
        <label class="field">Large (st)<input type="number" step=".1" min="-12" max="12" data-global-size="large" value="${esc(size.large)}"></label>
        <label class="field">Preview size<select id="simpleVoicePreviewSize"><option value="small"${defaultSize === 'small' ? ' selected' : ''}>Small</option><option value="medium"${defaultSize === 'medium' ? ' selected' : ''}>Medium</option><option value="large"${defaultSize === 'large' ? ' selected' : ''}>Large</option></select></label>
      </div>
    </div>
    <div class="card"><h3>Recording base tuning</h3><div class="muted">These two values belong to the source recording everywhere it is used.</div><div class="simpleVoiceRecordings">${recordingRows(animal, clips)}</div></div>
    ${CALLS.map(([kind, label]) => callCard(animal, kind, label, clips)).join('')}
    <div class="card"><h3>Discovery announcements</h3><div class="grid">
      <label class="field">Buried treasure<textarea class="compactText" id="simpleTreasureLines">${esc(lineText(treasure))}</textarea></label>
      <label class="field">Animal den<textarea class="compactText" data-simple-discovery="animal-den">${esc(lineText(discovery['animal-den'] || []))}</textarea></label>
      <label class="field">Bandit camp<textarea class="compactText" data-simple-discovery="bandit-camp">${esc(lineText(discovery['bandit-camp'] || []))}</textarea></label>
    </div></div>`;

    editor.querySelectorAll('[data-global-size]').forEach(input => {
      input.oninput = () => {
        const common = defaultOverride();
        common.sizePitchSemitones ||= { ...DEFAULT_SIZE_PITCH };
        common.sizePitchSemitones[input.dataset.globalSize] = clamp(finite(input.value, 0), -12, 12);
        mark();
      };
    });
    editor.querySelectorAll('[data-clip-speed],[data-clip-pitch]').forEach(input => {
      input.oninput = () => {
        const url = input.dataset.clipSpeed || input.dataset.clipPitch;
        const key = clipName(url);
        const own = animalOverride(animal.id);
        own.clipTuning ||= {};
        own.clipTuning[key] ||= effectiveClipTuning(animal.id, url);
        if (input.dataset.clipSpeed) own.clipTuning[key].tempo = clamp(finite(input.value, 1), 0.35, 2);
        else own.clipTuning[key].pitchSemitones = clamp(finite(input.value, 0), -12, 12);
        mark();
      };
    });
    editor.querySelectorAll('[data-preview-clip]').forEach(button => button.onclick = () => {
      stopPreview();
      previewOne(animal, button.dataset.previewClip);
    });
    editor.querySelectorAll('[data-call-clip]').forEach(input => input.onchange = () => {
      const kind = input.dataset.callClip;
      const names = effectiveAllowed(animal.id, kind, clips);
      const key = clipName(input.dataset.callUrl);
      if (input.checked) names.add(key); else names.delete(key);
      setAllowed(animal.id, kind, clips, names);
    });
    editor.querySelectorAll('[data-call-gap]').forEach(input => input.oninput = () => {
      const own = animalOverride(animal.id);
      own[input.dataset.callGap] ||= {};
      own[input.dataset.callGap].intervalMs = Math.max(0, finite(input.value, 0));
      mark();
    });
    editor.querySelectorAll('[data-utterance-kind]').forEach(input => input.oninput = () => {
      const kind = input.dataset.utteranceKind;
      const index = Number(input.dataset.utteranceIndex);
      const field = input.dataset.utteranceField;
      const own = animalOverride(animal.id);
      own[kind] ||= {};
      own[kind].utterances = clone(effectiveCall(animal.id, kind).utterances);
      own[kind].utterances[index][field] = field === 'tempo'
        ? clamp(finite(input.value, 1), 0.35, 2)
        : clamp(finite(input.value, 0), -12, 12);
      mark();
    });
    editor.querySelectorAll('[data-add-utterance]').forEach(button => button.onclick = () => {
      const kind = button.dataset.addUtterance;
      const own = animalOverride(animal.id);
      own[kind] ||= {};
      own[kind].utterances = clone(effectiveCall(animal.id, kind).utterances);
      if (own[kind].utterances.length < 12) own[kind].utterances.push({ tempo: 1, pitchSemitones: 0 });
      mark();
      renderSimpleAnimal();
    });
    editor.querySelectorAll('[data-remove-utterance]').forEach(button => button.onclick = () => {
      const kind = button.dataset.removeUtterance;
      const index = Number(button.dataset.removeIndex);
      const own = animalOverride(animal.id);
      own[kind] ||= {};
      own[kind].utterances = clone(effectiveCall(animal.id, kind).utterances);
      own[kind].utterances.splice(index, 1);
      mark();
      renderSimpleAnimal();
    });
    editor.querySelectorAll('[data-preview-call]').forEach(button => button.onclick = () => previewCall(animal, button.dataset.previewCall, clips));
    document.getElementById('simpleTreasureLines').oninput = event => {
      state.config.companionTreasureLines[animal.id] = lines(event.target.value);
      mark();
    };
    editor.querySelectorAll('[data-simple-discovery]').forEach(input => input.oninput = () => {
      const own = animalOverride(animal.id);
      own.discoveryText ||= {};
      own.discoveryText[input.dataset.simpleDiscovery] = lines(input.value);
      mark();
    });
  }

  function injectStyles() {
    if (document.getElementById('simpleAnimalVoiceStyles')) return;
    const style = document.createElement('style');
    style.id = 'simpleAnimalVoiceStyles';
    style.textContent = `
      .simpleVoiceRecordings{margin-top:9px}.simpleVoiceRecordingRow{display:grid;grid-template-columns:minmax(180px,1.5fr) minmax(110px,.7fr) minmax(110px,.7fr) auto;gap:8px;align-items:end;padding:8px 0;border-bottom:1px solid var(--line)}
      .simpleVoiceAssignments{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.simpleVoiceCheck{display:flex;align-items:center;gap:5px;padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:rgba(255,255,255,.035)}.simpleVoiceCheck input{width:auto}
      .simpleUtteranceRow{display:grid;grid-template-columns:42px minmax(110px,1fr) minmax(110px,1fr) auto;gap:8px;align-items:end;padding:7px 0;border-bottom:1px solid var(--line)}
      @media(max-width:720px){.simpleVoiceRecordingRow{grid-template-columns:1fr 1fr}.simpleVoiceRecordingRow>b{grid-column:1/-1}.simpleUtteranceRow{grid-template-columns:38px 1fr 1fr}.simpleUtteranceRow button{grid-column:2/-1}.simpleVoiceAssignments{display:grid;grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (installed) return true;
    if (typeof window.renderAnimal !== 'function' || typeof state === 'undefined' || typeof VOICE_CLIPS === 'undefined' || typeof ensureAnimalOverride !== 'function') return false;
    injectStyles();
    window.renderAnimal = renderSimpleAnimal;
    installed = true;
    if (state.mode === 'animal') renderSimpleAnimal();
    return true;
  }

  if (!install() && typeof window.setInterval === 'function') {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  }
})();
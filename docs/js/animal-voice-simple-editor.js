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
  const UTTERANCE_INDEX_URL = '../../assets/audio/sfx/utterances/index.json';
  const UTTERANCE_BASE_URL = '../../assets/audio/sfx/utterances/';

  let installed = false;
  let previewTimers = [];
  let utteranceIndex = null;
  let libraryPromise = null;
  let libraryError = null;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clipName(url) {
    return window.AnimalVoiceIndependentPlayback?.normalizeLibraryName?.(url)
      || window.AnimalVoiceIndependentPlayback?.clipKey?.(url)
      || String(url || '').split('/').pop().toLowerCase();
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function animalOverride(id) { return ensureAnimalOverride(id); }
  function defaultOverride() {
    state.config.animalVocalizations ||= {};
    return state.config.animalVocalizations.default || (state.config.animalVocalizations.default = {});
  }
  function voiceSpeciesKey(id) {
    if (typeof voiceKey === 'function') return voiceKey(id);
    const raw = String(id || '').toLowerCase();
    if (raw.includes('dabinggi')) return 'dabinggi-hound';
    if (raw.includes('gar-wolf')) return 'gar-wolf';
    if (raw.includes('grehlr')) return 'grehlr';
    if (raw.includes('drenkirra')) return 'drenkirra';
    if (raw.includes('uumkao')) return 'uumkaoii';
    if (raw.includes('nelk')) return 'nelk';
    return raw;
  }

  async function loadUtteranceIndex() {
    if (utteranceIndex) return utteranceIndex;
    if (libraryPromise) return libraryPromise;
    libraryPromise = fetch(UTTERANCE_INDEX_URL)
      .then(response => {
        if (!response.ok) throw new Error(`Utterance index fetch ${response.status}`);
        return response.json();
      })
      .then(index => {
        if (!index || !Array.isArray(index.clips)) throw new Error('Utterance index has no clips array');
        const seen = new Set();
        index.clips = index.clips
          .filter(entry => entry && typeof entry.file === 'string' && /\.ogg$/i.test(entry.file))
          .filter(entry => {
            const key = String(entry.id || entry.file).toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        index.legacyAliases ||= {};
        index.legacySpeciesDefaults ||= {};
        utteranceIndex = index;
        libraryError = null;
        return index;
      })
      .catch(error => {
        libraryError = error;
        throw error;
      });
    return libraryPromise;
  }

  function libraryEntries() {
    if (!utteranceIndex?.clips) return [];
    return utteranceIndex.clips.map(entry => {
      const id = String(entry.id || entry.file).toLowerCase();
      const url = new URL(`${UTTERANCE_BASE_URL}${encodeURIComponent(entry.file).replace(/%27/g, "'")}`, document.baseURI).href;
      return {
        ...entry,
        id,
        url,
        label: String(entry.label || entry.file),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
      };
    });
  }
  function libraryEntryFor(value) {
    const key = clipName(value);
    return libraryEntries().find(entry => entry.id === key || clipName(entry.url) === key) || null;
  }
  function libraryLabel(value) {
    const entry = libraryEntryFor(value);
    return entry?.label || clipName(value);
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
  function effectiveClipTuning(_id, url) {
    const key = clipName(url);
    const map = state.config?.animalVocalizations?.default?.clipTuning || {};
    let value = map[key];
    if (!value && utteranceIndex?.legacyAliases) {
      const oldKey = Object.keys(utteranceIndex.legacyAliases)
        .find(legacy => String(utteranceIndex.legacyAliases[legacy]).toLowerCase() === key);
      if (oldKey) value = map[String(oldKey).toLowerCase()];
    }
    value ||= {};
    return {
      tempo: clamp(finite(value.tempo ?? value.speed, 1), 0.35, 2),
      pitchSemitones: clamp(finite(value.pitchSemitones ?? value.pitch, 0), -12, 12),
    };
  }
  function legacyDefaultNames(id) {
    const species = voiceSpeciesKey(id);
    const list = utteranceIndex?.legacySpeciesDefaults?.[species];
    return Array.isArray(list) ? list.map(clipName) : [];
  }
  function effectiveAllowed(id, kind, entries) {
    const own = state.config?.animalVocalizations?.[id]?.[kind];
    const common = state.config?.animalVocalizations?.default?.[kind];
    const configured = Array.isArray(own?.allowedClips)
      ? own.allowedClips
      : Array.isArray(common?.allowedClips)
        ? common.allowedClips
        : null;
    const all = entries.map(entry => clipName(entry.url));
    if (!configured) {
      const legacy = new Set(legacyDefaultNames(id));
      return new Set(all.filter(name => legacy.has(name)));
    }
    const wanted = new Set(configured.map(clipName));
    return new Set(all.filter(name => wanted.has(name)));
  }
  function setAllowed(id, kind, entries, names) {
    const own = animalOverride(id);
    own[kind] ||= {};
    const wanted = new Set(names);
    own[kind].allowedClips = entries.map(entry => clipName(entry.url)).filter(name => wanted.has(name));
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
  function previewCall(animal, kind, entries) {
    stopPreview();
    const call = effectiveCall(animal.id, kind);
    const allowed = effectiveAllowed(animal.id, kind, entries);
    const pool = entries.filter(entry => allowed.has(clipName(entry.url)));
    if (!pool.length || !call.utterances.length) return;
    call.utterances.forEach((utterance, index) => {
      previewTimers.push(setTimeout(() => {
        const entry = pool[Math.floor(Math.random() * pool.length)];
        previewOne(animal, entry.url, utterance);
      }, Math.max(0, finite(call.intervalMs, 0)) * index));
    });
  }

  function recordingRows(animal, entries) {
    if (!entries.length) return '<div class="muted">The utterance index contains no .ogg clips.</div>';
    return entries.map(entry => {
      const tuning = effectiveClipTuning(animal.id, entry.url);
      const search = `${entry.label} ${entry.file} ${entry.tags.join(' ')}`.toLowerCase();
      return `<div class="simpleVoiceRecordingRow" data-library-search="${esc(search)}">
        <div><b>${esc(entry.label)}</b><div class="muted clipList">${esc(entry.file)}</div></div>
        <label class="field">Base speed ×<input type="number" step=".01" min=".35" max="2" data-clip-speed="${esc(entry.url)}" value="${esc(tuning.tempo)}"></label>
        <label class="field">Base pitch (st)<input type="number" step=".1" min="-12" max="12" data-clip-pitch="${esc(entry.url)}" value="${esc(tuning.pitchSemitones)}"></label>
        <button class="subtle" data-preview-clip="${esc(entry.url)}">▶ Preview</button>
      </div>`;
    }).join('');
  }

  function callCard(animal, kind, label, entries) {
    const call = effectiveCall(animal.id, kind);
    const allowed = effectiveAllowed(animal.id, kind, entries);
    const assignments = entries.length
      ? entries.map(entry => {
          const search = `${entry.label} ${entry.file} ${entry.tags.join(' ')}`.toLowerCase();
          return `<label class="simpleVoiceCheck" data-library-search="${esc(search)}"><input type="checkbox" data-call-clip="${kind}" data-call-url="${esc(entry.url)}"${allowed.has(clipName(entry.url)) ? ' checked' : ''}><span><b>${esc(entry.label)}</b><small>${esc(entry.file)}</small></span></label>`;
        }).join('')
      : '<span class="muted">No recordings.</span>';
    const utterances = call.utterances.map((utterance, index) => `<div class="simpleUtteranceRow">
      <b>#${index + 1}</b>
      <label class="field">Tempo ×<input type="number" step=".01" min=".35" max="2" data-utterance-kind="${kind}" data-utterance-index="${index}" data-utterance-field="tempo" value="${esc(utterance.tempo)}"></label>
      <label class="field">Pitch (st)<input type="number" step=".1" min="-12" max="12" data-utterance-kind="${kind}" data-utterance-index="${index}" data-utterance-field="pitchSemitones" value="${esc(utterance.pitchSemitones)}"></label>
      <button class="subtle" data-remove-utterance="${kind}" data-remove-index="${index}">Remove</button>
    </div>`).join('');
    return `<div class="card soundCard simpleCallCard">
      <div class="sectionHead"><h3>${esc(label)}</h3><button class="subtle" data-preview-call="${kind}">▶ Preview response</button></div>
      <div class="muted">Choose any indexed recordings this response may use. Missing authoring preserves the old species sound pair; an explicit empty selection makes the response silent.</div>
      <div class="simpleVoiceBulk"><button class="subtle" data-call-all="${kind}">All library sounds</button><button class="subtle" data-call-none="${kind}">None</button><span class="pill">${allowed.size}/${entries.length} allowed</span></div>
      <div class="simpleVoiceAssignments">${assignments}</div>
      <div class="row" style="margin:10px 0"><label class="field" style="max-width:190px">Gap between utterances (ms)<input type="number" min="0" step="10" data-call-gap="${kind}" value="${esc(call.intervalMs)}"></label><button class="subtle" data-add-utterance="${kind}">Add utterance</button></div>
      <div>${utterances || '<div class="muted">No utterances: this response is silent.</div>'}</div>
    </div>`;
  }

  function applyLibrarySearch(value) {
    const needle = String(value || '').trim().toLowerCase();
    document.querySelectorAll('#editor [data-library-search]').forEach(element => {
      element.style.display = !needle || String(element.dataset.librarySearch || '').includes(needle) ? '' : 'none';
    });
  }

  function renderSimpleAnimal() {
    if (typeof state === 'undefined' || state.mode !== 'animal') return;
    const animal = selectedRecord?.();
    const editor = document.getElementById('editor');
    if (!animal || !editor) return;
    stopPreview();

    if (!utteranceIndex) {
      editor.innerHTML = `<div class="card"><h2>${esc(animal.label || animal.id)}</h2><div class="muted">${libraryError ? `Utterance library failed to load: ${esc(libraryError.message || libraryError)}` : 'Loading indexed utterance library…'}</div></div>`;
      loadUtteranceIndex().then(() => {
        if (state.mode === 'animal' && selectedRecord?.()?.id === animal.id) renderSimpleAnimal();
      }).catch(() => {});
      return;
    }

    const entries = libraryEntries();
    const size = globalSizePitch();
    const treasure = state.config.companionTreasureLines?.[animal.id] || [];
    const discovery = state.config.animalVocalizations?.[animal.id]?.discoveryText || {};
    const defaultSize = ['small', 'medium', 'large'].includes(animal.defaultSizeClass) ? animal.defaultSizeClass : 'medium';

    editor.innerHTML = `<div class="card">
      <div class="row"><h2>${esc(animal.label || animal.id)}</h2><span class="pill">${esc(animal.id)}</span><span class="pill">${entries.length} indexed sounds</span></div>
      <div class="muted">Simple voice model: response chooses an indexed recording → global recording base speed/pitch → exact utterance tempo/pitch → one global size-class pitch offset. The library comes from <code>assets/audio/sfx/utterances/index.json</code>.</div>
      <div class="subhead">Global size pitch · shared by every species</div>
      <div class="grid">
        <label class="field">Small (st)<input type="number" step=".1" min="-12" max="12" data-global-size="small" value="${esc(size.small)}"></label>
        <label class="field">Medium (st)<input type="number" step=".1" min="-12" max="12" data-global-size="medium" value="${esc(size.medium)}"></label>
        <label class="field">Large (st)<input type="number" step=".1" min="-12" max="12" data-global-size="large" value="${esc(size.large)}"></label>
        <label class="field">Preview size<select id="simpleVoicePreviewSize"><option value="small"${defaultSize === 'small' ? ' selected' : ''}>Small</option><option value="medium"${defaultSize === 'medium' ? ' selected' : ''}>Medium</option><option value="large"${defaultSize === 'large' ? ' selected' : ''}>Large</option></select></label>
      </div>
      <label class="field" style="margin-top:10px">Filter utterance library<input id="simpleVoiceLibrarySearch" type="search" placeholder="bark, rattle, growl, filename…"></label>
    </div>
    <div class="card"><h3>Global recording base tuning</h3><div class="muted">These speed/pitch values belong to the indexed sound itself and are shared anywhere any species uses it.</div><div class="simpleVoiceRecordings">${recordingRows(animal, entries)}</div></div>
    ${CALLS.map(([kind, label]) => callCard(animal, kind, label, entries)).join('')}
    <div class="card"><h3>Discovery announcements</h3><div class="grid">
      <label class="field">Buried treasure<textarea class="compactText" id="simpleTreasureLines">${esc(lineText(treasure))}</textarea></label>
      <label class="field">Animal den<textarea class="compactText" data-simple-discovery="animal-den">${esc(lineText(discovery['animal-den'] || []))}</textarea></label>
      <label class="field">Bandit camp<textarea class="compactText" data-simple-discovery="bandit-camp">${esc(lineText(discovery['bandit-camp'] || []))}</textarea></label>
    </div></div>`;

    document.getElementById('simpleVoiceLibrarySearch').oninput = event => applyLibrarySearch(event.target.value);
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
        const common = defaultOverride();
        common.clipTuning ||= {};
        common.clipTuning[key] ||= effectiveClipTuning(animal.id, url);
        if (input.dataset.clipSpeed) common.clipTuning[key].tempo = clamp(finite(input.value, 1), 0.35, 2);
        else common.clipTuning[key].pitchSemitones = clamp(finite(input.value, 0), -12, 12);
        mark();
      };
    });
    editor.querySelectorAll('[data-preview-clip]').forEach(button => button.onclick = () => {
      stopPreview();
      previewOne(animal, button.dataset.previewClip);
    });
    editor.querySelectorAll('[data-call-clip]').forEach(input => input.onchange = () => {
      const kind = input.dataset.callClip;
      const names = effectiveAllowed(animal.id, kind, entries);
      const key = clipName(input.dataset.callUrl);
      if (input.checked) names.add(key); else names.delete(key);
      setAllowed(animal.id, kind, entries, names);
      mark();
    });
    editor.querySelectorAll('[data-call-all]').forEach(button => button.onclick = () => {
      setAllowed(animal.id, button.dataset.callAll, entries, entries.map(entry => clipName(entry.url)));
      renderSimpleAnimal();
    });
    editor.querySelectorAll('[data-call-none]').forEach(button => button.onclick = () => {
      setAllowed(animal.id, button.dataset.callNone, entries, []);
      renderSimpleAnimal();
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
    editor.querySelectorAll('[data-preview-call]').forEach(button => button.onclick = () => previewCall(animal, button.dataset.previewCall, entries));
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
      .simpleVoiceRecordings{margin-top:9px;max-height:440px;overflow:auto}.simpleVoiceRecordingRow{display:grid;grid-template-columns:minmax(190px,1.5fr) minmax(110px,.7fr) minmax(110px,.7fr) auto;gap:8px;align-items:end;padding:8px 0;border-bottom:1px solid var(--line)}
      .simpleVoiceAssignments{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px;margin-top:9px;max-height:320px;overflow:auto}.simpleVoiceCheck{display:flex;align-items:flex-start;gap:6px;padding:7px 8px;border:1px solid var(--line);border-radius:7px;background:rgba(255,255,255,.035)}.simpleVoiceCheck input{width:auto;margin-top:3px}.simpleVoiceCheck span{min-width:0}.simpleVoiceCheck small{display:block;color:var(--muted);overflow-wrap:anywhere}
      .simpleVoiceBulk{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:9px}.simpleVoiceBulk button{padding:5px 7px}
      .simpleUtteranceRow{display:grid;grid-template-columns:42px minmax(110px,1fr) minmax(110px,1fr) auto;gap:8px;align-items:end;padding:7px 0;border-bottom:1px solid var(--line)}
      @media(max-width:720px){.simpleVoiceRecordingRow{grid-template-columns:1fr 1fr}.simpleVoiceRecordingRow>div{grid-column:1/-1}.simpleUtteranceRow{grid-template-columns:38px 1fr 1fr}.simpleUtteranceRow button{grid-column:2/-1}.simpleVoiceAssignments{grid-template-columns:1fr;max-height:280px}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (installed) return true;
    if (typeof window.renderAnimal !== 'function' || typeof state === 'undefined' || typeof ensureAnimalOverride !== 'function') return false;
    injectStyles();
    window.renderAnimal = renderSimpleAnimal;
    installed = true;
    loadUtteranceIndex().then(() => {
      if (state.mode === 'animal') renderSimpleAnimal();
    }).catch(() => {
      if (state.mode === 'animal') renderSimpleAnimal();
    });
    if (state.mode === 'animal') renderSimpleAnimal();
    return true;
  }

  if (!install() && typeof window.setInterval === 'function') {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  }
})();
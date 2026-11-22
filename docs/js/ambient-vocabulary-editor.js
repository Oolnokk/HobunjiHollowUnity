// Integrated Vocabulary tab for the Ambient Dialogue Editor; exports a separate JSON
// so adding synonyms cannot overwrite greetings, reactions, or personality assignments.
(() => {
  'use strict';
  if (window.AmbientVocabularyEditor?.installed || typeof listItems !== 'function' || typeof render !== 'function') return;
  const CONFIG_URL = '../../config/dialogue/ambient-vocabulary.json'; // Independent user-authored word dictionary, family defaults and per-character generated tables.
  const PROFILE_URL = '../../config/dialogue/npc-reaction-profiles.json'; // Existing NPC assignments, not duplicated or modified here.
  const SLIDERS = Object.freeze([
    ['verbosity', 'Simplicity', 'Verbosity', 'Prefers brief everyday words or longer, more elaborate expressions'],
    ['color', 'Technical', 'Colorful', 'Prefers clinical or technical synonyms versus vivid, evocative words'],
    ['formality', 'Casual', 'Formal', 'Prefers familiar, conversational or ceremonious diction'],
    ['breadth', 'Narrow', 'Broad vocabulary', 'How many approved synonyms the character knows for each eligible word'],
    ['variety', 'Consistent', 'Varied', 'Favors the same expressions or draws different words each time'],
    ['frequency', 'Rarely swaps', 'Frequently swaps', 'Probability of substituting each matched word'],
  ]); // Editor presents independent axes; a verbose NPC may still be highly technical or casual.
  const model = { config: null, profiles: null, selected: 'dictionary', term: 'lovely', currentWord: '', preview: "That's a lovely tune. I could listen to that all day.", result: '', error: null, loading: true }; // Editor-only selection and unsaved settings.
  const oldListItems = listItems; // Retains the existing NPC, Animal, Crowd and Reactions sidebar renderers.
  const oldRender = render; // Keeps all existing ambient authoring unchanged.
  const rules = () => window.AmbientVocabularyRules;
  const safe = value => esc(String(value ?? ''));
  const cfg = () => model.config;
  const entries = () => Object.keys(cfg()?.lexicon || {}).sort((a, b) => a.localeCompare(b));
  const clamp = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 50));
  const allNpcs = () => Array.isArray(state.npcs) ? state.npcs : [];
  const personName = id => allNpcs().find(npc => npc.id === id)?.name || id;
  function familyId(id) {
    return String(model.profiles?.assignments?.[id] || (/^child_[a-z0-9]+$/i.test(id) ? 'child' : '') || model.profiles?.defaultProfile || 'neighborly'); // Same family convention as ambient NPC reactions.
  }
  function inherited(id) {
    const family = cfg()?.families?.[familyId(id)]?.sliders || {}; // NPC sliders inherit their existing personality family's default axes.
    const seeded = rules().seedSliders({ ...rules().DEFAULT_SLIDERS, ...family }, id); // Editor displays exactly the same initial variation used by runtime.
    return rules().normalizeSliders({ ...seeded, ...(cfg()?.characters?.[id]?.sliders || {}) });
  }
  function mark(label = 'Vocabulary changed · export JSON to save') {
    $('status').textContent = label; // Existing mobile-visible status label reports every unsaved change.
  }
  function ensureCharacter(id) {
    cfg().characters ||= {};
    return cfg().characters[id] ||= { sliders: inherited(id) }; // Created only when a character's sliders or generated table is edited.
  }
  function sidebar() {
    const search = String($('search')?.value || '').toLocaleLowerCase();
    const items = [
      { id: 'dictionary', label: 'Dictionary · words and phrases' },
      ...Object.keys(cfg()?.families || {}).map(id => ({ id: 'family:' + id, label: 'Family · ' + id })),
      ...allNpcs().map(npc => ({ id: 'npc:' + npc.id, label: npc.name || npc.id })),
    ].filter(item => item.label.toLocaleLowerCase().includes(search) || item.id.toLocaleLowerCase().includes(search));
    $('list').innerHTML = items.map(item => '<div class="item' + (model.selected === item.id ? ' active' : '') +
      '" data-vocab-id="' + safe(item.id) + '"><b>' + safe(item.label) + '</b><div class="muted">' + safe(item.id) + '</div></div>').join('');
    $('list').querySelectorAll('[data-vocab-id]').forEach(element => {
      element.onclick = () => { model.selected = element.dataset.vocabId; sidebar(); renderVocabulary(); };
    });
  }
  function fieldSliders(values) {
    return '<div class="grid">' + SLIDERS.map(([key, left, right, description]) =>
      '<div class="field"><label for="vocab_' + key + '">' + safe(left) + ' ↔ ' + safe(right) + '</label>' +
      '<input id="vocab_' + key + '" data-vocab-slider="' + key + '" type="range" min="0" max="100" step="1" value="' + clamp(values[key]) + '" aria-label="' + safe(description) + '">' +
      '<div class="row"><span class="muted">' + safe(description) + '</span><strong data-vocab-value="' + key + '">' + clamp(values[key]) + '</strong></div></div>'
    ).join('') + '</div>'; // Native range inputs remain touch/controller-browser accessible on narrow screens.
  }
  function wireSliders(onChange) {
    $('editor').querySelectorAll('[data-vocab-slider]').forEach(input => {
      input.oninput = () => {
        const value = clamp(input.value); // Range input is clamped even if external automation sends malformed values.
        const label = $('editor').querySelector('[data-vocab-value="' + input.dataset.vocabSlider + '"]');
        if (label) label.textContent = value;
        onChange(input.dataset.vocabSlider, value);
      };
    });
  }
  function downloadConfig() {
    const blob = new Blob([JSON.stringify(cfg(), null, 2) + '\n'], { type: 'application/json' }); // Export matches repository-tracked ambient-vocabulary.json exactly.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ambient-vocabulary.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    mark('Exported ambient-vocabulary.json');
  }
  function toolbar() {
    return '<div class="card"><div class="row"><h2>Vocabulary tables</h2><span class="pill">Floating NPC dialogue only</span>' +
      '<button id="vocabImportBtn" class="subtle">Import Words</button><button id="vocabExportBtn" class="good">Export Words</button>' +
      '<input id="vocabImportFile" type="file" accept=".json" hidden></div>' +
      '<div class="muted">Authored words are the fallback. Ordinary Talk, cutscenes, player status and non-dialogue popups are never rewritten. NPCs use their existing personality family unless they have a generated individual table.</div></div>';
  }
  function wireToolbar() {
    $('vocabExportBtn').onclick = downloadConfig;
    $('vocabImportBtn').onclick = () => $('vocabImportFile').click();
    $('vocabImportFile').onchange = async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed.lexicon !== 'object' || !parsed.families || !parsed.characters) throw new Error('Missing lexicon/families/characters');
        model.config = parsed; // Imports replace only vocabulary data; existing dialogue and reactions files are untouched.
        model.term = entries()[0] || '';
        sidebar();
        renderVocabulary();
        mark('Imported ambient-vocabulary.json');
      } catch (error) { mark('Vocabulary import failed: ' + error.message); }
    };
  }
  function dictionaryView() {
    const keys = entries();
    if (!cfg().lexicon[model.term]) model.term = keys[0] || '';
    const alternates = cfg().lexicon[model.term] || [];
    const text = alternates.map(value => [value.text, value.verbosity ?? 50, value.color ?? 50, value.formality ?? 50].join(' | ')).join('\n');
    return '<div class="card"><h2>Editable synonym dictionary</h2>' +
      '<div class="muted">Add any word or phrase, then author alternatives as: replacement | simplicity–verbosity | technical–colorful | casual–formal. Each numeric rating is 0–100. Write grammatically compatible alternatives; this never queries an unreviewed thesaurus.</div>' +
      '<div class="row"><input id="vocabNewTerm" placeholder="New word or phrase" aria-label="New vocabulary word"><button id="vocabAddTerm" class="good">Add word</button>' +
      '<button id="vocabSeedMissing">Generate missing NPC tables</button></div>' +
      '<label class="field">Edit dictionary entry<select id="vocabTerm">' + keys.map(key => '<option value="' + safe(key) + '"' + (key === model.term ? ' selected' : '') + '>' + safe(key) + '</option>').join('') + '</select></label>' +
      '<textarea id="vocabAlternatives" spellcheck="false" placeholder="nice | 20 | 40 | 20">' + safe(text) + '</textarea>' +
      '<div class="row"><button id="vocabDeleteTerm" class="subtle">Delete selected word</button><span id="vocabEntryCount" class="muted">' + keys.length + ' editable entries</span></div>' +
      '<div id="vocabWordWarning" class="muted"></div></div>';
  }
  function editDictionary() {
    $('vocabTerm').onchange = event => { model.term = event.target.value; renderVocabulary(); };
    $('vocabAddTerm').onclick = () => {
      const key = String($('vocabNewTerm').value || '').toLocaleLowerCase().trim();
      if (!key || key.length > 80 || /[{}]/.test(key)) return $('vocabWordWarning').textContent = 'Enter a word or phrase of up to 80 characters without braces.';
      cfg().lexicon[key] ||= [];
      model.term = key;
      mark();
      renderVocabulary();
    };
    $('vocabAlternatives').oninput = () => {
      const text = $('vocabAlternatives').value; // Editor accepts one candidate per line with three independent register coordinates.
      let warning = '';
      const values = [];
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const parts = line.split('|').map(part => part.trim());
        if (!parts[0] || parts.length !== 4 || parts.slice(1).some(part => part === '' || !Number.isFinite(Number(part)))) {
          warning = 'Invalid row: ' + line + ' · expected synonym | number | number | number';
          break;
        }
        if (!values.some(item => item.text.toLocaleLowerCase() === parts[0].toLocaleLowerCase())) values.push({
          text: parts[0], verbosity: clamp(parts[1]), color: clamp(parts[2]), formality: clamp(parts[3]),
        }); // Duplicate synonym rows collapse to one value within the same word.
      }
      $('vocabWordWarning').textContent = warning;
      if (warning) return; // Invalid edits never corrupt the current exportable dictionary.
      cfg().lexicon[model.term] = values;
      mark('Dictionary changed · regenerate NPC tables after editing this entry');
    };
    $('vocabDeleteTerm').onclick = () => {
      if (!model.term) return;
      delete cfg().lexicon[model.term]; // Word deletion is explicit and local to the isolated vocabulary document.
      model.term = entries()[0] || '';
      mark();
      renderVocabulary();
    };
    $('vocabSeedMissing').onclick = () => {
      let created = 0;
      for (const npc of allNpcs()) {
        if (!npc?.id || cfg().characters?.[npc.id]?.table) continue;
        const original = inherited(npc.id); // Manual NPC slider preferences are preserved when a table is still missing.
        const existing = cfg().characters?.[npc.id];
        const sliders = existing?.sliders ? rules().normalizeSliders(existing.sliders) : original; // Reuse the same stable per-character range already displayed in the editor and runtime.
        const record = ensureCharacter(npc.id);
        record.sliders = sliders;
        record.table = rules().generateTable(cfg().lexicon, sliders, npc.id);
        created++;
      }
      mark('Generated ' + created + ' missing NPC vocabulary table(s) · export to save');
    };
  }
  function familyView(id) {
    const family = cfg()?.families?.[id];
    if (!family) return '<div class="card">Unknown family: ' + safe(id) + '</div>';
    const sliders = rules().normalizeSliders(family.sliders || {});
    return '<div class="card"><h2>' + safe(id) + ' family vocabulary</h2><div class="muted">These defaults apply to characters who have not generated their own tables. Editing a family does not overwrite an existing individual table.</div>' +
      fieldSliders(sliders) + '</div>';
  }
  function editFamily(id) {
    wireSliders((key, value) => {
      cfg().families[id].sliders = { ...rules().normalizeSliders(cfg().families[id].sliders), [key]: value }; // Inherited NPCs pick up the next authored family value.
      mark();
    });
  }
  function charTable(id) {
    const saved = cfg().characters?.[id]?.table;
    return saved || rules().generateTable(cfg().lexicon, inherited(id), id); // An unsaved new NPC can be previewed without mutating config.
  }
  function characterView(id) {
    const values = inherited(id);
    const table = charTable(id);
    const words = Object.keys(table).sort((a, b) => a.localeCompare(b));
    if (!words.includes(model.currentWord)) model.currentWord = words[0] || '';
    return '<div class="card"><h2>' + safe(personName(id)) + '</h2>' +
      '<div class="muted">Personality: <strong>' + safe(familyId(id)) + '</strong>. Configure independent vocabulary dimensions, then generate a table. Existing tables are intentionally preserved while you adjust sliders.</div>' +
      fieldSliders(values) + '<div class="row"><button id="vocabGenerate" class="good">Generate this NPC table</button><span class="muted">' +
      (cfg().characters?.[id]?.table ? 'Saved generated table' : 'Using inherited preview table') + '</span></div></div>' +
      '<div class="card"><h3>Table editor</h3><div class="muted">' + words.length + ' source words/phrases are available. Select one to override its allowed synonyms.</div>' +
      '<select id="vocabTableWord">' + words.map(word => '<option value="' + safe(word) + '"' + (word === model.currentWord ? ' selected' : '') + '>' + safe(word) + '</option>').join('') + '</select>' +
      '<textarea id="vocabTableAlternatives" class="compactText" placeholder="One allowed replacement per line">' + safe((table[model.currentWord] || []).join('\n')) + '</textarea>' +
      '<div class="muted">Manual entries take priority after saving. Regenerating this table replaces individual manual overrides.</div></div>' +
      '<div class="card"><h3>Try this character’s voice</h3><textarea class="compactText" id="vocabPreviewInput">' + safe(model.preview) + '</textarea>' +
      '<div class="row"><button id="vocabTry" class="good">Try another variation</button><span class="pill">Current substitution frequency: ' + values.frequency + '%</span></div>' +
      '<div id="vocabPreviewResult" class="preview">' + safe(model.result || model.preview) + '</div></div>';
  }
  function editCharacter(id) {
    wireSliders((key, value) => {
      const record = ensureCharacter(id);
      record.sliders = { ...inherited(id), [key]: value }; // A slider edit takes effect for this character without altering its family.
      mark('Sliders changed · regenerate this NPC table, then export to save');
    });
    $('vocabGenerate').onclick = () => {
      const record = ensureCharacter(id);
      record.sliders = inherited(id);
      record.table = rules().generateTable(cfg().lexicon, record.sliders, id); // Saved explicit table overrides inherited family data at runtime.
      mark('Generated ' + Object.keys(record.table).length + ' word entries for ' + personName(id));
      renderVocabulary();
    };
    $('vocabTableWord').onchange = event => { model.currentWord = event.target.value; renderVocabulary(); };
    $('vocabTableAlternatives').oninput = event => {
      const record = ensureCharacter(id);
      record.table ||= charTable(id); // First manual edit creates an independent snapshot rather than mutating the family's dictionary.
      const alternatives = [...new Set(event.target.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
      if (alternatives.length) record.table[model.currentWord] = alternatives;
      else delete record.table[model.currentWord];
      mark();
    };
    $('vocabPreviewInput').oninput = event => { model.preview = event.target.value; };
    $('vocabTry').onclick = () => {
      model.preview = $('vocabPreviewInput').value;
      const result = rules().rewriteLine(model.preview, charTable(id), inherited(id), Math.random, id); // Exactly the same shared phrase matcher the game uses.
      model.result = result.text;
      $('vocabPreviewResult').textContent = result.text;
      mark('Preview: ' + result.swaps + ' swapped / ' + result.hits + ' eligible matches');
    };
  }
  function renderVocabulary() {
    window.AnimalVoiceIndependentPlayback?.stopAllPreviews?.();
    if (model.loading || model.error || !cfg() || !rules()) {
      $('editor').innerHTML = '<div class="card">' + safe(model.loading ? 'Loading vocabulary and personality assignments…' : (model.error || 'Missing vocabulary rules')) + '</div>';
      return;
    }
    const selected = model.selected;
    $('editor').innerHTML = toolbar() + (selected === 'dictionary' ? dictionaryView()
      : selected.startsWith('family:') ? familyView(selected.slice(7))
      : selected.startsWith('npc:') ? characterView(selected.slice(4))
      : '<div class="card">Select a vocabulary profile.</div>');
    wireToolbar();
    if (selected === 'dictionary') editDictionary();
    else if (selected.startsWith('family:')) editFamily(selected.slice(7));
    else if (selected.startsWith('npc:')) editCharacter(selected.slice(4));
  }
  function installTab() {
    const tabs = document.querySelector('.tabs');
    if (!tabs || tabs.querySelector('[data-mode="vocabulary"]')) return;
    tabs.style.display = 'flex'; // Horizontally scrolling tabs remain legible on mobile with five authoring modes.
    tabs.style.overflowX = 'auto';
    tabs.style.gridTemplateColumns = 'none';
    for (const tab of tabs.querySelectorAll('button')) { tab.style.flex = '0 0 auto'; tab.style.minWidth = '62px'; }
    const button = document.createElement('button');
    button.dataset.mode = 'vocabulary';
    button.textContent = 'Words';
    button.title = 'Vocabulary tables';
    button.style.flex = '0 0 auto';
    button.style.minWidth = '72px';
    button.onclick = () => {
      state.mode = 'vocabulary';
      document.querySelectorAll('[data-mode]').forEach(tab => tab.classList.toggle('active', tab === button));
      listItems();
      render();
    };
    tabs.appendChild(button);
  }
  async function load() {
    model.loading = true;
    try {
      const [a, b] = await Promise.all([fetch(CONFIG_URL, { cache: 'no-store' }), fetch(PROFILE_URL, { cache: 'no-store' })]);
      if (!a.ok || !b.ok) throw new Error('HTTP ' + a.status + '/' + b.status);
      const [config, profiles] = await Promise.all([a.json(), b.json()]);
      if (!config?.lexicon || !config?.families || !config?.characters || !profiles?.profiles) throw new Error('Vocabulary/personality data is incomplete');
      model.config = config;
      model.profiles = profiles;
      model.error = null;
    } catch (error) { model.error = error?.message || String(error); }
    model.loading = false;
    if (state.mode === 'vocabulary') { listItems(); render(); }
  }
  listItems = function vocabularyAwareListItems() {
    return state.mode === 'vocabulary' ? sidebar() : oldListItems();
  };
  render = function vocabularyAwareRender() {
    return state.mode === 'vocabulary' ? renderVocabulary() : oldRender();
  };
  installTab();
  $('search').oninput = listItems;
  load();
  window.AmbientVocabularyEditor = Object.freeze({
    installed: true,
    getDebug: () => ({ loaded: !!model.config, error: model.error, selected: model.selected, wordCount: entries().length, characterTables: Object.keys(cfg()?.characters || {}).length }),
  }); // Author-facing mobile diagnostics without developer tools.
})();
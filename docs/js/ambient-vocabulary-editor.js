// Standalone authoring UI for the shared floating-speech vocabulary catalog.
// Each synonym exists once in ambient-vocabulary.json; characters store ONLY checked synonym IDs.
(() => {
  'use strict';
  if (window.AmbientVocabularyEditor?.installed) return;
  const CONFIG_URL = '../../config/dialogue/ambient-vocabulary.json'; // Canonical editable dictionary and per-character checkbox references.
  const PROFILE_URL = '../../config/dialogue/npc-reaction-profiles.json'; // Existing reaction personality assignments are reused without modification.
  const NPC_URL = '../../config/npcs/hobunji-starter-npc-database.json'; // Canonical NPC IDs populate the character chooser and batch generator.
  const AXES = Object.freeze([
    ['verbosity', 'Simplicity', 'Verbosity', 'Prefers short everyday vocabulary or elaborate expressions'],
    ['color', 'Technical', 'Colorful', 'Prefers precise technical wording or evocative language'],
    ['formality', 'Casual', 'Formal', 'Prefers informal or ceremonious language'],
    ['breadth', 'Narrow', 'Broad', 'Number of source words and alternatives the character knows'],
    ['variety', 'Consistent', 'Varied', 'Number of different checked alternatives the generator prefers'],
    ['frequency', 'Rare swaps', 'Frequent swaps', 'Chance of substituting an eligible word when speaking'],
    ['oldSlang', 'No old slang', 'Pre-1900 slang', 'How often historical slang documented before 1900 enters generated checkbox choices'],
    ['simplicity', 'Normal words', 'Over-simple', 'Plain childlike substitutes rather than simply low verbosity'],
    ['nearMiss', 'Exact meaning', 'Almost-right', 'Invented or childlike near-miss expressions with deliberately approximate meaning'],
  ]); // Nine independent style dimensions; no one-to-one connection between simplicity and childish mistakes.
  const model = {
    config: null, profiles: null, npcs: [], selected: 'dictionary', word: '', wordSearch: '',
    preview: "That's a lovely tune. Good to see you, friend!", previewResult: '', loading: true, error: null,
  }; // Editor state is transient until the user explicitly exports the JSON file.
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); // Only escaped authoring data enters HTML templates.
  const rules = () => window.AmbientVocabularyRules;
  const cfg = () => model.config;
  const clamp = n => Math.max(0, Math.min(100, Number.isFinite(Number(n)) ? Number(n) : 50));
  const words = () => Object.keys(cfg()?.lexicon || {}).sort((a, b) => a.localeCompare(b));
  const npcName = id => model.npcs.find(npc => npc.id === id)?.name || id;
  const notify = message => { $('status').textContent = message || 'Edited · export vocabulary JSON to save'; }; // Existing status banner provides mobile feedback without a developer console.

  function ensureCanonical(document) {
    if (!document || !document.lexicon || typeof document.lexicon !== 'object' || Array.isArray(document.lexicon)
        || !document.families || typeof document.families !== 'object' || !document.characters || typeof document.characters !== 'object') {
      throw new Error('Vocabulary JSON must contain lexicon, families, and characters objects.');
    }
    for (const [word, list] of Object.entries(document.lexicon)) {
      if (!Array.isArray(list)) throw new Error('Dictionary entry must be an array: ' + word);
      const seen = new Set(); // IDs are stable within each original source phrase, regardless of the replacement text.
      for (const entry of list) {
        if (!entry || typeof entry.text !== 'string' || !entry.text.trim()) throw new Error('Invalid synonym for ' + word);
        const id = rules().synonymId(entry);
        if (!id || seen.has(id)) throw new Error('Duplicate synonym ID in ' + word + ': ' + id);
        entry.id = id;
        seen.add(id);
      }
    }
    for (const character of Object.values(document.characters)) {
      if (!character || typeof character !== 'object') continue;
      if (character.table && !character.selections) character.selections = rules().migrateLegacyTable(document.lexicon, character.table);
      delete character.table; // Upgrading the original implementation removes the duplicate per-NPC text lists.
    }
    document.schema = 'hobunji_ambient_vocabulary.v2';
    return document;
  }

  function familyId(id) {
    return String(model.profiles?.assignments?.[id]
      || (/^child_[a-z0-9]+$/i.test(id) ? 'child' : '')
      || (/^porakaneki(?:[_:-]|$)/i.test(id) ? 'porakaneki' : '')
      || model.profiles?.defaultProfile || 'neighborly'); // Follows the existing reaction system's child/personality policy.
  }
  function traitsFor(id) {
    return rules().speakerTraits(cfg(), id); // Same regional ID resolver as gameplay; Ginju members retain their original personality families.
  }
  function slidersFor(id) {
    const family = cfg()?.families?.[familyId(id)]?.sliders || {};
    const seeded = rules().seedSliders({ ...rules().DEFAULT_SLIDERS, ...family }, id); // Stable personal differences, then regional voice group, then author-approved per-NPC axes.
    return rules().normalizeSliders({ ...seeded, ...traitsFor(id).sliders, ...(cfg()?.characters?.[id]?.sliders || {}) });
  }
  function ensureCharacter(id) {
    cfg().characters ||= {};
    if (!cfg().characters[id]) cfg().characters[id] = { sliders: {}, selections: {} }; // Stores only explicitly edited slider axes; inherited regional defaults remain live and canonical synonym IDs, never replacement text.
    return cfg().characters[id];
  }
  function generated(id) {
    return rules().generateSelections(cfg().lexicon, slidersFor(id), id, traitsFor(id).dialects); // Only the speaker's documented dialects are generated by default.
  }
  function selectedIds(id) {
    const inherited = rules().mergeSelections(generated(id), cfg().families?.[familyId(id)]?.selections);
    const regional = rules().mergeSelections(inherited, traitsFor(id).selections); // Group defaults include Ginju contractions and Pahu's authored Ahoy/matey.
    return rules().mergeSelections(regional, cfg().characters?.[id]?.selections || {}); // Personal checkboxes win, including [] disabling a regional suggestion.
  }
  function candidateIds(id, word) {
    return selectedIds(id)[word] || []; // This word's checked IDs are read by the UI and compiled by the game.
  }
  function resolvedTable(id) {
    return rules().resolveSelections(cfg().lexicon, selectedIds(id)); // Ephemeral preview only, identical to the runtime's compiled table.
  }
  function activeWord() {
    const list = words();
    if (!list.includes(model.word)) model.word = list[0] || '';
    return model.word;
  }
  function wordChooser(id = 'vocabWord') {
    const list = words().filter(word => word.toLocaleLowerCase().includes(model.wordSearch.toLocaleLowerCase()));
    const current = activeWord();
    if (current && !list.includes(current)) list.unshift(current); // Keep current selection visible while filtering.
    return '<div class="row"><input id="vocabWordSearch" type="search" placeholder="Find a source word or phrase…" value="' + safe(model.wordSearch) + '" aria-label="Search dictionary words"></div>' +
      '<select id="' + id + '" aria-label="Source word">' +
      list.map(word => '<option value="' + safe(word) + '"' + (word === current ? ' selected' : '') + '>' + safe(word) + '</option>').join('') + '</select>';
  }
  function wireWordChooser(selectId = 'vocabWord') {
    $('vocabWordSearch').oninput = event => {
      model.wordSearch = event.target.value;
      const select = $(selectId);
      const current = activeWord();
      const options = words().filter(word => word.toLocaleLowerCase().includes(model.wordSearch.toLocaleLowerCase()));
      if (current && !options.includes(current)) options.unshift(current);
      select.innerHTML = options.map(word => '<option value="' + safe(word) + '"' + (word === current ? ' selected' : '') + '>' + safe(word) + '</option>').join('');
    }; // Search updates only the select choices, preserving text focus and edited values.
    $(selectId).onchange = event => {
      model.word = event.target.value;
      render();
    };
  }
  function sliderHtml(values) {
    return '<div class="grid">' + AXES.map(([id, low, high, help]) =>
      '<div class="field"><label for="axis_' + id + '">' + safe(low) + ' ↔ ' + safe(high) + '</label>' +
      '<input id="axis_' + id + '" type="range" min="0" max="100" step="1" data-axis="' + id + '" value="' + clamp(values[id]) + '" aria-label="' + safe(help) + '">' +
      '<div class="row"><span class="muted">' + safe(help) + '</span><strong data-axis-value="' + id + '">' + clamp(values[id]) + '</strong></div></div>'
    ).join('') + '</div>';
  }
  function wireSliders(apply) {
    $('editor').querySelectorAll('[data-axis]').forEach(input => {
      input.oninput = () => {
        const value = clamp(input.value);
        const label = $('editor').querySelector('[data-axis-value="' + input.dataset.axis + '"]');
        if (label) label.textContent = value;
        apply(input.dataset.axis, value);
      };
    });
  }
  function sidebar() {
    const query = String($('search').value || '').trim().toLocaleLowerCase();
    const options = [{ id: 'dictionary', name: 'Master dictionary' },
      ...Object.keys(cfg()?.families || {}).map(id => ({ id: 'family:' + id, name: id + ' family' })),
      ...Object.keys(cfg()?.speakerGroups || {}).map(id => ({ id: 'voice:' + id, name: cfg().speakerGroups[id].label || id + ' regional voice' })), // Regional groups are independent of personality family tabs.
      ...model.npcs.map(npc => ({ id: 'npc:' + npc.id, name: npc.name || npc.id })),
    ].filter(item => (item.name + ' ' + item.id).toLocaleLowerCase().includes(query));
    $('list').innerHTML = options.map(item => '<div class="item' + (item.id === model.selected ? ' active' : '') +
      '" data-entry="' + safe(item.id) + '" role="button" tabindex="0"><b>' + safe(item.name) +
      '</b><div class="muted">' + safe(item.id) + '</div></div>').join('');
    $('list').querySelectorAll('[data-entry]').forEach(node => {
      const choose = () => { model.selected = node.dataset.entry; model.previewResult = ''; sidebar(); render(); }; // A new speaker never inherits the previous NPC's preview.
      node.onclick = choose;
      node.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } };
    });
  }
  function toolbar() {
    return '<section class="card"><div class="row"><h2>Shared Vocabulary Workshop</h2><span class="pill">Floating NPC text only</span>' +
      '<button id="importVocabulary" type="button" class="subtle">Import JSON</button><button id="exportVocabulary" class="good" type="button">Export JSON</button>' +
      '<input type="file" hidden accept=".json" id="vocabularyFile"></div>' +
      '<div class="muted">There is one authoritative list of synonyms for each word. NPCs check approved alternatives by ID, while Talk dialogue, quest cutscenes, and UI notices remain unchanged. Export to update the repository config.</div></section>';
  }
  function download() {
    const file = new Blob([JSON.stringify(cfg(), null, 2) + '\n'], { type: 'application/json' }); // Always export complete updated config for replacing its single repository JSON file.
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'ambient-vocabulary.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Exported ambient-vocabulary.json · import it into the repository to save permanently');
  }
  function wireToolbar() {
    $('exportVocabulary').onclick = download;
    $('importVocabulary').onclick = () => $('vocabularyFile').click();
    $('vocabularyFile').onchange = async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const parsed = ensureCanonical(JSON.parse(await file.text())); // Validated standalone imports cannot alter dialogue/reaction configuration.
        model.config = parsed;
        model.word = '';
        model.wordSearch = '';
        sidebar();
        render();
        notify('Imported vocabulary JSON · review and export to keep changes');
      } catch (error) { notify('Import failed: ' + (error?.message || error)); }
      event.target.value = '';
    };
  }
  function nextId(word, candidate) {
    const used = new Set((cfg().lexicon[word] || []).map(entry => rules().synonymId(entry)));
    const base = String(candidate).trim().toLocaleLowerCase();
    let id = base, n = 2;
    while (used.has(id)) id = base + '-' + n++;
    return id;
  }
  function dictionaryView() {
    const word = activeWord();
    const entries = cfg().lexicon[word] || [];
    return '<section class="card"><h2>Master synonym dictionary</h2>' +
      '<div class="muted">Add any source word or phrase. Each approved synonym is defined once here, with its own stable ID and three independent style ratings. Renaming a synonym keeps every NPC checkbox linked.</div>' +
      '<div class="row"><input id="newWord" placeholder="New source word or phrase…" aria-label="New source word"><button id="addWord" type="button" class="good">Add source word</button>' +
      '<button id="batchGenerate" type="button">Generate unchecked NPC profiles</button></div>' +
      wordChooser('dictionaryWord') +
      '<div class="row"><strong>' + safe(word || 'No words') + '</strong><span class="pill">' + entries.length + ' shared synonyms</span>' +
      '<button id="deleteWord" type="button" class="subtle">Delete this word</button></div>' +
      entries.map(entry =>
        '<div class="card" style="margin:10px 0;padding:10px" data-synonym="' + safe(entry.id) + '">' +
        '<label class="field">Approved replacement<input type="text" data-edit-synonym="' + safe(entry.id) + '" value="' + safe(entry.text) + '"></label>' +
        '<div class="grid"><label class="field">Word style<select data-edit-kind="' + safe(entry.id) + '">' +
        [['standard','Standard'],['regional','Regional dialect'],['old-slang','Historical slang (before 1900)'],['simple','Over-simple / childlike'],['near-miss','Almost-right / coined']].map(([kind,label]) =>
          '<option value="' + kind + '"' + ((entry.kind || 'standard') === kind ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
        '<label class="field">First attested year (old slang only)<input data-edit-period="' + safe(entry.id) + '" type="number" min="1000" max="1899" step="1" placeholder="e.g. 1861" value="' + safe(entry.firstRecorded || '') + '"></label>' +
        '<label class="field">Regional dialect tag<input data-edit-dialect="' + safe(entry.id) + '" placeholder="e.g. southeastern-us" value="' + safe(entry.dialect || '') + '"></label></div>' +
        '<div class="grid">' +
        [['verbosity', 'Simple', 'Verbose'], ['color', 'Technical', 'Colorful'], ['formality', 'Casual', 'Formal']].map(([axis, low, high]) =>
          '<label class="field">' + low + ' ↔ ' + high + '<input type="number" min="0" max="100" step="1" data-edit-rating="' + axis + '" data-synonym-id="' + safe(entry.id) + '" value="' + clamp(entry[axis]) + '"></label>'
        ).join('') + '</div><div class="row"><span class="muted">Stable ID: ' + safe(entry.id) + '</span>' +
        '<button type="button" class="subtle" data-remove-synonym="' + safe(entry.id) + '">Delete synonym globally</button></div></div>'
      ).join('') +
      '<div class="row"><input id="newSynonym" placeholder="New synonym / alternate phrase…" aria-label="New synonym">' +
      '<button id="addSynonym" type="button" class="good">Add synonym</button></div>' +
      '<div id="vocabWarning" class="muted" role="status">Only text and the three ratings live in this master list. Characters only select IDs.</div></section>';
  }
  function wireDictionary() {
    wireWordChooser('dictionaryWord');
    $('addWord').onclick = () => {
      const word = String($('newWord').value || '').trim().toLocaleLowerCase();
      if (!word || word.length > 80 || /[{}]/.test(word) || ['__proto__', 'constructor', 'prototype'].includes(word)) {
        notify('Source word must be 1–80 characters without braces or reserved object names.');
        return;
      }
      cfg().lexicon[word] ||= []; // Master dictionary is the only place to author synonym strings.
      model.word = word;
      model.wordSearch = '';
      render();
      notify('Added source word · add synonyms below');
    };
    $('deleteWord').onclick = () => {
      const word = activeWord();
      if (!word) return;
      delete cfg().lexicon[word];
      for (const character of Object.values(cfg().characters || {})) delete character?.selections?.[word]; // Removed words cannot leave stale checked references.
      model.word = '';
      render();
      notify('Deleted word and its NPC checkmarks');
    };
    $('addSynonym').onclick = () => {
      const text = String($('newSynonym').value || '').trim();
      const word = activeWord();
      if (!word || !text || text.length > 120 || text.includes('{') || text.includes('}')) {
        notify('Enter a source word and a replacement up to 120 characters (without placeholders).');
        return;
      }
      const entries = cfg().lexicon[word];
      if (entries.some(entry => entry.text.toLocaleLowerCase() === text.toLocaleLowerCase())) {
        notify('This synonym is already listed for that word.'); return;
      }
      entries.push({ id: nextId(word, text), text, verbosity: 50, color: 50, formality: 50 }); // New stable IDs are unique within their source word.
      render();
      notify('Added canonical synonym · now available for every character to check');
    };
    $('editor').querySelectorAll('[data-edit-synonym]').forEach(input => {
      input.onchange = () => {
        const entry = cfg().lexicon[activeWord()]?.find(item => item.id === input.dataset.editSynonym);
        const text = input.value.trim();
        if (!entry || !text || /[{}]/.test(text) || text.length > 120
            || cfg().lexicon[activeWord()].some(item => item !== entry && item.text.toLocaleLowerCase() === text.toLocaleLowerCase())) {
          notify('Invalid or duplicate synonym; original text retained.'); input.value = entry?.text || ''; return;
        }
        entry.text = text; // The canonical ID does NOT change, so checked words update globally when renamed.
        notify('Master synonym edited · character checkmarks preserved');
      };
    });
    $('editor').querySelectorAll('[data-edit-kind]').forEach(input => {
      input.onchange = () => {
        const entry = cfg().lexicon[activeWord()]?.find(item => item.id === input.dataset.editKind); // Edit only the canonical synonym; every character retains the same checkbox ID.
        if (!entry || !rules().WORD_KINDS.includes(input.value)) return;
        entry.kind = input.value;
        notify('Updated synonym style. Pre-1900 slang requires a first attested year to enter automatic generation.');
      };
    });
    $('editor').querySelectorAll('[data-edit-dialect]').forEach(input => {
      input.onchange = () => {
        const entry = cfg().lexicon[activeWord()]?.find(item => item.id === input.dataset.editDialect); // One shared entry is the sole owner of its region tag.
        if (!entry) return;
        const tag = String(input.value || '').trim().toLowerCase();
        if (tag && !/^[a-z][a-z0-9-]{1,49}$/.test(tag)) { input.value = entry.dialect || ''; notify('Use a lower-case dialect tag such as southeastern-us'); return; }
        if (tag) entry.dialect = tag;
        else delete entry.dialect;
        notify('Updated shared dialect tag · unassigned NPCs will not inherit this region');
      };
    });
    $('editor').querySelectorAll('[data-edit-period]').forEach(input => {
      input.onchange = () => {
        const entry = cfg().lexicon[activeWord()]?.find(item => item.id === input.dataset.editPeriod); // Historical metadata is author-editable, never guessed at runtime.
        if (!entry) return;
        const year = Number(input.value);
        if (!input.value.trim()) delete entry.firstRecorded;
        else if (Number.isInteger(year) && year >= 1000 && year <= 1899) entry.firstRecorded = year;
        else { input.value = String(entry.firstRecorded || ''); notify('First attested year must be before 1900.'); return; }
        notify('Updated historical attestation year for the shared synonym.');
      };
    });
    $('editor').querySelectorAll('[data-edit-rating]').forEach(input => {
      input.onchange = () => {
        const entry = cfg().lexicon[activeWord()]?.find(item => item.id === input.dataset.synonymId);
        if (!entry) return;
        entry[input.dataset.editRating] = clamp(input.value); // Altering a register affects generation for everyone, never duplicates their vocabulary text.
        input.value = String(entry[input.dataset.editRating]);
        notify('Master synonym ratings updated');
      };
    });
    $('editor').querySelectorAll('[data-remove-synonym]').forEach(button => {
      button.onclick = () => {
        const word = activeWord(), id = button.dataset.removeSynonym;
        cfg().lexicon[word] = (cfg().lexicon[word] || []).filter(entry => entry.id !== id);
        for (const character of Object.values(cfg().characters || {})) {
          if (Array.isArray(character?.selections?.[word])) character.selections[word] = character.selections[word].filter(selected => selected !== id);
        } // References to deleted canonical synonyms are pruned immediately.
        render();
        notify('Deleted synonym globally and cleared its character checkmarks');
      };
    });
    $('batchGenerate').onclick = () => {
      let changed = 0;
      for (const npc of model.npcs) {
        if (!npc?.id || Object.keys(cfg().characters?.[npc.id]?.selections || {}).length) continue; // Batch action never overwrites deliberate existing checked entries.
        const record = ensureCharacter(npc.id);
        record.selections = generated(npc.id);
        changed++;
      }
      notify('Generated checkbox selections for ' + changed + ' previously unconfigured NPCs');
    };
  }
  function familyView(id) {
    const family = cfg()?.families?.[id];
    if (!family) return '<section class="card">Unknown personality family</section>';
    return '<section class="card"><h2>' + safe(id) + ' · family defaults</h2>' +
      '<div class="muted">Sliders supply initial checked choices for each NPC in this family. Already checked character overrides are preserved, including deliberately unchecked words.</div>' +
      sliderHtml(rules().normalizeSliders(family.sliders || {})) + '</section>';
  }
  function wireFamily(id) {
    wireSliders((key, value) => {
      const family = cfg().families[id];
      family.sliders = { ...rules().normalizeSliders(family.sliders), [key]: value };
      notify('Family style updated · regenerate character checkmarks only when desired');
    });
  }
  function doorstepSpeech(id) {
    const gifts = window.WEAPON_TRUST_VISIT_CONFIG?.gifts || []; // Live script data only: never duplicate a historical authored speech inside the vocabulary JSON.
    return gifts.filter(gift => gift.npcId === id).map(gift => ({
      title: gift.dialogueLabel || gift.id, id: gift.id,
      lines: (Array.isArray(gift.dialogueLines) ? gift.dialogueLines
        : (gift.dialogueTree?.nodes || []).filter(node => node.type === 'text').map(node => node.text)).filter(value => typeof value === 'string'),
    })); // Full original authored lines, including Kzubug's branches and Pahu's phonetic spellings.
  }
  function doorstepCandidates(id) {
    const ignored = new Set(('about after again also and are been before being but came come could ' +
      'from good have here into just know little made more most much only our own said some that ' +
      'them then there these they this those through time very want were what when where which ' +
      'while with would your yourself already because enough every thought should').split(' ')); // Avoid polluting suggestions with grammatical glue.
    const terms = new Set(); // Source phrases come from the actual doorstep visit records, not fabricated dialect examples.
    for (const visit of doorstepSpeech(id)) for (const line of visit.lines) {
      const clean = line.replace(/\{\{[^}]+\}\}|<[^>]+>|\[[^\]]+\]/g, ' ');
      for (const match of clean.matchAll(/[a-z][a-z'-]{3,}/gi)) {
        const term = match[0].toLowerCase();
        if (!ignored.has(term) && !Object.hasOwn(cfg().lexicon, term) && !/^(?:player|rakako|hollow|hobunji|khanni)/i.test(term)) terms.add(term);
      }
    }
    return [...terms].sort((a, b) => a.localeCompare(b)).slice(0, 28); // Bounded mobile suggestions; nothing enters the dictionary without a deliberate tap.
  }
  function doorstepSamplesHtml(id) {
    const visits = doorstepSpeech(id);
    if (!visits.length) return '<section class="card"><details><summary>Doorstep voice references</summary>' +
      '<div class="muted">No authored weapon-trust doorstep voice is available for this NPC. Other visit providers may be dynamic; this editor does not invent a voice from them.</div></details></section>';
    const candidates = doorstepCandidates(id); // Unique source words from this NPC's actual authored speech; no automatic dictionary mutation.
    return '<section class="card"><details><summary>Authoritative doorstep speech · ' + visits.reduce((n, visit) => n + visit.lines.length, 0) +
      ' lines</summary><div class="muted">Read-only excerpts loaded from the actual weapon-trust visit configuration. These are voice references, not dialogue to rewrite. Tap any line to preview how this NPC would phrase it in a different floating-speech context.</div>' +
      '<details style="padding:10px 0"><summary>Harvest vocabulary candidates · ' + candidates.length + '</summary>' +
      '<div class="muted">These words were extracted from the source dialogue, not generated by a thesaurus. Tap one to add it as an empty master dictionary entry; no replacement takes place until you author alternatives.</div>' +
      '<div class="row">' + candidates.map(word => '<button type="button" data-harvest-word="' + safe(word) + '">+ ' + safe(word) + '</button>').join('') + '</div></details>' +
      '<div class="doorstep-lines">' + visits.flatMap(visit => visit.lines.map((line, index) =>
        '<div class="doorstep-line"><div class="muted">' + safe(visit.title) + ' · line ' + (index + 1) + '</div>' +
        safe(line) + '<div><button type="button" data-use-visit="' + safe(visit.id) + ':' + index + '">Use as preview</button></div></div>'
      )).join('') + '</div></details></section>';
  }
  function groupView(id) {
    const group = cfg()?.speakerGroups?.[id];
    if (!group) return '<section class="card">Unknown voice group.</section>';
    const preset = cfg()?.phoneticPresets?.[group.phoneticPreset];
    return '<section class="card"><h2>' + safe(group.label || id) + '</h2>' +
      '<div class="muted">Applies to ' + safe((group.speakerIds || []).join(', ') || group.idSuffix || 'unassigned') +
      '. Separate from personality; only regional vocabulary and phonetic rules are inherited.</div>' +
      '<label class="field">Enabled dialect tags (comma-separated)<input id="groupDialects" value="' + safe((group.dialects || []).join(', ')) +
      '"></label>' + sliderHtml(rules().normalizeSliders({ ...rules().DEFAULT_SLIDERS, ...(group.sliders || {}) })) +
      '<div class="muted">Changing a group default preserves NPC-specific manual synonym checkboxes and individual style overrides.</div></section>' +
      (preset ? '<section class="card"><h3>Doorstep-derived phonetic rules · ' + safe(group.phoneticPreset) + '</h3>' +
      '<div class="muted">One exact source word/phrase and target spelling per line, separated by |. Longest matches win. All replacements are limited to this assigned voice group.</div>' +
      '<textarea id="phoneticPairs" spellcheck="false">' + safe(preset.rules.map(rule => rule.from + ' | ' + rule.to).join('\n')) + '</textarea>' +
      '<div class="row"><button type="button" id="savePhonetics" class="good">Apply phonetic rules</button></div>' +
      '<div class="muted">Original authoring: ' + safe(preset.source || 'unavailable') + '</div></section>' : '');
  }
  function wireGroup(id) {
    const group = cfg().speakerGroups[id];
    wireSliders((key, value) => {
      group.sliders = { ...(group.sliders || {}), [key]: value }; // Group sliders are only deltas relative to each member's actual personality family.
      notify('Updated ' + id + ' regional voice: export vocabulary JSON to save');
    });
    $('groupDialects').onchange = event => {
      group.dialects = [...new Set(String(event.target.value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean))]; // New dialect tags are matched against canonical dictionary entries.
      notify('Changed enabled regional dialects for ' + id);
    };
    const preset = cfg()?.phoneticPresets?.[group.phoneticPreset];
    if (preset && $('savePhonetics')) $('savePhonetics').onclick = () => {
      const pairs = []; // Only validated bounded phrase pairs reach runtime; the source dialogue file remains read-only.
      const seen = new Set();
      for (const line of $('phoneticPairs').value.split(/\r?\n/).filter(line => line.trim())) {
        const pipe = line.indexOf('|'), from = line.slice(0, pipe).trim(), to = line.slice(pipe + 1).trim();
        if (pipe < 1 || !from || from.length > 80 || !to || to.length > 120 || /[{}<>|]/.test(from + to) || seen.has(from.toLowerCase())) {
          notify('Invalid phonetic rule: ' + line.slice(0, 80) + ' · use source | replacement with no duplicates');
          return;
        }
        pairs.push({ from, to }); seen.add(from.toLowerCase());
      }
      cfg().phoneticPresets[group.phoneticPreset] = { ...preset, rules: pairs }; // Replacing the object invalidates the shared weak-cached matcher immediately, including in-editor previews.
      notify('Updated ' + pairs.length + ' phonetic rules for ' + id + ' · export to save');
    };
  }
  function characterView(id) {
    const sliders = slidersFor(id);
    const word = activeWord();
    const options = cfg()?.lexicon?.[word] || [];
    const checked = new Set(candidateIds(id, word));
    const own = Object.hasOwn(cfg()?.characters?.[id]?.selections || {}, word);
    const generatedCount = Object.keys(selectedIds(id)).length;
    return '<section class="card"><h2>' + safe(npcName(id)) + ' · vocabulary</h2><div class="muted">Personality: ' +
      '<strong>' + safe(familyId(id)) + '</strong>. Sliders generate suggested checkmarks; each choice below links to the single master synonym list.</div>' +
      sliderHtml(sliders) +
      '<div class="row"><button id="generateCharacter" type="button" class="good">Regenerate all checkmarks</button>' +
      '<button id="resetCharacter" type="button" class="subtle">Use generated defaults</button>' +
      '<span class="muted">' + generatedCount + ' eligible source words · Regenerate replaces this NPC’s manual checkmarks</span></div></section>' +
      '<section class="card"><h3>Check this character’s allowed synonyms</h3>' +
      wordChooser('characterWord') +
      '<div class="row"><strong>' + safe(word) + '</strong><span class="pill" id="checkedSynonymCount">' + checked.size + ' checked</span>' +
      '<span class="muted">' + (own ? 'Manually configured' : 'Suggested by sliders') + '</span></div>' +
      options.map(entry => '<label class="friend" style="display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:6px;border:1px solid var(--line);border-radius:8px">' +
        '<input type="checkbox" data-check-synonym="' + safe(entry.id) + '"' + (checked.has(entry.id) ? ' checked' : '') +
        ' style="width:23px;height:23px;flex:none;accent-color:var(--accent)">' +
        '<span style="flex:1"><strong>' + safe(entry.text) + '</strong><span class="muted" style="display:block">Verbosity ' + clamp(entry.verbosity) +
        ' · Color ' + clamp(entry.color) + ' · Formality ' + clamp(entry.formality) +
        ' · ' + safe((entry.kind || 'standard') === 'old-slang' ? 'Pre-1900 slang' : (entry.kind === 'simple' ? 'Over-simple' : (entry.kind === 'near-miss' ? 'Almost-right' : (entry.kind === 'regional' ? 'Regional' : 'Standard')))) +
        (entry.dialect ? ' · ' + safe(entry.dialect) : '') +
        '</span></span></label>').join('') +
      '<div class="row"><button id="checkAll" type="button">Check all</button><button id="checkNone" type="button">Uncheck all</button>' +
      '<button id="resetWord" class="subtle" type="button">Reset word to generated</button></div>' +
      '<div class="muted">Every change here edits only this NPC’s checkmarks. Edit the wording itself in Master dictionary to update it for everyone.</div></section>' +
      '<section class="card"><h3>Live speech preview</h3><textarea id="previewInput" class="compactText">' + safe(model.preview) + '</textarea>' +
      '<div class="row"><button id="previewButton" type="button" class="good">Try another variation</button>' +
      '<span class="pill" id="swapChance">Swap chance: ' + sliders.frequency + '%</span></div>' +
      '<div class="preview" id="previewResult">' + safe(model.previewResult || model.preview) + '</div></section>' +
      doorstepSamplesHtml(id); // Source dialogue stays read-only; phonetic and synonym rules apply only to the separate preview.
  }
  function wireCharacter(id) {
    wireSliders((key, value) => {
      const record = ensureCharacter(id);
      record.sliders = { ...(record.sliders || {}), [key]: value }; // Store only this explicitly changed axis, so later family/group changes still inherit.
      model.previewResult = ''; // A previous preview must never masquerade as the newly configured voice.
      const checked = new Set(candidateIds(id, activeWord())); // Update visible checkboxes without destroying the actively dragged range input.
      $('editor').querySelectorAll('[data-check-synonym]').forEach(input => { input.checked = checked.has(input.dataset.checkSynonym); });
      $('checkedSynonymCount').textContent = checked.size + ' checked';
      $('swapChance').textContent = 'Swap chance: ' + slidersFor(id).frequency + '%';
      notify('Character slider updated · implicit checkmarks refreshed; regenerate all to replace manual choices');
    });
    $('generateCharacter').onclick = () => {
      const record = ensureCharacter(id);
      record.selections = rules().mergeSelections(generated(id), traitsFor(id).selections); // Keep named regional defaults when explicitly baking checkmarks. // Explicit user action generates canonical IDs, NOT per-character duplicate synonym text.
      model.previewResult = '';
      render(); notify('Regenerated all checked synonyms for ' + npcName(id));
    };
    $('resetCharacter').onclick = () => {
      const record = ensureCharacter(id);
      record.selections = {}; // Re-enable live family/slider generation for every word; do not alter character slider preferences.
      model.previewResult = '';
      render(); notify('Cleared manual checkmarks; using generated defaults for ' + npcName(id));
    };
    wireWordChooser('characterWord');
    function setWord(ids) {
      const rec = ensureCharacter(id);
      rec.selections ||= {};
      rec.selections[activeWord()] = [...new Set(ids)].filter(value => typeof value === 'string');
      model.previewResult = '';
      render();
      notify('Updated ' + npcName(id) + ' checkmarks for ' + activeWord());
    }
    $('editor').querySelectorAll('[data-check-synonym]').forEach(input => {
      input.onchange = () => {
        const chosen = new Set(candidateIds(id, activeWord()));
        if (input.checked) chosen.add(input.dataset.checkSynonym);
        else chosen.delete(input.dataset.checkSynonym);
        setWord([...chosen]);
      };
    });
    $('checkAll').onclick = () => setWord((cfg().lexicon[activeWord()] || []).map(entry => entry.id));
    $('checkNone').onclick = () => setWord([]);
    $('resetWord').onclick = () => {
      const record = ensureCharacter(id);
      delete record.selections?.[activeWord()]; // Restore this one word's automatically suggested checkboxes.
      model.previewResult = '';
      render(); notify('Reset selected word to generated checkmarks');
    };
    $('editor').querySelectorAll('[data-harvest-word]').forEach(button => {
      button.onclick = () => {
        const word = button.dataset.harvestWord;
        if (!word || /[{}<>]/.test(word) || word.length > 80) return;
        cfg().lexicon[word] ||= []; // Only a new canonical source word: the original visit stays immutable and no runtime synonym is invented.
        model.word = word;
        model.wordSearch = '';
        model.selected = 'dictionary';
        sidebar(); render();
        notify('Harvested ' + word + ' from a doorstep visit · add alternatives before it can change anyone’s speech');
      };
    });
    $('editor').querySelectorAll('[data-use-visit]').forEach(button => {
      button.onclick = () => {
        const [giftId, indexText] = String(button.dataset.useVisit).split(':');
        const visit = doorstepSpeech(id).find(item => item.id === giftId), line = visit?.lines?.[Number(indexText)];
        if (!line) return;
        model.preview = line; model.previewResult = '';
        render(); // The full original authored line becomes an editable sample, never a modification to the actual doorstep dialogue.
        notify('Loaded ' + visit.title + ' into the preview; original doorstep dialogue is unchanged');
      };
    });
    $('previewInput').oninput = event => { model.preview = event.target.value; };
    $('previewButton').onclick = () => {
      model.preview = $('previewInput').value;
      const result = rules().rewriteLine(model.preview, resolvedTable(id), slidersFor(id), Math.random, id);
      const accent = traitsFor(id).phoneticPreset || cfg().characters?.[id]?.phoneticPreset;
      const pronounced = accent ? rules().applyPhoneticPreset(result.text, cfg(), accent, id) : { text: result.text, swaps: 0 };
      model.previewResult = pronounced.text;
      $('previewResult').textContent = pronounced.text;
      notify('Preview: ' + result.swaps + ' synonyms + ' + pronounced.swaps + ' phonetic changes; ' + result.hits + ' matches');
    };
  }

  function render() {
    if (model.loading || model.error || !cfg() || !rules()) {
      $('editor').innerHTML = '<section class="card">' + safe(model.loading ? 'Loading vocabulary and personality assignments…' :
        (model.error || 'Missing shared vocabulary rules')) + '</section>'; return;
    }
    const selected = model.selected;
    $('editor').innerHTML = toolbar() + (selected === 'dictionary' ? dictionaryView()
      : selected.startsWith('family:') ? familyView(selected.slice(7))
      : selected.startsWith('voice:') ? groupView(selected.slice(6))
      : selected.startsWith('npc:') ? characterView(selected.slice(4))
      : '<section class="card">Select a word, personality or character.</section>');
    wireToolbar();
    if (selected === 'dictionary') wireDictionary();
    else if (selected.startsWith('family:')) wireFamily(selected.slice(7));
    else if (selected.startsWith('voice:')) wireGroup(selected.slice(6));
    else if (selected.startsWith('npc:')) wireCharacter(selected.slice(4));
  }
  async function load() {
    try {
      const [a, b, n] = await Promise.all([
        fetch(CONFIG_URL, { cache: 'no-store' }),
        fetch(PROFILE_URL, { cache: 'no-store' }),
        fetch(NPC_URL, { cache: 'no-store' }),
      ]); // One-time authoring load; no background frame work or polling.
      if (!a.ok || !b.ok || !n.ok) throw new Error('HTTP ' + a.status + '/' + b.status + '/' + n.status);
      const [config, profiles, database] = await Promise.all([a.json(), b.json(), n.json()]);
      if (!profiles?.profiles) throw new Error('NPC reaction personality config is missing.');
      model.config = ensureCanonical(config);
      model.profiles = profiles;
      model.npcs = Array.isArray(database?.npcs) ? database.npcs : (Array.isArray(database) ? database : []);
      model.error = null;
    } catch (error) { model.error = error?.message || String(error); }
    model.loading = false;
    sidebar(); render();
    notify(model.error ? 'Vocabulary load failed: ' + model.error : 'Ready · edits require exporting ambient-vocabulary.json');
  }
  $('search').oninput = sidebar;
  render();
  load();
  window.AmbientVocabularyEditor = Object.freeze({
    installed: true,
    getDebug: () => ({ loaded: !!model.config, error: model.error, selected: model.selected, wordCount: words().length,
      characterOverrides: Object.keys(cfg()?.characters || {}).length,
      checkboxCount: Object.values(cfg()?.characters || {}).reduce((sum, character) =>
        sum + Object.values(character?.selections || {}).reduce((n, ids) => n + (Array.isArray(ids) ? ids.length : 0), 0), 0),
    }),
  }); // One mobile-readable diagnostic snapshot, without opening browser developer tools.
})();

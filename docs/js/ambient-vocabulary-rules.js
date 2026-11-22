// Pure vocabulary-table generator shared by the game and the mobile Vocabulary Editor.
// No asset loading, persistent state, or gameplay dependencies.
(() => {
  'use strict';
  const DEFAULT_SLIDERS = Object.freeze({ verbosity: 50, color: 50, formality: 50, breadth: 70, variety: 55, frequency: 55, oldSlang: 0, simplicity: 0, nearMiss: 0 }); // Default axis values for incomplete profiles and new NPCs.
  const clamp = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 50));
  const normalizeSliders = values => Object.fromEntries(Object.keys(DEFAULT_SLIDERS).map(key => [key, clamp(values?.[key] ?? DEFAULT_SLIDERS[key])])); // Shared generator/runtime/editor input validation.
  function hash(text) {
    let value = 2166136261; // Stable across sessions so low-variety characters favor the same vocabulary.
    for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return value >>> 0;
  }
  function synonymId(entry) {
    return String(entry?.id || entry?.text || '').trim().toLocaleLowerCase(); // Immutable canonical ID; the editor keeps it when synonyms are renamed.
  }
  const WORD_KINDS = Object.freeze(['standard', 'old-slang', 'simple', 'near-miss']); // Shared editor/runtime classifications: historical slang pre-1900, plain childlike forms, intentional almost-right words.
  const CATEGORY_SLIDER = Object.freeze({ 'old-slang': 'oldSlang', simple: 'simplicity', 'near-miss': 'nearMiss' }); // Every nonstandard kind has its own independent inclusion slider.
  function isEligibleKind(entry, selected, speakerId, word) {
    const kind = String(entry?.kind || 'standard');
    if (kind === 'standard') return true;
    const slider = CATEGORY_SLIDER[kind];
    if (!slider || !Number.isFinite(Number(selected[slider]))) return false; // Unknown categories fail closed instead of leaking unusual words into everyone's speech.
    const strength = selected[slider];
    if (strength < 20) return false; // Ordinary villagers never inherit historical slang/misnamings from a zero-weight preset.
    if (kind === 'old-slang' && (!Number.isInteger(entry?.firstRecorded) || entry.firstRecorded >= 1900)) return false; // Documented period slang only; anything undated requires explicit manual checkmarks.
    const roll = (hash(speakerId + ':kind:' + word + ':' + synonymId(entry)) >>> 0) / 4294967296; // Stable per-speaker sample, generated only on first bubble/editor preview.
    return roll < (strength - 10) / 90;
  }
  function generateSelections(lexicon, sliders, speakerId = '') {
    const selected = normalizeSliders(sliders); // Independent axes determine which globally authored words each character is allowed to say.
    const selections = {}; // Only canonical synonym IDs are stored, not copies of another character's word list.
    for (const [original, entries] of Object.entries(lexicon || {})) {
      const key = String(original || '').toLocaleLowerCase().trim(); // A source phrase is checked by its actual authored words.
      if (!key || key.length > 80 || /[{}]/.test(key) || !Array.isArray(entries)) continue;
      const coverage = 0.12 + (selected.breadth / 100) * 0.88; // Broad characters know more words; low breadth excludes entire entries.
      if ((hash(speakerId + ':known:' + key) >>> 0) / 4294967296 >= coverage) continue;
      const ranked = entries.filter(item => item && typeof item.text === 'string' && item.text.trim() && isEligibleKind(item, selected, speakerId, key)).map(item => ({
        id: synonymId(item),
        distance: Math.abs(clamp(item.verbosity ?? 50) - selected.verbosity) * 0.9
          + Math.abs(clamp(item.color ?? 50) - selected.color)
          + Math.abs(clamp(item.formality ?? 50) - selected.formality) * 0.7
          - (CATEGORY_SLIDER[item.kind] ? Math.max(0, selected[CATEGORY_SLIDER[item.kind]] - 35) * 0.8 : 0), // Strong style sliders make approved historical/childlike choices competitive with standard synonyms.
        text: item.text.trim(),
      })).filter(item => item.id && item.text.toLocaleLowerCase() !== key)
        .sort((left, right) => left.distance - right.distance || left.text.localeCompare(right.text));
      if (!ranked.length) continue;
      const shortlisted = ranked.filter(item => item.distance <= ranked[0].distance + 42); // Keep formal and colorful axes independent.
      const capacity = Math.max(1, Math.ceil(shortlisted.length * (0.2 + selected.breadth / 125)));
      const eligible = shortlisted.slice(0, capacity);
      const count = Math.max(1, Math.ceil(eligible.length * Math.max(0.01, selected.variety / 100)));
      const variants = eligible.slice(0, count).map(item => item.id);
      selections[key] = selected.variety < 15
        ? [variants[hash(speakerId + ':' + key) % variants.length]]
        : [...new Set(variants)];
    }
    return selections;
  }
  function mergeSelections(automatic, overrides) {
    const selected = { ...(automatic || {}) }; // Missing override keys continue to use the character's generated family vocabulary.
    for (const [word, ids] of Object.entries(overrides || {})) {
      if (Object.hasOwn(selected, word) || (ids && Array.isArray(ids))) {
        selected[word] = Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string').map(id => id.trim().toLocaleLowerCase()).filter(Boolean))] : [];
      }
    } // Explicit empty arrays are meaningful: this character must never replace that source word.
    return selected;
  }
  function resolveSelections(lexicon, selections) {
    const table = {}; // Compiled ephemeral render table. The JSON schema stores ONLY synonym ID references.
    for (const [word, ids] of Object.entries(selections || {})) {
      const entries = lexicon?.[word];
      if (!Array.isArray(entries) || !Array.isArray(ids) || !ids.length) continue;
      const enabled = new Set(ids.filter(id => typeof id === 'string').map(id => id.toLocaleLowerCase()));
      const words = [...new Set(entries.filter(entry => entry && enabled.has(synonymId(entry)) && typeof entry.text === 'string' && entry.text.trim()
        && (entry.kind !== 'old-slang' || (Number.isInteger(entry.firstRecorded) && entry.firstRecorded < 1900))) // Even manual checkmarks cannot turn post-1900 or undated slang into historical vocabulary.
        .map(entry => entry.text.trim()).filter(text => text.toLocaleLowerCase() !== word))];
      if (words.length) table[word] = words;
    }
    return table;
  }
  function migrateLegacyTable(lexicon, table) {
    const selections = {}; // Imports from the first PR revision are converted to central synonym IDs without duplicate text.
    for (const [word, alternatives] of Object.entries(table || {})) {
      if (!Array.isArray(alternatives)) continue;
      const desired = new Set(alternatives.map(text => String(text || '').toLocaleLowerCase()));
      selections[word] = (lexicon?.[word] || []).filter(entry => desired.has(String(entry?.text || '').toLocaleLowerCase())).map(synonymId);
    }
    return selections;
  }
  function generateTable(lexicon, sliders, speakerId = '') {
    return resolveSelections(lexicon, generateSelections(lexicon, sliders, speakerId)); // Compatibility helper for older read-only preview/test callers.
  }
  function seedSliders(familySliders, speakerId) {
    const values = normalizeSliders(familySliders); // Existing personality family is the center of each character's vocabulary.
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [
      key, value === 0 && ['oldSlang', 'simplicity', 'nearMiss'].includes(key) ? 0
        : clamp(value + hash(String(speakerId) + ':' + key) % 25 - 12),
    ])); // Stable ±12-point individual variation; no random changes every time a character speaks.
  }
  const expressionCache = new WeakMap(); // Each stable NPC table is compiled once and reused across its floating dialogue bubbles.
  function expressionFor(table) {
    if (!table || typeof table !== 'object') return null;
    if (expressionCache.has(table)) return expressionCache.get(table);
    const terms = Object.keys(table).filter(key => key && key.length <= 80 && !/[{}]/.test(key))
      .sort((a, b) => b.length - a.length); // Longer authored phrases have priority over their component words.
    const escaped = terms.map(term => term.replace(/([^\p{L}\p{N}\s])/gu, '\\$1')); // Escape every punctuation mark while preserving Unicode words and spaces.
    const pattern = escaped.length ? new RegExp('(^|[^\\p{L}\\p{N}_])(' + escaped.join('|') + ')(?=$|[^\\p{L}\\p{N}_])', 'giu') : null;
    expressionCache.set(table, pattern);
    return pattern;
  }
  function caseLike(source, replacement) {
    if (source !== source.toLocaleLowerCase() && source === source.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
    if (source[0] && source[0] === source[0].toLocaleUpperCase()) return replacement[0].toLocaleUpperCase() + replacement.slice(1);
    return replacement;
  }
  function rewriteLine(source, table, sliders, random = Math.random, speakerId = '') {
    const original = String(source ?? ''); // Never mutate the original authored sentence or its placeholders.
    const pattern = expressionFor(table);
    if (!pattern) return { text: original, hits: 0, swaps: 0 };
    const settings = normalizeSliders(sliders);
    let hits = 0, swaps = 0; // Diagnostics distinguish a missed coin flip from a missing entry.
    const text = original.split(/(\{\{[^{}]*\}\}|\{[A-Za-z][A-Za-z0-9_]*\})/g).map(segment => {
      if (/^(?:\{\{[^{}]*\}\}|\{[A-Za-z][A-Za-z0-9_]*\})$/.test(segment)) return segment; // Only complete dialogue placeholders are protected; normal text starting with a brace remains eligible.
      pattern.lastIndex = 0;
      return segment.replace(pattern, (whole, prefix, raw, offset) => {
        const candidates = Object.hasOwn(table, raw.toLocaleLowerCase()) ? table[raw.toLocaleLowerCase()] : null; // No inherited prototype names are legal dictionary matches.
        if (!Array.isArray(candidates) || !candidates.length) return whole;
        const preceding = segment.slice(0, offset) + prefix; // The regex includes its leading word boundary; include that boundary when inspecting grammar.
        const article = /(?:^|[^\p{L}\p{N}_])(a|an)\s+$/iu.exec(preceding)?.[1]?.toLocaleLowerCase() || null;
        const valid = candidates.filter(value => {
          if (typeof value !== 'string' || !value.trim() || value.toLocaleLowerCase() === raw.toLocaleLowerCase()) return false;
          if (!article) return true;
          return /^[aeiou]/i.test(value.trim()) === (article === 'an'); // Prefer no substitution to an obvious a/an grammatical error.
        });
        if (!valid.length) return whole;
        hits++;
        const probability = Number(random());
        if (!Number.isFinite(probability) || probability >= settings.frequency / 100) return whole;
        const roll = Number(random()); // Invalid external test/previews can never produce an out-of-range candidate.
        const pick = settings.variety < 15
          ? hash(speakerId + ':' + raw.toLocaleLowerCase()) % valid.length
          : Math.min(valid.length - 1, Math.floor(Math.max(0, Number.isFinite(roll) ? roll : 0) * valid.length));
        swaps++;
        return prefix + caseLike(raw, valid[pick]);
      });
    }).join('');
    return { text, hits, swaps };
  }
  window.AmbientVocabularyRules = Object.freeze({ DEFAULT_SLIDERS, WORD_KINDS, normalizeSliders, seedSliders, synonymId, generateSelections, mergeSelections, resolveSelections, migrateLegacyTable, generateTable, rewriteLine });
})();

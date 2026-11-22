// Pure vocabulary-table generator shared by the game and the mobile Vocabulary Editor.
// No asset loading, persistent state, or gameplay dependencies.
(() => {
  'use strict';
  const DEFAULT_SLIDERS = Object.freeze({ verbosity: 50, color: 50, formality: 50, breadth: 70, variety: 55, frequency: 55 }); // Default axis values for incomplete profiles and new NPCs.
  const clamp = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 50));
  const normalizeSliders = values => Object.fromEntries(Object.keys(DEFAULT_SLIDERS).map(key => [key, clamp(values?.[key] ?? DEFAULT_SLIDERS[key])])); // Shared generator/runtime/editor input validation.
  function hash(text) {
    let value = 2166136261; // Stable across sessions so low-variety characters favor the same vocabulary.
    for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return value >>> 0;
  }
  function generateTable(lexicon, sliders, speakerId = '') {
    const selected = normalizeSliders(sliders); // Each slider weights an independent attribute, without implying intelligence.
    const table = {}; // Exportable original-phrase -> eligible alternatives table, editable after generation.
    for (const [original, entries] of Object.entries(lexicon || {})) {
      const key = String(original || '').toLocaleLowerCase().trim(); // Exact whole-word/phrase key; no transformations of unidentified vocabulary.
      if (!key || key.length > 80 || /[{}]/.test(key) || !Array.isArray(entries)) continue;
      const ranked = entries.filter(item => item && typeof item.text === 'string' && item.text.trim()).map(item => ({
        text: item.text.trim(),
        distance: Math.abs(clamp(item.verbosity ?? 50) - selected.verbosity) * 0.9
          + Math.abs(clamp(item.color ?? 50) - selected.color)
          + Math.abs(clamp(item.formality ?? 50) - selected.formality) * 0.7,
      })).filter(item => item.text.toLocaleLowerCase() !== key)
        .sort((a, b) => a.distance - b.distance || a.text.localeCompare(b.text));
      if (!ranked.length) continue;
      const capacity = Math.max(1, Math.ceil(ranked.length * (0.12 + selected.breadth / 115))); // Vocabulary breadth limits the number of synonyms available for a word.
      const shortlist = ranked.slice(0, capacity).filter(item => item.distance <= ranked[0].distance + 42); // Avoid contradictory registers even when breadth is high.
      if (!shortlist.length) continue;
      table[key] = selected.variety < 15
        ? [shortlist[hash(speakerId + ':' + key) % shortlist.length].text]
        : shortlist.map(item => item.text);
    }
    return table;
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
      return segment.replace(pattern, (whole, prefix, raw) => {
        const candidates = table[raw.toLocaleLowerCase()];
        if (!Array.isArray(candidates) || !candidates.length) return whole;
        const valid = candidates.filter(value => typeof value === 'string' && value.trim() && value.toLocaleLowerCase() !== raw.toLocaleLowerCase()); // Invalid manual entries are ignored.
        if (!valid.length) return whole;
        hits++;
        if (random() >= settings.frequency / 100) return whole;
        const pick = settings.variety < 15
          ? hash(speakerId + ':' + raw.toLocaleLowerCase()) % valid.length
          : Math.min(valid.length - 1, Math.floor(Math.max(0, random()) * valid.length));
        swaps++;
        return prefix + caseLike(raw, valid[pick]);
      });
    }).join('');
    return { text, hits, swaps };
  }
  window.AmbientVocabularyRules = Object.freeze({ DEFAULT_SLIDERS, normalizeSliders, generateTable, rewriteLine });
})();

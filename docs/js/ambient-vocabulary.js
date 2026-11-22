// Authored vocabulary substitutions for character-owned world-space dialogue only.
// Text is transformed once when AmbientDialogue.show creates a bubble; ordinary Talk never calls this.
(() => {
  'use strict';
  const CONFIG_PATH = 'config/dialogue/ambient-vocabulary.json'; // The Vocabulary tab exports this independent authored configuration.
  const PROFILE_PATH = 'config/dialogue/npc-reaction-profiles.json'; // Existing NPC-to-personality assignments supply inherited vocabulary defaults.
  const DEFAULT_SLIDERS = Object.freeze({ verbosity: 50, color: 50, formality: 50, breadth: 70, variety: 55, frequency: 55 }); // Used for an unassigned NPC or incomplete imported settings.
  const state = { config: null, profiles: null, compiled: null, last: null, error: null, ready: false, changed: 0, skipped: 0 }; // Keeps one configuration, regex, and mobile-readable diagnostic snapshot.
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const clamp = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 50));
  const normalizeSliders = value => Object.fromEntries(Object.keys(DEFAULT_SLIDERS).map(key => [key, clamp(hasOwn(value, key) ? value[key] : DEFAULT_SLIDERS[key])])); // Every slider is bounded before selecting vocabulary.
  const normalizedWord = value => String(value || '').trim().toLocaleLowerCase();
  function hash(text) {
    let h = 2166136261; // Stable speaker/word hash used when the variety slider prefers recurring favorite expressions.
    for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  function optionsFor(config, speakerId, profiles) {
    const id = String(speakerId || ''); // Only real NPC IDs qualify; status and player announcements must not be rewritten.
    if (!id || id === 'player' || id.startsWith('player-') || !config || config.enabled === false) return null;
    const familyId = String(profiles?.assignments?.[id] || (/^child_[a-z0-9]+$/i.test(id) ? 'child' : '') || profiles?.defaultProfile || 'neighborly'); // Shares the established personality assignment and generated-child convention.
    const family = config.families?.[familyId] || null; // Family defaults are used unless an individual generated table overrides them.
    const character = config.characters?.[id] || null; // Explicit character settings and generated table take precedence over family defaults.
    if (!family && !character) return null;
    const sliders = normalizeSliders({ ...DEFAULT_SLIDERS, ...(family?.sliders || {}), ...(character?.sliders || {}) }); // Independent axes never derive formality from sophistication.
    return { sliders, familyId, table: character?.table || family?.table || null, characterId: id };
  }
  function scoredAlternatives(alternatives, sliders, seed) {
    const valid = (Array.isArray(alternatives) ? alternatives : []).filter(entry => entry && typeof entry.text === 'string' && entry.text.trim()); // Invalid or empty authoring records never enter a runtime table.
    const selected = valid.map(entry => ({
      text: entry.text.trim(),
      distance: Math.abs(clamp(entry.verbosity ?? 50) - sliders.verbosity) * 0.9
        + Math.abs(clamp(entry.color ?? 50) - sliders.color) * 1.0
        + Math.abs(clamp(entry.formality ?? 50) - sliders.formality) * 0.7,
    })).sort((a, b) => a.distance - b.distance || a.text.localeCompare(b.text)); // The independent sliders rank only editor-approved synonyms.
    const count = Math.max(1, Math.ceil(selected.length * (0.12 + sliders.breadth / 115))); // Breadth controls how many candidate forms a speaker knows for each entry.
    const eligible = selected.slice(0, count);
    const best = eligible.filter(candidate => candidate.distance <= eligible[0].distance + 42);
    const choices = best.length ? best : eligible;
    if (sliders.variety < 15) return choices.length ? [choices[hash(seed) % choices.length].text] : [];
    return choices.map(candidate => candidate.text);
  }
  function generateTable(lexicon, sliders, speakerId) {
    const table = {}; // Snapshot of allowed alternatives is exported for direct manual editing and never recomputed during rendering.
    const normalized = normalizeSliders(sliders);
    for (const [term, entries] of Object.entries(lexicon || {})) {
      const key = normalizedWord(term); // One original word/phrase is the unit of an authored Mad-Libs-style substitution.
      if (!key || /[{}]/.test(key) || key.length > 80) continue;
      const alternatives = scoredAlternatives(entries, normalized, speakerId + ':' + key).filter(text => normalizedWord(text) !== key);
      if (alternatives.length) table[key] = alternatives;
    }
    return table;
  }
  function compile(config) {
    const terms = Object.keys(config?.lexicon || {}).map(normalizedWord).filter(term => term && !/[{}]/.test(term) && term.length <= 80).sort((a, b) => b.length - a.length); // Longest phrase wins, so 'very nice' is not intercepted by 'nice'.
    const unique = [...new Set(terms)];
    if (!unique.length) return null;
    const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return new RegExp('(^|[^\\p{L}\\p{N}_])(' + unique.map(escape).join('|') + ')(?=$|[^\\p{L}\\p{N}_])', 'giu'); // Unicode word boundaries preserve names, punctuation, and complete words.
    } catch (_) { return null; }
  }
  function preserveCase(source, replacement) {
    if (source === source.toLocaleUpperCase() && source !== source.toLocaleLowerCase()) return replacement.toLocaleUpperCase();
    if (source.charAt(0) === source.charAt(0).toLocaleUpperCase()) return replacement.charAt(0).toLocaleUpperCase() + replacement.slice(1);
    return replacement;
  }
  function rewrite(text, speakerId, random = Math.random, config = state.config, profiles = state.profiles) {
    const source = String(text ?? ''); // Original authoring stays immutable and is returned when any dependency is absent.
    const selected = optionsFor(config, speakerId, profiles);
    if (!selected || !source) return source;
    const pattern = config === state.config ? state.compiled : compile(config);
    if (!pattern) return source;
    const table = selected.table || generateTable(config.lexicon, selected.sliders, selected.characterId);
    const chance = selected.sliders.frequency / 100;
    let hits = 0; // Included in Dev Companion diagnostics for failed or overly aggressive vocabulary configurations.
    let swaps = 0; // Counts actual substitutions, not merely words encountered.
    const output = source.split(/(\{\{[^{}]*\}\}|\{[A-Za-z][A-Za-z0-9_]*\})/g).map(chunk => {
      if (/^\{/.test(chunk)) return chunk; // Never alter existing template/identity placeholders.
      pattern.lastIndex = 0;
      return chunk.replace(pattern, (match, prefix, raw) => {
        const alternatives = table[normalizedWord(raw)];
        if (!Array.isArray(alternatives) || !alternatives.length) return match;
        hits++;
        if (random() >= chance) return match;
        const usable = alternatives.filter(candidate => typeof candidate === 'string' && candidate.trim() && normalizedWord(candidate) !== normalizedWord(raw));
        if (!usable.length) return match;
        const variant = selected.sliders.variety < 15
          ? usable[hash(selected.characterId + ':' + normalizedWord(raw)) % usable.length]
          : usable[Math.min(usable.length - 1, Math.floor(Math.max(0, random()) * usable.length))];
        swaps++;
        return prefix + preserveCase(raw, variant);
      });
    }).join('');
    state.last = { speakerId: selected.characterId, familyId: selected.familyId, original: source, displayed: output, hits, swaps }; // Available on mobile through AmbientVocabulary.getDebug().
    state.changed += swaps;
    state.skipped += hits - swaps;
    return output;
  }
  async function load() {
    try {
      const [a, b] = await Promise.all([
        fetch(CONFIG_PATH, { cache: 'no-store' }),
        fetch(PROFILE_PATH, { cache: 'no-store' }),
      ]); // One startup request per file, never one lookup per NPC or bubble.
      if (!a.ok || !b.ok) throw new Error('Vocabulary/profile HTTP ' + a.status + '/' + b.status);
      const [config, profiles] = await Promise.all([a.json(), b.json()]);
      if (!config || !config.lexicon || !profiles?.profiles) throw new Error('Invalid vocabulary or personality configuration');
      state.config = config;
      state.profiles = profiles;
      state.compiled = compile(config);
      state.ready = true;
      state.error = null;
      return true;
    } catch (error) {
      state.ready = false;
      state.error = error?.message || String(error);
      return false; // Failure leaves authored ambient speech unchanged.
    }
  }
  const api = Object.freeze({
    rewrite,
    generateTable,
    normalizeSliders,
    reload: load,
    getDebug: () => ({ ready: state.ready, error: state.error, last: state.last, replacements: state.changed, untouchedMatches: state.skipped, wordCount: Object.keys(state.config?.lexicon || {}).length }),
  }); // Public surface for editor tests and the existing mobile diagnostic console.
  window.AmbientVocabulary = api;
  load();
})();

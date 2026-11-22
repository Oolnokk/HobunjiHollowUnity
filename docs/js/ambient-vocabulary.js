// Authored vocabulary substitutions for character-owned world-space dialogue only.
// Text is transformed once when AmbientDialogue.show creates a bubble; ordinary Talk never calls this.
(() => {
  'use strict';
  const CONFIG_PATH = 'config/dialogue/ambient-vocabulary.json'; // The Vocabulary tab exports this independent authored configuration.
  const PROFILE_PATH = 'config/dialogue/npc-reaction-profiles.json'; // Existing NPC-to-personality assignments supply inherited vocabulary defaults.
  const DEFAULT_SLIDERS = Object.freeze({ verbosity: 50, color: 50, formality: 50, breadth: 70, variety: 55, frequency: 55 }); // Used for an unassigned NPC or incomplete imported settings.
  const state = { config: null, profiles: null, last: null, error: null, ready: false, changed: 0, skipped: 0, tableCache: new Map() }; // Keeps one configuration, regex, and mobile-readable diagnostic snapshot.
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
    const familySliders = normalizeSliders({ ...DEFAULT_SLIDERS, ...(family?.sliders || {}) }); // Existing personality defines the center of the vocabulary range.
    const seeded = window.AmbientVocabularyRules?.seedSliders?.(familySliders, id) || familySliders; // Same stable per-NPC variation as the editor's slider preview.
    const sliders = normalizeSliders({ ...seeded, ...(character?.sliders || {}) }); // An explicitly generated NPC table/sliders always overrides the initial variation.
    return { sliders, familyId, table: character?.table || family?.table || null, characterId: id };
  }
  function generateTable(lexicon, sliders, speakerId) {
    return window.AmbientVocabularyRules?.generateTable?.(lexicon, sliders, speakerId) || {}; // Editor and runtime use exactly the same table generator.
  }
  function rewrite(text, speakerId, random = Math.random, config = state.config, profiles = state.profiles) {
    const source = String(text ?? ''); // Original authoring stays immutable and is returned when any dependency is absent.
    const selected = optionsFor(config, speakerId, profiles);
    if (!selected || !source) return source;
    const table = selected.table || (config === state.config
      ? (state.tableCache.get(selected.characterId) || (() => {
          const generated = generateTable(config.lexicon, selected.sliders, selected.characterId); // Cached per character: no repeated generation on every bubble.
          state.tableCache.set(selected.characterId, generated);
          return generated;
        })())
      : generateTable(config.lexicon, selected.sliders, selected.characterId));
    const transformed = window.AmbientVocabularyRules?.rewriteLine?.(source, table, selected.sliders, random, selected.characterId); // Shares token-safe, one-pass rendering with the editor preview.
    if (!transformed) return source;
    const { text: output, hits, swaps } = transformed;
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
      state.tableCache.clear();
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

// Authored vocabulary substitutions for character-owned world-space dialogue only.
// Text is transformed once when AmbientDialogue.show creates a bubble; ordinary Talk never calls this.
(() => {
  'use strict';
  const CONFIG_PATH = 'config/dialogue/ambient-vocabulary.json'; // The Vocabulary tab exports this independent authored configuration.
  const PROFILE_PATH = 'config/dialogue/npc-reaction-profiles.json'; // Existing NPC-to-personality assignments supply inherited vocabulary defaults.
  const DEFAULT_SLIDERS = window.AmbientVocabularyRules?.DEFAULT_SLIDERS || Object.freeze({ verbosity: 50, color: 50, formality: 50, breadth: 70, variety: 55, frequency: 55, oldSlang: 0, simplicity: 0, nearMiss: 0 }); // Shared generator is authoritative for all nine axes; fallback only supports missing rule scripts.
  const MAX_CACHED_SPEAKERS = 128; // Bounds memory even when many unique wildlife actor IDs produce ambient text.
  const state = { config: null, profiles: null, matchPattern: null, last: null, error: null, ready: false, changed: 0, skipped: 0, tableCache: new Map() }; // Keeps one configuration, regex, and mobile-readable diagnostic snapshot.
  const normalizeSliders = value => window.AmbientVocabularyRules?.normalizeSliders?.(value) || { ...DEFAULT_SLIDERS }; // Never maintain a second slider whitelist: historical/childlike axes must survive runtime normalization.
  function optionsFor(config, speakerId, profiles) {
    const id = String(speakerId || ''); // Only real NPC IDs qualify; status and player announcements must not be rewritten.
    if (!id || id === 'player' || id.startsWith('player-') || !config || config.enabled === false) return null;
    const familyId = String(profiles?.assignments?.[id] || (/^child_[a-z0-9]+$/i.test(id) ? 'child' : '') || (/^porakaneki(?:[_:-]|$)/i.test(id) ? 'porakaneki' : '') || profiles?.defaultProfile || 'neighborly'); // Shares the established personality assignment and generated-child convention.
    const family = config.families?.[familyId] || null; // Family defaults are used unless an individual generated table overrides them.
    const character = config.characters?.[id] || null; // Explicit character settings and generated table take precedence over family defaults.
    if (!family && !character) return null;
    const familySliders = normalizeSliders({ ...DEFAULT_SLIDERS, ...(family?.sliders || {}) }); // Existing personality defines the center of the vocabulary range.
    const seeded = window.AmbientVocabularyRules?.seedSliders?.(familySliders, id) || familySliders; // Same stable per-NPC variation as the editor's slider preview.
    const sliders = normalizeSliders({ ...seeded, ...(character?.sliders || {}) }); // An explicitly generated NPC table/sliders always overrides the initial variation.
    return { sliders, familyId, character: character || null, family, characterId: id }; // Selection references stay in the central word catalog; per-NPC text copies are not retained.
  }
  function sourceMatcher(lexicon) {
    const words = Object.keys(lexicon || {}).filter(word => word.length > 0 && word.length <= 80 && !/[{}]/.test(word));
    if (!words.length) return null;
    const escape = word => word.replace(/([^\p{L}\p{N}\s])/gu, '\\$1'); // Escape editor-authored punctuation before composing a safe source-word matcher.
    words.sort((a, b) => b.length - a.length);
    return new RegExp('(^|[^\\p{L}\\p{N}_])(?:' + words.map(escape).join('|') + ')(?=$|[^\\p{L}\\p{N}_])', 'iu');
  }
  function cachedTable(characterId, create) {
    if (state.tableCache.has(characterId)) {
      const cached = state.tableCache.get(characterId);
      state.tableCache.delete(characterId);
      state.tableCache.set(characterId, cached); // Keep actively speaking NPCs in the LRU cache.
      return cached;
    }
    const compiled = create(); // One allocation per eligible speaker, not per on-screen animal or game frame.
    if (state.tableCache.size >= MAX_CACHED_SPEAKERS) state.tableCache.delete(state.tableCache.keys().next().value);
    state.tableCache.set(characterId, compiled);
    return compiled;
  }
  function rewrite(text, speakerId, random = Math.random, config = state.config, profiles = state.profiles) {
    const source = String(text ?? ''); // Original authoring stays immutable and is returned when any dependency is absent.
    const selected = optionsFor(config, speakerId, profiles);
    if (!selected || !source) return source;
    if (config === state.config && (!state.matchPattern || !state.matchPattern.test(source))) return source; // Most speech contains no configured vocabulary and skips all per-NPC generation.
    const rules = window.AmbientVocabularyRules; // Existing pure rules are shared by the game, standalone editor, and tests.
    if (!rules?.generateSelections || !rules?.resolveSelections) return source;
    const compile = () => {
      const generated = rules.generateSelections(config.lexicon, selected.sliders, selected.characterId); // One lazy generation per NPC, not one per frame or bubble.
      const legacy = selected.character?.table ? rules.migrateLegacyTable(config.lexicon, selected.character.table) : null; // Old exported tables migrate into canonical references.
      const overrides = selected.character?.selections || legacy || selected.family?.selections || null; // Explicit character checkboxes outrank inherited family choices.
      return rules.resolveSelections(config.lexicon, rules.mergeSelections(generated, overrides)); // Only ephemeral, cached render strings; never duplicated in config.
    };
    const table = config === state.config
      ? cachedTable(selected.characterId, compile)
      : compile();
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
      state.matchPattern = sourceMatcher(config.lexicon);
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
    generateTable: (lexicon, sliders, id) => window.AmbientVocabularyRules?.generateTable?.(lexicon, sliders, id) || {}, // Compatibility preview surface.
    normalizeSliders,
    reload: load,
    getDebug: () => ({ ready: state.ready, error: state.error, last: state.last, replacements: state.changed, untouchedMatches: state.skipped, wordCount: Object.keys(state.config?.lexicon || {}).length, cachedSpeakers: state.tableCache.size }),
  }); // Public surface for editor tests and the existing mobile diagnostic console.
  window.AmbientVocabulary = api;
  load();
})();

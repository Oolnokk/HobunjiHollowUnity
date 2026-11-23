// Authored vocabulary substitutions for character-owned world-space dialogue only.
// Text is transformed once when AmbientDialogue.show creates a bubble; ordinary Talk never calls this.
(() => {
  'use strict';
  const CONFIG_PATH = 'config/dialogue/ambient-vocabulary.json'; // The Vocabulary tab exports this independent authored configuration.
  const PROFILE_PATH = 'config/dialogue/npc-reaction-profiles.json'; // Existing NPC-to-personality assignments supply inherited vocabulary defaults.
  const DEFAULT_SLIDERS = window.AmbientVocabularyRules?.DEFAULT_SLIDERS || Object.freeze({ verbosity: 50, color: 50, formality: 50, breadth: 70, variety: 55, frequency: 55, oldSlang: 0, simplicity: 0, nearMiss: 0 }); // Shared generator is authoritative for all nine axes; fallback only supports missing rule scripts.
  const MAX_CACHED_SPEAKERS = 128; // Bounds memory even when many unique wildlife actor IDs produce ambient text.
  const state = { config: null, profiles: null, matchPattern: null, last: null, error: null, ready: false, changed: 0, skipped: 0, unmatched: 0, recent: [], tableCache: new Map() }; // Keeps one configuration, regex, and mobile-readable diagnostic snapshot.
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
    const traits = window.AmbientVocabularyRules?.speakerTraits?.(config, id) || { sliders: {}, dialects: [], selections: {}, phoneticPreset: null }; // A voice group adds region-specific diction without replacing the named character's personality.
    const sliders = normalizeSliders({ ...seeded, ...traits.sliders, ...(character?.sliders || {}) }); // Explicit character overrides win over a shared family dialect.
    const dialects = Array.isArray(character?.dialects) ? character.dialects : traits.dialects;
    const phoneticPreset = character?.phoneticPreset ?? traits.phoneticPreset; // Pahu's doorstep orthography remains isolated to Pahu unless explicitly assigned.
    return { sliders, familyId, character: character || null, family, traits, dialects, phoneticPreset, characterId: id };
  }
  function sourceMatcher(lexicon) {
    const words = Object.keys(lexicon || {}).filter(word => word.length > 0 && word.length <= 80 && !/[{}]/.test(word));
    if (!words.length) return null;
    const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Unicode regex must keep apostrophes unescaped for Southern contractions.
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
  function shieldSpokenNames(source, names) {
    const literals = [...new Set((Array.isArray(names) ? names : []).filter(value => typeof value === 'string')
      .map(value => value.trim()).filter(value => value.length > 0 && value.length <= 100))]
      .sort((left, right) => right.length - left.length); // Longer names win over shorter aliases in the same sentence.
    if (!literals.length) return { text: source, restore: value => value };
    const escape = value => value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&'); // Exact name spelling, never regex syntax.
    const pattern = new RegExp('(^|[^\\p{L}\\p{N}_])(' + literals.map(escape).join('|') + ')(?=$|[^\\p{L}\\p{N}_])', 'giu'); // Whole names only.
    const saved = []; // The exact proper names are restored after both the semantic and phonetic passes.
    const masked = source.replace(pattern, (whole, prefix, match) => {
      let index = saved.length; // Chooses a tag absent from the authored line so user names cannot clash with placeholders.
      while (source.includes('{{AMBIENT_VOCAB_NAME_' + index + '}}')) index++;
      const marker = '{{AMBIENT_VOCAB_NAME_' + index + '}}'; // Existing rules already protect double-brace placeholders.
      saved.push([marker, match]);
      return prefix + marker;
    });
    return { text: masked, restore: value => saved.reduce((text, [marker, name]) => text.split(marker).join(name), value) };
  }
  function rememberSpeech(result) {
    state.last = result; // Most recent attempted vocabulary pass is available in the mobile in-game diagnostics even if no word matched.
    state.recent.push(result); // The last twelve actual bubbles make intermittent greeting/pet failures inspectable without console access.
    if (state.recent.length > 12) state.recent.shift();
  }
  function rewrite(text, speakerId, random = Math.random, config = state.config, profiles = state.profiles, protectedNames = []) {
    const source = String(text ?? ''); // Original authoring stays immutable and is returned when any dependency is absent.
    const selected = optionsFor(config, speakerId, profiles);
    if (!source) return source;
    if (!selected) {
      if (speakerId && speakerId !== 'player' && !String(speakerId).startsWith('player-')) {
        rememberSpeech({ speakerId: String(speakerId), original: source, displayed: source, hits: 0, swaps: 0, phoneticSwaps: 0, reason: state.ready ? 'no-voice-profile' : 'engine-not-ready' });
      }
      return source;
    }
    const guarded = shieldSpokenNames(source, protectedNames); // Proper nouns are masked before either vocabulary pass.
    const hasLexicalMatch = config === state.config ? !!state.matchPattern?.test(guarded.text) : true; // Keeps most animal and NPC bubbles allocation-free.
    if (!hasLexicalMatch && !selected.phoneticPreset) {
      state.unmatched++; // Unmatched text never compiles an NPC table, so animal sounds remain cheap.
      rememberSpeech({ speakerId: selected.characterId, familyId: selected.familyId, original: source, displayed: source, hits: 0, swaps: 0, phoneticSwaps: 0, reason: 'no-dictionary-phrase' });
      return source;
    }
    const rules = window.AmbientVocabularyRules; // Existing pure rules are shared by the game, standalone editor, and tests.
    if (!rules?.generateSelections || !rules?.resolveSelections) return source;
    const compile = () => {
      const generated = rules.generateSelections(config.lexicon, selected.sliders, selected.characterId, selected.dialects); // Only declared regional dialects can generate Southern or West Country alternatives.
      const legacy = selected.character?.table ? rules.migrateLegacyTable(config.lexicon, selected.character.table) : null; // Previous exports still read as canonical references.
      const inherited = rules.mergeSelections(generated, selected.family?.selections);
      const regional = rules.mergeSelections(inherited, selected.traits.selections); // Shared Ginju/Pahu defaults come after ordinary personality suggestions.
      const personal = rules.mergeSelections(regional, selected.character?.selections || legacy); // Individual authored checkboxes remain authoritative.
      return rules.resolveSelections(config.lexicon, personal); // Transient strings only; the shared JSON never copies synonyms per speaker.
    };
    const table = hasLexicalMatch ? (config === state.config
      ? cachedTable(selected.characterId, compile)
      : compile()) : null; // A purely phonetic Pahu line skips semantic generation and the LRU.
    const transformed = table ? rules.rewriteLine(guarded.text, table, selected.sliders, random, selected.characterId)
      : { text: guarded.text, hits: 0, swaps: 0 };
    const phonetic = selected.phoneticPreset
      ? rules.applyPhoneticPreset(transformed.text, config, selected.phoneticPreset, selected.characterId)
      : { text: transformed.text, hits: 0, swaps: 0 }; // Doorstep-specific phonetics never touch Talk or any unassigned speaker.
    const output = guarded.restore(phonetic.text); // Recover original names before rendering or debugging.
    rememberSpeech({ speakerId: selected.characterId, familyId: selected.familyId, dialectGroup: selected.traits.groupId,
      original: source, displayed: output, hits: transformed.hits, swaps: transformed.swaps, phoneticSwaps: phonetic.swaps,
      reason: output !== source ? 'reworded' : (transformed.hits ? 'frequency-or-disabled-choice' : 'no-eligible-choice') });
    state.changed += transformed.swaps + phonetic.swaps;
    state.skipped += transformed.hits - transformed.swaps;
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
    getDebug: () => ({ ready: state.ready, error: state.error, last: state.last, replacements: state.changed, untouchedMatches: state.skipped, wordCount: Object.keys(state.config?.lexicon || {}).length, cachedSpeakers: state.tableCache.size, unmatched: state.unmatched, recent: state.recent.slice() }),
  }); // Public surface for editor tests and the existing mobile diagnostic console.
  window.AmbientVocabulary = api;
  load();
})();

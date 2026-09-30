// Character-scoped save helper.
//
// Every character-scoped save in game.js (gear, skills, perks, stable,
// equipment slots) used to repeat the same steps: parse hobunjiSaveMeta,
// find the current character by window.__hobunjiPlayerProfile.characterId,
// mutate it, write the whole meta back, and swallow storage errors. That
// shared step now lives here; each caller only supplies its mutation.
(() => {
  'use strict';

  const META_KEY = 'hobunjiSaveMeta';

  // Runs mutator(character, meta) against the current character's save
  // record and persists the result. Returns true only if it was written.
  function update(mutator) {
    try {
      const characterId = window.__hobunjiPlayerProfile?.characterId;
      if (!characterId || typeof mutator !== 'function') return false;
      const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
      if (!meta) return false;
      const character = (meta.characters || []).find(entry => entry.id === characterId);
      if (!character) return false;
      mutator(character, meta);
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      return true;
    } catch {
      return false;
    }
  }

  window.CharacterMetaSave = Object.freeze({ META_KEY, update });
})();

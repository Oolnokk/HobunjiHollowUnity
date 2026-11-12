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
  const pending = new Map(); // Progression fields waiting for an idle save, keyed by the character that earned them.
  let queued = false; // One idle callback serves all pending character updates.

  function write(characterId, mutator) {
    try {
      const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
      if (!meta) return false;
      const character = (meta.characters || []).find(entry => entry.id === characterId);
      if (!character) return false;
      const patch = pending.get(characterId); // An immediate save can include this character's queued progression.
      if (patch) Object.assign(character, patch);
      mutator?.(character, meta);
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      pending.delete(characterId);
      return true;
    } catch {
      return false;
    }
  }

  function flush() {
    for (const characterId of pending.keys()) write(characterId);
  }

  function schedule(patch) {
    const characterId = window.__hobunjiPlayerProfile?.characterId;
    if (!characterId) return;
    pending.set(characterId, Object.assign(pending.get(characterId) || {}, patch));
    if (queued) return;
    queued = true;
    const commit = () => { queued = false; flush(); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(commit, { timeout: 1500 });
    else setTimeout(commit, 100);
  }

  window.addEventListener?.('pagehide', flush);
  window.document?.addEventListener?.('visibilitychange', () => { if (window.document.hidden) flush(); });

  // Runs mutator(character, meta) against the current character's save
  // record and persists the result. Returns true only if it was written.
  function update(mutator) {
    const characterId = window.__hobunjiPlayerProfile?.characterId;
    return !!characterId && typeof mutator === 'function' && write(characterId, mutator);
  }

  window.CharacterMetaSave = Object.freeze({ META_KEY, update, schedule });
})();

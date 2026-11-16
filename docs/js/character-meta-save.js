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
  const pendingMutations = new Map(); // Keyed character-field mutations for already-folder-backed events, merged into later full captures without a huge synchronous localStorage write.
  let queued = false; // One idle callback serves all pending character updates.

  function write(characterId, mutator) {
    try {
      const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
      if (!meta) return false;
      const character = (meta.characters || []).find(entry => entry.id === characterId);
      if (!character) return false;
      const patch = pending.get(characterId); // An immediate save can include this character's queued progression.
      if (patch) Object.assign(character, patch);
      for (const change of pendingMutations.get(characterId)?.values() || []) change(character, meta); // Apply narrow pending lock-progress deltas without replacing sibling lock records.
      mutator?.(character, meta);
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      pending.delete(characterId);
      pendingMutations.delete(characterId); // Browser now contains each staged character change.
      return true;
    } catch {
      return false;
    }
  }

  function flush() {
    if (window.HobunjiSessionPersistenceStartupGuard?.exitFlushSuppressed?.()) return;
    for (const characterId of new Set([...pending.keys(), ...pendingMutations.keys()])) write(characterId);
  }

  function capturePending(meta) {
    // Folder and cloud snapshots can include live progression without writing browser storage.
    for (const character of (meta?.characters || [])) {
      const patch = pending.get(character.id); // The queue stays intact for a later browser write.
      if (patch) Object.assign(character, patch);
      for (const change of pendingMutations.get(character.id)?.values() || []) change(character, meta); // Folder snapshots always include staged, not-yet-browser-mirrored lock progress.
    }
  }

  function stageMutation(key, mutate) {
    const characterId = window.__hobunjiPlayerProfile?.characterId; // The current character owns the in-memory delta until a verified folder commit or later browser flush.
    if (!characterId || typeof key !== 'string' || !key || typeof mutate !== 'function') return false;
    let changes = pendingMutations.get(characterId); // Stable keys collapse repeated attempts at one lock rather than retaining every mutation closure.
    if (!changes) pendingMutations.set(characterId, changes = new Map());
    changes.set(key, mutate);
    return true;
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

  window.CharacterMetaSave = Object.freeze({ META_KEY, update, schedule, stageMutation, flush, capturePending });
})();

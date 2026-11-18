// Character-owned four-way picking patterns, indexed by the equipped instrument's gear key.
// Mirrors Combat.loadout's per-character persistence without involving game.js.
(() => {
  'use strict';
  if (window.InstrumentPatternLoadout) return;
  const DEFAULT_SLOTS = Object.freeze(['direct', 'arp-forward-reverse-16', 'tremolo-16', 'strum-reggae-8']); // Used for any instrument that has no saved choices.
  const SLOT_LABELS = Object.freeze(['Up', 'Right', 'Down', 'Left']); // Shown in Loadout and used by the performance cross.
  let loadoutsByInstrument = Object.create(null); // Current character's instrument-key-to-pattern assignments.
  let loadedCharacterId = null; // Prevents carrying a previous character's choices into a newly loaded character.

  function validPatternIds() {
    const patterns = window.MusicMinigame?.patternOptions?.(); // Reuses the actual gameplay pattern library when its script has loaded.
    if (!Array.isArray(patterns)) return null; // Onboarding may install the player profile before the music host is initialized; never discard saved choices during that gap.
    return new Set([...DEFAULT_SLOTS, ...patterns.map(entry => entry[0])]);
  }

  function normalizeSlots(slots) {
    const valid = validPatternIds(); // Invalid or removed library entries fall back only after the host has supplied its complete library.
    return DEFAULT_SLOTS.map((fallback, index) => {
      const candidate = Array.isArray(slots) && typeof slots[index] === 'string' ? slots[index] : null; // Preserve raw saved IDs until the music library is ready.
      return candidate && (!valid || valid.has(candidate)) ? candidate : fallback;
    });
  }

  function legacySlots() {
    try {
      const saved = JSON.parse(localStorage.getItem('musicSystemDemoSettingsV13') || 'null'); // Migrates existing global pattern choices when an instrument has not been configured yet.
      return Array.isArray(saved?.autoPickSlots) ? normalizeSlots(saved.autoPickSlots) : DEFAULT_SLOTS.slice();
    } catch (_) { return DEFAULT_SLOTS.slice(); }
  }

  function currentCharacterId() {
    return window.__hobunjiPlayerProfile?.characterId || null; // The existing character identifier used by Combat.loadout persistence.
  }

  function loadFromProfile(profile) {
    loadedCharacterId = currentCharacterId() || profile?.characterId || null;
    loadoutsByInstrument = Object.create(null);
    const source = profile?.instrumentPatternLoadout; // Per-character record, never the shared Music Lab preferences.
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    for (const [key, slots] of Object.entries(source)) {
      if (key && key !== '__proto__' && Array.isArray(slots)) loadoutsByInstrument[key] = normalizeSlots(slots);
    }
  }

  function ensureCharacter() {
    if (loadedCharacterId !== currentCharacterId()) loadFromProfile(window.__hobunjiPlayerProfile); // Supports switching saves without a page reload.
  }

  function getSlots(instrumentKey) {
    ensureCharacter();
    if (typeof instrumentKey !== 'string' || !instrumentKey.trim()) return DEFAULT_SLOTS.slice();
    return loadoutsByInstrument[instrumentKey] ? normalizeSlots(loadoutsByInstrument[instrumentKey]) : legacySlots(); // Validate loaded patterns at use time; every unconfigured instrument starts from legacy/default slots.
  }

  function serialize() {
    ensureCharacter();
    return Object.fromEntries(Object.entries(loadoutsByInstrument).map(([key, slots]) => [key, slots.slice()])); // Detached snapshot for save metadata and diagnostics.
  }

  function persist() {
    const characterId = currentCharacterId(); // Uses the same active character and metadata file as Combat.loadout.
    if (!characterId) return;
    const snapshot = serialize();
    if (window.__hobunjiPlayerProfile) window.__hobunjiPlayerProfile.instrumentPatternLoadout = snapshot;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null'); // The authoritative character metadata also holds saved weapon loadouts.
      const character = meta?.characters?.find(record => record.id === characterId);
      if (!character) return;
      character.instrumentPatternLoadout = snapshot;
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    } catch (_) {}
  }

  function setSlot(instrumentKey, index, patternId) {
    const valid = validPatternIds(); // Only the fully initialized game's real library authorizes new assignments.
    if (typeof instrumentKey !== 'string' || !instrumentKey.trim() || !Number.isInteger(index) || index < 0 || index >= 4 || !valid?.has(patternId)) return false;
    const next = getSlots(instrumentKey); // Changing one direction keeps this instrument's other directions intact.
    next[index] = patternId;
    loadoutsByInstrument[instrumentKey] = next;
    persist();
    return true;
  }

  document.addEventListener('hobunjiPlayerReady', event => loadFromProfile(event.detail));
  if (window.__hobunjiPlayerProfile) loadFromProfile(window.__hobunjiPlayerProfile);
  window.InstrumentPatternLoadout = Object.freeze({
    DEFAULT_SLOTS, SLOT_LABELS, getSlots, setSlot, serialize, loadFromProfile,
    debugState: () => ({characterId:currentCharacterId(),instrumentKey:window.MusicMinigame?.getEquippedInstrument?.() || null,loadouts:serialize()})
  });
})();

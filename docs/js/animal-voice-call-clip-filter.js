(() => {
  'use strict';

  // Restricts AudioSystem's existing per-species random voice selection to the
  // recording subset authored for the current semantic call. The underlying
  // AudioSystem remains authoritative for range, falloff, volume and preload.
  const POOL_ORDER = Object.freeze({
    'dabinggi-hound': Object.freeze(['sfx_dabinggi-hound1.ogg', 'sfx_dabinggi-hound2.ogg']),
    drenkirra: Object.freeze(['sfx_drenkirra1.ogg', 'sfx_drenkirra2.ogg']),
    'gar-wolf': Object.freeze(['sfx_gar-wolf1.ogg', 'sfx_gar-wolf2.ogg']),
    grehlr: Object.freeze(['sfx_grehlr1.ogg', 'sfx_grehlr2.ogg']),
    nelk: Object.freeze(['sfx_nelk1.ogg']),
    uumkaoii: Object.freeze(["sfx_uumkao'ii1.ogg", "sfx_uumkao'ii2.ogg"]),
  });

  const debug = {
    installed: false,
    filteredCalls: 0,
    suppressedCalls: 0,
    lastSpecies: null,
    lastMeaning: null,
    lastAllowed: null,
    lastChosen: null,
  };

  function speciesKey(c) {
    const raw = String(c?.creatureKey || c?.speciesKey || c?.species || c?.def?.key || '').toLowerCase();
    if (raw.includes('dabinggi')) return 'dabinggi-hound';
    if (raw.includes('gar-wolf')) return 'gar-wolf';
    if (raw.includes('grehlr')) return 'grehlr';
    if (raw.includes('drenkirra')) return 'drenkirra';
    if (raw.includes('uumkao')) return 'uumkaoii';
    if (raw.includes('nelk')) return 'nelk';
    return raw;
  }

  function clipKey(value) {
    const text = String(value || '');
    try {
      return decodeURIComponent(new URL(text, document.baseURI).pathname.split('/').pop() || '').toLowerCase();
    } catch (_) {
      return text.split('/').pop().toLowerCase();
    }
  }

  function normalizedAllowed(c, opts) {
    // Missing field deliberately means legacy behavior: every species clip is
    // eligible. An explicit empty array means this call type is silent.
    if (!Array.isArray(opts?.allowedClips)) return null;
    const canonical = POOL_ORDER[speciesKey(c)] || [];
    const requested = new Set(opts.allowedClips.map(clipKey).filter(Boolean));
    return canonical
      .map((name, index) => ({ name, index }))
      .filter(entry => requested.has(entry.name.toLowerCase()));
  }

  function install() {
    const audioSystem = window.AudioSystem;
    if (!audioSystem?.playAnimalVoiceUtterance) return false;
    if (audioSystem.__animalVoiceCallClipFilterInstalled) return true;

    const original = audioSystem.playAnimalVoiceUtterance;
    audioSystem.playAnimalVoiceUtterance = function filteredAnimalVoiceUtterance(c, opts = {}) {
      const allowed = normalizedAllowed(c, opts);
      if (allowed == null) return original.call(this, c, opts);

      const species = speciesKey(c);
      debug.lastSpecies = species;
      debug.lastMeaning = opts.meaning || null;
      debug.lastAllowed = allowed.map(entry => entry.name);

      if (!allowed.length) {
        debug.suppressedCalls++;
        debug.lastChosen = null;
        return false;
      }

      const canonical = POOL_ORDER[species] || [];
      if (!canonical.length) return false;
      const chosen = allowed[Math.floor(Math.random() * allowed.length)];
      debug.filteredCalls++;
      debug.lastChosen = chosen.name;

      // AudioSystem currently selects exactly one species clip with Math.random
      // synchronously before it starts/captures playback. Constraining that one
      // draw lets every existing renderer (native, WSOLA and reverb wrappers)
      // keep the correct selected URL without duplicating their audio logic.
      const nativeRandom = Math.random;
      Math.random = () => (chosen.index + 0.5) / canonical.length;
      try {
        return original.call(this, c, opts);
      } finally {
        Math.random = nativeRandom;
      }
    };
    audioSystem.__animalVoiceCallClipFilterInstalled = true;
    debug.installed = true;
    return true;
  }

  function debugSnapshot() { return { ...debug }; }

  window.AnimalVoiceCallClipFilter = { install, debugSnapshot, clipKey };
  install();
  if (typeof window.setInterval === 'function') window.setInterval(install, 250);
})();

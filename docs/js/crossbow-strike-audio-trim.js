// Removes the audible dead air at the beginning of the crossbow firing clip.
// ranged-weapons.js already triggers `rangedFire` at heavyCrossbow.fireAtFrac,
// which exactly matches heavyCrossbow.strikeFrac. Keep that combat timing intact
// and seek into the bundled recording instead of delaying/moving the fire event.
(function (global) {
  'use strict';

  const TRIM_START_S = 0.10;
  let installed = false;

  function rangedFireConfig() {
    return global.SCRATCHBONES_CONFIG?.game?.audio?.combatSfx?.rangedFire || null;
  }

  // Waits for `window.AudioSystem` the way the rest of the codebase's
  // late-global bridges do (see npc-social-inhibition-runtime.js and
  // friends): install immediately if it already exists, otherwise hook its
  // future assignment. Replaces a permanent per-frame RAF retry loop with a
  // one-time install that fires exactly once AudioSystem actually shows up
  // (see docs/architecture/runtime-frame-scheduler.md's ownership audit).
  function chainGlobal(name, patcher) {
    const current = global[name];
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current;
    const oldGet = descriptor?.get, oldSet = descriptor?.set;
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(global) : stored; },
        set(value) {
          if (oldSet) oldSet.call(global, value); else stored = value;
          const resolved = oldGet ? oldGet.call(global) : stored;
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  function install() {
    const audio = global.AudioSystem;
    if (!audio?.playSfx || audio.playSfx.__hobunjiCrossbowTrimWrapped) return !!audio?.playSfx?.__hobunjiCrossbowTrimWrapped;

    const original = audio.playSfx;
    const wrapped = function trimmedCrossbowSfx(key, ...args) {
      if (key !== 'rangedFire') return original.call(this, key, ...args);
      const cfg = rangedFireConfig();
      const originalUrl = cfg?.url;
      if (!cfg || !originalUrl) return original.call(this, key, ...args);

      // HTML media temporal fragments make the Audio element begin decoding at
      // the trimmed timestamp while preserving AudioSystem's existing master/SFX
      // volume, random pitch, overlap, and one-shot lifecycle behavior.
      const baseUrl = String(originalUrl).replace(/#t=[^#]+$/i, '');
      cfg.url = `${baseUrl}#t=${TRIM_START_S.toFixed(3)}`;
      try {
        return original.call(this, key, ...args);
      } finally {
        // playSfx/new Audio captures the URL synchronously. Restore config so no
        // caller observes a mutated global asset path after this one-shot starts.
        cfg.url = originalUrl;
      }
    };
    wrapped.__hobunjiCrossbowTrimWrapped = true;
    wrapped.__hobunjiCrossbowTrimStartS = TRIM_START_S;
    audio.playSfx = wrapped;
    installed = true;
    return true;
  }

  chainGlobal('AudioSystem', install);

  global.HobunjiCrossbowStrikeAudioTrim = {
    get installed() { return installed; },
    get trimStartS() { return TRIM_START_S; },
  };
})(window);

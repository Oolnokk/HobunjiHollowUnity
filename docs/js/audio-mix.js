// Player-facing audio mix: Master / Music / Effects volume plus "mute while
// the game is in the background".
//
// The game has no single audio owner — music, weather, footsteps, object SFX,
// creature voices, reverb and dialogue blips each create their own <audio>
// elements and/or Web Audio graphs. Rather than threading a volume multiplier
// through every one of those paths, this module sits underneath all of them:
//
//  - Every AudioContext created after this file loads gets a small bus graph
//    (effects bus + music bus -> master bus -> real destination), and its
//    `destination` property is shadowed by the effects bus, so every existing
//    `node.connect(ctx.destination)` lands on the effects bus unchanged.
//    Music code opts in to the music bus with `HobunjiAudioMix.musicDestination(ctx)`.
//  - HTMLMediaElement.volume is wrapped so an element's audible level is its
//    requested ("logical") volume x its category level. The getter keeps
//    returning the logical value, so fades that read-modify-write `.volume`
//    still behave. Elements captured by createMediaElementSource are left at
//    their logical volume because their Web Audio bus already applies the mix.
//
// Must load before any other audio code (see index.html).
(() => {
  'use strict';
  if (window.HobunjiAudioMix) return;

  const STORAGE_KEY = 'hobunji.audioMix.v1';
  const DEFAULTS = { master: 1, music: 1, effects: 1, muteUnfocused: false };
  const settings = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const key of ['master', 'music', 'effects']) {
        const value = Number(saved[key]);
        if (Number.isFinite(value)) settings[key] = Math.max(0, Math.min(1, value));
      }
      settings.muteUnfocused = saved.muteUnfocused === true;
    }
  } catch (_) {}

  let backgrounded = false; // True while the tab is hidden or the window lost focus (only matters with muteUnfocused).
  const contexts = new Set(); // AudioContexts carrying a bus graph; contexts are long-lived singletons in this game.
  const mediaRefs = new Set(); // WeakRefs to media elements whose volume this module has scaled.
  let sweepAt = 256; // Most one-shot SFX are fresh <audio> elements, so dead refs are swept as the set grows.
  const musicElements = new WeakSet();
  const routedElements = new WeakSet(); // Elements captured into Web Audio; their bus applies the mix instead.
  const logicalVolume = new WeakMap();

  const nativeVolume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');

  function effectiveMaster() {
    return settings.muteUnfocused && backgrounded ? 0 : settings.master;
  }
  function categoryLevel(category) {
    return effectiveMaster() * (category === 'music' ? settings.music : settings.effects);
  }

  // ── Web Audio buses ────────────────────────────────────────────────────
  function installBuses(ctx) {
    if (!ctx || ctx.__hobunjiMix) return;
    try {
      const realDestination = ctx.destination; // Still the native destination: the shadowing property is defined below.
      const master = ctx.createGain();
      const music = ctx.createGain();
      const effects = ctx.createGain();
      master.gain.value = effectiveMaster();
      music.gain.value = settings.music;
      effects.gain.value = settings.effects;
      music.connect(master);
      effects.connect(master);
      master.connect(realDestination);
      ctx.__hobunjiMix = { master, music, effects, realDestination };
      Object.defineProperty(ctx, 'destination', { configurable: true, get: () => effects });
      contexts.add(ctx);
    } catch (_) {
      // Leave the context untouched; it still plays at full mix.
    }
  }

  function wrapContextCtor(name) {
    const Original = window[name];
    if (typeof Original !== 'function' || Original.__hobunjiMixWrapped) return;
    class MixedAudioContext extends Original {
      constructor(...args) {
        super(...args);
        installBuses(this);
      }
    }
    MixedAudioContext.__hobunjiMixWrapped = true;
    try { window[name] = MixedAudioContext; } catch (_) {}
  }
  wrapContextCtor('AudioContext');
  wrapContextCtor('webkitAudioContext');

  const BaseCtx = window.BaseAudioContext || window.AudioContext;
  const originalCreateMediaElementSource = BaseCtx?.prototype?.createMediaElementSource;
  if (typeof originalCreateMediaElementSource === 'function') {
    BaseCtx.prototype.createMediaElementSource = function (element) {
      const node = originalCreateMediaElementSource.call(this, element);
      if (element && this.__hobunjiMix) {
        routedElements.add(element);
        applyElementVolume(element); // Drop the element-level scaling; the bus now owns it.
      }
      return node;
    };
  }

  // ── HTMLMediaElement volume ────────────────────────────────────────────
  function elementScale(element) {
    if (routedElements.has(element)) return 1;
    return categoryLevel(musicElements.has(element) ? 'music' : 'effects');
  }
  function applyElementVolume(element) {
    if (!nativeVolume) return;
    const logical = logicalVolume.has(element) ? logicalVolume.get(element) : nativeVolume.get.call(element);
    const next = Math.max(0, Math.min(1, logical * elementScale(element)));
    if (Math.abs(nativeVolume.get.call(element) - next) > 1e-4) nativeVolume.set.call(element, next);
  }
  function track(element) {
    if (element.__hobunjiMixTracked) return;
    element.__hobunjiMixTracked = true;
    if (!logicalVolume.has(element)) logicalVolume.set(element, nativeVolume.get.call(element));
    if (typeof WeakRef !== 'function') return; // Without WeakRef, skip live re-scaling rather than pin every element in memory.
    mediaRefs.add(new WeakRef(element));
    if (mediaRefs.size > sweepAt) {
      for (const ref of mediaRefs) if (!ref.deref()) mediaRefs.delete(ref);
      sweepAt = Math.max(256, mediaRefs.size * 2); // Amortized O(1) per tracked element.
    }
  }

  if (nativeVolume?.get && nativeVolume?.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
      configurable: true,
      enumerable: nativeVolume.enumerable,
      get() {
        return logicalVolume.has(this) ? logicalVolume.get(this) : nativeVolume.get.call(this);
      },
      set(value) {
        const numeric = Number(value);
        // Let the native setter throw on out-of-range values exactly as before.
        if (!(numeric >= 0 && numeric <= 1)) { nativeVolume.set.call(this, value); return; }
        logicalVolume.set(this, numeric);
        track(this);
        applyElementVolume(this);
      },
    });
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      track(this);
      applyElementVolume(this);
      return originalPlay.apply(this, args);
    };
  }

  // ── Applying changes ───────────────────────────────────────────────────
  function applyAll() {
    for (const ctx of contexts) {
      const mix = ctx.__hobunjiMix;
      const now = ctx.currentTime;
      for (const [node, value] of [[mix.master, effectiveMaster()], [mix.music, settings.music], [mix.effects, settings.effects]]) {
        try { node.gain.setTargetAtTime(value, now, 0.03); } catch (_) { node.gain.value = value; }
      }
    }
    for (const ref of mediaRefs) {
      const element = ref.deref();
      if (!element) { mediaRefs.delete(ref); continue; }
      applyElementVolume(element);
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  function setLevel(key, value) {
    if (!['master', 'music', 'effects'].includes(key)) return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    settings[key] = Math.max(0, Math.min(1, numeric));
    save();
    applyAll();
  }

  function setMuteUnfocused(enabled) {
    settings.muteUnfocused = !!enabled;
    save();
    applyAll();
  }

  function updateBackgrounded() {
    const next = document.hidden || !document.hasFocus();
    if (next === backgrounded) return;
    backgrounded = next;
    if (settings.muteUnfocused) applyAll();
  }
  document.addEventListener('visibilitychange', updateBackgrounded);
  window.addEventListener('blur', updateBackgrounded);
  window.addEventListener('focus', updateBackgrounded);

  function markMusic(element) {
    if (!element || typeof element !== 'object' || musicElements.has(element)) return;
    musicElements.add(element);
    if (element instanceof HTMLMediaElement) applyElementVolume(element);
  }

  function musicDestination(ctx) {
    return ctx?.__hobunjiMix?.music || ctx?.destination;
  }

  // ── Settings UI (Settings → Audio) ─────────────────────────────────────
  function bindSettingsUi() {
    for (const key of ['master', 'music', 'effects']) {
      const slider = document.getElementById(`settingAudio${key[0].toUpperCase()}${key.slice(1)}`);
      const label = document.getElementById(`settingAudio${key[0].toUpperCase()}${key.slice(1)}Value`);
      if (!slider || slider.__hobunjiMixBound) continue;
      slider.__hobunjiMixBound = true;
      const render = () => {
        const pct = Math.round(settings[key] * 100);
        if (slider.value !== String(pct)) slider.value = String(pct);
        if (label && label.textContent !== `${pct}%`) label.textContent = `${pct}%`;
      };
      slider.addEventListener('input', () => { setLevel(key, Number(slider.value) / 100); render(); });
      render();
    }
    const mute = document.getElementById('settingAudioMuteUnfocused');
    if (mute && !mute.__hobunjiMixBound) {
      mute.__hobunjiMixBound = true;
      mute.checked = settings.muteUnfocused;
      mute.addEventListener('change', () => setMuteUnfocused(mute.checked));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindSettingsUi, { once: true });
  else bindSettingsUi();

  window.HobunjiAudioMix = {
    get settings() { return { ...settings }; },
    setLevel,
    setMuteUnfocused,
    markMusic,
    musicDestination,
    categoryLevel,
    bindSettingsUi,
    debug: () => ({ contexts: contexts.size, trackedMedia: mediaRefs.size, backgrounded, ...settings }),
  };
})();

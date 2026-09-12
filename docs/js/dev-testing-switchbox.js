// Dev Testing Switchbox — dev-only performance kill switches for whatever
// expensive system doesn't matter for the thing currently being tested.
// Lives entirely in this one file: reads/writes its own localStorage-backed
// flags, patches a couple of shared browser/engine primitives so it doesn't
// have to chase every call site of the systems it turns off, and renders its
// own toggle row inside the existing Dev Tools panel (#devSpawnPanel, opened
// via the 🐾 button, itself already gated behind Settings' Dev Mode switch).
//
// Every flag here takes effect on the next page load, not live — a toggle
// click persists the new value and reloads immediately (same pattern as
// Settings' "Load from local folder" button). That keeps each gated system
// simple: it only has to check its flag once, at boot, instead of on every
// call.
//
// Must load after js/audio-system.js, js/water-system.js and
// js/foliage-generator.js (whose exported functions it wraps) and before
// game.js (whose own boot calls into all three) — see index.html's script
// order, right before the game.js tag.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunji_dev_switchbox_v1';

  // Order here is also the on-screen button order.
  const SWITCHES = Object.freeze({
    noAudio: {
      label: '🔇 Audio',
      hint: 'Mutes every game sound — SFX, footsteps, ambience, animal voices, music.',
    },
    noNpcBehavior: {
      label: '🚶 NPC & Creature AI',
      hint: 'Freezes villager schedules/pathing and all wildlife/bandit AI, spawning, and corpse cleanup.',
    },
    noWaterSim: {
      label: '💧 Water Simulation',
      hint: 'Skips the periodic water-level recompute (rain fill/drainage).',
    },
    lowPolyFoliage: {
      label: '🧊 Low-Poly Foliage',
      hint: 'Replaces newly generated trees/bushes/boulders/stumps with plain box placeholders.',
    },
  });

  function readFlags() {
    const flags = Object.fromEntries(Object.keys(SWITCHES).map(key => [key, false]));
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed) for (const key of Object.keys(SWITCHES)) if (typeof parsed[key] === 'boolean') flags[key] = parsed[key];
    } catch (_) {}
    return flags;
  }

  const flags = readFlags();
  function saveFlags() {
    try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(flags)); } catch (_) {}
  }

  function setFlag(name, value) {
    if (!(name in SWITCHES) || flags[name] === !!value) return;
    flags[name] = !!value;
    saveFlags();
    location.reload();
  }

  window.DevTestingSwitchbox = Object.freeze({
    flags, // Read directly (e.g. window.DevTestingSwitchbox.flags.noNpcBehavior) by the couple of per-frame checks in game.js that can't be patched from outside.
    SWITCHES,
    setFlag,
  });

  // ── 🔇 Audio ─────────────────────────────────────────────────────────
  // Rather than gate every play*() call across the several separate sound
  // modules (AudioSystem, HobunjiAmbientBgs, AnimalVocalizations, ambient
  // dialogue, music-system...), patch the two browser primitives every one
  // of them ultimately plays through: HTMLMediaElement.play() covers every
  // pooled/one-shot <audio> element (footsteps, object/combat SFX, voices,
  // music), and BaseAudioContext.createGain() covers the Web Audio synth
  // fallbacks (oscillator-based footsteps/attacks) — every gain node this
  // codebase creates sits between its signal and ctx.destination, so forcing
  // each one's value to (and pinned at) 0 silences that whole chain.
  if (flags.noAudio) {
    try {
      if (window.HTMLMediaElement) {
        window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      }
      const gainProto = window.BaseAudioContext?.prototype || window.AudioContext?.prototype;
      if (gainProto && typeof gainProto.createGain === 'function') {
        const nativeCreateGain = gainProto.createGain;
        gainProto.createGain = function (...args) {
          const node = nativeCreateGain.apply(this, args);
          node.gain.value = 0;
          const nativeSetValueAtTime = node.gain.setValueAtTime?.bind(node.gain);
          if (nativeSetValueAtTime) node.gain.setValueAtTime = (_v, t) => nativeSetValueAtTime(0, t);
          const nativeLinearRamp = node.gain.linearRampToValueAtTime?.bind(node.gain);
          if (nativeLinearRamp) node.gain.linearRampToValueAtTime = (_v, t) => nativeLinearRamp(0, t);
          const nativeExpRamp = node.gain.exponentialRampToValueAtTime?.bind(node.gain);
          if (nativeExpRamp) node.gain.exponentialRampToValueAtTime = (_v, t) => nativeExpRamp(0.0001, t);
          return node;
        };
      }
    } catch (err) {
      console.warn('[Testing Switchbox] audio mute patch failed', err);
    }
  }

  // ── 💧 Water Simulation ─────────────────────────────────────────────
  // recomputeWater is the periodic flood-fill/drainage pass (see game.js's
  // gameLoop, ticked every 1/8 game-hour) — every caller fires it and
  // ignores the return value, so a plain no-op is a safe stand-in. The
  // lighter per-frame mesh sync (updateTownWaterMeshes/updateZoneWaterMeshes)
  // is left alone so existing water tiles keep rendering normally.
  if (flags.noWaterSim && window.WaterSystem && typeof window.WaterSystem.recomputeWater === 'function') {
    window.WaterSystem.recomputeWater = function () {};
  }

  // ── 🧊 Low-Poly Foliage ──────────────────────────────────────────────
  // FoliageGenerator's public API is a set of buildXMesh(col, row, ...)
  // factories that each return a fresh THREE.Group at local-origin, which
  // the caller then positions/scales — swapping the return value for a
  // simple box costs nothing at every call site. Real trees can carry
  // gameplay metadata (userData.canopyLocal for camera-occlusion, a named
  // climbBranch mesh for ClimbSystem) but every reader of those already
  // treats them as optional, so a plain placeholder with none of it is safe.
  if (flags.lowPolyFoliage && window.FoliageGenerator) {
    const material = new THREE.MeshLambertMaterial({ color: 0x6fae52 });
    // Rough per-preset footprint so e.g. a boulder placeholder doesn't read as
    // a sapling — exact size doesn't matter, this is a spatial stand-in.
    const SIZE_BY_METHOD = {
      buildBoulderMesh: [0.8, 0.6, 0.8],
      buildStumpMesh: [0.5, 0.35, 0.5],
      buildWeedsMesh: [0.35, 0.3, 0.35],
      buildShrubMesh: [0.5, 0.5, 0.5],
      buildWildernessBushMesh: [0.5, 0.5, 0.5],
      buildNeedlegrainMesh: [0.3, 0.6, 0.3],
      buildHeftrootMesh: [0.3, 0.5, 0.3],
    };
    const DEFAULT_SIZE = [0.55, 1.6, 0.55]; // Trees (crowned pine / shadewood / jungle tree) and anything unlisted.

    function placeholderGroup(size) {
      const [w, h, d] = size;
      const group = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      box.position.y = h / 2; // Base-anchored at local origin, matching the real meshes it replaces.
      box.castShadow = true;
      group.add(box);
      return group;
    }

    for (const methodName of Object.keys(window.FoliageGenerator)) {
      if (!/^build.*Mesh$/.test(methodName) || typeof window.FoliageGenerator[methodName] !== 'function') continue;
      const size = SIZE_BY_METHOD[methodName] || DEFAULT_SIZE;
      window.FoliageGenerator[methodName] = () => placeholderGroup(size);
    }
  }

  // ── Dev Tools panel wiring ───────────────────────────────────────────
  // The panel markup (#devSwitchboxGrid) lives in index.html next to the
  // rest of #devSpawnPanel's dev-only controls; this only needs to paint
  // each button's on/off state and bind its click.
  function renderSwitchButton(btn, name) {
    const on = !!flags[name];
    btn.textContent = `${SWITCHES[name].label}: ${on ? 'OFF' : 'Running'}`;
    btn.classList.toggle('fed-active', on);
    btn.title = SWITCHES[name].hint;
    btn.setAttribute('aria-pressed', String(on));
  }

  function installSwitchboxUI() {
    const grid = document.getElementById('devSwitchboxGrid');
    if (!grid || grid.dataset.switchboxBound) return;
    grid.dataset.switchboxBound = '1';
    for (const name of Object.keys(SWITCHES)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fed-btn';
      btn.dataset.switch = name;
      renderSwitchButton(btn, name);
      btn.addEventListener('click', () => setFlag(name, !flags[name]));
      grid.appendChild(btn);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSwitchboxUI, { once: true });
  else installSwitchboxUI();
})();

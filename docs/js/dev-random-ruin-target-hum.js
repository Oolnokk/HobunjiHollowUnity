// Proximity hum for Random Test Ruin projectile targets.
//
// Every unstruck projectile target — glyphs hidden in pillars and walls
// (js/dev-random-ruin-hit-puzzles.js), ceiling glyphs and composer targets
// such as the ceiling-rail targets (js/dev-random-ruin-simple-puzzles.js) —
// hums softly. The volume falls off very steeply with distance (a quartic
// curve over HUM_RADIUS) and is panned left/right from the camera, so a
// hidden target is found by walking toward the hum rather than checking
// every pillar. A struck target falls silent.
//
// Registered as a simple-puzzle composer only for its per-frame update (which
// runs only inside the ruin) and its clear() when the ruin is left.
(() => {
  'use strict';

  const SimplePuzzles = window.DevRandomRuinSimplePuzzles;
  if (!window.THREE || !SimplePuzzles?.registerComposer) return;

  const HUM_RADIUS = 6.5; // Silent beyond this many world units.
  const FALLOFF_POWER = 4; // (1 - d / radius)^4: ~50% at 1u, ~23% at 2u, ~8% at 3u, ~2% at 4u.
  const MAX_GAIN = .16;
  const MAX_VOICES = 4; // Nearest targets only.
  const EAR_HEIGHT = 1.1;
  const TONES = [174.6, 196.0, 220.0, 261.6, 293.7]; // Neighbouring targets get different pitches.
  const LIST_REFRESH_MS = 500;

  let ctx = null, master = null;
  const voices = new Map(); // target object -> voice
  let targets = [], listedAt = -Infinity;
  const scratch = { p:new THREE.Vector3(), right:new THREE.Vector3(), box:new THREE.Box3() };
  const glyphCenters = new WeakMap(); // Static hidden glyphs: centre measured once.

  function audioVolume() {
    const audio = window.AudioSystem?.gameAudioConfig?.() || {};
    if (audio.enabled === false) return 0;
    return Math.max(0, Math.min(1, Number(audio.sfxVolume ?? 1)));
  }

  function ensureContext() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume?.().catch(() => {}); return ctx; }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    } catch (_) { ctx = null; }
    return ctx;
  }

  function createVoice(toneIndex) {
    const now = ctx.currentTime, freq = TONES[toneIndex % TONES.length];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 900;
    const oscillators = [];
    const partial = (type, f, level) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type; osc.frequency.value = f; g.gain.value = level;
      osc.connect(g).connect(filter);
      osc.start(now);
      oscillators.push(osc);
    };
    partial('sine', freq, .55);
    partial('sine', freq * 1.006, .4); // Slow beating gives the hum its throb.
    partial('triangle', freq * 2, .12);
    const tremolo = ctx.createOscillator(), depth = ctx.createGain(), body = ctx.createGain();
    tremolo.frequency.value = 5.5; depth.gain.value = .25; body.gain.value = .75;
    tremolo.connect(depth).connect(body.gain);
    tremolo.start(now);
    oscillators.push(tremolo);
    filter.connect(body).connect(gain);
    if (pan) gain.connect(pan).connect(master); else gain.connect(master);
    return { gain, pan, oscillators, level:0 };
  }

  function stopVoice(voice) {
    if (!voice || !ctx) return;
    const now = ctx.currentTime;
    voice.gain.gain.setTargetAtTime(0, now, .05);
    for (const osc of voice.oscillators) { try { osc.stop(now + .3); } catch (_) {} }
    setTimeout(() => { try { voice.gain.disconnect(); voice.pan?.disconnect(); } catch (_) {} }, 400);
  }

  function clear() {
    for (const voice of voices.values()) stopVoice(voice);
    voices.clear();
    targets = [];
    listedAt = -Infinity;
  }

  function refreshTargets(now) {
    if (now - listedAt < LIST_REFRESH_MS) return;
    listedAt = now;
    const list = [];
    for (const circuit of window.DevRandomRuinHitPuzzles?.getGlyphCircuits?.() || []) {
      for (const target of circuit.targets || []) list.push({ object:target.object, active:!!target.active, record:target, glyph:true });
    }
    for (const target of SimplePuzzles.listProjectileTargets?.() || []) list.push({ object:target.object, active:!!target.active, glyph:false });
    targets = list.filter(entry => entry.object);
  }

  function targetPosition(entry, out) {
    if (entry.glyph) { // Hidden glyphs never move: centre of the hit box (reaches the room-facing rune) or of the glyph itself.
      let center = glyphCenters.get(entry.object);
      if (!center) {
        const box = entry.record?.hitBox || scratch.box.setFromObject(entry.object);
        center = box.isEmpty?.() ? entry.object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
        glyphCenters.set(entry.object, center);
      }
      return out.copy(center);
    }
    return entry.object.getWorldPosition(out);
  }

  function update(kit, now) {
    refreshTargets(now);
    const player = kit.playerWorld();
    const volume = audioVolume();
    const heard = [];
    if (player && volume > 0) {
      for (let i = 0; i < targets.length; i++) {
        const entry = targets[i];
        const active = entry.glyph ? !!entry.record?.active : entry.active;
        if (active || !entry.object.parent) continue;
        const p = targetPosition(entry, scratch.p);
        const d = Math.hypot(p.x - player.x, p.y - (player.y + EAR_HEIGHT), p.z - player.z);
        if (d < HUM_RADIUS) heard.push({ entry, index:i, d, x:p.x, z:p.z });
      }
    }
    heard.sort((a, b) => a.d - b.d);
    const keep = new Set(heard.slice(0, MAX_VOICES).map(item => item.entry.object));
    for (const [object, voice] of voices) if (!keep.has(object)) { stopVoice(voice); voices.delete(object); }
    if (!keep.size || !ensureContext()) return;
    const camera = window.DevRandomRuinInteractions?.activeCamera?.();
    if (camera) scratch.right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const t = ctx.currentTime;
    for (const item of heard.slice(0, MAX_VOICES)) {
      let voice = voices.get(item.entry.object);
      if (!voice) { voice = createVoice(item.index); voices.set(item.entry.object, voice); }
      // Live hit-state check for composer targets between list refreshes.
      if (!item.entry.glyph && item.entry.object.visible === false) { voice.gain.gain.setTargetAtTime(0, t, .04); continue; }
      const level = MAX_GAIN * volume * Math.pow(Math.max(0, 1 - item.d / HUM_RADIUS), FALLOFF_POWER);
      voice.gain.gain.setTargetAtTime(level, t, .06);
      voice.level = level;
      if (voice.pan && camera) {
        const dx = item.x - player.x, dz = item.z - player.z, len = Math.hypot(dx, dz) || 1;
        const side = (dx * scratch.right.x + dz * scratch.right.z) / len;
        voice.pan.pan.setTargetAtTime(Math.max(-.85, Math.min(.85, side)), t, .06);
      }
    }
  }

  function snapshot() {
    return { targets:targets.length, voices:[...voices.values()].map(voice => +voice.level.toFixed(4)), radius:HUM_RADIUS };
  }

  SimplePuzzles.registerComposer({ id:'targetHum', update, snapshot, clear });
  window.DevRandomRuinTargetHum = Object.freeze({ snapshot, HUM_RADIUS, FALLOFF_POWER });
})();

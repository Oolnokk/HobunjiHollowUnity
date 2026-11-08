// GameFeel — shared impact/juice layer: camera shake, melee hit-stop, hurt
// flash, the ruin "puzzle solved" chime and the reveal camera that pans to
// whatever a solve set in motion.
//
// Ownership:
//   * Camera position stays owned by game.js's updateCameraPosition(). Shake
//     is a pure presentation offset added at the RuntimeFrameScheduler
//     'pre-render' checkpoint and removed again in 'post-game', so camera
//     smoothing/collision never sees it.
//   * Hit-stop is a short time-scale on gameLoop's dt (game.js asks
//     GameFeel.frameDt(dt)); nothing else is paused.
//   * The reveal shot goes through CinematicCameraRuntime.activate() (the
//     same owner dialogue shots use) and a CharacterActionLocks token, so
//     the player cannot walk off-screen while the camera is away.
//
// Inputs (all optional; missing systems simply disable that effect):
//   CombatAttackEvents 'hit'           -> hit-stop + small shake
//   WorldEvents 'blast'                -> distance-scaled shake
//   GameFeel.playerHurt(amount)        -> called from game.js damagePlayer
//   GameFeel.puzzleSolved()            -> called by RuinInteractionAudio
//   GameFeel.mechanismMoved(object)    -> called by RuinInteractionAudio
//
// Players who dislike screen shake: Settings toggle writes
// localStorage 'hobunjiScreenShake' = '0'.
(() => {
  'use strict';

  const SHAKE_KEY = 'hobunjiScreenShake';
  const MAX_OFFSET = 0.16; // World units at trauma 1.
  const MAX_ROLL = 0.022; // Radians at trauma 1.
  const TRAUMA_DECAY = 1.9; // Trauma lost per second.
  const HIT_STOP_SCALE = 0.07; // Simulation speed while a hit-stop is held.
  const REVEAL_WINDOW_MS = 1900; // A mechanism must start moving this soon after a solve to count as "what the solve opened".
  const REVEAL_HOLD_MS = 2300; // Total time the reveal shot owns the camera.
  const REVEAL_BLEND_S = 0.65;
  const RUIN_MAP_ID = 'map_i_dev_random_ruin';

  let deps = null;
  let trauma = 0;
  let shakeTime = 0;
  let hitStopUntil = 0;
  let applied = false;
  const savedPosition = { x: 0, y: 0, z: 0 };
  let savedRoll = 0;
  let scratchVec = null, scratchVec2 = null, scratchBox = null;
  let solvedAt = -Infinity;
  let revealConsumed = true;
  let reveal = null; // { lockToken, endsAt, timer }
  let lastRumbleAt = 0;
  let flashEl = null, flashTimer = 0;
  let audioCtx = null;
  const debug = { shakes: 0, hitStops: 0, reveals: 0, revealSkipped: null, chimes: 0, hurtFlashes: 0, lastTrauma: 0 };

  function shakeEnabled() {
    try { return localStorage.getItem(SHAKE_KEY) !== '0'; } catch (_) { return true; }
  }
  function setShakeEnabled(on) {
    try { localStorage.setItem(SHAKE_KEY, on ? '1' : '0'); } catch (_) {}
    if (!on) trauma = 0;
  }

  // ── Shake ──────────────────────────────────────────────────────────────
  function addTrauma(amount) {
    const a = Math.max(0, Number(amount) || 0);
    if (!a || !shakeEnabled()) return;
    trauma = Math.min(1, trauma + a);
    debug.shakes++; debug.lastTrauma = trauma;
  }
  // Smooth pseudo-noise: three incommensurate sines per axis stay coherent
  // frame to frame (unlike Math.random jitter, which reads as video noise).
  function wobble(t, seed) {
    return (Math.sin(t * 31.7 + seed) * 0.5 + Math.sin(t * 17.3 + seed * 2.1) * 0.33 + Math.sin(t * 47.9 + seed * 3.7) * 0.17);
  }
  function applyShake() {
    applied = false;
    const camera = deps?.getCamera?.();
    if (!camera || trauma <= 0.001) { trauma = Math.max(0, trauma); return; }
    if (window.CinematicCameraRuntime?.isActive?.() && !reveal) return; // Authored dialogue framing stays exact.
    const shake = trauma * trauma;
    const t = shakeTime;
    savedPosition.x = camera.position.x; savedPosition.y = camera.position.y; savedPosition.z = camera.position.z;
    savedRoll = camera.rotation.z;
    if (!scratchVec) { scratchVec = new THREE.Vector3(); scratchVec2 = new THREE.Vector3(); }
    // Offset in camera space so shake is always "screen" shake whatever the view direction.
    scratchVec.set(wobble(t, 1.3) * MAX_OFFSET * shake, wobble(t, 4.1) * MAX_OFFSET * shake, 0).applyQuaternion(camera.quaternion);
    camera.position.add(scratchVec);
    camera.rotation.z += wobble(t, 7.7) * MAX_ROLL * shake;
    camera.updateMatrixWorld(true);
    applied = true;
  }
  function restoreShake() {
    if (!applied) return;
    applied = false;
    const camera = deps?.getCamera?.();
    if (!camera) return;
    camera.position.set(savedPosition.x, savedPosition.y, savedPosition.z);
    camera.rotation.z = savedRoll;
    camera.updateMatrixWorld(true);
  }
  function tick(dt) {
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    shakeTime += step;
    if (trauma > 0) trauma = Math.max(0, trauma - TRAUMA_DECAY * step);
    if (reveal && performance.now() >= reveal.endsAt) endReveal('timeout');
    tickSinking(performance.now());
  }

  // ── Sinking stone (gates/doors that used to pop out of existence) ──────
  // Presentation only: callers keep owning collision. The object slides down
  // by its own height with an ease-in, then hides and is restored to its
  // original Y so a later re-block shows it in place again.
  const sinking = new Map(); // object -> { baseY, depth, start, ms }
  function sinkAway(object, options = {}) {
    if (!object?.isObject3D && !object?.position) return false;
    cancelSink(object);
    let depth = Number(options.depth);
    if (!(depth > 0)) {
      try {
        if (!scratchBox) scratchBox = new THREE.Box3();
        object.updateWorldMatrix?.(true, true);
        scratchBox.setFromObject(object);
        depth = scratchBox.isEmpty() ? 2 : (scratchBox.max.y - scratchBox.min.y);
      } catch (_) { depth = 2; }
    }
    sinking.set(object, { baseY: object.position.y, depth: depth + 0.05, start: performance.now(), ms: Math.max(150, Number(options.ms) || 700) });
    object.visible = true;
    addTrauma(0.12);
    return true;
  }
  function cancelSink(object) {
    const rec = sinking.get(object);
    if (!rec) return false;
    object.position.y = rec.baseY;
    sinking.delete(object);
    return true;
  }
  function tickSinking(now) {
    if (!sinking.size) return;
    for (const [object, rec] of sinking) {
      const t = Math.min(1, (now - rec.start) / rec.ms);
      object.position.y = rec.baseY - rec.depth * t * t; // Ease-in: heavy stone starts slow, then drops.
      if (t >= 1 || !object.parent) {
        object.visible = false;
        object.position.y = rec.baseY;
        sinking.delete(object);
      }
    }
  }

  // ── Hit-stop ───────────────────────────────────────────────────────────
  function hitStop(seconds) {
    const s = Math.max(0, Math.min(0.14, Number(seconds) || 0));
    if (!s || reveal) return;
    hitStopUntil = Math.max(hitStopUntil, performance.now() + s * 1000);
    debug.hitStops++;
  }
  function frameDt(dt) {
    tick(dt);
    return performance.now() < hitStopUntil ? dt * HIT_STOP_SCALE : dt;
  }

  // ── Hurt flash ─────────────────────────────────────────────────────────
  function ensureFlash() {
    if (flashEl || typeof document === 'undefined' || !document.body) return flashEl;
    flashEl = document.createElement('div');
    flashEl.id = 'gameFeelHurtFlash';
    flashEl.setAttribute('aria-hidden', 'true');
    flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;opacity:0;'
      + 'background:radial-gradient(ellipse at center, rgba(160,0,0,0) 45%, rgba(170,10,10,.55) 100%);'
      + 'transition:opacity .42s ease-out;';
    document.body.appendChild(flashEl);
    return flashEl;
  }
  function hurtFlash(strength) {
    const el = ensureFlash();
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = String(Math.max(0.35, Math.min(1, strength)));
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.style.transition = 'opacity .42s ease-out'; el.style.opacity = '0'; }, 70);
    debug.hurtFlashes++;
  }
  function playerHurt(amount) {
    const a = Math.max(0, Number(amount) || 0);
    if (!a) return;
    const maxHp = Math.max(1, Number(deps?.getPlayer?.()?.maxHealth) || 100);
    const frac = Math.min(1, a / maxHp);
    addTrauma(0.32 + frac * 1.2);
    hitStop(0.05 + frac * 0.08);
    hurtFlash(0.55 + frac * 2);
  }

  // ── Solve chime (original motif; synthesized so it needs no asset) ────
  function audioContext() {
    if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { audioCtx = new Ctx(); } catch (_) { audioCtx = null; }
    return audioCtx;
  }
  function sfxVolume() {
    const cfg = window.AudioSystem?.gameAudioConfig?.() || {};
    if (cfg.enabled === false) return 0;
    return Math.max(0, Math.min(1.5, Number(cfg.sfxVolume ?? 1)));
  }
  function bell(ctx, out, freq, at, length, gain) {
    for (const [mul, g] of [[1, 1], [2.01, 0.28], [3.02, 0.09]]) { // Slightly inharmonic partials give a struck-stone bell rather than a pure beep.
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = mul === 1 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq * mul, at);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(gain * g, at + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.connect(env); env.connect(out);
      osc.start(at); osc.stop(at + length + 0.05);
    }
  }
  function solveChime() {
    const vol = sfxVolume();
    if (vol <= 0) return false;
    const ctx = audioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    const out = ctx.createGain();
    out.gain.value = 0.16 * vol;
    out.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.05;
    // Rising open-fifth figure that lands on a held major-sixth shimmer.
    const notes = [[587.33, 0], [880.0, 0.11], [783.99, 0.22], [1174.66, 0.33], [987.77, 0.47]];
    notes.forEach(([f, dt], i) => bell(ctx, out, f, t0 + dt, i === notes.length - 1 ? 1.6 : 0.55, i === notes.length - 1 ? 0.9 : 0.7));
    bell(ctx, out, 1479.98, t0 + 0.47, 1.4, 0.25);
    debug.chimes++;
    return true;
  }

  // ── Letterbox (reveal shots only; DOM writes happen on start/end, never per frame) ──
  let bars = null;
  function letterbox(on) {
    if (typeof document === 'undefined' || !document.body) return;
    if (!bars) {
      bars = ['top', 'bottom'].map(side => {
        const el = document.createElement('div');
        el.className = 'game-feel-letterbox';
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = `position:fixed;left:0;right:0;${side}:0;height:11vh;background:#000;pointer-events:none;z-index:41;`
          + `transform:translateY(${side === 'top' ? '-100%' : '100%'});transition:transform .45s cubic-bezier(.2,.8,.2,1);`;
        document.body.appendChild(el);
        return { el, side };
      });
    }
    for (const { el, side } of bars) el.style.transform = on ? 'translateY(0)' : `translateY(${side === 'top' ? '-100%' : '100%'})`;
  }

  // One rising bell per partial success (glyph 2/3, brazier 4/6): you can
  // hear you are on the right track before the full solve motif plays.
  const PROGRESS_SCALE = [587.33, 659.25, 739.99, 880.0, 987.77]; // D major pentatonic.
  function progressNote(step, total) {
    const vol = sfxVolume();
    if (vol <= 0) return false;
    const ctx = audioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    const n = Math.max(1, Math.floor(Number(step) || 1));
    const t = Math.max(n, Math.floor(Number(total) || n));
    const index = Math.round((n - 1) / Math.max(1, t - 1) * (Math.min(t, 8) - 1)); // Spread any total across at most 8 rungs so long chains still climb.
    const freq = PROGRESS_SCALE[index % PROGRESS_SCALE.length] * Math.pow(2, Math.floor(index / PROGRESS_SCALE.length));
    const out = ctx.createGain();
    out.gain.value = 0.13 * vol;
    out.connect(ctx.destination);
    bell(ctx, out, freq, ctx.currentTime + 0.02, 0.7, 0.8);
    debug.progressNotes = (debug.progressNotes || 0) + 1;
    return true;
  }

  // ── Reveal camera ──────────────────────────────────────────────────────
  function inRuin() { return deps?.getCurrentArea?.() === RUIN_MAP_ID; }
  function objectCenter(object) {
    if (!object?.isObject3D) return null;
    if (!scratchBox) scratchBox = new THREE.Box3();
    if (!scratchVec) { scratchVec = new THREE.Vector3(); scratchVec2 = new THREE.Vector3(); }
    try {
      object.updateWorldMatrix?.(true, true);
      scratchBox.setFromObject(object);
      if (scratchBox.isEmpty()) return null;
      const c = scratchBox.getCenter(new THREE.Vector3());
      const size = scratchBox.getSize(scratchVec2);
      return { center: c, span: Math.max(size.x, size.y, size.z) };
    } catch (_) { return null; }
  }
  function playerWorld() {
    const p = deps?.getPlayer?.();
    const T = Number(deps?.TILE) || 0;
    if (!p || !T) return null;
    return { x: p.x / T, y: Number(deps.getPlayerWorldY?.()) || 0, z: p.y / T };
  }
  function alreadyOnScreen(center, player) {
    const camera = deps?.getCamera?.();
    if (!camera) return false;
    const d = Math.hypot(center.x - player.x, center.z - player.z);
    if (d > 8) return false; // Far away things are worth showing even when technically in frame.
    const ndc = center.clone().project(camera);
    return ndc.z < 1 && Math.abs(ndc.x) < 0.75 && Math.abs(ndc.y) < 0.75;
  }
  function beginReveal(object, options = {}) {
    const why = (() => {
      if (!inRuin()) return 'not-in-ruin';
      if (reveal) return 'already-revealing';
      if (deps?.isPlayerInCombat?.()) return 'combat';
      if (window.CinematicCameraRuntime?.isActive?.()) return 'cinematic-active';
      if (!window.CinematicCameraRuntime?.activate) return 'no-cinematic-runtime';
      return null;
    })();
    if (why) { debug.revealSkipped = why; return false; }
    const info = objectCenter(object);
    const player = playerWorld();
    if (!info || !player) { debug.revealSkipped = 'no-geometry'; return false; }
    if (alreadyOnScreen(info.center, player)) { debug.revealSkipped = 'on-screen'; return false; }
    if (Math.hypot(info.center.x - player.x, info.center.z - player.z) > 40 || Math.abs(info.center.y - player.y) > 14) { debug.revealSkipped = 'too-far'; return false; } // Different wing/floor: the toast already explains it.
    const target = info.center;
    // Stand between the player and the mechanism, raised, looking at the
    // mechanism: the shot keeps a sense of "it's over there" from where you are.
    let dx = player.x - target.x, dz = player.z - target.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist; dz /= dist;
    const back = Math.min(dist * 0.8, Math.max(3.2, info.span * 1.35 + 2));
    const position = { x: target.x + dx * back, y: target.y + Math.max(1.6, info.span * 0.55), z: target.z + dz * back };
    const shot = {
      id: 'gamefeel_reveal', shotKey: 'reveal-' + (debug.reveals + 1),
      position, target: { x: target.x, y: target.y, z: target.z },
      fovDeg: 50, blendSeconds: REVEAL_BLEND_S, dialogueFraming: false,
    };
    const holdMs = Math.max(600, Number(options.holdMs) || REVEAL_HOLD_MS); // holdMs lets headless tests (≈1-6 fps) keep the shot up long enough to capture.
    if (!window.CinematicCameraRuntime.activate(deps.getCurrentArea(), shot, { reason: 'ruin-reveal' })) { debug.revealSkipped = 'activate-failed'; return false; }
    const lock = window.CharacterActionLocks?.acquire?.({ owner: 'game-feel-reveal', reason: 'puzzle reveal shot', participants: ['player'], channels: ['movement', 'actions', 'tools'], timeoutMs: holdMs + 800 });
    reveal = { lock, endsAt: performance.now() + holdMs };
    letterbox(true);
    debug.reveals++; debug.revealSkipped = null;
    revealConsumed = true; // A direct reveal (e.g. the Great Door waking) satisfies the current solve's window.
    return true;
  }
  function endReveal() {
    if (!reveal) return;
    const r = reveal;
    reveal = null;
    if (window.CinematicCameraRuntime?.activeRecord?.()?.reason === 'ruin-reveal') window.CinematicCameraRuntime.deactivate();
    if (r.lock) window.CharacterActionLocks?.release?.(r.lock);
    letterbox(false);
  }

  function puzzleSolved() {
    if (performance.now() - solvedAt < 600) return; // A nested puzzle and its chamber can both report the same solve.
    solvedAt = performance.now();
    revealConsumed = false;
    solveChime();
    addTrauma(0.18);
  }
  function mechanismMoved(object, options = {}) {
    if (!deps) return;
    const now = performance.now();
    const info = objectCenter(object);
    const player = playerWorld();
    if (info && player && now - lastRumbleAt > 120) {
      const d = Math.hypot(info.center.x - player.x, info.center.z - player.z);
      const falloff = Math.max(0, 1 - d / 14);
      const size = Math.min(1, (Number(options.size) || info.span) / 4);
      if (falloff > 0) { addTrauma(0.26 * falloff * (0.35 + 0.65 * size)); lastRumbleAt = now; }
    }
    if (!revealConsumed && now - solvedAt <= REVEAL_WINDOW_MS) {
      revealConsumed = true;
      beginReveal(object);
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    window.RuntimeFrameScheduler?.register?.('game-feel:shake-apply', applyShake, { phase: 'pre-render', owner: 'game-feel', description: 'Adds presentation-only camera shake after the gameplay camera is solved.' });
    window.RuntimeFrameScheduler?.register?.('game-feel:shake-restore', restoreShake, { phase: 'post-game', owner: 'game-feel', description: 'Removes the shake offset so camera smoothing never integrates it.' });
    window.CombatAttackEvents?.on?.('hit', event => {
      const dmg = Math.max(0, Number(event?.actualDamage) || 0);
      if (!dmg) return;
      const heavy = /charge|breaker|finisher|heavy/i.test(String(event?.abilityId || event?.attackCategory || ''));
      hitStop(heavy ? 0.1 : 0.055);
      addTrauma(heavy ? 0.34 : 0.14);
    });
    window.WorldEvents?.on?.('blast', payload => {
      if (payload?.scope && payload.scope !== deps?.getCurrentArea?.()) return;
      const p = playerWorld();
      if (!p) return;
      const d = Math.hypot((Number(payload.x) || 0) - p.x, (Number(payload.z) || 0) - p.z);
      const r = Math.max(1, Number(payload.radius) || 2);
      const falloff = Math.max(0, 1 - d / (r * 5));
      addTrauma(0.75 * falloff);
    });
  }

  function init(injected) {
    deps = injected || null;
    wire();
  }

  window.GameFeel = Object.freeze({
    init, frameDt, addTrauma, hitStop, playerHurt, puzzleSolved, mechanismMoved, solveChime, progressNote, sinkAway, cancelSink,
    beginReveal, endReveal, isRevealing: () => !!reveal,
    shakeEnabled, setShakeEnabled,
    debugSnapshot: () => ({ ...debug, trauma, revealing: !!reveal, hitStopActive: performance.now() < hitStopUntil }),
  });
})();

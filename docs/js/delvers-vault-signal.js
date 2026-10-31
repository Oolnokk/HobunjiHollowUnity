// Harlyao Key Talisman search signal: true 3D light pulse + short audio beep.
// The hidden tile is owned by RuinSites; this renderer never reveals it or
// replaces the world's authoritative quest/terrain save state.
(() => {
  'use strict';
  const ID = 'delvers-vault-talisman-signal'; // Reused scheduler identity; exactly one pulse system per game session.
  const ZONE = 'map_western_slope'; // No off-zone beacon can disclose the hidden burrow's position.
  const MIN_PERIOD_MS = 380; // Audible/visible pulses at the location itself.
  const MAX_PERIOD_MS = 3700; // Sparse pulses at distances of 100+ tiles.
  const PULSE_DURATION_MS = 710; // Ring expands independently of its distance-based repeat frequency.
  let deps = null; // BanditCombat's existing live-area/player/terrain dependencies; no second player state.
  let visual = null; // One reusable ring and glow shell attached to the current wilderness scene.
  let nextPulseAt = 0; // Next WebAudio+visual pulse, reset on area/quest transition.
  let pulseAt = -Infinity; // The last emitted pulse timestamp drives radius/opacity.
  let audioContext = null; // Lazily unlocked in the player-initiated game session, shared between beeps.
  let lastError = null; // Mobile-visible diagnostics rather than a console-only failure.
  let lastDistance = null; // Exact player-to-target tile distance for balancing search cadence.
  let pulses = 0; // Cumulative signals this session, exposed to DevCompanion.
  let installed = false; // Scheduler and BanditCombat-init wrapping must remain idempotent.

  function target() {
    if (!deps?.player || !(deps.TILE > 0) || deps.getCurrentArea?.() !== ZONE ||
        window.DelversGuild?.vaultPhase?.() !== 'search' || !window.DelversGuild?.hasTalisman?.()) return null;
    return window.RuinSites?.storyVaultSite?.(ZONE) || null;
  }

  function periodForDistance(distance) {
    const fraction = Math.max(0, Math.min(1, (Number(distance) || 0) / 95)); // One smooth easing curve, never a direction indicator.
    return Math.round(MIN_PERIOD_MS + (MAX_PERIOD_MS - MIN_PERIOD_MS) * Math.pow(fraction, 0.72));
  }

  function ensureVisual() {
    const T = window.THREE;
    if (!T || visual) return visual;
    const root = new T.Group();
    root.name = 'harlyao_key_talisman_locator_pulse';
    root.userData.noOutline = true;
    const ring = new T.Mesh(new T.TorusGeometry(0.33, 0.038, 6, 36),
      new T.MeshBasicMaterial({color:'#fff0b8',transparent:true,opacity:0,depthWrite:false,depthTest:false,blending:T.AdditiveBlending}));
    ring.rotation.x = -Math.PI/2;
    ring.renderOrder = 970;
    ring.userData.noOutline = true;
    const glow = new T.Mesh(new T.SphereGeometry(0.38, 12, 8),
      new T.MeshBasicMaterial({color:'#fff1b3',transparent:true,opacity:0,depthWrite:false,depthTest:false,blending:T.AdditiveBlending}));
    glow.renderOrder = 969;glow.userData.noOutline = true;
    root.add(ring,glow);
    visual = {root,ring,glow};
    return visual;
  }

  function beep() {
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!audioContext) {
        audioContext = window._footstepAudioCtx || new AudioCtor(); // Share the game's already-unlocked footstep WebAudio context when possible.
        if (!window._footstepAudioCtx) window._footstepAudioCtx = audioContext; // Existing pointer/touch/key gesture listeners can unlock pulses later on mobile.
      }
      if (audioContext.state === 'suspended') { void audioContext.resume()?.catch?.(()=>{}); return; } // Autoplay restrictions never interrupt the quest.
      const start = audioContext.currentTime;
      const gain = audioContext.createGain(), tone = audioContext.createOscillator();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(640,start);
      tone.frequency.exponentialRampToValueAtTime(940,start+0.095);
      gain.gain.setValueAtTime(0.0001,start);
      gain.gain.exponentialRampToValueAtTime(0.062,start+0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001,start+0.14);
      tone.connect(gain);gain.connect(audioContext.destination);
      tone.start(start);tone.stop(start+0.145);
      tone.onended=()=>{tone.disconnect();gain.disconnect();};
    } catch(error) { lastError=String(error?.message||error); }
  }

  function update() {
    const site = target();
    const scene = deps?.getActiveScene?.();
    if (!site || !scene) {
      visual?.root?.parent?.remove?.(visual.root);
      nextPulseAt = 0;lastDistance = null;
      return;
    }
    const x = deps.player.x / deps.TILE, z = deps.player.y / deps.TILE; // Canonical pixel-to-world tile transform.
    const distance = Math.hypot(site.col+.5-x,site.row+.5-z);
    lastDistance = distance;
    const now = performance.now();
    const period = periodForDistance(distance);
    const v = ensureVisual();
    if (!v) return;
    if (v.root.parent !== scene) { v.root.parent?.remove?.(v.root); scene.add(v.root); nextPulseAt=0; }
    const grid = deps.getActiveGrid?.();
    const tile = grid?.[Math.floor(z)]?.[Math.floor(x)];
    const ground = tile ? (Number(deps.tileSurfaceYInArea?.(tile,ZONE)) || 0) : 0;
    v.root.position.set(x,ground+0.9,z); // Pulse originates at the player's talisman/body, never the hidden vault.
    if (!nextPulseAt || now >= nextPulseAt) {
      pulseAt=now;nextPulseAt=now+period;pulses++;beep();
    }
    const fraction = Math.max(0,Math.min(1,(now-pulseAt)/PULSE_DURATION_MS));
    const remaining = Math.pow(1-fraction,1.5);
    v.ring.scale.setScalar(0.45+fraction*3.5);
    v.ring.material.opacity=0.76*remaining;
    v.glow.scale.setScalar(0.55+fraction*1.8);
    v.glow.material.opacity=0.26*remaining;
    v.root.visible=remaining>0;
  }

  function install() {
    if (installed || !window.RuntimeFrameScheduler?.register) return installed;
    window.RuntimeFrameScheduler.register(ID,update,{
      phase:'pre-render',owner:'DelversGuild',
      description:'Player-origin audio and light pulses that accelerate near the Western Slope quest vault.',
    });
    installed=true;
    window.DevCompanion?.registerStateProvider?.('delversVaultSignal',debugSnapshot);
    return true;
  }

  function captureCombatDeps() {
    const api=window.BanditCombat;
    if (!api?.init || api.__delversVaultSignalWrapped) return;
    const prior=api.init; // Preserve earlier harlyao-night-march beacon hooks instead of replacing them.
    api.init=function (...args) { deps=args[0];return prior.apply(this,args); };
    api.__delversVaultSignalWrapped=true;
  }

  function debugSnapshot() {
    return {installed,active:!!target(),site:target(),distanceTiles:lastDistance,
      periodMs:lastDistance===null?null:periodForDistance(lastDistance),
      asset:'Harlyao Key Talisman',pulses,audioState:audioContext?.state||'not-started',lastError};
  }

  window.DelversVaultSignal=Object.freeze({update,periodForDistance,debugSnapshot});
  captureCombatDeps();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();

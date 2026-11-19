// The Five Wandering Blossoms: one chunk-scoped landmark hum and one perception cue.
// RiddleGenerator owns the unique anchor; this module never invents or searches for clues.
(() => {
  'use strict';

  const CHUNK_FALLBACK = 16; // Mirrors WildernessChunks.constants.CHUNK_TILES in test/early-load contexts.
  const MAX_GAIN = 0.16; // Same peak level as ruin projectile-target hums.
  const HUM_FREQUENCY = 196; // Same harmonic voice family as DevRandomRuinTargetHum.
  let sceneOwner = null; // Active wilderness scene to which a temporary ground decal may belong.
  let cueKey = ''; // Current blossom/shift/anchor identity; a different clue invalidates the old visual.
  let visual = null; // Owned river-landmark decal only; existing rock and pillar meshes must never be disposed here.
  let objectRoot = null; // Borrowed scene root of an actual dyed standing stone, boulder or pillar.
  let color = '#ffffff'; // The active blossom's live window-swatch color, used for audio/visual diagnostics.
  let currentAnchor = null; // Verified riddle anchor, never an approximate player-facing coordinate.
  let inChunk = false; // Gates both the hum and the sense marker to the actual 16x16 streaming chunk.
  let audioContext = null; // Lazy Web Audio synthesizer shared across this session's clue changes.
  let voice = null; // At most one beating, low-pass, tremolo voice at a time.
  let level = 0; // Last requested gain, displayed in the mobile Dev Companion snapshot.

  function audioVolume() {
    const config = window.AudioSystem?.gameAudioConfig?.() || {};
    return config.enabled === false ? 0 : Math.max(0, Math.min(1, Number(config.sfxVolume ?? 1) || 0));
  }
  function stopVoice() {
    if (!voice || !audioContext) { voice = null; level = 0; return; }
    const old = voice; // A detached, fading voice is never reused by a new landmark.
    voice = null;
    level = 0;
    const now = audioContext.currentTime;
    old.gain.gain.setTargetAtTime(0, now, 0.04);
    for (const oscillator of old.oscillators) {
      try { oscillator.stop(now + 0.25); } catch (_) {}
    }
    setTimeout(() => { try { old.gain.disconnect(); old.pan?.disconnect(); } catch (_) {} }, 350);
  }
  function makeVoice() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!audioContext) {
      try { audioContext = new AudioContextCtor(); } catch (_) { return null; }
    }
    if (audioContext.state === 'suspended') audioContext.resume?.().catch?.(() => {});
    const ctx = audioContext, now = ctx.currentTime;
    const gain = ctx.createGain(), pan = ctx.createStereoPanner?.() || null;
    const filter = ctx.createBiquadFilter();
    gain.gain.setValueAtTime(0, now);
    filter.type = 'lowpass'; filter.frequency.value = 900;
    const oscillators = []; // Three ruin-style partials plus the original 5.5-Hz tremolo.
    function partial(type, frequency, amplitude) {
      const oscillator = ctx.createOscillator(), volume = ctx.createGain();
      oscillator.type = type; oscillator.frequency.value = frequency; volume.gain.value = amplitude;
      oscillator.connect(volume).connect(filter);
      oscillator.start(now); oscillators.push(oscillator);
    }
    partial('sine', HUM_FREQUENCY, 0.55);
    partial('sine', HUM_FREQUENCY * 1.006, 0.4);
    partial('triangle', HUM_FREQUENCY * 2, 0.12);
    const tremolo = ctx.createOscillator(), depth = ctx.createGain(), body = ctx.createGain();
    tremolo.frequency.value = 5.5; depth.gain.value = 0.25; body.gain.value = 0.75;
    tremolo.connect(depth).connect(body.gain); tremolo.start(now); oscillators.push(tremolo);
    filter.connect(body).connect(gain);
    if (pan) gain.connect(pan).connect(ctx.destination);
    else gain.connect(ctx.destination);
    return { gain, pan, oscillators };
  }
  function clearVisual() {
    if (visual) {
      visual.parent?.remove?.(visual);
      visual.traverse?.(part => { part.geometry?.dispose?.(); part.material?.dispose?.(); });
    }
    visual = null; objectRoot = null; sceneOwner = null; cueKey = '';
  }
  function reset() {
    clearVisual(); stopVoice();
    audioContext?.close?.().catch?.(() => {});
    audioContext = null; currentAnchor = null; inChunk = false;
  }

  function tileHeight(point, tilePixels) {
    const raw = window.ClimbSystem?.groundYAt?.((point.col + 0.5) * tilePixels, (point.row + 0.5) * tilePixels);
    return Number.isFinite(Number(raw)) && raw != null ? Number(raw) : 0;
  }
  function createAreaDecal(scene, point, tint, tilePixels) {
    const THREE = window.THREE;
    if (!THREE?.Group || !THREE?.RingGeometry || !THREE?.MeshBasicMaterial || !THREE?.Mesh) return null;
    const root = new THREE.Group(); // Two multi-tile circles and a small center ring form one discoverable ground decal.
    root.name = 'five-blossoms-start-area-sense';
    const material = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.73, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1,
    });
    for (const [inside, outside] of [[0.72, 0.84], [1.42, 1.56], [2.12, 2.27]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(inside, outside, 40), material.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      ring.raycast = () => {}; // A clue is never an interactable target or terrain collision.
      root.add(ring);
    }
    root.position.set(point.col + 0.5, tileHeight(point, tilePixels), point.row + 0.5);
    root.visible = false; // Only the real Perception Mode toggle can reveal this ground signal.
    root.userData.festivalBlossomStartArea = true;
    scene.add(root);
    material.dispose(); // The three scene materials are independently owned and disposed with the decal.
    return root;
  }

  function sameChunk(tile, anchor, chunkTiles) {
    return tile?.area && Number.isFinite(tile.col) && Number.isFinite(tile.row) &&
      Number.isFinite(anchor?.col) && Number.isFinite(anchor?.row) &&
      Math.floor(tile.col / chunkTiles) === Math.floor(anchor.col / chunkTiles) &&
      Math.floor(tile.row / chunkTiles) === Math.floor(anchor.row / chunkTiles);
  }
  function updateAudio(tile, anchor, isArea, tilePixels) {
    const volume = audioVolume();
    if (!inChunk || !volume || globalThis.document?.hidden) { stopVoice(); return; }
    if (!voice) voice = makeVoice();
    if (!voice || !audioContext) return;
    // The bank is walkable; for rivers the actual verified water-center emits the sound.
    const source = isArea && anchor.waterCenter ? anchor.waterCenter : anchor.coordinate;
    const player = window.Combat?.deps?.player; // Gameplay's pixel-space position sharpens panning between tile events.
    const px = Number.isFinite(player?.x) ? player.x / tilePixels : tile.col + 0.5;
    const pz = Number.isFinite(player?.y) ? player.y / tilePixels : tile.row + 0.5;
    const dx = source.col + 0.5 - px, dz = source.row + 0.5 - pz;
    const dist = Math.hypot(dx, dz);
    const chunkTiles = Math.max(1, Math.floor(Number(window.WildernessChunks?.constants?.CHUNK_TILES) || CHUNK_FALLBACK));
    const fade = Math.max(0, 1 - dist / (Math.SQRT2 * chunkTiles + 2));
    // The ruin's same beating hum, but a larger detection field: audible throughout this one chunk.
    level = MAX_GAIN * volume * (0.16 + 0.84 * fade * fade);
    const now = audioContext.currentTime;
    voice.gain.gain.setTargetAtTime(level, now, 0.07);
    const camera = window.Combat?.deps?.getActiveCamera?.() || window.HobunjiGameplayBackdrop?.getCamera?.();
    const e = camera?.matrixWorld?.elements;
    if (voice.pan && e) {
      const side = (dx * e[0] + dz * e[2]) / (dist || 1);
      voice.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, side)), now, 0.07);
    }
  }
  function update(options = {}) {
    const anchor = options.anchor; // Only the current quest's generated uniqueStart is eligible.
    const point = anchor?.coordinate;
    const tile = options.tile;
    const scene = options.scene;
    const chunkTiles = Math.max(1, Math.floor(Number(window.WildernessChunks?.constants?.CHUNK_TILES) || CHUNK_FALLBACK));
    const isArea = anchor?.kind === 'riverConfluence' || anchor?.kind === 'riverEnd'; // River sound belongs to the actual water-center chunk, not the accessible bank tile.
    const center = anchor?.waterCenter;
    const chunkAnchor = isArea && Number.isFinite(center?.col) && Number.isFinite(center?.row) ? center : point;
    const valid = options.active === true && !!options.blossom?.id && !!scene &&
      tile?.area === options.blossom.zoneId && anchor?.unique === true &&
      Number.isFinite(point?.col) && Number.isFinite(point?.row);
    inChunk = !!(valid && sameChunk(tile, chunkAnchor, chunkTiles));
    if (!inChunk) {
      clearVisual(); stopVoice(); currentAnchor = null;
      return;
    }
    currentAnchor = anchor;
    color = options.color || options.blossom.color || '#ffffff';
    const nextKey = [options.blossom.id, options.shift, anchor.kind, point.col, point.row, anchor.dyeId].join(':');

    const tilePixels = Math.max(1, Number(options.tilePixels) || 64);
    if (sceneOwner !== scene || cueKey !== nextKey) {
      clearVisual();
      sceneOwner = scene; cueKey = nextKey;
    }
    if (isArea) {
      if (!visual) visual = createAreaDecal(scene, point, color, tilePixels);
      if (visual) visual.visible = window.PerceptionMode?.isActive?.() === true;
    } else {
      if (objectRoot?.parent?.parent !== scene) objectRoot = window.WildernessLandmarkScenery?.objectAt?.(options.blossom.zoneId, scene, point) || null; // Re-resolve only if asynchronous pillar construction or a scene rebuild replaced the root.
    }
    updateAudio(tile, anchor, isArea, tilePixels);
  }
  function senseTargets(scene) {
    if (!inChunk || scene !== sceneOwner || window.PerceptionMode?.isActive?.() !== true) return [];
    const root = visual || objectRoot;
    return root?.parent ? [{ root, color }] : [];
  }
  function debugSnapshot() {
    return { inChunk, anchorKind:currentAnchor?.kind || null, bank:currentAnchor?.coordinate || null,
      waterCenter:currentAnchor?.waterCenter || null, color, visualKind:visual?'area-decal':objectRoot?'existing-object':'waiting-for-scenery',
      perceptionVisible:!!visual?.visible, audioGain:+level.toFixed(4), voiceActive:!!voice };
  }
  globalThis.document?.addEventListener?.('visibilitychange', () => {
    if (globalThis.document?.hidden) stopVoice();
  });
  window.FestivalBlossomStartCue = Object.freeze({ update, reset, senseTargets, debugSnapshot,
    __test: Object.freeze({ sameChunk }) });
})();

// Reusable per-character suppression registry for synchronized interactions.
//
// A caller acquires one token for any number of participants and channels,
// then releases it when its interaction ends. Multiple systems may overlap:
// a channel remains locked until every token covering it has been released.
(() => {
  'use strict';

  const DEFAULT_CHANNELS = Object.freeze(['movement', 'tools', 'actions']);
  const activeLocks = new Map(); // Read by isLocked/getDebug and mutated by acquire/release.
  let nextTokenId = 1; // Supplies stable debug-friendly token IDs for each acquired lock.

  function normalizedParticipant(entry, fallbackChannels) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (!id) return null;
    const authoredChannels = typeof entry === 'string' ? fallbackChannels : entry.channels;
    const channels = [...new Set((authoredChannels?.length ? authoredChannels : DEFAULT_CHANNELS)
      .map(channel => String(channel || '').trim()).filter(Boolean))];
    return channels.length ? { id: String(id), channels } : null;
  }

  function release(tokenOrHandle) {
    const token = typeof tokenOrHandle === 'string' ? tokenOrHandle : tokenOrHandle?.token;
    return token ? activeLocks.delete(token) : false;
  }

  function acquire(options = {}) {
    const fallbackChannels = options.channels?.length ? options.channels : DEFAULT_CHANNELS;
    const participants = (options.participants || []).map(entry => normalizedParticipant(entry, fallbackChannels)).filter(Boolean);
    if (!participants.length) return null;
    const token = `character-action-lock-${nextTokenId++}`;
    const now = performance.now();
    const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
    const record = {
      token,
      owner: String(options.owner || 'interaction'),
      reason: String(options.reason || options.owner || 'interaction'),
      participants,
      acquiredAt: now,
      expiresAt: timeoutMs > 0 ? now + timeoutMs : 0,
    };
    activeLocks.set(token, record);
    return Object.freeze({ token, release: () => release(token) });
  }

  function pruneExpired(now = performance.now()) {
    for (const [token, lock] of activeLocks) {
      if (lock.expiresAt > 0 && lock.expiresAt <= now) activeLocks.delete(token);
    }
  }

  function isLocked(participantId, channel) {
    if (!participantId || !channel) return false;
    pruneExpired();
    const id = String(participantId);
    const requestedChannel = String(channel);
    for (const lock of activeLocks.values()) {
      const participant = lock.participants.find(entry => entry.id === id);
      if (participant?.channels.includes(requestedChannel)) return true;
    }
    return false;
  }

  function clearParticipant(participantId) {
    const id = String(participantId || '');
    if (!id) return 0;
    let cleared = 0;
    for (const [token, lock] of activeLocks) {
      if (!lock.participants.some(entry => entry.id === id)) continue;
      activeLocks.delete(token);
      cleared++;
    }
    return cleared;
  }

  function getDebug() {
    const now = performance.now();
    pruneExpired(now);
    return [...activeLocks.values()].map(lock => ({
      token: lock.token,
      owner: lock.owner,
      reason: lock.reason,
      ageMs: Math.max(0, Math.round(now - lock.acquiredAt)),
      remainingMs: lock.expiresAt > 0 ? Math.max(0, Math.round(lock.expiresAt - now)) : null,
      participants: lock.participants.map(entry => ({ id: entry.id, channels: [...entry.channels] })),
    }));
  }

  window.CharacterActionLocks = Object.freeze({
    acquire,
    release,
    isLocked,
    clearParticipant,
    getDebug,
    channels: DEFAULT_CHANNELS,
  });
})();

// The main page already loads this interaction primitive before FarmAnimals,
// DialogueContent, and game.js. Use that stable parser position to load small,
// modular gameplay interaction features without adding more monolithic
// index.html wiring. Tool pages are excluded.
(() => {
  if (typeof document === 'undefined' || document.readyState !== 'loading' || typeof document.write !== 'function') return;
  if (typeof location !== 'undefined' && /\/tools\//.test(location.pathname || '')) return;
  const src = document.currentScript?.src || '';
  const base = src ? new URL('.', src).href : 'js/';
  const chathead = new URL('animal-chathead-frame.js?v=20260902modular1', base).href;
  const dialogue = new URL('livestock-dialogue.js?v=20260902modular1', base).href;
  const livestockHarvestStaging = new URL('livestock-harvest-staging.js?v=20260906harvest1', base).href; // Loads the harvest-only animal staging/approach-suppression bridge before FarmAnimals is assigned.
  const social = new URL('social-action-wheel.js?v=20260903social1', base).href;
  const socialArchAdapter = new URL('social-action-wheel-arch-adapter.js?v=20260905social17', base).href; // Keeps the centered wheel while sharing selection-arch hold/wheel/release controls and HUD styling.
  const socialRhythmRuntime = new URL('social-rhythm-runtime.js?v=20260903social8', base).href;
  const socialRenderBridge = new URL('social-action-r128-render-bridge.js?v=20260903social5', base).href;
  const npcAmbientMusicStimuliRuntime = new URL('npc-ambient-music-stimuli-runtime.js?v=20260903social10', base).href;
  const npcSocialInhibitionRuntime = new URL('npc-social-inhibition-runtime.js?v=20260903social9', base).href;
  const socialDanceRuntime = new URL('social-action-dance-runtime.js?v=20260903social4', base).href;
  const socialBodyPlaneRuntime = new URL('social-action-body-plane-runtime.js?v=20260903social6', base).href;
  const socialCameraRuntime = new URL('social-action-camera-runtime.js?v=20260903social7', base).href;
  const npcDancePresentationRuntime = new URL('npc-dance-presentation-runtime.js?v=20260903social12', base).href;
  const proceduralHandForearmAlignmentRuntime = new URL('procedural-hand-forearm-alignment-runtime.js?v=20260903social13', base).href;
  const npcSillinessReactionRuntime = new URL('npc-silliness-reaction-runtime.js?v=20260903social16', base).href;
  document.write(`<script src="${chathead}"><\/script><script src="${dialogue}"><\/script><script src="${livestockHarvestStaging}"><\/script><script src="${social}"><\/script><script src="${socialArchAdapter}"><\/script><script src="${socialRhythmRuntime}"><\/script><script src="${socialRenderBridge}"><\/script><script src="${npcAmbientMusicStimuliRuntime}"><\/script><script src="${npcSocialInhibitionRuntime}"><\/script><script src="${socialDanceRuntime}"><\/script><script src="${socialBodyPlaneRuntime}"><\/script><script src="${socialCameraRuntime}"><\/script><script src="${npcDancePresentationRuntime}"><\/script><script src="${proceduralHandForearmAlignmentRuntime}"><\/script><script src="${npcSillinessReactionRuntime}"><\/script>`);
})();
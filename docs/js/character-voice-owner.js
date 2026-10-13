// Shared one-voice-per-character arbitration for dialogue and combat vocals.
(() => {
  'use strict';

  const VERSION = 1;
  const DEFAULT_FADE_OUT_S = 0.008; // Abrupt enough to feel immediate while avoiding hard-stop clicks/pops.
  const PRIORITY = Object.freeze({
    breath: 1,
    dialogue: 1.5,
    pain: 2,
    active: 3,
  });
  const objectSlots = new WeakMap(); // Anonymous runtime entities retain identity without preventing garbage collection.
  const stableSlots = new Map(); // NPC/player IDs let dialogue records and combat entities resolve to the same voice slot.
  const activeClaims = new Set(); // Small debug/reset surface; claims remove themselves on release/preemption.
  let serial = 0;

  function keyFor(subject) {
    if (subject == null) return null;
    if (typeof subject !== 'object' && typeof subject !== 'function') return `actor:${String(subject)}`;
    if (subject === window.Combat?.deps?.player) return 'actor:player';
    const stableId = subject.voiceOwnerKey
      || subject.npcId
      || subject.id
      || subject.rec?.id
      || subject.rosterRecord?.id
      || subject.rosterRecord?.name
      || subject.name;
    return stableId ? `actor:${String(stableId)}` : subject;
  }

  function getSlot(key) {
    if (key == null) return null;
    return typeof key === 'object' || typeof key === 'function'
      ? objectSlots.get(key) || null
      : stableSlots.get(key) || null;
  }

  function setSlot(key, value) {
    if (key == null) return;
    const objectKey = typeof key === 'object' || typeof key === 'function';
    const store = objectKey ? objectSlots : stableSlots;
    if (value == null) store.delete(key);
    else store.set(key, value);
  }

  function release(claim) {
    if (!claim || claim.released) return false;
    claim.released = true;
    activeClaims.delete(claim);
    if (getSlot(claim.key) === claim) setSlot(claim.key, null);
    return true;
  }

  function request(subject, options = {}) {
    const key = keyFor(subject);
    if (key == null) return null;
    const priority = Number.isFinite(Number(options.priority)) ? Number(options.priority) : 0;
    const current = getSlot(key);
    if (current && !current.released && current.priority > priority) return null;

    const fadeOutS = Math.max(0, Number(options.fadeOutS ?? DEFAULT_FADE_OUT_S) || 0);
    const claim = {
      id: ++serial,
      key,
      subject,
      kind: String(options.kind || 'voice'),
      priority,
      fadeOutS,
      handoffDelayS: current && !current.released ? fadeOutS : 0,
      stop: null,
      released: false,
      preempted: false,
    };
    setSlot(key, claim);
    activeClaims.add(claim);

    if (current && !current.released) {
      current.preempted = true;
      activeClaims.delete(current);
      try { current.stop?.(fadeOutS, { reason: 'preempted', by: claim }); } catch (_) {}
    }
    return claim;
  }

  function bindStop(claim, stop) {
    if (!claim || typeof stop !== 'function') return false;
    claim.stop = stop;
    if (claim.released || claim.preempted || getSlot(claim.key) !== claim) {
      try { stop(claim.fadeOutS, { reason: 'late-bind-preempted' }); } catch (_) {}
      return false;
    }
    return true;
  }

  function stop(subjectOrClaim, fadeOutS = DEFAULT_FADE_OUT_S) {
    const claim = subjectOrClaim?.key && Object.prototype.hasOwnProperty.call(subjectOrClaim, 'priority')
      ? subjectOrClaim
      : getSlot(keyFor(subjectOrClaim));
    if (!claim || claim.released) return false;
    claim.preempted = true;
    activeClaims.delete(claim);
    if (getSlot(claim.key) === claim) setSlot(claim.key, null);
    try { claim.stop?.(Math.max(0, Number(fadeOutS) || 0), { reason: 'stopped' }); } catch (_) {}
    return true;
  }

  function current(subject) {
    const claim = getSlot(keyFor(subject));
    if (!claim || claim.released) return null;
    return {
      id: claim.id,
      kind: claim.kind,
      priority: claim.priority,
      key: typeof claim.key === 'string' ? claim.key : '(runtime-object)',
    };
  }

  function debugSnapshot() {
    return [...activeClaims].filter(claim => !claim.released).map(claim => ({
      id: claim.id,
      kind: claim.kind,
      priority: claim.priority,
      key: typeof claim.key === 'string' ? claim.key : '(runtime-object)',
      preempted: claim.preempted,
    }));
  }

  window.CharacterVoiceOwner = Object.freeze({
    version: VERSION,
    priorities: PRIORITY,
    defaultFadeOutS: DEFAULT_FADE_OUT_S,
    keyFor,
    request,
    bindStop,
    release,
    stop,
    current,
    debugSnapshot,
  });
})();

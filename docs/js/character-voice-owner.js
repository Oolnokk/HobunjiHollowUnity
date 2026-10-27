// Per-character voice arbitration for dialogue and combat; only release grunts may share a channel.
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
  const objectSlots = new WeakMap(); // Per-entity arrays of claims retain anonymous identity without blocking garbage collection.
  const stableSlots = new Map(); // NPC/player IDs resolve dialogue and combat to the same list of claims.
  const activeClaims = new Set(); // Small debug/reset surface; claims remove themselves on release/preemption.
  let serial = 0;

  function keyFor(subject) {
    if (subject == null) return null;
    if (typeof subject !== 'object' && typeof subject !== 'function') return `actor:${String(subject)}`;
    if (subject === window.Combat?.deps?.player) return 'actor:player';
    const stableId = subject.voiceOwnerKey
      || subject.npcId
      || subject.rec?.id // Ordinary town walkers use rec.id as their canonical identity even if a runtime id is also present.
      || subject.id
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
    const claims = getSlot(claim.key) || []; // A completed overlapping grunt must not release its still-playing siblings.
    if (claims.includes(claim)) {
      const remaining = claims.filter(active => active !== claim);
      setSlot(claim.key, remaining.length ? remaining : null);
    }
    return true;
  }

  function request(subject, options = {}) {
    const key = keyFor(subject);
    if (key == null) return null;
    const priority = Number.isFinite(Number(options.priority)) ? Number(options.priority) : 0;
    const currentClaims = getSlot(key) || []; // All sounds still owned by this character, including overlapping release grunts.
    if (currentClaims.some(current => !current.released && current.priority > priority)) return null;

    const preserveGroup = options.preserveGroup || options.overlapGroup || null; // Attack windups and new releases preserve existing release-grunt tails.
    const retained = preserveGroup
      ? currentClaims.filter(current => !current.released && current.overlapGroup === preserveGroup && current.priority === priority)
      : [];
    const replaced = currentClaims.filter(current => !current.released && !retained.includes(current));
    const fadeOutS = Math.max(0, Number(options.fadeOutS ?? DEFAULT_FADE_OUT_S) || 0);
    const claim = {
      id: ++serial,
      key,
      subject,
      kind: String(options.kind || 'voice'),
      priority,
      overlapGroup: options.overlapGroup || null, // Only explicitly grouped vocals may remain concurrently active.
      fadeOutS,
      handoffDelayS: replaced.length ? fadeOutS : 0,
      stop: null,
      released: false,
      preempted: false,
    };
    setSlot(key, [...retained, claim]);
    activeClaims.add(claim);

    for (const previous of replaced) {
      previous.preempted = true;
      activeClaims.delete(previous);
      try { previous.stop?.(fadeOutS, { reason: 'preempted', by: claim }); } catch (_) {}
    }
    return claim;
  }

  function bindStop(claim, stop) {
    if (!claim || typeof stop !== 'function') return false;
    claim.stop = stop;
    if (claim.released || claim.preempted || !(getSlot(claim.key) || []).includes(claim)) {
      try { stop(claim.fadeOutS, { reason: 'late-bind-preempted' }); } catch (_) {}
      return false;
    }
    return true;
  }

  function stop(subjectOrClaim, fadeOutS = DEFAULT_FADE_OUT_S) {
    const isClaim = subjectOrClaim?.key && Object.prototype.hasOwnProperty.call(subjectOrClaim, 'priority');
    const claims = isClaim ? [subjectOrClaim] : [...(getSlot(keyFor(subjectOrClaim)) || [])]; // Despawn/reset stops every overlapping voice, not just the newest.
    let stopped = false;
    for (const claim of claims) {
      const active = getSlot(claim.key) || [];
      if (claim.released || !active.includes(claim)) continue;
      claim.preempted = true;
      activeClaims.delete(claim);
      const remaining = active.filter(other => other !== claim);
      setSlot(claim.key, remaining.length ? remaining : null);
      try { claim.stop?.(Math.max(0, Number(fadeOutS) || 0), { reason: 'stopped' }); } catch (_) {}
      stopped = true;
    }
    return stopped;
  }

  function current(subject) {
    const claims = getSlot(keyFor(subject)) || [];
    const claim = claims[claims.length - 1]; // The newest vocal remains the public-facing owner while older releases finish.
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
      overlapGroup: claim.overlapGroup,
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

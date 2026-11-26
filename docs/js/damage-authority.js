(() => {
  'use strict';

  // DamageAuthority — the single entry for "attacker hurts target" where the
  // target may be the local player, another player, or a creature/NPC.
  //
  // Before this, every enemy module called `deps.damagePlayer(...)`, which is
  // hardwired to the one local avatar: it has no notion of *which* player was
  // hit. `hit(target, ...)` takes the victim explicitly and routes by what the
  // victim is:
  //
  //   local player      -> the game's damagePlayer (dodge, i-frames, downed, death)
  //   remote player     -> the registered remote handler (host: apply + replicate;
  //                        guest: forward to the host). With none registered the
  //                        hit is recorded as 'unhandled' and does NOT touch the
  //                        local player — a hit on someone else never hurts you.
  //   anything else     -> the game's damageCreature
  //
  // Every resolved hit is also appended to a small event log with stable actor
  // ids. That log is the seam a host will later broadcast as "confirmed damage".

  let deps = { damageLocalPlayer: null, damageCreature: null };
  let remoteHandler = null;
  const listeners = new Set();
  const recent = [];
  const RECENT_MAX = 64;
  let seq = 0;

  function init(injected) { deps = { ...deps, ...injected }; }
  function setRemotePlayerHandler(fn) { remoteHandler = typeof fn === 'function' ? fn : null; }
  function onHit(fn) { if (typeof fn === 'function') { listeners.add(fn); return () => listeners.delete(fn); } return () => {}; }

  const registry = () => window.ActorRegistry;

  function record(target, amount, opts, outcome, kind) {
    const reg = registry();
    const ev = {
      seq: ++seq,
      kind,
      outcome,
      amount: Number(amount) || 0,
      tag: opts?.tag || null,
      attackerId: reg?.idOf(opts?.attacker) || null,
      targetId: reg?.idOf(target) || null,
      areaId: reg?.areaOf(target) ?? null,
    };
    recent.push(ev);
    if (recent.length > RECENT_MAX) recent.shift();
    for (const fn of listeners) { try { fn(ev); } catch (e) { console.warn('[DamageAuthority] listener failed', e); } }
    return ev;
  }

  // Resolves one hit. Returns whatever the underlying owner returns (the
  // environmental-impact path of damagePlayer returns { applied, lethal }).
  function hit(target, amount, fromX, fromY, knockbackPxS, opts) {
    const reg = registry();
    if (!target) return undefined;
    if (reg?.isPlayer(target) && !reg.isLocalPlayer(target)) {
      if (!remoteHandler) { record(target, amount, opts, 'unhandled', 'remote-player'); return undefined; }
      const result = remoteHandler(target, amount, fromX, fromY, knockbackPxS, opts);
      record(target, amount, opts, 'remote', 'remote-player');
      return result;
    }
    if (reg ? reg.isLocalPlayer(target) : target === deps.getLocalPlayer?.()) {
      const result = deps.damageLocalPlayer(amount, fromX, fromY, knockbackPxS, opts);
      record(target, amount, opts, 'local', 'local-player');
      return result;
    }
    const result = deps.damageCreature(target, amount, fromX, fromY, knockbackPxS, opts);
    record(target, amount, opts, 'creature', 'creature');
    return result;
  }

  window.DamageAuthority = {
    init, hit, onHit, setRemotePlayerHandler,
    getRecent: () => recent.slice(),
  };
})();

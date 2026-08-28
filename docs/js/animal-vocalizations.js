(() => {
  'use strict';

  // Converts gameplay meaning into a timed sequence of utterances. This
  // module deliberately owns no Audio objects and knows no asset paths:
  // producers request chatter/warning/growl intents, while AudioSystem is
  // injected as the renderer. That keeps perception, combat AI, scheduling,
  // and browser audio loading independently replaceable.
  let deps = null;
  const states = new WeakMap();
  const tracked = new Set();
  const PRIORITY = Object.freeze({ chatter: 1, growl: 2, warning: 3 });
  const debug = { requested: 0, rendered: 0, suppressed: 0, last: null };

  function init(injectedDeps) { deps = injectedDeps; }
  function random() { return deps?.random?.() ?? Math.random(); }
  function hasVoice(c) { return !!deps?.hasVoice?.(c); }

  function stateFor(c) {
    let state = states.get(c);
    if (!state) {
      state = { active: null, nextChatterS: 4 + random() * 8 };
      states.set(c, state);
      tracked.add(c);
    }
    return state;
  }

  function buildSequence(kind, opts) {
    if (kind === 'growl') {
      const rate = 0.56 + random() * 0.12;
      return [{ atS: 0, volume: opts.volume ?? 0.76, rate,
        rateContour: [rate, rate * 1.22, rate * 0.92], earshotTiles: opts.earshotTiles ?? 10 }];
    }
    if (kind === 'warning') {
      const repeats = Math.max(1, Math.min(5, Number(opts.repeats) || 3));
      const intervalS = Math.max(0.26, (Number(opts.intervalMs) || 520) / 1000);
      return Array.from({ length: repeats }, (_, i) => ({
        atS: i * intervalS,
        volume: opts.volume ?? 0.94,
        rate: 0.96 + random() * 0.1,
        earshotTiles: opts.earshotTiles ?? 12,
      }));
    }
    const repeats = Math.max(2, Math.min(6, Number(opts.repeats) || (2 + Math.floor(random() * 4))));
    let atS = 0;
    return Array.from({ length: repeats }, (_, i) => {
      if (i) atS += 0.12 + random() * 0.36;
      return { atS, volume: opts.volume ?? (0.16 + random() * 0.1),
        rate: 1.18 + random() * 0.38, earshotTiles: opts.earshotTiles ?? 8 };
    });
  }

  function request(c, requestedKind, opts = {}) {
    if (!deps || !c || c.health <= 0 || !hasVoice(c)) return false;
    const kind = requestedKind === 'discovery' ? 'warning' : requestedKind;
    const priority = PRIORITY[kind];
    if (!priority) return false;
    const state = stateFor(c);
    if (state.active && priority <= state.active.priority) {
      debug.suppressed++;
      return false;
    }
    const sequence = buildSequence(kind, opts);
    const tailS = kind === 'growl' ? 1.2 : kind === 'warning' ? 0.5 : 0.35;
    state.active = {
      kind, priority, reason: opts.reason || null, elapsedS: 0, nextIndex: 0,
      sequence, endsAtS: sequence[sequence.length - 1].atS + tailS,
    };
    if (kind !== 'chatter') state.nextChatterS = Math.max(state.nextChatterS, 2.5);
    debug.requested++;
    debug.last = { kind, reason: opts.reason || null, species: c.creatureKey || '?', at: Date.now() };
    // The first sound is intentionally rendered synchronously with the
    // gameplay event; later repeats are advanced by tickCreature.
    renderDue(c, state);
    return true;
  }

  function renderDue(c, state) {
    const active = state.active;
    if (!active) return;
    while (active.nextIndex < active.sequence.length
      && active.sequence[active.nextIndex].atS <= active.elapsedS + 0.0001) {
      const utterance = active.sequence[active.nextIndex++];
      if (deps.renderUtterance(c, { ...utterance, meaning: active.kind, reason: active.reason })) debug.rendered++;
    }
    if (active.nextIndex >= active.sequence.length && active.elapsedS >= active.endsAtS) state.active = null;
  }

  function tickCreature(c, dt, opts = {}) {
    if (!deps || !c || c.health <= 0 || !hasVoice(c)) return;
    const state = stateFor(c);
    const step = Math.max(0, Number(dt) || 0);
    if (state.active) {
      state.active.elapsedS += step;
      renderDue(c, state);
    }
    const threatened = opts.threatened ?? (
      ['attack', 'attacking', 'chase', 'chasing', 'aggro', 'hostile', 'flee', 'fleeing', 'patrol-chase']
        .includes(String(c.state || '').toLowerCase())
      || !!(c.target || c.combatTarget || c.attackTarget || c.aggroTarget || c.targetCreature)
    );
    if (opts.allowPassive === false || threatened) {
      state.nextChatterS = Math.max(state.nextChatterS, 2.5);
      return;
    }
    state.nextChatterS -= step;
    if (state.nextChatterS > 0 || state.active) return;
    request(c, 'chatter');
    state.nextChatterS = 5 + random() * 9;
  }

  function companionDiscovery(c, reason, opts = {}) {
    return request(c, 'warning', { ...opts, reason });
  }

  function threatGrowl(c, reason, opts = {}) {
    return request(c, 'growl', { ...opts, reason });
  }

  function warning(c, reason, opts = {}) {
    return request(c, 'warning', { ...opts, reason });
  }

  function debugSnapshot() {
    let active = 0;
    for (const c of tracked) {
      if (!c || c.health <= 0) { tracked.delete(c); continue; }
      if (states.get(c)?.active) active++;
    }
    return { ...debug, active };
  }

  window.AnimalVocalizations = { init, tickCreature, companionDiscovery, threatGrowl, warning, debugSnapshot };
})();

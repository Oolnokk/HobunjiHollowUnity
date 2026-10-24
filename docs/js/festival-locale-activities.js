// Autonomous participation in the four non-Gorkunash festival locales.
// Reuses the regular NPC schedule and social-presentation pipeline; no frame loop or cloned NPCs.
(() => {
  'use strict';
  let deps = null; // FestivalSystem supplies its cached active map and current gathering state.
  let layout = null; // Effective layout identity invalidates authored destinations when the map is edited.
  let phaseKey = ''; // Festival/date/shift key; NPC choices change only every 60 game minutes.
  const targets = new Map(); // Read in O(1) by the high-frequency NPC schedule override.
  const walkers = new Map(); // Refreshed during the existing low-frequency festival update.
  let lastError = ''; // Copied through FestivalSystem diagnostics on mobile.

  function clear() {
    targets.clear(); walkers.clear(); layout = null; phaseKey = ''; lastError = '';
  }
  function init(injected) { deps = injected; clear(); }
  function hash(value) {
    let result = 2166136261; // Stable actor preference; no per-frame randomness or simultaneous rerolls.
    for (const ch of String(value || '')) result = Math.imul(result ^ ch.charCodeAt(0), 16777619);
    return result >>> 0;
  }
  function isDance(kind) { return kind === 'mask-dance' || kind === 'blossom-dance'; }
  function dancePose(kind, id, focus) {
    return {
      socialDance: {
        stimulusId: 'festival-locale:' + id,
        style: kind === 'blossom-dance' ? 'gentle-twirl' : 'loose-sway',
        armStyle: kind === 'blossom-dance' ? 'overhead-punch' : 'tpose-jiggle'
      },
      socialLookAt: focus, socialWatching: false
    };
  }
  function update() {
    const festival = deps?.festival?.(); // Missing or suspended festivals must never take over ordinary schedules.
    if (!festival || festival.id === 'gorkunash' || !deps?.active?.()) {
      if (phaseKey) clear();
      return;
    }
    if (deps?.paused?.()) return;
    const nextLayout = deps.getLayout?.(), minute = Number(deps.minutes?.());
    if (!nextLayout || !Number.isFinite(minute)) return;
    const shift = Math.floor(minute / 60); // One-hour phases leave time for guests to physically reach each locale.
    const key = festival.id + ':' + shift;
    walkers.clear(); // Walker instances change after scene transfers even when the locale itself has not moved.
    for (const walker of deps.getWalkers?.() || []) if (walker?.rec?.id) walkers.set(walker.rec.id, walker);
    if (nextLayout === layout && phaseKey === key && !lastError) return;
    layout = nextLayout; phaseKey = key; targets.clear(); lastError = '';
    const roots = (nextLayout.decor || []).filter(p => p.festivalLocale?.kind && p.activity?.type);
    const stations = new Map(); // Group expanded station IDs under their movable parent, not absolute coordinates.
    for (const station of nextLayout.npcStations || []) {
      if (!station.festivalLocaleParent) continue;
      if (!stations.has(station.festivalLocaleParent)) stations.set(station.festivalLocaleParent, []);
      stations.get(station.festivalLocaleParent).push(station);
    }
    const places = roots.map(root => ({
      root, kind: root.festivalLocale.kind,
      slots: (stations.get(root.id) || []).filter(s => ['participant','audience','host'].includes(s.festivalRole))
    })).filter(entry => entry.slots.length);
    if (!places.length) return;
    const reserved = new Set(); // Prevent two NPCs walking to the same authored position.
    const residents = (deps.residents?.() || []).slice().sort((a,b) => String(a.id).localeCompare(String(b.id)));
    for (const rec of residents) {
      if (!rec?.id || rec.dead || rec.deceased) continue;
      // Dedicated storytellers, guards and musicians have first refusal on their own authored slot.
      for (const place of places) {
        const host = place.slots.find(s => s.festivalNpcId === rec.id);
        if (!host || reserved.has(host.id)) continue;
        const target = deps.resolve?.(host.id);
        if (!target) continue;
        reserved.add(host.id);
        targets.set(rec.id, { target, root:place.root, kind:place.kind, role:'host' });
        break;
      }
    }
    for (const rec of residents) {
      if (!rec?.id || targets.has(rec.id) || rec.dead || rec.deceased) continue;
      const preference = hash(rec.id + ':' + festival.id);
      // A little free time remains: the original town guest stations still accommodate the overflow.
      if ((preference + shift) % 7 === 0) continue;
      const order = places.map((place,i) => ({place,score:(preference + shift * 3 + i * 11) % 29}))
        .sort((a,b) => a.score - b.score);
      for (const {place} of order) {
        const options = place.slots.filter(s => !s.festivalNpcId && !reserved.has(s.id));
        if (!options.length) continue;
        const wantedRole = (preference + shift) % 4 === 0 ? 'audience' : 'participant';
        const compatible = options.filter(s => s.festivalRole === wantedRole);
        const choices = compatible.length ? compatible : options;
        const picked = choices[(preference + shift) % choices.length];
        const target = deps.resolve?.(picked.id);
        if (!target) { lastError = 'Unregistered station: ' + picked.id; continue; }
        reserved.add(picked.id);
        targets.set(rec.id, { target, root:place.root, kind:place.kind, role:picked.festivalRole });
        break;
      }
    }
  }
  function targetFor(rec) {
    const state = targets.get(rec?.id);
    if (!state || !deps?.active?.()) return null;
    if (state.role === 'host') return state.target; // Music stations retain their tool, roles and stage facing.
    const walker = walkers.get(rec.id);
    const inPosition = walker?.area === 'town' && walker?.root?.position &&
      Math.hypot(walker.root.position.x - state.target.c - .5, walker.root.position.z - state.target.r - .5) < .65;
    if (!inPosition) return state.target;
    if (state.presenting) return state.presenting;
    const focus = { stimulusId:'festival-locale:' + state.root.id,
      x:state.root.col + (Number(state.root.postX)||0) + .5,
      z:state.root.row + (Number(state.root.postZ)||0) + .5 };
    // Each festival has an actual ambient behavior: dance at the two dance courts;
    // listen or watch at the story/duel; face the offering, remembrance or gift exchange.
    const presentation = isDance(state.kind) && state.role === 'participant'
      ? dancePose(state.kind, state.root.id, focus)
      : {socialLookAt:focus, socialWatching:true};
    state.presenting = {...state.target, ...presentation};
    return state.presenting;
  }
  function diagnostics() {
    return {festival:deps?.festival?.()?.id || null, phaseKey,
      locales:[...new Set([...targets.values()].map(s => s.root.id))],
      actors:[...targets].map(([id,s]) => ({id,role:s.role,kind:s.kind,station:s.target.stationId,
        presenting:!!s.presenting})), lastError};
  }
  window.FestivalLocaleActivities = {init, update, clear, targetFor, diagnostics};
})();
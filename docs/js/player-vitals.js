(() => {
  'use strict';

  // Player health/stamina/footing regen tick and the vitals-bar HUD refresh,
  // extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its siblings. `player` is a `const` object never
  // reassigned wholesale (only its properties mutate), so it's passed by
  // direct reference like the other stable object dependencies below.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }
  let deathHandled = false; // Prevents repeated respawn requests if a caller leaves the player at zero for more than one tick.

  // These three resource rows mirror the rings while remaining readable when
  // the avatar is tiny or obscured. The live ResourceSystem owns all values.
  const HUD_RESOURCES = Object.freeze([
    { key: 'health', value: 'health', max: 'maxHealth', label: 'Health' },
    { key: 'stamina', value: 'stamina', max: 'maxStamina', label: 'Stamina' },
    { key: 'footing', value: 'footing', max: 'maxFooting', label: 'Footing' },
  ]); // Drives the shared renderer without maintaining three separate HUD algorithms.
  const hudNodes = Object.create(null); // Caches row, fill, segment nodes and cap overlays for lightweight updates.
  let hudRoot = null; // The bottom-center #vitalsBar; resolved after the body exists.

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function resolveHudNodes() {
    if (hudRoot) return true;
    hudRoot = document.getElementById('vitalsBar');
    if (!hudRoot) return false; // The script loads before <body>; retry on the next tick.
    for (const spec of HUD_RESOURCES) {
      hudNodes[spec.key] = {
        row: document.getElementById('vb' + spec.label + 'Row'),
        fill: document.getElementById('vb' + spec.label + 'Fill'),
        segments: document.getElementById('vb' + spec.label + 'Segments'),
        cap: document.getElementById('vb' + spec.label + 'Cap'),
        segmentsByKey: new Map(), // Preserve CSS animations between ordinary resource ticks.
        fillColor: '', // Tracks the CSS color assigned to the ordinary/exhausted bar across frames.
      };
    }
    return true;
  }

  // Clip lower-priority afflictions against higher-priority occupied portions,
  // as ResourceRings does. Normal-colored fill is drawn beneath the segments.
  function visibleAfflictionSegments(entity, resourceKey, entries, denominator, rs) {
    const claimed = []; // Keeps already-painted intervals from overlapping lower-priority afflictions.
    const visible = []; // Supplies exact [start,end] intervals to the DOM renderer.
    const palette = window.HOBUNJI_CONFIG?.resourceRings?.afflictionColors || {};
    for (const [id, def] of entries.sort((a, b) => (b[1].priority || 0) - (a[1].priority || 0))) {
      const box = rs.getSegmentBox(entity, resourceKey, id);
      if (!box) continue;
      const start = clamp(Number(box.leftPoints) || 0, 0, denominator);
      const end = clamp(start + Math.max(0, Number(box.widthPoints) || 0), 0, denominator);
      if (end <= start) continue;
      let remaining = [{ start, end }]; // Portions of this affliction not already claimed by a stronger one.
      for (const occupied of claimed) {
        remaining = remaining.flatMap(piece => {
          if (occupied.end <= piece.start || occupied.start >= piece.end) return [piece];
          const cuts = []; // Pieces before/after this overlap, retained for the next subtraction.
          if (piece.start < occupied.start) cuts.push({ start: piece.start, end: occupied.start });
          if (piece.end > occupied.end) cuts.push({ start: occupied.end, end: piece.end });
          return cuts;
        });
      }
      for (const piece of remaining) {
        claimed.push(piece);
        visible.push({ ...piece, id, name: def.name || id, color: palette[id] || '#ffffff' });
      }
    }
    return visible;
  }

  // Player HUD only: symbolic visuals deliberately do not touch enemy rings.
  const DRIP_EFFECTS = Object.freeze({
    bleedingHealth: 'drip',
    poisonedHealth: 'drip poison',
    woundedHealth: 'drip wound',
  });
  const BRITTLE_EFFECTS = new Set([
    'bruisedHealth', 'woundedStamina', 'infectedStamina',
    'frostbittenStamina', 'shatteredStamina',
    'scentMarkedHealth', 'drunkenHealth',
  ]);

  function effectClasses(id) {
    const kinds = DRIP_EFFECTS[id] || (BRITTLE_EFFECTS.has(id) ? 'brittle' : '');
    return kinds.split(' ').filter(Boolean).map(kind => ' vb-effect-' + kind).join('');
  }

  function drawAfflictionSegments(nodes, pieces, denominator) {
    const previous = nodes.segmentsByKey;
    const next = new Map();
    const order = [];
    const occurrences = Object.create(null);
    for (const piece of pieces) {
      const nth = occurrences[piece.id] || 0;
      occurrences[piece.id] = nth + 1;
      const key = piece.id + ':' + nth;
      let segment = previous.get(key);
      if (!segment) {
        segment = document.createElement('span');
        segment.className = 'vb-affliction-segment' + effectClasses(piece.id);
        segment.title = piece.name;
      }
      const left = (piece.start / denominator * 100).toFixed(1) + '%';
      const width = ((piece.end - piece.start) / denominator * 100).toFixed(1) + '%';
      if (segment.style.left !== left) segment.style.left = left;
      if (segment.style.width !== width) segment.style.width = width;
      if (segment.style.backgroundColor !== piece.color) segment.style.backgroundColor = piece.color;
      if (segment.style.color !== piece.color) segment.style.color = piece.color;
      next.set(key, segment);
      order.push(segment);
    }
    const rendered = nodes.segments.children;
    // Never replace the span merely because an affliction amount changed:
    // doing so would reset its CSS drop animation dozens of times a second.
    if (rendered.length !== order.length || order.some((item, index) => rendered[index] !== item)) {
      nodes.segments.replaceChildren(...order);
    }
    nodes.segmentsByKey = next;
  }

  function refreshVitalsHud() {
    if (!deps?.player || !resolveHudNodes()) return;
    const rs = window.ResourceSystem; // Supplies authoritative affliction, capacity and exhausted state.
    if (!rs?.AFFLICTIONS || !rs.getEffectiveMax || !rs.getAffliction) return;
    const player = deps.player; // The stable local player entity injected at initialization.
    const colors = window.HOBUNJI_CONFIG?.resourceRings?.colors || {};
    let visibleCount = 0; // Controls container visibility when no resource needs attention.

    for (const spec of HUD_RESOURCES) {
      const nodes = hudNodes[spec.key]; // DOM elements for this resource row.
      if (!nodes?.row || !nodes.fill || !nodes.segments || !nodes.cap) continue;
      const authoredMax = Math.max(0, Number(player[spec.max]) || 0); // Original resource capacity used for band positions.
      const effectiveMax = Math.max(0, Number(rs.getEffectiveMax(player, spec.key)) || 0); // Buffs, reservations and capacity damage.
      const current = Math.max(0, Number(player[spec.value]) || 0); // Live ordinary Health/Stamina/Footing level.
      const exhausted = spec.key === 'stamina' && player.exhaustion?.active === true;
      const activeAfflictions = Object.entries(rs.AFFLICTIONS)
        .filter(([id, def]) => def.resource === spec.key && rs.getAffliction(player, id) > 0); // Same resource-specific active set the rings use.
      const active = exhausted || activeAfflictions.length > 0 || (effectiveMax > 0 && current < effectiveMax - 0.05);
      nodes.row.classList.toggle('is-active', active);
      if (!active) continue;
      visibleCount++;

      const denominator = Math.max(1, authoredMax, effectiveMax); // Allows maximum-resource buffs to show their increased capacity accurately.
      const fillFraction = exhausted
        ? clamp((Number(player.exhaustion.blackStamina) || 0) / 100, 0, 1)
        : clamp(current / denominator, 0, 1); // Exhausted displays black-Stamina recovery, not the forced-zero ordinary Stamina.
      const percent = Math.round(fillFraction * 1000) / 10;
      const desiredWidth = percent + '%';
      if (nodes.fill.style.width !== desiredWidth) nodes.fill.style.width = desiredWidth;
      const fillColor = exhausted ? (colors.exhausted || '#050608') : (colors[spec.key] || '#ffffff');
      if (nodes.fillColor !== fillColor) { nodes.fillColor = fillColor; nodes.fill.style.backgroundColor = fillColor; }
      nodes.row.classList.toggle('is-exhausted', exhausted);

      const missingCapacity = Math.max(0, authoredMax - effectiveMax); // Hatches capacity removed by afflictions (rather than treating it as spent).
      nodes.cap.hidden = exhausted || missingCapacity <= 0.05;
      // Late-registered reducer definitions sometimes lack the canonical
      // reducesEffectiveMax metadata; honor the observed drop in capacity.
      const capAfflicted = activeAfflictions.some(([id, def]) =>
        def.reducesEffectiveMax === true || id === 'drunkenFooting' || id === 'woundedHealth');
      nodes.cap.classList.toggle('is-withered', !nodes.cap.hidden && capAfflicted);
      if (!nodes.cap.hidden) {
        nodes.cap.style.left = (effectiveMax / denominator * 100).toFixed(1) + '%';
        nodes.cap.style.width = (missingCapacity / denominator * 100).toFixed(1) + '%';
      }
      const pieces = exhausted ? [] : visibleAfflictionSegments(player, spec.key, activeAfflictions, denominator, rs);
      drawAfflictionSegments(nodes, pieces, denominator);
      const amountLabel = exhausted
        ? 'Exhausted ' + percent.toFixed(0) + '%'
        : Math.round(current) + ' / ' + Math.round(effectiveMax);
      nodes.row.setAttribute('aria-valuenow', String(Math.round(percent)));
      nodes.row.title = spec.label + ': ' + amountLabel +
        (activeAfflictions.length ? '\n' + activeAfflictions.map(([id, def]) =>
          (def.name || id) + ' ' + Math.round(rs.getAffliction(player, id))).join(', ') : '');
    }
    hudRoot.classList.toggle('is-active', visibleCount > 0);
  }

  function updatePlayerVitals(dt) {
    if (deps.isPlayerInWater?.()) window.KnockbackCollisionImpact?.extinguishInWater?.(deps.player); // Entering standing/permanent water clears Burning before this frame's resource tick can deal another burn tick.
    // Health/Stamina regen, Exhausted/black-stamina recovery, and every
    // affliction's own tick (bleed/poison/congealed/recovery/puke) —
    // see docs/js/combat/resource-system.js. Passing the existing
    // per-second constants keeps un-afflicted regen feeling the same
    // as before this system existed; quiet rest now doubles it.
    const tickResult = window.ResourceSystem?.tick(deps.player, dt, {
      staminaRegenPerSec: deps.PLAYER_STAMINA_REGEN * window.CookingSystem.getStaminaRegenMultiplier() * (window.FestivalSystem?.blessingMultiplier?.('vigor') || 1),
      healthRegenPerSec: deps.PLAYER_HEALTH_REGEN,
    });
    // Direct hits check death in game.js's damagePlayer(), while already-
    // applied Bleeding/Burning/Poison buildup can deal lethal damage inside
    // ResourceSystem.tick(). Route those deaths through the same respawn
    // authority before AI observes a zero-health player.
    if (deps.player.health <= 0) {
      if (!deathHandled) {
        deathHandled = true;
        deps.handlePlayerDeath?.('resource-tick');
      }
    } else {
      deathHandled = false;
    }
    if (tickResult?.puked) deps.showToast('You feel queasy...', false);
    if (deps.player.dodgeCooldownT > 0) deps.player.dodgeCooldownT = Math.max(0, deps.player.dodgeCooldownT - dt);
    refreshVitalsHud();
  }

  window.PlayerVitals = {
    init,
    updatePlayerVitals,
    refreshVitalsHud,
    getDebug: () => ({
      health: Number(deps?.player?.health) || 0,
      maxHealth: Number(deps?.player?.maxHealth) || 0,
      deathHandled,
      hud: {
        visible: !!hudRoot?.classList.contains('is-active'),
        rows: Object.fromEntries(HUD_RESOURCES.map(spec => [
          spec.key, {
            visible: !!hudNodes[spec.key]?.row?.classList.contains('is-active'),
            text: hudNodes[spec.key]?.row?.title || '',
            afflictionSegments: hudNodes[spec.key]?.segments?.children?.length || 0,
          },
        ])),
      }, // Visible in PlayerVitals.getDebug() for mobile-compatible in-game diagnostics.
    }),
  };
})();

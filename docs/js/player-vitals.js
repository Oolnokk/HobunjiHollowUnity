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
        normalSegments: document.getElementById('vb' + spec.label + 'Normal'),
        cap: document.getElementById('vb' + spec.label + 'Cap'),
        segmentsByKey: new Map(), // Preserve CSS animations between ordinary resource ticks.
        normalByKey: new Map(), // Stable straight-edged ordinary resource bands.
        fillColor: '', // Tracks the CSS color assigned to the ordinary/exhausted bar across frames.
      };
    }
    return true;
  }

  // The screen HUD can expand past an entity's authored maximum for capacity buffs.
  // Rebase end-anchored segments onto that expanded scale so recovered ordinary
  // resources do not appear beyond an affliction that should still trail current.
  // Ground rings intentionally keep their authored-max coordinate system.
  function getHudAfflictionBox(entity, resourceKey, id, denominator, rs) {
    const box = rs.getSegmentBox(entity, resourceKey, id); // Preserve ResourceSystem's precedence-aware/custom segment geometry.
    if (!box) return null;
    const def = rs.AFFLICTIONS[id]; // Supplies the anchoring rule for this affliction.
    const maxField = resourceKey === 'health' ? 'maxHealth' : resourceKey === 'footing' ? 'maxFooting' : 'maxStamina'; // Matches ResourceSystem's source maximum.
    const sourceMax = Math.max(0, Number(box.max) || Number(entity[maxField]) || 0); // Original scale used by getSegmentBox.
    const expansion = Math.max(0, denominator - sourceMax); // Extra HUD track length introduced by max-resource buffs.
    if (!def || expansion <= 0) return box;

    let offset = 0; // Moves only segments whose anchor belongs to the expanded end of the track.
    if (def.extend === 'currentBack') {
      const current = Number(entity[resourceKey]) || 0; // Current live resource value, which may exceed the authored maximum.
      offset = clamp(current - sourceMax, 0, expansion);
    } else if (def.extend === 'maxBack') {
      offset = expansion;
    }
    if (!(offset > 0)) return box;
    return { ...box, leftPoints: clamp((Number(box.leftPoints) || 0) + offset, 0, denominator) };
  }

  // Clip lower-priority afflictions against higher-priority occupied portions,
  // as ResourceRings does. Normal-colored fill is drawn beneath the segments.
  function visibleAfflictionSegments(entity, resourceKey, entries, denominator, rs) {
    const claimed = []; // Keeps already-painted intervals from overlapping lower-priority afflictions.
    const visible = []; // Supplies exact [start,end] intervals to the DOM renderer.
    const palette = window.HOBUNJI_CONFIG?.resourceRings?.afflictionColors || {};
    for (const [id, def] of entries.sort((a, b) => (b[1].priority || 0) - (a[1].priority || 0))) {
      const box = getHudAfflictionBox(entity, resourceKey, id, denominator, rs);
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
    'bruisedHealth', 'corrodedHealth', 'woundedStamina', 'infectedStamina',
    'frostbittenStamina', 'shatteredStamina',
    'scentMarkedHealth', 'drunkenHealth',
  ]);

  // Semantic effect classes are derived from the SAME metadata that governs
  // enhanced transactions. Future 2x/3x efficient bands automatically inherit
  // crenellations; future accelerated Held resources inherit ballooning.
  function visualTreatment(id, def, rs) {
    if (DRIP_EFFECTS[id]) return DRIP_EFFECTS[id];
    if (BRITTLE_EFFECTS.has(id)) return 'brittle';
    // A zero-anchored capacity reducer must deform its afflicted band itself,
    // not only the unavailable-cap overlay at the far end of the track.
    if (def?.reducesEffectiveMax) return 'starved';
    const enhanced = rs.ENHANCED_RESOURCE_DEFS?.[id];
    if (Number(enhanced?.tempoMultiplier) > 1) return 'balloon';
    if (Number(enhanced?.conversionRate) > 1) return 'crenellated';
    const tags = def?.tags || [];
    if (tags.includes('mirror')) return 'mirror';
    if (tags.includes('kindling')) return 'ember';
    if (tags.includes('fire')) return 'fire';
    if (tags.includes('entrancement')) return 'entranced';
    return '';
  }

  function effectClasses(treatment) {
    return treatment.split(' ').filter(Boolean).map(kind => ' vb-effect-' + kind).join('');
  }

  // Real player-HUD silhouettes. Normalized SVG viewBoxes avoid measuring layout
  // every tick; the short jagged shapes are seeded, stable and memoized.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_HEIGHT = 40;
  // Severely pinched throat: 13.34 of 40 units, or ~1/3 normal height.
  const STARVED_PATH = 'M 0 0 C 7 10.5 16 13.33 34 13.33 L 66 13.33 C 84 13.33 93 10.5 100 0 L 100 40 C 93 29.5 84 26.67 66 26.67 L 34 26.67 C 16 26.67 7 29.5 0 40 Z';
  const jaggedPaths = new Map();

  function stableSeed(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function jaggedPath(key, fraction) {
    // Every other vertex cuts inward 12.5-20% (half the previous depth).
    // Fewer vertices on narrower segments keep chips short and legible.
    const intervals = Math.max(4, Math.min(24, 2 * Math.round(fraction * 12)));
    const cacheKey = key + ':' + intervals;
    if (jaggedPaths.has(cacheKey)) return jaggedPaths.get(cacheKey);
    let random = stableSeed(key);
    const rand = () => {
      random += 0x6D2B79F5;
      let x = random;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const top = ['M 0 0'];
    for (let i = 1; i < intervals; i++) {
      const x = (i + (rand() - .5) * .22) * 100 / intervals;
      const inset = i % 2 === 1 ? SVG_HEIGHT * (.125 + rand() * .075) : 0;
      top.push('L ' + x.toFixed(2) + ' ' + inset.toFixed(2));
    }
    top.push('L 100 0', 'L 100 ' + SVG_HEIGHT);
    for (let i = intervals - 1; i >= 1; i--) {
      const x = (i + (rand() - .5) * .22) * 100 / intervals;
      const inset = i % 2 === 1 ? SVG_HEIGHT * (.125 + rand() * .075) : 0;
      top.push('L ' + x.toFixed(2) + ' ' + (SVG_HEIGHT - inset).toFixed(2));
    }
    top.push('L 0 ' + SVG_HEIGHT, 'Z');
    const path = top.join(' ');
    jaggedPaths.set(cacheKey, path);
    return path;
  }

  // Swelling displays tempo rather than enhanced resource quantity. The
  // outline expands above and below its normal baseline, but its x endcaps
  // and underlying gameplay segment boundaries stay untouched.
  const BALLOON_REST = 'M 0 0 C 14 -2 24 -3 38 -3 L 62 -3 C 76 -3 86 -2 100 0 L 100 40 C 86 42 76 43 62 43 L 38 43 C 24 43 14 42 0 40 Z';
  const BALLOON_FULL = 'M 0 0 C 14 -7 24 -10 38 -10 L 62 -10 C 76 -10 86 -7 100 0 L 100 40 C 86 47 76 50 62 50 L 38 50 C 24 50 14 47 0 40 Z';
  const crenellatedPaths = new Map();

  function crenellatedPath(fraction) {
    // Castle-like merlons extend 10% out and recess 10% in, evenly spaced
    // with flat ledges (not triangular spikes). Each segment is generated only
    // once at creation, even if it subsequently drains or shrinks.
    const bays = Math.max(3, Math.min(10, Math.round(fraction * 12)));
    if (crenellatedPaths.has(bays)) return crenellatedPaths.get(bays);
    const side = [];
    const top = ['M 0 0'];
    for (let i = 0; i < bays; i++) {
      const left = i * 100 / bays, width = 100 / bays;
      const a = (left + width * .18).toFixed(2);
      const b = (left + width * .46).toFixed(2);
      const c = (left + width * .70).toFixed(2);
      const d = ((i + 1) * 100 / bays).toFixed(2);
      top.push('L ' + a + ' 0', 'L ' + a + ' -4', 'L ' + b + ' -4',
        'L ' + b + ' 4', 'L ' + c + ' 4', 'L ' + c + ' 0', 'L ' + d + ' 0');
      side.push([left, width]);
    }
    top.push('L 100 40');
    for (let i = side.length - 1; i >= 0; i--) {
      const [left, width] = side[i];
      const a = (left + width * .18).toFixed(2);
      const b = (left + width * .46).toFixed(2);
      const c = (left + width * .70).toFixed(2);
      const d = ((i + 1) * 100 / bays).toFixed(2);
      top.push('L ' + c + ' 40', 'L ' + c + ' 44', 'L ' + b + ' 44',
        'L ' + b + ' 36', 'L ' + a + ' 36', 'L ' + a + ' 40',
        'L ' + left.toFixed(2) + ' 40');
    }
    top.push('Z');
    const path = top.join(' ');
    crenellatedPaths.set(bays, path);
    return path;
  }

  function svgElement(tag) {
    return document.createElementNS(SVG_NS, tag);
  }

  function shapeSvg(kind) {
    const svg = svgElement('svg');
    svg.setAttribute('viewBox', '0 0 100 ' + SVG_HEIGHT);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('vb-shape-svg', 'vb-' + kind + '-svg');
    // The opaque dark backing removes the former rectangular fill AND its
    // straight rim, so the coloured outline really follows the deformed mesh.
    const ground = svgElement('rect');
    ground.setAttribute('x', '0');
    ground.setAttribute('y', '0');
    ground.setAttribute('width', '100');
    ground.setAttribute('height', String(SVG_HEIGHT));
    ground.setAttribute('fill', '#000');
    const path = svgElement('path');
    path.setAttribute('fill', '#777');
    path.setAttribute('stroke', '#000');
    path.setAttribute('stroke-width', '4');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(ground, path);
    return { svg, path };
  }

  function ensureBrittleShape(segment, key, fraction, color) {
    if (!segment._vbShape) {
      segment._vbShape = shapeSvg('brittle');
      segment._vbShape.path.setAttribute('d', jaggedPath(key, fraction));
      segment.appendChild(segment._vbShape.svg);
    }
    // Lock the generated vertices for this segment's lifetime: a changing
    // affliction amount only scales the same jagged mesh, never rerolls it.
    const shape = segment._vbShape.path;
    if (shape.getAttribute('fill') !== color) shape.setAttribute('fill', color);
  }

  // A fixed, morphing bottom border gives the droplet a little adhesive
  // neck before release. Each SVG path has IDENTICAL command structure, so
  // the browser interpolates the surface without a game-loop DOM update.
  function liquidEdge(leftDepth = 0, rightDepth = 0) {
    const L = n => Number(n).toFixed(2);
    return 'M 0 0 L 100 0 L 100 40 L 84 40 '
      + 'C 78 40 76 ' + L(40 + rightDepth * .5) + ' 72 ' + L(40 + rightDepth) + ' '
      + 'C 68 ' + L(40 + rightDepth * .5) + ' 66 40 62 40 '
      + 'L 38 40 '
      + 'C 34 40 32 ' + L(40 + leftDepth * .5) + ' 28 ' + L(40 + leftDepth) + ' '
      + 'C 24 ' + L(40 + leftDepth * .5) + ' 22 40 16 40 '
      + 'L 0 40 Z';
  }

  function ensureDripShape(segment, color) {
    if (!segment._vbShape) {
      segment._vbShape = shapeSvg('drip');
      const path = segment._vbShape.path;
      const flat = liquidEdge();
      const left = liquidEdge(18, 0);
      const right = liquidEdge(0, 18);
      path.setAttribute('d', flat);
      // Reduced-motion mode retains the still silhouette and drip markers.
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
        const motion = svgElement('animate');
        motion.setAttribute('attributeName', 'd');
        motion.setAttribute('dur', '1.45s');
        motion.setAttribute('keyTimes', '0;0.06;0.12;0.20;0.5;0.56;0.62;0.70;1');
        motion.setAttribute('values', [flat, left, left, flat, flat, right, right, flat, flat].join(';'));
        motion.setAttribute('repeatCount', 'indefinite');
        path.appendChild(motion);
      }
      segment.appendChild(segment._vbShape.svg);
    }
    const path = segment._vbShape.path;
    if (path.getAttribute('fill') !== color) path.setAttribute('fill', color);
  }

  function ensureEnhancedShape(segment, treatment, fraction, color) {
    if (!segment._vbShape) {
      segment._vbShape = shapeSvg(treatment);
      const path = segment._vbShape.path;
      if (treatment === 'crenellated') path.setAttribute('d', crenellatedPath(fraction));
      else {
        path.setAttribute('d', BALLOON_REST);
        if (!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
          const pulse = svgElement('animate');
          pulse.setAttribute('attributeName', 'd');
          pulse.setAttribute('values', [BALLOON_REST, BALLOON_FULL, BALLOON_REST].join(';'));
          pulse.setAttribute('keyTimes', '0;0.52;1');
          pulse.setAttribute('dur', '1.15s');
          pulse.setAttribute('repeatCount', 'indefinite');
          path.appendChild(pulse);
        }
      }
      segment.appendChild(segment._vbShape.svg);
    }
    const path = segment._vbShape.path;
    if (path.getAttribute('fill') !== color) path.setAttribute('fill', color);
  }

  function ensureStarvedCap(cap, color) {
    if (!cap._vbShape) {
      cap._vbShape = shapeSvg('starved');
      cap._vbShape.path.setAttribute('d', STARVED_PATH);
      cap.appendChild(cap._vbShape.svg);
    }
    const shape = cap._vbShape.path;
    if (shape.getAttribute('fill') !== color) shape.setAttribute('fill', color);
  }

  function drawAfflictionSegments(nodes, pieces, denominator, rs) {
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
        segment._vbTreatment = visualTreatment(piece.id, rs.AFFLICTIONS[piece.id], rs);
        segment.className = 'vb-affliction-segment' + effectClasses(segment._vbTreatment);
        segment.title = piece.name;
      }
      const left = (piece.start / denominator * 100).toFixed(1) + '%';
      const width = ((piece.end - piece.start) / denominator * 100).toFixed(1) + '%';
      if (segment.style.left !== left) segment.style.left = left;
      if (segment.style.width !== width) segment.style.width = width;
      const treatment = segment._vbTreatment;
      const brittle = treatment === 'brittle';
      const dripping = treatment.includes('drip');
      const shaped = brittle || dripping || treatment === 'starved'
        || treatment === 'balloon' || treatment === 'crenellated';
      const base = shaped ? 'transparent' : piece.color;
      if (segment.style.backgroundColor !== base) segment.style.backgroundColor = base;
      if (segment.style.color !== piece.color) segment.style.color = piece.color;
      if (brittle) ensureBrittleShape(segment, key, (piece.end - piece.start) / denominator, piece.color);
      if (dripping) ensureDripShape(segment, piece.color);
      if (treatment === 'starved') ensureStarvedCap(segment, piece.color);
      if (treatment === 'balloon' || treatment === 'crenellated') {
        ensureEnhancedShape(segment, treatment, (piece.end - piece.start) / denominator, piece.color);
      }
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

  // Ordinary resource fill is now segmented too: no horizontal border runs
  // through another affliction's shape, and the full track has only end caps.
  function drawNormalSegments(nodes, afflicted, end, denominator, color) {
    const ordered = [...afflicted].sort((a, b) => a.start - b.start);
    const unclaimed = [];
    let cursor = 0;
    for (const piece of ordered) {
      const left = clamp(piece.start, 0, end);
      const right = clamp(piece.end, 0, end);
      if (left > cursor + .001) unclaimed.push({ start: cursor, end: left });
      cursor = Math.max(cursor, right);
    }
    if (end > cursor + .001) unclaimed.push({ start: cursor, end });
    const previous = nodes.normalByKey, next = new Map(), order = [];
    for (let i = 0; i < unclaimed.length; i++) {
      const piece = unclaimed[i], key = String(i);
      let segment = previous.get(key);
      if (!segment) {
        segment = document.createElement('span');
        segment.className = 'vb-normal-segment';
      }
      const left = (piece.start / denominator * 100).toFixed(1) + '%';
      const width = ((piece.end - piece.start) / denominator * 100).toFixed(1) + '%';
      if (segment.style.left !== left) segment.style.left = left;
      if (segment.style.width !== width) segment.style.width = width;
      if (segment.style.backgroundColor !== color) segment.style.backgroundColor = color;
      next.set(key, segment);
      order.push(segment);
    }
    const rendered = nodes.normalSegments.children;
    if (rendered.length !== order.length || order.some((el, i) => rendered[i] !== el)) {
      nodes.normalSegments.replaceChildren(...order);
    }
    nodes.normalByKey = next;
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
      if (!nodes?.row || !nodes.fill || !nodes.segments || !nodes.normalSegments || !nodes.cap) continue;
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
      const capHidden = exhausted || missingCapacity <= 0.05;
      if (nodes.cap.hidden !== capHidden) nodes.cap.hidden = capHidden;
      // Late-registered reducer definitions sometimes lack the canonical
      // reducesEffectiveMax metadata; honor the observed drop in capacity.
      const capAfflicted = activeAfflictions.some(([id, def]) =>
        def.reducesEffectiveMax === true || id === 'drunkenFooting' || id === 'woundedHealth');
      const withered = !nodes.cap.hidden && capAfflicted;
      nodes.cap.classList.toggle('is-withered', withered);
      if (withered) {
        const reducer = activeAfflictions
          .filter(([id, def]) => def.reducesEffectiveMax === true || id === 'drunkenFooting' || id === 'woundedHealth')
          .sort((a, b) => (b[1].priority || 0) - (a[1].priority || 0))[0];
        const reducerColor = window.HOBUNJI_CONFIG?.resourceRings?.afflictionColors?.[reducer?.[0]] || '#666';
        ensureStarvedCap(nodes.cap, reducerColor === '#000000' ? '#555' : reducerColor);
      }
      if (!nodes.cap.hidden) {
        const capLeft = (effectiveMax / denominator * 100).toFixed(1) + '%';
        const capWidth = (missingCapacity / denominator * 100).toFixed(1) + '%';
        if (nodes.cap.style.left !== capLeft) nodes.cap.style.left = capLeft;
        if (nodes.cap.style.width !== capWidth) nodes.cap.style.width = capWidth;
      }
      const pieces = exhausted ? [] : visibleAfflictionSegments(player, spec.key, activeAfflictions, denominator, rs);
      drawAfflictionSegments(nodes, pieces, denominator, rs);
      drawNormalSegments(nodes, pieces, fillFraction * denominator, denominator, fillColor);
      const amountLabel = exhausted
        ? 'Exhausted ' + percent.toFixed(0) + '%'
        : Math.round(current) + ' / ' + Math.round(effectiveMax);
      // Runs every frame while a bar is showing: compare before writing so
      // idle frames queue no attribute mutations (AGENTS.md per-frame rule).
      const valueNow = String(Math.round(percent));
      if (nodes.row.getAttribute('aria-valuenow') !== valueNow) nodes.row.setAttribute('aria-valuenow', valueNow);
      const title = spec.label + ': ' + amountLabel +
        (activeAfflictions.length ? '\n' + activeAfflictions.map(([id, def]) =>
          (def.name || id) + ' ' + Math.round(rs.getAffliction(player, id))).join(', ') : '');
      if (nodes.row.title !== title) nodes.row.title = title;
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

// Resource rings — the ground-projected Health/Stamina HUD ported from the
// "Resource Afflictions Battle Demo" prototype's buildGroundRingForFighter().
// Builds flat annular-arc meshes (not sprites/DOM) that sit on the ground
// under a character, same idea as this game's existing per-character
// ground shadow (see makeCharacterGroundShadow in game.js) — a sibling
// THREE.Object3D that tracks the character's feet without inheriting the
// body's own rotation/squash.
//
// Requires docs/js/combat/resource-system.js (reads entity.health/
// maxHealth/stamina/maxStamina/afflictions/exhaustion through it) and
// three.js. Everything here is namespaced on window.ResourceRings.
(() => {
  "use strict";
  if (typeof THREE === "undefined") { console.error("resource-rings.js requires three.js to load first"); return; }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function parseCssColor(value, fallback) {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return fallback;
    if (value.startsWith("#")) return Number.parseInt(value.slice(1), 16);
    return fallback;
  }

  // Same fixed sweep angles (degrees) as the source demo: Health occupies
  // the right side of the ring, Stamina the left, leaving a gap at the
  // front (south, ~0deg) and a smaller one at the back — this is what
  // reads as an "open ring" HUD rather than a full annulus.
  const HEALTH_ARC = { start: 292, end: 186 };
  const STAMINA_ARC = { start: 174, end: 68 };

  const HEALTH_COLOR = 0x55d76f;
  const STAMINA_COLOR = 0x67b7ff;
  const EXHAUSTED_COLOR = 0x050608;
  const OUTLINE_COLOR = 0x000000;
  // Fill only — each affliction now entirely replaces the bar's color over
  // the points it claims (see buildGroundResourceArc's precedence-clipped
  // segments) rather than tinting an overlay on top of it, so there's no
  // separate outline-per-affliction color anymore; every segment boundary
  // gets the same black outline (see addSegmentOutlines).
  const AFFLICTION_COLORS = {
    woundedStamina: 0xff9b2f,
    bleedingHealth: 0xcf1e2e,
    congealedHealth: 0xc98d41,
    infectedStamina: 0x284f2a,
    windedStamina: 0x90949c,
    bruisedHealth: 0x4c42a9,
    shatteredStamina: 0x8c4ad9,
    poisonedHealth: 0x37651c,
  };

  function makeFlatArcGeometry(innerRadius, outerRadius, startDeg, endDeg, segments) {
    const span = endDeg - startDeg;
    const safeSegments = Math.max(2, Math.ceil(Math.abs(span) / 8), segments);
    const vertices = [];
    const indices = [];

    for (let i = 0; i <= safeSegments; i++) {
      const t = i / safeSegments;
      const angle = (startDeg + span * t) * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      vertices.push(cos * outerRadius, 0, sin * outerRadius);
      vertices.push(cos * innerRadius, 0, sin * innerRadius);
    }

    for (let i = 0; i < safeSegments; i++) {
      const outerA = i * 2;
      const innerA = outerA + 1;
      const outerB = outerA + 2;
      const innerB = outerA + 3;
      indices.push(outerA, outerB, innerA, innerA, outerB, innerB);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function makeArcMesh(innerRadius, outerRadius, startDeg, endDeg, color, opacity, yOffset, segments = 32) {
    const geometry = makeFlatArcGeometry(innerRadius, outerRadius, startDeg, endDeg, segments);
    geometry.translate(0, yOffset, 0);
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
      // X-ray through grass billboards/foliage/anything else in front —
      // this HUD should always read, not get lost behind ground clutter.
      // renderOrder (below) still controls draw order among the ring's own
      // stacked layers and against other depthTest:false objects.
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = Math.round(yOffset * 100000);
    return mesh;
  }

  function makeDashedArc(innerRadius, outerRadius, startDeg, endDeg, color, opacity, yOffset) {
    const group = new THREE.Group();
    const dashCount = 9;
    const span = endDeg - startDeg;
    for (let i = 0; i < dashCount; i++) {
      const dashStart = startDeg + span * (i / dashCount);
      const dashEnd = startDeg + span * ((i + .48) / dashCount);
      group.add(makeArcMesh(innerRadius, outerRadius, dashStart, dashEnd, color, opacity, yOffset + i * .0008, 5));
    }
    return group;
  }

  // Subtracts every range in `claimed` from every range in `ranges`,
  // splitting a range into two pieces if a claim falls in its middle.
  // Ranges are plain {start,end} point values (not fractions/angles).
  function subtractRanges(ranges, claimed) {
    let result = ranges;
    for (const c of claimed) {
      const next = [];
      for (const r of result) {
        if (c.end <= r.start || c.start >= r.end) { next.push(r); continue; }
        if (c.start > r.start) next.push({ start: r.start, end: Math.min(c.start, r.end) });
        if (c.end < r.end) next.push({ start: Math.max(c.end, r.start), end: r.end });
      }
      result = next.filter(p => p.end - p.start > 0.001);
    }
    return result;
  }

  function buildGroundResourceArc(entity, spec, radius) {
    const RS = window.ResourceSystem;
    const group = new THREE.Group();
    const max = spec.resourceKey === "health" ? entity.maxHealth : entity.maxStamina;
    const current = spec.resourceKey === "health" ? entity.health : entity.stamina;
    const displayFraction = RS.getRingFillFraction(entity, spec.resourceKey);
    const effectiveMax = RS.getEffectiveMax(entity, spec.resourceKey);
    const capFraction = max ? clamp(effectiveMax / max, 0, 1) : 0;
    const inner = radius * spec.innerMul, outer = radius * spec.outerMul;
    const isExhaustedStamina = spec.resourceKey === "stamina" && entity.exhaustion.active;

    // Background track spans the full arc regardless of fill — the black
    // rim/cut outlines added at the end read against this even where the
    // resource is empty.
    group.add(makeArcMesh(inner, outer, spec.start, spec.end, 0xffffff, .11, spec.y, 36));

    const boundaryPoints = new Set([0, max]);

    if (isExhaustedStamina) {
      if (displayFraction > 0) {
        const fillEnd = spec.start + (spec.end - spec.start) * displayFraction;
        group.add(makeArcMesh(inner + radius * .02, outer - radius * .02, spec.start, fillEnd, spec.color, .95, spec.y + .004, 34));
        boundaryPoints.add(displayFraction * max);
      }
      group.add(makeDashedArc(inner + radius * .04, outer - radius * .04, spec.start, spec.end, 0xffffff, .34, spec.y + .009));
    } else {
      // Precedence-clipped affliction segments: the most dire (highest
      // priority) affliction claims its full point range first; any less
      // dire affliction that would otherwise share those same points has
      // them cut away from its own range instead (see subtractRanges) —
      // this only actually changes anything once two afflictions' ranges
      // overlap (e.g. Health fully claimed by non-fatal effects with more
      // piled on top), which is exactly when precedence needs to apply.
      // Each surviving segment is its own solid color, not a tint over the
      // base fill.
      const claimed = [];
      const afflictionSegments = [];
      const activeIds = Object.entries(RS.AFFLICTIONS)
        .filter(([id, def]) => def.resource === spec.resourceKey && RS.getAffliction(entity, id) > 0)
        .sort((a, b) => b[1].priority - a[1].priority);

      for (const [id] of activeIds) {
        const box = RS.getSegmentBox(entity, spec.resourceKey, id);
        if (box.widthPoints <= 0 || !max) continue;
        const raw = { start: clamp(box.leftPoints, 0, max), end: clamp(box.leftPoints + box.widthPoints, 0, max) };
        if (raw.end <= raw.start) continue;
        for (const piece of subtractRanges([raw], claimed)) {
          afflictionSegments.push({ ...piece, id });
          claimed.push(piece);
        }
      }

      // Normal-color fill: whatever of [0, current] isn't claimed above.
      const normalPieces = max ? subtractRanges([{ start: 0, end: clamp(current, 0, max) }], claimed) : [];
      for (const p of normalPieces) {
        const sf = p.start / max, ef = p.end / max;
        group.add(makeArcMesh(inner + radius * .02, outer - radius * .02, spec.start + (spec.end - spec.start) * sf, spec.start + (spec.end - spec.start) * ef, spec.color, .95, spec.y + .004, 34));
        boundaryPoints.add(p.start); boundaryPoints.add(p.end);
      }

      for (const seg of afflictionSegments) {
        const def = RS.AFFLICTIONS[seg.id];
        const color = AFFLICTION_COLORS[seg.id] ?? 0xffffff;
        const sf = seg.start / max, ef = seg.end / max;
        group.add(makeArcMesh(inner + radius * .02, outer - radius * .02, spec.start + (spec.end - spec.start) * sf, spec.start + (spec.end - spec.start) * ef, color, .95, spec.y + .006 + def.priority * .00001, 24));
        boundaryPoints.add(seg.start); boundaryPoints.add(seg.end);
      }

      if (effectiveMax < max) {
        const capAngle = spec.start + (spec.end - spec.start) * capFraction;
        group.add(makeArcMesh(inner - radius * .025, outer + radius * .025, capAngle - 1.7, capAngle + 1.7, 0xffffff, .9, spec.y + .014, 6));
      }
    }

    addSegmentOutlines(group, spec, radius, max, boundaryPoints);

    if (spec.resourceKey === "health") addHealthRiskGroundArc(group, entity, spec, radius);
    // Tags this resource's whole arc group (fills + outlines together) so
    // updateAfflictionPulses/applyAfflictionPulseTransform below can find it
    // again on later frames without needing a rebuild.
    group.userData.resourceKey = spec.resourceKey;
    return group;
  }

  // ── Affliction "just added" pulse/shake feedback ──────────────────────
  // Whenever a resource's total afflicted points go up (a fresh application
  // — bleed ticking down, recovery, etc. don't count since those only ever
  // decrease it), that resource's whole arc group gets a brief scale pulse
  // + position jitter so a landed affliction reads as an event instead of
  // its color just silently appearing next frame.
  const AFFLICTION_PULSE_DURATION_S = 1.0;
  const AFFLICTION_PULSE_SCALE = 0.22;
  const AFFLICTION_SHAKE_UNITS = 0.035;

  function afflictionTotalFor(entity, resourceKey) {
    const RS = window.ResourceSystem;
    let total = 0;
    for (const [id, def] of Object.entries(RS.AFFLICTIONS)) {
      if (def.resource === resourceKey) total += RS.getAffliction(entity, id);
    }
    return total;
  }

  // Compares this frame's affliction totals against last frame's to decide
  // whether to (re)start a pulse — called every updateRingHud, independent
  // of whether the ring's geometry itself needed rebuilding this frame.
  function updateAfflictionPulses(entity, nowMs) {
    if (!entity._afflictionPulsePrev) entity._afflictionPulsePrev = { health: 0, stamina: 0 };
    if (!entity._afflictionPulseUntil) entity._afflictionPulseUntil = { health: 0, stamina: 0 };
    for (const key of ["health", "stamina"]) {
      const total = afflictionTotalFor(entity, key);
      if (total > entity._afflictionPulsePrev[key] + 0.05) {
        entity._afflictionPulseUntil[key] = nowMs + AFFLICTION_PULSE_DURATION_S * 1000;
      }
      entity._afflictionPulsePrev[key] = total;
    }
  }

  // Applies the current pulse transform to whichever child groups are
  // tagged with a resourceKey — runs every frame (not just on rebuild) so
  // the animation keeps playing across frames where nothing else changed.
  function applyAfflictionPulseTransform(hudGroup, entity, nowMs) {
    for (const child of hudGroup.children) {
      const key = child.userData?.resourceKey;
      if (!key) continue;
      const until = entity._afflictionPulseUntil?.[key] || 0;
      const remaining = (until - nowMs) / 1000;
      if (remaining > 0) {
        const t = 1 - remaining / AFFLICTION_PULSE_DURATION_S; // 0 -> 1 across the pulse
        const falloff = 1 - t;
        child.scale.setScalar(1 + AFFLICTION_PULSE_SCALE * falloff * Math.sin(t * Math.PI * 5));
        const phase = key === "health" ? 0 : Math.PI * 0.5;
        child.position.x = Math.sin(nowMs / 1000 * 42 + phase) * AFFLICTION_SHAKE_UNITS * falloff;
        child.position.z = Math.cos(nowMs / 1000 * 55 + phase) * AFFLICTION_SHAKE_UNITS * falloff;
      } else if (child.scale.x !== 1 || child.position.x !== 0 || child.position.z !== 0) {
        child.scale.setScalar(1);
        child.position.x = 0;
        child.position.z = 0;
      }
    }
  }

  // Black outline around the whole ring's rim (inner+outer edge, spanning
  // the full arc even across empty/unfilled space) plus a thin radial line
  // at every boundary between two differently-colored segments, so the
  // whole bar reads as cleanly divided pieces rather than blended color.
  function addSegmentOutlines(group, spec, radius, max, boundaryPoints) {
    const inner = radius * spec.innerMul, outer = radius * spec.outerMul;
    const rim = radius * .02;
    const outlineY = spec.y + .05;
    group.add(makeArcMesh(inner - rim, inner, spec.start, spec.end, OUTLINE_COLOR, .95, outlineY, 36));
    group.add(makeArcMesh(outer, outer + rim, spec.start, spec.end, OUTLINE_COLOR, .95, outlineY, 36));

    const halfWidthDeg = 1.1;
    for (const pt of boundaryPoints) {
      const frac = max ? clamp(pt / max, 0, 1) : 0;
      const angle = spec.start + (spec.end - spec.start) * frac;
      group.add(makeArcMesh(inner - rim, outer + rim, angle - halfWidthDeg, angle + halfWidthDeg, OUTLINE_COLOR, .95, outlineY + .002, 4));
    }
  }

  function addHealthRiskGroundArc(group, entity, spec, radius) {
    const RS = window.ResourceSystem;
    const directRisk = Math.min(entity.health, RS.getAffliction(entity, "woundedStamina") + RS.getAffliction(entity, "infectedStamina"));
    if (directRisk <= 0 || !entity.maxHealth) return;

    const inner = radius * spec.innerMul, outer = radius * spec.outerMul;
    const currentFraction = clamp(entity.health / entity.maxHealth, 0, 1);
    const riskFraction = clamp(directRisk / entity.maxHealth, 0, 1);
    const startFraction = clamp(currentFraction - riskFraction, 0, 1);
    const startAngle = spec.start + (spec.end - spec.start) * startFraction;
    const endAngle = spec.start + (spec.end - spec.start) * currentFraction;
    group.add(makeDashedArc(inner + radius * .08, outer - radius * .08, startAngle, endAngle, 0xff9b2f, .96, spec.y + .03));
  }

  function buildGroundRingForFighter(entity, radius) {
    const group = new THREE.Group();
    // Matches the source demo's ringGroup.rotation.y = Math.PI/2 — the
    // HEALTH_ARC/STAMINA_ARC angles above are authored against that same
    // fixed offset, so the group needs it too or the whole ring reads 90deg
    // off from its intended facing.
    group.rotation.y = Math.PI / 2;
    const healthSpec = { resourceKey: "health", ...HEALTH_ARC, color: HEALTH_COLOR, innerMul: .74, outerMul: .92, y: .018 };
    const staminaSpec = { resourceKey: "stamina", ...STAMINA_ARC, color: entity.exhaustion.active ? EXHAUSTED_COLOR : STAMINA_COLOR, innerMul: .74, outerMul: .92, y: .02 };
    group.add(buildGroundResourceArc(entity, healthSpec, radius));
    group.add(buildGroundResourceArc(entity, staminaSpec, radius));
    return group;
  }

  // Auto-target lock indicator (see game.js's findAutoTarget/swapAutoTarget)
  // — two full red rings sitting just outside the resource ring's own
  // footprint (outerMul .92): a slightly larger one, and a smaller one a
  // bit inside it, both beneath (a lower y than) the resource rings so they
  // read as a halo the resource ring sits on top of. Rotationally
  // symmetric, so the group.rotation.y = Math.PI/2 on the resource ring
  // above doesn't matter for these.
  const TARGET_RING_COLOR = 0xff2020;
  function buildTargetIndicatorRings(radius) {
    const group = new THREE.Group();
    const y = .008;
    group.add(makeArcMesh(radius * 1.04, radius * 1.10, 0, 360, TARGET_RING_COLOR, .9, y, 48));
    group.add(makeArcMesh(radius * .96, radius * 1.00, 0, 360, TARGET_RING_COLOR, .9, y + .002, 48));
    return group;
  }

  // Homeostasis = full Health, full Stamina, not Exhausted, and no active
  // affliction — the ring should be invisible at rest and only appear once
  // something is actually missing or afflicted.
  function isHomeostatic(entity) {
    if (entity.exhaustion.active) return false;
    if (entity.health < entity.maxHealth) return false;
    if (entity.stamina < entity.maxStamina) return false;
    return Object.values(entity.afflictions).every(v => !(v > 0));
  }

  function clearGroup(group) {
    while (group.children.length) disposeObject(group.children.pop());
  }

  function disposeObject(object) {
    if (object.children) while (object.children.length) disposeObject(object.children.pop());
    if (object.geometry) object.geometry.dispose();
    if (object.material) {
      if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
      else object.material.dispose();
    }
  }

  // Change-detection key so the (fairly expensive, geometry-rebuilding)
  // ring only regenerates when Health/Stamina/afflictions/exhaustion
  // actually changed, not every single frame.
  function makeHudKey(entity) {
    return `${entity.health}|${entity.maxHealth}|${entity.stamina}|${entity.maxStamina}|${entity.exhaustion.active}|${entity.exhaustion.blackStamina}|${Object.values(entity.afflictions).join(",")}`;
  }

  const HOMEOSTASIS_KEY = "homeostasis";

  // Creates (once) and updates the ring group parented directly on `scene`
  // — call every frame from the entity's own mesh-sync function, then
  // position the returned group at the entity's ground point yourself
  // (same as this game's existing groundShadow.position.set(...) calls).
  // opts.isTarget: true while this entity is the player's current weapon
  // auto-target (see game.js's findAutoTarget) — draws the red target-lock
  // rings and forces the resource ring visible even at full Health/Stamina,
  // so targeting a healthy creature doesn't leave you with no ring at all
  // until it first takes damage.
  function updateRingHud(entity, scene, radius = .6, opts = {}) {
    const isTarget = !!opts.isTarget;
    const nowMs = performance.now();
    updateAfflictionPulses(entity, nowMs);
    if (!entity._ringHud) {
      entity._ringHud = new THREE.Group();
      entity._ringHud.name = "resource_ring_hud";
      entity._ringHudKey = "";
      scene.add(entity._ringHud);
    } else if (entity._ringHud.parent !== scene) {
      // Creature swapped areas/scenes (see spawnCreatureEntity/despawnCreature) —
      // reparent instead of leaking a ring into the old scene.
      entity._ringHud.parent?.remove(entity._ringHud);
      scene.add(entity._ringHud);
    }

    if (isHomeostatic(entity) && !isTarget) {
      entity._ringHud.visible = false;
      if (entity._ringHudKey !== HOMEOSTASIS_KEY) {
        entity._ringHudKey = HOMEOSTASIS_KEY;
        clearGroup(entity._ringHud);
      }
      return entity._ringHud;
    }

    entity._ringHud.visible = true;
    const key = makeHudKey(entity) + "|" + radius + "|" + isTarget;
    if (key !== entity._ringHudKey) {
      entity._ringHudKey = key;
      clearGroup(entity._ringHud);
      entity._ringHud.add(buildGroundRingForFighter(entity, radius));
      if (isTarget) entity._ringHud.add(buildTargetIndicatorRings(radius));
    }
    applyAfflictionPulseTransform(entity._ringHud, entity, nowMs);
    return entity._ringHud;
  }

  function disposeRingHud(entity) {
    if (!entity._ringHud) return;
    entity._ringHud.parent?.remove(entity._ringHud);
    clearGroup(entity._ringHud);
    entity._ringHud = null;
    entity._ringHudKey = "";
  }

  window.ResourceRings = {
    updateRingHud,
    disposeRingHud,
    parseCssColor,
    // Exposed so other visual systems (game.js's weapon ghost-trail) can
    // reuse the exact same per-affliction color the resource bars themselves
    // use, instead of keeping a second copy of this mapping in sync by hand.
    AFFLICTION_COLORS,
  };
})();

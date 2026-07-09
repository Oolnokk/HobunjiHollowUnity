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
  const AFFLICTION_COLORS = {
    woundedStamina: { fill: 0xff9b2f, outline: 0xffdf9e },
    bleedingHealth: { fill: 0xcf1e2e, outline: 0x66ff83 },
    congealedHealth: { fill: 0xc98d41, outline: 0xffeec4 },
    infectedStamina: { fill: 0x284f2a, outline: 0xb7ff39 },
    windedStamina: { fill: 0x90949c, outline: 0xffffff },
    bruisedHealth: { fill: 0x4c42a9, outline: 0xc6beff },
    shatteredStamina: { fill: 0x8c4ad9, outline: 0xf0d2ff },
    poisonedHealth: { fill: 0x37651c, outline: 0xd3ff59 },
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
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = Math.round(yOffset * 10000);
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

  function buildGroundResourceArc(entity, spec, radius) {
    const RS = window.ResourceSystem;
    const group = new THREE.Group();
    const max = spec.resourceKey === "health" ? entity.maxHealth : entity.maxStamina;
    const displayFraction = RS.getRingFillFraction(entity, spec.resourceKey);
    const effectiveMax = RS.getEffectiveMax(entity, spec.resourceKey);
    const capFraction = max ? clamp(effectiveMax / max, 0, 1) : 0;

    const inner = radius * spec.innerMul, outer = radius * spec.outerMul;

    group.add(makeArcMesh(inner, outer, spec.start, spec.end, 0xffffff, .11, spec.y, 36));

    if (displayFraction > 0) {
      group.add(makeArcMesh(inner + radius * .02, outer - radius * .02, spec.start, spec.start + (spec.end - spec.start) * displayFraction, spec.color, .95, spec.y + .004, 34));
    }

    const isExhaustedStamina = spec.resourceKey === "stamina" && entity.exhaustion.active;
    if (isExhaustedStamina) {
      group.add(makeDashedArc(inner + radius * .04, outer - radius * .04, spec.start, spec.end, 0xffffff, .34, spec.y + .009));
    } else {
      addAfflictionArcMeshes(group, entity, spec, radius);
      if (effectiveMax < max) {
        const capAngle = spec.start + (spec.end - spec.start) * capFraction;
        group.add(makeArcMesh(inner - radius * .025, outer + radius * .025, capAngle - 1.7, capAngle + 1.7, 0xffffff, .9, spec.y + .014, 6));
      }
    }

    if (spec.resourceKey === "health") addHealthRiskGroundArc(group, entity, spec, radius);
    return group;
  }

  function addAfflictionArcMeshes(group, entity, spec, radius) {
    const RS = window.ResourceSystem;
    const inner = radius * spec.innerMul, outer = radius * spec.outerMul;
    const max = spec.resourceKey === "health" ? entity.maxHealth : entity.maxStamina;
    if (!max) return;

    const activeIds = Object.entries(RS.AFFLICTIONS)
      .filter(([id, def]) => def.resource === spec.resourceKey && RS.getAffliction(entity, id) > 0)
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([id]) => id);

    for (const id of activeIds) {
      const box = RS.getSegmentBox(entity, spec.resourceKey, id);
      if (box.widthPoints <= 0) continue;
      const startFraction = clamp(box.leftPoints / max, 0, 1);
      const endFraction = clamp((box.leftPoints + box.widthPoints) / max, 0, 1);
      if (endFraction <= startFraction) continue;

      const startAngle = spec.start + (spec.end - spec.start) * startFraction;
      const endAngle = spec.start + (spec.end - spec.start) * endFraction;
      const colors = AFFLICTION_COLORS[id] || { fill: 0xffffff, outline: 0xffffff };
      const def = RS.AFFLICTIONS[id];
      group.add(makeArcMesh(inner + radius * .04, outer - radius * .04, startAngle, endAngle, colors.fill, .88, spec.y + .018 + def.priority * .00004, 20));
      group.add(makeArcMesh(inner + radius * .005, inner + radius * .025, startAngle, endAngle, colors.outline, .78, spec.y + .022 + def.priority * .00004, 20));
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
    const healthSpec = { resourceKey: "health", ...HEALTH_ARC, color: HEALTH_COLOR, innerMul: .74, outerMul: .92, y: .018 };
    const staminaSpec = { resourceKey: "stamina", ...STAMINA_ARC, color: entity.exhaustion.active ? EXHAUSTED_COLOR : STAMINA_COLOR, innerMul: .74, outerMul: .92, y: .02 };
    group.add(buildGroundResourceArc(entity, healthSpec, radius));
    group.add(buildGroundResourceArc(entity, staminaSpec, radius));
    return group;
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

  // Creates (once) and updates the ring group parented directly on `scene`
  // — call every frame from the entity's own mesh-sync function, then
  // position the returned group at the entity's ground point yourself
  // (same as this game's existing groundShadow.position.set(...) calls).
  function updateRingHud(entity, scene, radius = .6) {
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

    const key = makeHudKey(entity) + "|" + radius;
    if (key !== entity._ringHudKey) {
      entity._ringHudKey = key;
      clearGroup(entity._ringHud);
      entity._ringHud.add(buildGroundRingForFighter(entity, radius));
    }
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
  };
})();

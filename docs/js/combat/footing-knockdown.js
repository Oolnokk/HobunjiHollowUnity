// Shared zero-Footing knockdown presentation.
//
// The ResourceSystem/footing-damage-recovery bridge owns when Footing breaks;
// this module owns how that break is presented. Humanoid players keep using the
// authored ImpactRagdollPlayback blendspace. Animal cutout avatars get a
// reversible non-lethal tumble based on the same prone state instead of reusing
// humanoid leg data that does not fit their rigs.
(() => {
  'use strict';

  if (window.HobunjiFootingKnockdown) return;

  const ANIMAL_FALL_DURATION_S = 0.46;
  const ANIMAL_RECOVER_DURATION_S = 0.38;
  const ANIMAL_HOP_HEIGHT_FACTOR = 0.18;
  const EPSILON = 0.01;
  const animalStates = new Set();
  let creatureDeathHookInstalled = false;
  let breakCount = 0;

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const smooth = value => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
  };
  const normalizeAngle = angle => {
    let a = Number(angle) || 0;
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
  };

  function vectorAngle(x, y) {
    const vx = Number(x) || 0;
    const vy = Number(y) || 0;
    return Math.hypot(vx, vy) > EPSILON ? Math.atan2(vy, vx) : null;
  }

  // Blend clips describe where the impact SOURCE is. The break bridge gives us
  // where the body should FALL, so invert it before selecting a blend pole.
  function cardinalFromFallVector(entity, fallX, fallY) {
    const fallAngle = vectorAngle(fallX, fallY);
    if (fallAngle === null) return 'front';
    const facing = Number(entity?.facing);
    const localFall = Number.isFinite(facing) ? normalizeAngle(fallAngle - facing) : fallAngle;
    const sourceAngle = normalizeAngle(localFall + Math.PI);
    const quarter = Math.PI / 4;
    if (sourceAngle >= -quarter && sourceAngle < quarter) return 'front';
    if (sourceAngle >= quarter && sourceAngle < quarter * 3) return 'right';
    if (sourceAngle <= -quarter && sourceAngle > -quarter * 3) return 'left';
    return 'back';
  }

  function isLocalPlayer(entity) {
    return !!entity && entity === window.Combat?.deps?.player;
  }

  function isAnimal(entity) {
    return !!(entity?.avatarRef?.group && entity?.def?.sprites);
  }

  function animalFootingIsFull(entity) {
    const max = Number(window.ResourceSystem?.getEffectiveMax?.(entity, 'footing')) || Number(entity?.maxFooting) || 0;
    return max > 0 && Number(entity?.footing) >= max - 0.05;
  }

  function resetAnimalPlaneRestPose(entity) {
    if (entity?.avatarRef?.frontPlane) entity.avatarRef.frontPlane.rotation.y = Math.PI / 2;
    if (entity?.avatarRef?.backPlane) entity.avatarRef.backPlane.rotation.y = -Math.PI / 2;
    if (entity?.avatarRef?.legsPivot) entity.avatarRef.legsPivot.rotation.y = 0;
  }

  function beginAnimalKnockdown(entity, detail) {
    if (!isAnimal(entity) || entity.health <= 0) return false;
    window.Combat?.animalAttacks?.cancel?.(entity);
    const group = entity.avatarRef.group;
    const fallAngle = vectorAngle(detail?.fallX, detail?.fallY);
    const facing = Number.isFinite(Number(entity.facing)) ? Number(entity.facing) : 0;
    const localFall = fallAngle === null ? 0 : normalizeAngle(fallAngle - facing);
    const forward = Math.cos(localFall);
    const sideways = Math.sin(localFall);

    entity._footingKnockdownVisual = {
      phase: 'fall',
      elapsed: 0,
      startX: group.rotation.x,
      startY: group.rotation.y,
      startZ: group.rotation.z,
      // +Z/-Z are both valid lying-flat poses for the animal cutout. Front/
      // back travel chooses the sign; side travel adds a yaw quarter-turn so
      // the collapse remains visibly directional before it settles.
      targetZ: (forward < 0 ? -1 : 1) * Math.PI / 2,
      yawOffset: sideways * Math.PI / 2,
      fallAngle: fallAngle ?? facing,
      cause: detail?.cause || 'unknown',
    };
    entity.scaleY = 1;
    if (entity.avatarRef.group?.scale) entity.avatarRef.group.scale.y = 1;
    resetAnimalPlaneRestPose(entity);
    animalStates.add(entity);
    return true;
  }

  function updateAnimalKnockdown(entity, dt) {
    const visual = entity?._footingKnockdownVisual;
    const group = entity?.avatarRef?.group;
    if (!visual || !group) {
      animalStates.delete(entity);
      return;
    }
    if (entity.health <= 0 || entity.state === 'dying' || entity.state === 'corpse') {
      delete entity._footingKnockdownVisual;
      animalStates.delete(entity);
      return;
    }

    // Players choose when to recover from prone. Animals have no recovery
    // input, so the existing Footing sequence itself is their stand-up trigger:
    // remain down through the prone recovery delay/regen, then get up at full.
    if (entity.prone && animalFootingIsFull(entity)) entity.prone = false;

    if (entity.prone) {
      if (visual.phase !== 'fall' && visual.phase !== 'hold') {
        visual.phase = 'fall';
        visual.elapsed = ANIMAL_FALL_DURATION_S;
      }
      visual.elapsed = Math.min(ANIMAL_FALL_DURATION_S, visual.elapsed + Math.max(0, dt));
      const t = smooth(visual.elapsed / ANIMAL_FALL_DURATION_S);
      group.rotation.x = visual.startX * (1 - t);
      group.rotation.y = visual.startY + visual.yawOffset * t;
      group.rotation.z = visual.startZ + (visual.targetZ - visual.startZ) * t;
      const hopBase = Math.max(0.04, Number(entity.halfHeight) || 0.35);
      group.position.y += Math.sin(Math.PI * t) * hopBase * ANIMAL_HOP_HEIGHT_FACTOR;
      if (visual.elapsed >= ANIMAL_FALL_DURATION_S) visual.phase = 'hold';
      return;
    }

    if (visual.phase !== 'recover') {
      visual.phase = 'recover';
      visual.elapsed = 0;
      visual.recoverStartX = group.rotation.x;
      visual.recoverStartY = group.rotation.y;
      visual.recoverStartZ = group.rotation.z;
    }
    visual.elapsed = Math.min(ANIMAL_RECOVER_DURATION_S, visual.elapsed + Math.max(0, dt));
    const t = smooth(visual.elapsed / ANIMAL_RECOVER_DURATION_S);
    const normalYaw = Number.isFinite(Number(entity.groupRot)) ? Number(entity.groupRot) : visual.startY;
    group.rotation.x = visual.recoverStartX * (1 - t);
    group.rotation.y = visual.recoverStartY + normalizeAngle(normalYaw - visual.recoverStartY) * t;
    group.rotation.z = visual.recoverStartZ * (1 - t);
    if (visual.elapsed >= ANIMAL_RECOVER_DURATION_S) {
      group.rotation.x = 0;
      group.rotation.z = 0;
      delete entity._footingKnockdownVisual;
      animalStates.delete(entity);
    }
  }

  function updateAnimals(dt) {
    for (const entity of Array.from(animalStates)) updateAnimalKnockdown(entity, dt);
  }

  // CreatureDeath.updateCorpses already runs after ordinary creature mesh/AI
  // presentation each frame. Append non-lethal knockdowns there so the normal
  // billboard updater cannot overwrite our final prone rotation.
  function installCreatureDeathHook() {
    if (creatureDeathHookInstalled) return true;
    const death = window.CreatureDeath;
    if (!death?.updateCorpses) return false;
    const previousUpdateCorpses = death.updateCorpses.bind(death);
    death.updateCorpses = function updateCorpsesWithKnockdowns(dt) {
      const result = previousUpdateCorpses(dt);
      updateAnimals(dt);
      return result;
    };
    creatureDeathHookInstalled = true;
    return true;
  }

  function ensureCreatureDeathHook(attempt = 0) {
    if (installCreatureDeathHook()) return;
    if (attempt < 40) setTimeout(() => ensureCreatureDeathHook(attempt + 1), 0);
  }

  function beginPlayerFallback(entity, detail) {
    if (!entity?.prone || entity.health <= 0) return;
    const playback = window.ImpactRagdollPlayback;
    if (!playback?.trigger || playback.isActive?.()) return;
    const direction = cardinalFromFallVector(entity, detail?.fallX, detail?.fallY);
    playback.trigger('breakThrow', direction);
  }

  function onFootingBreak(event) {
    const detail = event?.detail;
    const entity = detail?.entity;
    if (!entity) return;
    breakCount++;
    entity._footingKnockdownDirection = cardinalFromFallVector(entity, detail.fallX, detail.fallY);

    // Wait one frame so the original strike handler can keep its already-authored
    // hit-relative direction. If it started playback, the fallback sees it active
    // and does nothing. Non-strike/new sources instead use the break vector here.
    requestAnimationFrame(() => {
      if (!entity.prone || entity.health <= 0) return;
      if (isLocalPlayer(entity)) beginPlayerFallback(entity, detail);
      else if (isAnimal(entity)) beginAnimalKnockdown(entity, detail);
    });
  }

  window.addEventListener('hobunji-footing-break', onFootingBreak);
  ensureCreatureDeathHook();

  window.HobunjiFootingKnockdown = Object.freeze({
    cardinalFromFallVector,
    beginAnimalKnockdown,
    updateAnimals,
    getDebug() {
      return {
        breakCount,
        activeAnimals: animalStates.size,
        creatureDeathHookInstalled,
      };
    },
  });
})();

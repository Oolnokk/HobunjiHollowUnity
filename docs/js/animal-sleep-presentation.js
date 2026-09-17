(() => {
  'use strict';
  if (window.AnimalSleepPresentation) return;

  const SLEEP_SCALE_Y = 0.75; // Authoritative visual Y multiplier for every visible sleeping animal.
  const LEGACY_SLEEP_SCALE_Y = 0.5; // Normalizes older barn/wilderness callers that still author their pre-render pose at 50%.
  const DEFAULT_SLEEP_HEAD_DOWN_DEG = 30; // Fallback downward pitch when an animal head rig does not publish its authored max angle.
  const STATIC_SLEEP_PREFIXES = ['barn_sleep_', 'nest_sleep_', 'incubator_sleep_']; // Names emitted by the three existing static sleeper builders.
  const STATIC_COMPOSE_MAX_AGE_MS = 2500; // Prevents an abandoned sleeper build from claiming an unrelated later compose of the same species.

  let farmDeps = null; // Captured from FarmAnimals.init for live outdoor livestock.
  let combatDeps = null; // Captured from Combat.init for live wilderness animals.
  const PRE_RENDER_SCHEDULER_ID = 'animal-sleep-presentation-pre-render'; // Used to prepare all sleep-only render state once after simulation and before the frame's first gameplay render pass.
  const RESTORE_SCHEDULER_ID = 'animal-sleep-presentation-restore'; // Used to restore authored/simulation transforms once after every gameplay render pass has completed.
  let schedulerRegistered = false; // Set by installSchedulerOwnership() and exposed in mobile diagnostics to catch a missing shared-frame hookup.
  let preparedFrames = 0; // Incremented by the pre-render scheduler callback so Pixel Probe/debug copies can verify once-per-frame cadence.
  let restoredFrames = 0; // Incremented by the post-game scheduler callback so stuck temporary transforms are visible in diagnostics.
  let lastPreparedFrameId = 0; // Records the scheduler frame most recently prepared for rendering.
  let lastRestoredFrameId = 0; // Records the scheduler frame most recently restored after rendering.
  let boundsScans = 0; // Cumulative Box3.setFromObject calls used only when a sleeper needs generic ground-preserving rescaling.
  let frameBoundsScans = 0; // Reset at each pre-render checkpoint so one-frame grounding cost is visible without profiling enabled.
  let lastPreparedBoundsScans = 0; // Number of hierarchy bounds scans performed by the most recent sleep preparation frame.
  let externalRenderDepth = 0; // Nesting guard for explicit secondary live-scene renders such as Farm layout and Pixel Probe.
  let externalRenderPrepared = false; // True only when the outermost explicit secondary render scope applied temporary sleep transforms itself.
  let externalRenderScopes = 0; // Mobile-visible count of deliberate out-of-band render scopes; ordinary gameplay never increments this.
  let lastExternalContext = null; // Label of the most recent explicit secondary render consumer for mobile diagnostics.
  let run2Redirects = 0; // Mobile-visible count of static sleeper composites redirected to run2.
  let closedEyeComposites = 0; // Mobile-visible count of unique permanent-closed-eye sleep composites requested.
  let headDownApplications = 0; // Mobile-visible count of visible sleepers whose head pose was forced downward.
  let bodyFacingLocks = 0; // Mobile-visible count of outdoor sleeper body-facing corrections applied before draw.
  let liveSleepFrames = 0; // Mobile-visible count of live outdoor/wilderness sleeper render adjustments.
  let lastContext = null; // Mobile-visible label for the most recently corrected sleeper.

  const staticSleepers = new Map(); // group -> { avatarRef, kind }; retains the head controller for barn/nest/incubator sleepers.
  const pendingStaticComposes = new Map(); // kind -> [{group, createdAt}], pairing a new static sleeper with its first genotype compose.
  const liveFrameStates = new WeakMap(); // Live entity -> original plane maps and sleep-only body-facing state so waking restores ordinary behavior.
  const frameCache = new Map(); // kind|frame|genotype -> permanently closed-eye texture pair for sleeping presentation.
  const temporaryTransforms = []; // Render-only scale/position changes restored by the post-game scheduler phase after all gameplay render passes.

  let boxBefore = null; // Lazily allocated Box3 used to preserve visible ground contact while rescaling.
  let boxAfter = null; // Paired Box3 for the post-scale bottom measurement.
  let parentScale = null; // Lazily allocated Vector3 used to convert world-bottom corrections into local Y.

  function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  }

  function isStaticSleepName(name) {
    const text = String(name || '');
    return STATIC_SLEEP_PREFIXES.some(prefix => text.startsWith(prefix));
  }

  function kindFromOptions(options, name) {
    const explicit = String(options?.creatureId || options?.animalId || '').trim();
    if (explicit) return explicit;
    const text = String(name || '');
    if (text.startsWith('barn_sleep_')) return text.slice('barn_sleep_'.length).split('_')[0] || null;
    return null;
  }

  function frameDescriptor(kind, def = null, sleeping = true) {
    const rendererSpec = window.CreatureGeneticsRender?.SPECIES?.[kind];
    const idle = rendererSpec?.base?.idle || def?.sprites?.idle || null;
    const run2 = rendererSpec?.base?.run2 || def?.sprites?.run?.[1] || null;
    if (sleeping && run2) return { frame: 'run2', url: run2, usesRun2: true };
    return { frame: 'idle', url: idle || run2, usesRun2: false };
  }

  function blinkOverlayFor(kind) {
    return window.CreatureGeneticsRender?.SPECIES?.[kind]?.eyeOverlay?.blink || null;
  }

  function sourceScaleForStatic(group) {
    const name = String(group?.name || '');
    if (name.startsWith('nest_sleep_') || name.startsWith('incubator_sleep_')) {
      const configured = Number(window.BARN_INCUBATOR_CONFIG?.visuals?.sleepScaleY);
      return Number.isFinite(configured) && configured > 0 ? configured : LEGACY_SLEEP_SCALE_Y;
    }
    return LEGACY_SLEEP_SCALE_Y;
  }

  function registerStaticSleeper(group, kind, avatarRef = null) {
    if (!group || !isStaticSleepName(group.name)) return group;
    group.userData ||= {};
    group.userData.animalSleepKind = kind || group.userData.animalSleepKind || null;
    group.userData.animalSleepSourceScaleY = sourceScaleForStatic(group);
    if (avatarRef) group.userData.animalSleepAvatarRef = avatarRef;
    staticSleepers.set(group, {
      avatarRef: avatarRef || group.userData.animalSleepAvatarRef || null,
      kind: kind || group.userData.animalSleepKind || null,
    });
    if (kind) {
      const queue = pendingStaticComposes.get(kind) || [];
      queue.push({ group, createdAt: nowMs() });
      pendingStaticComposes.set(kind, queue);
    }
    return group;
  }

  function takePendingStaticCompose(kind) {
    const queue = pendingStaticComposes.get(kind);
    if (!queue?.length) return null;
    const cutoff = nowMs() - STATIC_COMPOSE_MAX_AGE_MS;
    while (queue.length && (queue[0].createdAt < cutoff || !queue[0].group)) queue.shift();
    const entry = queue.shift() || null;
    if (!queue.length) pendingStaticComposes.delete(kind);
    return entry;
  }

  function patchPngAnimalBuilder() {
    const api = window.PNGPlaneAvatar;
    if (!api || api.__animalSleepPresentationBuilderPatched || typeof api.buildAnimalPlaneAvatarModel !== 'function') return false;
    const original = api.buildAnimalPlaneAvatarModel;
    api.buildAnimalPlaneAvatarModel = function sleepAwareAnimalAvatarBuilder(THREE_NS, spriteUrl, options = {}) {
      const avatarRef = original.apply(this, arguments);
      const group = avatarRef?.group;
      if (group && isStaticSleepName(group.name || options?.name)) {
        registerStaticSleeper(group, kindFromOptions(options, group.name || options?.name), avatarRef);
      }
      return avatarRef;
    };
    api.__animalSleepPresentationBuilderPatched = true;
    return true;
  }

  function patchGenotypeComposer() {
    const renderer = window.CreatureGeneticsRender;
    if (!renderer || renderer.__animalSleepPresentationComposerPatched || typeof renderer.composeFrame !== 'function') return false;
    const original = renderer.composeFrame;
    renderer.composeFrame = function sleepAwareComposeFrame(kind, frame, genotype, blinkShut = false) {
      if (frame === 'idle') {
        const pending = takePendingStaticCompose(kind);
        if (pending) {
          const descriptor = frameDescriptor(kind, window.CREATURE_DB?.[kind], true);
          pending.group.userData ||= {};
          pending.group.userData.animalSleepKind = kind;
          pending.group.userData.animalSleepGenotype = genotype || null;
          pending.group.userData.animalSleepFrame = descriptor.frame;
          pending.group.userData.animalSleepBlinkOverlay = blinkOverlayFor(kind);
          if (descriptor.usesRun2) run2Redirects++;
          // Sleeping eyes never participate in the normal blink cycle: the sleep
          // composite is always authored with the species' blink/closed-eye overlay.
          return original.call(this, kind, descriptor.frame, genotype, true);
        }
      }
      return original.apply(this, arguments);
    };
    renderer.__animalSleepPresentationComposerPatched = true;
    return true;
  }

  function patchFarmAnimals() {
    const api = window.FarmAnimals;
    if (!api || api.__animalSleepPresentationInitPatched || typeof api.init !== 'function') return false;
    const original = api.init;
    api.init = function sleepPresentationFarmInit(injectedDeps) {
      farmDeps = injectedDeps || farmDeps;
      return original.apply(this, arguments);
    };
    api.__animalSleepPresentationInitPatched = true;
    return true;
  }

  function patchCombat() {
    const api = window.Combat;
    if (!api || api.__animalSleepPresentationInitPatched || typeof api.init !== 'function') return false;
    combatDeps = api.deps || combatDeps;
    const original = api.init;
    api.init = function sleepPresentationCombatInit(injectedDeps) {
      combatDeps = injectedDeps || combatDeps;
      return original.apply(this, arguments);
    };
    api.__animalSleepPresentationInitPatched = true;
    return true;
  }

  function chainFutureGlobal(name, patch) {
    if (window[name]) { patch(); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) return;
    if (descriptor && typeof descriptor.set === 'function') {
      const priorGet = descriptor.get;
      const priorSet = descriptor.set;
      Object.defineProperty(window, name, {
        configurable: descriptor.configurable !== false,
        enumerable: descriptor.enumerable !== false,
        get() { return priorGet ? priorGet.call(window) : undefined; },
        set(value) {
          priorSet.call(window, value);
          patch();
        },
      });
      return;
    }
    let value = descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return value; },
      set(next) { value = next; patch(); },
    });
  }

  function setTextureColorSpace(texture) {
    const THREE_NS = window.THREE || globalThis.THREE;
    if (!texture || !THREE_NS) return texture;
    if ('colorSpace' in texture && THREE_NS.SRGBColorSpace) texture.colorSpace = THREE_NS.SRGBColorSpace;
    else if ('encoding' in texture && THREE_NS.sRGBEncoding !== undefined) texture.encoding = THREE_NS.sRGBEncoding;
    texture.needsUpdate = true;
    return texture;
  }

  function pairFromCanvas(canvas) {
    const THREE_NS = window.THREE || globalThis.THREE;
    if (!THREE_NS?.CanvasTexture || !canvas) return null;
    const front = setTextureColorSpace(new THREE_NS.CanvasTexture(canvas));
    const back = setTextureColorSpace(new THREE_NS.CanvasTexture(canvas));
    if (THREE_NS.RepeatWrapping !== undefined) back.wrapS = THREE_NS.RepeatWrapping;
    back.repeat?.set?.(-1, 1);
    back.offset?.set?.(1, 0);
    return { front, back };
  }

  function frameCacheKey(kind, frame, genotype) {
    let signature = '';
    try {
      signature = window.CreatureGeneticsRender?.genotypeSignature?.(kind, genotype) || JSON.stringify(genotype || null);
    } catch (_) { signature = String(genotype?.id || 'plain'); }
    return `${kind}|${frame}|${signature}|sleep-eyes-closed`;
  }

  function sleepTextureEntry(kind, genotype, def = null) {
    const descriptor = frameDescriptor(kind, def, true);
    const renderer = window.CreatureGeneticsRender;
    if (!renderer?.composeFrame) return null;
    const key = frameCacheKey(kind, descriptor.frame, genotype);
    let entry = frameCache.get(key);
    if (entry) return entry;
    entry = { key, descriptor, blinkOverlay: blinkOverlayFor(kind), pair: null, promise: null };
    closedEyeComposites++;
    entry.promise = (async () => {
      let canvas = null;
      try {
        // `true` is deliberate and permanent for this cached sleep texture.
        // It selects the species' *_blink.png eye overlay and prevents an
        // ordinary awake-eye composite from ever entering the sleep cache.
        canvas = await renderer.composeFrame(kind, descriptor.frame, genotype || null, true);
      } catch (_) {}
      const pair = canvas ? pairFromCanvas(canvas) : null;
      entry.pair = pair;
      return pair;
    })();
    frameCache.set(key, entry);
    return entry;
  }

  function animalPlaneMaterials(group) {
    const out = [];
    group?.traverse?.(child => {
      if (!child?.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        if (child.name?.endsWith('_front_plane')) out.push({ material, side: 'front' });
        else if (child.name?.endsWith('_back_plane')) out.push({ material, side: 'back' });
      }
    });
    return out;
  }

  function captureOriginalMaps(entity, group) {
    let state = liveFrameStates.get(entity);
    if (state?.group === group) return state;
    const planeMaterials = animalPlaneMaterials(group); // Captured only on sleep entry/group replacement, not for every awake animal in the scene.
    state = {
      group,
      sleeping: false,
      planeMaterials,
      originals: planeMaterials.map(entry => ({ material: entry.material, map: entry.material.map })),
      entry: null,
      sleepBodyYaw: null,
    };
    liveFrameStates.set(entity, state);
    return state;
  }

  function applyPair(group, pair, cachedMaterials = null) {
    if (!pair || !group) return false;
    let applied = 0;
    const materials = cachedMaterials || animalPlaneMaterials(group); // Static sleepers may not have a live entity state; live sleepers reuse their cached plane list.
    for (const entry of materials) {
      const map = entry.side === 'back' ? pair.back : pair.front;
      if (!map || entry.material.map === map) continue;
      entry.material.map = map;
      entry.material.needsUpdate = true;
      applied++;
    }
    return applied > 0;
  }

  function setLiveFrame(entity, group, kind, genotype, def, sleeping) {
    if (!entity || !group || !kind) return;
    let state = liveFrameStates.get(entity);
    if (!sleeping) {
      if (!state?.sleeping) return; // Awake animals that have never slept incur no avatar traversal or texture snapshot at all.
      if (state.group !== group) {
        liveFrameStates.delete(entity); // A replaced awake avatar already owns its correct maps; stale detached-group state is irrelevant.
        return;
      }
      for (let index = 0; index < state.originals.length; index++) {
        const original = state.originals[index];
        if (!original.material) continue;
        const plane = state.planeMaterials[index];
        const sleepMap = state.entry?.pair && plane ? (plane.side === 'back' ? state.entry.pair.back : state.entry.pair.front) : null;
        // Normal farm/wilderness animation runs before this checkpoint. If it
        // already replaced the sleep texture with a fresh awake/blink frame,
        // leave that authoritative map alone instead of resurrecting the
        // snapshot captured when sleep began.
        if (!sleepMap || original.material.map !== sleepMap) continue; // Restore only a sleep texture this presenter actually owns; never clobber a fresh awake map or an unresolved sleep composite.
        original.material.map = original.map;
        original.material.needsUpdate = true;
      }
      state.sleeping = false;
      state.entry = null;
      state.sleepBodyYaw = null;
      return;
    }
    state = captureOriginalMaps(entity, group);
    if (!state.sleeping) state.sleepBodyYaw = null; // A fresh sleep period captures a fresh last-travel heading below.
    state.sleeping = true;
    const entry = sleepTextureEntry(kind, genotype, def);
    if (!entry) return;
    state.entry = entry;
    if (entry.pair) applyPair(group, entry.pair, state.planeMaterials); // Reasserted once each pre-render frame after normal blink/animation updates.
  }

  function forceHeadDown(avatarRef, entity = null) {
    if (!avatarRef) return false;
    const authoredMax = Number(avatarRef.headRig?.rig?.maxDeg);
    const targetDeg = Number.isFinite(authoredMax) ? authoredMax : DEFAULT_SLEEP_HEAD_DOWN_DEG;
    let applied = false;
    if (typeof avatarRef.setHeadRotation === 'function') {
      avatarRef.setHeadRotation(targetDeg);
      applied = true;
    } else if (typeof avatarRef.updateHeadRotation === 'function') {
      avatarRef.updateHeadRotation(targetDeg, 999); // Large delta snaps older rigs to the same authored downward limit.
      applied = true;
    }
    if (typeof avatarRef.updateHeadYaw === 'function') {
      avatarRef.updateHeadYaw(0, 999); // Sleeping heads face neutrally forward rather than tracking a nearby player sideways.
    }
    if (entity) entity._lookAtDebug = null; // Prevents debug/interaction rays from implying a sleeping animal is still looking at the player.
    avatarRef.group?.updateMatrixWorld?.(true);
    if (applied) headDownApplications++;
    return applied;
  }

  function lockFarmSleepBody(animal, group) {
    if (!animal || !group?.rotation) return false;
    const state = liveFrameStates.get(animal) || captureOriginalMaps(animal, group);
    if (!state.sleeping) return false;
    if (!Number.isFinite(state.sleepBodyYaw)) {
      const travelYaw = Number(animal.targetRot); // Last authored movement heading stays independent of player-look body facing.
      const logicalYaw = Number(animal.groupRot); // Fallback for older farm entities without targetRot.
      const renderedYaw = Number(group.rotation.y); // Final fallback keeps the existing body pose stable.
      state.sleepBodyYaw = Number.isFinite(travelYaw)
        ? travelYaw
        : (Number.isFinite(logicalYaw) ? logicalYaw : (Number.isFinite(renderedYaw) ? renderedYaw : 0));
    }
    animal.groupRot = state.sleepBodyYaw; // Prevents the next awake-style update from accumulating player-facing drift while sleep continues.
    group.rotation.y = state.sleepBodyYaw;
    group.updateMatrixWorld?.(true);
    bodyFacingLocks++;
    return true;
  }

  function ensureStaticPresentation(group, record) {
    if (!group?.parent || group.visible === false) return;
    const kind = record?.kind || group.userData?.animalSleepKind;
    if (kind) {
      const entry = sleepTextureEntry(kind, group.userData?.animalSleepGenotype, window.CREATURE_DB?.[kind]);
      record.planeMaterials ||= animalPlaneMaterials(group); // Static sleeper hierarchy is stable; cache its two plane materials after first use.
      if (entry?.pair) applyPair(group, entry.pair, record.planeMaterials);
      group.userData.animalSleepBlinkOverlay = entry?.blinkOverlay || blinkOverlayFor(kind);
    }
    forceHeadDown(record?.avatarRef || group.userData?.animalSleepAvatarRef || null);
  }

  function worldBottom(group, box) {
    if (!group || !box?.setFromObject) return NaN;
    try {
      group.updateMatrixWorld?.(true);
      box.setFromObject(group);
      boundsScans++;
      frameBoundsScans++;
      return Number(box.min?.y);
    } catch (_) { return NaN; }
  }

  function applyTemporaryScale(group, ratio, contextLabel) {
    const numericRatio = Number(ratio);
    if (!group?.scale || !group?.position || !Number.isFinite(numericRatio) || numericRatio <= 0 || Math.abs(numericRatio - 1) < 1e-5) return false;
    const THREE_NS = window.THREE || globalThis.THREE;
    boxBefore ||= THREE_NS?.Box3 ? new THREE_NS.Box3() : null;
    boxAfter ||= THREE_NS?.Box3 ? new THREE_NS.Box3() : null;
    parentScale ||= THREE_NS?.Vector3 ? new THREE_NS.Vector3(1, 1, 1) : null;

    const originalScaleY = Number(group.scale.y) || 1;
    const originalPositionY = Number(group.position.y) || 0;
    const bottomBefore = worldBottom(group, boxBefore);
    group.scale.y = originalScaleY * numericRatio;
    const bottomAfter = worldBottom(group, boxAfter);
    if (Number.isFinite(bottomBefore) && Number.isFinite(bottomAfter)) {
      let parentScaleY = 1;
      try {
        if (group.parent?.getWorldScale && parentScale) {
          group.parent.getWorldScale(parentScale);
          parentScaleY = Number(parentScale.y) || 1;
        }
      } catch (_) {}
      group.position.y += (bottomBefore - bottomAfter) / parentScaleY;
      group.updateMatrixWorld?.(true);
    }
    temporaryTransforms.push({ group, scaleY: originalScaleY, positionY: originalPositionY });
    lastContext = contextLabel || group.name || 'sleeping animal';
    return true;
  }

  function restoreTemporaryTransforms() {
    for (let index = temporaryTransforms.length - 1; index >= 0; index--) {
      const entry = temporaryTransforms[index];
      if (!entry.group?.scale || !entry.group?.position) continue;
      entry.group.scale.y = entry.scaleY;
      entry.group.position.y = entry.positionY;
      entry.group.updateMatrixWorld?.(true);
    }
    temporaryTransforms.length = 0;
  }

  function applyStaticSleepers() {
    for (const [group, record] of staticSleepers) {
      if (!group?.parent) { staticSleepers.delete(group); continue; }
      ensureStaticPresentation(group, record);
      const sourceScale = Number(group.userData?.animalSleepSourceScaleY) || LEGACY_SLEEP_SCALE_Y;
      applyTemporaryScale(group, SLEEP_SCALE_Y / sourceScale, group.name);
    }
  }

  function applyFarmSleepers() {
    const animals = farmDeps?.animalObjects;
    if (!animals || typeof animals[Symbol.iterator] !== 'function') return;
    const awakeMin = Number(window.OutdoorLivestockWelfare?.constants?.OUTDOOR_AWAKE_MIN_SCALE_Y) || 0.8;
    for (const animal of animals) {
      const avatarRef = animal?.avatarRef;
      const group = avatarRef?.group;
      if (!group?.parent || group.visible === false) continue;
      const blend = Math.max(0, Math.min(1, Number(animal._outdoorSleepBlend) || 0));
      const sleeping = blend > 0.001;
      const kind = animal.animalKey || animal.creatureKey || null;
      setLiveFrame(animal, group, kind, animal.genotype, farmDeps?.CREATURE_DB?.[kind], sleeping);
      if (!sleeping) continue;

      forceHeadDown(avatarRef, animal); // Runs immediately before draw, so daytime/player look-at updates cannot remain visible at night.
      lockFarmSleepBody(animal, group); // Holds the last travel heading so a sleeping body cannot continue turning toward a nearby player.
      const stress = Math.max(0, Math.min(1, Number(animal._outdoorVisualStress) || 0));
      const awakeScale = 1 - (1 - awakeMin) * stress;
      const desiredSleepScale = 1 - (1 - SLEEP_SCALE_Y) * blend;
      const desiredFinal = awakeScale * desiredSleepScale; // Sleep multiplier first conceptually; neglect remains an independent awake multiplier.
      const currentFinal = Number(animal._outdoorAppliedScaleY) || 1;
      if (applyTemporaryScale(group, desiredFinal / currentFinal, `farm:${animal.livestockId || kind || 'animal'}`)) liveSleepFrames++;
    }
  }

  function wildernessSets() {
    return [combatDeps?.hostileObjects, combatDeps?.companionObjects].filter(Boolean);
  }

  function applyWildernessSleepers() {
    for (const setLike of wildernessSets()) {
      if (typeof setLike?.[Symbol.iterator] !== 'function') continue;
      for (const creature of setLike) {
        const avatarRef = creature?.avatarRef;
        const group = avatarRef?.group;
        if (!group?.parent || group.visible === false) continue;
        const sleeping = creature?._cfDrenkirra?.mode === 'sleeping' || creature?._animalSleeping === true;
        const kind = creature.creatureKey || creature.animalKey || null;
        setLiveFrame(creature, group, kind, creature.genotype, creature.def, sleeping);
        if (!sleeping) continue;
        forceHeadDown(avatarRef, creature);
        const authoredScale = Number(creature.scaleY) || 1;
        if (applyTemporaryScale(group, SLEEP_SCALE_Y / authoredScale, `wild:${creature.id || kind || 'animal'}`)) liveSleepFrames++;
      }
    }
  }

  function prepareRenderFrame(frameContext = {}) {
    // post-game always restores after the frame driver, even when gameLoop throws.
    // This recovery guard only handles a broken/externally-invoked frame sequence.
    if (temporaryTransforms.length) restoreTemporaryTransforms();
    const frameId = Number(frameContext.frameId) || 0;
    preparedFrames++;
    lastPreparedFrameId = frameId; // Set before feature work so post-game can recover partially-applied transforms if a later preparation step throws.
    frameBoundsScans = 0;
    try {
      applyStaticSleepers();
      applyFarmSleepers();
      applyWildernessSleepers();
    } finally {
      lastPreparedBoundsScans = frameBoundsScans;
    }
  }

  function restoreRenderFrame(frameContext = {}) {
    const frameId = Number(frameContext.frameId) || 0;
    if (!frameId || frameId !== lastPreparedFrameId || lastRestoredFrameId === frameId) return; // Title/onboarding frames can reach post-game without ever reaching the pre-render checkpoint.
    restoreTemporaryTransforms();
    restoredFrames++;
    lastRestoredFrameId = frameId;
  }

  function beginExternalRenderScope(contextLabel = 'external-render') {
    externalRenderDepth++;
    if (externalRenderDepth > 1) return true;
    externalRenderPrepared = false;
    // If a caller somehow runs synchronously inside an already-prepared gameplay
    // render sequence, reuse that state and let the scheduler remain its owner.
    if (temporaryTransforms.length) return true;
    try {
      applyStaticSleepers();
      applyFarmSleepers();
      applyWildernessSleepers();
      externalRenderPrepared = true;
      externalRenderScopes++;
      lastExternalContext = String(contextLabel || 'external-render');
      return true;
    } catch (error) {
      restoreTemporaryTransforms(); // Never strand a partially-applied scale/position if an on-demand diagnostic render preparation fails.
      externalRenderDepth = 0;
      externalRenderPrepared = false;
      throw error;
    }
  }

  function endExternalRenderScope() {
    if (externalRenderDepth <= 0) return false;
    externalRenderDepth--;
    if (externalRenderDepth > 0) return true;
    if (externalRenderPrepared) restoreTemporaryTransforms();
    externalRenderPrepared = false;
    return true;
  }

  function installSchedulerOwnership() {
    const scheduler = window.RuntimeFrameScheduler;
    if (!scheduler?.register) return false;
    scheduler.register(PRE_RENDER_SCHEDULER_ID, prepareRenderFrame, {
      phase: 'pre-render',
      owner: 'AnimalSleepPresentation',
      description: 'Prepare sleeping-animal textures, poses, and temporary grounding transforms once before gameplay rendering.',
    });
    scheduler.register(RESTORE_SCHEDULER_ID, restoreRenderFrame, {
      phase: 'post-game',
      owner: 'AnimalSleepPresentation',
      description: 'Restore temporary sleeping-animal transforms once after all gameplay render passes complete.',
    });
    schedulerRegistered = true;
    return true;
  }

  function install() {
    patchPngAnimalBuilder();
    patchGenotypeComposer();
    patchFarmAnimals();
    patchCombat();
    installSchedulerOwnership();
    return true;
  }

  function debugSnapshot() {
    return {
      mostRecentChange: 'Animal sleep presentation now prepares once at the shared pre-render scheduler checkpoint and restores once post-game instead of rescanning animals around every WebGL render pass.',
      sleepScaleY: SLEEP_SCALE_Y,
      preferredFrame: 'run2-if-present-else-idle',
      sleepingEyes: 'blink-overlay-closed-only',
      sleepingHead: 'authored-max-down',
      sleepingBody: 'last-travel-heading-locked',
      staticSleepers: [...staticSleepers.keys()].filter(group => !!group?.parent).length,
      cachedSleepFrames: frameCache.size,
      pendingStaticComposes: [...pendingStaticComposes.values()].reduce((sum, queue) => sum + queue.length, 0),
      run2Redirects,
      closedEyeComposites,
      headDownApplications,
      bodyFacingLocks,
      liveSleepFrames,
      lastContext,
      schedulerRegistered,
      schedulerCadence: 'pre-render-once/post-game-restore',
      preparedFrames,
      restoredFrames,
      lastPreparedFrameId,
      lastRestoredFrameId,
      boundsScans,
      lastPreparedBoundsScans,
      externalRenderScopes,
      externalRenderDepth,
      lastExternalContext,
      activeTemporaryTransforms: temporaryTransforms.length,
      farmDepsReady: !!farmDeps,
      combatDepsReady: !!combatDeps,
    };
  }

  window.AnimalSleepPresentation = Object.freeze({
    SLEEP_SCALE_Y,
    frameDescriptor,
    blinkOverlayFor,
    forceHeadDown,
    registerStaticSleeper,
    beginExternalRenderScope,
    endExternalRenderScope,
    install,
    getDebug: debugSnapshot,
  });
  window.__animalSleepPresentationDebug = debugSnapshot;

  chainFutureGlobal('PNGPlaneAvatar', patchPngAnimalBuilder);
  chainFutureGlobal('CreatureGeneticsRender', patchGenotypeComposer);
  chainFutureGlobal('FarmAnimals', patchFarmAnimals);
  chainFutureGlobal('Combat', patchCombat);
  chainFutureGlobal('RuntimeFrameScheduler', installSchedulerOwnership);
  install();
})();

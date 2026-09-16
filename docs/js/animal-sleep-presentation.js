(() => {
  'use strict';
  if (window.AnimalSleepPresentation) return;

  const SLEEP_SCALE_Y = 0.75; // Authoritative visual Y multiplier for every visible sleeping animal.
  const LEGACY_SLEEP_SCALE_Y = 0.5; // Normalizes older barn/wilderness callers that still author their pre-render pose at 50%.
  const STATIC_SLEEP_PREFIXES = ['barn_sleep_', 'nest_sleep_', 'incubator_sleep_']; // Names emitted by the three existing static sleeper builders.
  const STATIC_COMPOSE_MAX_AGE_MS = 2500; // Keeps a stale sleeper build from stealing an unrelated later idle compose of the same species.

  let farmDeps = null; // Captured from FarmAnimals.init so outdoor livestock can share this presentation without another per-frame save lookup.
  let combatDeps = null; // Captured from Combat.init so visible wilderness sleepers can use the same scale/frame policy.
  let renderDepth = 0; // Prevents nested renderer wrappers from applying the temporary sleep transform twice.
  let run2Redirects = 0; // Mobile-visible count of static sleeping composites redirected from idle to run2.
  let liveSleepFrames = 0; // Mobile-visible count of live outdoor/wilderness sleepers presented through this central path.
  let lastContext = null; // Mobile-visible label for the most recently corrected sleeping animal.

  const staticSleepers = new Set(); // Sleeping barn/nest/incubator avatar groups registered once by the shared PNG avatar builder wrapper.
  const pendingStaticComposes = new Map(); // kind -> [{group, createdAt}], pairing each static sleeper build with its immediately-following genotype compose.
  const liveFrameStates = new WeakMap(); // Live entity -> original material maps/current sleep-frame state so waking restores its prior art.
  const frameCache = new Map(); // kind|frame|genotype signature -> cached texture-pair promise; bounded by sleeping animals/genotypes encountered this session.
  const temporaryTransforms = []; // Reused render stack of group scale/position values restored immediately after WebGL draw.

  let boxBefore = null; // Lazily allocated Box3 used only while preserving a sleeper's visible ground contact during render-time rescaling.
  let boxAfter = null; // Paired Box3 for the post-scale bottom measurement.
  let parentScale = null; // Lazily allocated Vector3 used to convert world-bottom correction into the group's local Y space.

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

  function sourceScaleForStatic(group) {
    const name = String(group?.name || '');
    if (name.startsWith('nest_sleep_') || name.startsWith('incubator_sleep_')) {
      const configured = Number(window.BARN_INCUBATOR_CONFIG?.visuals?.sleepScaleY);
      return Number.isFinite(configured) && configured > 0 ? configured : LEGACY_SLEEP_SCALE_Y;
    }
    return LEGACY_SLEEP_SCALE_Y;
  }

  function registerStaticSleeper(group, kind) {
    if (!group || !isStaticSleepName(group.name)) return group;
    group.userData ||= {};
    group.userData.animalSleepKind = kind || group.userData.animalSleepKind || null;
    group.userData.animalSleepSourceScaleY = sourceScaleForStatic(group);
    staticSleepers.add(group);
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
        registerStaticSleeper(group, kindFromOptions(options, group.name || options?.name));
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
          if (descriptor.usesRun2) run2Redirects++;
          return original.call(this, kind, descriptor.frame, genotype, blinkShut);
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

  function rawTexturePair(url) {
    const THREE_NS = window.THREE || globalThis.THREE;
    if (!THREE_NS?.TextureLoader || !url) return Promise.resolve(null);
    return new Promise(resolve => {
      const loader = new THREE_NS.TextureLoader();
      loader.load(url, texture => {
        const front = setTextureColorSpace(texture);
        const back = setTextureColorSpace(typeof texture.clone === 'function' ? texture.clone() : texture);
        if (THREE_NS.RepeatWrapping !== undefined) back.wrapS = THREE_NS.RepeatWrapping;
        back.repeat?.set?.(-1, 1);
        back.offset?.set?.(1, 0);
        resolve({ front, back });
      }, undefined, () => resolve(null));
    });
  }

  function frameCacheKey(kind, frame, genotype) {
    let signature = '';
    try {
      signature = window.CreatureGeneticsRender?.genotypeSignature?.(kind, genotype) || JSON.stringify(genotype || null);
    } catch (_) { signature = String(genotype?.id || 'plain'); }
    return `${kind}|${frame}|${signature}`;
  }

  function sleepTextureEntry(kind, genotype, def = null) {
    const descriptor = frameDescriptor(kind, def, true);
    if (!descriptor.url && !window.CreatureGeneticsRender?.SPECIES?.[kind]) return null;
    const key = frameCacheKey(kind, descriptor.frame, genotype);
    let entry = frameCache.get(key);
    if (entry) return entry;
    entry = { key, descriptor, pair: null, promise: null };
    entry.promise = (async () => {
      let canvas = null;
      try {
        canvas = await window.CreatureGeneticsRender?.composeFrame?.(kind, descriptor.frame, genotype || null, false);
      } catch (_) {}
      const pair = canvas ? pairFromCanvas(canvas) : await rawTexturePair(descriptor.url);
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
    if (state) return state;
    state = {
      sleeping: false,
      originals: animalPlaneMaterials(group).map(entry => ({ material: entry.material, map: entry.material.map })),
      entry: null,
    };
    liveFrameStates.set(entity, state);
    return state;
  }

  function applyPair(group, pair) {
    if (!pair || !group) return false;
    let applied = 0;
    for (const entry of animalPlaneMaterials(group)) {
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
    const state = captureOriginalMaps(entity, group);
    if (!sleeping) {
      if (!state.sleeping) return;
      for (const original of state.originals) {
        if (!original.material) continue;
        original.material.map = original.map;
        original.material.needsUpdate = true;
      }
      state.sleeping = false;
      state.entry = null;
      return;
    }
    state.sleeping = true;
    const entry = sleepTextureEntry(kind, genotype, def);
    if (!entry) return;
    state.entry = entry;
    if (entry.pair) applyPair(group, entry.pair);
    else if (!entry._liveApplyHooked) {
      entry._liveApplyHooked = true;
      entry.promise?.then(() => {});
    }
  }

  function ensureStaticFrame(group) {
    if (!group?.parent || group.visible === false) return;
    const kind = group.userData?.animalSleepKind;
    if (!kind) return;
    const entry = sleepTextureEntry(kind, group.userData?.animalSleepGenotype, window.CREATURE_DB?.[kind]);
    if (entry?.pair) applyPair(group, entry.pair);
  }

  function worldBottom(group, box) {
    if (!group || !box?.setFromObject) return NaN;
    try {
      group.updateMatrixWorld?.(true);
      box.setFromObject(group);
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
    for (const group of [...staticSleepers]) {
      if (!group?.parent) { staticSleepers.delete(group); continue; }
      ensureStaticFrame(group);
      const sourceScale = Number(group.userData?.animalSleepSourceScaleY) || LEGACY_SLEEP_SCALE_Y;
      applyTemporaryScale(group, SLEEP_SCALE_Y / sourceScale, group.name);
    }
  }

  function applyFarmSleepers() {
    const animals = farmDeps?.animalObjects;
    if (!animals || typeof animals[Symbol.iterator] !== 'function') return;
    const awakeMin = Number(window.OutdoorLivestockWelfare?.constants?.OUTDOOR_AWAKE_MIN_SCALE_Y) || 0.8;
    for (const animal of animals) {
      const group = animal?.avatarRef?.group;
      if (!group?.parent || group.visible === false) continue;
      const blend = Math.max(0, Math.min(1, Number(animal._outdoorSleepBlend) || 0));
      const sleeping = blend > 0.001;
      const kind = animal.animalKey || animal.creatureKey || null;
      setLiveFrame(animal, group, kind, animal.genotype, farmDeps?.CREATURE_DB?.[kind], sleeping);
      if (!sleeping) continue;
      const stress = Math.max(0, Math.min(1, Number(animal._outdoorVisualStress) || 0));
      const awakeScale = 1 - (1 - awakeMin) * stress;
      const desiredSleepScale = 1 - (1 - SLEEP_SCALE_Y) * blend;
      const desiredFinal = awakeScale * desiredSleepScale; // Sleep multiplier is composed first conceptually; neglect remains an independent awake-scale multiplier.
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
        const group = creature?.avatarRef?.group;
        if (!group?.parent || group.visible === false) continue;
        const sleeping = creature?._cfDrenkirra?.mode === 'sleeping' || creature?._animalSleeping === true;
        const kind = creature.creatureKey || creature.animalKey || null;
        setLiveFrame(creature, group, kind, creature.genotype, creature.def, sleeping);
        if (!sleeping) continue;
        const authoredScale = Number(creature.scaleY) || 1;
        if (applyTemporaryScale(group, SLEEP_SCALE_Y / authoredScale, `wild:${creature.id || kind || 'animal'}`)) liveSleepFrames++;
      }
    }
  }

  function beforeRender() {
    temporaryTransforms.length = 0;
    applyStaticSleepers();
    applyFarmSleepers();
    applyWildernessSleepers();
  }

  function patchRendererPrototype() {
    const prototype = (window.THREE || globalThis.THREE)?.WebGLRenderer?.prototype;
    if (!prototype || prototype.__animalSleepPresentationRenderPatched || typeof prototype.render !== 'function') return false;
    const original = prototype.render;
    prototype.render = function animalSleepPresentationRender(...args) {
      const outermost = renderDepth++ === 0;
      if (outermost) beforeRender();
      try {
        return original.apply(this, args);
      } finally {
        renderDepth--;
        if (outermost) restoreTemporaryTransforms();
      }
    };
    prototype.__animalSleepPresentationRenderPatched = true;
    return true;
  }

  function install() {
    patchPngAnimalBuilder();
    patchGenotypeComposer();
    patchFarmAnimals();
    patchCombat();
    patchRendererPrototype();
    return true;
  }

  function debugSnapshot() {
    return {
      mostRecentChange: 'All visible animal sleep poses now share 75% Y scaling and prefer a frozen run2 frame when that species has one.',
      sleepScaleY: SLEEP_SCALE_Y,
      preferredFrame: 'run2-if-present-else-idle',
      staticSleepers: [...staticSleepers].filter(group => !!group?.parent).length,
      cachedSleepFrames: frameCache.size,
      pendingStaticComposes: [...pendingStaticComposes.values()].reduce((sum, queue) => sum + queue.length, 0),
      run2Redirects,
      liveSleepFrames,
      lastContext,
      farmDepsReady: !!farmDeps,
      combatDepsReady: !!combatDeps,
    };
  }

  window.AnimalSleepPresentation = Object.freeze({
    SLEEP_SCALE_Y,
    frameDescriptor,
    registerStaticSleeper,
    install,
    getDebug: debugSnapshot,
  });
  window.__animalSleepPresentationDebug = debugSnapshot;

  chainFutureGlobal('PNGPlaneAvatar', patchPngAnimalBuilder);
  chainFutureGlobal('CreatureGeneticsRender', patchGenotypeComposer);
  chainFutureGlobal('FarmAnimals', patchFarmAnimals);
  chainFutureGlobal('Combat', patchCombat);
  install();
})();

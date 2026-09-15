// Prevents an NPC who is actively performing an instrument from abandoning that
// performance for social movement/facing reactions (dance joins, watch movement,
// reactive facing, etc.). The suppression is derived from the same
// NpcScheduling.listInstrumentPerformers() source used by ambient Kurraya audio,
// so it applies to every current/future NPC performer without character-specific rules.
(function (global) {
  'use strict';

  if (global.NpcPerformanceReactionLock?.installed) return;

  const state = {
    plannerDeps: null,
    maskedResolves: 0,
    renderSuppressions: 0,
    facingSuppressions: 0,
    lastNpcId: null,
    lastAt: 0,
    renderHookInstalled: false,
    patchedWalkers: new WeakSet(),
    loggedNpcIds: new Set(),
  };

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function performerFor(npcId, area = null) {
    const id = String(npcId || '');
    if (!id) return null;
    const performers = global.NpcScheduling?.listInstrumentPerformers?.() || [];
    return performers.find(performer => {
      if (String(performer?.npcId || '') !== id) return false;
      if (!area || !performer?.area) return true;
      return performer.area === area;
    }) || null;
  }

  function isNpcPerformanceLocked(npcId, area = null) {
    return !!performerFor(npcId, area);
  }

  function noteSuppression(npcId) {
    const id = String(npcId || 'unknown');
    state.lastNpcId = id;
    state.lastAt = nowMs();
    if (state.loggedNpcIds.has(id)) return;
    state.loggedNpcIds.add(id);
    global.__farmLog?.(`[performance-reaction-lock] ${id}: physical reactions suppressed while performing an instrument`, 'social');
  }

  function withSocialStimuliMasked(callback) {
    const stimuli = global.NpcSocialStimuli;
    if (!stimuli) return callback();
    const originalGetActive = stimuli.getActive;
    const originalStrongestNear = stimuli.strongestNear;
    let maskedGetActive = false;
    let maskedStrongestNear = false;
    try {
      if (typeof originalGetActive === 'function') {
        stimuli.getActive = () => [];
        maskedGetActive = true;
      }
      if (typeof originalStrongestNear === 'function') {
        stimuli.strongestNear = () => null;
        maskedStrongestNear = true;
      }
      return callback();
    } finally {
      if (maskedGetActive) stimuli.getActive = originalGetActive;
      if (maskedStrongestNear) stimuli.strongestNear = originalStrongestNear;
    }
  }

  function patchWalkerFacing(walker) {
    if (!walker || state.patchedWalkers.has(walker) || typeof walker.applyFacingDeadzone !== 'function') return;
    const original = walker.applyFacingDeadzone;
    walker.applyFacingDeadzone = function performanceReactionLockedFacing(...args) {
      if (isNpcPerformanceLocked(walker.rec?.id, walker.area)) {
        state.facingSuppressions++;
        noteSuppression(walker.rec?.id);
        return Number.isFinite(walker.rot) ? walker.rot : undefined;
      }
      return original.apply(this, args);
    };
    state.patchedWalkers.add(walker);
  }

  function patchPlanner(api) {
    if (!api || api.__npcPerformanceReactionLockWrapped) return;
    if (typeof api.init === 'function' && !api.init.__npcPerformanceReactionLockWrapped) {
      const originalInit = api.init.bind(api);
      api.init = function performanceReactionLockPlannerInit(injectedDeps) {
        state.plannerDeps = injectedDeps || state.plannerDeps;
        return originalInit(injectedDeps);
      };
      api.init.__npcPerformanceReactionLockWrapped = true;
    }
    if (typeof api.resolveNpcTarget === 'function' && !api.resolveNpcTarget.__npcPerformanceReactionLockWrapped) {
      const originalResolve = api.resolveNpcTarget.bind(api);
      api.resolveNpcTarget = function performanceReactionLockedNpcTarget(rec, extra = {}) {
        const walker = state.plannerDeps?.findNpcWalker?.(rec?.id) || null;
        if (walker) patchWalkerFacing(walker);
        const area = walker?.area || null;
        if (!isNpcPerformanceLocked(rec?.id, area)) return originalResolve(rec, extra);
        state.maskedResolves++;
        noteSuppression(rec?.id);
        return withSocialStimuliMasked(() => originalResolve(rec, extra));
      };
      api.resolveNpcTarget.__npcPerformanceReactionLockWrapped = true;
    }
    api.__npcPerformanceReactionLockWrapped = true;
  }

  function chainGlobal(name, patcher) {
    const current = global[name];
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current;
    const oldGet = descriptor?.get, oldSet = descriptor?.set;
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(global) : stored; },
        set(value) {
          if (oldSet) oldSet.call(global, value); else stored = value;
          const resolved = oldGet ? oldGet.call(global) : stored;
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  function currentWalkers() {
    if (!state.plannerDeps?.listNpcWalkersInArea) return [];
    const area = state.plannerDeps.getCurrentArea?.();
    return state.plannerDeps.listNpcWalkersInArea(area) || [];
  }

  function installRenderHook() {
    const proto = global.THREE?.WebGLRenderer?.prototype;
    if (state.renderHookInstalled || !proto || typeof proto.render !== 'function') return;
    const original = proto.render;
    if (original.__npcPerformanceReactionLockRenderHook) {
      state.renderHookInstalled = true;
      return;
    }
    function performanceReactionLockRender(scene, camera) {
      const hiddenTargets = [];
      for (const walker of currentWalkers()) {
        patchWalkerFacing(walker);
        if (!isNpcPerformanceLocked(walker?.rec?.id, walker?.area)) continue;
        const target = walker?.currentScheduleTarget;
        if (!target || (!target.socialLookAt && !target.socialDance)) continue;
        hiddenTargets.push({
          target,
          hadSocialLookAt: Object.prototype.hasOwnProperty.call(target, 'socialLookAt'),
          socialLookAt: target.socialLookAt,
          hadSocialDance: Object.prototype.hasOwnProperty.call(target, 'socialDance'),
          socialDance: target.socialDance,
        });
        delete target.socialLookAt;
        delete target.socialDance;
        state.renderSuppressions++;
        noteSuppression(walker.rec?.id);
      }
      try {
        return original.call(this, scene, camera);
      } finally {
        for (const snapshot of hiddenTargets) {
          if (snapshot.hadSocialLookAt) snapshot.target.socialLookAt = snapshot.socialLookAt;
          if (snapshot.hadSocialDance) snapshot.target.socialDance = snapshot.socialDance;
        }
      }
    }
    performanceReactionLockRender.__npcPerformanceReactionLockRenderHook = true;
    performanceReactionLockRender.__npcPerformanceReactionLockOriginal = original;
    proto.render = performanceReactionLockRender;
    state.renderHookInstalled = true;
  }

  chainGlobal('NpcActivityPlanner', patchPlanner);
  installRenderHook();
  global.setInterval?.(installRenderHook, 500);

  global.NpcPerformanceReactionLock = Object.freeze({
    installed: true,
    isNpcPerformanceLocked,
    getDebug: () => ({
      maskedResolves: state.maskedResolves,
      renderSuppressions: state.renderSuppressions,
      facingSuppressions: state.facingSuppressions,
      lastNpcId: state.lastNpcId,
      lastAt: state.lastAt,
      renderHookInstalled: state.renderHookInstalled,
    }),
  });
})(window);

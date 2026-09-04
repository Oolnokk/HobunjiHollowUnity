// Bridges ambient NPC Kurraya performances into the generic NpcSocialStimuli
// bulletin board. The music minigame already knows who is currently on duty;
// this file only turns that audible world event into the same `music` stimulus
// the player Kurraya already emits, so inhibition/watch/join logic has one
// source-agnostic input.
(function (global) {
  'use strict';

  if (global.NpcAmbientMusicStimuli?.installed) return;

  const state = {
    plannerDeps: null,
    lastPollAt: 0,
    activeIds: new Set(),
    emitted: 0,
  };
  const POLL_MS = 500;
  const STIM_PREFIX = 'ambient-kurraya:';

  function patchPlanner(api) {
    if (!api?.init || api.init.__ambientMusicStimuliWrapped) return;
    const original = api.init.bind(api);
    api.init = function ambientMusicStimuliPlannerInit(injectedDeps) {
      state.plannerDeps = injectedDeps || state.plannerDeps;
      return original(injectedDeps);
    };
    api.init.__ambientMusicStimuliWrapped = true;
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

  function clearMissing(nextIds) {
    for (const id of state.activeIds) {
      if (nextIds.has(id)) continue;
      global.NpcSocialStimuli?.clear?.(id);
    }
    state.activeIds = nextIds;
  }

  function poll() {
    const t = performance.now();
    if (t - state.lastPollAt < POLL_MS) return;
    state.lastPollAt = t;
    const stimuli = global.NpcSocialStimuli;
    const scheduling = global.NpcScheduling;
    const deps = state.plannerDeps;
    if (!stimuli?.emit || !scheduling?.listInstrumentPerformers || !deps?.findNpcWalker) return;

    // While the player is actively leading/joining a Kurraya session, the
    // ordinary `player-kurraya` stimulus is already authoritative in this
    // area. Ambient musicians defer to that leader, so do not advertise
    // phantom simultaneous music from their on-duty stations.
    if (global.MusicMinigame?.state?.active) {
      clearMissing(new Set());
      return;
    }

    const nextIds = new Set();
    for (const performer of scheduling.listInstrumentPerformers() || []) {
      const walker = deps.findNpcWalker(performer.npcId);
      if (!walker?.root || walker.area !== performer.area) continue;
      const id = `${STIM_PREFIX}${performer.npcId}`;
      nextIds.add(id);
      stimuli.emit({
        id,
        type: 'music',
        area: performer.area,
        x: walker.root.position.x,
        z: walker.root.position.z,
        radius: 12,
        strength: 0.82,
        durationMs: 1500,
        sourceNpcId: performer.npcId,
        sourceIsPlayer: false,
        rhythmSource: performer.songId || null,
      });
      state.emitted++;
    }
    clearMissing(nextIds);
  }

  function frame() {
    poll();
    global.requestAnimationFrame(frame);
  }

  chainGlobal('NpcActivityPlanner', patchPlanner);

  global.NpcAmbientMusicStimuli = Object.freeze({
    installed: true,
    poll,
    getDebug: () => ({ emitted: state.emitted, activeIds: [...state.activeIds], hasPlannerDeps: !!state.plannerDeps }),
  });
  global.requestAnimationFrame(frame);
})(window);

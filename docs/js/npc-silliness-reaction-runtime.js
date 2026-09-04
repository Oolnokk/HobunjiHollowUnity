// Relationship-polarized ambient reactions to player silliness.
//
// Polarity is intentionally simple and absolute:
//   hearts < 0  -> negative authored reaction
//   hearts >= 0 -> positive authored reaction
// Inhibition never participates in that branch. It only informed how each
// character's positive/negative lines were authored in silliness-reactions.json.
// The current automatic source is a nearby player dance, but react() is public
// so later emotes/pranks can reuse the exact same relationship rule.
(function (global) {
  'use strict';

  if (global.NpcSillinessReactions?.installed) return;

  const state = {
    plannerDeps: null,
    config: null,
    configError: null,
    ambientGreetingRadiusTiles: 2.6,
    ambientGreetingConfigError: null,
    greetingSuppressedNpcIds: new Set(), // Reactions replace a same-encounter ordinary player greeting until the pair separate.
    encounters: new Map(), // npcId -> { inside, serial, lastReactionAt, lastReactionSerial, lastPolarity, lastLine }
    reactions: 0,
    positive: 0,
    negative: 0,
    greetingReplacements: 0,
  };

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function chainGlobal(name, patcher) {
    const current = global[name];
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current;
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(global) : stored; },
        set(value) {
          if (oldSet) oldSet.call(global, value);
          else stored = value;
          const resolved = oldGet ? oldGet.call(global) : stored;
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  function patchPlanner(api) {
    if (!api?.init || api.init.__npcSillinessReactionDepsWrapped) return;
    const originalInit = api.init.bind(api);
    api.init = function sillinessReactionPlannerInit(injectedDeps) {
      state.plannerDeps = injectedDeps || state.plannerDeps;
      return originalInit(injectedDeps);
    };
    api.init.__npcSillinessReactionDepsWrapped = true;
  }

  function patchAmbientDialogue(api) {
    if (!api?.init || api.init.__npcSillinessGreetingPriorityWrapped) return;

    // AmbientDialogue gets its own shallow dependency bag so only its greeting
    // walker query is filtered. No shared game dependency object is mutated.
    const originalInit = api.init.bind(api);
    api.init = function sillinessPriorityAmbientInit(injectedDeps) {
      const sourceDeps = injectedDeps || {};
      const originalGetNpcWalkers = sourceDeps.getNpcWalkers;
      if (typeof originalGetNpcWalkers !== 'function') return originalInit(injectedDeps);
      const ambientDeps = {
        ...sourceDeps,
        getNpcWalkers: (...args) => {
          const walkers = originalGetNpcWalkers.apply(sourceDeps, args) || [];
          return walkers.filter(walker => !state.greetingSuppressedNpcIds.has(String(walker?.rec?.id || '')));
        },
      };
      return originalInit(ambientDeps);
    };
    api.init.__npcSillinessGreetingPriorityWrapped = true;

    // Run the reaction pass immediately before AmbientDialogue's own greeting
    // scan. That makes priority deterministic rather than depending on whether
    // the 180 ms silliness interval or the 200 ms greeting throttle fired first.
    if (api.update && !api.update.__npcSillinessGreetingPriorityWrapped) {
      const originalUpdate = api.update.bind(api);
      api.update = function sillinessPriorityAmbientUpdate(now) {
        update(Number.isFinite(Number(now)) ? Number(now) : nowMs());
        return originalUpdate(now);
      };
      api.update.__npcSillinessGreetingPriorityWrapped = true;
    }
  }

  async function loadConfig() {
    if (state.config) return state.config;
    try {
      const url = new URL('config/dialogue/silliness-reactions.json', document.baseURI).href;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = await response.json();
      if (!loaded?.default?.positive?.length || !loaded?.default?.negative?.length) {
        throw new Error('silliness-reactions.json is missing default positive/negative lines');
      }
      state.config = loaded;
      state.configError = null;
      return loaded;
    } catch (error) {
      state.configError = error?.message || String(error);
      return null;
    }
  }

  async function loadAmbientGreetingRadius() {
    try {
      const url = new URL('config/dialogue/ambient-dialogue.json', document.baseURI).href;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = await response.json();
      const radius = Number(loaded?.greetingRadiusTiles);
      if (Number.isFinite(radius) && radius > 0) state.ambientGreetingRadiusTiles = radius;
      state.ambientGreetingConfigError = null;
    } catch (error) {
      // 2.6 is AmbientDialogue's own built-in default, so this fallback remains
      // behaviorally identical if the authored config cannot be fetched.
      state.ambientGreetingConfigError = error?.message || String(error);
    }
    return state.ambientGreetingRadiusTiles;
  }

  function heartsFor(npcId) {
    // This is deliberately the same raw favor/heart value used by the social
    // inhibition invitation rule. No friendship tier or inhibition conversion
    // is allowed to alter positive-vs-negative silliness polarity.
    return Number(global.DialogueContent?.getNpcDlgState?.(npcId)?.favor) || 0;
  }

  function hash01(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }

  function linesFor(npcId, polarity) {
    const authored = state.config?.npcs?.[npcId]?.[polarity];
    if (Array.isArray(authored) && authored.length) return authored;
    const fallback = state.config?.default?.[polarity];
    return Array.isArray(fallback) && fallback.length ? fallback : [];
  }

  function lineFor(npcId, polarity, serial) {
    const lines = linesFor(npcId, polarity);
    if (!lines.length) return null;
    const index = Math.floor(hash01(`${npcId}|${polarity}|${serial}`) * lines.length) % lines.length;
    return lines[index];
  }

  function playerTarget() {
    const root = global.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || global.ProceduralHandAttachments?.gameDeps?.playerMesh
      || global.Combat?.deps?.playerMesh
      || null;
    if (root) return { root };
    const position = state.plannerDeps?.getPlayerPosition?.();
    return position && Number.isFinite(position.x) && Number.isFinite(position.z)
      ? { x: position.x, z: position.z }
      : null;
  }

  function playerXZ() {
    const player = playerTarget();
    const x = Number(player?.root?.position?.x ?? player?.x);
    const z = Number(player?.root?.position?.z ?? player?.z);
    return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
  }

  function setGreetingSuppressed(npcId, suppressed) {
    const id = String(npcId || '');
    if (!id) return;
    if (suppressed) {
      if (!state.greetingSuppressedNpcIds.has(id)) state.greetingReplacements++;
      state.greetingSuppressedNpcIds.add(id);
    } else {
      state.greetingSuppressedNpcIds.delete(id);
    }
  }

  function refreshGreetingSuppressionFor(walker, encounter) {
    const id = String(walker?.rec?.id || '');
    if (!id || !walker?.root || !encounter) return;
    const player = playerXZ();
    if (!player) {
      setGreetingSuppressed(id, false);
      return;
    }
    const distance = Math.hypot(walker.root.position.x - player.x, walker.root.position.z - player.z);
    if (distance > state.ambientGreetingRadiusTiles) {
      // Separation ends the replacement encounter. A later re-approach may use
      // the ordinary once-per-day greeting if it has not actually been spoken.
      setGreetingSuppressed(id, false);
      return;
    }
    // Once this silliness encounter produced a reaction, that reaction owns any
    // regular player greeting opportunity that overlaps it. This remains true
    // while the pair stay in greeting range, even if the dance stops one frame
    // later, preventing an awkward "reaction -> hello" double line.
    setGreetingSuppressed(id, encounter.lastReactionSerial === encounter.serial && encounter.serial > 0);
  }

  function refreshSuppressionAfterStimulusEnds(walkers) {
    const live = new Set();
    for (const walker of walkers || []) {
      const id = String(walker?.rec?.id || '');
      if (!id) continue;
      live.add(id);
      if (!state.greetingSuppressedNpcIds.has(id)) continue;
      refreshGreetingSuppressionFor(walker, state.encounters.get(id));
    }
    for (const id of [...state.greetingSuppressedNpcIds]) {
      if (!live.has(id)) state.greetingSuppressedNpcIds.delete(id);
    }
  }

  function react(walker, options = {}) {
    if (!walker?.root || !walker?.rec?.id || !state.config || !global.AmbientDialogue?.show) return false;
    if (global.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(walker.rec.id)) return false;
    if (state.plannerDeps?.isDialogueOpen?.() || state.plannerDeps?.isPaused?.()) return false;

    const id = String(walker.rec.id);
    const hearts = heartsFor(id);
    const polarity = hearts < 0 ? 'negative' : 'positive'; // THE ONLY polarity rule.
    const serial = Number(options.serial) || 1;
    const line = lineFor(id, polarity, serial);
    if (!line) return false;

    const player = playerTarget();
    if (player?.root?.position || (Number.isFinite(player?.x) && Number.isFinite(player?.z))) {
      const px = player.root?.position?.x ?? player.x;
      const pz = player.root?.position?.z ?? player.z;
      const angle = -Math.atan2(pz - walker.root.position.z, px - walker.root.position.x) + Math.PI / 2;
      walker.applyFacingDeadzone?.(angle, 0.34);
    }

    const shown = global.AmbientDialogue.show(walker.root, line, {
      speakerId: id,
      profile: walker.profile,
      mode: 'chathead',
      durationMs: Number(state.config.durationMs) || 4400,
      tone: `silliness-${polarity}`,
      directedAtPlayer: true,
      faceWalker: walker,
      faceTarget: player,
    });
    if (!shown) return false;

    const encounter = state.encounters.get(id) || { inside: false, serial: 0, lastReactionAt: -Infinity };
    encounter.lastReactionAt = nowMs();
    encounter.lastReactionSerial = serial;
    encounter.lastPolarity = polarity;
    encounter.lastLine = line;
    encounter.lastHearts = hearts;
    state.encounters.set(id, encounter);
    refreshGreetingSuppressionFor(walker, encounter);
    state.reactions++;
    state[polarity]++;
    return true;
  }

  function activePlayerSilliness(area) {
    const stimuli = global.NpcSocialStimuli?.getActive?.(area) || [];
    // A future emote/prank can emit type=silliness. Player dancing already emits
    // type=dance, so it participates without changing the existing stimulus API.
    return stimuli
      .filter(stimulus => stimulus?.sourceIsPlayer && (stimulus.type === 'dance' || stimulus.type === 'silliness'))
      .sort((a, b) => (Number(b.strength) || 0) - (Number(a.strength) || 0))[0] || null;
  }

  function update() {
    if (!state.config || !state.plannerDeps?.listNpcWalkersInArea) return;
    const area = state.plannerDeps.getCurrentArea?.();
    const stimulus = activePlayerSilliness(area);
    const walkers = state.plannerDeps.listNpcWalkersInArea(area) || [];
    const liveIds = new Set();

    if (!stimulus) {
      for (const encounter of state.encounters.values()) encounter.inside = false;
      refreshSuppressionAfterStimulusEnds(walkers);
      return;
    }

    const configuredRadius = Math.max(0.5, Number(state.config.reactionRadiusTiles) || 4);
    const radius = Math.min(configuredRadius, Math.max(0.5, Number(stimulus.radius) || configuredRadius));
    const cooldownMs = Math.max(0, Number(state.config.cooldownMs) || 0);
    const now = nowMs();

    for (const walker of walkers) {
      const id = String(walker?.rec?.id || '');
      if (!id || !walker?.root || stimulus.sourceNpcId === id) continue;
      liveIds.add(id);
      let encounter = state.encounters.get(id);
      if (!encounter) {
        encounter = { inside: false, serial: 0, lastReactionAt: -Infinity, lastReactionSerial: 0, lastPolarity: null, lastLine: null };
        state.encounters.set(id, encounter);
      }
      const distance = Math.hypot(walker.root.position.x - stimulus.x, walker.root.position.z - stimulus.z);
      const inside = distance <= radius;
      if (inside && !encounter.inside) {
        encounter.inside = true;
        encounter.serial++;
        // Cooldown controls repetition only. It never changes which polarity is
        // selected; when a line is allowed to fire, hearts < 0 is the whole rule.
        if (now - encounter.lastReactionAt >= cooldownMs) {
          const emitted = react(walker, { stimulus, serial: encounter.serial });
          // If dialogue/UI systems were temporarily unavailable, keep this as an
          // unconsumed entrance so the NPC can answer on a later poll while the
          // player is still nearby instead of silently losing the reaction.
          if (!emitted) encounter.inside = false;
        }
      } else if (!inside) {
        encounter.inside = false;
      }
      refreshGreetingSuppressionFor(walker, encounter);
    }

    for (const [id, encounter] of state.encounters) {
      if (!liveIds.has(id)) {
        encounter.inside = false;
        state.greetingSuppressedNpcIds.delete(id);
      }
    }
  }

  chainGlobal('NpcActivityPlanner', patchPlanner);
  chainGlobal('AmbientDialogue', patchAmbientDialogue);
  loadConfig();
  loadAmbientGreetingRadius();
  global.setInterval?.(update, 180);

  global.NpcSillinessReactions = Object.freeze({
    installed: true,
    react,
    reload: async () => {
      state.config = null;
      await Promise.all([loadConfig(), loadAmbientGreetingRadius()]);
      return state.config;
    },
    getDebug(npcId) {
      if (npcId) {
        const id = String(npcId);
        return {
          npcId: id,
          hearts: heartsFor(id),
          polarity: heartsFor(id) < 0 ? 'negative' : 'positive',
          authored: !!state.config?.npcs?.[id],
          greetingSuppressed: state.greetingSuppressedNpcIds.has(id),
          encounter: state.encounters.get(id) || null,
        };
      }
      return {
        configLoaded: !!state.config,
        configError: state.configError,
        ambientGreetingRadiusTiles: state.ambientGreetingRadiusTiles,
        ambientGreetingConfigError: state.ambientGreetingConfigError,
        authoredNpcCount: Object.keys(state.config?.npcs || {}).length,
        reactions: state.reactions,
        positive: state.positive,
        negative: state.negative,
        greetingReplacements: state.greetingReplacements,
        greetingSuppressedNpcIds: [...state.greetingSuppressedNpcIds],
      };
    },
  });
})(window);

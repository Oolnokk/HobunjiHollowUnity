// Shared personality-driven NPC ambient reactions.
//
// This keeps the old NpcSillinessReactions public API for compatibility, but
// broadens the runtime to one authoring source for:
//   - player silliness, dance, and music reactions
//   - mount / companion / shoulder-pet ambient reactions
//   - the one-time stable-animal recognition conversation
//
// All authored copy lives in config/dialogue/npc-reaction-profiles.json and is
// edited from the Ambient Dialogue Editor. Gameplay systems still decide WHEN
// a reaction happens; this module only decides WHAT the NPC says.
(function (global) {
  'use strict';

  if (global.NpcReactionProfiles?.installed) return;

  const CONFIG_PATH = 'config/dialogue/npc-reaction-profiles.json'; // Used by loadConfig() and diagnostics to keep one reaction-copy authority.
  const AMBIENT_CONFIG_PATH = 'config/dialogue/ambient-dialogue.json'; // Used only to mirror AmbientDialogue's greeting radius for greeting replacement.
  const ALLOWED_SOCIAL_TYPES = Object.freeze(['silliness', 'dance', 'music']); // Used by automatic player-stimulus selection and public react() normalization.
  const ROLE_IDS = Object.freeze(['companion', 'mount', 'shoulderPet']); // Used when matching an animal-directed AmbientDialogue event back to the active stable animal.

  const FALLBACK_CONFIG = Object.freeze({ // Used only if the authored JSON cannot be loaded, so reactions never become fatal.
    settings: Object.freeze({ reactionRadiusTiles: 4, cooldownMs: 9000, durationMs: 4400, directPetGreetingRank: 3 }),
    defaultProfile: 'neighborly',
    profiles: Object.freeze({
      neighborly: Object.freeze({
        label: 'Neighborly',
        animal: Object.freeze({
          recognized: Object.freeze(['Hello, {animalName}!']),
          trained: Object.freeze({ mount: Object.freeze(["That's a fine {species}." ]), companion: Object.freeze(['Good {species}.']), shoulderPet: Object.freeze(['Well, hello up there.']) }),
          familiar: Object.freeze({ mount: Object.freeze(["They're settling in nicely."]), companion: Object.freeze(['{animalName} listens well.']), shoulderPet: Object.freeze(['{animalName} looks comfortable up there.']) }),
          wary: Object.freeze({ mount: Object.freeze(['Easy with that {species}.']), companion: Object.freeze(['Keep {animalName} close, please.']), shoulderPet: Object.freeze(['Oh! I almost missed {animalName}.']) }),
          recognition: Object.freeze({ mount: Object.freeze(["I've gotten used to seeing {animalName} with you."]), companion: Object.freeze(['I know {animalName} now.']), shoulderPet: Object.freeze(["I'd notice if {animalName} wasn't up there."]) }),
        }),
        silliness: Object.freeze({ positive: Object.freeze(['Ha! That was funny.']), negative: Object.freeze(["That's enough."]) }),
        dance: Object.freeze({ positive: Object.freeze(['There you go!']), negative: Object.freeze(['Not with me, thanks.']) }),
        music: Object.freeze({ positive: Object.freeze(["That's nice."]), negative: Object.freeze(['Not right now, please.']) }),
      }),
    }),
    assignments: Object.freeze({}),
  });

  const state = { // Shared mutable runtime state used by config loading, automatic social encounters, and mobile-friendly diagnostics.
    plannerDeps: null,
    config: clone(FALLBACK_CONFIG),
    configLoaded: false,
    configError: null,
    ambientGreetingRadiusTiles: 2.6,
    ambientGreetingConfigError: null,
    greetingSuppressedNpcIds: new Set(),
    encounters: new Map(),
    reactions: 0,
    positive: 0,
    negative: 0,
    reactionsByType: { silliness: 0, dance: 0, music: 0 },
    greetingReplacementEncounters: 0,
    animalLineReplacements: 0,
    recognitionLineReplacements: 0,
  };

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()); // Used by cooldowns and debug timestamps independent of game clock speed.

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function finite(value, fallback) {
    const number = Number(value); // Parsed numeric input used by authored tuning and runtime distances.
    return Number.isFinite(number) ? number : fallback;
  }
  function hashIndex(seed, length) {
    let hash = 2166136261; // FNV-style deterministic hash used so the same encounter seed picks a stable authored line.
    for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return length ? (hash >>> 0) % length : 0;
  }
  function cleanPool(value) {
    return Array.isArray(value) ? value.map(line => String(line || '').trim()).filter(Boolean) : [];
  }
  function profileIdForNpc(npcId) {
    const requested = String(state.config?.assignments?.[npcId] || ''); // Per-NPC profile assignment used before the config default.
    if (requested && state.config?.profiles?.[requested]) return requested;
    const fallback = String(state.config?.defaultProfile || FALLBACK_CONFIG.defaultProfile); // Default profile ID used when the NPC has no valid assignment.
    return state.config?.profiles?.[fallback] ? fallback : Object.keys(state.config?.profiles || {})[0] || 'neighborly';
  }
  function profileForNpc(npcId) {
    const profileId = profileIdForNpc(npcId); // Resolved ID returned with the profile for editor/debug visibility.
    return { id: profileId, profile: state.config?.profiles?.[profileId] || FALLBACK_CONFIG.profiles.neighborly };
  }
  function defaultProfile() {
    const id = String(state.config?.defaultProfile || FALLBACK_CONFIG.defaultProfile); // Author-selected inheritance source for blank personality sub-pools.
    return state.config?.profiles?.[id] || FALLBACK_CONFIG.profiles.neighborly;
  }
  function nestedPool(profile, category, options = {}) {
    if (!profile) return [];
    if (category === 'animal') {
      const tier = String(options.tier || 'wary'); // Animal familiarity tier selects recognized/trained/familiar/wary/recognition authoring.
      if (tier === 'recognized') return cleanPool(profile.animal?.recognized);
      const role = String(options.role || 'companion'); // Stable role selects the role-specific animal pool within the tier.
      return cleanPool(profile.animal?.[tier]?.[role]);
    }
    const polarity = options.polarity === 'negative' ? 'negative' : 'positive'; // Relationship polarity selects positive vs negative social copy.
    return cleanPool(profile?.[category]?.[polarity]);
  }
  function poolFor(npcId, category, options = {}) {
    const selected = profileForNpc(npcId); // NPC-specific personality profile checked before default-profile inheritance.
    const ownPool = nestedPool(selected.profile, category, options); // Authored pool for the assigned personality.
    if (ownPool.length) return ownPool;
    const inherited = nestedPool(defaultProfile(), category, options); // Blank pool inherits from the configured default personality.
    if (inherited.length) return inherited;
    return nestedPool(FALLBACK_CONFIG.profiles.neighborly, category, options); // Hard fallback protects old saves/config mistakes.
  }
  function templateLine(source, values = {}) {
    return String(source || '').replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, key) => key in values ? String(values[key]) : token);
  }
  function resolve(options = {}) {
    const npcId = String(options.npcId || ''); // Speaker ID selects the assigned personality profile.
    const category = String(options.category || 'silliness'); // Reaction category selects animal/silliness/dance/music authoring.
    const pool = poolFor(npcId, category, options); // Final inherited pool used for deterministic selection.
    if (!pool.length) return null;
    const seed = options.seed ?? `${npcId}|${category}|${options.tier || options.polarity || ''}|${options.role || ''}`; // Stable encounter seed avoids frame-dependent line changes.
    return templateLine(pool[hashIndex(seed, pool.length)], options.values || {});
  }

  async function loadConfig() {
    try {
      const url = new URL(CONFIG_PATH, document.baseURI).href; // Absolute config URL used by browser fetch and diagnostics.
      const response = await fetch(url, { cache: 'no-store' }); // Fresh authoring fetch keeps dev previews from holding stale reaction copy.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = await response.json(); // Parsed reaction profile document becomes runtime authority after shape validation.
      if (!loaded?.profiles || !Object.keys(loaded.profiles).length) throw new Error('npc-reaction-profiles.json has no profiles');
      state.config = loaded;
      state.configLoaded = true;
      state.configError = null;
      return state.config;
    } catch (error) {
      state.config = clone(FALLBACK_CONFIG);
      state.configLoaded = false;
      state.configError = error?.message || String(error);
      return state.config;
    }
  }

  async function loadAmbientGreetingRadius() {
    try {
      const url = new URL(AMBIENT_CONFIG_PATH, document.baseURI).href; // Shared greeting config URL used only for reaction-vs-greeting encounter ownership.
      const response = await fetch(url, { cache: 'no-store' }); // Current ambient radius keeps replacement behavior aligned with AmbientDialogue.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = await response.json(); // Ambient config snapshot inspected only for greetingRadiusTiles.
      const radius = Number(loaded?.greetingRadiusTiles); // Positive authored radius replaces the runtime mirror fallback.
      if (Number.isFinite(radius) && radius > 0) state.ambientGreetingRadiusTiles = radius;
      state.ambientGreetingConfigError = null;
    } catch (error) {
      state.ambientGreetingConfigError = error?.message || String(error);
    }
    return state.ambientGreetingRadiusTiles;
  }

  function chainGlobal(name, patcher) {
    const current = global[name]; // Existing global is patched immediately when this runtime loads after its dependency.
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(global, name); // Existing accessor chain is preserved for modules that also patch future globals.
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current; // Local storage backs a future assignment when no older setter exists.
    const oldGet = descriptor?.get; // Prior getter remains authoritative when another module already installed an accessor.
    const oldSet = descriptor?.set; // Prior setter remains authoritative before this module patches the resolved value.
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(global) : stored; },
        set(value) {
          if (oldSet) oldSet.call(global, value);
          else stored = value;
          const resolved = oldGet ? oldGet.call(global) : stored; // Actual assigned API object passed through the reaction patcher.
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  function stableRoleActor(role) {
    if (role === 'mount') {
      const ride = global.Mounts?.rideEntity; // Live mounted actor matched against AmbientDialogue.faceTarget.
      return ride && ride.health > 0 && ride.avatarRef?.group?.visible !== false ? ride : null;
    }
    const combat = global.Combat?.deps; // Combat dependency bag owns active companion/shoulder-pet actors.
    const player = combat?.player; // Player ownership check prevents another actor's creature from matching the player's stable entry.
    const area = combat?.getCurrentArea?.(); // Current area filters hidden/off-map companions.
    if (!player) return null;
    for (const actor of combat.companionObjects || []) {
      if (!actor || actor.health <= 0 || actor.stableRole !== role) continue;
      if ((actor.master || player) !== player) continue;
      if (area && actor.areaId && actor.areaId !== area) continue;
      if (actor.avatarRef?.group?.visible === false) continue;
      return actor;
    }
    return null;
  }

  function activeAnimalForTarget(options) {
    const targetRoot = options?.faceTarget?.root; // Animal-directed stable reactions identify their addressee through the existing faceTarget root.
    if (!targetRoot) return null;
    const progression = global.StableAnimalProgression; // Public stable progression API supplies active entries and rapport-bond ranks.
    if (!progression?.activeEntryForRole) return null;
    for (const role of ROLE_IDS) {
      const entry = progression.activeEntryForRole(role); // Active stable entry paired with the live actor for this role.
      const actor = stableRoleActor(role); // Live actor root compared to the reaction's existing face target.
      if (!entry || !actor || actor.avatarRef?.group !== targetRoot) continue;
      return { role, entry, actor, bondRank: Number(progression.perkRank?.(entry, 'rapportBond')) || 0 };
    }
    return null;
  }

  function animalByStableId(stableId) {
    const progression = global.StableAnimalProgression; // Public active-role API used because recognition candidates are necessarily present animals.
    if (!progression?.activeEntryForRole) return null;
    for (const role of ROLE_IDS) {
      const entry = progression.activeEntryForRole(role); // Active entry checked against the recognition tree's embedded stable ID.
      if (!entry || String(entry.id) !== String(stableId)) continue;
      const actor = stableRoleActor(role); // Live actor retained for parity with ambient animal diagnostics.
      return { role, entry, actor, bondRank: Number(progression.perkRank?.(entry, 'rapportBond')) || 0 };
    }
    return null;
  }

  function speciesLabel(entry) {
    return global.CREATURE_DB?.[entry?.kind]?.label || entry?.kind || 'animal';
  }
  function socialDay() {
    const rapportDay = Number(global.NpcRapport?.currentGameDay?.()); // Rapport's social-day bridge is preferred when available.
    if (Number.isFinite(rapportDay)) return Math.floor(rapportDay);
    const calendarDay = Number(global.CalendarSystem?.timeDebugSnapshot?.()?.rawDay ?? global.calendar?.day); // Calendar fallback keeps deterministic seeds stable before NpcRapport loads.
    return Number.isFinite(calendarDay) ? Math.floor(calendarDay) : 0;
  }
  function npcRecognizesAnimal(npcId, entry) {
    const memory = global.DialogueContent?.getNpcDlgState?.(npcId)?.memory || []; // Existing dialogue memory remains the sole recognition-state authority.
    const key = `stableAnimalRecognized:${entry?.id || 'unknown'}`; // Same event key authored by StableAnimalProgression.
    return memory.some(item => (typeof item === 'string' ? item : item?.event) === key);
  }
  function animalTier(npcId, animal) {
    const directRank = Math.max(1, Math.floor(finite(state.config?.settings?.directPetGreetingRank, 3))); // Configured training threshold mirrors the stable progression's direct greeting rank.
    if (npcRecognizesAnimal(npcId, animal.entry) && animal.bondRank >= directRank) return 'recognized';
    if (animal.bondRank >= directRank) return 'trained';
    if (animal.bondRank > 0) return 'familiar';
    return 'wary';
  }
  function animalLine(npcId, animal, tier = animalTier(npcId, animal)) {
    const animalName = animal.entry?.name || speciesLabel(animal.entry); // Placeholder value prefers the stable animal's player-given name.
    const species = speciesLabel(animal.entry); // Placeholder value exposes the creature species label for generic lines.
    return resolve({
      npcId,
      category: 'animal',
      tier,
      role: animal.role,
      values: { animalName, species },
      seed: `${npcId}|${animal.entry?.id}|${socialDay()}|${tier}|${animal.role}`,
    });
  }

  function patchAnimalDialogueShow(api) {
    if (!api?.show || api.show.__npcReactionAnimalCopyWrapped) return;
    const originalShow = api.show.bind(api); // Existing AmbientDialogue.show remains authoritative for rendering, timing, facing, and sequencing wrappers.
    const wrappedShow = function personalityAnimalDialogueShow(target, text, options = {}) {
      const npcId = String(options?.speakerId || ''); // Speaker selects personality assignment for animal-directed lines.
      const animal = npcId && options?.directedAtPlayer === true ? activeAnimalForTarget(options) : null; // Existing directed animal face target distinguishes stable reactions from ordinary greetings.
      if (animal) {
        const tier = animalTier(npcId, animal); // Used both for personality copy selection and the matching ambient facial reaction.
        const replacement = animalLine(npcId, animal, tier); // Personality line replaces only the old hardcoded stable-animal copy.
        if (replacement) {
          text = replacement;
          state.animalLineReplacements++;
        }
        const expression = animalReactionExpression(tier); // Uses a temporary emotion only for clearly warm/wary animal reactions; otherwise resting Favor expression wins.
        if (expression && !options.expression) options = { ...options, expression };
      }
      return originalShow(target, text, options);
    };
    wrappedShow.__npcReactionAnimalCopyWrapped = true;
    api.show = wrappedShow;
  }

  function patchRecognitionConversation(api) {
    if (!api?.beginNpcConversation || api.beginNpcConversation.__npcReactionRecognitionWrapped) return;
    const originalBegin = api.beginNpcConversation.bind(api); // Existing DialogueContent flow remains authoritative for UI, memory, and tree progression.
    const wrappedBegin = function personalityRecognitionConversation(rec, ...args) {
      const tree = (rec?.dialogueTrees || []).find(candidate => String(candidate?.id || '').startsWith('stable_animal_recognition_')); // StableAnimalProgression's temporary recognition tree is the only tree this wrapper edits.
      const node = tree?.nodes?.find(candidate => candidate?.type === 'text'); // Single text node receives personality-authored recognition copy.
      const stableId = tree ? String(tree.id).slice('stable_animal_recognition_'.length) : ''; // Embedded stable ID identifies the present animal and role.
      const animal = stableId ? animalByStableId(stableId) : null; // Present stable animal supplies placeholders and role-specific pool selection.
      const oldText = node?.text; // Original hardcoded text is restored after the underlying conversation starts.
      if (node && animal) {
        const replacement = animalLine(String(rec?.id || ''), animal, 'recognition'); // Personality recognition line replaces the old long generic sentence.
        if (replacement) {
          node.text = replacement;
          state.recognitionLineReplacements++;
        }
      }
      try { return originalBegin(rec, ...args); }
      finally { if (node && oldText != null) node.text = oldText; }
    };
    wrappedBegin.__npcReactionRecognitionWrapped = true;
    api.beginNpcConversation = wrappedBegin;
  }

  function patchPlanner(api) {
    if (!api?.init || api.init.__npcReactionPlannerDepsWrapped) return;
    const originalInit = api.init.bind(api); // Existing planner initialization remains authoritative after dependency capture.
    api.init = function npcReactionPlannerInit(injectedDeps) {
      state.plannerDeps = injectedDeps || state.plannerDeps;
      return originalInit(injectedDeps);
    };
    api.init.__npcReactionPlannerDepsWrapped = true;
  }

  function patchAmbientDialogue(api) {
    patchAnimalDialogueShow(api);
    if (api?.init && !api.init.__npcReactionGreetingPriorityWrapped) {
      const originalInit = api.init.bind(api); // AmbientDialogue receives a shallow dependency view so only its greeting walker query is filtered.
      api.init = function npcReactionPriorityAmbientInit(injectedDeps) {
        const sourceDeps = injectedDeps || {}; // Original AmbientDialogue dependency bag remains untouched for every other consumer.
        const originalGetNpcWalkers = sourceDeps.getNpcWalkers; // Existing walker query filtered only while a reaction owns that encounter's greeting opportunity.
        if (typeof originalGetNpcWalkers !== 'function') return originalInit(injectedDeps);
        const ambientDeps = {
          ...sourceDeps,
          getNpcWalkers: (...args) => {
            const walkers = originalGetNpcWalkers.apply(sourceDeps, args) || []; // Live walkers filtered by reaction-owned NPC IDs.
            return walkers.filter(walker => !state.greetingSuppressedNpcIds.has(String(walker?.rec?.id || '')));
          },
        };
        return originalInit(ambientDeps);
      };
      api.init.__npcReactionGreetingPriorityWrapped = true;
    }
    if (api?.update && !api.update.__npcReactionGreetingPriorityWrapped) {
      const originalUpdate = api.update.bind(api); // Reaction pass runs immediately before AmbientDialogue's own greeting scan for deterministic priority.
      api.update = function npcReactionPriorityAmbientUpdate(now) {
        update(Number.isFinite(Number(now)) ? Number(now) : nowMs());
        return originalUpdate(now);
      };
      api.update.__npcReactionGreetingPriorityWrapped = true;
    }
  }

  function heartsFor(npcId) {
    return Number(global.DialogueContent?.getNpcDlgState?.(npcId)?.favor) || 0;
  }
  function playerTarget() {
    const root = global.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || global.ProceduralHandAttachments?.gameDeps?.playerMesh
      || global.Combat?.deps?.playerMesh
      || null; // Live player render root used for facing and directed chathead anchoring.
    if (root) return { root };
    const position = state.plannerDeps?.getPlayerPosition?.(); // Planner fallback supports tests and runtimes without the body composer.
    return position && Number.isFinite(position.x) && Number.isFinite(position.z) ? { x: position.x, z: position.z } : null;
  }
  function playerXZ() {
    const player = playerTarget(); // Shared player target converted to a simple X/Z point for encounter distance checks.
    const x = Number(player?.root?.position?.x ?? player?.x); // Player world X used by greeting replacement radius checks.
    const z = Number(player?.root?.position?.z ?? player?.z); // Player world Z used by greeting replacement radius checks.
    return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
  }
  function normalizeSocialType(value) {
    const type = String(value || 'silliness'); // Public/automatic stimulus type normalized to one authored reaction category.
    return ALLOWED_SOCIAL_TYPES.includes(type) ? type : 'silliness';
  }
  function reactionExpression(reactionType, polarity) {
    if (polarity === 'negative') return 'frown'; // Negative silliness/dance/music reactions visibly disapprove instead of keeping the NPC's resting mouth.
    return reactionType === 'silliness' ? 'laugh' : 'smile'; // Positive pranks get the stronger laugh mouth; positive dance/music reactions smile.
  }
  function animalReactionExpression(tier) {
    if (tier === 'wary') return 'frown'; // Wary animal copy should read as concern/disapproval.
    if (tier === 'recognized' || tier === 'trained') return 'smile'; // Familiar successful pet greetings visibly warm the NPC's expression.
    return null; // Familiar-but-not-trained copy keeps the NPC's Favor-driven resting expression.
  }
  function socialLine(npcId, reactionType, polarity, serial) {
    return resolve({
      npcId,
      category: reactionType,
      polarity,
      seed: `${npcId}|${reactionType}|${polarity}|${serial}`,
    });
  }
  function setGreetingSuppressed(npcId, suppressed) {
    const id = String(npcId || ''); // Normalized speaker ID used by the filtered AmbientDialogue walker query.
    if (!id) return;
    if (suppressed) {
      if (!state.greetingSuppressedNpcIds.has(id)) state.greetingReplacementEncounters++;
      state.greetingSuppressedNpcIds.add(id);
    } else state.greetingSuppressedNpcIds.delete(id);
  }
  function refreshGreetingSuppressionFor(walker, encounter) {
    const id = String(walker?.rec?.id || ''); // Encounter speaker whose ordinary greeting may be replaced.
    if (!id || !walker?.root || !encounter) return;
    const player = playerXZ(); // Current player position determines whether separation ended the replacement encounter.
    if (!player) { setGreetingSuppressed(id, false); return; }
    const distance = Math.hypot(walker.root.position.x - player.x, walker.root.position.z - player.z); // Same-encounter separation check against AmbientDialogue's greeting radius.
    if (distance > state.ambientGreetingRadiusTiles) { setGreetingSuppressed(id, false); return; }
    setGreetingSuppressed(id, encounter.lastReactionSerial === encounter.serial && encounter.serial > 0);
  }
  function refreshSuppressionAfterStimulusEnds(walkers) {
    const live = new Set(); // Current area NPC IDs used to clean stale suppression entries when walkers despawn.
    for (const walker of walkers || []) {
      const id = String(walker?.rec?.id || ''); // Walker ID looked up in the persisted encounter map.
      if (!id) continue;
      live.add(id);
      if (state.greetingSuppressedNpcIds.has(id)) refreshGreetingSuppressionFor(walker, state.encounters.get(id));
    }
    for (const id of [...state.greetingSuppressedNpcIds]) if (!live.has(id)) state.greetingSuppressedNpcIds.delete(id);
  }

  function react(walker, options = {}) {
    if (!walker?.root || !walker?.rec?.id || !global.AmbientDialogue?.show) return false;
    if (global.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(walker.rec.id)) return false;
    if (state.plannerDeps?.isDialogueOpen?.() || state.plannerDeps?.isPaused?.()) return false;

    const id = String(walker.rec.id); // NPC ID selects personality and relationship state.
    const hearts = heartsFor(id); // Raw favor/heart value remains the sole positive-vs-negative polarity rule.
    const polarity = hearts < 0 ? 'negative' : 'positive'; // Existing relationship behavior preserved exactly.
    const serial = Number(options.serial) || 1; // Encounter serial seeds deterministic line choice and repeat tracking.
    const reactionType = normalizeSocialType(options.reactionType || options.stimulus?.type); // Stimulus kind routes to silliness/dance/music copy.
    const line = socialLine(id, reactionType, polarity, serial); // Personality-authored line chosen from the matching category and polarity.
    if (!line) return false;

    const player = playerTarget(); // Directed reaction faces the player without changing the old movement controller.
    if (player?.root?.position || (Number.isFinite(player?.x) && Number.isFinite(player?.z))) {
      const px = player.root?.position?.x ?? player.x; // Player X used by the existing facing angle calculation.
      const pz = player.root?.position?.z ?? player.z; // Player Z used by the existing facing angle calculation.
      const angle = -Math.atan2(pz - walker.root.position.z, px - walker.root.position.x) + Math.PI / 2; // Existing NPC facing convention preserved.
      walker.applyFacingDeadzone?.(angle, 0.34);
    }

    const shown = global.AmbientDialogue.show(walker.root, line, {
      speakerId: id,
      profile: walker.profile,
      mode: 'chathead',
      durationMs: Math.max(800, finite(state.config?.settings?.durationMs, 4400)),
      tone: `reaction-${reactionType}-${polarity}`,
      expression: reactionExpression(reactionType, polarity),
      directedAtPlayer: true,
      faceWalker: walker,
      faceTarget: player,
    });
    if (!shown) return false;

    const encounter = state.encounters.get(id) || { inside: false, serial: 0, lastReactionAt: -Infinity }; // Per-NPC encounter record tracks cooldown and greeting replacement ownership.
    encounter.lastReactionAt = nowMs();
    encounter.lastReactionSerial = serial;
    encounter.lastPolarity = polarity;
    encounter.lastReactionType = reactionType;
    encounter.lastLine = line;
    encounter.lastHearts = hearts;
    state.encounters.set(id, encounter);
    refreshGreetingSuppressionFor(walker, encounter);
    state.reactions++;
    state[polarity]++;
    state.reactionsByType[reactionType]++;
    return true;
  }

  function activePlayerReaction(area) {
    const stimuli = global.NpcSocialStimuli?.getActive?.(area) || []; // Shared social bulletin board supplies player dance, music, and later explicit silliness/pranks.
    return stimuli
      .filter(stimulus => stimulus?.sourceIsPlayer && ALLOWED_SOCIAL_TYPES.includes(stimulus.type))
      .sort((a, b) => (Number(b.strength) || 0) - (Number(a.strength) || 0))[0] || null;
  }

  function update() {
    if (!state.plannerDeps?.listNpcWalkersInArea) return;
    const area = state.plannerDeps.getCurrentArea?.(); // Current area scopes both player stimuli and candidate NPC walkers.
    const stimulus = activePlayerReaction(area); // Strongest active player silliness/dance/music stimulus owns the encounter pass.
    const walkers = state.plannerDeps.listNpcWalkersInArea(area) || []; // Existing planner walker list remains authoritative for eligible NPCs.
    const liveIds = new Set(); // Current candidate IDs used to clear despawned encounter state.

    if (!stimulus) {
      for (const encounter of state.encounters.values()) encounter.inside = false;
      refreshSuppressionAfterStimulusEnds(walkers);
      return;
    }

    const configuredRadius = Math.max(0.5, finite(state.config?.settings?.reactionRadiusTiles, 4)); // Authored maximum reaction distance.
    const radius = Math.min(configuredRadius, Math.max(0.5, finite(stimulus.radius, configuredRadius))); // Stimulus radius may narrow but not widen authored reaction reach.
    const cooldownMs = Math.max(0, finite(state.config?.settings?.cooldownMs, 9000)); // Per-NPC repetition cooldown preserved from the old silliness runtime.
    const now = nowMs(); // Single monotonic timestamp reused for every walker this pass.

    for (const walker of walkers) {
      const id = String(walker?.rec?.id || ''); // Candidate NPC ID keys encounter state and profile selection.
      if (!id || !walker?.root || stimulus.sourceNpcId === id) continue;
      liveIds.add(id);
      let encounter = state.encounters.get(id); // Existing encounter reused across repeated interval/update calls.
      if (!encounter) {
        encounter = { inside: false, serial: 0, lastReactionAt: -Infinity, lastReactionSerial: 0, lastPolarity: null, lastReactionType: null, lastLine: null };
        state.encounters.set(id, encounter);
      }
      const distance = Math.hypot(walker.root.position.x - stimulus.x, walker.root.position.z - stimulus.z); // Stimulus-center distance determines encounter entry/exit.
      const inside = distance <= radius; // Edge transition, not continuous proximity, triggers a new reaction serial.
      if (inside && !encounter.inside) {
        encounter.inside = true;
        encounter.serial++;
        if (now - encounter.lastReactionAt >= cooldownMs) {
          const emitted = react(walker, { stimulus, serial: encounter.serial }); // Existing public reaction path handles polarity, facing, rendering, and profile copy.
          if (!emitted) encounter.inside = false;
        }
      } else if (!inside) encounter.inside = false;
      refreshGreetingSuppressionFor(walker, encounter);
    }

    for (const [id, encounter] of state.encounters) {
      if (!liveIds.has(id)) {
        encounter.inside = false;
        state.greetingSuppressedNpcIds.delete(id);
      }
    }
  }

  function getDebug(npcId) {
    if (npcId) {
      const id = String(npcId); // Requested speaker ID narrows diagnostics to one NPC for mobile copy/paste.
      const assignment = profileForNpc(id); // Resolved personality exposes both assignment and inherited fallback behavior.
      return {
        npcId: id,
        hearts: heartsFor(id),
        polarity: heartsFor(id) < 0 ? 'negative' : 'positive',
        profileId: assignment.id,
        profileLabel: assignment.profile?.label || assignment.id,
        greetingSuppressed: state.greetingSuppressedNpcIds.has(id),
        encounter: state.encounters.get(id) || null,
      };
    }
    return {
      configLoaded: state.configLoaded,
      configError: state.configError,
      profileCount: Object.keys(state.config?.profiles || {}).length,
      assignmentCount: Object.keys(state.config?.assignments || {}).length,
      ambientGreetingRadiusTiles: state.ambientGreetingRadiusTiles,
      ambientGreetingConfigError: state.ambientGreetingConfigError,
      reactions: state.reactions,
      positive: state.positive,
      negative: state.negative,
      reactionsByType: { ...state.reactionsByType },
      animalLineReplacements: state.animalLineReplacements,
      recognitionLineReplacements: state.recognitionLineReplacements,
      greetingReplacementEncounters: state.greetingReplacementEncounters,
      greetingSuppressedNpcIds: [...state.greetingSuppressedNpcIds],
    };
  }

  chainGlobal('NpcActivityPlanner', patchPlanner);
  chainGlobal('AmbientDialogue', patchAmbientDialogue);
  chainGlobal('DialogueContent', patchRecognitionConversation);
  loadConfig();
  loadAmbientGreetingRadius();
  global.setInterval?.(update, 180);

  const profileApi = Object.freeze({ // Public resolver/debug API used by diagnostics and future reaction-producing systems without duplicating profile logic.
    installed: true,
    resolve,
    profileForNpc: npcId => ({ ...profileForNpc(String(npcId || '')) }),
    reload: loadConfig,
    getDebug,
  });
  global.NpcReactionProfiles = profileApi;
  global.NpcSillinessReactions = Object.freeze({ // Compatibility surface retained for existing tests/callers while the implementation now covers three social reaction types.
    installed: true,
    react,
    reload: async () => {
      await Promise.all([loadConfig(), loadAmbientGreetingRadius()]);
      return state.config;
    },
    getDebug,
  });
})(window);

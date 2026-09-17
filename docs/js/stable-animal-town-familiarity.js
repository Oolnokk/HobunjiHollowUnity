(() => {
  'use strict';

  const progression = window.StableAnimalProgression; // Existing progression API supplies active animals and rapport-perk contribution math.
  if (!progression || window.StableAnimalTownFamiliarity?.installed) return;

  const MAX_PET_RAPPORT_HEARTS = 10; // Townspeople may use the animal's player-given name once Pet Rapport reaches ten hearts.
  const FALLBACK_POINTS_PER_HEART = 40; // Used only before NpcFavorBalance is available; Pet Rapport intentionally shares that heart scale.
  const DIRECT_GREETING_RANK = 3; // Mirrors the existing direct animal greeting/recognition training threshold.
  const PET_GREETING_PREFIX = 'pet_greeting:'; // Existing rapport reason prefix identifies Rapport created directly by an animal greeting.
  const ROLES = Object.freeze(['companion', 'mount', 'shoulderPet']); // Shared active-role order used by attribution and dialogue targeting.
  const TRACE_LIMIT = 24; // Small rolling attribution history supports mobile copy/paste diagnostics.
  const POINT_PRECISION = 10000; // Pet Rapport keeps fractional perk attribution without floating-point tails.

  let farmDeps = null; // Captured FarmAnimals dependencies provide the canonical stable array and saveStable().
  const awardTrace = []; // Recent Pet Rapport gains are exposed through getDebug()/copyDebug().

  function number(value, fallback = 0) {
    const parsed = Number(value); // Parsed numeric value is reused by all clamping/attribution helpers.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundPoint(value) {
    return Math.round(number(value, 0) * POINT_PRECISION) / POINT_PRECISION;
  }

  function pointsPerHeart() {
    const current = number(window.NpcFavorBalance?.favorPointsPerHeart, FALLBACK_POINTS_PER_HEART); // Live relationship scale keeps Pet Rapport hearts aligned if balancing changes later.
    return current > 0 ? current : FALLBACK_POINTS_PER_HEART;
  }

  function heartsToPetRapport(hearts) {
    const converter = window.NpcFavorBalance?.heartsToFavorPoints; // Canonical relationship helper is preferred so Pet Rapport uses the exact same heart spacing.
    const converted = typeof converter === 'function' ? number(converter(hearts), NaN) : NaN;
    return Number.isFinite(converted) ? converted : number(hearts, 0) * pointsPerHeart();
  }

  function petRapportToHearts(points) {
    const converter = window.NpcFavorBalance?.favorPointsToHearts; // Canonical relationship helper is preferred so the Stable UI matches Relationships exactly.
    const converted = typeof converter === 'function' ? number(converter(points), NaN) : NaN;
    return Number.isFinite(converted) ? converted : number(points, 0) / pointsPerHeart();
  }

  function maxPetRapportPoints() {
    return Math.max(0, heartsToPetRapport(MAX_PET_RAPPORT_HEARTS));
  }

  function clampPetRapport(value) {
    return Math.max(0, Math.min(maxPetRapportPoints(), number(value, 0)));
  }

  function stableEntries() {
    const stable = farmDeps?.getStable?.(); // Existing stable collection remains the persistence owner; no parallel save store is introduced.
    return Array.isArray(stable) ? stable : [];
  }

  function normalizeEntry(entry) {
    if (!entry) return entry;
    const canonical = number(entry.petRapport, NaN); // New saves store the relationship only as Pet Rapport.
    const legacyTownFavor = number(entry.townFavor, NaN); // Earlier builds of this branch briefly used townFavor; migrate it without discarding test progress.
    const source = Number.isFinite(canonical) ? canonical : (Number.isFinite(legacyTownFavor) ? legacyTownFavor : 0);
    entry.petRapport = roundPoint(clampPetRapport(source));
    if (Object.prototype.hasOwnProperty.call(entry, 'townFavor')) delete entry.townFavor;
    return entry;
  }

  function normalizeStable(save = false) {
    let changed = false; // Indicates whether Pet Rapport had to be initialized, migrated, or repaired.
    for (const entry of stableEntries()) {
      const before = JSON.stringify({ petRapport: entry?.petRapport, townFavor: entry?.townFavor }); // Small before/after snapshot catches legacy-field deletion too.
      normalizeEntry(entry);
      const after = JSON.stringify({ petRapport: entry?.petRapport, townFavor: entry?.townFavor });
      if (before !== after) changed = true;
    }
    if (changed && save) farmDeps?.saveStable?.();
    return changed;
  }

  function activeEntryById(id) {
    const stableId = String(id || ''); // Canonical id is matched against the three existing active stable roles.
    for (const role of ROLES) {
      const entry = progression.activeEntryForRole?.(role); // StableAnimalProgression remains authoritative for active-role selection.
      if (entry && String(entry.id || '') === stableId) return entry;
    }
    return null;
  }

  function findEntry(id) {
    const stableId = String(id || ''); // Stable id may come from a saved entry or an existing pet_greeting reason.
    return stableEntries().find(entry => String(entry?.id || '') === stableId) || activeEntryById(stableId);
  }

  function getPetRapport(entryOrId) {
    const entry = typeof entryOrId === 'string' ? findEntry(entryOrId) : entryOrId; // Public helper returns raw Pet Rapport points.
    return entry ? normalizeEntry(entry).petRapport : 0;
  }

  function getPetHearts(entryOrId) {
    return petRapportToHearts(getPetRapport(entryOrId));
  }

  function isKnownByTown(entryOrId) {
    return getPetHearts(entryOrId) >= MAX_PET_RAPPORT_HEARTS;
  }

  function awardPetRapport(entryOrId, amount, reason = 'presence', details = {}) {
    const entry = typeof entryOrId === 'string' ? findEntry(entryOrId) : entryOrId; // Pet Rapport is stored directly on the canonical stable entry.
    const requested = Math.max(0, number(amount, 0)); // One attributable NPC Rapport grants one Pet Rapport; negative/invalid Rapport never lowers it.
    if (!entry || requested <= 0) return 0;
    const before = getPetRapport(entry); // Previous Pet Rapport determines the actual clamped gain.
    const after = roundPoint(clampPetRapport(before + requested)); // Pet Rapport caps at the point equivalent of ten hearts.
    const gained = roundPoint(after - before); // Actual gain is used by diagnostics and future treat/perk hooks.
    if (gained <= 0) return 0;
    entry.petRapport = after;
    farmDeps?.saveStable?.();
    const trace = {
      at: Date.now(),
      animalId: entry.id,
      deltaRapport: gained,
      petRapport: entry.petRapport,
      petHearts: roundPoint(getPetHearts(entry)),
      reason,
      ...details,
    }; // Compact non-saved event record supports mobile debugging.
    awardTrace.push(trace);
    if (awardTrace.length > TRACE_LIMIT) awardTrace.splice(0, awardTrace.length - TRACE_LIMIT);
    window.__farmLog?.(`[pet-rapport] ${entry.id} +${gained} Pet Rapport from ${reason}; now ${entry.petRapport}/${maxPetRapportPoints()} (${trace.petHearts}/${MAX_PET_RAPPORT_HEARTS} hearts).`, 'farm');
    return gained;
  }

  function multiplierSnapshot() {
    const details = progression.rapportMultiplierDetails?.() || {}; // Existing progression helper already knows which present animals create each bonus slice.
    const multiplier = Math.max(1, number(details.multiplier, 1)); // Combined multiplier is needed when NPC Rapport clips at its cap.
    const contributors = Array.isArray(details.details) ? details.details : []; // Each contributor exposes stable id plus additive multiplier share.
    return { multiplier, contributors };
  }

  function awardAttributedRapport(rawAmount, actualRapport, source) {
    const base = number(rawAmount, NaN); // Unmultiplied NPC Rapport request is the counterfactual baseline for attribution.
    const actual = number(actualRapport, 0); // Existing NpcRapport.adjust return value is Rapport actually obtained after clamping.
    if (!Number.isFinite(base) || base <= 0 || actual <= 0) return [];
    const snapshot = multiplierSnapshot(); // Same current active-pet math used by StableAnimalProgression's Rapport wrapper.
    const intended = base * snapshot.multiplier; // Intended post-perk Rapport lets clipped gains scale proportionally.
    const capScale = intended > 0 ? Math.max(0, Math.min(1, actual / intended)) : 0; // Only NPC Rapport actually obtained may become Pet Rapport.
    const sourceText = String(source || ''); // Existing reason string may identify a direct animal greeting.
    const sourceId = sourceText.startsWith(PET_GREETING_PREFIX) ? sourceText.slice(PET_GREETING_PREFIX.length) : ''; // Direct greeting base Rapport belongs to that animal.
    const claims = new Map(); // Stable id -> pre-cap NPC Rapport attributable to that animal's presence.

    for (const detail of snapshot.contributors) {
      const animalId = String(detail?.id || ''); // Contributor stable id identifies whose rapport perk created the bonus.
      const add = Math.max(0, number(detail?.add, 0)); // Additive multiplier share converts to `base * add` attributable NPC Rapport.
      if (animalId && add > 0) claims.set(animalId, (claims.get(animalId) || 0) + base * add);
    }
    if (sourceId) claims.set(sourceId, (claims.get(sourceId) || 0) + base);

    const awards = []; // Returned attribution list is test/debug data only; NpcRapport callers still receive their original return value.
    for (const [animalId, claim] of claims) {
      const attributed = claim * capScale; // Contributor's share is reduced proportionally when NPC Rapport was capped.
      const gained = awardPetRapport(
        animalId,
        attributed,
        sourceId === animalId ? 'pet-greeting-rapport' : 'rapport-perk-bonus',
        {
          npcRapportSource: sourceText,
          rawAmount: base,
          actualRapport: actual,
          capScale: roundPoint(capScale),
        },
      ); // One actual attributable NPC Rapport becomes one Pet Rapport.
      if (gained > 0) awards.push({ animalId, gained });
    }
    return awards;
  }

  function patchNpcRapport(api) {
    if (!api || api.__stableAnimalTownFamiliarityWrapped || typeof api.adjust !== 'function') return api;
    const originalAdjust = api.adjust.bind(api); // Existing progression-wrapped adjust remains authoritative for perk multiplication and NPC caps.
    const wrapper = Object.create(Object.getPrototypeOf(api) || Object.prototype); // Frozen NpcRapport APIs are safely extended by replacement.
    const descriptors = Object.getOwnPropertyDescriptors(api); // Every existing property except adjust is preserved on the replacement object.
    delete descriptors.adjust;
    Object.defineProperties(wrapper, descriptors);
    Object.defineProperty(wrapper, 'adjust', {
      configurable: true,
      enumerable: true,
      value(npcId, amount, source) {
        const result = originalAdjust(npcId, amount, source); // Original NPC Rapport delta/return contract is preserved exactly.
        awardAttributedRapport(amount, result, source);
        return result;
      },
    });
    Object.defineProperty(wrapper, '__stableAnimalTownFamiliarityWrapped', { value: true });
    try { return Object.freeze(wrapper); } catch (_) { return wrapper; }
  }

  function liveActor(role) {
    if (role === 'mount') {
      const ride = window.Mounts?.rideEntity; // Active mount root is used to identify animal-directed dialogue.
      return ride && ride.health > 0 && ride.avatarRef?.group?.visible !== false ? ride : null;
    }
    const combat = window.Combat?.deps; // Combat deps own live companion/shoulder-pet actor sets.
    const player = combat?.player; // Ownership check prevents another actor's animal from matching the player's stable entry.
    const area = combat?.getCurrentArea?.(); // Area check rejects hidden/off-map companions.
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

  function animalForTarget(options) {
    const root = options?.faceTarget?.root; // Existing animal reactions expose their addressee through faceTarget.root.
    if (!root) return null;
    for (const role of ROLES) {
      const entry = progression.activeEntryForRole?.(role); // Stable entry supplies saved name/species/Pet Rapport.
      const actor = liveActor(role); // Live actor root must exactly match the current reaction target.
      if (entry && actor?.avatarRef?.group === root) return { role, entry, actor };
    }
    return null;
  }

  function speciesLabel(entry) {
    return window.CREATURE_DB?.[entry?.kind]?.label || entry?.kind || 'animal';
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function genericizeAnimalName(text, entry) {
    const name = String(entry?.name || '').trim(); // Player-given name is suppressed until the pet has ten Pet Rapport hearts.
    if (!name || isKnownByTown(entry)) return String(text || '');
    const species = speciesLabel(entry); // Species label remains usable in pre-recognition authored/fallback lines.
    const matcher = new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(name)})(?=$|[^A-Za-z0-9_])`, 'gi'); // Case-insensitive token boundaries prevent name leaks without replacing short names inside unrelated words.
    return String(text || '').replace(matcher, (match, prefix) => `${prefix}${species}`);
  }

  function patchAmbientDialogue(api) {
    if (!api || api.__stableAnimalTownFamiliarityDialogueWrapped || typeof api.show !== 'function') return api;
    const originalShow = api.show.bind(api); // Existing greeting/personality wrappers continue to choose copy and timing.
    api.show = function stableAnimalTownFamiliarityShow(target, text, options = {}) {
      const animal = options?.directedAtPlayer === true ? animalForTarget(options) : null; // Only explicit animal-directed encounters are name-gated.
      return originalShow(target, animal ? genericizeAnimalName(text, animal.entry) : text, options);
    };
    api.__stableAnimalTownFamiliarityDialogueWrapped = true;
    return api;
  }

  function patchDialogueContent(api) {
    if (!api || api.__stableAnimalTownFamiliarityConversationWrapped || typeof api.beginNpcConversation !== 'function') return api;
    const originalBegin = api.beginNpcConversation.bind(api); // Existing StableAnimalProgression per-NPC recognition wrapper remains inside this final gate.
    api.beginNpcConversation = function stableAnimalTownFamiliarityConversation(rec, ...rest) {
      const hiddenRanks = []; // Pre-threshold rapport-bond ranks are hidden only during synchronous recognition-candidate selection.
      for (const role of ROLES) {
        const entry = progression.activeEntryForRole?.(role); // Only active stable animals can be selected by the existing recognition conversation.
        const rank = entry ? number(progression.perkRank?.(entry, 'rapportBond'), 0) : 0; // Existing training rank is restored immediately after the call.
        if (!entry || isKnownByTown(entry) || rank < DIRECT_GREETING_RANK || !entry.animalPerks) continue;
        hiddenRanks.push([entry, entry.animalPerks.rapportBond]);
        entry.animalPerks.rapportBond = 0;
      }
      try { return originalBegin(rec, ...rest); }
      finally { for (const [entry, rank] of hiddenRanks) entry.animalPerks.rapportBond = rank; }
    };
    api.__stableAnimalTownFamiliarityConversationWrapped = true;
    return api;
  }

  function patchFarmAnimals(api) {
    if (!api || api.__stableAnimalTownFamiliarityFarmWrapped) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api); // Existing farm initialization loads the stable before Pet Rapport normalization runs.
      api.init = function stableAnimalTownFamiliarityFarmInit(deps, ...rest) {
        farmDeps = deps || null;
        const result = originalInit(deps, ...rest); // Canonical stable data must exist before old entries can initialize/migrate Pet Rapport.
        normalizeStable(true);
        return result;
      };
    }
    if (typeof api.addToStable === 'function') {
      const originalAdd = api.addToStable.bind(api); // Existing acquisition path creates the canonical new stable entry first.
      api.addToStable = function stableAnimalTownFamiliarityAdd(...args) {
        const result = originalAdd(...args);
        normalizeStable(true); // Newly obtained animals get explicit saved petRapport=0.
        return result;
      };
    }
    api.__stableAnimalTownFamiliarityFarmWrapped = true;
    return api;
  }

  function hookGlobal(name, patcher) {
    const current = window[name]; // Already-loaded globals are patched immediately; frozen APIs may return replacements.
    if (current) {
      const replacement = patcher(current) || current; // Replacement assignment preserves frozen-object compatibility.
      if (replacement !== current) window[name] = replacement;
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Existing future-global accessor chains from other modules are preserved.
    const oldGet = descriptor?.get; // Prior getter remains authoritative for resolving the assigned API.
    const oldSet = descriptor?.set; // Prior setter receives the assignment before Pet Rapport patches it.
    if (oldSet) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get: oldGet,
        set(value) {
          oldSet.call(window, value);
          const currentDescriptor = Object.getOwnPropertyDescriptor(window, name); // Prior setter may replace the accessor with a final data property.
          const resolved = oldGet ? oldGet.call(window) : (currentDescriptor && 'value' in currentDescriptor ? currentDescriptor.value : value);
          const replacement = patcher(resolved) || resolved; // Pet Rapport becomes the final wrapper layer.
          if (replacement && replacement !== resolved) {
            Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: replacement });
          }
        },
      });
      return;
    }
    let pending = null; // Temporary storage exists only until this not-yet-loaded global is assigned once.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return pending; },
      set(value) {
        pending = patcher(value) || value;
        Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: pending });
      },
    });
  }

  function getDebug() {
    return {
      installed: true,
      storageUnit: 'pet-rapport-points',
      pointsPerHeart: pointsPerHeart(),
      maxPetRapportHearts: MAX_PET_RAPPORT_HEARTS,
      maxPetRapport: maxPetRapportPoints(),
      nameKnownAtHearts: MAX_PET_RAPPORT_HEARTS,
      nameKnownAtPetRapport: maxPetRapportPoints(),
      depsReady: !!farmDeps,
      animals: stableEntries().map(entry => ({
        id: entry?.id || null,
        name: entry?.name || null,
        kind: entry?.kind || null,
        petRapport: getPetRapport(entry),
        petHearts: roundPoint(getPetHearts(entry)),
        knownByTown: isKnownByTown(entry),
      })),
      activeMultiplier: multiplierSnapshot(),
      recentAwards: awardTrace.map(entry => ({ ...entry })),
    };
  }

  async function copyDebug() {
    const text = JSON.stringify(getDebug(), null, 2); // Clipboard snapshot supports the user's mobile diagnostics workflow without a console.
    try {
      await navigator.clipboard?.writeText?.(text);
      farmDeps?.showToast?.('Pet Rapport debug copied.', true);
      return true;
    } catch (_) {
      window.prompt?.('Copy Pet Rapport debug:', text);
      return false;
    }
  }

  let installed = false; // Install guard prevents duplicate wrapper layers when the farm bridge calls install more than once.
  function install() {
    if (installed) return api;
    installed = true;
    hookGlobal('FarmAnimals', patchFarmAnimals);
    hookGlobal('NpcRapport', patchNpcRapport);
    hookGlobal('AmbientDialogue', patchAmbientDialogue);
    hookGlobal('DialogueContent', patchDialogueContent);
    return api;
  }

  const api = {
    installed: true,
    install,
    normalizeEntry,
    getPetRapport,
    getPetHearts,
    maxPetRapportPoints,
    maxPetRapportHearts: MAX_PET_RAPPORT_HEARTS,
    pointsPerHeart,
    isKnownByTown,
    awardPetRapport,
    awardAttributedRapport,
    genericizeAnimalName,
    getDebug,
    copyDebug,
  }; // Public helpers intentionally support later NPC treats/perks without touching internals.
  window.StableAnimalTownFamiliarity = api;
})();

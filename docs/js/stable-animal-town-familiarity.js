(() => {
  'use strict';

  const progression = window.StableAnimalProgression; // Existing progression API supplies active animals and rapport-perk contribution math.
  if (!progression || window.StableAnimalTownFamiliarity?.installed) return;

  const MAX_FAVOR = 10; // Saved whole-town familiarity cap for each stable animal.
  const NAME_THRESHOLD = 10; // One authority for when townspeople may use the animal's player-given name.
  const DIRECT_GREETING_RANK = 3; // Mirrors the existing direct animal greeting/recognition training threshold.
  const PET_GREETING_PREFIX = 'pet_greeting:'; // Existing rapport reason prefix identifies Rapport created directly by an animal greeting.
  const ROLES = Object.freeze(['companion', 'mount', 'shoulderPet']); // Shared active-role order used by attribution and dialogue targeting.
  const TRACE_LIMIT = 24; // Small rolling attribution history supports mobile copy/paste diagnostics.

  let farmDeps = null; // Captured FarmAnimals dependencies provide the canonical stable array and saveStable().
  const awardTrace = []; // Recent familiarity gains are exposed through getDebug()/copyDebug().

  function number(value, fallback = 0) {
    const parsed = Number(value); // Parsed numeric value is reused by all clamping/attribution helpers.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampFavor(value) {
    return Math.max(0, Math.min(MAX_FAVOR, number(value, 0)));
  }

  function stableEntries() {
    const stable = farmDeps?.getStable?.(); // Existing stable collection remains the persistence owner; no parallel save store is introduced.
    return Array.isArray(stable) ? stable : [];
  }

  function normalizeEntry(entry) {
    if (!entry) return entry;
    const favor = clampFavor(entry.townFavor); // Old/new entries default to a bounded saved townFavor value.
    if (entry.townFavor !== favor) entry.townFavor = favor;
    return entry;
  }

  function normalizeStable(save = false) {
    let changed = false; // Indicates whether townFavor had to be initialized or repaired.
    for (const entry of stableEntries()) {
      const before = entry?.townFavor; // Previous value is compared to avoid needless stable saves.
      normalizeEntry(entry);
      if (before !== entry?.townFavor) changed = true;
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

  function getTownFavor(entryOrId) {
    const entry = typeof entryOrId === 'string' ? findEntry(entryOrId) : entryOrId; // Public helper accepts either an entry object or stable id.
    return entry ? normalizeEntry(entry).townFavor : 0;
  }

  function isKnownByTown(entryOrId) {
    return getTownFavor(entryOrId) >= NAME_THRESHOLD;
  }

  function awardTownFavor(entryOrId, amount, reason = 'presence', details = {}) {
    const entry = typeof entryOrId === 'string' ? findEntry(entryOrId) : entryOrId; // Familiarity is stored directly on the canonical stable entry.
    const requested = Math.max(0, number(amount, 0)); // Negative/invalid Rapport never lowers town familiarity.
    if (!entry || requested <= 0) return 0;
    const before = getTownFavor(entry); // Previous favor determines the actual clamped gain.
    const after = clampFavor(before + requested); // Whole-town familiarity is permanently capped at ten.
    const gained = after - before; // Actual gain is used by diagnostics and future treat/perk hooks.
    if (gained <= 0) return 0;
    entry.townFavor = Math.round(after * 1000) / 1000;
    farmDeps?.saveStable?.();
    const trace = { at: Date.now(), animalId: entry.id, delta: Math.round(gained * 1000) / 1000, townFavor: entry.townFavor, reason, ...details }; // Compact non-saved event record supports mobile debugging.
    awardTrace.push(trace);
    if (awardTrace.length > TRACE_LIMIT) awardTrace.splice(0, awardTrace.length - TRACE_LIMIT);
    window.__farmLog?.(`[pet-town-favor] ${entry.id} +${gained.toFixed(3)} from ${reason}; now ${entry.townFavor}/${MAX_FAVOR}.`, 'farm');
    return gained;
  }

  function multiplierSnapshot() {
    const details = progression.rapportMultiplierDetails?.() || {}; // Existing progression helper already knows which present animals create each bonus slice.
    const multiplier = Math.max(1, number(details.multiplier, 1)); // Combined multiplier is needed when NPC Rapport clips at its cap.
    const contributors = Array.isArray(details.details) ? details.details : []; // Each contributor exposes stable id plus additive multiplier share.
    return { multiplier, contributors };
  }

  function awardAttributedRapport(rawAmount, actualRapport, source) {
    const base = number(rawAmount, NaN); // Unmultiplied Rapport request is the counterfactual baseline for attribution.
    const actual = number(actualRapport, 0); // Existing NpcRapport.adjust return value is Rapport actually obtained after clamping.
    if (!Number.isFinite(base) || base <= 0 || actual <= 0) return [];
    const snapshot = multiplierSnapshot(); // Same current active-pet math used by StableAnimalProgression's Rapport wrapper.
    const intended = base * snapshot.multiplier; // Intended post-perk Rapport lets clipped gains scale proportionally.
    const capScale = intended > 0 ? Math.max(0, Math.min(1, actual / intended)) : 0; // Only Rapport the NPC actually obtained may become familiarity.
    const sourceText = String(source || ''); // Existing reason string may identify a direct animal greeting.
    const sourceId = sourceText.startsWith(PET_GREETING_PREFIX) ? sourceText.slice(PET_GREETING_PREFIX.length) : ''; // Direct greeting base Rapport belongs to that animal.
    const claims = new Map(); // Stable id -> pre-cap Rapport attributable to that animal's presence.

    for (const detail of snapshot.contributors) {
      const animalId = String(detail?.id || ''); // Contributor stable id identifies whose rapport perk created the bonus.
      const add = Math.max(0, number(detail?.add, 0)); // Additive multiplier share converts to `base * add` attributable Rapport.
      if (animalId && add > 0) claims.set(animalId, (claims.get(animalId) || 0) + base * add);
    }
    if (sourceId) claims.set(sourceId, (claims.get(sourceId) || 0) + base);

    const awards = []; // Returned attribution list is test/debug data only; NpcRapport callers still receive their original return value.
    for (const [animalId, claim] of claims) {
      const attributed = claim * capScale; // Contributor's share is reduced proportionally when NPC Rapport was capped.
      const gained = awardTownFavor(animalId, attributed, sourceId === animalId ? 'pet-greeting-rapport' : 'rapport-perk-bonus', { npcRapportSource: sourceText, rawAmount: base, actualRapport: actual, capScale: Math.round(capScale * 1000) / 1000 }); // Existing save path records the resulting familiarity.
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
    Object.defineProperty(wrapper, 'adjust', { configurable: true, enumerable: true, value(npcId, amount, source) {
      const result = originalAdjust(npcId, amount, source); // Original Rapport delta/return contract is preserved exactly.
      awardAttributedRapport(amount, result, source);
      return result;
    } });
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
      if ((actor.master || player) !== player || (area && actor.areaId && actor.areaId !== area) || actor.avatarRef?.group?.visible === false) continue;
      return actor;
    }
    return null;
  }

  function animalForTarget(options) {
    const root = options?.faceTarget?.root; // Existing animal reactions expose their addressee through faceTarget.root.
    if (!root) return null;
    for (const role of ROLES) {
      const entry = progression.activeEntryForRole?.(role); // Stable entry supplies saved name/species/familiarity.
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
    const name = String(entry?.name || '').trim(); // Player-given name is suppressed until whole-town familiarity reaches ten.
    if (!name || isKnownByTown(entry)) return String(text || '');
    const species = speciesLabel(entry); // Species label remains usable in pre-recognition authored/fallback lines.
    const matcher = new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(name)})(?=$|[^A-Za-z0-9_])`, 'g'); // Token boundaries avoid replacing short names inside unrelated words.
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
      const originalInit = api.init.bind(api); // Existing farm initialization loads the stable before familiarity normalization runs.
      api.init = function stableAnimalTownFamiliarityFarmInit(deps, ...rest) {
        farmDeps = deps || null;
        const result = originalInit(deps, ...rest); // Canonical stable data must exist before old entries can default to zero.
        normalizeStable(true);
        return result;
      };
    }
    if (typeof api.addToStable === 'function') {
      const originalAdd = api.addToStable.bind(api); // Existing acquisition path creates the canonical new stable entry first.
      api.addToStable = function stableAnimalTownFamiliarityAdd(...args) {
        const result = originalAdd(...args);
        normalizeStable(true); // Newly obtained animals get an explicit saved townFavor=0.
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
    const oldSet = descriptor?.set; // Prior setter receives the assignment before familiarity patches it.
    if (oldSet) {
      Object.defineProperty(window, name, { configurable: true, enumerable: descriptor.enumerable !== false, get: oldGet, set(value) {
        oldSet.call(window, value);
        const resolved = oldGet ? oldGet.call(window) : window[name]; // Fully resolved dependency includes earlier wrapper layers.
        const replacement = patcher(resolved) || resolved; // Familiarity becomes the final wrapper layer.
        if (replacement && replacement !== resolved) Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: replacement });
      } });
      return;
    }
    let pending = null; // Temporary storage exists only until this not-yet-loaded global is assigned once.
    Object.defineProperty(window, name, { configurable: true, enumerable: true, get() { return pending; }, set(value) {
      pending = patcher(value) || value;
      Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: pending });
    } });
  }

  function getDebug() {
    return { installed: true, maxTownFavor: MAX_FAVOR, nameKnownAt: NAME_THRESHOLD, depsReady: !!farmDeps, animals: stableEntries().map(entry => ({ id: entry?.id || null, name: entry?.name || null, kind: entry?.kind || null, townFavor: getTownFavor(entry), knownByTown: isKnownByTown(entry) })), activeMultiplier: multiplierSnapshot(), recentAwards: awardTrace.map(entry => ({ ...entry })) };
  }

  async function copyDebug() {
    const text = JSON.stringify(getDebug(), null, 2); // Clipboard snapshot supports the user's mobile diagnostics workflow without a console.
    try { await navigator.clipboard?.writeText?.(text); farmDeps?.showToast?.('Pet familiarity debug copied.', true); return true; }
    catch (_) { window.prompt?.('Copy pet familiarity debug:', text); return false; }
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

  const api = { installed: true, install, normalizeEntry, getTownFavor, isKnownByTown, awardTownFavor, awardAttributedRapport, genericizeAnimalName, getDebug, copyDebug }; // Public helpers intentionally support later town treats/perks without touching internals.
  window.StableAnimalTownFamiliarity = api;
  window.__stableAnimalTownFamiliarityDebug = getDebug;
})();

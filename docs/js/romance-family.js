// Children after marriage (builds on js/romance-system.js's spouse state).
//
// 3 months after the wedding (and then on a recurring six-month birth cadence):
//   • you male + spouse female, same species → spouse announces a pregnancy
//     (Kenkari: an egg, and the spouse stays in bed with it until it hatches)
//   • you female + spouse male, same species → you feel sick, bloated, and
//     throw up (Kenkari: you lay an egg, and your spouse stays in bed with it)
//   • any other pairing → nothing yet (see the dream below)
// The first time you sleep in your farmhouse bed 4 months after the wedding:
//   • an egg hatches / a baby is born — case 1 babies mix both parents'
//     colors, case 2 babies take colors near their same-gender parent
//   • otherwise you dream of your child (species, gender and colors), and
//     on waking Father Hunundi is outside with an orphan from a bandit raid
// Every newborn is named, sleeps a month in a baby basket in the house, then
// toddles (Toddling Footing eases 99 → 0 over 5 months, no visible bars),
// as a toddler works slowly on the farm or a squeezer, then walks normally,
// visits town, greets you, and develops their single shared usefulness level.
(() => {
  'use strict';
  if (window.RomanceFamily) return;

  const FRAME_ID = 'romance-family-toddlers'; // RuntimeFrameScheduler id for toddler wobble presentation (enabled only while a toddler is visible).
  let R = null; // RomanceSystem API
  let H = null; // RomanceSystem.helpers
  let fam = defaultFamily();
  const spawning = new Set(); // child ids whose walker build is in flight
  const vatWorkerPoses = new Map(); // Active vat ID → live child pose; never serialized.
  let lastRawDay = null;
  let announceTimers = [];
  let doorstepRegistered = false;
  let frameRegistered = false;
  let uiOverlay = null;
  let pendingBabyPromptScheduled = false; // Prevents the lifecycle tick from racing an already queued birth/naming overlay.
  let registeredSocialGraph = null; // Previously linked social graph, used to detect world changes.
  let registeredChildFriends = ''; // Signature of world-specific NPC friendship links, avoids work each tick.

  function defaultFamily() {
    return { pregnancy: null, children: [], pendingAdoption: null, pendingBaby: null, spouseUsefulness: null, farmChores: { livestock: '', processing: {} } };
  }
  const cfg = () => H?.cfg?.()?.family || {};
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const deps = () => H?.deps?.() || {};
  const basketDays = () => num(cfg().basketDays, 28);
  const toddlingDays = () => num(cfg().toddlingDays, 140);
  const usefulnessCfg = () => cfg().usefulness || {}; // Shared family-work tuning, used for levels, XP and product stars.
  const workActions = () => usefulnessCfg().jobXp || {};
  function workProfileFor(workerId) {
    const spouse = R?.getSpouse?.();
    if (spouse?.npcId === workerId) {
      if (fam.spouseUsefulness?.npcId !== workerId) fam.spouseUsefulness = { npcId: workerId, level: Math.max(1, num(usefulnessCfg().adultStartLevel, 2)), xp: 0 }; // One saved stat per spouse.
      if (!(num(fam.spouseUsefulness.level, 0) >= 1)) fam.spouseUsefulness.level = Math.max(1, num(usefulnessCfg().adultStartLevel, 2)); // Repair malformed/legacy ranks before awarding work XP.
      if (!(num(fam.spouseUsefulness.xp, -1) >= 0)) fam.spouseUsefulness.xp = 0;
      return { record: fam.spouseUsefulness, stage: 'adult', multiplier: num(usefulnessCfg().intelligenceXpMultiplier?.adult, 1) };
    }
    const child = fam.children.find(entry => entry.id === workerId);
    if (!child) return null;
    const phase = phaseOf(child);
    if (phase === 'basket') return null;
    if (!(num(child.usefulnessLevel, 0) >= 1)) child.usefulnessLevel = Math.max(1, num(usefulnessCfg().youngStartLevel, 1));
    if (!(num(child.usefulnessXp, -1) >= 0)) child.usefulnessXp = 0;
    return { record: child, stage: phase, multiplier: num(usefulnessCfg().intelligenceXpMultiplier?.[phase], phase === 'toddler' ? 0.25 : 0.5) };
  }
  function usefulnessInfo(workerId) {
    const profile = workProfileFor(workerId);
    if (!profile) return null;
    const { record, stage, multiplier } = profile;
    const level = num(stage === 'adult' ? record.level : record.usefulnessLevel, stage === 'adult' ? 2 : 1);
    const xp = num(stage === 'adult' ? record.xp : record.usefulnessXp, 0);
    return { level, xp, nextLevelXp: Math.max(1, num(usefulnessCfg().xpPerLevelFactor, 40)) * level * level, stage, intelligenceMultiplier: multiplier };
  }
  // One saved usefulness XP pool; infants accumulate experience but cannot perform jobs.
  const BABY_OBSERVATION_XP_RATE = 0.01; // Share of actual player skill XP while back-stowed.
  let unsubscribeObservationXp = null; // One subscription across family reinitialization.
  let lastUsefulnessPopup = null; // Latest attempted award, exposed through the existing family mobile diagnostics.
  function presentUsefulnessGain(id, gain) {
    if (!(gain > 0)) return;
    const walker = H?.findWalker?.(id);
    const carried = window.FamilyBabyAmbientVoice?.anchorFor?.(id); // Use the real visible arms/back proxy rather than its hidden walker.
    const root = carried?.group || walker?.root;
    const shown = window.WorldPopupText?.showFamilyUsefulness?.(root, gain) === true;
    lastUsefulnessPopup = { id, gain, shown };
    window.FarmPanel?.refreshVisibleFamilyProgress?.(); // Event-driven only; no frame loop or closed-menu rendering.
  }
  function awardObservationXp(event) {
    if (!H?.rawDay) return; // Progression can fire before the family system has initialized.
    const gain = Number(event?.amount) * BABY_OBSERVATION_XP_RATE;
    if (!Number.isFinite(gain) || gain <= 0) return;
    const id = window.Shattercasks?.backCarriedInfo?.()?.id;
    if (!id) return;
    const child = fam.children.find(c => ['basket', 'toddler'].includes(phaseOf(c)) && id === 'family_baby_' + c.id);
    if (!child) return;
    const maxLevel = Math.max(1, Math.floor(num(usefulnessCfg().maxLevel, 5)));
    child.usefulnessLevel = clamp(Math.floor(num(child.usefulnessLevel, 1)), 1, maxLevel);
    if (child.usefulnessLevel >= maxLevel) return; // Maxed babies need no repeated saves.
    const previousLevel = child.usefulnessLevel, previousXp = Math.max(0, num(child.usefulnessXp, 0));
    child.usefulnessXp = previousXp + gain;
    while (child.usefulnessLevel < maxLevel) {
      const threshold = Math.max(1, num(usefulnessCfg().xpPerLevelFactor, 40)) * child.usefulnessLevel ** 2;
      if (child.usefulnessXp < threshold) break;
      child.usefulnessXp -= threshold;
      child.usefulnessLevel++;
      H.toast(`⭐ ${child.name} reached usefulness level ${child.usefulnessLevel}!`, true);
    }
    if (child.usefulnessLevel >= maxLevel) child.usefulnessXp = 0;
    presentUsefulnessGain(child.id, appliedUsefulnessGain(previousLevel, previousXp, child.usefulnessLevel, child.usefulnessXp));
    // Family XP is world-member data, not character skill metadata; coalesce writes with the existing idle-save queue.
    if (deps().scheduleMemberSave) deps().scheduleMemberSave(); else H.persist();
  }
  function appliedUsefulnessGain(beforeLevel, beforeXp, afterLevel, afterXp) {
    let gain = afterXp - beforeXp;
    const factor = Math.max(1, num(usefulnessCfg().xpPerLevelFactor, 40));
    for (let level = beforeLevel; level < afterLevel; level++) gain += factor * level * level;
    return Math.max(0, gain); // Report actual accepted XP, including level-up carryover but excluding overflow at cap.
  }
  function awardWork(workerId, action) {
    const profile = workProfileFor(workerId);
    if (!profile || !Object.prototype.hasOwnProperty.call(workActions(), action)) return null;
    const { record, stage, multiplier } = profile;
    const levelKey = stage === 'adult' ? 'level' : 'usefulnessLevel';
    const xpKey = stage === 'adult' ? 'xp' : 'usefulnessXp';
    const maxLevel = Math.max(1, Math.floor(num(usefulnessCfg().maxLevel, 5)));
    if (record[levelKey] >= maxLevel) return usefulnessInfo(workerId);
    const previousLevel = record[levelKey], previousXp = Math.max(0, num(record[xpKey], 0));
    record[xpKey] = previousXp + Math.max(0, num(workActions()[action], 0)) * Math.max(0, multiplier);
    while (record[levelKey] < maxLevel) {
      const threshold = Math.max(1, num(usefulnessCfg().xpPerLevelFactor, 40)) * record[levelKey] * record[levelKey];
      if (record[xpKey] < threshold) break;
      record[xpKey] -= threshold;
      record[levelKey] += 1;
      H.toast(`⭐ ${stage === 'adult' ? H.npcName(workerId) : record.name} reached usefulness level ${record[levelKey]}!`, true);
    }
    if (record[levelKey] >= maxLevel) record[xpKey] = 0;
    presentUsefulnessGain(workerId, appliedUsefulnessGain(previousLevel, previousXp, record[levelKey], record[xpKey]));
    H.persist();
    return usefulnessInfo(workerId);
  }
  function rollWorkQuality(workerId) {
    const info = usefulnessInfo(workerId);
    if (!info) return null;
    const rank = Math.max(1, Math.min(5, Math.floor(info.level)));
    if (rank === 1) return 1; // New children genuinely average 1★ instead of being lifted by a lower clamp.
    const roll = window.GameRandom?.random?.() ?? Math.random();
    return clamp(rank + (roll < 0.2 ? -1 : roll >= 0.8 ? 1 : 0), 1, 5); // Level two averages exactly 2★.
  }

  // ── Pairing / case resolution ─────────────────────────────────────────
  function isEggLayer(speciesId) { return (cfg().eggLayingSpecies || ['kenkari']).includes(speciesId); }
  function resolveKind(spouseId) {
    const you = H.playerAppearance();
    const them = H.npcAppearance(spouseId);
    const sameSpecies = !!you.speciesId && you.speciesId === them.speciesId;
    if (sameSpecies && you.gender === 'male' && them.gender === 'female') return isEggLayer(them.speciesId) ? 'spouse_egg' : 'spouse_live';
    if (sameSpecies && you.gender === 'female' && them.gender === 'male') return isEggLayer(you.speciesId) ? 'player_egg' : 'player_live';
    return 'adoption';
  }
  function ensurePlan() {
    const spouse = R.getSpouse();
    if (!spouse) return null;
    const existingChildren = fam.children.filter(child => child.otherParentId === spouse.npcId); // Existing children count toward a per-marriage limit.
    const childLimit = Math.floor(num(cfg().maxChildrenPerMarriage, 0));
    if (childLimit > 0 && existingChildren.length >= childLimit) return null;
    if (fam.pendingAdoption || fam.pendingBaby || (fam.pregnancy?.spouseId === spouse.npcId && (!fam.pregnancy.born || fam.pregnancy.awaitingChild))) return fam.pregnancy;
    const firstWeddingDay = num(spouse.marriedRawDay, H.rawDay());
    const latestBirth = existingChildren.length ? Math.max(...existingChildren.map(child => num(child.bornRawDay, 0))) : null;
    const firstDue = firstWeddingDay + num(cfg().birthAfterDays, 112);
    const nextDue = latestBirth == null ? firstDue : Math.max(firstDue, latestBirth + Math.max(1, num(cfg().birthSpacingDays, 168)));
    const conceptionDay = nextDue - num(cfg().birthAfterDays, 112); // Subsequent pregnancies are delayed until their own spaced due day.
    fam.pregnancy = {
      spouseId: spouse.npcId,
      kind: resolveKind(spouse.npcId),
      announceRawDay: conceptionDay + num(cfg().announceAfterDays, 84),
      dueRawDay: nextDue,
      announced: false,
      born: false,
    };
    H.persist();
    return fam.pregnancy;
  }
  function spouseHoldingEgg() {
    const p = fam.pregnancy;
    return !!p && p.announced && !p.born && (p.kind === 'spouse_egg' || p.kind === 'player_egg');
  }

  // ── Colors ────────────────────────────────────────────────────────────
  function jitter(color, amount = 1) {
    const c = color || { h: 0, s: -0.5, v: -0.3 };
    const r = () => (Math.random() * 2 - 1) * amount;
    return { h: Math.round(num(c.h) + r() * 6), s: clamp(num(c.s) + r() * 0.05, -1, 1), v: clamp(num(c.v) + r() * 0.05, -1, 1) };
  }
  function mixedColors(a, b) {
    const out = {};
    for (const channel of ['A', 'B', 'C']) {
      const pick = Math.random() < 0.5 ? a?.[channel] : b?.[channel];
      out[channel] = jitter(pick || a?.[channel] || b?.[channel]);
    }
    return out;
  }
  function nearColors(source) {
    const out = {};
    for (const channel of ['A', 'B', 'C']) out[channel] = jitter(source?.[channel], 0.6);
    return out;
  }
  function babyFromParents(kind) {
    const you = H.playerAppearance();
    const them = H.npcAppearance(fam.pregnancy.spouseId);
    const gender = Math.random() < 0.5 ? 'male' : 'female';
    const speciesId = you.speciesId || them.speciesId || 'mao-ao';
    let bodyColors;
    if (kind === 'spouse_live' || kind === 'spouse_egg') bodyColors = mixedColors(you.bodyColors, them.bodyColors);
    else bodyColors = nearColors(gender === you.gender ? you.bodyColors : them.bodyColors); // Sexual dimorphism: colors near the same-gender parent.
    return { speciesId, gender, bodyColors };
  }

  // ── Announcements (3 months) ──────────────────────────────────────────
  function clearAnnounceTimers() { announceTimers.forEach(clearTimeout); announceTimers = []; }
  function maybeAnnounce() {
    const p = fam.pregnancy;
    if (!p || p.announced || H.rawDay() < p.announceRawDay) return;
    const d = deps();
    if (d.isDialogueOpen?.()) return;
    const spouseName = H.npcName(p.spouseId);
    if (p.kind === 'adoption') { p.announced = true; H.persist(); return; }
    if (p.kind === 'spouse_live' || p.kind === 'spouse_egg') {
      const walker = H.findWalker(p.spouseId);
      const player = d.getPlayerTilePosition?.();
      const area = d.normalizeNpcArea?.(d.getCurrentArea?.());
      if (!walker || !player || walker.area !== area) return;
      if (Math.hypot(walker.root.position.x - player.x, walker.root.position.z - player.z) > 4) return;
      p.announced = true;
      H.persist();
      const steps = p.kind === 'spouse_live'
        ? [
            { text: 'Come here a moment… I have something to tell you.' },
            { text: "I'm pregnant. We're going to have a baby!", expression: 'smile', choices: [{ label: "That's wonderful!", goto: 'end' }] },
          ]
        : [
            { text: 'You need to see this — look!' },
            { text: "I laid an egg this morning! I'm going to keep it warm in our bed until it hatches. One month, maybe.", expression: 'smile', choices: [{ label: 'Our egg!', goto: 'end' }] },
          ];
      H.converse(walker, steps);
      return;
    }
    p.announced = true;
    H.persist();
    clearAnnounceTimers();
    if (p.kind === 'player_live') {
      H.toast("You're feeling kind of sick… and bloated.", false);
      announceTimers.push(setTimeout(() => H.toast('🤢 …and then you throw up.', false), 2600));
      announceTimers.push(setTimeout(() => H.toast(`🍼 Could it be? You're expecting a child with ${spouseName}!`, true), 5600));
    } else {
      H.toast(`🥚 You've laid an egg! ${spouseName} tucks it into bed and refuses to leave its side.`, true);
    }
  }

  // ── Births (first farmhouse sleep after the one-month pregnancy) ──────
  function onTimePassage(event) {
    const detail = event?.detail || {};
    if (detail.kind !== 'sleep') return;
    const p = fam.pregnancy;
    if (!p || p.born || H.rawDay() < p.dueRawDay) return;
    if (p.kind === 'adoption' && H.rawDay() < num(p.nextDreamRawDay, p.dueRawDay)) return; // Save-compatible deferred dream.
    if (deps().getCurrentArea?.() !== 'interior') return; // Only sleeping in your own farmhouse bed counts.
    if (!p.announced) p.announced = true;
    const spouseName = H.npcName(p.spouseId);
    if (p.kind === 'adoption') {
      setTimeout(() => { if (fam.pregnancy === p && !p.born) openDreamDecision(); }, 900);
      return;
    }
    p.born = true;
    p.awaitingChild = true; // Prevents creating a new pregnancy while the birth naming UI is unresolved.
    const baby = babyFromParents(p.kind);
    fam.pendingBaby = { ...baby, bornRawDay: H.rawDay(), origin: p.kind.endsWith('egg') ? 'egg' : 'birth', otherParentId: p.spouseId }; // Save-safe pending newborn and exact birthday, resumed after reload.
    const message = {
      spouse_egg: 'The egg hatched in the night!',
      player_egg: 'Your egg hatched in the night!',
      spouse_live: `${spouseName} gave birth in the night!`,
      player_live: 'You unexpectedly gave birth in the night!',
    }[p.kind];
    H.persist();
    pendingBabyPromptScheduled = true;
    setTimeout(() => {
      pendingBabyPromptScheduled = false;
      H.toast(`👶 ${message}`, true);
      if (fam.pendingBaby && !uiOverlay) promptPendingBaby();
    }, 900);
  }

  // Father Hunundi waits outside with the dreamt child (DoorstepVisits).
  function registerDoorstep() {
    if (doorstepRegistered || !window.DoorstepVisits?.registerProvider) return;
    doorstepRegistered = true;
    window.DoorstepVisits.registerProvider({
      id: 'romance_adoption',
      priority: 90,
      next() {
        if (!fam.pendingAdoption) return null;
        const officiant = H.cfg().officiantNpcId || 'father_hunundi_hodu';
        const lines = [
          'Good {{timeOfDay}}, {{playerHonorific}}. Forgive the early call — I have someone with me.',
          'Bandits raided a homestead out past the hills. This little one was the only soul we found alive.',
          `I can think of no better home than yours and ${H.npcName(fam.pendingAdoption.spouseId)}'s. Will you raise them?`,
        ];
        const nodes = lines.map((text, index) => ({
          id: `romance_adoption_${index + 1}`, type: 'text', text, expression: index === 2 ? 'smile' : 'neutral', expressionHold: 2, revealSpeed: 'normal',
          next: index + 1 < lines.length ? `romance_adoption_${index + 2}` : null,
        }));
        return { key: 'romance_adoption', npcId: officiant, tree: { id: 'doorstep_romance_adoption', label: 'Doorstep — Orphan', trigger: 'interact', priority: 99, visibility: 'any', entryNode: nodes[0].id, nodes } };
      },
      onComplete() {
        const pending = fam.pendingAdoption;
        if (!pending) return true;
        fam.pendingAdoption = null;
        fam.pendingBaby = { ...pending, bornRawDay: H.rawDay(), origin: 'adopted', otherParentId: pending.spouseId }; // Arrival date and naming survive save/reload.
        H.persist();
        pendingBabyPromptScheduled = true;
        setTimeout(() => { pendingBabyPromptScheduled = false; if (fam.pendingBaby && !uiOverlay) promptPendingBaby(); }, 300);
        return true;
      },
    });
  }

  // ── Children ──────────────────────────────────────────────────────────
  function ageDays(child) { return Math.max(0, H.rawDay() - num(child.bornRawDay, H.rawDay())); }
  function phaseOf(child) {
    const age = ageDays(child);
    if (age < basketDays()) return 'basket';
    if (age < basketDays() + toddlingDays()) return 'toddler';
    if (age < Math.max(basketDays() + toddlingDays(), num(cfg().independentAfterDays, 168))) return 'toddler';
    return 'child';
  }
  function voiceAgePhase(npcId) {
    if (!H?.rawDay) return null; // Saved family ages are unavailable until the family system has initialized.
    const child = fam.children.find(entry => entry.id === npcId); // Only a recognized family child can override a generic NPC's authored age band.
    if (!child) return null;
    const phase = phaseOf(child); // Share the existing day-accurate basket/toddler/child transition.
    return phase === 'basket' ? 'baby' : phase;
  }
  function isBasketBaby(npcId) {
    const child = fam.children.find(entry => entry.id === npcId); // Saved family age is authoritative for follower commands.
    return !!child && phaseOf(child) === 'basket';
  }
  function isCarryFollowing(id) {
    const child = fam.children.find(entry => entry.id === id); // Only active carry/follow ownership, not age or speech.
    return !!child && (phaseOf(child) === 'basket' || phaseOf(child) === 'toddler') && !!(child.carryBy || child.followPlayer || window.FamilyBabyBurdens?.isProxyActive?.(id));
  }
  function isProtectedFamilyChild(id) {
    const child = fam.children.find(entry => entry.id === id); // Carry protection does not change toddler speech or ordinary development.
    if (!child) return false;
    const phase = phaseOf(child);
    return phase === 'basket' || window.FamilyBabyBurdens?.isProxyActive?.(id) === true
      || (phase === 'toddler' && !!(child.carryBy || child.followPlayer));
  }
  function isFamilyWorkUnavailable(id) { return isProtectedFamilyChild(id); }
  function familyProgress() {
    const maxLevel = Math.max(1, Math.floor(num(usefulnessCfg().maxLevel, 5)));
    const spouse = R?.getSpouse?.(), rows = [];
    if (spouse?.npcId) rows.push({ id: spouse.npcId, name: H?.npcName?.(spouse.npcId) || spouse.npcId, role: 'Spouse', ...usefulnessInfo(spouse.npcId), maxLevel });
    for (const child of fam.children) {
      const phase = phaseOf(child);
      const info = usefulnessInfo(child.id) || { level: num(child.usefulnessLevel, 1), xp: num(child.usefulnessXp, 0),
        nextLevelXp: Math.max(1, num(usefulnessCfg().xpPerLevelFactor, 40)) * num(child.usefulnessLevel, 1) ** 2 };
      rows.push({ id: child.id, name: child.name, role: phase === 'basket' ? 'Baby' : phase === 'toddler' ? 'Toddler' : 'Child',
        ...info, maxLevel, vatId: child.vatId || null, carrying: child.carryBy || null, following: !!child.followPlayer });
    }
    return rows;
  }
  function retargetProcessingAssignment(oldId, newId) {
    const assignments = fam.farmChores?.processing;
    if (!assignments || !Object.prototype.hasOwnProperty.call(assignments, oldId) || oldId === newId) return false;
    const assignment = assignments[oldId];
    delete assignments[oldId];
    if (newId) assignments[newId] = assignment;
    window.NpcFarmPlots?.invalidateFamilyChores?.(); H?.persist?.(); return true;
  }
  function familyChores() { return fam.farmChores || null; } // Saved assignments belong to the family, not the map.
  function setFamilyChore(kind, stationId, workerId, inputKey = '') {
    if (workerId && !workProfileFor(workerId)) return false;
    if (!fam.farmChores || typeof fam.farmChores !== 'object') fam.farmChores = { livestock: '', processing: {} };
    if (kind === 'livestock') fam.farmChores.livestock = workerId || '';
    else if (kind === 'processing') {
      if (!window.FarmProduction?.isFamilyStation?.(stationId, inputKey)) return false;
      if (!fam.farmChores.processing || typeof fam.farmChores.processing !== 'object') fam.farmChores.processing = {};
      if (!workerId && !inputKey) delete fam.farmChores.processing[stationId];
      else fam.farmChores.processing[stationId] = { workerId: workerId || '', inputKey: inputKey || '' };
    } else return false;
    window.NpcFarmPlots?.invalidateFamilyChores?.(); H.persist(); return true;
  }
  function releaseCarryFollow(id) {
    const child = fam.children.find(entry => entry.id === id);
    if (!child || phaseOf(child) !== 'toddler' || child.carryBy || !child.followPlayer) return false;
    child.followPlayer = false; child.carrySpot = null;
    window.FamilyBabyFollow?.clearWalker?.(walkerFor(child)); H.persist(); return true;
  }
  function babyAmbientSound(npcId, random = Math.random) {
    return window.FamilyBabyAmbientVoice?.sound?.(npcId, isBasketBaby(npcId), cfg(), random) || null; // Voice module owns phonetics, family owns saved age.
  }
  function syncChildAmbientGreetings(child) {
    return window.FamilyBabyAmbientVoice?.sync?.(child.id, phaseOf(child), cfg()); // Single narrow age-stage notification.
  }
  // 99 (barely any usable Footing) → 0 over the toddling span. Hidden: children have no resource bars.
  function toddlingFooting(child) {
    if (phaseOf(child) !== 'toddler') return phaseOf(child) === 'basket' ? 99 : 0;
    const progress = (ageDays(child) - basketDays()) / Math.max(1, toddlingDays());
    return Math.round(99 * clamp(1 - progress, 0, 1));
  }
  function phaseScaleFields(phase) {
    const scales = cfg().phaseScales?.[phase];
    return scales ? { childBodyScale: scales.height ?? scales.body, childBodyHeightScale: scales.height ?? scales.body, childBodyWidthScale: scales.width ?? scales.body, childHeadScale: scales.head, childWidthConvergence: scales.widthConvergence ?? 0, childHeightConvergence: scales.heightConvergence ?? 0 } : {}; // Both independent axes travel with family baby/toddler records.
  }
  function childRecord(child) {
    const phase = phaseOf(child); // Same stage identity for the portrait and any direct record consumer.
    const stage = phase === 'basket' ? 'baby' : phase;
    const api = window.HobunjiCharacterAgeRigConfig;
    const individual = api?.profileFor?.(stage,child.speciesId,child.gender);
    const adult = window.HobunjiCharacterRigScale?.scaleFor?.(child.speciesId,child.gender) || window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(child.speciesId,child.gender);
    const resolved = individual ? api.relativeProfile(individual,adult) : null;
    return {
      id: child.id,
      name: child.name,
      isChild: true,
      species: child.speciesId,
      gender: child.gender,
      appearance: { speciesId: child.speciesId, gender: child.gender, bodyColors: child.bodyColors, cosmetics: { ...(child.cosmetics || {}) } },
      equippedCosmetics: [...(child.equippedCosmetics || [])],
      appliedDyes: { ...(child.appliedDyes || {}) },
      role: 'child',
      homeId: 'farmhouse', // Keeps village children anchored to their farm household.
      tags: phaseOf(child) === 'child' ? ['child', 'family', 'villager'] : ['child', 'family'], // Join village activities only when old enough.
      childGrowthStage: stage, // Explicit phase for species/gender baked proportion lookup.
      ...phaseScaleFields(phase),
      ...(resolved ? {childBodyScale:resolved.height,childBodyHeightScale:resolved.height,childBodyWidthScale:resolved.width,childHeadScale:resolved.head,childWidthConvergence:0,childHeightConvergence:0} : {}),
      bio: `Your ${child.gender === 'female' ? 'daughter' : 'son'}.`,
      relationship: { canBefriend: true, canDate: false, canMarry: false, maxHearts: 10 },
      ambientGreetings: true, // Babies babble and toddlers have first words without a new speech loop.
      scheduleHooks: { rules: [] },
    };
  }
  function createChild({ name, speciesId, gender, bodyColors, cosmetics, equippedCosmetics, appliedDyes, origin, otherParentId, bornRawDay }) {
    const id = `child_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const child = {
      id, name: String(name || 'Little One').slice(0, 32), speciesId, gender, bodyColors,
      cosmetics: { ...(cosmetics || {}) }, equippedCosmetics: [...(equippedCosmetics || [])], appliedDyes: { ...(appliedDyes || {}) }, // Dream children keep every creator choice.
      origin, otherParentId, bornRawDay: Math.min(H.rawDay(), Math.max(0, num(bornRawDay, H.rawDay()))), basketId: null, vatId: null, // An interrupted naming prompt never makes a child younger.
      usefulnessLevel: Math.max(1, num(usefulnessCfg().youngStartLevel, 1)), usefulnessXp: 0, // Lifelong general work progression.
    };
    const placed = phaseOf(child) === 'basket' ? deps().furniture?.placeInteriorFixture?.('babyBasket') : null; // A delayed naming after toddlerhood must not displace furniture for a basket already outgrown.
    if (placed?.id) child.basketId = placed.id;
    if (placed?.stored) H.toast(`📦 Moved your ${placed.stored} into farm storage to make room for the baby basket.`, true);
    fam.children.push(child);
    if (fam.pregnancy?.spouseId === otherParentId) fam.pregnancy.awaitingChild = false; // The next plan can begin after naming/doorstep arrival.
    syncChildFriendships(); // Connects each new child to Gantami via the shared social graph.
    registerChildDialogue(child);
    H.toast(`👶 Welcome home, ${child.name}!`, true);
    window.HobunjiActivityEvents?.emit('child_born', { childId: id, origin });
    H.persist();
    return child;
  }

  function walkerFor(child) { return H.findWalker(child.id); }
  const spawnRetryAt = new Map(); // child id → earliest performance.now() for another build attempt after a failure.
  function ensureWalker(child) {
    if (walkerFor(child) || spawning.has(child.id) || !deps().spawnNpcRecord) return;
    if (performance.now() < num(spawnRetryAt.get(child.id), 0)) return;
    const target = childTarget(child);
    if (!target) return;
    spawning.add(child.id);
    Promise.resolve(deps().spawnNpcRecord(childRecord(child), target))
      .then(walker => { if (!walker && !walkerFor(child)) spawnRetryAt.set(child.id, performance.now() + 10000); })
      .catch(error => { spawnRetryAt.set(child.id, performance.now() + 10000); console.warn('[RomanceFamily] child spawn failed', child.id, error); })
      .finally(() => spawning.delete(child.id));
  }

  function basketObject(child) {
    return child.basketId ? (deps().getInteriorFurniture?.() || []).find(obj => obj.id === child.basketId) || null : null;
  }
  function interiorAnchor() {
    const bed = H.bedSpot();
    return bed ? { area: 'interior', c: bed.c, r: bed.r } : null;
  }
  function vatObject(child) {
    return child.vatId ? (window.DewVats?.listSqueezingVats?.() || []).find(obj => obj.id === child.vatId) || null : null;
  }

  function vatJobActive(vat) {
    const job = vat?.getJob?.(); // A pending real batch may start before the ordinary 08:00 shift.
    if (job?.kind !== 'timed') return false;
    const now = window.ItemProcessing?.gameHour?.(); // Offscreen processors may retain expired jobs until the farm is rendered again.
    return job.readyAtGameHour == null || !Number.isFinite(now)
      || !Number.isFinite(Number(job.readyAtGameHour)) || Number(job.readyAtGameHour) > now;
  }

  // The furniture timeline already resolves the animated sack surface, bounce,
  // and placement yaw for livestock. Children have a floor-relative rig root
  // rather than an animal shoulderGrip: put their feet on that same point.
  function vatPoseBlocked(child, walker) {
    const participant = 'npc:' + child.id; // Shared action-lock identity, including paired animations.
    return walker?.combatTutorialSuspended || window.FestivalWheelDanceRuntime?.isPartner?.(walker)
      || window.CharacterActionLocks?.isLocked?.(participant, 'pose')
      || window.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(child.id);
  }

  function canPoseVatWorker(child, walker, vatId) {
    const target = walker?.currentScheduleTarget; // Only an arrived worker on the matching chore may enter the animation.
    const root = walker?.root;
    const hour = H?.clockHour?.();
    return !!(child && child.vatId === vatId && !isFamilyWorkUnavailable(child.id)
      && deps().getCurrentArea?.() === 'farm'
      && walker?.area === 'farm' && root?.parent && root.visible !== false && !vatPoseBlocked(child, walker)
      && target?.area === 'farm' && target.vatId === vatId
      && Math.hypot(root.position.x - target.c - 0.5, root.position.z - target.r - 0.5) <= 0.35
      && ((hour >= 8 && hour < 18) || vatJobActive(vatObject(child))));
  }

  function clearVatWorkerPose(vatId) {
    const pose = vatWorkerPoses.get(vatId); // Owns the temporary render matrix, not the schedule position.
    if (!pose) return;
    vatWorkerPoses.delete(vatId);
    const root = pose.root; // Release the originally captured rig even if the walker has since rebuilt its root.
    root.removeEventListener?.('removed', pose.release);
    root.matrixAutoUpdate = true;
    root.updateMatrix();
    root.matrixWorldNeedsUpdate = true;
    pose.movementLock?.release?.(); // No held movement channel survives the batch or rig removal.
    pose.walker._npcScheduleDecision = null;
    if (pose.shadow) pose.shadow.visible = pose.shadowVisible;
    window.__farmLog?.(`[squeezing-vat] child ${pose.childId} released from ${vatId}`, 'info');
  }

  function setVatWorkerPose(vatId, targetMatrix, worker) {
    if (!worker?.familyWorker || !targetMatrix) { clearVatWorkerPose(vatId); return null; }
    const child = fam.children.find(entry => entry.id === worker.id);
    let pose = vatWorkerPoses.get(vatId); // Cached matrix/vector scratch for the active worker.
    const walker = H?.findWalker?.(worker.id);
    if (!canPoseVatWorker(child, walker, vatId)) {
      clearVatWorkerPose(vatId); pose = null;
      // The processor calls this only while a timed batch is running. Unlike
      // ordinary schedules, a short squeeze must not finish while its worker
      // is still walking out of the farmhouse or across the farm.
      if (!child || child.vatId !== vatId || phaseOf(child) === 'basket'
        || deps().getCurrentArea?.() !== 'farm' || !walker?.root || walker.root.visible === false
        || walker.root.matrixAutoUpdate === false
        || vatPoseBlocked(child, walker)) return null;
      const target = childTarget(child); // Reuse the same validated approach tile and active-shift policy.
      if (target?.vatId !== vatId || !window.NpcPathfinding?.teleportWalkerToTile?.(walker, 'farm', target)
        || !canPoseVatWorker(child, walker, vatId)) return null;
      window.__farmLog?.(`[squeezing-vat] child ${child.id} relocated to ${vatId}`, 'info');
    }
    const root = walker.root;
    if (pose && (pose.walker !== walker || pose.root !== root)) { clearVatWorkerPose(vatId); pose = null; }
    if (!pose) {
      if (!root.matrixAutoUpdate) return null; // Never take over another presentation's manual matrix.
      pose = { childId: child.id, walker, root, matrix: targetMatrix.clone(),
        position: root.position.clone(), quaternion: root.quaternion.clone(), scale: root.scale.clone(),
        shadow: walker.groundShadow, shadowVisible: walker.groundShadow?.visible,
        movementLock: window.CharacterActionLocks?.acquire?.({
          owner: 'child-vat', participants: ['npc:' + child.id], channels: ['movement'],
        }), // Keep the logical feet on the safe tile; the shared animation owns the visible hop.
        release: () => clearVatWorkerPose(vatId) };
      vatWorkerPoses.set(vatId, pose);
      root.addEventListener?.('removed', pose.release); // Despawn/area transfer releases the live rig before reparenting.
      root.matrixAutoUpdate = false;
      window.__farmLog?.(`[squeezing-vat] child ${child.id} stomping at ${vatId}`, 'info');
    }
    root.parent.updateWorldMatrix(true, false);
    pose.matrix.copy(root.parent.matrixWorld).invert().multiply(targetMatrix);
    pose.matrix.decompose(pose.position, pose.quaternion, pose.scale);
    // Use the animated contact position and rotation, but never inherit the
    // cloth/liquid mesh's squash scale. The child's own authored body scale
    // lives inside this root and remains intact.
    root.matrix.copy(pose.matrix.compose(pose.position, pose.quaternion, root.scale));
    root.matrixWorldNeedsUpdate = true;
    root.updateWorldMatrix?.(false, false); // Later NPC gaze and targeting systems see the current rendered root, not last frame's contact.
    if (walker.groundShadow) walker.groundShadow.visible = false;
    return worker;
  }

  function pruneVatWorkerPoses() {
    for (const [vatId, pose] of vatWorkerPoses) {
      const child = fam.children.find(entry => entry.id === pose.childId); // Only active jobs are examined.
      if (!canPoseVatWorker(child, pose.walker, vatId)
        || H.findWalker(pose.childId) !== pose.walker || pose.walker.root !== pose.root
        || !vatJobActive(vatObject(child))) clearVatWorkerPose(vatId);
    }
  }

  function retargetVatAssignments(oldVatId, newVatId) {
    if (!oldVatId || oldVatId === newVatId) return 0;
    clearVatWorkerPose(oldVatId);
    let changed = 0; // Count saved family assignments moved or removed with the physical processor.
    for (const child of fam.children) {
      if (child.vatId !== oldVatId) continue;
      child.vatId = newVatId || null;
      const walker = H?.findWalker?.(child.id);
      if (walker) walker._npcScheduleDecision = null; // Do not walk toward the previous tile for the rest of the schedule lease.
      changed++;
    }
    if (changed) H?.persist?.();
    return changed;
  }

  function childVisitDay(child) {
    const town = cfg().childTown || {}; // Tunable share of days/afternoons spent in town.
    const hour = H.clockHour();
    if (hour < num(town.startHour, 11) || hour >= num(town.endHour, 16)) return false;
    const chance = clamp(num(town.visitPercent, 65), 0, 100);
    return H.hashInt(`${child.id}:${H.rawDay()}:town-visit`) % 100 < chance; // Stable all day; no per-frame rerolls.
  }
  function childTownTarget(child) {
    if (!childVisitDay(child)) return null;
    const town = cfg().childTown || {};
    const friendIds = Array.isArray(town.friendNpcIds) ? town.friendNpcIds : ['gantami_ginju'];
    const childIds = new Set(fam.children.map(entry => entry.id)); // Siblings aren't moving anchors: prevents circular chasing.
    const peers = (deps().npcWalkers || []).filter(walker => walker?.area === 'town' && walker.root?.position && !childIds.has(walker.rec?.id)
      && (friendIds.includes(walker.rec?.id) || walker.rec?.isChild || walker.rec?.tags?.includes?.('child')))
      .sort((a, b) => String(a.rec.id).localeCompare(String(b.rec.id)));
    const preferred = peers.filter(walker => friendIds.includes(walker.rec.id));
    const roll = H.hashInt(`${child.id}:${H.rawDay()}:friend-visit`) % 100;
    const peerPool = preferred.length && roll < clamp(num(town.peerMeetPercent, 85), 0, 100) ? preferred : peers;
    if (peerPool.length) {
      const peer = peerPool[H.hashInt(`${child.id}:${H.rawDay()}:peer`) % peerPool.length];
      const pos = peer.root.position;
      const spot = H.nearestWalkable('town', Math.floor(pos.x) + 1, Math.floor(pos.z), 3);
      if (spot) return { area: 'town', c: spot.c, r: spot.r, activity: `playing with ${peer.rec.name || 'friends'}`,
        stationId: `family_child_peer_${child.id}_${peer.rec.id}`, wanderMode: 'radius', wanderRadiusTiles: Math.max(1, num(town.wanderRadiusTiles, 3)) };
    }
    const roles = Array.isArray(town.stationRoles) ? town.stationRoles : ['play', 'socialize', 'sit']; // Reuse known safe locations; don't invent town coordinates.
    const stations = roles.flatMap(role => window.NpcScheduling?.findStationsByRole?.(role, { area: 'town' }) || [])
      .filter(station => Number.isFinite(station.c) && Number.isFinite(station.r));
    if (!stations.length) return null; // When no town anchors exist, let the child safely stay at the farm.
    const block = Math.floor(H.clockHour() / 2);
    const station = stations[H.hashInt(`${child.id}:${H.rawDay()}:${block}:town-station`) % stations.length];
    const spot = H.nearestWalkable('town', station.c, station.r, 3);
    return spot ? { area: 'town', c: spot.c, r: spot.r, activity: 'playing around the village',
      stationId: `family_child_town_${child.id}`, wanderMode: 'radius', wanderRadiusTiles: Math.max(1, num(town.wanderRadiusTiles, 3)) } : null;
  }
  function childTarget(child) {
    const phase = phaseOf(child);
    const hour = H.clockHour();
    if (phase === 'basket' || isCarryFollowing(child.id) || window.FamilyBabyBurdens?.isProxyActive?.(child.id)) {
      const following = window.FamilyBabyFollow?.scheduleTarget?.(child, phase);
      if (following) return following;
      const carry = child.carrySpot; // Saved safe landing spot: a put-down or thrown baby does not teleport to the basket on reload.
      if (carry && window.FamilyBabyBurdens?.isAllowedArea?.(carry.area)
          && Number.isFinite(carry.c) && Number.isFinite(carry.r)) {
        return { area: carry.area, c: carry.c, r: carry.r, activity: 'resting after being carried' };
      }
      if (phase !== 'basket') return null; // A carried child has no independent farm or vat schedule.
      const basket = basketObject(child);
      if (basket) return { area: 'interior', c: basket.col, r: basket.row, activity: 'napping in the basket' };
      const anchor = interiorAnchor();
      return anchor ? { ...anchor, activity: 'napping' } : null;
    }
    const vat = vatObject(child);
    // Daily squeezing starts at the 06:00 rollover. A real unfinished batch
    // takes priority over sleep/free time so the child can actually reach it.
    // Do not postpone production, alter output, or hold a child at an expired
    // offscreen job that has not yet been collected by processor VFX.
    if (vat && ((hour >= 8 && hour < 18) || vatJobActive(vat)) && Number.isFinite(vat.col) && Number.isFinite(vat.row)) {
      const spot = H.nearestWalkable('farm', vat.col, vat.row + 1, 2);
      if (spot) return { area: 'farm', c: spot.c, r: spot.r, activity: 'working the squeezing vat', vatId: vat.id };
    }
    if (hour >= 20 || hour < 7) {
      const anchor = interiorAnchor();
      return anchor ? { ...anchor, activity: 'sleeping' } : null;
    }
    if (!child.vatId) {
      const chore = window.NpcFarmPlots?.targetFor?.({ id: child.id }, { familyOnly: true }); // Toddlers may work on the farm, but never visit town.
      if (chore) return chore;
      if (phase === 'child') {
        const townTarget = childTownTarget(child);
        if (townTarget) return townTarget;
      }
    }
    const door = H.farmhouseDoorAnchor();
    if (door) return { area: 'farm', c: door.c, r: door.r, activity: phase === 'toddler' ? 'toddling on the farm' : 'playing outside', stationId: `child_play_${child.id}`, wanderMode: 'radius', wanderRadiusTiles: phase === 'toddler' ? 3 : 7 };
    const anchor = interiorAnchor();
    return anchor ? { ...anchor, activity: 'at home' } : null;
  }
  function scheduleOverride(rec) {
    if (!rec?.isChild) return null;
    const child = fam.children.find(entry => entry.id === rec.id);
    return child ? childTarget(child) : null;
  }

  function activeVatScheduleOverride(rec) {
    if (!rec?.isChild) return null;
    const child = fam.children.find(entry => entry.id === rec.id);
    if (!child?.vatId || isFamilyWorkUnavailable(child.id) || !vatJobActive(vatObject(child))) return null;
    const target = childTarget(child); // Only real unfinished batches outrank follow/wait and other ordinary schedules.
    return target?.vatId === child.vatId ? target : null;
  }

  function updateChild(child) {
    ensureWalker(child);
    const walker = walkerFor(child);
    const phase = phaseOf(child);
    syncChildAmbientGreetings(child); // Sync only on phase changes; module caches the last stage.
    if (phase === 'child' && !window.FamilyBabyBurdens?.isProxyActive?.(child.id)) { child.followPlayer = false; window.FamilyBabyFollow?.clearWalker?.(walker); }
    if (phase !== 'basket' && child.basketId) {
      const basket = basketObject(child);
      if (child.carryBy === 'spouse') window.FamilyBabyBurdens?.returnToBasket?.(child, basket); // Finish newborn-only automatic care before removing the cradle.
      if (basket) deps().furniture?.removeInteriorFurniture?.(basket.id);
      child.basketId = null;
      H.toast(`🧸 ${child.name} has outgrown the baby basket and is toddling around!`, true);
      H.persist();
    }
    if (phase === 'child' && !child.grownAnnounced) {
      child.grownAnnounced = true;
      H.toast(`🌱 ${child.name} is walking steadily now and will head outside to play.`, true);
      H.persist();
    }
    if (child.vatId && !vatObject(child)) { window.DewVats?.setExternalWorker?.(child.vatId, null); child.vatId = null; H.persist(); }
    if (child.vatId && phase !== 'basket') window.DewVats?.setExternalWorker?.(child.vatId, { id: child.id, name: child.name, efficacy: num(cfg().vatEfficacyMultiplier, 2), familyWorker: true });
    if (!walker) return; // Offscreen children still keep their vat jobs registered above.
    if (walker.rec) walker.rec.ambientGreetings = true; // Old saved babies and toddlers can use ambient speech.
    // Proportions are baked when the avatar is built (PNGPlaneAvatar child
    // scale + the rig scaler's head compensation), so a child who grows into
    // the next phase is rebuilt once with that phase's body/head scale.
    if (walker._childPhase && walker._childPhase !== phase && deps().despawnNpcWalker) {
      if (window.FamilyBabyBurdens?.isProxyActive?.(child.id)) return; // Finish the active carry/throw before rebuilding the source avatar at its new age.
      window.FamilyBabyBurdens?.discard?.(child.id, phase === 'toddler' && !!child.followPlayer); // Growth preserves a dropped baby's safe position/follow state.
      deps().despawnNpcWalker(walker);
      return;
    }
    walker._childPhase = phase;
    const individual = window.HobunjiCharacterAgeRigConfig?.profileFor?.(phase === 'basket' ? 'baby' : phase, child.speciesId, child.gender);
    const limbScale = individual || (phase === 'child' ? cfg().childLimbModifiers : cfg().phaseScales?.[phase]); // Same age-global hand/foot fields exported by Full Character Scale.
    if (phase === 'basket' || (limbScale && (Number(limbScale.hand) !== 1 || Number(limbScale.foot) !== 1))) {
      window.FamilyBabyLimbs?.balanceWalker?.(walker, limbScale); // Preserve the baby's carried proxy, and support optional toddler/child limb modifiers without a permanent new frame loop.
    }
    window.FamilyBabyBurdens?.sync?.(child,walker,phase,()=>H.persist());
    window.FamilyBabyFollow?.bind?.(child, walker, phase); // The normal walker tick owns the baby's movement.
    if (phase === 'toddler') {
      const footing = toddlingFooting(child) / 99;
      const now = performance.now();
      if (!(walker._toddleTumbleUntil > now) && Math.random() < 0.025 * footing) walker._toddleTumbleUntil = now + 1100 + footing * 900;
      walker.catchup = walker._toddleTumbleUntil > now ? 0.001 : 0.35 + 0.65 * (1 - footing);
      walker._toddlingFooting = toddlingFooting(child);
    } else {
      walker._toddlingFooting = 0;
      walker._toddleTumbleUntil = 0;
      if (walker.catchup !== 1 && phase === 'child') walker.catchup = 1;
    }
  }

  // Toddler wobble / tumble presentation (visual only; per-frame but bounded
  // to the handful of child walkers, and disabled when none are toddling).
  function updateToddlerFrame() {
    const now = performance.now();
    for (const child of fam.children) {
      const walker = walkerFor(child);
      if (!walker?.root) continue;
      if (phaseOf(child) === 'basket' || child.carryBy || window.FamilyBabyBurdens?.isProxyActive?.(child.id)) continue; // Only carried/airborne children and crawling babies suppress the normal toddler wobble.
      const footing = num(walker._toddlingFooting, 0) / 99;
      const tumbling = walker._toddleTumbleUntil > now;
      const target = tumbling ? 1.15 : Math.sin(now / 160 + child.id.length) * 0.11 * footing;
      const current = walker.root.rotation.z;
      const next = current + (target - current) * (tumbling ? 0.25 : 0.35);
      if (Math.abs(next - current) > 1e-4) walker.root.rotation.z = next;
    }
  }
  function syncFrameSubscriber() {
    const scheduler = window.RuntimeFrameScheduler;
    if (!scheduler?.register) return;
    if (!frameRegistered) {
      scheduler.register(FRAME_ID, updateToddlerFrame, { phase: 'post-game', owner: 'RomanceFamily', description: 'Toddler wobble/tumble tilt for child walkers.', enabled: false });
      frameRegistered = true;
    }
    const area = deps().normalizeNpcArea?.(deps().getCurrentArea?.());
    const active = fam.children.some(child => { const w = walkerFor(child); return w && w.area === area && (num(w._toddlingFooting, 0) > 0 || Math.abs(w.root?.rotation?.z || 0) > 0.001); });
    scheduler.setEnabled?.(FRAME_ID, active);
  }

  function onNewDay() {
    const workers = fam.children.filter(child => child.vatId && phaseOf(child) !== 'basket' && !isFamilyWorkUnavailable(child.id)).map(child => ({ id: child.id, name: child.name, vatId: child.vatId })); // Squeezing is a child/toddler chore; spouses retain ordinary plot work.
    for (const worker of workers) {
      const status = window.DewVats?.squeezePileWithExternalWorker?.(worker.vatId);
      if (status === 'started') {
        awardWork(worker.id, 'squeeze');
        H.toast(`🥛 ${worker.name} squeezed dew at the vat (${num(cfg().vatEfficacyMultiplier, 2)}× yield).`, true);
      }
    }
  }

  // ── Village friendships ──────────────────────────────────────────────
  function syncChildFriendships() {
    const relationships = window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.relationships;
    if (!Array.isArray(relationships)) return;
    const friends = cfg().childTown?.friendNpcIds || ['gantami_ginju']; // Authored first friend; configurable without changing NPC AI.
    const signature = JSON.stringify(fam.children.map(child => child.id).sort()) + JSON.stringify(friends);
    if (relationships === registeredSocialGraph && signature === registeredChildFriends) return;
    for (let i = relationships.length - 1; i >= 0; i--) {
      if (relationships[i]?.familyChildFriend === true) relationships.splice(i, 1); // Remove links left by a different loaded world.
    }
    for (const child of fam.children) {
      for (const friendId of friends) {
        if (friendId !== child.id) relationships.push({ type: 'friend', members: [child.id, friendId], familyChildFriend: true });
      }
    }
    registeredSocialGraph = relationships;
    registeredChildFriends = signature;
  }

  // ── Dialogue for children ─────────────────────────────────────────────
  function childTree(child) {
    const phase = phaseOf(child);
    const lines = phase === 'basket' ? ['*gurgles happily*', '*grabs at your finger*']
      : phase === 'toddler' ? ['Da! Da!', '*wobbles toward you and plops down*', 'Up! Up!']
      : [`Hi! Can I help on the farm today?`, `I saw a big bug by the barn!`, `${H.npcName(child.otherParentId)} says I'm getting really tall.`, 'When I grow up I want to be just like you.'];
    const text = lines[(H.rawDay() + child.id.length) % lines.length];
    return { id: `tree_${child.id}`, label: `${child.name}`, trigger: 'interact', priority: 1, entryNode: `${child.id}_n1`, nodes: [{ id: `${child.id}_n1`, type: 'text', text, next: null, expression: 'smile' }] };
  }
  function registerChildDialogue(child) {
    window.DialogueContent?.registerTreeProvider?.(child.id, () => childTree(child));
    syncChildAmbientGreetings(child); // Standalone voice policy, original family Talk trees unchanged.
  }

  // ── Command wheel (child/toddler squeezing jobs) ──────────────────────
  function commandOptionsFor(walker) {
    const child = fam.children.find(entry => entry.id === walker?.rec?.id);
    const infantOptions = window.FamilyBabyCare?.commandOptionsFor?.(walker) || []; // Spouses retain baby handoffs, but never receive vat-work commands.
    if (!child || isFamilyWorkUnavailable(child.id)) return infantOptions;
    if (child.vatId) return [...infantOptions, { id: 'unvat', icon: '🛑', label: 'Stop Vat Work', run: () => {
      clearVatWorkerPose(child.vatId);
      window.DewVats?.setExternalWorker?.(child.vatId, null);
      child.vatId = null;
      H.persist(); H.say(walker, 'Okay! Time to play!');
    } }];
    const vats = (window.DewVats?.listSqueezingVats?.() || []).filter(vat => !window.DewVats.assignedWorkerForVat(vat.id));
    return [...infantOptions, { id: 'vat', icon: '🥛', label: 'Work the Vat', muted: !vats.length, run: () => {
      const available = (window.DewVats?.listSqueezingVats?.() || []).find(vat => !window.DewVats.assignedWorkerForVat(vat.id));
      if (!available) { H.toast('There is no free squeezing vat on the farm.', false); return; }
      child.vatId = available.id;
      window.DewVats.setExternalWorker(available.id, { id: child.id, name: child.name, efficacy: num(cfg().vatEfficacyMultiplier, 2), familyWorker: true });
      H.persist(); H.say(walker, "I'll work at the squeezing vat!");
    } }];
  }

  // ── Spouse override hook (egg rest and baby care) ────────────────────
  function spouseTargetOverride(rec, { bedSpot } = {}) {
    if (spouseHoldingEgg() && fam.pregnancy.spouseId === rec.id) {
      const bed = (bedSpot || H.bedSpot)();
      return bed ? { ...bed, activity: 'keeping the egg warm in bed', stationId: 'spouse_egg_bed' } : null;
    }
    const babyCare = window.FamilyBabyCare?.spouseTarget?.(rec, { bedSpot }); // Nursery time precedes idle wandering, not assigned farmwork.
    if (babyCare) return babyCare;
    return null;
  }

  // ── UI: dream picker + naming ─────────────────────────────────────────
  function promptPendingBaby() {
    const baby = fam.pendingBaby;
    if (!baby || uiOverlay) return false;
    openNamingPrompt(baby, name => {
      if (fam.pendingBaby !== baby) return;
      fam.pendingBaby = null;
      createChild({ ...baby, name }); // Saved child record supersedes pending naming.
    });
    return true;
  }
  function injectStyles() {
    if (document.getElementById('romanceFamilyStyles')) return;
    const style = document.createElement('style');
    style.id = 'romanceFamilyStyles';
    style.textContent = `
#romanceFamilyOverlay{position:fixed;inset:0;z-index:12100;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,rgba(70,40,90,.86),rgba(5,4,12,.95));padding:16px;box-sizing:border-box;font-family:"Pixelify Sans",system-ui,sans-serif;color:#f5ecff}
#romanceFamilyOverlay .rf-card{width:min(520px,100%);max-height:100%;overflow:auto;background:rgba(18,12,30,.92);border-radius:14px;box-shadow:0 0 0 2px rgba(220,190,255,.25),0 20px 70px rgba(0,0,0,.6);padding:18px;box-sizing:border-box}
#romanceFamilyOverlay h2{margin:0 0 4px;font-size:20px}
#romanceFamilyOverlay p{margin:0 0 12px;opacity:.8;font-size:13px}
#romanceFamilyOverlay .rf-row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
#romanceFamilyOverlay button{font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 10px;cursor:pointer}
#romanceFamilyOverlay button.on{background:rgba(220,160,255,.35);border-color:rgba(240,200,255,.7)}
#romanceFamilyOverlay .rf-label{font-size:12px;opacity:.75;margin-top:4px}
#romanceFamilyOverlay .rf-name-heading{display:flex;align-items:center;gap:12px;margin-bottom:8px}
#romanceFamilyOverlay .rf-name-portrait{display:grid;place-items:center;flex:0 0 64px;width:64px;height:64px;overflow:hidden;border-radius:12px;background:rgba(255,255,255,.06)}
#romanceFamilyOverlay .rf-name-portrait canvas{position:static;inset:auto;display:block;margin:0;width:100%;height:100%;max-width:100%;max-height:100%;image-rendering:pixelated}
#romanceFamilyOverlay .rf-name-portrait canvas[hidden],#romanceFamilyOverlay .rf-name-fallback[hidden]{display:none}
#romanceFamilyOverlay .rf-name-fallback{font-size:32px;line-height:1}
#romanceFamilyOverlay input{font:inherit;width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.35);color:#fff}
#romanceFamilyOverlay .rf-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
#romanceFamilyOverlay .rf-primary{background:rgba(200,130,255,.45)}
`;
    document.head.appendChild(style);
  }
  function closeUi() { uiOverlay?.remove(); uiOverlay = null; }
  function openOverlay(html) {
    injectStyles();
    closeUi();
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (_) {} }
    uiOverlay = document.createElement('div');
    uiOverlay.id = 'romanceFamilyOverlay';
    uiOverlay.setAttribute('data-ctrl-panel', ''); // Route dream and naming interactions through the existing menu controller.
    uiOverlay.setAttribute('data-ctrl-modal', ''); // Prevent other visible panels from stealing focus.
    uiOverlay.setAttribute('role', 'dialog');
    uiOverlay.setAttribute('aria-modal', 'true');
    uiOverlay.innerHTML = `<div class="rf-card">${html}</div>`;
    uiOverlay.addEventListener('keydown', event => event.stopPropagation()); // Typing a name must not drive the game.
    uiOverlay.addEventListener('keyup', event => event.stopPropagation());
    document.body.appendChild(uiOverlay);
    return uiOverlay;
  }

  // Delay the adoption dream without changing the wedding date or biological births.
  // These saved day offsets are checked only at a later farmhouse sleep.
  function postponeDream(days) {
    const p = fam.pregnancy;
    if (!p || p.kind !== 'adoption' || p.born) return false;
    p.nextDreamRawDay = H.rawDay() + Math.max(1, Math.floor(num(days, 1)));
    closeUi();
    H.toast('You decide to give the thought of a child more time.', true);
    H.persist();
    return true;
  }
  function openDreamDecision() {
    const p = fam.pregnancy;
    if (!p || p.kind !== 'adoption' || p.born || fam.pendingAdoption) return false;
    const delays = H.cfg().family?.dreamPostponeDays || { soon: 1, time: 14, month: 28 };
    const root = openOverlay(`
      <h2>🌙 A child in your dream</h2>
      <p>A child waits for you, familiar and yet unknown. Are you ready to welcome them into your family?</p>
      <div class="rf-actions" style="flex-direction:column">
        <button class="rf-primary" data-rf-ready data-ctrl-default>Yes. I want to meet them.</button>
        <button data-rf-postpone="soon" data-ctrl-cancel>Soon, but not yet (ask again in 24 hours)</button>
        <button data-rf-postpone="time">I need some time (ask again in 2 weeks)</button>
        <button data-rf-postpone="month">I'm not ready yet (ask again in 1 month)</button>
      </div>`);
    root.querySelectorAll('[data-rf-postpone]').forEach(button => button.addEventListener('click',
      () => postponeDream(delays[button.dataset.rfPostpone] || 1)));
    root.querySelector('[data-rf-ready]').addEventListener('click', () => {
      closeUi();
      const opened = openDreamPicker(choice => {
        if (fam.pregnancy !== p || p.born) return;
        p.born = true; // Only commit when the player finishes character creation.
        p.awaitingChild = true; // The doorstep and naming events must finish before another birth is scheduled.
        fam.pendingAdoption = { ...choice, spouseId: p.spouseId };
        H.toast('You wake from a vivid dream of a child you have never met…', true);
        H.persist();
      });
      if (!opened) H.toast('The dream could not open. You can try again after another sleep.', false);
    });
    return true;
  }

  async function renderPreview(canvas, choice) {
    const preview = window.NpcAvatarPreview; // Builds the baby from its authored appearance, without a second portrait profile builder.
    const fallback = canvas?.parentElement?.querySelector('.rf-name-fallback'); // The baby emoji remains visible until the chathead successfully paints.
    const renderChathead = window.AmbientDialogue?.renderChatheadImage; // Uses the same head-only crop as NPC floating dialogue.
    if (!canvas || !preview?.buildProfileFromNpcExport || typeof renderChathead !== 'function') return;
    try {
      await preview.ensurePortraitCosmetics?.(); // Lazy portrait assets must be ready before converting a newborn into the shared NPC profile.
      if (!canvas.isConnected || !canvas.closest('#romanceFamilyOverlay')) return; // Asset loading may outlive this naming dialog.
      const profile = preview.buildProfileFromNpcExport({
        name: 'dream_child',
        appearance: { speciesId: choice.speciesId, gender: choice.gender, bodyColors: choice.bodyColors, cosmetics: { ...(choice.cosmetics || {}) } },
        equippedCosmetics: [...(choice.equippedCosmetics || [])],
        appliedDyes: { ...(choice.appliedDyes || {}) },
      });
      if (!profile) return;
      const rendered = await renderChathead(canvas, profile); // The shared renderer crops the finished portrait into the small icon square.
      if (!rendered || !canvas.isConnected || !canvas.closest('#romanceFamilyOverlay')) return;
      const pixels = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height)?.data; // Visible alpha distinguishes a real chathead from a renderer that returned true with a blank crop.
      let hasPortrait = false; // Only an actually painted newborn can replace the naming prompt's emoji fallback.
      for (let i = 3; i < (pixels?.length || 0); i += 4) {
        if (pixels[i] >= 8) { hasPortrait = true; break; }
      }
      if (hasPortrait) {
        canvas.hidden = false;
        if (fallback) fallback.hidden = true;
      }
    } catch (error) { console.warn('[RomanceFamily] child chathead failed; using emoji fallback', error); }
  }

  // The dream is the real character creator (HobunjiOnboarding.openCreator):
  // species/subspecies, gender, every cosmetic slot, body colors, clothing
  // and dyes, with the to-scale 3D preview showing child proportions. The
  // child is named later, when Father Hunundi brings them to the door.
  let dreamLock = null;
  function openDreamPicker(onDone) {
    const creator = window.HobunjiOnboarding;
    if (!creator?.openCreator) { console.warn('[RomanceFamily] character creator unavailable for the dream child'); return false; }
    dreamLock?.release?.();
    dreamLock = window.CharacterActionLocks?.acquire?.({ owner: 'romance-dream-child', reason: 'Dreaming of a child', participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }] }) || null;
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (_) {} }
    const opened = creator.openCreator({
      mode: 'dreamChild',
      child: true,
      hideName: true,
      title: '🌙 You dream of a child…',
      subtitle: 'In the dream they are so clear. Who do you see?',
      confirmLabel: '☀️ Wake up',
      hint: 'You will name them when you meet.',
      speciesId: H.playerAppearance().speciesId || 'mao-ao',
      gender: Math.random() < 0.5 ? 'male' : 'female',
      onComplete: result => {
        dreamLock?.release?.();
        dreamLock = null;
        const appearance = result?.appearance || {};
        onDone?.({
          speciesId: appearance.speciesId || 'mao-ao',
          gender: appearance.gender === 'female' ? 'female' : 'male',
          bodyColors: appearance.bodyColors || null,
          cosmetics: { ...(appearance.cosmetics || {}) },
          equippedCosmetics: [...(result?.equippedCosmetics || [])],
          appliedDyes: { ...(result?.appliedDyes || {}) },
        });
      },
    });
    if (!opened) { dreamLock?.release?.(); dreamLock = null; }
    return opened;
  }

  function randomName(speciesId, gender) {
    try { return window.BanditNameForge?.generateCulturalIdentity?.({ speciesId, gender })?.givenName || ''; } catch (_) { return ''; }
  }
  function openNamingPrompt(baby, onDone) {
    const root = openOverlay(`
      <h2 class="rf-name-heading"><span class="rf-name-portrait"><canvas width="200" height="200" hidden role="img" aria-label="Your baby's portrait" data-rf-preview></canvas><span class="rf-name-fallback" aria-hidden="true">👶</span></span><span>Name your ${baby.gender === 'female' ? 'daughter' : 'son'}</span></h2>
      <p>What will you call them?</p>
      <input type="text" maxlength="32" autocomplete="off" spellcheck="false" data-ctrl-default data-rf-name value="${randomName(baby.speciesId, baby.gender).replace(/"/g, '')}">
      <div class="rf-actions"><button data-rf-random>Random</button><button class="rf-primary" data-rf-done>Name them</button></div>`);
    const input = root.querySelector('[data-rf-name]');
    renderPreview(root.querySelector('[data-rf-preview]'), baby);
    root.querySelector('[data-rf-random]').addEventListener('click', () => { input.value = randomName(baby.speciesId, baby.gender) || input.value; });
    const done = () => {
      const name = input.value.trim() || randomName(baby.speciesId, baby.gender) || 'Little One';
      closeUi();
      onDone?.(name);
    };
    root.querySelector('[data-rf-done]').addEventListener('click', done);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') done(); });
    setTimeout(() => input.focus(), 50);
  }


  // One read-only source for Dev Companion family timing; game events still own scheduling/delivery.
  function devArrivalPanel() {
    const spouse = R?.getSpouse?.(); // Identifies the current marriage, not a plan from a previous spouse.
    const plan = fam.pregnancy?.spouseId === spouse?.npcId ? fam.pregnancy : null; // Only the current spouse's plan can be upcoming.
    const today = H.rawDay(); // Same raw in-game day used by the actual sleep and birth gates.
    const savedDay = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : null; // Saved milestone parser: missing dates must never become raw day zero.
    const daysLeft = target => Math.max(0, target - today); // Count only whole in-game days remaining on each companion state poll.
    const dateLabel = target => target == null ? 'Not recorded' : window.CalendarSystem?.formatCalendarDateFull?.(target) || `Game day ${target}`; // Civil date when available; avoid fabricating absent dates.
    const rows = [['Spouse', spouse?.npcId ? H.npcName(spouse.npcId) : 'None']]; // Shared first row across every arrival state.

    if (fam.pendingBaby) {
      const adopted = fam.pendingBaby.origin === 'adopted'; // Distinguishes a doorstep adoption from a biological birth.
      const arrivalDay = savedDay(fam.pendingBaby.bornRawDay); // A malformed legacy date must not be shown as an actual birthday.
      return {
        summary: adopted ? 'Adopted baby arrived' : 'Baby arrived',
        rows: [...rows, ['Status', 'Awaiting newborn naming'], ['Arrival date', dateLabel(arrivalDay)]],
        note: arrivalDay == null
          ? 'A newborn is awaiting a name, but this save has no valid recorded arrival day.'
          : 'The child has arrived. Complete the naming prompt; its original arrival date is already saved.',
      };
    }
    if (fam.pendingAdoption) {
      const doorstep = window.DoorstepVisits; // Shared provider owns the real visitor lifecycle and any spawn failure.
      const atDoor = doorstep?.activeVisitKey?.() === 'romance_adoption'; // Detects a visitor who actually spawned, not merely a queued provider.
      const attempt = atDoor ? null : doorstep?.debugSnapshot?.()?.lastSpawnAttempt; // Read only while queued to keep the regular state poll inexpensive.
      const failedAttempt = attempt?.key === 'romance_adoption' && attempt.reason && attempt.reason !== 'Spawned successfully.' ? String(attempt.reason) : null; // Last matching failure only; unrelated visitors do not affect this family status.
      return {
        summary: atDoor ? 'Adoption visitor at farmhouse' : 'Adoption visit queued',
        rows: [...rows, ['Visitor', 'Father Hunundi'], ['Arrival', atDoor ? 'Waiting outside the farmhouse' : 'Next eligible farmhouse exit'], ...(failedAttempt ? [['Last spawn attempt', failedAttempt]] : [])],
        note: atDoor
          ? 'Speak to Father Hunundi and complete the conversation. Leaving early keeps the visit pending.'
          : 'Exit the farmhouse into the farm to trigger this visit. There is no fixed arrival time; unavailable NPC or doorway placement can delay it.',
      };
    }
    if (!spouse) return { summary: 'No family arrival scheduled', rows, note: 'Family arrivals are planned after marriage.' };
    if (!plan || plan.born) return { summary: 'No family arrival currently scheduled', rows, note: 'No birth, adoption dream, or visitor is pending. The family system schedules the next eligible plan during its normal tick.' };
    const kind = String(plan.kind || ''); // Validate old or incomplete saves before interpreting a birth as a dream or vice versa.
    if (!['adoption', 'spouse_live', 'player_live', 'spouse_egg', 'player_egg'].includes(kind)) return {
      summary: 'Family arrival plan needs attention', rows: [...rows, ['Plan kind', kind || 'Missing']],
      note: 'The saved plan has an unrecognized event type; no reliable birth/adoption estimate can be shown.',
    };
    const due = savedDay(plan.dueRawDay); // Authoritative earliest eligible day used by the actual sleep handler.
    if (due == null) return {
      summary: 'Family arrival date unavailable', rows: [...rows, ['Plan kind', kind]],
      note: 'The saved family plan has no valid due day. Check the saved plan before relying on an arrival countdown.',
    };

    if (kind === 'adoption') {
      const earliest = Math.max(due, savedDay(plan.nextDreamRawDay) ?? due); // Postponements affect dreams, not wedding or birth dates.
      const remaining = daysLeft(earliest); // Zero means eligible for a farmhouse sleep, not that the visitor has appeared.
      return {
        summary: remaining ? `Adoption dream in ${remaining} game day${remaining === 1 ? '' : 's'}` : 'Adoption dream eligible',
        rows: [...rows, ['Earliest dream', dateLabel(earliest)], ['Time remaining', remaining ? `${remaining} game day${remaining === 1 ? '' : 's'}` : 'Ready for farmhouse sleep'], ['Visit', 'After accepting the dream and creating the child']],
        note: 'Sleep in the farmhouse on or after the eligible day to receive the dream. Accept it and finish the child creator; Father Hunundi then visits on a farmhouse exit.',
      };
    }

    const remaining = daysLeft(due); // Overdue deliveries remain due until the required sleep.
    const event = kind.endsWith('_egg') ? 'Egg hatching' : 'Birth'; // Same types resolved by ensurePlan.
    const announceDay = savedDay(plan.announceRawDay); // Announcement may be delayed for NPC proximity, independently of the delivery day.
    const announcement = plan.announced ? 'Announced' : announceDay == null ? 'Date not recorded' : today >= announceDay ? 'Eligible; announcement pending' : dateLabel(announceDay);
    return {
      summary: remaining ? `${event} due in ${remaining} game day${remaining === 1 ? '' : 's'}` : `${event} due — sleep required`,
      rows: [...rows, ['Event', event], ['Announcement', announcement], ['Earliest arrival', dateLabel(due)], ['Time remaining', remaining ? `${remaining} game day${remaining === 1 ? '' : 's'}` : 'Due now'], ['Delivery trigger', 'Farmhouse sleep on or after the due date']],
      note: 'Births and hatching happen on the first qualifying farmhouse sleep, not automatically when the clock reaches the due date.',
    };
  }
  function registerDevCompanionPanel() {
    window.DevCompanion?.registerPanel?.({
      id: 'family-arrivals',
      title: '👶 Family arrivals',
      order: 25,
      when: () => window.__hobunjiGameStarted === true && !!R && !!H,
      render: devArrivalPanel,
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────
  function tick() {
    if (!R || !H) return;
    registerDoorstep();
    const day = H.rawDay();
    if (lastRawDay !== null && day !== lastRawDay) onNewDay();
    lastRawDay = day;
    ensurePlan();
    maybeAnnounce();
    if (fam.pendingBaby && !pendingBabyPromptScheduled && !uiOverlay && !deps().isDialogueOpen?.()) promptPendingBaby();
    syncChildFriendships();
    pruneVatWorkerPoses();
    for (const child of fam.children) updateChild(child);
    window.FamilyBabyCare?.tick?.(); // One lightweight family update, not a new per-frame character behavior.
    syncFrameSubscriber();
  }

  function init(romanceApi) {
    R = romanceApi;
    H = romanceApi.helpers;
    unsubscribeObservationXp?.();
    unsubscribeObservationXp = window.SkillSystem?.onAward?.(awardObservationXp) || null;
    window.NpcScheduling?.registerTargetOverride?.('romance-family-vat', activeVatScheduleOverride, 20); // Below festival ceremony priority (100).
    window.NpcScheduling?.registerTargetOverride?.('romance-family', scheduleOverride);
    window.addEventListener('hobunji-time-passage', onTimePassage);
    registerDoorstep();
    registerDevCompanionPanel();
    return api;
  }
  function serialize() {
    const saved = JSON.parse(JSON.stringify(fam));
    // The shared Burden slots are not serialized. Save a safe nearby landing for
    // a baby held in the wilderness so reloading never sends them back home.
    const carried = H?.rawDay ? saved.children.filter(c => c.carryBy === 'player') : [];
    const spot = carried.length && window.FamilyBabyFollow?.savedCarrySpot?.();
    for (const child of carried) {
      child.carryBy = null; child.carryPose = null; // Physical burden slots are not persisted.
      const canFollow = ['basket', 'toddler'].includes(phaseOf(child)) && !!spot;
      child.carrySpot = canFollow ? { ...spot } : null;
      child.followPlayer = canFollow;
    }
    return saved;
  }
  function restore(saved) {
    for (const vatId of vatWorkerPoses.keys()) clearVatWorkerPose(vatId);
    closeUi(); // A naming/dream dialog belongs to the former character/world, not the one being loaded.
    window.FamilyBabyBurdens?.clear?.(); // A new world gets its own baby burden handles.
    window.FamilyBabyFollow?.clear?.();
    window.FamilyBabyCare?.clear?.(); // No childcare intervals leak across restored families.
    lastUsefulnessPopup = null;
    window.NpcFarmPlots?.invalidateFamilyChores?.(); // Old family claims cannot survive a world/character change.
    window.FamilyBabyAmbientVoice?.clear?.(); // Remove prior world child speech registrations.
    window.DewVats?.clearFamilyWorkers?.(); // Remove stale assignments before rehydrating the newly loaded family's vats.
    fam = saved && typeof saved === 'object'
      ? { ...defaultFamily(), ...saved, children: Array.isArray(saved.children) ? saved.children.map(child => ({ ...child })) : [] }
      : defaultFamily();
    if (!fam.farmChores || typeof fam.farmChores !== 'object') fam.farmChores = { livestock: '', processing: {} }; // Legacy saves remain opt-in.
    for (const child of fam.children) {
      // Older saves may contain an unsaved hand/back slot; don't block ensureWalker on a nonexistent proxy.
      if (child.carryBy) { child.carryBy = null; child.carryPose = null; child.followPlayer = !!child.carrySpot && !!child.followPlayer; }
      if (!child.carrySpot || !window.FamilyBabyBurdens?.isAllowedArea?.(child.carrySpot.area)) {
        child.carrySpot = null; child.followPlayer = false;
      }
      if (H?.rawDay && phaseOf(child) === 'child') child.followPlayer = false;
    }
    delete fam.spouseVatId; // Retired adult vat jobs from older saves are discarded; clearFamilyWorkers above releases their runtime shifts.
    delete fam.spouseVatWorkerId; // No obsolete spouse vat ownership is written back on the next save.
    // Save migration: shorten an existing three-month gestation to one month. A pre-migration
    // save interrupted during newborn naming can retry delivery on the next farmhouse sleep.
    const plan = fam.pregnancy;
    if (plan && !plan.born && num(plan.dueRawDay, 0) - num(plan.announceRawDay, 0) === 84) plan.dueRawDay = plan.announceRawDay + 28;
    if (plan?.born && !fam.pendingBaby && !fam.pendingAdoption && !fam.children.some(child => child.otherParentId === plan.spouseId)) {
      plan.born = false; plan.awaitingChild = false;
    }
    pendingBabyPromptScheduled = false;
    clearAnnounceTimers();
    lastRawDay = null;
    syncChildFriendships();
    for (const child of fam.children) registerChildDialogue(child);
  }
  function snapshot() {
    return {
      pregnancy: fam.pregnancy ? { ...fam.pregnancy } : null,
      pendingAdoption: !!fam.pendingAdoption,
      pendingBaby: !!fam.pendingBaby, // Mobile diagnostics reveal a naming prompt waiting to resume after reload.
      spouseUsefulness: R?.getSpouse?.()?.npcId ? usefulnessInfo(R.getSpouse().npcId) : null,
      lastUsefulnessPopup,
      babyFollow: window.FamilyBabyFollow?.snapshot?.() || null,
      babyCare: window.FamilyBabyCare?.snapshot?.() || [], // Mobile debug rows show arms/back/basket and current shift.
      babyBurdens: window.FamilyBabyBurdens?.snapshot?.() || null, // Mobile shows proxy geometry, reverse-art policy and parent scene without devtools.
      children: fam.children.map(child => ({ id: child.id, name: child.name, speciesId: child.speciesId, gender: child.gender, origin: child.origin, ageDays: ageDays(child), phase: phaseOf(child), carrySpot: child.carrySpot || null, carrying: window.FamilyBabyBurdens?.carrying?.(child.id) || false, toddlingFooting: toddlingFooting(child), vatId: child.vatId, vatStomping: vatWorkerPoses.get(child.vatId)?.childId === child.id, usefulness: usefulnessInfo(child.id) || (phaseOf(child) === 'basket' ? { level: num(child.usefulnessLevel, 1), xp: num(child.usefulnessXp, 0), observationRate: BABY_OBSERVATION_XP_RATE } : null), spawned: !!walkerFor(child) })), 
    };
  }

  const api = {
    init, tick, serialize, restore, snapshot, setVatWorkerPose, clearVatWorkerPose, retargetVatAssignments,
    spouseTargetOverride, commandOptionsFor, spouseHoldingEgg, isBasketBaby, isCarryFollowing, isProtectedFamilyChild, isFamilyWorkUnavailable, releaseCarryFollow, babyAmbientSound, voiceAgePhase,
    careContext: () => ({ family: fam, helpers: H, romance: R, phaseOf, walkerFor, basketObject, persist: () => H.persist() }), // One source of family state for childcare.
    usefulnessInfo, awardWork, rollWorkQuality, awardObservationXp, familyChores, setFamilyChore, familyProgress, retargetProcessingAssignment,
    isAssignedToVat: id => fam.children.some(child => child.id === id && phaseOf(child) !== 'basket' && !!child.vatId), // Only non-infant children can reserve vats and interrupt family plot claims.
    openDreamPicker, openNamingPrompt, createChild,
    wardrobeRecordFor: id => { const child = fam.children.find(entry => entry.id === id); return child ? childRecord(child) : null; }, // Offscreen children still have identity/clothing for their family chest.
    isWardrobeChild: id => fam.children.some(child => child.id === id), // Fast per-frame physical wardrobe targeting avoids allocating a full family snapshot.
    wardrobeChildName: id => fam.children.find(child => child.id === id)?.name || null, // The interaction label follows a renamed child without querying the full family snapshot.
    _test: { resolveKind, mixedColors, nearColors, phaseOf, toddlingFooting, childVisitDay, childTownTarget, childTarget, childRecord, onTimePassage, postponeDream, openDreamDecision, syncChildFriendships, syncChildAmbientGreetings, getFamily: () => fam },
  };
  window.RomanceFamily = api;
})();

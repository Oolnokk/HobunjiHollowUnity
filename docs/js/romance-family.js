// Children after marriage (builds on js/romance-system.js's spouse state).
//
// 3 months after the wedding:
//   • you male + spouse female, same species → spouse announces a pregnancy
//     (Kenkari: an egg, and the spouse stays in bed with it until it hatches)
//   • you female + spouse male, same species → you feel sick, bloated, and
//     throw up (Kenkari: you lay an egg, and your spouse stays in bed with it)
//   • any other pairing → nothing yet (see the dream below)
// The first time you sleep in your farmhouse bed 6 months after the wedding:
//   • an egg hatches / a baby is born — case 1 babies mix both parents'
//     colors, case 2 babies take colors near their same-gender parent
//   • otherwise you dream of your child (species, gender and colors), and
//     on waking Father Hunundi is outside with an orphan from a bandit raid
// Every newborn is named, sleeps a month in a baby basket in the house, then
// toddles (Toddling Footing eases 99 → 0 over 5 months, no visible bars),
// and after that walks normally, leaves the house, greets you, has dialogue
// lines, and can work a squeezing vat in place of Small livestock at 2x.
(() => {
  'use strict';
  if (window.RomanceFamily) return;

  const FRAME_ID = 'romance-family-toddlers'; // RuntimeFrameScheduler id for toddler wobble presentation (enabled only while a toddler is visible).
  let R = null; // RomanceSystem API
  let H = null; // RomanceSystem.helpers
  let fam = defaultFamily();
  const spawning = new Set(); // child ids whose walker build is in flight
  let lastRawDay = null;
  let announceTimers = [];
  let doorstepRegistered = false;
  let frameRegistered = false;
  let uiOverlay = null;

  function defaultFamily() {
    return { pregnancy: null, children: [], pendingAdoption: null };
  }
  const cfg = () => H?.cfg?.()?.family || {};
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const deps = () => H?.deps?.() || {};
  const basketDays = () => num(cfg().basketDays, 28);
  const toddlingDays = () => num(cfg().toddlingDays, 140);

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
    if (fam.pregnancy?.spouseId === spouse.npcId) return fam.pregnancy;
    if (fam.children.some(child => child.otherParentId === spouse.npcId)) return null; // One child per marriage.
    const married = num(spouse.marriedRawDay, H.rawDay());
    fam.pregnancy = {
      spouseId: spouse.npcId,
      kind: resolveKind(spouse.npcId),
      announceRawDay: married + num(cfg().announceAfterDays, 84),
      dueRawDay: married + num(cfg().birthAfterDays, 168),
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
            { text: "I laid an egg this morning! I'm going to keep it warm in our bed until it hatches. Three months, maybe.", expression: 'smile', choices: [{ label: 'Our egg!', goto: 'end' }] },
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

  // ── Births (first sleep in your bed after 6 months) ───────────────────
  function onTimePassage(event) {
    const detail = event?.detail || {};
    if (detail.kind !== 'sleep') return;
    const p = fam.pregnancy;
    if (!p || p.born || H.rawDay() < p.dueRawDay) return;
    if (deps().getCurrentArea?.() !== 'interior') return; // Only sleeping in your own farmhouse bed counts.
    if (!p.announced) p.announced = true;
    const spouseName = H.npcName(p.spouseId);
    if (p.kind === 'adoption') {
      p.born = true;
      H.persist();
      setTimeout(() => openDreamPicker(choice => {
        fam.pendingAdoption = { ...choice, spouseId: p.spouseId };
        H.toast('You wake from a vivid dream of a child you have never met…', true);
        H.persist();
      }), 900);
      return;
    }
    p.born = true;
    const baby = babyFromParents(p.kind);
    const message = {
      spouse_egg: 'The egg hatched in the night!',
      player_egg: 'Your egg hatched in the night!',
      spouse_live: `${spouseName} gave birth in the night!`,
      player_live: 'You unexpectedly gave birth in the night!',
    }[p.kind];
    H.persist();
    setTimeout(() => {
      H.toast(`👶 ${message}`, true);
      openNamingPrompt(baby, name => createChild({ ...baby, name, origin: p.kind.endsWith('egg') ? 'egg' : 'birth', otherParentId: p.spouseId }));
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
        H.persist();
        setTimeout(() => openNamingPrompt(pending, name => createChild({ ...pending, name, origin: 'adopted', otherParentId: pending.spouseId })), 300);
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
    return 'child';
  }
  // 99 (barely any usable Footing) → 0 over the toddling span. Hidden: children have no resource bars.
  function toddlingFooting(child) {
    if (phaseOf(child) !== 'toddler') return phaseOf(child) === 'basket' ? 99 : 0;
    const progress = (ageDays(child) - basketDays()) / Math.max(1, toddlingDays());
    return Math.round(99 * clamp(1 - progress, 0, 1));
  }
  function phaseScaleFields(phase) {
    const scales = cfg().phaseScales?.[phase];
    return scales ? { childBodyScale: scales.body, childHeadScale: scales.head } : {};
  }
  function childRecord(child) {
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
      tags: ['child', 'family'],
      ...phaseScaleFields(phaseOf(child)),
      bio: `Your ${child.gender === 'female' ? 'daughter' : 'son'}.`,
      relationship: { canBefriend: true, canDate: false, canMarry: false, maxHearts: 10 },
      ambientGreetings: phaseOf(child) === 'child',
      scheduleHooks: { rules: [] },
    };
  }
  function createChild({ name, speciesId, gender, bodyColors, cosmetics, equippedCosmetics, appliedDyes, origin, otherParentId }) {
    const id = `child_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const child = {
      id, name: String(name || 'Little One').slice(0, 32), speciesId, gender, bodyColors,
      cosmetics: { ...(cosmetics || {}) }, equippedCosmetics: [...(equippedCosmetics || [])], appliedDyes: { ...(appliedDyes || {}) }, // Dream children keep every creator choice.
      origin, otherParentId, bornRawDay: H.rawDay(), basketId: null, vatId: null,
    };
    const placed = deps().furniture?.placeInteriorFixture?.('babyBasket');
    if (placed?.id) child.basketId = placed.id;
    if (placed?.stored) H.toast(`📦 Moved your ${placed.stored} into farm storage to make room for the baby basket.`, true);
    fam.children.push(child);
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

  function childTarget(child) {
    const phase = phaseOf(child);
    const hour = H.clockHour();
    if (phase === 'basket') {
      const basket = basketObject(child);
      if (basket) return { area: 'interior', c: basket.col, r: basket.row, activity: 'napping in the basket' };
      const anchor = interiorAnchor();
      return anchor ? { ...anchor, activity: 'napping' } : null;
    }
    if (phase === 'toddler' || hour >= 20 || hour < 7) {
      const anchor = interiorAnchor();
      if (!anchor) return null;
      return phase === 'toddler'
        ? { ...anchor, activity: 'toddling around', stationId: `child_toddle_${child.id}`, wanderMode: 'radius', wanderRadiusTiles: 3 }
        : { ...anchor, activity: 'sleeping' };
    }
    const vat = vatObject(child);
    if (vat && hour >= 8 && hour < 18 && Number.isFinite(vat.col) && Number.isFinite(vat.row)) {
      const spot = H.nearestWalkable('farm', vat.col, vat.row + 1, 2);
      if (spot) return { area: 'farm', c: spot.c, r: spot.r, activity: 'working the squeezing vat' };
    }
    const door = H.farmhouseDoorAnchor();
    if (door) return { area: 'farm', c: door.c, r: door.r, activity: 'playing outside', stationId: `child_play_${child.id}`, wanderMode: 'radius', wanderRadiusTiles: 7 };
    const anchor = interiorAnchor();
    return anchor ? { ...anchor, activity: 'at home' } : null;
  }
  function scheduleOverride(rec) {
    if (!rec?.isChild) return null;
    const child = fam.children.find(entry => entry.id === rec.id);
    return child ? childTarget(child) : null;
  }

  function updateChild(child) {
    ensureWalker(child);
    const walker = walkerFor(child);
    const phase = phaseOf(child);
    if (phase !== 'basket' && child.basketId) {
      const basket = basketObject(child);
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
    if (!walker) return;
    if (walker.rec) walker.rec.ambientGreetings = phase === 'child';
    // Proportions are baked when the avatar is built (PNGPlaneAvatar child
    // scale + the rig scaler's head compensation), so a child who grows into
    // the next phase is rebuilt once with that phase's body/head scale.
    if (walker._childPhase && walker._childPhase !== phase && deps().despawnNpcWalker) {
      deps().despawnNpcWalker(walker);
      return;
    }
    walker._childPhase = phase;
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
    if (child.vatId && !vatObject(child)) { child.vatId = null; H.persist(); }
    if (child.vatId) window.DewVats?.setExternalWorker?.(child.vatId, { id: child.id, name: child.name, efficacy: num(cfg().vatEfficacyMultiplier, 2) });
  }

  // Toddler wobble / tumble presentation (visual only; per-frame but bounded
  // to the handful of child walkers, and disabled when none are toddling).
  function updateToddlerFrame() {
    const now = performance.now();
    for (const child of fam.children) {
      const walker = walkerFor(child);
      if (!walker?.root) continue;
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
    for (const child of fam.children) {
      if (!child.vatId || phaseOf(child) !== 'child') continue;
      const status = window.DewVats?.squeezePileWithExternalWorker?.(child.vatId);
      if (status === 'started') H.toast(`🥛 ${child.name} squeezed a batch of dew at the vat (2x yield).`, true);
    }
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
    window.AmbientDialogue?.setNpcGreetings?.(child.id, { player: ['Hi {{name}}!', 'Hiya!', 'Look what I found!', 'Can we play later?'] });
  }

  // ── Command wheel (child at a vat) ────────────────────────────────────
  function commandOptionsFor(walker) {
    const child = fam.children.find(entry => entry.id === walker?.rec?.id);
    if (!child || phaseOf(child) !== 'child') return [];
    if (child.vatId) {
      return [{ id: 'unvat', icon: '🛑', label: 'Stop Vat Work', run: () => { window.DewVats?.setExternalWorker?.(child.vatId, null); child.vatId = null; H.persist(); H.say(walker, 'Okay! Time to play!'); } }];
    }
    const vats = (window.DewVats?.listSqueezingVats?.() || []).filter(vat => !window.DewVats.assignedWorkerForVat(vat.id));
    return [{ id: 'vat', icon: '🥛', label: 'Work the Vat', muted: !vats.length, run: () => {
      if (!vats.length) { H.toast('There is no free squeezing vat on the farm.', false); return; }
      child.vatId = vats[0].id;
      window.DewVats.setExternalWorker(child.vatId, { id: child.id, name: child.name, efficacy: num(cfg().vatEfficacyMultiplier, 2) });
      H.persist();
      H.say(walker, "I'll squeeze the dew! I'm really good at it!");
    } }];
  }

  // ── Spouse override hook (bed rest with the egg) ──────────────────────
  function spouseTargetOverride(rec, { bedSpot } = {}) {
    if (!spouseHoldingEgg() || fam.pregnancy.spouseId !== rec.id) return null;
    const bed = (bedSpot || H.bedSpot)();
    return bed ? { area: bed.area, c: bed.c, r: bed.r, rotY: bed.rotY, activity: 'keeping the egg warm in bed', stationId: 'spouse_egg_bed' } : null;
  }

  // ── UI: dream picker + naming ─────────────────────────────────────────
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
#romanceFamilyOverlay canvas{display:block;margin:0 auto 8px;width:160px;height:160px}
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
    uiOverlay.innerHTML = `<div class="rf-card">${html}</div>`;
    uiOverlay.addEventListener('keydown', event => event.stopPropagation()); // Typing a name must not drive the game.
    uiOverlay.addEventListener('keyup', event => event.stopPropagation());
    document.body.appendChild(uiOverlay);
    return uiOverlay;
  }

  async function renderPreview(canvas, choice) {
    const preview = window.NpcAvatarPreview;
    if (!canvas || !preview?.buildProfileFromNpcExport || !preview?.renderProfileToCanvas) return;
    try {
      const profile = preview.buildProfileFromNpcExport({
        name: 'dream_child',
        appearance: { speciesId: choice.speciesId, gender: choice.gender, bodyColors: choice.bodyColors, cosmetics: { ...(choice.cosmetics || {}) } },
        equippedCosmetics: [...(choice.equippedCosmetics || [])],
        appliedDyes: { ...(choice.appliedDyes || {}) },
      });
      if (profile) await preview.renderProfileToCanvas(canvas, profile);
    } catch (error) { console.warn('[RomanceFamily] child preview failed', error); }
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
      <h2>👶 Name your ${baby.gender === 'female' ? 'daughter' : 'son'}</h2>
      <p>What will you call them?</p>
      <canvas width="200" height="200" data-rf-preview></canvas>
      <input type="text" maxlength="32" autocomplete="off" spellcheck="false" data-rf-name value="${randomName(baby.speciesId, baby.gender).replace(/"/g, '')}">
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

  // ── Lifecycle ─────────────────────────────────────────────────────────
  function tick() {
    if (!R || !H) return;
    registerDoorstep();
    const day = H.rawDay();
    if (lastRawDay !== null && day !== lastRawDay) onNewDay();
    lastRawDay = day;
    ensurePlan();
    maybeAnnounce();
    for (const child of fam.children) updateChild(child);
    syncFrameSubscriber();
  }

  function init(romanceApi) {
    R = romanceApi;
    H = romanceApi.helpers;
    window.NpcScheduling?.registerTargetOverride?.('romance-family', scheduleOverride);
    window.addEventListener('hobunji-time-passage', onTimePassage);
    registerDoorstep();
    return api;
  }
  function serialize() { return JSON.parse(JSON.stringify(fam)); }
  function restore(saved) {
    fam = saved && typeof saved === 'object'
      ? { ...defaultFamily(), ...saved, children: Array.isArray(saved.children) ? saved.children.map(child => ({ ...child })) : [] }
      : defaultFamily();
    clearAnnounceTimers();
    lastRawDay = null;
    for (const child of fam.children) registerChildDialogue(child);
  }
  function snapshot() {
    return {
      pregnancy: fam.pregnancy ? { ...fam.pregnancy } : null,
      pendingAdoption: !!fam.pendingAdoption,
      children: fam.children.map(child => ({ id: child.id, name: child.name, speciesId: child.speciesId, gender: child.gender, origin: child.origin, ageDays: ageDays(child), phase: phaseOf(child), toddlingFooting: toddlingFooting(child), vatId: child.vatId, spawned: !!walkerFor(child) })),
    };
  }

  const api = {
    init, tick, serialize, restore, snapshot,
    spouseTargetOverride, commandOptionsFor, spouseHoldingEgg,
    openDreamPicker, openNamingPrompt, createChild,
    _test: { resolveKind, mixedColors, nearColors, phaseOf, toddlingFooting, childTarget, childRecord, onTimePassage, getFamily: () => fam },
  };
  window.RomanceFamily = api;
})();

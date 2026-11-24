// Newborn parenting policy for the existing RomanceFamily and shared FamilyBabyBurdens runtime.
// Kept separate from family life-cycle, NPC schedule and Shattercasks physics implementations.
(() => {
  'use strict';
  if (window.FamilyBabyCare) return;
  const lastDecision = new Map(); // Baby ID -> latest care plan for mobile debugging, not an animation tick.

  function context() { return window.RomanceFamily?.careContext?.() || null; }
  function isNewborn(child, ctx) { return ctx?.phaseOf?.(child) === 'basket'; }

  function planFor(child, ctx = context()) {
    const H = ctx?.helpers, R = ctx?.romance; // Existing family clock/romance API remains the only schedule authority.
    const spouse = R?.getSpouse?.();
    if (!isNewborn(child, ctx) || !spouse || spouse.npcId !== child.otherParentId
        || child.carryBy === 'player' || child.followPlayer || R.isOnDateWith?.(spouse.npcId)
        || R.activeSpouseOuting?.()?.npcId === spouse.npcId) return null;
    const walker = H?.findWalker?.(spouse.npcId); // Physical caregiver for same-area pickup and attachment.
    if (!walker?.root) return null;
    const hour = H.clockHour(); // 22–07 sleep, 08–18 ordinary job block, other hours at home.
    const sleeping = hour >= 22 || hour < 7;
    const workHours = hour >= 8 && hour < 18; // Spouse work hours follow the existing plot schedule, not the child's squeezing-vat shifts.
    const farmwork = workHours && !!window.NpcFarmPlots?.targetFor?.(walker.rec, { familyOnly: true }); // Only assigned crop/plot work stows a spouse-held baby on the back.
    const otherWork = workHours && !farmwork; // After work, hold the baby in arms rather than leaving a work-only back pose active.
    const slot = Math.floor(H.hourStamp() * 2); // Half-hour holds feel natural without any per-frame random rerolls.
    const takingBreak = H.hashInt(child.id + ':' + slot + ':holding-break') % 4 === 0;
    const pose = farmwork ? 'back' : !sleeping && !otherWork && !takingBreak ? 'arms' : null;
    return { child, spouse: walker, hour, farmwork, sleeping, otherWork, slot,
      pose, stayHome: hour >= 7 && hour < 22 && (hour < 8 || hour >= 18) }; // Off-schedule hours are spent with the baby.
  }

  function tick() {
    const ctx = context();
    if (!ctx?.family?.children) return;
    for (const child of ctx.family.children) {
      const plan = planFor(child, ctx);
      if (!plan) continue;
      lastDecision.set(child.id, { pose: plan.pose || 'basket', hour: plan.hour, farmwork: plan.farmwork, stayHome: plan.stayHome });
      const parent = plan.spouse, baby = ctx.walkerFor(child);
      if (plan.pose) {
        if (!baby?.root) continue; // Unloaded infants retain their family record; don't summon an off-map clone.
        if (child.carryBy !== 'spouse') {
          if (parent.area !== baby.area) continue; // Retrieve an infant from their saved safe landing spot, not only from the farmhouse.
          const dx = parent.root.position.x - baby.root.position.x;
          const dz = parent.root.position.z - baby.root.position.z;
          if (Math.hypot(dx, dz) > 2.4) continue; // The parent walks up to the basket before picking up.
        }
        window.FamilyBabyBurdens?.spouseCarry?.(child, baby, parent, plan.pose, ctx.persist);
      } else if (child.carryBy === 'spouse' && parent.area === 'interior') {
        window.FamilyBabyBurdens?.returnToBasket?.(child, ctx.basketObject(child)); // Pass the actual furniture coordinates so the real infant is seated in the cup.
      }
    }
  }

  function spouseTarget(rec, extras = {}) {
    const ctx = context();
    if (!ctx || !rec?.id) return null;
    const child = ctx.family.children.find(c => c.otherParentId === rec.id && isNewborn(c, ctx) && c.carryBy !== 'player');
    if (!child) return null; // When the player holds/stows the baby, the spouse behaves completely normally.
    const plan = planFor(child, ctx);
    if (!plan) return null;
    const needPickup = !!plan.pose && child.carryBy !== 'spouse';
    const needReturnHome = plan.sleeping && child.carryBy === 'spouse';
    if (!plan.stayHome && !needPickup && !needReturnHome) return null; // Farmwork and authored shifts keep their normal destinations.
    const landing = needPickup && child.carrySpot && window.FamilyBabyBurdens?.isAllowedArea?.(child.carrySpot.area)
      ? child.carrySpot : null; // A put-down infant may be resting in the farm or town, not in the empty cup.
    const basket = ctx.basketObject(child);
    const anchor = landing ? { area: landing.area, c: landing.c, r: landing.r }
      : basket ? { area: 'interior', c: basket.col, r: basket.row }
      : (extras.bedSpot || ctx.helpers.bedSpot)?.();
    if (!anchor) return null;
    return { ...anchor, stationId: 'spouse_newborn_care',
      activity: child.carryBy === 'spouse' ? 'caring for the baby' : 'staying close to the baby',
      wanderMode: 'radius', wanderRadiusTiles: 1 };
  }

  function commandOptionsFor(walker) {
    const ctx = context(), id = walker?.rec?.id;
    if (!ctx || !id) return [];
    const child = ctx.family.children.find(c => c.id === id && isNewborn(c, ctx));
    if (child) return [{
      id: 'hold_baby', icon: '🍼', label: 'Hold Baby',
      run: () => {
        const ok = window.FamilyBabyBurdens?.takeIntoArms?.(child, walker, ctx.persist) === true;
        if (!ok) ctx.helpers.toast?.('You need a free hand and the baby nearby.', false);
        return ok;
      },
    }]; // The real NPC radial wheel has a Hold option, never Follow.
    const newborns = ctx.family.children.filter(c => c.otherParentId === id && isNewborn(c, ctx));
    if (!newborns.length) return [];
    const options = []; // Extra commands share the ordinary hold-for-more action wheel.
    for (const baby of newborns) {
      if (baby.carryBy === 'spouse') options.push({
        id: 'hold_baby_' + baby.id, icon: '🍼', label: 'Ask to Hold ' + baby.name,
        run: () => window.FamilyBabyBurdens?.takeIntoArms?.(baby, ctx.walkerFor(baby), ctx.persist) === true,
      });
      else if (baby.carryBy === 'player' && window.Shattercasks?.heldBurdenInfo?.()?.id === 'family_baby_' + baby.id)
        options.push({ id: 'stow_baby_' + baby.id, icon: '🎒', label: 'Stow Baby on Back',
          run: () => window.Shattercasks?.stowOnBack?.() === true });
    }
    return options;
  }

  function clear() { lastDecision.clear(); }
  window.FamilyBabyCare = Object.freeze({
    tick, spouseTarget, commandOptionsFor, planFor, clear,
    snapshot: () => [...lastDecision].map(([id, value]) => ({ id, ...value })),
  });
})();

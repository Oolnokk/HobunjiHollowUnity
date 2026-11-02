// Persistent festival rules and activity handlers. UI, authored props, and NPC conversations share this authority.
(() => {
  'use strict';
  let deps = null; // Runtime-owned inventory, scene, NPC, and persistence closures.
  let state = { claims: {}, blessing: null, festivalFun: {}, funDay: null, feastBuffs: [], fullness: { stacks: 0, expiresHour: 0, durationHours: 24 }, feastBuffDurationHours: 4, potluckContests: {} }; // Per-member annual claims, pending festival relationships, isolated meal buffs and fullness.
  let pendingDance = null; // Accepted invitations let seated/solo dancers stand and approach before capturing their procedural rigs.
  let dance = null; // Session-only dance participation; leaving the dance court cancels without awarding.
  let remembrance = null; // Active Tzizkhanash observance; completing twelve played seconds earns an annual reward.
  let musicParticipation = null; // Active local music session; only actual playing earns the once-yearly music reward.
  let heldBowl = null; // Temporary ten-portion festival bowl: never added to real inventory or character saves.
  let heldCup = null; // Temporary keg cup ({swigs,capacity}): like the bowl it is never in the inventory, cannot be gifted, and refills free from the keg.
  let socialParticipationS = 0; // Counts played wheel dance/music seconds, independent of marked festival activity regions.
  let seatedMeal = null; // Runs one existing drink animation every few seconds while seated at the feast.
  let feastCache = null; // Avoid regenerating and scanning the cooking recipe list in the 60-fps action-bar path.
  let potluckRecoveryPending = false; // Completed migrations must not scan annual claims on every serving-pot/action-bar read.
  let lastTick = 0; // Low-frequency game-loop work and dance elapsed time.
  let effectiveCache = null; // Reused by activity and NPC queries until the raw map or resolved layout changes.
  let residentCache = []; // Refreshed at most once every two seconds as NPC records finish loading.
  let residentCacheAt = -Infinity; // Millisecond stamp for the resident cache.
  const costumeState = new WeakMap(); // Each walker redraws only when its event costume changes.
  let lastCostumeTick = -Infinity; // Rare costume refreshes share the existing game-loop tick.
  let lastSipSave = -Infinity; // Throttles world saves caused by NPCs sipping from the keg.
  let lastError = ''; // Copied by the mobile diagnostics panel.
  const handlers = new Map(); // Extensible activity handler registry; no second action dispatcher in the UI.
  const HOME_IDS = new Set(['ginju_farmstead', 'little_swamp_house', 'general_store', 'smithy', 'inn', 'temple', 'potion_shop', 'carpenters', 'unumanuk_household']); // Existing resident households invited to town festivities.
  const MASKS = ['gar-wolf', 'grehlr', "uumkao'ii", 'voorg-ass']; // Existing festival cosmetics, granted as normal wearable clothing.
  const STORY = [ // Placeholder prose preserves the user’s story without inventing another kingdom or protagonist.
    'When the last Mao’ao kingdom stood against the Hachutu, people feared the dark magic of their masks.',
    'One wise lad discovered that their magic had no effect on those who did not fear them.',
    'So the people wore silly masks of their own. They mocked the Hachutu’s terrible masks with ridiculous animals and laughter.',
    'They made a joke of what had frightened them, and defeated their enemy with ease. Tonight we laugh, share sweets, and practice meeting a challenge without fear.',
  ];
  function festival() { return window.FestivalCalendar.current(); }
  function year() { return window.CalendarSystem.aotYearNumber(); }
  function day() { return year() * 336 + window.FestivalCalendar.ordinal(window.CalendarSystem.monthNumber(), window.CalendarSystem.dayOfMonth()) - 1; }
  function eventKey(f = festival()) { return f ? `${year()}:${f.id}` : ''; }
  function claims(f = festival()) { return state.claims[eventKey(f)] || {}; }
  function claimed(key, f) { return !!claims(f)[key]; }
  function mark(key, value = true, f = festival()) { (state.claims[eventKey(f)] ||= {})[key] = value; }
  function commit(message) {
    deps.refresh?.();
    deps.save?.();
    window.EffectBuffBar?.refresh(true);
    window.FestivalProps?.refreshFeast?.(); // Immediately reveal the contributed sixth stew pot without rebuilding the town.
    if (message) deps.toast?.(message, true);
    return { ok: true, message };
  }
  function fail(message) { lastError = message; deps?.toast?.(message, false); return { ok: false, message }; }
  const CUP_KEY = 'festival_cup', CUP_SWIGS = 4, CUP_FUN_PER_SWIG = 20;
  const CUP_DEF = Object.freeze({ key:CUP_KEY, icon:'🍺', label:'Festival Airag', tags:Object.freeze(['Alcohol','Airag']), swigsPerBottle:CUP_SWIGS, spriteIcon:'festival-cup.png', noGift:true }); // Airag is the mildest authored spirit tier; the same strength table as bottled drink applies.
  const FOOD_PORTION_HOURS = 4; // Each festival bite adds four in-game hours of meal buffs.
  const FULLNESS_DURATION_HOURS = 24; // Fullness remains a separate 24-hour effect, independent of meal-buff portions.
  const MAX_FOOD_PORTIONS = 10; // Bowl capacity, independent meal-duration cap, and fullness stack limit.
  const FOOD_EFFECT_ICONS = { strength:'💪',fortitude:'🛡️',vigor:'⚡',speed:'🏃',perception:'👁️',clarity:'🧠',combat:'⚔️',farming:'🌾',fishing:'🎣',foraging:'🌿',cooking:'🍲',mining:'⛏️' }; // HUD fallback symbols for the cooking-system meal effects.
  function worldHour() { return day() * 24 + (Number(window.CalendarSystem?.getHour?.()) || 0); } // Used for the calendar-based festival meal and fullness windows.
  function validGatheringHours(start, end) {
    return Number.isFinite(start) && start >= 0 && start < 24
      && Number.isFinite(end) && end >= 0 && end <= 24 && start !== end;
  }
  function festivalHours() {
    const current = festival(); // A gathering window never closes shops on an ordinary day.
    if (!current) return false;
    const hour = Number(window.CalendarSystem?.getHour?.()); // Civil time shared by attendance and shop access.
    const start = Number(current.gatheringHours?.start ?? 15); // Optional per-festival civil hours, inclusive at opening.
    const end = Number(current.gatheringHours?.end ?? 1); // Exclusive end releases the normal shopkeeper schedule immediately.
    if (!Number.isFinite(hour) || hour < 0 || hour >= 24 || !validGatheringHours(start, end)) return false;
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
  }
  function gatheringHoursLabel() {
    const current = festival(); // UI and diagnostics show the same configured window that controls shop access.
    if (!current) return 'No gathering scheduled';
    const start = Number(current.gatheringHours?.start ?? 15), end = Number(current.gatheringHours?.end ?? 1); // Display-only civil-hour boundaries.
    if (!validGatheringHours(start, end)) return 'No gathering scheduled';
    const format = value => { // Formatting is used only in menus and copied diagnostics, outside the frame loop.
      const minutes = Math.round(value * 60); // Preserve authored half-hour and minute boundaries.
      return `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`;
    };
    return `${format(start)}–${format(end)}`;
  }
  function shopsClosedFor(rec) {
    return !!rec && HOME_IDS.has(rec.homeId) && !rec.visitorPresence
      && !deps?.isFestivalSuspended?.() && festivalHours();
  }
  function isRomanceable(rec) {
    return !!rec && !rec.isChild && (rec.relationship?.canDate === true
      || (window.SCRATCHBONES_CONFIG?.game?.romance?.likes?.[rec.id] || []).length > 0);
  }
  function contestIngredients(definition, stars) {
    const exact = Array.isArray(definition?.festivalIngredientQuality) && definition.festivalIngredientQuality.length;
    const entries = exact ? definition.festivalIngredientQuality : (definition?.ingredientKeys || []).map(key=>({key,stars})); // Legacy dishes know their ingredient keys but not their input tiers.
    const recipe = window.HobunjiCookingData?.recipes?.find(item=>item.id === definition?.recipeId); // Restore structural/no-buff slot rules for old cooked item definitions.
    const orderedSlots = recipe?.slots?.length === entries.length ? recipe.slots : null;
    const ingredients = entries.map((item,index) => {
      const slot = recipe?.slots?.find(candidate => candidate.id === item.slotId) || orderedSlots?.[index];
      return {key:item.key,stars:item.stars,slotId:item.slotId || slot?.id,
        contributesEffects:typeof item.contributesEffects === 'boolean' ? item.contributesEffects : slot?.contributesEffects !== false};
    }); // True input-star data is preserved, and the original cooking recipe decides whether each ingredient grants a buff.
    return {ingredients,estimated:!exact,
      estimatedEffects:ingredients.some((item,index)=>entries[index]?.contributesEffects === undefined &&
        !(entries[index]?.slotId || orderedSlots))}; // Warn when the original slot's behavior cannot be reconstructed.
  }
  function contestData() {
    const key = year() + ':gorkunash'; // Stable seven-day result is member/world-owned and survives all sleeps and reloads.
    const cached = state.potluckContests[key];
    if (cached) return cached;
    const guests = residents(); // Never freeze an empty resident list during initial asset/NPC loading.
    if (!guests.length || !window.FestivalPotluckContest) return null;
    const created = { days:window.FestivalPotluckContest.buildDays(guests,year(),deps?.getItemDefs?.() || {}),entry:null,rewarded:false };
    state.potluckContests[key] = created;
    deps?.save?.(); // The original opponent rolls are persisted before a contribution can be accepted.
    return created;
  }
  function recoverPotluckEntries() {
    if (!potluckRecoveryPending || !deps || !window.FestivalPotluckContest) return;
    const defs = deps.getItemDefs?.() || {};
    let changed = false;
    let retry = false;
    for (const [event, annualClaims] of Object.entries(state.claims)) {
      const match = /^(\d+):gorkunash$/.exec(event);
      const donated = annualClaims?.potluck;
      if (!match || !donated || state.potluckContests[event]?.entry) continue;
      const definition = defs[donated.key];
      if (!definition?.isCookedFood) { retry = true; continue; } // Cooking definitions hydrate after festivals; retry rather than saving a guessed score.
      let contest = state.potluckContests[event];
      if (!contest) {
        const guests = residents();
        if (!guests.length) { retry = true; continue; } // Preserve the claim until real residents are ready to generate its original-year roster.
        contest = state.potluckContests[event] = { days:window.FestivalPotluckContest.buildDays(guests,Number(match[1]),defs),entry:null,rewarded:false };
      }
      const snapshot = contestIngredients(definition,donated.stars); // Recover legacy donations without rewriting their recorded contest result.
      contest.entry = { key:donated.key,stars:donated.stars,label:definition.label || donated.key,
        score:window.FestivalPotluckContest.scoreCooked(definition,donated.stars,defs),
        ingredients:snapshot.ingredients,estimatedQuality:snapshot.estimated,
        estimatedEffects:snapshot.estimatedEffects,foodEffects:{...(definition.foodEffects||{})} };
      changed = true;
    }
    potluckRecoveryPending = retry;
    if (changed) deps.save?.(); // One save after recovery, including overdue claims from previous civil years.
  }
  function feastMenu() {
    if (festival()?.id !== 'gorkunash') return [];
    recoverPotluckEntries();
    const contest = contestData();
    if (contest?.entry && (!Array.isArray(contest.entry.ingredients) ||
        contest.entry.ingredients.some(item=>typeof item.contributesEffects !== 'boolean') ||
        contest.entry.foodEffects === undefined)) {
      const entry = contest.entry; // Upgrade entries saved by earlier versions of this PR without rerolling their contest totals.
      const definition = deps?.getItemDefs?.()?.[entry.key] || {};
      const source = Array.isArray(entry.ingredients) && entry.ingredients.length
        ? {...definition,festivalIngredientQuality:entry.ingredients} : definition;
      const snapshot = contestIngredients(source,entry.stars);
      entry.ingredients = snapshot.ingredients;
      entry.estimatedQuality = entry.estimatedQuality ?? snapshot.estimated;
      entry.estimatedEffects = snapshot.estimatedEffects;
      entry.foodEffects ||= {...(definition.foodEffects || {})}; // An older saved contest entry may not have persisted its exact buff payload.
      deps?.save?.();
    }
    const offset = Math.max(0,Math.min(6,day() - (year()*336 + 4*28 + 8 - 1)));
    const key = day() + ':' + (contest ? 'roster' : 'loading') + ':' + (contest?.entry?.key || 'none');
    if (feastCache?.key === key && feastCache.contest === contest) return feastCache.menu;
    const days = contest?.days || window.FestivalPotluckContest?.buildDays?.([], year(), deps?.getItemDefs?.() || {}) || [];
    const defs = deps?.getItemDefs?.() || {};
    const dishes = (days[offset] || []).map(dish => ({
      ...dish, ingredients:dish.ingredients || [],
      foodEffects:window.FestivalPotluckContest?.mealEffects?.(dish.ingredients,defs) || dish.foodEffects || {},
    })); // Recalculate legacy saved NPC buffs with the canonical quality/processing rules, once per day.
    const entry = contest?.entry;
    const definition = entry && deps?.getItemDefs?.()?.[entry.key];
    dishes.push(entry ? { id:'player:' + entry.key,label:"Your " + entry.label,owner:'You',dish:entry.label,
      icon:definition?.icon || '🍲',score:entry.score,
      ingredients:entry.ingredients || definition?.festivalIngredientQuality || [],
      estimatedQuality:!!entry.estimatedQuality,estimatedEffects:!!entry.estimatedEffects,
      foodEffects:{...(entry.foodEffects || definition?.foodEffects || {})} }
      : { id:'reserved',label:'Your contest entry (empty)',owner:'You',dish:'Awaiting entry',
        icon:'🍲',score:0,foodEffects:{},ingredients:[] });
    feastCache = { key,contest,menu:dishes };
    return dishes;
  }
  function feastDishDetails(index) {
    const dishes = feastMenu(); // A bounded, saved seven-pot menu rather than another recipe or item catalog search.
    const safeIndex = Number(index);
    if (!Number.isInteger(safeIndex) || safeIndex < 0 || safeIndex >= dishes.length) return null;
    const meal = dishes[safeIndex];
    if (!meal) return null;
    return { ...meal, index:safeIndex,
      ingredientDetails:window.FestivalPotluckContest?.ingredientBreakdown?.(meal.ingredients,deps?.getItemDefs?.() || {}) || [] };
  }
  function contestStandings() {
    const record = contestData();
    if (!record) return null;
    const visibleDay = Math.min(7,Math.max(1,day()-(year()*336+4*28+8-1)+1)); // Current scoreboard cannot reveal future festival entries.
    const rivals = record.days.slice(0,visibleDay).flat();
    const champion = rivals.reduce((best,entry)=>entry.score > (best?.score ?? -1) ? entry : best,null);
    return { entry:record.entry, strongest:champion,
      winning:record.entry ? record.entry.score >= (champion?.score || 0) : false,
      rewarded:record.rewarded, day:visibleDay };
  }
  function currentFullness() {
    const full = state.fullness || {stacks:0,expiresHour:0,durationHours:FULLNESS_DURATION_HOURS};
    return worldHour() < full.expiresHour ? Math.max(0,Math.min(10,Number(full.stacks)||0)) : 0;
  }
  function foodDurationEntries() {
    const now = worldHour(); // Festival food effects use the same pausable calendar clock as ordinary cooked meals.
    return (state.feastBuffs || []).filter(entry => entry.expiresHour > now).map(entry => ({
      key:`festival-meal:${entry.id}`,label:entry.label,icon:entry.icon||'🍲',
      sourceLabel:'Gorkunash meal',kind:'boon',stacks:entry.portions,
      durationS:FOOD_PORTION_HOURS*MAX_FOOD_PORTIONS*3600,remainingS:(entry.expiresHour-now)*3600,
      fractionLabel:`${Math.ceil(entry.expiresHour-now)}h/${FOOD_PORTION_HOURS*MAX_FOOD_PORTIONS}h`,
    })).concat(currentFullness() ? [{
      key:'festival-fullness',label:'Fullness',icon:'🥣',kind:'bane',sourceLabel:'Gorkunash',
      stacks:currentFullness(),durationS:FULLNESS_DURATION_HOURS*3600,remainingS:Math.max(1,(state.fullness.expiresHour-worldHour())*3600),
    }] : []);
  }
  function festivalFoodStacks(effectKey) {
    const now=worldHour(); // Festival meal bonuses expire only as the in-game calendar advances.
    return (state.feastBuffs||[]).filter(entry=>entry.expiresHour>now).reduce((total,entry)=>total+(Number(entry.foodEffects?.[effectKey])||0),0);
  }
  function festivalBowl() { return heldBowl ? { ...heldBowl } : null; }
  function festivalCup() { return heldCup ? { ...heldCup } : null; }
  // The one temporary vessel currently shown in the player's hand (cup or bowl), in the held-item shape game.js renders.
  function heldVessel() {
    if (heldCup) return { key:CUP_KEY, icon:CUP_DEF.icon, label:CUP_DEF.label, spriteIcon:CUP_DEF.spriteIcon };
    if (heldBowl) return { key:'festival_bowl', icon:'🥣', label:heldBowl.meal?.label || 'Festival Bowl', spriteIcon:'festival-bowl.png' };
    return null;
  }
  function vesselDef(key) {
    if (key === CUP_KEY) return { key, icon:CUP_DEF.icon, label:CUP_DEF.label, spriteIcon:CUP_DEF.spriteIcon };
    return key === 'festival_bowl' ? { key, icon:'🥣', label:'Meal Bowl', spriteIcon:'festival-bowl.png' } : null;
  }
  function discardFestivalBowl(reason = 'equipment-changed') {
    if(!heldBowl && !seatedMeal && !heldCup)return false;
    heldBowl=null; heldCup=null; seatedMeal=null;
    deps?.cancelFestivalDrink?.(); // Removes the short-lived serving sprite immediately when drawing equipment.
    deps?.refresh?.();
    window.__farmLog?.(`[festival] Temporary bowl/cup put away: ${reason}`, 'items');
    return true;
  }
  function aimedServingObject() {
    const target = window.FurnitureTableSystem?.aimedService?.(deps?.getArea?.(), deps?.getAimPosition?.()); // Actual furniture surface target, shared with ordinary world input.
    return target?.entry.record.serviceId === 'gorkunash-feast' ? target : null;
  }
  function potIndexAtAim() { const target = aimedServingObject(); return target?.placement.service.kind === 'meal' ? Number(target.placement.service.index) : -1; }
  function isDiningSeat(col, row) { return !!window.FurnitureTableSystem?.tableForSeat?.(deps?.getArea?.(), { col, row }); }
  function seatedMealAction() {
    if(deps?.isPlayerSeated?.()===false)return null;
    if(!heldBowl?.meal || !heldBowl.uses || festival()?.id!=='gorkunash'||!festivalHours())return null;
    return {icon:'🥣',label:seatedMeal?'Stop eating':`Eat ${heldBowl.meal.label}`,action:'obj_eat_meal',style:'secondary',allowed:true,swigFraction:`${heldBowl.uses}/${MAX_FOOD_PORTIONS}`};
  }
  function toggleSeatedMeal() {
    if(seatedMeal){seatedMeal=null;return commit('Finished eating for now.');}
    if(!heldBowl?.meal||!heldBowl.uses||!festivalHours()||deps?.isPlayerSeated?.()===false)
      return fail('Sit on a chair with a filled bowl to eat.');
    if(currentFullness()>=MAX_FOOD_PORTIONS)return fail('You are already full.');
    seatedMeal={nextAt:0,animating:false}; // The existing drink pose animation commits each individual bite, not the action-button tap.
    return commit('Eating from the bowl.');
  }
  // The keg hands out a free, already-filled cup whenever asked; a held cup is simply topped up again.
  function takeOrRefillCup() {
    registerCupProvider();
    if (festival()?.id!=='gorkunash'||!festivalHours()) return fail('The keg is closed.');
    if (heldBowl||seatedMeal) discardFestivalBowl('took-a-cup'); // One vessel in hand at a time.
    const refill = !!heldCup;
    heldCup = { swigs:CUP_SWIGS, capacity:CUP_SWIGS, selectedItemKey:heldCup?.selectedItemKey ?? (deps?.getActiveItemKey?.()||'') };
    deps?.equipFestivalBowl?.();
    return commit(refill ? `Topped up your cup (${CUP_SWIGS}/${CUP_SWIGS}). The keg is free.` : `Took a cup of ${CUP_DEF.label} (${CUP_SWIGS}/${CUP_SWIGS}). Refill whenever you like; offer swigs to share the fun.`);
  }
  function bowlPileInReach() { return aimedServingObject()?.placement.service.kind === 'bowls'; }
  function takeFestivalBowl() {
    if (festival()?.id!=='gorkunash'||!festivalHours()||!bowlPileInReach()) return fail('Aim at the stack of bowls to take one.');
    discardFestivalBowl('new-bowl');
    heldBowl={meal:null,uses:0,capacity:MAX_FOOD_PORTIONS,selectedItemKey:deps?.getActiveItemKey?.()||''};
    deps?.equipFestivalBowl?.();
    return commit('Picked up a bowl. Aim at a serving pot to fill it.');
  }
  function fillFestivalBowl(index) {
    if (festival()?.id!=='gorkunash'||!festivalHours()||!heldBowl||potIndexAtAim()!==index) return fail('Hold a festival bowl beside the feast table.');
    const meal=feastMenu()[index];
    if (!meal || meal.id === 'reserved') return fail('That pot is waiting for your contest entry.');
    const selectedItemKey=heldBowl.selectedItemKey;
    heldBowl={meal,uses:MAX_FOOD_PORTIONS,capacity:MAX_FOOD_PORTIONS,selectedItemKey};
    return commit(`Filled the bowl with ${meal.label} (10/10 portions).`);
  }
  function eatFestivalBowl() {
    if (!heldBowl?.meal||heldBowl.uses<1||!festivalHours()||deps?.isPlayerSeated?.()===false) return fail('Sit on a chair with a filled bowl.');
    if (currentFullness()>=MAX_FOOD_PORTIONS) return fail('You are full. The fullness effect fades 24 in-game hours after its first serving.');
    const meal=heldBowl.meal;
    const now=worldHour(); // Every serving transfers all active meal-buff time to the newly eaten food.
    const activeBuffs=(state.feastBuffs||[]).filter(entry=>entry.expiresHour>now);
    const remainingHours=activeBuffs.reduce((total,entry)=>total+Math.max(0,entry.expiresHour-now),0);
    const hours=Math.min(MAX_FOOD_PORTIONS*FOOD_PORTION_HOURS,remainingHours+FOOD_PORTION_HOURS);
    state.feastBuffs=[{ id:meal.id,label:meal.label,icon:meal.icon,foodEffects:meal.foodEffects,portions:Math.max(1,Math.min(MAX_FOOD_PORTIONS,Math.ceil(hours/FOOD_PORTION_HOURS))),expiresHour:now+hours }];
    if (!currentFullness()) state.fullness={stacks:0,expiresHour:worldHour()+FULLNESS_DURATION_HOURS,durationHours:FULLNESS_DURATION_HOURS};
    state.fullness.stacks++;
    heldBowl.uses--;
    if (!heldBowl.uses){heldBowl={meal:null,uses:0,capacity:MAX_FOOD_PORTIONS,selectedItemKey:heldBowl.selectedItemKey};seatedMeal=null;}
    const dinerSeat=deps?.getPlayerSeatedSeat?.(); // Normal seating feeds the shared table member array.
    const table=window.FurnitureTableSystem?.tableForSeat?.(deps.getArea(), dinerSeat);
    const diners=table ? (window.FurnitureTableSystem.members(deps.getArea(), table.id) || []).filter(member=>member.id!=='player') : [];
    for(const member of diners) addFestivalFun(member.id,25);
    return commit(`${meal.label}: +${FOOD_PORTION_HOURS} in-game hours of meal effects; fullness ${currentFullness()}/10; ${diners.length} tablemates gain 25 Festival Fun.`);
  }
  function addFestivalFun(id,amount) {
    if (!id || !Number.isFinite(amount)||amount<=0) return;
    state.festivalFun[id]=(Number(state.festivalFun[id])||0)+amount;
    window.WorldPopupText?.queueSocialGain?.('festivalFun',amount,id);
  }
  function settleFestivalFun() {
    if (!deps || !window.CalendarSystem?.isInitialized?.()) return;
    const today=day();
    if (!Number.isFinite(state.funDay)) {state.funDay=today;return;}
    if (today<=state.funDay) return;
    const awarded=[];
    for(const [id,raw] of Object.entries(state.festivalFun||{})) {
      const hearts=Math.floor(Math.max(0,Number(raw)||0)/200);
      if(!hearts)continue;
      giveFavor(id,hearts*40,'fun_rollover');
      state.festivalFun[id]-=hearts*200;
      awarded.push(`${id} +${hearts} heart${hearts===1?'':'s'}`);
    }
    state.funDay=today;
    if(awarded.length)commit(`Festival Fun converted overnight: ${awarded.join(', ')}.`);
  }
  function danceStartMessage() {
    const code=window.FestivalWheelDanceRuntime?.diagnostics?.()?.lastStartFailure?.code; // Report the real start gate instead of attributing every failure to room.
    if(code==='too-far')return 'Come a little closer to your dance partner.';
    if(code==='different-floor-height')return 'Stand on the same level as your dance partner.';
    if(code==='camera-busy')return 'Finish the current camera scene before dancing.';
    if(code==='already-dancing')return 'Finish your current dance first.';
    if(code==='anatomical-reach'||code==='invalid-rig-scale')return 'The paired pose could not fit these dancers. The dance diagnostics have the details.';
    return 'The dance animation is not ready yet. Please try again in a moment.';
  }
  function beginPairedDance(walker) {
    if(dance||!window.FestivalWheelDanceRuntime?.start?.(walker,deps.getPlayerMesh?.()))return false;
    dance={propId:null,event:eventKey(),elapsed:0,targetNpcId:walker.rec.id,awardTime:0,awardedSeconds:0};
    window.HobunjiActivityEvents?.emit?.('dance_together',{npcId:walker.rec.id});
    return true;
  }
  function clearPendingDance() { if(!pendingDance)return; pendingDance=null;window.WorldActionInputClaims?.clearClaims?.('dance-invitation');deps?.refreshActions?.(); }
  function askFestivalDance(walker) {
    const id=walker?.rec?.id;
    if (festival()?.id!=='gorkunash'||!festivalHours()||deps?.isFestivalSuspended?.()||!isRomanceable(walker?.rec)
      ||walker.area!=='town'||!walker.root?.position||!deps?.getPlayerTile?.())return fail('Approach someone you would like to dance with.');
    if(dance||pendingDance)return fail('Finish your current dance invitation first.');
    const player=deps.getPlayerTile(), reach=Number(window.SCRATCHBONES_CONFIG?.game?.movement?.npc?.socialInteractionRadiusTiles)||6;
    if(Math.hypot(player.c-walker.root.position.x,player.r-walker.root.position.z)>reach)return fail('Approach your dance partner.');
    const accepted=favorHearts(id)>=3||(favorHearts(id)>=1&&(window.NpcRapport?.get?.(id)||0)>200);
    const response=window.AmbientDialogue?.showSocialResponse || window.AmbientDialogue?.showAlcoholOfferResponse;
    if(!accepted){response?.(walker,{text:'Perhaps another time.',accepted:false,reason:'dance'});return fail('Your invitation was politely declined.');}
    window.SocialActionWheel?.stopDance?.('paired-invitation'); // Transition an existing solo dance into the requested pair.
    if(deps.prepareDance) {
      deps.prepareDance(walker);
      pendingDance={walker,targetNpcId:id,event:eventKey(),remaining:20,settleS:0,followSession:{mode:'follow'},
        waitTarget:{area:walker.area,c:walker.root.position.x-.5,r:walker.root.position.z-.5,pose:'stand'}};
      window.WorldActionInputClaims?.setClaims?.('dance-invitation',['dodge','action2'].map(actionId=>({actionId,label:'Cancel dance invitation',priority:600,onPress:cancelDance})));
      response?.(walker,{text:'I would be delighted. Let me get ready.',accepted:true,reason:'dance'});
      return commit(`Getting ready to dance with ${walker.rec.name||id}. Dodge or Action 2 cancels.`);
    }
    if(!beginPairedDance(walker))return fail(danceStartMessage());
    response?.(walker,{text:'I would be delighted to dance.',accepted:true,reason:'dance'});
    return commit(`Dancing with ${walker.rec.name||id}: 15 Festival Fun per second while you remain together.`);
  }
  function updateDanceInvitation(elapsed) {
    if(!pendingDance)return;
    const invitation=pendingDance,walker=invitation.walker; // This invitation alone owns the temporary approach target.
    if(eventKey()!==invitation.event||!festivalHours()||deps.isFestivalSuspended?.()||deps.getArea?.()!=='town'||walker.area!=='town'||walker.rec.dead||!walker.root?.parent||deps.isBlocked?.()) {clearPendingDance();return;}
    if(deps.socialPaused?.()||document.hidden)return;
    invitation.remaining-=elapsed;invitation.settleS+=elapsed;
    if(invitation.remaining<=0){clearPendingDance();fail(danceStartMessage());return;}
    if(invitation.settleS<.4||deps.canStartDance?.()===false||walker.currentScheduleTarget?.pose==='sit')return;
    const player=deps.getPlayerTile();
    if(Math.hypot(player.c-walker.root.position.x,player.r-walker.root.position.z)>3.5)return;
    if(beginPairedDance(walker)){clearPendingDance();commit(`Dancing with ${walker.rec.name||walker.rec.id}.`);return;}
    const code=window.FestivalWheelDanceRuntime?.diagnostics?.()?.lastStartFailure?.code;
    if(['anatomical-reach','nonuniform-rig-scale','different-floor-height','partner-unavailable'].includes(code)){clearPendingDance();fail(danceStartMessage());}
  }

  function socialOptionsFor(walker) {
    return festival()?.id==='gorkunash' && festivalHours() && isRomanceable(walker?.rec) && walker.area==='town'
      ? [{id:'dance-together',icon:'💃',label:'Ask to dance',run:()=>askFestivalDance(walker)}] : [];
  }
  function registerActivity(id, handler) { if (id && typeof handler === 'function') { handlers.set(id, handler); return true; } return false; }
  function rawMap() { return deps?.getTownMap?.() || null; }
  function layout() {
    const raw = rawMap(); // Preserve the edited map identity so live reflection invalidates this cache.
    const id = window.MapLayoutSystem?.resolveActiveLayout(raw)?.id || 'default';
    if (!effectiveCache || effectiveCache.raw !== raw || effectiveCache.id !== id) effectiveCache = { raw, id, data: window.MapLayoutSystem?.getEffectiveMapData(raw) };
    return effectiveCache.data;
  }
  function activityProps() { return (layout()?.decor || []).filter(p => p.activity?.type && festival()?.activities.includes(p.activity.type)); }
  function propCenter(prop) {
    const size = deps?.getDecorSize?.(prop.key) || {}; // Matches makeDecorativeFurnitureMesh's unrotated placement anchor.
    return { c: prop.col + (size.fw || 1) * .5 + (Number(prop.postX) || 0), r: prop.row + (size.fd || 1) * .5 + (Number(prop.postZ) || 0) };
  }
  function atProp(prop) {
    if (!deps || deps.getArea() !== 'town' || !prop) return false;
    const position = deps.getPlayerTile(); // Same placement offsets as TownZoneBuildings.
    const center = propCenter(prop); // Activity and rendered furniture share exactly one center.
    return Math.hypot(position.c - center.c, position.r - center.r) <= Math.max(1, Math.min(8, Number(prop.activity?.radius) || 2.5));
  }
  function nearestActivity() {
    if (!festival() || deps?.isBlocked?.()) return null;
    const position = deps.getPlayerTile(); // Sort the few activity anchors, never scene-traverse.
    const distance = prop => { const center = propCenter(prop); return Math.hypot(position.c - center.c, position.r - center.r); }; // Use the rendered center for differently sized tables and rugs.
    return activityProps().filter(atProp).sort((a, b) => distance(a) - distance(b))[0] || null;
  }
  function actionButton() {
    if (dance||pendingDance||remembrance) return { icon: '■', label: remembrance?'Stop remembering':pendingDance?'Cancel invitation':'Stop dancing', action: 'festival_stop_dance', allowed: true, style: 'secondary' };
    if (festival()?.id === 'gorkunash') return null; // Schedules and ordinary objects provide the event; there is no event/activity input.
    const prop = nearestActivity(); // Activity remains tied to the prop when moved in the editor.
    if (prop?.festivalLocale && ['dance','story','duel','music','remembrance'].includes(prop.activity.type)
        && (!festivalHours() || (['story','duel'].includes(prop.activity.type) && Number(window.CalendarSystem?.getHour?.()) >= 22))) return null;
    return prop ? { icon: festival().icon, label: prop.festivalLocale && ['dance','story','duel','music','remembrance'].includes(prop.activity.type)
      ? 'Join ' + (prop.activity.label || window.FestivalCalendar.activityLabels[prop.activity.type])
      : prop.activity.label || window.FestivalCalendar.activityLabels[prop.activity.type],
      action: 'festival_activity', allowed: true, style: 'primary' } : null;
  }
  function npcRewardAction(walker) {
    if (!walker?.rec?.id || deps?.isBlocked?.()) return null;
    // Reuse the existing secondary NPC festival action route; game.js already
    // dispatches festival_npc_gift to receiveNpcReward on every input platform.
    if(festival()?.id==='gorkunash')return null;
    const id = walker.rec.id; // Same annual claims as the gift table, so the two routes cannot duplicate rewards.
    if (festival()?.id === 'mountaindawn' && favorHearts(id) >= 3 && !claimed(`gift:${id}`)) return { icon: '🎁', label: 'Receive Mountaindawn gift', action: 'festival_npc_gift', style: 'secondary', allowed: true };
    if (festival()?.id === 'hachutukara' && residents().some(rec => rec.id === id) && !claimed(`sweet:${id}`)) return { icon: '🍬', label: 'Ask for sweets', action: 'festival_npc_sweet', style: 'secondary', allowed: true };
    return null;
  }
  function receiveNpcReward(walker, action) {
    const offer = npcRewardAction(walker); // Do not trust an old action-bar button after a date, NPC, or favor change.
    const position = deps?.getPlayerTile?.();
    if (!offer || offer.action !== action || walker.area !== deps.getArea() || !walker.root?.position || Math.hypot(position.c - walker.root.position.x, position.r - walker.root.position.z) > 3) return fail('Move closer to your friend to receive their gift.');
    if(festival()?.id==='gorkunash'&&action==='festival_npc_gift')return askFestivalDance(walker);
    return handlers.get(action === 'festival_npc_gift' ? 'gifts' : 'sweets')({ npcId: walker.rec.id });
  }
  function perform(type, payload = {}) {
    const f = festival(); // Recheck everything on commit, including stale UI after midnight or travel.
    const prop = activityProps().find(p => p.id === payload.propId && p.activity.type === type);
    if (!f || !f.activities.includes(type) || !atProp(prop) || deps?.isBlocked?.()) return fail('Return to this festival activity area to take part.');
    const handler = handlers.get(type); // Mechanics are reusable independently of any particular holiday.
    if (!handler) return fail('This activity is unavailable.');
    return handler(payload, prop, f);
  }
  function residents() {
    if (performance.now() - residentCacheAt >= 2000) { residentCache = (deps?.getNpcs?.() || []).filter(rec => HOME_IDS.has(rec.homeId) && !rec.deceased && !rec.dead && !String(rec.role || '').includes('deceased')); residentCacheAt = performance.now(); }
    return residentCache;
  }
  function favorHearts(id) { return window.NpcFavorBalance?.relationshipHeartsForNpc?.(id) ?? (Number(window.DialogueContent?.getNpcDlgState?.(id)?.favor) || 0) / 40; }
  function giveFavor(id, amount, reason) { return window.DialogueContent?.adjustNpcFavor?.(id, amount, `festival_${reason}`); }
  function allFavor(amount, reason) { for (const rec of residents()) giveFavor(rec.id, amount, reason); }
  function grantItem(key, count = 1, stars = 3) {
    if (!key || !deps.getItemDefs()[key] || !Number.isInteger(count) || count <= 0) return false;
    const owned = Number(deps.inventory[key]) || 0; // Preflight capacity before consuming a claim.
    if (owned + count > (window.InventoryStacks?.MAX_TOTAL || 9999)) return false;
    deps.inventory[key] = owned + count;
    window.CookingSystem?.recordItemQuality?.(key, stars, count);
    return true;
  }
  function qualityChoices(kind) {
    return Object.entries(deps?.inventory || {}).filter(([key, count]) => {
      const def = deps.getItemDefs()[key]; // Only physical giftable items; coins/equipment/quest objects cannot become offerings.
      return count > 0 && def && (kind === 'potluck' ? def.isCookedFood : key !== 'gold' && !def.questItem && !def.isQuestItem && !def.isBlueprint && !def.isTool && window.NpcGifting?.isItemGiftable?.({ key, kind: 'item' }));
    }).flatMap(([key]) => (window.CookingSystem?.availableQualityEntries?.(key) || []).map(entry => ({ ...entry, key, label: deps.getItemDefs()[key].label || key })));
  }
  function consumeChoice(kind, payload) {
    if (!qualityChoices(kind).some(choice => choice.key === payload.key && choice.stars === payload.stars && choice.count >= 1)) return false;
    return window.CookingSystem.consumeQuality(payload.key, payload.stars, 1);
  }
  function giftMultiplier() { return festival()?.id === 'mountaindawn' ? 2 : 1; }
  function blessingMultiplier(stat) {
    if (!window.CalendarSystem?.isInitialized?.()) return 1;
    const buff = state.blessing; // Date-based expiry survives sleeping, reloading, year boundaries, and character switches.
    const def = window.FestivalCalendar.blessings[stat];
    return buff?.stat === stat && def && Number.isFinite(buff.expiresDay) && day() < buff.expiresDay ? 1 + Math.min(5, Math.max(1, buff.level)) * def.perLevel : 1;
  }
  function buffEntries() {
    const buff = state.blessing; // EffectBuffBar handles display alongside food and alchemy.
    if (!deps || !window.CalendarSystem?.isInitialized?.() || !buff || day() >= buff.expiresDay) return [];
    const def = window.FestivalCalendar.blessings[buff.stat];
    return def ? [{ key: 'ancestor-blessing', label: `${def.label} ${buff.level} · ${Math.ceil(buff.expiresDay - day())} days`, icon: def.icon, sourceLabel: 'Ancestor offering', durationS: 336, remainingS: buff.expiresDay - day(), stacks: buff.level }] : [];
  }
  function serialize() {
    const copy=JSON.parse(JSON.stringify(state));
    const now=worldHour(); // Persist festival food time in calendar-hours rather than page-session seconds.
    copy.feastBuffDurationHours=FOOD_PORTION_HOURS; // Save the timer schema so old 24-hour-per-portion saves migrate exactly once.
    copy.feastBuffs=(state.feastBuffs||[]).map(entry=>({...entry,remainingHours:Math.max(0,entry.expiresHour-now)})).filter(entry=>entry.remainingHours>0);
    return copy;
  }
  function restore(saved) {
    residentCacheAt = -Infinity; effectiveCache = null;
    state = { claims: {}, blessing: null, festivalFun: {}, funDay: null, feastBuffs: [], fullness:{stacks:0,expiresHour:0,durationHours:FULLNESS_DURATION_HOURS}, feastBuffDurationHours:FOOD_PORTION_HOURS, potluckContests:{} };
    heldBowl=null; seatedMeal=null; feastCache=null; remembrance=null; musicParticipation=null;
    window.NpcSharedMeals?.clear?.();
    window.FestivalLocaleActivities?.clear?.();
    if(saved?.festivalFun&&typeof saved.festivalFun==='object')for(const [id,points] of Object.entries(saved.festivalFun))if(/^[a-z0-9_-]+$/i.test(id)&&Number.isFinite(points))state.festivalFun[id]=Math.max(0,points);
    if(Number.isFinite(saved?.funDay))state.funDay=saved.funDay;
    if(Number.isFinite(saved?.fullness?.expiresHour)&&Number.isFinite(saved?.fullness?.stacks)) {
      const stacks=Math.max(0,Math.min(10,saved.fullness.stacks));
      const stillActive=saved.fullness.expiresHour>worldHour()&&stacks>0;
      const legacyDuration=Number(saved.fullness.durationHours)!==FULLNESS_DURATION_HOURS;
      state.fullness={stacks,expiresHour:stillActive&&legacyDuration?worldHour()+FULLNESS_DURATION_HOURS:saved.fullness.expiresHour,durationHours:FULLNESS_DURATION_HOURS};
    }
    const now=worldHour(); // Restore exact calendar-hour timers and migrate old 24-hour portions once.
    const savedPortionHours=Number(saved?.feastBuffDurationHours);
    const migrateLegacyPortions=savedPortionHours!==FOOD_PORTION_HOURS;
    const restoredBuffs=(Array.isArray(saved?.feastBuffs)?saved.feastBuffs:[]).filter(entry=>entry && (Number(entry.remainingHours)>0 || Number(entry.remainingS)>0))
      .slice(0,24).map(entry=>{
        const portions=Math.max(1,Math.min(MAX_FOOD_PORTIONS,Number(entry.portions)||1));
        const storedHours=Number(entry.remainingHours);
        const remainingHours=Number.isFinite(storedHours)
          ? Math.min(FOOD_PORTION_HOURS*MAX_FOOD_PORTIONS,migrateLegacyPortions ? storedHours*(FOOD_PORTION_HOURS/24) : storedHours)
          : portions*FOOD_PORTION_HOURS; // Legacy real-time saves have no calendar timer; grant four hours per recorded portion.
        return {...entry,portions:Math.max(1,Math.min(MAX_FOOD_PORTIONS,Math.ceil(remainingHours/FOOD_PORTION_HOURS))),expiresHour:now+remainingHours};
      });
    if(restoredBuffs.length) {
      const latestBuff=restoredBuffs[restoredBuffs.length-1]; // Older saves may contain separate meal timers; keep the newest meal's effects.
      const combinedHours=Math.min(FOOD_PORTION_HOURS*MAX_FOOD_PORTIONS,restoredBuffs.reduce((total,entry)=>total+Math.max(0,entry.expiresHour-now),0));
      state.feastBuffs=[{...latestBuff,portions:Math.max(1,Math.min(MAX_FOOD_PORTIONS,Math.ceil(combinedHours/FOOD_PORTION_HOURS))),expiresHour:now+combinedHours}];
    }
    state.feastBuffDurationHours=FOOD_PORTION_HOURS;
    if (saved?.claims && typeof saved.claims === 'object' && !Array.isArray(saved.claims)) {
      for (const [key, value] of Object.entries(saved.claims)) if (/^\d+:[a-z_]+$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) state.claims[key] = { ...value };
    }
    if (saved?.potluckContests && typeof saved.potluckContests === 'object') {
      for (const [key,value] of Object.entries(saved.potluckContests)) {
        if (!/^\d+:gorkunash$/.test(key) || !Array.isArray(value?.days) || value.days.length !== 7) continue;
        state.potluckContests[key] = {days:value.days.map(d=>Array.isArray(d)?d.slice(0,6):[]),
          entry:value.entry || null,rewarded:!!value.rewarded};
      }
    }
    if (window.FestivalCalendar.blessings[saved?.blessing?.stat] && Number.isFinite(saved.blessing.expiresDay) && Number.isFinite(saved.blessing.level)) state.blessing = { stat: saved.blessing.stat, level: Math.max(1, Math.min(5, Math.trunc(saved.blessing.level))), expiresDay: saved.blessing.expiresDay };
    potluckRecoveryPending = true; // Recheck only the newly restored member's annual claims; resolved entries remain untouched.
    cancelDance();
    window.FestivalProps?.refreshFeast?.();
    window.FestivalUI?.close?.();
  }
  function musicPlaying() { // A musician is physically performing in town (or the player is playing there): the only time anyone dances.
    if (window.MusicMinigame?.state?.active && deps?.getArea?.()==='town') return true;
    return (window.NpcScheduling?.listInstrumentPerformers?.()||[]).some(p=>p.area==='town');
  }
  // The regular town soundtrack gives way to the live band for Gorkunash's gathering hours (15:00 inclusive to 01:00 exclusive).
  function silencesTownMusic(area) {
    if (area !== 'town' && area !== 'map_hobunji_town') return false;
    return festival()?.id === 'gorkunash' && festivalHours();
  }
  const gatheringAssignments = new Map(); // Stable per-shift destinations avoid aliasing occupied stations or flickering between locales.
  function musicianAbsent(id) { // Dead, or not loaded at all: the other musician must cover so the festival is never silent.
    const rec = (deps.getNpcs?.()||[]).find(npc=>npc.id===id);
    return !rec || rec.dead || rec.deceased || !(deps.getWalkers?.()||[]).some(w=>w.rec?.id===id);
  }
  const MUSICIANS = ['foroji_funji','kaboku_kunji'];
  const stageFailures = new Map(); // npcId -> festival day on which they proved unable to reach the stage; the other musician covers.
  const dutyWatch = new Map(); // npcId -> world hour their current stage shift began without them being on stage.
  function stageFailed(id) { return stageFailures.get(id) === day(); }
  function stationFor(id) { return layout()?.npcStations?.find(s=>s.festivalNpcId===id && s.festivalLocaleKind==='bandstand'); }
  function onStage(id) {
    const walker = (deps.getWalkers?.()||[]).find(w=>w.rec?.id===id), station = stationFor(id);
    return !!walker && !!station && walker.area==='town' && Math.hypot(walker.root.position.x-station.col-.5,walker.root.position.z-station.row-.5)<=.5;
  }
  function scheduledDuty(rec) { // The shift the band plan assigns, before any watchdog verdict.
    if (!festivalHours()) return false;
    const hour = Number(window.CalendarSystem?.getHour?.())||0; // Incoming performers overlap their shift so the outgoing musician can wait for actual arrival.
    if (rec.id === 'kaboku_kunji') return hour>=19.5 || (hour<1) || (hour>=14 && (musicianAbsent('foroji_funji') || stageFailed('foroji_funji')));
    if (hour>=14 && hour<20) return true;
    const incoming = (deps.getWalkers?.()||[]).find(w=>w.rec?.id==='kaboku_kunji');
    return stageFailed('kaboku_kunji') || !incoming || incoming.rec.dead || incoming.area!=='town' || !stationFor('kaboku_kunji') || !onStage('kaboku_kunji');
  }
  function stageDuty(rec) {
    if (!MUSICIANS.includes(rec?.id)) return false;
    return scheduledDuty(rec) && !stageFailed(rec.id);
  }
  // A musician who cannot walk to the stage (blocked route, trapped in a building) is relieved so the festival is never silent.
  function watchStage() {
    if (festival()?.id !== 'gorkunash') { dutyWatch.clear(); return; }
    const now = worldHour();
    for (const id of MUSICIANS) {
      const rec = (deps.getNpcs?.()||[]).find(npc=>npc.id===id), walker = (deps.getWalkers?.()||[]).find(w=>w.rec?.id===id);
      if (!rec || !walker || stageFailed(id) || !scheduledDuty(rec) || onStage(id)) { dutyWatch.delete(id); continue; }
      if (!dutyWatch.has(id)) dutyWatch.set(id,now);
      const waited = now - dutyWatch.get(id);
      const routeFailed = !!walker._npcPathFailKey && Date.now() < (walker._npcPathFailUntil||0) && waited > 20/60; // Pathfinding repeatedly found no route.
      if (routeFailed || waited > 1.5) { stageFailures.set(id,day()); dutyWatch.delete(id); window.__farmLog?.(`[festival] ${id} cannot reach the bandstand; the other musician covers`,'social'); }
    }
  }
  function npcTarget(rec) {
    const release=()=>{gatheringAssignments.delete(rec.id);window.FurnitureTableSystem?.setSeatTarget?.(rec.id,null);return null;};
    if(!deps||!festival()||deps.isFestivalSuspended?.()||!HOME_IDS.has(rec.homeId)||rec.deceased||rec.dead||rec.visitorPresence)return release();
    if (pendingDance?.targetNpcId === rec.id) return window.NpcFollowing?.target?.(rec,pendingDance.followSession,1.5) || pendingDance.waitTarget;
    if (festival()?.id === 'gorkunash' && stageDuty(rec)) {
      const station = layout()?.npcStations?.find(s=>s.festivalNpcId===rec.id && s.festivalLocaleKind==='bandstand');
      const target = station && window.NpcScheduling?.resolveNpcStationTarget?.(station.id);
      if (target) { release(); return target; } // Ordinary pathfinding takes the host to the stage during gathering hours.
    }
    if(!festivalHours()||(rec.id==='spearhead_unumanuk'&&window.CombatTutorial?.active?.()))return release();
    if (festival()?.id === 'gorkunash') {
      if (rec.id === 'father_hunundi_hodu') return release(); // The presence schedule owns his walk out of town.
      if (rec.id === 'kinami_kunji') {
        release();
        return window.FestivalDialogue?.homeTarget?.(rec) || null;
      }
    }
    if (festival()?.id === 'gorkunash' && window.NpcSharedMeals) return window.NpcSharedMeals.targetFor(rec); // Cached multi-step meals still use ordinary scheduler/pathfinding targets.
    if (festival()?.id !== 'gorkunash') {
      const localeTarget = window.FestivalLocaleActivities?.targetFor?.(rec); // Cached, role-specific festival stations instead of generic standing still.
      if (localeTarget) return localeTarget;
    }
    const stations=layout()?.npcStations||[], index=residents().findIndex(npc=>npc.id===rec.id);
    if(index<0)return release();
    const hour=Number(window.CalendarSystem.getHour())||0, shift=hour>=15?hour-15:hour+9;
    const scope=`${eventKey()}:${day()}:${Math.floor(shift/2)}`; // Existing two-hour preferences remain deterministic.
    const preferred=isRomanceable(rec)?['dance','dining','dance','dining'][(Math.floor(shift/2)+index)%4]
      :((index%5===0&&shift%3===1)?'dance':'dining');
    const kinds=isRomanceable(rec)?[preferred,preferred==='dining'?'dance':'dining']:[preferred];
    const taken=station=>{
      const target=window.NpcScheduling?.resolveNpcStationTarget?.(station.id);
      if(target?.pose==='sit' && window.FurnitureTableSystem?.isSeatTaken?.(target.area||'town',target,rec.id))return true;
      for(const [id,assignment] of gatheringAssignments)if(id!==rec.id && assignment.scope===scope && assignment.stationId===station.id)return true;
      return (deps.getWalkers?.()||[]).some(w=>w.rec?.id!==rec.id && w.currentScheduleTarget?.stationId===station.id);
    };
    let selected=null;
    if(festival()?.id==='gorkunash'){
      const leader=shift<5?'foroji_funji':'kaboku_kunji';
      if(rec.id===leader)selected=stations.find(st=>st.festivalNpcId===rec.id&&st.festivalLocaleKind==='bandstand');
      if(!selected)for(const kind of kinds){
        const candidates=stations.filter(st=>st.festivalLocaleKind===kind&&st.festivalRole!=='musician');
        const previous=gatheringAssignments.get(rec.id);
        if(previous?.scope===scope)selected=candidates.find(st=>st.id===previous.stationId&&!taken(st));
        const start=(index*7+Math.floor(shift/2))%Math.max(1,candidates.length);
        for(let n=0;!selected&&n<candidates.length;n++){const candidate=candidates[(start+n)%candidates.length];if(!taken(candidate))selected=candidate;}
        if(selected)break;
      }
    }else{
      const choices=stations.filter(st=>st.festivalRole==='guest');
      selected=stations.find(st=>st.festivalNpcId===rec.id&&!taken(st))||choices.find((st,i)=>i>=index%Math.max(1,choices.length)&&!taken(st))||choices.find(st=>!taken(st));
    }
    const target=selected&&window.NpcScheduling?.resolveNpcStationTarget?.(selected.id);
    if(target){
      gatheringAssignments.set(rec.id,{scope,stationId:selected.id});
      window.FurnitureTableSystem?.setSeatTarget?.(rec.id,target);
      return {...target,stationId:target.stationId||selected.id,activity:festival().name};
    }
    release();
    const walker=(deps.getWalkers?.()||[]).find(w=>w.rec?.id===rec.id), anchor=stations.find(st=>kinds.includes(st.festivalLocaleKind));
    const x=walker?.area==='town'?walker.root.position.x:(anchor?.col||30)+.5, z=walker?.area==='town'?walker.root.position.z:(anchor?.row||25)+.5;
    for(let radius=0;radius<=4;radius++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
      const c=Math.floor(x)+dx,r=Math.floor(z)+dz;
      if(deps.canStandAt?.('town',c,r)===false)continue;
      if((deps.getWalkers?.()||[]).some(w=>w.rec?.id!==rec.id&&w.area==='town'&&Math.hypot(w.root.position.x-c-.5,w.root.position.z-r-.5)<.6))continue;
      return {area:'town',c,r,pose:'stand',activity:festival().name}; // No preferred locale has room; wait on clear ground instead of taking an occupied chair.
    }
    return {area:walker?.area||'town',c:x-.5,r:z-.5,pose:'stand',activity:festival().name};
  }
  function cancelDance() {
    remembrance = null; // The existing Stop activity input also cancels an unfinished observance.
    clearPendingDance();
    if(dance?.targetNpcId)window.FestivalWheelDanceRuntime?.stop?.('festival-ended');
    else if(dance)window.SocialActionWheel?.stopDance?.('festival-ended');
    dance=null;
  }
  function update() {
    const now = performance.now(); // Called by gameLoop; no independent animation loop.
    settleFestivalFun();
    const vessel = heldCup || heldBowl;
    if (vessel && (festival()?.id!=='gorkunash'||deps?.getArea?.()!=='town'||(deps?.getHeldMode?.() && deps.getHeldMode()!=='item')
      ||(deps?.getActiveItemKey?.() && deps.getActiveItemKey()!==vessel.selectedItemKey)))discardFestivalBowl('left-festival-or-changed-equipment');
    if(seatedMeal && (!heldBowl?.meal || !heldBowl?.uses || deps?.isPlayerSeated?.()===false || !festivalHours()))
      seatedMeal=null;
    if(seatedMeal && !seatedMeal.animating && now>=seatedMeal.nextAt && !document.hidden){
      const playing=deps?.playFestivalBowlDrink?.(()=> {
        const result=eatFestivalBowl();
        if(!result.ok)seatedMeal=null;
        else if(seatedMeal){seatedMeal.animating=false;seatedMeal.nextAt=performance.now()+2700;}
      });
      if(playing)seatedMeal.animating=true;
      else if(deps?.playFestivalBowlDrink)seatedMeal.nextAt=now+500;
      else seatedMeal=null; // Never consume automatically if the actual authored drink animation is unavailable.
    }
    if (now - lastTick < 200) return;
    const elapsed = Math.max(0, Math.min(.5, (now - lastTick) / 1000));
    lastTick = now;
    updateDanceInvitation(elapsed);
    registerCupProvider();
    watchStage();
    window.NpcSharedMeals?.update?.(); // Existing low-frequency gathering tick owns meal decisions; no extra frame loop.
    window.FestivalLocaleActivities?.update?.(); // Same 200ms tick drives other festivals; schedule reads stay cached.
    const playing = window.SocialActionWheel?.isDancing?.() || window.MusicMinigame?.state?.active; // Both established social paths remain free to start anywhere.
    if (festival()?.id === 'gorkunash' && festivalHours() && deps?.getArea?.() === 'town' && playing && !deps?.socialPaused?.() && !document.hidden) {
      socialParticipationS += elapsed;
      if (socialParticipationS >= 1) {
        const seconds = Math.floor(socialParticipationS), position = deps.getPlayerTile(); // Award only actual played whole seconds with nearby company.
        socialParticipationS -= seconds;
        for (const walker of deps.getWalkers()) if (walker.area === 'town' && !walker.rec?.dead && Math.hypot(walker.root.position.x-position.c, walker.root.position.z-position.r) <= 3) addFestivalFun(walker.rec.id, seconds * 15);
      }
    } else socialParticipationS = 0;
    if (remembrance) {
      const prop = activityProps().find(p=>p.id===remembrance.propId);
      if (eventKey()!==remembrance.event || !festivalHours() || !atProp(prop) || deps?.isBlocked?.()) {
        remembrance=null; // Leaving the ceremony or entering combat cancels an unfinished observance.
      } else if (!document.hidden && !deps?.socialPaused?.()) {
        remembrance.elapsed+=elapsed;
        if (remembrance.elapsed>=12) {
          remembrance=null;
          if (!claimed('remembrance')) { mark('remembrance'); allFavor(2,'remembrance'); commit('Remembrance observed with the townsfolk: +2 Favor once this Tzizkhanash.'); }
          else deps.toast?.('You shared a moment of remembrance.',true);
        }
      }
    }
    if (musicParticipation) {
      const prop=activityProps().find(p=>p.id===musicParticipation.propId);
      if (eventKey()!==musicParticipation.event || !festivalHours() || !atProp(prop)
          || !window.MusicMinigame?.state?.active) musicParticipation=null;
      else if (!document.hidden && !deps?.socialPaused?.() && window.MusicMinigame.state.announcedPlaying) {
        musicParticipation.elapsed+=elapsed;
        if (musicParticipation.elapsed>=20) {
          musicParticipation=null;
          if (!claimed('music')) { mark('music'); allFavor(2,'festival_music'); commit('You played along with the festival musicians: +2 Favor with the townsfolk.'); }
        }
      }
    }
    if (deps && now - lastCostumeTick >= 2000) {
      lastCostumeTick = now;
      for (const walker of deps.getWalkers()) {
        const costume = festival()?.id === 'hachutukara' && residents().some(rec => rec.id === walker.rec?.id) ? 'hachutukara' : '';
        if (costumeState.get(walker) !== costume && (costume || costumeState.has(walker))) void window.NpcWardrobe?.refreshWalkerAppearance?.(walker);
        costumeState.set(walker, costume);
      }
    }
    if (dance?.targetNpcId && (!festivalHours() || deps?.isFestivalSuspended?.() || deps?.isBlocked?.()
        || !(deps?.getWalkers?.()||[]).some(w=>w.rec?.id===dance.targetNpcId && !w.rec.dead && !w.rec.deceased && w.area==='town'))) {
      cancelDance(); // Combat, modal interaction, death, or NPC despawn releases both avatar transforms and their action lock.
    }
    if (dance) {
      const prop = activityProps().find(p => p.id === dance.propId);
      if (eventKey() !== dance.event || (!dance.targetNpcId && !atProp(prop))
          || (dance.targetNpcId
            ? !window.FestivalWheelDanceRuntime?.activeFor?.(dance.targetNpcId)
            : !window.SocialActionWheel?.getDebug?.().dancing)) cancelDance();
      else if (!deps.isBlocked?.() && !document.hidden) {
        dance.elapsed += elapsed;
        if (dance.targetNpcId) {
          // Count only rendered paired-animation seconds. The player's logical tile
          // remains anchored for collision while both avatar visuals orbit together.
          const elapsedPair=window.FestivalWheelDanceRuntime?.elapsedSeconds?.(dance.targetNpcId) || 0;
          const wholeSeconds=Math.max(0,Math.floor(elapsedPair)-(dance.awardedSeconds||0));
          if(wholeSeconds>0){
            dance.awardedSeconds+=wholeSeconds;
            addFestivalFun(dance.targetNpcId,wholeSeconds*15);
            deps.save?.(); // Entire granted-second intervals survive an immediate reload.
          }
        }
        if (dance && !dance.targetNpcId && dance.elapsed >= 20) {
          const key = dance.claimKey; // Preserve identity before releasing the social pose.
          cancelDance();
          if (!claimed(key)) { mark(key); allFavor(2, 'dance'); commit('Dance completed! +2 Favor with the townsfolk.'); }
          else deps.toast?.('A lovely dance. You have already earned this festival’s dance reward.', true);
        }
      }
    }
    window.FestivalUI?.update?.();
  }
  function diagnostics() {
    return { festival:festival()?.id||null,year:deps?year():null,layout:layout()?.activeLayoutId||'default',
      activities:activityProps().map(p=>({id:p.id,type:p.activity.type,col:p.col,row:p.row,locale:p.festivalLocale?.kind})),
      claims:claims(),blessing:state.blessing,dance,festivalWheel:window.FestivalWheelDanceRuntime?.diagnostics?.(),heldBowl,heldCup,seatedMeal,aimedPot:potIndexAtAim(),festivalFun:state.festivalFun,
      dailyFeast:feastMenu().map(m=>({dish:m.label,stars:m.score,ingredients:m.ingredients,effects:m.foodEffects})),contest:contestStandings(),fullness:currentFullness(),mealBuffs:foodDurationEntries(),lastError,
      pendingDance:pendingDance?{npcId:pendingDance.targetNpcId,remaining:pendingDance.remaining,settleS:pendingDance.settleS}:null,
      remembrance, musicParticipation, localeActivities:window.FestivalLocaleActivities?.diagnostics?.(),
      festivalDialogue:window.FestivalDialogue?.diagnostics?.(),sharedMeals:window.NpcSharedMeals?.diagnostics?.(),
      gatheringActive:festivalHours(),gatheringHours:gatheringHoursLabel(),shopsClosed:!deps?.isFestivalSuspended?.() && festivalHours(),
      latestChange:'Shops pause only during active festival hours and resume their normal schedules afterward.' };
  }
  // The combat loader installs the alcohol bridge asynchronously, so registration is retried until it exists.
  let cupProviderRegistered = false;
  const cupProvider = { // The cup rides the ordinary hold-to-drink, swig-offer, drunkenness and blackout pipeline.
    current: () => heldCup ? { key:CUP_KEY, def:CUP_DEF, remaining:heldCup.swigs, total:heldCup.capacity, stars:3 } : null,
    consumeSwig: () => { if (!heldCup || heldCup.swigs < 1) return { ok:false }; heldCup.swigs--; return { ok:true, remaining:heldCup.swigs, total:heldCup.capacity, stars:3 }; },
    drinkSwig: () => {
      if (!heldCup || heldCup.swigs < 1) return { ok:false, message:'Your cup is empty. Refill it free at the keg.' };
      const drink = window.HobunjiAlcohol?.drinkDef?.(CUP_DEF,3,CUP_KEY);
      if (!drink?.ok) return drink || { ok:false, message:'Nothing to drink.' };
      heldCup.swigs--;
      return { ok:true, message:`${drink.message} ${heldCup.swigs}/${heldCup.capacity} swigs left; the keg refills you free.` };
    },
    onNpcSwig: id => { addFestivalFun(id,CUP_FUN_PER_SWIG); deps?.save?.(); },
  };
  function registerCupProvider() {
    if (cupProviderRegistered) return;
    const bridge = window.HobunjiDrunkGameplayBridge;
    if (!bridge?.registerVirtualDrink) return;
    bridge.registerVirtualDrink(cupProvider);
    cupProviderRegistered = true;
  }
  function init(injected) {
    deps = injected;
    residentCacheAt = -Infinity;
    window.FestivalDialogue?.init?.({ getTownMap: deps.getTownMap });
    window.FestivalPotluckContest?.registerRewardVisit?.(deps,()=>{
      recoverPotluckEntries(); // Farmhouse exits recover overdue donations even after the feast has closed.
      return state.potluckContests;
    },event=>{
      if (state.potluckContests[event]) state.potluckContests[event].rewarded = true;
    },day); // Shared doorstep queue awards the prize only on natural dialogue completion.
    const socialConfig = () => window.SCRATCHBONES_CONFIG?.game?.socialRelationships;
    window.NpcFestivalDance?.init?.({
      relationships: () => socialConfig()?.relationships, // Authored partner/family/friend pairs: the same graph the seating system reads.
      isRomanceable,
      inhibition: rec => window.NpcSocialInhibition?.profileFor?.(rec)?.base,
      danceThreshold: value => window.NpcSocialInhibition?.danceThresholdFor?.(value) ?? (value <= 30 ? value : Math.min(99, 30 + (value - 30) * 2)),
      drunkFraction: id => window.HobunjiDrunkGameplayBridge?.npcDrunkFraction?.(id),
      likesDancing: id => (window.SCRATCHBONES_CONFIG?.game?.romance?.likes?.[id] || []).includes('dancing'),
      playerSpouseId: () => window.RomanceSystem?.getSpouse?.()?.npcId || null,
    });
    window.FestivalLocaleActivities?.init?.({
      festival, active:()=>festivalHours()&&!deps.isFestivalSuspended?.(),
      getLayout:layout, getWalkers:deps.getWalkers, residents,
      minutes:()=>worldHour()*60, paused:deps.socialPaused,
      resolve:id=>window.NpcScheduling?.resolveNpcStationTarget?.(id),
    });
    window.NpcSharedMeals?.init?.({
      enabled: () => festival()?.id === 'gorkunash' && festivalHours() && !deps.isFestivalSuspended?.(),
      musicOn: musicPlaying,
      getLayout: layout, getWalkers: deps.getWalkers, minutes: () => worldHour()*60, paused: deps.socialPaused,
      owner:'festivals', canStandAt:deps.canStandAt,
      isMusician: stageDuty,
      companions: rec => {
        const bonds = new Map((window.DialogueContent?.relatedNpcBonds?.(rec.id)||[]).map(([id,weight])=>[id,weight*16])); // Existing household/workplace relation strengths.
        for (const id of window.AmbientDialogue?.friendIdsFor?.(rec.id)||[]) bonds.set(id,Math.max(3,bonds.get(id)||0));
        for (const link of socialConfig()?.relationships||[]) { // Authored spouses, relatives and friends outrank mere housemates when picking a table.
          const weight = socialConfig()?.seating?.baseRelationshipWeights?.[link.type] ?? ({partner:14,family:11,friend:8}[link.type]||0);
          if (!link.members?.includes(rec.id)) continue;
          for (const id of link.members) if (id !== rec.id) bonds.set(id,Math.max(weight,bonds.get(id)||0));
        }
        return bonds;
      },
      visible: deps.canSeeNpc,
      carryBowl: (walker,id) => window.NpcDrinkInteraction?.setAmbientCarry?.({ownerId:`meal:${id}`,root:walker.root,avatarGroup:walker.avatarGroup,itemKey:'festival_bowl'}),
      clearCarry: (id,walker) => { window.NpcDrinkInteraction?.clearAmbientCarry?.(`meal:${id}`); if(walker)window.NpcDrinkInteraction?.stopAutonomous?.(walker); },
      playEat: walker => window.NpcDrinkInteraction?.playAutonomous?.(walker,'festival_bowl'),
      // Keg cups: NPCs draw the same free cup, carry it, and their sips change real sobriety (blackouts included).
      drunkFraction: id => window.HobunjiDrunkGameplayBridge?.npcDrunkFraction?.(id),
      isBlackedOut: id => window.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(id) || false,
      drinkNpc: (rec,count,footing) => {
        const result = window.HobunjiDrunkGameplayBridge?.addNpcDrunkenness?.(rec.id,footing,CUP_KEY);
        const stamp = performance.now();
        if (stamp - lastSipSave > 20000) { lastSipSave = stamp; deps.save?.(); } // Alcohol state is saved with the world; batch the writes.
        if (result?.blackout) window.__farmLog?.(`[festival] ${rec.id} passed out after ${count} swigs of keg airag`,'social');
        return result;
      },
      carryCup: (walker,id) => window.NpcDrinkInteraction?.setAmbientCarry?.({ownerId:`cup:${id}`,root:walker.root,avatarGroup:walker.avatarGroup,itemKey:CUP_KEY}),
      clearCup: id => window.NpcDrinkInteraction?.clearAmbientCarry?.(`cup:${id}`),
      playSip: (walker,apply) => window.NpcDrinkInteraction?.playAutonomous?.(walker,CUP_KEY,apply),
    });
    registerCupProvider();
    window.FurnitureTableSystem?.registerService?.('gorkunash-drinks', {
      enabled: () => festival()?.id === 'gorkunash' && festivalHours(),
      buttons: () => [{icon:'🍺',label:heldCup ? `Refill cup (${heldCup.swigs}/${heldCup.capacity})` : 'Take a cup',action:'obj_take_cup',style:'primary',allowed:!deps?.isBlocked?.()}],
      onAction: action => action === 'obj_take_cup' && festival()?.id === 'gorkunash' && festivalHours() && !deps?.isBlocked?.() ? takeOrRefillCup() : fail('The keg is unavailable.'),
    });
    window.FurnitureTableSystem?.registerService?.('gorkunash-feast', {
      enabled: () => festival()?.id === 'gorkunash' && festivalHours(),
      buttons(target) {
        if (deps?.isBlocked?.()) return [];
        if (target.placement.service.kind === 'bowls') return [{ icon:'🥣', label:'Take bowl', action:'obj_take_bowl', style:'primary', allowed:true }];
        const index = Number(target.placement.service.index), meal = feastMenu()[index]; // Every serving pot carries its own authored menu slot.
        const buttons = meal ? [{ icon:'🍲', label:heldBowl ? 'Fill bowl: ' + meal.label + (meal.id==='reserved'?'':' · '+meal.score+'★') : 'Take a bowl first', action:'obj_fill_bowl', style:'primary', allowed:!!heldBowl && meal.id!=='reserved' }] : [];
        const held = deps?.getHeldMealChoice?.(); // The normal item wheel determines which dish and quality are donated.
        if (meal?.id !== 'reserved') buttons.push({icon:'📋',label:'Inspect ingredients & effects',action:'obj_inspect_meal',style:'secondary',allowed:true}); // Inspection never consumes a bowl or meal.
        if (!claimed('potluck') && held && deps.getItemDefs()[held.key]?.isCookedFood) buttons.push({ icon:'🍲',label:'Contribute held meal',action:'obj_contribute_meal',style:'secondary',allowed:true });
        return buttons;
      },
      onAction(action, target) {
        if (!festivalHours() || festival()?.id !== 'gorkunash' || deps?.isBlocked?.()) return fail('This serving table is closed.');
        if (action === 'obj_take_bowl' && target.placement.service.kind === 'bowls') return takeFestivalBowl();
        if (action === 'obj_fill_bowl' && target.placement.service.kind === 'meal') return fillFestivalBowl(Number(target.placement.service.index));
        if (action === 'obj_inspect_meal' && target.placement.service.kind === 'meal') {
          const index = Number(target.placement.service.index);
          return feastDishDetails(index)?.id !== 'reserved' && window.FestivalUI?.openFeast?.(index)
            ? {ok:true} : fail('The dish cannot be inspected right now.');
        }
        if (action === 'obj_contribute_meal') {
          const held = deps?.getHeldMealChoice?.();
          const stars = held?.stars ?? window.CookingSystem?.peekLowestQuality?.(held?.key); // Uses PackHold's selected tier through the existing quality owner.
          const choice = qualityChoices('potluck').find(item=>item.key===held?.key && item.stars===stars);
          return choice ? handlers.get('potluck')(choice) : fail('Hold a cooked meal to contribute it.');
        }
        return fail('Aim directly at a pot or the stack of bowls.');
      },
      decorate(holder, record) {
        if (record.service.kind !== 'meal') return;
        const available = feastMenu()[Number(record.service.index)]?.id !== 'reserved'; // An empty reserved pot keeps its real vessel and only hides the liquid.
        holder.traverse?.(node=>{ if (node.userData?.authoredPart?.kind==='liquidSurface' && node.visible!==available) node.visible=available; });
      },
    });
    window.NpcWardrobe?.registerAppearanceDecorator('festivals', data => {
      if (festival()?.id !== 'hachutukara' || !residents().some(rec => rec.id === data.id)) return data;
      const index = [...data.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % MASKS.length; // Stable animal mask for each named resident.
      return { ...data, equippedCosmetics: [...(data.equippedCosmetics || []).filter(id => !id.startsWith('festivalmask_') && !['mask'].includes(window.NpcWardrobe.slotForCosmetic(id))), `festivalmask_${MASKS[index]}`] };
    });
    window.NpcScheduling?.registerTargetOverride('festivals', npcTarget);
    window.EffectBuffBar?.registerProvider('festivals', () => [...buffEntries(), ...foodDurationEntries()]);
    window.CookingSystem?.registerExternalFoodProvider?.('gorkunash-feast', festivalFoodStacks);
  }
  registerActivity('welcome', () => ({ ok: true }));
  registerActivity('remembrance', (payload, prop) => {
    if (!festivalHours() || festival()?.id!=='tzizkhanash') return fail('The remembrance gathering is not underway.');
    if (remembrance || dance || pendingDance || window.SocialActionWheel?.isDancing?.()) return fail('Finish your current activity before joining the remembrance.');
    remembrance={event:eventKey(),propId:prop.id,elapsed:0}; // Timer advances only during unpaused play inside this locale.
    return commit('You join the remembrance. Stay with the mourners for twelve seconds to complete the observance.');
  });
  registerActivity('potluck', payload => {
    if(claimed('potluck'))return fail('You have already contributed a meal to this Gorkunash.');
    if(!consumeChoice('potluck',payload))return fail('Choose a cooked meal and a quality you still have.');
    const definition=deps.getItemDefs()[payload.key];
    let recipients=0;
    for(const rec of residents()) {
      const evaluated=window.NpcGifting?.evaluateHeldGift?.(rec,{kind:'item',key:payload.key,stars:payload.stars});
      if(['disliked','hated'].includes(evaluated?.tier))continue;
      const points=Math.max(1,Number(evaluated?.favorDelta)||1)*10;
      giveFavor(rec.id,points,'potluck');
      recipients++;
    }
    const contest = contestData();
    if (contest) {
      const snapshot = contestIngredients(definition,payload.stars); // Snapshot real input tiers before the donated meal leaves inventory.
      contest.entry = {key:payload.key,stars:payload.stars,label:definition?.label||payload.key,
        score:window.FestivalPotluckContest.scoreCooked(definition,payload.stars,deps.getItemDefs()),
        ingredients:snapshot.ingredients,estimatedQuality:snapshot.estimated,
        estimatedEffects:snapshot.estimatedEffects,foodEffects:{...(definition?.foodEffects || {})}};
    }
    mark('potluck',{key:payload.key,stars:payload.stars,day:day()});
    if (!contest) potluckRecoveryPending = true; // NPC loading may defer creation of an otherwise accepted donation's roster.
    feastCache = null; // The seventh physical serving pot becomes available immediately.
    return commit(`Contributed ${definition?.label||payload.key}; 10× normal gift Favor for ${recipients} villagers who do not dislike it.`);
  });
  registerActivity('offering', payload => {
    if (claimed('offering')) return fail('You have already made this year’s offering.');
    if (!window.FestivalCalendar.blessings[payload.stat]) return fail('Choose a blessing before making your offering.');
    if (!consumeChoice('offering', payload)) return fail('Choose an offering and a quality you still have.');
    state.blessing = { stat: payload.stat, level: payload.stars, expiresDay: day() + 336 };
    mark('offering', { key: payload.key, stars: payload.stars, stat: payload.stat });
    return commit(`${window.FestivalCalendar.blessings[payload.stat].label}, level ${payload.stars}, for 336 days. Your previous ancestor blessing is replaced.`);
  });
  registerActivity('gifts', payload => {
    const rec = deps.getNpcs().find(npc => npc.id === payload.npcId); // Every eligible NPC can give once; the registry supplies named and loaded procedural NPCs.
    if (!rec || rec.deceased || rec.dead || String(rec.homeId || '').includes('deceased') || favorHearts(rec.id) < 3) return fail('This friend needs at least three hearts of Favor.');
    if (claimed(`gift:${rec.id}`)) return fail('You have already received this friend’s Mountaindawn gift.');
    const recipes = Object.values(window.AlchemySystem?.RECIPE_DEFS || {}).filter(recipe => recipe.useMode === 'drink' && recipe.traits?.drive === 'restore');
    if (!recipes.length) return fail('Gift supplies are still loading.');
    const hash = [...rec.id].reduce((sum, letter) => sum + letter.charCodeAt(0), year()); // Stable annual reward prevents rerolling by closing the menu or reloading.
    const recipe = recipes[hash % recipes.length];
    const key = window.AlchemySystem.ensureRecipeItemDef(recipe.id, 2); // Existing high-potency restorative, with normal inventory/use semantics.
    if (!grantItem(key, 2, 5)) return fail('Make room for your gift first.');
    mark(`gift:${rec.id}`);
    return commit(`${rec.name || rec.displayName || rec.id} gives you 2 × ${deps.getItemDefs()[key].label}.`);
  });
  registerActivity('sweets', payload => {
    const rec = residents().find(npc => npc.id === payload.npcId);
    if (!rec) return fail('Choose a townsfolk to collect sweets from.');
    if (claimed(`sweet:${rec.id}`)) return fail('You have already collected this friend’s sweets this year.');
    window.CookingSystem?.registerCookedDefinition?.('festivalSweet', { label: 'Hachutukara Sweet', icon: '🍬', desc: 'A ridiculous little animal made of sweet paste.', sellPrice: 8, foodQuality: 3, cookingDefaultStars: 3, cookingCategories: ['sweetPaste'], foodEffects: { vigor: 1 } }); // Register on grant, after the current character's cooking save has been restored.
    if (!grantItem('festivalSweet', 1)) return fail('Make room for a sweet first.');
    mark(`sweet:${rec.id}`);
    return commit(`${rec.name || rec.id} gives you an animal-shaped sweet.`);
  });
  registerActivity('masks', payload => {
    if (!MASKS.includes(payload.mask)) return fail('Choose one of the festival masks.');
    if (claimed('mask')) return fail('You have already chosen your free mask this year.');
    const id = `festivalmask_${payload.mask}`; // Existing mask cosmetic retains all authored tint layers and species variants.
    if (!deps.grantMask?.(id)) return fail('The mask is unavailable. Try again once its assets have loaded.');
    mark('mask');
    return commit('Your silly animal mask is in your clothing inventory. Equip it from the item panel.');
  });
  registerActivity('story', (payload, prop) => {
    if (prop.festivalLocale && (!festivalHours() || Number(window.CalendarSystem?.getHour?.()) >= 22)) return fail('The storyteller has finished for today.');
    const walker = deps.getWalkers().find(w => w.rec?.id === 'father_hunundi_hodu' && w.area === 'town');
    if (!walker) return fail('Father Hunundi tells the story here between 10:00 and 22:00.');
    window.FestivalUI.close();
    const started=deps.tellStory(walker, STORY);
    if (started && !claimed('story')) { // Reward attending Hunundi, using the same yearly-claim ledger as other activities.
      mark('story');
      giveFavor('father_hunundi_hodu',2,'story');
      deps.save?.();
    }
    return started;
  });
  registerActivity('dance', (payload, prop) => {
    if (prop.festivalLocale && !festivalHours()) return fail('The dance gathering has not begun.');
    if (dance || remembrance) return fail('Finish your current activity first.');
    if (!window.SocialActionWheel?.startDance?.('gentle-twirl', 'tpose-jiggle')) return fail('The dance could not start.');
    dance = { propId: prop.id, event: eventKey(), elapsed: 0, claimKey: 'dance' };
    window.FestivalUI.close();
    deps.toast('Dance inside the marked court for 20 seconds. Leaving cancels; the Favor reward is once per festival.', true);
    return { ok: true };
  });
  registerActivity('music', (payload, prop) => {
    if (!festivalHours()) return fail('The music gathering is not underway.');
    window.FestivalUI.close();
    window.MusicMinigame?.beginPlayerSession();
    if (!window.MusicMinigame?.state?.active) return fail('Equip a Kurraya before joining the musicians.');
    musicParticipation={event:eventKey(),propId:prop.id,elapsed:0}; // Count active time after the player actually sounds a note.
    return {ok:true};
  });
  registerActivity('liquor', () => takeOrRefillCup()); // The festival keg: a free temporary cup, not a bottle for the bag.
  registerActivity('duel', (payload, prop) => {
    if (prop.festivalLocale && (!festivalHours() || Number(window.CalendarSystem?.getHour?.()) >= 22)) return fail('The sparring exhibition is over for today.');
    const walker = deps.getWalkers().find(w => w.rec?.id === 'spearhead_unumanuk' && w.area === 'town');
    if (!walker) return fail('Spearhead supervises the friendly duels here between 10:00 and 22:00.');
    if (window.CombatTutorial?.active()) return fail('Finish your current practice first.');
    window.FestivalUI.close();
    const arena = { area: 'town', ...propCenter(prop) }; // Moves with the editor-authored ring; the existing training system owns combat and cleanup.
    const duelEvent = eventKey(); // Availability and rewards remain tied to the event that actually started this round.
    const quest = { isAvailable: () => eventKey() === duelEvent, id: `festival_duel_${year()}`, title: 'Hachutukara — Laugh at Fear', transient: true, practice: arena, steps: [{ id: 'fearless', title: 'Friendly duel', text: 'Stand calmly against Oddclaw. Land three ordinary hits while he spars back. Our borrowed weapons cannot cost you your belongings, and we restore your resources when you finish or leave.', check: 'hit', count: 3, hostile: true, goal: 'Land three hits on Oddclaw', weapon: 'hatchet' }], onComplete: () => { if (eventKey() === duelEvent && !claimed('duel')) { mark('duel'); giveFavor('spearhead_unumanuk', 6, 'duel'); giveFavor('oddclaw_unumanuk', 6, 'duel'); commit('Fear faced! +6 Favor with Spearhead and Oddclaw.'); } } };
    return window.CombatTutorial.start(quest, walker);
  });
  window.FestivalSystem = { init, festival, year, claims, claimed, residents, favorHearts, qualityChoices, registerActivity, perform, actionButton, npcRewardAction, receiveNpcReward, nearestActivity, activityProps, atProp, update, cancelDance, giftMultiplier, blessingMultiplier, serialize, restore, diagnostics, MASKS, STORY,
    socialOptionsFor, festivalHours, gatheringHoursLabel, shopsClosedFor, silencesTownMusic, musicPlaying, feastMenu, feastDishDetails, contestStandings, festivalBowl, festivalCup, heldVessel, vesselDef, takeOrRefillCup, takeFestivalBowl, fillFestivalBowl, eatFestivalBowl, currentFullness, addFestivalFun, askFestivalDance, festivalFoodStacks,
    discardFestivalBowl, potIndexAtAim, seatedMealAction, toggleSeatedMeal, isDiningSeat,get pendingDance() { return pendingDance; }, get dance() { return dance; }, getNpcs: () => deps?.getNpcs?.() || [] };
})();

// Persistent festival rules and activity handlers. UI, authored props, and NPC conversations share this authority.
(() => {
  'use strict';
  let deps = null; // Runtime-owned inventory, scene, NPC, and persistence closures.
  let state = { claims: {}, blessing: null, festivalFun: {}, funDay: null, feastBuffs: [], fullness: { stacks: 0, expiresHour: 0 } }; // Per-member annual claims, pending festival relationships, isolated meal buffs and fullness.
  let dance = null; // Session-only dance participation; leaving the dance court cancels without awarding.
  let heldBowl = null; // Temporary ten-portion festival bowl: never added to real inventory or character saves.
  let lastTick = 0; // Low-frequency game-loop work and dance elapsed time.
  let effectiveCache = null; // Reused by activity and NPC queries until the raw map or resolved layout changes.
  let residentCache = []; // Refreshed at most once every two seconds as NPC records finish loading.
  let residentCacheAt = -Infinity; // Millisecond stamp for the resident cache.
  const costumeState = new WeakMap(); // Each walker redraws only when its event costume changes.
  let lastCostumeTick = -Infinity; // Rare costume refreshes share the existing game-loop tick.
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
    if (message) deps.toast?.(message, true);
    return { ok: true, message };
  }
  function fail(message) { lastError = message; deps?.toast?.(message, false); return { ok: false, message }; }
  const FOOD_PORTION_SECONDS = 300; // Each festival bite adds one normal cooking-buff duration.
  const MAX_FOOD_PORTIONS = 10; // Bowl capacity, independent meal-duration cap, and fullness stack limit.
  const FOOD_EFFECT_ICONS = { strength:'💪',fortitude:'🛡️',vigor:'⚡',speed:'🏃',perception:'👁️',clarity:'🧠',combat:'⚔️',farming:'🌾',fishing:'🎣',foraging:'🌿',cooking:'🍲',mining:'⛏️' }; // HUD fallback symbols for the cooking-system meal effects.
  function worldHour() { return day() * 24 + (Number(window.CalendarSystem?.getHour?.()) || 0); } // Used for the eighteen-hour fullness window.
  function festivalHours() {
    const hour = Number(window.CalendarSystem?.getHour?.()) || 0;
    return hour >= 15 || hour < 1;
  }
  function isRomanceable(rec) {
    return !!rec && !rec.isChild && (rec.relationship?.canDate === true
      || (window.SCRATCHBONES_CONFIG?.game?.romance?.likes?.[rec.id] || []).length > 0);
  }
  function feastMenu() {
    if (festival()?.id !== 'gorkunash') return [];
    const source = window.HobunjiCookingData || {}; // Actual authored cooking recipes/ingredients determine the daily dishes.
    const recipes = (source.recipes || []).filter(recipe => recipe?.slots?.length);
    const defs = deps?.getItemDefs?.() || {};
    const prepared = Object.entries(defs).filter(([,def]) => def?.isCookedFood && Object.keys(def.foodEffects || {}).length);
    const indexSeed = Math.abs((day() * 1103515245 + 12345) | 0);
    const count = claimed('potluck') && day() > (claims().potluck?.day ?? Infinity) ? 6 : 5;
    const meals = []; // Stable within a civil day, so closing the menu cannot reroll free food.
    for (let i=0;i<count;i++) {
      if (recipes.length) {
        const recipe = recipes[(indexSeed + i*7) % recipes.length];
        const ingredients = (recipe.slots || []).map((slot,j) => {
          const choices = Object.values(source.items || {}).filter(item => item.categories?.some(cat => slot.accepts?.includes(cat)));
          return choices.length ? choices[(indexSeed + i*17 + j*11) % choices.length] : null;
        }).filter(Boolean);
        const foodEffects = {};
        for (const item of ingredients) if (item.primaryEffect) foodEffects[item.primaryEffect] = (foodEffects[item.primaryEffect] || 0) + Math.max(1,Math.ceil(Number(item.baseBoost)||1));
        meals.push({ id:`day:${day()}:pot:${i}`, label:recipe.baseOutputName || recipe.name || 'Festival meal',icon:recipe.outputIcon || '🍲',foodEffects });
      } else if (prepared.length) {
        const [key,def] = prepared[(indexSeed+i*13)%prepared.length];
        meals.push({id:key,label:def.label||'Cooked meal',icon:def.icon||'🍲',foodEffects:{...def.foodEffects}});
      } else meals.push({id:`day:${day()}:pot:${i}`,label:'Festival stew',icon:'🍲',foodEffects:{vigor:1}});
    }
    return meals;
  }
  function currentFullness() {
    const full = state.fullness || {stacks:0,expiresHour:0};
    return worldHour() < full.expiresHour ? Math.max(0,Math.min(10,Number(full.stacks)||0)) : 0;
  }
  function foodDurationEntries() {
    const now = performance.now()/1000;
    return (state.feastBuffs || []).filter(entry => entry.expiresAt > now).map(entry => ({
      key:`festival-meal:${entry.id}`,label:entry.label,icon:entry.icon||'🍲',
      sourceLabel:'Gorkunash meal',kind:'boon',stacks:entry.portions,
      durationS:FOOD_PORTION_SECONDS*MAX_FOOD_PORTIONS,remainingS:entry.expiresAt-now,
      fractionLabel:`${Math.ceil(entry.expiresAt-now)}/${FOOD_PORTION_SECONDS*MAX_FOOD_PORTIONS}s`,
    })).concat(currentFullness() ? [{
      key:'festival-fullness',label:'Fullness',icon:'🥣',kind:'bane',sourceLabel:'Gorkunash',
      stacks:currentFullness(),durationS:18*3600,remainingS:Math.max(1,(state.fullness.expiresHour-worldHour())*3600),
    }] : []);
  }
  function festivalFoodStacks(effectKey) {
    const now=performance.now()/1000;
    return (state.feastBuffs||[]).filter(entry=>entry.expiresAt>now).reduce((total,entry)=>total+(Number(entry.foodEffects?.[effectKey])||0),0);
  }
  function festivalBowl() { return heldBowl ? { ...heldBowl } : null; }
  function takeFestivalBowl() {
    if (festival()?.id!=='gorkunash'||!festivalHours()||!nearestActivityOfType('potluck')) return fail('Pick up a bowl at the Gorkunash feast, from 3 PM until 1 AM.');
    heldBowl={meal:null,uses:0,capacity:MAX_FOOD_PORTIONS};
    return commit('Picked up a festival bowl. Fill it from one of the six pots.');
  }
  function nearestActivityOfType(type) { return activityProps().find(prop=>prop.activity?.type===type && atProp(prop))||null; }
  function fillFestivalBowl(index) {
    if (festival()?.id!=='gorkunash'||!festivalHours()||!heldBowl||!nearestActivityOfType('potluck')) return fail('Hold a festival bowl beside the feast table.');
    const meal=feastMenu()[index];
    if (!meal) return fail('That pot is waiting for a contributed meal.');
    heldBowl={meal,uses:MAX_FOOD_PORTIONS,capacity:MAX_FOOD_PORTIONS};
    return commit(`Filled the bowl with ${meal.label} (10/10 portions).`);
  }
  function eatFestivalBowl() {
    if (!heldBowl?.meal||heldBowl.uses<1||!nearestActivityOfType('potluck')||!festivalHours()) return fail('Sit by the festival feast with a filled bowl.');
    if (currentFullness()>=MAX_FOOD_PORTIONS) return fail('You are full. The fullness effect fades eighteen in-game hours after its first serving.');
    const meal=heldBowl.meal;
    const now=performance.now()/1000;
    const existing=(state.feastBuffs||[]).find(entry=>entry.id===meal.id && entry.expiresAt>now);
    if (existing) {
      const seconds=Math.min(MAX_FOOD_PORTIONS*FOOD_PORTION_SECONDS,Math.max(0,existing.expiresAt-now)+FOOD_PORTION_SECONDS);
      existing.expiresAt=now+seconds;
      existing.portions=Math.max(1,Math.min(10,Math.ceil(seconds/FOOD_PORTION_SECONDS)));
    } else state.feastBuffs.push({ id:meal.id,label:meal.label,icon:meal.icon,foodEffects:meal.foodEffects,portions:1,expiresAt:now+FOOD_PORTION_SECONDS});
    state.feastBuffs=state.feastBuffs.filter(entry=>entry.expiresAt>now);
    if (!currentFullness()) state.fullness={stacks:0,expiresHour:worldHour()+18};
    state.fullness.stacks++;
    heldBowl.uses--;
    if (!heldBowl.uses) heldBowl={meal:null,uses:0,capacity:MAX_FOOD_PORTIONS};
    const diners=(deps.getWalkers?.()||[]).filter(walker=>walker.area==='town'&&walker.state==='idle'
      &&walker.currentScheduleTarget?.festivalLocaleKind==='dining'
      &&walker.root?.position && Math.hypot(walker.root.position.x-deps.getPlayerTile().c,walker.root.position.z-deps.getPlayerTile().r)<5);
    for(const walker of diners) addFestivalFun(walker.rec.id,25);
    return commit(`${meal.label}: +5 min food duration; fullness ${currentFullness()}/10; ${diners.length} tablemates gain 25 Festival Fun.`);
  }
  function addFestivalFun(id,amount) {
    if (!id || !Number.isFinite(amount)||amount<=0) return;
    state.festivalFun[id]=(Number(state.festivalFun[id])||0)+amount;
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
  function askFestivalDance(walker) {
    const id=walker?.rec?.id;
    if (festival()?.id!=='gorkunash'||!festivalHours()||!isRomanceable(walker?.rec)
      ||walker.area!=='town'||walker.currentScheduleTarget?.festivalLocaleKind!=='dance'
      ||!walker.root?.position||!deps?.getPlayerTile?.()) return fail('Find a romanceable dancer on the Gorkunash dance floor.');
    const player=deps.getPlayerTile();
    if(Math.hypot(player.c-walker.root.position.x,player.r-walker.root.position.z)>3.5)return fail('Approach your dance partner.');
    const accepted=favorHearts(id)>=3||(favorHearts(id)>=1&&(window.NpcRapport?.get?.(id)||0)>200);
    window.AmbientDialogue?.showAlcoholOfferResponse?.(walker,{text:accepted?'I would be delighted to dance.':'Perhaps another time.',line:accepted?'I would be delighted to dance.':'Perhaps another time.',accepted,reason:'festival'});
    if(!accepted)return fail('Your invitation was politely declined.');
    const prop=activityProps().find(p=>p.activity.type==='dance');
    if(dance||!prop||!window.SocialActionWheel?.startDance?.('gentle-twirl','tpose-jiggle'))return fail('The dance cannot start right now.');
    dance={propId:prop.id,event:eventKey(),elapsed:0,targetNpcId:id,awardTime:0};
    window.HobunjiActivityEvents?.emit?.('dance_together',{npcId:id});
    return commit(`Dancing with ${walker.rec.name||id}: 15 Festival Fun per second while you remain together.`);
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
    if (dance) return { icon: '■', label: 'Leave festival dance', action: 'festival_stop_dance', allowed: true, style: 'secondary' };
    const prop = nearestActivity(); // Activity remains tied to the prop when moved in the editor.
    return prop ? { icon: festival().icon, label: prop.activity.label || window.FestivalCalendar.activityLabels[prop.activity.type], action: 'festival_activity', allowed: true, style: 'primary' } : null;
  }
  function npcRewardAction(walker) {
    if (!walker?.rec?.id || deps?.isBlocked?.()) return null;
    // Reuse the existing secondary NPC festival action route; game.js already
    // dispatches festival_npc_gift to receiveNpcReward on every input platform.
    if(festival()?.id==='gorkunash'&&festivalHours()&&isRomanceable(walker.rec)
      &&walker.currentScheduleTarget?.festivalLocaleKind==='dance')
      return {icon:'💃',label:'Ask to dance',action:'festival_npc_gift',style:'secondary',allowed:true};
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
    const now=performance.now()/1000;
    copy.feastBuffs=(state.feastBuffs||[]).map(entry=>({...entry,remainingS:Math.max(0,entry.expiresAt-now)})).filter(entry=>entry.remainingS>0);
    return copy;
  }
  function restore(saved) {
    residentCacheAt = -Infinity; effectiveCache = null;
    state = { claims: {}, blessing: null, festivalFun: {}, funDay: null, feastBuffs: [], fullness:{stacks:0,expiresHour:0} };
    heldBowl=null;
    if(saved?.festivalFun&&typeof saved.festivalFun==='object')for(const [id,points] of Object.entries(saved.festivalFun))if(/^[a-z0-9_-]+$/i.test(id)&&Number.isFinite(points))state.festivalFun[id]=Math.max(0,points);
    if(Number.isFinite(saved?.funDay))state.funDay=saved.funDay;
    if(Number.isFinite(saved?.fullness?.expiresHour)&&Number.isFinite(saved?.fullness?.stacks))state.fullness={stacks:Math.max(0,Math.min(10,saved.fullness.stacks)),expiresHour:saved.fullness.expiresHour};
    const now=performance.now()/1000;
    state.feastBuffs=(Array.isArray(saved?.feastBuffs)?saved.feastBuffs:[]).filter(entry=>entry&&Number.isFinite(entry.remainingS)&&entry.remainingS>0)
      .slice(0,24).map(entry=>({...entry,expiresAt:now+Math.min(3000,entry.remainingS)}));
    if (saved?.claims && typeof saved.claims === 'object' && !Array.isArray(saved.claims)) {
      for (const [key, value] of Object.entries(saved.claims)) if (/^\d+:[a-z_]+$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) state.claims[key] = { ...value };
    }
    if (window.FestivalCalendar.blessings[saved?.blessing?.stat] && Number.isFinite(saved.blessing.expiresDay) && Number.isFinite(saved.blessing.level)) state.blessing = { stat: saved.blessing.stat, level: Math.max(1, Math.min(5, Math.trunc(saved.blessing.level))), expiresDay: saved.blessing.expiresDay };
    cancelDance();
    window.FestivalUI?.close?.();
  }
  function npcTarget(rec) {
    if(!deps||!festival()||deps.isFestivalSuspended?.()||!HOME_IDS.has(rec.homeId)||rec.deceased||rec.dead||rec.visitorPresence)return null;
    if(!festivalHours()||(rec.id==='spearhead_unumanuk'&&window.CombatTutorial?.active?.()))return null;
    const stations=layout()?.npcStations||[];
    const index=residents().findIndex(npc=>npc.id===rec.id);
    if(index<0)return null;
    let selected=null;
    if(festival()?.id==='gorkunash'){
      const hour=Number(window.CalendarSystem.getHour())||0;
      const shift=(hour>=15?hour-15:hour+9);
      const leader=shift<5?'foroji_funji':'kaboku_kunji';
      if(rec.id===leader)selected=stations.find(st=>st.festivalNpcId===rec.id&&st.festivalLocaleKind==='bandstand');
      const type=isRomanceable(rec)?['dance','dining','dance','dining'][(Math.floor(shift/2)+index)%4]
        :((index%5===0&&shift%3===1)?'dance':'dining');
      const candidates=stations.filter(st=>st.festivalLocaleKind===type&&st.festivalRole!=='musician');
      if(!selected&&candidates.length)selected=candidates[(index*7+Math.floor(shift/2))%candidates.length];
    } else {
      const choices=stations.filter(st=>st.festivalRole==='guest');
      selected=stations.find(st=>st.festivalNpcId===rec.id)||choices[index%Math.max(1,choices.length)];
    }
    const target=selected&&window.NpcScheduling?.resolveNpcStationTarget?.(selected.id);
    return target?{...target,activity:festival().name}:null;
  }
  function cancelDance() { if (dance) window.SocialActionWheel?.stopDance?.('festival-ended'); dance = null; }
  function update() {
    const now = performance.now(); // Called by gameLoop; no independent animation loop.
    settleFestivalFun();
    if (festival()?.id!=='gorkunash') heldBowl=null;
    if (now - lastTick < 200) return;
    const elapsed = Math.max(0, Math.min(.5, (now - lastTick) / 1000));
    lastTick = now;
    if (deps && now - lastCostumeTick >= 2000) {
      lastCostumeTick = now;
      for (const walker of deps.getWalkers()) {
        const costume = festival()?.id === 'hachutukara' && residents().some(rec => rec.id === walker.rec?.id) ? 'hachutukara' : '';
        if (costumeState.get(walker) !== costume && (costume || costumeState.has(walker))) void window.NpcWardrobe?.refreshWalkerAppearance?.(walker);
        costumeState.set(walker, costume);
      }
    }
    if (dance) {
      const prop = activityProps().find(p => p.id === dance.propId);
      if (eventKey() !== dance.event || !atProp(prop) || !window.SocialActionWheel?.getDebug?.().dancing) cancelDance();
      else if (!deps.isBlocked?.() && !document.hidden) {
        dance.elapsed += elapsed;
        if (dance.targetNpcId) {
          const partner=(deps.getWalkers?.()||[]).find(w=>w.rec?.id===dance.targetNpcId&&w.area==='town'&&w.root?.position);
          const position=deps.getPlayerTile?.();
          if(!partner||!position||Math.hypot(partner.root.position.x-position.c,partner.root.position.z-position.r)>4)cancelDance();
          else {
            dance.awardTime=(dance.awardTime||0)+elapsed;
            const wholeSeconds=Math.floor(dance.awardTime);
            if(wholeSeconds>0){addFestivalFun(dance.targetNpcId,wholeSeconds*15);dance.awardTime-=wholeSeconds;deps.save?.();}
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
      claims:claims(),blessing:state.blessing,dance,heldBowl,festivalFun:state.festivalFun,
      dailyFeast:feastMenu().map(m=>m.label),fullness:currentFullness(),mealBuffs:foodDurationEntries(),lastError,
      latestChange:'Gorkunash movable festival locales, 15:00–01:00 rotations, NPC dances, six-pot feasts and Festival Fun.' };
  }
  function init(injected) {
    deps = injected;
    residentCacheAt = -Infinity;
    window.NpcWardrobe?.registerAppearanceDecorator('festivals', data => {
      if (festival()?.id !== 'hachutukara' || !residents().some(rec => rec.id === data.id)) return data;
      const index = [...data.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % MASKS.length; // Stable animal mask for each named resident.
      return { ...data, equippedCosmetics: [...(data.equippedCosmetics || []).filter(id => !id.startsWith('festivalmask_') && !['hood', 'hat'].includes(window.NpcWardrobe.slotForCosmetic(id))), `festivalmask_${MASKS[index]}`] };
    });
    window.NpcScheduling?.registerTargetOverride('festivals', npcTarget);
    window.EffectBuffBar?.registerProvider('festivals', () => [...buffEntries(), ...foodDurationEntries()]);
    window.CookingSystem?.registerExternalFoodProvider?.('gorkunash-feast', festivalFoodStacks);
  }
  registerActivity('welcome', () => ({ ok: true }));
  registerActivity('remembrance', () => ({ ok: true }));
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
    mark('potluck',{key:payload.key,stars:payload.stars,day:day()});
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
    const id = `festivalmask_${payload.mask}`; // Existing hood cosmetic retains all authored tint layers and species variants.
    if (!deps.grantMask?.(id)) return fail('The mask is unavailable. Try again once its assets have loaded.');
    mark('mask');
    return commit('Your silly animal mask is in your clothing inventory. Equip it from the item panel.');
  });
  registerActivity('story', () => {
    const walker = deps.getWalkers().find(w => w.rec?.id === 'father_hunundi_hodu' && w.area === 'town');
    if (!walker) return fail('Father Hunundi tells the story here between 10:00 and 22:00.');
    window.FestivalUI.close();
    return deps.tellStory(walker, STORY);
  });
  registerActivity('dance', (payload, prop) => {
    if (dance) return fail('You are already dancing.');
    if (!window.SocialActionWheel?.startDance?.('gentle-twirl', 'tpose-jiggle')) return fail('The dance could not start.');
    dance = { propId: prop.id, event: eventKey(), elapsed: 0, claimKey: 'dance' };
    window.FestivalUI.close();
    deps.toast('Dance inside the marked court for 20 seconds. Leaving cancels; the Favor reward is once per festival.', true);
    return { ok: true };
  });
  registerActivity('music', () => { window.FestivalUI.close(); window.MusicMinigame?.beginPlayerSession(); return { ok: true }; });
  registerActivity('liquor', () => {
    if (claimed('liquor')) return fail('You have already received your festival bottle.');
    const key = Object.keys(deps.getItemDefs()).find(key => window.HobunjiDrunkGameplayBridge?.isAlcoholDef?.(deps.getItemDefs()[key]));
    if (!key || !grantItem(key, 1, 4)) return fail('No festival liquor is available, or your inventory is full.');
    mark('liquor');
    return commit(`A bottle of ${deps.getItemDefs()[key].label}. Hold it to drink or offer a swig through the existing item actions.`);
  });
  registerActivity('duel', (payload, prop) => {
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
    festivalHours, feastMenu, festivalBowl, takeFestivalBowl, fillFestivalBowl, eatFestivalBowl, currentFullness, addFestivalFun, askFestivalDance, festivalFoodStacks,
    discardFestivalBowl:()=>{heldBowl=null;},get dance() { return dance; }, getNpcs: () => deps?.getNpcs?.() || [] };
})();

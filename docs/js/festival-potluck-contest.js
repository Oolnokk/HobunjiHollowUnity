// Gorkunash's seeded seven-day contest. FestivalSystem owns its saved roster and contribution.
(() => {
  'use strict';
  const HELM_ID = 'replica_bzabag_helm'; // Used by the Hreesh doorstep reward and the cosmetic catalog.
  const FESTIVAL_START = 4 * 28 + 8 - 1; // Zero-based Highheat 8; used to gate the post-festival visit.
  const DAYS = 7; // One week of six NPC pots plus the player's seventh pot.
  const SPICES = Object.freeze(['travelSpice', 'drySeasonSpice', 'cloudSaffron', 'starpepper', 'nightCardamom']); // Imported seasoning available to wealthy cooks and Engh-sho.
  const MOTHERS = new Set(['gikali_ginju', 'aliri_ginju', 'dzahiri_khibu', 'kinami_kunji']); // Authored family elders with a raised minimum.
  const GRANDMOTHERS = new Set(['teacup_unumanuk']); // Most experienced competitors have the highest quality floor.
  let rewardDeps = null; // Current member's FestivalSystem gear grant/save bridge.
  const hash = value => { let h = 2166136261; for (const ch of String(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function random(seed) {
    let x = hash(seed) || 1; // Local seeded RNG; menu opening/reloading cannot reroll a rival.
    return () => { x += 0x6D2B79F5; let t = Math.imul(x ^ x >>> 15, 1 | x); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function processingDepth(key, defs, seen = new Set()) {
    if (!key || seen.has(key) || seen.size > 8) return 0;
    const def = defs?.[key] || {};
    const prototype = window.HobunjiCookingData?.items?.[key] || {};
    const tier = def.cookingProcessingTier || prototype.processingTier || 'raw';
    const direct = (def.ingredientKeys || def.giftIngredientKeys || []).filter(x => x && x !== key);
    const processed = tier !== 'raw' || !!def.isCookedFood || direct.length > 0;
    if (!processed) return 0;
    const visited = new Set(seen); visited.add(key);
    return Math.min(3, 1 + (direct.length ? Math.max(...direct.map(input => processingDepth(input, defs, visited))) : 0));
  }
  function ingredientPoints(key, stars, defs) {
    const quality = Math.max(1, Math.min(5, Math.trunc(Number(stars) || 1)));
    return quality * (2 ** processingDepth(key, defs));
  }
  function scoreIngredients(entries, defs) {
    return (entries || []).reduce((sum, item) => sum + ingredientPoints(item.key, item.stars, defs), 0);
  }
  function scoreCooked(def, stars, defs) {
    if (!def) return 0;
    if (Number.isFinite(def.festivalContestScore)) return Math.max(0, Math.trunc(def.festivalContestScore));
    const entries = Array.isArray(def.festivalIngredientQuality) ? def.festivalIngredientQuality
      : (def.ingredientKeys || []).map(key => ({ key, stars }));
    return entries.length ? scoreIngredients(entries, defs) : Math.max(1, Math.min(5, Number(stars) || 1));
  }
  function ingredientDefinition(key, defs) {
    const authored = window.HobunjiCookingData?.items?.[key] || {}; // Cooking's prototype source remains available before registerIngredientItems runs.
    const runtime = defs?.[key] || {}; // Live cooking rules override authored defaults when equipment/processing updates an ingredient.
    return { ...runtime, label:runtime.label || authored.name || key, icon:runtime.icon || '🥕',
      cookingPrimaryEffect:runtime.cookingPrimaryEffect || authored.primaryEffect,
      cookingBaseBoost:runtime.cookingBaseBoost ?? authored.baseBoost ?? 1,
      cookingProcessingTier:runtime.cookingProcessingTier || authored.processingTier || 'raw',
      cookingDefaultStars:runtime.cookingDefaultStars || 3 };
  }
  function ingredientEffects(key, stars, defs) {
    const def = ingredientDefinition(key, defs); // Exactly the definition the cooking UI uses for its ingredient contribution.
    const canonical = window.CookingSystem?.ingredientEffectTotals?.(def, stars);
    if (canonical) return canonical; // No separate balancing math when cooking is initialized.
    if (def.foodEffects && Object.keys(def.foodEffects).length) return { ...def.foodEffects };
    if (!def.cookingPrimaryEffect) return {};
    const data = window.HobunjiCookingData;
    const tier = data?.processingTiers?.[def.cookingProcessingTier] || data?.processingTiers?.raw || { multiplier:1 };
    const quality = Math.max(1,Math.min(5,Math.round(Number(stars) || Number(def.cookingDefaultStars) || 3)));
    return { [def.cookingPrimaryEffect]:Math.max(1,Math.ceil(def.cookingBaseBoost * (1+(quality-1)/2) * (tier.multiplier || 1))) };
  }
  function mealEffects(ingredients, defs) {
    const effects = {}; // Used both by meal previews and actual festival buffs after the first bite.
    for (const entry of ingredients || []) {
      if (entry.contributesEffects === false) continue; // Recipe-specific structural ingredients count for judging but never grant a cooking buff.
      for (const [effect, amount] of Object.entries(ingredientEffects(entry.key,entry.stars,defs)))
        effects[effect] = (effects[effect] || 0) + amount;
    }
    return effects;
  }
  function ingredientBreakdown(ingredients, defs) {
    return (ingredients || []).map(entry => {
      const def = ingredientDefinition(entry.key,defs);
      const stars = Math.max(1,Math.min(5,Math.round(Number(entry.stars) || 1)));
      const multiplier = 2 ** processingDepth(entry.key,defs);
      return {key:entry.key,label:def.label,icon:def.icon,stars,multiplier,
        points:ingredientPoints(entry.key,stars,defs),
        contributesEffects:entry.contributesEffects !== false,
        effects:entry.contributesEffects === false ? {} : ingredientEffects(entry.key,stars,defs)};
    });
  }
  function profileFor(rec) {
    const id = String(rec?.id || '').toLowerCase();
    const species = String(rec?.speciesId || rec?.species || '').toLowerCase();
    const role = String(rec?.role || rec?.occupation || rec?.job || '').toLowerCase();
    if (id === 'harkharash' || id.includes('kharkanash') || /surveyor/.test(role)) return 'surveyor';
    if (id === 'jubmir') return 'trader';
    if (id === 'hreesh') return 'innkeeper';
    if (id === 'sloomi' || species === 'mashtzarr' || species === 'mammakh' || species === 'mammakhbuur') return 'highland';
    if (id.includes('ginju')) return 'ginju';
    if (species === 'kenkari' || species === 'rakakoan') return 'kenkari';
    if (species === 'engh-sho' || species === 'harlyao') return 'engh-sho';
    if (/fish/.test(role)) return 'kenkari';
    if (/farm|gardener|grower/.test(role)) return 'ginju';
    if (/trade|merchant/.test(role)) return 'trader';
    return 'town';
  }
  const MENUS = Object.freeze({
    'ginju': [
      { name:'Harvest Vegetable Medley', keys:['heftroot','garlink','ongyums','greenMustard','needlegrain'] },
      { name:'Ginju Garden Scramble', keys:['heftroot','ongyums','blackMustard','garlink','nelkEggs'] },
      { name:'Four-Vegetable Stew', keys:['heftroot','garlink','ongyums','greenMustard','blackMustard'] },
    ],
    'kenkari': [
      { name:'Archipelago Fish Chowder', keys:['riverFish','fishSauce','puktukMilk','heftroot'] },
      { name:'Kenkari Fish Noodles', keys:['cloudFish','fishSauce','needlegrainFlour'] },
      { name:'Island Fish Roast', keys:['riverFish','garlink','travelSpice'] },
    ],
    'engh-sho': [
      { name:'Spiced Nelk and Eggs', keys:['nelkMeat','nelkEggs','starpepper','puktukMilk','nelkMayonnaise'] },
      { name:'Nelk Roast with Imported Spices', keys:['nelkMeat','smokedMeat','nightCardamom','nelkEggs','nelkMayonnaise'] },
      { name:'Creamy Highland Meat Pot', keys:['nelkMeat','voorgAssMilk','cloudSaffron','nelkEggs','smokedMeat'] },
    ],
    'highland': [
      { name:'Cold-Plain Root and Meat Stew', keys:['heftroot','puktukMeat','puktukMilk','garlink'] },
      { name:'Snowfield Egg Chowder', keys:['nelkEggs','needlegrain','smokedMeat','puktukMilk'] },
      { name:'Highland Hearth Pot', keys:['heftroot','nelkMeat','needlegrainFlour','voorgAssMilk'] },
    ],
    'trader': [
      { name:'Caravan Spice Banquet', keys:['nelkMeat','cloudSaffron','nightCardamom','fishSauce'] },
      { name:'Five Lands Chowder', keys:['cloudFish','starpepper','puktukMilk','heftroot'] },
      { name:'Imported Spiced Noodles', keys:['needlegrainFlour','nelkMeat','travelSpice','cloudSaffron'] },
    ],
    'surveyor': [
      { name:'Extravagantly Prepared Supper', keys:['smokedMeat','fishSauce','uumkaoiiCheese','nelkMayonnaise','needlegrainFlour'] },
      { name:'Company Banquet Deluxe', keys:['smokedMeat','fishSauce','redberryJam','uumkaoiiCheese','nelkMayonnaise'] },
      { name:'Overworked Victory Stew', keys:['smokedMeat','nelkMayonnaise','fishSauce','uumkaoiiCheese','heftrootFlour'] },
    ],
    'innkeeper': [
      { name:'Hearth Special', keys:['smokedMeat','heftroot','nelkEggs','garlink','nelkMayonnaise'] },
      { name:'Finest Chowder', keys:['nelkMeat','puktukMilk','needlegrain','travelSpice','smokedMeat'] },
      { name:'Slow-Cooked Stew', keys:['smokedMeat','heftroot','ongyums','puktukMilk','fishSauce'] },
    ],
    'town': [
      { name:'Shared Hearth Supper', keys:['heftroot','nelkMeat','garlink','nelkEggs'] },
      { name:'Town Harvest Chowder', keys:['puktukMilk','needlegrain','garlink','smokedMeat'] },
      { name:'Festival Roast', keys:['nelkMeat','ongyums','travelSpice','heftroot'] },
    ],
  });
  function bounds(rec) {
    const id = String(rec.id || '').toLowerCase();
    const role = String(rec.role || rec.occupation || '').toLowerCase();
    if (GRANDMOTHERS.has(id) || rec.isGrandmother || /grandmother|grandma/.test(role)) return { min:27, max:40 };
    if (id === 'hreesh') return { min:23, max:38 };
    if (MOTHERS.has(id) || rec.isMother || /\bmother\b/.test(role)) return { min:16, max:36 };
    if (profileFor(rec) === 'surveyor') return { min:16, max:34 };
    return { min:7, max:34 };
  }
  function npcName(rec) {
    return String(rec?.name || rec?.displayName || rec?.id || 'Villager')
      .replace(/_[a-z]+$/i, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  function mealFor(rec, seed, defs) {
    const rng = random(seed); // One independent daily RNG per NPC; score stays stable even if other villagers leave.
    const profile = profileFor(rec), variants = MENUS[profile] || MENUS.town;
    const selection = variants[Math.floor(rng() * variants.length)];
    const allowed = selection.keys.filter(key => defs?.[key] || window.HobunjiCookingData?.items?.[key]);
    const fallback = Object.keys(window.HobunjiCookingData?.items || {}).filter(key => defs?.[key] || window.HobunjiCookingData?.items?.[key]).slice(0,4); // Reduced cooking fixtures still serve real registered ingredients.
    const keys = allowed.length ? allowed : (fallback.length ? fallback : selection.keys);
    const limits = bounds(rec);
    const target = limits.min + Math.floor(rng() * (limits.max - limits.min + 1)); // One rolled strength target per dish; experienced cooks have higher floors.
    let best = null; // Closest *achievable* ingredient sum, never a fabricated clamped rating.
    for (let attempt = 0; attempt < 160; attempt++) {
      const ingredients = keys.map(key => ({ key, stars:1 + Math.floor(rng() * 5) }));
      const score = scoreIngredients(ingredients, defs);
      const inBounds = score >= limits.min && score <= limits.max;
      const distance = inBounds ? Math.abs(score - target) : 1000 + Math.max(limits.min - score, score - limits.max, 0);
      if (!best || distance < best.distance || (distance === best.distance && rng() < .3)) best = { ingredients, score, distance };
      if (inBounds && score === target) break;
    }
    // Never display an invented rating different from the constituent ingredient arithmetic.
    const actual = best || { ingredients:[], score:0 };
    const effects = mealEffects(actual.ingredients,defs); // Actual eating benefits scale with quality and processing, independent of contest ranking.
    return { id:'npc:' + seed, npcId:rec.id, owner:npcName(rec), dish:selection.name,
      label:npcName(rec) + "'s " + selection.name, icon:'🍲', ingredients:actual.ingredients,
      score:actual.score, cap:limits.max, minimum:limits.min, foodEffects:effects };
  }
  function buildDays(records, year, defs) {
    const candidates = (records || []).filter(rec => rec?.id && !rec.dead && !rec.deceased).slice().sort((a,b)=>a.id.localeCompare(b.id));
    const result = []; // Seven saved daily menus: 6 rotating contributors per day, no per-frame generation.
    for (let d = 0; d < DAYS; d++) {
      const rotated = candidates.map((rec,index) => ({ rec, sort:hash(year + ':' + d + ':' + rec.id) }))
        .sort((a,b)=>a.sort-b.sort).map(x=>x.rec);
      result.push(Array.from({ length:6 }, (_,i) => {
        const rec = rotated[i % rotated.length] || { id:'town_cook_' + i, name:'Town Cook ' + (i+1) };
        return mealFor(rec, year + ':' + d + ':' + rec.id + ':' + i, defs);
      }));
    }
    return result;
  }
  function winner(entry, days) {
    if (!entry || !Number.isFinite(entry.score)) return false;
    return entry.score >= Math.max(0, ...((days || []).flat().map(meal => Number(meal.score) || 0)));
  }
  function registerRewardVisit(deps, getContests, markRewarded, worldDay) {
    rewardDeps = deps;
    window.DoorstepVisits?.registerProvider?.({
      id:'gorkunash-potluck-prize', priority:15,
      next() {
        const contests = getContests() || {};
        const pending = Object.entries(contests).filter(([key,data]) => {
          const match = /^(\d+):gorkunash$/.exec(key);
          return match && worldDay() >= Number(match[1]) * 336 + FESTIVAL_START + DAYS
            && data?.entry && !data.rewarded && !window.DoorstepVisits?.isDone?.('gorkunash-potluck:' + key)
            && winner(data.entry, data.days);
        }).sort((a,b)=>Number(b[0].split(':')[0])-Number(a[0].split(':')[0]));
        if (!pending.length) return null;
        const [event,data] = pending[0];
        const lines = [
          "There you are! I have the results of the Gorkunash potluck.",
          "Your " + data.entry.label + " earned " + data.entry.score + " stars. That's the highest total of the whole week.",
          "It's a replica, mind you, but it's a fine one. The Replica Helm of Bzabag is yours. Wear it proudly!",
        ];
        return { key:'gorkunash-potluck:' + event, npcId:'hreesh', tree:{
          id:'gorkunash_potluck_prize_' + event.replace(':','_'), label:'Gorkunash Potluck Champion',
          trigger:'interact', priority:100, entryNode:'line0',
          nodes:lines.map((line,index)=>({id:'line' + index,type:'text',text:line,next:index+1<lines.length?'line'+(index+1):null}))
        }, event };
      },
      onComplete(visit) {
        // Grant only after natural dialogue completion; a failed inventory grant leaves the visit pending.
        if (!rewardDeps?.grantMask?.(HELM_ID)) return false;
        window.MetalArmorSystem?.prepareFestivalHelmPrize?.(); // Convert the ordinary festival cosmetic reward into a metal faceguard + wool cap article, with town-gated chest alloy.
        markRewarded(visit.event);
        rewardDeps.save?.();
        window.DoorstepVisits?.markDone?.(visit.key);
        return true;
      }
    });
  }
  window.FestivalPotluckContest = Object.freeze({ HELM_ID, DAYS, SPICES, profileFor, bounds, processingDepth,
    ingredientPoints, scoreIngredients, scoreCooked, ingredientEffects, mealEffects, ingredientBreakdown, buildDays, winner, registerRewardVisit });
})();

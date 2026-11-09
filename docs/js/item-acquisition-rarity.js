// Reusable, economy-neutral item acquisition rarity. Source odds come from the
// actual generators; authored sell prices NEVER feed back into acquisition odds.
(() => {
  'use strict';
  if (window.ItemAcquisitionRarity) return;

  const VERSION = 1; // Saved recipes keep the scoring version that judged their ingredients.
  const FISH_SEASONS = ['spring','summer','fall','winter']; // Enumerates the authored fishing calendar.
  const FISH_TIMES = ['dawn','day','dusk','night']; // Enumerates fishing daypart eligibility.
  const RARITY_PRICE_CAP = .35; // Limits the sale-price uplift to protect established progression.
  const RARITY_CONTEST_CAP = .65; // Limits additional Gorkunash points from acquisition difficulty.
  const MAX_RECIPE_DEPTH = 6; // Prevents recursive recipe dependencies and expensive cycle walks.
  let cache = new WeakMap(); // ITEM_DEFS object -> key/Town Value -> valuation.
  let fallbackCache = new Map(); // Handles pre-bootstrap calls with no ITEM_DEFS object.
  let indexedPools = null; // Rebuilds only when LootRolling replaces its pool map.
  let indexedSources = new Map(); // Item -> actual independent loot-pool entries.
  let lastEvaluation = null; // Mobile diagnostic evidence of the most recent evaluated item.

  const num = (v, fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const prob = v => clamp(num(v),0,1);
  const rounded = (v,dp=3) => Number(v.toFixed(dp));
  const mean = (a,b) => (num(a,1)+num(b,num(a,1)))/2;

  function origin(kind,label,p,quantity=1,opportunities=1,effort=1,certainty='exact',details={}) {
    const probability = prob(p); // Probability per opportunity, not per arbitrary unit of real-world time.
    const expectedUnits = probability * Math.max(0,num(quantity,1)) * Math.max(0,num(opportunities,1));
    return {kind,label,probability:rounded(probability,7),quantity:rounded(Math.max(0,num(quantity,1))),
      opportunities:rounded(Math.max(0,num(opportunities,1))),expectedUnits:rounded(expectedUnits,7),
      effort:rounded(Math.max(1,num(effort,1))),certainty,...details};
  }

  function lootIndex() {
    const pools = window.LootRolling?.getLootPools?.() || null; // Includes user-edited loot tables.
    if (!pools || typeof pools !== 'object') return indexedSources;
    if (pools === indexedPools) return indexedSources;
    indexedPools = pools;
    indexedSources = new Map();
    for (const [id,pool] of Object.entries(pools)) for (const entry of pool?.entries || []) {
      if (!entry?.itemKey) continue;
      if (!indexedSources.has(entry.itemKey)) indexedSources.set(entry.itemKey,[]);
      indexedSources.get(entry.itemKey).push({id,entry});
    }
    cache = new WeakMap();
    fallbackCache.clear();
    return indexedSources;
  }

  function ruinContext() {
    const tiers = window.RuinLayerPlan?.TIERS || {}; // Exact playable floor/wing/rooms structure.
    let status = null;
    try { status = window.RuinSites?.debugSnapshot?.(); } catch (_) {}
    const placed = Object.values(status?.zones || {}).reduce((total,list)=>total+(list?.length || 0),0);
    const zones = window.WildernessMapGenerator?.zoneMapIds?.()?.length || 0;
    const siteCount = placed || (zones ? 5*zones : 0); // Five default candidates per zone is a proxy, not a measured placement.
    const live = window.DevRandomRuinDungeonChests?.snapshot?.() || []; // Actual chest counts while a ruin exists.
    const holeRoll = window.RuinSites?.treasureHoleChance?.();
    return { siteCount:siteCount || null,siteCountMeasured:placed>0,
      guardianCount:3, // One first-entered key-stone grave per Harlyao planar tradition.
      guardianShare:siteCount ? Math.min(1,3/siteCount) : null,
      buriedRuinChance:Number.isFinite(Number(holeRoll)) ? prob(holeRoll) : null,
      tiers:Object.fromEntries(Object.entries(tiers).map(([key,t])=>[key,{
        floors:num(t.floors),wings:num(t.wings),roomsPerWing:num(t.wingRooms),
        rooms:num(t.floors)+num(t.wings)*num(t.wingRooms)}])),
      liveChestCounts:Object.fromEntries([1,2,3,4].map(tier=>[tier,live.filter(c=>c.tier===tier).length])),
      liveChestData:live.length>0 };
  }

  function chestSource(tier,ruin) {
    const kind=tier===4?'lich':'hole'; // Cave-only ruin sites are not active; don't mislabel their small-tier chances.
    const layout=ruin.tiers[kind] || {floors:1,wings:1,rooms:1};
    const vaultCount=window.DevRandomRuinConfig?.get?.('sanctum.vault.chestCount',3);
    const exact=tier===4||ruin.liveChestData;
    const count=ruin.liveChestData ? ruin.liveChestCounts[tier]
      :tier===4 ? clamp(Math.round(num(vaultCount,3)),0,6) : 1;
    const siteShare=ruin.guardianShare == null?null:(tier===4?ruin.guardianShare:1-ruin.guardianShare);
    return {kind,layout,count,siteChance:siteShare==null?1:siteShare,
      effort:1+layout.floors*.6+layout.rooms*.11+tier*.25,
      certainty:exact?(tier===4?'authored':'live'):'conditional-chest',
      chanceKnown:siteShare!=null};
  }

  function artifactChance(key,tier,culture) {
    const list=Object.entries(window.ArtifactCollection?.ARTIFACTS || {})
      .filter(([name,d])=>num(d?.tier,Infinity)<=tier && name.startsWith('hachutu')===(culture==='hachutu'));
    const target=list.find(([name])=>name===key)?.[1];
    if (!target) return null;
    const total=list.reduce((sum,[,d])=>sum+Math.max(0,num(d.weight)),0);
    const single=total>0?prob(num(target.weight)/total):0; // Weight divided by eligible tier pool mass.
    const range=window.ArtifactCollection?.LOOT_TUNING?.countsByTier?.[tier-1] || {min:1,max:1};
    const min=Math.max(1,Math.round(num(range.min,1)));
    const max=Math.max(min,Math.round(num(range.max,min)));
    let any=0; // Exact probability of at least one matching artifact across with-replacement draws.
    for (let n=min;n<=max;n++) any+=1-Math.pow(1-single,n);
    const p=any/(max-min+1);
    return {probability:p,quantity:p?mean(min,max)*single/p:0,drawWeight:num(target.weight),totalWeight:total};
  }

  function lootOrigins(key,list,ruin) {
    for (const {id,entry} of lootIndex().get(key)||[]) {
      const chestMatch=/^dungeonChest_tier([1-4])$/.exec(id);
      const chest=chestMatch?chestSource(Number(chestMatch[1]),ruin):null;
      const conditional=Object.keys(entry.conditions || {}).length>0;
      list.push(origin(chest?'chest-loot':'loot',id,prob(entry.chance??1)*(chest?.siteChance??1),
        mean(entry.min,entry.max),chest?.count??1,chest?.effort??1.2,
        conditional?'conditional-filters':chest?.certainty||'exact',{
          ...(chest?{chestTier:Number(chestMatch[1]),ruinKind:chest.kind,floors:chest.layout.floors,
            wings:chest.layout.wings,rooms:chest.layout.rooms,chestsPerRuin:chest.count,
            siteCount:ruin.siteCount,siteCountMeasured:ruin.siteCountMeasured}:{}),
          ...(conditional?{note:'Conditions are not assigned fabricated season/weather frequencies'}:{})}));
    }
    const artifact=window.ArtifactCollection?.ARTIFACTS?.[key];
    if (!artifact) return;
    const culture=key.startsWith('hachutu')?'hachutu':'harlyao';
    for(let tier=1;tier<=4;tier++) {
      const pool=window.LootRolling?.getLootPools?.()?.['dungeonChest_tier'+tier];
      if(culture==='harlyao'&&!pool?.entries?.some(e=>e.generatorKey==='harlyaoArtifact'))continue;
      const odds=artifactChance(key,tier,culture);
      if(!odds)continue;
      const chest=chestSource(tier,ruin);
      list.push(origin('artifact','Weighted artifact in tier '+tier+' chest',odds.probability*chest.siteChance,
        odds.quantity,chest.count,chest.effort,chest.certainty,{
          chestTier:tier,ruinKind:chest.kind,floors:chest.layout.floors,wings:chest.layout.wings,
          rooms:chest.layout.rooms,chestsPerRuin:chest.count,drawWeight:odds.drawWeight,
          totalEligibleWeight:odds.totalWeight,siteCount:ruin.siteCount}));
    }
  }

  function crops(key,list) {
    const data=window.CropVarieties?.rarityProfile?.(key); // Shares real crop genome, trader and growing math.
    if(!data)return false;
    const townValue=Math.max(0,num(window.TownMine?.getTownValue?.()));
    const arrival=window.SlagothimTraders?.dailySpawnChance?.(townValue)
      ??(townValue<1?0:Math.min(.7,.15+(townValue-1)*.06));
    const growDays=Math.max(1,num(data.growDays,3));
    const cultivationEffort=1+growDays/4;
    if(data.native)list.push(origin('cultivation','Native plot harvest',1,1,1/growDays,
      cultivationEffort,'authored',{growDays}));
    else if(data.pureImport)list.push(origin('import','Slagothim regional seed stock',
      arrival*num(data.chancePerCaravan),num(data.meanOfferQuantity,3.5),1,
      cultivationEffort,'authored-before-route-access',{
        caravanDailyChance:rounded(arrival),familySelectionChance:rounded(num(data.familyPickChance)),
        regionalSelectionChance:rounded(num(data.regionPickChance)),growDays,seedDerivedProduce:!data.isSeed}));
    else {
      const choices=Math.max(1,num(data.breedingChoices,1));
      list.push(origin('crossbreeding','Seed maker crossbred genome',Math.pow(.5,choices),1,1,
        cultivationEffort+num(data.seedMakerDays), 'proxy-parent-genes',{
          geneChoices:choices,mutationRate:num(data.mutationRate),
          note:'Parent alleles are not recorded on an inventory seed: genetic probability is a 50/50 locus proxy'}));
    }
    return true;
  }

  function tradersAndShops(key,list) {
    const traders=window.SlagothimTraders;
    if((traders?.IMPORTED_SPICES||[]).includes(key)) {
      const townValue=Math.max(0,num(window.TownMine?.getTownValue?.()));
      const arrival=traders.dailySpawnChance?.(townValue)
        ??(townValue<1?0:Math.min(.7,.15+(townValue-1)*.06));
      const spices=traders.IMPORTED_SPICES;
      list.push(origin('trade','Imported Slagothim spice',arrival*1.5/spices.length,2,1,1.7,
        'expected-offer-count',{caravanDailyChance:rounded(arrival),spicePool:spices.length}));
    }
    const shops=window.LootRolling?.getShopStock?.()||{};
    for(const [id,shop] of Object.entries(shops)) {
      const entry=(shop?.goods||[]).find(e=>e?.key===key||e?.itemKey===key);
      if(!entry)continue;
      const gate=Math.max(0,num(entry.minTownValue??shop.minTownValue));
      if(num(window.TownMine?.getTownValue?.())<gate)continue;
      list.push(origin('shop','Shop: '+id,1,Math.max(1,num(entry.qty??entry.quantity,1)),1,
        1+gate/2,'conditional-shop-stock',{townValueRequirement:gate,
          note:'An authored listing is not an infinite supply; restock and store access unmodeled'}));
    }
  }

  function offspring(key,list,def,options) {
    const tags=Array.isArray(def.tags)?def.tags:[];
    if(def.cat!=='livestock'&&!tags.includes('Baby')&&!(tags.includes('Egg')&&tags.includes('Fertile')))return false;
    const config=window.SCRATCHBONES_CONFIG?.game||{};
    const mothers=Object.entries(config.wildlife?.denMothers||{}).filter(([,d])=>d.nestItemKey===key);
    const species=config.livestock?.itemKinds?.[key]||mothers[0]?.[0]||null;
    const clutch=config.wildlife?.nestClutch||{};
    const zones=window.WildernessMapGenerator?.zoneMapIds?.()||[];
    let total=0,matching=0;
    for(const zone of zones)try {
      for(const den of window.WildlifeSpawn?.denCensus?.(zone)||[]) {
        total++;
        if(den.species===species||mothers.some(([kind])=>den.species===kind))matching++;
      }
    }catch(_){}
    if(mothers.length)list.push(origin('wild-nest','Nest of '+species,
      total?matching/total:1/Math.max(1,Object.keys(config.wildlife?.denMothers||{}).length),
      Math.max(1,mean(clutch.min,clutch.max)),total||1,2.5,
      total?'live-den-census':'den-species-proxy',{totalDens:total||null,matchingDens:total?matching:null,
        clutchMin:clutch.min??null,clutchMax:clutch.max??null}));
    const gestation=num(window.FarmAnimals?.GESTATION_DAYS);
    if(species&&gestation>0)list.push(origin('animal-breeding','Breeding '+species,1,1,1,
      1+gestation/2,'requires-owned-compatible-parents',{gestationDays:gestation}));
    if(options.genotype) {
      const inherited=window.CreatureGenetics?.sellValueFor?.(species,options.genotype);
      if(inherited&&Number.isFinite(Number(inherited.animalValue)))list.push(origin('genotype',
        'Inherited animal genetics',.5,1,1,Math.max(1,num(inherited.animalValue)/100),
        'unknown-parent-proxy',{animalValue:num(inherited.animalValue)}));
    }
    return true;
  }

  function fishing(key,list) {
    const entries=window.FishCatalog?.entries||[];
    const fish=entries.find(f=>f.key===key);
    if(!fish)return false;
    const weights=window.ECONOMY_PROGRESSION_CONFIG?.referenceFishing?.rarityWeights||{common:6,uncommon:3,rare:1};
    const zones=[...new Set(entries.flatMap(f=>f.zones||[]))];
    let contexts=0,eligible=0,weightShare=0;
    for(const zone of zones)for(const season of FISH_SEASONS)for(const time of FISH_TIMES) {
      const pool=entries.filter(f=>(f.zones||[]).includes(zone)
        &&(f.seasons==='any'||String(f.seasons).split(',').includes(season))
        &&(f.timesOfDay==='any'||String(f.timesOfDay).split(',').includes(time)));
      if(!pool.length)continue;
      contexts++;
      if(!pool.some(f=>f.key===key))continue;
      eligible++;
      const mass=pool.reduce((sum,f)=>sum+Math.max(0,num(weights[f.rarity],1)),0);
      weightShare+=mass?num(weights[fish.rarity],1)/mass:0;
    }
    list.push(origin('fishing','Zone, season and daypart fishing',contexts?weightShare/contexts:0,
      1,1,1+num(fish.difficulty)/75+(fish.amphibious?1:0),
      'authored-context-average',{sampledContexts:contexts,eligibleContexts:eligible,
        zones:(fish.zones||[]).length,amphibious:!!fish.amphibious,difficulty:num(fish.difficulty)}));
    return true;
  }

  function crafted(key,list,defs,def,depth,ancestors) {
    if(depth>=MAX_RECIPE_DEPTH)return;
    const inputs=(Array.isArray(def.ingredientKeys)?def.ingredientKeys:def.giftIngredientKeys)||[];
    const distinct=inputs.filter(k=>k&&k!==key&&!ancestors.has(k));
    if(!distinct.length)return;
    let bits=0,effort=0,known=0;
    for(const input of distinct) {
      const result=calculate(input,defs,{},depth+1,new Set([...ancestors,key]));
      if(!result.known)continue;
      bits+=result.surprisalBits*result.surprisalBits;
      effort+=result.effort;
      known++;
    }
    if(!known)return;
    const processing=String(def.cookingProcessingTier||def.processingTier||'raw').toLowerCase();
    const stage=['raw','low','medium','high','long','cooked'].indexOf(processing);
    list.push(origin('processing','Crafted from '+known+' sourced inputs',
      Math.pow(2,-Math.sqrt(bits/known)),1,1,
      1+Math.max(0,stage)*.2+effort/known,'input-dependency-estimate',{ingredientCount:known,processing}));
  }

  function calculate(key,defs,options={},depth=0,ancestors=new Set()) {
    const def=options.def||defs?.[key]||window.HobunjiCookingData?.items?.[key]||{};
    const sources=[]; // Independent opportunities; no sum of a fish cast and a ruin opening.
    crops(key,sources);
    tradersAndShops(key,sources);
    offspring(key,sources,def,options);
    fishing(key,sources);
    lootOrigins(key,sources,ruinContext());
    if(def.dropChance!=null||def.spawnChance!=null||def.acquisitionChance!=null)
      sources.push(origin('direct-drop','Authored drop chance',def.dropChance??def.spawnChance??def.acquisitionChance,
        mean(def.dropMin,def.dropMax),1,num(def.acquisitionEffort,1),'authored'));
    crafted(key,sources,defs,def,depth,ancestors);
    const accessible=sources.filter(s=>s.certainty!=='requires-owned-compatible-parents'||options.hasBreedingPair);
    const best=accessible.reduce((prev,current)=>{
      const old=prev?prev.expectedUnits/prev.effort:-1;
      return current.expectedUnits/current.effort>old?current:prev;
    },null);
    if(!best)return {key,version:VERSION,known:false,score:0,surprisalBits:0,
      contestMultiplier:1,priceMultiplier:1,effort:1,sources,
      uncertainty:sources.length?'needs compatible breeding parents':'unmodeled source'};
    const units=clamp(best.expectedUnits/best.effort,1e-9,1);
    const bits=-Math.log2(units);
    const score=clamp(rounded(bits*8+Math.log2(1+best.effort)*5,1),0,100);
    return {key,version:VERSION,known:true,score,surprisalBits:rounded(bits),
      effort:best.effort,sourceLabel:best.label,acquisitionRoute:best.kind,
      uncertainty:best.certainty,
      contestMultiplier:rounded(1+Math.min(RARITY_CONTEST_CAP,Math.max(0,score-12)/140)),
      priceMultiplier:rounded(1+Math.min(RARITY_PRICE_CAP,Math.max(0,score-24)/250)),sources};
  }

  function evaluate(key,options={}) {
    const defs=options.defs||null;
    if(!key||typeof key!=='string')return calculate('',defs,options);
    lootIndex(); // Recognizes hot-reloaded loot-shop editor overrides.
    const entries=defs&&typeof defs==='object'
      ?(cache.get(defs)||(cache.set(defs,new Map()),cache.get(defs))):fallbackCache;
    const stamp=String(window.TownMine?.getTownValue?.()??'')+':' + key; // Town growth changes caravan frequency.
    if(!options.force&&!options.genotype&&!options.def&&entries.has(stamp))return entries.get(stamp);
    const result=calculate(key,defs,options);
    if(!options.force&&!options.genotype&&!options.def)entries.set(stamp,result);
    lastEvaluation={key,score:result.score,source:result.sourceLabel,certainty:result.uncertainty};
    return result;
  }

  function contestMultiplier(key,options={}) {return evaluate(key,options).contestMultiplier;}
  function sellPrice(key,authoredPrice,options={}) {
    const base=num(authoredPrice,NaN);
    if(!Number.isFinite(base)||base<=0)return authoredPrice;
    const def=options.def||options.defs?.[key];
    if(def?.rarityPriced)return base; // Newly cooked food already includes priced source ingredients.
    const rarity=evaluate(key,options);
    if(!rarity.known)return base;
    const crop=window.CropVarieties?.rarityProfile?.(key);
    // Starter native crop and fish prices are already tuned against early-game income.
    if(crop?.native||window.FishCatalog?.get?.(key))return base;
    return Math.max(1,Math.round(base*rarity.priceMultiplier));
  }

  function invalidate() {
    cache=new WeakMap();
    fallbackCache.clear();
    indexedPools=null;
    indexedSources=new Map();
  }
  window.ItemAcquisitionRarity=Object.freeze({VERSION,evaluate,contestMultiplier,sellPrice,
    ruinContext,invalidate,debugSnapshot:()=>({lastEvaluation,ruins:ruinContext(),
      indexedItemCount:indexedSources.size,
      latestChange:'Acquisition math considers ruin floors/rooms/chests, weighted drops, imported seed/trader odds, genetics, fish and processing. Unsourced items retain baseline price.'})});
})();
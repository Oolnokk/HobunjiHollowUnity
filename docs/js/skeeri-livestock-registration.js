// Domestic Skeeri share Pingdort's farm/Nursery/Stable pipeline; ruin enemies stay separate.
(() => {
  'use strict';
  if (window.SkeeriLivestockRegistration) return;
  const KIND = 'skeeri'; // Shared species key for livestock, breeding and Stable records.
  const FERTILE_EGG = 'fertileSkeeriEgg'; // Collectible egg that becomes a domestic Skeeri.
  const FARM_EGG = 'skeeriEgg'; // Ordinary unfertilized product from housed Skeeri.
  const SPRITES = Object.freeze({
    flying: 'assets/creaturesprites/skeeri_planebent_flying.png',
    perched: 'assets/creaturesprites/skeeri_planebent_perched.png',
    wings: 'assets/creaturesprites/skeeri_wings.png',
  }); // Reuses the existing authored planebent Skeeri artwork.
  const COLORS = Object.freeze([
    ['rust', '#854e48'], ['ochre', '#967d55'],
    ['seaglass', '#497a75'], ['blue', '#5f788d'],
    ['indigo', '#56506b'], ['violet', '#6b536d'],
  ]); // Breedable coats drawn from the established three ruin tradition palettes.
  const memory = new Map(); // One clutch count per world, ruin seed and room within this session.
  const debug = {registered:false, eggsCollected:0, clutchesExhausted:0, lastNest:null, lastError:null}; // Mobile-readable diagnostics.
  let deps = null; // WildlifeSpawn's existing inventory, save, and HUD dependency seam.
  const validHex = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));
  const validTheme = value => ['hronal', 'tothal', 'kanthic'].includes(value);

  function configureLivestock() {
    const game = window.SCRATCHBONES_CONFIG?.game;
    if (!game) return false;
    const livestock = game.livestock || (game.livestock = {});
    (livestock.itemKinds || (livestock.itemKinds = {}))[FERTILE_EGG] = KIND; // Item-to-animal mapping read by FarmAnimals.
    (livestock.animalWidths || (livestock.animalWidths = {}))[KIND] = .65; // Native small Skeeri width in barn pens.
    (livestock.diet || (livestock.diet = {}))[KIND] = 'predator'; // Same feed restrictions as Pingdort.
    (livestock.resources || (livestock.resources = {}))[KIND] = {itemKey:FARM_EGG,cooldownDays:2}; // Same egg timer as Pingdort.
    const genetics = game.creatureGenetics || (game.creatureGenetics = {});
    const palettes = genetics.palettes || (genetics.palettes = {});
    palettes[KIND] ||= COLORS.map(([id,hex]) => ({id,name:id,hex,weight:1})); // Existing genetics handles random coats and offspring.
    return true;
  }

  function register(injected = {}) {
    const db = injected.CREATURE_DB;
    if (!db) return false;
    const baseline = db['gar-wolf'] || db.grehlr || {};
    const previous = db[KIND] || {};
    db[KIND] = {...baseline,...previous,label:'Skeeri',hostile:false,diet:'carnivore',
      defaultSizeClass:'small',modelWidth:.65,spriteAspect:1000/1617,isFlyingSpecies:true,
      attackDamage:5,attackTag:'sharp',attackCooldownS:2.5,attacks:[],
      lootPool:'creature_skeeri-small',
      sprites:{idle:SPRITES.perched,run:[SPRITES.flying,SPRITES.flying]}}; // Separate from hostile skeeri-small/medium/large.
    const render = window.CreatureGeneticsRender?.SPECIES;
    if (render) render[KIND] = {...(render[KIND] || {}),prefix:'skeeri',
      base:{idle:SPRITES.perched,run1:SPRITES.flying,run2:SPRITES.flying},patterns:[],
      baseRecolorKeyHex:'#9dc09c',baseRecolorHueTolerance:24,
      baseRecolorMinSaturationRatio:.4,baseShadeReferenceHex:'#9dc09c'}; // Farm/Nursery tint the green coat, not eye markers.
    const items = injected.ITEM_DEFS;
    if (items) {
      items[FERTILE_EGG] = {...(items[FERTILE_EGG] || {}),label:'Fertile Skeeri Egg',
        icon:'🥚',cat:'livestock',sellPrice:42,tags:['Livestock','Egg','Fertile','Skeeri'],
        desc:'A hatchable egg from a hidden planebent Skeeri brood. Raise it on the farm or in your personal Stable.'};
      items[FARM_EGG] = {...(items[FARM_EGG] || {}),label:'Skeeri Egg',
        icon:'🥚',cat:'ingredient',sellPrice:8,tags:['Egg','Skeeri','Unfertilized'],
        desc:'An ordinary edible egg laid by a housed Skeeri. Cannot hatch.'};
    }
    if (Array.isArray(injected.inventoryItems)) for (const key of [FERTILE_EGG,FARM_EGG])
      if (!injected.inventoryItems.some(item => item?.key === key))
        injected.inventoryItems.push({key,icon:'🥚',
          label:key===FERTILE_EGG?'FERTILE SKEERI EGG':'SKEERI EGG',max:99});
    debug.registered = true;
    return configureLivestock();
  }

  function init(injected = {}) {
    deps = injected; // Same runtime lifecycle and inventory object as PingdortFlocks.
    return configureLivestock();
  }
  function nestKey(seed,roomId) {
    const world = String(window.__hobunjiPlayerProfile?.worldId || 'world');
    return 'skeeri:ruin-eggs:' + world + ':' + String(seed) + ':' + String(roomId);
  }
  function remainingEggs({seed,roomId,count} = {}) {
    const total = Math.max(0,Math.min(3,Math.floor(Number(count) || 0)));
    if (!roomId || !total) return 0;
    const key = nestKey(seed,roomId);
    let saved = memory.has(key) ? memory.get(key) : null;
    if (saved === null) {
      try {
        const raw = localStorage.getItem(key);
        if (raw?.startsWith('n:')) saved = Number(raw.slice(2));
      } catch (error) { debug.lastError = String(error); }
    }
    return saved === null || !Number.isFinite(saved)
      ? total : Math.max(0,Math.min(total,Math.floor(saved)));
  }
  function paletteForGenotype(genotype,identity = 'stable') {
    const theme = validTheme(genotype?.skeeriTradition) ? genotype.skeeriTradition : 'hronal';
    const palette = window.SkeeriRuins?.paletteFor?.(theme,identity) || {};
    return {...palette,
      body: validHex(genotype?.base?.color) ? genotype.base.color : (palette.body || '#854e48'),
      pattern: validHex(genotype?.secondary?.color) ? genotype.secondary.color : (validHex(genotype?.skeeriPattern) ? genotype.skeeriPattern : (palette.pattern || '#967d55')),
      eyes: validHex(genotype?.skeeriEyes) ? genotype.skeeriEyes : (palette.eyes || '#ff8027'),
    }; // Existing flying rig supports separately tinted fur, markings and glowing eyes.
  }
  function inheritAppearance(child,parentA,parentB) {
    if (!child || typeof child !== 'object') return child;
    const sources = [parentA,parentB].filter(parent=>parent && (
      validTheme(parent.skeeriTradition) || validHex(parent.skeeriPattern) || validHex(parent.skeeriEyes)));
    if (!sources.length) return child;
    const donor = sources[Math.floor(Math.random()*sources.length)]; // Inherits one parent's complete visual tradition, never a random unrelated clan.
    if (validTheme(donor.skeeriTradition)) child.skeeriTradition = donor.skeeriTradition;
    if (child.secondary?.color) child.skeeriPattern = child.secondary.color; // Compatibility mirror, not an independent inherited marking.
    if (validHex(donor.skeeriEyes)) child.skeeriEyes = donor.skeeriEyes;
    return child;
  }
  function collectNestEgg({seed,roomId,count,theme,identity} = {}) {
    const remaining = remainingEggs({seed,roomId,count});
    if (!remaining) return {ok:false,remaining:0,message:'No fertile Skeeri eggs remain in this nest.'};
    if (!deps?.inventory) return {ok:false,remaining,message:'Inventory unavailable.'};
    const bag = deps.inventory;
    const capacity = Math.max(1,Number(window.InventoryStacks?.MAX_TOTAL) || 99);
    if ((Number(bag[FERTILE_EGG]) || 0) >= capacity)
      return {ok:false,remaining,message:'No room for fertile Skeeri eggs.'};
    const genotype = window.CreatureGenetics?.makeDefaultGenotype?.(KIND);
    if (!genotype?.base) return {ok:false,remaining,message:'Skeeri genetics are not ready.'};
    const palette = window.SkeeriRuins?.paletteFor?.(theme,identity || nestKey(seed,roomId)) || {};
    if (validHex(palette.body)) genotype.base.color = palette.body;
    genotype.sizeClass = 'small'; // Found eggs hatch small; breeding can produce companion-sized variants.
    genotype.skeeriTradition = validTheme(theme) ? theme : 'hronal';
    if (validHex(palette.pattern)) { genotype.secondary = { color: palette.pattern, copies: 2, inheritance: 'dominant' }; genotype.skeeriPattern = palette.pattern; }
    if (validHex(palette.eyes)) genotype.skeeriEyes = palette.eyes;
    bag[FERTILE_EGG] = (Number(bag[FERTILE_EGG]) || 0) + 1;
    const next = remaining - 1;
    const key = nestKey(seed,roomId);
    memory.set(key,next);
    try { localStorage.setItem(key,'n:'+next); } catch (error) { debug.lastError = String(error); }
    window.FarmAnimals?.queueItemGenotype?.(FERTILE_EGG,genotype);
    deps.saveMemberWorldData?.();
    deps.refreshItemScroll?.();
    deps.buildInventoryGrid?.();
    deps.refreshActionBar?.();
    debug.eggsCollected++;
    if (!next) debug.clutchesExhausted++;
    debug.lastNest = {world:window.__hobunjiPlayerProfile?.worldId || null,seed,roomId,remaining:next};
    return {ok:true,remaining:next,message:'🥚 Took a fertile Skeeri egg.'};
  }

  configureLivestock(); // Must run before game.js snapshots itemKinds, just like PingdortRegistration.
  window.SkeeriLivestockRegistration = Object.freeze({
    KIND,FERTILE_EGG,FARM_EGG,SPRITES,configureLivestock,register,init,
    remainingEggs,collectNestEgg,paletteForGenotype,inheritAppearance,
    debugSnapshot:()=>({...debug,activeNests:memory.size}),
  });
})();

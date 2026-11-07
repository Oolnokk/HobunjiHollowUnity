// Northern Cliffs Moot registration. Shared by wild roaming groups and farm livestock;
// uses the existing creature/genetics/rendering pipelines, not a second animal system.
(() => {
  'use strict';
  if (window.MootRegistration) return;

  const KIND = 'moot'; // Shared ID used by wild spawns, livestock, and genetic rendering.
  const ZONE_ID = 'map_northern_cliffs'; // Only the Northern Cliffs get the natural Moot population.
  const BABY_ITEM_KEY = 'mootBaby'; // The Ranch starting baby and future livestock offspring use this existing save key.
  const SPRITE_ASPECT = 1000 / 1617; // Authored 1617x1000 PNG dimensions, used by the world-space animal card.
  const COAT_SOURCE_COLOR = '#9CBD9E'; // The existing mint-green coat art is the keyed shade-fill reference; protects teeth, hooves, and heavy black linework.
  const SPRITES = Object.freeze({
    idle: 'assets/creaturesprites/moot_idle.png',
    run1: 'assets/creaturesprites/moot_run1.png',
    run2: 'assets/creaturesprites/moot_run2.png',
    eyes: 'assets/creaturesprites/moot_eyes.png',
    blink: 'assets/creaturesprites/moot_blink.png',
  }); // Existing authored art; eye overlay is composed after base-coat tinting.

  function configureLivestock() {
    const game = window.SCRATCHBONES_CONFIG?.game; // Existing game config, read by FarmAnimals and the main game bootstrap.
    if (!game) return false;
    const livestock = game.livestock || (game.livestock = {}); // Existing barn/stable settings.
    const itemKinds = livestock.itemKinds || (livestock.itemKinds = {}); // Converts the Ranch's mootBaby inventory item to a living animal.
    itemKinds[BABY_ITEM_KEY] = KIND;
    const widths = livestock.animalWidths || (livestock.animalWidths = {}); // Full-grown plane width for farm and nursery previews.
    widths[KIND] = Number(widths[KIND]) > 0 ? Number(widths[KIND]) : 1.7;
    const diet = livestock.diet || (livestock.diet = {}); // Reuses the existing plant-fodder barn feeding behavior.
    diet[KIND] = 'prey';
    const mothers = game.wildlife?.denMothers; // Moots are surface animals, not den species.
    if (mothers) delete mothers[KIND];
    return true;
  }

  function ensureCreatureDefs(creatureDb) {
    if (!creatureDb) return false;
    const baseline = creatureDb['uumkaoii-wild'] || creatureDb.uumkaoii || creatureDb.drenkirra || {}; // Existing non-hostile herbivore behavior.
    const existing = creatureDb[KIND] || {}; // Keep any future authored tuning instead of overwriting it.
    creatureDb[KIND] = {
      ...baseline,
      ...existing,
      label: 'Moot',
      hostile: false,
      defaultSizeClass: existing.defaultSizeClass || 'large',
      modelWidth: Number(existing.modelWidth) > 0 ? Number(existing.modelWidth) : 1.7,
      spriteAspect: SPRITE_ASPECT,
      lootPool: 'creature_moot',
      sprites: { idle: SPRITES.idle, run: [SPRITES.run1, SPRITES.run2] },
    };
    return true;
  }

  function ensureRendererSpecies(species = window.CreatureGeneticsRender?.SPECIES) {
    if (!species) return false;
    species[KIND] = {
      ...(species[KIND] || {}),
      prefix: KIND,
      baseShadeReferenceHex: COAT_SOURCE_COLOR, // Normalize all coat shading against the authored mint color.
      baseRecolorKeyHex: COAT_SOURCE_COLOR, // Restrict tinting to the green coat family, preserving neutral teeth/hooves and outlines.
      baseRecolorHueTolerance: 20,
      baseRecolorMinSaturationRatio: 0.45,
      fullBaseRecolor: false, // A full-sprite fill would recolor the Moot's teeth, claws, hooves and black outlines.
      base: { idle: SPRITES.idle, run1: SPRITES.run1, run2: SPRITES.run2 },
      patterns: [], // No unauthored coat overlays or imaginary pattern sprites.
      eyes: { open: SPRITES.eyes, blink: SPRITES.blink },
    };
    return true;
  }

  function ensureNorthernCliffsPopulation(injectedDeps) {
    const zone = injectedDeps?.EXTERIOR_ZONES?.[ZONE_ID]; // Live zone record shared by WildlifeSpawn's roaming groups.
    if (!zone) return { ready: false, foragers: [], zone: null };
    const foragers = Array.isArray(zone.roamingForagerSpecies) ? zone.roamingForagerSpecies : (zone.roamingForagerSpecies = []); // Existing small surface-group slots.
    if (!foragers.includes(KIND)) foragers.push(KIND);
    zone.roamingForagerCount = Math.max(foragers.length, Math.floor(Number(zone.roamingForagerCount) || 0)); // One stable slot per named species; don't displace Nazgraku.
    for (const key of ['herbivoreSpecies', 'denSpecies']) {
      const species = zone[key]; // Avoid accidentally assigning Moots to the zone's cave and den populations.
      if (Array.isArray(species)) for (let i = species.length - 1; i >= 0; i--) if (species[i] === KIND) species.splice(i, 1);
    }
    if (injectedDeps?.DEN_MOTHER_DEFS) delete injectedDeps.DEN_MOTHER_DEFS[KIND];
    return { ready: foragers.includes(KIND) && zone.roamingForagerCount >= foragers.length, foragers, zone };
  }

  function registerBabyItem(itemDefs) {
    if (!itemDefs) return false;
    const old = itemDefs[BABY_ITEM_KEY] || {}; // Preserve saved-item customizations while replacing its old placeholder classification.
    itemDefs[BABY_ITEM_KEY] = {
      ...old,
      label: 'Baby Moot',
      icon: old.icon || '🐾',
      cat: 'livestock',
      tags: [...new Set([...(Array.isArray(old.tags) ? old.tags : []), 'Livestock', 'Baby'])],
      desc: 'A young Moot. Add it to a farm or stable and assign it to a barn to raise it.',
      sellPrice: Math.max(60, Number(old.sellPrice) || 0),
    };
    return true;
  }

  function registerLootItems(injectedDeps) {
    const itemDefs = injectedDeps?.ITEM_DEFS; // Core inventory item registry used by corpse loot and Pack.
    const inventoryItems = injectedDeps?.inventoryItems; // Existing item-wheel catalog; updated without duplicate entries.
    if (!itemDefs) return false;
    const items = {
      mootMeat: { label: 'Moot Meat', icon: '🥩', cat: 'ingredient', sellPrice: 18, tags: ['Meat', 'Moot'], desc: 'Meat from a Moot of the Northern Cliffs.' },
      mootHide: { label: 'Moot Hide', icon: '🟫', cat: 'material', sellPrice: 24, tags: ['Material', 'Hide', 'Moot'], desc: 'A Moot hide retaining the animal\'s inherited coat color.' },
    }; // Actual corpse-drop keys from loot-pools.json; hide metadata follows the shared AnimalHides pipeline.
    for (const [key, spec] of Object.entries(items)) {
      itemDefs[key] = { ...spec, ...(itemDefs[key] || {}) };
      if (Array.isArray(inventoryItems) && !inventoryItems.some(item => item?.key === key))
        inventoryItems.push({ key, icon: itemDefs[key].icon, label: itemDefs[key].label.toUpperCase(), max: 99 });
    }
    return true;
  }

  function register(injectedDeps) {
    const livestockReady = configureLivestock(); // Keep the item-kind mapping present when farms are initialized.
    const creatureReady = ensureCreatureDefs(injectedDeps?.CREATURE_DB);
    const rendererReady = ensureRendererSpecies();
    const population = ensureNorthernCliffsPopulation(injectedDeps);
    const babyReady = registerBabyItem(injectedDeps?.ITEM_DEFS);
    const lootReady = registerLootItems(injectedDeps);
    const ready = livestockReady && creatureReady && rendererReady && population.ready && babyReady && lootReady;
    window.__farmLog?.(`[moot] northernCliffs=${population.ready ? 'ok' : 'missing'} foragers=[${population.foragers.join(',')}] slots=${population.zone?.roamingForagerCount || 0} creature=${creatureReady ? 'ok' : 'missing'} renderer=${rendererReady ? 'ok' : 'missing'} baby=${babyReady ? 'ok' : 'missing'} loot=${lootReady ? 'ok' : 'missing'}`, ready ? 'wildlife' : 'warn');
    return ready;
  }

  configureLivestock(); // Early config registration survives the main game's initial snapshot of LIVESTOCK_ITEM_KINDS.
  window.MootRegistration = Object.freeze({
    KIND, ZONE_ID, BABY_ITEM_KEY, SPRITES,
    configureLivestock, ensureCreatureDefs, ensureRendererSpecies,
    ensureNorthernCliffsPopulation, registerBabyItem, registerLootItems, register,
  });
})();

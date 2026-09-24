// Single source of truth for registering the Voorg-Ass as Northern Cliffs
// roaming-herd wildlife against game.js's live registries. Previously the same
// creature-def / renderer-species / zone-config mutations were written out
// three times (creature-genetics.js's WildlifeSpawn.init wrapper,
// wildlife-spawn.js's init fallback, and puktuk-den-nest-registration.js's
// WildlifeSpawn.init wrapper) because each one guards a different load-order
// race. Those callers still run at their own points in the boot sequence, but
// all of them now call these idempotent helpers, so the data can't drift.
//
// Loaded from index.html before creature-genetics.js, so every caller can rely
// on window.VoorgAssRegistration existing.
(() => {
  'use strict';
  if (window.VoorgAssRegistration) return;

  const KIND = 'voorg-ass'; // Species key shared by wild herds, livestock, and the genotype renderer.
  const HERD_MOTHER_KIND = 'voorg-ass-herd-mother'; // Exterior-only mother variant: same genotype/art, distinct label and corpse loot.
  const ZONE_ID = 'map_northern_cliffs'; // Exterior zone whose open-air herd ecology owns Voorg-Asses.
  const BABY_ITEM_KEY = 'voorgAssBaby'; // Livestock item recovered from a killed Herd-Mother.
  const LEGACY_DEN_HERBIVORES = new Set(['uumkaoii', 'uumkaoii-wild', KIND]); // Stripped from the cavern herbivore pool: Voorg-Asses replaced the old Uumkao'ii den herds and never live in dens.
  const SPRITES = Object.freeze({
    idle: 'assets/creaturesprites/voorg-ass_idle.png',
    run1: 'assets/creaturesprites/voorg-ass_run1.png',
    run2: 'assets/creaturesprites/voorg-ass_run2.png',
  });

  // Adult + Herd-Mother entries in the live CREATURE_DB. Prey behavior is
  // borrowed from the Uumkao'ii it replaced; existing authored overrides win
  // except for the identity/art fields the species requires.
  function ensureCreatureDefs(creatureDb) {
    if (!creatureDb) return false;
    const preyBaseline = creatureDb['uumkaoii-wild'] || creatureDb.uumkaoii || creatureDb.drenkirra || {};
    const existing = creatureDb[KIND] || {};
    creatureDb[KIND] = {
      ...preyBaseline,
      ...existing,
      label: 'Voorg-Ass',
      hostile: false,
      defaultSizeClass: 'large',
      modelWidth: Number(existing.modelWidth) || Number(preyBaseline.modelWidth) || 1.5,
      spriteAspect: Number(existing.spriteAspect) || Number(preyBaseline.spriteAspect) || (600 / 1375),
      lootPool: 'creature_voorg-ass',
      sprites: { idle: SPRITES.idle, run: [SPRITES.run1, SPRITES.run2] },
    };
    const baseVoorg = creatureDb[KIND]; // Mother tracks adult stat/render changes automatically.
    const existingMother = creatureDb[HERD_MOTHER_KIND] || {};
    creatureDb[HERD_MOTHER_KIND] = {
      ...baseVoorg,
      ...existingMother,
      label: 'Herd-Mother',
      hostile: false,
      defaultSizeClass: 'large',
      lootPool: 'creature_voorg-ass',
      sprites: baseVoorg.sprites,
    };
    return true;
  }

  // Genotype compositor entry: uploaded base frames plus the mandatory belly
  // layer, with no optional patterns.
  function ensureRendererSpecies(species = window.CreatureGeneticsRender?.SPECIES) {
    if (!species) return false;
    species[KIND] = {
      prefix: KIND,
      baseShadeReferenceHex: '#99BF99', // Authored full-strength Voorg-Ass coat color used as the fixed base-recolor normalization anchor.
      fullBaseRecolor: true, // Voorg-Ass base art is one recolorable body layer; no creature-base mask exists, so recolor the full opaque sprite before the belly overlay.
      base: { idle: SPRITES.idle, run1: SPRITES.run1, run2: SPRITES.run2 },
      patterns: ['belly'],
    };
    return true;
  }

  // Northern Cliffs population config: Voorg-Asses are exterior roaming-herd
  // wildlife only — out of the cavern herbivore pool, the explicit den roster,
  // and the Den-Mother registry — with at least two independent herds.
  function ensureNorthernCliffsHerds(injectedDeps) {
    const zone = injectedDeps?.EXTERIOR_ZONES?.[ZONE_ID];
    const denMotherDefs = injectedDeps?.DEN_MOTHER_DEFS;
    if (denMotherDefs) delete denMotherDefs[KIND];
    if (!zone) return { ready: false, zone: null, removedLegacyDenHerbivores: 0, roaming: [], herbivores: [], denSpecies: null };

    const herbivores = Array.isArray(zone.herbivoreSpecies) ? zone.herbivoreSpecies : (zone.herbivoreSpecies = []);
    let removedLegacyDenHerbivores = 0;
    for (let i = herbivores.length - 1; i >= 0; i--) {
      if (!LEGACY_DEN_HERBIVORES.has(herbivores[i])) continue;
      herbivores.splice(i, 1);
      removedLegacyDenHerbivores++;
    }
    const roaming = Array.isArray(zone.roamingHerdSpecies) ? zone.roamingHerdSpecies : (zone.roamingHerdSpecies = []);
    if (!roaming.includes(KIND)) roaming.push(KIND);
    zone.roamingHerdCount = Math.max(2, Math.floor(Number(zone.roamingHerdCount) || 2));
    const denSpecies = Array.isArray(zone.denSpecies) ? zone.denSpecies : null;
    if (denSpecies) {
      for (let i = denSpecies.length - 1; i >= 0; i--) if (denSpecies[i] === KIND) denSpecies.splice(i, 1);
    }
    const ready = roaming.includes(KIND)
      && !herbivores.some(kind => LEGACY_DEN_HERBIVORES.has(kind))
      && !(denSpecies?.includes(KIND))
      && !denMotherDefs?.[KIND]
      && zone.roamingHerdCount >= 2;
    return { ready, zone, removedLegacyDenHerbivores, roaming, herbivores, denSpecies };
  }

  window.VoorgAssRegistration = Object.freeze({
    KIND,
    HERD_MOTHER_KIND,
    ZONE_ID,
    BABY_ITEM_KEY,
    SPRITES,
    ensureCreatureDefs,
    ensureRendererSpecies,
    ensureNorthernCliffsHerds,
  });
})();

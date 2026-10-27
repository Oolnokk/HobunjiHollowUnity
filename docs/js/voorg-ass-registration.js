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
  const BASE_RECOLOR_KEY_HEX = '#99BF99'; // Authored Voorg-Ass coat source color used to select only the coat shade family for genotype recoloring.
  const BASE_RECOLOR_HUE_TOLERANCE = 20; // Limits the #99BF99 keyed pass to nearby authored coat hues instead of unrelated sprite regions.
  const BASE_RECOLOR_MIN_SATURATION_RATIO = 0.45; // Rejects gray/near-white pixels that can share a hue numerically but are not part of the coat key family.
  const LEGACY_DEN_HERBIVORES = new Set(['uumkaoii', 'uumkaoii-wild', KIND]); // Stripped from the cavern herbivore pool: Voorg-Asses replaced the old Uumkao'ii den herds and never live in dens.
  const SPRITES = Object.freeze({
    idle: 'assets/creaturesprites/voorg-ass_idle.png',
    run1: 'assets/creaturesprites/voorg-ass_run1.png',
    run2: 'assets/creaturesprites/voorg-ass_run2.png',
  });

  const LEGACY_VISUAL_GENOTYPE = Object.freeze({
    base: Object.freeze({ color: BASE_RECOLOR_KEY_HEX, copies: 2, inheritance: 'dominant' }),
    belly: Object.freeze({ color: BASE_RECOLOR_KEY_HEX, copies: 2, inheritance: 'dominant', enabled: true }),
  }); // Stable source-coat colors for older/preview animals with no saved genes; never a randomly rerolled genome.
  function displayGenotypeFor(kind, genotype) {
    if (kind !== KIND && kind !== HERD_MOTHER_KIND) return genotype; // No migration for unrelated animals.
    if (genotype?.base?.color) return genotype; // Preserve genuine inherited coloring unchanged.
    return {
      ...(genotype || {}),
      base: { ...LEGACY_VISUAL_GENOTYPE.base },
      belly: genotype?.belly || { ...LEGACY_VISUAL_GENOTYPE.belly },
    }; // Renderer-only fallback: the beard remains coat-colored without creating a beard1 allele.
  }

  // Adult + Herd-Mother entries in the live CREATURE_DB. Prey behavior is
  // borrowed from the Uumkao'ii it replaced; existing authored overrides win
  // except for the identity/art fields the species requires.
  function ensureCreatureDefs(creatureDb, tilePx) {
    if (!creatureDb) return false;
    const tile = Number(tilePx) > 0 ? Number(tilePx) : 55; // game.js TILE; the prey baseline defines no attack reach of its own.
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
      attackDamage: 1, attackTag: 'blunt', // Rear kick prioritizes knockback/Footing rather than Health.
      attackRangePx: Number(existing.attackRangePx) || tile * 1.1, // Companion AI gates chase and attack on this; without it (Uumkao'ii-wild has none) the companion never closes in or kicks.
      attackHalfConeRad: Number(existing.attackHalfConeRad) || Math.PI / 3, // Matches the kick's own cone.
      attackStaminaCost: 10, attackCooldownS: 1.3, // Existing ordinary animal-attack resource/cadence gates.
      attacks: ['rearKick'], realAttackEvery: 1, // Wild retaliation uses only this kick; companions fall back to Guard Charge during cooldown.
      rearKickCooldownS: 9, // Used by the companion-only signature-attack timer in the animal attack module.
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
      attacks: baseVoorg.attacks, attackTag: baseVoorg.attackTag, // Herd-Mother inherits the same defensive attack.
      rearKickCooldownS: baseVoorg.rearKickCooldownS,
      sprites: baseVoorg.sprites,
    };
    return true;
  }

  // Genotype compositor entry: uploaded base frames plus the mandatory belly
  // layer; beard1 is an unconditional coat-colored visual fallback, not a genotype trait. Voorg-Ass deliberately does NOT opt into
  // the full-sprite fallback: CreatureGeneticsRender's cached base recolor
  // tints only the #99BF99 coat family (baseRecolorKeyHex), before the belly
  // and eyes are layered on.
  function ensureRendererSpecies(species = window.CreatureGeneticsRender?.SPECIES) {
    if (!species) return false;
    species[KIND] = {
      prefix: KIND,
      baseShadeReferenceHex: BASE_RECOLOR_KEY_HEX, // The same #99BF99 key is the fixed full-strength normalization anchor for canonical shade-fill math.
      baseRecolorKeyHex: BASE_RECOLOR_KEY_HEX, // Authored source key selecting the coat pixels the base allele recolors.
      baseRecolorHueTolerance: BASE_RECOLOR_HUE_TOLERANCE,
      baseRecolorMinSaturationRatio: BASE_RECOLOR_MIN_SATURATION_RATIO,
      fullBaseRecolor: false, // Non-coat opaque pixels must remain authored.
      base: { idle: SPRITES.idle, run1: SPRITES.run1, run2: SPRITES.run2 },
      patterns: ['belly'], // Only inheritable color regions go here; the default beard is not a genotype allele.
      defaultCoatPatterns: [{ id: 'beard1', family: 'beard' }], // Always draw coat-colored beard1 unless a visible, registered inherited beard variant replaces it.
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
    displayGenotypeFor,
    ensureCreatureDefs,
    ensureRendererSpecies,
    ensureNorthernCliffsHerds,
  });
})();

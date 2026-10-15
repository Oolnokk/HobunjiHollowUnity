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

  function makeBaseHexPredicate(pixels, renderer, keyHex) {
    const keyRgb = renderer.hexToRgb(keyHex); // Exact authored source color anchors hue/saturation matching for every shaded coat pixel.
    const colorFill = window.ColorFill; // Shared color math is preferred so key classification follows the same HSV conventions as other keyed sprite recolors.
    if (typeof colorFill?.rgbToHsv !== 'function' || typeof colorFill?.hueDistance !== 'function') {
      return index => pixels[index] === keyRgb[0] && pixels[index + 1] === keyRgb[1] && pixels[index + 2] === keyRgb[2] && pixels[index + 3] > 0;
    }
    const keyHsv = colorFill.rgbToHsv(...keyRgb); // Coat-key hue and saturation are reused for every pixel predicate call.
    const minimumSaturation = Math.max(0.04, keyHsv.s * BASE_RECOLOR_MIN_SATURATION_RATIO); // Prevents low-chroma highlights/background details from entering the keyed coat region.
    return index => {
      if (!pixels[index + 3]) return false;
      const sourceHsv = colorFill.rgbToHsv(pixels[index], pixels[index + 1], pixels[index + 2]); // Current source pixel decides whether the canonical shade-fill is allowed to touch it.
      return sourceHsv.s >= minimumSaturation && colorFill.hueDistance(sourceHsv.h, keyHsv.h) <= BASE_RECOLOR_HUE_TOLERANCE;
    };
  }

  // Voorg-Ass used to opt into CreatureGeneticsRender's full-sprite fallback,
  // which recolored every opaque base pixel. Wrap the canonical compositor only
  // for this species: let it draw the untouched base + authored belly first,
  // then run its own Grehlr-style shade-fill math through a #99BF99 source-key
  // predicate. All other species and all pattern/eye composition stay on the
  // original renderer path unchanged.
  function installHexTargetedBaseRecolor(renderer = window.CreatureGeneticsRender) {
    if (!renderer?.composeFrame || !renderer?.recolorPixels || !renderer?.hexToRgb) return false;
    if (renderer.composeFrame.__voorgAssHexTargeted === true) return true;
    const originalComposeFrame = renderer.composeFrame; // Canonical compositor retained for every species and for Voorg-Ass's ordinary layer assembly.
    async function composeFrameWithVoorgHexTarget(kind, frame, genotype, blinkShut = false) {
      const requestedBaseColor = kind === KIND ? genotype?.base?.color : null; // Only a real Voorg-Ass base allele activates the keyed post-pass.
      if (!requestedBaseColor) return originalComposeFrame.call(renderer, kind, frame, genotype, blinkShut);
      const neutralBaseGenotype = { ...genotype, base: { ...(genotype.base || {}), color: null } }; // Prevents the old full-sprite fallback while preserving belly/paint/genetic metadata for canonical composition.
      const composed = await originalComposeFrame.call(renderer, kind, frame, neutralBaseGenotype, blinkShut); // Base + belly + eyes are assembled once by the shared renderer before the keyed coat pass.
      const ctx = composed?.getContext?.('2d', { willReadFrequently: true }); // Final native-resolution canvas is recolored in place so callers/cache behavior remain unchanged.
      if (!ctx || !composed.width || !composed.height) return composed;
      const imageData = ctx.getImageData(0, 0, composed.width, composed.height); // Mutable final-frame pixels consumed by the shared shade-fill utility.
      const coatPredicate = makeBaseHexPredicate(imageData.data, renderer, BASE_RECOLOR_KEY_HEX); // Restricts the shared shade-fill to the authored #99BF99 coat family.
      let matchedPixels = 0; // Mobile debug output reports whether the source-key actually found coat pixels in the current frame.
      const countedPredicate = index => {
        const matched = coatPredicate(index); // Same predicate is supplied to both shade sampling and application by CreatureGeneticsRender.recolorPixels.
        if (matched) matchedPixels++;
        return matched;
      };
      renderer.recolorPixels(
        imageData.data,
        renderer.hexToRgb(requestedBaseColor),
        countedPredicate,
        BASE_RECOLOR_KEY_HEX,
        `animal-base:${KIND}:hex-target`,
      );
      ctx.putImageData(imageData, 0, 0);
      window.__farmLog?.(`[voorg-ass] hex-target coat key=${BASE_RECOLOR_KEY_HEX} matched=${matchedPixels} target=${requestedBaseColor} frame=${frame}`, matchedPixels ? 'wildlife' : 'warn');
      return composed;
    }
    composeFrameWithVoorgHexTarget.__voorgAssHexTargeted = true; // Idempotence marker prevents repeated registration callers from stacking compositor wrappers.
    composeFrameWithVoorgHexTarget.__voorgAssOriginalComposeFrame = originalComposeFrame; // Debug hook identifies the canonical renderer preserved underneath the Voorg-only pass.
    renderer.composeFrame = composeFrameWithVoorgHexTarget;
    return true;
  }

  // Genotype compositor entry: uploaded base frames plus the mandatory belly
  // layer, with no optional patterns. Voorg-Ass deliberately does NOT opt into
  // the full-sprite fallback; its base allele is applied by the keyed wrapper.
  function ensureRendererSpecies(species = window.CreatureGeneticsRender?.SPECIES) {
    if (!species) return false;
    species[KIND] = {
      prefix: KIND,
      baseShadeReferenceHex: BASE_RECOLOR_KEY_HEX, // The same #99BF99 key is the fixed full-strength normalization anchor for canonical shade-fill math.
      baseRecolorKeyHex: BASE_RECOLOR_KEY_HEX, // Renderer/debug metadata records the authored source key that owns Voorg-Ass coat recoloring.
      fullBaseRecolor: false, // Non-coat opaque pixels must remain authored; installHexTargetedBaseRecolor handles the coat region instead.
      base: { idle: SPRITES.idle, run1: SPRITES.run1, run2: SPRITES.run2 },
      patterns: ['belly'],
    };
    if (species === window.CreatureGeneticsRender?.SPECIES) installHexTargetedBaseRecolor(window.CreatureGeneticsRender);
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
    installHexTargetedBaseRecolor,
  });
})();

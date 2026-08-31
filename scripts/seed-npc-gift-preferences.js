#!/usr/bin/env node
// Seeds every NPC's previously-empty `gifts` scaffold (loved/liked/disliked/
// hated arrays already reserved in the schema — see hobunji-starter-npc-
// database.json, verified empty for all 39 NPCs before this ran) with item
// TRAIT ids (not item keys — see js/item-traits.js/js/npc-gifting.js) using
// a repeatable, explainable rule rather than hand-authored flavor picks,
// since this is meant to be a tunable starting point (edit the JSON, or the
// npcDatabase local-db-override, directly to refine):
//   - loved:    one trait tied to the NPC's role/trade (a blacksmith loves
//               ore, a farmer loves crops, ...).
//   - liked:    the hue/saturation/value traits of the NPC's own primary
//               worn dye (people tend to like colors similar to what they
//               already wear).
//   - disliked: the hue trait(s) opposite their own on the color wheel.
//   - hated:    the opposite saturation vibe from what they wear (someone
//               who dresses in muted colors hates garish "hot" gifts, and
//               vice versa).
// Re-running this script is idempotent (it only ever overwrites the exact
// empty scaffold produced by the schema, matched by literal text, so it's
// safe against the original repo state but intentionally refuses to
// clobber hand-edited gifts blocks on a second run).
'use strict';
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'docs', 'config', 'npcs', 'hobunji-starter-npc-database.json');

// ── Same dye catalog math as config/scratchbones-config.js's hueFamilies/
// variants tables (see docs/js/item-traits.js's catalogHsv for the runtime
// equivalent) — duplicated here in plain data form since this is a one-shot
// Node script with no browser/game.js to load DyeSystem from.
const HUE_FAMILIES = ['red', 'red_orange', 'orange', 'yellow_orange', 'yellow', 'yellow_green',
  'green', 'green_blue', 'blue', 'blue_indigo', 'indigo', 'indigo_violet', 'violet'];
const VARIANTS = { // id -> [saturationPercent, brightnessPercent]
  pure: [100, 100], bright: [60, 100], pale: [30, 100],
  deep: [100, 55], muted: [60, 55], dusty: [30, 55],
  shadow: [100, 35], dark_muted: [60, 35], smoky: [30, 35],
};
const VARIANT_IDS = Object.keys(VARIANTS).sort((a, b) => b.length - a.length); // longest first so "dark_muted" wins over "muted".

const HUE_TRAITS = { // familyId -> the one or two pure-hue traits it carries (mirrors item-traits.js's HUE_BANDS blend rule).
  red: ['hueRed'], red_orange: ['hueRed', 'hueOrange'], orange: ['hueOrange'],
  yellow_orange: ['hueOrange', 'hueYellow'], yellow: ['hueYellow'], yellow_green: ['hueYellow', 'hueGreen'],
  green: ['hueGreen'], green_blue: ['hueGreen', 'hueBlue'], blue: ['hueBlue'],
  blue_indigo: ['hueBlue', 'hueIndigo'], indigo: ['hueIndigo'], indigo_violet: ['hueIndigo', 'hueViolet'],
  violet: ['hueViolet'],
};
const OPPOSITE_HUE = { // Roughly across the wheel; used only for "disliked".
  hueRed: ['hueGreen', 'hueBlue'], hueOrange: ['hueBlue', 'hueIndigo'], hueYellow: ['hueIndigo', 'hueViolet'],
  hueGreen: ['hueRed', 'hueViolet'], hueBlue: ['hueRed', 'hueOrange'], hueIndigo: ['hueOrange', 'hueYellow'],
  hueViolet: ['hueYellow', 'hueGreen'],
};

function parseDyeId(dyeRef) {
  if (typeof dyeRef !== 'string') return null;
  const raw = dyeRef.includes(':') ? dyeRef.split(':').pop() : dyeRef;
  const variantId = VARIANT_IDS.find(v => raw.startsWith(v + '_'));
  if (!variantId) return null;
  const familyId = raw.slice(variantId.length + 1);
  if (!HUE_FAMILIES.includes(familyId)) return null;
  return { variantId, familyId };
}

function traitsForDye(dyeRef) {
  const parsed = parseDyeId(dyeRef);
  if (!parsed) return null;
  const [sPercent, vPercent] = VARIANTS[parsed.variantId];
  return {
    hue: HUE_TRAITS[parsed.familyId],
    saturation: sPercent >= 50 ? 'hot' : 'muted',
    value: vPercent >= 50 ? 'bright' : 'dark',
  };
}

// ── Role/trade -> a signature "loved" trait, matched by keyword against the
// NPC database's free-text `role` field. Order matters (first match wins).
const ROLE_LOVE_RULES = [
  [/smith|bonehewer|hakaru/i, 'mineral'],
  [/carpenter|woodcutter/i, 'wood'],
  [/farm/i, 'crop'],
  [/hunter/i, 'animalProduct'],
  [/potion|alchemy|researcher|snow-watcher/i, 'reagent'],
  [/inn|waitress|festival|bard|shopkeep/i, 'food'],
  [/priest|eldress|hag/i, 'medicine'],
  [/watch|war leader|chief|leader|antagonist|bowyer/i, 'valuable'],
  [/child/i, 'sweet'],
  [/fish/i, 'fish'],
];
function loveTraitForRole(role) {
  for (const [re, trait] of ROLE_LOVE_RULES) if (re.test(role || '')) return trait;
  return 'food'; // Generic, always-sensible fallback for roles nothing above matches.
}

function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db = JSON.parse(raw);
  const EMPTY_BLOCK = `"gifts": {
                        "loved": [],
                        "liked": [],
                        "neutral": [],
                        "disliked": [],
                        "hated": [],
                        "categoryNotes": []
                  },`;

  let text = raw;
  let seeded = 0, skipped = 0;
  for (const npc of db.npcs || []) {
    const dyeRef = Object.values(npc.appliedDyes || {}).find(Boolean);
    const dyeTraits = traitsForDye(dyeRef);
    const loved = [loveTraitForRole(npc.role)];
    const liked = dyeTraits ? [...dyeTraits.hue, dyeTraits.saturation, dyeTraits.value] : [];
    const disliked = dyeTraits ? [...new Set(dyeTraits.hue.flatMap(h => OPPOSITE_HUE[h] || []))] : [];
    const hated = dyeTraits ? [dyeTraits.saturation === 'hot' ? 'muted' : 'hot'] : [];

    const replacement = `"gifts": {
                        "loved": ${JSON.stringify(loved)},
                        "liked": ${JSON.stringify(liked)},
                        "neutral": [],
                        "disliked": ${JSON.stringify(disliked)},
                        "hated": ${JSON.stringify(hated)},
                        "categoryNotes": []
                  },`;

    if (text.includes(EMPTY_BLOCK)) {
      text = text.replace(EMPTY_BLOCK, replacement);
      seeded++;
    } else {
      skipped++; // Already seeded/hand-edited on a previous run — left untouched.
    }
  }
  fs.writeFileSync(DB_PATH, text);
  console.log(`[seed-npc-gift-preferences] Seeded ${seeded} NPC(s); ${skipped} already had non-empty gifts and were left alone.`);
}

main();

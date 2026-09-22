#!/usr/bin/env node
// Seeds NPC gift preferences from their authored role and ACTUALLY WORN outfit
// colors. Color preferences deliberately ignore orphaned appliedDyes slots:
// only tint slots belonging to equipped garment categories participate.
//
// Rules:
//   - loved:    one trait tied to the NPC's role/trade.
//   - liked:    every hue/saturation/value trait visibly used by the equipped
//               outfit.
//   - disliked: opposite hue traits, excluding any hue the NPC also wears.
//   - hated:    the opposite saturation vibe only when the entire worn outfit
//               is consistently hot OR muted. Mixed hot+muted outfits hate
//               neither saturation category.
//
// The script may fill an empty gifts scaffold OR refresh a block that exactly
// matches the old primary-dye-only generator. Anything hand-edited is skipped.
'use strict';
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'docs', 'config', 'npcs', 'hobunji-starter-npc-database.json');

// Same dye math as runtime ItemTraits. Note that "muted_*" dye NAMES are 60%
// saturation and therefore runtime trait "hot"; pale/dusty/smoky are 30% and
// therefore runtime trait "muted". Trait semantics follow saturation, not name.
const HUE_FAMILIES = ['red', 'red_orange', 'orange', 'yellow_orange', 'yellow', 'yellow_green',
  'green', 'green_blue', 'blue', 'blue_indigo', 'indigo', 'indigo_violet', 'violet'];
const VARIANTS = {
  pure: [100, 100], bright: [60, 100], pale: [30, 100],
  deep: [100, 55], muted: [60, 55], dusty: [30, 55],
  shadow: [100, 35], dark_muted: [60, 35], smoky: [30, 35],
};
const VARIANT_IDS = Object.keys(VARIANTS).sort((a, b) => b.length - a.length);

const HUE_TRAITS = {
  red: ['hueRed'], red_orange: ['hueRed', 'hueOrange'], orange: ['hueOrange'],
  yellow_orange: ['hueOrange', 'hueYellow'], yellow: ['hueYellow'], yellow_green: ['hueYellow', 'hueGreen'],
  green: ['hueGreen'], green_blue: ['hueGreen', 'hueBlue'], blue: ['hueBlue'],
  blue_indigo: ['hueBlue', 'hueIndigo'], indigo: ['hueIndigo'], indigo_violet: ['hueIndigo', 'hueViolet'],
  violet: ['hueViolet'],
};
const OPPOSITE_HUE = {
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

// Mirrors the categories used by the current NPC wardrobe/shop cosmetics.
// Pattern fallbacks keep new ordinary hats/hoods/tunics/ponchos useful without
// needing this one-shot data script to boot browser portrait configuration.
function cosmeticCategory(cosmeticId) {
  const id = String(cosmeticId || '').toLowerCase();
  if (id.includes('::hat::') || /headband|kasa/.test(id)) return 'hat';
  if (id === 'facewrap' || /hood/.test(id)) return 'hood';
  if (/tunic|bandolier/.test(id)) return 'torso';
  if (/poncho|bodywrap|cloak/.test(id)) return 'overwear';
  return null;
}

const TINT_SLOT_BY_CATEGORY = { hat: 'HAT', hood: 'HOOD', torso: 'TORSO', overwear: 'CLOTH' };

function wornDyeRefsForNpc(npc) {
  const out = [];
  const seen = new Set();
  const dyes = npc?.appliedDyes || {};
  for (const cosmeticId of (npc?.equippedCosmetics || [])) {
    const tintSlot = TINT_SLOT_BY_CATEGORY[cosmeticCategory(cosmeticId)];
    if (!tintSlot) continue;
    for (const slot of [tintSlot, tintSlot + '_B']) {
      const dyeRef = dyes[slot];
      if (!dyeRef || seen.has(dyeRef)) continue;
      seen.add(dyeRef);
      out.push(dyeRef);
    }
  }
  return out;
}

function wornColorTraitsForNpc(npc) {
  const hues = [];
  const saturations = [];
  const values = [];
  const seenHue = new Set(), seenSat = new Set(), seenValue = new Set();
  for (const dyeRef of wornDyeRefsForNpc(npc)) {
    const traits = traitsForDye(dyeRef);
    if (!traits) continue;
    for (const hue of traits.hue) if (!seenHue.has(hue)) { seenHue.add(hue); hues.push(hue); }
    if (!seenSat.has(traits.saturation)) { seenSat.add(traits.saturation); saturations.push(traits.saturation); }
    if (!seenValue.has(traits.value)) { seenValue.add(traits.value); values.push(traits.value); }
  }
  return { hues, saturations, values };
}

// Role/trade -> signature loved trait.
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
  return 'food';
}

function deriveGiftPreferences(npc) {
  const color = wornColorTraitsForNpc(npc);
  const wornHues = new Set(color.hues);
  const disliked = [...new Set(color.hues.flatMap(h => OPPOSITE_HUE[h] || []).filter(h => !wornHues.has(h)))];
  const hated = color.saturations.length === 1
    ? [color.saturations[0] === 'hot' ? 'muted' : 'hot']
    : [];
  return {
    loved: [loveTraitForRole(npc?.role)],
    liked: [...color.hues, ...color.saturations, ...color.values],
    neutral: [],
    disliked,
    hated,
    categoryNotes: [],
  };
}

// Exact old generator, retained only so rerunning this script can safely
// refresh the mechanically-generated blocks without clobbering hand edits.
function legacyGiftPreferences(npc) {
  const dyeRef = Object.values(npc?.appliedDyes || {}).find(Boolean);
  const dyeTraits = traitsForDye(dyeRef);
  return {
    loved: [loveTraitForRole(npc?.role)],
    liked: dyeTraits ? [...dyeTraits.hue, dyeTraits.saturation, dyeTraits.value] : [],
    neutral: [],
    disliked: dyeTraits ? [...new Set(dyeTraits.hue.flatMap(h => OPPOSITE_HUE[h] || []))] : [],
    hated: dyeTraits ? [dyeTraits.saturation === 'hot' ? 'muted' : 'hot'] : [],
    categoryNotes: [],
  };
}

function samePreferences(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function formatGiftBlock(prefs) {
  return `"gifts": {
                        "loved": ${JSON.stringify(prefs.loved || [])},
                        "liked": ${JSON.stringify(prefs.liked || [])},
                        "neutral": ${JSON.stringify(prefs.neutral || [])},
                        "disliked": ${JSON.stringify(prefs.disliked || [])},
                        "hated": ${JSON.stringify(prefs.hated || [])},
                        "categoryNotes": ${JSON.stringify(prefs.categoryNotes || [])}
                  },`;
}

function replaceNpcGiftBlock(text, npc, replacement) {
  const idAnchor = `"id": "${npc.id}"`;
  const idIndex = text.indexOf(idAnchor);
  if (idIndex < 0) return text;
  const currentBlock = formatGiftBlock(npc.gifts || { loved: [], liked: [], neutral: [], disliked: [], hated: [], categoryNotes: [] });
  const blockIndex = text.indexOf(currentBlock, idIndex);
  if (blockIndex < 0) return text;
  return text.slice(0, blockIndex) + formatGiftBlock(replacement) + text.slice(blockIndex + currentBlock.length);
}

function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db = JSON.parse(raw);
  const empty = { loved: [], liked: [], neutral: [], disliked: [], hated: [], categoryNotes: [] };

  let text = raw;
  let seeded = 0, refreshedLegacy = 0, skipped = 0;
  for (const npc of db.npcs || []) {
    const current = npc.gifts || empty;
    const next = deriveGiftPreferences(npc);
    if (samePreferences(current, empty)) {
      text = replaceNpcGiftBlock(text, npc, next);
      seeded++;
    } else if (samePreferences(current, legacyGiftPreferences(npc))) {
      text = replaceNpcGiftBlock(text, npc, next);
      refreshedLegacy++;
    } else {
      skipped++;
    }
  }
  fs.writeFileSync(DB_PATH, text);
  console.log(`[seed-npc-gift-preferences] Seeded ${seeded}; refreshed ${refreshedLegacy} legacy-generated; skipped ${skipped} hand-edited NPC(s).`);
}

module.exports = {
  traitsForDye,
  cosmeticCategory,
  wornDyeRefsForNpc,
  wornColorTraitsForNpc,
  deriveGiftPreferences,
  legacyGiftPreferences,
  samePreferences,
};

if (require.main === module) main();

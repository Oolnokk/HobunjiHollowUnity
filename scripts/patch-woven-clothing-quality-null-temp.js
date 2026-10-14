#!/usr/bin/env node
'use strict';

// Temporary branch-only patch runner; removed after its validated implementation commit lands.
const fs = require('node:fs');

function replaceOnce(file, before, after) {
  const source = fs.readFileSync(file, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor in ${file}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor in ${file}: ${before.slice(0, 120)}`);
  fs.writeFileSync(file, source.slice(0, first) + after + source.slice(first + before.length));
}

replaceOnce(
  'docs/js/equipment-panel.js',
  "      qualityStars: Number.isFinite(Number(item.qualityStars)) ? Math.max(1, Math.min(5, Math.round(Number(item.qualityStars)))) : null, // Preserves literal woven quality when moving a garment from Pack into permanent Gear.\n",
  "      qualityStars: item.qualityStars != null && Number.isFinite(Number(item.qualityStars)) ? Math.max(1, Math.min(5, Math.round(Number(item.qualityStars)))) : null, // Preserves literal woven quality while keeping ordinary unstarred clothing unstarred during Pack → Gear transfer.\n"
);

replaceOnce(
  'docs/js/favor-heart-balance.js',
  "  function activeGiftStars() {\n    if (activeGiftContext?.kind !== 'item' && activeGiftContext?.kind !== 'clothing') return null;\n    return Number.isFinite(Number(activeGiftContext.stars)) ? Number(activeGiftContext.stars) : null;\n  }\n",
  "  function activeGiftStars() {\n    if (activeGiftContext?.kind !== 'item' && activeGiftContext?.kind !== 'clothing') return null;\n    const stars = activeGiftContext.stars; // Used to keep an explicitly unstarred gift distinct from numeric star quality before coercion.\n    return stars != null && Number.isFinite(Number(stars)) ? Number(stars) : null;\n  }\n"
);

replaceOnce(
  'docs/js/favor-heart-balance.js',
  "      const wovenStars = Number(held?.instance?.qualityStars); // Used to make literal woven garment quality participate in the same Favor multiplier as other starred gifts.\n      return { kind: 'clothing', key: held?.instance?.uid || held.key || null, stars: Number.isFinite(wovenStars) ? clamp(Math.round(wovenStars), 1, 5) : null, held };\n",
  "      const wovenQuality = held?.instance?.qualityStars; // Used to distinguish authored/unstarred clothing from literal woven garments that actually carry quality.\n      const wovenStars = wovenQuality == null ? NaN : Number(wovenQuality); // Prevents null from coercing to 0 and accidentally turning ordinary clothing into a 1★ gift.\n      return { kind: 'clothing', key: held?.instance?.uid || held.key || null, stars: Number.isFinite(wovenStars) ? clamp(Math.round(wovenStars), 1, 5) : null, held };\n"
);

replaceOnce(
  'scripts/test-favor-heart-balance.js',
  "assert.equal(consumedQuality.length, consumedBeforeWovenGift, 'woven clothing quality is instance metadata and does not consume a CookingSystem quality bucket');\n\n// NpcRapport already mutates state.favor by point deltas; v4 deliberately leaves that point-space mutation alone.\n",
  "assert.equal(consumedQuality.length, consumedBeforeWovenGift, 'woven clothing quality is instance metadata and does not consume a CookingSystem quality bucket');\n\nheld = { kind: 'clothing', key: 'ordinaryClothing', instance: { uid: 'ordinary-clothing', qualityStars: null } };\ninventory.ordinaryClothing = 1;\nNpcGifting.offerGift({ rec: { id: 'ordinary_clothing' }, giftScore: 10 });\nassert.equal(rawState('ordinary_clothing').favor, 10, 'ordinary unstarred clothing keeps full authored gift value instead of coercing null quality into 1★');\nassert.equal(rewards.at(-1)?.text, '+10 Favor', 'ordinary clothing gift feedback remains unchanged when no star quality exists');\n\n// NpcRapport already mutates state.favor by point deltas; v4 deliberately leaves that point-space mutation alone.\n"
);

console.log('Applied unstarred-clothing quality guard.');

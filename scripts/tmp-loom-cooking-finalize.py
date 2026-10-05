from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly 1 occurrence, found {count}')
    return text.replace(old, new, 1)


# ── Cooking perk tree ──────────────────────────────────────────────────
perk_path = 'docs/js/perk-system.js'
perk = read(perk_path)
perk = replace_once(
    perk,
    '  // Perk trees for Combat, Alchemy, Foraging, Fishing, and Mining. Point entitlement\n',
    '  // Perk trees for Combat, Alchemy, Foraging, Fishing, Mining, Farming, and Cooking. Point entitlement\n',
    'perk header cooking mention',
)
perk = replace_once(
    perk,
    "    farming: [8, 16],\n",
    "    farming: [8, 16],\n    cooking: [], // Cooking currently has only a Tier-1 foundation perk; later tiers can add thresholds here without changing saves.\n",
    'cooking thresholds',
)
perk = replace_once(
    perk,
    "    farming: [\n      { id: 'selectiveHarvest', name: 'Selective Harvest', tier: 1, maxRank: 5, desc: r => `Crop and animal-product quality rolls are noticeably better, on top of Farming's existing bonus (rank ${r}/5).` },\n      { id: 'bountifulHarvest', name: 'Bountiful Harvest', tier: 1, maxRank: 5, desc: r => `Chance of an additional harvested crop is increased ${r * 6}%.` },\n      { id: 'husbandry', name: 'Husbandry', tier: 1, maxRank: 5, desc: r => `A well-cared-for animal's hearts push its product quality even further (rank ${r}/5).` },\n      { id: 'farmhand', name: 'Farmhand', tier: 1, maxRank: 5, desc: r => `Digging, planting, and harvesting are faster, on top of Farming's existing bonus (rank ${r}/5).` },\n      { id: 'artisan', name: 'Artisan', tier: 2, maxRank: 5, desc: r => `Processing craftsmanship is shifted toward preserving or improving quality (rank ${r}/5)${r >= 5 ? ' — ★★★★★ inputs can never lose quality' : ''}.` },\n      { id: 'carefulBatches', name: 'Careful Batches', tier: 2, maxRank: 3, desc: r => `Improves the minimum processing result (rank ${r}/3)${r >= 3 ? ' — ordinary quick-processing never lowers quality' : ''}.` },\n      { id: 'efficientProcessing', name: 'Efficient Processing', tier: 2, maxRank: 5, desc: r => `Chance to produce an extra processed unit without consuming another ingredient is increased ${r * 3}%.` },\n      { id: 'workingAnimals', name: 'Working Animals', tier: 2, maxRank: 3, desc: r => `Animal-operated processing (assigned squeezing-vat livestock) draws on that animal's own hearts instead of behaving like an anonymous machine (rank ${r}/3).` },\n      { id: 'cellarmaster', name: 'Cellarmaster', tier: 3, maxRank: 5, desc: r => `Barrel/vase aging is noticeably more likely to improve quality (rank ${r}/5).` },\n      { id: 'preserver', name: 'Preserver', tier: 3, maxRank: 5, desc: r => `Drying/smoking is noticeably more likely to preserve or improve quality (rank ${r}/5).` },\n    ],\n  };",
    "    farming: [\n      { id: 'selectiveHarvest', name: 'Selective Harvest', tier: 1, maxRank: 5, desc: r => `Crop and animal-product quality rolls are noticeably better, on top of Farming's existing bonus (rank ${r}/5).` },\n      { id: 'bountifulHarvest', name: 'Bountiful Harvest', tier: 1, maxRank: 5, desc: r => `Chance of an additional harvested crop is increased ${r * 6}%.` },\n      { id: 'husbandry', name: 'Husbandry', tier: 1, maxRank: 5, desc: r => `A well-cared-for animal's hearts push its product quality even further (rank ${r}/5).` },\n      { id: 'farmhand', name: 'Farmhand', tier: 1, maxRank: 5, desc: r => `Digging, planting, and harvesting are faster, on top of Farming's existing bonus (rank ${r}/5).` },\n      { id: 'artisan', name: 'Artisan', tier: 2, maxRank: 5, desc: r => `Processing craftsmanship is shifted toward preserving or improving quality (rank ${r}/5)${r >= 5 ? ' — ★★★★★ inputs can never lose quality' : ''}.` },\n      { id: 'carefulBatches', name: 'Careful Batches', tier: 2, maxRank: 3, desc: r => `Improves the minimum processing result (rank ${r}/3)${r >= 3 ? ' — ordinary quick-processing never lowers quality' : ''}.` },\n      { id: 'efficientProcessing', name: 'Efficient Processing', tier: 2, maxRank: 5, desc: r => `Chance to produce an extra processed unit without consuming another ingredient is increased ${r * 3}%.` },\n      { id: 'workingAnimals', name: 'Working Animals', tier: 2, maxRank: 3, desc: r => `Animal-operated processing (assigned squeezing-vat livestock) draws on that animal's own hearts instead of behaving like an anonymous machine (rank ${r}/3).` },\n      { id: 'cellarmaster', name: 'Cellarmaster', tier: 3, maxRank: 5, desc: r => `Barrel/vase aging is noticeably more likely to improve quality (rank ${r}/5).` },\n      { id: 'preserver', name: 'Preserver', tier: 3, maxRank: 5, desc: r => `Drying/smoking is noticeably more likely to preserve or improve quality (rank ${r}/5).` },\n    ],\n    // Cooking is already a real character skill. Start its perk tree with one\n    // broad yield choice; more specialized recipe/effect perks can branch from\n    // here later without moving Cooking progression into world Crafting Mastery.\n    cooking: [\n      { id: 'increaseCookingYield', name: 'Increase Cooking Yield', tier: 1, maxRank: 1, desc: () => '25% chance for each cooking action to produce one extra serving without consuming extra ingredients.' },\n    ],\n  };",
    'cooking perk tree',
)
perk = replace_once(
    perk,
    "  const ranks = { combat: {}, alchemy: {}, foraging: {}, fishing: {}, mining: {}, farming: {} }; // skillKey -> perkId -> rank\n",
    "  const ranks = { combat: {}, alchemy: {}, foraging: {}, fishing: {}, mining: {}, farming: {}, cooking: {} }; // skillKey -> perkId -> rank\n",
    'cooking rank storage',
)
perk = replace_once(
    perk,
    "    farming: { label: 'Farming', icon: '🌾' },\n",
    "    farming: { label: 'Farming', icon: '🌾' },\n    cooking: { label: 'Cooking', icon: '🍲' },\n",
    'cooking tree metadata',
)
write(perk_path, perk)


# ── Cooking output integration ─────────────────────────────────────────
cooking_path = 'docs/js/cooking-system.js'
cooking = read(cooking_path)
cooking = replace_once(
    cooking,
    "      const label = foodName(recipe, effects);\n      const saved = [];\n",
    "      const label = foodName(recipe, effects);\n      const cookingYieldRank = window.PerkSystem?.rank?.('cooking', 'increaseCookingYield') || 0; // Used by the Cooking perk tree; one purchased rank grants the authored extra-serving chance.\n      const cookingYieldChance = Math.min(0.25, Math.max(0, cookingYieldRank) * 0.25); // Central yield tuning: rank 1 = 25%, and bonus ranks cannot push this starter perk above its authored cap.\n      const servings = 1 + (((deps.random || Math.random)() < cookingYieldChance) ? 1 : 0); // Extra yield never consumes another ingredient because this roll happens once per completed cooking action.\n      const saved = [];\n",
    'cooking yield roll',
)
cooking = replace_once(
    cooking,
    "      deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + 1);\n      recordItemQuality(key, stars, 1);\n",
    "      deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + servings);\n      recordItemQuality(key, stars, servings); // Both servings share the same completed dish quality/effects because the perk increases batch yield, not recipe resolution.\n",
    'cooking yield output quantity',
)
cooking = replace_once(
    cooking,
    "      deps.showToast(`🍲 ${window.SkillSystem?.starRatingText?.(stars) || '★'.repeat(stars)} ${label}${saved.length ? ` · saved ${saved.join(', ')}` : ''}`, true);\n",
    "      deps.showToast(`🍲 ${window.SkillSystem?.starRatingText?.(stars) || '★'.repeat(stars)} ${label}${servings > 1 ? ' · ×2 yield' : ''}${saved.length ? ` · saved ${saved.join(', ')}` : ''}`, true);\n",
    'cooking yield toast',
)
cooking = replace_once(
    cooking,
    "    const banubuDiagnostics = window.BanubuQuestline?.diagnosticsText?.(); // Used to expose fish-pie target feasibility/progress on mobile without browser developer tools.\n    output.textContent = `Station: ${isOpen() ? 'hearth open' : 'closed'}\\nRecipes: ${data().recipes.length}",
    "    const banubuDiagnostics = window.BanubuQuestline?.diagnosticsText?.(); // Used to expose fish-pie target feasibility/progress on mobile without browser developer tools.\n    const cookingYieldRank = window.PerkSystem?.rank?.('cooking', 'increaseCookingYield') || 0; // Used to verify the perk without a desktop console.\n    const cookingYieldChance = Math.min(0.25, Math.max(0, cookingYieldRank) * 0.25); // Mirrors the authoritative cook() roll above for mobile-readable diagnostics.\n    output.textContent = `Station: ${isOpen() ? 'hearth open' : 'closed'}\\nCooking Yield perk: ${cookingYieldRank} (extra serving ${(cookingYieldChance * 100).toFixed(0)}%)\\nRecipes: ${data().recipes.length}",
    'cooking yield diagnostics',
)
write(cooking_path, cooking)


# ── Procedural fallback schema fix ─────────────────────────────────────
advanced_path = 'docs/js/advanced-loom-system.js'
advanced = read(advanced_path)
advanced = replace_once(
    advanced,
    "    const box = (x, y, z, sx, sy, sz, tint = 0.9) => ({ type: 'box', x, y, z, sx, sy, sz, color: 0x7d5b3a, tint }); // Used by the two loom fallback frames when authored furniture JSON is unavailable.\n    const leg = (x, z, h, thick = 0.1, tint = 0.8) => ({ type: 'legSquare', x, y: h / 2, z, sx: thick, sy: h, sz: thick, color: 0x6f5133, tint }); // Used to keep Simple and Advanced loom fallback proportions consistent.\n",
    "    const box = (x, y, z, sx, sy, sz, tint = 0.9) => ({ kind: 'box', tint, color: 0x7d5b3a, transform: { x, y, z, sx, sy, sz } }); // Used by the two loom fallback frames when authored furniture JSON is unavailable; matches ProceduralFurniture's canonical part schema.\n    const leg = (x, z, h, thick = 0.1, tint = 0.8) => ({ kind: 'legSquare', tint, color: 0x6f5133, transform: { x, y: h / 2, z, sx: thick, sy: h, sz: thick } }); // Used to keep Simple and Advanced loom fallback proportions consistent.\n",
    'advanced loom procedural schema',
)
advanced = advanced.replace("    version: 1,\n      masteryId", "    version: 1,\n      masteryId", 1)
write(advanced_path, advanced)


# ── Regression contract ────────────────────────────────────────────────
test_path = Path('scripts/test-advanced-loom-cooking-yield.js')
test_path.write_text(r'''const assert = require('assert');
const fs = require('fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const weaving = fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8');
const mastery = fs.readFileSync('docs/js/advanced-loom-system.js', 'utf8');
const perks = fs.readFileSync('docs/js/perk-system.js', 'utf8');
const cooking = fs.readFileSync('docs/js/cooking-system.js', 'utf8');
const grid = fs.readFileSync('docs/js/interior-furniture-grid.js', 'utf8');
const carpenter = fs.readFileSync('docs/js/carpenter-shop.js', 'utf8');
const simpleAuthored = JSON.parse(fs.readFileSync('docs/config/furniture-authored/loom.json', 'utf8'));
const advancedAuthored = JSON.parse(fs.readFileSync('docs/config/furniture-authored/advancedLoom.json', 'utf8'));

assert.match(game, /name: 'Simple Loom'/, 'legacy loom is renamed Simple Loom');
assert.match(game, /advancedLoom:\s*\{[^\n]+name: 'Advanced Loom'/, 'Advanced Loom is registered as furniture');
assert.match(game, /makeLoomInteractable\(false\)/, 'Simple Loom explicitly uses ordinary weaving capability');
assert.match(game, /makeLoomInteractable\(true\)/, 'Advanced Loom explicitly enables overpass weaving');
assert.deepEqual(simpleAuthored.footprint, { w: 1, d: 1 }, 'Simple Loom authored footprint is physically compact');
assert.deepEqual(advancedAuthored.footprint, { w: 1, d: 2 }, 'Advanced Loom keeps a full-sized footprint');
assert.match(grid, /loomFurniture:\s*\[1,\s*1\].*advancedLoomFurniture:\s*\[1,\s*2\]/s, 'runtime furniture footprints distinguish Simple and Advanced looms');

assert.match(mastery, /MASTERY_ID = 'advancedLoomBlueprint'/, 'Advanced Loom has a world Crafting Mastery blueprint unlock');
assert.match(mastery, /MOTE_COST = 8/, 'Advanced Loom blueprint costs Motes of Craft');
assert.match(mastery, /kind: 'box'.*transform:/, 'Advanced Loom procedural box fallback uses canonical furniture part schema');
assert.match(mastery, /kind: 'legSquare'.*transform:/, 'Advanced Loom procedural leg fallback uses canonical furniture part schema');
assert.doesNotMatch(mastery, /type: 'box'|type: 'legSquare'/, 'Advanced Loom does not use the obsolete flat fallback schema');
assert.match(carpenter, /!bp\.moteOnly/, 'Mote-only Advanced Loom blueprint is excluded from the gold carpenter shop');

assert.match(weaving, /function weavingHasOverpass\(/, 'weaving system detects authored pattern stack slot 2');
assert.match(weaving, /const cost = baseCost \* \(weavingHasOverpass\(weaving\) \? 2 : 1\)/, 'overpass doubles both craft and reweave wool cost through shared cost rule');
assert.match(weaving, /Advanced Loom is required to weave an overpass pattern/, 'Simple Loom cannot author overpass garments');
assert.match(weaving, /Advanced Loom is required to reweave an overpass pattern/, 'Simple Loom cannot strip or edit overpass garments');
assert.match(weaving, /patterns,\n\s*\.\.\.\(entry\.patternId/, 'crafted garment stores the two-pattern stack');

assert.match(perks, /cooking:\s*\[\s*\{ id: 'increaseCookingYield', name: 'Increase Cooking Yield', tier: 1, maxRank: 1/, 'Cooking perk tree owns Increase Cooking Yield');
assert.match(perks, /cooking: \{ label: 'Cooking', icon: '🍲' \}/, 'Cooking perk tree is rendered in the shared perk UI');
assert.match(cooking, /rank\?\.\('cooking', 'increaseCookingYield'\)/, 'cooking output reads the character Cooking perk rank');
assert.match(cooking, /const servings = 1 \+/, 'Cooking Yield resolves an extra-serving roll per completed cook');
assert.match(cooking, /inventory\[key\].*\+ servings/, 'extra cooking yield increases the output stack');
assert.match(cooking, /recordItemQuality\(key, stars, servings\)/, 'extra serving quantity is tracked in food quality buckets');
assert.match(cooking, /Cooking Yield perk:/, 'mobile cooking diagnostics expose the yield rank and chance');

console.log('advanced loom + cooking yield regression passed');
''', encoding='utf-8')


# The branch used temporary patch automation because several integration files
# are intentionally huge. Remove those helpers in the same commit that records
# the finished feature so no one can accidentally rerun a one-shot patch.
for temp in [
    'scripts/tmp-advanced-loom-patch.py',
    'scripts/tmp-loom-cooking-finalize.py',
    '.github/workflows/tmp-advanced-loom-inspect.yml',
]:
    path = Path(temp)
    if path.exists():
        path.unlink()

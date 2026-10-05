const assert = require('assert');
const fs = require('fs');

// Cross-system contract: loom capability/progression and Cooking yield stay in their respective world- and character-scoped progression systems.
const game = fs.readFileSync('docs/game.js', 'utf8');
const weaving = fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8');
const mastery = fs.readFileSync('docs/js/advanced-loom-system.js', 'utf8');
const perks = fs.readFileSync('docs/js/perk-system.js', 'utf8');
const cooking = fs.readFileSync('docs/js/cooking-system.js', 'utf8');
const grid = fs.readFileSync('docs/js/interior-furniture-grid.js', 'utf8');
const carpenter = fs.readFileSync('docs/js/carpenter-shop.js', 'utf8');
const commissions = fs.readFileSync('docs/js/npc-crafting-commission-generator.js', 'utf8');
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
assert.match(commissions, /!entry\?\.moteOnly && !entry\?\.masteryUnlockId/, 'Mote/Crafting-Mastery blueprints cannot be granted free by furniture commissions');

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
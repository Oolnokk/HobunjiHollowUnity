#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expandClassicScriptGroups } = require('./classic-script-group-index.js');

const root = path.resolve(__dirname, '..'); // Repository root for the real shipped script manifests and modules.
const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Production parser-position source.
const expanded = expandClassicScriptGroups(html); // Actual effective synchronous script order.
const urls = [...expanded.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]); // Actual versioned URLs.
const scriptPaths = urls.map(url => url.split('?')[0]); // Normalized path lookup for uniqueness and adjacency.
const baseline = {
  "combat-main": [
    "js/combat/weapon-shape-stats.js",
    "js/combat/combat-core.js",
    "js/combat/enemy-search-ai.js",
    "js/combat/impact-blend-library.js",
    "js/combat/impact-ragdoll-playback.js",
    "js/combat/combat-enemy-telegraph.js",
    "js/combat/combat-animal-attacks.js",
    "js/combat/combat-voorg-ass-rear-kick.js",
    "js/combat/combat-attach.js",
    "js/combat/combat-loadout.js",
    "js/combat/combat-progression.js",
    "js/combat/combat-attack-events.js",
    "js/combat/companion-offense.js",
    "js/companion-combat-response.js",
    "js/combat/animal-scent-targeting.js",
    "js/combat/combat-input.js",
    "js/combat/attack-pose-templates.js",
    "js/combat/combat-combo.js",
    "js/combat/combat-quickattacks.js",
    "js/combat/combat-counter-shield.js",
    "js/combat/combat-blink-dodge.js",
    "js/combat/combat-charged-breaker.js",
    "js/combat/combat-flurry.js",
    "js/combat/combat-loadout-ui.js",
    "js/combat/combat-enchantments.js",
    "js/combat/weapon-enchantment-vfx.js",
    "js/combat/loadout-weapon-preview.js"
  ],
  "combat-enemies": [
    "js/combat/ranged-weapons.js",
    "js/combat/ranged-hud-reticle.js",
    "js/combat/melee-hud-reticle.js",
    "js/combat/enemy-loadout-rules.js",
    "js/combat/combat-bandit.js",
    "js/combat/ghoul-special-variants.js",
    "js/combat/bandit-rank-wardrobe.js",
    "js/combat/combat-ghoul-wyrm-witches.js",
    "js/combat/combat-minion.js",
    "js/combat/combat-maskbound-guardian.js",
    "js/combat/combat-enemy-dodge.js",
    "js/combat/combat-maskbound-headtaker.js",
    "js/combat/combat-lich.js",
    "js/combat/combat-special-liches.js"
  ],
  "ruin-puzzles": [
    "js/melody-camera-framing.js",
    "js/puzzle-cave-melody.js",
    "js/puzzle-cave-plate-art.js",
    "js/ruin-melody-glyph-decal.js",
    "js/ruin-layer-challenges.js",
    "js/ruin-layer-playable.js",
    "js/ruin-v50-native-mechanisms.js",
    "js/ruin-v50-native-floors.js",
    "js/ruin-shaft-connector.js",
    "js/ruin-v50-vestibule.js",
    "js/ruin-wall-coffins.js",
    "js/ruin-multifloor-v50-style.js",
    "js/ruin-checkpoint-travel.js"
  ],
  "dialogue": [
    "js/cinematic-camera-runtime.js",
    "js/camera-tile-collision.js",
    "js/camera-occlusion-chunks.js",
    "js/dialogue-camera-framing.js",
    "js/dialogue-templates.js",
    "js/dialogue-rich-text.js",
    "js/character-voice-owner.js",
    "js/dialogue-content.js"
  ]
}; // Original required members, in their original relative order.
const placement = {
  "combat-main": {
    "before": "js/tool-activity-stages.js",
    "after": "js/nearby-volume-collision.js"
  },
  "combat-enemies": {
    "before": "js/swept-move.js",
    "after": "js/bandit-camps.js"
  },
  "ruin-puzzles": {
    "before": "js/ruin-layer-defense.js",
    "after": "js/wilderness-map.js"
  },
  "dialogue": {
    "before": "js/pixel-probe.js",
    "after": "js/combat/combat-tutorial-content.js"
  }
}; // Adjacent scripts that stay outside the migrated group.
assert.equal(new Set(scriptPaths).size, scriptPaths.length, 'production startup must not load a classic script twice');
for (const [name, members] of Object.entries(baseline)) {
  assert(html.includes('data-classic-group="' + name + '"'), name + ' must have its own loader tag');
  const file = path.join(root, 'docs/js/bootstrap/classic-groups', name + '.js'); // Feature-owned manifest.
  const match = fs.readFileSync(file, 'utf8').match(/const scriptUrls = (\[[\s\S]*?\]);/);
  assert(match, name + ' must expose its ordered scriptUrls');
  const ownedUrls = JSON.parse(match[1]); // Actual manifest members, not an unrelated index.html entry.
  const ownedPaths = ownedUrls.map(url => url.split('?')[0]); // Used for exact ownership checks.
  assert.equal(new Set(ownedPaths).size, ownedPaths.length, name + ' must not duplicate a module');
  let previous = -1; // Monotonic index ensures that interdependent original members retain evaluation order.
  for (const modulePath of members) {
    const index = ownedPaths.indexOf(modulePath); // Required member position inside its owning manifest.
    assert(index > previous, name + ' lost or reordered ' + modulePath);
    previous = index;
    assert.equal(scriptPaths.filter(url => url === modulePath).length, 1, modulePath + ' must load once');
    assert(/\.js\?v=[A-Za-z0-9_-]+$/.test(ownedUrls[index]), modulePath + ' needs a cache version');
    assert(fs.existsSync(path.join(root, 'docs', modulePath)), modulePath + ' must exist in docs');
  }
  const first = scriptPaths.indexOf(members[0]); // First original member for group boundary checks.
  const last = scriptPaths.indexOf(members[members.length - 1]); // Last original member for group boundary checks.
  assert(scriptPaths.indexOf(placement[name].before) < first, name + ' moved before its prerequisite');
  assert(last < scriptPaths.indexOf(placement[name].after), name + ' moved behind its dependent');
  assert(last < scriptPaths.indexOf('game.js'), name + ' must initialize before game.js');
}
console.log('Combat, enemy, dialogue and ruin-puzzle manifests retain required ownership, order, cache versions and neighbors.');

#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expandClassicScriptGroups } = require('./classic-script-group-index.js');

const root = path.resolve(__dirname, '..'); // Shared root used for real shipped manifest paths.
const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Production script positions.
const effective = expandClassicScriptGroups(html); // Actual classic script order after parser insertion.
const scripts = [...effective.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]); // Production versioned URLs.
const baseline = { // Original order anchors inside the two feature-owned manifests.
  festival: [
    'js/festival-ancestor-figures.js', 'js/festival-props.js', 'js/festival-wheel-dance-runtime.js',
    'js/npc-festival-dance.js', 'js/npc-shared-meals.js', 'js/festival-potluck-contest.js',
    'js/festival-locale-activities.js', 'js/festival-offering-ritual.js', 'js/festival-system.js',
    'js/festival-dialogue.js', 'js/festival-ui.js',
  ],
  'npc-schedule': [
    'js/npc-agenda.js', 'js/npc-activities.js', 'js/npc-social-stimuli.js', 'js/npc-activity-planner.js',
    'js/npc-scheduling.js', 'js/npc-farm-plots.js', 'config/npcs/social-relations.js',
    'js/npc-social-seating-bridge.js', 'js/npc-pathfinding.js', 'js/nohuknuk-wilderness.js',
    'js/npc-route-graph.js',
  ],
};
const indexes = {}; // Used to check the feature boundaries against neighbouring classic scripts.
for (const [group, members] of Object.entries(baseline)) {
  assert(html.includes('data-classic-group="' + group + '"'), group + ' group must be present');
  let previous = -1; // Preserves original evaluation-time dependency order while allowing new members.
  for (const modulePath of members) {
    const found = scripts.map((url, i) => url.split('?')[0] === modulePath ? i : -1).filter(i => i !== -1);
    assert.equal(found.length, 1, modulePath + ' must load exactly once');
    const index = found[0]; // Position in the flattened script list used for ordering.
    assert(index > previous, group + ' reordered required module ' + modulePath);
    assert(/\.js\?v=[A-Za-z0-9_-]+$/.test(scripts[index]), modulePath + ' requires a cache version');
    assert(fs.existsSync(path.join(root, 'docs', modulePath)), modulePath + ' must exist in docs');
    indexes[modulePath] = index;
    previous = index;
  }
}
function position(relativePath) {
  const found = scripts.findIndex(url => url.split('?')[0] === relativePath); // Neighboring module boundary.
  assert(found >= 0, 'Missing neighboring module ' + relativePath);
  return found;
}
assert(indexes['js/festival-ancestor-figures.js'] > position('js/combat/combat-tutorial.js'));
assert(indexes['js/festival-ui.js'] < position('js/tutorial-unlock-visits.js'));
assert(indexes['js/npc-agenda.js'] > position('js/music-minigame.js'));
assert(indexes['js/npc-route-graph.js'] < position('js/camera-look-clamp.js'));
assert(indexes['js/npc-route-graph.js'] < position('game.js'));
console.log('Festival and NPC scheduling script manifests preserve 22 original dependencies and cache versions.');

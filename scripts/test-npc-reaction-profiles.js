#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repository root used by every fixture read below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Shared text loader for source/config assertions.
const runtimeSource = read('docs/js/npc-silliness-reaction-runtime.js'); // Unified runtime must parse and expose compatibility + profile APIs.
const editorSource = read('docs/js/ambient-dialogue-reaction-editor.js'); // Reactions editor adapter must parse independently of browser execution.
const ambientEditor = read('docs/tools/ambient-dialogue-editor/index.html'); // Base editor must actually load the reactions adapter.
const config = JSON.parse(read('docs/config/dialogue/npc-reaction-profiles.json')); // Authored personality data validated structurally and through the runtime resolver.

assert.doesNotThrow(() => new vm.Script(runtimeSource), 'NPC reaction runtime parses');
assert.doesNotThrow(() => new vm.Script(editorSource), 'Ambient Dialogue reaction editor parses');
assert.match(ambientEditor, /ambient-dialogue-reaction-editor\.js/, 'Ambient Dialogue Editor loads the Reactions tab adapter');
assert.doesNotMatch(runtimeSource, /silliness-reactions\.json/, 'runtime no longer reads the retired standalone silliness config');
assert.match(runtimeSource, /\['silliness', 'dance', 'music'\]/, 'automatic player reactions include silliness, dance, and music');
assert.match(runtimeSource, /stable_animal_recognition_/, 'stable-animal recognition copy is routed through reaction profiles');
assert.match(runtimeSource, /return reactionType === 'silliness' \? 'laugh' : 'smile'/, 'positive social reactions map silliness to laugh and dance/music to smile');
assert.match(runtimeSource, /if \(polarity === 'negative'\) return 'frown'/, 'negative social reactions use a frown');
assert.match(runtimeSource, /expression: reactionExpression\(reactionType, polarity\)/, 'ambient social reaction renderer receives the derived reaction expression');
assert.match(runtimeSource, /tier === 'wary'\) return 'frown'/, 'wary pet reactions frown');
assert.match(runtimeSource, /tier === 'recognized' \|\| tier === 'trained'\) return 'smile'/, 'warm trained or recognized pet reactions smile');
assert.match(editorSource, /NPC personality assignments/, 'editor exposes per-NPC personality assignment');
assert.match(editorSource, /Animal reactions/, 'editor exposes animal reaction pools');
assert.match(editorSource, /Silliness \/ pranks/, 'editor exposes silliness pools');
assert.match(editorSource, /Dance/, 'editor exposes dance pools');
assert.match(editorSource, /Music/, 'editor exposes music pools');

assert.ok(config.profiles?.[config.defaultProfile], 'configured default personality exists');
assert.deepEqual(Object.keys(config.profiles).sort(), ['neighborly', 'playful', 'proper', 'reserved', 'stern'], 'starter personality set is stable');
assert.ok(Object.keys(config.assignments || {}).length >= 25, 'starter NPC database has broad personality assignments');

const animalTiers = ['trained', 'familiar', 'wary', 'recognition']; // Runtime-supported role-specific animal tiers every profile must expose.
const roles = ['mount', 'companion', 'shoulderPet']; // Runtime-supported stable animal roles every tier must expose.
const socialCategories = ['silliness', 'dance', 'music']; // Social reaction types every profile must expose with both polarities.
let longestLineWords = 0; // Tracks prose compactness so future generated copy does not drift back into paragraph-like ambient lines.
for (const [profileId, profile] of Object.entries(config.profiles)) {
  assert.ok(profile.label, `${profileId} has a display label`);
  assert.ok(Array.isArray(profile.animal?.recognized) && profile.animal.recognized.length, `${profileId} has recognized-animal copy`);
  for (const tier of animalTiers) for (const role of roles) {
    assert.ok(Array.isArray(profile.animal?.[tier]?.[role]) && profile.animal[tier][role].length, `${profileId} ${tier}/${role} has copy`);
  }
  for (const category of socialCategories) for (const polarity of ['positive', 'negative']) {
    assert.ok(Array.isArray(profile?.[category]?.[polarity]) && profile[category][polarity].length, `${profileId} ${category}/${polarity} has copy`);
  }
  const allLines = JSON.stringify(profile).match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) || []; // String scan is used only for a soft ambient-line length guard.
  for (const raw of allLines) {
    const text = JSON.parse(raw); // JSON decoding restores punctuation/placeholders before counting words.
    if (!/[.!?]/.test(text) && !text.includes('{')) continue;
    longestLineWords = Math.max(longestLineWords, text.trim().split(/\s+/).filter(Boolean).length);
  }
}
assert.ok(longestLineWords <= 16, `ambient reaction copy stays concise (longest ${longestLineWords} words)`);

for (const [npcId, profileId] of Object.entries(config.assignments || {})) {
  assert.ok(config.profiles[profileId], `${npcId} assignment points to existing profile ${profileId}`);
}

const context = { // Minimal browser-like sandbox used to exercise the actual resolver without starting gameplay loops.
  console,
  URL,
  performance: { now: () => 1000 },
  document: { baseURI: 'https://example.invalid/' },
  setInterval: () => 1,
  clearInterval() {},
  fetch: async url => ({
    ok: true,
    json: async () => String(url).includes('npc-reaction-profiles.json') ? config : { greetingRadiusTiles: 2.6 },
  }),
};
context.window = context;
vm.createContext(context);
vm.runInContext(runtimeSource, context, { filename: 'npc-silliness-reaction-runtime.js' });

(async () => {
  await context.NpcReactionProfiles.reload();
  assert.equal(context.NpcReactionProfiles.profileForNpc('gantami_ginju').id, 'playful', 'Gantami uses playful reaction personality');
  assert.equal(context.NpcReactionProfiles.profileForNpc('spearhead_unumanuk').id, 'stern', 'Spearhead uses stern reaction personality');
  const playfulDance = context.NpcReactionProfiles.resolve({ npcId: 'gantami_ginju', category: 'dance', polarity: 'positive', seed: 'test' }); // Resolver output verifies social profile routing.
  assert.ok(config.profiles.playful.dance.positive.includes(playfulDance), 'dance reaction resolves from assigned playful profile');
  const properAnimal = context.NpcReactionProfiles.resolve({ npcId: 'father_hunundi_hodu', category: 'animal', tier: 'trained', role: 'mount', values: { animalName: 'Moss', species: 'grehlr' }, seed: 'test' }); // Resolver output verifies animal placeholders and role/tier routing.
  assert.ok(properAnimal && !properAnimal.includes('{'), 'animal reaction resolves placeholders through assigned proper profile');
  const debug = context.NpcReactionProfiles.getDebug(); // Public debug surface is required for mobile diagnosis without console access.
  assert.equal(debug.profileCount, 5, 'debug reports authored profile count');
  console.log('NPC reaction personality profiles passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

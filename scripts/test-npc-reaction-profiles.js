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
assert.match(editorSource, /NPC personality assignments/, 'editor exposes per-NPC personality assignment');
assert.match(editorSource, /Animal reactions/, 'editor exposes animal reaction pools');
assert.match(editorSource, /Rare size reactions/, 'editor exposes rare genetic-size reaction pools');
assert.match(editorSource, /Silliness \/ pranks/, 'editor exposes silliness pools');
assert.match(editorSource, /Dance/, 'editor exposes dance pools');
assert.match(editorSource, /Music/, 'editor exposes music pools');

assert.ok(config.profiles?.[config.defaultProfile], 'configured default personality exists');
assert.deepEqual(Object.keys(config.profiles).sort(), ['neighborly', 'playful', 'proper', 'reserved', 'stern'], 'starter personality set is stable');
assert.ok(Object.keys(config.assignments || {}).length >= 25, 'starter NPC database has broad personality assignments');

const defaultAnimalReactions = config.profiles[config.defaultProfile].animal; // Default personality owns the shared rare-size copy inherited by personalities that leave these pools blank.
assert.deepEqual(defaultAnimalReactions.sizeTwoLarger, ['Dear Breath, that has to be the biggest {species} I have ever seen in my life.'], 'Small-to-Large pets get the extreme large reaction');
assert.deepEqual(defaultAnimalReactions.sizeOneLarger, ['I think you might be overfeeding your {species}.'], 'one-size-larger pets get the overfeeding reaction');
assert.deepEqual(defaultAnimalReactions.sizeOneSmaller, ['What a cute little fellow. Runt of the litter?'], 'one-size-smaller pets get the runt reaction');
assert.deepEqual(defaultAnimalReactions.sizeTwoSmaller, ['Dear Breath, that has to be the tiniest {species} I have ever seen in my life.'], 'Large-to-Small pets get the extreme small reaction');
assert.match(runtimeSource, /tier === 'recognition' \? null : rareSizeTierForEntry/, 'one-time recognition copy is not replaced by rare-size ambient quips');

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
  context.CREATURE_DB = {
    tinyCritter: { label: 'Tiny Critter' },
    middleCritter: { label: 'Middle Critter' },
    giantCritter: { label: 'Giant Critter' },
  }; // Deliberately omits defaultSizeClass: the real bug was assuming the injected genetics registry is always mirrored onto window.CREATURE_DB.
  const defaultSizes = { tinyCritter: 'small', middleCritter: 'medium', giantCritter: 'large' }; // Authoritative species defaults supplied through the same CreatureGenetics API gameplay uses.
  context.CreatureGenetics = {
    defaultLivestockName: kind => context.CREATURE_DB?.[kind]?.label || kind,
    creatureSizeClass(kind, genotype) { return genotype?.sizeClass || defaultSizes[kind] || 'medium'; },
  };
  const rareSizeTierForEntry = context.NpcReactionProfiles.rareSizeTierForEntry; // Public pure helper lets regression tests validate the exact default-vs-bred size routing.
  assert.equal(rareSizeTierForEntry({ kind: 'tinyCritter', genotype: { sizeClass: 'large' } }), 'sizeTwoLarger', 'Small -> Large is the extreme larger tier');
  assert.equal(rareSizeTierForEntry({ kind: 'tinyCritter', genotype: { sizeClass: 'medium' } }), 'sizeOneLarger', 'Small -> Medium is one size larger');
  assert.equal(rareSizeTierForEntry({ kind: 'middleCritter', genotype: { sizeClass: 'large' } }), 'sizeOneLarger', 'Medium -> Large is one size larger');
  assert.equal(rareSizeTierForEntry({ kind: 'middleCritter', genotype: { sizeClass: 'small' } }), 'sizeOneSmaller', 'Medium -> Small is one size smaller');
  assert.equal(rareSizeTierForEntry({ kind: 'giantCritter', genotype: { sizeClass: 'medium' } }), 'sizeOneSmaller', 'Large -> Medium is one size smaller');
  assert.equal(rareSizeTierForEntry({ kind: 'giantCritter', genotype: { sizeClass: 'small' } }), 'sizeTwoSmaller', 'Large -> Small is the extreme smaller tier');
  assert.equal(rareSizeTierForEntry({ kind: 'middleCritter', genotype: { sizeClass: 'medium' } }), null, 'species-normal size keeps ordinary pet reactions');
  assert.equal(rareSizeTierForEntry({ kind: 'tinyCritter' }, 'mount'), 'sizeTwoLarger', 'active Stable role preserves rare legacy size when an old entry has no genotype payload');
  const inheritedRareLine = context.NpcReactionProfiles.resolve({ npcId: 'father_hunundi_hodu', category: 'animal', tier: 'sizeTwoLarger', role: 'mount', values: { animalName: 'Moss', species: 'Tiny Critter' }, seed: 'rare-size-test' }); // Proper personality intentionally has no rare-size override, so this must inherit the shared default line.
  assert.equal(inheritedRareLine, 'Dear Breath, that has to be the biggest Tiny Critter I have ever seen in my life.', 'rare-size copy inherits through the existing personality fallback');
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

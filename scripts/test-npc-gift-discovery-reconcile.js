#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/npc-gifting.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
assert.doesNotThrow(() => new vm.Script(source), 'NPC gifting runtime parses');
assert.match(gameSource, /getNpcRecordById: npcId => scheduledNpcRecords\.get\(npcId\)/, 'game gives gifting the canonical loaded NPC record for save reconciliation');

const records = new Map([
  ['kinami_kunji', {
    id: 'kinami_kunji',
    gifts: {
      loved: ['reagent'],
      liked: ['hueIndigo', 'muted', 'hot', 'dark'],
      neutral: [],
      disliked: ['hueOrange'],
      hated: [],
    },
  }],
  ['gorobi_ginju', {
    id: 'gorobi_ginju',
    gifts: {
      loved: ['crop'],
      liked: ['hueOrange', 'hueYellow', 'muted', 'dark', 'bright'],
      neutral: [],
      disliked: ['hueBlue', 'hueIndigo', 'hueViolet'],
      hated: ['hot'],
    },
  }],
]);

const context = {
  window: null,
  console,
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'npc-gifting.js' });

const gifting = context.NpcGifting;
gifting.init({
  getNpcRecordById: npcId => records.get(npcId) || null,
});

gifting.restoreDiscoveredPrefs({
  kinami_kunji: {
    loved: [],
    liked: ['hueIndigo'],
    disliked: [],
    hated: ['muted'], // Old save learned this before the authored preference correction.
  },
  gorobi_ginju: {
    loved: [],
    liked: [],
    disliked: [],
    hated: ['muted'], // Old save has exactly the now-wrong saturation tier.
  },
});

const kinami = gifting.getDiscoveredGiftTraits('kinami_kunji');
assert.deepEqual(Array.from(kinami.hated), [], 'old Kinami hated-Muted discovery is removed from hated');
assert.deepEqual(new Set(kinami.liked), new Set(['hueIndigo', 'muted']), 'old learned Muted knowledge moves to Kinami current liked tier');

const gorobi = gifting.getDiscoveredGiftTraits('gorobi_ginju');
assert.deepEqual(Array.from(gorobi.hated), [], 'old Gorobi hated-Muted discovery is removed');
assert.deepEqual(Array.from(gorobi.liked), ['muted'], 'old Gorobi Muted knowledge moves to his current liked tier');

const saved = gifting.serializeDiscoveredPrefs();
assert.deepEqual(saved.kinami_kunji.hated, [], 'cleaned Kinami tier is what gets saved back');
assert.ok(saved.kinami_kunji.liked.includes('muted'), 'corrected Kinami Muted knowledge persists');
assert.deepEqual(saved.gorobi_ginju.hated, [], 'cleaned Gorobi tier is what gets saved back');
assert.ok(saved.gorobi_ginju.liked.includes('muted'), 'corrected Gorobi Muted knowledge persists');

console.log('NPC discovered gift preference reconciliation passed.');

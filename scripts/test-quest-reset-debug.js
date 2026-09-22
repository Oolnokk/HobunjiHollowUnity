#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/quest-reset-debug.js', 'utf8');
assert.doesNotThrow(() => new vm.Script(source), 'quest reset debug module parses');
assert.match(source, /delete store\[questId\]/, 'generic active quests reset by removing their live questProgress record');
assert.match(source, /state\.visitedSeqSlots = \{\}/, 'dialogue sequence visit history resets');
assert.match(source, /state\.heardTrees = \[\]/, 'heard dialogue trees reset');
assert.match(source, /state\.heardPoolEntries = \[\]/, 'heard phrase-pool entries reset');
assert.match(source, /state\.memory = \[\]/, 'quest-giver dialogue memory resets');
assert.match(source, /Relationship favor was preserved/, 'debug reset explicitly preserves favor');
assert.match(source, /BanubuQuestline\?\.resetForDebug/, 'authored Banubu story state uses its dedicated reset seam');
assert.match(fs.readFileSync('docs/js/banubu-questline.js', 'utf8'), /function resetForDebug\(\)/, 'Banubu controller exposes a full intro reset');
assert.match(fs.readFileSync('docs/index.html', 'utf8'), /quest-reset-debug\.js/, 'game page loads the mobile-visible quest reset panel');
console.log('quest reset debug regression passed');

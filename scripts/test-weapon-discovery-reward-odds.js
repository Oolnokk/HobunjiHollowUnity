#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/config/weapon-discovery-rewards.js', 'utf8'), context, { filename: 'weapon-discovery-rewards.js' });

const rewards = context.WEAPON_DISCOVERY_REWARD_CONFIG?.rewards || [];
const fishingMace = rewards.find(reward => reward.source === 'gulletFish' && reward.shapeKey === 'fishingmace');
const dagger = rewards.find(reward => reward.source === 'treasureChest' && reward.shapeKey === 'dagger');

assert(fishingMace, 'Fishing Mace must remain available from gulletfish rewards');
assert(dagger, 'Dagger must remain available from treasure chests');
assert.equal(fishingMace.chance, 0.15, 'Fishing Mace gulletfish reward chance must be 15%');
assert.equal(dagger.chance, 0.15, 'Dagger treasure chest reward chance must be 15%');

console.log('weapon discovery reward source and 15% chance checks passed');

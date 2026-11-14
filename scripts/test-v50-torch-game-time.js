#!/usr/bin/env node
'use strict';
// V50 braziers now ignite the permanent Adventuring Tools torch, not an expiring pickup.
const assert = require('node:assert/strict');
const fs = require('node:fs'); // The actual shipped torch module is exercised in isolation.
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/adventuring-tools.js', 'utf8');
assert.doesNotMatch(source, /TORCH_BURN_MS|burnRemainingMs/, 'permanent torch has no V50 burn clock');
const world = { CharacterMetaSave: { update() {} } };
vm.runInNewContext(source, { window:world });
const torch = world.AdventuringTools;
torch.init({
  getActiveTool:()=> 'adventuring',
  getHeldMode:()=> 'tool',
  getEquippedTool:()=> 'torch',
  getUnlocked:()=> [],
  refreshActionBar() {},
});
assert.equal(torch.light(),true,'permanent equipped torch lights at a fire hazard');
for(let i=0;i<1200;i++)assert.equal(torch.isLit(),true,'gameplay time cannot expire the permanent torch');
assert.equal(torch.light(),false,'lighting an already burning torch does not reset or duplicate it');
torch.stow();
assert.equal(torch.isLit(),false,'putting away the torch deliberately extinguishes it');
assert.equal(torch.light(),true,'the same torch may be relit any number of times');
assert.equal(torch.isLit(),true);
console.log('ok V50 permanent torch: no burn clock, stow extinguishes, relight works');

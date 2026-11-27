#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Run actual family-care policy, not a restatement of its logic.
const source = fs.readFileSync('docs/js/family-baby-care.js', 'utf8');
let hour = 19, working = false, holdingCalls = [], returnCalls = 0, persisted = 0;
const baby = { id: 'baby1', name: 'Pip', otherParentId: 'spouse1', carryBy: null };
const infantWalker = { rec: { id: 'baby1', isChild: true }, area: 'interior', root: { position: { x: 6.5, z: 6.5 } } };
const parent = { rec: { id: 'spouse1' }, area: 'interior', root: { position: { x: 6.7, z: 6.5 } } };
const ctx = {
  family: { children: [baby] },
  helpers: {
    clockHour: () => hour, hourStamp: () => hour,
    hashInt: () => 1, findWalker: id => id === 'spouse1' ? parent : null,
    bedSpot: () => ({ area: 'interior', c: 6, r: 7 }), toast() {},
  },
  romance: { getSpouse: () => ({ npcId: 'spouse1' }), isOnDateWith: () => false, activeSpouseOuting: () => null },
  phaseOf: () => 'basket', walkerFor: () => infantWalker,
  basketObject: () => ({ col: 6, row: 6 }),
  persist: () => persisted++,
};
const W = {
  RomanceFamily: { careContext: () => ctx },
  NpcFarmPlots: { targetFor: () => working ? { area: 'farm', c: 5, r: 5 } : null },
  Shattercasks: { heldBurdenInfo: () => null, stowOnBack: () => true },
  FamilyBabyBurdens: {
    isAllowedArea: area => ['interior', 'farm', 'town'].includes(area),
    spouseCarry: (child, _baby, _parent, pose) => { holdingCalls.push(pose); child.carryBy = 'spouse'; child.carryPose = pose; return true; },
    returnToBasket: (child, basket) => { assert.equal(basket.col, 6, 'childcare passes the actual cup coordinate to the burden'); returnCalls++; child.carryBy = null; return true; },
    takeIntoArms: child => { child.carryBy = 'player'; return true; },
  },
};
vm.runInNewContext(source, { window: W, console });
const policy = W.FamilyBabyCare;
assert.equal(policy.planFor(baby).pose, 'arms', 'free-time newborn is held in arms');
assert.equal(policy.spouseTarget(parent.rec).area, 'interior', 'off-duty spouse stays by crib');
policy.tick();
assert.deepEqual(holdingCalls, ['arms'], 'spouse takes baby in arms when they are close to the basket');
ctx.family.spouseVatId = 'obsolete_spouse_vat'; // Simulates a stale field before legacy family-save migration.
hour = 12;
assert.equal(policy.planFor(baby).farmwork, false, 'retired spouse vat fields cannot masquerade as real fieldwork');
assert.equal(policy.planFor(baby).pose, null, 'stale vat fields never cause an incorrect back-stow pose');
delete ctx.family.spouseVatId;
working = true; hour = 12;
assert.equal(policy.planFor(baby).pose, 'back', 'farmwork selects back-stow instead of skipping work');
assert.equal(policy.spouseTarget(parent.rec), null, 'working parent retains ordinary farmwork target while carrying baby');
policy.tick();
assert.deepEqual(holdingCalls, ['arms', 'back'], 'actual parenting path reuses spouse carry attachment in the new pose');
hour = 19; working = true;
assert.equal(policy.planFor(baby).pose, 'arms', 'old farmwork requests cannot keep the baby stowed after the spouse finishes their shift');
working = false; hour = 23;
assert.equal(policy.planFor(baby).pose, null, 'baby rests in basket during night');
assert.equal(policy.spouseTarget(parent.rec).area, 'interior', 'carrying spouse returns home before normal bedtime');
policy.tick();
assert.equal(returnCalls, 1, 'spouse returns baby to basket on arriving home');
hour = 19; baby.carryBy = 'player';
assert.equal(policy.planFor(baby), null, 'player holding always takes precedence');
assert.equal(policy.spouseTarget(parent.rec), null, 'the spouse resumes normal idle behavior when player holds baby');
policy.tick(); assert.equal(holdingCalls.length, 2, 'parent never steals child from player');
baby.carryBy = 'spouse';
const spouseCommands = policy.commandOptionsFor(parent);
const handoff = spouseCommands.find(x => x.id === 'hold_baby_baby1');
assert(handoff && handoff.run(), 'long-hold spouse wheel can hand baby to the player');
assert.equal(baby.carryBy, 'player', 'handoff changes the authoritative owner');
baby.carryBy = null;
const babyCommands = policy.commandOptionsFor(infantWalker);
assert.equal(babyCommands.length, 1, 'newborn wheel offers just one family interaction');
assert.equal(babyCommands[0].id, 'hold_baby');
assert.equal(babyCommands[0].run(), true, 'newborn Hold Baby uses shared burden pickup');
ctx.phaseOf = () => 'toddler';
assert.equal(policy.commandOptionsFor(infantWalker)[0].label, 'Hold Toddler', 'toddlers reuse the shared pickup command');
assert.equal(policy.planFor(baby), null, 'care ends once baby is a toddler');
ctx.phaseOf = () => 'basket'; baby.carryBy = null;
ctx.romance.activeSpouseOuting = () => ({npcId:'spouse1'});
assert.equal(policy.planFor(baby), null, 'committed spouse outing is not stolen by baby care');
assert.equal(persisted, 0, 'policy does not persist on each tick; burden state changes own persistence');
ctx.romance.activeSpouseOuting = () => null;
hour = 19; baby.carryBy = null;
baby.carrySpot = { area: 'farm', c: 11, r: 12 };
parent.area = 'farm'; infantWalker.area = 'farm';
parent.root.position.x = 11.7; parent.root.position.z = 12.5;
infantWalker.root.position.x = 11.5; infantWalker.root.position.z = 12.5;
assert.equal(policy.spouseTarget(parent.rec).area, 'farm', 'caregiver navigates to the actual dropped child');
assert.equal(policy.spouseTarget(parent.rec).c, 11, 'the saved landing tile overrides an empty basket');
policy.tick();
assert.equal(holdingCalls.at(-1), 'arms', 'caregiver can retrieve a child safely dropped on the farm');
console.log('Spouse baby cradle/arms/back care, player handoff and child-stage gates: PASS');

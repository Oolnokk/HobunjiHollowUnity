#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Color {
  constructor(hex = 0) { this.hex = hex; }
  getHSL(target) {
    const r = ((this.hex >> 16) & 255) / 255;
    const g = ((this.hex >> 8) & 255) / 255;
    const b = (this.hex & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    target.l = (max + min) / 2;
    if (max === min) { target.h = target.s = 0; return target; }
    const d = max - min;
    target.s = target.l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) target.h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) target.h = ((b - r) / d + 2) / 6;
    else target.h = ((r - g) / d + 4) / 6;
    return target;
  }
  setHSL(h, s, l) {
    if (s === 0) this.hex = Math.round(l * 255) * 0x010101;
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const channel = t => Math.round((t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p) * 255);
      this.hex = (channel((h + 1 / 3) % 1) << 16) | (channel(h) << 8) | channel((h + 2 / 3) % 1);
    }
    return this;
  }
  getHex() { return this.hex; }
}

const context = { console, performance: { now: () => 0 }, THREE: { Color } };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/config/config.js', 'utf8'), context);
context.SCRATCHBONES_CONFIG = { game: { combat: { resourceSystem: { pukeChancePerSec: 0 } } } }; // Keeps Infected-Stamina handoff checks deterministic.
vm.runInContext(fs.readFileSync('docs/js/combat/resource-system.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/combat/resource-rings.js', 'utf8'), context);

const { ResourceRings, ResourceSystem, HOBUNJI_CONFIG } = context;
const fullEntity = {
  health: 100, maxHealth: 100, stamina: 100, maxStamina: 100,
  footing: 100, maxFooting: 100, exhaustion: { active: false, blackStamina: 100 },
  afflictions: Object.fromEntries(Object.keys(ResourceSystem.AFFLICTIONS).map(id => [id, 0]))
};

for (const key of ['health', 'stamina', 'footing']) {
  assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, key), true, `${key} starts hidden`);
}
fullEntity.health = 99;
assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, 'health'), false);
assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, 'stamina'), true);
assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, 'footing'), true);
fullEntity.health = 100;
fullEntity.afflictions.bleedingHealth = 5;
assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, 'health'), false);
assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, 'stamina'), true);
fullEntity.afflictions.bleedingHealth = 0;
fullEntity.afflictions.woundedStamina = 5;
assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, 'health'), true);
assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, 'stamina'), false);
fullEntity.afflictions.woundedStamina = 0;
fullEntity.exhaustion.active = true;
assert.equal(ResourceRings.isResourceHomeostatic(fullEntity, 'stamina'), false);

const recoveringEntity = { ...fullEntity, stamina: 73, exhaustion: { active: true, blackStamina: 40 }, afflictions: { ...fullEntity.afflictions } }; // Exercises the Exhausted/black-Stamina invariant through both recovery and cap enforcement.
ResourceSystem.tick(recoveringEntity, 0.25, { staminaRegenPerSec: 999 });
assert.ok(recoveringEntity.exhaustion.blackStamina > 40 && recoveringEntity.exhaustion.blackStamina < 100, 'black Stamina advances without clearing Exhausted');
assert.equal(recoveringEntity.stamina, 0, 'regular Stamina stays at zero while black Stamina is recovering');
recoveringEntity.stamina = 55;
ResourceSystem.enforceCaps(recoveringEntity);
assert.equal(recoveringEntity.stamina, 0, 'cap enforcement removes regular Stamina restored by another system while Exhausted');

const clearingEntity = { ...fullEntity, stamina: 88, exhaustion: { active: true, blackStamina: 99 }, afflictions: { ...fullEntity.afflictions } }; // Verifies the handoff from black Stamina recovery back to ordinary Stamina recovery.
ResourceSystem.tick(clearingEntity, 1);
assert.equal(clearingEntity.exhaustion.active, false, 'reaching full black Stamina clears Exhausted');
assert.equal(clearingEntity.exhaustion.blackStamina, 100);
assert.equal(clearingEntity.stamina, 0, 'regular Stamina is empty when black Stamina finishes recovering');
ResourceSystem.tick(clearingEntity, 0.25);
assert.ok(clearingEntity.stamina > 0 && clearingEntity.stamina < clearingEntity.maxStamina, 'ordinary Stamina starts regenerating from zero on the following tick');

const afflictedEntity = {
  health: 100, maxHealth: 100, stamina: 47, maxStamina: 100,
  footing: 100, maxFooting: 100, exhaustion: { active: true, blackStamina: 60 },
  afflictions: Object.fromEntries(Object.keys(ResourceSystem.AFFLICTIONS).map(id => [id, 0])),
}; // Exercises all Stamina-affliction families while Black Stamina owns the live resource channel.
ResourceSystem.initEntity(afflictedEntity);
ResourceSystem.addAffliction(afflictedEntity, 'woundedStamina', 20);
ResourceSystem.addAffliction(afflictedEntity, 'infectedStamina', 15);
ResourceSystem.addAffliction(afflictedEntity, 'shatteredStamina', 10);
ResourceSystem.addAffliction(afflictedEntity, 'windedStamina', 30);
const afflictedBeforeSpend = Object.fromEntries(['woundedStamina','infectedStamina','shatteredStamina','windedStamina'].map(id => [id, ResourceSystem.getAffliction(afflictedEntity, id)]));
ResourceSystem.spendStamina(afflictedEntity, 10, 'black-affliction regression');
assert.equal(afflictedEntity.stamina, 0, 'Black Stamina spending cannot expose a hidden normal-Stamina reserve');
assert.equal(afflictedEntity.exhaustion.blackStamina, 50, 'Exhausted spending drains Black Stamina instead of regular Stamina');
for (const [id, amount] of Object.entries(afflictedBeforeSpend)) {
  assert.equal(ResourceSystem.getAffliction(afflictedEntity, id), amount, `${id} is not consumed by spending Black Stamina`);
}
ResourceSystem.tick(afflictedEntity, 0.25, { staminaRegenPerSec: 999 });
assert.equal(afflictedEntity.stamina, 0, 'regular Stamina remains zero while Black Stamina and Stamina afflictions recover in parallel');
for (const [id, amount] of Object.entries(afflictedBeforeSpend)) {
  assert.ok(ResourceSystem.getAffliction(afflictedEntity, id) < amount, `${id} continues its own passive recovery while Exhausted`);
}
assert.ok(ResourceSystem.getEffectiveMax(afflictedEntity, 'stamina') < afflictedEntity.maxStamina, 'Winded Stamina continues lowering the future normal-Stamina cap while Exhausted');

afflictedEntity.exhaustion.blackStamina = 99;
ResourceSystem.tick(afflictedEntity, 1);
assert.equal(afflictedEntity.exhaustion.active, false, 'Black Stamina can finish recovering while Stamina afflictions remain');
assert.equal(afflictedEntity.stamina, 0, 'the Black-to-regular handoff stays at zero even with active Stamina afflictions');
assert.ok(ResourceSystem.getAffliction(afflictedEntity, 'woundedStamina') > 0, 'Wounded Stamina survives the handoff if it has not recovered naturally');
assert.ok(ResourceSystem.getAffliction(afflictedEntity, 'windedStamina') > 0, 'Winded Stamina survives the handoff and still constrains the regular pool');
ResourceSystem.tick(afflictedEntity, 0.25);
assert.ok(afflictedEntity.stamina > 0 && afflictedEntity.stamina <= ResourceSystem.getEffectiveMax(afflictedEntity, 'stamina'), 'post-handoff regeneration obeys Winded Stamina effective max');

ResourceSystem.removeAffliction(afflictedEntity, 'infectedStamina', 999);
ResourceSystem.removeAffliction(afflictedEntity, 'shatteredStamina', 999);
const staminaBeforeWoundedSpend = afflictedEntity.stamina;
const healthBeforeWoundedSpend = afflictedEntity.health;
ResourceSystem.spendStamina(afflictedEntity, staminaBeforeWoundedSpend, 'wounded handoff regression');
assert.ok(afflictedEntity.health < healthBeforeWoundedSpend, 'regenerated Stamina still triggers surviving Wounded Stamina when spent after the handoff');

const potionHandoffEntity = {
  health: 100, maxHealth: 100, stamina: 55, maxStamina: 100,
  footing: 100, maxFooting: 100, exhaustion: { active: true, blackStamina: 90 },
  afflictions: Object.fromEntries(Object.keys(ResourceSystem.AFFLICTIONS).map(id => [id, 0])),
}; // Mirrors a Stamina Potion finishing debt while Winded Stamina is still active.
ResourceSystem.initEntity(potionHandoffEntity);
ResourceSystem.addAffliction(potionHandoffEntity, 'windedStamina', 30);
const potionRestore = ResourceSystem.restoreStamina(potionHandoffEntity, 34, { exhaustionAmount: 28 });
assert.equal(potionRestore.blackStamina, 10, 'instant Exhaustion restoration only restores the debt that actually exists');
assert.equal(potionHandoffEntity.exhaustion.active, false);
assert.equal(potionHandoffEntity.exhaustion.blackStamina, 100);
assert.equal(potionHandoffEntity.stamina, 0, 'instant Black-Stamina recovery cannot spill into regular Stamina');
const normalRestore = ResourceSystem.restoreStamina(potionHandoffEntity, 100);
assert.equal(normalRestore.stamina, 70, 'later ordinary Stamina restoration respects Winded Stamina effective max');
assert.equal(potionHandoffEntity.stamina, 70);

for (const id of Object.keys(ResourceSystem.AFFLICTIONS)) {
  assert.ok(id in ResourceRings.AFFLICTION_COLORS, `${id} has a resource-ring color`);
}
for (const [id, configured] of Object.entries(HOBUNJI_CONFIG.resourceRings.afflictionColors)) {
  assert.equal(ResourceRings.AFFLICTION_COLORS[id], Number.parseInt(configured.slice(1), 16), `${id} uses its configured color`);
}
assert.equal(ResourceRings.neonizeColor(ResourceRings.AFFLICTION_COLORS.windedStamina), ResourceRings.AFFLICTION_COLORS.windedStamina, 'gray winded color remains gray');
console.log('resource ring visibility and affliction color checks passed');

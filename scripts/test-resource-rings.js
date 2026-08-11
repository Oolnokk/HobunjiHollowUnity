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

for (const id of Object.keys(ResourceSystem.AFFLICTIONS)) {
  assert.ok(id in ResourceRings.AFFLICTION_COLORS, `${id} has a resource-ring color`);
}
for (const [id, configured] of Object.entries(HOBUNJI_CONFIG.resourceRings.afflictionColors)) {
  assert.equal(ResourceRings.AFFLICTION_COLORS[id], Number.parseInt(configured.slice(1), 16), `${id} uses its configured color`);
}
assert.equal(ResourceRings.neonizeColor(ResourceRings.AFFLICTION_COLORS.windedStamina), ResourceRings.AFFLICTION_COLORS.windedStamina, 'gray winded color remains gray');
console.log('resource ring visibility and affliction color checks passed');

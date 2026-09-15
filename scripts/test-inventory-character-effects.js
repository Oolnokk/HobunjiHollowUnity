#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/inventory-character-effects.js', 'utf8');
const compactToolSource = fs.readFileSync('docs/js/inventory-gear-compact-effects.js', 'utf8');
const xControlSource = fs.readFileSync('docs/js/hud-x-control-polish.js', 'utf8');
const dodgeSource = fs.readFileSync('docs/js/combat/combat-blink-dodge.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');

const windowStub = {};
const context = { window: windowStub, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'inventory-character-effects.js' });

const api = windowStub.InventoryCharacterEffects;
assert(api, 'InventoryCharacterEffects exports its runtime API');
assert.equal(api.version, 1, 'character effects module version is available to the bootstrap loader');
assert.match(loaderSource, /inventory-character-effects\.js\?v=20260915a/, 'combat bootstrap loads the character-effects module');
assert.match(loaderSource, /inventory-gear-compact-effects\.js\?v=20260915a/, 'combat bootstrap loads the compact Gear Effects presentation');
assert.match(loaderSource, /hud-x-control-polish\.js\?v=20260915a/, 'combat bootstrap loads shared X-control presentation after generic HUD icons');

// Character effects remain a true two-column presentation instead of falling back to InventoryUI's generic single-column list.
assert.match(
  source,
  /#mpInventory \.gear-character-effects-card \.gear-effects-list \{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/,
  'effects lists retain their authored two-column grid',
);

// The compact Gear module owns the final vertical split: upper loadout gets the remainder while Owned Gear always keeps a visible reserved region.
assert.match(
  compactToolSource,
  /#mpInventory\.inv-mode-gear \.gear-loadout-grid \{[\s\S]*?flex:1 1 auto;[\s\S]*?min-height:0;[\s\S]*?overflow:hidden;/,
  'upper Gear loadout can shrink inside the inventory instead of pushing the lower section away',
);
assert.match(
  compactToolSource,
  /#mpInventory\.inv-mode-gear \.gear-owned-section \{[\s\S]*?flex:0 0 calc\(5\.25 \* var\(--inv-row\)\);[\s\S]*?min-height:calc\(5\.25 \* var\(--inv-row\)\);[\s\S]*?overflow-y:auto;/,
  'Owned Gear always retains a visible lower region and is the scrollable variable-content section',
);

// Tool Effects divides height by content, stacks chips vertically, and measures real rendered overflow before choosing a font size.
assert.match(
  compactToolSource,
  /#mpInventory \.gear-tool-stats > \.gear-stat-list \{[\s\S]*?display:flex !important;[\s\S]*?flex-direction:column !important;[\s\S]*?overflow:hidden !important;/,
  'Tool Effects list is a non-scrolling vertical stack with enough selector strength to beat generic inventory rules',
);
assert.match(
  compactToolSource,
  /#mpInventory \.gear-tool-stats \.gear-stat-item \{[\s\S]*?flex:var\(--gear-tool-card-weight,1\) 1 0;[\s\S]*?min-height:0;[\s\S]*?overflow:hidden;/,
  'Tool Effects cards distribute the available height according to their real content weight',
);
assert.match(
  compactToolSource,
  /#mpInventory \.gear-tool-stats \.gear-stat-chips \{[\s\S]*?flex-direction:column;[\s\S]*?flex-wrap:nowrap;/,
  'mastery, quality, and effect chips stack vertically inside each shortened tool card',
);
assert.match(
  compactToolSource,
  /scrollHeight > card\.clientHeight[\s\S]*?scrollWidth > element\.clientWidth/,
  'font fitting verifies actual rendered vertical and horizontal overflow rather than relying on estimated line counts',
);
assert.match(
  compactToolSource,
  /fitMeasuredFont[\s\S]*?PREFERRED_MIN_FONT_PX[\s\S]*?EMERGENCY_MIN_FONT_PX[\s\S]*?Binary search|Binary search[\s\S]*?fitMeasuredFont/,
  'measured fitting can shrink below the preferred compact size in extreme aspect ratios and then chooses the largest fitting font',
);
assert.match(
  compactToolSource,
  /#mpInventory \.gear-outfit-stats\.gear-character-effects-host \{[\s\S]*?display:flex !important;[\s\S]*?overflow:hidden !important;/,
  'Outfit Effects and Final Values participate in the same bounded orientation-safe upper layout',
);
assert.match(
  compactToolSource,
  /orientationchange[\s\S]*?scheduleFit|resize[\s\S]*?scheduleFit/,
  'mobile portrait/landscape changes explicitly schedule a fresh measured fit',
);

// Generic semantic X glyphs are PNG-backed; their source pixels are black, so the shared control style must whiten them and center common close/unequip buttons.
assert.match(
  xControlSource,
  /\.generic-hud-icon\.generic-hud-icon-x \{[\s\S]*?filter:brightness\(0\) invert\(1\);/,
  'generic X icon art is forced white everywhere it is used',
);
assert.match(xControlSource, /#mpClose/, 'main menu close control receives shared X fitting');
assert.match(xControlSource, /\.ies-unequip/, 'gear unequip/unassign controls receive shared X fitting');
assert.match(
  xControlSource,
  /:has\(> \.generic-hud-icon-x\) \{[\s\S]*?display:inline-grid;[\s\S]*?place-items:center;[\s\S]*?padding:0 !important;/,
  'symbol-only X controls center the icon inside their own button box instead of using text padding',
);

const player = { maxHealth: 100, maxStamina: 80, maxFooting: 50 };
const snapshot = api.__test.composeSnapshot({
  clothing: {
    armorStats: () => ({
      weightUnits: 6,
      damageTakenMul: 0.85,
      footingTakenMul: 0.8,
      dodgeEfficacy: 0.85,
      combatMoveMul: 0.9,
    }),
  },
  skill: {
    attackMultiplier: () => 1.1,
    damageTakenMultiplier: () => 0.9,
  },
  perks: {
    rank: (tree, id) => tree === 'combat' && id === 'increaseFootingResistance' ? 2 : 0,
    combatDamageMultiplier: () => 1.08,
  },
  alchemy: {
    getOutgoingDamageMultiplier: () => 1.2,
    getMovementSpeedMultiplier: () => 1.2,
    getFootingDamageMultiplier: () => 1.5,
    getStaminaSpendMultiplier: () => 0.75,
    getStaminaRegenMultiplier: () => 1.25,
    getHealthRegenMultiplier: () => 1.4,
    getIncomingDamageAfflictionMultiplier: () => 0.7,
    getPositiveFavorMultiplier: () => 1.3,
    getPerceptionMultiplier: () => 1.15,
  },
  cooking: {
    getSpeedMultiplier: () => 1.1,
    getStaminaRegenMultiplier: () => 1.2,
  },
  combat: {
    deps: { player },
    getMovementSpeedMul: () => 0.9,
  },
  resources: {
    getExhaustionSpeed: () => 0.75,
    getEffectiveMax: (_entity, key) => ({ health: 124, stamina: 96, footing: 65 })[key],
  },
  player,
});

assert.equal(snapshot.outfit.weightUnits, 6, 'outfit summary reports the shared total equipped weight');
assert(Math.abs(snapshot.final.damageDealtMul - 1.4256) < 1e-12, 'final outgoing damage composes stats, universal perks, and buffs');
assert(Math.abs(snapshot.final.damageTakenMul - 0.765) < 1e-12, 'final incoming damage composes food/stat mitigation with outfit defense');
assert(Math.abs(snapshot.final.footingTakenMul - 0.672) < 1e-12, 'final Footing damage composes outfit resistance with the perk-owned reduction');
assert(Math.abs(snapshot.final.moveSpeedMul - 1.188) < 1e-12, 'final movement composes food, buff, and Combat-owned movement multipliers');
assert.equal(snapshot.final.attackSpeedMul, 0.75, 'attack speed uses ResourceSystem exhaustion timing when a player exists');
assert.equal(snapshot.final.staminaRegenMul, 1.5, 'Stamina regen composes Cooking and Alchemy recovery multipliers');
assert.equal(snapshot.final.maxHealth, 124, 'stable effective resource maxima stay literal');
assert.equal(snapshot.final.maxStamina, 96, 'stable effective Stamina maximum stays literal');
assert.equal(snapshot.final.maxFooting, 65, 'stable effective Footing maximum stays literal');
assert.equal(snapshot.final.dodgeIframeMs, 323, 'outfit efficacy converts the base 380 ms iframe window to a literal final value');
assert.equal(snapshot.final.dodgeDurationMs, 187, 'outfit efficacy converts the base 220 ms dodge window to a literal final value');

assert.match(dodgeSource, /380 ms invulnerability window/, 'UI iframe baseline remains tied to the ordinary player dodge contract');
assert.match(dodgeSource, /BASE_DODGE_SOMERSAULT_DUR_S = 0\.22/, 'UI dodge-duration baseline remains tied to the ordinary player dodge presentation contract');
assert.deepEqual({ ...api.__test.BASE_DODGE_PROFILE }, { durationS: 0.22, iframeMs: 380 }, 'module exposes its dodge timing baseline for regression tests');

console.log('Inventory character effects tests passed');
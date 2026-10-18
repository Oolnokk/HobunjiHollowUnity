#!/usr/bin/env node
'use strict';

// Regression coverage for the Skyrim-style on-screen resource HUD.
// Run with: node scripts/test-player-vitals-hud.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element(id) {
  const classes = new Set(); // Tracks visibility/exhaustion classes without requiring a browser.
  return {
    id, children: [], textContent: '', style: {}, hidden: true, title: '',
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; },
  };
}

const elements = new Map(); // Provides the exact HUD ids expected by the game's HTML.
elements.set('vitalsBar', element('vitalsBar'));
for (const resource of ['Health', 'Stamina', 'Footing']) {
  for (const part of ['Row', 'Fill', 'Segments', 'Cap']) {
    const id = 'vb' + resource + part; // Matches the existing in-game #vb<resource><part> naming pattern.
    elements.set(id, element(id));
  }
}
const context = {
  console,
  performance: { now: () => 0 },
  document: {
    getElementById: id => elements.get(id) || null,
    createElement: tag => ({ tag, className: '', style: {}, title: '' }),
  },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
// The actual config is loaded in <head> and its optional town-geometry DOM hooks
// must not run in this intentionally Three.js-free HUD unit test.
const hudDocument = context.document; // Restored after config initialization for the HUD renderer.
delete context.document;
vm.runInContext(fs.readFileSync('docs/config/config.js', 'utf8'), context, { filename: 'docs/config/config.js' });
context.document = hudDocument;
for (const path of ['docs/js/combat/resource-system.js', 'docs/js/player-vitals.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
}

const player = {
  health: 100, maxHealth: 100, stamina: 100, maxStamina: 100,
  footing: 100, maxFooting: 100,
  exhaustion: { active: false, blackStamina: 100 },
  afflictions: {},
}; // The local player injected into PlayerVitals and used by ResourceSystem capacity logic.
context.Combat = { deps: { player } };
context.ResourceSystem.initEntity(player);
context.PlayerVitals.init({ player });
const refresh = () => context.PlayerVitals.refreshVitalsHud(); // Invokes the game's actual DOM renderer without ticking time.
const shown = id => elements.get(id).classList.contains('is-active'); // Checks per-resource HUD visibility.
const bar = id => elements.get('vb' + id + 'Fill'); // Reads displayed width from the actual row fill.

refresh();
assert.equal(shown('vitalsBar'), false, 'at full and unafflicted the entire HUD is hidden');
player.health = 49;
refresh();
assert.equal(shown('vitalsBar'), true);
assert.equal(shown('vbHealthRow'), true, 'damaged Health is visible');
assert.equal(shown('vbStaminaRow'), false, 'full Stamina stays hidden when Health is damaged');
assert.equal(shown('vbFootingRow'), false, 'full Footing stays hidden');
assert.equal(bar('Health').style.width, '49%');

player.health = 100;
player.afflictions.bleedingHealth = 40;
player.afflictions.bruisedHealth = 20;
refresh();
assert.equal(shown('vbHealthRow'), true, 'a full but afflicted resource is visible');
assert.equal(elements.get('vbHealthSegments').children.length, 1, 'priority clips the lower-priority overlapping affliction');
assert.equal(elements.get('vbHealthSegments').children[0].style.backgroundColor,
  context.HOBUNJI_CONFIG.resourceRings.afflictionColors.bleedingHealth, 'uses the shared resource-ring palette');
player.afflictions.bleedingHealth = 0;
refresh();
assert.equal(elements.get('vbHealthSegments').children.length, 1, 'lower-priority affliction becomes visible after strong one clears');
player.afflictions.bruisedHealth = 0;

player.afflictions.congealedHealth = 30;
player.health = 70;
refresh();
assert.equal(elements.get('vbHealthCap').hidden, false, 'lost effective maximum receives a distinct hatched region');
assert.equal(elements.get('vbHealthCap').style.left, '70.0%');
player.afflictions.congealedHealth = 0;
player.health = 100;

player.stamina = 0;
player.exhaustion.active = true;
player.exhaustion.blackStamina = 57;
refresh();
assert.equal(shown('vbStaminaRow'), true, 'exhaustion is never homeostatic');
assert.equal(bar('Stamina').style.width, '57%', 'exhaustion displays black-Stamina recovery rather than normal Stamina');
assert.equal(elements.get('vbStaminaRow').title, 'Stamina: Exhausted 57%');
assert.equal(elements.get('vbStaminaSegments').children.length, 0, 'exhausted bands do not show ordinary affliction colors');
player.exhaustion.active = false;
player.stamina = 100;

player.footing = 75;
refresh();
assert.equal(shown('vbFootingRow'), true);
assert.equal(shown('vbHealthRow'), false);
player.footing = 100;
refresh();
assert.equal(shown('vitalsBar'), false, 'HUD disappears again on full unafflicted recovery');

// A temporary Stamina-capacity buff should expose unfilled capacity even at the old maximum.
context.AlchemySystem = { getMaxStaminaMultiplier: () => 1.25 }; // Simulates Endurance against the live getEffectiveMax multiplier API.
refresh();
assert.equal(shown('vbStaminaRow'), true, 'a buffed maximum reveals the unfilled portion of Stamina');
assert.equal(bar('Stamina').style.width, '80%', 'buffed capacity denominator is respected');
context.AlchemySystem = null;
refresh();
assert.equal(shown('vbStaminaRow'), false, 'the Stamina bar disappears when the bonus ends');

player.afflictions.shamblingFooting = 30;
refresh();
assert.equal(shown('vbFootingRow'), true, 'Footing afflictions also reveal their bar at full displayed points');
assert.equal(elements.get('vbFootingSegments').children.length, 1);
assert.equal(context.PlayerVitals.getDebug().hud.rows.footing.afflictionSegments, 1, 'mobile-readable debug snapshot includes HUD state');

const html = fs.readFileSync('docs/index.html', 'utf8');
const css = fs.readFileSync('docs/style.css', 'utf8');
const hudHtml = html.slice(html.indexOf('<div id="vitalsBar"'), html.indexOf('<!-- Active alchemy buffs/'));
assert(!/class="vb-(icon|label|value)"/.test(hudHtml), 'HUD contains no visible icon, label or numeric text');
assert(css.includes('border: 2px solid #000'), 'resource tracks use black outlines');
assert(css.slice(css.indexOf('/* ── Minimal bottom resource bars'), css.indexOf('/* Keep desktop resource bars')).includes('background: transparent'), 'HUD root has no visible panel');
console.log('player vitals HUD tests passed');

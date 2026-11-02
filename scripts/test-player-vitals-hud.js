#!/usr/bin/env node
'use strict';

// Regression coverage for the Skyrim-style on-screen resource HUD.
// Run with: node scripts/test-player-vitals-hud.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element(id) {
  const classes = new Set();
  const attributes = {};
  return {
    id, children: [], textContent: '', style: {}, hidden: true, title: '',
    classList: {
      add(...items) { for (const item of items) classes.add(item); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { attributes[name] = String(value); this[name] = String(value); },
    getAttribute(name) { return attributes[name] ?? null; },
  };
}

const elements = new Map(); // Provides the exact HUD ids expected by the game's HTML.
elements.set('vitalsBar', element('vitalsBar'));
for (const resource of ['Health', 'Stamina', 'Footing']) {
  for (const part of ['Row', 'Fill', 'Segments', 'Normal', 'Cap']) {
    const id = 'vb' + resource + part; // Matches the existing in-game #vb<resource><part> naming pattern.
    elements.set(id, element(id));
  }
}
const context = {
  console,
  performance: { now: () => 0 },
  document: {
    getElementById: id => elements.get(id) || null,
    createElement: tag => element(tag),
    createElementNS: (_namespace, tag) => element(tag),
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
assert.equal(elements.get('vbHealthNormal').children.length, 1, 'ordinary fill receives its own straight-outlined span');
assert.equal(elements.get('vbHealthNormal').children[0].style.width, '49.0%', 'ordinary span follows current Health');

player.health = 100;
player.afflictions.bleedingHealth = 40;
player.afflictions.bruisedHealth = 20;
refresh();
assert.equal(shown('vbHealthRow'), true, 'a full but afflicted resource is visible');
assert.equal(elements.get('vbHealthSegments').children.length, 1, 'priority clips the lower-priority overlapping affliction');
assert.equal(elements.get('vbHealthSegments').children[0].style.color,
  context.HOBUNJI_CONFIG.resourceRings.afflictionColors.bleedingHealth, 'drips inherit the shared resource-ring palette');
assert.equal(elements.get('vbHealthSegments').children[0].style.backgroundColor, 'transparent', 'deforming liquid bottom owns the entire outline');
assert.equal(elements.get('vbHealthSegments').children[0].children[0].id, 'svg', 'dripping bands have live SVG bottom edges');
const dripMotion = elements.get('vbHealthSegments').children[0].children[0].children[1].children[0];
assert.equal(dripMotion.id, 'animate', 'SVG morphs the bottom edge instead of overlaying it');
assert.equal(dripMotion.getAttribute('attributeName'), 'd');
assert.equal(dripMotion.getAttribute('repeatCount'), 'indefinite');
assert.equal(elements.get('vbHealthNormal').children.length, 1, 'underlying ordinary fill is separated from the affliction');
assert.equal(elements.get('vbHealthNormal').children[0].style.width, '60.0%', 'ordinary top and bottom borders stop before the bleeding interval');
const bleedingSpan = elements.get('vbHealthSegments').children[0];
assert(bleedingSpan.className.includes('vb-effect-drip'), 'bleeding shows falling drops');
player.afflictions.bleedingHealth = 38;
refresh();
assert.equal(elements.get('vbHealthSegments').children[0], bleedingSpan, 'CSS animations survive frequent affliction-value updates');
player.afflictions.bleedingHealth = 0;
refresh();
assert.equal(elements.get('vbHealthSegments').children.length, 1, 'lower-priority affliction becomes visible after strong one clears');
const bruisedSpan = elements.get('vbHealthSegments').children[0];
assert(bruisedSpan.className.includes('vb-effect-brittle'), 'bruising gets a real jagged path');
assert.equal(bruisedSpan.style.backgroundColor, 'transparent', 'rectangular band replaced by actual silhouette');
assert.equal(bruisedSpan.children[0].id, 'svg', 'inline SVG renders the bar mesh');
const bruisePath = bruisedSpan.children[0].children[1].getAttribute('d');
assert(bruisePath.includes('L') && bruisePath.includes('Z'), 'closed jagged outline path');
const topInset = [...bruisePath.matchAll(/L [\d.]+ ([\d.]+)/g)].map(match => +match[1]);
assert(topInset.some(y => y >= 5 && y <= 8), 'inward cuts are halved to 12.5-20% of path height');
player.afflictions.bruisedHealth = 17;
refresh();
assert.equal(elements.get('vbHealthSegments').children[0], bruisedSpan, 'jagged mesh remains stable across frames');
assert.equal(bruisedSpan.children[0].children[1].getAttribute('d'), bruisePath, 'vertices do not reroll as the segment shrinks');
player.afflictions.bruisedHealth = 0;

player.afflictions.congealedHealth = 30;
player.health = 70;
refresh();
assert.equal(elements.get('vbHealthCap').hidden, false, 'lost effective maximum receives a distinct hatched region');
assert.equal(elements.get('vbHealthCap').style.left, '70.0%');
const congealedCap = elements.get('vbHealthCap');
assert.equal(congealedCap.classList.contains('is-withered'), true, 'capacity damage creates a starved outline');
assert.equal(congealedCap.children[0].id, 'svg', 'cap draws with a real SVG');
const congealedShape = congealedCap.children[0].children[1].getAttribute('d');
assert(congealedShape.includes(' C ') && congealedShape.includes(' L '), 'cap is a smooth spline with a flat central section');
assert.equal(congealedCap.children[0].children[1].getAttribute('fill'), context.HOBUNJI_CONFIG.resourceRings.afflictionColors.congealedHealth, 'withered cap retains its affliction color');
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

// When the buffed pool has recovered past its authored maximum, currentBack
// afflictions must follow the live current edge instead of leaving normal fill
// stranded on both sides of the afflicted segment.
player.stamina = 120;
player.afflictions.furiousStamina = 26;
refresh();
const buffedFurious = elements.get('vbStaminaSegments').children.find(span => span.title === 'Furious Stamina'); // The currentBack segment under test.
assert.equal(buffedFurious.style.left, '75.2%', 'Furious Stamina is rebased to the recovered current edge');
assert.equal(buffedFurious.style.width, '20.8%', 'Furious Stamina retains its full point width on the expanded scale');
const buffedNormal = elements.get('vbStaminaNormal').children; // Ordinary fill should end where Furious Stamina begins.
assert.equal(buffedNormal.length, 1, 'ordinary Stamina is not split onto both sides of Furious Stamina');
assert.equal(buffedNormal[0].style.width, '75.2%', 'ordinary Stamina ends at the rebased affliction start');
player.afflictions.furiousStamina = 0;
player.stamina = 100;
context.AlchemySystem = null;
refresh();
assert.equal(shown('vbStaminaRow'), false, 'the Stamina bar disappears when the bonus ends');

player.afflictions.windedStamina = 25;
player.stamina = 75;
refresh();
assert.equal(elements.get('vbStaminaCap').classList.contains('is-withered'), true, 'winded Stamina shows withered capacity');
const windedSpan = elements.get('vbStaminaSegments').children.find(span => span.title === 'Winded Stamina');
assert(windedSpan?.className.includes('vb-effect-starved'), 'flasker Winding affliction uses a genuinely pinched band');
assert.equal(windedSpan.style.backgroundColor, 'transparent', 'starved band draws the SVG fill rather than a rectangular fill');
assert.equal(windedSpan.children[0].id, 'svg', 'starved band owns an inline SVG');
assert.equal(windedSpan.children[0].children[1].getAttribute('d'), congealedShape, 'band uses the same one-third-height starved spline as the missing cap');
player.afflictions.windedStamina = 0;
player.stamina = 100;
player.afflictions.poisonedHealth = 20;
player.health = 90;
refresh();
assert(elements.get('vbHealthSegments').children[0].className.includes('vb-effect-poison'), 'poison uses slower colored droplets');
player.afflictions.poisonedHealth = 0;
player.health = 100;
player.afflictions.infectedStamina = 15;
player.stamina = 85;
refresh();
assert(elements.get('vbStaminaSegments').children[0].className.includes('vb-effect-brittle'), 'infected Stamina warns of conditional damage');
player.afflictions.infectedStamina = 0;
player.stamina = 100;
player.afflictions.shamblingFooting = 30;
refresh();
assert.equal(shown('vbFootingRow'), true, 'Footing afflictions also reveal their bar at full displayed points');
assert.equal(elements.get('vbFootingSegments').children.length, 1);
assert.equal(context.PlayerVitals.getDebug().hud.rows.footing.afflictionSegments, 1, 'mobile-readable debug snapshot includes HUD state');

// Enhanced resource visuals are driven by actual transaction metadata, not
// one-off names: rapid attacks swell, efficient resources have crenellations.
player.afflictions.shamblingFooting = 0;
player.afflictions.furiousStamina = 26;
refresh();
const furious = elements.get('vbStaminaSegments').children.find(span => span.title === 'Furious Stamina');
assert(furious?.className.includes('vb-effect-balloon'), 'Furious Stamina swells from tempoMultiplier');
assert.equal(furious.style.backgroundColor, 'transparent', 'balloon has genuine deforming SVG silhouette');
assert.equal(furious.children[0].id, 'svg');
assert.equal(furious.children[0].children[1].children[0].id, 'animate', 'balloon animates SVG outline without game-frame work');
assert.equal(furious.children[0].children[1].children[0].getAttribute('attributeName'), 'd');
player.afflictions.furiousStamina = 23;
refresh();
assert.equal(elements.get('vbStaminaSegments').children.find(span => span.title === 'Furious Stamina'), furious, 'balloon node retained as amount changes');
player.afflictions.furiousStamina = 0;

player.afflictions.moralizedStamina = 31;
refresh();
const moralized = elements.get('vbStaminaSegments').children.find(span => span.title === 'Moralized Stamina');
assert(moralized?.className.includes('vb-effect-crenellated'), '3-for-1 Stamina uses generic efficient-resource crenels');
const battlement = moralized.children[0].children[1].getAttribute('d');
assert(battlement.includes(' -4') && battlement.includes(' 4') && battlement.includes(' 44') && battlement.includes(' 36'), 'castle outline alternates slight outward and inward ledges');
player.afflictions.moralizedStamina = 24;
refresh();
assert.equal(moralized.children[0].children[1].getAttribute('d'), battlement, 'crenellation mesh is stable while draining');
player.afflictions.moralizedStamina = 0;

player.afflictions.resoluteHealth = 21;
refresh();
assert(elements.get('vbHealthSegments').children.some(span => span.className.includes('vb-effect-crenellated')), '3-for-1 Health damage absorption reuses crenels');
player.afflictions.resoluteHealth = 0;

player.afflictions.resoluteFooting = 28;
refresh();
assert(elements.get('vbFootingSegments').children.some(span => span.className.includes('vb-effect-crenellated')), '3-for-1 Footing damage absorption reuses crenels');
player.afflictions.resoluteFooting = 0;

// A future two-for-one resource must inherit the same motif with no new CSS.
context.ResourceSystem.AFFLICTIONS.futureEfficientHealth = {
  name: 'Future Efficient Health', resource: 'health', extend: 'currentBack',
  priority: 200, enhanced: true, tags: ['enhanced'],
};
context.ResourceSystem.ENHANCED_RESOURCE_DEFS = {
  ...context.ResourceSystem.ENHANCED_RESOURCE_DEFS,
  futureEfficientHealth: { resource: 'health', conversionRate: 2 },
};
player.afflictions.futureEfficientHealth = 14;
refresh();
assert(elements.get('vbHealthSegments').children.some(span =>
  span.title === 'Future Efficient Health' && span.className.includes('vb-effect-crenellated')),
  'future two-for-one resources automatically receive crenellations');
player.afflictions.futureEfficientHealth = 0;
delete context.ResourceSystem.AFFLICTIONS.futureEfficientHealth;
delete context.ResourceSystem.ENHANCED_RESOURCE_DEFS.futureEfficientHealth;

player.afflictions.mirroredHealth = 16;
refresh();
assert(elements.get('vbHealthSegments').children.some(span => span.className.includes('vb-effect-mirror')), 'one-for-one reflected health uses shine, not crenels');
player.afflictions.mirroredHealth = 0;
for (const [id, klass] of [
  ['burningHealth', 'fire'],
  ['kindlingHealth', 'ember'],
  ['entrancedHealth', 'entranced'],
]) {
  player.afflictions[id] = 12;
  refresh();
  assert(elements.get('vbHealthSegments').children.some(span => span.className.includes('vb-effect-' + klass)),
    id + ' has its behavioral overlay');
  player.afflictions[id] = 0;
}
refresh();

const html = fs.readFileSync('docs/index.html', 'utf8');
const css = fs.readFileSync('docs/style.css', 'utf8');
const compendium = fs.readFileSync('docs/js/compendium-ui.js', 'utf8');
const rings = fs.readFileSync('docs/js/combat/resource-rings.js', 'utf8');
assert.equal(context.HOBUNJI_CONFIG.resourceRings.colors.health, '#55d76f', 'Health remains green');
assert.equal(context.HOBUNJI_CONFIG.resourceRings.colors.stamina, '#d9a441', 'Stamina takes the former Footing yellow-gold');
assert.equal(context.HOBUNJI_CONFIG.resourceRings.colors.footing, '#67b7ff', 'Footing takes the former Stamina sky blue');
assert(css.includes('.vb-stamina { background-color: #d9a441; }'), 'HUD CSS fallback Stamina color agrees with the config');
assert(css.includes('.vb-footing { background-color: #67b7ff; }'), 'HUD CSS fallback Footing color agrees with the config');
assert(rings.includes('parseCssColor(ringConfig.colors.stamina') && rings.includes('parseCssColor(ringConfig.colors.footing'), 'world rings use the same shared palette');
assert(compendium.includes('iconColor: ringColors.stamina') && compendium.includes('iconColor: ringColors.footing'), 'Compendium resource colors come from the same shared config');
assert(compendium.includes('yellow-gold Stamina') && compendium.includes('light-blue Footing'), 'Compendium describes the swapped colors');
assert(compendium.includes("definition?.resource === 'footing' ? '⬡'"), 'Compendium gives Footing afflictions their own icon');
const hudHtml = html.slice(html.indexOf('<div id="vitalsBar"'), html.indexOf('<!-- Active alchemy buffs/'));
assert(!/class="vb-(icon|label|value)"/.test(hudHtml), 'HUD contains no visible icon, label or numeric text');
assert(css.includes('border-left: .556dvh solid #000') && css.includes('border-top: 0'), 'track retains only its left/right endcaps');
assert(css.includes('#vitalsBar .vb-normal-segment'), 'normal resource sections own their straight outline');
assert.equal(context.HOBUNJI_CONFIG.resourceRings.afflictionColors.corrodedHealth, '#c8cf2a', 'Corroded Health palette is shared');
assert.equal(context.HOBUNJI_CONFIG.resourceRings.afflictionColors.woundedHealth, '#8b3f64', 'Wounded Health no longer defaults to white');
assert.equal(context.HOBUNJI_CONFIG.resourceRings.afflictionColors.scentMarkedHealth, '#7dbb69', 'Scent-marked Health has its own palette');
// Corroded Health normally registers in combat-corroded-health.js after ResourceSystem.
context.ResourceSystem.AFFLICTIONS.corrodedHealth = {
  name: 'Corroded Health', resource: 'health', extend: 'currentBack', priority: 75, recovers: false,
};
player.afflictions.corrodedHealth = 13;
player.health = 87;
refresh();
assert(elements.get('vbHealthSegments').children.some(span => span.className.includes('vb-effect-brittle')), 'Corroded Health is brittle like Bruised Health');
player.afflictions.corrodedHealth = 0;
player.health = 100;
assert(css.includes('border: max(1px, .14dvh) solid #000'), 'droplets have their own black outlines');
assert(css.includes('translate3d(0, 9.5dvh, 0)'), 'faster droplets still cross lower resource rows');
assert(css.includes('#vbHealthRow { z-index: 30; }'), 'upper bar paints its droplets over the bars below it');
assert(css.includes('vb-fluid-drop 1.45s linear infinite'), 'droplets fall constantly on a fast loop');
assert(css.includes('animation-delay: -.725s'), 'drip emitters stagger by half a cycle');
assert.equal(bleedingSpan.children[0].children[1].children[0].getAttribute('dur'), '1.45s', 'SVG neck follows the faster droplet cycle');
assert(congealedShape.includes('13.33') && congealedShape.includes('26.67'), 'starved throat is one-third of normal height');
assert(css.includes('height: 2.29dvh') && css.includes('width: 27.78vw') && css.includes('width: 81.25vw'), 'bar width and height are viewport percentages');
assert(css.includes('bottom: max(2.2dvh, env(safe-area-inset-bottom))'), 'bar hugs viewport safe-area bottom');
assert(css.includes('.vb-shape-svg'), 'actual inline SVG silhouette styling exists');
assert(css.includes('.vb-effect-balloon') && css.includes('.vb-effect-crenellated'), 'enhanced silhouettes hide old rectangular borders');
assert(css.includes('.vb-effect-mirror::after'), 'mirror reflection visual is present');
assert(css.includes('.vb-effect-fire::after') && css.includes('.vb-effect-ember::after') && css.includes('.vb-effect-entranced::after'), 'remaining damaging/control effects have semantic overlays');
assert(!css.includes('.vb-effect-brittle::before'), 'old fake chip slashes are gone');
assert(!css.includes('clip-path: polygon('), 'starved cap no longer clips a rectangular border');
assert(css.slice(css.indexOf('/* ── Player-only resource bars'), css.indexOf('/* ── Buff bar: active timed effects')).includes('background: transparent'), 'HUD root has no visible panel');
console.log('player vitals HUD tests passed');

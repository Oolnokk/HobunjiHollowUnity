'use strict';

const assert = require('node:assert/strict'); // Used for lightweight source-level regression assertions.
const fs = require('node:fs'); // Used to read the runtime and bootstrap sources exactly as shipped.

const source = fs.readFileSync('docs/js/generic-hud-icons.js', 'utf8'); // Used to pin icon substitution and rapport-popup behavior.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Used to pin parser-blocking load order before game initialization.

assert.match(source, /icon_heart\.png/, 'heart glyphs must use icon_heart.png');
assert.match(source, /icon_exclamation\.png/, 'exclamation emoji must use the checked-in icon_exclamation.png filename');
assert.match(source, /icon_question\.png/, 'question emoji must use icon_question.png');
assert.match(source, /icon_x\.png/, 'X controls must use icon_x.png');
assert.match(source, /❤️\|❤\|♥️\?\|💜\|🖤\|🤍/, 'all relationship-heart emoji variants must be intercepted');
assert.match(source, /❗\|❓\|❌\|✖️\?\|✕/, 'exclamation, question, and X emoji/symbol variants must be intercepted');
assert.match(source, /RELATIONSHIPS_TAB_SELECTOR = '\[data-mpanel="relationships"\]'/, 'Relationships tab must be targeted directly');
assert.match(source, /tab\.textContent = '';[\s\S]*relationships-tab-heart/, 'Relationships tab must contain only the heart icon');
assert.match(source, /element\.textContent\.trim\(\) !== '×'/, 'plain multiplication-sign controls must be classified before replacement');
assert.match(source, /X_CONTROL_HINT = \/\(close\|cancel\|delete\|remove\|unequip\|unassign\|dismiss\|clear\)/, '× replacement must be limited to semantic X controls');
assert.match(source, /entry\?\.type !== 'rapport'/, 'rapport visuals must observe the centralized applied-delta memory event');
assert.match(source, /Number\.isFinite\(amount\) && amount > 0/, 'only positive applied rapport deltas should produce hearts');
assert.match(source, /api\.showRapportGain = \(root, amount\) => spawnRapportPopup\(root, amount\)/, 'rapport gains must be owned by WorldPopupText');
assert.match(source, /renderOrder = RAPPORT_RENDER_ORDER/, 'rapport popup must share the world-text overlay render band');
assert.match(source, /depthTest: false, depthWrite: false/, 'rapport popup must remain outside depth/shell occlusion like other world popup text');
assert.match(source, /window\.__genericHudIconsDebug = debugSnapshot/, 'mobile-safe runtime diagnostics must remain exposed');

const socialIndex = loader.indexOf('npc-social-relationship-bridge-v2.js'); // Used to verify the rapport source exists before the icon observer installs.
const iconIndex = loader.indexOf('generic-hud-icons.js'); // Used to verify the icon extension installs before later social runtime modules.
const seatingIndex = loader.indexOf('npc-social-seating-bridge.js'); // Used as the expected module immediately following the icon extension.
assert(socialIndex >= 0 && iconIndex > socialIndex && seatingIndex > iconIndex, 'generic HUD icons must load after Rapport and before social seating');

console.log('generic HUD icon + rapport popup regression checks passed');

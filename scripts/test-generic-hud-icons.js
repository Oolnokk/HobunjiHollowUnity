'use strict';

const assert = require('node:assert/strict'); // Used for lightweight source-level regression assertions.
const fs = require('node:fs'); // Used to read the runtime and bootstrap sources exactly as shipped.

const source = fs.readFileSync('docs/js/generic-hud-icons.js', 'utf8'); // Used to pin icon substitution and rapport-popup behavior.
const menuTabs = fs.readFileSync('docs/js/menu-tab-icon-only.js', 'utf8'); // Used to pin icon-only main menu tabs and the Relationships glow.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Used to pin parser-blocking load order before game initialization.

assert.doesNotThrow(() => new Function(menuTabs), 'icon-only menu tab presentation must parse');
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
assert.match(source, /RAPPORT_HEART_COLOR = '#ffd84d'/, 'Rapport gain hearts must use their own yellow tint instead of normal heart colors');
assert.match(source, /tintHeartCanvas\(image, RAPPORT_HEART_COLOR, iconSize\)/, 'the Rapport popup heart must actually use the yellow-only tint');
assert.match(source, /context\.fillStyle = RAPPORT_COLOR;[\s\S]*context\.fillText\(label/, 'the Rapport +number label should remain pink while only the heart turns yellow');
assert.match(source, /api\.showRapportGain = \(root, amount\) => spawnRapportPopup\(root, amount\)/, 'rapport gains must be owned by WorldPopupText');
assert.match(source, /renderOrder = RAPPORT_RENDER_ORDER/, 'rapport popup must share the world-text overlay render band');
assert.match(source, /depthTest: false, depthWrite: false/, 'rapport popup must remain outside depth/shell occlusion like other world popup text');
assert.match(source, /window\.__genericHudIconsDebug = debugSnapshot/, 'mobile-safe runtime diagnostics must remain exposed');

assert.match(menuTabs, /TAB_SELECTOR = '\.mp-tabs \.mp-tab\[data-mpanel\]'/, 'all main menu tabs must be targeted as one presentation group');
assert.match(menuTabs, /tab\.textContent = '';[\s\S]*tab\.appendChild\(makeGlyphNode\(glyph\)\)/, 'non-relationship menu tabs must retain only their existing leading icon');
assert.match(menuTabs, /tab\.setAttribute\('aria-label', label\)/, 'removed visible tab labels must remain available to assistive UI');
assert.match(menuTabs, /drop-shadow\(0 0 2px rgba\(255, 113, 143, \.76\)\)[\s\S]*drop-shadow\(0 0 6px rgba\(255, 113, 143, \.34\)\)/, 'Relationships heart must have a soft two-stage pink glow');
assert.match(menuTabs, /window\.__menuTabIconsDebug = debugSnapshot/, 'icon-only tab presentation must expose mobile-safe diagnostics');

const socialIndex = loader.indexOf('npc-social-relationship-bridge-v2.js'); // Used to verify the rapport source exists before the icon observer installs.
const iconIndex = loader.indexOf('generic-hud-icons.js'); // Used to verify generic icon replacement installs before tab presentation.
const menuTabIndex = loader.indexOf('menu-tab-icon-only.js'); // Used to verify icon-only tabs run after the Relationships PNG heart exists.
const seatingIndex = loader.indexOf('npc-social-seating-bridge.js'); // Used as the expected social module after these HUD presentation adapters.
assert(socialIndex >= 0 && iconIndex > socialIndex && menuTabIndex > iconIndex && seatingIndex > menuTabIndex, 'menu tab presentation must load after generic HUD icons and before social seating');

console.log('generic HUD icon + rapport popup + icon-only menu tab regression checks passed');

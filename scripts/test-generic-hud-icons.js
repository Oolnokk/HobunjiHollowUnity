'use strict';

const assert = require('node:assert/strict'); // Used for lightweight source-level regression assertions.
const fs = require('node:fs'); // Used to read the runtime and bootstrap sources exactly as shipped.

const source = fs.readFileSync('docs/js/generic-hud-icons.js', 'utf8'); // Used to pin icon substitution and relationship-popup behavior.
const social = fs.readFileSync('docs/js/npc-social-relationship-bridge-v2.js', 'utf8'); // Used to pin gifts to permanent Favor rather than temporary Rapport.
const menuTabs = fs.readFileSync('docs/js/menu-tab-icon-only.js', 'utf8'); // Used to pin icon-only main menu tabs, shared gananji presentation, and the Relationships glow.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Used to pin the persistent HUD amount/suffix nodes consumed by the shared currency presenter.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Used to pin parser-blocking load order before game initialization.

assert.doesNotThrow(() => new Function(source), 'generic relationship popup/icon runtime must parse');
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
assert.match(source, /RAPPORT_HEART_COLOR = '#ffd84d'/, 'Rapport changes must use a yellow heart');
assert.match(source, /FAVOR_HEART_COLOR = '#ff8fbd'/, 'Favor changes must use an explicitly pink heart distinct from loss red');
assert.match(source, /RELATIONSHIP_GAIN_COLOR = '#66d96f'/, 'positive relationship deltas must use green numbers');
assert.match(source, /RELATIONSHIP_LOSS_COLOR = '#ff5b5b'/, 'negative relationship deltas must use red numbers');
assert.match(source, /amount > 0 \? RELATIONSHIP_GAIN_COLOR : RELATIONSHIP_LOSS_COLOR/, 'number color must be determined only by change direction');
assert.match(source, /kind === 'favor' \? FAVOR_HEART_COLOR : RAPPORT_HEART_COLOR/, 'heart color must be determined only by relationship value');
assert.match(source, /entry\?\.type !== 'rapport'/, 'Rapport visuals must observe the centralized applied-delta memory event');
assert.match(source, /Number\.isFinite\(amount\) && amount !== 0/, 'both Rapport gains and losses must produce signed popups');
assert.match(source, /installFavorObserver\(\)/, 'Favor changes must install a popup observer');
assert.match(source, /dialogue\.adjustNpcFavor = function genericHudFavorAdjust/, 'Favor popup observer must wrap the authoritative Favor mutation API');
assert.match(source, /after - before/, 'Favor popup must show the actual applied delta after clamping');
assert.match(source, /showFavorChange\(id, applied\)/, 'actual Favor changes must route through the shared relationship popup');
assert.match(source, /api\.showRelationshipChange = \(root, kind, amount\) => spawnRelationshipPopup\(root, kind, amount\)/, 'Rapport and Favor must share the WorldPopupText relationship renderer');
assert.match(source, /renderOrder = RELATIONSHIP_RENDER_ORDER/, 'relationship popup must share the world-text overlay render band');
assert.match(source, /depthTest: false, depthWrite: false/, 'relationship popup must remain outside depth/shell occlusion like other world popup text');
assert.match(source, /window\.__genericHudIconsDebug = debugSnapshot/, 'mobile-safe runtime diagnostics must remain exposed');
assert.doesNotMatch(social, /adjust\(id, giftDelta/, 'gift reactions must no longer be diverted into temporary Rapport');
assert.match(social, /Existing gift code remains authoritative for its authored permanent Favor delta and reaction/, 'daily gift wrapper must preserve authored Favor handling');

assert.match(menuTabs, /TAB_SELECTOR = '\.mp-tabs \.mp-tab\[data-mpanel\]'/, 'all main menu tabs must be targeted as one presentation group');
assert.match(menuTabs, /tab\.replaceChildren\(makeGlyphNode\(glyph\)\)/, 'non-relationship menu tabs must retain only their existing leading icon');
assert.match(menuTabs, /CURRENCY_ICON_FILE = 'icon_bronzecurrency\.png'/, 'gananji currency presentation must use icon_bronzecurrency.png while the Tankanscript glyph metrics are being corrected');
assert.match(menuTabs, /CURRENCY_VERDIGRIS_COLOR = '#6fae9b'/, 'menu and gameplay HUD gananji amounts and symbols must share the bronze-verdigris color');
assert.match(menuTabs, /CURRENCY_ICON_SCALE = 0\.7667/, 'currency artwork must be 15 percent larger than the previous two-thirds scale');
assert.match(menuTabs, /align-items: flex-end;[\s\S]*justify-content: flex-start;/, 'currency symbols must anchor to the bottom-left of their 1em character spaces');
assert.match(menuTabs, /width: \$\{CURRENCY_ICON_SCALE\}em;[\s\S]*height: \$\{CURRENCY_ICON_SCALE\}em;/, 'menu and gameplay HUD must share the same currency artwork scale');
assert.match(menuTabs, /#mpInventory \.inv-wallet-amount,[\s\S]*\$\{HUD_GOLD_AMOUNT_SELECTOR\}[\s\S]*color: \$\{CURRENCY_VERDIGRIS_COLOR\} !important;/, 'wallet and persistent HUD numbers must share the same verdigris color');
assert.match(menuTabs, /HUD_GOLD_SELECTOR = '#spGold'/, 'persistent gameplay HUD currency must use the existing spGold host');
assert.match(menuTabs, /HUD_SUFFIX_SELECTOR = '#spGold \.sb-gold-suffix'/, 'persistent gameplay HUD currency must reuse its authored suffix character space');
assert.match(menuTabs, /hud\.replaceChildren\(hudGoldAmountNode, suffix\)/, 'persistent HUD must render the amount followed by the bronze currency symbol');
assert.match(menuTabs, /hudGoldAmountNode = hud\.querySelector\(HUD_GOLD_AMOUNT_SELECTOR\)/, 'shared HUD currency presentation must preserve the existing live amount node');
assert.match(menuTabs, /new MutationObserver\(\(\) => applyHudCurrencyPresentation\(\)\)/, 'legacy full-text HUD rewrites must be repaired only when the HUD DOM changes');
assert.match(menuTabs, /walletCurrencyIconPresent/, 'wallet currency icon state must remain available in mobile-safe diagnostics');
assert.match(menuTabs, /hudCurrencyIconPresent/, 'persistent HUD currency icon state must be available in mobile-safe diagnostics');
assert.match(index, /id="spGoldAmount"/, 'persistent HUD must expose the live amount node used by hud-update.js');
assert.match(index, /class="sb-gold-suffix"/, 'persistent HUD must expose a suffix character-space host for the shared currency artwork');
assert.match(menuTabs, /tab\.setAttribute\('aria-label', label\)/, 'removed visible tab labels must remain available to assistive UI');
assert.match(menuTabs, /drop-shadow\(0 0 2px rgba\(255, 113, 143, \.76\)\)[\s\S]*drop-shadow\(0 0 6px rgba\(255, 113, 143, \.34\)\)/, 'Relationships heart must have a soft two-stage pink glow');
assert.match(menuTabs, /window\.__menuTabIconsDebug = debugSnapshot/, 'icon-only tab presentation must expose mobile-safe diagnostics');

const socialIndex = loader.indexOf('npc-social-relationship-bridge-v2.js'); // Used to verify the Rapport source exists before the icon observer installs.
const iconIndex = loader.indexOf('generic-hud-icons.js'); // Used to verify generic icon replacement installs before tab presentation.
const menuTabIndex = loader.indexOf('menu-tab-icon-only.js'); // Used to verify icon-only tabs run after the Relationships PNG heart exists.
const seatingIndex = loader.indexOf('npc-social-seating-bridge.js'); // Used as the expected social module after these HUD presentation adapters.
assert(socialIndex >= 0 && iconIndex > socialIndex && menuTabIndex > iconIndex && seatingIndex > menuTabIndex, 'menu tab presentation must load after generic HUD icons and before social seating');

console.log('generic HUD icons + relationship popups + shared gananji presentation regression checks passed');

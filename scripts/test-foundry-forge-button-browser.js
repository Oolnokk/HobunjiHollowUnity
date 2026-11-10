#!/usr/bin/env node
'use strict';
// Measures the shipped Foundry builder inside the real menu CSS, not a DOM mock.
const assert = require('node:assert/strict'); // Geometry, tap, keyboard, and forge assertions.
const fs = require('node:fs'); // Checks browser availability alongside the shipped assets.
const path = require('node:path'); // Resolves CSS and module files from the checkout.
let chromium; // Playwright is installed by the regression workflow's browser phase.
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: Playwright is not installed (browser-only test)'); process.exit(0);
}
if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && !fs.existsSync(chromium.executablePath())) {
  console.log('skip: Chromium is not installed (browser-only test)'); process.exit(0);
}
const root = path.resolve(__dirname, '..'); // Existing checkout, never deployed or cached website.
const itemKey = 'modular:shaft:head:copper'; // Example combined recipe generated through the real Foundry UI.
const longName = 'Extralongnonbreakingprefix'.repeat(6) + ' Hammer of the Great Long-Shafted Forgemasters'; // Stresses narrow text wrapping.
const sizes = [
  { width: 320, height: 568, row: 10, col: 10 }, // Worst-case letterboxed mobile portrait, very short game menu.
  { width: 412, height: 850, row: 13, col: 12.875 }, // Typical portrait touchscreen game grid.
  { width: 736, height: 414, row: 23, col: 23 }, // Landscape game grid.
];
function markup(size) {
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
    '<div id="menuPanel" class="open" style="--ox:0px;--oy:0px;--row:' + size.row + 'px;--col:' + size.col +
    'px;--glass-2:#181b1e;--border:#666;--border-bright:#888;--text:#eee;--muted:#bbb;--accent:#eed455">' +
    '<div class="mp-header"><div class="mp-tabs">Smithing</div></div><div class="mp-body">' +
    '<div class="mp-pane active" id="mpMetalCraftShop"><div class="supply-top-row">' +
    '<div class="wallet-display"><div class="wallet-label">Current bronze</div><div class="wallet-amount">200g</div></div></div>' +
    '<div class="menu-section supply-shop-section"><div class="menu-section-title">Sloomi &amp; Kzubug\'s Foundry</div>' +
    '<div id="metalCraftShopList" class="supply-list"></div></div></div></div></div></body></html>';
}
(async () => {
  const browser = await chromium.launch({ // Test the same Chromium as the shipped game browser suite.
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox'],
  });
  try {
    for (const size of sizes) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height },
        hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage(); // Real CSS layout and DOM; mock only unrelated gameplay/save adapters.
        const errors = []; // Browser errors are surfaced in the test, including mobile-only issues.
        page.on('pageerror', error => errors.push(error.stack || error.message));
        await page.setContent(markup(size));
        await page.addStyleTag({ path: path.join(root, 'docs/style.css') });
        await page.evaluate(({ itemKey, longName }) => {
          window.__gear = { tools: {} }; // The click must write to this real gear inventory object.
          window.__inventory = { gold: 200, bar_copper: 12, pineLog: 12 }; // All material costs are affordable.
          window.__toasts = []; // Captures the actual success/failed-forge notification.
          const definition = { label: longName, dmgType: 'blunt', animStyle: 'sweep',
            slots: ['weapon'], weaponAssembly: { flail: true } }; // Longest optional description path.
          const cost = { gold: 40, bars: 5, wood: 5 }; // Stable test resource fixture.
          window.TownMine = { improvementStatus: () => ({ built: true }), hasImprovement: () => true };
          window.ModularWeapons = {
            unlockedParts: () => ({ shafts: ['shaft'], heads: ['head'] }),
            getConfig: () => ({ shafts: { shaft: { label: 'Long Wrapped Handle', sourceShape: 'shaft' } },
              heads: { head: { label: 'Complicated Composite Mace Head' } }, craftCost: cost }),
            isDisallowed: () => false, itemKey: () => itemKey, weaponDamageType: () => 'blunt',
            diagnostics: () => ({ hugeValue: 'unbrokenDiagnosticText'.repeat(220) }),
            settings: () => ({ normal: true }),
          };
          window.ToolMetalRecolor = { getRecoloredCanvas: () => Promise.resolve({
            toDataURL: () => 'data:image/png;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
          }) };
          window.HobunjiHandToolGrips = { weaponHandModeForTool: () => 'two-hand' };
          window.__foundryDeps = {
            inventory: window.__inventory, getGearInventory: () => window.__gear,
            TOOL_ITEM_DEFS: { [itemKey]: definition }, UNLOCKED_TOOL_SHAPES: ['shaft', 'head'],
            VERDIGRIS_METAL_KEYS: ['copper'], METAL_DEFS: { copper: { label: 'Copper', hex: '#b87333' } },
            metalBarItemKey: metal => 'bar_' + metal, clampInventoryStack() {}, saveGearInventory() {},
            buildInventoryGrid() {}, buildEquipmentSlots() {}, saveMemberWorldData() {},
            showToast: (message, ok) => window.__toasts.push({ message, ok }),
            rerender() { // Production smith UI clears this exact list before refreshing, so selectors rebuild too.
              const list = document.querySelector('#metalCraftShopList');
              list.replaceChildren();
              window.FoundryShop.render(list);
            },
          };
        }, { itemKey, longName });
        await page.addScriptTag({ path: path.join(root, 'docs/js/foundry-shop.js') });
        await page.evaluate(() => {
          window.FoundryShop.init(window.__foundryDeps);
          window.FoundryShop.render(document.querySelector('#metalCraftShopList'));
        });
        const button = page.locator('#mpMetalCraftShop .foundry-forge-button');
        assert.equal(await button.count(), 1, 'A Forge action must exist in the actual rendered Foundry menu');
        assert.equal(await button.isEnabled(), true, 'Affordable custom weapon must be craftable');
        const before = await page.evaluate(() => {
          const pane = document.querySelector('#mpMetalCraftShop');
          const section = pane.querySelector('.foundry-section');
          const button = pane.querySelector('.foundry-forge-button');
          const image = section.querySelector('img');
          const bounds = node => {
            const rect = node.getBoundingClientRect();
            return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom,
              width:rect.width, height:rect.height };
          };
          return { pane:bounds(pane), section:bounds(section), button:bounds(button),
            image:bounds(image), overflow:section.scrollWidth - section.clientWidth,
            paneScroll: pane.scrollHeight - pane.clientHeight };
        });
        assert(before.button.bottom <= before.image.top, 'Forge appears before the long sprite preview');
        assert(before.button.width >= 100 && before.button.height >= 44, 'Forge button is touch-sized');
        assert(before.overflow <= 2, 'Long assembled names and diagnostics cannot force horizontal scrolling');
        assert(before.button.left >= before.pane.left - 2 && before.button.right <= before.pane.right + 2,
          'Forge stays within the menu pane horizontally');
        await button.scrollIntoViewIfNeeded(); // Real touch/keyboard can reach it even in a 140px-tall menu.
        const visible = await page.evaluate(() => {
          const pane = document.querySelector('#mpMetalCraftShop');
          const b = pane.querySelector('.foundry-forge-button');
          const pr = pane.getBoundingClientRect(), br = b.getBoundingClientRect();
          const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
          return { pane: { top:pr.top,bottom:pr.bottom }, button:{top:br.top,bottom:br.bottom},
            hittable:hit === b || b.contains(hit),
            scrollTop:pane.scrollTop };
        });
        assert(visible.button.top >= visible.pane.top - 2 && visible.button.bottom <= visible.pane.bottom + 2,
          'Forge can be scrolled completely into view, even on the smallest display');
        assert(visible.hittable, 'Forge is not obscured by another UI layer');
        // Keyboard/controller-style navigation from the last select must focus the same main action.
        await page.locator('#mpMetalCraftShop select[aria-label="Metal"]').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('foundry-forge-button')),
          true, 'The Forge action follows the final selector in keyboard navigation');
        await button.tap(); // Real mobile pointer gesture, not onclick() or a forced DOM click.
        const result = await page.evaluate(itemKey => ({
          owned:!!window.__gear.tools[itemKey], message:window.__toasts.at(-1),
          disabled:document.querySelector('.foundry-forge-button').disabled,
          label:document.querySelector('.foundry-forge-button').textContent,
          gold:window.__inventory.gold,
        }), itemKey);
        assert.equal(result.owned, true, 'Mobile tap crafts the selected weapon');
        assert.equal(result.message.ok, true, 'Craft success is reported');
        assert.equal(result.gold, 160, 'Forge debits the configured price exactly once');
        assert.equal(result.disabled, true, 'Already-forged recipe becomes disabled on rerender');
        assert.match(result.label, /Already forged/);
        assert.deepEqual(errors, [], 'Foundry did not throw in Chromium');
        console.log('Foundry viewport ' + size.width + 'x' + size.height +
          ': PASS (button ' + Math.round(before.button.width) + 'x' + Math.round(before.button.height) +
          ', scrollTop ' + Math.round(visible.scrollTop) + ', touch craft succeeded)');
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
// Real MutationObservers are essential: isolated DOM stubs missed this controller/icon feedback loop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only test)');
  process.exit(0);
}
if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && !fs.existsSync(chromium.executablePath())) {
  console.log('skip: Chromium not installed (browser-only test)');
  process.exit(0);
}
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: process.env.HOBUNJI_BROWSER_ARGS ? JSON.parse(process.env.HOBUNJI_BROWSER_ARGS) : ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    for (const glyphMode of ['fallback', 'native']) {
      await page.goto('about:blank');
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<div id="menuPanel" data-ctrl-panel class="open">
        <div id="mpInventory" class="mp-pane active">
          <div id="invGridArea" class="inv-grid-area" aria-label="Pack"><div id="invGrid"></div></div>
          <div id="invKeySection" class="inv-key-section"><button>Key item</button></div>
          <div id="invInfo" class="inv-info" data-ctrl-detail-panel>
            <div id="iiEmpty">Select an item</div><div id="iiDetail">
            <div id="iiIcon"></div><div id="iiName"></div><div id="iiPrice"></div>
            <div id="iiQuality"></div><div id="iiTags"></div><div id="iiDesc"></div><div id="iiActions"></div>
          </div></div>
        </div></div>`);
      await page.addStyleTag({ content: '.ctrl-nav-subtab-hidden{display:none!important}' });
      await page.evaluate(glyphMode => {
        // Model a device without the newer stone glyph, independently of CI's installed fonts.
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
          return fillText.call(this, text === '🪨' ? (glyphMode === 'fallback' ? '\u{10FFFF}' : 'O') : text, ...args);
        };
        window.__observerLoops = [];
        const Observer = MutationObserver;
        window.MutationObserver = class extends Observer {
          constructor(callback) {
            let calls = 0;
            let resetQueued = false;
            const origin = new Error().stack;
            super((records, observer) => {
              // Break a failing build's microtask starvation so the test can report the failure.
              if (++calls > 200) {
                window.__observerLoops.push(origin);
                observer.disconnect();
                return;
              }
              if (!resetQueued) {
                resetQueued = true;
                setTimeout(() => { calls = 0; resetQueued = false; }, 0);
              }
              callback(records, observer);
            });
          }
        };
        window.EquipmentPanel = { init() {} };
        window.Combat = { deps: {} };
        window.InventoryStacks = { applyHeadIcon() {} };
        window.CookingSystem = { valueMultiplierForStars: () => 1 };
        window.ControllerInput = { PRIORITY: { menuNav: 10 }, subscribe(_id, callback) { window.__pollController = callback; }, normalizeStick: (x, y) => ({ x, y }) };
        window.InputBindings = { getCurrentBindings: () => ({ controller: { uiConfirm: 'Button0', uiCancel: 'Button1' } }) };
        let now = 0;
        window.__pressController = (action, heldFrames = 1) => {
          const code = action === 'confirm' ? 'Button0' : 'Button1';
          const frame = down => ({ now: now += 16, focused: true, pad: { axes: [0,0,0,0], buttons: [{ pressed: down }] }, isDown: binding => down && binding === code });
          window.__pollController(frame(false));
          for (let i = 0; i < heldFrames; i++) window.__pollController(frame(true));
          window.__pollController(frame(false));
        };
      }, glyphMode);
      for (const file of ['item-processing.js', 'inventory-held-override.js', 'generic-hud-icons.js', 'combat/combat-progression.js']) {
        await page.addScriptTag({ path: path.join(root, 'docs/js', file) });
      }
      const gameSource = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
      const first = gameSource.indexOf('function selectInventoryItem(key, skipGridUpdate, selectedStack = null)');
      const last = gameSource.indexOf('function disposeAvatarGroup(', first);
      assert(first >= 0 && last > first);
      await page.evaluate(selectionSource => {
        const items = { ITEM_DEFS: {}, inventoryItems: [], inventory: {} };
        window.CombatProgression.registerItems(items);
        const tablet = window.CombatProgression.itemKey('sharp', 1, 'stat_rangeMul_0p12');
        const scroll = window.CombatProgression.itemKey('sharp', 1, 'stat_rangeMul_0p12', 'scroll');
        items.ITEM_DEFS.apple = { label: 'Apple', icon: '🍎', cat: 'material', sellPrice: 1, tags: ['Fruit'], desc: 'A piece of fruit.' };
        for (const key of ['apple', tablet, scroll]) items.inventory[key] = 1;
        window.__items = items;
        window.__lessonKeys = [tablet, scroll];
        window.ItemProcessing.init({ ITEM_DEFS: items.ITEM_DEFS, getInventoryItems: () => items.inventoryItems, PROCESSING_METHODS: [] });
        window.EquipmentPanel.init(items);
        // Execute the actual Pack renderer; only unrelated artwork/save/gameplay adapters are stubbed.
        const select = new Function('deps', `
          let invSelectedKey = null, invSelectedStack = null, activeItemIndex = 0, heldMode = 'tool';
          const inventory = deps.inventory, ITEM_DEFS = deps.ITEM_DEFS, TOOL_ITEM_DEFS = {}, gearInventory = {tools:{}}, equipmentSlots = {};
          const LIVESTOCK_ITEM_KINDS = {}, QUALITY_DESCRIPTORS = {}, MYSTERY_DYE_POOL_BY_ITEM_KEY = {};
          const clampInventoryStack = () => {}, starGlyphs = () => '', qualityDisplayForItem = () => '';
          const itemDescriptionWithFlavor = (key, def) => def.desc, itemIconForKey = key => ITEM_DEFS[key].icon;
          const applyItemSpriteIcon = () => {}, getManualHeldItem = () => null, setManualHeldItem = () => {};
          const getInventoryStackItems = () => [], showToast = () => {}, saveMemberWorldData = () => {};
          const refreshActionBar = () => {}, closeMenu = () => {}, spGoldAmount = null;
          ${selectionSource}
          return selectInventoryItem;
        `)(items);
        for (const key of ['apple', tablet, scroll]) {
          const tile = document.createElement('button');
          tile.className = 'inv-item-box';
          tile.dataset.key = key;
          tile.dataset.stackId = key + '|plain|0';
          tile.dataset.ctrlDetail = 'invInfo';
          tile.textContent = items.ITEM_DEFS[key].label;
          tile.onclick = () => select(key, false, { key, count: items.inventory[key], stackId: tile.dataset.stackId });
          document.getElementById('invGrid').appendChild(tile);
        }
      }, gameSource.slice(first, last));
      await page.addScriptTag({ path: path.join(root, 'docs/js/controller-ui-nav.js') });
      await page.addScriptTag({ path: path.join(root, 'docs/js/inventory-ui.js') });
      await page.evaluate(() => window.InventoryUI.init({ isDevMode: () => false }));
      await page.evaluate(() => window.dispatchEvent(new Event('gamepadconnected')));
      // Pad navigation changes the detail before Confirm and never enters the action group.
      const previews = await page.evaluate(() => {
        window.ControllerUI.showSection('mpInventory', 'invGridArea');
        const snapshots = [];
        for (const tile of document.querySelectorAll('#invGrid .inv-item-box[data-key]')) {
          tile.dispatchEvent(new CustomEvent('hobunji-controller-focus', { bubbles: true })); // Exercises every stack without an activation click.
          snapshots.push({
            key: tile.dataset.key,
            name: document.getElementById('iiName').textContent,
            selected: tile.classList.contains('selected'),
            group: window.ControllerUI.debugState().groupId,
            count: window.__items.inventory[tile.dataset.key],
            debugKey: window.InventoryUI.debugSnapshot().lastControllerPackPreview?.key,
          });
        }
        window.ControllerUI.showSection('mpInventory', 'invGridArea');
        const focused = window.ControllerUI.focusedElement();
        return { snapshots, focusedKey: focused?.dataset.key, focusedName: document.getElementById('iiName').textContent };
      });
      assert.equal(previews.snapshots.length, 3);
      for (const preview of previews.snapshots) {
        assert.ok(preview.name.endsWith(' ×1'), 'every hovered item renders its own stack detail');
        if (preview.key === 'apple') assert.equal(preview.name, 'Apple ×1');
        else assert.notEqual(preview.name, 'Apple ×1');
        assert.equal(preview.selected, true);
        assert.equal(preview.group, 'invGridArea', 'highlight alone must never enter the detail action group');
        assert.equal(preview.count, 1, 'highlight must not consume or use an item');
        assert.equal(preview.debugKey, preview.key);
      }
      if (previews.focusedKey) assert.equal(previews.focusedName, previews.snapshots.find(row => row.key === previews.focusedKey).name);

      const keys = await page.evaluate(() => window.__lessonKeys);
      for (const key of [keys[1], 'apple', ...keys, 'apple', ...keys]) {
        await page.evaluate(key => {
          window.ControllerUI.showSection('mpInventory', 'invGridArea');
          Array.from(document.querySelectorAll('#invGrid [data-key]')).find(tile => tile.dataset.key === key).focus();
          window.__pressController('confirm', 3);
        }, key);
        // A timer must run after the observers settle; the old build hits the guard first.
        await page.waitForTimeout(75);
        const result = await page.evaluate(() => ({
          loops: window.__observerLoops,
          group: window.ControllerUI.debugState().groupId,
          name: document.getElementById('iiName').textContent,
          actionKey: document.getElementById('inventoryDirectUseBtn')?.dataset.itemKey,
          iconKind: document.querySelector('#inventoryDirectUseBtn [data-generic-hud-icon]')?.dataset.genericHudIcon,
        }));
        assert.deepEqual(result.loops, [], 'controller detail selection must settle without an observer feedback loop');
        assert.equal(result.group, 'invInfo');
        assert.ok(result.name.endsWith(' ×1'));
        if (key !== 'apple') assert.equal(result.actionKey, key);
        if (key === keys[0]) assert.equal(result.iconKind, glyphMode === 'fallback' ? 'item' : 'item-native', 'the test must exercise the intended platform glyph path');
        await page.evaluate(() => window.__pressController('cancel'));
        assert.equal(await page.evaluate(() => window.ControllerUI.focusedElement()?.dataset.key), key, 'Back returns to the selected stack');
      }
      // Read the scroll through the controller and verify its identity/consumption.
      await page.evaluate(() => {
        document.getElementById('inventoryDirectUseBtn').focus();
        window.__pressController('confirm', 3);
      });
      assert.equal(await page.evaluate(key => window.__items.inventory[key], keys[1]), 0);
      assert.equal(await page.evaluate(key => window.__items.inventory[key], keys[0]), 1);
      await page.evaluate(key => {
        window.ControllerUI.showSection('mpInventory', 'invGridArea');
        Array.from(document.querySelectorAll('#invGrid [data-key]')).find(tile => tile.dataset.key === key).focus();
        window.__pressController('confirm');
      }, keys[0]);
      await page.waitForTimeout(75);
      assert.equal(await page.locator('#inventoryDirectUseBtn').isDisabled(), true, 'a duplicate lesson disables Read after learning its effect');
      assert.match(await page.locator('#inventoryDirectUseBtn').innerText(), /Already learned/);
      assert.equal(await page.evaluate(key => window.__items.inventory[key], keys[0]), 1);
      assert.deepEqual(await page.evaluate(() => window.__observerLoops), []);
      assert.deepEqual(errors, []);
    }
    console.log('controller mastery inventory browser tests passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

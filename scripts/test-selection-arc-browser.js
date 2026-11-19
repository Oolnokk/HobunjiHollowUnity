#!/usr/bin/env node
'use strict';

// Real Chromium regression for the live selection wheel: steady idle frames must
// not mutate CSS, but legacy timer scrolling and close/reopen must still work.
const assert = require('node:assert/strict');
const fs = require('node:fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only selection arc test)');
  process.exit(0);
}
if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && !fs.existsSync(chromium.executablePath())) {
  console.log('skip: Chromium not installed (browser-only selection arc test)');
  process.exit(0);
}
const source = fs.readFileSync('docs/js/quick-potion-arc-ui.js', 'utf8'); // Runs the shipped presentation module with real layout, CSSStyleDeclaration, and observers.
const itemSource = fs.readFileSync('docs/js/item-arch-category-colors.js', 'utf8'); // Run item presentation against real browser DOM/CSS.

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: process.env.HOBUNJI_BROWSER_ARGS ? JSON.parse(process.env.HOBUNJI_BROWSER_ARGS) : ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport:{ width:840, height:640 } });
    const errors = []; // Page errors are reported without requiring browser devtools, including on mobile.
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><html><body>
      <div id="toolSelect" style="position:fixed;right:18px;bottom:18px;width:0;height:0"></div>
      <button id="toolBtn" style="position:fixed;right:146px;bottom:146px;width:22px;height:22px">tool</button>
      <div id="wheel">
        <button id="choiceA" class="arc-slot" style="left:10px;opacity:1" aria-label="Herbs"><span class="arc-label">Herbs</span></button>
        <button id="choiceB" class="arc-slot" style="left:20px;opacity:1" aria-label="Potions"><span class="arc-label">Potions</span></button>
      </div>
    </body></html>`);
    await page.addScriptTag({ content:source });
    await page.waitForFunction(() => window.QuickPotionArcUI?.diagnostics().frameEnforcerRunning
      && document.body.classList.contains('shared-selection-arc-open'));
    await page.waitForTimeout(360); // The real 190ms atomic opening transition must have settled before measuring idle mutations.

    async function idleProbe() {
      return page.evaluate(async () => {
        const watched = ['style', 'class', 'data-shared-selection-radius',
          'data-shared-selection-angle', 'data-shared-selection-target-x', 'data-shared-selection-target-y'];
        let writes = 0; // Counts actual attribute mutation records across the whole visible selection HUD.
        const observer = new MutationObserver(records => { writes += records.length; });
        observer.observe(document.body, { attributes:true, childList:true, subtree:true, attributeFilter:watched });
        const before = window.QuickPotionArcUI.diagnostics().domWrites; // The public mobile readout must agree with real DOM observations.
        await new Promise(resolve => {
          let frames = 0; // At least 12 browser animation frames exercise the live timer-aware enforcer.
          const step = () => { if (++frames >= 12) resolve(); else requestAnimationFrame(step); };
          requestAnimationFrame(step);
        });
        observer.disconnect();
        const after = window.QuickPotionArcUI.diagnostics().domWrites;
        return { writes, appliedDelta:after.applied-before.applied, skippedDelta:after.skipped-before.skipped,
          open:document.body.classList.contains('shared-selection-arc-open') };
      });
    }

    const resting = await idleProbe();
    assert.equal(resting.writes, 0, 'real Chromium selector makes no DOM attribute writes during idle frames');
    assert.equal(resting.appliedDelta, 0, 'mobile diagnostics report no applied writes during idle frames');
    assert(resting.skippedDelta > 10, 'the live enforcer is still checking and suppressing redundant writes');
    assert(resting.open, 'idle optimization does not close the selection ring');

    await page.evaluate(() => {
      const arrow = document.createElement('button'); // Legacy item wheel sentinel enables left-ordered recycling.
      arrow.id = 'legacyArrow'; arrow.className = 'arc-slot arc-arrow'; arrow.style.left = '999px';
      document.getElementById('wheel').appendChild(arrow);
    });
    await page.waitForFunction(() => document.getElementById('legacyArrow')?.dataset.sharedSelectionSentinel === '1');
    const beforeScroll = await page.locator('#choiceA').getAttribute('data-shared-selection-target-x');
    await page.evaluate(() => { document.getElementById('choiceA').style.left = '100px'; }); // Legacy scroll can change only inline left without inserting nodes.
    await page.waitForFunction(previous => {
      return document.getElementById('choiceA')?.dataset.sharedSelectionTargetX !== previous;
    }, beforeScroll);
    const afterScroll = await page.locator('#choiceA').getAttribute('data-shared-selection-target-x');
    assert.notEqual(afterScroll, beforeScroll, 'timer-scrolled legacy choices visibly move despite idle guards');
    await page.waitForTimeout(260);
    const scrolledIdle = await idleProbe();
    assert.equal(scrolledIdle.writes, 0, 'selector stops writing after a real animated scroll settles');

    const beforeResize = await page.locator('#choiceA').getAttribute('data-shared-selection-radius');
    await page.evaluate(() => {
      document.getElementById('toolBtn').style.right = '205px'; // Moving the permanent ring reference changes the shared selector radius.
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(previous => document.getElementById('choiceA')?.dataset.sharedSelectionRadius !== previous, beforeResize);
    const afterResize = await page.locator('#choiceA').getAttribute('data-shared-selection-radius');
    assert.notEqual(afterResize, beforeResize, 'the wheel responds to a real outer-ring geometry change');
    await page.waitForTimeout(260);
    const resizedIdle = await idleProbe();
    assert.equal(resizedIdle.writes, 0, 'selector returns to a mutation-free idle after resizing');

    await page.evaluate(() => {
      document.querySelectorAll('.arc-slot').forEach(slot => slot.remove()); // Real selector teardown must restore the permanent arch.
    });
    await page.waitForFunction(() => !document.body.classList.contains('shared-selection-arc-open')
      && !window.QuickPotionArcUI?.diagnostics().frameEnforcerRunning);
    await page.evaluate(() => {
      const choice = document.createElement('button');
      choice.className = 'arc-slot'; choice.id = 'reopenedChoice'; choice.setAttribute('aria-label', 'Reopened');
      choice.style.left = '10px';
      document.getElementById('wheel').appendChild(choice);
    });
    await page.waitForFunction(() => window.QuickPotionArcUI?.diagnostics().frameEnforcerRunning
      && document.body.classList.contains('shared-selection-arc-open')
      && document.getElementById('reopenedChoice')?.dataset.sharedSelectionPresented === '1');

    // Exercise the merged presenter inside the same real Chromium wheel used by
    // the original browser smoke: sprites, category halo, radius, edge scroll, idle writes.
    await page.evaluate(() => {
      document.querySelectorAll('.arc-slot').forEach(slot => slot.remove());
      const itemBtn = document.createElement('button'); // The item's actual open-mode condition.
      itemBtn.id = 'itemBtn'; document.body.appendChild(itemBtn);
      document.getElementById('toolBtn').style.visibility = 'hidden';
      window.CookingSystem = {init() {}};
      window.FarmCrates = {init() {}};
      window.AlchemySystem = {init() {}};
      window.itemArchBrowserDeps = {
        ITEM_DEFS: {seed:{label:'BLUE SEED',itemArchCategory:'seed'},berry:{label:'RED BERRY',tags:['berry']}},
        inventory:{seed:2,berry:3},
        inventoryItems:[{key:'seed',label:'BLUE SEED'},{key:'berry',label:'RED BERRY'}],
      };
      for (const [id,label,active] of [['itemArchSeed','BLUE SEED',true],['itemArchBerry','RED BERRY',false]]) {
        const node = document.createElement('div');
        node.id = id;
        node.className = 'arc-slot' + (active ? ' arc-active' : '');
        node.style.cssText = 'position:fixed;left:20px;opacity:1;';
        node.innerHTML = '<span class="arc-icon sprited-icon"></span><span class="arc-label"></span>';
        node.querySelector('.arc-label').textContent = label;
        node.querySelector('.arc-icon').style.backgroundImage = 'url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")';
        document.body.appendChild(node);
      }
      const arrow = document.createElement('div');
      arrow.id = 'itemArchEdge';
      arrow.className = 'arc-slot arc-arrow';
      arrow.style.left = '25px';
      document.body.appendChild(arrow);
    });
    await page.addScriptTag({content:itemSource});
    await page.evaluate(() => window.CookingSystem.init(window.itemArchBrowserDeps));
    await page.waitForFunction(() => document.getElementById('itemArchSeed')?.dataset.itemCategory === 'seed'
      && document.getElementById('itemArchBerry')?.dataset.itemCategory === 'berry'
      && document.querySelector('#itemArchFixedCategoryHeading textPath')?.textContent === 'Seeds'
      && document.getElementById('itemArchSeed')?.classList.contains('item-select-radius-inset')
      && window.ItemArchCategoryColors?.debugSnapshot().presentation.selectionRadiusMatchesPotion);
    await page.waitForTimeout(350);
    const openItem = await page.evaluate(() => {
      const slot = document.getElementById('itemArchSeed');
      const icon = getComputedStyle(slot.querySelector('.arc-icon'));
      return {
        headings:document.querySelectorAll('#itemArchFixedCategoryHeading').length,
        retired:document.querySelectorAll('#itemArchCategoryHeading, #itemArchStickyCategoryHeading').length,
        text:document.querySelector('#itemArchFixedCategoryHeading textPath')?.textContent,
        background:icon.backgroundImage,
        radiusInset:getComputedStyle(slot).translate,
        haloBorder:getComputedStyle(slot, '::before').borderTopColor,
        geometry:window.QuickPotionArcUI.readGeometry(),
      };
    });
    assert.equal(openItem.headings, 1, 'exactly one fixed item-category heading');
    assert.equal(openItem.retired, 0, 'the hidden legacy SVG presenters are gone');
    assert.equal(openItem.text, 'Seeds');
    assert.match(openItem.background, /data:image\/gif/, 'sprite icon background is not erased');
    assert.notEqual(openItem.radiusInset, 'none', 'six-pixel item-only inward radius is applied');
    assert.match(openItem.haloBorder, /rgb/, 'category halo is rendered by the slot pseudo-element');
    assert(openItem.geometry.outerRingGeometry?.radius > 8, 'cheap live geometry is available');
    const idleWrites = await page.evaluate(async () => {
      let writes = 0;
      const observer = new MutationObserver(records => { writes += records.length; });
      for (const element of [document.getElementById('itemArchSeed'), document.getElementById('itemArchBerry'),
        document.getElementById('itemArchFixedCategoryHeading')]) {
        observer.observe(element, {subtree:true,attributes:true,attributeFilter:['class','style','d','viewBox','data-item-category','data-item-category-label']});
      }
      await new Promise(resolve => {
        let frames = 0;
        const frame = () => { if (++frames >= 12) resolve(); else requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
      });
      observer.disconnect();
      return writes;
    });
    assert.equal(idleWrites, 0, 'real Chromium idle item selection does not rewrite category slots or SVG attributes');
    await page.evaluate(() => {
      document.getElementById('itemArchSeed').classList.remove('arc-active');
      document.getElementById('itemArchEdge').classList.add('arc-active');
    });
    await page.waitForFunction(() => document.querySelector('#itemArchFixedCategoryHeading textPath')?.textContent === 'Seeds'
      && window.ItemArchStickyCategoryHeading?.debugSnapshot().stickyVisible);
    await page.evaluate(() => {
      document.getElementById('itemArchEdge').classList.remove('arc-active');
      document.getElementById('itemArchBerry').classList.add('arc-active');
    });
    await page.waitForFunction(() => document.querySelector('#itemArchFixedCategoryHeading textPath')?.textContent === 'Berries');
    await page.evaluate(() => { document.getElementById('itemArchBerry').querySelector('.arc-label').textContent = 'BLUE SEED'; });
    await page.waitForFunction(() => document.getElementById('itemArchBerry')?.dataset.itemCategory === 'seed',
      null, {timeout:3000});
    await page.evaluate(() => {
      document.querySelectorAll('.arc-slot').forEach(slot => slot.remove());
      document.getElementById('toolBtn').style.visibility = '';
    });
    await page.waitForFunction(() => !document.getElementById('itemArchFixedCategoryHeading')
      && !window.ItemArchCategoryColors.debugSnapshot().presentation.frameRunning);
    assert.deepEqual(errors, [], 'real Chromium selection and item-arch integration produces no browser errors');

    console.log('selection arc real-browser idle: PASS (12+ quiet frames, legacy scroll, responsive resize, close/reopen, diagnostics)');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

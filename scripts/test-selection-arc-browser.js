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
    assert.deepEqual(errors, [], 'real selector open, scroll, close, and reopen produce no browser errors');
    console.log('selection arc real-browser idle: PASS (12+ quiet frames, legacy scroll, responsive resize, close/reopen, diagnostics)');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

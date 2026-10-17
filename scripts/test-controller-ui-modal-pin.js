'use strict';

// A data-ctrl-modal panel (the day review) must stay the controller's active panel when another panel opens later
// (e.g. a dialogue/cutscene box), including when that panel explicitly asks for focus.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const navSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'controller-ui-nav.js'), 'utf8'); // Shipped navigation module under test.

(async () => {
  const pinned = '/opt/pw-browsers/chromium'; // Sandbox-provided Chromium; other environments use Playwright's own.
  const browser = await chromium.launch(fs.existsSync(pinned) ? { executablePath: pinned } : {});
  try {
    const page = await browser.newPage();
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: navSource });
    const result = await page.evaluate(async () => {
      const make = (id, modal) => {
        const el = document.createElement('div');
        el.id = id;
        el.setAttribute('data-ctrl-panel', '');
        if (modal) el.setAttribute('data-ctrl-modal', '');
        el.style.cssText = 'width:100px;height:100px';
        el.innerHTML = '<button>x</button>';
        document.body.appendChild(el);
        return el;
      };
      const review = make('review', true);
      window.ControllerUI.focusPanel(review);
      const dialogue = make('dialogue', false);
      await new Promise(resolve => setTimeout(resolve, 150));
      const afterOpen = window.ControllerUI.activePanel()?.id;
      window.ControllerUI.focusPanel(dialogue);
      const afterFocusTheft = window.ControllerUI.activePanel()?.id;
      review.remove();
      await new Promise(resolve => setTimeout(resolve, 150));
      return { afterOpen, afterFocusTheft, afterClose: window.ControllerUI.activePanel()?.id };
    });
    assert.equal(result.afterOpen, 'review', 'a panel opening later does not take the stack top from the modal');
    assert.equal(result.afterFocusTheft, 'review', 'explicit focusPanel from another panel is refused while the modal is up');
    assert.equal(result.afterClose, 'dialogue', 'focus falls back to the other panel once the modal closes');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });

'use strict';
// A touch icon is real <img> markup: the browser re-serializes it, so the old "innerHTML !== value" check
// never matched and every per-frame prompt refresh rewrote the button subtree (a MutationObserver fan-out).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let innerHtmlWrites = 0;
function makeElement(id) {
  const el = {
    id, style: {}, onpointerup: null, className: '', _text: '', _html: '',
    classList: { _s: new Set(), contains(c) { return this._s.has(c); }, add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } },
    get textContent() { return this._text; }, set textContent(v) { this._text = v; },
    // Browser-style normalisation: attributes get quoted, so the getter never equals the source string.
    get innerHTML() { return this._html.replace(/<img src=([^ >"]+)>/g, '<img src="$1">'); },
    set innerHTML(v) { if (id === 'apBtn') innerHtmlWrites++; this._html = v; },
  };
  return el;
}
const els = new Map();
const document = {
  getElementById(id) {
    if (!els.has(id)) els.set(id, makeElement(id));
    return els.get(id);
  },
  head: { appendChild() {} }, createElement: () => makeElement('x'),
};
// buildActionPromptDom assigns actionPrompt.innerHTML, then looks the children up by id: fine with the lazy map.
const sandbox = { window: {}, document, console };
sandbox.window.document = document;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('docs/js/action-prompt-ui.js', 'utf8'), sandbox);
const ui = sandbox.window.ActionPromptUI;
ui.init({ getLastInputDevice: () => 'touch' });

const show = (extra = {}) => ui.showActionPrompt({ actionId: 'interact', touchIcon: '<img src=hand.png>', verb: 'Take', onPress() {}, ...extra });
show();
const first = innerHtmlWrites;
assert(first >= 1, 'first refresh writes the button markup');
for (let i = 0; i < 60; i++) show();
assert.equal(innerHtmlWrites, first, 'sixty identical per-frame refreshes with <img> markup write nothing');
show({ verb: 'Pick up' });
assert.equal(innerHtmlWrites, first + 1, 'a changed verb still updates the button');
for (let i = 0; i < 10; i++) show({ verb: 'Pick up' });
assert.equal(innerHtmlWrites, first + 1, 'and then goes quiet again');
const dbg = ui.getDebug();
assert(dbg.skippedWrites > dbg.appliedWrites, 'skips dominate (applied ' + dbg.appliedWrites + ', skipped ' + dbg.skippedWrites + ')');
console.log('PASS action prompt: identical <img> markup is not rewritten per frame; changes still apply');

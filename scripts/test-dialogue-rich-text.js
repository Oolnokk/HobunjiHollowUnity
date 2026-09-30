'use strict';
const assert = require('node:assert/strict'); // Shared markup, editor preview and typewriter regression checks.
const fs = require('node:fs'); // Loads the production parser and dialogue functions.
const vm = require('node:vm'); // Exercises the renderer without a browser or unsafe HTML.
const window = {}; // The same global module namespace used by game and editor.
vm.runInNewContext(fs.readFileSync('docs/js/dialogue-rich-text.js', 'utf8'), { window });
const rich = window.DialogueRichText; // Production parser/rendering API.
function element() {
  return { children: [], style: {}, textContent: '', ownerDocument: { createElement: element }, replaceChildren() { this.children = []; this.textContent = ''; }, appendChild(child) { this.children.push(child); } };
}
const line = 'Use [color=#8bd5ff]Defensive Hold[/color] now.'; // One colored phrase surrounded by ordinary dialogue.
const runs = rich.parse(line); // Color metadata must never enter spoken/revealed text.
assert.equal(rich.plain(runs), 'Use Defensive Hold now.');
const output = element(); // Captures the safe DOM spans during partial and complete reveals.
rich.render(output, runs, 7);
assert.equal(output.children.map(child => child.textContent).join(''), 'Use Def');
assert.equal(output.children[1].style.color, '#8bd5ff');
rich.render(output, runs);
assert.equal(output.children.map(child => child.textContent).join(''), 'Use Defensive Hold now.');
assert.equal(rich.plain(rich.parse('[color=red]raw[/color]')), '[color=red]raw[/color]');
assert.match(rich.html('<img onerror="attack()">'), /&lt;img/);
assert.doesNotMatch(rich.html('[color=#123456" onclick="x]bad[/color]'), /<span/);
assert.equal(rich.parse('[color=#112233]a[color=#445566]b[/color]c[/color]')[2].color, '#112233');

const source = fs.readFileSync('docs/js/dialogue-content.js', 'utf8'); // Exercise actual speech reveal callbacks, not a duplicate implementation.
const start = source.indexOf('  function stopNpcDialogueTypewriter('); // Beginning of the complete typewriter helpers.
const end = source.indexOf('\n  function ', source.indexOf('  function _setNpcDialogueText(') + 10); // End of the real line setter.
const timers = []; // Deterministic reveal queue and vowel-sound callbacks.
const context = vm.createContext({
  window, _npcDialogueTextEl: output, _npcDialogueTypeText: '', _npcDialogueSequenceId: 0,
  _npcDialogueTypeTimers: [], _npcDialogueTypeUnits: [], _npcDialogueTypeIndex: 0,
  _npcDialogueColorRuns: [], _npcDialogueVisibleCharacters: 0, _dlgNpcRec: null,
  deps: { getDialogueOpen: () => true }, setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
  _applyNpcDialogueLinePresentation(text) { assert.equal(text, 'Use Defensive Hold now.'); },
  npcDialogueTypewriterConfig: () => ({ enabled: true }), npcDialoguePortraitConfig: () => ({ yap: {} }),
  dialogueSeatId: () => 'test', _playNpcDialogueLetterSfx() {},
}); // Stub only audio/presentation boundaries; retain the actual dialogue timing and skip behavior.
vm.runInContext(source.slice(start, end) + '\n_setNpcDialogueText(' + JSON.stringify(line) + ');', context);
assert.equal(context._npcDialogueTypeText, 'Use Defensive Hold now.');
for (const timer of timers.filter(timer => timer.delay <= 350)) timer.fn();
assert.equal(output.children.map(child => child.textContent).join(''), 'Use Def');
vm.runInContext('stopNpcDialogueTypewriter(true)', context);
assert.equal(output.children.map(child => child.textContent).join(''), 'Use Defensive Hold now.');
assert.equal(output.children[1].style.color, '#8bd5ff', 'skip-to-end preserves the same colored phrase');
console.log('Dialogue colored spans: safe markup, nested colors, editor HTML, cadence reveal, and skip-to-end passed.');

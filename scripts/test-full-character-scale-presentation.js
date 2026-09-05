const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/character-scale-comparison-presentation.js', 'utf8');
const appended = [];
const document = {
  body: { dataset: {} },
  head: { appendChild(node) { appended.push(node); } },
  getElementById() { return null; },
  createElement(tag) { return { tagName: tag.toUpperCase(), style: {}, set id(value) { this._id = value; }, get id() { return this._id; } }; },
};
const window = { addEventListener() {} };
const context = vm.createContext({
  window,
  document,
  location: { pathname: '/tools/animation-author/index.html' },
  setInterval() { return 1; },
  setTimeout(fn) { fn(); return 1; },
  queueMicrotask(fn) { fn(); },
  console,
  Set,
  Promise,
  Number,
  Math,
  Object,
  String,
});
vm.runInContext(source, context, { filename: 'character-scale-comparison-presentation.js' });

const api = window.HobunjiFullScaleEditorPresentation;
assert(api, 'presentation adapter must expose its diagnostic/test API');
assert(Math.abs(api.rawHeadPercentFromRuntime(1.02, 1) - 102) < 1e-9, 'Mao-ao male 1.02 head over 1.00 portrait scale should display as 102% of raw PNG');
assert(Math.abs(api.rawHeadPercentFromRuntime(1.085, 0.75) - 81.375) < 1e-9, 'Kenkari male head should include its 75% portrait-plane scale');
assert(Math.abs(api.rawHeadPercentFromRuntime(1.01, 1.18) - 119.18) < 1e-9, 'Mashtzarr male head should include its 118% portrait-plane scale');
assert(Math.abs(api.runtimeHeadPercentFromRaw(81.375, 0.75) - 108.5) < 1e-9, 'raw-PNG percentage must round-trip to the existing runtime headScale percent');
assert.match(source, /position:fixed!important/);
assert.match(source, /right:max\(10px,env\(safe-area-inset-right\)\)!important/);
assert.match(source, /camera\.isPerspectiveCamera = false/);
assert.match(source, /camera\.isOrthographicCamera = true/);
assert.match(source, /projectionMatrix\.makeOrthographic/);
assert.match(source, /reservePx/);
console.log('full character scale presentation tests passed');

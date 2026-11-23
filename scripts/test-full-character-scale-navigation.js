'use strict';
// Regression for Full Character Scale trapping the user when switching back to native Animation Author tabs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const editor = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8');
const host = fs.readFileSync('docs/js/character-scale-comparison-host-bridge.js', 'utf8');
const native = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');

assert.match(editor, /max-height:min\(68dvh,calc\(100dvh - 150px\)\);overflow-y:auto/,
  'comparison panel must have a mobile-height limit and its own scroll area');
assert.match(editor, /#maaTopbar\{z-index:25\}/,
  'the native navigation toolbar must remain above the comparison panel');
assert.match(editor, /if \(!active && !building && !exitingPromise\) return;/,
  'native tab clicks remain captured while a comparison restore is pending');
assert.match(editor, /event\.stopImmediatePropagation\(\)/,
  'native mode transition must not run simultaneously with actor restoration');
assert.match(native, /setMode: mode => setAnimationAuthorMode\(mode\)/,
  'public setMode must resolve the final Rig-aware mode handler, not an earlier captured function');
assert.match(native, /refreshModeChrome: \(\) => renderAnimationModeChrome\(\)/,
  'the already-selected Multi tab needs an explicit chrome refresh after scale mode');
assert.match(native, /MultiAvatarAnimationAuthor\.setMode = mode => setAnimationAuthorMode\(mode\)/,
  'V15.51 public API refresh must also late-bind Rig-aware mode switching');
assert.match(host, /await api\.setMode\(normalizedMode\);[\s\S]{0,65}api\.refreshModeChrome\?\.\(\);/,
  'the comparison host must restore native chrome even when the target mode was already active');
assert.doesNotMatch(host, /function installPicking\(/,
  'legacy viewport click selection must stay retired, leaving dropdown-only selection');

const PROBE = '  let attempts = 0;';
assert(editor.includes(PROBE), 'full-character-scale editor footer changed');
const injected = editor.slice(0, editor.lastIndexOf(PROBE)) + `
  window.__navigationTest = {
    configure({ loading = false, saved = true, setup = Promise.resolve() } = {}) {
      active = !loading; building = loading; generation++;
      savedMulti = saved ? { schema: 'hobunji.multi-avatar-animation.v8', actors: [] } : null;
      pendingSetup = setup; pendingExitMode = null; exitingPromise = null;
    },
    exit,
    get state() { return { active, building, exiting: !!exitingPromise,
      pendingExitMode, mode: document.body.dataset.animationAuthorMode, hasSnapshot: !!savedMulti }; },
  };
})();
`;

let modeLog = [];
let imports = 0;
let failImport = false;
let importGate = null;
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, disabled: false, hidden: false, textContent: '', style: {},
    setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name] || null; },
  });
  return elements.get(id);
}
const document = {
  currentScript: null,
  body: { dataset: { animationAuthorMode: 'scale-compare' } },
  getElementById: element,
};
const window = {
  HobunjiAnimationAuthorScaleHost: {
    setMode: async mode => {
      modeLog.push(mode);
      document.body.dataset.animationAuthorMode = mode; // Mock the native late-bound setMode + chrome refresh pair.
      for (const tab of ['multi', 'single', 'rig']) element('maa' + tab[0].toUpperCase() + tab.slice(1) + 'Tab')
        .setAttribute('aria-selected', String(tab === mode));
    },
    serializeRig: () => ({ schema: 'hobunji.attachment-rig-profiles.v10', profiles: { characters: {}, creatures: {} } }),
  },
  MultiAvatarAnimationAuthor: {
    importProject: async () => {
      imports++;
      if (importGate) await importGate;
      if (failImport) throw Error('test import failure');
    },
  },
  ProceduralHandFrameDriver: { syncNow() {} },
};
const store = new Map();
const localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value),
  removeItem: key => store.delete(key) };
const context = vm.createContext({
  window, document, localStorage, URL, console,
  location: { pathname: '/tools/animation-author/index.html', href: 'https://example.test/tools/animation-author/index.html' },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
});
vm.runInContext(injected, context);
const api = window.__navigationTest;

async function visit(mode) {
  document.body.dataset.animationAuthorMode = 'scale-compare';
  modeLog = []; imports = 0; failImport = false; importGate = null;
  api.configure();
  await api.exit(mode);
  assert.deepEqual(modeLog, [mode], 'native mode handoff must happen exactly once for ' + mode);
  assert.equal(imports, 1, 'restore multi project once when switching to ' + mode);
  assert.equal(api.state.mode, mode, 'mode CSS must be restored for ' + mode);
  assert.equal(api.state.exiting, false);
  assert.equal(element('maaFullScaleTab')['aria-selected'], 'false');
}
(async () => {
  for (const mode of ['multi', 'single', 'rig']) await visit(mode);

  let releaseImport;
  importGate = new Promise(resolve => { releaseImport = resolve; });
  modeLog = []; imports = 0;
  document.body.dataset.animationAuthorMode = 'scale-compare';
  api.configure();
  const first = api.exit('multi');
  const second = api.exit('rig');
  const third = api.exit('single'); // The user's latest navigation request must win.
  assert.equal(first, second);
  assert.equal(second, third);
  releaseImport();
  await third;
  assert.equal(imports, 1, 'rapid taps must not trigger overlapping actor imports');
  assert.deepEqual(modeLog, ['single'], 'last tab tap must win without reopening another comparison');
  assert.equal(api.state.mode, 'single');

  let releaseSetup;
  const setup = new Promise(resolve => { releaseSetup = resolve; });
  modeLog = []; imports = 0; importGate = null;
  document.body.dataset.animationAuthorMode = 'scale-compare';
  api.configure({ loading: true, setup });
  const duringLoad = api.exit('rig');
  assert.equal(api.state.building, false, 'click during loading cancels the lineup');
  releaseSetup();
  await duringLoad;
  assert.deepEqual(modeLog, ['rig'], 'cancelled build still restores the requested native tab');
  assert.equal(imports, 1, 'pending scratch-project setup must settle before the original project is restored');

  document.body.dataset.animationAuthorMode = 'scale-compare';
  api.configure();
  modeLog = []; imports = 0; failImport = true;
  await api.exit('multi');
  assert.deepEqual(modeLog, ['multi'], 'failed actor import must not trap navigation');
  assert.match(element('statusPill').textContent, /could not be restored/);
  failImport = false;
  console.log('PASS Full Character Scale native tab switching: Multi, Single, Rig, rapid taps, during loading, import failure and mobile panel bounds');
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
// Regression: isolated Full Character Scale never clears, imports, or replaces native animation actors.
const assert = require('node:assert/strict'); // Verifies tab mode, scene visibility, and zero native imports.
const fs = require('node:fs'); // Reads live repository modules.
const vm = require('node:vm'); // Executes browser-only editor handlers without WebGL.

const editor = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Full Character Scale under test.
const host = fs.readFileSync('docs/js/character-scale-comparison-host-bridge.js', 'utf8'); // Native setMode controller.
const native = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Native animation author API.

assert.match(editor, /max-height:min\(68dvh,calc\(100dvh - 150px\)\);overflow-y:auto/, 'panel stays usable on mobile');
assert.match(editor, /#maaTopbar\{z-index:25\}/, 'native tabs stay above the panel');
assert.match(editor, /event\.stopImmediatePropagation\(\)/, 'native tab clicks serialize preview exit');
assert.match(native, /setMode: mode => setAnimationAuthorMode\(mode\)/, 'Rig-aware mode switch stays late-bound');
assert.match(native, /refreshModeChrome: \(\) => renderAnimationModeChrome\(\)/, 'native chrome can restore without changing modes');
assert.match(host, /await api\.setMode\(normalizedMode\);[\s\S]{0,65}api\.refreshModeChrome\?\.\(\);/, 'native chrome refreshed');
assert.doesNotMatch(editor, /MultiAvatarAnimationAuthor\?\.importProject/, 'comparison must not import projects');
assert.doesNotMatch(editor, /scaleHost\.clearActors\(/, 'comparison must not clear actors');
assert.doesNotMatch(editor, /scaleHost\.setMode\('multi'\)/, 'comparison must not switch through Multi');
assert.match(editor, /root = scene\?\.getObjectByName\?\.\('AnimationAuthorWorkspace'\)/, 'master root preserved');
assert.match(editor, /finally \{ restoreNativeWorkspace\(\); \}/, 'failed disposal restores native root');

const PROBE = '  let attempts = 0;'; // Script bootstrap footer used for safe isolated test injection.
assert(editor.includes(PROBE), 'editor bootstrap seam must still exist');
const injected = editor.slice(0, editor.lastIndexOf(PROBE)) + [
  '  window.__navigationTest = {',
  '    begin() {',
  '      ensureUi = () => true;',
  '      loadAgeModifiers = () => {};',
  '      syncAgeControls = () => {};',
  '      buildLineup = async () => {};',
  '      return enter();',
  '    },',
  '    beginWithFailure() {',
  '      ensureUi = () => true;',
  '      loadAgeModifiers = () => {};',
  '      syncAgeControls = () => {};',
  '      buildLineup = async () => { throw Error("failed preview image"); };',
  '      return enter();',
  '    },',
  '    exit,',
  '    get state() { return { active, building, exiting: !!exitingPromise,',
  '      currentTab: document.body.dataset.animationAuthorMode,',
  '      isolated: !!nativeWorkspaceVisibility, isolationDebug: { ...isolationDebug } }; },',
  '  };',
  '})();',
  '',
].join('\n');
assert.notEqual(injected, editor, 'test seam injects real private editor handlers');

const nativeRoot = { visible: true }; // Shared native Multi/Single/Rig root, unchanged except for temporary visibility.
const scene = { getObjectByName: name => name === 'AnimationAuthorWorkspace' ? nativeRoot : null }; // Lookup used by real isolateNativeWorkspace.
const elements = new Map(); // Minimal DOM fixtures for tabs and status.
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, hidden: false, textContent: '', style: {}, offsetParent: {},
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] ?? null; },
  });
  return elements.get(id);
}
const body = {
  dataset: { animationAuthorMode: 'rig' },
  appendChild(node) { elements.set(node.id, node); return node; }, // Startup errors must remain visible even when the scale editor panel hides.
};
const document = {
  currentScript: null, body,
  getElementById: id => id === 'maaFullScaleErrorBanner' && !elements.has(id) ? null : element(id),
  createElement: tag => ({
    tagName: tag, style: {}, textContent: '',
    setAttribute(name, value) { this[name] = value; },
    remove() { elements.delete(this.id); },
  }), // Realistic diagnostic-banner creation rather than returning a fictitious existing element.
};
let imports = 0; // Any project import demonstrates a regression to the old automatic loop.
const modes = []; // Native setMode calls should happen only on explicit exit.
const window = {
  HobunjiFullScaleBodyInputGuard: { applyScaleField() {} },
  HobunjiGameplayBackdrop: { getScene: () => scene },
  HobunjiAnimationAuthorScaleHost: {
    async setMode(mode) {
      modes.push(mode);
      document.body.dataset.animationAuthorMode = mode;
      for (const tab of ['multi', 'single', 'rig'])
        element('maa' + tab[0].toUpperCase() + tab.slice(1) + 'Tab').setAttribute('aria-selected', String(tab === mode));
    },
    serializeRig: () => ({ schema: 'hobunji.attachment-rig-profiles.v10', profiles: { characters: {}, creatures: {} } }),
  },
  MultiAvatarAnimationAuthor: {
    exportProject: () => { throw Error('native project exported by scale comparison'); },
    importProject: () => { imports++; throw Error('native project imported by scale comparison'); },
  },
  ProceduralHandFrameDriver: { syncNow() {} },
};
const store = new Map(); // Profile autosave should not touch the native Multi project.
const localStorage = { getItem: key => store.get(key) ?? null, setItem: (key,val) => store.set(key,val),
  removeItem: key => store.delete(key) };
const context = vm.createContext({
  window, document, localStorage, URL, console,
  location: { pathname: '/tools/animation-author/index.html', href: 'https://example.test/tools/animation-author/index.html' },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
});
vm.runInContext(injected, context);
const api = window.__navigationTest; // Private test-only controls are not exposed by the shipped editor.

async function visit(from, to) {
  nativeRoot.visible = true;
  document.body.dataset.animationAuthorMode = from;
  modes.length = 0;
  await api.begin();
  assert.equal(api.state.currentTab, 'scale-compare', 'comparison opens its own panel');
  assert.equal(nativeRoot.visible, false, 'native actor scene is hidden, not cleared');
  assert.equal(imports, 0, 'opening never imports actor projects');
  assert.deepEqual(modes, [], 'opening never routes through Multi');
  assert.equal(api.state.isolated, true, 'native visibility saved');
  await api.exit(to);
  assert.deepEqual(modes, [to], 'native handoff is direct and once-only');
  assert.equal(nativeRoot.visible, true, 'native actor scene is restored');
  assert.equal(api.state.isolated, false, 'visibility snapshot cleared');
  assert.equal(api.state.active, false);
  assert.equal(imports, 0, 'closing never imports an empty project');
  assert.equal(element('maaFullScaleTab').getAttribute('aria-selected'), 'false');
}
(async () => {
  for (const mode of ['multi', 'single', 'rig']) await visit('rig', mode);
  for (const mode of ['multi', 'single', 'rig']) await visit('single', mode);
  document.body.dataset.animationAuthorMode = 'rig';
  nativeRoot.visible = true;
  modes.length = 0;
  await api.begin();
  const first = api.exit('multi');
  const second = api.exit('rig');
  const third = api.exit('single'); // Last native tab request wins without reimporting actors.
  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
  await third;
  assert.deepEqual(modes, ['single'], 'rapid taps settle directly on the requested mode');
  assert.equal(nativeRoot.visible, true, 'rapid exit restores the hidden native scene');
  assert.equal(imports, 0, 'no automatic Multi/empty import/Rig loop can originate here');
  nativeRoot.visible = false; // Preserve a previously hidden editor workspace.
  document.body.dataset.animationAuthorMode = 'rig';
  await api.begin();
  await api.exit('rig');
  assert.equal(nativeRoot.visible, false, 'an originally hidden workspace stays hidden');
  nativeRoot.visible = true; // A failed preview load must restore Rig without importing actors.
  document.body.dataset.animationAuthorMode = 'rig';
  await api.beginWithFailure();
  assert.equal(nativeRoot.visible, true, 'preview build failure restores native actor visibility');
  assert.match(element('maaFullScaleStatus').textContent, /Could not build scale comparison/, 'failure is visible without devtools');
  assert.match(document.getElementById('maaFullScaleErrorBanner')?.textContent || '', /failed preview image/, 'persistent error banner survives returning to Rig');
  assert.equal(imports, 0, 'preview failure never triggers an empty actor import');
  assert.equal(api.state.isolationDebug.nativeProjectImports, 0, 'mobile diagnostic reports zero project imports');
  assert.ok(api.state.isolationDebug.entries >= 7 && api.state.isolationDebug.exits >= 7, 'repeated entry/exit counted');
  console.log('PASS isolated Full Character Scale: no project imports or Multi detours, tab restoration, repeated visits, rapid taps');
})().catch(error => { console.error(error); process.exitCode = 1; });

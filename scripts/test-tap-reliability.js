#!/usr/bin/env node
'use strict';

// Taps must reach buttons on phones in "desktop site" mode. There the browser ignores <meta viewport>, leaves
// double-tap zoom on and holds each tap back ~300ms; a second tap then zooms the page instead of clicking.
// docs/js/tap-reliability.js is the single owner of the page-wide fix and every page must include it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = file => fs.readFileSync(file, 'utf8');

// ---- the shared script ---------------------------------------------------
function runShared(existing) {
  const created = [];
  const document = {
    head: { prepend: node => created.push(node) },
    documentElement: { prepend: node => created.push(node) },
    getElementById: id => (existing && id === 'hobunjiTapReliability' ? { id } : null),
    createElement: tag => ({ tag, id: '', textContent: '' }),
  };
  vm.runInNewContext(read('docs/js/tap-reliability.js'), { document });
  return created;
}
const injected = runShared(false);
assert.strictEqual(injected.length, 1, 'shared script must inject exactly one style element');
assert.strictEqual(injected[0].id, 'hobunjiTapReliability');
assert(/html,body\{touch-action:manipulation\}/.test(injected[0].textContent), 'root must disable double-tap zoom (touch-action: manipulation)');
assert(/button[^{]*\{[^}]*touch-action:manipulation/.test(injected[0].textContent), 'buttons and other tap targets must disable double-tap zoom too');
assert(!/touch-action:\s*none/.test(injected[0].textContent), 'the shared rule must never take away raw touch input from canvases');
assert.strictEqual(runShared(true).length, 0, 'including the script twice must not inject twice');

// ---- every real page includes it (game, hub, every tool, the pinned-preview wrapper) -------------------------
const pages = ['docs/index.html', 'docs/tools/index.html', 'docs/tools/procedural-animation-editor/commit-pinned-preview.html'];
for (const dir of fs.readdirSync('docs/tools', { withFileTypes: true })) {
  if (!dir.isDirectory() || /-test$/.test(dir.name)) continue; // grounding/rig-space test fixtures are intentionally untouched
  const page = path.join('docs/tools', dir.name, 'index.html');
  if (fs.existsSync(page)) pages.push(page);
}
const missing = pages.filter(page => !/<script src="(?:\.\.\/)*(?:js\/)?(?:\.\.\/)*js\/tap-reliability\.js\?v=[A-Za-z0-9_-]+"><\/script>|<script src="(?:\.\.\/)*js\/tap-reliability\.js\?v=[A-Za-z0-9_-]+"><\/script>/.test(read(page)));
assert.deepStrictEqual(missing, [], `pages without docs/js/tap-reliability.js: ${missing.join(', ')}`);
assert(pages.length >= 30, `expected to cover the game and all tools, found only ${pages.length} pages`);

// ---- Enlarge: a double tap opens the window once ---------------------------
function makeEnlargeHarness() {
  const handlers = new Map(); // button -> click handler
  const makeEl = () => {
    const el = { style: { setProperty() {}, removeProperty() {} }, dataset: {}, className: '', textContent: '', title: '', attrs: {}, children: [], _classes: new Set() };
    el.classList = { add: (...c) => c.forEach(x => el._classes.add(x)), remove: (...c) => c.forEach(x => el._classes.delete(x)), toggle: (c, on) => { if (on === undefined ? !el._classes.has(c) : on) el._classes.add(c); else el._classes.delete(c); }, contains: c => el._classes.has(c) };
    el.setAttribute = (k, v) => { el.attrs[k] = v; };
    el.addEventListener = (type, fn) => { if (type === 'click') handlers.set(el, fn); };
    el.appendChild = child => { el.children.push(child); return child; };
    el.querySelector = sel => el.children.find(child => sel.split('.').some(part => part && child.className.split(' ').includes(part))) || null;
    return el;
  };
  const row = makeEl();
  const canvas = makeEl(); canvas.width = 760; canvas.height = 760; canvas.id = 'pantsCanvas'; canvas.closest = () => ({ clientWidth: 600, clientHeight: 600, scrollWidth: 600, scrollHeight: 600 });
  const card = makeEl();
  card.querySelector = sel => (sel === '.row' ? row : sel === 'canvas.author' ? canvas : sel === '.row strong' ? { textContent: 'Pants PNG workspace' } : row.querySelector(sel));
  const posted = [];
  const documentElement = makeEl();
  const document = {
    readyState: 'complete',
    head: makeEl(),
    documentElement,
    createElement: () => makeEl(),
    getElementById: () => null,
    querySelectorAll: () => [card],
    addEventListener() {},
  };
  const win = { addEventListener() {}, parent: null, location: { origin: 'https://example.test' } };
  win.parent = { postMessage: message => posted.push(message) };
  const sandbox = { window: win, document, performance: { now: () => clock.t }, requestAnimationFrame: () => {}, setTimeout: () => 0 };
  const clock = { t: 1000 };
  sandbox.window.document = document;
  vm.createContext(sandbox);
  vm.runInContext(read('docs/tools/pants-rig-author/workspace-enlarge.js'), sandbox);
  const enlargeButton = row.children.find(child => child.className.includes('pantsEnlargeBtn'));
  return { click: () => handlers.get(enlargeButton)(), clock, posted, card, api: win.PantsRigWorkspaceEnlarge, style: document.head.children[0] };
}

const h = makeEnlargeHarness();
assert(h.api, 'workspace-enlarge did not publish its API');
assert(/\.pantsEnlargeBtn,\.pantsZoomBtn,\.pantsPanBtn\{[^}]*touch-action:manipulation/.test(h.style.textContent), 'Enlarge/Zoom/Pan buttons must be touch-action: manipulation');
assert(/@media\(pointer:coarse\)\{[^}]*pantsEnlargeBtn[^}]*min-height:44px/.test(h.style.textContent), 'touch screens need 44px Enlarge buttons');

h.click(); // first tap opens
assert.strictEqual(h.api.active(), 'pantsCanvas', 'first tap must enlarge the workspace');
h.clock.t += 90; h.click(); // second tap of a double tap, 90ms later
assert.strictEqual(h.api.active(), 'pantsCanvas', 'a double tap must not close the window it just opened');
h.clock.t += 600; h.click(); // a deliberate later tap closes it
assert.strictEqual(h.api.active(), null, 'a later tap must still exit the enlarged window');
assert(h.posted.some(m => m.enlarged === true && m.title === 'Pants PNG workspace'), 'host must be told which workspace opened');

console.log('Tap reliability: PASS');

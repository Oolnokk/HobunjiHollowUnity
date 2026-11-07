#!/usr/bin/env node
'use strict';

// Lightweight DOM integration smoke for the production Leatherworking overlay.
// No headless browser or gameplay boot is needed; this exercises the actual UI handlers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/fur-hood-leatherworking.js'), 'utf8'); // Same module that gameplay and the Pattern Editor load.
const exampleHide = { // Provides a real genotype-bearing hide for the preview and recipe selectors.
  itemKey: 'wolfHide', kind: 'gar-wolf', stars: 4,
  genotype: { base: { color: '#997755' } }, appearance: { baseColor: '#997755', patterns: [] },
};
const requests = []; // Captures the exact hood, colors and view handed to the existing clothing compositor.
let deferNextRender = null; // A deferred render lets the test catch stale async results after closing.
const keydownHandlers = new Set(); // Exposes leaking or unremoved Escape listeners after repeated opening.
const panels = []; // Holds overlays so an old closed overlay can be inspected after reopening.

class TestElement {
  constructor(tag = 'div') {
    this.tag = tag.toLowerCase(); this.attrs = new Map(); this.nodes = new Map();
    this.children = []; this.style = {}; this.value = ''; this.textContent = ''; this.src = '';
    this.hidden = false; this.isConnected = false; this.events = new Map();
  }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  hasAttribute(key) { return this.attrs.has(key); }
  removeAttribute(key) { this.attrs.delete(key); if (key === 'src') this.src = ''; }
  set innerHTML(html) {
    this.markup = html;
    this.nodes.clear();
    for (const tag of html.matchAll(/<(button|select|span|img|output)\b[^>]*>/g)) {
      const data = tag[0].match(/\bdata-(action|field|view)="([^"]+)"/);
      if (!data) continue;
      const el = new TestElement(tag[1]);
      el.setAttribute('data-' + data[1], data[2]);
      if (/\sdata-ctrl-cancel(?:\s|>)/.test(tag[0])) el.setAttribute('data-ctrl-cancel', '');
      el.hidden = /\shidden(?:\s|>)/.test(tag[0]);
      if (data[2] === 'hood-kind') el.value = 'fur_lined_hood';
      this.nodes.set('[data-' + data[1] + '="' + data[2] + '"]', el);
    }
  }
  get innerHTML() { return this.markup || ''; }
  querySelector(selector) { return this.nodes.get(selector) || null; }
  appendChild(child) {
    this.children.push(child);
    if (this.tag === 'select' && child.tag === 'option' && this.children.length === 1) this.value = child.value;
    if (this.tag === 'body') { child.isConnected = true; panels.push(child); }
    return child;
  }
  addEventListener(name, fn) { this.events.set(name, fn); }
  remove() { this.isConnected = false; }
}

const document = { // Represents the minimal browser DOM used by openLoom, not the unrelated game scene.
  currentScript: { src: 'https://example.test/docs/js/fur-hood-leatherworking.js' },
  readyState: 'complete',
  body: new TestElement('body'),
  createElement: name => new TestElement(name),
};
const window = {
  AnimalHides: {
    isHide: key => key === 'wolfHide',
    groupsFor: (_key, count) => [{ count, variant: 'wolf-brown', stars: 4, hideRecord: exampleHide }],
    consume() { throw new Error('The preview must not craft items.'); },
  },
  SCRATCHBONES_CONFIG: { game: { creatureGenetics: { palettes: { wolf: [{ name: 'Brown', hex: '#997755' }] } } } },
  DyeSystem: {
    ensureCollection() {},
    getCatalog: () => [{ id: 'blue', label: 'Blue', hex: '#3366cc' }, { id: 'red', label: 'Red', hex: '#cc3333' }],
    owns: () => true,
  },
  ClothingWeavingSystem: {
    renderClothingLayers(id, options) {
      requests.push({ id, options: { ...options } });
      if (deferNextRender) {
        const deferred = deferNextRender;
        deferNextRender = null;
        return new Promise(resolve => { deferred.resolve = resolve; });
      }
      return Promise.resolve({ canvas: { width: 234, height: 173, toDataURL: () => 'data:image/png;base64,preview' } });
    },
  },
  addEventListener(name, handler) { if (name === 'keydown') keydownHandlers.add(handler); },
  removeEventListener(name, handler) { if (name === 'keydown') keydownHandlers.delete(handler); },
};
vm.runInNewContext(source, {
  window, document, URL,
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_fur_hoods.v1', species: {} }) }),
}, { filename: 'fur-hood-leatherworking.js' });

const api = window.FurHoodLeatherworking;
const deps = { inventory: { wolfHide: 1 }, getPackClothing: () => [], showToast() {} };
const flush = () => new Promise(resolve => setImmediate(resolve)); // Settles resolved compositor and manifest Promises between UI actions.
const get = (panel, category, key) => panel.querySelector('[data-' + category + '="' + key + '"]');

async function main() {
  assert.equal(api.openLoom(deps, { advanced: false }), true);
  const first = panels.at(-1);
  const preview = get(first, 'view', 'preview');
  const message = get(first, 'view', 'message');
  assert(first.isConnected && first.hasAttribute('data-ctrl-panel'), 'Leatherworking registers one live controller modal');
  assert(get(first, 'action', 'close').hasAttribute('data-ctrl-cancel'), 'Controller Cancel/Menu have a close target');
  assert.match(first.innerHTML, /furhood-preview-card/, 'own preview exists alongside recipe fields');
  assert.equal(keydownHandlers.size, 1, 'one Escape handler is installed');
  await flush();
  assert.equal(requests.at(-1).id, 'fur_lined_hood', 'default lined style previews through the normal renderer');
  assert.equal(requests.at(-1).options.primaryHex, '#3366cc', 'selected dye reaches the compositor');
  assert.equal(requests.at(-1).options.secondaryHex, '#997755', 'real genotype tint reaches the compositor');
  assert.equal(preview.src, 'data:image/png;base64,preview', 'the final garment bitmap is shown');
  assert.equal(preview.hidden, false, 'loaded preview image is visible');
  assert.equal(message.hidden, true, 'loading label disappears after rendering');

  get(first, 'field', 'dye').value = 'red';
  get(first, 'field', 'dye').onchange();
  await flush();
  assert.equal(requests.at(-1).options.primaryHex, '#cc3333', 'a dye change refreshes the preview');

  get(first, 'field', 'hood-kind').value = 'fur_hood';
  get(first, 'field', 'hood-kind').onchange();
  await flush();
  assert.equal(requests.at(-1).id, 'fur_hood', 'trophy hood uses the same production renderer');
  assert.equal(requests.at(-1).options.furHood.kind, 'gar-wolf', 'full inherited animal details are preserved');

  get(first, 'action', 'view').onclick({ target: get(first, 'action', 'view') });
  await flush();
  assert.equal(requests.at(-1).options.view, 'behind', 'view toggle renders the rear garment');
  assert.match(preview.alt, /behind view/, 'preview description reflects the chosen view');

  get(first, 'action', 'close').onclick(); // Exact button used by the game's semantic uiCancel and uiOpenMenu navigator.
  assert(!first.isConnected, 'Cancel target closes the overlay');
  assert.equal(keydownHandlers.size, 0, 'close releases the Escape handler');

  api.openLoom(deps);
  const second = panels.at(-1);
  await flush();
  let prevented = false, stopped = false;
  for (const onKeydown of [...keydownHandlers]) onKeydown({
    key: 'Escape', preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; },
  });
  assert(!second.isConnected, 'Escape closes the currently open overlay');
  assert(prevented && stopped, 'Escape is consumed before gameplay handlers');
  assert.equal(keydownHandlers.size, 0, 'Escape also releases its own handler');

  const pending = {}; // A late compositor result must never resurrect a dismissed dialog.
  deferNextRender = pending;
  api.openLoom(deps);
  const third = panels.at(-1);
  const stalePreview = get(third, 'view', 'preview');
  api.closePanel();
  pending.resolve({ canvas: { width: 234, height: 173, toDataURL: () => 'data:image/png;base64,stale' } });
  await flush();
  assert(!third.isConnected && !stalePreview.src, 'late render cannot update a closed panel');
  assert.equal(keydownHandlers.size, 0, 'no key handler remains after delayed preview');
  console.log('OK: Leatherworking preview, dye/hide/hood view, Cancel/Menu target, Escape and stale async result');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

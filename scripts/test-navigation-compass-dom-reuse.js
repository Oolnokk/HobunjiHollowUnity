// The compass strip re-renders at ~30 Hz. It used to replaceChildren() and
// recreate every marker span each time, queueing childList mutations for every
// body-wide MutationObserver even while nothing on the strip changed. This
// drives the real renderIndicators() against a minimal fake DOM and checks that
// spans are reused and an unchanged strip performs no DOM writes at all.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let writes = 0; // Every DOM mutation the fake elements see.
let created = 0;

function makeStyle() {
  const props = new Map();
  return {
    getPropertyValue: name => props.get(name) || '',
    setProperty(name, value) { writes++; props.set(name, String(value)); },
    removeProperty(name) { writes++; props.delete(name); },
  };
}

function makeElement() {
  created++;
  const element = {
    style: makeStyle(),
    attributes: new Map(),
    parent: null,
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
    hasAttribute(name) { return this.attributes.has(name); },
    setAttribute(name, value) { writes++; this.attributes.set(name, String(value)); },
    removeAttribute(name) { writes++; this.attributes.delete(name); },
    remove() { writes++; const kids = this.parent.children; kids.splice(kids.indexOf(this), 1); this.parent = null; },
  };
  for (const key of ['className', 'textContent', 'title']) {
    let value = '';
    Object.defineProperty(element, key, { get: () => value, set(next) { writes++; value = String(next); } });
  }
  return element;
}

const layer = {
  children: [],
  appendChild(child) { writes++; child.parent = layer; layer.children.push(child); return child; },
  get lastElementChild() { return layer.children[layer.children.length - 1] || null; },
  replaceChildren() { throw new Error('renderIndicators must reuse spans instead of replaceChildren()'); },
};

const context = {
  console, Math, Number, Object, Array, Map, String,
  performance: { now: () => 0 },
  requestAnimationFrame() { return 1; },
  document: { createElement: makeElement, getElementById() { return null; } },
  RuntimeFrameScheduler: { register() { return () => {}; } },
  WildernessMap: { getCompassWaypoint: () => null }, // Present so the module skips its script-reload fallback.
};
context.window = context;
vm.createContext(context);
const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'navigation-compass.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
const { renderIndicators } = context.NavigationCompass._test;

const cardinals = [
  { id: 'east', label: 'E', symbol: 'E', angle: 0 },
  { id: 'north', label: 'N', symbol: 'N', angle: -Math.PI / 2 },
];
const marker = { id: 'quest:1', label: 'Quest', symbol: '!', color: '#ff0', col: 10, row: 0 };

let markers = renderIndicators(layer, [...cardinals, marker], 0, 0, 0);
assert.equal(layer.children.length, 3, 'two cardinals and one target are on-strip');
assert.equal(markers.length, 1, 'distance markers are reported for debug');
const target = layer.children[2];
assert.equal(target.className, 'nav-compass-marker');
assert.equal(target.style.getPropertyValue('color'), '#ff0');
assert.equal(target.getAttribute('aria-label'), target.title);

writes = 0; created = 0;
renderIndicators(layer, [...cardinals, marker], 0, 0, 0);
assert.equal(created, 0, 'an identical update reuses existing spans');
assert.equal(writes, 0, 'an identical update performs no DOM writes');

// Fewer entries trims surplus spans; a span reused for a cardinal sheds
// the distance-marker-only properties it carried before.
renderIndicators(layer, [cardinals[0], { ...cardinals[1], id: 'west', label: 'W', symbol: 'W', angle: 0.3 }], 0, 0, 0);
assert.equal(layer.children.length, 2, 'surplus spans are removed');
renderIndicators(layer, [marker, cardinals[0]], 0, 0, 0);
renderIndicators(layer, [cardinals[0], cardinals[1]], 0, 0, 0);
const reused = layer.children[0];
assert.equal(reused.className, 'nav-compass-cardinal');
assert.equal(reused.style.getPropertyValue('color'), '', 'cardinal reuse clears marker color');
assert.equal(reused.title, '', 'cardinal reuse clears marker title');
assert.equal(reused.hasAttribute('aria-label'), false, 'cardinal reuse clears marker aria-label');

console.log('navigation compass DOM reuse: ok');

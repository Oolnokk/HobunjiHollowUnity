'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Used to resolve the production compass module under test from the repository root.
const source = fs.readFileSync(path.join(root, 'docs/js/navigation-compass.js'), 'utf8'); // Used to execute the real parser-time recovery logic instead of a copied helper.
const appendedScripts = []; // Used to capture the one cache-busted wilderness-map retry requested by the fallback bootstrap.
const debugMessages = []; // Used to verify the missing required module becomes visible in the in-game-style diagnostic channel.
let recoveredInitDeps = null; // Used to prove dependencies captured by fallback init are replayed into a late-arriving real WildernessMap module.

const document = {
  currentScript: { src: 'https://example.test/docs/js/navigation-compass.js?v=test' },
  baseURI: 'https://example.test/docs/',
  head: { appendChild(script) { appendedScripts.push(script); } },
  createElement(tag) {
    if (tag === 'script') return {};
    return {
      className: '', textContent: '', title: '',
      style: { setProperty() {} },
      setAttribute() {},
    };
  },
  getElementById() { return null; },
};

const context = {
  console,
  document,
  URL,
  Math,
  performance: { now: () => 0 },
  requestAnimationFrame() {},
  __farmLog(message, level) { debugMessages.push({ message, level }); },
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'navigation-compass.js' });

const fallback = context.WildernessMap;
assert.equal(fallback?.__loadFallback, true, 'missing WildernessMap must install a non-crashing fallback before game.js can run');
assert.equal(typeof fallback.updateFogAroundPlayer, 'function', 'fallback must cover the unconditional game-loop fog update');
assert.equal(typeof fallback.renderMapPanel, 'function', 'fallback must cover the unguarded Map-tab render call');
assert.equal(appendedScripts.length, 1, 'missing parser-time module must trigger exactly one retry');
assert.match(appendedScripts[0].src, /wilderness-map\.js\?v=20260909loadretry1$/, 'retry must bypass the stale/missed parser-time URL');

const deps = { marker: 'game-init-deps' };
fallback.init(deps);
assert(debugMessages.some(entry => /namespace was missing before game initialization/.test(entry.message)), 'fallback init must publish a useful mobile-visible diagnostic');
assert.equal(appendedScripts.length, 1, 'fallback init must not create a second retry while one is already in flight');

context.WildernessMap = {
  init(injectedDeps) { recoveredInitDeps = injectedDeps; },
  getCompassWaypoint() { return null; },
};
appendedScripts[0].onload();
assert.equal(recoveredInitDeps, deps, 'late real module must receive the dependencies captured during fallback game initialization');
assert.equal(context.WildernessMap.__loadFallback, undefined, 'successful retry must leave the real WildernessMap authoritative');
assert(debugMessages.some(entry => /Recovered wilderness-map\.js/.test(entry.message)), 'successful recovery should be visible in diagnostics');

console.log('wilderness map load recovery regression checks passed');

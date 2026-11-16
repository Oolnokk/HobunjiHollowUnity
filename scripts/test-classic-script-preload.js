#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('docs/index.html', 'utf8'); // The shipped parser order defines the authoritative group list.
const preloadSource = fs.readFileSync('docs/js/bootstrap/classic-script-preload.js', 'utf8'); // The real early preload entrypoint.
const loaderSource = fs.readFileSync('docs/js/bootstrap/classic-script-group-loader.js', 'utf8'); // The parser-blocking loader whose requests should reuse preloads.
const groups = [...html.matchAll(/data-classic-group="([a-z][a-z0-9-]*)"/g)].map(match => match[1]); // The actual group names from index.html.
const preloadScript = /src="js\/bootstrap\/classic-script-preload\.js\?v=[A-Za-z0-9_-]+"/; // The version token must remain free to change without breaking tests.
assert(preloadScript.test(html), 'game index includes the new preloader');
assert(html.search(preloadScript) > html.indexOf('js/storage-quota-guard.js'), 'storage quota guard must stay first among local scripts');
assert(html.search(preloadScript) < html.indexOf('js/precreator-arena.js'), 'preloads start before other game scripts');
new vm.Script(preloadSource, { filename: 'classic-script-preload.js' });
new vm.Script(loaderSource, { filename: 'classic-script-group-loader.js' });

function simulate(pathname) {
  const links = []; // Network hints inserted before any group loader runs.
  const timers = []; // Captures the stall fallback without waiting fifteen seconds.
  const listeners = new Map(); // DOMContentLoaded removes the visible diagnostic.
  const dom = new Map(); // Visible notice nodes created during the slow-path check.
  const htmlElement = { appendChild(node) { dom.set(node.id, node); } }; // Pre-body fallback host.
  const document = {
    readyState: 'loading',
    head: { appendChild(node) { links.push(node); } },
    documentElement: htmlElement,
    body: null,
    createElement(tag) {
      const node = { tag, style: {}, setAttribute(name, value) { this[name] = value; }, remove() { dom.delete(this.id); } }; // Fake link or notice with enough DOM behavior for both paths.
      return node;
    },
    getElementById(id) { return dom.get(id) || null; },
    addEventListener(type, cb) { listeners.set(type, cb); },
    currentScript: { getAttribute(name) { return name === 'data-classic-group' ? groups[0] : null; } },
    write(markup) { this.writes.push(markup); },
    writes: [],
  };
  const window = {
    location: { pathname },
    addEventListener() {},
    setTimeout(cb, ms) { timers.push({ cb, ms }); },
  };
  const clock = { now() { return 87654321; } }; // Fixed time verifies matching URLs without relying on wall time.
  vm.runInNewContext(preloadSource, { window, document, Date: clock });
  return { links, timers, listeners, dom, document, window, clock };
}

for (const path of [
  '/Oolnokk/HobunjiHollowUnity/main/docs/index.html',
  '/Oolnokk/HobunjiHollowUnity/0123456789abcdef0123456789abcdef01234567/docs/index.html',
  '/gh/Oolnokk/HobunjiHollowUnity@0123456789abcdef0123456789abcdef01234567/docs/index.html',
]) {
  const result = simulate(path); // Test mutable URLs and both supported commit-pinned CDNs.
  const { links, window, document, clock } = result;
  const token = path.includes('/main/') ? '87654321' : '0123456789abcdef0123456789abcdef01234567';
  assert.equal(window.HobunjiClassicScriptPreload.token, token, 'mutability determines manifest cache token');
  assert.equal(links.length, groups.length, 'one preload is issued per shipped group');
  assert.deepEqual([...new Set(links.map(link => link.href))].length, groups.length, 'preload URLs are unique');
  assert.deepEqual(links.map(link => link.href.split('/').pop()), groups.map(name => name + '.js?load=' + token), 'preloads follow canonical manifest ordering');
  assert(links.every(link => link.rel === 'preload' && link.as === 'script' && link.fetchPriority === 'low'), 'all preloads use low-priority script resource hints');
  // The original synchronous loader must still run at its original parser slot.
  vm.runInNewContext(loaderSource, { window, document, Date: clock });
  assert.equal(document.writes.length, 1, 'loader inserts one synchronous parser-ordered manifest');
  assert(document.writes[0].includes(links[0].href), 'loader request exactly matches its preloaded URL');
  assert.equal(window.HobunjiClassicScriptPreload.reached, 1, 'diagnostics count actual parser positions');
  assert.equal(window.HobunjiClassicScriptPreload.lastGroup, groups[0], 'diagnostics identify the most recent group');

  // No notice should appear on a normal, completed parse.
  assert.equal(result.timers.length, 1);
  assert.equal(result.timers[0].ms, 15000);
  document.readyState = 'complete';
  result.timers[0].cb();
  assert.equal(result.dom.size, 0, 'completed pages never show a false stall notice');
  // When head parsing really stalls, provide a lightweight notice even without a body.
  document.readyState = 'loading';
  result.timers[0].cb();
  assert.equal(result.dom.get('hobunjiSlowStartup').role, 'status');
  assert.match(result.dom.get('hobunjiSlowStartup').textContent, /reached 1\//);
  result.listeners.get('DOMContentLoaded')();
  assert.equal(result.dom.size, 0, 'notice disappears after the parser resumes');
}
console.log('Classic group preloads preserve parser order, URL matching, and mobile stall diagnostics.');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const panelSource = fs.readFileSync('docs/js/panel-ui.js', 'utf8'); // Executes the shipping tool bootstrap so parser-time dependency order cannot drift unnoticed.
const writes = []; // Captures document.write output used by Animation Author during normal parser-time startup.
const context = vm.createContext({ // Supplies only the browser state needed by panel-ui.js's synchronous bootstrap path.
  window: {},
  location: { href: 'https://example.test/tools/animation-author/index.html', pathname: '/tools/animation-author/index.html' },
  URL,
  document: {
    readyState: 'loading',
    currentScript: { src: 'https://example.test/js/panel-ui.js' },
    write(html) { writes.push(String(html)); },
  },
});
vm.runInContext(panelSource, context, { filename: 'docs/js/panel-ui.js' });

assert.equal(writes.length, 1, 'PanelUI parser-time bootstrap should emit one ordered script chain');
const chain = writes[0]; // Used to compare ColorFill and PanelUI/core positions in the exact emitted markup.
const colorFillIndex = chain.indexOf('color-fill.js'); // Must precede all Animation Author inline runtime loading of portrait-utils.js.
const coreIndex = chain.indexOf('panel-ui-core.js'); // Existing first shared PanelUI dependency remains after the Animation Author-only prerequisite.
assert(colorFillIndex >= 0, 'Animation Author must preload color-fill.js');
assert(coreIndex >= 0, 'PanelUI core must remain in the bootstrap chain');
assert(colorFillIndex < coreIndex, 'ColorFill must load before the rest of the Animation Author page can load portrait-utils.js');

const breathing = JSON.parse(fs.readFileSync('docs/config/animations/breathing-default.json', 'utf8')); // Guards the runtime URL requested by portrait-breathing.js and the Animation Author catalog.
assert.equal(breathing.gridCols, 4);
assert.equal(breathing.gridRows, 6);
assert(Array.isArray(breathing.poses) && breathing.poses.length >= 2, 'default breathing animation must provide at least two poses');
assert.equal(breathing.poseDurations.length, breathing.poses.length, 'default breathing durations must match pose count');
for (const pose of breathing.poses) {
  assert.equal(pose.points.length, breathing.gridCols * breathing.gridRows, `${pose.label || 'unnamed'} breathing pose must cover the full control grid`);
}

const portraitSource = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Ensures the test continues protecting the dependency that originally produced the user-visible actor-add error.
assert.match(portraitSource, /ColorFill must load before portrait-utils\.js/);
console.log('Animation Author ColorFill ordering and default breathing asset checks passed.');

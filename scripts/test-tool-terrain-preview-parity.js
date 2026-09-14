'use strict';

const fs = require('fs'); // Used to statically verify the shared Tool Hub parity bootstrap without needing a browser.
const path = require('path'); // Used to resolve repository-relative source files consistently.

const wrapper = fs.readFileSync(path.join(__dirname, '../docs/js/panel-ui.js'), 'utf8');
const parity = fs.readFileSync(path.join(__dirname, '../docs/js/tool-terrain-preview-parity.js'), 'utf8');

for (const expected of ['panel-ui-core.js', 'tool-terrain-preview-parity.js', 'document.write']) {
  if (!wrapper.includes(expected)) throw new Error(`panel-ui wrapper missing bootstrap contract: ${expected}`);
}
for (const expected of [
  "ensureScript('../config/natural-surface-materials.js'",
  "ensureScript('./natural-surface-materials.js'",
  "ensureScript('./surface-stretch-uv-furniture.js'",
  'Native full-PNG span',
  'Protected source edge',
  'edgeReferenceWorldSize: settings.span',
  'edgeSourceFraction: settings.edge',
  'THREE?.WebGLRenderer',
  'requestAnimationFrame',
  'iframe',
  'window.TerrainPreview || window.BorderTerrain',
]) {
  if (!parity.includes(expected)) throw new Error(`tool terrain parity missing contract: ${expected}`);
}
console.log('Tool Hub terrain preview parity static regression passed.');

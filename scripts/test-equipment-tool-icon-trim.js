#!/usr/bin/env node
'use strict';

// Cold tool thumbnails must preserve authored opaque bounds and bottom-edge
// crop placement when their scan is optimized. The test uses the real module.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/equipment-panel.js', 'utf8');
const width = 7, height = 9; // Tiny source exercises opaque pixels at opposite corners of the trim.
const rgba = new Uint8ClampedArray(width * height * 4);
for (const [x, y] of [[1, 2], [3, 8]]) rgba[(y * width + x) * 4 + 3] = 255;

const canvases = []; // Captures which canvas is source versus final 128px thumbnail.
const document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const drawCalls = [];
    const canvas = {
      width: 0, height: 0, drawCalls,
      getContext(type) {
        assert.equal(type, '2d');
        return {
          drawImage: (...args) => drawCalls.push(args),
          getImageData: () => ({ data: rgba }),
        };
      },
      toDataURL: () => 'data:image/png;base64,test',
    };
    canvases.push(canvas);
    return canvas;
  },
};
let clock = 100; // Deterministic clock makes the thumbnail performance diagnostic testable.
const window = {};
vm.runInNewContext(source, { window, document, performance: { now: () => clock++ } }, { filename: 'equipment-panel.js' });
const tool = window.EquipmentPanel;
const image = { width, height };

assert.equal(tool.squareToolIcon(image), 'data:image/png;base64,test');
assert.equal(canvases[0].width, width);
assert.equal(canvases[1].width, 128);
assert.deepEqual(canvases[1].drawCalls[0].slice(1), [1, 6, 3, 3, 0, 0, 128, 128],
  'ordinary tools crop the bottommost square at the same opaque bounds as before');
assert.deepEqual(JSON.parse(JSON.stringify(tool.getIconDebug().lastFrame)), { left: 1, right: 3, top: 2, bottom: 8, side: 3 },
  'mobile diagnostics report the correct opaque bounds');
assert.equal(tool.getIconDebug().lastTrimMs, 1);

tool.squareToolIcon(image, { flute: true });
assert.deepEqual(canvases[3].drawCalls[0].slice(1), [1, 2, 3, 7, 40, 8, 48, 112],
  'flute thumbnails keep their full authored height and original scale');
assert.equal(tool.getIconDebug().slowestTrimMs, 1);
console.log('tool icon crop parity and mobile timing diagnostics passed');

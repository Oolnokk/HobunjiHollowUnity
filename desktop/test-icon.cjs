'use strict';

// Windows build regression: exercise the real asset and pixel-preserving converter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const { SOURCE_ICON, ICON_SIZE, generateDesktopIcon } = require('./prepare-icon.cjs');

const source = PNG.sync.read(fs.readFileSync(SOURCE_ICON)); // Authored image used by game and updater windows.
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hobunji-desktop-icon-')); // Test artifacts never enter the installer.

try {
  const target = path.join(folder, 'icon.png'); // Full-size image destined for electron-builder.
  generateDesktopIcon({ outputPath: target });
  const icon = PNG.sync.read(fs.readFileSync(target)); // Verify the actual bytes produced by the build step.
  assert.equal(icon.width, ICON_SIZE);
  assert.equal(icon.height, ICON_SIZE);
  for (const [x, y] of [[0, 0], [Math.floor(ICON_SIZE / 2), Math.floor(ICON_SIZE / 2)], [ICON_SIZE - 1, ICON_SIZE - 1]]) {
    const sx = Math.floor(x * source.width / ICON_SIZE); // Pixel expected after nearest-neighbor resampling.
    const sy = Math.floor(y * source.height / ICON_SIZE); // Row expected after nearest-neighbor resampling.
    const from = (sy * source.width + sx) * 4; // RGBA offset into original artwork.
    const to = (y * ICON_SIZE + x) * 4; // RGBA offset into output icon.
    assert.deepEqual([...icon.data.subarray(to, to + 4)], [...source.data.subarray(from, from + 4)],
      'Icon must preserve the source pixel and alpha channel');
  }
  assert.throws(() => generateDesktopIcon({ size: 107, outputPath: target }), /at least|between 256/);
  assert.throws(() => generateDesktopIcon({ sourcePath: path.join(folder, 'missing.png'), outputPath: target }), /ENOENT/);
  console.log('Windows desktop icon: PNG source, 512px conversion and transparency OK');
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}

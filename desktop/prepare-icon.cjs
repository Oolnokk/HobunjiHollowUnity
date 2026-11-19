'use strict';

// Produce an electron-builder-compatible icon without altering the source artwork.
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const SOURCE_ICON = path.resolve(__dirname, '../docs/assets/hud/icon_hobunji.png'); // Original game icon, shared by both desktop editions.
const BUILD_ICON = path.join(__dirname, 'build', 'icon.png'); // Larger Windows packaging image, deliberately not checked in.
const ICON_SIZE = 512; // Windows icon conversion needs at least 256 px; use 512 for clean scaling.

function generateDesktopIcon({ sourcePath = SOURCE_ICON, outputPath = BUILD_ICON, size = ICON_SIZE } = {}) {
  if (!Number.isInteger(size) || size < 256 || size > 1024) {
    throw new RangeError('Windows app icon size must be an integer between 256 and 1024.');
  }
  const source = PNG.sync.read(fs.readFileSync(sourcePath)); // Decoded RGBA pixels from the authored icon.
  if (source.width !== source.height || !source.width) {
    throw new Error('Hobunji desktop icon must be a nonempty square PNG.');
  }
  const output = new PNG({ width: size, height: size }); // Nearest-neighbor preserves the authored pixel-art edges.
  for (let y = 0; y < size; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / size)); // Corresponding source row.
    for (let x = 0; x < size; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / size)); // Corresponding source column.
      const from = (sourceY * source.width + sourceX) * 4; // Source RGBA byte offset.
      const to = (y * size + x) * 4; // Destination RGBA byte offset.
      source.data.copy(output.data, to, from, from + 4);
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, PNG.sync.write(output));
  return { sourcePath, outputPath, size };
}

if (require.main === module) {
  try {
    const result = generateDesktopIcon(); // The prepack step creates the icon before electron-builder starts.
    console.log('Generated Windows app icon:', result.outputPath);
  } catch (error) {
    console.error('Could not generate Hobunji desktop icon:', error);
    process.exitCode = 1;
  }
}

module.exports = { SOURCE_ICON, BUILD_ICON, ICON_SIZE, generateDesktopIcon };

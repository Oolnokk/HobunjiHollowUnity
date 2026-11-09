'use strict';
const assert = require('node:assert/strict'); // Guards dynamic HTML editor scripts and their separate overpass ink controls.
const fs = require('node:fs'); // Uses the real shipped editor pages.
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'); // Repository root for authoring and runtime sources.
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function checkInlineScripts(page) {
  const html = read(page); // Avoids false confidence from node --check on external .js files only.
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1])); // Embedded controllers compile as plain scripts in these non-module pages.
  assert(inline.length > 0, page + ': has inline controllers');
  for (let i = 0; i < inline.length; i++) {
    new vm.Script(inline[i][2], { filename: page + ':inline-' + (i + 1) }); // Finds syntax errors not detected by CI's external-js lint.
  }
  return html;
}
const patternEditor = checkInlineScripts('docs/tools/pattern-editor/index.html');
const characterStudio = checkInlineScripts('docs/tools/character-studio/index.html');
const furnitureEditor = checkInlineScripts('docs/tools/furniture-avatar-author/index.html');
assert.match(patternEditor, /id="overpassInkColor"/, 'Pattern Editor provides separate overpass color input');
assert.match(patternEditor, /inkColorHex:\s*\$\('overpassInkColor'\)\.value/, 'preview passes that color into the shared compositor');
assert.match(characterStudio, /data-npc-overpass-ink/, 'NPC clothing editor exposes its own overpass dye');
assert.match(furnitureEditor, /foliage-furniture-mode\.js\?v=/, 'furniture authoring page loads its pattern extension');
const furniturePatterns = read('docs/tools/furniture-avatar-author/furniture-patterns.js');
assert.match(furniturePatterns, /id="fpOverpassDye"/, 'furniture authoring has a dedicated overpass swatch');
const surfaceRuntime = read('docs/js/furniture-pattern-surfaces.js');
assert.match(surfaceRuntime, /inkColorHex:\s*record\.palette\[2\]/, 'furniture overpass ink reaches the same compositor');
const weaving = read('docs/js/clothing-weaving-system.js');
assert.match(weaving, /overpassInkHex/, 'the shared compositor recognizes independent overpass dyes');
assert.match(weaving, /secondPattern\.inkColorHex/, 'Advanced Loom persists the chosen second ink with its garment');
console.log('Inline editor scripts parse and their independent overpass dye controls are wired');

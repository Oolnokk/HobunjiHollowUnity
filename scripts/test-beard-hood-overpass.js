'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fitRoot = 'docs/tools/clothing-species-fit';
const appParts = Array.from({ length: 12 }, (_, index) => fs.readFileSync(`${fitRoot}/app.part${index + 1}.txt`, 'utf8'));
const maskAuthor = fs.readFileSync(`${fitRoot}/app.part13.txt`, 'utf8');
const closeAt = appParts[11].lastIndexOf('})();');
assert.ok(closeAt >= 0, 'the twelve core chunks retain their standalone closure');
appParts[11] = appParts[11].slice(0, closeAt) + maskAuthor + '\n})();' + appParts[11].slice(closeAt + 5);
const appSource = appParts.join('');
new vm.Script(appSource, { filename: 'clothing-species-fit-app.js' }); // The split editor must still compile as one private-scope application.

const html = fs.readFileSync(`${fitRoot}/index.html`, 'utf8');
const loader = fs.readFileSync(`${fitRoot}/loader.js`, 'utf8');
const editor = fs.readFileSync(`${fitRoot}/app.part13.txt`, 'utf8');
const catalog = fs.readFileSync(`${fitRoot}/app.part2.txt`, 'utf8');
const portrait = fs.readFileSync('docs/js/portrait-utils.js', 'utf8');

assert.match(loader, /i<=13/, 'loader includes the mask authoring module');
assert.match(editor, /beardRevealMasks/);
assert.match(html, /hood reveal area/i);
assert.match(html, /beard priority/i);
assert.match(html, /beardHoodMaskMode/);
assert.match(html, /id="pickBeard"/, 'beard selection is an explicit action');
assert.match(html, /id="pickHood"/, 'hood selection is an explicit action');
assert.match(html, /beardHoodMaskUndo/);
assert.match(html, /beardHoodMaskRedo/);
assert.match(html, /sidebarResizeHandle/);
assert.match(editor, /undoBeardHoodMask/);
assert.match(editor, /redoBeardHoodMask/);
assert.match(editor, /pushBeardHoodMaskHistory/);
assert.match(editor, /setSidebarWidth/);
assert.match(editor, /pointercapture/i);

assert.match(catalog, /cfg\?\.portraitSlot==='facialHair'/, 'facial hair cosmetics enter the head-space fitting catalog');
assert.match(editor, /pointerdown/);
assert.match(editor, /pointermove/);
assert.match(editor, /destination-out/);
assert.match(editor, /beardRevealMasks/);
assert.match(editor, /beardOverpassMasks/);
assert.match(editor, /garment\.cfg\?\.\[property\]\?\.\[beardHoodMaskVariant\(\)\]/, 'existing config masks are loaded into the brush');
assert.match(editor, /Object\.entries\(beardHoodMaskStore\(kind\)\)/, 'all saved species variants are exported together');
assert.match(editor, /delete config\[property\]\[variant\]/, 'clearing a mask removes that variant from the exported cosmetic config');
assert.match(html, /beardHoodReference/, 'the opposite sprite layer can be shown as a ghost reference while painting');
assert.match(html, /Export selected cosmetic JSON/);
assert.match(portrait, /beardRevealMasks: json\.beardRevealMasks/);
assert.match(portrait, /beardOverpassMasks: json\.beardOverpassMasks/);
assert.match(portrait, /hood\?\.beardRevealMasks/);
assert.match(portrait, /facialHair\?\.beardOverpassMasks/);
assert.match(portrait, /destination-in/);
assert.match(portrait, /destination-out/);
assert.match(portrait, /hood: \(\) => \{ drawBreathingLayers\(hoodLayers\); if \(pendingBeardOverpass\)/, 'selected beard pixels are composited immediately after the hood');
assert.match(portrait, /!hasBeardOverpassMask/);
assert.match(portrait, /hoodHideFrontAndSideHair && \(/, 'mask metadata only overrides concealment while a hood is equipped');
assert.match(portrait, /if \(!hoodHidesFacialHair\(hood\) && !hoodHidesFacialHair\(mask\)\) targetCtx\.drawImage\(beardCanvas/, 'concealing hoods keep unselected beard pixels hidden');

console.log('Beard/hood overpass mask authoring and rendering contracts passed.');

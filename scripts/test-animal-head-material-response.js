'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = global;
require(path.resolve(__dirname, '../docs/js/animal-head-material-response.js'));

const api = global.AnimalHeadMaterialResponse;
assert(api, 'AnimalHeadMaterialResponse should install on window/global');

const influence = api.decodeWeightMap({ width: 2, height: 2, encoding: 'rle-u9', data: [1, 0, 1, 128, 1, 255, 1, 256] });
assert(influence, 'Influence RLE should decode');
assert.strictEqual(api.sampleInfluenceMap(influence, 0, 0), 0);
assert.strictEqual(api.sampleInfluenceMap(influence, 1, 0), 128 / 255);
assert.strictEqual(api.sampleInfluenceMap(influence, 1, 1), 0, 'unset Influence remains body weight 0');

const material = api.decodeWeightMap({ width: 2, height: 2, encoding: 'rle-u9', data: [1, 256, 1, 64, 1, 255, 1, 256] });
assert(material, 'Material RLE should decode');
assert.strictEqual(api.sampleMaterialMap(null, influence, 0.5, 0.5, 0.35), 0.35, 'missing material map inherits the exact mesh Influence weight');
assert.strictEqual(api.sampleMaterialMap(material, influence, 0, 0, 0), 0, 'unset material cell inherits Influence at that cell');
assert(api.sampleMaterialMap(material, influence, 1, 0, 128 / 255) <= 128 / 255, 'material override may never exceed Influence');
assert.strictEqual(api.sampleMaterialMap(material, influence, 0, 1, 1), 1, '255 override is capped by the local full Influence weight');

assert.strictEqual(api.responseKindForVertex(20, 0.7, 0.5), 'compress');
assert.strictEqual(api.responseKindForVertex(20, 0.3, 0.5), 'stretch');
assert.strictEqual(api.responseKindForVertex(-20, 0.3, 0.5), 'compress');
assert.strictEqual(api.responseKindForVertex(-20, 0.7, 0.5), 'stretch');
assert.strictEqual(api.responseKindForVertex(0, 0.7, 0.5), 'neutral');

assert.strictEqual(api.materialWeightForBend(0.5, 0.2, 0.4, 'compress'), 0.2);
assert.strictEqual(api.materialWeightForBend(0.5, 0.2, 0.4, 'stretch'), 0.4);
assert.strictEqual(api.materialWeightForBend(0.5, 0.2, 0.4, 'neutral'), 0.5);
assert.strictEqual(api.materialWeightForBend(0.5, 0.9, 0.9, 'compress'), 0.5, 'material channel is reduction-only and cannot exceed Influence');

const riggerDir = path.resolve(__dirname, '../docs/tools/animal-head-rig');
const shell = fs.readFileSync(path.join(riggerDir, 'index.html'), 'utf8');
const author = [1, 2, 3, 4, 5].map(n => fs.readFileSync(path.join(riggerDir, `author-part${n}.js`), 'utf8')).join('\n');
assert(shell.includes('id="paintCanvas"') && shell.includes('id="previewCanvas"'), 'rigger should expose persistent stacked paint + preview canvases');
assert(!shell.includes('previewDeform'), 'preview checkbox should be removed');
assert(shell.includes('id="brushStrength"'), 'Influence/material brush strength control should be visible');
for (let n = 1; n <= 5; n++) assert(shell.includes(`src="./author-part${n}.js"`), `rigger shell should load author-part${n}.js`);
assert(author.includes("state.compressibility.values[index]=UNSET") && author.includes("state.stretchability.values[index]=UNSET"), 'Influence edits should reset both material channels to inherit the new Influence');
assert(author.includes('lerp(current,0,amount)'), 'material brush should only reduce the selected material channel');
assert(author.includes('lerp(current,base,amount)'), 'material restore should move the selected material channel back toward Influence');
assert(author.includes("$('toolEraser').textContent=material?'Toward Influence':'Eraser'"), 'material eraser should become Toward Influence');
assert(author.includes("paintCanvas.addEventListener('pointermove'") && !author.includes("previewCanvas.addEventListener('pointer"), 'only the undeformed paint canvas should accept painting input');
assert(author.includes('requestAnimationFrame(draw)'), 'live preview redraw should be frame-coalesced during brush drags');

console.log('animal-head-material-response: all tests passed');
console.log('animal-head-rigger-workflow: all tests passed');

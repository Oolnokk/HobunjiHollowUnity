#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../docs/tools/clothing-species-fit'); // Test the actual shipped authoring module and assembled editor.
const host = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'headband-spline-fit.js'), 'utf8'), host);
const fit = host.window.ClothingHeadbandSpline;
const width = 234, height = 173; // Non-square portrait checks proper pixel-space rotation.
const original = Array.from({ length: 7 }, (_, i) => ({
  x: .24 + i * .085, y: .40 - .11 * Math.sin(i * Math.PI / 6)
}));
const neutral = fit.defaultWholeTransform();
function near(actual, expected, message, epsilon = 1e-7) {
  assert(Math.abs(actual - expected) < epsilon, message + ': ' + actual + ' vs ' + expected);
}
function bounds(nodes) {
  return {
    width: (nodes.at(-1).x - nodes[0].x) * (width - 1),
    height: (Math.max(...nodes.map(p => p.y)) - Math.min(...nodes.map(p => p.y))) * (height - 1)
  };
}
const identity = fit.transformWhole(original, neutral, width, height);
assert(identity && identity.every((p, i) =>
  Math.abs(p.x - original[i].x) < 1e-10 && Math.abs(p.y - original[i].y) < 1e-10),
  'Neutral whole-spline settings preserve every mapped control point');
const moved = fit.transformWhole(original, { ...neutral, x: 12, y: -8 }, width, height);
assert(moved && fit.valid(moved));
original.forEach((p, i) => {
  near((moved[i].x - p.x) * (width - 1), 12, 'X translation moves all seven nodes equally');
  near((moved[i].y - p.y) * (height - 1), -8, 'Y translation moves all seven nodes equally');
});
const resized = fit.transformWhole(original, { ...neutral, scaleX: 1.4, scaleY: .5 }, width, height);
assert(resized && fit.valid(resized));
near(bounds(resized).width, bounds(original).width * 1.4, 'Independent width scaling');
near(bounds(resized).height, bounds(original).height * .5, 'Independent height scaling');
const rotated = fit.transformWhole(original, { ...neutral, rotation: 13 }, width, height);
assert(rotated && fit.valid(rotated),'Small whole-curve rotation preserves left-to-right order');
const safe = fit.fitWholeTransform(original, neutral, { ...neutral, x: 1000 }, width, height);
assert(safe.fraction > 0 && safe.fraction < 1 && fit.valid(safe.nodes),
  'Movement into canvas edge is limited without collapsing or reordering nodes');
assert(safe.nodes.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
  'Every constrained point stays inside the native sprite');
const slope = Array.from({ length: 7 }, (_, i) => ({ x: .2 + .09 * i, y: .2 + .08 * i }));
const tilt = fit.fitWholeTransform(slope, neutral, { ...neutral, rotation: 65 }, width, height);
assert(tilt.fraction < 1 && fit.valid(tilt.nodes),
  'Rotation stops before two adjacent X points cross');
const step = fit.fitWholeTransform(original, neutral,
  { x: 9, y: -4, scaleX: 1.2, scaleY: .9, rotation: 7 }, width, height);
assert.equal(step.fraction, 1,'A reasonable combined whole-curve edit is accepted fully');
const sameAgain = fit.transformWhole(original, step.settings, width, height);
assert(sameAgain.every((p, i) =>
  Math.abs(p.x - step.nodes[i].x) < 1e-10 && Math.abs(p.y - step.nodes[i].y) < 1e-10),
  'Saved settings reconstruct the exact transformed node positions without accumulating error');
const saved = JSON.parse(JSON.stringify({ whole: { source: { base: original, settings: step.settings } } }));
assert(fit.transformWhole(saved.whole.source.base, saved.whole.source.settings, width, height)
  .every((p, i) => Math.abs(p.x - step.nodes[i].x) < 1e-10),
  'Whole controls and original baseline survive JSON save/restore');
const inputCopy = JSON.stringify(original);
fit.transformWhole(original, { ...neutral, scaleX: 1.9 }, width, height);
assert.equal(JSON.stringify(original), inputCopy, 'Whole-curve transforms never mutate donor points');
assert.throws(() => fit.transformWhole(original, { ...neutral, scaleX: -1 }, width, height),
  /Whole-spline transform/, 'Negative width scales must not be treated as a mirror or node fold');
assert.throws(() => fit.fitWholeTransform(original, neutral, { ...neutral, x: NaN }, width, height),
  /whole-spline settings/i, 'Malformed settings fail explicitly');

const core = Array.from({ length: 12 }, (_, i) =>
  fs.readFileSync(path.join(root, 'app.part' + (i + 1) + '.txt'), 'utf8')).join('');
new vm.Script(core);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for(const id of ['headbandWholeX','headbandWholeY','headbandWholeScaleX','headbandWholeScaleY',
  'headbandWholeRotation','headbandWholeDrag','headbandWholeReset','headbandWholeBake']){
  assert(html.includes('id="' + id + '"'),'Whole control missing: ' + id);
}
assert(core.includes('bakeHeadbandWhole(record,headbandDrag.curve)'),
  'Individual node dragging needs to rebase the whole transform');
assert(core.includes('const applied=window.ClothingHeadbandSpline.fitWholeTransform('),
  'Whole sliders must use safe mathematical whole-curve fitting');
assert(core.includes('headbandWholeGesture') && core.includes('pushUndo()'),
  'Whole-curve edits must participate in undo');
assert(core.includes('headbandWholeDrag.checked') && core.includes('headbandDrag={whole:true'),
  'Whole-curve pointer mode must move the entire curve rather than one node');
assert(core.includes('headbandSplines:A.headbandSplines'),
  'Saved grid JSON must carry the per-view whole-spline settings');
// Donor switching must never reuse a different starting species' whole-spline settings.
function editorFunction(start,end,globals,values){
  const a=core.indexOf(start),b=core.indexOf(end,a);
  assert(a>=0&&b>a,'Missing editor helper '+start);
  return new Function(...globals,core.slice(a,b)+'\nreturn '+start.match(/^function ([^(]+)/)[1]+';')(...values);
}
const ui={sourceSpecies:{value:'mao-ao'},sourceGender:{value:'male'},garment:{value:'headband'}};
const legacyKey='headwear::kenkari_male::headband';
const legacy={enabled:true,source:original.map(p=>({...p})),target:original.map(p=>({...p}))};
const state={headbandSplines:{[legacyKey]:legacy}};
const key=editorFunction('function headbandSelectionKey()','function traceHeadbandCanvas(',
  ['E','contourSelectionKey'],[ui,()=>legacyKey]);
const getRecord=editorFunction('function currentHeadbandRecord()','function currentHeadbandViewRecord()',
  ['R','A','fitRegion','headbandSelectionKey','contourSelectionKey','window','clone',
    'autoHeadbandSourceNodes','autoHeadbandTargetNodes','E'],
  [{body:{width,height},cloth:{}},state,()=>'headwear',key,()=>legacyKey,host.window,
    value=>JSON.parse(JSON.stringify(value)),()=>original.map(p=>({...p})),()=>original.map(p=>({...p})),ui]);
const donorOne=getRecord();
assert.notStrictEqual(donorOne,legacy,'Existing target-only curves are migrated by copy, not overwritten');
donorOne.target[0].y=.72;
ui.sourceSpecies.value='tletingan';
const donorTwo=getRecord();
assert.notStrictEqual(donorTwo,donorOne,'Another donor species receives an independent curve record');
near(donorTwo.target[0].y,legacy.target[0].y,'New donor starts from legacy mapping rather than other donor edits');
assert.notEqual(key().indexOf('tletingan'),-1,'Persistence key contains the source species');
ui.sourceSpecies.value='mao-ao';
assert.strictEqual(getRecord(),donorOne,'Switching donors back restores its separately authored settings');

console.log('OK: whole-spline position, independent scales, rotation, constraints, save/undo integration and controls');

#!/usr/bin/env node
'use strict';
const assert = require('assert');
const TP = require('../docs/js/terrain-preview.js');

const root = { id:'root', category:'exterior', cols:4, rows:4, tiles:{'1,1':{type:'grass',plateau:'p'}}, visualHeights:{'0,0':1,'1,0':0.5,'2,2':0.75,'3,2':0.75} };
const child = { id:'child', category:'exterior', cols:2, rows:1, isSubmap:true, parentMapId:'root', plateauGroupId:'p', tiles:{}, visualHeights:{'0,0':-0.5} };
const ws = { maps:[root,child], plateauGroups:[{id:'p',elevation:1}] };
const beforeTiles = JSON.stringify(root.tiles);
const merged = TP.buildMergedZoneGrid(ws,'root');
assert.equal(merged.visualHeights.get('0,0'),1, 'root sparse value is retained');
assert.equal(merged.visualHeights.get('2,2'),-0.5, 'nested local value is translated to root coordinates');
assert.equal(merged.visualHeights.has('3,2'),false, 'child sparse absence clears a parent value inside its extent');
assert.equal(TP.sampleVisualHeight(merged.visualHeights,0.5,0.5,4,4),TP.VISUAL_HEIGHT_DISPLACEMENT);
assert.equal(TP.sampleVisualHeight({'0,0':1,'1,0':0},1,0.5,2,2),TP.VISUAL_HEIGHT_DISPLACEMENT/2, 'center-authored values interpolate bilinearly');
assert.equal(TP.sampleVisualHeight({'0,0':1},-1,-1,2,2),0, 'outside boundaries is zero');
assert.equal(JSON.stringify(root.tiles),beforeTiles, 'merge does not mutate navigation tile data');
const positions=[0.5,2,0.5, 1,2,0.5];
TP.displaceGeometryPositions(positions,{'0,0':1,'1,0':0},2,2);
assert.equal(positions[1],2+TP.VISUAL_HEIGHT_DISPLACEMENT);
assert.equal(positions[4],2+TP.VISUAL_HEIGHT_DISPLACEMENT/2, 'equal coordinates share equal seam samples');
assert.deepEqual(TP.diffSparseCoordinateField({'0,0':0.25,'2,2':1},{'0,0':0.5,'1,1':-1}), {
  set:{'0,0':0.25,'2,2':1}, removed:['1,1']
}, 'height diffs contain replacements, additions, and sparse deletion tombstones');
assert.equal(TP.diffSparseCoordinateField({'0,0':1},{'0,0':1}),null, 'unchanged sparse fields do not create a diff');
console.log('visual-height tests passed');

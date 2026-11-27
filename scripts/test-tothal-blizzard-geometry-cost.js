#!/usr/bin/env node
'use strict';
// Flat interior snow uses two triangles; cliffs and complex ramps preserve the original geometry and collision.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');
const start = source.indexOf('function addMicroPlateauTile(');
const end = source.indexOf('// Naive per-vertex planar UV', start);
assert(start > 0 && end > start, 'production snow builder must remain discoverable');
const sandbox = {module:{exports:null}};
vm.runInNewContext(`const SURFACE_DEPTH=0.22, EDGE_WIDTH=0.22;
let compactTiles=0, detailedTiles=0, triangleCount=0;
${source.slice(start,end)}
module.exports={addMicroPlateauTile,stats:()=>({compactTiles,detailedTiles,triangleCount})};`,sandbox);
const {addMicroPlateauTile,stats}=sandbox.module.exports;
const none={N:false,E:false,S:false,W:false}; // No edge discontinuity on an interior snow tile.
const p=[],i=[];
const flat=addMicroPlateauTile(p,i,0,0,[0,0,0,0],none,1.5);
assert.equal(p.length,12,'flat tile emits four vertices');
assert.equal(i.length,6,'flat tile emits two triangles');
assert(flat.every(h=>Math.abs(h-.33)<1e-6),'Western Slope keeps fifty percent deeper snow');
const bentP=[],bentI=[];
addMicroPlateauTile(bentP,bentI,2,3,[0,0,0,1],none,1);
assert.equal(bentP.length,48,'nonplanar ramp retains sixteen vertices');
assert.equal(bentI.length,54,'nonplanar ramp retains eighteen triangles');
const cliffP=[],cliffI=[];
const cliff=addMicroPlateauTile(cliffP,cliffI,0,0,[0,0,0,0],{N:true,E:false,S:false,W:false},1);
assert.equal(cliffP.length,48,'cliff retains sixteen rooted vertices');
assert.equal(cliffI.length,54,'cliff retains eighteen triangles');
assert(Math.abs(cliff[0])<1e-6,'cliff edge meets authored ground');
assert(Math.abs(cliff[5]-.22)<1e-6,'cliff interior reaches full snow depth');
const rampP=[],rampI=[];
const ramp=addMicroPlateauTile(rampP,rampI,2,3,[0,1,1,2],none,1);
assert.equal(rampI.length,6,'coplanar ramp safely uses compact geometry');
assert(Math.abs(ramp[5]-.66)<1e-5,'camera ramp sample includes full snow depth');
const raisedCliffP=[], raisedCliffI=[];
const raisedCliff=addMicroPlateauTile(raisedCliffP,raisedCliffI,3,3,[5,5,5,5],{N:true,E:true,S:true,W:true},1.5);
assert.equal(raisedCliff[0],5,'a high mesa lip roots into its own elevated surface');
assert.equal(raisedCliff[15],5,'the far corner also stays at its own terrain height');
assert(Math.abs(raisedCliff[5]-5.33)<1e-6,'only the interior rises on elevated snow');
assert(raisedCliff.every(height=>height>=5),'no snow vertex extends toward the lower neighboring terrain');
assert.equal(stats().compactTiles,2);
assert.equal(stats().detailedTiles,3);
assert.equal(stats().triangleCount,58,'two compact plus three detailed tiles are 58 triangles rather than 90');
console.log('Tothal snow flat geometry and cliff/ramp collision parity passed.');

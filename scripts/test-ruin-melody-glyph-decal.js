#!/usr/bin/env node
'use strict';

// Exercises the actual procedural Scratchbone decal against minimal Three.js scene objects.
const assert = require('node:assert/strict'); // Verifies generated note order, texture selection, wrapping and live replacement.
const fs = require('node:fs'); // Reads the shipped module so this cannot accidentally test a replica.
const vm = require('node:vm'); // Runs browser globals in a deterministic headless harness.
const loaded = []; // Counts image loads to catch needless texture reallocation on every ruin reroll.
const configured = []; // Confirms all loaded Scratchbone images use the shared PNG-plane settings.
const madeMaterials = []; // Confirms all numeral planes use the same canonical sprite material factory.

class SceneObject {
  constructor() {
    this.children = []; this.userData = {}; this.parent = null;
    this.position = {x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.rotation = {x:0,y:0,z:0};
    this.scale = {x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
  }
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(entry=>entry!==child);child.parent=null;}
}
class Group extends SceneObject {}
class Geometry {
  constructor(...dimensions){this.dimensions=dimensions;this.userData={};this.disposed=false;}
  dispose(){this.disposed=true;}
}
class Material {
  constructor(options){Object.assign(this,options);this.disposed=false;}
  dispose(){this.disposed=true;}
}
class Mesh extends SceneObject {
  constructor(geometry,material){super();this.geometry=geometry;this.material=material;}
}
class TextureLoader {
  load(url){loaded.push(url);return {url,colorSpace:null};}
}
const win = {THREE:{
  Group,Mesh,BoxGeometry:Geometry,PlaneGeometry:Geometry,MeshBasicMaterial:Material,TextureLoader,
  DoubleSide:2,SRGBColorSpace:'srgb',
},KurrayaPuzzle:{NOTE_CODES:Array(8).fill('note')},
  HobunjiSpritePngSurface:{
    configureTexture(THREE,texture,name){configured.push(name);texture.canonical=true;return texture;},
    makeMaterial(THREE,texture,name,options){madeMaterials.push(name);return new Material({map:texture,...options});},
    alphaTest:()=>.001,
  }};
vm.runInNewContext(fs.readFileSync('docs/js/ruin-melody-glyph-decal.js','utf8'),{window:win});
const api=win.RuinMelodyGlyphDecal;
assert(api?.create && api?.layoutFor, 'the game exports a reusable Scratchbone inscription builder');
assert.equal(api.layoutFor([0,1,2,3,4]).rows,1);
assert.equal(api.layoutFor(Array(12).fill(0)).rows,2,'up to twelve-note patterns wrap to stay legible in a hall');

const sampleSupport=()=>({y:0,id:'devruin-floor-test'}); // All nearby positions in the first test are flat supported floor.
const bounds={minX:-4,maxX:4,minZ:-4,maxZ:4}; // Room-sized area permits a decal distinct from the bronze trigger.
const root=new Group(),plate={x:0,z:0,y:0}; // Group ownership is the real ruin's disposal path.
const first=[0,7,1,7,2]; // Includes repeated notes and the highest glyph.
const inscription=api.create({root,plate,notes:first,bounds,sampleSupport,blockedAt:()=>false,
  makeStoneMaterial:()=>new Material({stone:true})});
const glyphs=()=>inscription.group.children.filter(child=>Number.isInteger(child.userData.melodyNoteIndex));
const glyphNames=()=>glyphs().map(child=>child.material.map.url.split('/').at(-1));
assert(inscription && root.children.includes(inscription.group));
assert.equal(inscription.group.children.length,first.length+1,'every note is a real texture-backed decal plane');
assert.deepEqual(glyphNames(),['scratchbone1.png','scratchbone8.png','scratchbone2.png','scratchbone8.png','scratchbone3.png']);
assert.notEqual(inscription.group.position.z,plate.z,'the clue is near the plate, not placed over its pressure surface');
assert.equal(inscription.diagnostics().fallback,false);
assert.equal(inscription.diagnostics().rows,1);
assert.equal(glyphs().every(glyph=>glyph.raycast()===undefined),true,'decal art never steals gameplay hits');
assert.equal(inscription.setNotes(first.slice()),true);
assert.equal(inscription.group.children.length,first.length+1,'reapplying the same notes is idempotent');

const oldMaterial=glyphs()[0].material; // Verifies that swapping a melody does not leak its previous material wrappers.
const next=[7,6,5,4,3,2,1,0,7,0,2,1]; // Longer, different phrase whose first six glyphs form row one.
assert.equal(inscription.setNotes(next),true);
assert.equal(inscription.group.children.length,next.length+1);
assert.equal(inscription.diagnostics().rows,2,'longer phrases are wrapped automatically');
assert.deepEqual(Array.from(inscription.diagnostics().notes),next);
assert.deepEqual(glyphNames(),next.map(note=>'scratchbone'+(note+1)+'.png'));
assert.equal(oldMaterial.disposed,true,'old wrappers are disposed on inscription regeneration');
assert.equal(inscription.setNotes([8]),false,'invalid generated note indices never replace the visible clue');
assert.equal(inscription.group.children.length,next.length+1,'an invalid generator update leaves the last valid clue intact');

const second=api.create({root,plate,notes:[0,7],bounds,sampleSupport,blockedAt:()=>false});
assert(second,'a new ruin may reuse the same glyph assets with entirely different notes');
assert.equal(new Set(loaded).size,8);
assert.equal(loaded.length,8,'each of the eight Scratchbone PNGs loads only once for all generated inscriptions');
assert.equal(configured.length,8,'each number PNG uses the canonical color/filter pipeline');
assert(madeMaterials.length>=next.length+first.length,'real glyph decals use canonical sprite materials rather than ad hoc UI textures');

const tight=api.create({root:new Group(),plate,notes:[4,3,2,1],bounds:{minX:-.4,maxX:.4,minZ:-.4,maxZ:.4},
  sampleSupport,blockedAt:()=>true}); // Cramped generation cannot suppress its sequence clue entirely.
assert.equal(tight.diagnostics().fallback,true);
assert.deepEqual(Array.from(tight.diagnostics().notes),[4,3,2,1]);
console.log('Procedural ruin Scratchbone glyph decals passed.');

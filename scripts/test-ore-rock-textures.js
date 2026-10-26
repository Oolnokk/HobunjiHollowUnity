#!/usr/bin/env node
'use strict';

const assert = require('assert'); // Guards the historic metal-bodied ore appearance.
const fs = require('fs'); // Reads production code and existing ore definitions.
const vm = require('vm'); // Runs browser module with deterministic lightweight stubs.
const requests = []; // Captures source sprite and original metal recoloring options.
const THREE = {
  RepeatWrapping: 1, sRGBEncoding: 3001,
  TextureLoader: class { load(src) { return { src, repeat: { set(x, y) { this.x=x; this.y=y; } } }; } },
  CanvasTexture: class { constructor(canvas) { this.image=canvas; this.repeat={ set(x,y) { this.x=x; this.y=y; } }; } },
  MeshStandardMaterial: class { constructor(opts) { Object.assign(this, opts); this.userData={}; } },
};
const logs = []; // Ensures the mobile debugging fallback stays quiet on success.
const browser = {
  __farmLog: message => logs.push(message),
  ToolMetalRecolor: {
    getRecoloredCanvas(src, opts) {
      requests.push({src, opts});
      return Promise.resolve({width:96,height:96});
    },
  },
};
vm.runInNewContext(fs.readFileSync('docs/js/ore-rock-textures.js','utf8'), {window:browser});
async function flush() { for (let i=0; i<6; i++) await Promise.resolve(); }

(async () => {
  const ores = {
    copper: {hex:'#B87333',verdigrisHex:'#3FAF9F',oxidationAmount:0.58},
    tinCopper: {hex:'#58A28D',verdigrisHex:'#4EAA86',oxidationAmount:0},
    mushistonite: {hex:'#7BA963',verdigrisHex:'#57B38B',oxidationAmount:0},
    tin: {hex:'#513C32',verdigrisHex:null,oxidationAmount:0},
  }; // Old copper plus introduced bronze and a non-verdigris ore.
  const stone = browser.OreRockTextures.materialFor(THREE, 'stone', ores);
  assert(stone instanceof THREE.MeshStandardMaterial, 'Restore the original lit rock material');
  assert.equal(stone.map.src, 'assets/textures/carved_smooth.png');
  assert.equal(stone.map.wrapS, THREE.RepeatWrapping, 'Stone uses its original tiling');
  assert.deepStrictEqual([stone.map.repeat.x,stone.map.repeat.y],[0.7,0.7]);
  assert.strictEqual(browser.OreRockTextures.materialFor(THREE,'notAnOre',ores),stone);
  assert.strictEqual(browser.OreRockTextures.materialFor(THREE,null,ores),stone);
  for (const key of Object.keys(ores)) {
    const m = browser.OreRockTextures.materialFor(THREE,key,ores);
    assert.strictEqual(browser.OreRockTextures.materialFor(THREE,key,ores),m,'Material is shared across rocks');
    assert.equal(m.userData.sharedOreRockMaterial,true,'Individual mined rocks must not dispose shared maps');
    await flush();
    assert(m.map instanceof THREE.CanvasTexture,key+' is recolored as a metal body');
    assert.equal(m.map.wrapS,THREE.RepeatWrapping,key+' must not wrap at a mapped facet boundary');
    assert.deepStrictEqual([m.map.repeat.x,m.map.repeat.y],[0.7,0.7]);
    assert.equal(m.map.encoding,THREE.sRGBEncoding,'Three r128 uses sRGB encoding');
    assert.equal(browser.OreRockTextures.debugSnapshot()[key],'ready','Mobile diagnostics show success');
  }
  assert.equal(requests.length,4,'Exactly one recolor per mineral, never one per spawned rock');
  for (const {src,opts} of requests) {
    assert.equal(src,'assets/textures/carved_smooth.png');
    assert.equal(opts.sourceHex,'#635544','Recolor actual original stone pigment, not scattered mineral islands');
    assert.equal(opts.hueToleranceDeg,8,'Restore old source pigment mask tolerance');
    assert.equal(opts.saturationTolerance,0.12);
    assert.equal(opts.outlineWidth,1);
    assert(Number.isInteger(opts.seed),'Blotches remain deterministic by ore type');
  }
  const optionsFor = key => requests.find(request => request.opts.targetHex===ores[key].hex).opts;
  assert.equal(optionsFor('copper').oxidationAmount,0.58,'Original copper patina amount');
  assert.equal(optionsFor('copper').verdigrisHex,ores.copper.verdigrisHex);
  assert.equal(optionsFor('tinCopper').oxidationAmount,0.58,'Crude bronze gets patina over metal');
  assert.equal(optionsFor('mushistonite').oxidationAmount,0.58,'Natural bronze gets patina over metal');
  assert.equal(optionsFor('tin').oxidationAmount,0,'Non-oxidizing rock stays ore-colored');

  const geometry={ dispose(){ throw Error('Do not dispose pre-redesign geometry'); } }; // Old UV coordinates must survive.
  const mesh={geometry,userData:{}};
  browser.HobunjiSurfaceStretchUV={ mapMesh(){ throw Error('Rejected rock nine-slice renderer was called'); } };
  assert(browser.OreRockTextures.fitRockMesh(mesh),'Modern call sites retain their compatibility hook');
  assert.strictEqual(mesh.geometry,geometry,'Do not allocate new per-facet rock geometry');
  assert.equal(mesh.userData.naturalSurfaceUvOwner,'legacy-continuous-rock-uv');
  assert(mesh.userData.oreRockSurfaceMapped,'Farm prevents repeat hook calls');
  browser.OreRockTextures.fitRockMesh(mesh);
  assert.equal(browser.OreRockTextures.debugSnapshot()._surfaceMapping.originalUvs,1,'No double counting');
  assert.equal(browser.OreRockTextures.fitRockMesh({userData:{}}),false,'Missing geometry fails safely');

  const game=fs.readFileSync('docs/game.js','utf8');
  const cave=fs.readFileSync('docs/js/cavern-ore-rocks.js','utf8');
  const farm=fs.readFileSync('docs/js/vegetation-crop-rendering.js','utf8');
  const wilderness=fs.readFileSync('docs/js/wilderness-map-generator.js','utf8');
  assert(game.includes('OreRockTextures.materialFor')&&cave.includes('OreRockTextures.materialFor'),'Mine, world and caves share restored recolorer');
  assert(game.includes('OreRockTextures.fitRockMesh')&&cave.includes('OreRockTextures.fitRockMesh'),'Existing geometry hookups do not go missing');
  assert(farm.includes('OreRockTextures?.fitRockMesh'),'Farm hook stays callable without remapping');
  assert(game.includes('verdigrisHex: METAL_DEFS.lowTinBronze.verdigrisHex')&&game.includes('verdigrisHex: METAL_DEFS.tinBronze.verdigrisHex'),'Both new ores keep their real alloy verdigris');
  const definitions=game.slice(game.indexOf('      const METAL_DEFS = {'),game.indexOf('      const METAL_BAR_RECIPES = {'));
  const actual=vm.runInNewContext(definitions+'\n({ metals: METAL_DEFS, ores: ORE_DEFS })');
  for (const [ore,metal] of [['tinCopper','lowTinBronze'],['mushistonite','tinBronze']]) {
    assert.equal(actual.ores[ore].verdigrisHex,actual.metals[metal].verdigrisHex,ore+' uses its corresponding alloy patina');
  }
  assert(wilderness.includes('generatedObjectOreKind')&&game.includes('t.generatedObjectOreKind'),'No change to ore identity or wilderness drops');
  assert.equal(logs.length,0,'No warnings on successful recolors');
  console.log('PASS ore-rock-textures: legacy metallic body and patina, continuous UV, consistent cave/town/wilderness');
})().catch(error=>{console.error(error);process.exitCode=1;});

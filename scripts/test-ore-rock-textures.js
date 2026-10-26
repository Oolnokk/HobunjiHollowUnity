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
  const game=fs.readFileSync('docs/game.js','utf8'); // Test the actual metal/ore palette, not a hand-copied mock.
  const definitions=game.slice(game.indexOf('      const METAL_DEFS = {'),game.indexOf('      const METAL_BAR_RECIPES = {'));
  assert(definitions.includes('const ORE_DEFS = {'), 'The real metal and ore definitions must be present');
  const actual=vm.runInNewContext(definitions+'\n({ metals: METAL_DEFS, ores: ORE_DEFS })');
  const ores=actual.ores; // Every mineable ore, including newly introduced bronze types.
  for (const [ore,metal] of [['tinCopper','lowTinBronze'],['mushistonite','tinBronze'],['tin','tin']]) {
    assert.equal(ores[ore].rockMetalHex,actual.metals[metal].hex,ore+' rock must use its contained metal color');
  }
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
  assert.equal(requests.length,Object.keys(ores).length,'Exactly one recolor per ore type, not per spawned rock');
  for (const {src,opts} of requests) {
    assert.equal(src,'assets/textures/carved_smooth.png');
    assert.equal(opts.sourceHex,'#635544','Recolor actual original stone pigment, not scattered mineral islands');
    assert.equal(opts.hueToleranceDeg,8,'Restore old source pigment mask tolerance');
    assert.equal(opts.saturationTolerance,0.12);
    assert.equal(opts.outlineWidth,1);
    assert(Number.isInteger(opts.seed),'Blotches remain deterministic by ore type');
  }
  const optionsFor = key => requests.find(request => request.opts.targetHex===(ores[key].rockMetalHex || ores[key].hex)).opts;
  assert.equal(optionsFor('copper').oxidationAmount,0.58,'Original copper patina amount');
  assert.equal(optionsFor('copper').verdigrisHex,ores.copper.verdigrisHex);
  assert.equal(optionsFor('tinCopper').oxidationAmount,0.58,'Crude bronze gets patina over metal');
  assert.equal(optionsFor('mushistonite').oxidationAmount,0.58,'Natural bronze gets patina over metal');
  assert.equal(optionsFor('tinCopper').targetHex,actual.metals.lowTinBronze.hex,'Crude bronze is metal-colored, not raw ore-icon green');
  assert.equal(optionsFor('mushistonite').targetHex,actual.metals.tinBronze.hex,'Natural bronze is metal-colored, not raw ore-icon green');
  assert.equal(optionsFor('tin').targetHex,actual.metals.tin.hex,'Cassiterite rocks take on metallic tin color');
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
  const farmRock={geometry, userData:{farmLooseRockMound:true, naturalSurfaceUvOwner:'HobunjiSurfaceStretchUV'}}; // Farm stones are not ore and may already be natural-surface mapped.
  assert(browser.OreRockTextures.fitRockMesh(farmRock),'Farm compatibility hook remains available');
  assert.strictEqual(farmRock.geometry,geometry,'Farm rock never reallocates existing geometry');
  assert.strictEqual(farmRock.userData.naturalSurfaceUvOwner,'HobunjiSurfaceStretchUV','Ore rollback does not overwrite natural farm UV ownership');
  assert.strictEqual(farmRock.userData.terrainJigsawIgnore,undefined,'Farm keeps its established UV exclusion decisions');

  const cave=fs.readFileSync('docs/js/cavern-ore-rocks.js','utf8');
  const farm=fs.readFileSync('docs/js/vegetation-crop-rendering.js','utf8');
  const wilderness=fs.readFileSync('docs/js/wilderness-map-generator.js','utf8');
  assert(game.includes('OreRockTextures.materialFor')&&cave.includes('OreRockTextures.materialFor'),'Mine, world and caves share restored recolorer');
  assert(game.includes('OreRockTextures.fitRockMesh')&&cave.includes('OreRockTextures.fitRockMesh'),'Existing geometry hookups do not go missing');
  assert(farm.includes('OreRockTextures?.fitRockMesh'),'Farm hook stays callable without remapping');
  assert(game.includes('verdigrisHex: METAL_DEFS.lowTinBronze.verdigrisHex')&&game.includes('verdigrisHex: METAL_DEFS.tinBronze.verdigrisHex'),'Both new ores keep their real alloy verdigris');
  for (const [ore,metal] of [['tinCopper','lowTinBronze'],['mushistonite','tinBronze']]) {
    assert.equal(ores[ore].verdigrisHex,actual.metals[metal].verdigrisHex,ore+' uses its corresponding alloy patina');
  }
  assert(wilderness.includes('generatedObjectOreKind')&&game.includes('t.generatedObjectOreKind'),'No change to ore identity or wilderness drops');
  assert.equal(logs.length,0,'No warnings on successful recolors');
  console.log('PASS ore-rock-textures: legacy metallic body and patina, continuous UV, consistent cave/town/wilderness');
})().catch(error=>{console.error(error);process.exitCode=1;});

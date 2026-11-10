'use strict';
// Real general GLTFLoader interception and pre-baked-first quality-mode contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const rootPath = path.resolve(__dirname, '..');
const source = 'assets/models/hands/hand_feline.glb';
const variant = 'assets/models/hands/hand_feline_optimized60.glb';
const manifest = {schema:'hobunji_geometry_quality.v1', profiles:[{source,variants:{low:variant}}]};
let globalMode = true; // Mimics user's Optimize Geometry checkbox.
let failPreferred = false; // Simulate missing precomputed GLB fallback.
const requests = []; // Record actual file requests rather than guessing what the renderer loaded.
const bakedPairs = []; // Verified pairings retain original GLTF for physics and store reduced render-only geometry.
const storage = new Map();
const settings = Object.fromEntries(['settingGeometryDetail','settingGeometryQualityImport',
  'settingGeometryQualityClear','geometryQualityStatus'].map(k=>[k,{
    value:'high',textContent:'',addEventListener(){},checked:false,
  }]));
class Loader {
  load(path, onLoad, progress, error) {
    requests.push(path);
    if (failPreferred && path === variant) { error(new Error('404 optimized file')); return undefined; }
    const mesh={isMesh:true,userData:{},geometry:{userData:{}}};
    const scene={userData:{},mesh,traverse(cb){cb(mesh);}};
    onLoad({scene});
    return undefined;
  }
}
const window = {
  THREE:{GLTFLoader:Loader},
  GeometryAutoLOD:{isEnabled:()=>globalMode,registerPrebaked(original,baked){bakedPairs.push({original,baked});return 1;}},
  document:{readyState:'complete',getElementById(id){return settings[id]||null;}},
  localStorage:{getItem(k){return storage.get(k)??null;},setItem(k,v){storage.set(k,String(v))},removeItem(k){storage.delete(k)}},
  fetch:async url=>{assert.equal(url,'config/geometry-quality-presets.json');return {ok:true,json:async()=>manifest}},
};
const js=fs.readFileSync(path.join(rootPath,'docs/js/geometry-quality.js'),'utf8');
new Function('window','module',js)(window,{exports:{}});
const quality=window.GeometryQuality;
(async()=>{
  await quality.ready;
  assert.equal(quality.snapshot().loaderInstalled,true,'existing GLTFLoader global class is patched exactly once');
  assert.equal(quality.resolvePath(source),variant,'global mode picks shipped Low variant even with High selector');
  assert.equal(quality.resolvePath(source,'high'),source,'explicit request for High is not overridden');
  const first=await new Promise((resolve,reject)=>new Loader().load(source,resolve,null,reject));
  assert.deepEqual(requests.slice(-2),[source,variant],'global mode must load ORIGINAL first and optimized render geometry second');
  assert.equal(first.scene.mesh.userData.geometryQualityGLBSource,true,'source GLB tagged to skip procedural decimation');
  assert.equal(first.scene.mesh.geometry.userData.geometryQualityPrebakedVariant,false,'physics/source GLB is NEVER replaced by an optimized GLB');
  assert.equal(bakedPairs.length,1);
  assert.equal(bakedPairs[0].original.scene,first.scene,'baked geometry is registered alongside original geometry, not returned as gameplay source');
  assert.equal(quality.snapshot().prebakedLoads,1);
  assert.match(settings.geometryQualityStatus.textContent,/baked models loaded/);

  failPreferred=true;
  let result;
  result=await new Promise((resolve,reject)=>new Loader().load(source,resolve,null,reject));
  assert.deepEqual(requests.slice(-2),[source,variant],'original remains loaded even when optional optimized GLB is missing');
  assert.equal(result.scene.mesh.geometry.userData.geometryQualityPrebakedVariant,false);
  assert.equal(result.scene.mesh.userData.geometryQualityGLBSource,true);
  assert.ok(quality.snapshot().fallbackCount>=1);
  // Existing rig loaders already call quality.loadWithFallback; ensure a
  // missing precomputed file isn't requested twice through nested handlers.
  requests.length = 0;
  const once = await quality.loadWithFallback(source, requested => new Promise((resolve,reject) =>
    new Loader().load(requested,resolve,null,reject)));
  assert.deepEqual(requests,[source,variant],'missing optimized variant fetched just once; original is never retried');
  assert.equal(once.scene.mesh.userData.geometryQualityGLBSource,true);

  globalMode=false;
  result=await new Promise((resolve,reject)=>new Loader().load(source,resolve,null,reject));
  assert.equal(requests.at(-1),source,'disabling global optimized mode restores originals immediately for new loads');
  assert.equal(result.scene.mesh.geometry.userData.geometryQualityPrebakedVariant,false);

  globalMode=true;
  result=await new Promise((resolve,reject)=>new Loader().load(
    'assets/models/furniture/chest_storage.glb',resolve,null,reject));
  assert.equal(requests.at(-1),'assets/models/furniture/chest_storage.glb','unbaked authored assets load originals, not 404 guessed variants');
  assert.equal(result.scene.mesh.userData.geometryQualityGLBSource,true,'unbaked GLBs are also excluded from procedural simplifier');

  execFileSync(process.execPath,['scripts/validate-baked-geometry-quality.js'],{cwd:rootPath,stdio:'pipe'});
  execFileSync(process.execPath,['--check','scripts/bake-geometry-quality.mjs'],{cwd:rootPath,stdio:'pipe'});
  for(const file of ['docs/js/geometry-quality.js','docs/js/geometry-auto-lod.js'])
    execFileSync(process.execPath,['--check',file],{cwd:rootPath,stdio:'pipe'});
  const baker=fs.readFileSync(path.join(rootPath,'scripts/bake-geometry-quality.mjs'),'utf8');
  assert.match(baker,/listSkins\(\)\.length \|\| r\.listAnimations\(\)\.length/);
  assert.match(baker,/getAlphaMode\(\) !== 'OPAQUE'/);
  assert.match(baker,/error: ERROR, lockBorder: true/);
  assert.match(baker,/writeFile\(output, binary\)/);
  assert.doesNotMatch(baker,/writeFile\(source,/,'builder cannot overwrite source model');
  const autoLod=fs.readFileSync(path.join(rootPath,'docs/js/geometry-auto-lod.js'),'utf8');
  assert.match(autoLod,/geometryQualityGLBSource/);
  assert.match(autoLod,/if \(!ready\) \{/,'lazy procedural optimizer is required');
  const html=fs.readFileSync(path.join(rootPath,'docs/index.html'),'utf8');
  assert.match(html,/Optimized Geometry \(pre-baked \+ cached, up to 60%\)/);
  console.log('Precomputed GLBs: global 60% preference, all GLTFLoader loads, safe fallback, skipped runtime reduction, offline build safety OK');
})().catch(error=>{console.error(error);process.exitCode=1;});

#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('docs/js/held-object-render-order.js','utf8');
const registry=src.slice(src.indexOf('  const retiredScenes ='),src.indexOf('  const heldMeshes ='));
const collect=src.slice(src.indexOf('  let walkVisible ='),src.indexOf('  // gl.getParameter()'));
assert(registry.includes('class SceneRegistry')&&collect.includes('function memoAncestor'));
const api=new Function('window',registry+collect+`
  let registryAncestorHits=0, registryAncestorReads=0;
  return {SceneRegistry,collectVisible,stats:()=>({registryAncestorHits,registryAncestorReads})};
`)({});
const scene={isScene:true,visible:true,parent:null}, other={isScene:true,visible:true,parent:null};
const root={parent:scene,visible:true}, nested={parent:root,visible:true};
const leaves=Array.from({length:80},()=>({isMesh:true,parent:nested,visible:true}));
const a=new api.SceneRegistry(),b=new api.SceneRegistry();
for(const o of leaves){a.add(o,scene);b.add(o,scene);}
const memo=new Map();
assert.deepEqual(api.collectVisible(a,scene,null,memo),api.collectVisible(a,scene));
assert.deepEqual(api.collectVisible(b,scene,null,memo),api.collectVisible(b,scene));
assert.equal(api.stats().registryAncestorReads,3,'shared ancestors read once per read batch');
assert(api.stats().registryAncestorHits>=159,'repeated ancestry is reused across registries');
memo.clear();root.visible=false;
assert.deepEqual(api.collectVisible(a,scene,null,memo),[],'hidden ancestor is respected in the next batch');
memo.clear();root.visible=true;nested.parent=other; // Reparent between batches.
assert.deepEqual(api.collectVisible(a,scene,null,memo),[]);
assert.deepEqual(api.collectVisible(a,other,null,memo),leaves,'registry rebuckets moved mesh without changing order');
memo.clear();nested.parent=null;
assert.deepEqual(api.collectVisible(a,other,null,memo),[]);
assert.equal(a.all.size,0,'detached mesh entries removed');
console.log('held registry ancestry: shared parent reads, exact order, hidden, moved and detached entries passed');

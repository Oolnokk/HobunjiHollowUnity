'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('docs/js/combat/ranged-weapons.js','utf8');
const start=code.indexOf('  const projectileMaterialPool =');
const end=code.indexOf('  function createProjectileMesh(',start);
assert(start>=0 && end>start);
class Material {constructor(opts){Object.assign(this,opts);this.opacity=1;}dispose(){this.disposed=true;}}
const api=vm.runInNewContext(code.slice(start,end)
  + '\n({acquireProjectileMaterial,releaseProjectileMaterial,acquireProjectileGeometry,releaseProjectileGeometry,projectileMaterialPool,projectileGeometryPool,projectilePoolStats})',
  {THREE:{MeshBasicMaterial:Material,DoubleSide:2}});
const texture=()=>({dispose(){this.disposed=true;}});
const t1=texture(),t2=texture(),t3=texture();
const a=api.acquireProjectileMaterial(t1),b=api.acquireProjectileMaterial(t2);
assert.notEqual(a,b);
a.opacity=.1;
api.releaseProjectileMaterial(a);
assert.equal(t1.disposed,true);
assert.equal(a.map,null);
assert.equal(api.acquireProjectileMaterial(t3),a);
assert.equal(a.opacity,1);
assert.equal(a.map,t3);
assert.equal(b.map,t2);
const g=()=>({dispose(){this.disposed=true;}});
const first=api.acquireProjectileGeometry('plane:1:1',g);
api.releaseProjectileGeometry(first);
assert.notEqual(api.acquireProjectileGeometry('plane:1:2',g),first);
assert.equal(api.acquireProjectileGeometry('plane:1:1',g),first);
const many=Array.from({length:20},()=>api.acquireProjectileGeometry('other',g));
many.forEach(api.releaseProjectileGeometry);
assert.equal(api.projectileGeometryPool.length,16);
assert.equal(many.filter(x=>x.disposed).length,4);
assert.equal(api.projectilePoolStats.materialReuses,1);
assert.equal(api.projectilePoolStats.geometryReuses,1);
console.log('projectile pool ownership OK');

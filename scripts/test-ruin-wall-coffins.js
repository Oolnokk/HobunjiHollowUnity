#!/usr/bin/env node
'use strict';
// Wall coffins: the real wall panel is the lid; it only wakes when you stand next to it, falls flat onto
// the floor, and a skeleton comes out — and only ONE coffin skeleton may be alive at a time.
const assert = require('node:assert/strict');
const path = require('node:path');
global.window = global;
class Vec { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
class Quat { constructor(){this.w=1;} clone(){return Object.assign(new Quat(),this);} copy(o){Object.assign(this,o);return this;} multiply(){return this;} setFromAxisAngle(a,t){this.axis=a;this.angle=t;return this;} }
class Obj { constructor(){this.position=new Vec();this.rotation=new Vec();this.quaternion=new Quat();this.children=[];this.visible=true;} add(...o){for(const c of o){c.parent=this;this.children.push(c);}} remove(c){this.children=this.children.filter(x=>x!==c);} }
class Mesh extends Obj { constructor(g,m){super();this.geometry=g;this.material=m;this.isMesh=true;} }
const THREE = { Vector3:Vec, Quaternion:Quat, Mesh, PlaneGeometry:class{dispose(){}scale(){}}, MeshBasicMaterial:class{constructor(o){Object.assign(this,o);}dispose(){}} };
const Coffins = require(path.join(__dirname, '..', 'docs/js/ruin-wall-coffins.js'));

const sites = [];
const group = new Obj();
for (let story = 0; story < 3; story++) for (let i = 0; i < 12; i++) {
  const panel = new Mesh({}, {}); panel.position.set(i * 4, story * 10 + 1.1, 0); group.add(panel);
  sites.push({ key: story + ':' + i, story, x: i * 4, z: 0, dx: 0, dz: 1, floorY: story * 10, panel });
}
for (const [tier, n] of [['cave', 2], ['hole', 4], ['lich', 6]]) assert.equal(Coffins.pick(sites, { seed: 3, tier }).length, n, tier + ' coffin count');

const spawned = [], hostile = new Set(); let live = 0;
window.Combat = { deps: { TILE: 64, hostileObjects: hostile } };
window.MinionCombat = { makeEntity: async o => { const e = { health: 10, x: o.x, y: o.y, extra: o.extra, state: 'chase' }; spawned.push(e); live++; return e; } };
const player = { x: -50, z: -50, y: 0 };
const run = Coffins.mount({ THREE, sites, seed: 3, tier: 'lich', getPlayerY: () => player.y, getPlayerPosition: () => ({ x: player.x, z: player.z }), isActive: () => true });
(async () => {
  const flush = () => new Promise(r => setImmediate(r));
  for (let i = 0; i < 30; i++) run.update(.05);
  assert.equal(run.snapshot().states.every(s => s === 'closed'), true, 'nothing wakes while the player is far away');
  const first = run.coffins[0]; player.x = first.site.x; player.z = first.site.z + 1.2; player.y = first.site.floorY;
  run.update(.05);
  assert.equal(first.state, 'falling');
  for (let i = 0; i < 40; i++) run.update(.05);
  await flush();
  assert.ok(Math.abs(Math.abs(first.lid.quaternion.angle) - Math.PI / 2) < 1e-6, 'the lid ends lying flat');
  assert.ok(first.lid.position.y < first.site.floorY + .2, 'and it has dropped to the floor');
  assert.equal(spawned.length, 1, 'one skeleton came out');
  // Stand beside every other coffin: none may open while the first occupant lives.
  for (const c of run.coffins.slice(1)) { player.x = c.site.x; player.z = c.site.z + 1; player.y = c.site.floorY; for (let i = 0; i < 40; i++) run.update(.05); }
  await flush();
  assert.equal(spawned.length, 1, 'only one coffin skeleton alive at a time');
  spawned[0].health = 0; // defeated
  const second = run.coffins[1]; player.x = second.site.x; player.z = second.site.z + 1; player.y = second.site.floorY;
  for (let i = 0; i < 40; i++) run.update(.05);
  await flush();
  assert.equal(spawned.length, 2, 'the next one opens once the last occupant is beaten');
  run.dispose();
  assert.equal(hostile.size, 0, 'dispose retires every coffin skeleton');
  console.log('ruin wall coffins: ok');
})().catch(e => { console.error(e); process.exit(1); });

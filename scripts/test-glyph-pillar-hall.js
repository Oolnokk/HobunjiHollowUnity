#!/usr/bin/env node
'use strict';
// The projectile room (glyphObelisk) is a hall of solid pillars hiding three glyph targets.
// Regression: every pillar blocker must be registered WITH an id (DynamicSurfaces throws otherwise).
const assert = require('node:assert/strict');
const path = require('node:path');
class Obj { constructor(){this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};this.rotation={x:0,y:0,z:0};this.children=[];this.userData={};this.visible=true;}
  add(...c){for(const o of c){o.parent=this;this.children.push(o);}} remove(c){this.children=this.children.filter(x=>x!==c);} traverse(f){f(this);this.children.forEach(c=>c.traverse?.(f));} }
class Mesh extends Obj { constructor(g,m){super();this.geometry=g;this.material=m;this.isMesh=true;} }
class Geo { dispose(){} }
const THREE = { Group:Obj, Mesh, MeshBasicMaterial:class{constructor(o){Object.assign(this,o);}dispose(){}}, BoxGeometry:Geo, CylinderGeometry:Geo, PlaneGeometry:Geo, SphereGeometry:Geo };
const blockers = new Map(), scopes = [];
const DS = { registerBlocker: d => { if (!d?.id) throw new Error('DynamicSurfaces blocker requires an id'); blockers.set(d.id, d); return d; }, clearScope: s => { scopes.push(s); for (const [k,v] of blockers) if (v.scope === s) blockers.delete(k); } };
const Challenges = require(path.join(__dirname, '..', 'docs/js/ruin-layer-challenges.js'));
const bus = { registerExternalProjectileTarget: () => () => {}, hasActiveRuinState: () => true };
const rec = Challenges.compose({ THREE, parent: new Obj(), room: { x: 10, z: 10, w: 16, d: 16 }, id: 'room-a', kind: 'glyphObelisk', y: 0,
  isActive: () => true, onSolved: () => {}, getPlayerPosition: () => ({ x: 18, z: 18 }), getPlayerY: () => 0, projectileBus: bus, DynamicSurfaces: DS });
assert.equal(rec.targets.length, 3, 'three hidden glyph targets');
assert.ok(blockers.size >= 6, 'every pillar is solid: ' + blockers.size);
for (const b of blockers.values()) assert.ok(b.maxX > b.minX && b.maxZ > b.minZ && b.scope.startsWith('ruin-layer-glyph-'));
rec.dispose();
assert.equal(blockers.size, 0, 'dispose clears the pillar blockers');
console.log('glyph pillar hall: ok');

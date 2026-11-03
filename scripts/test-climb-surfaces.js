#!/usr/bin/env node
'use strict';
const assert = require('assert');
const G = require('../docs/js/cell-grid-3d.js');
const CS = require('../docs/js/climb-surfaces.js');
const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-6, `${msg || ''} expected ${b}, got ${a}`);

// A shaft: west wall (col 2) faces east, climbable from y=1 to y=11, rows 4..5 -> z 6..8 (origin 2,2).
const g = G.create({ cols: 9, rows: 9, levels: 12, originX: 2, originZ: 2 });
g.fillBox(0, 0, 0, 8, 8, 11, G.KIND.SOLID);
g.fillBox(3, 3, 1, 5, 5, 11, G.KIND.AIR);
g.paintClimbFaces(2, 4, 1, 2, 5, 11, G.DIR.E, 'ivy');
assert.equal(CS.registerGrid(g, { scope: 't' }), 1);
const [wall] = CS.list();
assert.deepEqual(wall.normal, { x: 1, z: 0 });
assert.deepEqual(wall.tangent, { x: 0, z: 1 });
assert.equal(wall.plane, 5); assert.equal(wall.u0, 6); assert.equal(wall.u1, 8);
assert.equal(wall.y0, 1); assert.equal(wall.y1, 12);

const WEST = Math.PI; // facing -x, into the west wall from inside the shaft

// --- grabbing ---------------------------------------------------------------
assert(CS.findGrabTarget({ x: 5.4, z: 7, y: 1 }, WEST), 'facing the wall within reach grabs');
assert.equal(CS.findGrabTarget({ x: 5.4, z: 7, y: 1 }, 0), null, 'facing away does not');
assert.equal(CS.findGrabTarget({ x: 7, z: 7, y: 1 }, WEST), null, 'too far from the wall');
assert.equal(CS.findGrabTarget({ x: 4.5, z: 7, y: 1 }, WEST), null, 'behind the wall plane (inside the solid) does not');
assert.equal(CS.findGrabTarget({ x: 5.4, z: 9.5, y: 1 }, WEST), null, 'beside the wall does not');
assert.equal(CS.findGrabTarget({ x: 5.4, z: 7, y: 11.8 }, WEST), null, 'at the very top you walk onto it instead');
assert(CS.findGrabTarget({ x: 5.4, z: 7, y: 6 }, WEST), 'can grab mid-wall from a balcony');
assert(CS.findGrabTarget({ x: 5.4, z: 7, y: 1 }, WEST + 0.6), 'within the facing tolerance');
assert.equal(CS.findGrabTarget({ x: 5.4, z: 7, y: 1 }, WEST + 1.5), null, 'outside the facing tolerance');
assert.equal(CS.findGrabTarget({ x: 5.4, z: 7, y: 1 }, WEST, { scope: 'other' }), null, 'scope filter');

// --- attached movement --------------------------------------------------------
const hit = CS.findGrabTarget({ x: 5.4, z: 7, y: 1 }, WEST);
const session = CS.attach(hit.surface, { x: 5.4, z: 7, y: 1 });
near(session.u, 7); near(session.v, 1);
let out = CS.step(session, { x: 0, z: 0 }, 0);
near(out.x, 5 + 0.34, 'hangs standOff off the wall'); near(out.z, 7); near(out.y, 1);
near(Math.cos(out.facing), -1, 'faces into the wall');

// Pushing toward the wall (-x) climbs at ivy speed 1.4/s.
out = CS.step(session, { x: -1, z: 0 }, 0.5);
near(out.y, 1 + 1.4 * 0.5, 'climbs up'); near(out.z, 7, 'does not drift sideways'); near(out.x, 5.34);
// Pulling away (+x) climbs down.
CS.step(session, { x: 1, z: 0 }, 0.25); near(session.v, 1.7 - 1.4 * 0.25);
// Along the wall (+z) slides sideways, keeping height: normal space, not auto-climb.
const v0 = session.v; CS.step(session, { x: 0, z: 1 }, 0.25);
near(session.v, v0, 'sideways input does not change height'); near(session.u, 7 + 1.6 * 0.25);
// Diagonal moves both axes.
const u1 = session.u, v1 = session.v; CS.step(session, { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }, 0.2);
assert(session.v > v1 && session.u < u1, 'diagonal input climbs and slides');
// Below the dead zone nothing moves.
const snap = { u: session.u, v: session.v }; CS.step(session, { x: -0.1, z: 0.1 }, 1);
near(session.u, snap.u); near(session.v, snap.v);
// Side edges clamp inside the margin.
for (let i = 0; i < 100; i++) CS.step(session, { x: 0, z: 1 }, 0.1);
near(session.u, 8 - 0.3, 'clamped at the far edge'); for (let i = 0; i < 100; i++) CS.step(session, { x: 0, z: -1 }, 0.1);
near(session.u, 6 + 0.3, 'clamped at the near edge');

// --- exits ----------------------------------------------------------------------
const s2 = CS.attach(hit.surface, { x: 5.4, z: 7, y: 1 });
let ev = CS.step(s2, { x: 1, z: 0 }, 0.1).event;
assert.equal(ev, 'bottom', 'pulling away at the bottom lets go');
ev = CS.step(s2, { x: -1, z: 0 }, 0.1).event; assert.equal(ev, null, 'pushing up from the bottom just climbs');
s2.v = 11.9; ev = CS.step(s2, { x: -1, z: 0 }, 0.5).event;
near(s2.v, 12, 'clamped at the top'); assert.equal(ev, 'top', 'pushing up at the top mantles');
ev = CS.step(s2, { x: 0, z: 1 }, 0.1).event; assert.equal(ev, null, 'sideways at the top does not mantle');
const exit = CS.topExitPoint(wall, 7);
near(exit.x, 5 - 0.5, 'mantle lands past the wall plane'); near(exit.z, 7); near(exit.y, 12);

// Every facing: the same push-into-wall rule holds for a wall of each orientation.
for (const dir of [G.DIR.N, G.DIR.E, G.DIR.S, G.DIR.W]) {
  const h = G.create({ cols: 7, rows: 7, levels: 6, originX: 0, originZ: 0 });
  h.fillBox(0, 0, 0, 6, 6, 5, G.KIND.SOLID); h.fillBox(1, 1, 0, 5, 5, 5, G.KIND.AIR);
  // Paint the matching ring wall: E faces on col 0, W on col 6, S on row 0, N on row 6.
  if (dir === G.DIR.E) h.paintClimbFaces(0, 1, 0, 0, 5, 4, dir, 'holds');
  if (dir === G.DIR.W) h.paintClimbFaces(6, 1, 0, 6, 5, 4, dir, 'holds');
  if (dir === G.DIR.S) h.paintClimbFaces(1, 0, 0, 5, 0, 4, dir, 'holds');
  if (dir === G.DIR.N) h.paintClimbFaces(1, 6, 0, 5, 6, 4, dir, 'holds');
  CS.clearScope('t'); CS.clearScope('dir');
  CS.registerGrid(h, { scope: 'dir', idPrefix: 'dir' });
  const w = CS.list()[0], n = w.normal;
  const pos = { x: 3 + n.x * 2.0, z: 3 + n.z * 2.0, y: 0 };
  // Stand 0.5 off the wall plane on its open side, facing into it.
  pos.x = (w.axis === 'z' ? w.plane + n.x * 0.5 : 3.5); pos.z = (w.axis === 'x' ? w.plane + n.z * 0.5 : 3.5);
  const found = CS.findGrabTarget(pos, Math.atan2(-n.z, -n.x));
  assert(found, `can grab a ${G.DIR_NAMES[dir]}-facing wall`);
  const ss = CS.attach(found.surface, pos);
  const o = CS.step(ss, { x: -n.x, z: -n.z }, 0.5);
  near(o.y, 0.5 * 0.9, `${G.DIR_NAMES[dir]} wall: pushing into it climbs (holds speed 0.9)`);
  const before = ss.u; CS.step(ss, { x: w.tangent.x, z: w.tangent.z }, 0.2);
  near(ss.u, before + 1.0 * 0.2, `${G.DIR_NAMES[dir]} wall: along-wall input slides on u`);
}

// --- styles -----------------------------------------------------------------------
assert.equal(CS.getStyle('nope').id, 'default', 'unknown styles fall back');
CS.registerStyle('moss', { speedV: 0.5 });
assert.equal(CS.getStyle('moss').speedV, 0.5);
assert.equal(CS.getStyle('moss').speedU, 1.2, 'unspecified speeds default');
assert.throws(() => CS.register({ id: 'bad', axis: 'z', normal: { x: 1, z: 0 }, plane: 0, u0: 1, u1: 1, y0: 0, y1: 1 }), /invalid/);

// --- raw composer-face visuals ------------------------------------------------------
// CellGrid3D emits raw faces without a tangent; the visual path must normalize them just like registerGrid.
class VisualVector3 {
  constructor(x,y,z){this.x=x;this.y=y;this.z=z;}
  cross(v){const x=this.y*v.z-this.z*v.y,y=this.z*v.x-this.x*v.z,z=this.x*v.y-this.y*v.x;Object.assign(this,{x,y,z});return this;}
}
class VisualGroup {
  constructor(){this.children=[];this.userData={};this.position={set:(x,y,z)=>{this.origin={x,y,z};}};this.quaternion={setFromRotationMatrix:m=>{this.basis=m.basis;}};}
  add(item){this.children.push(item);}
}
class VisualMesh extends VisualGroup {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class VisualMatrix4 {makeBasis(x,y,z){this.basis=[x,y,z];return this;}}
const FakeVisualThree={Group:VisualGroup,Mesh:VisualMesh,PlaneGeometry:class{},BoxGeometry:class{},MeshBasicMaterial:class{},DoubleSide:2,Vector3:VisualVector3,Matrix4:VisualMatrix4}; // Minimal render API isolates raw-face math from WebGL.
for(const [axis,normal] of [['x',{x:0,z:1}],['x',{x:0,z:-1}],['z',{x:1,z:0}],['z',{x:-1,z:0}]]){
  const raw={axis,normal,plane:4,u0:1,u1:3,y0:0,y1:4,style:'holds'}; // Matches the raw CellGrid3D faces passed by ShaftHub.buildVisual.
  const visual=CS.buildVisual(FakeVisualThree,raw);
  assert(visual.basis?.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z)), 'raw wall orientation must have a finite normalized tangent');
  assert(visual.children.length===1&&visual.children[0].children.length===2,'plane and handholds must both render from a raw face');
}

// --- player glue ------------------------------------------------------------------
CS.clearScope('dir'); CS.registerGrid(g, { scope: 't' });
const TILE = 32, player = { x: 5.4 * TILE, y: 7 * TILE, angle: WEST, vx: 3, vy: 3 };
let input = { x: 0, y: 0 }, feetY = 1, facingSet = null;
CS.init({ player, TILE, getFeetY: () => feetY, getMovementInput: () => input, setFacingAngle: a => { facingSet = a; }, canStandAt: () => true });
const provided = CS.worldClimbProvider();
assert.equal(provided.kind, 'climbSurface');
provided.start();
assert(player.onClimbSurface && CS.isAttached());
near(player.x / TILE, 5.34); near(player.y / TILE, 7); near(player.wallClimbY, 1); near(Math.cos(facingSet), -1);
assert.equal(player.vx, 0);
assert.equal(CS.worldClimbProvider(), null, 'no second grab while attached');
input = { x: -1, y: 0 }; CS.updatePlayer(1);
near(player.wallClimbY, 2.4, 'input drives height through updatePlayer (client input.y is world z)');
input = { x: 0, y: 1 }; CS.updatePlayer(0.2);
near(player.y / TILE, 7 + 1.6 * 0.2, 'sideways input moves the player along the wall in world space');
assert(CS.release()); assert.equal(player.onClimbSurface, null); assert.equal(CS.release(), false);
// Letting go at the bottom.
player.x = 5.4 * TILE; player.y = 7 * TILE; CS.worldClimbProvider().start();
input = { x: 1, y: 0 }; CS.updatePlayer(0.1);
assert.equal(player.onClimbSurface, null, 'bottom event releases the player');

console.log('climb-surfaces: ok');

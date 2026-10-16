'use strict';
const assert = require('assert'); // Checks the rendered gaze against its world-space target.
const fs = require('fs'); // Executes the shipped aim functions rather than duplicating their decisions.
const vm = require('vm'); // Isolates rendering and gameplay seams without a browser dependency.
const source = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8'); // Production render-time head solver.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Production fishing/interaction target routing.
class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  identity() { Object.assign(this, { x: 0, y: 0, z: 0, w: 1 }); return this; }
  multiply(b) {
    const { x, y, z, w } = this; // Standard Hamilton product used to inspect the final neck orientation.
    Object.assign(this, { x: w*b.x+x*b.w+y*b.z-z*b.y, y: w*b.y-x*b.z+y*b.w+z*b.x,
      z: w*b.z+x*b.y-y*b.x+z*b.w, w: w*b.w-x*b.x-y*b.y-z*b.z }); return this;
  }
  normalize() { const n = Math.hypot(this.x, this.y, this.z, this.w); for (const k of ['x','y','z','w']) this[k] /= n; return this; }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this; }
}
class V {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  copy(v) { Object.assign(this, { x: v.x, y: v.y, z: v.z }); return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  lengthSq() { return this.x*this.x + this.y*this.y + this.z*this.z; }
  applyQuaternion(q) {
    const v = new Q(this.x, this.y, this.z, 0); // Independent quaternion-vector product for geometry assertions.
    const result = new Q(q.x,q.y,q.z,q.w).multiply(v).multiply(new Q(-q.x,-q.y,-q.z,q.w));
    return this.copy(result);
  }
}
function rotation(x = 0, y = 0, z = 0, order = 'YXZ') {
  return { x,y,z,order, set(a,b,c,o = this.order) { Object.assign(this,{x:a,y:b,z:c,order:o}); },
    clone() { return rotation(this.x,this.y,this.z,this.order); }, copy(r) { Object.assign(this,r); } };
}
function eulerQ(x,y,z) {
  return new Q(0,Math.sin(y/2),0,Math.cos(y/2)).multiply(new Q(Math.sin(x/2),0,0,Math.cos(x/2)))
    .multiply(new Q(0,0,Math.sin(z/2),Math.cos(z/2)));
}
const root = { isObject3D: true, quaternion: new Q() }; // Models the composed player body, including arbitrary facing and run lean.
const parent = { isObject3D: true, quaternion: new Q(), parent: root }; // Includes an authored portrait-parent orientation.
const neck = { parent, rotation: rotation(0.1,0.2,0), updateWorldMatrix() {},
  getWorldPosition(out) { return out.copy(new V(0,1.4,0).applyQuaternion(root.quaternion)); } }; // Neck pivot follows the leaned body.
const context = { THREE: { Vector3: V, Quaternion: Q, MathUtils: { radToDeg: v => v*180/Math.PI } },
  headAimTarget: new V(), headAimOrigin: new V(), headAimDirection: new V(), headAimParentQuaternion: new Q(),
  headAimEnabled: false, headAimSource: null, currentPlayerNeckJoint: () => neck }; // Supplies only IO/state; all aim math below is production code.
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function hierarchyWorldQuaternion('), source.indexOf('  function quaternionEulerDegrees(')), context);
vm.runInContext(source.slice(source.indexOf('  function setHeadAimTarget('), source.indexOf('  // Diagnostics only.')), context);
for (let i = 0; i < 8; i++) {
  const yaw = i*Math.PI/4; // Every compass heading must preserve aim under a thirty-degree lean and additional roll.
  root.quaternion = eulerQ(Math.PI/6,yaw,0.12);
  parent.quaternion = eulerQ(0,0.15,0);
  for (const water of [false,true]) {
    const point = new V(Math.sin(yaw)*8,water ? 0.35 : 2.1,Math.cos(yaw)*8); // Fishing looks down at the selected water surface.
    assert(context.setHeadAimTarget(point,water ? 'fishing-water' : 'interaction-ray'));
    const before = neck.rotation.clone(), undo = [], debug = {}; // Captures gameplay pose before temporary render compensation.
    context.applyPlayerHeadAim(undo,debug);
    const worldQ = new Q().multiply(root.quaternion).multiply(parent.quaternion).multiply(eulerQ(neck.rotation.x,neck.rotation.y,neck.rotation.z)); // Actual displayed head orientation.
    const actual = new V(0,0,1).applyQuaternion(worldQ);
    const expected = new V().copy(point).sub(neck.getWorldPosition(new V())); // Desired ray from the neck after body lean/translation.
    const length = Math.sqrt(expected.lengthSq());
    assert(Math.hypot(actual.x-expected.x/length,actual.y-expected.y/length,actual.z-expected.z/length) < 1e-10);
    assert.strictEqual(debug.headAim.source,water ? 'fishing-water' : 'interaction-ray');
    undo.reverse().forEach(fn => fn());
    assert.deepStrictEqual([neck.rotation.x,neck.rotation.y,neck.rotation.z,neck.rotation.order],[before.x,before.y,before.z,before.order],'temporary counter-lean is restored after each draw');
  }
}
assert.strictEqual(context.setHeadAimTarget({x:NaN,y:0,z:0}),false);
const noAimUndo = []; // Invalid or cleared targets cannot overwrite an independently authored head pose.
context.applyPlayerHeadAim(noAimUndo,{});
assert.strictEqual(noAimUndo.length,0);

let target = 'stale'; // Captures the actual game-to-renderer handoff, including early-return cleanup.
const sharedPoint = {x:0,y:2,z:20}, waterPoint = {x:4.5,y:0.35,z:2.5}; // Distinct targets make camera/raycast drift during fishing detectable.
const gameplay = { window: {PlayerBodyTransformComposer:{setHeadAimTarget(point,source){target={point,source};},resolvedYawDeltaRad:()=>0},Fishing:{state:{active:true,anchorWorld:waterPoint}}},
  playerNeckJoint:{userData:{},rotation:rotation()},player:{angle:0,prone:false},playerMesh:{rotation:{y:0}},
  activeCameraMode:'normal',SHOULDER_SURF_MODE:'shoulder',cutscenePreviewActive:false,dialogueOpen:false,characterViewMode:{enabled:false},sitInteraction:null,
  currentPlayerPerspectiveDirection:()=>({x:0,y:0,z:1}),shoulderPerspectiveFacingAngle:()=>0,currentPlayerPerspectiveTarget:()=>({point:sharedPoint}),
  activeCameraAzimuthRad:()=>0,angleDiff:(a,b)=>a-b }; // Exercises the real updatePlayerHeadAim function and its ownership rules.
vm.createContext(gameplay);
vm.runInContext(game.slice(game.indexOf('      function updatePlayerHeadAim()'),game.indexOf('      // Interactable used by both getInteriorInteractableAt')),gameplay);
gameplay.updatePlayerHeadAim();assert.strictEqual(target.point,waterPoint);assert.strictEqual(target.source,'fishing-water');
gameplay.window.Fishing.state.active=false;
gameplay.updatePlayerHeadAim();assert.strictEqual(target.point,sharedPoint);assert.strictEqual(target.source,'interaction-ray');
for (const key of ['dialogueOpen','cutscenePreviewActive']) {
  gameplay[key]=true;gameplay.updatePlayerHeadAim();assert.strictEqual(target.point,null);gameplay[key]=false;
}
gameplay.player.prone=true;gameplay.updatePlayerHeadAim();assert.strictEqual(target.point,null);gameplay.player.prone=false;
gameplay.characterViewMode.enabled=true;gameplay.updatePlayerHeadAim();assert.strictEqual(target.point,null);
console.log('player head aim: lean compensation and fishing target passed');

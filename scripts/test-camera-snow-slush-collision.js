'use strict';
const assert = require('node:assert/strict'); // Checks real surface and camera behavior.
const fs = require('node:fs'); // Loads the production owners.
const vm = require('node:vm'); // Runs the renderer-independent geometry and camera code.
class Node {
  constructor() { this.children = []; this.userData = {}; this.visible = true; }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(entry => entry !== child); child.parent = null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
class Attribute {
  constructor(array, size) { this.array = array; this.itemSize = size; this.count = array.length / size; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class Geometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(value) { this.index = value; }
  computeBoundingBox() {
    const p = this.attributes.position; // Geometry extents needed by the production UV fallback.
    this.boundingBox = { min: {x:Infinity,z:Infinity}, max:{x:-Infinity,z:-Infinity} };
    for (let i = 0; i < p.count; i++) for (const axis of ['x','z']) {
      const value = axis === 'x' ? p.getX(i) : p.getZ(i); // Reads the current vertex axis.
      this.boundingBox.min[axis] = Math.min(this.boundingBox.min[axis], value);
      this.boundingBox.max[axis] = Math.max(this.boundingBox.max[axis], value);
    }
  }
  computeBoundingSphere() {}
  dispose() {}
  toNonIndexed() {
    const result = new Geometry(); // Expands indexed geometry just as Three.js does before chunk slicing.
    for (const [name, attr] of Object.entries(this.attributes)) {
      const array = new Float32Array(this.index.count * attr.itemSize); // Independent output attribute.
      for (let i = 0; i < this.index.count; i++) for (let axis = 0; axis < attr.itemSize; axis++) array[i * attr.itemSize + axis] = attr.array[this.index.getX(i) * attr.itemSize + axis];
      result.setAttribute(name, new Attribute(array, attr.itemSize));
    }
    return result;
  }
}
let area = 'map_western_slope', season = 'Longpour', scene = new Node(), tick; // Live scene/season inputs and registered callback.
const grid = [[{type:'grass'}, {type:'water'}, {type:'raised',elevTier:1}, {type:'ramp',rampElevation:1}]]; // Coverage, water, height discontinuity and ramp fixtures.
const window = {
  THREE: {
    Group: Node, BufferGeometry: Geometry, BufferAttribute: Attribute, Float32BufferAttribute: Attribute,
    Mesh: class extends Node { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } },
    MeshBasicMaterial: class { constructor(config) { Object.assign(this, config); this.userData = {}; } },
    TextureLoader: class { load() {} }, DoubleSide: 2,
  },
  GridTileAccessors: { getCurrentArea:()=>area, getActiveScene:()=>scene, getActiveGrid:()=>grid, getActiveCols:()=>4, getActiveRows:()=>1 },
  CalendarSystem: { currentSeason:()=>({name:season}) },
  RuntimeFrameScheduler: { register(id, callback) { tick = callback; } },
}; // Stubs graphics plumbing while executing the actual surface construction.
vm.runInNewContext(fs.readFileSync('docs/js/environment-surface-micro-plateau.js','utf8'), {window});
const api = window.EnvironmentSurfaceMicroPlateau; // Camera surface authority from the real owner.
assert.equal(api.cameraSurfaceYAt(.5,.5), null, 'no phantom collision before the surface is built');
tick({timestamp:100});
assert.equal(api.hasCameraSurface(), true);
assert.ok(Math.abs(api.cameraSurfaceYAt(.5,.5) - .22) < 1e-7);
assert.equal(api.cameraSurfaceYAt(1.5,.5), null, 'water stays uncovered');
for (const x of [-1,4,NaN,Infinity]) assert.equal(api.cameraSurfaceYAt(x,.5), null);
const positions = scene.children[0].children[0].geometry.getAttribute('position'); // Rendered cap and lip triangles, independent of the camera cache.
for (let i = 0; i < positions.count; i += 3) {
  const x = (positions.getX(i)+positions.getX(i+1)+positions.getX(i+2))/3; // Triangle centroid's world X.
  const z = (positions.getZ(i)+positions.getZ(i+1)+positions.getZ(i+2))/3; // Triangle centroid's world Z.
  const y = (positions.getY(i)+positions.getY(i+1)+positions.getY(i+2))/3; // Height on the actual rendered triangle.
  assert.ok(Math.abs(api.cameraSurfaceYAt(x,z)-y) < 1e-6, `camera height matches rendered triangle ${i/3}`);
}
const game = fs.readFileSync('docs/game.js','utf8'); // Actual game-owned collision solver and camera update.
const start = game.indexOf('      const CAMERA_FLOOR_CLEARANCE ='); // Camera math block with its shared state.
const context = vm.createContext({
  activeCameraMode:'shoulderSurf', SHOULDER_SURF_MODE:'shoulderSurf', cutscenePreviewActive:false,
  dialogueZoomActive:()=>false, camTargetY:0, _playerGroundY:()=>0, activeSurfaceYAtWorld:()=>0,
  currentArea:area, _isBuildingArea:()=>false, currentAreaOcclusionMeshes:()=>[],
  performance:{now:()=>1000}, THREE:{MathUtils:{degToRad:n=>n*Math.PI/180}},
  window:{EnvironmentSurfaceMicroPlateau:api, FormatUtils:{clamp:(n,lo,hi)=>Math.max(lo,Math.min(hi,n))}},
}); // Keeps player terrain at zero while the rendered cap is raised.
vm.runInContext(game.slice(start,game.indexOf('      // How far under a tree canopy',start))+'\nthis.solve=occlusionSafeCameraPosition; this.debug=()=>_cameraBoomDebug;',context);
const updateStart = game.indexOf('      function updateCameraPosition() {'); // Gameplay integration, including the short-character target guard.
const camera = {position:{set(x,y,z){Object.assign(this,{x,y,z});}},lookAt(x,y,z){this.target={x,y,z};},updateProjectionMatrix(){}}; // Final camera pose capture.
Object.assign(context,{
  camera, applyAuthoredCinematicCamera:()=>false, cameraModeConfig:()=>({distanceTiles:1.3,angleFromGroundDeg:9,targetYOffsetTiles:.15,ignoreGlobalZoom:true}),
  cameraContainerAspect:()=>1, camTargetX:.5,camTargetZ:.5,cameraAngleOffsetDeg:-85,cameraAzimuthOffsetDeg:0,s_zoomScale:1.5,
  dialoguePortraitCameraAim:()=>null,s_shoulderSurfOffsetH_current:0,s_shoulderSurfOffsetV_current:0,_lastCameraLookPoint:{set(){}},
});
vm.runInContext(game.slice(updateStart,game.indexOf('      updateCameraPosition();',updateStart))+'\nthis.update=updateCameraPosition;',context);
for (const mode of ['snow','slush']) {
  if (mode === 'slush') { area='farm'; season='Coldmuck'; tick({timestamp:200}); }
  context.update();
  assert.ok(Math.abs(camera.target.y-.26)<1e-7, 'short-character pivot clears the rendered cap');
  assert.ok(camera.position.y >= api.cameraSurfaceYAt(camera.position.x,camera.position.z)+context.debug().floorClearance-1e-9);
  const pitch = Math.atan2(camera.target.y-camera.position.y,Math.hypot(camera.position.x-camera.target.x,camera.position.z-camera.target.z))*180/Math.PI; // Effective upward aim after cover collision.
  assert.ok(Math.abs(pitch-76)<1e-7, 'cover collision preserves requested aim');
  assert.equal(context.activeSurfaceYAtWorld(.5,.5),0, 'player ground is unchanged');
  context.activeCameraMode='seated';
  const seated = context.solve(.5,.5,.5,.5,0,.7); // A seated boom crossing the cap while its endpoint is below cover.
  assert.ok(seated.y >= api.cameraSurfaceYAt(seated.x,seated.z)+.01-1e-9);
  context.cutscenePreviewActive=true;
  const cinematic = context.solve(.5,.5,.5,.5,0,.7); // Scripted views share cover collision.
  assert.ok(cinematic.y >= api.cameraSurfaceYAt(cinematic.x,cinematic.z)+.01-1e-9);
  context.cutscenePreviewActive=false; context.activeCameraMode='shoulderSurf';
}
scene.children[0].visible=false;
assert.equal(api.cameraSurfaceYAt(.5,.5),null, 'hidden cover cannot block the camera');
scene.children[0].visible=true;
api.forceRebuild();
assert.equal(api.hasCameraSurface(),false, 'rebuild clears stale heights immediately');
tick({timestamp:300});
assert.equal(api.hasCameraSurface(),true);
season='Longpour';
assert.equal(api.cameraSurfaceYAt(.5,.5),null, 'season change stops stale slush collision before the next tick');
tick({timestamp:400});
assert.equal(scene.children.length,0);
area='map_western_slope'; tick({timestamp:500});
scene=new Node();
assert.equal(api.cameraSurfaceYAt(.5,.5),null, 'scene swap stops stale collision before rebuild');
area='map_i_den_map_western_slope_test'; tick({timestamp:600});
assert.equal(api.hasCameraSurface(),false, 'interiors never inherit cover collision');
console.log('Camera snow/slush collision: exact rendered triangles, short-character aim, seated/scripted views, and lifecycle passed.');

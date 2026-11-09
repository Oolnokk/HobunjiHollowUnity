const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/shoulder-camera-character-framing.js', 'utf8'); // Executes the real runtime bridge rather than a duplicate test implementation.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
} // Minimal Three.js vector surface required by the framing measurement code.

const shoulderMode = { distanceTiles: 2.6, targetYOffsetTiles: 0.62 }; // Reproduces the current Tletingan-authored Shoulder Cam defaults.
const scaleValues = {
  'tletingan::male': 0.85,
  'tletingan::female': 0.89,
  'mao-ao::male': 1.02,
  'mao-ao::female': 0.98,
}; // Supplies representative authored body-height factors for ratio tests.
const windowObject = {
  THREE: { Vector3 },
  SCRATCHBONES_CONFIG: { game: { camera: { modes: { shoulderSurf: shoulderMode } } } },
  HobunjiCharacterRigScale: {
    scaleFor(species, gender) {
      return { y: scaleValues[`${species}::${gender}`] || 1 };
    },
  },
  PNGPlaneAvatar: { resolveSkinnedPixelWorldPosition(node) { return node.testHeadWorld; } }, // Represents the existing canonical skinned head-centroid resolver used by dialogue.
  ProceduralLegAnimation: { attach() { return {}; } },
  ProceduralHandAttachments: { attach() { return {}; } },
}; // Provides the same global APIs the runtime bridge decorates in the game.
windowObject.window = windowObject;
const context = vm.createContext({
  window: windowObject,
  setInterval(fn) { fn(); return 1; },
  clearInterval() {},
  setTimeout(fn) { fn(); return 1; },
}); // Makes bridge installation and deferred leg refresh deterministic for this headless test.
vm.runInContext(source, context, { filename: 'shoulder-camera-character-framing.js' });

function makeRoot({ speciesId, gender, scaleY, neckHeight, modelHeight = 1, headHeight = neckHeight + 0.12, floorY = 0 }) {
  const neckJoint = {
    getWorldPosition(target) { target.x = 0; target.y = floorY + neckHeight; target.z = 0; return target; },
  }; // Represents the actual neck bone whose Y should drive non-Tletingan vertical framing.
  const avatarNode = {
    userData: {
      neckRig: { neckJoint, headCentroidPx: { x: 50, y: 15 } },
      portraitModelHeight: modelHeight,
      hobunjiCharacterRigHeadRuntime: { species: speciesId, gender },
    },
    testHeadWorld: headHeight == null ? null : { x: 0, y: floorY + headHeight, z: 0 }, // Lets fixtures control measured head height without introducing another head-position implementation.
    getWorldScale(target) { target.x = scaleY; target.y = scaleY; target.z = scaleY; return target; },
  }; // Represents the portrait avatar node carrying both rig and model-height metadata.
  return {
    userData: { hobunjiCharacterRigScaleState: { factor: { x: scaleY, y: scaleY }, species: speciesId } },
    updateMatrixWorld() {},
    getWorldPosition(target) { target.x = 0; target.y = floorY; target.z = 0; return target; },
    traverse(callback) { callback(this); callback(avatarNode); },
  }; // Represents the shared floor-relative player root used by hands, legs, portrait and camera framing.
}

const api = windowObject.HobunjiShoulderCameraCharacterFraming; // Public/mobile debug API exported by the bridge.
assert.ok(api && api.version >= 1, 'camera framing bridge must install');

const tletinganRoot = makeRoot({ speciesId: 'tletingan', gender: 'male', scaleY: 0.85, neckHeight: 0.71 }); // A reference species must now use its actual head center too.
assert.strictEqual(api.refreshPlayerFraming(tletinganRoot, { speciesId: 'tletingan', gender: 'male' }, 'test-tletingan'), true);
assert.strictEqual(shoulderMode.distanceTiles, 2.6, 'Tletingan must keep the current Shoulder Cam distance baseline');
assert.ok(Math.abs(shoulderMode.targetYOffsetTiles - 0.83) < 1e-9, 'Tletingan must target its head center');

const maoRoot = makeRoot({ speciesId: 'mao-ao', gender: 'male', scaleY: 1.02, neckHeight: 0.79 }); // Taller species fixture verifies both neck-Y and full-height distance adaptation.
assert.strictEqual(api.refreshPlayerFraming(maoRoot, { speciesId: 'mao-ao', gender: 'male' }, 'test-mao'), true);
const expectedRatio = 1.02 / 0.85; // Same-gender Tletingan scale is the requested reference height.
assert.ok(Math.abs(shoulderMode.distanceTiles - 2.6 * expectedRatio) < 1e-9, 'camera distance/zoom must scale with full character height');
assert.ok(Math.abs(shoulderMode.targetYOffsetTiles - 0.91) < 1e-9, 'camera Y must follow the live non-reference species head centroid');

const snapshot = api.snapshot(); // Confirms mobile diagnostics expose the measurements needed to validate framing without devtools.
assert.strictEqual(snapshot.speciesId, 'mao-ao');
assert.strictEqual(snapshot.gender, 'male');
assert.ok(Math.abs(snapshot.neckHeightTiles - 0.79) < 1e-9);
assert.ok(Math.abs(snapshot.heightRatio - expectedRatio) < 1e-9);
assert.ok(Math.abs(snapshot.characterHeightTiles - 1.02) < 1e-9);
assert.strictEqual(snapshot.usedMeasuredNeck, false);
assert.strictEqual(snapshot.usedMeasuredHead, true);
assert.strictEqual(snapshot.targetSource, 'head-centroid');
assert.ok(Math.abs(snapshot.headHeightTiles - 0.91) < 1e-9);

// Ranged focus now zooms optically by FOV. It must never freeze or own the
// species-relative shoulder distance while active.
windowObject.HobunjiRangedCameraFocus = { snapshot: () => ({ active: true, blend: 1, baseFovDeg: 55 }) };
const focusedRoot = makeRoot({ speciesId: 'mao-ao', gender: 'female', scaleY: 0.98, neckHeight: 0.76 });
assert.strictEqual(api.refreshPlayerFraming(focusedRoot, { speciesId: 'mao-ao', gender: 'female' }, 'test-focused'), true);
const focusedRatio = 0.98 / 0.89;
assert.ok(Math.abs(shoulderMode.distanceTiles - 2.6 * focusedRatio) < 1e-9,
  'active ranged FOV focus must not defer or overwrite species-relative camera distance');
const focusedSnapshot = api.snapshot();
assert.strictEqual(focusedSnapshot.distanceDeferredForRangedFocus, false);
assert.strictEqual(focusedSnapshot.rangedFocusActive, true);
assert.strictEqual(focusedSnapshot.rangedFocusBaseFovDeg, 55);

// Short species and elevated player roots retain the actual head's local height.
const nuhonganRoot = makeRoot({ speciesId: 'nuhongan', gender: 'male', scaleY: 0.6375, neckHeight: 0.15, headHeight: 0.29, floorY: 2.5 }); // Exercises Nuhongan head centering on a raised terrain tier.
assert.strictEqual(api.refreshPlayerFraming(nuhonganRoot, { speciesId: 'nuhongan', gender: 'male' }), true);
assert.ok(Math.abs(shoulderMode.targetYOffsetTiles - 0.29) < 1e-9, 'short characters target the head, with ground elevation removed');
assert.ok(Math.abs(shoulderMode.distanceTiles - 2.6 * 0.75) < 1e-9, 'head centering preserves existing species-relative distance');
assert.strictEqual(api.snapshot().targetSource, 'head-centroid');
const headlessRoot = makeRoot({ speciesId: 'nuhongan', gender: 'male', scaleY: 0.6375, neckHeight: 0.15, headHeight: null }); // Missing centroid data must keep a usable camera rather than producing NaN.
api.refreshPlayerFraming(headlessRoot, { speciesId: 'nuhongan', gender: 'male' });
assert.equal(shoulderMode.targetYOffsetTiles, 0.15);
assert.equal(api.snapshot().targetSource, 'neck-fallback');
for (const headHeight of [NaN, Infinity, -0.1, 12]) {
  const invalid = api.resolveFraming({ speciesId: 'nuhongan' }, { headHeight, neckHeight: 0.15, heightRatio: 0.75 }); // Verifies malformed head centers use the existing valid neck fallback.
  assert.equal(invalid.targetYOffsetTiles, 0.15);
  assert.equal(invalid.usedMeasuredHead, false);
}
const referenceFallback = api.resolveFraming({ speciesId: 'tletingan' }, { headHeight: null, neckHeight: 0.71, heightRatio: 1 }); // A missing Tletingan centroid retains its authored fallback.
assert.equal(referenceFallback.targetYOffsetTiles, 0.62);

console.log('Shoulder camera character framing tests passed.');

scaleValues['mashtzarr::male']=1.255; // Canonical tall-species fixture controls the assisted framing target.
api.refreshPlayerFraming(nuhonganRoot,{speciesId:'nuhongan',gender:'male'});
let surfaceNearby=true, probePosition=null; // Deterministic authored surface probe records only character position; orientation and camera height are absent.
windowObject.FurnitureTableSystem={nearbySurface(area,x,z){probePosition=[x,z];return {active:surfaceNearby,furnitureId:'serving-table',height:normalTarget+.1};}};
const normalDistance=shoulderMode.distanceTiles, normalTarget=shoulderMode.targetYOffsetTiles; // Species settings must survive assisted framing unchanged.
api.updateSurfaceView('town',0,0,true,0);
const rising=api.updateSurfaceView('town',0,0,true,100);
assert(rising.lift>0 && rising.distanceScale>1 && rising.blend<1,'camera eases upward and outward instead of snapping');
assert.deepEqual(probePosition,[0,0],'probe receives only player position');
for(let t=200;t<=2000;t+=100)api.updateSurfaceView('town',0,0,true,t);
assert(Math.abs(api.snapshot().surfaceView.distanceScale-(1.255/.6375))<.001,'zoom approaches the authored Mashtzarr height ratio');
assert.equal(shoulderMode.distanceTiles,normalDistance,'camera help never changes player zoom/species config');
assert.equal(shoulderMode.targetYOffsetTiles,normalTarget,'camera help never changes the normal head target');
surfaceNearby=false;
const before=api.snapshot().surfaceView.lift;
const falling=api.updateSurfaceView('town',0,0,true,2100);
assert(falling.lift>0 && falling.lift<before,'walking away smoothly restores normal framing');
assert.equal(api.updateSurfaceView('interior',0,0,true,2200).lift,0,'map transition clears the previous lift');
surfaceNearby=true;api.updateSurfaceView('interior',0,0,true,2300);
assert.equal(api.updateSurfaceView('interior',0,0,false,2400).lift,0,'scripted/seated camera ownership immediately clears assistance');

// Execute the actual game camera call with independently controlled player position and camera orbit.
const gameSource = fs.readFileSync('docs/game.js','utf8'); // Real integration must test adjacency at the character, rather than at the smoothed camera target.
const callStart = gameSource.indexOf('const surfaceView = window.HobunjiShoulderCameraCharacterFraming?.updateSurfaceView?.(');
const callEnd = gameSource.indexOf('performance.now());',callStart)+'performance.now());'.length;
const cameraCall = '{'+gameSource.slice(callStart,callEnd)+'}'; // Block scope permits repeatedly evaluating the real call as the camera turns.
let captured = null; // Holds the real camera adapter arguments for independent orbit tests.
const cameraContext = {window:{HobunjiShoulderCameraCharacterFraming:{updateSurfaceView(...args){captured=args;}}},
  currentArea:'town',player:{x:120,y:80},TILE:40,facingAngle:-Math.PI/2,azimuth:0,tx:999,tz:999,
  lookY:.3,angle:.1,distance:2,activeCameraMode:'shoulderSurf',SHOULDER_SURF_MODE:'shoulderSurf',
  portraitAim:null,cutscenePreviewActive:false,dialogueZoomActive:()=>false,performance:{now:()=>2500}}; // Bindings used by the shipped updateCameraPosition integration.
vm.runInNewContext(cameraCall,cameraContext);
assert.equal(captured[1],3,'adjacency uses player X, not the smoothed camera target');
assert.equal(captured[2],2,'adjacency uses player Z, not the smoothed camera target');
const originalArguments=[...captured]; // Position, mode ownership, and time are the entire lift input contract.
for (const rotation of [-Math.PI,-Math.PI/2,0,Math.PI/2,Math.PI]) {
 cameraContext.azimuth=rotation;cameraContext.facingAngle=rotation;cameraContext.angle=rotation; // Orbit, body yaw, and pitch change without moving the character.
 vm.runInNewContext(cameraCall,cameraContext);
 assert.deepEqual(captured,originalArguments,'camera and character rotation cannot affect lift inputs');
}
for (const ratio of [.5, 1, 1.75]) {
 const root = makeRoot({ speciesId:'test-size', gender:'male', scaleY:.85*ratio, neckHeight:.6*ratio }); // Reuses the measured species rig path at short, reference and tall scales.
 api.refreshPlayerFraming(root,{speciesId:'test-size',gender:'male'},'collision-limit-test');
 assert.ok(Math.abs(api.minimumCollisionSetback()-.8*ratio)<1e-9,'collision setback scales with the same cached body ratio as native shoulder distance');
}

windowObject.FurnitureTableSystem.nearbySurface=()=>({active:true,height:50,furnitureId:'high-pedestal'});
assert.equal(api.updateSurfaceView('ruin',0,0,true,2500).active,false,'High basin rims cannot trigger tall-species assistance');
windowObject.FurnitureTableSystem.nearbySurface=()=>({active:true,height:-5,furnitureId:'basin-floor'});
assert.equal(api.updateSurfaceView('ruin',0,0,true,2600).active,false,'Floors below the player do not request a camera lift');
const floorStart=gameSource.indexOf('function cameraSurfaceYAtWorld('),floorEnd=gameSource.indexOf('// Find the first terrain crossing',floorStart); // Execute the actual camera floor owner.
const floorQuery=vm.runInNewContext('('+gameSource.slice(floorStart,floorEnd).trim()+')',{
 currentArea:'map_i_dev_random_ruin',window:{DevRandomRuin:{getPlayerSupportY:()=>-3},DynamicSurfaces:{sampleSupport:(_x,_z,options)=>({y:options.maxY<0?-3:0})}},
 activeSurfaceYAtWorld:()=>0,
});
assert.equal(floorQuery(4,4),-3,'Camera clearance follows the sunken floor rather than the zero-height map proxy');

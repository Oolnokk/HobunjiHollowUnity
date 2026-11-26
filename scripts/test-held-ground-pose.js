const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync('docs/js/held-ground-pose.js','utf8'),context);
const {contractedZ,minimumY,chooseAngle}=context.window.HeldGroundPose;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} vs ${b}`);
const segments=[{a:-2,b:-1},{a:1,b:3}];
close(contractedZ(0,0,segments,.5),0);
close(contractedZ(-3,0,segments,.5),-2.5);
close(contractedZ(4,0,segments,.5),3);
close(contractedZ(3,0,segments,.5)-contractedZ(1,0,segments,.5),1);
close(contractedZ(1,0,segments,.5)-contractedZ(-1,0,segments,.5),2);
close(contractedZ(2,2,segments,.5),2);
const points=[{a:-1,b:1},{a:0,b:0}];
const angle=chooseAngle(points,1,.5);assert.ok(angle>0&&angle<Math.PI/2);
assert.ok(minimumY(points,1,angle)>=.5);
assert.equal(chooseAngle(points,1,.5,()=>false),null);
assert.equal(chooseAngle(points,2,.5),0);
assert.equal(chooseAngle([{a:0,b:0}],0,.5),null);
console.log('held ground pose: pure contraction and rotation checks passed');

// Protruding axe head: contact X is not a fictitious full-width rectangle.
const box={min:{x:-1,y:-2},max:{x:1,y:2}};
const axe=[{x:-.1,z:-2},{x:.1,z:-2},{x:.1,z:1},{x:1,z:1},{x:1,z:2},{x:-.1,z:2}];
const contacts=[];assert.equal(context.window.HeldGroundPose.contactVertices(box,axe,[{a:0,b:.5}],contacts),true);
assert.ok(contacts.some(p=>p.x===1&&p.z===2));
assert.ok(!contacts.some(p=>p.x===1&&p.z===-2));
assert.ok(contacts.some(p=>Math.abs(p.x-.1)<1e-6&&p.z===.5),'edge split at shortening boundary');
assert.equal(context.window.HeldGroundPose.contactVertices(box,[{x:2,z:0},{x:0,z:0},{x:0,z:1}],[],contacts),false);
assert.equal(contacts.length,4,'invalid outline uses rectangle');

const rope=context.window.HeldGroundPose.ropeClearance;
assert.equal(rope(2,.5,-1,3).length,2);
assert.equal(rope(2,.5,-1,1.5).length,1.5);
const drag=rope(2,.5,-1,.6);assert.equal(drag.length,1);assert.equal(drag.directionY,-.6);assert.equal(drag.trailing,true);
assert.equal(rope(2,.5,-1,-2),null);

const fixed=context.window.HeldGroundPose.fixedValue;
assert.equal(fixed(null,false,.8),null,'airborne cannot fit');
assert.equal(fixed(null,true,.4),.4,'grounded neutral fits');
assert.equal(fixed(.4,false,0),.4,'jump cannot lengthen');
assert.equal(fixed(.4,true,.7),.4,'later ground contact cannot shorten');
assert.equal(fixed(0,true,.7),0,'zero shortening is also a permanent fit');
assert.equal(rope(1,1,-1,.6).length,1,'fitted rope trails without changing its length');
assert.equal(rope(1,1,-1,2).length,1,'airborne rope never grows');

const {tracePixels}=context.window.HeldGroundPose;
const bounded=[{a:-1,b:0,x0:-.2,x1:.2}];
close(contractedZ(-1,1,bounded,.5,0),-.5);
close(contractedZ(-.5,1,bounded,.5,0),-.25);
close(contractedZ(-.5,1,bounded,.5,.8),0);
close(contractedZ(-1,1,bounded,.5,.8)-contractedZ(.5,1,bounded,.5,.8),-1.5);
const rgba=new Uint8ClampedArray(4*4*4);
for(const [x,y] of [[1,0],[1,1],[1,2],[2,0],[3,0],[1,3]])rgba[(y*4+x)*4+3]=255;
const traced=tracePixels(rgba,4,4,{min:{x:-1,y:-1},max:{x:1,y:1}},bounded);
assert.ok(traced.some(p=>p.x===1&&p.z===-1),'actual outer head pixel participates');
assert.ok(traced.every(p=>Number.isFinite(p.columnX)),'contact carries exact deformation column');
assert.ok(!traced.some(p=>p.x===1&&p.z===1),'transparent lower corner is excluded');
console.log('bounded bands and alpha contact: ok');

const candidate=context.window.HeldGroundPose.ropeFitCandidate;
close(candidate(0,2,1,1,.3,.5),1);
close(candidate(0,2,1,.5,.3,.5),.5);
close(candidate(0,2,1,.1,.3,.5),.3);
close(candidate(1,Math.sqrt(3),1,.25,.1,.5),.5);

const preview=context.window.HeldGroundPose;
assert.equal(preview.enabled(),false);
preview.configurePreview({});
assert.equal(preview.enabled(),true);
assert.equal(preview.groundY(),0,'preview floor equals visible grid');
preview.setPreviewEnabled(false);
assert.equal(preview.enabled(),false);
assert.equal(preview.snapshot().reason,'raw-preview');
preview.setPreviewEnabled(true);
assert.equal(preview.groundY(),0);

const editor=fs.readFileSync('docs/tools/attack-animation-editor/index.html','utf8');
assert.ok(editor.includes('js/held-ground-pose.js?'),'standalone page loads shared solver');
assert.ok(editor.includes('configurePreview?.(THREE)'),'editor supplies module-scoped Three');
assert.ok(editor.includes('solver.constrainWeapon(toolHolder,toolPlaneMesh,context)'),'editor runs real solver');
assert.ok(editor.includes('applyWeaponGroundPreview();'),'applied pose reaches solver');
assert.ok(editor.includes('previewAppliedGeometry()'),'Apply exits raw gizmo mode and focuses Neutral');
const author=fs.readFileSync('docs/js/weapon-geometry-author.js','utf8');
assert.ok(author.includes('originalGeometryFor?.(plane?.geometry)'),'drawing retains source coordinates during compression');
assert.ok(author.includes('weaponGeometryFitStatus'),'visible live diagnostic');
let THREE;
try{THREE=require('three');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
if(THREE){
  // Actual Three transforms and buffer geometry, synthetic opaque sprite.
  // No browser/WebGL or gameplay singleton is needed to run the editor path.
  const rgba=new Uint8ClampedArray(4*16*4).fill(255);
  const w={document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData(){return {data:rgba};}})})}};
  vm.runInNewContext(fs.readFileSync('docs/js/held-ground-pose.js','utf8'),{window:w});
  const solver=w.HeldGroundPose;solver.configurePreview(THREE);
  const parent=new THREE.Group(),holder=new THREE.Group(),weapon=new THREE.Group();
  parent.add(holder);holder.add(weapon);
  const source=new THREE.PlaneGeometry(.5,2),plane=new THREE.Mesh(source,new THREE.MeshBasicMaterial());
  plane.material.map={image:{width:4,height:16}};plane.rotation.x=-Math.PI/2;weapon.add(plane);weapon.userData.toolPlane=plane;
  holder.position.y=.6;holder.rotation.x=Math.PI/2;parent.updateMatrixWorld(true);
  const profile={a:-1,b:1,heightFraction:1,minSegmentScale:.5,segments:[{a:0,b:.9}],contactOutline:[]};
  const ctx={preview:true,rig:{parent},itemKey:'test',fitIdentity:'test',primary:{position:{x:0,y:0,z:0}},basis:new THREE.Quaternion(),authoredGripZ:0,profile,allowFit:true,lightReference:holder.matrix.clone()};
  assert.equal(solver.needsFit(ctx,weapon),true);
  solver.constrainWeapon(holder,weapon,ctx);
  const result=solver.snapshot();assert.ok(result.fitted&&result.shortening>0,'preview establishes shortening from Light');
  assert.ok(result.finalMinY>=.035-1e-5,'lowest opaque contact clears floor');
  assert.ok(plane.geometry!==source,'actual displayed geometry is shortened');
  const fitted=plane.geometry;
  holder.position.y=1.5;holder.rotation.x=Math.PI/2;parent.updateMatrixWorld(true);
  delete ctx.lightReference;solver.constrainWeapon(holder,weapon,ctx);
  assert.equal(plane.geometry,fitted,'later frames retain physical length');
  close(solver.snapshot().shortening,result.shortening);
  solver.setPreviewEnabled(false);
  assert.equal(plane.geometry,source,'raw mode restores original geometry');
  // Two visible copies have distinct raw poses. Correct around each actual
  // grip, including the offhand offset, rather than either mesh's origin.
  solver.setPreviewEnabled(true);
  holder.position.set(.1,.45,0);holder.rotation.set(Math.PI/2,0,0);
  const mainRoot=new THREE.Group(),offRoot=new THREE.Group();
  const mainMesh=new THREE.Mesh(source,new THREE.MeshBasicMaterial()),offMesh=new THREE.Mesh(source,new THREE.MeshBasicMaterial());
  mainRoot.add(mainMesh);offRoot.add(offMesh);plane.add(mainRoot,offRoot);
  mainRoot.position.x=-.2;offRoot.position.set(.3,0,.08);
  offRoot.rotation.z=.25;
  w.HobunjiDualWieldWeaponVisuals={isOwnedChild:(p,c)=>p===plane&&(c===mainRoot||c===offRoot)};
  ctx.dual=true;ctx.offhand={position:{x:.05,y:0,z:0}};
  parent.updateMatrixWorld(true);
  solver.constrainWeapon(holder,weapon,ctx);
  assert.equal(solver.snapshot().reason,'dual-ready');
  parent.updateMatrixWorld(true);
  const canonicalInverse=plane.matrixWorld.clone().invert();
  const localRight=new THREE.Vector3().applyMatrix4(holder.matrixWorld).applyMatrix4(canonicalInverse);
  const localLeft=new THREE.Vector3(.05,0,0).applyMatrix4(holder.matrixWorld).applyMatrix4(canonicalInverse);
  const beforeRight=localRight.clone().applyMatrix4(mainMesh.matrixWorld);
  const beforeLeft=localLeft.clone().applyMatrix4(offMesh.matrixWorld);
  const holderBefore=holder.matrix.clone();
  solver.constrainDualCopies({plane,mainRoot,offRoot,mainMesh,offMesh,invisible:false});
  const d=solver.snapshot().dual;
  assert.ok(d.right.angleDeg!==0&&d.left.angleDeg!==0,'independent corrective rotation');
  assert.ok(d.right.finalMinY>=.035-1e-5&&d.left.finalMinY>=.035-1e-5,'both weapons clear floor');
  close(localRight.clone().applyMatrix4(mainMesh.matrixWorld).distanceTo(beforeRight),0);
  close(localLeft.clone().applyMatrix4(offMesh.matrixWorld).distanceTo(beforeLeft),0);
  assert.ok(holder.matrix.equals(holderBefore),'dual solve does not modify authored holder');
  assert.equal(mainMesh.geometry,plane.geometry);
  assert.equal(offMesh.geometry,plane.geometry);
  // Unsupported live basis must keep the fixed geometry, not lengthen copies.
  plane.rotation.x=0;parent.updateMatrixWorld(true);
  solver.constrainWeapon(holder,weapon,ctx);
  solver.constrainDualCopies({plane,mainRoot,offRoot,mainMesh,offMesh,invisible:false});
  assert.equal(mainMesh.geometry,plane.geometry);
  assert.equal(offMesh.geometry,plane.geometry);
  assert.equal(solver.snapshot().reason,'dual-fit-retained');
  solver.setPreviewEnabled(false);
  assert.equal(mainMesh.geometry,source,'raw mode releases borrowed fit');
  assert.equal(offMesh.geometry,source);
  console.log('held ground pose: actual Three preview and independent dual grip pivots passed');
}

const suspended=context.window.HeldGroundPose.suspendedReferenceY;
// Local positive Y points upward in the Light reference. Moving a downward
// attachment toward the grip improves the full suspended-contact height.
const ref={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,1,0,1]};
const spec={x:0,y:-.6,spanX:0,spanY:.8,headDrop:.2};
close(suspended(ref,spec,[{a:0,b:.6}],0,0,.6),-.28);
close(suspended(ref,spec,[{a:0,b:.6}],0,.5,.6),.02);
assert.equal(rope(1,1,-1,.2).trailing,true,'fixed rope still trails');
const assemblies=fs.readFileSync('docs/js/weapon-sprite-assemblies.js','utf8');
assert.ok(assemblies.includes('const floor=profile?pose.groundY():null'),'zero rope-minimum does not disable clearance');
assert.ok(assemblies.includes('function groundFitSpec(root,profile)'),'fit uses actual suspended assembly');

const hiddenMain={visible:false},hiddenOff={visible:true,children:[{visible:false}]},overlay={visible:true};
const planeFixture={children:[hiddenMain,hiddenOff]};
context.window.HobunjiDualWieldWeaponVisuals={isNonDrawingChild:(p,c)=>p===planeFixture&&(c===hiddenMain||c===hiddenOff)&&(!c.visible||c.children.every(n=>!n.visible))};
assert.equal(preview.hasDrawingHaftChildren(planeFixture),false,'invisible offhand helper cannot reject a normal weapon');
hiddenOff.children[0].visible=true;
assert.equal(preview.hasDrawingHaftChildren(planeFixture),true,'real visible dual copy is still rejected');
hiddenOff.children[0].visible=false;planeFixture.children.push(overlay);
assert.equal(preview.hasDrawingHaftChildren(planeFixture),true,'unrelated layer is still rejected');

const flame={userData:{weaponInterleavedVfx:true}};
const firePlane={children:[flame]};
context.window.HobunjiWeaponSpriteAssemblies={isGroundNonSolidChild:(p,c)=>p===firePlane&&c===flame};
assert.equal(preview.hasDrawingHaftChildren(firePlane),false,'staff flame must not reject rigid sprite');
firePlane.children.push({userData:{weaponInterleavedVfx:true}});
assert.equal(preview.hasDrawingHaftChildren(firePlane),true,'unowned child cannot bypass topology check');

const dualChild={visible:true},canonical={children:[dualChild]};
context.window.HobunjiDualWieldWeaponVisuals={isOwnedChild:(p,c)=>p===canonical&&c===dualChild};
assert.equal(preview.hasDrawingHaftChildren(canonical),true);
assert.equal(preview.hasDrawingHaftChildren(canonical,true),false,'canonical dual source allows only owned copies');
canonical.children.push({visible:true});assert.equal(preview.hasDrawingHaftChildren(canonical,true),true);

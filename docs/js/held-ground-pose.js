// Experimental player-only clearance. Rigid art and grip sockets share the
// same solved pose; ground depth and gameplay collision are independent.
(function (global) {
  'use strict';
  const PAD = 0.035; // Clearance above the physical standing surface, in world units.
  const STEP = Math.PI / 36; // Bounded five-degree rotation search with refinement.
  const debug = { reason: 'not-run', angleDeg: 0, shortening: 0, floorY: null, originalMinY: null, finalMinY: null, rotations: 0, compressions: 0, contactHullBuilds: 0, deepShortening: false, contactHullVertices: 0, gripPivotDrift: null, gripLift: 0, clearanceStrategy: null, freeHandLifts: 0, fallbacks: 0 };
  let active = null, floorFrame = null, floor = null, scratch = null;
  let gripHolder=null; // Owner of the exact current sprite-space grip transform, shared with hand sockets.
  let lastPoseHolder=null,lastPoseFrame=null; // Prevent an extra pre-render bake when the dual owner already solved this frame.
  // Opt-in render trace (js/held-ground-pose-trace.js, ?groundPoseTrace=1). Off by default: hot paths only
  // pay one boolean test. Records what the last solve decided so a later render can be compared against it.
  let traceOn=false;
  const trace={solveCalls:0,failCalls:0,lastSolveFrame:null,lastReason:null,lastFailReason:null,lastFailFrame:null,lastTarget:null,lastFloor:null,lastSolvedY:null,lastPlane:null,lastContact:null,solved:null};
  const traceOut={inScene:false,drawnHullY:null,drawnPointsY:null,matrixDelta:0,target:null,floor:null,solvedY:null,solveCalls:0,failCalls:0,lastSolveFrame:null,reason:null,lastFailReason:null,lastFailFrame:null,itemKey:null,speciesId:null,hullBuilds:0,hullVertices:0};
  let dualPrepared=null; // The canonical fit is prepared before the independently posed visible copies.
  const borrowedCopies=new Set(); // At most two copies borrow the canonical private fitted buffer; detach before disposal.
  let previewRoot=null; // Exact currently corrected editor root; raw gizmo mode must also bypass the suspension solve.
  let previewThree=null,previewEnabled=false; // Standalone editor uses its ESM Three namespace and the visible Y=0 grid.
  function configurePreview(three){previewThree=three;previewEnabled=!!three;}
  function setPreviewEnabled(value){previewEnabled=!!value;if(!previewEnabled)skip('raw-preview');}
  function three(){return previewThree||global.THREE;}
  function skip(reason){clear();Object.assign(debug,{reason,fitted:false,angleDeg:0,shortening:0,originalMinY:null,finalMinY:null,contactSource:null,lightOriginalMinY:null,lightFittedMinY:null,assemblyDetail:null});}
  function previewAppliesTo(root){return !!previewThree&&previewEnabled&&previewRoot===root;}
  const actorFits=new WeakMap(); // Actor rig -> bounded per-item immutable physical fits, surviving equip/unequip and mesh replacement.
  const rootFits=new WeakMap(); // Flail owner resolves the exact same fit without another rig traversal.
  const NO_SEGMENTS=Object.freeze([]);
  const traceCache=new WeakMap(); // Final loaded image -> bounded alpha traces, never scan repeatedly in the render loop.
  function needsFit(context,mesh) {
    const fit=fitFor(context,mesh),image=mesh?.userData?.toolPlane?.material?.map?.image;
    return !!fit&&!Number.isFinite(fit.amount)&&!!image&&(image.naturalWidth||image.width)>0
      &&(!context.profile.modular||!!image.modularFrame);
  }
  function lightRopeScale(root){return rootFits.get(root)?.referenceFlailScale??1;}
  function ropeFitCandidate(spanX,spanY,scale,drop,minScale,lightScale=1){
    const base=Math.hypot(spanX,spanY);
    if(!(base>0&&scale>0&&lightScale>0)||!Number.isFinite(drop))return null;
    const available=Math.max(0,drop/scale);
    const requiredY=Math.sqrt(Math.max(0,available*available-spanX*spanX))/lightScale;
    return Math.max(minScale,Math.abs(spanX)/base,Math.min(1,Math.hypot(spanX,requiredY)/base));
  }
  function originalGeometryFor(geometry){return active?.geometry===geometry?active.source:geometry;}
  function prepareGeometryUpdate(geometry){if(active?.geometry===geometry)restoreGeometry();}
  function referenceDrop(root,point) {
    const fit=rootFits.get(root),e=fit?.referenceMatrix?.elements;
    return e?e[1]*point.x+e[5]*point.y+e[9]*point.z+e[13]-fit.referenceFloor:null;
  }
  function fitFor(context,mesh) {
    const owner=context.rig?.parent,profile=context.profile;
    if(!owner||!profile||!context.itemKey)return null;
    let items=actorFits.get(owner);
    if(!items){items=new Map();actorFits.set(owner,items);}
    const key=context.itemKey;
    let fit=items.get(key);
    if(!fit||fit.profile!==profile||fit.identity!==context.fitIdentity){
      fit={profile,identity:context.fitIdentity,amount:null,anchorZ:null,ropeScale:null};
      if(items.size>=128&&!items.has(key))items.delete(items.keys().next().value);
      items.set(key,fit);
    }
    rootFits.set(mesh,fit);
    return fit;
  }
  // A fitted length is immutable until the authoring profile or body identity changes.
  // Airborne samples, later attacks, and ground changes can never refit it.
  function fixedValue(previous,canFit,candidate) {
    if(Number.isFinite(previous))return previous;
    return canFit&&Number.isFinite(candidate)?candidate:null;
  }
  function fittedRopeScale(root,profile,canFit,candidate) {
    const fit=rootFits.get(root);
    if(!enabled()||fit?.profile!==profile)return 1;
    fit.ropeScale=fixedValue(fit.ropeScale,canFit&&Number.isFinite(fit.amount),candidate);
    return fit.ropeScale??1;
  }
  const frameId = () => global.RuntimeFrameScheduler?.frameId?.();
  function enabled() { return previewThree?previewEnabled:global.XrayHierarchy?.get?.('ground.heldPose') === 'rotation'; }
  function groundY() {
    if (!enabled()) return null;
    if(previewThree){debug.floorY=0;return 0;}
    const id = frameId();
    if (id == null || floorFrame !== id) {
      floorFrame = id;
      floor = global.PlayerJump?.heldPoseGroundY?.() ?? null;
      debug.floorY = Number.isFinite(floor) ? floor : null;
    }
    return Number.isFinite(floor) ? floor : null;
  }
  // Integrate equal strain over disjoint intervals. Subtract the grip's
  // displacement so it remains a fixed point even inside a compressible span.
  function contractedZ(z, gripZ, segments, amount, columnX = null) {
    if (!amount) return z;
    let delta = 0;
    for (const v of segments) {
      const span = v.b-v.a;
      // Outside a bounded band the protruding head stays rigid, following the
      // headward end rather than being compressed along with the wooden haft.
      const outside=columnX!=null&&v.x0!=null&&(columnX<v.x0||columnX>v.x1);
      const sample=outside?(gripZ<=(v.a+v.b)/2?v.b:v.a):z;
      delta += Math.max(0,Math.min(span,sample-v.a))-Math.max(0,Math.min(span,gripZ-v.a));
    }
    return z-amount*delta;
  }
  function minimumY(points, pivotY, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    let min = Infinity;
    for (const p of points) min = Math.min(min,pivotY+p.a*c+p.b*s);
    return min;
  }
  function chooseAngle(points,pivotY,floorY,reachable = () => true) {
    if (!points.length || !Number.isFinite(pivotY) || !Number.isFinite(floorY)) return null;
    if (minimumY(points,pivotY,0)>=floorY) return 0;
    const valid = a => minimumY(points,pivotY,a)>=floorY && reachable(a);
    for(let i=1;i<=18;i++) {
      const magnitude=i*STEP;
      let best=null;
      for(const sign of [1,-1]) {
        if(!valid(sign*magnitude)) continue;
        let lo=magnitude-STEP,hi=magnitude;
        for(let j=0;j<10;j++) { const mid=(lo+hi)/2; if(valid(sign*mid))hi=mid;else lo=mid; }
        const angle=sign*hi;
        if(best===null||Math.abs(angle)<Math.abs(best))best=angle;
      }
      if(best!==null)return best;
    }
    return null;
  }
  function work() {
    const T=three();
    if(!T)return null;
    return scratch ||= {
      holder: new T.Matrix4(), mesh: new T.Matrix4(), plane: new T.Matrix4(), matrix: new T.Matrix4(), reference: new T.Matrix4(),
      inverse: new T.Matrix4(), parentInverse: new T.Matrix4(), pivot: new T.Vector3(),
      grip: new T.Vector3(), second: new T.Vector3(), shoulder: new T.Vector3(),
      axis: new T.Vector3(), direction: new T.Vector3(), cross: new T.Vector3(),
      radialAxis: new T.Vector3(), flatAxis: new T.Vector3(), // Fallback rotation axes used only when the authored pose penetrates.
      faceX: new T.Vector3(), faceY: new T.Vector3(), faceZ: new T.Vector3(), faceFrom: new T.Matrix4(), faceTo: new T.Matrix4(), // Face-up flat fallback.
      point: new T.Vector3(), rel: new T.Vector3(), base: new T.Vector3(), candidate: new T.Vector3(),
      pos: new T.Vector3(), scale: new T.Vector3(), parentQ: new T.Quaternion(), q: new T.Quaternion(),
      localQ: new T.Quaternion(), oldQ: new T.Quaternion(), gripBasis: new T.Quaternion(),
      samples: [], points: [], rows: [], contact: [], contactKey: null, contactSource: null, contactSegments: null,
    };
  }
  function detachBorrowed(){
    for(const copy of borrowedCopies)if(copy.geometry===active?.geometry)copy.geometry=active.source;
    borrowedCopies.clear();
  }
  function restoreGeometry() {
    if (!active) return;
    detachBorrowed();
    if (active.plane.geometry===active.geometry) active.plane.geometry=active.source;
    active.geometry.dispose();
    active=null;
  }
  function releaseCompression() {
    if(!active)return;
    detachBorrowed();
    if(active.plane.geometry===active.geometry)active.plane.geometry=active.source;
    active.amount=0; // Keep the private strip buffer for the next near-ground pose.
  }
  function clear() { previewRoot=null;gripHolder=null;lastPoseHolder=null;lastPoseFrame=null;dualPrepared=null;debug.dual=null;debug.gripPivotDrift=null;debug.gripLift=0;debug.clearanceStrategy=null;restoreGeometry(); }
  function fail(reason,preserveFit=false) { debug.reason=reason; debug.fallbacks++; if(traceOn){trace.failCalls++;trace.lastFailReason=reason;trace.lastFailFrame=frameId()??null;} if(!preserveFit)restoreGeometry();return false; }
  // The canonical PNG is a flat XY quad; its -90 degree X basis makes
  // image Y correspond to -item Z. Split exactly at the authored endpoints,
  // preserving UVs so the rigid portions are never squashed by interpolation.
  function stripRows(box,segments,rows) {
    rows.length=0; rows.push(box.max.y,box.min.y);
    for(const v of segments)for(const y of [-v.a,-v.b])if(y>box.min.y&&y<box.max.y)rows.push(y);
    rows.sort((a,b)=>b-a);
    for(let i=rows.length-1;i>0;i--)if(Math.abs(rows[i]-rows[i-1])<1e-7)rows.splice(i,1);
    return rows;
  }
  function columnCuts(box,segments) {
    const cuts=[box.min.x,box.max.x];
    for(const v of segments)for(const x of [v.x0,v.x1])if(x>box.min.x&&x<box.max.x)cuts.push(x);
    return [...new Set(cuts)].sort((a,b)=>a-b);
  }
  function convexHull(points) {
    if(points.length<2)return points;
    const sorted=points.sort((a,b)=>a.x-b.x||a.z-b.z);
    const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
    const half=items=>{const out=[];for(const p of items){while(out.length>=2&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}out.pop();return out;};
    return half(sorted).concat(half(sorted.slice().reverse()));
  }
  function tracePixels(rgba,w,h,box,segments) {
    // Each column's alpha hull is clipped at the exact authored horizontal
    // cuts; split hull edges at longitudinal cuts before transforming.
    const cuts=columnCuts(box,segments),result=[];
    const dx=(box.max.x-box.min.x)/w,dz=(box.max.y-box.min.y)/h;
    for(let c=0;c<cuts.length-1;c++){
      const left=cuts[c],right=cuts[c+1],columnX=(left+right)/2,points=[];
      const start=Math.max(0,Math.floor((left-box.min.x)/dx)),end=Math.min(w,Math.ceil((right-box.min.x)/dx));
      for(let y=0;y<h;y++){
        let lo=end,hi=-1;
        for(let x=start;x<end;x++)if(rgba[(y*w+x)*4+3]>=21){lo=Math.min(lo,x);hi=x;}
        if(hi<lo)continue;
        const x0=Math.max(left,box.min.x+lo*dx),x1=Math.min(right,box.min.x+(hi+1)*dx);
        if(x1<=x0)continue;
        const z0=-box.max.y+y*dz,z1=z0+dz;
        points.push({x:x0,z:z0},{x:x1,z:z0},{x:x0,z:z1},{x:x1,z:z1});
      }
      if(!points.length)continue;
      const hull=convexHull(points),vertices=[];
      contactVertices(box,hull,segments,vertices);
      for(const p of vertices)result.push({...p,columnX});
    }
    return result;
  }
  function autoContact(image,box,segments) {
    if(!image||!(image.naturalWidth||image.width)||!(image.naturalHeight||image.height))return null;
    let cache=traceCache.get(image);
    if(!cache){cache=new Map();traceCache.set(image,cache);}
    const signature=[box.min.x,box.max.x,box.min.y,box.max.y,JSON.stringify(segments)].join('|');
    if(cache.has(signature))return cache.get(signature);
    let result=null;
    try{
      const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
      if(w>0&&h>0&&w*h<=16000000){
        const canvas=global.document.createElement('canvas');canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
        const points=tracePixels(ctx.getImageData(0,0,w,h).data,w,h,box,segments);
        if(points.length)result=points;
      }
    }catch(_){/* Unreadable alpha keeps legacy fallback; never freeze an unverified fit. */}
    if(cache.size>=8)cache.delete(cache.keys().next().value);
    cache.set(signature,result);return result;
  }
  function setCompression(plane,source,box,rows,segments,gripZ,amount,holder,rootScale) {
    if(!amount) { releaseCompression(); return; }
    const T=three();
    if(active?.plane===plane&&active.source===source&&active.amount===amount&&active.gripZ===gripZ&&active.segments===segments){
      active.holder=holder;active.rootScale=rootScale;plane.geometry=active.geometry;return;
    }
    const cuts=columnCuts(box,segments); // Independent strips duplicate the seam vertices so a rigid beard is never sheared.
    const signature=rows.join(',')+'|'+cuts.join(',');
    if(!active||active.plane!==plane||active.source!==source||active.signature!==signature) {
      restoreGeometry();
      const geometry=new T.BufferGeometry(),count=(cuts.length-1)*rows.length*2;
      geometry.parameters={...source.parameters}; // Preserve canonical source width for flail pixel anchors and rope scale.
      geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(count*3),3));
      geometry.setAttribute('uv',new T.BufferAttribute(new Float32Array(count*2),2));
      geometry.setAttribute('normal',new T.BufferAttribute(Float32Array.from({length:count*3},(_,i)=>i%3===2?1:0),3));
      const indices=[];
      for(let c=0;c<cuts.length-1;c++)for(let i=0;i<rows.length-1;i++){
        const a=(c*rows.length+i)*2;indices.push(a,a+2,a+1,a+2,a+3,a+1);
      }
      geometry.setIndex(indices);
      active={plane,source,geometry,signature,amount:-1,gripZ:NaN,holder,rootScale,segments};
    }
    // Geometry is private to this equipped plane, never the shared asset.
    const sameSegments=active.segments===segments; // Profiles are normalized and cached by the grip metadata owner.
    if(active.amount!==amount||active.gripZ!==gripZ||!sameSegments) {
      const p=active.geometry.attributes.position,uv=active.geometry.attributes.uv;
      const height=box.max.y-box.min.y;
      const width=box.max.x-box.min.x;
      for(let c=0;c<cuts.length-1;c++)for(let i=0;i<rows.length;i++) {
        const left=cuts[c],right=cuts[c+1],columnX=(left+right)/2;
        const y=-contractedZ(-rows[i],gripZ,segments,amount,columnX),v=(rows[i]-box.min.y)/height,index=(c*rows.length+i)*2;
        p.setXYZ(index,left,y,0);p.setXYZ(index+1,right,y,0);
        uv.setXY(index,(left-box.min.x)/width,v);uv.setXY(index+1,(right-box.min.x)/width,v);
      }
      p.needsUpdate=true;uv.needsUpdate=true;
      active.geometry.computeBoundingBox();active.geometry.computeBoundingSphere();
    }
    Object.assign(active,{amount,gripZ,holder,rootScale,segments});
    plane.geometry=active.geometry;
  }
  function gripZFor(point,mesh) { return (point.z-mesh.position.z)/mesh.scale.z; }
  function adjustHaftPoint(plane,point) {
    // The rope anchor follows exactly the same strip deformation as the art.
    if(enabled()&&active?.amount&&(active.plane===plane||borrowedCopies.has(plane)))point.y=-contractedZ(-point.y,active.gripZ,active.segments,active.amount,point.x);
    return point;
  }
  // The shortest permissible straight connector is tried first. If that
  // cannot hang vertically, retain the minimum length and trail sideways.
  function ropeClearance(length,minScale,directionY,availableDrop) {
    if(!(length>0)||!Number.isFinite(availableDrop))return null;
    const dy=Math.max(-1,Math.min(1,directionY));
    const min=length*Math.max(.1,Math.min(1,minScale));
    if(length*dy>=-availableDrop)return {length,directionY:dy,trailing:false};
    if(dy<0&&availableDrop>=0) {
      const desired=availableDrop/-dy;
      if(desired>=min)return {length:Math.min(length,desired),directionY:dy,trailing:false};
    }
    if(-availableDrop>min)return null; // Even the shortest connector cannot reach the required raised endpoint.
    return {length:min,directionY:Math.max(-1,Math.min(1,-availableDrop/min)),trailing:true};
  }
  function adjustGrip(holder,point) {
    if(!enabled()||active?.holder!==holder||!active.amount)return point;
    const z=(point.z-active.rootOffset)/active.rootScale;
    return {x:point.x,y:point.y,z:active.rootOffset+contractedZ(z,active.gripZ,active.segments,active.amount)*active.rootScale};
  }
  // Grip data is calibrated in the neutral item frame, not at the holder
  // origin. Undo the item's placement, deform/rotate in its own space, then
  // apply the visible root scale (including a reflected X) and placement.
  function localGripPoint(point,basis,mesh,gripZ,segments,amount,out) {
    const position=mesh.position,scale=mesh.scale;
    return out.set((point.x-position.x)/Math.abs(scale.x),
      (point.y-position.y)/Math.abs(scale.y),
      contractedZ(gripZFor(point,mesh),gripZ,segments,amount))
      .applyQuaternion(basis).multiply(scale).add(position);
  }
  function worldGrip(s,point,basis,mesh,gripZ,segments,amount,out) {
    return localGripPoint(point,basis,mesh,gripZ,segments,amount,out).applyMatrix4(s.holder);
  }
  function gripBasisFor(holder) {
    return holder===gripHolder?scratch?.gripBasis:null;
  }
  function hasCurrentGripPose(holder) {
    const id=frameId();
    return id!=null&&lastPoseHolder===holder&&lastPoseFrame===id;
  }
  function resolveGripLocal(holder,point,out) {
    const s=scratch;
    if(!s||!gripHolder||holder!==gripHolder)return null;
    return localGripPoint(point,s.gripBasis,s.gripMesh,s.gripAnchor,s.gripSegments,s.gripAmount,out);
  }
  // Split every outline edge at the shortening boundaries. The deformation
  // is piecewise affine, so its extrema occur at these vertices.
  function contactVertices(box,outline,segments,out=[]) {
    out.length=0;
    const valid=Array.isArray(outline)&&outline.length>=3&&outline.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)
      &&p.x>=box.min.x-1e-5&&p.x<=box.max.x+1e-5&&-p.z>=box.min.y-1e-5&&-p.z<=box.max.y+1e-5);
    const polygon=valid?outline:[{x:box.min.x,z:-box.max.y},{x:box.max.x,z:-box.max.y},{x:box.max.x,z:-box.min.y},{x:box.min.x,z:-box.min.y}];
    for(let i=0;i<polygon.length;i++){
      const p=polygon[i],q=polygon[(i+1)%polygon.length];
      out.push(p);
      if(Math.abs(q.z-p.z)<1e-10)continue;
      for(const seg of segments)for(const z of [seg.a,seg.b]){
        const t=(z-p.z)/(q.z-p.z);
        if(t>0&&t<1)out.push({x:p.x+(q.x-p.x)*t,z});
      }
    }
    return valid;
  }
  function samplePoints(s,vertices,segments,gripZ,amount,matrix=s.matrix) {
    let min=Infinity;
    const e=matrix.elements; // Actual X extent, including protruding heads.
    for(const p of vertices){
      const y=-contractedZ(p.z,gripZ,segments,amount,p.columnX);
      min=Math.min(min,e[1]*p.x+e[5]*y+e[13]);
    }
    return min;
  }
  function bakeContact(vertices,segments,gripZ,amount) {
    // Keep source ordering for the lowest-point tie that picks the rotation axis.
    const points=vertices.map(p=>({x:p.x,z:contractedZ(p.z,gripZ,segments,amount,p.columnX)}));
    return {points,hull:convexHull(points.slice())};
  }
  function projectedContactY(hull,matrix) {
    const e=matrix.elements; // World height is affine in the sprite's local XY.
    let min=Infinity;
    for(const p of hull)min=Math.min(min,e[1]*p.x+e[5]*-p.z+e[13]);
    return min;
  }
  function fittedContact(s,segments,gripZ,amount,deep=false) {
    const k=deep?'deep':'baked'; // Two slots: the fitted length, and the full shortening used before a fallback orientation.
    if(!s[k+'Contact']||s[k+'Amount']!==amount||(amount!==0&&s[k+'GripZ']!==gripZ)){
      s[k+'Contact']=amount?bakeContact(s.contact,segments,gripZ,amount):{points:s.contact,hull:s.rawHull};
      s[k+'Amount']=amount;
      s[k+'GripZ']=gripZ;
      debug.contactHullBuilds++;
    }
    return s[k+'Contact'];
  }
  function suspendedReferenceY(matrix,spec,segments,gripZ,amount,lightScale){
    const e=matrix.elements,scale=Math.hypot(e[4],e[5],e[6]); // Actual Light stance long-axis scale, never the live attack scale.
    const anchorY=e[1]*spec.x-e[5]*contractedZ(-spec.y,gripZ,segments,amount,spec.x)+e[13];
    return anchorY-scale*(spec.headDrop+Math.hypot(spec.spanX,spec.spanY*lightScale));
  }
  // Enchantment motes (combat/weapon-enchantment-vfx.js) are camera-facing sprites in one marked group parented to
  // the haft plane. They are attached a moment after the weapon is equipped, so treating them as a drawing child
  // made a solve that had worked fail with 'unsupported-assembly' ever after and left the raw stance on screen.
  // Only the marked group with nothing but sprites is exempt; any real mesh or PNG overlay stays solid.
  function isEnchantmentVfxChild(child){
    if(child?.userData?.weaponEnchantmentVfx!==true)return false;
    for(const node of child.children||[])if(!node.isSprite)return false;
    return true;
  }
  function hasDrawingHaftChildren(plane,allowDual=false){
    const copies=global.HobunjiDualWieldWeaponVisuals;
    const assemblies=global.HobunjiWeaponSpriteAssemblies;
    for(const child of plane.children)if(!copies?.isNonDrawingChild?.(plane,child)&&!(allowDual&&copies?.isOwnedChild?.(plane,child))&&!assemblies?.isGroundNonSolidChild?.(plane,child)&&!isEnchantmentVfxChild(child))return true;
    return false;
  }
  function constrainWeapon(holder,mesh,context) {
    dualPrepared=null;gripHolder=null;debug.gripPivotDrift=null;debug.gripLift=0;debug.clearanceStrategy=null;
    debug.itemKey=context?.itemKey??null;debug.speciesId=context?.scaleIdentity?.speciesId??null;debug.gripY=null;debug.deepShortening=false;
    if(!enabled()){clear();return false;}
    lastPoseHolder=holder;lastPoseFrame=frameId();
    previewRoot=null;debug.dual=null;debug.angleDeg=0;debug.shortening=0;debug.originalMinY=null;debug.finalMinY=null;debug.fitted=false;debug.assemblyDetail=null;debug.lightOriginalMinY=null;debug.lightFittedMinY=null;
    const y=groundY(),s=work(),plane=mesh?.userData?.toolPlane;
    if(!s||!context||!holder?.parent||!holder.visible||!mesh?.visible||(!plane?.visible&&!context.dual))return fail('no-rig');
    // A missing support sample is normal over a gap; it must not undo a fit.
    if(active&&active.plane!==plane)restoreGeometry();
    const kind=global.HobunjiWeaponSpriteAssemblies?.assemblyKind?.(mesh);
    const flexible=kind==='flail'||context.flexibleHaft===true;
    if(flexible&&!context.profile)return fail('unmeasured-flail');
    const fit=fitFor(context,mesh); // Fitting and rotation are separate: only the former is retained.
    // Suspension siblings are owned by the actual decorated root. A caller's
    // spelling of the weapon key cannot cause a legitimate flail to be rejected.
    const detail=mesh.parent!==holder?'root-parent':plane.parent!==mesh?'haft-parent':
      (!flexible&&mesh.children.length!==1)?'rigid-siblings':
      hasDrawingHaftChildren(plane,context.dual===true)?'haft-children':mesh.userData.toolEndFlipBase?'end-flip':
      plane.isSkinnedMesh||plane.isInstancedMesh?'nonrigid-plane':!(mesh.scale.z>0)?'nonpositive-scale':null;
    if(detail){debug.assemblyDetail=detail+' · '+(kind||'unregistered')+' · root children '+mesh.children.length+' · haft children '+plane.children.length;return fail('unsupported-assembly');}
    if(context.preview)previewRoot=mesh;
    const source=active?.plane===plane&&plane.geometry===active.geometry?active.source:plane.geometry;
    if(source?.type!=='PlaneGeometry'||source.attributes.position.count!==4)return fail('non-quad-weapon');
    if(active&&active.source!==source)restoreGeometry();
    if(!source.boundingBox)source.computeBoundingBox();
    const box=source.boundingBox;
    if(!box||box.isEmpty()||Math.abs(box.max.z-box.min.z)>1e-6||Math.abs(box.max.z)>1e-6)return fail('invalid-geometry');
    // Apply known physical geometry even when there is no floor, a rotated
    // child basis, or a nonuniform parent that makes a rotation solve unsafe.
    if(fit?.amount>1e-6&&fit.profile.segments.length) {
      const rows=stripRows(box,fit.profile.segments,s.rows);
      setCompression(plane,source,box,rows,fit.profile.segments,fit.anchorZ,fit.amount,holder,mesh.scale.z);
      active.rootOffset=mesh.position.z;
    } else releaseCompression();
    debug.shortening=fit?.amount??0;debug.fitted=Number.isFinite(fit?.amount);debug.lightOriginalMinY=fit?.lightOriginalMinY??null;debug.lightFittedMinY=fit?.lightFittedMinY??null;
    // Preserve fitted length on both copies even over pits or when their live
    // orientation cannot be corrected. Only the floor-dependent solve waits.
    if(context.dual)dualPrepared={holder,mesh,plane,context,segments:fit?.profile?.segments||NO_SEGMENTS,gripZ:fit?.anchorZ??context.authoredGripZ,amount:fit?.amount??0,contact:null,target:null,floor:y,flexible};
    if(!Number.isFinite(y))return fail('no-ground-sample',true);
    if(Math.abs(mesh.quaternion.x)+Math.abs(mesh.quaternion.y)+Math.abs(mesh.quaternion.z)>1e-6
      ||Math.abs(plane.rotation.x+Math.PI/2)>1e-4||Math.abs(plane.rotation.y)>1e-4
      ||plane.position.lengthSq()>1e-8||!(plane.scale.x>0&&plane.scale.y>0&&plane.scale.z>0)||!mesh.scale.x||!mesh.scale.y)
      return fail('unsupported-rotation-basis',true);
    const parent=holder.parent;
    parent.matrixWorld.decompose(s.pos,s.parentQ,s.scale);
    if(!uniformParentScale(s.scale))return fail('nonuniform-holder-parent',true);
    holder.updateMatrix();mesh.updateMatrix();plane.updateMatrix();
    s.holder.multiplyMatrices(parent.matrixWorld,holder.matrix);
    s.mesh.multiplyMatrices(s.holder,mesh.matrix);
    s.matrix.multiplyMatrices(s.mesh,plane.matrix);
    const primary=context.primary?.position;
    if(!primary)return fail('no-primary-grip',true);
    // Read the actual rendered sprite basis after the stance owner's twist.
    // A separately reconstructed/rounded animation basis is not authoritative.
    const basis=s.gripBasis.set(Math.SQRT1_2,0,0,Math.SQRT1_2).premultiply(plane.quaternion);
    const profile=context.profile;
    // Use a single source-space anchor for the whole lifetime of the fit.
    // Animated grip ranges and sweep twists may change the hand, never the
    // physical proportions of the weapon.
    const image=plane.material?.map?.image;
    const measuredSource=!!image&&(image.naturalWidth||image.width)>0&&(image.naturalHeight||image.height)>0
      &&(profile?.modular?!!image.modularFrame:(profile?.a>=-box.max.y-1e-4&&profile?.b<=-box.min.y+1e-4));
    const pending=!!fit&&context.allowFit&&!!context.lightReference&&measuredSource&&(context.preview===true||global.PlayerJump?.heldPoseGrounded?.()===true);
    const gripZ=fit?.anchorZ??context.authoredGripZ??gripZFor(primary,mesh);
    const segments=profile&&(pending||Number.isFinite(fit?.amount))?profile.segments:NO_SEGMENTS;
    const rows=stripRows(box,segments,s.rows);
    const outline=profile?.contactOutline;
    const segmentKey=segments.length?segments:null;
    const boundsChanged=s.contactMinX!==box.min.x||s.contactMaxX!==box.max.x||s.contactMinY!==box.min.y||s.contactMaxY!==box.max.y;
    if(!s.rawHull||s.contactKey!==outline||s.contactSource!==source||s.contactImage!==image||s.contactSegments!==segmentKey||boundsChanged){
      const auto=autoContact(image,box,segments);
      s.contact.length=0;
      if(auto)s.contact.push(...auto);
      else contactVertices(box,outline,segments,s.contact);
      s.rawHull=convexHull(s.contact.slice()); // Full unshortened outline for the diagnostic minimum.
      s.bakedContact=null;s.deepContact=null; // Asset, segment layout, or bounds changed.
      s.autoContact=!!auto;s.contactKey=outline;s.contactSource=source;s.contactImage=image;s.contactSegments=segmentKey;
      s.contactMinX=box.min.x;s.contactMaxX=box.max.x;s.contactMinY=box.min.y;s.contactMaxY=box.max.y;
    }
    const suspension=pending&&!Number.isFinite(fit.amount)&&flexible?global.HobunjiWeaponSpriteAssemblies?.groundFitSpec?.(mesh,profile):null;
    const canFit=pending&&!Number.isFinite(fit.amount)&&s.autoContact&&(!flexible||!!suspension); // Do not lock zero shortening before the rope/head have loaded.
    debug.contactSource=s.autoContact?'auto-alpha':outline?.length?'authored-fallback':'quad-fallback';
    debug.contactVertices=s.contact.length;
    if(canFit)s.reference.multiplyMatrices(parent.matrixWorld,context.lightReference).multiply(mesh.matrix).multiply(context.lightPlaneReference||plane.matrix);
    debug.fitReference='lightWeapon';
    const target=y+PAD;
    const original=projectedContactY(s.rawHull,s.matrix); // Unshortened baseline in Pixel Probe.
    debug.originalMinY=original;
    let amount=fit?.amount??0; // The fitting pass may establish a permanent shortening.
    const rig=context.rig;
    const secondary=context.secondary?.position;
    function reachable(a,compression) {
      if(!secondary)return true;
      const local=rig.shoulderPositionLocal?.('left',s.shoulder);
      const reach=rig.armLengthForSide?.('left');
      if(!local||!(reach>0))return false;
      // Measure in the same rig-parent frame as the authored arm length.
      s.inverse.copy(rig.parent.matrixWorld).invert();
      worldGrip(s,secondary,basis,mesh,gripZ,segments,compression,s.second);
      if(a)s.second.sub(s.pivot).applyQuaternion(s.q.setFromAxisAngle(s.axis,a)).add(s.pivot);
      s.second.applyMatrix4(s.inverse);
      // Existing authored poses may already exceed reach. Do not worsen them.
      worldGrip(s,secondary,basis,mesh,gripZ,segments,0,s.base).applyMatrix4(s.inverse);
      return s.second.distanceTo(s.shoulder)<=Math.max(reach,s.base.distanceTo(s.shoulder))+0.002;
    }
    if(canFit){
      const lightScale=context.lightReferenceFlailScale??1;
      const evaluate=a=>Math.min(samplePoints(s,s.contact,segments,gripZ,a,s.reference),suspension?suspendedReferenceY(s.reference,suspension,segments,gripZ,a,lightScale):Infinity);
      const referenceMin=evaluate(0);
      const max=1-profile.minSegmentScale;
      debug.lightOriginalMinY=referenceMin;
      if(referenceMin<target&&segments.length&&max>0){
        // Minimum of affine contact heights is concave in shortening. Find
        // the best safe amount even when another edge becomes the lowest.
        let lo=0,hi=max;
        for(let i=0;i<24;i++){const a=(2*lo+hi)/3,b=(lo+2*hi)/3;if(evaluate(a)<evaluate(b))lo=a;else hi=b;}
        const peak=(lo+hi)/2;
        let best=evaluate(max)>=evaluate(peak)?max:peak;
        if(evaluate(best)>referenceMin+1e-6){
          if(evaluate(best)>=target){lo=0;hi=best;for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(evaluate(mid)>=target)hi=mid;else lo=mid;}best=hi;}
          amount=best;
        }
      }
      fit.amount=fixedValue(fit.amount,true,amount);fit.anchorZ=gripZ;
      fit.referenceMatrix=s.reference.clone();fit.referenceFloor=target;fit.referenceFlailScale=context.lightReferenceFlailScale??1;
      debug.lightFittedMinY=evaluate(amount);
      fit.lightOriginalMinY=referenceMin;fit.lightFittedMinY=debug.lightFittedMinY;
      if(suspension){
        const e=s.reference.elements,scale=Math.hypot(e[4],e[5],e[6]);
        const anchorY=e[1]*suspension.x-e[5]*contractedZ(-suspension.y,gripZ,segments,amount,suspension.x)+e[13];
        fit.ropeScale=profile.ropeMinScale!=null?ropeFitCandidate(suspension.spanX,suspension.spanY,scale,anchorY-target-scale*suspension.headDrop,profile.ropeMinScale,lightScale):1;
      }
    }
    // Always apply the fitted geometry before attempting a pose correction.
    // A failed rotation retains the fit and falls back to legacy depth.
    if(amount>1e-6&&segments.length) {
      setCompression(plane,source,box,rows,segments,gripZ,amount,holder,mesh.scale.z);
      active.rootOffset=mesh.position.z;
      debug.compressions++;
    } else releaseCompression();
    debug.shortening=amount;debug.fitted=Number.isFinite(fit?.amount);
    gripHolder=holder; s.gripMesh=mesh;s.gripAnchor=gripZ;s.gripSegments=segments;s.gripAmount=amount;
    const contact=fittedContact(s,segments,gripZ,amount); // Both dual copies share the baked sprite coordinates.
    debug.contactHullVertices=contact.hull.length;
    if(context.dual){
      // The hidden source owns length, not either hand's live orientation.
      // Copies are posed later by the dual-wield owner, then individually corrected.
      dualPrepared={holder,mesh,plane,context,basis,segments,gripZ,amount,contact,target,floor:y,flexible,source,box};
      debug.reason='dual-ready';debug.finalMinY=null;return false;
    }
    let min=amount?projectedContactY(contact.hull,s.matrix):original;
    let angle=0; // Clear poses skip the pivot and rotation work.
    let used=contact,usedAmount=amount; // Become the deepest shortening when only a fallback orientation clears.
    if(min<target) {
      worldGrip(s,primary,basis,mesh,gripZ,segments,amount,s.pivot);
      debug.gripY=s.pivot.y;
      angle=solveContactRotation(s,contact,s.matrix,target,secondary?a=>reachable(a,amount):null);
      // The fit keeps only the shortening the Light reference needed. When the ordinary grip-radial rotation cannot
      // clear the floor, shorten as far as the weapon's bands allow BEFORE accepting a fallback orientation, and
      // keep that full shortening if a fallback is still needed. Flexible hafts keep their own suspension solver.
      const deepest=!flexible&&profile&&segments.length?1-profile.minSegmentScale:0;
      if(s.clearanceStrategy!=='radial'&&deepest>amount+1e-6){
        used=fittedContact(s,segments,gripZ,deepest,true);usedAmount=deepest;
        setCompression(plane,source,box,rows,segments,gripZ,deepest,holder,mesh.scale.z);
        active.rootOffset=mesh.position.z;debug.compressions++;
        s.gripAmount=deepest; // Hand sockets follow the visible, fully shortened haft.
        worldGrip(s,primary,basis,mesh,gripZ,segments,deepest,s.pivot);
        debug.gripY=s.pivot.y;
        angle=solveContactRotation(s,used,s.matrix,target,secondary?a=>reachable(a,deepest):null);
        debug.deepShortening=true;
      }
      debug.clearanceStrategy=s.clearanceStrategy;
      if(angle&&!rotateAroundGrip(holder,parent.matrixWorld,s.holder,s.pivot,s.axis,angle,s)){
        debug.finalMinY=min;return fail('unsupported-pivot-parent',true);
      }
      s.holder.multiplyMatrices(parent.matrixWorld,holder.matrix);
      debug.gripPivotDrift=worldGrip(s,primary,basis,mesh,gripZ,segments,usedAmount,s.point).distanceTo(s.pivot);
      // Validate against the resulting matrix, not the search's predicted Y.
      s.matrix.multiplyMatrices(s.holder,mesh.matrix).multiply(plane.matrix);
      min=projectedContactY(used.hull,s.matrix);
      if(angle)debug.rotations++;
      if(min<target-1e-7){
        // A grip below the floor (or a sprite offset below it) cannot always
        // be solved by rotation alone. Lift the entire weapon and its sockets
        // only by the remaining deficit; never change its established length.
        debug.gripLift=target-min;
        liftNode(holder,parent.matrixWorld,s.holder,debug.gripLift,s);
        s.holder.multiplyMatrices(parent.matrixWorld,holder.matrix);
        s.matrix.multiplyMatrices(s.holder,mesh.matrix).multiply(plane.matrix);
        min=projectedContactY(used.hull,s.matrix);
      }
    }
    debug.angleDeg=angle*180/Math.PI;debug.shortening=usedAmount;debug.finalMinY=min;
    debug.reason=debug.gripLift?'rotation-and-lift':angle?'rotation':amount?'shortening':'already-clear';
    if(traceOn)traceSolved(plane,used,min,target,y);
    return !!angle||debug.gripLift>0;
  }
  // Project around one horizontal axis. Reuse the sampled points and coefficient
  // objects: the common already-clear case never enters this routine.
  function rotationCoefficients(s,axis){
    s.axis.copy(axis);
    let i=0;
    for(const p of s.samples){
      s.rel.copy(p).sub(s.pivot);s.cross.crossVectors(s.axis,s.rel);
      const c=s.points[i]||={a:0,b:0};c.a=s.rel.y;c.b=s.cross.y;i++;
    }
    s.points.length=i;
  }
  // Rotation about the grip that lays the sprite flat with its long axis along its current horizontal heading and
  // its front face (local +Z) up. Sets s.axis / s.clearanceStrategy and returns the angle, or null if unusable.
  function faceUpFlatAngle(s,matrix,target,reachable){
    const e=matrix.elements;
    s.faceY.set(e[4],e[5],e[6]).normalize();
    const heading=Math.hypot(s.faceY.x,s.faceY.z);
    if(heading<1e-3)return null; // A vertical haft has no heading to preserve.
    s.faceX.set(e[0],e[1],e[2]).normalize();
    s.faceZ.set(e[8],e[9],e[10]).normalize();
    const reflected=s.faceX.clone().cross(s.faceY).dot(s.faceZ)<0; // Mirrored copies keep their handedness.
    s.faceFrom.makeBasis(s.faceX,s.faceY,s.faceZ);
    const ty=s.faceY.clone();ty.y=0;ty.normalize();
    const tz=s.faceZ.set(0,1,0);
    const tx=ty.clone().cross(tz);if(reflected)tx.negate();
    s.faceTo.makeBasis(tx,ty,tz);
    s.faceFrom.transpose(); // Orthonormal: transpose is the inverse.
    s.faceTo.multiply(s.faceFrom); // World rotation taking the current basis to the target basis.
    s.q.setFromRotationMatrix(s.faceTo);
    if(s.q.w<0){s.q.x=-s.q.x;s.q.y=-s.q.y;s.q.z=-s.q.z;s.q.w=-s.q.w;}
    const w=Math.min(1,s.q.w),sinHalf=Math.sqrt(Math.max(0,1-w*w));
    if(sinHalf<1e-9)return null;
    const angle=2*Math.acos(w);
    s.axis.set(s.q.x/sinHalf,s.q.y/sinHalf,s.q.z/sinHalf);
    let min=Infinity;
    for(const p of s.samples){
      s.rel.copy(p).sub(s.pivot).applyQuaternion(s.q);
      min=Math.min(min,s.pivot.y+s.rel.y);
    }
    if(min<target-1e-9)return null; // The grip itself is too low for any flat pose; the lift fallback handles that.
    if(reachable&&!reachable(angle))return null;
    s.clearanceStrategy='flat-face-up';
    return angle;
  }
  function solveContactRotation(s,contact,matrix,target,reachable){
    let count=0,lowest=null;
    for(const v of contact.points){
      const p=s.samples[count]||=new (three().Vector3)();
      p.set(v.x,-v.z,0).applyMatrix4(matrix);count++;
      if(!lowest||p.y<lowest.y)lowest=p;
    }
    s.samples.length=count;
    s.radialAxis.set(-(lowest.z-s.pivot.z),0,lowest.x-s.pivot.x);
    if(s.radialAxis.lengthSq()<1e-10)s.radialAxis.set(1,0,0);else s.radialAxis.normalize();
    rotationCoefficients(s,s.radialAxis);
    let angle=chooseAngle(s.points,s.pivot.y,target,reachable||undefined);
    s.clearanceStrategy='radial';
    if(angle!==null)return angle;
    // A sprite plane is authored lying front-face-up. Tipping it over about a horizontal axis can settle it
    // face-down, drawing the back of the art mirrored ("flipped"). Prefer a flat pose that keeps the weapon's
    // own heading and keeps its front face up, reached by rolling about the weapon's length through the grip.
    angle=faceUpFlatAngle(s,matrix,target,reachable);
    if(angle!==null)return angle;
    // Rotating the weapon plane to horizontal supplies an exact alternate
    // solution even when the lowest-vertex axis misses the safe orientations.
    const e=matrix.elements;
    s.direction.set(e[0],e[1],e[2]).cross(s.cross.set(e[4],e[5],e[6])).normalize();
    const horizontal=Math.hypot(s.direction.x,s.direction.z);
    s.flatAxis.set(-s.direction.z,0,s.direction.x);
    if(horizontal<1e-10)s.flatAxis.set(1,0,0);else s.flatAxis.multiplyScalar(1/horizontal);
    const up=Math.atan2(horizontal,s.direction.y),down=up-Math.PI;
    function flatCandidate(check){
      rotationCoefficients(s,s.flatAxis);
      const found=chooseAngle(s.points,s.pivot.y,target,check||undefined);
      if(found!==null)return found;
      let best=null;
      for(const a of [up,down]){
        if(minimumY(s.points,s.pivot.y,a)>=target-1e-9&&(!check||check(a))
          &&(best===null||Math.abs(a)<Math.abs(best)))best=a;
      }
      return best;
    }
    s.clearanceStrategy='alternate-axis';
    angle=flatCandidate(reachable);
    if(angle!==null)return angle;
    // A second hand's reach must not make the primary-held blade cut the floor.
    // Preserve the primary pivot and fitted length before relaxing arm reach.
    if(reachable){
      rotationCoefficients(s,s.radialAxis);
      angle=chooseAngle(s.points,s.pivot.y,target);
      s.clearanceStrategy='radial-reach-relaxed';
      if(angle!==null)return angle;
      s.clearanceStrategy='alternate-axis-reach-relaxed';
      angle=flatCandidate(null);
      if(angle!==null)return angle;
    }
    // Neither axis yielded a clear fixed-pivot pose. Compare the exact flat
    // orientations and keep the higher one (smaller angle breaks ties).
    rotationCoefficients(s,s.flatAxis);
    const minUp=minimumY(s.points,s.pivot.y,up),minDown=minimumY(s.points,s.pivot.y,down);
    s.clearanceStrategy='flat-plus-minimum-lift';
    return Math.abs(minUp-minDown)<1e-9?(Math.abs(up)<=Math.abs(down)?up:down):minUp>minDown?up:down;
  }
  function setTrace(on){traceOn=!!on;if(!traceOn){trace.solved=null;trace.lastPlane=null;trace.lastContact=null;}return traceOn;}
  function traceSolved(plane,contact,min,target,floorY){
    trace.solveCalls++;trace.lastSolveFrame=frameId()??null;trace.lastReason=debug.reason;
    trace.lastTarget=target;trace.lastFloor=floorY;trace.lastSolvedY=min;trace.lastPlane=plane;trace.lastContact=contact;
    if(!trace.solved)trace.solved=new Float32Array(16);
    const e=scratch.matrix.elements;for(let i=0;i<16;i++)trace.solved[i]=e[i]; // The exact matrix the solve validated.
  }
  // What a draw will actually use: the sprite's live matrixWorld, measured both through the cached hull and
  // through every baked point. They must agree; a gap means the hull cache is stale for the current fit.
  function traceDrawn(scene){
    const plane=trace.lastPlane,contact=trace.lastContact,o=traceOut;
    if(!traceOn||!plane||!contact)return null;
    let root=plane;while(root.parent)root=root.parent;
    o.inScene=root===scene;
    const m=plane.matrixWorld.elements;
    o.drawnHullY=projectedContactY(contact.hull,plane.matrixWorld);
    let mn=Infinity;for(const p of contact.points)mn=Math.min(mn,m[1]*p.x+m[5]*-p.z+m[13]);
    o.drawnPointsY=mn;
    let d=0;const sv=trace.solved;if(sv)for(let i=0;i<16;i++)d=Math.max(d,Math.abs(sv[i]-m[i]));
    o.matrixDelta=d;o.target=trace.lastTarget;o.floor=trace.lastFloor;o.solvedY=trace.lastSolvedY;
    o.solveCalls=trace.solveCalls;o.failCalls=trace.failCalls;o.lastSolveFrame=trace.lastSolveFrame;o.reason=trace.lastReason;
    o.lastFailReason=trace.lastFailReason;o.lastFailFrame=trace.lastFailFrame;
    o.itemKey=debug.itemKey;o.speciesId=debug.speciesId;o.hullBuilds=debug.contactHullBuilds;o.hullVertices=contact.hull.length;
    return o;
  }
  function liftNode(node,parentMatrix,nodeWorld,lift,s){
    s.parentInverse.copy(parentMatrix).invert();
    s.pos.setFromMatrixPosition(nodeWorld);s.pos.y+=lift;
    node.position.copy(s.pos.applyMatrix4(s.parentInverse));node.updateMatrix?.();
  }
  // Rotate a node in world space around the actual grip, not its authored
  // holder origin. The accompanying translation keeps that world point fixed.
  function uniformParentScale(scale){
    const magnitude=Math.abs(scale.x); // Three's decomposition places a reflection on X.
    return magnitude>0&&scale.y>0&&scale.z>0&&Math.abs(magnitude-scale.y)<1e-5&&Math.abs(magnitude-scale.z)<1e-5;
  }
  function rotateAroundGrip(node,parentMatrix,nodeWorld,pivot,axis,angle,s=work()){
    parentMatrix.decompose(s.pos,s.parentQ,s.scale);
    if(!uniformParentScale(s.scale))return false;
    s.q.setFromAxisAngle(axis,angle);
    s.parentInverse.copy(parentMatrix).invert();
    s.pos.setFromMatrixPosition(nodeWorld).sub(pivot).applyQuaternion(s.q).add(pivot).applyMatrix4(s.parentInverse);
    s.localQ.copy(s.parentQ).invert().multiply(s.q).multiply(s.parentQ);
    // Conjugate the world delta by the parent's X reflection as well as its
    // proper rotation. The mirrored dual weapon still rotates about its grip.
    if(s.scale.x<0){s.localQ.y=-s.localQ.y;s.localQ.z=-s.localQ.z;}
    node.position.copy(s.pos);node.quaternion.premultiply(s.localQ);node.updateMatrix?.();
    return true;
  }
  function releaseDualCopy(copy){
    if(!copy)return;
    if(borrowedCopies.delete(copy)&&copy.geometry===active?.geometry)copy.geometry=active.source;
  }
  function constrainDualCopies(current){
    const d=dualPrepared,s=work();
    if(!current)return;
    const main=current.mainMesh,off=current.offMesh;
    if(!enabled()||!s||!d||d.plane!==current.plane||current.invisible||!current.mainRoot.visible){
      releaseDualCopy(main);releaseDualCopy(off);return;
    }
    // Both rigid and flexible haft copies borrow the fitted source buffer.
    // The assembly separately solves each flexible head using its own tip;
    // the owner restores the borrowed geometry before disposal.
    for(const copy of [main,off]){
      if(copy.geometry!==d.plane.geometry)copy.geometry=d.plane.geometry;
      if(active?.geometry===copy.geometry)borrowedCopies.add(copy);
    }
    if(!d.contact||!Number.isFinite(d.target)){debug.reason='dual-fit-retained';return;}
    const context=d.context;
    const grips=global.HobunjiHandToolGrips;
    const live=global.ProceduralHandFrameDriver?.groundPoseContext?.(d.holder,context.itemKey)||context;
    s.holder.copy(d.holder.matrixWorld);
    s.inverse.copy(d.plane.matrixWorld).invert();
    let contact=d.contact,amount=d.amount; // Become the fully shortened haft when either copy needs a fallback orientation.
    const localGrip=(point,out)=>worldGrip(s,point,d.basis,d.mesh,d.gripZ,d.segments,amount,out).applyMatrix4(s.inverse);
    const results=debug.dual={};
    const sides=[
      ['right',current.mainRoot,main,live.primary],
      ['left',current.offRoot,off,live.offhand||grips?.offhandPrimaryGripForTool?.(context.itemKey,'melee',live.scaleIdentity||context.scaleIdentity)]
    ];
    // Both copies borrow one shortened buffer, so shorten it as far as its bands allow BEFORE accepting a fallback
    // orientation for either, and keep that full shortening while a fallback is in use.
    const deepest=!d.flexible&&d.source&&d.box&&d.context.profile&&d.segments.length?1-d.context.profile.minSegmentScale:0;
    if(deepest>d.amount+1e-6){
      let needsFallback=false;
      for(const [,,copy,grip] of sides){
        if(!grip?.position||projectedContactY(d.contact.hull,copy.matrixWorld)>=d.target)continue;
        localGrip(grip.position,s.grip);s.pivot.copy(s.grip).applyMatrix4(copy.matrixWorld);
        solveContactRotation(s,d.contact,copy.matrixWorld,d.target,null);
        if(s.clearanceStrategy!=='radial')needsFallback=true;
      }
      if(needsFallback){
        contact=fittedContact(s,d.segments,d.gripZ,deepest,true);amount=deepest;
        setCompression(d.plane,d.source,d.box,stripRows(d.box,d.segments,s.rows),d.segments,d.gripZ,deepest,d.holder,d.mesh.scale.z);
        active.rootOffset=d.mesh.position.z;debug.compressions++;
        s.gripAmount=deepest; // Hand sockets follow the visible, fully shortened haft.
        debug.deepShortening=true;
      }
    }
    for(const [side,root,copy,grip] of sides){
      if(!grip?.position){results[side]={reason:'no-grip'};continue;}
      let min=projectedContactY(contact.hull,copy.matrixWorld),angle=0;
      const original=min;let gripPivotDrift=null,gripLift=0,strategy=null;
      if(min<d.target){
        localGrip(grip.position,s.grip);
        s.pivot.copy(s.grip).applyMatrix4(copy.matrixWorld);
        angle=solveContactRotation(s,contact,copy.matrixWorld,d.target,null);
        strategy=s.clearanceStrategy;
        if(angle&&!rotateAroundGrip(root,d.plane.matrixWorld,root.matrixWorld,s.pivot,s.axis,angle,s)){
          results[side]={reason:'unsupported-pivot-parent',originalMinY:original,finalMinY:min};continue;
        }
        root.updateMatrixWorld(true);
        min=projectedContactY(contact.hull,copy.matrixWorld);
        gripPivotDrift=s.point.copy(s.grip).applyMatrix4(copy.matrixWorld).distanceTo(s.pivot);
        if(min<d.target-1e-7){
          gripLift=d.target-min;
          liftNode(root,d.plane.matrixWorld,root.matrixWorld,gripLift,s);
          root.updateMatrixWorld(true);
          min=projectedContactY(contact.hull,copy.matrixWorld);
        }
      }
      results[side]={reason:gripLift?'rotation-and-lift':angle?'rotation':'already-clear',angleDeg:angle*180/Math.PI,originalMinY:original,finalMinY:min,gripPivotDrift,gripLift,clearanceStrategy:strategy};
    }
    debug.shortening=amount;debug.reason='dual-clearance';debug.gripLift=Math.max(results.right?.gripLift??0,results.left?.gripLift??0);debug.finalMinY=Math.min(results.right?.finalMinY??Infinity,results.left?.finalMinY??Infinity);
  }
  function constrainFreeHand(parent,socket,shoulder,reach,height) {
    if(!enabled()||parent!==global.PlayerBodyTransformComposer?.getPlayerMesh?.()||!(reach>0)||!socket?.parent)return false;
    const y=groundY(),s=work();if(!Number.isFinite(y)||!s)return false;
    // Only a normal free-hand anchor, not authored crawl/paired contacts.
    const margin=Math.max(PAD,Number(height)*0.13||PAD);
    socket.parent.updateWorldMatrix?.(true,false);
    s.point.copy(socket.position).applyMatrix4(socket.parent.matrixWorld);
    if(s.point.y>=y+margin)return false;
    s.point.y=y+margin;
    s.inverse.copy(socket.parent.matrixWorld).invert();
    s.candidate.copy(s.point).applyMatrix4(s.inverse);
    s.inverse.copy(parent.matrixWorld).invert();
    s.point.applyMatrix4(s.inverse);
    if(s.point.distanceTo(shoulder)>reach+0.002)return false;
    socket.position.copy(s.candidate);debug.freeHandLifts++;return true;
  }
  global.HeldGroundPose=Object.freeze({configurePreview,setPreviewEnabled,previewAppliesTo,suspendedReferenceY,hasDrawingHaftChildren,skip,enabled,groundY,setTrace,traceDrawn,constrainWeapon,constrainDualCopies,releaseDualCopy,rotateAroundGrip,constrainFreeHand,adjustGrip,gripBasisFor,hasCurrentGripPose,resolveGripLocal,adjustHaftPoint,ropeClearance,fittedRopeScale,referenceDrop,lightRopeScale,ropeFitCandidate,needsFit,originalGeometryFor,prepareGeometryUpdate,fixedValue,clear,contractedZ,contactVertices,tracePixels,autoContact,bakeContact,projectedContactY,minimumY,chooseAngle,snapshot:()=>({...debug})});
})(typeof window!=='undefined'?window:globalThis);

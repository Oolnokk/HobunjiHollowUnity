// Experimental player-only clearance. Rigid art, grip sockets and the
// ground exemption share the same solved pose; gameplay collision is untouched.
(function (global) {
  'use strict';
  const PAD = 0.035; // Clearance above the physical standing surface, in world units.
  const STEP = Math.PI / 36; // Bounded five-degree rotation search with refinement.
  const debug = { reason: 'not-run', angleDeg: 0, shortening: 0, floorY: null, originalMinY: null, finalMinY: null, rotations: 0, compressions: 0, freeHandLifts: 0, ordinaryParts: 0, fallbacks: 0 };
  let active = null, proof = null, floorFrame = null, floor = null, scratch = null;
  let dualPrepared=null; // The canonical fit is prepared before the independently posed visible copies.
  let dualProofs=new WeakMap(); // Per-copy floor proof, never shared between hands.
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
      point: new T.Vector3(), rel: new T.Vector3(), base: new T.Vector3(), candidate: new T.Vector3(),
      pos: new T.Vector3(), scale: new T.Vector3(), parentQ: new T.Quaternion(), q: new T.Quaternion(),
      localQ: new T.Quaternion(), oldQ: new T.Quaternion(), box: new T.Box3(),
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
  function clear() { proof=null;previewRoot=null;dualPrepared=null;dualProofs=new WeakMap();debug.dual=null;restoreGeometry(); }
  function fail(reason,preserveFit=false) { debug.reason=reason; debug.fallbacks++; proof=null;if(!preserveFit)restoreGeometry();return false; }
  function boxFor(mesh) {
    const g=mesh?.geometry;
    if(!g||mesh.isSkinnedMesh||mesh.isInstancedMesh||g.morphAttributes?.position?.length)return null;
    if(!g.boundingBox)g.computeBoundingBox?.();
    return g.boundingBox&&!g.boundingBox.isEmpty()?g.boundingBox:null;
  }
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
    if(enabled()&&active?.plane===plane&&active.amount)point.y=-contractedZ(-point.y,active.gripZ,active.segments,active.amount,point.x);
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
  function worldGrip(s,point,basis,mesh,gripZ,segments,amount,out) {
    const z=gripZFor(point,mesh);
    return out.set(point.x,point.y,mesh.position.z+contractedZ(z,gripZ,segments,amount)*mesh.scale.z)
      .applyQuaternion(basis).applyMatrix4(s.holder);
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
  function suspendedReferenceY(matrix,spec,segments,gripZ,amount,lightScale){
    const e=matrix.elements,scale=Math.hypot(e[4],e[5],e[6]); // Actual Light stance long-axis scale, never the live attack scale.
    const anchorY=e[1]*spec.x-e[5]*contractedZ(-spec.y,gripZ,segments,amount,spec.x)+e[13];
    return anchorY-scale*(spec.headDrop+Math.hypot(spec.spanX,spec.spanY*lightScale));
  }
  function hasDrawingHaftChildren(plane,allowDual=false){
    const copies=global.HobunjiDualWieldWeaponVisuals;
    const assemblies=global.HobunjiWeaponSpriteAssemblies;
    for(const child of plane.children)if(!copies?.isNonDrawingChild?.(plane,child)&&!(allowDual&&copies?.isOwnedChild?.(plane,child))&&!assemblies?.isGroundNonSolidChild?.(plane,child))return true;
    return false;
  }
  function constrainWeapon(holder,mesh,context) {
    proof=null;dualPrepared=null;
    if(!enabled()){clear();return false;}
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
    if(!Number.isFinite(y))return fail('no-ground-sample',true);
    if(Math.abs(mesh.quaternion.x)+Math.abs(mesh.quaternion.y)+Math.abs(mesh.quaternion.z)>1e-6
      ||Math.abs(plane.rotation.x+Math.PI/2)>1e-4||Math.abs(plane.rotation.y)>1e-4
      ||plane.position.lengthSq()>1e-8||!(plane.scale.x>0&&plane.scale.y>0&&plane.scale.z>0))
      return fail('unsupported-rotation-basis',true);
    const parent=holder.parent;
    parent.matrixWorld.decompose(s.pos,s.parentQ,s.scale);
    if(!(s.scale.x>0)||Math.abs(s.scale.x-s.scale.y)>1e-5||Math.abs(s.scale.x-s.scale.z)>1e-5)return fail('nonuniform-holder-parent',true);
    holder.updateMatrix();mesh.updateMatrix();plane.updateMatrix();
    s.holder.multiplyMatrices(parent.matrixWorld,holder.matrix);
    s.mesh.multiplyMatrices(s.holder,mesh.matrix);
    s.matrix.multiplyMatrices(s.mesh,plane.matrix);
    const primary=context.primary?.position;
    if(!primary)return fail('no-primary-grip',true);
    const basis=context.basis;
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
    if(s.contactKey!==outline||s.contactSource!==source||s.contactImage!==image||s.contactSegments!==segmentKey||boundsChanged){
      const auto=autoContact(image,box,segments);
      s.contact.length=0;
      if(auto)s.contact.push(...auto);
      else contactVertices(box,outline,segments,s.contact);
      s.autoContact=!!auto;s.contactKey=outline;s.contactSource=source;s.contactImage=image;s.contactSegments=segmentKey;
      s.contactMinX=box.min.x;s.contactMaxX=box.max.x;s.contactMinY=box.min.y;s.contactMaxY=box.max.y;
    }
    const suspension=pending&&flexible?global.HobunjiWeaponSpriteAssemblies?.groundFitSpec?.(mesh,profile):null;
    const canFit=pending&&s.autoContact&&(!flexible||!!suspension); // Do not lock zero shortening before the rope/head have loaded.
    debug.contactSource=s.autoContact?'auto-alpha':outline?.length?'authored-fallback':'quad-fallback';
    debug.contactVertices=s.contact.length;
    if(canFit)s.reference.multiplyMatrices(parent.matrixWorld,context.lightReference).multiply(mesh.matrix).multiply(context.lightPlaneReference||plane.matrix);
    debug.fitReference='lightWeapon';
    const target=y+PAD;
    const original=samplePoints(s,s.contact,segments,gripZ,0);
    debug.originalMinY=original;
    let amount=fit?.amount??0,min=samplePoints(s,s.contact,segments,gripZ,amount),angle=0;
    worldGrip(s,primary,basis,mesh,gripZ,segments,amount,s.pivot);
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
    if(canFit&&!Number.isFinite(fit.amount)){
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
      min=samplePoints(s,s.contact,segments,gripZ,amount);
    }
    // Always apply the fitted geometry before attempting a pose correction.
    // A failed rotation retains the fit and falls back to legacy depth.
    if(amount>1e-6&&segments.length) {
      setCompression(plane,source,box,rows,segments,gripZ,amount,holder,mesh.scale.z);
      active.rootOffset=mesh.position.z;
      debug.compressions++;
    } else releaseCompression();
    debug.shortening=amount;debug.fitted=Number.isFinite(fit?.amount);
    worldGrip(s,primary,basis,mesh,gripZ,segments,amount,s.pivot);
    if(context.dual){
      // The hidden source owns length, not either hand's live orientation.
      // Copies are posed later by the dual-wield owner, then individually corrected.
      dualPrepared={holder,mesh,plane,context,segments,gripZ,amount,contact:s.contact,target,floor:y,flexible};
      debug.reason='dual-ready';debug.finalMinY=null;return false;
    }
    if(min<target) {
      // Pick the horizontal axis perpendicular to the lowest point's radial
      // offset from the grip. This rotates the offending end upward.
      // Only construct world XYZ samples when actual rotation is required.
      let count=0,lowest=null;
      for(const vertex of s.contact){
        const p=s.samples[count] ||= new (three().Vector3)();
        p.set(vertex.x,-contractedZ(vertex.z,gripZ,segments,amount,vertex.columnX),0).applyMatrix4(s.matrix);
        count++;
        if(!lowest||p.y<lowest.y)lowest=p;
      }
      s.samples.length=count;
      s.axis.set(-(lowest.z-s.pivot.z),0,lowest.x-s.pivot.x);
      if(s.axis.lengthSq()<1e-10)s.axis.set(1,0,0);else s.axis.normalize();
      s.points.length=0;
      for(const p of s.samples) {
        s.rel.set(p.x-s.pivot.x,p.y-s.pivot.y,p.z-s.pivot.z);
        s.cross.crossVectors(s.axis,s.rel);
        s.points.push({a:s.rel.y,b:s.cross.y});
      }
      angle=chooseAngle(s.points,s.pivot.y,target,a=>reachable(a,amount));
      if(angle===null){debug.finalMinY=min;return fail('no-reachable-clear-pose',true);}
      min=minimumY(s.points,s.pivot.y,angle);
    }
    if(angle) {
      // Apply a world rotation around the actual primary grip. Convert the
      // quaternion back to the holder's parent; preserve the raw grip exactly.
      rotateAroundGrip(holder,parent.matrixWorld,s.holder,s.pivot,s.axis,angle,s);
      debug.rotations++;
    }
    debug.angleDeg=angle*180/Math.PI;debug.shortening=amount;debug.finalMinY=min;
    debug.reason=angle?'rotation':amount?'shortening':'already-clear';
    proof={plane,frame:frameId(),min,floor:y};
    return !!angle;
  }
  // Rotate a node in world space around the actual grip, not its authored
  // holder origin. The accompanying translation keeps that world point fixed.
  function rotateAroundGrip(node,parentMatrix,nodeWorld,pivot,axis,angle,s=work()){
    parentMatrix.decompose(s.pos,s.parentQ,s.scale);
    if(!(s.scale.x>0)||Math.abs(s.scale.x-s.scale.y)>1e-5||Math.abs(s.scale.x-s.scale.z)>1e-5)return false;
    s.q.setFromAxisAngle(axis,angle);
    s.parentInverse.copy(parentMatrix).invert();
    s.pos.setFromMatrixPosition(nodeWorld).sub(pivot).applyQuaternion(s.q).add(pivot).applyMatrix4(s.parentInverse);
    s.localQ.copy(s.parentQ).invert().multiply(s.q).multiply(s.parentQ);
    node.position.copy(s.pos);node.quaternion.premultiply(s.localQ);node.updateMatrix?.();
    return true;
  }
  function releaseDualCopy(copy){
    if(!copy)return;
    dualProofs.delete(copy);
    if(borrowedCopies.delete(copy)&&copy.geometry===active?.geometry)copy.geometry=active.source;
  }
  function constrainDualCopies(current){
    const d=dualPrepared,s=work();
    if(!current)return;
    const main=current.mainMesh,off=current.offMesh;
    dualProofs.delete(main);dualProofs.delete(off);
    if(!enabled()||!s||!d||d.plane!==current.plane||current.invisible||!current.mainRoot.visible||d.flexible){
      releaseDualCopy(main);releaseDualCopy(off);return;
    }
    // Both copies have identical source geometry. They borrow the fitted
    // buffer rather than allocate one per hand; the owner restores them before
    // disposing it. Never modify the canonical geometry.
    for(const copy of [main,off]){
      if(copy.geometry!==d.plane.geometry)copy.geometry=d.plane.geometry;
      if(active?.geometry===copy.geometry)borrowedCopies.add(copy);
    }
    const context=d.context;
    const grips=global.HobunjiHandToolGrips;
    const live=global.ProceduralHandFrameDriver?.groundPoseContext?.(d.holder,context.itemKey)||context;
    s.holder.copy(d.holder.matrixWorld);
    s.inverse.copy(d.plane.matrixWorld).invert();
    const localGrip=(point,out)=>worldGrip(s,point,live.basis||context.basis,d.mesh,d.gripZ,d.segments,d.amount,out).applyMatrix4(s.inverse);
    const results=debug.dual={};
    for(const [side,root,copy,grip] of [
      ['right',current.mainRoot,main,live.primary],
      ['left',current.offRoot,off,live.offhand||grips?.offhandPrimaryGripForTool?.(context.itemKey,'melee',live.scaleIdentity||context.scaleIdentity)]
    ]){
      if(!grip?.position){results[side]={reason:'no-grip'};continue;}
      localGrip(grip.position,s.pivot).applyMatrix4(copy.matrixWorld);
      let min=samplePoints(s,d.contact,d.segments,d.gripZ,d.amount,copy.matrixWorld),angle=0;
      const original=min;
      if(min<d.target){
        let count=0,lowest=null;
        for(const v of d.contact){
          const p=s.samples[count]||=new (three().Vector3)();
          p.set(v.x,-contractedZ(v.z,d.gripZ,d.segments,d.amount,v.columnX),0).applyMatrix4(copy.matrixWorld);
          count++;if(!lowest||p.y<lowest.y)lowest=p;
        }
        s.samples.length=count;
        s.axis.set(-(lowest.z-s.pivot.z),0,lowest.x-s.pivot.x);
        if(s.axis.lengthSq()<1e-10)s.axis.set(1,0,0);else s.axis.normalize();
        s.points.length=0;
        for(const p of s.samples){s.rel.copy(p).sub(s.pivot);s.cross.crossVectors(s.axis,s.rel);s.points.push({a:s.rel.y,b:s.cross.y});}
        angle=chooseAngle(s.points,s.pivot.y,d.target);
        if(angle===null||!rotateAroundGrip(root,d.plane.matrixWorld,root.matrixWorld,s.pivot,s.axis,angle,s)){
          results[side]={reason:'no-reachable-clear-pose',originalMinY:original,finalMinY:min};continue;
        }
        root.updateMatrixWorld(true);
        min=samplePoints(s,d.contact,d.segments,d.gripZ,d.amount,copy.matrixWorld);
      }
      results[side]={reason:angle?'rotation':'already-clear',angleDeg:angle*180/Math.PI,originalMinY:original,finalMinY:min};
      if(min>=d.target-1e-7)dualProofs.set(copy,{frame:frameId(),min});
    }
    debug.reason='dual-clearance';debug.finalMinY=Math.min(results.right?.finalMinY??Infinity,results.left?.finalMinY??Infinity);
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
  function ordinaryDepthFor(mesh,scope,shellPadding) {
    if(!enabled()||scope?.root!==global.PlayerBodyTransformComposer?.getPlayerMesh?.())return false;
    const y=groundY();if(!Number.isFinite(y))return false;
    const margin=Math.max(PAD,Number(shellPadding)||0);
    if(proof?.plane===mesh&&proof.frame===frameId()&&proof.min>=y+margin) {debug.ordinaryParts++;return true;}
    const dual=dualProofs.get(mesh);
    if(dual&&dual.frame===frameId()&&dual.min>=y+margin){debug.ordinaryParts++;return true;}
    if(mesh.userData?.hobunjiProceduralHand!==true)return false;
    const box=boxFor(mesh),s=work();if(!box||!s)return false;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if(materials.some(mat=>mat?.isShaderMaterial||mat?.displacementMap))return false;
    // Alternate outline/depth matrices must also clear the floor.
    const parity=mesh.__hobunjiXrayBoundParity;
    if(mesh.onBeforeRender&&mesh.onBeforeRender!==global.THREE?.Object3D?.prototype?.onBeforeRender&&parity?.hook!==mesh.onBeforeRender)return false;
    const extra=parity?.hook===mesh.onBeforeRender&&parity.isFresh?.()?parity.visibleMatrixWorld:null;
    if(parity&&parity.hook===mesh.onBeforeRender&&shellPadding!=null&&!extra)return false;
    const clear=matrix=>!!matrix&&s.box.copy(box).applyMatrix4(matrix).min.y>=y+margin;
    if(!clear(mesh.matrixWorld)||(extra&&!clear(extra)))return false;
    debug.ordinaryParts++;return true;
  }
  global.HeldGroundPose=Object.freeze({configurePreview,setPreviewEnabled,previewAppliesTo,suspendedReferenceY,hasDrawingHaftChildren,skip,enabled,groundY,constrainWeapon,constrainDualCopies,releaseDualCopy,rotateAroundGrip,constrainFreeHand,ordinaryDepthFor,adjustGrip,adjustHaftPoint,ropeClearance,fittedRopeScale,referenceDrop,lightRopeScale,ropeFitCandidate,needsFit,originalGeometryFor,prepareGeometryUpdate,fixedValue,clear,contractedZ,contactVertices,tracePixels,autoContact,minimumY,chooseAngle,snapshot:()=>({...debug})});
})(typeof window!=='undefined'?window:globalThis);

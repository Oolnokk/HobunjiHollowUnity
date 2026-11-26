// Experimental player-only clearance. Rigid art, grip sockets and the
// ground exemption share the same solved pose; gameplay collision is untouched.
(function (global) {
  'use strict';
  const PAD = 0.035; // Clearance above the physical standing surface, in world units.
  const STEP = Math.PI / 36; // Bounded five-degree rotation search with refinement.
  const debug = { reason: 'not-run', angleDeg: 0, shortening: 0, floorY: null, originalMinY: null, finalMinY: null, rotations: 0, compressions: 0, freeHandLifts: 0, ordinaryParts: 0, fallbacks: 0 };
  let active = null, proof = null, floorFrame = null, floor = null, scratch = null;
  const actorFits=new WeakMap(); // Actor rig -> bounded per-item immutable physical fits, surviving equip/unequip and mesh replacement.
  const rootFits=new WeakMap(); // Flail owner resolves the exact same fit without another rig traversal.
  const NO_SEGMENTS=Object.freeze([]);
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
  function enabled() { return global.XrayHierarchy?.get?.('ground.heldPose') === 'rotation'; }
  function groundY() {
    if (!enabled()) return null;
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
  function contractedZ(z, gripZ, segments, amount) {
    if (!amount) return z;
    let delta = 0;
    for (const v of segments) {
      const span = v.b-v.a;
      delta += Math.max(0,Math.min(span,z-v.a))-Math.max(0,Math.min(span,gripZ-v.a));
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
    const T=global.THREE;
    if(!T)return null;
    return scratch ||= {
      holder: new T.Matrix4(), mesh: new T.Matrix4(), plane: new T.Matrix4(), matrix: new T.Matrix4(),
      inverse: new T.Matrix4(), parentInverse: new T.Matrix4(), pivot: new T.Vector3(),
      grip: new T.Vector3(), second: new T.Vector3(), shoulder: new T.Vector3(),
      axis: new T.Vector3(), direction: new T.Vector3(), cross: new T.Vector3(),
      point: new T.Vector3(), rel: new T.Vector3(), base: new T.Vector3(), candidate: new T.Vector3(),
      pos: new T.Vector3(), scale: new T.Vector3(), parentQ: new T.Quaternion(), q: new T.Quaternion(),
      localQ: new T.Quaternion(), oldQ: new T.Quaternion(), box: new T.Box3(),
      samples: [], points: [], rows: [], contact: [], contactKey: null, contactSource: null, contactSegments: null,
    };
  }
  function restoreGeometry() {
    if (!active) return;
    if (active.plane.geometry===active.geometry) active.plane.geometry=active.source;
    active.geometry.dispose();
    active=null;
  }
  function releaseCompression() {
    if(!active)return;
    if(active.plane.geometry===active.geometry)active.plane.geometry=active.source;
    active.amount=0; // Keep the private strip buffer for the next near-ground pose.
  }
  function clear() { proof=null; restoreGeometry(); }
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
  function setCompression(plane,source,box,rows,segments,gripZ,amount,holder,rootScale) {
    if(!amount) { releaseCompression(); return; }
    const T=global.THREE;
    const signature=rows.join(',');
    if(!active||active.plane!==plane||active.source!==source||active.signature!==signature) {
      restoreGeometry();
      const geometry=new T.PlaneGeometry(box.max.x-box.min.x,box.max.y-box.min.y,1,rows.length-1);
      active={plane,source,geometry,signature,amount:-1,gripZ:NaN,holder,rootScale,segments};
    }
    // Geometry is private to this equipped plane, never the shared asset.
    const sameSegments=active.segments===segments; // Profiles are normalized and cached by the grip metadata owner.
    if(active.amount!==amount||active.gripZ!==gripZ||!sameSegments) {
      const p=active.geometry.attributes.position,uv=active.geometry.attributes.uv;
      const height=box.max.y-box.min.y;
      for(let i=0;i<rows.length;i++) {
        const y=-contractedZ(-rows[i],gripZ,segments,amount),v=(rows[i]-box.min.y)/height;
        p.setXYZ(i*2,box.min.x,y,0);p.setXYZ(i*2+1,box.max.x,y,0);
        uv.setXY(i*2,0,v);uv.setXY(i*2+1,1,v);
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
    if(enabled()&&active?.plane===plane&&active.amount)point.y=-contractedZ(-point.y,active.gripZ,active.segments,active.amount);
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
  function samplePoints(s,vertices,segments,gripZ,amount) {
    let min=Infinity;
    const e=s.matrix.elements; // Use actual X extent, including protruding heads.
    for(const p of vertices){
      const y=-contractedZ(p.z,gripZ,segments,amount);
      min=Math.min(min,e[1]*p.x+e[5]*y+e[13]);
    }
    return min;
  }
  function constrainWeapon(holder,mesh,context) {
    proof=null;
    if(!enabled()){if(active)restoreGeometry();return false;}
    debug.angleDeg=0;debug.shortening=0;debug.originalMinY=null;debug.finalMinY=null;
    const y=groundY(),s=work(),plane=mesh?.userData?.toolPlane;
    if(!s||!context||!holder?.parent||!holder.visible||!mesh?.visible||!plane?.visible)return fail('no-rig');
    // A missing support sample is normal over a gap; it must not undo a fit.
    if(active&&active.plane!==plane)restoreGeometry();
    if(context.flexibleHaft&&!context.profile)return fail('unmeasured-flail');
    const fit=fitFor(context,mesh); // Fitting and rotation are separate: only the former is retained.
    // Only a single canonical rigid plane (or an independent flail haft)
    // owns a fitted strip. Rotation eligibility is checked separately below.
    if(mesh.parent!==holder||plane.parent!==mesh||(!context.flexibleHaft&&mesh.children.length!==1)||plane.children.length
      ||mesh.userData.toolEndFlipBase||plane.isSkinnedMesh||plane.isInstancedMesh||!(mesh.scale.z>0))return fail('unsupported-assembly');
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
    debug.shortening=fit?.amount??0;debug.fitted=Number.isFinite(fit?.amount);
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
      &&profile?.a>=-box.max.y-1e-4&&profile?.b<=-box.min.y+1e-4;
    const canFit=!!fit&&context.allowFit&&measuredSource&&global.PlayerJump?.heldPoseGrounded?.()===true;
    const gripZ=fit?.anchorZ??context.authoredGripZ??gripZFor(primary,mesh);
    const segments=profile&&(canFit||Number.isFinite(fit?.amount))?profile.segments:NO_SEGMENTS;
    const rows=stripRows(box,segments,s.rows);
    const outline=profile?.contactOutline;
    const segmentKey=segments.length?segments:null;
    const boundsChanged=s.contactMinX!==box.min.x||s.contactMaxX!==box.max.x||s.contactMinY!==box.min.y||s.contactMaxY!==box.max.y;
    if(s.contactKey!==outline||s.contactSource!==source||s.contactSegments!==segmentKey||boundsChanged){
      s.authoredContact=contactVertices(box,outline,segments,s.contact);
      s.contactKey=outline;s.contactSource=source;s.contactSegments=segmentKey;
      s.contactMinX=box.min.x;s.contactMaxX=box.max.x;s.contactMinY=box.min.y;s.contactMaxY=box.max.y;
    }
    debug.contactSource=s.authoredContact?'authored-outline':'quad-fallback';
    debug.contactVertices=s.contact.length;
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
    if(canFit&&!Number.isFinite(fit.amount)&&min<target&&segments.length) {
      const max=1-profile.minSegmentScale;
      if(max>0) {
        const compressed=samplePoints(s,s.contact,segments,gripZ,max);
        if(compressed>original+1e-6) {
          let lo=0,hi=max;
          if(compressed>=target)for(let i=0;i<10;i++) {
            const mid=(lo+hi)/2;
            if(samplePoints(s,s.contact,segments,gripZ,mid)>=target)hi=mid;else lo=mid;
          }
          amount=hi;
          if(!reachable(0,amount)) {
            lo=0;hi=amount;
            for(let i=0;i<10;i++) {const mid=(lo+hi)/2;if(reachable(0,mid))lo=mid;else hi=mid;}
            amount=lo;
          }
          min=samplePoints(s,s.contact,segments,gripZ,amount);
        } else min=samplePoints(s,s.contact,segments,gripZ,0);
      }
    }
    if(canFit&&!Number.isFinite(fit.amount)){
      fit.amount=fixedValue(fit.amount,true,amount);fit.anchorZ=gripZ;
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
    if(min<target) {
      // Pick the horizontal axis perpendicular to the lowest point's radial
      // offset from the grip. This rotates the offending end upward.
      // Only construct world XYZ samples when actual rotation is required.
      let count=0,lowest=null;
      for(const vertex of s.contact){
        const p=s.samples[count] ||= new global.THREE.Vector3();
        p.set(vertex.x,-contractedZ(vertex.z,gripZ,segments,amount),0).applyMatrix4(s.matrix);
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
      if(angle===null)return fail('no-reachable-clear-pose',true);
      min=minimumY(s.points,s.pivot.y,angle);
    }
    if(angle) {
      // Apply a world rotation around the actual primary grip. Convert the
      // quaternion back to the holder's parent; preserve the raw grip exactly.
      s.q.setFromAxisAngle(s.axis,angle);
      s.parentInverse.copy(parent.matrixWorld).invert();
      s.pos.setFromMatrixPosition(s.holder).sub(s.pivot).applyQuaternion(s.q).add(s.pivot).applyMatrix4(s.parentInverse);
      s.localQ.copy(s.parentQ).invert().multiply(s.q).multiply(s.parentQ);
      holder.position.copy(s.pos);
      holder.quaternion.premultiply(s.localQ);
      debug.rotations++;
    }
    debug.angleDeg=angle*180/Math.PI;debug.shortening=amount;debug.finalMinY=min;
    debug.reason=angle?'rotation':amount?'shortening':'already-clear';
    proof={plane,frame:frameId(),min,floor:y};
    return !!angle;
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
  global.HeldGroundPose=Object.freeze({enabled,groundY,constrainWeapon,constrainFreeHand,ordinaryDepthFor,adjustGrip,adjustHaftPoint,ropeClearance,fittedRopeScale,fixedValue,clear,contractedZ,contactVertices,minimumY,chooseAngle,snapshot:()=>({...debug})});
})(typeof window!=='undefined'?window:globalThis);

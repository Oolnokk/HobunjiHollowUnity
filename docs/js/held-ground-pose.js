// Experimental player-only clearance. Rigid art, grip sockets and the
// ground exemption share the same solved pose; gameplay collision is untouched.
(function (global) {
  'use strict';
  const PAD = 0.035; // Clearance above the physical standing surface, in world units.
  const STEP = Math.PI / 36; // Bounded five-degree rotation search with refinement.
  const debug = { reason: 'not-run', angleDeg: 0, shortening: 0, floorY: null, originalMinY: null, finalMinY: null, rotations: 0, compressions: 0, freeHandLifts: 0, ordinaryParts: 0, fallbacks: 0 };
  let active = null, proof = null, floorFrame = null, floor = null, scratch = null;
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
      samples: [], points: [], rows: [],
    };
  }
  function restoreGeometry() {
    if (!active) return;
    if (active.plane.geometry===active.geometry) active.plane.geometry=active.source;
    active.geometry.dispose();
    active=null;
  }
  function clear() { proof=null; restoreGeometry(); }
  function fail(reason) { debug.reason=reason; debug.fallbacks++; clear(); return false; }
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
    if(!amount) { restoreGeometry(); return; }
    const T=global.THREE;
    const signature=rows.join(',');
    if(!active||active.plane!==plane||active.source!==source||active.signature!==signature) {
      restoreGeometry();
      const geometry=new T.PlaneGeometry(box.max.x-box.min.x,box.max.y-box.min.y,1,rows.length-1);
      active={plane,source,geometry,signature,amount:-1,gripZ:NaN,holder,rootScale,segments};
    }
    // Geometry is private to this equipped plane, never the shared asset.
    const sameSegments=JSON.stringify(active.segments)===JSON.stringify(segments);
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
  function samplePoints(s,box,rows,segments,gripZ,amount) {
    s.samples.length=0;
    let min=Infinity;
    for(const row of rows)for(const x of [box.min.x,box.max.x]) {
      const y=-contractedZ(-row,gripZ,segments,amount);
      s.point.set(x,y,0).applyMatrix4(s.matrix);
      s.samples.push({x:s.point.x,y:s.point.y,z:s.point.z});
      min=Math.min(min,s.point.y);
    }
    return min;
  }
  function constrainWeapon(holder,mesh,context) {
    proof=null;
    if(!enabled()){if(active)restoreGeometry();return false;}
    debug.angleDeg=0;debug.shortening=0;debug.originalMinY=null;debug.finalMinY=null;
    const y=groundY(),s=work(),plane=mesh?.userData?.toolPlane;
    if(!s||!Number.isFinite(y)||!context||!holder?.parent||!holder.visible||!mesh?.visible||!plane?.visible)return fail('no-ground-or-rig');
    if(active&&active.plane!==plane)restoreGeometry();
    // Reject independent assemblies, mirrored/multi-hand duplicates, dynamic
    // attachments, noncanonical planes, and shared/custom shader deformation.
    if(mesh.parent!==holder||plane.parent!==mesh||mesh.children.length!==1||plane.children.length
      ||mesh.userData.toolEndFlipBase||plane.isSkinnedMesh||plane.isInstancedMesh
      ||Math.abs(mesh.quaternion.x)+Math.abs(mesh.quaternion.y)+Math.abs(mesh.quaternion.z)>1e-6
      ||!(mesh.scale.z>0)||Math.abs(plane.rotation.x+Math.PI/2)>1e-4
      ||Math.abs(plane.rotation.y)>1e-4||plane.position.lengthSq()>1e-8
      ||plane.scale.distanceToSquared(s.scale.set(1,1,1))>1e-8)return fail('unsupported-assembly-or-basis');
    const source=active?.plane===plane&&plane.geometry===active.geometry?active.source:plane.geometry;
    if(source?.type!=='PlaneGeometry'||source.attributes.position.count!==4)return fail('non-quad-weapon');
    if(active&&active.source!==source)restoreGeometry();
    if(!source.boundingBox)source.computeBoundingBox();
    const box=source.boundingBox;
    if(!box||box.isEmpty()||Math.abs(box.max.z-box.min.z)>1e-6||Math.abs(box.max.z)>1e-6)return fail('invalid-geometry');
    const parent=holder.parent;
    parent.matrixWorld.decompose(s.pos,s.parentQ,s.scale);
    if(!(s.scale.x>0)||Math.abs(s.scale.x-s.scale.y)>1e-5||Math.abs(s.scale.x-s.scale.z)>1e-5)return fail('nonuniform-holder-parent');
    holder.updateMatrix();mesh.updateMatrix();plane.updateMatrix();
    s.holder.multiplyMatrices(parent.matrixWorld,holder.matrix);
    s.mesh.multiplyMatrices(s.holder,mesh.matrix);
    s.matrix.multiplyMatrices(s.mesh,plane.matrix);
    const primary=context.primary?.position;
    if(!primary)return fail('no-primary-grip');
    const gripZ=gripZFor(primary,mesh);
    const basis=context.basis;
    const profile=context.profile;
    // Only compress an un-twisted canonical weapon in this first experiment.
    // Rotation remains available in twisted sweeps; their grip remapping needs
    // a separate parity adapter before deforming their visual segments.
    const segments=profile&&Math.abs(plane.rotation.z)<1e-6&&Math.abs(basis.x)+Math.abs(basis.y)+Math.abs(basis.z)<1e-6
      ?profile.segments:[];
    const rows=stripRows(box,segments,s.rows);
    const target=y+PAD;
    const original=samplePoints(s,box,rows,segments,gripZ,0);
    debug.originalMinY=original;
    let amount=0,min=original,angle=0;
    worldGrip(s,primary,basis,mesh,gripZ,segments,0,s.pivot);
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
    if(min<target&&segments.length) {
      const max=1-profile.minSegmentScale;
      if(max>0) {
        const compressed=samplePoints(s,box,rows,segments,gripZ,max);
        if(compressed>original+1e-6) {
          let lo=0,hi=max;
          if(compressed>=target)for(let i=0;i<10;i++) {
            const mid=(lo+hi)/2;
            if(samplePoints(s,box,rows,segments,gripZ,mid)>=target)hi=mid;else lo=mid;
          }
          amount=hi;
          if(!reachable(0,amount)) {
            lo=0;hi=amount;
            for(let i=0;i<10;i++) {const mid=(lo+hi)/2;if(reachable(0,mid))lo=mid;else hi=mid;}
            amount=lo;
          }
          min=samplePoints(s,box,rows,segments,gripZ,amount);
        } else min=samplePoints(s,box,rows,segments,gripZ,0);
      }
    }
    if(min<target) {
      // Pick the horizontal axis perpendicular to the lowest point's radial
      // offset from the grip. This rotates the offending end upward.
      let lowest=s.samples[0];
      for(const p of s.samples)if(p.y<lowest.y)lowest=p;
      s.axis.set(-(lowest.z-s.pivot.z),0,lowest.x-s.pivot.x);
      if(s.axis.lengthSq()<1e-10)s.axis.set(1,0,0);else s.axis.normalize();
      s.points.length=0;
      for(const p of s.samples) {
        s.rel.set(p.x-s.pivot.x,p.y-s.pivot.y,p.z-s.pivot.z);
        s.cross.crossVectors(s.axis,s.rel);
        s.points.push({a:s.rel.y,b:s.cross.y});
      }
      angle=chooseAngle(s.points,s.pivot.y,target,a=>reachable(a,amount));
      if(angle===null)return fail('no-reachable-clear-pose');
      min=minimumY(s.points,s.pivot.y,angle);
    }
    if(amount>1e-6) {
      setCompression(plane,source,box,rows,segments,gripZ,amount,holder,mesh.scale.z);
      active.rootOffset=mesh.position.z;
      debug.compressions++;
    } else restoreGeometry();
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
    // Alternate outline/depth matrices must also clear the floor.
    const parity=mesh.__hobunjiXrayBoundParity;
    const extra=parity?.hook===mesh.onBeforeRender&&parity.isFresh?.()?parity.visibleMatrixWorld:null;
    if(parity&&parity.hook===mesh.onBeforeRender&&shellPadding!=null&&!extra)return false;
    const clear=matrix=>!!matrix&&s.box.copy(box).applyMatrix4(matrix).min.y>=y+margin;
    if(!clear(mesh.matrixWorld)||(extra&&!clear(extra)))return false;
    debug.ordinaryParts++;return true;
  }
  global.HeldGroundPose=Object.freeze({enabled,groundY,constrainWeapon,constrainFreeHand,ordinaryDepthFor,adjustGrip,clear,contractedZ,minimumY,chooseAngle,snapshot:()=>({...debug})});
})(typeof window!=='undefined'?window:globalThis);

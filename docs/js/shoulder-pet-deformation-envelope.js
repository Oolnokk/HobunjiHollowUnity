// Deformation-aware shoulder-pet constraints. Alpha proxy topology and skin bind
// coordinates are prepared on asset changes; only a bounded set of controls
// follows the existing bones. Horizontal disks and vertical slabs enclose
// each sampled patch, allowing forbidden body-yaw arcs to be solved analytically.
(() => {
  'use strict';
  const DEG=Math.PI/180, TAU=2*Math.PI, EPS=1e-9;
  const CLEARANCE=.002, CONTACT=.035, ANGLE_EPS=1e-6;
  const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  const positive=a=>((a%TAU)+TAU)%TAU;
  const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();

  function diskMetrics(d) {
    d.radial=Math.hypot(d.x,d.z);d.angle=Math.atan2(d.x,d.z);
    d.inner=Math.max(0,d.radial-d.r);d.outer=d.radial+d.r;
    return d;
  }

  function pairRadius(o,p) {
    if(o.y0>p.y1+CLEARANCE || p.y0>o.y1+CLEARANCE
      || o.inner>p.outer+CLEARANCE || p.inner>o.outer+CLEARANCE)return 0;
    // Permit intentional grip contact only when the entire possible overlap
    // lies inside the small contact sphere (not an arbitrary head/body mask).
    const y=Math.max(Math.abs(Math.max(o.y0,p.y0)-CLEARANCE),Math.abs(Math.min(o.y1,p.y1)+CLEARANCE));
    if(Math.min(o.outer,p.outer)**2+y*y<=CONTACT*CONTACT)return 0;
    return o.r+p.r+CLEARANCE;
  }

  function subtract(source,dest,lo,hi) {
    dest.length=0;
    for(let i=0;i<source.length;i+=2) {
      const a=source[i],b=source[i+1];
      if(hi<=a || lo>=b)dest.push(a,b);
      else {
        if(lo>a)dest.push(a,lo);
        if(hi<b)dest.push(hi,b);
      }
    }
  }

  function solveBodyYaw(owners,pets,requested,scratch={a:[],b:[],pairs:[]}) {
    const pairs=scratch.pairs; pairs.length=0;
    const c=Math.cos(requested),s=Math.sin(requested);
    let blocked=false;
    // Each surviving pair defines a single forbidden angular arc. Collect
    // them once; if the requested heading is already clear, no acos or arc
    // subtraction is needed.
    for(const p of pets) {
      const x=c*p.x+s*p.z,z=-s*p.x+c*p.z;
      for(const o of owners) {
        if(scratch.ownerSorted && o.y0>p.y1+CLEARANCE)break;
        const r=pairRadius(o,p);if(!r)continue;
        pairs.push(o,p,r);
        const dx=x-o.x,dz=z-o.z;
        if(dx*dx+dz*dz<=r*r)blocked=true;
      }
    }
    scratch.pairTests=(scratch.pairTests||0)+pairs.length/3;
    if(!blocked)return wrap(requested);
    let allowed=scratch.a,next=scratch.b;
    allowed.length=0;allowed.push(0,TAU);
    for(let i=0;i<pairs.length;i+=3) {
      const o=pairs[i],p=pairs[i+1],r=pairs[i+2],product=2*o.radial*p.radial;
      const numerator=o.radial**2+p.radial**2-r*r;
      if(product<EPS) {
        if(numerator<=0)return null;
        continue;
      }
      const threshold=numerator/product;
      if(threshold>1)continue;
      if(threshold<=-1)return null;
      const half=Math.acos(Math.max(-1,Math.min(1,threshold)))+ANGLE_EPS;
      if(half>=Math.PI)return null;
      const center=positive(o.angle-p.angle),lo=center-half,hi=center+half;
      if(lo<0) {
        subtract(allowed,next,0,hi);{const swap=allowed;allowed=next;next=swap;}
        subtract(allowed,next,lo+TAU,TAU);{const swap=allowed;allowed=next;next=swap;}
      } else if(hi>TAU) {
        subtract(allowed,next,lo,TAU);{const swap=allowed;allowed=next;next=swap;}
        subtract(allowed,next,0,hi-TAU);{const swap=allowed;allowed=next;next=swap;}
      } else {
        subtract(allowed,next,lo,hi);{const swap=allowed;allowed=next;next=swap;}
      }
      if(!allowed.length)return null;
    }
    let best=null,distance=Infinity;
    const target=positive(requested);
    for(let i=0;i<allowed.length;i+=2) {
      if(target>=allowed[i] && target<=allowed[i+1])return wrap(requested);
      for(let j=i;j<i+2;j++) {
        const delta=Math.abs(wrap(allowed[j]-requested));
        if(delta<distance){distance=delta;best=allowed[j];}
      }
    }
    return best===null?null:wrap(best);
  }

  function create(THREE,proxyFor) {
    if(!THREE?.Matrix4 || !THREE?.Quaternion || !THREE?.Euler)return null;
    const entries=new WeakMap(); // Prepared controls, released with their painted mesh.
    const ownerEntries=[],petEntries=[],ownerDisks=[],petDisks=[],candidates=[];
    const seenBones=new Set(),seenMeshes=new Set(); // Reused during the bounded bone update.
    const ownerFrame=new THREE.Matrix4(),petFrame=new THREE.Matrix4();
    const prefix=new THREE.Matrix4(),world=new THREE.Matrix4(),local=new THREE.Matrix4();
    const q=new THREE.Quaternion(),euler=new THREE.Euler(),axis=new THREE.Vector3(0,1,0);
    const scratch={a:[],b:[],pairs:[],pairTests:0,ownerSorted:true};
    const diagnostic={}; // Pixel Probe reads the final constraint, not speculative head alternatives.

    function materials(mesh) {
      return Array.isArray(mesh.material)?mesh.material:[mesh.material];
    }
    function mapKey(mesh) {
      return materials(mesh).map(m=>{
        const t=m?.map;
        return [t,t?.image,t?.version,t?.repeat?.x,t?.repeat?.y,t?.offset?.x,t?.offset?.y,t?.rotation,t?.flipY];
      });
    }
    function sameMaps(mesh,key) {
      const list=materials(mesh);
      if(list.length!==key.length)return false;
      for(let i=0;i<list.length;i++) {
        const t=list[i]?.map,k=key[i];
        if(t!==k[0] || t?.image!==k[1] || t?.version!==k[2]
          || t?.repeat?.x!==k[3] || t?.repeat?.y!==k[4] || t?.offset?.x!==k[5]
          || t?.offset?.y!==k[6] || t?.rotation!==k[7] || t?.flipY!==k[8])return false;
      }
      return true;
    }

    function refreshWeights(e) {
      const attr=e.weightsAttr;
      if(!attr)return;
      const arr=attr.array,size=attr.itemSize;
      for(let i=0;i<e.proxy.sourceIndices.length;i++) {
        const offset=e.proxy.sourceIndices[i]*size;
        for(let k=0;k<4;k++)e.weights[i*4+k]=arr[offset+k]||0;
      }
      e.weightVersion=attr.version;
    }

    function prepare(mesh,e) {
      const p=proxyFor(mesh);
      if(!p?.tris?.length || !p.sourceIndices?.length)return false;
      const pos=e.position,skinned=!!mesh.isSkinnedMesh;
      const skeleton=mesh.skeleton,indices=e.indicesAttr,weights=e.weightsAttr;
      if(!pos?.array || (skinned && (!skeleton?.bones?.length || !indices?.array || !weights?.array
        || indices.itemSize!==4 || weights.itemSize!==4 || !mesh.bindMatrix || !mesh.bindMatrixInverse)))return false;
      e.proxy=p;e.skinned=skinned;
      const count=p.sourceIndices.length;
      e.source=new Float64Array(count*3); // Immutable geometry coordinates; never read position vertices during animation.
      e.sourcePoints=new Float64Array(count*3);e.points=new Float64Array(p.samples.length*3);
      if(skinned) {
        e.indices=new Uint16Array(count*4);e.weights=new Float64Array(count*4);
        e.matrices=skeleton.bones.map(()=>new THREE.Matrix4());
      } else e.matrices=[new THREE.Matrix4()];
      for(let i=0;i<count;i++) {
        const index=p.sourceIndices[i],j=i*3;
        e.source[j]=pos.getX(index);e.source[j+1]=pos.getY(index);e.source[j+2]=pos.getZ(index);
        if(skinned)for(let k=0;k<4;k++)e.indices[i*4+k]=indices.array[index*4+k];
      }
      if(skinned)refreshWeights(e);
      // makeProxy emits two triangles per UV cell. A disk/slab enclosing
      // their four transformed corners also encloses both sampled triangles.
      e.patches=[];
      for(let i=0;i<p.tris.length;i+=2) {
        const corners=Array.from(new Set(p.tris[i].concat(p.tris[i+1]||[])));
        e.patches.push({corners,x:0,z:0,r:0,y0:0,y1:0,radial:0,angle:0,inner:0,outer:0});
      }
      return true;
    }

    function entryFor(mesh,d) {
      const geo=mesh?.geometry;
      if(!geo?.getAttribute)return null;
      const position=geo.getAttribute('position'),indices=geo.getAttribute('skinIndex'),weights=geo.getAttribute('skinWeight');
      let e=entries.get(mesh);
      if(!e || e.geo!==geo || e.position!==position || e.positionVersion!==position?.version
        || e.indicesAttr!==indices || e.indexVersion!==indices?.version || e.weightsAttr!==weights
        || e.skeleton!==mesh.skeleton || !sameMaps(mesh,e.maps)) {
        e={mesh,geo,position,positionVersion:position?.version,indicesAttr:indices,indexVersion:indices?.version,
          weightsAttr:weights,skeleton:mesh.skeleton,maps:mapKey(mesh),ready:false,retries:0};
        entries.set(mesh,e);
        const started=clock();e.ready=prepare(mesh,e);d.buildMs+=clock()-started;d.preparations++;
      } else if(!e.ready && ++e.retries>=30) {
        e.retries=0;const started=clock();e.ready=prepare(mesh,e);d.buildMs+=clock()-started;d.preparations++;
      }
      if(!e.ready)return null;
      if(e.skinned && e.weightVersion!==weights.version) {
        refreshWeights(e);d.weightRefreshes++; // Only cached source indices; painted pitch can change skin weights without changing the topology.
      }
      return e;
    }

    function sync(e) {
      const m=e.mesh;m.updateWorldMatrix(true,false);
      if(e.skinned)for(const b of m.skeleton.bones)if(!seenBones.has(b)) {
        b.updateWorldMatrix(true,false);seenBones.add(b);
      }
    }

    function isYawBone(b,rig) {
      return !!rig && (b===rig.frontYawBone || b===rig.backYawBone || b===rig.frontCombinedBone || b===rig.backCombinedBone);
    }

    function matrixPose(e,frame,rig,yawDeg) {
      const m=e.mesh;
      if(!e.skinned){e.matrices[0].multiplyMatrices(frame,m.matrixWorld);return;}
      // Attached skinning cancels mesh.matrixWorld against bindMatrixInverse.
      // Detached skins retain the full mesh * bindInverse prefix.
      prefix.copy(frame);
      if(m.bindMode==='detached')prefix.multiply(m.matrixWorld).multiply(m.bindMatrixInverse);
      const skeleton=m.skeleton;
      for(let i=0;i<skeleton.bones.length;i++) {
        const b=skeleton.bones[i];
        if(isYawBone(b,rig) && Math.abs(yawDeg-rig.currentYawDeg)>EPS) {
          // The animal's yaw and pitch+yaw bones are terminal siblings under
          // the torso bone. Substitute their local Y rotation mathematically;
          // no temporary updateHeadYaw calls or mutation of the live rig.
          euler.set(b.rotation.x,yawDeg*DEG,b.rotation.z,b.rotation.order);
          q.setFromEuler(euler);local.compose(b.position,q,b.scale);
          world.multiplyMatrices(b.parent.matrixWorld,local);
        } else world.copy(b.matrixWorld);
        e.matrices[i].multiplyMatrices(prefix,world).multiply(skeleton.boneInverses[i]).multiply(m.bindMatrix);
      }
    }

    function pose(e,frame,rig,yawDeg,grip,scale,out) {
      matrixPose(e,frame,rig,yawDeg);
      const src=e.source,dst=e.sourcePoints,points=e.points;
      for(let i=0;i<src.length;i+=3) {
        const x=src[i],y=src[i+1],z=src[i+2];
        let px=0,py=0,pz=0;
        if(e.skinned) {
          const j=i/3*4;
          for(let k=0;k<4;k++) {
            const w=e.weights[j+k];if(!w)continue;
            const a=e.matrices[e.indices[j+k]].elements;
            px+=w*(a[0]*x+a[4]*y+a[8]*z+a[12]);
            py+=w*(a[1]*x+a[5]*y+a[9]*z+a[13]);
            pz+=w*(a[2]*x+a[6]*y+a[10]*z+a[14]);
          }
        } else {
          const a=e.matrices[0].elements;
          px=a[0]*x+a[4]*y+a[8]*z+a[12];
          py=a[1]*x+a[5]*y+a[9]*z+a[13];
          pz=a[2]*x+a[6]*y+a[10]*z+a[14];
        }
        dst[i]=grip?(px-grip.x)*scale.x:px;
        dst[i+1]=grip?(py-grip.y)*scale.y:py;
        dst[i+2]=grip?(pz-grip.z)*scale.z:pz;
      }
      for(let i=0;i<e.proxy.samples.length;i++) {
        const [a,b,c,wa,wb,wc]=e.proxy.samples[i],j=i*3;
        for(let k=0;k<3;k++)points[j+k]=dst[a+k]*wa+dst[b+k]*wb+dst[c+k]*wc;
      }
      for(const d of e.patches) {
        let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity,y0=Infinity,y1=-Infinity;
        for(const i of d.corners) {
          const x=points[i],y=points[i+1],z=points[i+2];
          x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);y0=Math.min(y0,y);y1=Math.max(y1,y);
        }
        d.x=(x0+x1)/2;d.z=(z0+z1)/2;d.y0=y0;d.y1=y1;
        let r2=0;
        for(const i of d.corners)r2=Math.max(r2,(points[i]-d.x)**2+(points[i+2]-d.z)**2);
        d.r=Math.sqrt(r2);
        diskMetrics(d);out.push(d);
      }
    }

    function canonicalize(mesh,back) {
      const y=back?-Math.PI/2:Math.PI/2;
      if(mesh.matrixAutoUpdate===false || Math.abs(mesh.rotation.y-y)>EPS || Math.abs(mesh.rotation.x)>EPS || Math.abs(mesh.rotation.z)>EPS) {
        mesh.matrixAutoUpdate=true;mesh.rotation.set(0,y,0);mesh.updateMatrix();
      }
    }

    function constrain(args) {
      const started=clock(),d=diagnostic;
      const {pet,perch,grip,scale,quaternion}=args,avatar=pet?.avatarRef,group=avatar?.group;
      const requested=Math.atan2(2*(quaternion.w*quaternion.y+quaternion.x*quaternion.z),1-2*(quaternion.y**2+quaternion.z**2));
      const rig=avatar?.headRig,head=Number(rig?.currentYawDeg)||0;
      Object.assign(d,{mode:'geometry-unavailable',quality:'live-bone-envelopes',checks:0,buildChecks:0,buildMs:0,
        preparations:0,weightRefreshes:0,envelopePairs:0,headCandidates:0,ownerPatches:0,petPatches:0,cacheHit:true,
        requestedBodyYawDeg:requested/DEG,resolvedBodyYawDeg:requested/DEG,bodyOffsetDeg:0,requestedHeadYawDeg:head,headYawDeg:head});
      const finish=()=>{
        d.cacheHit=d.preparations===0;d.envelopePairs=scratch.pairTests;d.poseMs=Math.max(0,clock()-started-d.buildMs);
        // Do not keep the last unequipped/disposed avatar alive through scratch references.
        ownerEntries.length=petEntries.length=ownerDisks.length=petDisks.length=scratch.pairs.length=0;
        seenMeshes.clear();seenBones.clear();
        return d;
      };
      scratch.pairTests=0;
      if(!group?.isObject3D || !avatar.frontPlane || !grip || !scale || !perch || !args.ownerMeshes?.length)return finish();
      ownerEntries.length=petEntries.length=ownerDisks.length=petDisks.length=0;seenMeshes.clear();seenBones.clear();
      for(const mesh of args.ownerMeshes) {
        if(!mesh || seenMeshes.has(mesh))continue;
        seenMeshes.add(mesh);const e=entryFor(mesh,d);if(!e)return finish();ownerEntries.push(e);sync(e);
      }
      if(!ownerEntries.length)return finish();
      group.updateWorldMatrix(true,false);
      // The owner uses world-aligned coordinates around the live perch;
      // the pet uses native root coordinates around its authored grip.
      ownerFrame.makeTranslation(-perch.x,-perch.y,-perch.z);petFrame.copy(group.matrixWorld).invert();
      seenMeshes.clear();
      const addPet=(mesh,back)=>{
        if(!mesh || seenMeshes.has(mesh))return true;
        seenMeshes.add(mesh);canonicalize(mesh,back);const e=entryFor(mesh,d);if(!e)return false;petEntries.push(e);sync(e);return true;
      };
      if(!addPet(avatar.frontPlane,false) || !addPet(avatar.backPlane,true))return finish();
      for(const m of group.children)if(m.visible && m.userData?.hobunjiShoulderSplitOverlay && !addPet(m,m.userData.hobunjiPlaneFace==='back'))return finish();
      for(const e of ownerEntries)pose(e,ownerFrame,null,0,null,null,ownerDisks);
      ownerDisks.sort((a,b)=>a.y0-b.y0); // Vertical broad phase shared by every head alternative.
      d.ownerPatches=ownerDisks.length;
      let bestBody=null,bestHead=head,bestDelta=Infinity;
      const evaluate=angle=>{
        petDisks.length=0;
        for(const e of petEntries)pose(e,petFrame,rig,angle,grip,scale,petDisks);
        d.petPatches=petDisks.length;d.headCandidates++;
        const body=solveBodyYaw(ownerDisks,petDisks,requested,scratch);
        if(body===null)return false;
        if(args.passiveAwayLimit && Math.abs(angle)>EPS){
          const allowed=args.passiveAwayLimit(body);
          if(angle*allowed<=0 || Math.abs(angle)>Math.abs(allowed)+EPS)return false;
        }
        const delta=Math.abs(wrap(body-requested));
        if(delta<bestDelta-EPS || (Math.abs(delta-bestDelta)<=EPS && Math.abs(angle-head)<Math.abs(bestHead-head))) {
          bestDelta=delta;bestBody=body;bestHead=angle;
        }
        return delta<EPS;
      };
      const clear=evaluate(head);
      // Fixed, bounded head alternatives; body limits themselves are solved
      // as continuous angular arcs, never via a body-yaw scan or bisection.
      // Preserve the requested head yaw if the requested body yaw is clear.
      const canTurn=typeof avatar.updateHeadYaw==='function' && !!(rig?.frontYawBone || rig?.frontCombinedBone);
      if(!clear && canTurn) {
        candidates.length=0;
        if(Math.abs(head)>EPS)candidates.push(head*.75,head*.5,head*.25,0);
        for(const candidate of candidates)if(evaluate(candidate))break;
        if(bestBody===null && !args.passiveAwayLimit) { // Passive curiosity can yield to neutral, never search inward.
          const limit=Math.max(Math.abs(Number(rig.rig?.minDeg)||0),Math.abs(Number(rig.rig?.maxDeg)||0));
          const sign=head<0?1:-1;
          if(limit>EPS && !evaluate(sign*limit*.5) && bestBody===null)evaluate(sign*limit);
          if(Math.abs(head)<EPS && bestBody===null && !evaluate(-sign*limit*.5) && bestBody===null)evaluate(-sign*limit);
        }
      }
      if(bestBody===null){d.mode='no-safe-rotation';return finish();}
      d.mode='geometric-depth';d.bodyOffsetDeg=wrap(bestBody-requested)/DEG;d.resolvedBodyYawDeg=bestBody/DEG;d.headYawDeg=bestHead;
      if(bestDelta>EPS)quaternion.setFromAxisAngle(axis,bestBody);
      if(canTurn && Math.abs(bestHead-head)>EPS)avatar.updateHeadYaw(bestHead,1000);
      return finish();
    }
    return {constrain};
  }
  window.ShoulderPetDeformationEnvelope=Object.freeze({create,solveBodyYaw,diskMetrics});
})();

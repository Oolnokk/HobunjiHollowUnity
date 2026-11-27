// Shared painted silhouette preparation for shoulder constraints. Real rigs use
// live bone envelopes; the cached angular table remains for legacy/test runtimes.
(() => {
  'use strict';
  const GRID_X = 10, GRID_Y = 12; // Bounded proxy density, independent of visual tessellation.
  const DEG = Math.PI / 180;
  const CLEARANCE = 0.002; // World-space clearance between the two painted surfaces.
  const EPS = 1e-9;
  const BODY_CELLS=36, BODY_STEP=2*Math.PI/BODY_CELLS; // 10-degree cells around the owner-relative grip.
  const HEAD_STEP=8, SCALE_TOLERANCE=0.06, POSE_MARGIN=0.003; // Preparation-only sweep allowances.
  const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  const mod=(n,m)=>((n%m)+m)%m;
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));

  function separated(a, ai, b, bi, x, y, z, margin) {
    const length = Math.hypot(x, y, z);
    if (length < EPS) return false;
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (let k = 0; k < 3; k++) {
      const i = ai[k], j = bi[k];
      const ap = a[i] * x + a[i+1] * y + a[i+2] * z;
      const bp = b[j] * x + b[j+1] * y + b[j+2] * z;
      amin = Math.min(amin, ap); amax = Math.max(amax, ap);
      bmin = Math.min(bmin, bp); bmax = Math.max(bmax, bp);
    }
    return amin > bmax + margin * length || bmin > amax + margin * length;
  }
  const edge = (p, i, j) => [p[j]-p[i], p[j+1]-p[i+1], p[j+2]-p[i+2]];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  function trianglesOverlap(a, ai, b, bi, margin = CLEARANCE) {
    const ae = [edge(a,ai[0],ai[1]), edge(a,ai[1],ai[2]), edge(a,ai[2],ai[0])];
    const be = [edge(b,bi[0],bi[1]), edge(b,bi[1],bi[2]), edge(b,bi[2],bi[0])];
    const an = cross(ae[0], ae[1]), bn = cross(be[0], be[1]);
    const test = axis => separated(a, ai, b, bi, axis[0], axis[1], axis[2], margin);
    if (test(an) || test(bn)) return false;
    for (const e of ae) {
      if (test(cross(e, an))) return false; // Coplanar separation, including parallel billboard poses.
      for (const f of be) if (test(cross(e, f))) return false;
    }
    for (const f of be) if (test(cross(f, bn))) return false;
    return true;
  }

  function create(THREE) {
    const imageMasks = new WeakMap(); // Downsampled alpha integral image, shared by textures using the same pixels.
    const meshProxies = new WeakMap(); // Topology / texture caches are released with the live mesh.
    const tables = new WeakMap(); // At most two cached configurations per pet (mirrored perch sides).
    const vertex = new THREE.Vector3(), uvPoint = new THREE.Vector2();
    const axis = new THREE.Vector3(0, 1, 0);
    const liveEnvelope=window.ShoulderPetDeformationEnvelope?.create?.(THREE,proxyFor); // Bone-driven math shares the same cached alpha/topology.

    function alphaMask(map) {
      const image = map?.image;
      const w = Number(image?.naturalWidth || image?.videoWidth || image?.width);
      const h = Number(image?.naturalHeight || image?.videoHeight || image?.height);
      if (!(w > 0 && h > 0) || !image || typeof image !== 'object') return null;
      const version = map.version; // Canvas-backed portrait and split-layer updates invalidate the alpha mask.
      const old = imageMasks.get(image);
      if (old && old.version === version && old.w === w && old.h === h) return old;
      const mw = Math.min(w, 128), mh = Math.min(h, 128);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = mw; canvas.height = mh;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, mw, mh);
        const data = ctx.getImageData(0, 0, mw, mh).data;
        const sum = new Uint32Array((mw+1)*(mh+1)), stride = mw+1;
        for (let y=0; y<mh; y++) {
          let row=0;
          for (let x=0; x<mw; x++) {
            row += data[(y*mw+x)*4+3] > 8 ? 1 : 0;
            sum[(y+1)*stride+x+1] = sum[y*stride+x+1]+row;
          }
        }
        const mask = { version,w,h,mw,mh,sum,stride };
        imageMasks.set(image, mask);
        return mask;
      } catch (_) { return null; } // Loading or tainted images retry on the next pin, never guess alpha.
    }

    function opaqueCell(map, mask, u0,v0,u1,v1) {
      let minX=1,minY=1,maxX=0,maxY=0;
      for (const u of [u0+1e-7,u1-1e-7]) for (const v of [v0+1e-7,v1-1e-7]) {
        uvPoint.set(u,v);
        map.transformUv(uvPoint); // The real texture repeat/offset/flip, including portrait reflection.
        minX=Math.min(minX,uvPoint.x); maxX=Math.max(maxX,uvPoint.x);
        minY=Math.min(minY,uvPoint.y); maxY=Math.max(maxY,uvPoint.y);
      }
      const { mw,mh,sum,stride }=mask;
      const x0=Math.max(0,Math.min(mw-1,Math.floor(minX*mw))), x1=Math.min(mw,Math.max(x0+1,Math.ceil(maxX*mw)));
      const y0=Math.max(0,Math.min(mh-1,Math.floor(minY*mh))), y1=Math.min(mh,Math.max(y0+1,Math.ceil(maxY*mh)));
      return sum[y1*stride+x1]-sum[y1*stride+x0]-sum[y0*stride+x1]+sum[y0*stride+x0]>0;
    }

    function makeProxy(mesh, maps, masks) {
      const geo=mesh.geometry, uv=geo.getAttribute('uv'), pos=geo.getAttribute('position');
      if (!uv || !pos) return null;
      const idx=geo.index, group=geo.groups?.[0], start=group?.start || 0;
      const count=group?.count || (idx?.count || pos.count);
      const source=[]; // UV triangles of the original surface, with exact barycentric skin samples.
      for (let k=start;k<start+count;k+=3) {
        const a=idx?idx.getX(k):k, b=idx?idx.getX(k+1):k+1, c=idx?idx.getX(k+2):k+2;
        const ax=uv.getX(a),ay=uv.getY(a),bx=uv.getX(b),by=uv.getY(b),cx=uv.getX(c),cy=uv.getY(c);
        const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
        if (Math.abs(den)>EPS) source.push({a,b,c,ax,ay,bx,by,cx,cy,den,
          minU:Math.min(ax,bx,cx),maxU:Math.max(ax,bx,cx),minV:Math.min(ay,by,cy),maxV:Math.max(ay,by,cy)});
      }
      const us=Array.from({length:GRID_X+1},(_,i)=>i/GRID_X), vs=Array.from({length:GRID_Y+1},(_,i)=>i/GRID_Y);
      const seam=Number(geo.userData?.hobunjiAnimalYawFoldPivotX); // Do not interpolate across the rigid animal head fold.
      if (seam>0 && seam<1 && !us.some(u=>Math.abs(u-seam)<1e-5)) us.push(seam);
      us.sort((a,b)=>a-b);
      const samples=[], tris=[], pointIds=new Map(), sourceIds=new Map(), sourceIndices=[];
      function compact(i) {
        if (!sourceIds.has(i)) { sourceIds.set(i,sourceIndices.length*3); sourceIndices.push(i); }
        return sourceIds.get(i);
      }
      function sample(x,y) {
        const key=y*us.length+x;
        if (pointIds.has(key)) return pointIds.get(key);
        const u=us[x],v=vs[y];
        for (const t of source) {
          if (u<t.minU-1e-6 || u>t.maxU+1e-6 || v<t.minV-1e-6 || v>t.maxV+1e-6) continue;
          const wa=((t.by-t.cy)*(u-t.cx)+(t.cx-t.bx)*(v-t.cy))/t.den;
          const wb=((t.cy-t.ay)*(u-t.cx)+(t.ax-t.cx)*(v-t.cy))/t.den;
          const wc=1-wa-wb;
          if (Math.min(wa,wb,wc)<-1e-5) continue;
          const i=samples.length*3;
          samples.push([compact(t.a),compact(t.b),compact(t.c),wa,wb,wc]);
          pointIds.set(key,i);
          return i;
        }
        return -1;
      }
      for (let y=0;y<vs.length-1;y++) for (let x=0;x<us.length-1;x++) {
        if (!maps.some((map,i)=>opaqueCell(map,masks[i],us[x],vs[y],us[x+1],vs[y+1]))) continue;
        const a=sample(x,y),b=sample(x+1,y),c=sample(x,y+1),d=sample(x+1,y+1);
        if (Math.min(a,b,c,d)>=0) tris.push([a,b,c],[b,d,c]);
      }
      return { sourceIndices,samples,tris, sourcePoints:new Float64Array(sourceIndices.length*3),
        points:new Float64Array(samples.length*3), world:new Float64Array(samples.length*3),
        boxes:new Float64Array(tris.length*6) };
    }

    function proxyFor(mesh) {
      if (!mesh?.geometry?.getAttribute) return null;
      const maps=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m?.map).filter(Boolean);
      if (!maps.length || maps.some(m=>typeof m.transformUv!=='function')) return null;
      const key=maps.map(m=>[m,m.image,m.version,m.repeat?.x,m.repeat?.y,m.offset?.x,m.offset?.y,m.rotation,m.flipY]);
      let entries=meshProxies.get(mesh); // Keep a small LRU for alternating idle/split animation maps.
      if (!entries || entries.geo!==mesh.geometry) {
        entries={geo:mesh.geometry,items:[]};meshProxies.set(mesh,entries);
      }
      const found=entries.items.findIndex(old=>old.key.length===key.length && old.key.every((v,i)=>v.every((x,j)=>x===key[i][j])));
      if(found>=0) {const hit=entries.items.splice(found,1)[0];entries.items.unshift(hit);return hit.proxy;}
      const masks=maps.map(alphaMask);
      if (masks.some(m=>!m)) return null;
      for (const map of maps) if (map.matrixAutoUpdate) map.updateMatrix();
      const proxy=makeProxy(mesh,maps,masks);
      if (proxy) {entries.items.unshift({key,proxy});if(entries.items.length>6)entries.items.pop();}
      return proxy;
    }

    function pose(mesh, matrix) {
      const p=proxyFor(mesh);
      if (!p) return null;
      const pos=mesh.geometry.getAttribute('position');
      for (let k=0;k<p.sourceIndices.length;k++) {
        const i=p.sourceIndices[k];
        if (mesh.getVertexPosition) mesh.getVertexPosition(i,vertex);
        else {
          vertex.fromBufferAttribute(pos,i);
          if (mesh.isSkinnedMesh) (mesh.applyBoneTransform || mesh.boneTransform)?.call(mesh,i,vertex);
        }
        vertex.applyMatrix4(matrix);
        const j=k*3;
        p.sourcePoints[j]=vertex.x;p.sourcePoints[j+1]=vertex.y;p.sourcePoints[j+2]=vertex.z;
      }
      for (let k=0;k<p.samples.length;k++) {
        const [a,b,c,wa,wb,wc]=p.samples[k],j=k*3;
        for(let n=0;n<3;n++) p.points[j+n]=p.sourcePoints[a+n]*wa+p.sourcePoints[b+n]*wb+p.sourcePoints[c+n]*wc;
      }
      return p;
    }
    function bounds(p, points) {
      for (let k=0;k<p.tris.length;k++) {
        const [a,b,c]=p.tris[k],j=k*6;
        for(let n=0;n<3;n++) {
          p.boxes[j+n]=Math.min(points[a+n],points[b+n],points[c+n]);
          p.boxes[j+n+3]=Math.max(points[a+n],points[b+n],points[c+n]);
        }
      }
    }
    function worldPet(p, perch, grip, scale, yaw) {
      const cos=Math.cos(yaw),sin=Math.sin(yaw);
      for(let k=0;k<p.points.length;k+=3) {
        const x=(p.points[k]-grip.x)*scale.x, y=(p.points[k+1]-grip.y)*scale.y, z=(p.points[k+2]-grip.z)*scale.z;
        p.world[k]=perch.x+cos*x+sin*z; p.world[k+1]=perch.y+y; p.world[k+2]=perch.z-sin*x+cos*z;
      }
      bounds(p,p.world);
    }
    function radialBounds(boxes,i) {
      const j=i*6,x0=boxes[j],z0=boxes[j+2],x1=boxes[j+3],z1=boxes[j+5];
      return [Math.hypot(Math.max(x0,0,-x1),Math.max(z0,0,-z1)),
        Math.hypot(Math.max(Math.abs(x0),Math.abs(x1)),Math.max(Math.abs(z0),Math.abs(z1)))];
    }

    function prepareCandidates(owners,pets,grip,scale) {
      for(const p of pets) {
        worldPet(p,origin,grip,scale,0);
        p.candidates=new Array(p.tris.length); // Rotation-invariant radial/height broad phase, reused by every body angle.
        for(let i=0;i<p.tris.length;i++) {
          const [r0,r1]=radialBounds(p.boxes,i),a=i*6,margin=Math.max(CLEARANCE,p.padding[i]);
          const candidates=[];
          for(const o of owners)for(let j=0;j<o.tris.length;j++) {
            const b=j*6,k=j*2;
            if(p.boxes[a+1]>o.boxes[b+4]+margin || o.boxes[b+1]>p.boxes[a+4]+margin
              || r0>o.radials[k+1]+margin || o.radials[k]>r1+margin)continue;
            candidates.push(o,j);
          }
          p.candidates[i]=candidates;
        }
      }
    }

    function collisions(owners,pets,perch,grip,scale,yaw,contact,padded) {
      for(const p of pets) {
        worldPet(p,perch,grip,scale,yaw);
        for(let i=0;i<p.tris.length;i++) for(let k=0;k<p.candidates[i].length;k+=2) {
          const o=p.candidates[i][k],j=p.candidates[i][k+1];
          const a=i*6,b=j*6,A=p.boxes,B=o.boxes;
          const margin=padded?p.padding[i]:CLEARANCE;
          if(A[a]>B[b+3]+margin || B[b]>A[a+3]+margin ||
             A[a+1]>B[b+4]+margin || B[b+1]>A[a+4]+margin ||
             A[a+2]>B[b+5]+margin || B[b+2]>A[a+5]+margin) continue;
          // The authored grip is meant to touch the shoulder. Ignore only overlap
          // confined to this small contact neighborhood, not the pet's entire lower body.
          let far2=0;
          for(let n=0;n<3;n++) {
            const origin=n===0?perch.x:n===1?perch.y:perch.z;
            const lo=Math.max(A[a+n],B[b+n]),hi=Math.min(A[a+n+3],B[b+n+3]);
            far2+=Math.max(Math.abs(lo-origin),Math.abs(hi-origin))**2;
          }
          if(far2<=contact*contact) continue;
          if(trianglesOverlap(p.world,p.tris[i],o.points,o.tris[j],margin)) return true;
        }
      }
      return false;
    }

    const origin={x:0,y:0,z:0}; // Grip-centered coordinates during preparation.
    const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();

    function headLimit(avatar,requested) {
      if(typeof avatar.updateHeadYaw!=='function' || !avatar.headRig)return 0;
      const rig=avatar.headRig.rig;
      return Math.min(180,Math.max(Math.abs(Number(rig?.minDeg)||0),Math.abs(Number(rig?.maxDeg)||0)) || Math.abs(requested));
    }

    function matches(e,a,v,limit) {
      if(!e || e.front!==v.frontPlane || e.fg!==v.frontPlane.geometry || e.back!==v.backPlane
        || e.bg!==v.backPlane?.geometry || e.children!==v.group.children.length || e.rig!==v.headRig || e.limit!==limit
        || e.gx!==a.grip.x || e.gy!==a.grip.y || e.gz!==a.grip.z || e.owners.length!==a.ownerMeshes.length)return false;
      for(let i=0;i<e.owners.length;i++)if(e.owners[i]!==a.ownerMeshes[i] || e.geometries[i]!==a.ownerMeshes[i]?.geometry)return false;
      return Math.abs(a.scale.x-e.sx)<=Math.abs(e.sx)*SCALE_TOLERANCE
        && Math.abs(a.scale.y-e.sy)<=Math.abs(e.sy)*SCALE_TOLERANCE
        && Math.abs(a.scale.z-e.sz)<=Math.abs(e.sz)*SCALE_TOLERANCE;
    }

    function configuration(a,v,limit) {
      return {front:v.frontPlane,fg:v.frontPlane.geometry,back:v.backPlane,bg:v.backPlane?.geometry,
        children:v.group.children.length,rig:v.headRig,limit,gx:a.grip.x,gy:a.grip.y,gz:a.grip.z,
        sx:a.scale.x,sy:a.scale.y,sz:a.scale.z,owners:a.ownerMeshes.slice(),geometries:a.ownerMeshes.map(m=>m?.geometry),
        diagnostic:{},retries:0};
    }

    function compileRows(safe,count) {
      const rows=new Array(BODY_CELLS),left=new Int16Array(BODY_CELLS),right=new Int16Array(BODY_CELLS);
      left.fill(-1);right.fill(-1);let any=false;
      for(let i=0;i<BODY_CELLS;i++) {
        const row=new Int16Array(count);row.fill(-1);let valid=false;
        for(let j=0;j<count;j++)for(let d=0;d<count;d++) {
          if(j-d>=0 && safe[i*count+j-d]){row[j]=j-d;valid=true;break;}
          if(j+d<count && safe[i*count+j+d]){row[j]=j+d;valid=true;break;}
        }
        if(valid){rows[i]=row;any=true;}
      }
      if(!any)return null;
      for(let i=0;i<BODY_CELLS;i++)for(let d=0;d<BODY_CELLS;d++) {
        const a=mod(i-d,BODY_CELLS),b=mod(i+d,BODY_CELLS);
        if(left[i]<0 && rows[a])left[i]=a;
        if(right[i]<0 && rows[b])right[i]=b;
        if(left[i]>=0 && right[i]>=0)break;
      }
      return {rows,left,right};
    }

    function prepare(args,avatar,e,requestedHead) {
      const started=clock(),owners=[],{perch,grip,scale}=args;
      const yaw=Number(args.ownerFrameYaw)||0,c=Math.cos(yaw),sn=Math.sin(yaw);
      for(const mesh of new Set(args.ownerMeshes.filter(Boolean))) {
        mesh.updateWorldMatrix(true,false);mesh.updateMatrixWorld(true);
        const p=pose(mesh,mesh.matrixWorld);if(!p)return;
        for(let i=0;i<p.points.length;i+=3) {
          const x=p.points[i]-perch.x,z=p.points[i+2]-perch.z;
          p.points[i]=c*x-sn*z;p.points[i+1]-=perch.y;p.points[i+2]=sn*x+c*z;
        }
        bounds(p,p.points);p.radials=new Float64Array(p.tris.length*2);
        for(let i=0;i<p.tris.length;i++)p.radials.set(radialBounds(p.boxes,i),i*2);
        owners.push(p);
      }
      if(!owners.length)return;
      const group=avatar.group,front=avatar.frontPlane,back=avatar.backPlane,meshes=[front];
      if(back && back!==front)meshes.push(back);
      for(const m of group.children)if(m.visible && m.userData?.hobunjiShoulderSplitOverlay && !meshes.includes(m))meshes.push(m);
      for(const m of meshes)if(m.rotation?.set) {
        m.matrixAutoUpdate=true;m.rotation.set(0,m===back || m.userData?.hobunjiPlaneFace==='back'?-Math.PI/2:Math.PI/2,0);m.updateMatrix?.();
      }
      const n=Math.ceil(e.limit/HEAD_STEP),count=2*n+1,step=n?e.limit/n:0;
      const padded=new Uint8Array(BODY_CELLS*count),exact=new Uint8Array(padded.length);
      const canTurn=typeof avatar.updateHeadYaw==='function' && !!avatar.headRig;
      let current=requestedHead,checks=0;
      function sample(deg,copy) {
        if(canTurn && current!==deg){avatar.updateHeadYaw(deg,1000);current=deg;}
        group.updateWorldMatrix(true,false);group.updateMatrixWorld(true);
        const p=meshes.map(m=>pose(m,m.matrix));if(!p.every(Boolean))return null;
        return copy?p.map(v=>({proxy:v,points:new Float64Array(v.points)})):p;
      }
      try {
        for(let j=0;j<count;j++) {
          const center=(j-n)*step,lo=Math.max(-e.limit,center-step/2),hi=Math.min(e.limit,center+step/2);
          const a=step?sample(lo,true):null,b=step?sample(hi,true):null,pets=sample(center,false);
          if(!pets)return;
          let continuous=!step || !!(a&&b);
          for(let k=0;k<pets.length;k++) {
            const p=pets[k];p.padding=new Float64Array(p.tris.length);
            if(step && (!a || !b || a[k].proxy!==p || b[k].proxy!==p)){continuous=false;continue;}
            for(let i=0;i<p.tris.length;i++) {
              let pad=0;
              for(const v of p.tris[i]) {
                const x=(p.points[v]-grip.x)*scale.x,y=(p.points[v+1]-grip.y)*scale.y,z=(p.points[v+2]-grip.z)*scale.z;
                let headSweep=0;
                if(step)for(const endpoint of [a[k].points,b[k].points])
                  headSweep=Math.max(headSweep,Math.hypot((endpoint[v]-p.points[v])*scale.x,(endpoint[v+1]-p.points[v+1])*scale.y,(endpoint[v+2]-p.points[v+2])*scale.z));
                pad=Math.max(pad,2*Math.hypot(x,z)*Math.sin(BODY_STEP/4)+Math.hypot(x,y,z)*SCALE_TOLERANCE+headSweep*1.1);
              }
              p.padding[i]=CLEARANCE+POSE_MARGIN+pad;
            }
          }
          prepareCandidates(owners,pets,grip,scale);
          for(let i=0;i<BODY_CELLS;i++) {
            const angle=i*BODY_STEP,index=i*count+j;
            if(continuous){checks++;if(!collisions(owners,pets,origin,grip,scale,angle,0.035,true)){padded[index]=exact[index]=1;continue;}}
            checks++;if(!collisions(owners,pets,origin,grip,scale,angle,0.035,false))exact[index]=1;
          }
        }
      } finally {
        if(canTurn && current!==requestedHead)avatar.updateHeadYaw(requestedHead,1000);
        e.buildChecks=checks;e.buildMs=clock()-started;
      }
      e.padded=compileRows(padded,count);e.exact=compileRows(exact,count);
      e.count=count;e.n=n;e.step=step;e.prepared=true;
    }

    function lookup(table,e,relative,requestedHead,bodyIndex,requestedIndex,padded,out) {
      if(!table)return false;
      const {rows,left,right}=table;
      let index=bodyIndex;
      if(!rows[index]) {
        const l=left[index],r=right[index];
        index=Math.abs(wrap(relative-l*BODY_STEP))<=Math.abs(wrap(relative-r*BODY_STEP))?l:r;
      }
      const center=index*BODY_STEP,half=padded?BODY_STEP/2-1e-7:0;
      out.body=wrap(center+clamp(wrap(relative-center),-half,half));
      const headCenter=(rows[index][requestedIndex]-e.n)*e.step,headHalf=padded?e.step/2:0;
      out.head=clamp(requestedHead,Math.max(-e.limit,headCenter-headHalf),Math.min(e.limit,headCenter+headHalf));
      return true;
    }
    const paddedResult={},exactResult={}; // Reused scratch; no runtime lookup allocations.

    function constrain(args) {
      if(liveEnvelope)return liveEnvelope.constrain(args); // Owns its own unavailable cases, so the held pose and camera-edge zone still apply.
      const {pet,grip,scale,quaternion}=args,avatar=pet?.avatarRef,group=avatar?.group;
      if(!group?.isObject3D || !avatar.frontPlane || !grip || !scale || !args.ownerMeshes?.length)return {mode:'geometry-unavailable'};
      const yaw=Math.atan2(2*(quaternion.w*quaternion.y+quaternion.x*quaternion.z),1-2*(quaternion.y**2+quaternion.z**2));
      const ownerYaw=Number(args.ownerFrameYaw)||0,requestedHead=Number(avatar.headRig?.currentYawDeg)||0;
      const limit=headLimit(avatar,requestedHead),side=args.perchSide<0?0:1;
      let slots=tables.get(group);if(!slots){slots=[null,null];tables.set(group,slots);}
      let e=slots[side],built=false;
      if(!matches(e,args,avatar,limit)){e=configuration(args,avatar,limit);slots[side]=e;prepare(args,avatar,e,requestedHead);built=true;}
      else if(!e.prepared && ++e.retries>=30){e.retries=0;prepare(args,avatar,e,requestedHead);built=true;}
      const d=e.diagnostic; // Reuse per configuration. No geometry sampling or collision tests on cache hits.
      d.mode=!e.prepared?'geometry-unavailable':e.exact?'geometric-depth':'no-safe-rotation';
      d.quality='unavailable';d.cacheHit=!built;d.checks=built?(e.buildChecks||0):0;
      d.buildChecks=e.buildChecks||0;d.buildMs=e.buildMs||0;d.requestedBodyYawDeg=yaw/DEG;d.resolvedBodyYawDeg=yaw/DEG;
      d.bodyOffsetDeg=0;d.requestedHeadYawDeg=requestedHead;d.headYawDeg=requestedHead;
      if(!e.exact)return d;
      const relative=wrap(yaw-ownerYaw),bodyIndex=mod(Math.round(relative/BODY_STEP),BODY_CELLS);
      const requestedIndex=e.step?clamp(Math.round(requestedHead/e.step)+e.n,0,e.count-1):0;
      const hasPadded=lookup(e.padded,e,relative,requestedHead,bodyIndex,requestedIndex,true,paddedResult);
      lookup(e.exact,e,relative,requestedHead,bodyIndex,requestedIndex,false,exactResult);
      // Prefer a swept cell, but preserve a verified sample if padding would unnecessarily
      // move the body farther, or force a requested head turn past neutral.
      const chooseExact=!hasPadded
        || Math.abs(wrap(exactResult.body-relative))+1e-7<Math.abs(wrap(paddedResult.body-relative))
        || (Math.abs(wrap(exactResult.body-relative))<=Math.abs(wrap(paddedResult.body-relative))+1e-7
            && requestedHead*paddedResult.head<0 && requestedHead*exactResult.head>=0);
      const result=chooseExact?exactResult:paddedResult;
      const resolvedYaw=wrap(ownerYaw+result.body),headYaw=result.head;
      quaternion.setFromAxisAngle(axis,resolvedYaw);
      if(typeof avatar.updateHeadYaw==='function' && avatar.headRig && Math.abs(headYaw-requestedHead)>1e-6)avatar.updateHeadYaw(headYaw,1000);
      d.quality=chooseExact?'sampled-centre':'padded-cell';
      d.bodyOffsetDeg=wrap(resolvedYaw-yaw)/DEG;d.resolvedBodyYawDeg=resolvedYaw/DEG;d.headYawDeg=headYaw;
      return d;
    }
    return { constrain };
  }
  window.ShoulderPetRotationLimits=Object.freeze({create,trianglesOverlap});
})();

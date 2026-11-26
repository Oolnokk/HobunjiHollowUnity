// Geometric shoulder-pet collision proxy. Alpha masks and UV topology are cached;
// only the small set of sampled vertices follows the live skinning each pin.
(() => {
  'use strict';
  const GRID_X = 10, GRID_Y = 12; // Bounded proxy density, independent of visual tessellation.
  const DEG = Math.PI / 180;
  const CLEARANCE = 0.002; // World-space clearance between the two painted surfaces.
  const EPS = 1e-9;

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
    const previous = new WeakMap(); // Last safe body offset per attached avatar; avoids repeating a full angle sweep.
    const vertex = new THREE.Vector3(), uvPoint = new THREE.Vector2();
    const axis = new THREE.Vector3(0, 1, 0);

    function alphaMask(map) {
      const image = map?.image;
      const w = Number(image?.naturalWidth || image?.videoWidth || image?.width);
      const h = Number(image?.naturalHeight || image?.videoHeight || image?.height);
      if (!(w > 0 && h > 0) || !image || typeof image !== 'object') return null;
      const version = map.version; // Canvas-backed portrait and split-layer updates invalidate the alpha mask.
      const old = imageMasks.get(image);
      if (old?.version === version && old.w === w && old.h === h) return old;
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
      const old=meshProxies.get(mesh);
      if (old?.geo===mesh.geometry && old.key.length===key.length && old.key.every((v,i)=>v.every((x,j)=>x===key[i][j]))) return old.proxy;
      const masks=maps.map(alphaMask);
      if (masks.some(m=>!m)) return null;
      for (const map of maps) if (map.matrixAutoUpdate) map.updateMatrix();
      const proxy=makeProxy(mesh,maps,masks);
      if (proxy) meshProxies.set(mesh,{geo:mesh.geometry,key,proxy});
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
    function collisions(owners,pets,perch,grip,scale,yaw,contact) {
      for(const p of pets) {
        worldPet(p,perch,grip,scale,yaw);
        for(const o of owners) for(let i=0;i<p.tris.length;i++) for(let j=0;j<o.tris.length;j++) {
          const a=i*6,b=j*6,A=p.boxes,B=o.boxes;
          if(A[a]>B[b+3]+CLEARANCE || B[b]>A[a+3]+CLEARANCE ||
             A[a+1]>B[b+4]+CLEARANCE || B[b+1]>A[a+4]+CLEARANCE ||
             A[a+2]>B[b+5]+CLEARANCE || B[b+2]>A[a+5]+CLEARANCE) continue;
          // The authored grip is meant to touch the shoulder. Ignore only overlap
          // confined to this small contact neighborhood, not the pet's entire lower body.
          let far2=0;
          for(let n=0;n<3;n++) {
            const origin=n===0?perch.x:n===1?perch.y:perch.z;
            const lo=Math.max(A[a+n],B[b+n]),hi=Math.min(A[a+n+3],B[b+n+3]);
            far2+=Math.max(Math.abs(lo-origin),Math.abs(hi-origin))**2;
          }
          if(far2<=contact*contact) continue;
          if(trianglesOverlap(p.world,p.tris[i],o.points,o.tris[j])) return true;
        }
      }
      return false;
    }

    function constrain({ ownerMeshes, pet, perch, grip, scale, quaternion }) {
      const avatar=pet?.avatarRef, group=avatar?.group, front=avatar?.frontPlane;
      if (!group?.isObject3D || !front || !grip || !scale || !ownerMeshes?.length) return {mode:'geometry-unavailable'};
      const owners=[];
      for(const mesh of new Set(ownerMeshes.filter(Boolean))) {
        mesh.updateWorldMatrix(true,false);mesh.updateMatrixWorld(true);
        const p=pose(mesh,mesh.matrixWorld);
        if(!p) return {mode:'geometry-unavailable'};
        bounds(p,p.points);owners.push(p);
      }
      if(!owners.length) return {mode:'geometry-unavailable'};
      const meshes=[front,...group.children.filter(m=>m.visible && m.userData?.hobunjiShoulderSplitOverlay && m.userData?.hobunjiPlaneFace==='front')];
      function petPose() {
        group.updateWorldMatrix(true,false);group.updateMatrixWorld(true);
        const poses=meshes.map(m=>pose(m,m.matrix)); // All canonical animal cards are direct children of the scaled root.
        return poses.every(Boolean)?poses:null;
      }
      let poses=petPose();
      if(!poses) return {mode:'geometry-unavailable'};
      const yaw=Math.atan2(2*(quaternion.w*quaternion.y+quaternion.x*quaternion.z),1-2*(quaternion.y**2+quaternion.z**2));
      const requestedHead=Number(avatar.headRig?.currentYawDeg)||0;
      const canTurnHead=typeof avatar.updateHeadYaw==='function' && !!avatar.headRig;
      const contact=0.035; // Intentional grip contact in world units, not a global collision exemption.
      let checks=0;
      const safe=(offset)=>{checks++;return !collisions(owners,poses,perch,grip,scale,yaw+offset,contact);};
      if(safe(0)) { previous.set(group,0);return {mode:'geometric-depth',bodyOffsetDeg:0,headYawDeg:requestedHead,checks}; }
      const setHead=degrees=>{avatar.updateHeadYaw(degrees,1000);poses=petPose();};
      if(canTurnHead && requestedHead) setHead(0);
      let offset=null;
      if(poses && safe(0)) offset=0;
      else if(poses) {
        const last=previous.get(group);
        if(Number.isFinite(last) && last && safe(last)) {
          // A safe preceding clamp gives an inexpensive bracket for the new live pose.
          offset=last;
        } else {
          for(let d=15;d<=90 && offset===null;d+=15) {
            for(const sign of [-1,1]) if(safe(sign*d*DEG)) {offset=sign*d*DEG;break;}
          }
        }
        if(offset!==null && offset!==0) {
          let lo=0,hi=offset;
          for(let i=0;i<4;i++) {const mid=(lo+hi)/2;if(safe(mid))hi=mid;else lo=mid;}
          offset=hi;
        }
      }
      // Preserve the requested head direction when it fits. Clamp its final
      // applied angle independently of body yaw, not the owner's deadzone input.
      if(offset===null) {
        if(canTurnHead && requestedHead) setHead(requestedHead);
        return {mode:'no-safe-rotation',bodyOffsetDeg:0,headYawDeg:requestedHead,checks};
      }
      let headYaw=0;
      if(canTurnHead && requestedHead) {
        setHead(requestedHead);
        if(poses && safe(offset)) headYaw=requestedHead;
        else {
          let lo=0,hi=1;
          for(let i=0;i<4;i++) {
            const mid=(lo+hi)/2;
            setHead(requestedHead*mid);
            if(poses && safe(offset))lo=mid;else hi=mid;
          }
          headYaw=requestedHead*lo;
          setHead(headYaw);
        }
      }
      quaternion.setFromAxisAngle(axis,yaw+offset);
      previous.set(group,offset);
      return {mode:'geometric-depth',bodyOffsetDeg:offset/DEG,headYawDeg:headYaw,requestedHeadYawDeg:requestedHead,checks};
    }
    return { constrain };
  }
  window.ShoulderPetRotationLimits=Object.freeze({create,trianglesOverlap});
})();

// Wall fixtures shared by the House Editor and HousePieceGen gameplay renderer.
// Fixture locations are stored in the owning wall face's normalized U/V frame.
(function (global) {
  'use strict';
  if (global.HouseWallFixtures) return;
  // Keep the asset path stable across the game and Tool Hub's nested editors.
  const scriptSrc=typeof document!=='undefined'?document.currentScript?.src:null;
  const authoredConfigBase=scriptSrc&&typeof URL!=='undefined'
    ?new URL('../config/furniture-authored/',scriptSrc).href:null;
  const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const WINDOWS = new Set(['simpleWindow', 'crossbarWindow', 'wideWindow']);
  const PRESETS = Object.freeze({
    simpleWindow: { width: .76, height: .88 },
    crossbarWindow: { width: .85, height: .94 },
    wideWindow: { width: 1.25, height: .78 },
    sign: { width: .9, height: .48 },
    generalStoreSign: { width: .393, height: 1.37 }, // Authored +X beam-end mounting face, not a generic sign board.
    innSign: { width: .8, height: 1.3 },
    authoredWallFurniture: { width: .8, height: 1.3 }, // Signed/banner-like furniture with a declared wall ornament end.
    torch: { width: .18, height: .54 }
  });
  const isWindow = fixture => WINDOWS.has(fixture?.key);
  const validFace = face => face?.tag === 'wall' && Array.isArray(face.v) && face.v.length === 4
    && face.v.every(p => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite));
  const point = (face, u, v) => {
    const b = face.v[0], t = face.v[1], rt = face.v[2], rb = face.v[3];
    return [0,1,2].map(i => (1-v)*((1-u)*b[i]+u*rb[i]) + v*((1-u)*t[i]+u*rt[i]));
  };
  const faceSize = face => ({
    width: Math.hypot(...face.v[3].map((v,i)=>v-face.v[0][i])),
    height: Math.hypot(...face.v[1].map((v,i)=>v-face.v[0][i]))
  });
  const defaultPattern = () => ({
    slot:'stained-glass', selector:'all',mode:'glass',solid:true,patternId:'diamond-ring',
    scale:1, palette:['#b9d2db','#315b67','#315b67'],
    layerTransforms:[{tiling:true,scale:1,rotationDeg:0,offsetX:0,offsetY:0},
      {tiling:false,scale:1,rotationDeg:0,offsetX:0,offsetY:0}]
  });
  // All face math is shared by the cutter and renderer. The original gable
  // tangent may climb toward the ridge, so NEVER pass raw face edge vectors
  // to Matrix4.makeBasis: it requires a truly orthonormal frame.
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  const add=(a,b)=>a.map((v,i)=>v+b[i]);
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const mul=(a,k)=>a.map(v=>v*k);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const length=a=>Math.hypot(...a);
  const unit=a=>mul(a,1/Math.max(1e-10,length(a)));
  function faceFrame(face, toWorld=p=>p) {
    if(!validFace(face))return null;
    const b=toWorld(face.v[0]), t=toWorld(face.v[1]), rb=toWorld(face.v[3]);
    const edge=sub(rb,b), rise=sub(t,b);
    // A wall's left/right direction must be level even on tapered gables.
    let right=[edge[0],0,edge[2]];
    if(length(right)<1e-7){
      const top=sub(toWorld(face.v[2]),t);
      right=[top[0],0,top[2]];
    }
    if(length(right)<1e-7)return null; // Horizontal attachment frame is undefined on a floor/roof-like quad.
    right=unit(right);
    // Preserve face winding/outward orientation, but exclude any shear from
    // the non-rectangular or sloped authored geometry.
    let outward=unit(cross(rise,edge));
    if(length(outward)<.5)return null;
    const up=unit(cross(right,outward));
    if(up[1]<.08)return null; // A wall face should rise towards world +Y.
    outward=unit(cross(up,right));
    return {right,up,outward};
  }
  function normalize(fixture) {
    const key=PRESETS[fixture?.key]?fixture.key:'simpleWindow';
    return {
      ...fixture,key,id:String(fixture?.id||''),faceId:fixture?.faceId,
      u:clamp(finite(fixture?.u,.5),0,1),v:clamp(finite(fixture?.v,.5),0,1),
      width:clamp(finite(fixture?.width,PRESETS[key].width),.05,12),
      height:clamp(finite(fixture?.height,PRESETS[key].height),.05,12),
      depth:clamp(finite(fixture?.depth,fixture?.authoredFurnitureKey?0:.035),-.5,1.5),
      bodyOutset:clamp(finite(fixture?.bodyOutset,0),0,
        clamp(finite(fixture?.supportExtension?.maxOutset,6),0,6)), // Keep furniture within its beam's declared reach.
      rotationDeg:((finite(fixture?.rotationDeg,0)%360)+360)%360, // Spin in the wall plane; persists through game/editor/export.
      orientation:fixture?.orientation==='perpendicular'?'perpendicular':'flush',
      pattern:fixture?.pattern||defaultPattern()
    };
  }
  function uvFromWorld(face,target) {
    // Bilinear inverse handles narrowing gables where a fixed-u window cut
    // would become trapezoidal. Newton's normal equations also work for the
    // small non-planarity of independently edited house-face vertices.
    let u=.5,v=.5;
    for(let i=0;i<18;i++) {
      const b=face.v[0],t=face.v[1],rt=face.v[2],rb=face.v[3];
      const p=point(face,u,v),d=sub(target,p);
      const du=add(mul(sub(rb,b),1-v),mul(sub(rt,t),v));
      const dv=add(mul(sub(t,b),1-u),mul(sub(rt,rb),u));
      const uu=dot(du,du),uv=dot(du,dv),vv=dot(dv,dv),det=uu*vv-uv*uv;
      if(Math.abs(det)<1e-12)break;
      const uStep=(dot(d,du)*vv-dot(d,dv)*uv)/det;
      const vStep=(dot(d,dv)*uu-dot(d,du)*uv)/det;
      u+=clamp(uStep,-.4,.4);v+=clamp(vStep,-.4,.4);
      if(Math.abs(uStep)+Math.abs(vStep)<1e-9)break;
    }
    return {u,v};
  }
  function paneCornersWorld(face,f) {
    const frame=faceFrame(face);
    if(!frame)return [];
    const center=point(face,f.u,f.v),rad=f.rotationDeg*Math.PI/180;
    const co=Math.cos(rad),si=Math.sin(rad);
    // Local X is -wallRight, local Y is wallUp (also used by the mesh quaternion).
    return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>{
      const dx=x*f.width*.5,dy=y*f.height*.5;
      return add(center,add(mul(frame.right,-(co*dx-si*dy)),mul(frame.up,si*dx+co*dy)));
    });
  }
  function paneCornersUV(face,f) {
    return paneCornersWorld(face,f).map(p=>uvFromWorld(face,p));
  }
  // Keep rotated glass entirely within the selected wall, including a gable
  // whose top edge is shorter than its bottom edge. A binary size adjustment
  // is cheaper and more stable than comparing raw quad edge lengths.
  function fitToFace(face,raw) {
    const f=normalize(raw);
    if(!validFace(face)||f.authoredFurnitureKey)return f; // Authored sign owns its dimensions/unequal scale; never squeeze it like a window.
    const size=faceSize(face);
    f.width=Math.min(f.width,Math.max(.05,size.width*.96));
    f.height=Math.min(f.height,Math.max(.05,size.height*.96));
    const margin=.015;
    const cornersFit=fixture=>paneCornersUV(face,fixture).every(p=>Number.isFinite(p.u)&&Number.isFinite(p.v)
      &&p.u>=margin-1e-5&&p.u<=1-margin+1e-5&&p.v>=margin-1e-5&&p.v<=1-margin+1e-5);
    // Prefer sliding a new window away from an edge to shrinking it to a
    // postage stamp. Gables still shrink when their sloping top leaves too
    // little genuine wall for a full window at this height.
    const rad=f.rotationDeg*Math.PI/180,co=Math.abs(Math.cos(rad)),si=Math.abs(Math.sin(rad));
    const widthAtV=length(sub(point(face,1,f.v),point(face,0,f.v))); // The gable may be narrower at the chosen height.
    const heightAtU=length(sub(point(face,f.u,1),point(face,f.u,0)));
    const halfU=Math.min(.49,(co*f.width+si*f.height)*.5/Math.max(.01,widthAtV)+margin);
    const halfV=Math.min(.49,(si*f.width+co*f.height)*.5/Math.max(.01,heightAtU)+margin);
    f.u=clamp(f.u,halfU,1-halfU);f.v=clamp(f.v,halfV,1-halfV);
    if(!cornersFit(f)){
      const maxW=f.width,maxH=f.height;
      let lo=0,hi=1;
      for(let i=0;i<18;i++){
        const k=(lo+hi)*.5;
        const candidate={...f,width:maxW*k,height:maxH*k};
        if(cornersFit(candidate))lo=k;else hi=k;
      }
      f.width=Math.max(.01,maxW*lo);
      f.height=Math.max(.01,maxH*lo);
    }
    return f;
  }
  // Physical tile-space nudges, not arbitrary UV jumps: 0.10 tiles stays
  // the same distance whether the selected wall spans two or six tiles.
  // Authored furniture nudges outward by lengthening its support, whereas
  // windows/torches nudge their actual wall clearance.
  function nudgeFixture(face,raw,dHorizontal=0,dVertical=0,dOutward=0) {
    const f=normalize(raw);
    if(!validFace(face))return f;
    const horizontal=length(sub(point(face,1,f.v),point(face,0,f.v)));
    const vertical=length(sub(point(face,f.u,1),point(face,f.u,0)));
    f.u=clamp(f.u+finite(dHorizontal)/Math.max(horizontal,.001),0,1);
    f.v=clamp(f.v+finite(dVertical)/Math.max(vertical,.001),0,1);
    if(f.authoredFurnitureKey){
      const maxReach=clamp(finite(f.supportExtension?.maxOutset,6),0,6);
      f.bodyOutset=clamp(f.bodyOutset+finite(dOutward),0,maxReach);
    }else f.depth=clamp(f.depth+finite(dOutward),-.5,1.5);
    return fitToFace(face,f);
  }
  function projectToWall(face,frame,p) {
    const offset=sub(p,face.v[0]);
    return {u:dot(offset,frame.right),v:dot(offset,frame.up)};
  }
  function unprojectFromWall(face,frame,p) {
    return add(face.v[0],add(mul(frame.right,p.u),mul(frame.up,p.v)));
  }
  function intersectionsAtV(polygon,v) {
    const xs=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      if(Math.abs(a.v-b.v)<1e-10)continue;
      const t=(v-a.v)/(b.v-a.v);
      if(t>=-1e-8&&t<=1+1e-8)xs.push(a.u+t*(b.u-a.u));
    }
    return xs.length?{left:Math.min(...xs),right:Math.max(...xs)}:null;
  }
  // Partition by the rotated polygon's vertex heights, producing ONLY
  // non-overlapping quads (WallBuilder consumes quads, not arbitrary polygons).
  // Unlike an axis-aligned bounding cut, this leaves no empty corners around
  // diagonally rotated window frames.
  function cutFaces(source,fixtures) {
    const out=[],openingQuads=[];
    const windows=(fixtures||[]).map(normalize).filter(isWindow);
    for(const face of source||[]){
      if(!validFace(face)){out.push(face);continue;}
      const frame=faceFrame(face);
      if(!frame){out.push(face);continue;}
      // Operate on *physical wall-plane distances*. Bilinear UV coordinates
      // make gable widths shrink with height and turn diagonal cuts into
      // curved edges, producing wrong-size openings and overlapping bricks.
      const inPlane=p=>projectToWall(face,frame,p);
      const fromPlane=p=>unprojectFromWall(face,frame,p);
      let pieces=[{uv:face.v.map(inPlane)}];
      const openings=windows.filter(f=>String(f.faceId)===String(face.id));
      if(!openings.length){out.push(face);continue;}
      // Polygon difference: repeatedly subtract every convex aperture from
      // each current quad; strips split where a polygon reaches an extremum.
      for(const raw of openings){
        const f=fitToFace(face,raw),corners=paneCornersWorld(face,f),hole=corners.map(inPlane);
        if(hole.length<3)continue;
        const next=[];
        for(const piece of pieces){
          // Existing pieces remain convex quads; clip hole against each
          // piece's convex polygon before finding the exposed strips.
          const src=piece.uv;let clipped=hole.slice();
          const area=src.reduce((sum,p,i)=>sum+p.u*src[(i+1)%src.length].v-src[(i+1)%src.length].u*p.v,0);
          const sign=area>=0?1:-1;
          for(let i=0;i<src.length&&clipped.length;i++){
            const a=src[i],b=src[(i+1)%src.length];
            const crossEdge=p=>sign*((b.u-a.u)*(p.v-a.v)-(b.v-a.v)*(p.u-a.u));
            const old=clipped;clipped=[];
            for(let j=0;j<old.length;j++){
              const p=old[j],q=old[(j+1)%old.length];
              const dp=crossEdge(p),dq=crossEdge(q);
              if((dp>=-1e-8)!=(dq>=-1e-8)){
                const t=dp/(dp-dq);clipped.push({u:p.u+(q.u-p.u)*t,v:p.v+(q.v-p.v)*t});
              }
              if(dq>=-1e-8)clipped.push(q);
            }
          }
          if(clipped.length<3){next.push(piece);continue;}
          // For first-cut rectangles strip subdivision is exact. Subsequent
          // cuts on trapezoid pieces use the same vertical intersection rule,
          // accounting for the piece's own left/right boundaries.
          const stops=[...new Set([...src,...clipped].map(p=>+p.v.toFixed(9)))].sort((a,b)=>a-b);
          for(let i=0;i<stops.length-1;i++){
            const lo=stops[i],hi=stops[i+1];
            if(hi-lo<1e-7)continue;
            const edge=intersectionsAtV(src,(lo+hi)/2);
            if(!edge)continue;
            const at=(poly,v,side)=>{
              const list=intersectionsAtV(poly,v);
              return list?list[side]:null;
            };
            const leftLow=at(src,lo,'left'),leftHigh=at(src,hi,'left');
            const rightLow=at(src,lo,'right'),rightHigh=at(src,hi,'right');
            const holeMid=intersectionsAtV(clipped,(lo+hi)/2);
            if(!holeMid){
              next.push({uv:[{u:leftLow,v:lo},{u:leftHigh,v:hi},{u:rightHigh,v:hi},{u:rightLow,v:lo}]});
              continue;
            }
            const holeLeftLow=at(clipped,lo,'left'),holeLeftHigh=at(clipped,hi,'left');
            const holeRightLow=at(clipped,lo,'right'),holeRightHigh=at(clipped,hi,'right');
            if(Math.max(holeLeftLow-leftLow,holeLeftHigh-leftHigh)>1e-7)
              next.push({uv:[{u:leftLow,v:lo},{u:leftHigh,v:hi},{u:holeLeftHigh,v:hi},{u:holeLeftLow,v:lo}]});
            if(Math.max(rightLow-holeRightLow,rightHigh-holeRightHigh)>1e-7)
              next.push({uv:[{u:holeRightLow,v:lo},{u:holeRightHigh,v:hi},{u:rightHigh,v:hi},{u:rightLow,v:lo}]});
          }
        }
        pieces=next;
        // Exclusion polygon is a four-vertex rect in 3D even after wall
        // clipping. Bricks/logs also see the surviving split panel geometry.
        if(corners.length===4)openingQuads.push(corners);
      }
      if(!pieces.length)continue;
      pieces.forEach((piece,i)=>out.push({...face,id:String(face.id)+':fixture:'+i,
        sourceWallFaceId:face.id,v:piece.uv.map(fromPlane)}));
    }
    return {faces:out,openingQuads};
  }
  function resolveSupport(data,f) {
    const meta=f?.supportExtension || data?.wallOrnament?.extendableSupport;
    if(!meta||!['x','z'].includes(meta.axis)||!meta.partId)return null; // Wall support bars run horizontally.
    const part=data?.parts?.find?.(p=>p.id===meta.partId);
    const sourceLength=finite(part?.transform?.['s'+meta.axis],0);
    if(sourceLength<=.0001)return null;
    const attachedNormal=f?.authoredAttachmentNormal||data?.wallOrnament?.normal;
    // The declared stretched end must point TOWARD the wall, otherwise it
    // lengthens the free end and falsely appears attached.
    const component=finite(attachedNormal?.['xyz'.indexOf(meta.axis)],0);
    const end=meta.anchorEnd==='negative'?-1:1;
    if(Math.abs(component)<.9||Math.sign(component)!==end)return null;
    return {partId:meta.partId,axis:meta.axis,anchorEnd:meta.anchorEnd==='negative'?-1:1,
      sourceLength,maxOutset:clamp(finite(meta.maxOutset,6),0,6)};
  }
  // Move the intact furniture group away from the wall while stretching ONLY
  // the attachment beam, from its wall end, toward the relocated body.
  // The beam end is fixed in world space: its scaled length increases by d,
  // its center shifts toward the wall by d/2, and all other parts (including
  // boards, fabric, decals and animations) retain their own original sizes.
  function extendAuthoredSupport(model,data,fixture,sourceScale) {
    const spec=resolveSupport(data,fixture);
    if(!spec)return false;
    let support=model?.userData?.meshById?.get?.(spec.partId)||null;
    if(!support)model?.traverse?.(node=>{
      if(!support&&node.userData?.authoredPartId===spec.partId)support=node;
    });
    if(!support)return false;
    const axis=spec.axis,scale=Math.max(.001,finite(sourceScale?.['xyz'.indexOf(axis)],1));
    const outset=Math.min(clamp(finite(fixture?.bodyOutset,0),0,6),spec.maxOutset);
    const extension=outset/scale;
    if(!support.userData) support.userData={};
    if(!support.userData.wallSupportRest) {
      support.userData.wallSupportRest={position:finite(support.position?.[axis]),
        scale:finite(support.scale?.[axis],1)};
    }
    const rest=support.userData.wallSupportRest;
    support.scale[axis]=rest.scale*(spec.sourceLength+extension)/spec.sourceLength;
    support.position[axis]=rest.position+spec.anchorEnd*extension*.5;
    support.updateMatrix?.();
    support.userData.wallSupportOutset=outset;
    return true;
  }
  function createGroup(THREE,piece,transformPoint,options={}) {
    const root=new THREE.Group();root.name='HouseWallFixtures';
    const faces=new Map((piece?.base?.faces||[]).filter(validFace).map(face=>[String(face.id),face]));
    const toWorld=typeof transformPoint==='function'?transformPoint:p=>p;
    for (const raw of piece?.wallFixtures||[]) {
      const face=faces.get(String(raw?.faceId));
      if(!face)continue;
      const f=fitToFace(face,raw);
      const frameData=faceFrame(face,toWorld);
      if(!frameData)continue;
      const {right,up,outward}=frameData;
      const center=new THREE.Vector3().fromArray(toWorld(point(face,f.u,f.v)));
      const authoredMount=!!f.authoredFurnitureKey;
      const horizontalNormal=new THREE.Vector3(outward[0],0,outward[2]).normalize();
      center.addScaledVector(authoredMount?horizontalNormal:new THREE.Vector3(...outward),f.depth);
      if(!authoredMount&&f.orientation==='perpendicular'&&!isWindow(f))
        center.addScaledVector(new THREE.Vector3(...outward),f.width*.5);
      const mount=new THREE.Group();mount.name='WallFixture:'+f.id;mount.userData.wallFixtureId=f.id;
      mount.userData.wallFixtureBaseFrame={...frameData}; // Debugs world-space frame without console access.
      const basis=authoredMount
        // Unlike windows, hanging authored signs remain vertically level even
        // against the House Editor's tapered/frustum walls.
        ? new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...right).negate(),new THREE.Vector3(0,1,0),horizontalNormal)
        : new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...right).negate(),new THREE.Vector3(...up),new THREE.Vector3(...outward));
      mount.quaternion.setFromRotationMatrix(basis);
      mount.position.copy(center);
      if(!authoredMount&&f.orientation==='perpendicular'&&!isWindow(f))mount.rotateY(Math.PI/2);
      mount.rotateZ(f.rotationDeg*Math.PI/180); // Local plane spin; the aperture uses the same angle.
      const wood=new THREE.MeshLambertMaterial({color:0x705038,side:THREE.DoubleSide});
      const glass=new THREE.MeshLambertMaterial({color:0xb9d2db,side:THREE.DoubleSide,
        transparent:true,opacity:.88,depthWrite:false});
      const addBox=(x,y,z,w,h,d,material)=>{
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
        mesh.position.set(x,y,z);mesh.userData.wallFixtureId=f.id;
        mesh.castShadow=true;mesh.receiveShadow=true;mount.add(mesh);return mesh;
      };
      const w=f.width,h=f.height;
      if(authoredMount){
        // The existing authored JSON is the authority for geometry, decals,
        // wood textures and any animations. No second handmade sign definition.
        // The beam's +X face at [.5,1.376,0] must meet the wall anchor;
        // local +90° yaw points that attachment end into the front wall.
        const key=String(f.authoredFurnitureKey);
        const scale=(Array.isArray(f.authoredScale)?f.authoredScale:[1,1,1]).map(n=>Math.max(.001,finite(n,1)));
        const anchor=Array.isArray(f.authoredAnchor)?f.authoredAnchor:[.5,1.376,0];
        const holder=new THREE.Group();holder.name='AuthoredWallFurniture:'+key;
        const normal=Array.isArray(f.authoredAttachmentNormal)?f.authoredAttachmentNormal:[1,0,0];
        const yaw=Math.PI-Math.atan2(finite(normal[0],1),finite(normal[2],0));
        holder.rotation.y=yaw;holder.scale.set(...scale);
        const anchorScaled=new THREE.Vector3(
          finite(anchor[0]) * scale[0],finite(anchor[1]) * scale[1],finite(anchor[2]) * scale[2]);
        anchorScaled.applyAxisAngle(new THREE.Vector3(0,1,0),yaw);
        holder.position.copy(anchorScaled.multiplyScalar(-1));
        const baseHolderPosition=holder.position.clone();
        mount.add(holder);
        const supportMeta={key,bodyOutset:f.bodyOutset,extendable:false};
        mount.userData.wallSupport=supportMeta;
        const syncBodyOutset=(value)=>{
          const reach=clamp(finite(f.supportExtension?.maxOutset ??
            holder.userData.authoredData?.wallOrnament?.extendableSupport?.maxOutset,6),0,6);
          const d=clamp(finite(value,0),0,reach);
          f.bodyOutset=d;
          holder.position.copy(baseHolderPosition).add(new THREE.Vector3(0,0,d));
          supportMeta.bodyOutset=d;
          if(holder.userData.authoredModel&&holder.userData.authoredData){
            supportMeta.extendable=extendAuthoredSupport(holder.userData.authoredModel,
              holder.userData.authoredData,f,scale);
          } else if(holder.userData.fallbackBeam) {
            const beam=holder.userData.fallbackBeam;
            const span=1+d/scale[0];
            beam.scale.x=span;
            beam.position.x=d/(2*scale[0]);
            supportMeta.extendable=true;
          }
        };
        mount.userData.setBodyOutset=syncBodyOutset; // Inspector gizmo keeps the wall end fixed while dragging.
        syncBodyOutset(f.bodyOutset);
        const install=(model,data=null)=>{
          if(root.userData.disposed||!holder.parent||!model)return;
          holder.clear();holder.add(model);
          holder.userData.fallbackBeam=null;
          holder.userData.authoredModel=model;holder.userData.authoredData=data;
          model.traverse?.(node=>{ if(node.isMesh)node.userData.wallFixtureId=f.id; });
          syncBodyOutset(f.bodyOutset);
        };
        const authored=global.AuthoredFurniture;
        const cached=authored?.peek?.(key);
        if(cached&&authored?.buildGroup){
          install(authored.buildGroup(cached,0x765536),cached);
        }else if(authored?.load&&authored?.buildGroup){
          // Lightweight source geometry appears while the actual furniture
          // JSON is loading; runtime decals still run through the usual
          // AuthoredFurniture/FurnitureDecalRuntime construction chain.
          if(key==='generalStoreSign'||key==='innSign'){
            // Their shared authored beam + board dimensions make a truthful
            // temporary preview while the real furniture JSON loads.
            const stub=new THREE.Mesh(new THREE.BoxGeometry(.56,.95,.064),
              new THREE.MeshLambertMaterial({color:0x765536}));
            stub.position.set(-.06904,.776,0);holder.add(stub);
            const beam=new THREE.Mesh(new THREE.BoxGeometry(1,.112,.112),
              new THREE.MeshLambertMaterial({color:0x60452c}));
            beam.position.set(0,1.376,0);holder.add(beam);
            holder.userData.fallbackBeam=beam;
            syncBodyOutset(f.bodyOutset);
          }
          Promise.resolve(authored.load(key)).then(data=>{
            if(!data){mount.userData.authoredFurnitureError='Missing '+key;return;}
            install(authored.buildGroup(data,0x765536),data);
          }).catch(error=>{mount.userData.authoredFurnitureError=String(error?.message||error);});
        }else{
          // House Editor uses an isolated ES-module THREE; load the real
          // authored part dimensions for its selectable preview without
          // mixing incompatible renderer versions.
          const configBase=options.configBase||authoredConfigBase;
          if(configBase&&typeof fetch==='function'){
            fetch(configBase+key+'.json').then(res=>res.ok?res.json():null).then(data=>{
              if(!data?.parts||root.userData.disposed||!holder.parent)return;
              const preview=new THREE.Group();preview.name='AuthoredWallFurniturePreview:'+key;
              for(const part of data.parts){
                const t=part.transform||{};
                const color=part.color||'#765536';
                const size=[Math.max(.001,finite(t.sx,1)),Math.max(.001,finite(t.sy,1)),Math.max(.001,finite(t.sz,1))];
                const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshLambertMaterial({color}));
                mesh.name='authored_'+key+'_'+part.id;
                mesh.position.set(finite(t.x),finite(t.y),finite(t.z));
                mesh.rotation.set(finite(t.rx)*Math.PI/180,finite(t.ry)*Math.PI/180,finite(t.rz)*Math.PI/180);
                mesh.userData.wallFixtureId=f.id;
                mesh.userData.authoredPartId=part.id;
                preview.add(mesh);
              }
              install(preview,data);
              // Match the authored two-sided Tankan decals in the 3D House
              // Editor too; gameplay still uses FurnitureDecalRuntime as the
              // single authoritative sign/material renderer.
              const layout=global.TankanScriptLayout;
              const board=data.parts.find(part=>part.id==='hanging_sign_board')?.transform;
              if(board&&layout?.ensureFontLoaded&&Array.isArray(data.decals)){
                Promise.resolve(layout.ensureFontLoaded()).then(()=>{
                  if(root.userData.disposed||!holder.parent||!preview.parent)return;
                  for(const decal of data.decals){
                    if(decal.sourceType!=='tankanText'||!decal.tankanText)continue;
                    const opts={fontSizePx:128,
                      columnSpacingEm:finite(decal.tankanColumnSpacing,0),
                      glyphAdvanceEm:finite(decal.tankanGlyphAdvance,1),
                      glyphScaleX:finite(decal.tankanGlyphSizeX,1),
                      glyphScaleY:finite(decal.tankanGlyphSizeY,1),
                      paddingXEm:.8,paddingYEm:.28,color:decal.tankanColor||'#1b120d'};
                    const canvas=layout.createCanvas(decal.tankanText,opts).canvas;
                    if(!canvas)continue;
                    const texture=new THREE.CanvasTexture(canvas);
                    texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
                    const plane=new THREE.Mesh(
                      new THREE.PlaneGeometry(
                        finite(board.sx,.56)*finite(decal.width,.75),
                        finite(board.sy,.95)*finite(decal.height,.8)),
                      new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide,
                        depthWrite:false,opacity:finite(decal.opacity,.7)}));
                    const negative=String(decal.surfaceId||'').endsWith(':4');
                    plane.position.set(finite(board.x),finite(board.y),
                      (negative?-1:1)*(finite(board.sz,.064)*.5+.005));
                    plane.rotation.y=negative?Math.PI:0;
                    plane.name='authored_'+key+'_TankanText';
                    plane.userData.wallFixtureId=f.id;
                    preview.add(plane);
                  }
                }).catch(error=>{mount.userData.authoredDecalPreviewError=String(error?.message||error);});
              }
            }).catch(error=>{mount.userData.authoredFurnitureError=String(error?.message||error);});
          }
        }
      }else if(isWindow(f)){
        const pane=addBox(0,0,.01,w*.92,h*.9,.015,glass);
        pane.name='HouseStainedGlassPane';
        const t=Math.max(.035,Math.min(w,h)*.105);
        addBox(-w/2,0,.04,t,h,.09,wood);addBox(w/2,0,.04,t,h,.09,wood);
        addBox(0,h/2,.04,w,t,.09,wood);addBox(0,-h/2,.04,w,t,.09,wood);
        if(f.key==='crossbarWindow'){addBox(0,0,.055,t*.7,h,.075,wood);addBox(0,0,.055,w,t*.7,.075,wood);}
        if(f.key==='wideWindow'){addBox(-w/4,0,.055,t*.65,h,.075,wood);addBox(w/4,0,.055,t*.65,h,.075,wood);}
        if(f.pattern && global.FurniturePatternSurfaces?.renderTile){
          const record=global.FurniturePatternSurfaces.normalize(f.pattern);
          // Same compositor as Interior Editor; do not store pre-rendered canvas in piece JSON.
          const density=Math.min(256,1024/Math.max(w,h)); // Match Interior Editor's world-proportional atlas without stretching motifs.
          const size=[Math.max(16,Math.round(w*density)),Math.max(16,Math.round(h*density)),density/256];
          global.FurniturePatternSurfaces.renderTile(record,null,size)
            .then(canvas=>{
              if(root.userData.disposed||!pane.parent)return;
              const tex=new THREE.CanvasTexture(canvas);tex.needsUpdate=true;
              glass.map=tex;glass.color.set(0xffffff);glass.opacity=record.opacity;
              glass.needsUpdate=true;
            }).catch(error=>{mount.userData.patternError=String(error?.message||error);});
        }
      }else if(f.key==='sign'){
        addBox(0,0,.045,w,h,.095,wood);
        const faceMat=new THREE.MeshLambertMaterial({color:0xc8aa75,side:THREE.DoubleSide});
        addBox(0,0,.103,w*.89,h*.83,.008,faceMat);
      }else{
        const bracket=new THREE.MeshLambertMaterial({color:0x444448});
        const flame=new THREE.MeshBasicMaterial({color:0xffc766});
        addBox(0,-h*.08,.16,w*.34,h*.65,.09,wood);
        addBox(0,h*.25,.16,w*.55,h*.35,.14,flame);
        addBox(0,-h*.4,.09,w*.7,.06,.18,bracket);
      }
      if(options.previewSelectionId === f.id){
        const highlight=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w,h,.12)),
          new THREE.LineBasicMaterial({color:0xffdf72,depthTest:false}));
        highlight.renderOrder=20;mount.add(highlight);
      }
      root.add(mount);
    }
    return root;
  }
  global.HouseWallFixtures={version:1,PRESETS,isWindow,normalize,defaultPattern,validFace,
    point,faceSize,faceFrame,paneCornersUV,paneCornersWorld,fitToFace,cutFaces,
    resolveSupport,extendAuthoredSupport,nudgeFixture,createGroup};
})(window);

// Omgurku waist-to-neck connector: two five-point waistband splines,
 // sharing the Pants Rig Author's normalized spline contract. No second actor.
(function(global){
'use strict';
if(global.HobunjiOmgurkuConnector) return;
const ID='hobunji.omgurku-connector.v1';
const KEY='hobunji.omgurku.connector.v1';
const DOCS_ROOT=(() => {
 try { return new URL('../',document.currentScript?.src||new URL('js/',location.href)).href; }
 catch (_) { return new URL('../../',location.href).href; }
})();
const MAX_IMAGE_CHARS=2400000;
const TOP=[.32,.41,.50,.59,.68].map(x=>({x,y:.10}));
const BOTTOM=[.28,.39,.50,.61,.72].map(x=>({x,y:.90}));
const NECK=[.20,.25,.30,.35,.40].map((x,i)=>({x,y:[.32,.295,.28,.295,.32][i]}));
const DEFAULT={
 schema:ID, enabled:false, assetPath:'assets/portraitsprites/omgurku-connector.png',
 sourceTop:TOP, sourceBottom:BOTTOM, animalNeck:NECK, opacity:1
};
const clone=o=>JSON.parse(JSON.stringify(o));
const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,Number(n)||0));
const valid=points=>global.HobunjiPantsRig?.validateFivePointSpline?.(points)
  || (Array.isArray(points)&&points.length===5&&points.every(p=>
     Number.isFinite(+p.x)&&Number.isFinite(+p.y)&&+p.x>=0&&+p.x<=1&&+p.y>=0&&+p.y<=1));
function normalize(raw){
 const out={...clone(DEFAULT)};
 if(!raw||typeof raw!=='object')return out;
 out.enabled=raw.enabled===true;
 if(typeof raw.assetPath==='string' && /^assets\/[\w./-]+\.png$/.test(raw.assetPath) &&
    !raw.assetPath.includes('..')) out.assetPath=raw.assetPath;
 for(const field of ['sourceTop','sourceBottom','animalNeck']){
   if(valid(raw[field]))out[field]=raw[field].map(p=>({x:clamp(p.x),y:clamp(p.y)}));
 }
 if(Number.isFinite(Number(raw.opacity)))out.opacity=clamp(raw.opacity);
 // An uploaded PNG never enters a committed species JSON by accident.
 if(typeof raw.imageDataUrl==='string'&&raw.imageDataUrl.startsWith('data:image/png;base64,')
    &&raw.imageDataUrl.length<=MAX_IMAGE_CHARS)out.imageDataUrl=raw.imageDataUrl;
 return out;
}
let settings=normalize(null);
try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved)settings=normalize(saved);}catch(_){}
const live=new Set();
let revision=0;
function belt(){
 const chars=global.HOBUNJI_PANTS_RIGS?.characters||{};
 const found=chars['omgurku::male']?.portraitBeltSpline
       || chars['engh-sho::male']?.portraitBeltSpline;
 return valid(found)?found: [{x:.325,y:1},{x:.405,y:.99},{x:.485,y:.985},
     {x:.565,y:.99},{x:.645,y:1}];
}
function splineAt(points,t){
 const scaled=clamp(t)*4,index=Math.min(3,Math.floor(scaled)),f=scaled-index;
 const a=points[index],b=points[index+1];
 return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};
}
function sample3(points,t,target){
 const u=clamp(t)*4,i=Math.min(3,Math.floor(u)),f=u-i;
 target.copy(points[i]).lerp(points[i+1],f);
 return target;
}
function findPortraitPlane(group){
 let found=null;group.traverse?.(obj=>{
   if(!found && obj.name==='npc_avatar_front_plane')found=obj;
 });
 return found;
}
function findLower(group){
 const c=group.userData?.omgurkuComposite;
 return c?.lowerRefs?.[0]?.frontPlane||null;
}
function create(THREE,root){
 const c=root?.userData?.omgurkuComposite;
 if(!c)return null;
 const upperPlane=findPortraitPlane(c.upper),lowerPlane=findLower(root);
 if(!upperPlane||!lowerPlane)return null;
 const columns=24,rows=12,count=(columns+1)*(rows+1);
 const geometry=new THREE.BufferGeometry(),positions=new Float32Array(count*3);
 const uv=new Float32Array(count*2),indices=[];
 for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
   const i=row*(columns+1)+col;
   uv[2*i]=col/columns;
   uv[2*i+1]=1-row/rows;
 }
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
   const a=row*(columns+1)+col,b=a+1,d=a+columns+1,e=d+1;
   indices.push(a,d,b,b,d,e);
 }
 geometry.setIndex(indices);
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3)
   .setUsage(THREE.DynamicDrawUsage));
 geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
 const material=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide,
   depthTest:false,depthWrite:false,alphaTest:.002,opacity:settings.opacity});
 const mesh=new THREE.Mesh(geometry,material);
 mesh.name='Omgurku_WaistToNeckConnector';
 mesh.renderOrder=2.5;
 mesh.frustumCulled=false;
 root.add(mesh);
 const vec=()=>new THREE.Vector3();
 const targetsTop=Array.from({length:5},vec),targetsBottom=Array.from({length:5},vec);
 const tempTop=vec(),tempBottom=vec(),tempSourceTop=vec(),tempSourceBottom=vec();
 const local=vec(),lastState={key:'',rev:-1};
 let imageUrl=null,texture=null,disposed=false,loadEpoch=0;
 function applyImage(){
   const current=++loadEpoch;
   if(texture){material.map=null;material.needsUpdate=true;texture.dispose();texture=null;}
   const src=settings.imageDataUrl || (settings.enabled?
     new URL(settings.assetPath,DOCS_ROOT).href:null);
   if(!settings.enabled||!src){mesh.visible=false;return;}
   const loader=new THREE.TextureLoader();
   imageUrl=src;
   const next=loader.load(src,()=>{
     if(disposed||current!==loadEpoch){next.dispose();return;}
     next.colorSpace=THREE.SRGBColorSpace;
     next.magFilter=THREE.NearestFilter;
     next.minFilter=THREE.LinearFilter;
     material.map=next;material.needsUpdate=true;mesh.visible=true;
   },undefined,error=>{
     if(disposed||current!==loadEpoch)return;
     mesh.visible=false;
     console.warn('[omgurku-connector] PNG unavailable; connector stays hidden',error);
   });
   next.colorSpace=THREE.SRGBColorSpace;
   next.magFilter=THREE.NearestFilter;
   texture=next;
   mesh.visible=false; // Only render after successful image decode.
 }
 function localPoint(plane,p,result,depth,lower=false){
   const dims=plane.geometry?.parameters||{};
   // Weighted/skinned PNGPlaneAvatar geometry can lose PlaneGeometry
   // .parameters; resolve native dimensions from the authoritative avatar
   // metadata instead of silently degrading to an incorrect 1x1 plane.
   const w=Number(dims.width)||Number(lower?c.builtLowerWidth:c.upper.userData?.portraitModelWidth)||1;
   const h=Number(dims.height)||Number(lower?c.builtLowerHeight:c.upper.userData?.portraitModelHeight)||1;
   result.set((p.x-.5)*w,(.5-p.y)*h,depth);
   plane.localToWorld(result);
   root.worldToLocal(result);
   return result;
 }
 function update(force=false){
   if(disposed || !mesh.visible)return false;
   // One small 24×12 mesh, recomputed only when transforms or rigging change.
   const upper=c.upper,lower=c.lowerRefs[0].group;
   upper.updateWorldMatrix?.(true,true);
   lower.updateWorldMatrix?.(true,true);
   root.updateWorldMatrix?.(true,false);
   const key=[
     ...upper.matrixWorld.elements,
     ...lower.matrixWorld.elements,
     Number(upperPlane.position?.z)||0,
     Number(lowerPlane.position?.x)||0
   ].map(n=>Math.round(n*100000)/100000).join(',');
   if(!force && lastState.rev===revision &&lastState.key===key)return false;
   lastState.key=key;lastState.rev=revision;
   const b=belt();
   for(let i=0;i<5;i++){
     localPoint(upperPlane,b[i],targetsTop[i],.012,false);
     localPoint(lowerPlane,settings.animalNeck[i],targetsBottom[i],.012,true);
   }
   let offset=0,tex=geometry.attributes.uv.array;
   for(let j=0;j<=rows;j++){
     const t=j/rows;
     for(let i=0;i<=columns;i++){
       const x=i/columns;
       sample3(targetsTop,x,tempTop);
       sample3(targetsBottom,x,tempBottom);
       const sourceTop=splineAt(settings.sourceTop,x),
          sourceBottom=splineAt(settings.sourceBottom,x);
       local.copy(tempTop).lerp(tempBottom,t);
       positions[offset++]=local.x;positions[offset++]=local.y;positions[offset++]=local.z;
       const index=(j*(columns+1)+i)*2;
       // UV follows the two authored image splines, not the full rectangle;
       // five corresponding samples always land exactly on both endpoints.
       tex[index]=sourceTop.x+(sourceBottom.x-sourceTop.x)*t;
       tex[index+1]=1-(sourceTop.y+(sourceBottom.y-sourceTop.y)*t);
     }
   }
   geometry.attributes.position.needsUpdate=true;
   geometry.attributes.uv.needsUpdate=true;
   return true;
 }
 function dispose(){
   if(disposed)return;
   disposed=true;loadEpoch++;live.delete(handle);
   mesh.parent?.remove(mesh);geometry.dispose();material.dispose();texture?.dispose();
 }
 const handle={root,mesh,update,dispose,applyImage,targetsTop,targetsBottom};
 live.add(handle);applyImage();
 return handle;
}
function set(next,{persist=false}={}){
 const last=settings;
 settings=normalize(next);revision++;
 const newImage=last.enabled!==settings.enabled
   || last.assetPath!==settings.assetPath
   || last.imageDataUrl!==settings.imageDataUrl;
 for(const h of live){
   h.mesh.material.opacity=settings.opacity;
   if(newImage)h.applyImage();
   else h.update(true); // Dragged spline: geometry only, never re-decode PNG.
 }
 if(persist) localStorage.setItem(KEY,JSON.stringify(settings));
 return snapshot();
}
function snapshot({includeImage=false}={}){
 const out=clone(settings);
 if(!includeImage)delete out.imageDataUrl;
 return out;
}
function reset(){
 try{localStorage.removeItem(KEY);}catch(_){}
 return set(DEFAULT);
}
function updateAll(){for(const h of live)h.update();}
global.HobunjiOmgurkuConnector={
 schema:ID,storageKey:KEY,defaults:clone(DEFAULT),
 validateFivePointSpline:valid,normalize,belt,splineAt,
 create,set,snapshot,reset,updateAll,live,
};
})(window);
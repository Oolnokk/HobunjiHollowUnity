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
// The connector splines were authored against the basic pants sprite, so it
// stands in whenever the dedicated connector PNG is not shipped yet.
const FALLBACK_ASSET_PATH='assets/cosmetics/clothes/legs/pants_basic.png';
const missingAssets=new Set(); // Asset paths that already failed this session; later NPCs skip straight to the fallback.
const TOP=[.32,.41,.50,.59,.68].map(x=>({x,y:.10}));
const BOTTOM=[.28,.39,.50,.61,.72].map(x=>({x,y:.90}));
const FALLBACK_BELT=[{x:.325,y:1},{x:.405,y:.99},{x:.485,y:.985},
 {x:.565,y:.99},{x:.645,y:1}]; // Reused when no authored pants fit exists.
const NECK=[.20,.25,.30,.35,.40].map((x,i)=>({x,y:[.32,.295,.28,.295,.32][i]}));
const DEFAULT={
 schema:ID, enabled:false, assetPath:'assets/portraitsprites/omgurku-connector.png',
 sourceTop:TOP, sourceBottom:BOTTOM, animalNeck:NECK, riderWaist:null, opacity:1, upperInfluence:.65,
 shrinkwrapDirections:{sourceTop:90,sourceBottom:270,riderWaist:270,animalNeck:90}
};
const clone=o=>JSON.parse(JSON.stringify(o));
const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,Number(n)||0));
const valid=points=>Array.isArray(points)&&points.length===5&&points.every(p=>p && typeof p==='object') && (global.HobunjiPantsRig?.validateFivePointSpline?.(points)
  || (Array.isArray(points)&&points.length===5&&points.every(p=>
     p && Number.isFinite(+p.x)&&Number.isFinite(+p.y)&&+p.x>=0&&+p.x<=1&&+p.y>=0&&+p.y<=1)));
function normalize(raw){
 const out={...clone(DEFAULT)};
 if(!raw||typeof raw!=='object')return out;
 out.enabled=raw.enabled===true;
 if(typeof raw.assetPath==='string' && /^assets\/[\w./-]+\.png$/.test(raw.assetPath) &&
    !raw.assetPath.includes('..')) out.assetPath=raw.assetPath;
 for(const field of ['sourceTop','sourceBottom','animalNeck']){
   if(valid(raw[field]))out[field]=raw[field].map(p=>({x:clamp(p.x),y:clamp(p.y)}));
 }
 if(valid(raw.riderWaist))out.riderWaist=raw.riderWaist.map(p=>({x:clamp(p.x),y:clamp(p.y)}));
 for(const field of Object.keys(out.shrinkwrapDirections)){
   const angle=raw.shrinkwrapDirections?.[field]; // Direction arrows travel with saved/exported rigs.
   if(angle!=null && Number.isFinite(Number(angle)))out.shrinkwrapDirections[field]=((Number(angle)%360)+360)%360;
 }
 if(raw.upperInfluence!=null && Number.isFinite(Number(raw.upperInfluence)))out.upperInfluence=clamp(raw.upperInfluence);
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
 return valid(found)?found:FALLBACK_BELT;
}
function splineAt(points,t,target={}){
 const scaled=clamp(t)*4,index=Math.min(3,Math.floor(scaled)),f=scaled-index;
 const a=points[index],b=points[index+1];
 target.x=a.x+(b.x-a.x)*f;target.y=a.y+(b.y-a.y)*f;
 return target;
}
function deformationFraction(t,influence=settings.upperInfluence){
 const u=clamp(t),weight=Number.isFinite(Number(influence))?clamp(influence):.65; // Larger weights keep more of the bridge under upper-body control.
 return Math.pow(u,Math.pow(4,2*(weight-.5)));
}
function sample3(points,t,target){
 const u=clamp(t)*4,i=Math.min(3,Math.floor(u)),f=u-i;
 target.copy(points[i]).lerp(points[i+1],f);
 return target;
}
function findPortraitPlane(group){
 if(group.userData?.neckRig?.skinnedPlane)return group.userData.neckRig.skinnedPlane;
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
 const attachmentRows=2,collar=attachmentRows/rows,middleSpan=1-2*collar; // Both contact sections lie exactly in their attached sprite planes.
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
 const material=global.HobunjiSpritePngSurface.makeMaterial(THREE,null,
   'omgurku_connector_material',{side:THREE.DoubleSide,opacity:settings.opacity,
     polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}); // Shared PNG depth and cutout rules.
 const mesh=new THREE.Mesh(geometry,material);
 mesh.name='Omgurku_WaistToNeckConnector';
 mesh.renderOrder=2.5;
 mesh.frustumCulled=false;
 root.add(mesh);
 const vec=()=>new THREE.Vector3();
 const targetsTop=Array.from({length:5},vec),targetsBottom=Array.from({length:5},vec);
 const tangentTop=vec(),tangentBottom=vec(),curveTop=vec(),curveBottom=vec(); // Cached Hermite bridge endpoints and planar end tangents.
 const normalTop=vec(),normalBottom=vec(); // Surface normals in this avatar's local frame.
 const topNormalMatrix=new THREE.Matrix3(),bottomNormalMatrix=new THREE.Matrix3(); // Correct normals under nonuniform scaling.
 const tempTop=vec(),tempBottom=vec(); // Reused interpolation endpoints.
 const local=vec(),lastState={rev:-1}; // Last mesh-space transforms avoid per-frame string construction.
 const upperMatrix=new THREE.Matrix4(),lowerMatrix=new THREE.Matrix4(); // Geometry depends on relative transforms only.
 const sourceTop={x:0,y:0},sourceBottom={x:0,y:0}; // Reuse source spline samples during deformation.
 const previousUpper=new THREE.Matrix4(),previousLower=new THREE.Matrix4(); // Compare without serializing matrices.
 let texture=null,disposed=false,loadEpoch=0; // Own pending and decoded PNG lifetimes.
 const tintStatus={color:c.tintColor,ready:false,error:null}; // Mobile diagnostics for this actor's decoded/tinted connector.
 function applyImage(){
   const current=++loadEpoch; // Ignore PNG decodes completed after replacement or disposal.
   if(texture){material.map=null;material.needsUpdate=true;texture.dispose();texture=null;}
   mesh.visible=false;tintStatus.ready=false;tintStatus.error=null;
   const assetPath=missingAssets.has(settings.assetPath)?FALLBACK_ASSET_PATH:settings.assetPath;
   const src=settings.imageDataUrl || (settings.enabled?
     new URL(assetPath,DOCS_ROOT).href:null);
   if(!settings.enabled||!src)return;
   tintStatus.source=settings.imageDataUrl?'uploaded':assetPath; // Mobile diagnostics show which PNG the connector is using.
   const image=new Image(); // Decode CPU pixels once per image change, never during spline deformation.
   image.crossOrigin='anonymous';
   const fail=error=>{
     if(disposed||current!==loadEpoch)return;
     mesh.visible=false;tintStatus.error=String(error?.message||error);
     console.warn('[omgurku-connector] PNG unavailable; connector stays hidden',error);
   };
   image.onload=()=>{
     if(disposed||current!==loadEpoch)return;
     try{
       const renderer=global.CreatureGeneticsRender; // The lower coat owns source-key selection and shade-fill math.
       global.VoorgAssRegistration?.ensureRendererSpecies?.(renderer?.SPECIES);
       const donor=renderer?.SPECIES?.['voorg-ass']; // Same authored base color contract as the lower half.
       if(!donor||!renderer.recolorKeyedPixels)throw new Error('Connector coat tint renderer unavailable');
       const canvas=document.createElement('canvas'); // Native-resolution surface preserves the uploaded PNG's alpha and detail.
       canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
       const ctx=canvas.getContext('2d',{willReadFrequently:true}); // Pixel readback occurs only on image load.
       ctx.drawImage(image,0,0);
       const pixels=ctx.getImageData(0,0,canvas.width,canvas.height); // Classify the untouched source before recoloring.
       renderer.recolorKeyedPixels(pixels.data,renderer.hexToRgb(c.tintColor),{
         hex:donor.baseRecolorKeyHex,hueTolerance:donor.baseRecolorHueTolerance,
         minSaturationRatio:donor.baseRecolorMinSaturationRatio,
       },donor.baseShadeReferenceHex,'omgurku-connector:body-A');
       ctx.putImageData(pixels,0,0);
       texture=global.HobunjiSpritePngSurface.makeCanvasTexture(THREE,canvas,'omgurku_connector_png');
       material.map=texture;material.needsUpdate=true;mesh.visible=true;tintStatus.ready=true;
       update(true); // Fit before the first visible render after decode.
     }catch(error){fail(error);}
   };
   image.onerror=()=>{
     if(!settings.imageDataUrl && assetPath!==FALLBACK_ASSET_PATH && !disposed && current===loadEpoch){
       missingAssets.add(assetPath);
       applyImage(); // Retry once with the basic pants sprite the splines were authored on.
       return;
     }
     fail(new Error('Connector PNG failed to load'));
   };
   image.src=src;
 }
 function localPoint(plane,p,result,depth,lower=false){
   const dims=plane.geometry?.parameters||{};
   // Weighted/skinned PNGPlaneAvatar geometry can lose PlaneGeometry
   // .parameters; resolve native dimensions from the authoritative avatar
   // metadata instead of silently degrading to an incorrect 1x1 plane.
   const w=Number(dims.width)||Number(lower?c.builtLowerWidth:c.upper.userData?.portraitModelWidth)||1;
   const h=Number(dims.height)||Number(lower?c.builtLowerHeight:c.upper.userData?.portraitModelHeight)||1;
   const u=!lower&&lastState.flipped?1-p.x:p.x; // Waist landmarks are authored against raw pixels, before portrait UV mirroring.
   result.set((u-.5)*w,(.5-p.y)*h,depth);
   result.applyMatrix4(lower?lowerMatrix:upperMatrix);
   return result;
 }
 function relativeMatrix(plane,target){
   target.identity();
   for(let node=plane;node && node!==root;node=node.parent){
     if(node.matrixAutoUpdate)node.updateMatrix();
     target.premultiply(node.matrix);
   }
 }
 function update(force=false){
   if(disposed || !mesh.visible)return false;
   // One small 24×12 mesh, recomputed only when transforms or rigging change.
   relativeMatrix(upperPlane,upperMatrix);
   relativeMatrix(lowerPlane,lowerMatrix);
   const flipped=global.PNGPlaneAvatar?.getPortraitsFlipped?.()===true; // Mirror changes affect seam positions even when all object transforms are unchanged.
   if(!force && lastState.rev===revision && lastState.flipped===flipped && previousUpper.equals(upperMatrix)
      && previousLower.equals(lowerMatrix))return false;
   previousUpper.copy(upperMatrix);previousLower.copy(lowerMatrix);
   lastState.rev=revision;lastState.flipped=flipped;
   const b=settings.riderWaist||belt();
   normalTop.set(0,0,1).applyNormalMatrix(topNormalMatrix.getNormalMatrix(upperMatrix));
   normalBottom.set(0,0,1).applyNormalMatrix(bottomNormalMatrix.getNormalMatrix(lowerMatrix));
   for(let i=0;i<5;i++){
     localPoint(upperPlane,b[flipped?4-i:i],targetsTop[i],0,false); // Reverse mirrored traversal so the upper/lower strips retain matching winding.
     localPoint(lowerPlane,settings.animalNeck[i],targetsBottom[i],0,true);
   }
   let offset=0,tex=geometry.attributes.uv.array;
   for(let i=0;i<=columns;i++){
       const x=i/columns;
       sample3(targetsTop,x,tempTop);
       sample3(targetsBottom,x,tempBottom);
       tangentTop.copy(tempBottom).sub(tempTop);
       tangentBottom.copy(tangentTop);
       tangentTop.addScaledVector(normalTop,-tangentTop.dot(normalTop));
       tangentBottom.addScaledVector(normalBottom,-tangentBottom.dot(normalBottom));
       curveTop.copy(tempTop).addScaledVector(tangentTop,collar);
       curveBottom.copy(tempBottom).addScaledVector(tangentBottom,-collar);
       splineAt(settings.sourceTop,x,sourceTop);
       splineAt(settings.sourceBottom,x,sourceBottom);
       for(let j=0;j<=rows;j++){
       const t=j/rows; // Interpolate every row between this column's fixed seams.
       if(j<=attachmentRows)local.copy(tempTop).addScaledVector(tangentTop,t);
       else if(j>=rows-attachmentRows)local.copy(tempBottom).addScaledVector(tangentBottom,t-1);
       else{
         const u=deformationFraction((t-collar)/middleSpan),u2=u*u,u3=u2*u; // Smoothly join the two flat contact sections.
         local.copy(curveTop).multiplyScalar(2*u3-3*u2+1)
           .addScaledVector(tangentTop,(u3-2*u2+u)*middleSpan)
           .addScaledVector(curveBottom,-2*u3+3*u2)
           .addScaledVector(tangentBottom,(u3-u2)*middleSpan);
       }
       offset=(j*(columns+1)+i)*3;
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
 const handle={root,mesh,update,dispose,applyImage,tintStatus,targetsTop,targetsBottom,attachmentRows};
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
 const {imageDataUrl,...rig}=settings; // Keep multi-MB PNG bytes out of rig snapshots and drag-time JSON clones.
 const out=clone(rig);
 if(includeImage && imageDataUrl)out.imageDataUrl=imageDataUrl;
 return out;
}
function reset(){
 try{localStorage.removeItem(KEY);}catch(_){}
 return set(DEFAULT);
}
function updateAll(){for(const h of live)h.update();}
global.HobunjiOmgurkuConnector={
 schema:ID,storageKey:KEY,defaults:clone(DEFAULT),fallbackAssetPath:FALLBACK_ASSET_PATH,
 validateFivePointSpline:valid,normalize,belt,splineAt,deformationFraction,
 create,set,snapshot,reset,updateAll,live,
};
})(window);
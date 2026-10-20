// Restored feature set from the user-supplied Omgurku Assembly Lab V10.
// The model and upper portrait are obtained from the gameplay hybrid renderer;
// this workbench owns only preview equipment, motion and painted art buffers.
(() => {
'use strict';
const $=id=>document.getElementById(id);
const api=()=>window.HobunjiOmgurkuCalibration;
const ctx=()=>api()?.context?.()||{};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const toRad=d=>d*Math.PI/180;
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const poseKeys=['x','y','z','pitch','yaw','bodyYaw','roll'], mirrored=new Set(['x','yaw','bodyYaw','roll']);
const WEAPONS={
  hatchet:{label:'Hatchet',sprite:'toolsprites/axe_hatchet.png',style:'sweep',idleClass:'heavy'},
  pickshovel:{label:'Pick-Shovel',sprite:'toolsprites/shovel_pickshovel.png',style:'thrust',idleClass:'light'},
  fishingspear:{label:'Fishing Spear',sprite:'toolsprites/harpoon_fishingspear.png',style:'sweep',idleClass:'light'},
  fishingmace:{label:'Fishing Mace',sprite:'toolsprites/harpoon_fishingmace.png',style:'sweep',idleClass:'light'},
  plainsSword:{label:'Plains-Sword',sprite:'toolsprites/plains-sword.png',style:'sweep',idleClass:'heavy'},
  dagger:{label:'Dagger',sprite:'toolsprites/dagger.png',style:'thrust',idleClass:'light'},
  kylie:{label:'Kylie',sprite:'toolsprites/kylie.png',style:'sweep',idleClass:'heavy'},
};
const SWEEP={neutral:{x:0,y:0,z:0,pitch:0,yaw:0,roll:0,bodyYaw:0},
 windup:{x:0,y:0,z:0,pitch:0,yaw:-42,roll:0,bodyYaw:-90},
 strike:{x:0,y:0,z:0,pitch:0,yaw:20,roll:0,bodyYaw:120}};
const state={
  model:null,upper:null,base:null,holder:null,plane:null,texture:null,visual:null,
  attackValues:null,stances:null,attack:null,queue:[],queueDelay:0,
  moving:false,position:{x:0,z:0},target:{x:0,z:0},rawYaw:0,gaitClock:0,
  mask:null,maskImage:null,maskMode:false,painting:false,maskRefs:[],spriteWidth:0,spriteHeight:0,
  lastMaskAt:0,log:[],setupImport:null,
};
function note(text,bad=false){
  state.log.unshift((new Date()).toLocaleTimeString()+' '+(bad?'ERROR ':'')+text);
  state.log.length=Math.min(40,state.log.length);
  $('v10Log').textContent=state.log.join('\n');
}
function live(){const c=ctx(),model=c.model;return model?.userData?.omgurkuComposite?{...c,model,composite:model.userData.omgurkuComposite}:null;}
function syncDeadzones(){
  const v=live();if(!v)return;
  const animal=Number($('v10AnimalDead').value),rider=Number($('v10RiderDead').value);
  $('v10AnimalDeadValue').textContent=animal+'°';$('v10RiderDeadValue').textContent=rider+'°';
  window.HobunjiOmgurkuSpecies?.setPreviewDeadzones?.(v.model,{animal,rider});
}
function selectedWeapon(){return WEAPONS[$('v10Weapon').value]||WEAPONS.hatchet;}
function steps(){const combo=state.attackValues?.combo||{};return selectedWeapon().style==='thrust'?(combo.pokeCombo||[]):(combo.swingCombo||[]);}
function stanceKey(){const v=$('v10Stance').value;return v!=='auto'?v:(selectedWeapon().idleClass==='light'?'lightWeapon':'heavyWeapon');}
function pose(raw={},fallback={}){
 const out={};for(const key of poseKeys){const n=Number(raw[key]);out[key]=Number.isFinite(n)?n:Number(fallback[key])||0;}return out;
}
function idle(){
 const key=stanceKey();
 const fallback=key==='lightWeapon'?{x:.04,y:0,z:0,pitch:20,yaw:-70,bodyYaw:-40,roll:-65}
 :{x:.03,y:.37,z:-.01,pitch:-155,yaw:-79,bodyYaw:-15,roll:-82};
 return pose(state.stances?.stances?.[key],fallback);
}
function mirrorPose(p,sign){const out={};for(const key of poseKeys)out[key]=mirrored.has(key)?p[key]*sign:p[key];return out;}
function lerpPose(a,b,k){const out={};for(const key of poseKeys)out[key]=(a[key]||0)+((b[key]||0)-(a[key]||0))*clamp(k,0,1);return out;}
function endpoints(style,step){
 const power=Number.isFinite(Number(step.power))?Number(step.power):1;
 const heavy=stanceKey()==='heavyWeapon',
   sign=style==='sweep'&&Number(step.dirSign)===-1?-1:1;
 let windup,strike;
 if(style==='sweep'){
   windup=lerpPose(SWEEP.neutral,pose(SWEEP.windup),power);
   strike=lerpPose(SWEEP.neutral,pose(SWEEP.strike),power);
 }else{
   windup=pose({x:0,y:0,z:-.4*power,pitch:10.31,yaw:0,bodyYaw:-45*power,roll:0});
   strike=pose({x:-.23*power,y:0,z:.32*power,pitch:1,yaw:-45*power,bodyYaw:46*power,roll:0});
 }
 // V10 mirrors X/yaw/bodyYaw/roll, including opposite handedness of the
 // returning Heavy Neutral pose, while preserving authored attack endpoints.
 const base=idle();
 return {neutral:mirrorPose(base,heavy?sign:1),
   windup:mirrorPose(windup,sign),strike:mirrorPose(strike,sign),
   returning:mirrorPose(base,heavy?-sign:1)};
}
function populate(){
 $('v10Attack').replaceChildren();
 steps().forEach((step,i)=>{
   const o=document.createElement('option');o.value=String(i);o.textContent=(i+1)+'. '+(step.name||'Attack');$('v10Attack').append(o);
 });
 info();
}
function info(){
 const step=steps()[Number($('v10Attack').value)||0];
 $('v10AttackInfo').textContent=step?selectedWeapon().label+' / '+(step.name||'Attack')
  +' — '+stanceKey()+' — windup '+(Number(step.windupS)||.2).toFixed(2)
  +'s, strike '+(Number(step.strikeS)||.08).toFixed(2)
  +'s, return '+(Number(step.returnS)||.2).toFixed(2)
  +'s; lunge '+((Number(step.lungeMul)||0)*(Number(state.attackValues?.combo?.LUNGE_SCALE)||1.5)).toFixed(2)
  +' tiles. The whole Omgurku lunges; torso body-yaw is independent from the animal.'
  :'The current weapon has no authored attack sequence.';
}
function quaternionFrom(p,THREE){
 const a=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),toRad(p.yaw||0));
 const b=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),toRad(p.pitch||0));
 const c=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),toRad(p.roll||0));
 return a.multiply(b).multiply(c);
}
function applyPose(p,neutralWeight=1){
 const v=live();if(!v||!state.holder)return;
 state.holder.position.set(p.x||0,p.y||0,p.z||0);
 state.holder.quaternion.copy(quaternionFrom(p,v.THREE));
 if(state.plane){
   state.plane.rotation.x=-Math.PI/2;
   state.plane.rotation.z=selectedWeapon().style==='sweep'?
     -Math.PI/2+Math.PI/2*clamp(neutralWeight,0,1):0;
 }
 v.model.userData.omgurkuPreviewAttackBodyYaw=toRad(p.bodyYaw||0);
 window.ProceduralHandFrameDriver?.syncNow?.();
}
function cleanupWeapon(){
 const v=live();if(v?.model){
   v.model.userData.proceduralHandToolHolder=null;
   v.model.userData.proceduralHandToolKey=null;
   v.model.userData.omgurkuPreviewAttackBodyYaw=0;
 }
 state.base?.parent?.remove(state.base);
 state.plane?.geometry?.dispose?.();state.plane?.material?.dispose?.();state.texture?.dispose?.();
 state.base=state.holder=state.plane=state.texture=state.visual=null;
}
async function weapon(){
 const v=live();if(!v)return;
 cleanupWeapon();
 const THREE=v.THREE,def=selectedWeapon();
 const base=new THREE.Group(),holder=new THREE.Group(),visual=new THREE.Group();
 base.name='Omgurku_V10_HandAttachToolBase';holder.name='Omgurku_V10_ToolHolder';
 base.add(holder);holder.add(visual);v.composite.upper.add(base);
 holder.userData.omgurkuV10Sweep = def.style === 'sweep';
 base.position.set(Number(v.composite.upper.userData?.handAttachX)||-.45,
   Number(v.composite.upper.userData?.handAttachY)||.4,0);
 const image=new Image();image.crossOrigin='anonymous';
 const url=new URL('../../assets/'+def.sprite,location.href).href;
 await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Missing '+url));image.src=url;});
 if(!base.parent)return;
 const texture=new THREE.Texture(image);texture.needsUpdate=true;texture.colorSpace=THREE.SRGBColorSpace;
 texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;
 const plane=new THREE.Mesh(
   new THREE.PlaneGeometry(.5,.5*image.naturalHeight/Math.max(1,image.naturalWidth)),
   new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.001,side:THREE.DoubleSide,depthTest:false,depthWrite:false})
 );
 plane.renderOrder=110;plane.frustumCulled=false;plane.name='Omgurku_V10_WeaponPlane';
 visual.add(plane);visual.userData.toolPlane=plane;
 const grips=window.HobunjiHandToolGrips;
 const gripKey=grips?.toolKeyFor?.($('v10Weapon').value)||$('v10Weapon').value;
 const scale=Number(grips?.toolScaleForTool?.(gripKey))||1;
 const primary=grips?.authoredPrimaryGripForTool?.(gripKey)||{};
 const inverse=quaternionFrom(primary.rotationDeg||{},THREE).invert();
 const gp=primary.position||{};
 visual.position.set(-(Number(gp.x)||0)*scale,-(Number(gp.y)||0)*scale,-(Number(gp.z)||0)*scale).applyQuaternion(inverse);
 visual.quaternion.copy(inverse);visual.scale.setScalar(scale);
 state.base=base;state.holder=holder;state.plane=plane;state.texture=texture;state.visual=visual;
 v.model.userData.proceduralHandToolHolder=holder;v.model.userData.proceduralHandToolKey=gripKey;
 applyPose(idle());
 note('Authored '+def.label+' equipped; hands use shared tool-grip frames.');
}
function start(step=steps()[Number($('v10Attack').value)||0],queued=[]){
 if(!step)return;
 state.attack={step,phase:'windup',time:0,prepared:endpoints(selectedWeapon().style,step),
  windup:Math.max(.001,Number(step.windupS)||.2),strike:Math.max(.001,Number(step.strikeS)||.08),
  returning:Math.max(.16,Number(step.returnS)||.2),
  distance:(Number(step.lungeMul)||0)*(Number(state.attackValues?.combo?.LUNGE_SCALE)||1.5),
  startYaw:state.rawYaw||0,lunge:0};
 state.queue=queued.slice();state.queueDelay=0;
 note('Attack '+(step.name||'strike')+' started.');
}
function stop(){
 state.attack=null;state.queue=[];state.queueDelay=0;
 const v=live();if(v){v.model.position.set(state.position.x,0,state.position.z);applyPose(idle());}
 $('v10AttackBtn').classList.remove('active');
}
function updateAttack(dt){
 const a=state.attack;
 if(!a){
   if(state.queueDelay>0){
     state.queueDelay-=dt*Number($('v10Speed').value);
     if(state.queueDelay<=0&&state.queue.length)start(state.queue.shift(),state.queue);
   }
   return {x:0,z:0};
 }
 a.time+=dt*Number($('v10Speed').value);
 const end=a.windup+a.strike,full=end+a.returning;
 let out,weight;
 if(a.time<=a.windup){a.phase='windup';const t=smooth(a.time/a.windup);out=lerpPose(a.prepared.neutral,a.prepared.windup,t);weight=1-t;}
 else if(a.time<=end){a.phase='strike';out=lerpPose(a.prepared.windup,a.prepared.strike,smooth((a.time-a.windup)/a.strike));weight=0;}
 else {a.phase='return';const t=smooth((a.time-end)/a.returning);out=lerpPose(a.prepared.strike,a.prepared.returning,t);weight=t;}
 applyPose(out,weight);
 a.lunge=a.time<=end?a.distance*smooth(a.time/end):a.distance*(1-smooth((a.time-end)/a.returning));
 const offset={x:Math.sin(a.startYaw)*a.lunge,z:Math.cos(a.startYaw)*a.lunge};
 if(a.time>=full){
   const next=state.queue.slice(),loop=$('v10Loop').checked&&next.length===0;
   state.attack=null;applyPose(idle());
   if(next.length){state.queue=next;state.queueDelay=.1;}
   else if(loop){state.queue=[steps()[Number($('v10Attack').value)||0]];state.queueDelay=.3;}
   else state.queue=[];
   return {x:0,z:0};
 }
 return offset;
}
function chooseTarget(){
 const a=Math.random()*Math.PI*2,r=1.5+Math.random()*2.7;
 state.target.x=Math.cos(a)*r;state.target.z=Math.sin(a)*r;
}
function movementChanged(moving){
 state.moving=!!moving;state.gaitClock=0;
 if(state.moving){chooseTarget();note('V10 random waypoint movement started.');}
 else{
   state.position={x:0,z:0};state.rawYaw=0;
   stop();note('V10 random movement reset.');
 }
}
function tick(dt){
 const v=live();if(!v)return;
 // Original V10 CREATURE_GAIT_HZ=6 with two run frames: 12 sprite
 // transitions per second, preview-only and never another animal AI.
 state.gaitClock+=dt;
 const frame=state.moving?'run'+(1+(Math.floor(state.gaitClock*12)%2)):'idle';
 window.HobunjiOmgurkuSpecies?.setPreviewFrame?.(v.model,frame);
 if(state.moving){
   const dx=state.target.x-state.position.x,dz=state.target.z-state.position.z;
   const distance=Math.hypot(dx,dz);
   if(distance<.12)chooseTarget();
   else{
     const travel=Math.min(distance,1.2*dt),nx=dx/distance,nz=dz/distance;
     state.position.x+=nx*travel;state.position.z+=nz*travel;
     state.rawYaw=-Math.atan2(nz,nx)+Math.PI/2;
     window.HobunjiOmgurkuSpecies?.setPreviewFacing?.(v.model,state.rawYaw);
   }
 }
 const lunge=updateAttack(dt);
 v.model.position.set(state.position.x+lunge.x,0,state.position.z+lunge.z);
}
function maskDimensions(){
 const image=ctx().image,w=image?.naturalWidth||image?.width||1375,h=image?.naturalHeight||image?.height||600;
 return {w,h};
}
function ensureMask(){
 const {w,h}=maskDimensions();
 if(state.mask&&state.mask.width===w&&state.mask.height===h)return;
 state.mask=document.createElement('canvas');state.mask.width=w;state.mask.height=h;
 state.spriteWidth=w;state.spriteHeight=h;
 note('V10 shared mask allocated: '+w+' x '+h+'.');
}
function renderMaskOverlay(){
 const canvas=$('v10MaskEdit'),c=canvas.getContext('2d'),b=ctx().spriteBounds,mask=state.mask;
 c.clearRect(0,0,canvas.width,canvas.height);
 if(!mask||!b)return;
 c.save();c.globalAlpha=.35;
 c.drawImage(mask,b.left,b.top,b.w,b.h);
 c.globalCompositeOperation='source-atop';c.fillStyle='#ff5088';c.fillRect(b.left,b.top,b.w,b.h);
 c.restore();
}
function setMaskMode(active){
 state.maskMode=active;
 $('v10MaskEdit').style.display=active?'block':'none';
 $('v10EraseMode').classList.toggle('good',active);
 $('v10SaddleMode').classList.toggle('good',!active);
 renderMaskOverlay();
}
function paint(ev){
 const canvas=$('v10MaskEdit'),b=ctx().spriteBounds;
 if(!state.mask||!b)return;
 const box=canvas.getBoundingClientRect();
 const xp=(ev.clientX-box.left)/box.width*canvas.width,yp=(ev.clientY-box.top)/box.height*canvas.height;
 const x=clamp((xp-b.left)/b.w,0,1)*state.mask.width;
 const y=clamp((yp-b.top)/b.h,0,1)*state.mask.height;
 const m=state.mask.getContext('2d');
 m.fillStyle='#fff';m.beginPath();m.arc(x,y,Number($('v10Brush').value)/2,0,Math.PI*2);m.fill();
 renderMaskOverlay();
}
function disposeMaskTextures(){
 for(const e of state.maskRefs){
   if(e.ref?.frontPlane?.material?.map===e.front)e.ref.frontPlane.material.map=e.originalFront;
   if(e.ref?.backPlane?.material?.map===e.back)e.ref.backPlane.material.map=e.originalBack;
   e.front.dispose();e.back.dispose();
 }
 state.maskRefs.length=0;
}
function applyMaskToPreview(){
 disposeMaskTextures();
 const v=live();if(!v||!state.mask)return;
 // Only on stroke completion: 3 static CanvasTexture pairs, never rebuilt in
 // the animation loop. Recolor remains sourced from the canonical renderer.
 for(const ref of v.composite.lowerRefs){
   const originalFront=ref.frontPlane.material.map,originalBack=ref.backPlane.material.map;
   const img=originalFront?.image;
   if(!img?.width && !img?.naturalWidth)continue;
   const canvas=document.createElement('canvas');
   canvas.width=img.width||img.naturalWidth;canvas.height=img.height||img.naturalHeight;
   const c=canvas.getContext('2d');c.drawImage(img,0,0,canvas.width,canvas.height);
   c.globalCompositeOperation='destination-out';c.drawImage(state.mask,0,0,canvas.width,canvas.height);c.globalCompositeOperation='source-over';
   const THREE=v.THREE,front=new THREE.CanvasTexture(canvas),back=new THREE.CanvasTexture(canvas);
   front.colorSpace=back.colorSpace=THREE.SRGBColorSpace;
   back.wrapS=THREE.RepeatWrapping;back.repeat.set(-1,1);back.offset.set(1,0);
   ref.frontPlane.material.map=front;ref.backPlane.material.map=back;
   ref.frontPlane.material.needsUpdate=ref.backPlane.material.needsUpdate=true;
   state.maskRefs.push({ref,front,back,originalFront,originalBack});
 }
 note('Hidden-pixel mask applied to all '+state.maskRefs.length+' lower frames.');
}
async function maskImageDataUrl(dataUrl){
 if(!dataUrl)return;
 ensureMask();
 const image=new Image();
 await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=dataUrl;});
 const c=state.mask.getContext('2d');c.clearRect(0,0,state.mask.width,state.mask.height);
 c.drawImage(image,0,0,state.mask.width,state.mask.height);
 applyMaskToPreview();renderMaskOverlay();
}
function downloadBlob(bytes,name,type='application/json'){
 const b=new Blob([bytes],{type});const url=URL.createObjectURL(b),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setup(){
 ensureMask();
 const placement=ctx().placement||{};
 return {
  schema:'hobunji_omgurku_garwolf_setup.v1',
  purpose:'Original V10-compatible hidden-pixel mask and saddle geometry; Omgurku headless lower frames.',
  source:{repository:'Oolnokk/HobunjiHollowUnity',creatureKind:'omgurku-lower',
    creatureFrameBasis:'idle',frameWidthPx:state.mask.width,frameHeightPx:state.mask.height,
    maskAppliesToFrames:['idle','run1','run2']},
  mask:{format:'png-data-url',widthPx:state.mask.width,heightPx:state.mask.height,
    pngDataUrl:state.mask.toDataURL('image/png')},
  saddle:{u:placement.saddleU,v:placement.saddleV,pixelX:placement.saddleU*state.mask.width,
    pixelY:placement.saddleV*state.mask.height,coordinateConvention:'normalized from top-left'},
  join:{joinDepth:placement.joinDepth,riderScale:placement.riderScale},
  creaturePlacement:{modelWidth:placement.lowerWidth,modelHeight:placement.lowerHeight,
    largeScale:{x:placement.lowerScaleX,y:placement.lowerScaleY},
    authoredGroundLift:placement.authoredGroundLift,
    previewVisibleFloorCorrection:placement.visibleFloorCorrection},
  deadzones:{animal:Number($('v10AnimalDead').value),rider:Number($('v10RiderDead').value)},
  notes:{riderPortraitCropping:'none',proceduralLegAnimation:'omitted',
    weaponTransformSpace:'npc-portrait-local',originalCreature:'gar-wolf'},
 };
}
async function exportMaskedFrames(){
 ensureMask();
 for(const frame of ['idle','run1','run2']){
   const img=new Image();img.crossOrigin='anonymous';
   const url=new URL('../../assets/creaturesprites/omgurku-lower_'+frame+'.png',location.href).href;
   try{
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const c=canvas.getContext('2d');c.drawImage(img,0,0);
    c.globalCompositeOperation='destination-out';c.drawImage(state.mask,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(blob)downloadBlob(blob,'omgurku-lower_'+frame+'.png','image/png');
   }catch(e){note('Failed to export '+frame+': '+e.message,true);}
 }
 note('Exported original-palette lower frames with the shared mask. Add them to the authored assets to affect other players.');
}
async function importSetup(file){
 if(!file)return;
 try{
  const data=JSON.parse(await file.text());
  if(data.mask?.pngDataUrl)await maskImageDataUrl(data.mask.pngDataUrl);
  if(data.deadzones){
   if(Number.isFinite(Number(data.deadzones.animal)))$('v10AnimalDead').value=data.deadzones.animal;
   if(Number.isFinite(Number(data.deadzones.rider)))$('v10RiderDead').value=data.deadzones.rider;
   syncDeadzones();
  }
  const p={};
  if(data.saddle){p.saddleU=Number(data.saddle.u);p.saddleV=Number(data.saddle.v);}
  if(data.join){p.joinDepth=Number(data.join.joinDepth);p.riderScale=Number(data.join.riderScale);}
  if(data.creaturePlacement){
   p.lowerWidth=Number(data.creaturePlacement.modelWidth);p.lowerHeight=Number(data.creaturePlacement.modelHeight);
   p.visibleFloorCorrection=Number(data.creaturePlacement.previewVisibleFloorCorrection);
   if(data.creaturePlacement.largeScale){
     p.lowerScaleX=Number(data.creaturePlacement.largeScale.x);
     p.lowerScaleY=Number(data.creaturePlacement.largeScale.y);
   }
   if(data.creaturePlacement.authoredGroundLift!==undefined)
     p.authoredGroundLift=Number(data.creaturePlacement.authoredGroundLift);
  }
  const clean=Object.fromEntries(Object.entries(p).filter(([,v])=>Number.isFinite(v)));
  if(Object.keys(clean).length)api().setPlacement(clean);
  note('Imported V10 setup: '+file.name+'.');
 }catch(e){note('Failed to import V10 setup: '+e.message,true);}
}
async function loadRepositoryData(){
 try{
  const [a,b]=await Promise.all([
   fetch('../../config/combat/attack-values.json').then(r=>{if(!r.ok)throw Error('attacks HTTP '+r.status);return r.json();}),
   fetch('../../config/combat/weapon-idle-stances.json').then(r=>{if(!r.ok)throw Error('stances HTTP '+r.status);return r.json();}),
  ]);
  state.attackValues=a;state.stances=b;populate();note('Loaded original repository authored attack combos and stance transforms.');
 }catch(e){note('Could not load authored combat data: '+e.message,true);}
}
async function previewReady(){
 const v=live();if(!v)return;
 disposeMaskTextures();cleanupWeapon();
 state.model=v.model;state.upper=v.composite.upper;
 ensureMask();syncDeadzones();
 if(state.attackValues)await weapon();
 renderMaskOverlay();
}
function bind(){
 $('v10Weapon').addEventListener('change',async()=>{stop();populate();try{await weapon();}catch(e){note(e.message,true);}});
 $('v10Stance').addEventListener('change',()=>{if(!state.attack)applyPose(idle());info();});
 $('v10Attack').addEventListener('change',info);
 $('v10AttackBtn').addEventListener('click',()=>start());
 $('v10Combo').addEventListener('click',()=>{const arr=steps();if(arr.length)start(arr[0],arr.slice(1));});
 $('v10Stop').addEventListener('click',stop);
 $('v10Speed').addEventListener('input',()=>$('v10SpeedValue').textContent=Number($('v10Speed').value).toFixed(2)+'×');
 for(const n of ['Animal','Rider'])$('v10'+n+'Dead').addEventListener('input',syncDeadzones);
 $('v10SaddleMode').addEventListener('click',()=>setMaskMode(false));
 $('v10EraseMode').addEventListener('click',()=>setMaskMode(true));
 $('v10ResetMask').addEventListener('click',()=>{
  ensureMask();state.mask.getContext('2d').clearRect(0,0,state.mask.width,state.mask.height);
  disposeMaskTextures();renderMaskOverlay();note('Mask cleared (all lower pixels visible).');
 });
 $('v10Brush').addEventListener('input',()=>$('v10BrushValue').textContent=$('v10Brush').value+' px');
 const canvas=$('v10MaskEdit');
 canvas.addEventListener('pointerdown',e=>{if(!state.maskMode)return;state.painting=true;canvas.setPointerCapture(e.pointerId);paint(e);});
 canvas.addEventListener('pointermove',e=>{if(state.painting)paint(e);});
 const end=()=>{if(!state.painting)return;state.painting=false;applyMaskToPreview();};
 canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
 $('v10DownloadSetup').addEventListener('click',()=>downloadBlob(JSON.stringify(setup(),null,2),'omgurku-v10-setup.json'));
 $('v10CopySetup').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(setup(),null,2));note('Copied V10 setup JSON.');}catch(e){note(e.message,true);}});
 $('v10ExportFrames').addEventListener('click',exportMaskedFrames);
 $('v10ImportSetup').addEventListener('click',()=>$('v10ImportFile').click());
 $('v10ImportFile').addEventListener('change',e=>{importSetup(e.target.files?.[0]);e.target.value='';});
 $('v10ReloadDatabase').addEventListener('click',async()=>{
  try{
   const url=$('v10NpcDbPath').value.trim();
   const r=await fetch(new URL('../../'+url.replace(/^docs\//,''),location.href));
   if(!r.ok)throw Error('HTTP '+r.status);
   const db=await r.json();
   const records=Array.isArray(db)?db:(db.npcs||db.records||db.characters||db.entries||[]);
   if(!Array.isArray(records))throw Error('NPC DB needs an array');
   const sel=$('npcSelect');sel.replaceChildren();
   const option=document.createElement('option');option.value='';option.textContent='Generated Omgurku (NPC-only)';sel.append(option);
   const v=ctx();const npcs=v.npcs;
   if(npcs) {npcs.splice(0,npcs.length,...records);}
   records.forEach((rec,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=rec.name||rec.id||'NPC '+i;sel.append(o);});
   note('Reloaded '+records.length+' NPCs from '+url);
  }catch(e){note('NPC database reload: '+e.message,true);}
 });
 $('v10CopyDebug').addEventListener('click',()=>navigator.clipboard.writeText($('diagnostics').textContent+'\n'+$('v10Log').textContent));
}
window.HobunjiOmgurkuAdvanced={
 tick,movementChanged,previewReady,
 snapshot:()=>({maskPixels:state.mask?.width*state.mask?.height||0,maskMode:state.maskMode,
   weapon:$('v10Weapon').value,attack:state.attack?.phase||'idle',
   previewModel:!!state.model,maskFrameCount:state.maskRefs.length,
   requestedDeadzone:[Number($('v10AnimalDead').value),Number($('v10RiderDead').value)]})
};
bind();loadRepositoryData();
if(live())previewReady();
})();
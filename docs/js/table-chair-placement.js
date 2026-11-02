(() => {
'use strict';
// Shared table-relative chair geometry for player placement and authored maps.
const finite=(v,f)=>Number.isFinite(Number(v))?Number(v):f;
function normalize(d){
 if(!d||typeof d!=='object')return null;
 const distance=Math.max(0,Math.min(4,finite(d.distance,.65)));
 if(d.mode==='orbit')return{mode:'orbit',angleDeg:((finite(d.angleDeg,0)%360)+360)%360,distance};
 if(d.mode==='edge'&&['front','back','left','right'].includes(d.side))return{mode:'edge',side:d.side,along:Math.max(0,Math.min(1,finite(d.along,.5))),distance};
 return null;
}
function localPosition(descriptor,width,depth){
 const d=normalize(descriptor);if(!d)return null;
 if(d.mode==='orbit'){const a=d.angleDeg*Math.PI/180,r=Math.max(width,depth)/2+d.distance;return{x:Math.sin(a)*r,z:Math.cos(a)*r};}
 const x=(d.along-.5)*width,z=(d.along-.5)*depth;
 return d.side==='front'?{x,z:depth/2+d.distance}:d.side==='back'?{x,z:-depth/2-d.distance}:d.side==='right'?{x:width/2+d.distance,z}:{x:-width/2-d.distance,z};
}
function apply(chair,table,d,footprint={}){
 if(!chair||!table||!window.THREE?.Vector3)return false;
 const p=localPosition(d,Math.max(.1,finite(footprint.width,1)),Math.max(.1,finite(footprint.depth,1)));if(!p)return false;
 table.updateWorldMatrix?.(true,false);
 const target=table.localToWorld(new window.THREE.Vector3(p.x,0,p.z)),center=table.getWorldPosition(new window.THREE.Vector3());
 const currentWorld=chair.getWorldPosition?chair.getWorldPosition(new window.THREE.Vector3()):chair.position;
 target.y=currentWorld.y;
 const parent=chair.parent;
 let localTarget=target,localCenter=center;
 if(parent?.worldToLocal){parent.updateWorldMatrix?.(true,false);localTarget=parent.worldToLocal(target.clone());localCenter=parent.worldToLocal(center.clone());}
 chair.position.set(localTarget.x,localTarget.y,localTarget.z);
 chair.rotation.y=Math.atan2(localCenter.x-localTarget.x,localCenter.z-localTarget.z);
 chair.updateWorldMatrix?.(true,false);return true;
}
function refreshArea(area,entries){
 const byId=new Map(Array.from(entries||[],e=>[String(e.id),e]));let count=0;
 for(const e of byId.values()){const d=normalize(e.record?.tableAttachment),t=byId.get(String(e.record?.tableId));
  if(d&&t?.root?.parent&&e.root?.parent&&t!==e&&apply(e.root,t.root,d,{width:t.def?.fw||1,depth:t.def?.fd||1})){window.HobunjiFurnitureTableAttachmentMoved?.(e.record);count++;}
 }return count;
}
window.TableChairPlacement=Object.freeze({normalize,localPosition,apply,refreshArea});
})();

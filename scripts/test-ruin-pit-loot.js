'use strict';
const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../docs/js/creature-death.js'),'utf8');
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const map='map_i_dev_random_ruin',corpses=new Set(),grid=Array.from({length:5},()=>Array.from({length:6},()=>({})));
let lower=false,playerX=32,playerY=160,retired=0,disposed=0;
class Group {constructor(){this.children=[];this.userData={};this.position={set:(x,y,z)=>{this.xyz=[x,y,z]}};}add(o){this.children.push(o);o.parent=this;}remove(o){this.children=this.children.filter(x=>x!==o);o.parent=null;}}
class Sprite {constructor(material){this.material=material;this.userData={};this.center={set(){}};this.scale={set(){}};}}
const scene=new Group();
const w={DynamicSurfaces:{pointInPit:x=>x>=3&&x<4,sampleSupport:(x,z,o)=>{if(x>=3&&x<4)return lower&&o.maxY>=-2&&!(o.minY>-2)?{y:-2}:null;return x>=0&&x<6&&z>=0&&z<5?{y:0}:null;}},DevRandomRuin:{getPlayerGroundSupportY:()=>0,shaftBodyBlocksAtFeet:x=>x>=4},ResourceRings:{disposeRingHud(){}},DevRandomRuinLichThemes:{plasmTileCenters:()=>[{x:2.5,z:2.5,y:0}]}};
w.THREE={Group,Sprite,TextureLoader:class{load(path){assert(path.endsWith('pouch.png'),'authored seed pouch');return {dispose(){disposed++}}}},SpriteMaterial:class{dispose(){disposed++}}};
new Function('window',source)(w);
w.CreatureDeath.init({TILE:64,COLS:6,ROWS:5,clamp:(v,a,b)=>Math.max(a,Math.min(v,b)),getCurrentArea:()=>map,getGrid:()=>grid,getPlayer:()=>({x:playerX,y:playerY}),canOccupyAt:()=>true,corpseObjects:corpses,getDefaultScene:()=>scene,disposeCreaturePresentation:c=>{retired++;scene.remove(c.avatarRef.group);c.avatarRef.dispose()}});
const c={id:'test',areaId:map,x:224,y:160,shaftSupportY:0,health:0};
lower=true;assert(!w.CreatureDeath.preparePitLoot(c),'lower platform survived');
lower=false;assert(w.CreatureDeath.preparePitLoot(c),'fatal pit found');
const oldGroup=new Group();scene.add(oldGroup);c.avatarRef={group:oldGroup,dispose(){}};
assert(c._pitLootRest.col===2&&c._pitLootRest.row!==2,'nearest connected safe tile excludes plasm');
assert(w.CreatureDeath.begin(c,c.x,c.y)&&corpses.has(c)&&c.state==='corpse','normal corpse registry');
assert(retired===1&&c.avatarRef.isCorpseMarker&&c.avatarRef.isPitLootBag&&!scene.children.includes(oldGroup),'bag retires original rig and is not retired again');
assert(c.avatarRef.group.xyz[1]===0.02,'bag is placed on the true support');
let calls=0;const obj=w.CreatureDeath.decorateLootBag(c,{getButtons:()=>[{action:'obj_loot_corpse',label:'old'}],onAction:()=>{calls++;corpses.delete(c);return {ok:true}}});
assert(obj.getButtons()[0].label==='Loot bag','bag prompt');assert(obj.onAction('obj_loot_corpse').ok,'collect');assert(!obj.onAction('obj_loot_corpse').ok&&calls===1,'no repeated loot');
assert(!w.CreatureDeath.preparePitLoot({areaId:map,x:160,y:160,shaftSupportY:0}),'ordinary ground unchanged');
c.avatarRef.dispose();c.avatarRef.dispose();assert(disposed===2,'sprite material and texture disposed exactly once');
playerX=160;playerY=160;const onPlasm={id:'plasm-start',areaId:map,x:224,y:160,shaftSupportY:0};
assert(w.CreatureDeath.preparePitLoot(onPlasm)&&onPlasm._pitLootRest.row!==2,'player on plasm can recover to a safe adjacent tile');
console.log('ruin pit loot: passed');

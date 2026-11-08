#!/usr/bin/env node
'use strict';
// Focused regression: source-specific shadows, through-stone V50 ladder registration, and browser load order.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Shadows=require('../docs/js/ruin-light-occlusion.js');
const read=path=>fs.readFileSync(path,'utf8');

const source={x:0,y:2,z:0};
const block={min:{x:1,y:0,z:-.45},max:{x:1.8,y:4,z:.45}};
const project=(x,y,z)=>({x:x*100,y:z*100});
const shadow=Shadows.shadowPolygon(block,source,5,project);
assert(shadow,'a masonry pillar within the torch radius should cast a projected shadow');
assert.equal(shadow.polygon.length,4);
assert(shadow.polygon.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
assert(shadow.polygon[1].x>shadow.polygon[0].x,'the ray should extend behind the blocker');
assert.equal(Shadows.shadowPolygon(block,{x:1.3,y:2,z:0},5,project),null,
  'a torch attached to a wall must not block its own light');
assert.equal(Shadows.shadowPolygon(block,{x:-10,y:2,z:0},5,project),null,
  'distant solids must not affect a torch outside their reach');
assert.equal(Shadows.shadowPolygon({min:{x:1,y:5,z:-1},max:{x:2,y:6,z:1}},source,5,project),null,
  'a solid entirely above the flame must not cast a floor shadow');

let draws=0,saves=0,restores=0,clips=0,paths=0;
const ctx={save(){saves++;},restore(){restores++;},beginPath(){paths++;},
  rect(){},moveTo(){},lineTo(){},closePath(){},clip(rule){assert.equal(rule,'evenodd');clips++;}};
const answer=Shadows.withClip(ctx,[shadow.polygon,shadow.polygon],()=>{draws++;return 'painted';});
assert.equal(answer,'painted');
assert.equal(draws,1,'the light is painted exactly once, even with multiple occluders');
assert.equal(clips,2,'each blocker must exclude light independently; overlapping shadows may not cancel');
assert.equal(saves,1);assert.equal(restores,1);
Shadows.withClip(ctx,[],()=>{draws++;});
assert.equal(draws,2);assert.equal(saves,1);

const node={
  isMesh:true,isInstancedMesh:false,visible:true,name:'obelisk-f0-A-stone',
  material:{visible:true,transparent:false},parent:{},
  getWorldPosition(v){v.x=1.3;v.y=2;v.z=0;return v;},
  updateWorldMatrix(){},testBounds:block,
};
const scene={traverse(fn){fn(node);}};
class Box{setFromObject(n){this.min=n.testBounds.min;this.max=n.testBounds.max;return this;}isEmpty(){return false;}}
class Vec{constructor(){this.x=0;this.y=0;this.z=0;}}
const bounds=Shadows.projectedShadows({scene,source,radiusTiles:5,project,THREE:{Box3:Box,Vector3:Vec},now:1000});
assert.equal(bounds.length,1,'active shaft stone is discovered without trying to illuminate the whole scene');
const offsetNode={...node,name:'ruin-corridor-wall',getWorldPosition(v){v.x=9999;v.y=2;v.z=9999;return v;}};
assert.equal(Shadows.projectedShadows({scene:{traverse(fn){fn(offsetNode);}},source,
  radiusTiles:5,project,THREE:{Box3:Box,Vector3:Vec},now:1100}).length,1,
  'masonry with geometry offset from its mesh origin must still cast shadows');

const climb=read('docs/js/climb-surfaces.js');
const reach=read('docs/js/ruin-reaching-obelisks.js');
const sense=read('docs/js/perception-mode.js');
const fog=read('docs/js/cloud-forest-fog.js');
const furnitureMask=fog.split('function drawFurnitureLightMasksCompat(')[1]?.split('const ruinFireMaskStats')[0]||'';
const ruinMask=fog.split('function drawRuinTraditionLightMasks(')[1]?.split('const ruinGlowProjection')[0]||'';
assert.equal((furnitureMask.match(/withRuinShadowClip\(ctx,shadows,/g)||[]).length,3,
  'the furniture torch reveal, weather-tint and colored-glow passes must all cast the same shadows');
assert.equal((ruinMask.match(/withRuinShadowClip\(ctx,shadows,/g)||[]).length,2,
  'special ruin fire needs shadow-aware darkness reveal AND shadow-aware colored glow');
const index=read('docs/index.html');
assert(climb.includes('ladder.rotation.y=-Math.PI/2')&&climb.includes('ladder.position.set(width/2,height,.006)'),
  'V50 ladder width/depth axes must rotate 90° to sit flush on the real wall face');
assert(climb.includes('buildRuinLadderMarks(THREE,surface)')&&climb.includes('ruinLadderRuneGlow = true'),
  'climbing pillars have depth-tested, glowing rune boundaries');
assert(reach.includes('senseTargets')&&reach.includes('liveLadderGroups.delete(group)'),
  'sense targets must track live physical ladders and unregister on disposal');
assert(sense.includes('shaftLadders: window.RuinReachingObelisks?.senseTargets?.(scene)'),
  'sense mode must render the ladders, not the solid pillar');
assert(fog.includes('withRuinShadowClip(ctx,shadows')&&fog.includes('ruinShadowPolygons(light,light.radius)'),
  'every special-ruin fire mask, including tower sconces, uses per-light shadows');
assert(fog.includes('node.userData?.ruinLadderRuneGlow'),
  'the darkness overlay must leave the ladder edge glyphs luminous');
assert(index.indexOf('js/ruin-light-occlusion.js')<index.indexOf('js/cloud-forest-fog.js'),
  'the occlusion helper must load before the compositor');
console.log('ruin light occlusion / ladder sense regression PASS');

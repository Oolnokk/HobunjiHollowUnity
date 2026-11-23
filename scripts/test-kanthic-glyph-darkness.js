'use strict';
// node scripts/test-kanthic-glyph-darkness.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const original=fs.readFileSync('docs/js/cloud-forest-fog.js','utf8'); // The test instruments the production compositor rather than recreating it.
const fog=original.replace('  function ordinaryBuildingInterior(area) {',
  '  window.__probeGlyphMasks=(scene,deps,now=2000)=>{lightingDeps=deps;drawRuinPatternGlowMasks(scene,now);return {...ruinGlowStats};};\n  function ordinaryBuildingInterior(area) {');
assert.notEqual(fog,original,'test hook must be inserted into the production source');
new vm.Script(fog,{filename:'cloud-forest-fog.js'});

class Vec {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  applyMatrix4(){return this;} // The identity world matrix makes texture-to-screen expectations exact.
  setFromMatrixColumn(){return this.set(1,0,0);}
  sub(v){return this.set(this.x-v.x,this.y-v.y,this.z-v.z);}
  dot(v){return this.x*v.x+this.y*v.y+this.z*v.z;}
}
let tradition='kanthic'; // Switches between the new precise Kanthic rule and the unchanged Hronal rule.
const win={THREE:{Vector3:Vec},WeatherFX:{init(){}},DevRandomRuinLichThemes:{activeTheme:()=>tradition}};
vm.runInNewContext(fog,{window:win,performance:{now:()=>2000},console});
const draws=[]; // All light-mask paints are recorded for assertions and mobile-neutral regression coverage.
const context={
  canvas:{width:500,height:500},globalCompositeOperation:'source-over',globalAlpha:1,
  save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},arc(){},fill(){draws.push({kind:'fill',mode:this.globalCompositeOperation});},
  transform(...args){draws.push({kind:'transform',args});},
  drawImage(img){draws.push({kind:'image',mode:this.globalCompositeOperation,alpha:this.globalAlpha,img});},
  createRadialGradient(){draws.push({kind:'gradient'});return {addColorStop(){}};},
};
const camera={matrixWorld:{},near:0.01,far:100,
  getWorldPosition(v){return v.set(-20,0,0);},
  getWorldDirection(v){return v.set(1,0,0);}};
const deps={lctx:context,camera,getCurrentArea:()=> 'map_i_dev_random_ruin',getPlayerWorldY:()=>0,
  getThreeRect:()=>({width:500,height:500}),worldToOverlay:(x,y,z)=>({x:100+x*10,y:100+z*10})};
const image={width:16,height:16}; // Engraving atlas coverage is what the compositor must use, not a radial gradient.
const positions={array:new Float32Array([1,1,1, 3,1,1, 1,1,3]),count:3};
const uvs={array:new Float32Array([0,1, 1,1, 0,0]),count:3};
const geometry={boundingSphere:{center:new Vec(1.5,1,1.5),radius:2},
  getAttribute(name){return name==='position'?positions:name==='uv'?uvs:null;}};
const mesh={name:'engraving-glyph-glow',isMesh:true,visible:true,userData:{},
  matrixWorld:{getMaxScaleOnAxis:()=>1},geometry,
  material:{visible:true,opacity:.8,map:{image,flipY:true}},
  updateWorldMatrix(){},getWorldPosition(v){return v.set(1.5,1,1.5);}};
const scene={traverse(cb){cb(mesh);}};mesh.parent=scene;
function draw(){draws.length=0;return win.__probeGlyphMasks(scene,deps);}
const lit=draw();
assert.equal(lit.found,1,'real additive engraving layer is discovered');
assert.equal(lit.drawn,1,'engraving gets a visible darkness exemption');
assert.equal(lit.triangles,1,'three screen-projected glyph vertices form one alpha mask triangle');
assert.equal(draws.filter(d=>d.kind==='image').length,1,'texture alpha is the sole Kanthic darkness mask');
assert.equal(draws.find(d=>d.kind==='image').mode,'destination-out','atlas alpha clears only the engraved pixels');
assert.equal(draws.find(d=>d.kind==='image').alpha,.8,'authored emissive intensity controls the exemption strength');
assert(!draws.some(d=>d.kind==='gradient'||d.kind==='fill'),'Kanthic glyphs create no radial reveal or colored light halo');
const transform=draws.find(d=>d.kind==='transform').args;
assert(Math.abs(transform[0]-1.25)<1e-6&&Math.abs(transform[3]-1.25)<1e-6,
  'UV atlas scales to the actual triangle in screen pixels');
assert(Math.abs(transform[4]-110)<1e-6&&Math.abs(transform[5]-110)<1e-6,
  'cutout is positioned on the wall glyph, not around its center');
mesh.visible=false;
assert.equal(draw().drawn,0,'hidden wall sections must not cut through darkness');
mesh.visible=true;
mesh.material.map.image=null;
assert.equal(draw().drawn,0,'unloaded or disposed atlases make no fake light');
mesh.material.map.image=image;
positions.array[0]=-30;positions.array[3]=-30;positions.array[6]=-30;
assert.equal(draw().drawn,0,'engraving behind the camera cannot project a giant mask');
positions.array[0]=1;positions.array[3]=3;positions.array[6]=1;
tradition='hronal'; // Non-Kanthic traditions preserve their existing soft atmospheric engraving glow.
assert.equal(draw().drawn,1,'other traditions still display wall patterns');
assert(draws.some(d=>d.kind==='gradient'),'Hronal retains the prior soft engraved-glow treatment');
assert(!draws.some(d=>d.kind==='image'),'the Kanthic-only correction does not change Hronal engraving rendering');
console.log('Kanthic glyph-only darkness, no wall wash, UV projection, hidden surfaces, near plane, and other ruins: PASS');

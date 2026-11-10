'use strict';
// Regression checks for the shared Puzzle Cave plate art and manual melody presentation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

async function main(){
  const requests=[]; // Verifies both cave types take the exact authored furniture material path.
  const textCalls=[]; // Ensures the tankan script/font helper renders the intended word only once.
  let resolveFont; // Delayed font resolves after disposal, exercising stale scene ownership.
  const fontReady=new Promise(resolve=>{resolveFont=resolve;});
  let fontsLoaded=false; // Gates tests so canvas lettering never renders before the real font is ready.
  const layout={
    ensureFontLoaded:async()=>{await fontReady;fontsLoaded=true;return true;},
    createRingCanvas:(text,options)=>{
      assert(fontsLoaded,'Tankan canvas must wait for the font');
      textCalls.push({text,options});return {canvas:{width:128,height:512}};
    },
  };
  class Geometry {
    constructor(w,h){this.width=w;this.height=h;this.disposed=false;}
    dispose(){this.disposed=true;}
  }
  class Material {
    constructor(props={}){Object.assign(this,props);this.disposed=false;}
    dispose(){this.disposed=true;}
  }
  class Mesh {
    constructor(geometry,material){
      this.geometry=geometry;this.material=material;this.children=[];
      this.rotation={x:0};this.position={y:0};this.userData={};this.visible=true;
    }
    add(child){child.parent=this;this.children.push(child);}
    remove(child){this.children=this.children.filter(c=>c!==child);child.parent=null;}
  }
  class CanvasTexture{
    constructor(canvas){this.image=canvas;this.needsUpdate=false;}
  }
  const THREE={Mesh,PlaneGeometry:Geometry,MeshBasicMaterial:Material,CanvasTexture,
    DoubleSide:2,SRGBColorSpace:'srgb'};
  const window={
    THREE,
    FurnitureDecalRuntime:{ensureTankanLayout:()=>Promise.resolve(layout)},
    ProceduralFurniture:{makePartMaterial:(part)=>{
      requests.push(part);return new Material({color:0x8a8171,map:{filename:part.materialTexture}});
    }},
    __farmLog:()=>{},
  };
  vm.runInNewContext(read('docs/js/puzzle-cave-plate-art.js'),{window,Promise,console});
  const art=window.PuzzleCavePlateArt;
  assert.equal(art.INSCRIPTION,"hao'uun");
  const small=new Mesh(new Geometry(.46,.09),new Material());
  const large=new Mesh(new Geometry(.46,.15),new Material());
  const a=art.decorate(THREE,small,{radius:.46,thickness:.09});
  const b=art.decorate(THREE,large,{radius:.46,thickness:.15,toward:{x:1,z:0}});
  assert(a&&b);
  assert.equal(small.children[0].rotation.order,'YXZ','Tankan surface normal must stay upward after yaw');
  assert.equal(small.children[0].rotation.z,Math.PI,'text must face away from the approaching player');
  assert(Math.abs(large.children[0].rotation.y-Math.PI/2)<1e-10,
    'an eastward doorway must turn the writing a full quarter-turn, not a diagonal');
  assert.deepEqual(requests.map(p=>p.materialTexture),['carved_smooth.png','carved_smooth.png']);
  assert.equal(small.userData.puzzleCaveTankanText,"hao'uun");
  assert.equal(large.userData.puzzleCavePlateTexture,'carved_smooth.png');
  assert.equal(small.children[0].visible,false,'unloaded lettering must not render as a blank rectangle');
  b.dispose(); // Leave the cave before the asynchronous shared font finishes loading.
  resolveFont();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(textCalls.length,1,'all cave plates should share one Tankan raster');
  assert.equal(textCalls[0].text,"hao'uun");
  assert.equal(textCalls[0].options.radiusScale,.68,'inscription uses the circular Tankan layout');
  assert.equal(small.userData.puzzleCaveTankanLayout,'ring','the pressure plate exposes its ring mode in mobile diagnostics');
  assert.equal(small.children[0].geometry.width,small.children[0].geometry.height,'circular inscription must use a square top-facing canvas');
  assert.equal(small.children[0].visible,true);
  assert.equal(small.children[0].material.map.image.width,128);
  assert.equal(large.children.length,0,'disposed caves must never regain late-loading lettering');
  assert.equal(large.userData.puzzleCaveTankanReady,undefined);
  assert.equal(small.children[0].rotation.x,-Math.PI/2,'Tankan text should lie on the top of the stone pressure plate');
  a.dispose();assert.equal(small.children.length,0);

  const caves=read('docs/js/puzzle-cave-entrances.js');
  const ruin=read('docs/js/ruin-layer-challenges.js');
  const stone=read('docs/js/cavern-ore-rocks.js');
  const index=read('docs/index.html');
  assert(!caves.includes('beginPlayerSession?.('),'cliff melodies may not automatically launch the instrument');
  assert(!ruin.includes('beginPlayerSession?.('),'interior melodies may not automatically launch the instrument');
  assert(!caves.includes('MusicMinigame?.close?.('),'cliff puzzles cannot close a manually opened instrument');
  assert(ruin.includes("name='puzzle-cave-symmetric-note-columns'")||ruin.includes("scoreRoot.name='puzzle-cave-symmetric-note-columns'"),'interior notes must use mirrored authored pillars');
  assert(ruin.includes('maxColumns:1'),'each carved interior pillar carries a single vertical note column');
  assert(!ruin.includes('surfaces:[scoreFace]'),'no interior melody glyph is ever decaled onto the rough cave wall');
  assert(caves.includes('supportedScorePillarPair'),'exterior melodies also use paired standing score pillars');
  assert(caves.includes('new THREE.CylinderGeometry(.46,.46,.09,24)'),'outdoor melody stone must stay entirely within one tile');
  assert(caves.includes('Math.hypot(px-portal.plate.x,pz-portal.plate.z)<=.46'),'outdoor timing trigger must match the new one-tile plate');
  assert(ruin.includes('const MELODY_PLATE_RADIUS=0.46'),'interior melodies need one canonical one-tile radius');
  assert(ruin.includes('radius:MELODY_PLATE_RADIUS'),'interior judge must use the same radius as its stone plate');
  assert(ruin.includes("rec.plateArtStoneMesh=visiblePlate"),'ordinary ruin melody plates must also carry the concentric inscription');
  assert(ruin.includes('rec.inscription?.setVisible?.(down)'),'interior clue must only appear on the plate');
  assert(caves.includes('portal.scoreBoard.visible=!!down'),'exterior clue must only appear on the plate');
  const gate=JSON.parse(read('docs/config/furniture-authored/cliffGate.json')); // The physical cave gate must be an unobstructed passage once its slab opens.
  assert(!gate.parts.some(part=>part.id==='cliff_gate_darkness'),'interior cliff gate must not author a black backing mesh');
  assert(!ruin.includes('puzzle-cave-door-darkness-')&&!ruin.includes('puzzle-cave-fire-darkness-'),'interior cave gates must not generate a black placeholder');
  assert(ruin.includes("filter(part=>part.id!=='cliff_gate_darkness')"),'runtime must reject legacy cached black gate parts');
  assert(stone.includes('caveWall?.material'),'rock gate must reuse the actual cave-shell material');
  assert(index.includes('js/puzzle-cave-plate-art.js')&&index.includes('js/ruin-melody-glyph-decal.js'));
  console.log('PASS Puzzle Cave Tankan plates, shared font loading, async teardown, manual songs and paired stone-pillar clues');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

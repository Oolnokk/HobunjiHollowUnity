'use strict';
// Actual THREE r128 geometry and material lifecycle: multiroom floors never fill V50 voids.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;console.log('skip: playwright not installed (Stone Age browser regression)');process.exit(0);}
const root=path.resolve(__dirname,'..'),threeFile=path.join(root,'node_modules/three/build/three.min.js');
const scriptPaths=[
  'config/natural-surface-materials.js',
  'js/natural-surface-materials.js',
  'js/surface-stretch-uv-furniture.js',
  'js/terrain-preview.js',
  'js/procedural-furniture.js',
  'js/zone-terrain-features.js',
  'js/stone-age-ruin-scenery.js',
]; // The same source modules loaded by the game after opting into Stone Age mode.
const server=http.createServer((request,response)=>{
  const url=(request.url||'/').split('?')[0];
  if(url==='/stone-age-fixture'){
    const scripts=scriptPaths.map(file=>'<script src="/'+file+'"></script>').join('');
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><html><head><script src="/vendor-three.js"></script>'+scripts+'</head><body></body></html>');
    return;
  }
  if(url==='/vendor-three.js'){response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(threeFile));return;}
  const file=path.resolve(root,'docs',decodeURIComponent(url).replace(/^\/+/,''));
  if(!file.startsWith(path.join(root,'docs')+path.sep)){response.writeHead(403);response.end('Forbidden');return;}
  fs.readFile(file,(error,data)=>{if(error){response.writeHead(404);response.end(error.message);return;}
    response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'text/plain');response.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage(),errors=[]; // Any uncaught browser error fails the regression with its original stack.
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto('http://127.0.0.1:'+server.address().port+'/stone-age-fixture',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!(window.THREE?.BoxGeometry&&window.StoneAgeRuinScenery?.buildRoom&&window.ProceduralFurniture?.createRockGeometry&&window.HobunjiSurfaceStretchUV?.mapMesh),null,{timeout:30000});
    const stats=await page.evaluate(()=>{
      const T=window.THREE,check=(ok,reason)=>{if(!ok)throw new Error(reason);};
      const cells=[];for(let r=1;r<=5;r++)for(let c=1;c<=7;c++)if(!(c===4&&r===3))cells.push([c,r]);
      for(let r=7;r<=9;r++)for(let c=10;c<=15;c++)cells.push([c,r]);
      for(let c=7;c<=10;c++)cells.push([c,6]);
      const meta={gridCols:17,gridRows:11,cellSize:.5,worldWidth:8.5,worldDepth:5.5,floorSurfaceY:0,
        rooms:[{col:1,row:1,w:7,h:5},{col:10,row:7,w:6,h:3}],hallways:[{col:7,row:6,w:4,h:1}],
        plateauModel:{stepHeight:.42,regions:[]},floorCells:cells};
      const heights=new Map(cells.map(([c,r])=>[c+','+r,r===4&&c<7?-1.2:r>=7?.84:0]));
      const root=new T.Group(),floor=new T.Mesh(new T.BoxGeometry(1,.1,1),new T.MeshBasicMaterial()),
        wall=new T.Mesh(new T.BoxGeometry(4,2,.1),new T.MeshBasicMaterial());
      floor.userData.wallBuilderRecipe='wallrecipe2.json';floor.name='Native V50 floor';
      wall.userData.ruinInteriorWall=true;wall.name='Native V50 wall';wall.position.set(0,1,-1);
      root.add(floor,wall);
      const floorMask=floor.layers.mask,wallMask=wall.layers.mask,sourceGeometry=wall.geometry;
      const scenery=window.StoneAgeRuinScenery.buildRoom({root,meta,seed:'stone-browser',floorHeights:heights});
      const room=scenery.room,visible=room.model.children.find(child=>child.userData?.ruinPreviewRole==='floor');
      check(!!visible?.isMesh,'the floor must be a regular masked THREE.Mesh, not a rectangular InstancedMesh');
      check(!visible.isInstancedMesh,'multiroom floor cannot repeat unmasked 4×4 tiles');
      check(room.floorStats.levelCount===3&&room.floorStats.voidCells===131,'the real THREE floor retains three elevations and all absent cells');
      check(!room.floorStats.pos&&!room.floorStats.idx&&!room.floorStats.uv,'mobile diagnostics must not retain temporary full-resolution stone arrays');
      check(room.floorStones<cells.length,'irregular boulders must join multiple floor cells');
      check((visible.geometry.index?.count||visible.geometry.getAttribute('position')?.count)>0&&visible.geometry.getAttribute('uv').count>0,'the genuine mapped floor needs renderable triangles and UVs'); // The UV mapper intentionally splits indexed geometry into unindexed texture charts.
      check(visible.userData.stoneSurfaceMapping?.postRockification===true,'natural stone UVs must map after geometry generation');
      check(root.children.length===2,'construction must remain hidden until activated');
      scenery.activate();
      check(root.children.includes(room.model),'the new scene must attach to the native V50 root');
      check((floor.layers.mask&1)===0&&(wall.layers.mask&1)===0,'only source rendering should be suppressed');
      check(floor.visible&&wall.visible&&wall.geometry===sourceGeometry,'native V50 source and collision visibility must be preserved');
      const stoneGeometry=visible.geometry,wallStone=room.model.children.find(child=>child.userData?.ruinPreviewRole==='wall')?.geometry;
      let floorDisposed=false,wallDisposed=false; // Real THREE dispose events detect GPU buffer leaks, not just detached Object3D parents.
      stoneGeometry.addEventListener('dispose',()=>{floorDisposed=true;});
      wallStone?.addEventListener('dispose',()=>{wallDisposed=true;});
      const location={levels:room.floorStats.levelCount,voids:room.floorStats.voidCells,cells:room.floorStats.floorCells,boulders:room.floorStones,triangles:(stoneGeometry.index?.count||stoneGeometry.getAttribute('position').count)/3};
      scenery.dispose();scenery.dispose();
      check(floor.layers.mask===floorMask&&wall.layers.mask===wallMask,'exact original render layer masks must be restored');
      check(floor.visible&&wall.visible&&wall.geometry===sourceGeometry,'source collision geometry must survive disposal');
      check(!room.model.parent,'replaced scene must be detached');
      check(floorDisposed&&wallDisposed,'rockified floor and wall GPU geometry must be disposed exactly once');
      return location;
    });
    assert.equal(errors.length,0,errors.join('\n'));
    assert(stats.boulders>0&&stats.cells>0);
    console.log('Stone Age multiroom browser passed: real Three.js rock and UV geometry, void-masked floor, three V50 levels, native collision preservation and restoration.',JSON.stringify(stats));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

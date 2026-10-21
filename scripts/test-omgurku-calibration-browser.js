'use strict';
// CI browser smoke test: actual Omgurku calibration page, shared Three.js model,
// live edit, species export, and local game override. No pre-existing NPC required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only test)');
  process.exit(0);
}
const root=path.resolve(__dirname,'..');
const types={'.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.css':'text/css'};
const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/,'');
  const absolute=path.resolve(root,relative);
  if(!absolute.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(absolute,(error,data)=>{
    if(error){res.writeHead(404);return res.end('Missing '+relative);}
    res.setHeader('Content-Type',types[path.extname(absolute)]||'application/octet-stream');
    res.end(data);
  });
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:800}});
    const errors=[];
    page.on('pageerror',err=>errors.push(err.stack||err.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/docs/tools/omgurku-calibration/index.html',
      {waitUntil:'domcontentloaded',timeout:25000});
    await page.waitForFunction(()=>{
      const api=window.HobunjiOmgurkuCalibration;
      return api && (api.snapshot().hasComposite || api.snapshot().error);
    },null,{timeout:55000});
    const before=await page.evaluate(()=>window.HobunjiOmgurkuCalibration.snapshot());
    assert.equal(before.error,null,'calibration load: '+before.error+'\npage errors: '+errors.join('\n'));
    assert.equal(before.hasComposite,true,'real hybrid Omgurku should build without selected NPC');
    const rigIntegrity=await page.evaluate(()=>{
      const model=window.HobunjiOmgurkuCalibration && [...(window.HobunjiOmgurkuSpecies?.debugSnapshot()?.liveFrames||[])][0];
      const state=window.HobunjiOmgurkuSpecies.debugSnapshot();
      return { coat:state.coatColor,mode:window.PerpRotation.CREATURE_PLANE_ROT_MODE,
        animalDeadzone:window.PerpRotation.CREATURE_PERP_DEAD_RAD,
        npcDeadzone:window.PerpRotation.PERP_DEAD_RAD,
        ref:window.CreatureGeneticsRender.SPECIES['omgurku-lower']?.baseRecolorKeyHex };
    });
    assert.equal(rigIntegrity.ref,'#99BF99','lower sprite borrows keyed Voorg coat recolor');
    assert(rigIntegrity.npcDeadzone>rigIntegrity.animalDeadzone,'distinct deadzone angles');
    await page.waitForFunction(()=>window.HobunjiOmgurkuSpecies.debugSnapshot().tintedFrames>=3,
      null,{timeout:25000});
    await page.locator('#frontBtn').click();
    await page.waitForFunction(()=>{
      const snap=window.HobunjiOmgurkuSpecies.debugSnapshot();
      return snap.facingUpdates>3 && snap.liveFrames[0]?.handParentIsUpper === true;
    },null,{timeout:6000});
    await page.waitForFunction(()=>{
      const frame=window.HobunjiOmgurkuSpecies.debugSnapshot().liveFrames[0];
      return frame?.handRigAttached === true;
    },null,{timeout:6000});
    await page.waitForFunction(()=>{
      const frame=window.HobunjiOmgurkuSpecies.debugSnapshot().liveFrames[0];
      return Number.isFinite(frame?.upperYaw) && Number.isFinite(frame?.lowerYaw)
        && Math.abs(frame.upperYaw-frame.lowerYaw)>0.15;
    },null,{timeout:6000});
    assert.deepEqual(errors,[],'all shared engine modules should load without uncaught errors');
    await page.locator('#number_saddleU').fill('0.421');
    await page.locator('#number_saddleU').dispatchEvent('change');
    const current=await page.evaluate(()=>window.HobunjiOmgurkuCalibration.snapshot());
    assert.equal(current.placement.saddleU,.421);
    await page.locator('#saveLocalBtn').click();
    const saved=await page.evaluate(()=>{
      return JSON.parse(localStorage.getItem(window.HobunjiOmgurkuSpecies.localPlacementKey));
    });
    assert.equal(saved.hybridPlacement.saddleU,.421,'browser saved placement');
    await page.locator('#resetBtn').click();
    const cleared=await page.evaluate(()=>localStorage.getItem(window.HobunjiOmgurkuSpecies.localPlacementKey));
    assert.equal(cleared,null,'clear local override');
    await page.locator('#moveBtn').click();
    await page.waitForFunction(()=>/^run[12]$/.test(window.HobunjiOmgurkuCalibration.snapshot().frame),
      null,{timeout:4000});
    await page.locator('#moveBtn').click();
    // Omgurku connector: use a real in-browser PNG upload, not a mocked
    // renderer. It is disabled until the artwork arrives.
    assert.equal((await page.evaluate(()=>window.HobunjiOmgurkuConnector.snapshot())).enabled,false);
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=80;canvas.height=120;
      const g=canvas.getContext('2d');g.fillStyle='#caa05d';g.beginPath();
      g.moveTo(13,7);g.lineTo(68,7);g.lineTo(70,117);g.lineTo(7,117);g.fill();
      const binary=atob(canvas.toDataURL('image/png').split(',')[1]);
      const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      const file=new File([bytes],'waist-to-neck.png',{type:'image/png'});
      const input=document.getElementById('connectorFile');
      const transfer=new DataTransfer();transfer.items.add(file);
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await page.waitForFunction(()=>{
      const c=window.HobunjiOmgurkuConnector;
      return c?.live?.size===1 && [...c.live][0].mesh.visible
        && [...c.live][0].mesh.geometry.attributes.position.needsUpdate!==undefined;
    },null,{timeout:12000});
    const bridgeBefore=await page.evaluate(()=>{
      const c=window.HobunjiOmgurkuConnector,handle=[...c.live][0],
        mesh=handle.mesh,geometry=mesh.geometry;
      handle.update(true);
      const positions=geometry.attributes.position.array;
      return {
        configured:c.snapshot().enabled,
        savedSource:window.HobunjiOmgurkuConnectorAuthor.snapshot(),
        belt:c.belt(),length:positions.length,
        parent:mesh.parent===window.HobunjiOmgurkuCalibration.context().model,
        first:[positions[0],positions[1],positions[2]],
        topTarget:[handle.targetsTop[0].x,handle.targetsTop[0].y,handle.targetsTop[0].z],
      };
    });
    assert.equal(bridgeBefore.configured,true);
    assert.equal(bridgeBefore.savedSource.uploaded,true);
    assert.equal(bridgeBefore.belt.length,5,'canonical pants belt is five points');
    assert.equal(bridgeBefore.length,25*13*3,'bounded 24x12 deformable grid');
    assert.equal(bridgeBefore.parent,true,'connector shares the NPC root');
    for(let i=0;i<3;i++)
      assert(Math.abs(bridgeBefore.first[i]-bridgeBefore.topTarget[i])<.0001,
        'top of connector attached exactly to pants waistband');
    const original=bridgeBefore.first;
    await page.locator('#headingRange').evaluate(input=>{
      input.value='90';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.waitForTimeout(350);
    const afterTurn=await page.evaluate(()=>{
      const h=[...window.HobunjiOmgurkuConnector.live][0];
      h.update(true);return [h.targetsBottom[0].x,h.targetsBottom[0].y,h.targetsBottom[0].z];
    });
    assert(afterTurn.every(Number.isFinite),'bottom neck spline remains finite while animal turns');
    await page.locator('#connectorSave').click();
    const savedConnector=await page.evaluate(()=>{
      const k=window.HobunjiOmgurkuConnector.storageKey;
      return JSON.parse(localStorage.getItem(k));
    });
    assert.equal(savedConnector.enabled,true);
    assert.equal(savedConnector.sourceTop.length,5);
    assert.equal(savedConnector.sourceBottom.length,5);
    assert.equal(savedConnector.animalNeck.length,5);
    assert(savedConnector.imageDataUrl.startsWith('data:image/png;base64,'));
    const exported=await page.evaluate(()=>window.HobunjiOmgurkuConnectorAuthor.exportConfig());
    assert(!exported.imageDataUrl,'species export references PNG asset, not inline megabytes');
    await page.locator('#connectorClear').click();
    assert.equal((await page.evaluate(()=>window.HobunjiOmgurkuConnector.live.size)),0);
    assert.deepEqual(errors,[],'uncaught browser exceptions');
    console.log('Omgurku editor browser smoke passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
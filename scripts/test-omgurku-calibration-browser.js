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
    if(process.env.OMGURKU_CAPTURE_PREVIEW==='1'){
      fs.mkdirSync(path.join(root,'omgurku-visual-qa'),{recursive:true});
      await page.locator('#stage').screenshot({path:path.join(root,'omgurku-visual-qa','01-angle.png')});
      const visualAudit=await page.evaluate(()=>{
        const c=window.HobunjiOmgurkuCalibration.context(),model=c.model,composite=model.userData.omgurkuComposite;
        const pos=node=>{if(!node)return null;node.updateWorldMatrix?.(true,false);
          const p=node.getWorldPosition(new c.THREE.Vector3());
          return {x:Number(p.x.toFixed(3)),y:Number(p.y.toFixed(3)),z:Number(p.z.toFixed(3))};};
        const hands=[];
        model.traverse(node=>{
          if(/hand_socket|procedural_hands|RiderPortraitVisualOffset|Omgurku_V10_HandAttachToolBase/.test(node.name||''))
            hands.push({name:node.name,world:pos(node),local:{x:node.position.x,y:node.position.y,z:node.position.z},
              parent:node.parent?.name||null});
        });
        return {upper:pos(composite.upper),visual:pos(composite.portraitVisual),
          lower:pos(composite.lowerRefs[0]?.group),portraitHeight:composite.portraitHeight,
          posterior:composite.posterior,join:model.userData.omgurkuJoin,
          handAttachY:model.userData.handAttachY,handAttachX:model.userData.handAttachX,
          hands,handModel:model.userData.proceduralHandRig?.getDebug?.()?.modelKey,
          handLoadError:model.userData.proceduralHandRig?.getDebug?.()?.loadError||null};
      });
      fs.writeFileSync(path.join(root,'omgurku-visual-qa','assembly.json'),JSON.stringify(visualAudit,null,2));
      console.log('OMGURKU_VISUAL_GEOMETRY',JSON.stringify({
        upper:visualAudit.upper,lower:visualAudit.lower,portraitHeight:visualAudit.portraitHeight,
        posterior:visualAudit.posterior,join:visualAudit.join,hands:visualAudit.hands,
      }));
      await page.locator('#sideBtn').click();
      await page.waitForTimeout(150);
      await page.locator('#stage').screenshot({path:path.join(root,'omgurku-visual-qa','02-side.png')});
      await page.locator('#backBtn').click();
      await page.waitForTimeout(150);
      await page.locator('#stage').screenshot({path:path.join(root,'omgurku-visual-qa','03-back.png')});
      await page.locator('#angleBtn').click();
    }
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
    // Real GLB hands are mandatory; the old smoke passed with two fallback
    // ellipsoids while the Omgurku editor silently failed a bare Three.js
    // addons import.
    await page.waitForFunction(()=>{
      const model=window.HobunjiOmgurkuCalibration.context().model,rig=model?.userData?.proceduralHandRig;
      if(!rig)return false;
      const error=rig.getDebug?.().loadError;
      if(error)throw Error('Omgurku hand GLB loading failed: '+error);
      let actual=0;
      rig.group?.traverse?.(node=>{if(node.userData?.handModelKey==='feline')actual++;});
      return actual>=2;
    },null,{timeout:20000});
    const freeHand=await page.evaluate(()=>{
      const model=window.HobunjiOmgurkuCalibration.context().model;
      const socket=model.getObjectByName('left_hand_socket');
      return {socketY:socket?.position.y,portraitHandY:model.userData.handAttachY,
        source:model.userData.proceduralHandRig?.getDebug?.()?.shoulderCompass?.idlePositionRule};
    });
    assert(Math.abs(freeHand.socketY-freeHand.portraitHandY)<0.07,
      'Omgurku free hand must rest at its own waist-up portrait attachment, not the animal posterior');
    if(process.env.OMGURKU_CAPTURE_PREVIEW==='1')
      await page.locator('#stage').screenshot({path:path.join(root,'omgurku-visual-qa','04-real-hands.png')});
    await page.waitForFunction(()=>{
      const frame=window.HobunjiOmgurkuSpecies.debugSnapshot().liveFrames[0];
      return Number.isFinite(frame?.upperYaw) && Number.isFinite(frame?.lowerYaw)
        && Math.abs(frame.upperYaw-frame.lowerYaw)>0.15;
    },null,{timeout:6000});
    // The previous suite only checked that objects existed. Preserve three
    // actual rendered views so a human can inspect portrait/animal alignment.
    const artifacts=path.join(root,'test-artifacts','omgurku');
    fs.mkdirSync(artifacts,{recursive:true});
    for (const [name,button] of [['front','frontBtn'],['side','sideBtn'],['back','backBtn'],['three-quarter','angleBtn']]) {
      await page.locator('#'+button).click();
      await page.waitForTimeout(350);
      await page.locator('#stage').screenshot({path:path.join(artifacts,name+'.png')});
    }
    fs.writeFileSync(path.join(artifacts,'geometry.json'),JSON.stringify(
      await page.evaluate(()=>({
        placement:window.HobunjiOmgurkuCalibration.context().placement,
        scene:window.HobunjiOmgurkuSpecies.debugSnapshot().liveFrames[0],
        renderer:window.HobunjiOmgurkuAdvanced?.snapshot?.(),
      })),null,2));
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
    // V10 feature parity — actual shared portrait/weapon assembly, authored
    // attack data, separate user-authored deadzones, and painted lower mask.
    await page.waitForFunction(()=>window.HobunjiOmgurkuAdvanced?.snapshot()?.previewModel,
      null,{timeout:7000});
    await page.waitForFunction(()=>document.querySelectorAll('#v10Attack option').length>=1,
      null,{timeout:7000});
    const handAndWeapon=await page.evaluate(()=>{
      const c=window.HobunjiOmgurkuCalibration.context();
      const comp=c.model.userData.omgurkuComposite;
      return {holderInUpper:c.model.userData.proceduralHandToolHolder?.parent?.parent===comp.upper,
        heldWeaponKey:c.model.userData.proceduralHandToolKey};
    });
    assert(handAndWeapon.heldWeaponKey,'V10 selected weapon drives NPC-owned hand grips');
    assert(handAndWeapon.holderInUpper,'V10 weapon holder is in upper portrait transform');
    await page.locator('#v10AnimalDead').evaluate(el=>{el.value='18';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#v10RiderDead').evaluate(el=>{el.value='53';el.dispatchEvent(new Event('input',{bubbles:true}));});
    const radii=await page.evaluate(()=>window.HobunjiOmgurkuCalibration.context()
      .model.userData.omgurkuComposite.previewDeadzoneRadii);
    assert.equal(radii.animal,18);assert.equal(radii.rider,53);
    const visual=await page.evaluate(()=>{
      const frame=window.HobunjiOmgurkuSpecies.debugSnapshot().liveFrames[0];
      return {portraitLift:frame?.portraitLift,portraitHeight:frame?.portraitHeight};
    });
    assert(visual.portraitHeight>0,'portrait basis must be positive');
    assert(Math.abs(visual.portraitLift-visual.portraitHeight/2)<1e-6,
      'V10 centers the portrait half a model height above its floor-origin hand root');
    const posteriorJoin=await page.evaluate(()=>{
      const c=window.HobunjiOmgurkuCalibration.context(),v=c.model.userData.omgurkuComposite;
      const join=c.model.userData.omgurkuJoin,scale=c.placement.riderScale;
      return {jointY:join.y,posteriorY:v.posterior?.y,
        reconstructedY:v.upper.position.y+v.posterior.y*scale,
        handParentIsUpper:c.model.userData.proceduralHandParent===v.upper};
    });
    assert(Number.isFinite(posteriorJoin.posteriorY)&&posteriorJoin.posteriorY>0,
      'gameplay composite resolves NPC posterior anchor from rig');
    assert(Math.abs(posteriorJoin.jointY-posteriorJoin.reconstructedY)<.0001,
      'V10 posterior is aligned to saddle, not portrait root');
    assert(posteriorJoin.handParentIsUpper,'hands continue following vertically aligned portrait');
    await page.locator('#v10AttackBtn').click();
    await page.waitForFunction(()=>window.HobunjiOmgurkuAdvanced.snapshot().attack!=='idle',
      null,{timeout:3000});
    await page.locator('#v10Stop').click();
    await page.locator('#v10EraseMode').click();
    const area=await page.locator('#v10MaskEdit').boundingBox();
    await page.mouse.move(area.x+area.width*.5,area.y+area.height*.5);
    await page.mouse.down();await page.mouse.move(area.x+area.width*.53,area.y+area.height*.5,{steps:3});
    await page.mouse.up();
    await page.waitForFunction(()=>window.HobunjiOmgurkuAdvanced.snapshot().maskFrameCount===3,
      null,{timeout:8000});
    await page.locator('#v10ResetMask').click();
    assert.equal((await page.evaluate(()=>window.HobunjiOmgurkuAdvanced.snapshot())).maskFrameCount,0);
    assert.deepEqual(errors,[],'uncaught browser exceptions');
    console.log('Omgurku editor browser smoke passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
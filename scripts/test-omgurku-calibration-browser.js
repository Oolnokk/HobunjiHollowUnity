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
// A wedged Chromium (software WebGL under load) must not keep this process alive after the result is known: the test printed
// "passed" and then hung until the CI step was killed. Bound the close, then exit explicitly with the real result code.
async function closeBounded(browser){
  try{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,20000))]);}catch(_){/* already closed */}
}
function exitWithResult(){setImmediate(()=>process.exit(process.exitCode||0));}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:800}});
    // Optional installed Three.js package makes this smoke test independent of CDN access.
    if(process.env.HOBUNJI_THREE_TEST_ROOT)await page.route('https://esm.sh/**',async route=>{
      const suffix=new URL(route.request().url()).pathname.replace(/^\/three@[^/]+\/?/,'');
      const relative=suffix||'build/three.module.js'; // Use the same version as the game's configured CDN module.
      const base=path.resolve(process.env.HOBUNJI_THREE_TEST_ROOT);
      const file=path.resolve(base,relative);
      if(!file.startsWith(base+path.sep))return route.abort();
      try{await route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8').replace(/from ['"']three['"']/g,"from 'https://esm.sh/three@0.128.0'")});}
      catch(error){await route.abort();}
    });
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
    await page.waitForFunction(()=>window.HobunjiOmgurkuCalibration.context().image?.naturalWidth>0,
      null,{timeout:6000});
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
      return snap.facingUpdates>3 && snap.liveFrames[0]?.handParentIsRider === true;
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
    const idleSignature=await page.evaluate(()=>{
      const rig=window.HobunjiOmgurkuCalibration.context().model.userData.proceduralHandRig;
      return JSON.stringify(rig.group.children.map(child=>[...child.position.toArray(),...child.quaternion.toArray()]));
    });
    await page.waitForFunction(previous=>{
      const rig=window.HobunjiOmgurkuCalibration.context().model.userData.proceduralHandRig;
      return JSON.stringify(rig.group.children.map(child=>[...child.position.toArray(),...child.quaternion.toArray()]))!==previous;
    },idleSignature,{timeout:5000});
    await page.locator('#number_lowerDeadzoneDegrees').fill('58');
    await page.locator('#number_lowerDeadzoneDegrees').dispatchEvent('change');
    assert.equal(await page.evaluate(()=>window.HobunjiOmgurkuSpecies.debugSnapshot().placement.lowerDeadzoneDegrees),58);
    assert.equal(await page.evaluate(()=>window.PerpRotation.CREATURE_PERP_DEAD_RAD),rigIntegrity.animalDeadzone,'global animal deadzone is unchanged');
    await page.evaluate(()=>{
      const perp=window.PerpRotation;
      window.__omgurkuDeadzoneSamples=[];
      window.__omgurkuOriginalFacing={};
      for(const key of ['creatureSnapSwayTarget','creatureDeadzoneTarget','perpClamp']){
        const original=perp[key];
        if(!original)continue;
        window.__omgurkuOriginalFacing[key]=original;
        perp[key]=function(...args){window.__omgurkuDeadzoneSamples.push(args[3]);return original.apply(this,args);};
      }
    });
    await page.waitForFunction(()=>window.__omgurkuDeadzoneSamples.some(value=>Math.abs(value-58*Math.PI/180)<1e-8));
    await page.evaluate(()=>Object.assign(window.PerpRotation,window.__omgurkuOriginalFacing));

    await page.locator('#weaponPreviewMode').selectOption('stance');
    await page.waitForFunction(()=>window.HobunjiOmgurkuWeaponPreview.snapshot().weaponLoaded
      && window.HobunjiOmgurkuWeaponPreview.snapshot().holderVisible);
    await page.locator('#weaponPreviewStance').selectOption('lightWeapon');
    await page.waitForFunction(()=>Math.abs(window.HobunjiOmgurkuWeaponPreview.snapshot().sample.bodyYawRad+40*Math.PI/180)<1e-7);
    const mounted=await page.evaluate(()=>{
      const root=window.HobunjiOmgurkuCalibration.context().model,c=root.userData.omgurkuComposite;
      const p=window.HobunjiOmgurkuWeaponPreview.snapshot().sample;
      const expected=new window.THREE.Vector3(c.upper.userData.handAttachX*p.mirrorBlend+p.x,c.upper.userData.handAttachY+p.y,p.z);
      window.HobunjiSpeciesPoseScale.transformPosePoint(expected,{cx:0,cz:0,floorY:0,baseY:c.upper.userData.handAttachY,
        speciesId:'engh-sho',gender:'male',rigScaleY:1,modelHeight:c.upper.userData.portraitModelHeight,
        armLength:c.upper.userData.armLength,poseOrbitScale:c.upper.userData.poseOrbitScale});
      return {offset:c.riderFrame.position.y,height:c.upper.userData.portraitModelHeight,
        error:expected.distanceTo(root.userData.proceduralHandToolHolder.position),
        hands:root.userData.proceduralHandRig.parent===c.riderFrame};
    });
    assert.equal(mounted.offset,-mounted.height/2,'mounted rider floor compensates portrait center');
    assert(mounted.error<1e-8 && mounted.hands,'Engh-sho weapon poses and idle hands share mounted floor coordinates');
    if(process.env.HOBUNJI_WEAPON_QA_SCREENSHOT){
      await page.locator('#angleBtn').click();
      await page.waitForTimeout(300);
      await page.locator('#viewport').screenshot({path:process.env.HOBUNJI_WEAPON_QA_SCREENSHOT});
    }
    await page.locator('#weaponPreviewAttack').selectOption('1');
    await page.locator('#weaponPreviewPlay').click();
    await page.waitForFunction(()=>window.HobunjiOmgurkuWeaponPreview.snapshot().progress>.08);
    const armed=await page.evaluate(()=>{
      const model=window.HobunjiOmgurkuCalibration.context().model;
      return {state:window.HobunjiOmgurkuWeaponPreview.snapshot(),
        parent:model.userData.proceduralHandToolHolder.parent===model.userData.omgurkuComposite.riderFrame,
        grip:!!model.userData.proceduralHandAnimationGrip,
        driver:window.RuntimeFrameScheduler.getDebug()};
    });
    assert(armed.parent&&armed.grip,'preview weapon and gameplay grip driver share the upper portrait frame');
    assert.equal(armed.driver.frameDriverErrorCount,0,'idle and combat pre-render updates run without swallowed driver errors');
    await page.locator('#weaponPreviewScrub').evaluate(input=>{input.value='.5';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>Math.abs(window.HobunjiOmgurkuWeaponPreview.snapshot().progress-.5)<1e-8);
    for(const toolKey of ['fishingspear','plainsSword','pickshovel','bronzehoe','hatchet']){
      await page.locator('#weaponPreviewTool').selectOption(toolKey);
      await page.waitForFunction(key=>{
        const preview=window.HobunjiOmgurkuWeaponPreview.snapshot();
        return preview.toolKey===key && preview.weaponLoaded && !preview.error;
      },toolKey,{timeout:8000});
    }
    await page.locator('#weaponPreviewStance').selectOption('heavyWeapon');
    await page.locator('#weaponPreviewMode').selectOption('stance');
    await page.waitForFunction(()=>Math.abs(window.HobunjiOmgurkuWeaponPreview.snapshot().sample.bodyYawRad+15*Math.PI/180)<1e-7);
    await page.locator('#refreshPreviewBtn').click();
    await page.waitForFunction(()=>window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount===1
      && window.HobunjiOmgurkuWeaponPreview.snapshot().weaponLoaded);
    assert.equal(await page.evaluate(()=>window.RuntimeFrameScheduler.getDebug().frameDriverErrorCount),0,
      'rebuilding the avatar releases and rebinds the preview weapon without leaving a stale hand owner');
    await page.locator('#weaponPreviewIdle').click();
    await page.waitForFunction(()=>!window.HobunjiOmgurkuWeaponPreview.snapshot().holderVisible);
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
    assert.equal(saved.hybridPlacement.lowerDeadzoneDegrees,58,'unique lower deadzone exports with species');
    await page.locator('#resetBtn').click();
    const cleared=await page.evaluate(()=>localStorage.getItem(window.HobunjiOmgurkuSpecies.localPlacementKey));
    assert.equal(cleared,null,'clear local override');
    await page.locator('#moveBtn').click();
    await page.waitForFunction(()=>/^run[12]$/.test(window.HobunjiOmgurkuCalibration.snapshot().frame),
      null,{timeout:4000});
    await page.locator('#moveBtn').click();
    // Omgurku connector: use a real in-browser PNG upload, not a mocked
    // renderer. Until the dedicated artwork ships, the basic pants sprite stands in.
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=80;canvas.height=120;
      const g=canvas.getContext('2d');g.fillStyle='#99bf99';g.beginPath();
      g.moveTo(13,7);g.lineTo(68,7);g.lineTo(70,117);g.lineTo(7,117);g.fill();
      g.fillStyle='#eeeeee';g.fillRect(38,38,5,5);
      g.fillStyle='#c04040';g.fillRect(48,38,5,5);
      g.fillStyle='#4d604d';g.fillRect(28,58,5,5);
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
        && [...c.live][0].tintStatus.source==='uploaded'
        && [...c.live][0].mesh.geometry.attributes.position.version>0;
    },null,{timeout:12000});
    const mirror=await page.evaluate(()=>{
      const api=window.PNGPlaneAvatar,handle=[...window.HobunjiOmgurkuConnector.live][0];
      const root=handle.root,upper=root.userData.omgurkuComposite.upper;
      const plane=upper.userData.neckRig?.skinnedPlane||upper.getObjectByName('npc_avatar_front_plane');
      const waist=window.HobunjiOmgurkuConnector.snapshot().riderWaist||window.HobunjiOmgurkuConnector.belt();
      const expected=(point,flip)=>root.worldToLocal(plane.localToWorld(new window.THREE.Vector3(
        (flip?.5-point.x:point.x-.5)*upper.userData.portraitModelWidth,
        (.5-point.y)*upper.userData.portraitModelHeight,0)));
      root.updateMatrixWorld(true);
      api.setPortraitsFlipped(false,{persist:false});handle.update(false);
      const unflipped=handle.targetsTop[0].distanceTo(expected(waist[0],false));
      const bottom=handle.targetsBottom.map(point=>point.clone()),map=handle.mesh.material.map;
      const version=handle.mesh.geometry.attributes.position.version;
      api.setPortraitsFlipped(true,{persist:false});const updated=handle.update(false);
      return {unflipped,flipped:handle.targetsTop[0].distanceTo(expected(waist[4],true)),updated,
        revisionChanged:handle.mesh.geometry.attributes.position.version>version,
        bottomFixed:bottom.every((point,i)=>point.distanceTo(handle.targetsBottom[i])<1e-8),sameTexture:map===handle.mesh.material.map};
    });
    assert(mirror.unflipped<1e-7&&mirror.flipped<1e-7,'connector waist follows raw portrait pixels in both mirror settings without crossing its endpoints');
    assert(mirror.updated&&mirror.revisionChanged&&mirror.bottomFixed&&mirror.sameTexture,'mirror toggles invalidate only upper seam geometry, preserving the lower attachment and tinted texture');
    const tint=await page.evaluate(()=>{
      const h=[...window.HobunjiOmgurkuConnector.live][0];
      const canvas=h.mesh.material.map.image,ctx=canvas.getContext('2d');
      const pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
      return {key:pixel(25,40),gray:pixel(40,40),red:pixel(50,40),shade:pixel(30,60),alpha:pixel(0,0),
        color:window.CreatureGeneticsRender.hexToRgb(h.root.userData.omgurkuComposite.tintColor),status:h.tintStatus};
    });
    assert.deepEqual(tint.key,[...tint.color,255],'connector base color maps to this NPC body A');
    assert.deepEqual(tint.gray,[238,238,238,255],'unkeyed highlights stay authored');
    assert.deepEqual(tint.red,[192,64,64,255],'unrelated color details stay authored');
    assert.equal(tint.alpha[3],0,'PNG transparency survives the tint pass');
    assert(tint.shade[0]<tint.key[0]&&tint.shade[1]<tint.key[1],'source shading survives tinting');
    assert.equal(tint.status.ready,true,'mobile diagnostics report completed coat tint');
    await page.evaluate(()=>{
      const model=window.HobunjiOmgurkuCalibration.context().model,c=model.userData.omgurkuComposite;
      window.__connectorTintActor=window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(window.THREE,c.upper.userData.sourceCanvas,{
        backCanvas:c.upper.userData.backCanvas,speciesId:'omgurku',gender:'male',bodyColors:{A:{hex:'#d04070'}}});
    });
    await page.waitForFunction(()=>window.__connectorTintActor.userData.omgurkuComposite.connector.tintStatus.ready);
    const other=await page.evaluate(()=>{
      const actor=window.__connectorTintActor,h=actor.userData.omgurkuComposite.connector;
      const pixel=Array.from(h.mesh.material.map.image.getContext('2d').getImageData(25,40,1,1).data);
      window.PNGPlaneAvatar.disposeAvatarModel(actor);delete window.__connectorTintActor;
      return pixel;
    });
    assert.deepEqual(other,[208,64,112,255],'simultaneous NPCs tint the same connector independently');
    assert.equal(await page.evaluate(()=>window.HobunjiOmgurkuConnector.live.size),1,'second actor releases its own connector');
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
    const influenceCheck=await page.evaluate(()=>{
      const input=document.getElementById('connectorUpperInfluence'),handle=[...window.HobunjiOmgurkuConnector.live][0];
      input.value='.1';input.dispatchEvent(new Event('input',{bubbles:true}));
      const before=Array.from(handle.mesh.geometry.attributes.position.array);
      input.value='.9';input.dispatchEvent(new Event('input',{bubbles:true}));
      const after=Array.from(handle.mesh.geometry.attributes.position.array);
      return {moved:after.some((v,i)=>Math.abs(v-before[i])>1e-5),
        fixedTop:after.slice(0,3).every((v,i)=>v===before[i]),
        fixedBottom:after.slice(-3).every((v,i)=>v===before[before.length-3+i]),
        value:window.HobunjiOmgurkuConnector.snapshot().upperInfluence};
    });
    assert(influenceCheck.moved&&influenceCheck.fixedTop&&influenceCheck.fixedBottom,
      'upper/lower influence changes the bridge while keeping both attachment edges fixed');
    assert.equal(influenceCheck.value,.9);
    const performanceCheck=await page.evaluate(()=>{
      const handle=[...window.HobunjiOmgurkuConnector.live][0];
      const model=window.HobunjiOmgurkuCalibration.context().model;
      handle.update(true);
      const version=handle.mesh.geometry.attributes.position.version;
      model.position.x+=100;model.rotation.y+=.8;
      const rebuilt=handle.update();
      const stable=version===handle.mesh.geometry.attributes.position.version;
      model.position.x-=100;model.rotation.y-=.8;
      const image=handle.mesh.material.map;
      const next=window.HobunjiOmgurkuConnector.snapshot({includeImage:true});
      next.sourceTop[2].y+=.02;
      window.HobunjiOmgurkuConnectorAuthor.importConfig(next);
      return {rebuilt,stable,sameTexture:handle.mesh.material.map===image,
        depthTest:handle.mesh.material.depthTest,depthWrite:handle.mesh.material.depthWrite};
    });
    assert.equal(performanceCheck.rebuilt,false,'world movement does not deform a root-local connector');
    assert.equal(performanceCheck.stable,true,'world movement does not upload unchanged vertex buffers');
    assert.equal(performanceCheck.sameTexture,true,'rigging edits reuse the decoded PNG');
    assert.equal(performanceCheck.depthTest,true,'scenery occludes the connector');
    assert.equal(performanceCheck.depthWrite,true,'connector uses ordinary PNG cutout depth');
    // Exercise the actual mobile controls, including pointer rotation of the on-spline arrow.
    await page.setViewportSize({width:390,height:844});
    const beforeTransform=await page.evaluate(()=>window.HobunjiOmgurkuConnector.snapshot());
    await page.locator('#connectorSourceTools [data-action=left]').click();
    const movedSpline=await page.evaluate(()=>window.HobunjiOmgurkuConnector.snapshot());
    assert(movedSpline.sourceTop.every((p,i)=>Math.abs(p.x-beforeTransform.sourceTop[i].x+.004)<1e-10),
      'whole-spline buttons move all five nodes together');
    assert.deepEqual(movedSpline.sourceBottom,beforeTransform.sourceBottom,'the other source seam remains independent');
    await page.locator('#connectorUndo').click();
    assert.deepEqual(await page.evaluate(()=>window.HobunjiOmgurkuConnector.snapshot().sourceTop),beforeTransform.sourceTop);
    await page.locator('#connectorRiderTools [data-action=left]').click();
    assert.equal((await page.evaluate(()=>window.HobunjiOmgurkuConnector.snapshot().riderWaist)).length,5,
      'rider target is editable and saved with this connector only');
    await page.locator('#connectorUndo').click();
    await page.evaluate(()=>{
      const next=window.HobunjiOmgurkuConnector.snapshot();
      next.sourceTop=next.sourceTop.map(p=>({...p,y:0}));
      next.shrinkwrapDirections.sourceTop=90;next.shrinkwrapDirections.sourceBottom=270;
      window.HobunjiOmgurkuConnectorAuthor.importConfig(next);
    });
    await page.locator('#connectorSourceCanvas').scrollIntoViewIfNeeded();
    const arrow=await page.evaluate(()=>window.HobunjiOmgurkuConnectorAuthor.snapshot().arrows.sourceTop);
    const canvasBox=await page.locator('#connectorSourceCanvas').boundingBox();
    const px=x=>canvasBox.x+x*canvasBox.width/480;
    const py=y=>canvasBox.y+y*canvasBox.height/260;
    await page.mouse.move(px(arrow.tx),py(arrow.ty));await page.mouse.down();
    await page.mouse.move(px(arrow.cx+36),py(arrow.cy),{steps:5});await page.mouse.up();
    const arrowAngle=await page.evaluate(()=>window.HobunjiOmgurkuConnectorAuthor.snapshot().directions.sourceTop);
    assert(Math.min(arrowAngle,360-arrowAngle)<3,'dragging the arrow rotates its projection direction');
    await page.locator('#connectorSourceTools input[type=range]').evaluate(input=>{
      input.value='90';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.locator('#connectorSourceTools [data-action=shrinkwrap]').click();
    const shrinkwrapped=await page.evaluate(()=>window.HobunjiOmgurkuConnector.snapshot());
    assert(shrinkwrapped.sourceTop.every(p=>Math.abs(p.y-7/120)<1e-5),
      'mobile shrinkwrap button projects onto clean PNG pixels, not opaque editor guides');
    assert(shrinkwrapped.shrinkwrapDirections.sourceBottom===270,'other arrows retain their own angles');
    if(process.env.HOBUNJI_QA_SCREENSHOT){
      await page.locator('#connectorSourceCanvas').scrollIntoViewIfNeeded();
      await page.screenshot({path:process.env.HOBUNJI_QA_SCREENSHOT});
    }
    await page.setViewportSize({width:1200,height:800});
    await page.locator('#headingRange').evaluate(input=>{
      input.value='90';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.waitForTimeout(350);
    const afterTurn=await page.evaluate(()=>{
      const h=[...window.HobunjiOmgurkuConnector.live][0];
      h.update(true);return [h.targetsBottom[0].x,h.targetsBottom[0].y,h.targetsBottom[0].z];
    });
    assert(afterTurn.every(Number.isFinite),'bottom neck spline remains finite while animal turns');
    const contact=await page.evaluate(()=>{
      const handle=[...window.HobunjiOmgurkuConnector.live][0];
      const model=window.HobunjiOmgurkuCalibration.context().model;
      const c=model.userData.omgurkuComposite,THREE=window.THREE;
      let upper=c.upper.userData?.neckRig?.skinnedPlane;
      c.upper.traverse(node=>{if(node.name==='npc_avatar_front_plane')upper=node;});
      const lower=c.lowerRefs[0].frontPlane;
      model.updateMatrixWorld(true);handle.update(true);
      const positions=handle.mesh.geometry.attributes.position.array,point=new THREE.Vector3();
      let topError=0,bottomError=0;
      for(let row=0;row<=12;row++)for(let col=0;col<=24;col++){
        if(row>handle.attachmentRows&&row<12-handle.attachmentRows)continue;
        const offset=(row*25+col)*3;
        point.fromArray(positions,offset);model.localToWorld(point);
        if(row<=handle.attachmentRows){upper.worldToLocal(point);topError=Math.max(topError,Math.abs(point.z));}
        else{lower.worldToLocal(point);bottomError=Math.max(bottomError,Math.abs(point.z));}
      }
      const extra=window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE,c.upper.userData.sourceCanvas,{
        backCanvas:c.upper.userData.backCanvas,speciesId:'omgurku',gender:'male',neckRig:true});
      const skinned=extra.userData.omgurkuComposite.upper.userData.neckRig.available;
      const hasConnector=!!extra.userData.omgurkuComposite.connector;
      window.PNGPlaneAvatar.disposeAvatarModel(extra);
      return {topError,bottomError,skinned,hasConnector};
    });
    assert(contact.topError<1e-6&&contact.bottomError<1e-6,
      'both end strips remain exactly coplanar with their independently rotated sprite planes');
    assert.equal(contact.skinned,true,'the additional avatar uses the gameplay neck/skinned portrait path');
    assert.equal(contact.hasConnector,true,'gameplay skinned portraits also get their connector');
    await page.locator('#number_lowerDeadzoneDegrees').fill('58');
    await page.locator('#number_lowerDeadzoneDegrees').dispatchEvent('change');
    await page.locator('#saveLocalBtn').click();
    await page.locator('#connectorSave').click();
    const savedConnector=await page.evaluate(()=>{
      const k=window.HobunjiOmgurkuConnector.storageKey;
      return JSON.parse(localStorage.getItem(k));
    });
    assert.equal(savedConnector.enabled,true);
    assert.equal(savedConnector.upperInfluence,.9,'deformation influence survives the local rig save');
    assert.equal(savedConnector.sourceTop.length,5);
    assert.equal(savedConnector.sourceBottom.length,5);
    assert.equal(savedConnector.animalNeck.length,5);
    assert.equal(savedConnector.shrinkwrapDirections.sourceTop,90,'arrow directions survive local save');
    assert(savedConnector.imageDataUrl.startsWith('data:image/png;base64,'));
    const exported=await page.evaluate(()=>window.HobunjiOmgurkuConnectorAuthor.exportConfig());
    assert(!exported.imageDataUrl,'species export references PNG asset, not inline megabytes');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.HobunjiOmgurkuCalibration?.snapshot().hasComposite
      && [...(window.HobunjiOmgurkuConnector?.live||[])][0]?.mesh.visible,
      null,{timeout:55000});
    assert.equal(await page.evaluate(()=>window.HobunjiOmgurkuConnectorAuthor.snapshot().directions.sourceTop),90,
      'saved arrow directions restore after reload');
    assert.equal(await page.evaluate(()=>window.HobunjiOmgurkuConnector.snapshot().upperInfluence),.9,'deformation influence restores after reload');
    assert.equal(await page.evaluate(()=>window.HobunjiOmgurkuSpecies.debugSnapshot().placement.lowerDeadzoneDegrees),58,'lower deadzone restores after reload');
    assert.equal(await page.evaluate(()=>window.HobunjiOmgurkuConnectorAuthor.snapshot().uploaded),true,
      'saved PNG is restored into the author after reload');
    const imported=JSON.parse(fs.readFileSync(path.join(root,'docs/config/species/omgurku.json'),'utf8'));
    imported.hybridPlacement.saddleU=.377;
    imported.connector.enabled=true;imported.connector.sourceTop[2].x=.537;
    await page.locator('#fileInput').setInputFiles({name:'omgurku.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify(imported))});
    await page.waitForFunction(()=>window.HobunjiOmgurkuCalibration.snapshot().placement.saddleU===.377);
    const restored=await page.evaluate(()=>({rig:window.HobunjiOmgurkuConnector.snapshot({includeImage:true}),
      author:window.HobunjiOmgurkuConnectorAuthor.exportConfig()}));
    assert.equal(restored.rig.sourceTop[2].x,.537,'full species imports restore connector settings');
    assert.equal(restored.author.sourceTop[2].x,.537,'author controls follow imported connector settings');
    assert(restored.rig.imageDataUrl,'rig-only import preserves the uploaded artwork');
    await page.locator('#connectorClear').click();
    assert.equal((await page.evaluate(()=>window.HobunjiOmgurkuConnector.live.size)),0);
    assert.deepEqual(errors,[],'uncaught browser exceptions');
    console.log('Omgurku editor browser smoke passed');
  }finally{await closeBounded(browser);}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{server.close();exitWithResult();});
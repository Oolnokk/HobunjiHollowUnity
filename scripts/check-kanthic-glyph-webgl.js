'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:256,height:256}});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({path:require.resolve('three/build/three.min.js')});
    const source=fs.readFileSync('docs/js/cloud-forest-fog.js','utf8').replace('  function ordinaryBuildingInterior(area) {',
      '  window.__glyphTest=(deps,paint)=>{lightingDeps=deps;drawUnifiedLightingOverlay=()=>{paint();unifiedLightingPaintRevision++;};window.WeatherFX.drawLightingOverlay=drawUnifiedLightingOverlay;};window.__drawLanternTest=()=>drawLanternMasksCompat(1);\n  function ordinaryBuildingInterior(area) {');
    await page.evaluate(()=>{window.WeatherFX={init(){}};window.DevRandomRuinLichThemes={activeTheme:()=>'kanthic'};});
    await page.addScriptTag({content:source});
    await page.addScriptTag({path:require('node:path').resolve('docs/js/png-plane-outline-occluder.js')});
    const results=await page.evaluate(()=>{
      const T=THREE,api=CloudForestFog;
      const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
      renderer.setSize(128,128,false);document.body.appendChild(renderer.domElement);
      const camera=new T.OrthographicCamera(-2,2,2,-2,.1,20);camera.position.z=6;camera.lookAt(0,0,0);
      const scene=new T.Scene();scene.background=new T.Color(0x303030);
      PngPlaneOutlineOccluder.init({renderer,camera});
      const wall=new T.Mesh(new T.PlaneGeometry(4,4),new T.MeshBasicMaterial({color:0x404040}));scene.add(wall);
      const textureCanvas=document.createElement('canvas');textureCanvas.width=textureCanvas.height=4;
      const tx=textureCanvas.getContext('2d');tx.fillStyle='white';tx.fillRect(0,0,4,4);
      const glyph=new T.Mesh(new T.PlaneGeometry(4,4),new T.MeshBasicMaterial({map:new T.CanvasTexture(textureCanvas),color:0x00ff00,transparent:true,blending:T.AdditiveBlending,depthWrite:false,depthTest:true,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
      glyph.position.z=.01;glyph.name='engraving-glyph-glow';scene.add(glyph);
      const obstacle=new T.Mesh(new T.BoxGeometry(.6,4,.4),new T.MeshBasicMaterial({color:0x404040}));obstacle.position.set(-.5,0,1);scene.add(obstacle);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;document.body.appendChild(canvas);
      const ctx=canvas.getContext('2d');let region='room:a';
      const bounds={ 'room:a':{minX:-2,maxX:0,minZ:-1,maxZ:2,minY:-2,maxY:2},'room:b':{minX:0,maxX:2,minZ:-1,maxZ:2,minY:-2,maxY:2}};
      window.RuinRoomSystem={activeGlyphRegion:()=>region,glyphRegionBounds:id=>bounds[id]};
      window.__glyphTest({lctx:ctx,getCurrentArea:()=> 'map_i_dev_random_ruin',getSceneTransAlpha:()=>0},()=>{ctx.clearRect(0,0,1024,1024);ctx.fillStyle='rgba(0,0,0,.95)';ctx.fillRect(0,0,1024,1024);});
      const rt=new T.WebGLRenderTarget(128,128,{depthBuffer:true});
      let clock=1000;
      function frame(direct){
        const target=direct?null:rt;renderer.setRenderTarget(target);
        api.prepareKanthicGlyphFrame(scene,clock+=20,camera);
        try{
          renderer.render(scene,camera);
          if(!direct){renderer.autoClear=false;renderer.autoClearColor=false;renderer.autoClearDepth=false;renderer.autoClearStencil=false;PngPlaneOutlineOccluder.renderDepth(scene);renderer.autoClear=true;renderer.autoClearColor=true;renderer.autoClearDepth=true;renderer.autoClearStencil=true;}
          if(!api.renderKanthicGlyphFrame(renderer,camera,scene,direct))throw Error(JSON.stringify(api.getDebugState().ruinEngravingGlowMasks));
          function pixel(x){const a=new Uint8Array(4);if(target)renderer.readRenderTargetPixels(target,x,64,1,1,a);else renderer.getContext().readPixels(x,64,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,a);return [...a];}
          return {left:pixel(16),covered:pixel(48),right:pixel(112),spriteOpaque:pixel(19),spriteTransparent:pixel(32),diag:api.getDebugState().ruinEngravingGlowMasks};
        }finally{api.endKanthicGlyphFrame();}
      }
      const a=frame(false),b=frame(true);region='room:b';const c=frame(false);
      region='room:a';obstacle.visible=false;const d=frame(false);
      obstacle.visible=true;
      const actorTextureCanvas=document.createElement('canvas');actorTextureCanvas.width=actorTextureCanvas.height=16;
      const actorContext=actorTextureCanvas.getContext('2d');actorContext.fillStyle='#404040';actorContext.fillRect(0,0,8,16);
      const actorTexture=new T.CanvasTexture(actorTextureCanvas);actorTexture.minFilter=actorTexture.magFilter=T.NearestFilter;actorTexture.generateMipmaps=false;
      const actor=new T.Mesh(new T.PlaneGeometry(.8,4),new T.MeshBasicMaterial({map:actorTexture,transparent:true,alphaTest:.1,depthWrite:false,depthTest:true,side:T.DoubleSide}));actor.position.set(-1.2,0,1.5);scene.add(actor);PngPlaneOutlineOccluder.markPngPlane(actor);
      const spriteTarget=frame(false),spriteDirect=frame(true);
      region=null;api.prepareKanthicGlyphFrame(scene,clock+=20,camera);api.endKanthicGlyphFrame();
      const restored=canvas.style.visibility===''&&glyph.visible&&glyph.material.clippingPlanes===null&&renderer.localClippingEnabled===false;
      // Exercise the production cylinder geometry against actual rendered pixels.
      const voidScene=new T.Scene();voidScene.background=new T.Color(0x303030);
      const previousFetch=window.fetch;
      window.fetch=async()=>({ok:true,json:async()=>({})});
      api.init({THREE:{...T,TextureLoader:class{load(){}}},TILE:1,player:{x:0,y:0},
        getPlayerGroundY:()=>0,isCloudForestArea:()=>false,getCurrentArea:()=> 'map_i_dev_random_ruin',getActiveScene:()=>voidScene});
      window.fetch=previousFetch;
      api.update(.016);
      camera.position.set(0,1,3);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
      const farWall=new T.Mesh(new T.PlaneGeometry(4,4),new T.MeshBasicMaterial({color:0xffffff}));
      farWall.position.set(0,1,-6);voidScene.add(farWall);
      const nearWall=new T.Mesh(new T.PlaneGeometry(.6,2),new T.MeshBasicMaterial({color:0xffffff}));
      nearWall.position.set(-1,1,2.4);voidScene.add(nearWall);
      const farRune=new T.Mesh(new T.PlaneGeometry(.6,2),glyph.material.clone());
      farRune.name='engraving-glyph-glow';farRune.position.set(1,1,-5.99);voidScene.add(farRune);
      region='room:void';bounds[region]={minX:-2,maxX:2,minZ:-7,maxZ:2,minY:-2,maxY:4};
      function voidFrame(direct){
        const target=direct?null:rt;renderer.setRenderTarget(target);
        api.prepareKanthicGlyphFrame(voidScene,clock+=20,camera);
        try{
          renderer.render(voidScene,camera);
          if(!direct)api.renderOutlineMist(renderer,camera,voidScene);
          if(!api.renderKanthicGlyphFrame(renderer,camera,voidScene,direct))throw Error('void glyph pass not drawn');
          function pixel(x){const a=new Uint8Array(4);if(target)renderer.readRenderTargetPixels(target,x,64,1,1,a);else renderer.getContext().readPixels(x,64,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,a);return [...a];}
          return {near:pixel(32),far:pixel(64),rune:pixel(96)};
        }finally{api.endKanthicGlyphFrame();}
      }
      const voidTarget=voidFrame(false),voidDirect=voidFrame(true);
      // Keep the player still while the actual view camera pans, cuts and returns.
      const mistGroup=voidScene.getObjectByName('cloud_forest_mist_cylinders');
      const projected=new T.Vector3();
      const fixedPlayer={x:-1.5,y:0};
      const portraitRoot=new T.Group(), portrait=new T.Mesh(new T.PlaneGeometry(.8,1.2),new T.MeshBasicMaterial());
      portraitRoot.add(portrait);voidScene.add(portraitRoot);
      portraitRoot.userData.neckRig={skinnedPlane:portrait};
      window.PlayerBodyTransformComposer={getPlayerMesh:()=>portraitRoot};
      let cinematic=false;
      window.RuinRoomSystem.lightAllowed=()=>!cinematic; // Camera lantern cannot be rejected by a remote player's room ownership.
      window.RuinRoomSystem.withLightClip=(_ctx,_source,_project,draw)=>cinematic?false:draw();
      window.__glyphTest({lctx:ctx,camera,player:fixedPlayer,TILE:1,npcWalkers:[],getPlayerWorldY:()=>0,
        getCurrentArea:()=> 'map_i_dev_random_ruin',getActiveScene:()=>voidScene,getSceneTransAlpha:()=>0,
        getThreeRect:()=>({width:1024,height:1024}),worldToOverlay:(x,y,z)=>{
          projected.set(x,y,z).project(camera);
          return {x:(projected.x+1)*512,y:(1-projected.y)*512};
        }},()=>{});
      window.CinematicCameraRuntime={isActive:()=>cinematic};
      window.RuinRoomSystem.glyphRegionAt=x=>x>10?'room:shot':region;
      bounds['room:shot']={minX:10,maxX:20,minZ:0,maxZ:10,minY:0,maxY:10};
      function cameraSample(x,y,z,tx,ty,tz,shot,playerX,playerZ,portraitOffset=.35,detached=false){
        cinematic=shot;fixedPlayer.x=playerX;fixedPlayer.y=playerZ;
        portraitRoot.position.set(playerX,0,playerZ);
        portrait.position.set(Math.sign(playerX)*.22,portraitOffset,.2); // Rendered pose differs from the logical floor anchor.
        if(detached)portraitRoot.remove(portrait);else if(portrait.parent!==portraitRoot)portraitRoot.add(portrait);
        camera.position.set(x,y,z);camera.lookAt(tx,ty,tz);camera.updateMatrixWorld(true);
        api.update(.016); // Simulate ordinary gameplay mist placement before final render-camera sync.
        api.prepareKanthicGlyphFrame(voidScene,clock+=20,camera);
        try{
          const diag=api.getDebugState(),anchor=diag.kanthicCameraAtmosphere;
          const dir=camera.getWorldDirection(new T.Vector3());
          const expected=camera.position.clone().addScaledVector(dir,.75);
          const expectedLight=shot?camera.position.clone().addScaledVector(dir,2.25):detached?new T.Vector3(fixedPlayer.x,.5,fixedPlayer.y):portrait.getWorldPosition(new T.Vector3());
          const exact=mistGroup.children.every(m=>m.position.distanceTo(expected)<1e-8);
          const lightExact=new T.Vector3(anchor.lantern.x,anchor.lantern.y,anchor.lantern.z).distanceTo(expectedLight)<1e-8;
          ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,1024,1024);ctx.fillStyle='black';ctx.fillRect(0,0,1024,1024);
          window.__drawLanternTest();
          const lightPixel=expectedLight.clone().project(camera);
          const lx=Math.round((lightPixel.x+1)*512),ly=Math.round((1-lightPixel.y)*512);
          return {exact,lightExact,mode:anchor.lantern.mode,source:anchor.lantern.anchor,detached,radius:anchor.lantern.radiusTiles,apiRadius:api.getKanthicLanternRadiusTiles(),shot,region:diag.ruinEngravingGlowMasks.region,alpha:ctx.getImageData(lx,ly,1,1).data[3],centerAlpha:ctx.getImageData(512,512,1,1).data[3]};
        }finally{api.endKanthicGlyphFrame();}
      }
      const cameraSamples=[cameraSample(0,1,3,0,1,0,false,-1.5,0),
        cameraSample(0,1,3,0,1,0,false,1.5,0), // Player moves while the camera is still.
        cameraSample(0,1,3,0,1,0,true,-100,-100), // Mode changes with no camera movement.
        cameraSample(4,3,4,7,2,4,true,-100,-100),cameraSample(14,6,5,17,5,5,true,-100,-100),
        cameraSample(0,1,3,0,1,0,true,-100,-100),
        cameraSample(0,1,3,0,1,0,false,-1.5,0), // Return to portrait ownership without camera movement.
        cameraSample(0,1,3,0,1,0,false,-1.5,0,1.25), // Portrait alone moves vertically while the player and camera stay still.
        cameraSample(0,1,3,0,1,0,false,-1.5,0,.35,true), // Detached rig safely falls back to logical player coordinates.
        cameraSample(0,1,3,0,1,0,false,-1.5,0)]; // Reattached portrait takes ownership again.
      rt.dispose();renderer.dispose();
      return {a,b,c,d,spriteTarget,spriteDirect,restored,voidTarget,voidDirect,cameraSamples};
    });
    for(const x of [results.a,results.b]){
      assert(x.left[1]>150,'unoccluded active-room glyph is bright: '+JSON.stringify(x));
      assert(x.covered[1]<25,'foreground stone occludes only its covered pixels: '+JSON.stringify(x));
      assert(x.right[1]<25,'same large mesh is clipped at neighboring-room boundary: '+JSON.stringify(x));
      assert(x.diag.uploadPixels<=524288,'large mobile darkness buffer upload is bounded');
    }
    assert(results.c.left[1]<25&&results.c.right[1]>150,'switching rooms reverses only the occupied portion of the same panel');
    assert(results.d.covered[1]>150,'removing the occluder restores the actual hidden rune pixels');
    for(const x of [results.spriteTarget,results.spriteDirect]){
      assert(x.spriteOpaque[1]<25,'opaque alpha-tested actor pixels block glyphs: '+JSON.stringify(x));
      assert(x.spriteTransparent[1]>150,'transparent actor texels retain visible wall glyphs: '+JSON.stringify(x));
      assert(x.covered[1]<25,'sprite replay with a colored scene background must not clear the preexisting wall depth: '+JSON.stringify(x));
    }
    for(const x of [results.voidTarget,results.voidDirect]){
      assert(x.near[0]>4,'near geometry retains visible ambient light: '+JSON.stringify(x));
      assert(x.far.slice(0,3).every(c=>c===0),'ordinary geometry beyond the outer cylinder is black: '+JSON.stringify(x));
      assert(x.rune[1]>150,'the distant rune pierces the same outer cylinder: '+JSON.stringify(x));
    }
    for(const sample of results.cameraSamples){
      assert(sample.exact&&sample.lightExact,'mist follows the camera and lantern follows the correct owner: '+JSON.stringify(sample));
      assert.equal(sample.mode,sample.shot?'camera':'player');
      assert.equal(sample.radius,2,'debug reports the 2-tile default');
      assert.equal(sample.apiRadius,2,'rope and other light consumers receive the same radius');
      assert(sample.alpha<100,'real lantern mask opens at its selected source: '+JSON.stringify(sample));
      if(!sample.shot){
        assert.equal(sample.source,sample.detached?'ground-fallback':'portrait-plane');
        assert(sample.centerAlpha>180,'normal gameplay does not illuminate the camera center instead of the player: '+JSON.stringify(sample));
      }
    }
    assert.equal(results.cameraSamples[4].region,'room:shot','cinematic glyph ownership follows the rendered view');
    assert.equal(results.cameraSamples[6].region,'room:void','returning to gameplay restores player-room ownership');
    assert(results.restored,'DOM canvas, source visibility, material clipping and renderer state restore');
    assert.deepEqual(errors,[],'no WebGL or page errors');
    console.log('Kanthic real WebGL: target/direct partial occlusion, room clipping, bounded upload and cleanup OK');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

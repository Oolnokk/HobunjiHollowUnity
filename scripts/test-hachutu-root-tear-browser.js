#!/usr/bin/env node
'use strict';
// Real Three.js r128/browser check for the player's root-tear snapshot,
// skeletal skinning, visual-only flying fragments and cinematic teardown.
// Run with Playwright + three installed; the test owns its local HTTP fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch(error){if(error.code==='MODULE_NOT_FOUND'){console.log('skip: playwright unavailable');process.exit(0);}throw error;}
const repo=path.resolve(__dirname,'..'),three=require.resolve('three/build/three.min.js');
const scripts=['js/cinematic-camera-runtime.js','js/root-snare-toss.js','js/root-snare-runner.js','js/root-snare-player-tear.js'];
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname==='/'){response.setHeader('Content-Type','text/html');response.end(
    '<!doctype html><html><head><script src="/three.min.js"></script>'+scripts.map(file=>
      '<script src="/'+file+'"></script>').join('')+'</head><body></body></html>');return;}
  if(url.pathname==='/three.min.js'){response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(three));return;}
  if(!scripts.includes(url.pathname.slice(1))){response.writeHead(404);response.end();return;}
  response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(path.join(repo,'docs',url.pathname)));
});
(async()=>{
  let browser=null;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage(),pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(String(error)));
    await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
    const result=await page.evaluate(()=>{
      const T=window.THREE,scene=new T.Scene(),root=new T.Group();
      root.name='actual-player-rig';root.position.set(5,0,5);scene.add(root);
      const bodyGeometry=new T.BoxGeometry(.8,1.4,.18,2,7,1);
      bodyGeometry.translate(0,1.08,0);
      const position=bodyGeometry.getAttribute('position');
      const indices=[],weights=[];
      for(let i=0;i<position.count;i++){indices.push(0,0,0,0);weights.push(1,0,0,0);}
      bodyGeometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));
      bodyGeometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
      const body=new T.SkinnedMesh(bodyGeometry,new T.MeshBasicMaterial({color:0xcbb19b}));
      body.name='real skinned spine/neck plane';
      const bone=new T.Bone(),bones=new T.Skeleton([bone]);
      body.add(bone);body.bind(bones);bone.position.set(0,.17,0);
      root.add(body);
      const feet=new T.Mesh(new T.BoxGeometry(.42,.3,.21),new T.MeshBasicMaterial({color:0x62584a}));
      feet.position.y=.16;feet.name='procedural leg mesh';root.add(feet);
      const directDeath=[];
      const player={x:5*64,y:5*64,health:100,vx:4,vy:-3};
      window.PlayerBodyTransformComposer={getPlayerMesh:()=>root};
      window.PlayerDowned={dieImmediately(reason){directDeath.push(reason);player.health=0;return true;}};
      const handNeck={point:new T.Vector3(6,1.8,5)},handFeet={point:new T.Vector3(4,.3,5)};
      const api=window.RootSnarePlayerTear;
      const failures=[];
      const check=(condition,message)=>{if(!condition)failures.push(message);};
      check(!!api?.begin&&!!window.RootSnareRunner?.pullPose&&!!window.RootSnareToss?.create,'real modules did not load');
      const start=()=>api.begin({player,scene,areaId:'map_i_dev_random_ruin',
        floorY:0,neckAnchor:handNeck,feetAnchor:handFeet});
      check(start(),'live SkinnedMesh and independent leg mesh must be capturable');
      let shot=window.CinematicCameraRuntime?.activeRecord?.();
      check(shot?.camera?.id==='hachutu-root-tear','capture should use the real shared cinematic camera runtime');
      check(root.visible===false,'real player is hidden while disposable snapshots animate');
      const initial=api.debug();
      check(initial.fullHeight>1.6,'snapshot must measure actual skinned head-to-sole world height');
      check(initial.triangles>20,'snapshot should include skinned torso and foot vertices');
      for(let i=0;i<121;i++)api.update(.05);
      const split=api.debug();
      check(split.stage==='toss'&&split.tossed,'two visual-only body fragments must detach after the 6-second authored pull');
      check(directDeath.length===0,'real player cannot die before the finishing toss has been displayed');
      check(root.visible===false,'real player must remain hidden through the throw');
      for(let i=0;i<22;i++)api.update(.05);
      check(directDeath.length===1&&directDeath[0]==='hachutu-root-hands','finisher invokes authoritative immediate death once');
      check(!api.active()&&root.visible,'original intact skin and bones must be restored for respawn');
      check(!window.CinematicCameraRuntime?.activeRecord?.(),'only the owned cinematic shot should be deactivated');
      player.health=100;
      check(start(),'repeat capture should not leak the first snapshot or its disposed geometry');
      for(let i=0;i<7;i++)api.update(.05);
      check(api.stop('dodge')===true,'funded dodge must cancel before the final pull');
      check(root.visible===true&&directDeath.length===1,'dodge restores original body without executing');
      const sceneFragments=scene.children.filter(x=>/Hachutu visual-only split avatar/.test(x.name));
      check(sceneFragments.length===0,'no visual clone remains in the scene after dodge/death');
      return {failures,initial,split,deathCount:directDeath.length,sceneFragments:sceneFragments.length,
        camera:shot?.camera?.id,final:api.debug(),bones:!!body.skeleton,feet:!!feet.parent};
    });
    assert.deepEqual(result.failures,[],JSON.stringify(result,null,2));
    assert.equal(pageErrors.length,0,'page script errors: '+pageErrors.join('; '));
    console.log('PASS real Three.js root-tear browser: live bones + full-size legs, 6s pull, dual-clone toss, instant death, dodge, cleanup');
  }finally{await browser?.close?.();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

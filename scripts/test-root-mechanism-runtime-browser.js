'use strict';
// Exercises actual Three.js, native V50 capture, roots and the gameplay support registry.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;console.log('skip: playwright not installed (browser-only root runtime)');process.exit(0);}
const root=path.resolve(__dirname,'..'),server=http.createServer((request,response)=>{
 const route=(request.url||'/').split('?')[0];
 if(route==='/root-runtime-test'){
  response.setHeader('Content-Type','text/html');response.end('<!doctype html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'+['foliage-generator','live-root-network','live-root-growth','live-root-mechanisms','dynamic-surfaces','dev-random-ruin-solid-footprints'].map(name=>'<script src="/js/'+name+'.js"></script>').join('')+'</head><body></body>');return;
 }
 const file=path.resolve(root,'docs',decodeURIComponent(route).replace(/^\//,''));if(!file.startsWith(path.join(root,'docs')+path.sep)){response.writeHead(403);response.end();return;}
 fs.readFile(file,(error,bytes)=>{if(error){response.writeHead(404);response.end();return;}response.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.png')?'image/png':'text/plain');response.end(bytes);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(require.resolve('three/build/three.min.js'))}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/root-runtime-test');
  await page.evaluate(()=>{const frame=document.createElement('iframe');frame.id='native';frame.src='/tools/debris-ifier/index.html?devRuntime=1';document.body.append(frame);});
  await page.waitForFunction(()=>document.getElementById('native').contentWindow.DebrisifierV50?.captureRootMechanismKeyframes,{},{timeout:45000});
  const result=await page.evaluate(async()=>{
   const T=THREE,native=document.getElementById('native').contentWindow.DebrisifierV50,DS=DynamicSurfaces,scene=new T.Scene();native.pausePreviewLoop();
   const check=(condition,message)=>{if(!condition)throw Error(message);},recipe={floorDensity:.1,targetDensity:.3,strandLimit:12,branchCount:2,seed:'root-runtime-qa'},finish={color:'#24211d',texture:null};
   const build=async(source,type,extra={})=>{scene.add(source);const specification=native.captureRootMechanismKeyframes(source);return LiveRootMechanisms.bindRuntimeAsync({THREE:T,source,type,specification,scene,surfaces:DS,scope:'root-test',id:type,foliage:FoliageGenerator,recipe,rootFinish:finish,...extra});};
   const bridge=new T.Mesh(new T.BoxGeometry(3.6,.2,1.2).translate(1.8,0,0),new T.MeshBasicMaterial());bridge.position.set(10,.2,20);bridge.scale.x=.08;bridge.userData.previewMotion={type:'bridge',minScale:.08,maxScale:1};
   const original=bridge.material,transforms=bridge.matrixWorld.elements.slice();let binding=await build(bridge,'bridge');
   check(bridge.material.visible===false,'native guide hidden');check(!DS.sampleSupport(13,20,{scope:'root-test'}),'future bridge must not support before growing');
   native.applyProgress(bridge,.5);check(DS.sampleSupport(13,20,{scope:'root-test'}),'overlap grows new bridge before retracting old');
   native.applyProgress(bridge,1);check(DS.sampleSupport(13,20,{scope:'root-test'}),'grown bridge is walkable');check(binding.controller.states[0].partPlan[0].mesh.scale.x===.08&&binding.controller.states[1].partPlan[0].mesh.scale.x===1,'rendered keyframe guides must stay fixed');
   binding.dispose();check(!DS.sampleSupport(13,20,{scope:'root-test'}),'disposal removes collision');check(bridge.material===original,'original material restored');
   const door=new T.Mesh(new T.BoxGeometry(1.4,2,.2).translate(0,-1,0),new T.MeshBasicMaterial());door.position.set(4,2,4);door.userData.previewMotion={type:'stoneDoor',minScale:.06,maxScale:1};let occupied=false;
   binding=await build(door,'stoneDoor',{isOccupied:()=>occupied});const footprints=DevRandomRuinSolidFootprints.createSet();footprints.scan(door,'door',{force:true,enabled:()=>binding.isDoorClosed()});check(footprints.blocksBox(4,4,.2),'hidden native door retains the real collision footprint');check(binding.isDoorClosed(),'initial roots block door');native.applyProgress(door,1);check(!binding.isDoorClosed(),'retraction clears door');check(!footprints.blocksBox(4,4,.2),'open roots clear the real collision footprint');occupied=true;native.applyProgress(door,0);check(!binding.isDoorClosed(),'occupied doorway must not regrow closed');occupied=false;native.applyProgress(door,0);check(binding.isDoorClosed(),'clear doorway closes');check(binding.controller.states[0].partPlan[0].mesh.scale.y===1,'closed rooted pose stays fixed');binding.dispose();
   // A real moving-platform metadata contract, including a payload that must not become the deck.
   const dais=new T.Group(),platform=new T.Mesh(new T.BoxGeometry(1.5,.2,1.5),new T.MeshBasicMaterial()),payload=new T.Mesh(new T.BoxGeometry(.4,1,.4),new T.MeshBasicMaterial());payload.position.y=.6;payload.userData.groundedToMovingPlatform=true;platform.add(payload);dais.add(platform);dais.position.set(20,0,10);platform.position.y=.1;dais.userData.previewMotion={type:'movingDais',lowY:.1,highY:1.2};dais.userData.movingDaisPlatform=platform;scene.add(dais);
   const spec=native.captureRootMechanismKeyframes(dais);check(spec.states.length>=6,'lift needs intermediate fixed growth states');check(platform.position.y===.1,'capture restores native platform');
   const heights=spec.states.map(state=>{let top=-Infinity;state.target.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.rootSupportEligible)top=Math.max(top,new T.Box3().setFromObject(mesh).max.y);});return top;});for(let i=1;i<heights.length;i++)check(heights[i]-heights[i-1]<=.251,'root elevation stays within step clearance');
   binding=await LiveRootMechanisms.bindRuntimeAsync({THREE:T,source:dais,type:'movingDais',specification:spec,scene,surfaces:DS,scope:'root-test',id:'lift',foliage:FoliageGenerator,recipe,rootFinish:finish});
   let previous=DS.sampleSupport(20,10,{scope:'root-test'}).y;const liftHeights=[previous];
   for(let step=1;step<=100;step++){native.applyProgress(dais,step/100);const support=DS.sampleSupport(20,10,{scope:'root-test'});check(support,'lift support cannot disappear during growth');check(support.y-previous<=.251,'support cannot teleport player upward');previous=support.y;liftHeights.push(previous);}
   check(Math.abs(previous-1.3)<.001,'lift reaches deck height, not payload height');check(platform.position.y===1.2,'hidden logical platform continues positioning child interactions');binding.dispose();
   // Linked native signals are sampled at both endpoints and restored exactly.
   const signal={userData:{solveProgress:.37}};door.userData.linkedCubePuzzleRoot=signal;const signaled=native.captureRootMechanismKeyframes(door);check(signaled.states.length===2,'linked signal must not collapse keyframes');check(signal.userData.solveProgress===.37,'capture must restore linked signal');signaled.dispose();
   const aborted=new AbortController();aborted.abort();const cancelled=native.captureRootMechanismKeyframes(door);let cancelledOK=false;try{await LiveRootMechanisms.bindRuntimeAsync({THREE:T,source:door,type:'stoneDoor',specification:cancelled,scene,surfaces:DS,scope:'root-test',id:'cancel',foliage:FoliageGenerator,recipe,rootFinish:finish,signal:aborted.signal});}catch(error){cancelledOK=error.name==='AbortError';}check(cancelledOK&&!door.rootGrowthBinding,'cancelled runtime cannot publish');
   // Execute the actual adapter owner with only its host injection seam replaced.
   window.DevSpawner={init(){}};window.GridTileAccessors={init(){}};window.DevRandomRuinTileOccupancy={};window.DevRandomRuinSolvability={};
   const adapter=await (await fetch('/js/dev-random-ruin-interior-map.js')).text();
   (0,eval)(adapter.replace('  window.DevRandomRuin=Object.freeze(',"  window.__rootOwnerTest={prepare:prepareRootMechanisms,tick:updateMechanisms,clear:clearRuntime,seed:owner=>{ruin=owner;floorHeights.set('8,18',0);deps={player:{x:10,y:20},TILE:1};}};\n  window.DevRandomRuin=Object.freeze("));
   bridge.scale.x=.08;const locale=new T.Group();locale.add(bridge);scene.add(locale);let destroyed=false;
   const mechanism={id:'test-bridge',type:'bridge',root:bridge,progress:0,target:0,externalTarget:null},owner={api:native,sourceSeed:'owner-test',scene,localeRoot:locale,mechanisms:new Map([['test-bridge',mechanism]]),transitDoorStates:[],activators:[],occlusionMeshes:[bridge],occupancy:{refresh:()=>false,destroy(){destroyed=true;}}};
   DS.registerSurface({id:'native-deck-fixture',scope:'dev-random-ruin-interior',bounds:{minX:9,maxX:11,minZ:19,maxZ:21},topY:.3});
   __rootOwnerTest.seed(owner);await __rootOwnerTest.prepare(owner,recipe);check(owner.rootGrowthBindings.length===1&&owner.rootedMechanisms,'real adapter publishes root mode');check(owner.rootGrowthBindings[0].controller.recipe.floorY===-.2,'source vegetation uses terrain rather than the native moving deck');check(!owner.occlusionMeshes.includes(bridge)&&owner.occlusionMeshes.length>0,'camera occlusion switches to grown meshes');
   check(DevRandomRuin.setMechanismTarget('test-bridge',1),'composer signal must reach real owner');for(let i=0;i<4;i++)__rootOwnerTest.tick(.25);check(owner.rootGrowthBindings[0].controller.getPoseProgress()===1,'owner progress drives rooted binding');
   DevRandomRuin.lockMechanism('test-bridge');for(let i=0;i<4;i++)__rootOwnerTest.tick(.25);check(owner.rootGrowthBindings[0].controller.getPoseProgress()===0,'locks retract rooted mechanisms');
   DevRandomRuin.unlockMechanism('test-bridge');for(let i=0;i<4;i++)__rootOwnerTest.tick(.25);check(owner.rootGrowthBindings[0].controller.getPoseProgress()===1,'unlock restores rooted activation');
   __rootOwnerTest.clear(false);check(destroyed&&!bridge.rootGrowthBinding,'owner teardown releases bindings');check(DS.debugSnapshot().surfaces.length===0,'owner teardown leaves no orphan support');
   return {liftStates:heights.length,liftHeights:[liftHeights[0],liftHeights.at(-1)],surfaces:DS.debugSnapshot()};
  });
  assert(errors.length===0,errors.join('\n'));console.log('Root mechanism runtime browser passed: native trigger progress, actual grown supports, door occupancy safety, immutable guides, lift steps/payload exclusion, linked signal restoration, disposal and cancellation.',JSON.stringify(result));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

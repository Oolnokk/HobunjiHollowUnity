'use strict';
// Real Three.js r128 author-only regression: fixed root nodes, procedural runner,
// dormant/reaching/retracting hands, and sixteen void-safe Temple growth regions.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch(error){if(error.code==='MODULE_NOT_FOUND'){console.log('skip: playwright unavailable');process.exit(0);}throw error;}
const repo=path.resolve(__dirname,'..'),three=path.join(repo,'node_modules/three/build/three.min.js');
const scripts=['config/scratchbones-config.js','js/color-fill.js','js/portrait-utils.js','js/portrait-breathing.js','js/npc-avatar-preview-utils.js','js/png-plane-avatar.js','config/pants-rigs.js','js/pants-rig-core.js','js/pants-garment-renderer.js','js/leg-bones.js','js/procedural-leg-animation.js','js/foliage-generator.js','js/live-root-growth.js','js/stone-age-ruin-scenery.js','js/root-snare-hands.js','js/root-snare-toss.js','js/root-snare-runner.js'];
const server=http.createServer((request,response)=>{
  const route=decodeURIComponent((request.url||'/').split('?')[0]);
  if(route==='/tools/live-root-growth/snare-fixture'){
    response.setHeader('Content-Type','text/html');
    // Intentionally serve the test at the REAL nested tool pathname; the
    // href base affects HTML fetches but does NOT affect window.location.href.
    // This catches species JSON accidentally being resolved under tools/.
    response.end('<!doctype html><html><head><base href="../../"><script src="/vendor-three.js"></script>'+
      scripts.map(s=>'<script src="'+s+'"></script>').join('')+'</head><body></body></html>');return;
  }
  if(route==='/vendor-three.js'){response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(three));return;}
  const file=path.resolve(repo,'docs',route.replace(/^\/+/,''));
  if(!file.startsWith(path.join(repo,'docs')+path.sep)){response.writeHead(403);response.end();return;}
  fs.readFile(file,(err,data)=>{if(err){response.writeHead(404);response.end(err.message);return;}
    const mime=file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':file.endsWith('.jpg')?'image/jpeg':'text/javascript';
    response.setHeader('Content-Type',mime);response.end(data);});
});
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage(),pageErrors=[];
    const speciesRequests=[]; // Real network URLs prove that the species registry lives at docs/config.
    page.on('request',request=>{if(request.url().includes('species/index.json'))speciesRequests.push(new URL(request.url()).pathname);});
    page.on('pageerror',error=>pageErrors.push(String(error)));
    await page.goto('http://127.0.0.1:'+server.address().port+'/tools/live-root-growth/snare-fixture',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!(window.RootSnareHands?.create&&window.RootSnareToss?.create&&window.RootSnareRunner?.create&&window.ProceduralLegAnimation?.attach&&window.StoneAgeRuinScenery?.buildFloorCoverSectors));
    const result=await page.evaluate(async()=>{
      const T=window.THREE;
      const assert=(condition,message)=>{if(!condition)throw Error(message);};
      const roomModel=new T.Group(),wall=new T.Mesh(new T.BoxGeometry(8,2.5,.10),new T.MeshBasicMaterial());
      wall.position.set(0,1.3,-4);wall.userData.ruinPreviewRole='wall';roomModel.add(wall);
      const floor=new T.Mesh(new T.BoxGeometry(8,.1,8),new T.MeshBasicMaterial());floor.userData.ruinPreviewRole='floor';roomModel.add(floor);
      const room={model:roomModel,floorY:0};
      const positions=[],uvs=[];
      for(let ring=0;ring<550;ring++)for(let spoke=0;spoke<6;spoke++){
        const angle=spoke*Math.PI*2/5,radius=.025;
        positions.push(-3.3+ring*.012+Math.cos(angle)*radius,1.1+Math.sin(angle)*radius,
          -3.95+Math.sin(ring*.015)*.025);
        uvs.push(spoke/5,ring/549);
      }
      const tube=new T.BufferGeometry();tube.setAttribute('position',new T.Float32BufferAttribute(positions,3));
      tube.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
      const layer=new T.Group();layer.add(new T.Mesh(tube,new T.MeshBasicMaterial()));
      const anchorsA=window.RootSnareHands.findWallRootNodes(T,room,[layer],'exact-fixed-seed',6);
      const anchorsB=window.RootSnareHands.findWallRootNodes(T,room,[layer],'exact-fixed-seed',6);
      assert(anchorsA.length>0,'actual root surface rings must yield hidden wall nodes');
      assert(JSON.stringify(anchorsA.map(a=>a.point.toArray()))===JSON.stringify(anchorsB.map(a=>a.point.toArray())),
        'the same authored roots and seed must retain identical waiting nodes');
      // Floor-root nodes are real generator surface nodes as well; their sprouts
      // can point up or diagonally, not just horizontally away from wall faces.
      const floorLayer=new T.Group(),floorRoot=layer.children[0].clone();
      floorRoot.position.y=-1.065;floorRoot.position.z=3.95;floorLayer.add(floorRoot);
      const both=window.RootSnareHands.sourceNodes(T,room,
        [{layer,role:'wall'},{layer:floorLayer,role:'floor'}],'two-surface-test');
      assert(both.some(n=>n.role==='wall')&&both.some(n=>n.role==='floor'),
        'actual wall AND floor root nodes should both provide fixed snare anchors');

      const maths=window.RootSnareRunner.tugMultiplier,front=new T.Vector3(1,0,0);
      assert(Math.abs(maths(front,front)-2)<1e-8,'toward source must double movement speed');
      assert(Math.abs(maths(front,front.clone().negate())-.5)<1e-8,'away from source must halve movement speed');
      assert(Math.abs(maths(front,new T.Vector3(0,0,1))-1.25)<1e-8,'90 degree tug must blend endpoints');
      const one=window.RootSnareHands.create({THREE:T,room,rootLayers:[{layer,role:'wall'}],
        seed:'exact-fixed-seed',count:1,triggerRadius:15,reach:15,extendSpeed:.2});
      assert(one.settings.triggerRadius===15&&one.settings.reach===15&&one.settings.extendSpeed===.2,
        'requested slow 15-unit defaults must be active');
      assert(one.diagnostics().states[0].digits===3&&
        one.diagnostics().states[0].digitRoles.join(',')==='finger,finger,thumb',
        'each woody branch fork must keep exactly two articulated fingers and one thumb');
      const actor=new T.Group(),captured={group:actor,running:true,neck:null,freed:false,
        setNeckGrip(node){this.neck=node;},clearNeckGrip(){this.neck=null;},
        setRunning(v){this.running=v;},chooseTarget(){this.freed=true;}};
      const anchor=one.anchors[0];
      actor.position.copy(anchor.point).addScaledVector(anchor.direction,.67);
      actor.position.y-=1.38; // The actual sphere is compared with the neck in this preview.
      for(let i=0;i<3;i++)one.update(.033,captured);
      assert(one.diagnostics().states.some(x=>x.state==='approaching'&&!x.wrapped),
        'branches should remain open during initial extension');
      actor.position.x+=.18; // Change course while the *arm* is still growing.
      for(let i=0;i<340;i++)one.update(.033,captured);
      assert(one.diagnostics().neckGrip&&captured.neck,
        'the first true collider contact must attach to the neck');
      assert(captured.running,'one neck grip must NOT freeze the procedural runner');
      assert(one.diagnostics().states[0].reroutes>0,'the arm branch must steer its segments in-flight');
      assert(one.releaseCaptured()&&!captured.neck,'manual release must clear the directional neck tug');
      actor.position.set(100,0,100);
      for(let i=0;i<120;i++)one.update(.033,captured);
      assert(one.group.children.filter(x=>x.name.startsWith('Hidden root snare')).every(x=>!x.visible),
        'released branch hands must fully conceal again');
      one.setNodeVisibility(true);
      assert(one.group.children.some(x=>x.name.startsWith('Show hidden branch node')&&x.visible),
        'author markers reveal the original fixed branches');
      one.dispose();

      const runner=window.RootSnareRunner.create({THREE:T,room,speed:5,seed:'runner-test'});
      assert(runner.diagnostics().authenticFeet,'NPC must use the shared procedural gait');
      assert(runner.diagnostics().speed===5,'runner must default to five units per second');
      const initial=runner.group.position.clone();
      for(let i=0;i<120;i++)runner.update(.033);
      assert(initial.distanceTo(runner.group.position)>.1,'running NPC should navigate the room');
      runner.group.position.set(0,0,0); // Use the room center so direction checks cannot accidentally hit a boundary.
      runner.setNeckGrip({point:runner.group.position.clone().add(new T.Vector3(-1,0,0))});
      runner.headToAnchor(true);runner.update(.04);
      const away=runner.diagnostics().movementMultiplier;
      runner.headToAnchor(false);runner.update(.04);
      const toward=runner.diagnostics().movementMultiplier;
      assert(Math.abs(away-.5)<.02&&Math.abs(toward-2)<.02,
        'directional movement must yield 0.5× away and 2× toward a captured hand');
      runner.clearNeckGrip();assert(runner.diagnostics().neckTether===false,'tug must clear at release');

      const pair=window.RootSnareHands.create({THREE:T,room,rootLayers:[{layer,role:'wall'}],
        seed:'exact-fixed-seed',count:6,triggerRadius:15,reach:15,extendSpeed:.2});
      assert(pair.anchors.length>=2,'test room needs at least two hidden branch nodes');
      const stationary=new T.Group();stationary.position.copy(pair.anchors[0].point);
      stationary.position.addScaledVector(pair.anchors[0].direction,.62);stationary.position.y-=1.38;
      const natural={group:stationary,grips:[],running:true,setNeckGrip(a){this.grips.push('neck');},
        startDualCapture(a,b){this.grips.push('feet');this.running=false;},
        clearNeckGrip(){this.grips=[];},setRunning(v){this.running=v;},chooseTarget(){}};
      for(let i=0;i<440;i++)pair.update(.033,natural);
      assert(pair.diagnostics().dual&&natural.grips.join(',')==='neck,feet',
        'real sequential collider contacts must assign the first hand to the neck and second to the feet');
      assert(pair.releaseCaptured(),'natural two-hand capture should reset before manual animation demo');
      assert(pair.previewDoubleGrip(runner),'author preview must provide a reproducible two-grip trigger');
      assert(pair.diagnostics().neckGrip&&pair.diagnostics().feetGrip&&pair.diagnostics().dual,
        'first hand binds the neck and second binds the feet');
      assert(!runner.running&&runner.diagnostics().dual,
        'two actual grip roles should immobilize the runner');
      let lifted=false,stretched=false,firstYank=0,firstRecoil=0,secondYank=0,thirdMid=0;
      for(let i=0;i<122;i++){
        runner.update(.05);pair.update(.05,runner);
        const d=runner.diagnostics();
        if(runner.group.position.y>.5)lifted=true;
        if(d.stretchDistance>.6)stretched=true;
        if(i===3)firstYank=d.stretchDistance; // .20s: almost full first heartbeat yank.
        if(i===25)firstRecoil=d.stretchDistance; // 1.30s: most of that yank has recoiled.
        if(i===33)secondYank=d.stretchDistance; // 1.70s: second sharp yank.
        if(i===89)thirdMid=d.stretchDistance; // 4.50s: halfway through the long finishing pull.
        if(i===60)assert(!d.separated,'the first two yanks must not prematurely split the NPC');
      }
      const split=runner.diagnostics(),bothGrips=pair.diagnostics();
      assert(lifted&&stretched,'both hands must lift the runner before extending its body');
      assert(firstYank>firstRecoil*3&&Math.abs(firstYank-secondYank)<.03,
        'first and second heartbeat yanks must be sharp, repeatable and followed by long recoil');
      assert(thirdMid>0&&split.stretchDistance>thirdMid*1.8,
        'three-second finishing pull must stretch substantially farther than its midpoint');
      assert(split.separated&&split.splitCount===1&&split.stretchSeconds>=6&&split.pullNumber===3,
        'after two reversible 1.5s yanks and a 3s pull, pants/feet separate exactly once');
      assert(split.tossed&&!split.tossError&&split.toss?.pieces?.length===2,
        'two independent visual clones must tumble while the real rig remains untouched');
      assert(!bothGrips.dual&&!bothGrips.neckGrip&&!bothGrips.feetGrip,
        'both root hands must release and retract automatically without resetting the victim');
      const upperRig=runner.group.getObjectByName('Actual NPC neck and upper portrait rig');
      const lowerRig=runner.group.getObjectByName('Actual NPC pants + procedural feet rig');
      assert(!upperRig.visible&&!lowerRig.visible,'hide the actual rendered parts only while their visual copies fly');
      const clonedParts=runner.group.children.filter(node=>node.name.endsWith('flying visual clone'));
      assert(clonedParts.length===2&&clonedParts.every(node=>node.children.length>0),
        'the finished animation must have two distinct temporary render groups');
      // The splurt lives for 0.35-0.85 seconds, so assert it while the
      // separation frame is still current, before advancing the 2.75s tumble.
      const splurt=runner.group.getObjectByName('Stylized blood particle splurt');
      assert(splurt?.children.some(p=>p.visible),
        'splurt particles must be emitted at cartoon separation');
      const initialFlying=clonedParts.map(node=>node.position.clone());
      for(let i=0;i<55;i++){runner.update(.05);pair.update(.05,runner);}
      assert(clonedParts.every((node,index)=>node.position.distanceTo(initialFlying[index])>.5),
        'both detached visuals must fly away from their split pose');
      assert(clonedParts.every(node=>Math.abs(node.rotation.x)>.2),
        'both detached visuals should tumble about their own centers');
      assert(runner.diagnostics().toss?.pieces?.some(piece=>piece.bounces>0),
        'clones should collide with the visible room floor rather than fall forever');
      assert(splurt.children.every(p=>!p.visible),
        'short-lived separation particles must expire while the halves keep tumbling');
      assert(!pair.releaseCaptured(),'roots already released the victim as soon as the visual clones launched');
      runner.resetAfterSnare();
      assert(!runner.diagnostics().dual&&!runner.diagnostics().separated&&runner.running,
        'manual author reset must restore the playable walking preview without residual stretched parts');
      assert(upperRig.visible&&lowerRig.visible&&clonedParts.every(node=>!node.parent),
        'restore original mesh visibility and dispose temporary flying half snapshots');
      const traveled=runner.diagnostics();pair.dispose();runner.dispose();

      // Exercise the same REAL repository data + portrait render pipeline as
      // the Animation Author, not merely a fake THREE humanoid fixture.
      assert(document.baseURI.endsWith('/')&&location.pathname.startsWith('/tools/live-root-growth/'),
        'real author nested document base is exercised by actual repository NPC loader');
      const rendered=await window.RootSnareRunner.loadNpcPortrait({seed:'browser-repository-npc'});
      assert(rendered.npc&&rendered.front.width>0&&rendered.back.height>0,
        'real NPC database record must produce both painted portrait views');
      const avatarRunner=window.RootSnareRunner.create({THREE:T,room,speed:5,requireNpc:true});
      assert(!avatarRunner.hasRepositoryNpc,'do not silently substitute a fake humanoid before loading');
      assert(avatarRunner.installAvatar(rendered),'install the actual PNGPlaneAvatar and procedural feet');
      assert(avatarRunner.hasRepositoryNpc&&avatarRunner.diagnostics().authenticFeet,
        'an actual NPC must use its species-specific procedural foot rig');
      const equippedPants=window.PantsGarmentRenderer?.garmentForCosmetics?.(rendered.portraitNpc.equippedCosmetics||[]);
      if(equippedPants)assert(avatarRunner.diagnostics().authenticPants,
        'NPC equipped with authored pants/skirt must bind that garment to the real leg bones');
      assert(avatarRunner.diagnostics().neckBone,'the live NPC must have a real skinned portrait neck joint');
      const allObjects=[];avatarRunner.group.traverse(node=>allObjects.push(node.name));
      assert(allObjects.some(name=>name.startsWith('Upper '))&&allObjects.some(name=>name.startsWith('Pants and lower ')),
        'head/torso and pants/feet must be separate slices of the same real NPC portrait rig');
      avatarRunner.startDualCapture({point:new T.Vector3(-3,1,-4)},{point:new T.Vector3(3,0,-4)});
      for(let i=0;i<122;i++)avatarRunner.update(.05);
      const tilted=avatarRunner.diagnostics();
      assert(tilted.tiltedDegrees>12,'actual entire NPC must tilt toward the line between the two roots');
      assert(tilted.separated&&tilted.splitCount===1&&tilted.tossed&&!tilted.tossError,
        'real NPC portrait and GLB feet must bake into visual-only halves after the three-pull capture');
      const trueUpper=avatarRunner.group.getObjectByName('Actual NPC neck and upper portrait rig');
      const trueLower=avatarRunner.group.getObjectByName('Actual NPC pants + procedural feet rig');
      const authenticHalfCopies=avatarRunner.group.children.filter(node=>node.name.endsWith('flying visual clone'));
      assert(authenticHalfCopies.length===2&&!trueUpper.visible&&!trueLower.visible,
        'cloned half-portraits must render in place of the hidden but intact authentic NPC rig');
      const anatomicalSpan=Math.max(.2,tilted.anatomy.neckY-tilted.anatomy.footY);
      const gripSeparation=avatarRunner.getGripTarget('neck').distanceTo(avatarRunner.getGripTarget('feet'));
      assert(Math.abs(gripSeparation/anatomicalSpan-1.58)<.01,
        'both real NPC grips must preserve their anatomically scaled 58% final stretch regardless of species size (actual '+gripSeparation/anatomicalSpan+')');
      avatarRunner.resetAfterSnare();
      assert(!avatarRunner.diagnostics().dual&&avatarRunner.hasRepositoryNpc,
        'restarting the animation must preserve the loaded real character rig');
      assert(trueUpper.visible&&trueLower.visible&&authenticHalfCopies.every(node=>!node.parent),
        'restarting must restore intact skinned NPC and actual pants while disposing temporary clones');
      avatarRunner.dispose();

      // A complete 8 × 8 flat floor should partition into all sixteen quarters;
      // a hole must remain missing from the emitted floor guide triangles.
      const verts=[],uv=[];
      for(let r=0;r<16;r++)for(let c=0;c<16;c++){
        if(c===7&&r===7)continue;
        const x=c*.5-4,z=r*.5-4;
        const corners=[[x,0,z],[x+.5,0,z],[x+.5,0,z+.5],[x,0,z+.5]];
        for(const index of [0,1,2,0,2,3]){verts.push(...corners[index]);uv.push(0,0);}
      }
      const flatGeo=new T.BufferGeometry();flatGeo.setAttribute('position',new T.Float32BufferAttribute(verts,3));
      flatGeo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
      const pattern=new T.Mesh(flatGeo,new T.MeshBasicMaterial());
      const sectors=window.StoneAgeRuinScenery.buildFloorCoverSectors(pattern);
      assert(sectors.regions===16,'gameplay must match the author’s sixteen quarter-floor growth budgets');
      const count=sectors.target.children.filter(x=>x.userData?.surfaceFoliageGuide).reduce((n,x)=>n+x.geometry.getAttribute('position').count/3,0);
      assert(count===verts.length/9,'sector bucketing must neither fill missing floor tiles nor drop real triangles');
      // The real Temple foliage renderer must recognize every region even after
      // createCoverAsync() clones the original target and gives it a new UUID.
      const actual=await window.LiveRootGrowth.createCoverAsync({THREE:T,foliage:window.FoliageGenerator,
        target:sectors.target,seed:'sixteen-floor-regions',floorY:0,schedule:async()=>{},
        recipes:[{kind:'roots',style:'natural',target:'floors',perSurface:true,
          count:1,strandLimit:1,density:1,length:.8,radius:.025,color:'#24211d',texture:'',seed:'roots-test'}]});
      const layerStats=actual.targetGrowth.children[0]?.userData?.surfaceGrowthStats;
      assert(layerStats?.perSurface===true&&layerStats.surfaces===16,
        'real surface-growth must assign the author’s per-region root budget to all sixteen cloned floor guides');
      actual.dispose();sectors.dispose();
      return {nodes:anchorsA.length,lunges:1,doubleGrabs:bothGrips.doubleGrabs,splitCount:split.splitCount,npcRig:tilted.npcRig,tilt:+tilted.tiltedDegrees.toFixed(1),runnerTurns:traveled.turns,regions:16,triangles:count,
        mappedFoliageRegions:layerStats.surfaces};

    });
    assert.deepEqual(pageErrors,[],pageErrors.join('\n'));
    assert(speciesRequests.includes('/config/species/index.json'),
      'real NPC must fetch config/species/index.json from docs root; fetched '+speciesRequests.join(', '));
    assert(!speciesRequests.some(p=>p.includes('/tools/live-root-growth/config/species/')),
      'nested author must never fetch species index from its own tool folder');
    console.log('Wall-root hands and procedural walker author browser passed:',JSON.stringify(result));
  }finally{await browser?.close();await new Promise(ok=>server.close(ok));}
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
// Real Three.js r128 author-only regression: fixed root nodes, procedural runner,
// dormant/reaching/retracting hands, and sixteen void-safe Temple growth regions.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch(error){if(error.code==='MODULE_NOT_FOUND'){console.log('skip: playwright unavailable');process.exit(0);}throw error;}
const repo=path.resolve(__dirname,'..'),three=path.join(repo,'node_modules/three/build/three.min.js');
const scripts=['config/scratchbones-config.js','js/leg-bones.js','js/procedural-leg-animation.js','js/foliage-generator.js','js/live-root-growth.js','js/stone-age-ruin-scenery.js','js/root-snare-hands.js','js/root-snare-runner.js'];
const server=http.createServer((request,response)=>{
  const route=decodeURIComponent((request.url||'/').split('?')[0]);
  if(route==='/snare-fixture'){
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><html><head><script src="/vendor-three.js"></script>'+scripts.map(s=>'<script src="/'+s+'"></script>').join('')+'</head><body></body></html>');return;
  }
  if(route==='/vendor-three.js'){response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(three));return;}
  const file=path.resolve(repo,'docs',route.replace(/^\/+/,''));
  if(!file.startsWith(path.join(repo,'docs')+path.sep)){response.writeHead(403);response.end();return;}
  fs.readFile(file,(err,data)=>{if(err){response.writeHead(404);response.end(err.message);return;}
    response.setHeader('Content-Type','text/javascript');response.end(data);});
});
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage(),pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(String(error)));
    await page.goto('http://127.0.0.1:'+server.address().port+'/snare-fixture',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!(window.RootSnareHands?.create&&window.RootSnareRunner?.create&&window.ProceduralLegAnimation?.attach&&window.StoneAgeRuinScenery?.buildFloorCoverSectors));
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

      const hands=window.RootSnareHands.create({THREE:T,room,rootLayers:[{layer,role:'wall'}],
        seed:'exact-fixed-seed',count:6,triggerRadius:2.4,reach:1.6});
      assert(hands.diagnostics().active===0,'hands start hidden inside the fixed roots');
      assert(hands.diagnostics().states.every(s=>s.digits===3&&
        s.digitRoles.filter(role=>role==='finger').length===2&&s.digitRoles.includes('thumb')),
        'each wooden fork has precisely two foliage-branch fingers and one opposed thumb');
      const actor=new T.Group(),captured={group:actor,running:true,
        setRunning(value){this.running=value;},
        chooseTarget(){this.rerouted=true;}};
      const anchor=hands.anchors[0];
      actor.position.copy(anchor.point).addScaledVector(anchor.direction,.95);
      actor.position.y-=1; // The collider checks the runner's chest in world/room space.
      const initialScale=actor.scale.clone();
      for(let i=0;i<3;i++)hands.update(.033,captured);
      assert(hands.diagnostics().states.some(s=>s.state==='approaching'&&!s.wrapped),
        'the three branches must approach the runner with their palm open');
      // Turn the target halfway through growth: the branch ARM has to reroute.
      actor.position.copy(anchor.point).addScaledVector(anchor.direction,.5);
      actor.position.x+=.42;actor.position.y-=1;
      for(let i=0;i<230;i++)hands.update(.033,captured);
      const held=hands.diagnostics();
      assert(held.caught&&held.held===1,'the actual palm collider must grip, pull and keep holding the runner');
      assert(held.states.some(s=>s.state==='held'&&s.wrapped&&s.digits===3),
        'the held pose preserves the curled three-finger branch fork');
      assert(held.states.some(s=>s.reroutes>0),
        'the organic branch arm must steer in-flight as the runner changes direction');
      assert(!captured.running,'captured runner must stop its procedural walking controller');
      assert(actor.visible!==false&&actor.scale.distanceTo(initialScale)<.001,
        'holding must never hide, swallow or shrink the runner');
      assert(actor.position.distanceTo(anchor.point)<1.25,'the arm must carry its captive back to its original root node');
      const heldPosition=actor.position.clone();
      for(let i=0;i<120;i++)hands.update(.033,captured);
      assert(hands.diagnostics().held===1&&actor.position.distanceTo(heldPosition)<.02,
        'the captive stays held indefinitely at the original node');
      assert(hands.releaseCaptured()&&captured.running,'only explicit author release frees the runner');
      actor.position.set(100,0,100);
      for(let i=0;i<120;i++)hands.update(.033,captured);
      assert(!hands.diagnostics().caught&&!hands.diagnostics().held,
        'released hands withdraw to their unchanged hidden nodes');
      assert(hands.group.children.filter(x=>x.name.startsWith('Hidden root snare')).every(x=>!x.visible),
        'released arm and fingers must become indistinguishable from the source root again');
      hands.setNodeVisibility(true);
      assert(hands.group.children.some(x=>x.name.startsWith('Show hidden branch node')&&x.visible),
        'the author may reveal otherwise concealed fixed root nodes');
      hands.dispose();assert(!hands.group.parent,'disposed hands must release their resources');

      const runner=window.RootSnareRunner.create({THREE:T,room,speed:2.5,seed:'runner-test'});
      assert(runner.diagnostics().authenticFeet,'the simulation must use the procedural walking rig');
      const initial=runner.group.position.clone();
      for(let i=0;i<120;i++)runner.update(.033);
      assert(initial.distanceTo(runner.group.position)>.1,'runner must move under procedural gait control');
      const traveled=runner.diagnostics();
      runner.dispose();

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
      return {nodes:anchorsA.length,lunges:held.lungeCount,held:held.held,runnerTurns:traveled.turns,regions:16,triangles:count,
        mappedFoliageRegions:layerStats.surfaces};

    });
    assert.deepEqual(pageErrors,[],pageErrors.join('\n'));
    console.log('Wall-root hands and procedural walker author browser passed:',JSON.stringify(result));
  }finally{await browser?.close();await new Promise(ok=>server.close(ok));}
})().catch(error=>{console.error(error);process.exitCode=1;});

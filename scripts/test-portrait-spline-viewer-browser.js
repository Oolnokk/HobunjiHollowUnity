#!/usr/bin/env node
'use strict';
// Actual Chromium WebGL smoke: independent 2D knot editing, indexed head-silhouette generation,
// and pointer-operated 3D translation/rotation gizmos. No CDN or GitHub network dependency.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
let chromium;
try{({chromium}=require('playwright'));}
catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;console.log('skip: playwright not installed');process.exit(0);}
const root=path.resolve(__dirname,'..'); // Serves this checkout's actual author, cosmetics index, and sprite PNGs.
let threeMain,orbitSource;
try{
  threeMain=fs.readFileSync(path.join(root,'node_modules/three/build/three.module.js'),'utf8');
  orbitSource=fs.readFileSync(path.join(root,'node_modules/three/examples/jsm/controls/OrbitControls.js'),'utf8')
    .replace(/from ['"]three['"]/g,"from 'https://esm.sh/three@0.128.0'");
}catch(error){if(error.code!=='ENOENT')throw error;console.log('skip: pinned Three.js module not installed');process.exit(0);}

const mime={'.js':'application/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.webp':'image/webp','.css':'text/css'};
const server=http.createServer((req,res)=>{
  const route=decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/,'');
  const file=path.resolve(root,route);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(error,bytes)=>{
    if(error){res.writeHead(404);return res.end('Not found: '+route);}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(bytes);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const context=await browser.newContext({viewport:{width:1250,height:980},acceptDownloads:true});
    await context.route(/^https:\/\/esm\.sh\/three@0\.128\.0/,async route=>{
      const url=route.request().url();
      if(url.includes('/examples/jsm/controls/OrbitControls.js'))
        return route.fulfill({status:200,contentType:'application/javascript',body:orbitSource,headers:{'Access-Control-Allow-Origin':'*'}});
      if(url==='https://esm.sh/three@0.128.0')
        return route.fulfill({status:200,contentType:'application/javascript',body:threeMain,headers:{'Access-Control-Allow-Origin':'*'}});
      return route.abort('blockedbyclient');
    });
    const page=await context.newPage(),errors=[]; // Errors appear in CI without needing browser devtools.
    page.on('pageerror',error=>errors.push(error.stack||error.message));
    page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
    await page.goto('http://127.0.0.1:'+server.address().port+'/docs/tools/portrait-spline-author/index.html',
      {waitUntil:'domcontentloaded',timeout:30000});
    const debug=()=>page.evaluate(()=>window.HobunjiSplineAuthorDiagnostics?.());
    await page.waitForFunction(()=>{
      const info=window.HobunjiSplineAuthorDiagnostics?.();
      return info?.viewer?.webgl===true&&info?.viewer?.headLoaded&&info?.viewer?.hairLoaded
        &&info?.canonicalPortrait?.loaded&&info?.canonicalPortrait?.rearLoaded&&info?.regionMasks?.front>0
        &&info?.viewer?.pinnedFrontVertices>0; // Every strand pixel uses one textured mesh; some of its vertices must attach to the head.
    },null,{timeout:60000}).catch(async error=>{throw new Error('WebGL head/hair did not load: '+error.message+'\n'+errors.join('\n').slice(0,3000)
      +'\nStatus: '+(await page.locator('#viewerStatus').innerText()));});
    const before=await debug();
    assert.equal(before.selected.species,'mao-ao');
    assert.equal(before.selected.gender,'male');
    assert(before.canonicalPortrait.loaded,'shared NPC portrait produced a full character model, including torso/arms');
    assert(before.viewer.textures.headRear?.opaque>0,'the rear camera has its own canonical rear portrait texture');
    assert.equal(before.canonicalPortrait.error,null,'canonical portrait integration is error-free');
    assert.equal(Object.keys(before.viewer.textureErrors||{}).length,0,
      'no origin-tainted or invalid PNG textures: '+JSON.stringify(before.viewer.textureErrors));
    assert.equal(before.viewer.knots,2,'one root and one tip are shown in WebGL');
    assert(before.viewer.ribbonVertices>100,'the real WebGL ribbon has deformable vertex geometry');
    assert(before.viewer.textures.head?.colored>10 && before.viewer.textures.hair?.colored>10,
      'canonical body/head and hair textures contain real colored RGBA sprite pixels, not blank/black image buffers');
    assert.equal(before.viewer.textures.head.format,'canonical CanvasTexture',
      '3D editor uses the shared PNG-plane pipeline, not a custom DataTexture uploader');
    assert(before.viewer.gpuHead?.ok,
      'the head sprite must actually render colored pixels on the GPU (not merely have a material.map): '+JSON.stringify(before.viewer.gpuHead));
    assert(before.viewer.gpuHair?.ok,
      'the beard must actually render colored pixels on the GPU: '+JSON.stringify(before.viewer.gpuHair));
    assert(before.viewer.arrows.some(item=>item.axis==='x'),'the selected knot has a real X-axis move gizmo');
    // Wind previews must move existing meshes rather than allocate new ones on each touch input.
    await page.locator('#windX').evaluate(input=>{
      input.value='.47';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    const windEdited=await debug();
    assert.equal(windEdited.viewer.markerRebuilds,before.viewer.markerRebuilds,
      'wind slider should not rebuild the 3D knot spheres');
    assert.equal(windEdited.viewer.gizmoRebuilds,before.viewer.gizmoRebuilds,
      'wind slider should not rebuild the 3D XYZ gizmo');
    await page.locator('#windX').evaluate(input=>{
      input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    const authored=JSON.parse(await page.locator('#json').inputValue());
    assert.equal(authored.version,2,'single bone JSON schema');
    assert.equal(authored.points.length,2,'only root and tip are authored');
    assert(Object.values(authored.bone).every(n=>n>0),'one bone has swing limits');
    assert(!('segments' in authored)&&!('tipFollow' in authored),'old blend table has been eliminated');
    assert.equal(authored.hoodStretchPx,12,'elastic opening has a meaningful default');
    await page.locator('details:has(#json) > summary').click(); // Open the authoring JSON panel before touch-style typing.
    const rigBeforeDraft=await page.locator('#json').inputValue();
    await page.locator('#json').fill('{"draft":');
    await page.locator('#windX').evaluate(input=>{
      input.value='.65';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    assert.equal(await page.locator('#json').inputValue(),'{"draft":',
      'manual JSON must not be erased by live WebGL redraws');
    assert.match(await page.locator('#jsonDraftStatus').innerText(),/Unapplied JSON/,
      'mobile authors should see when typed JSON is not yet applied');
    const originalStyle=await page.locator('#cosmeticSelect').inputValue();
    const alternateStyle=await page.locator('#cosmeticSelect option').evaluateAll((options,current)=>
      options.find(option=>option.value&&option.value!==current)?.value||null,originalStyle);
    if(alternateStyle){
      await page.locator('#cosmeticSelect').selectOption(alternateStyle);
      assert((await debug()).jsonDraft.savedIndexedDrafts>0,
        'changing indexed cosmetics caches the un-applied original style JSON');
      await page.locator('#cosmeticSelect').selectOption(originalStyle);
      assert.equal(await page.locator('#json').inputValue(),'{"draft":',
        'returning to an indexed style restores its unpublished JSON text');
      await page.waitForFunction(()=>{
        const state=window.HobunjiSplineAuthorDiagnostics?.();
        return state?.viewer?.hairLoaded && state?.regionMasks?.front>0;
      },null,{timeout:30000});
    }
    await page.locator('#download').click();
    assert.match(await page.locator('#catalogStatus').innerText(),/Apply rig JSON before exporting/,
      'export cannot silently discard unapplied JSON changes');
    await page.locator('#json').fill(rigBeforeDraft);
    await page.locator('#applyJson').click();
    assert.equal(await page.locator('#jsonDraftStatus').innerText(),'',
      'applying valid JSON clears the draft warning');
    await page.locator('#windX').evaluate(input=>{
      input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    assert(before.regionMasks.front>0,'actual head-overlapping beard pixels default to the rigid region');
    assert(before.viewer.seamlessSingleMesh && before.viewer.pinnedFrontVertices>0,
      'beard geometry must consist of one full-art mesh with nonzero hard-pinned head vertices');
    assert(!('rigidFront' in before.viewer.textures),
      'there must be no independently rendered rigid portrait texture to open a black seam');
    assert(before.viewer.textures.hair?.opaque>0,
      'single mesh retains opaque rigid beard art and flexible hanging pixels in the same GPU texture');
    await page.locator('#maskMode').click();
    assert(await page.locator('#resetRig').isHidden(),'mask mode hides bone fitting tools');
    assert.equal((await debug()).viewer.handles,0,'mask mode removes the 3D rig gizmos');
    await page.locator('#autoMask').click();
    const initial=await debug();
    assert(initial.regionMasks.front>0,'automatic overlap classification produces a non-empty rigid region');
    const sample=await page.evaluate(()=>{
      const mask=JSON.parse(document.querySelector('#json').value).regionMasks.front;
      const [start,length]=mask.runs[Math.floor(mask.runs.length/2)];
      const index=start+Math.floor(length/2);
      return {u:(index%200+.5)/200,v:(Math.floor(index/200)+.5)/200};
    }); // Choose an actual rigid pixel, not a guessed beard coordinate.
    const clickMaskPixel=async()=>{
      await page.locator('#preview').scrollIntoViewIfNeeded();
      const bounds=await page.locator('#preview').boundingBox(); // Toolbar clicks can scroll the page, invalidating previously projected pixel coordinates.
      await page.mouse.click(bounds.x+sample.u*bounds.width,bounds.y+sample.v*bounds.height);
    };
    await page.locator('#eraseMode').click();await clickMaskPixel();
    const erased=await debug();
    assert(erased.regionMasks.front<initial.regionMasks.front,
      'eraser transfers pixels from rigid to flexible: '+JSON.stringify({before:initial.regionMasks,after:erased.regionMasks,sample,mode:erased.mode}));
    await page.locator('#paintMode').click();await clickMaskPixel();
    const repainted=await debug();
    assert(repainted.regionMasks.front>erased.regionMasks.front,
      'brush transfers pixel ownership back to the rigid head plane: '+JSON.stringify({afterErase:erased.regionMasks,afterPaint:repainted.regionMasks}));
    await page.locator('#preview').scrollIntoViewIfNeeded();
    const preview=await page.locator('#preview').boundingBox(); // Move across a full stroke with only one pointermove.
    await page.mouse.move(preview.x+preview.width*.15,preview.y+preview.height*.85);
    await page.mouse.down();
    await page.mouse.move(preview.x+preview.width*.85,preview.y+preview.height*.85);
    await page.mouse.up();
    const centerPainted=await page.evaluate(()=>{
      const mask=JSON.parse(document.querySelector('#json').value).regionMasks.front;
      const pixel=170*200+100;
      return mask.runs.some(([start,length])=>pixel>=start&&pixel<start+length);
    });
    assert(centerPainted,'one fast brush drag paints the midpoint between pointer events');
    await page.locator('#undoMask').click();
    assert.equal((await debug()).regionMasks.front,repainted.regionMasks.front,'one undo reverses the complete brush stroke');
    await page.locator('#moveMode').click();
    assert(await page.locator('#paintMode').isHidden(),'rigging mode hides brush tools');
    // A touch near the knot selects it without snapping its resting position to the finger.
    const originalRig=JSON.parse(await page.locator('#json').inputValue());
    await page.locator('#preview').scrollIntoViewIfNeeded();
    const knotCanvas=await page.locator('#preview').boundingBox();
    await page.mouse.click(knotCanvas.x+knotCanvas.width*(originalRig.points[1].u+.013),
      knotCanvas.y+knotCanvas.height*(originalRig.points[1].v+.009));
    const selectedPoint=JSON.parse(await page.locator('#json').inputValue()).points[1];
    assert.equal(selectedPoint.u,originalRig.points[1].u,'knot selection preserves rest X');
    assert.equal(selectedPoint.v,originalRig.points[1].v,'knot selection preserves rest Y');
    assert.equal(originalRig.points.length,2,'a single bone cannot insert middle knots');
    assert(!('segments' in originalRig),'no segment pose table is exported');
    assert.equal((await debug()).regionMasks.front,repainted.regionMasks.front,
      'tip selection does not discard painted head attachment');
    await page.locator('#moveMode').click();
    await page.locator('#gizmoTranslate').click();
    const move=(await debug()).viewer.arrows.find(item=>item.axis==='x');
    await page.mouse.move(move.x,move.y);
    await page.mouse.down();
    await page.mouse.move(move.x+65,move.y,{steps:6});
    await page.mouse.up();
    const moved=await debug();
    const dragged=JSON.parse(await page.locator('#json').inputValue());
    assert(Math.abs(dragged.points[1].u-originalRig.points[1].u)>0.006,
      '3D X arrow moves the actual free bone tip');
    assert.equal(moved.viewer.mode,'translate');
    await page.locator('#gizmoRotate').click();
    const ring=(await debug()).viewer.rings.find(item=>item.axis==='z');
    assert(ring&&Number.isFinite(ring.x)&&Number.isFinite(ring.y),'rotation rings have projected, pickable WebGL coordinates');
    await page.mouse.move(ring.x,ring.y);
    await page.mouse.down();
    await page.mouse.move(ring.x+42,ring.y-28,{steps:6});
    await page.mouse.up();
    const rotated=await debug();
    assert(Math.abs(rotated.bone.roll-dragged.bone.roll)>0.5,'3D Z ring authors one bone swing limit');
    assert.equal(rotated.regionMasks.front,repainted.regionMasks.front,
      '3D knot posing does not discard the separately authored rigid/flexible pixel region');
    const selectHood=async id=>{
      const value=await page.locator('#hoodSelect option').evaluateAll((options,suffix)=>
        options.find(option=>option.value.endsWith('/'+suffix+'.json'))?.value,id);
      assert(value,'canonical hood exists in the catalog: '+id);
      await page.locator('#hoodSelect').selectOption(value);
      await page.waitForFunction(id=>{
        const result=window.HobunjiSplineAuthorDiagnostics?.();
        return result?.hood.ready&&result.hood.equipped===id;
      },id);
    };
    await selectHood('fine_hood');
    const ordinary=await debug();
    assert(ordinary.viewer.hoodCoveragePixels>0&&ordinary.viewer.hairLoaded,'the game renderer supplies the Fine Hood foreground');
    const gameplay=await page.evaluate(async()=>{
      const registry=await window.NpcAvatarPreview.ensurePortraitCosmetics();
      const fighter=window.getPortraitFighters().find(f=>f.speciesId==='mao-ao'&&f.gender==='male');
      const hood=registry.hoodOptions.find(option=>option.id==='fine_hood');
      const beard=registry.facialHairOptions.find(option=>option.splineRig&&option.label==='Grand Beard');
      const rig=window.PortraitSplineRig;
      const canvas=document.createElement('canvas');canvas.width=canvas.height=200;
      const profile={fighter,hood,hairFront:null,facialHair:beard,bodyColors:{}};
      await window.NpcAvatarPreview.renderProfileToCanvas(canvas,profile,{forceEyesOpen:true,deferSplineParts:true});
      const part=canvas.hobunjiSplineParts.find(item=>item.slot==='facialHair');
      const pixels=part.canvas.getContext('2d').getImageData(0,0,200,200).data;
      const covered=part.hoodFit.coverage.findIndex((value,i)=>value&&pixels[i*4+3]>=128);
      if(covered<0)throw Error('Fine Hood fixture needs an opaque pixel covering Grand Beard.');
      const authored={...part.rig,hoodOpeningMask:{size:200,runs:[[covered,1]]}};
      profile.facialHair={...beard,splineRig:authored,variantSplineRigs:{}};
      await window.NpcAvatarPreview.renderProfileToCanvas(canvas,profile,{forceEyesOpen:true,deferSplineParts:true});
      const fitted=canvas.hobunjiSplineParts[0].hoodFit;
      const opening=fitted.coverage[covered],aperture=fitted.aperture[covered],openingPixels=fitted.openingPixels;
      profile.facialHair={...profile.facialHair,splineRig:{...authored,hoodOpeningMask:null,hoodOverlapMask:{size:200,runs:[[covered,1]]}}};
      await window.NpcAvatarPreview.renderProfileToCanvas(canvas,profile,{forceEyesOpen:true,deferSplineParts:true});
      const overlap=canvas.hobunjiSplineParts[0].hoodFit.overlap[covered];
      const THREE=await import('https://esm.sh/three@0.128.0');
      const island=rig.normalize({...part.rig,regionMasks:{front:{size:200,runs:[[0,10050],[10051,29949]]}}});
      const mesh=rig.strandGeometry(THREE,island,1,1),uv=mesh.attributes.uv;
      let hasIslandVertex=false;
      for(let i=0;i<uv.count;i++)if(Math.abs(uv.getX(i)-50.5/200)<1e-6&&Math.abs(uv.getY(i)-(1-50.5/200))<1e-6)hasIslandVertex=true;
      mesh.dispose();
      return {opening,overlap,hasIslandVertex,aperture,openingPixels};
    });
    assert.equal(gameplay.opening,0,'seeded beard pixel punches the hood');
    assert.equal(gameplay.aperture,1,'the same hole pins the beard at the aperture');
    assert(gameplay.openingPixels>1,'elastic opening expands around connected hair');
    assert.equal(gameplay.overlap,1,'marked hair can still overlap opaque hood cloth');
    assert.equal(gameplay.hasIslandVertex,true,'small flexible islands remain deformable');
    // Independent real-WebGL owner/beard depth contract: the owner's color may
    // have depthWrite disabled for shoulder-pet/actor sorting, but the beard
    // still wins only when its geometry is genuinely closer to the camera.
    const pairedDepth=await page.evaluate(async()=>{
      const THREE=await import('https://esm.sh/three@0.128.0');
      const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:false});
      const target=new THREE.WebGLRenderTarget(64,64,{depthBuffer:true});
      const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
      camera.position.set(0,0,2);camera.lookAt(0,0,0);
      scene.background=new THREE.Color(0xffffff);
      const skin=document.createElement('canvas');skin.width=skin.height=4;
      const ctx=skin.getContext('2d');ctx.fillStyle='#001aff';ctx.fillRect(0,0,2,4);
      const tex=new THREE.CanvasTexture(skin);tex.magFilter=tex.minFilter=THREE.NearestFilter;
      const ownerMat=new THREE.MeshBasicMaterial({map:tex,transparent:true,alphaTest:.35,
        depthTest:true,depthWrite:false,side:THREE.FrontSide});
      const beardMat=new THREE.MeshBasicMaterial({color:0xff0000,transparent:true,
        alphaTest:.35,depthTest:true,depthWrite:true,side:THREE.FrontSide});
      const plane=new THREE.PlaneGeometry(1.8,1.8);
      const owner=new THREE.Mesh(plane,ownerMat),beard=new THREE.Mesh(plane,beardMat);
      owner.renderOrder=2;beard.renderOrder=1.99;
      scene.add(owner,beard);
      const sample=(front,x)=>{
        beard.position.z=front?.2:-.2;
        renderer.setRenderTarget(target);
        renderer.clear(true,true,true);
        renderer.render(scene,camera);
        const pixels=new Uint8Array(64*64*4);
        renderer.readRenderTargetPixels(target,0,0,64,64,pixels);
        const at=(32*64+x)*4;
        return [...pixels.slice(at,at+3)];
      };
      const frontOpaque=sample(true,16),behindOpaque=sample(false,16);
      const behindTransparent=sample(false,48);
      // A wrong late-pass x-ray would return red for behindOpaque; a wrong
      // depthWrite=false early beard would return blue for frontOpaque.
      ownerMat.dispose();beardMat.dispose();tex.dispose();plane.dispose();target.dispose();renderer.dispose();
      return {frontOpaque,behindOpaque,behindTransparent};
    });
    assert(pairedDepth.frontOpaque[0]>200&&pairedDepth.frontOpaque[2]<60,
      'front beard prevents its owner painting through 3D geometry: '+JSON.stringify(pairedDepth));
    assert(pairedDepth.behindOpaque[2]>200&&pairedDepth.behindOpaque[0]<60,
      'opaque owner hides beard geometry physically behind it, even without owner depth writes');
    assert(pairedDepth.behindTransparent[0]>200&&pairedDepth.behindTransparent[2]<60,
      'a real alpha opening in the owner does not hide otherwise visible beard pixels');
    assert(before.viewer.pairedOwnerDepth.depthTest&&before.viewer.pairedOwnerDepth.depthWrite
      &&before.viewer.pairedOwnerDepth.frontBeforeOwner,
      'live 3D author matches gameplay depth and actor-order pairing');
    const projected=await page.evaluate(async()=>{
      const THREE=await import('https://esm.sh/three@0.128.0');
      const renderer=new THREE.WebGLRenderer();
      const target=new THREE.WebGLRenderTarget(32,32);
      const scene=new THREE.Scene();
      const sprite=document.createElement('canvas');sprite.width=sprite.height=1;
      sprite.getContext('2d').fillRect(0,0,1,1);
      const material=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(sprite)});
      const geometry=new THREE.PlaneGeometry(.08,.08);
      geometry.translate(-.16,0,-.32); // Beard behind cloth: oblique sightlines cross the opaque hood at x=0.
      const mesh=new THREE.Mesh(geometry,material);
      const clip=window.PortraitSplineRig.hoodOcclusion(THREE,material);
      const coverage=new Uint8Array(40000),overlap=new Uint8Array(40000);
      for(let y=80;y<120;y++)for(let x=90;x<110;x++)coverage[y*200+x]=1;
      mesh.onBeforeRender=(_renderer,_scene,camera)=>clip.setCamera(mesh,camera);
      scene.background=new THREE.Color('white');
      scene.add(mesh);
      const parallel=new THREE.OrthographicCamera(-.2,.2,.2,-.2,.1,10);
      const perspective=new THREE.PerspectiveCamera(15,1,.1,10);
      const read=(camera,x,z)=>{
        camera.position.set(x,0,z);
        camera.lookAt(0,0,0);
        renderer.setRenderTarget(target);renderer.render(scene,camera);
        const pixels=new Uint8Array(32*32*4);
        renderer.readRenderTargetPixels(target,0,0,32,32,pixels);
        return pixels.some((value,i)=>i%4===0&&value<128);
      };
      clip.update({coverage,overlap},1,1);
      const covered=[read(parallel,1,2),read(perspective,1,2)];
      overlap.fill(1);clip.update({coverage,overlap},1,1);
      const permitted=[read(parallel,1,2),read(perspective,1,2)];
      overlap.fill(0);clip.update({coverage,overlap},1,1);
      geometry.translate(.32,0,.64); // The same strand is now IN FRONT of the hood without a painted override.
      const trulyInFront=[read(parallel,1,2),read(perspective,1,2)];
      clip.update(null,1,1);
      const removed=read(parallel,1,2);
      clip.dispose();geometry.dispose();material.map.dispose();material.dispose();target.dispose();renderer.dispose();
      return {covered,permitted,trulyInFront,removed};
    });
    assert.deepEqual(projected,{covered:[false,false],permitted:[true,true],
      trulyInFront:[true,true],removed:true},
      'actual WebGL fragments are hidden only when opaque hood is in front, not x-rayed away when beard is nearer');
    await page.locator('#maskMode').click();
    await page.locator('#maskSelect').selectOption('opening');
    await page.locator('#paintMode').click();await clickMaskPixel();
    assert((await debug()).hood.opening>0,'the opening brush authors a separate beard mask');
    await page.locator('#maskSelect').selectOption('overlap');
    await page.locator('#paintMode').click();await clickMaskPixel();
    assert((await debug()).hood.overlap>0,'bend paint authors its own overlap pixels');
    await page.locator('#overlapMode').selectOption('rigid');
    await clickMaskPixel();
    const masked=await debug();
    assert(masked.hood.rigid>0&&masked.hood.opening>0,'rigid overlap paint preserves the opening mask');
    assert.equal(masked.hood.overlap,0,'rigid paint replaces bend paint at the same pixel');
    assert.equal(masked.regionMasks.front,rotated.regionMasks.front,'hood masks leave the hard head mask intact');
    await selectHood('facewrap');
    assert((await debug()).hood.hidden&&!(await debug()).viewer.hairLoaded,'the game facewrap rule hides the beard in preview');
    await page.locator('#hoodSelect').selectOption('');
    assert((await debug()).viewer.hairLoaded,'removing the hood restores the beard and clears its shader mask');
    const hoodPng=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=200;
      const ctx=canvas.getContext('2d');ctx.fillRect(50,50,100,100);ctx.clearRect(80,80,20,20);
      return canvas.toDataURL().split(',')[1];
    });
    await page.locator('#hoodFile').setInputFiles({name:'wand-fixture.png',mimeType:'image/png',buffer:Buffer.from(hoodPng,'base64')});
    await page.locator('#maskSelect').selectOption('opening');
    await page.locator('#wandMode').click();
    const openingBefore=(await debug()).hood.opening;
    await page.locator('#preview').scrollIntoViewIfNeeded();
    const wandCanvas=await page.locator('#preview').boundingBox();
    const tap=(u,v)=>page.mouse.click(wandCanvas.x+wandCanvas.width*u,wandCanvas.y+wandCanvas.height*v);
    await tap(.1,.1);
    assert.equal((await debug()).hood.opening,openingBefore,'exterior transparency leaves the mask alone');
    await tap(.45,.45);
    assert((await debug()).hood.opening>openingBefore,'the wand adds the uploaded hood opening');
    await page.locator('#undoMask').click();
    assert.equal((await debug()).hood.opening,openingBefore,'one undo restores the previous opening mask');
    assert.equal(errors.filter(text=>/uncaught|typeerror|referenceerror|syntaxerror|shader error|validate_status/i.test(text)).length,0,
      'No unhandled source error: '+errors.join('\n').slice(-2400));
    console.log('Single-bone hair author browser: GPU textures, elastic hood aperture, facewrap and 3D gizmos pass.');
  }finally{
    await browser?.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

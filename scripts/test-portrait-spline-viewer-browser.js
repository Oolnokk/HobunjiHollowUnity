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
    assert.equal(before.viewer.knots,3,'the 3D viewer builds the same three rest knots as the 2D author');
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
    const natural=await page.evaluate(()=>{
      const authored=JSON.parse(document.querySelector('#json').value);
      return {tip:authored.segments.at(-1).poses.right.translate.x,
        upper:authored.segments[0].poses.right.translate.x,
        follow:authored.tipFollow,hasOldGrip:'pinWidthPx' in authored};
    });
    assert(natural.tip>natural.upper&&natural.tip>0,
      'new cosmetics start with natural, tip-led poses based on actual strand length: '+JSON.stringify(natural));
    assert(natural.follow>0&&!natural.hasOldGrip,'authored head pixels alone determine the hard mask');
    assert(before.regionMasks.front>0,'actual head-overlapping beard pixels default to the rigid region');
    assert(before.viewer.seamlessSingleMesh && before.viewer.pinnedFrontVertices>0,
      'beard geometry must consist of one full-art mesh with nonzero hard-pinned head vertices');
    assert(!('rigidFront' in before.viewer.textures),
      'there must be no independently rendered rigid portrait texture to open a black seam');
    assert(before.viewer.textures.hair?.opaque>0,
      'single mesh retains opaque rigid beard art and flexible hanging pixels in the same GPU texture');
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
    await page.locator('#generateBlend').click();
    const generated=await debug();
    assert.equal(generated.regionMasks.front,repainted.regionMasks.front,
      'regenerating natural six-direction poses never discards manual rigid/flexible mask edits');
    await page.locator('#moveMode').click();
    await page.locator('#gizmoTranslate').click();
    const move=(await debug()).viewer.arrows.find(item=>item.axis==='x');
    await page.mouse.move(move.x,move.y);
    await page.mouse.down();
    await page.mouse.move(move.x+65,move.y,{steps:6});
    await page.mouse.up();
    const moved=await debug();
    assert(Math.abs(moved.pose.translate.x)>0.006,'dragging the 3D X arrow edits the runtime X knot translation');
    assert.equal(moved.viewer.mode,'translate');
    await page.locator('#gizmoRotate').click();
    const ring=(await debug()).viewer.rings.find(item=>item.axis==='z');
    assert(ring&&Number.isFinite(ring.x)&&Number.isFinite(ring.y),'rotation rings have projected, pickable WebGL coordinates');
    await page.mouse.move(ring.x,ring.y);
    await page.mouse.down();
    await page.mouse.move(ring.x+42,ring.y-28,{steps:6});
    await page.mouse.up();
    const rotated=await debug();
    assert(Math.abs(rotated.pose.roll)>0.5,'dragging the Z rotation ring authors the real roll pose');
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
      const opening=canvas.hobunjiSplineParts[0].hoodFit.coverage[covered];
      profile.facialHair={...profile.facialHair,splineRig:{...authored,hoodOpeningMask:null,hoodOverlapMask:{size:200,runs:[[covered,1]]}}};
      await window.NpcAvatarPreview.renderProfileToCanvas(canvas,profile,{forceEyesOpen:true,deferSplineParts:true});
      const overlap=canvas.hobunjiSplineParts[0].hoodFit.overlap[covered];
      const THREE=await import('https://esm.sh/three@0.128.0');
      const island=rig.normalize({...part.rig,regionMasks:{front:{size:200,runs:[[0,10050],[10051,29949]]}}});
      const mesh=rig.strandGeometry(THREE,island,1,1),uv=mesh.attributes.uv;
      let hasIslandVertex=false;
      for(let i=0;i<uv.count;i++)if(Math.abs(uv.getX(i)-50.5/200)<1e-6&&Math.abs(uv.getY(i)-(1-50.5/200))<1e-6)hasIslandVertex=true;
      mesh.dispose();
      return {opening,overlap,hasIslandVertex};
    });
    assert.deepEqual(gameplay,{opening:0,overlap:1,hasIslandVertex:true},'the gameplay bake carries both masks and preserves isolated flexible pixels in 3D');
    const projected=await page.evaluate(async()=>{
      const THREE=await import('https://esm.sh/three@0.128.0');
      const renderer=new THREE.WebGLRenderer();
      const target=new THREE.WebGLRenderTarget(32,32);
      const scene=new THREE.Scene();
      const sprite=document.createElement('canvas');sprite.width=sprite.height=1;
      sprite.getContext('2d').fillRect(0,0,1,1);
      const material=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(sprite)});
      const geometry=new THREE.PlaneGeometry(.08,.08);
      geometry.translate(.16,0,.32); // Oblique rays hit the hood at x=0, while a straight-on ray misses.
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
      clip.update(null,1,1);
      const removed=read(parallel,1,2);
      clip.dispose();geometry.dispose();material.map.dispose();material.dispose();target.dispose();renderer.dispose();
      return {covered,permitted,removed};
    });
    assert.deepEqual(projected,{covered:[false,false],permitted:[true,true],removed:true},
      'actual WebGL fragments follow the hood under oblique perspective and orthographic cameras');
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
    assert.equal(errors.filter(text=>/uncaught|typeerror|referenceerror|syntaxerror|shader error|validate_status/i.test(text)).length,0,
      'No unhandled source error: '+errors.join('\n').slice(-2400));
    console.log('Portrait spline author browser: canonical hood and facewrap, independent masks, and 3D gizmos pass.');
  }finally{
    await browser?.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

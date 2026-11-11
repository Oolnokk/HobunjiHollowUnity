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
        &&info?.canonicalPortrait?.loaded&&info?.regionMasks?.front>0
        &&info?.viewer?.textures?.rigidFront?.opaque>0; // Head overlap is loaded asynchronously after the full canonical character. // Verify the full body from the real Pants Rig Author portrait renderer, not only two detached images.
    },null,{timeout:60000}).catch(async error=>{throw new Error('WebGL head/hair did not load: '+error.message+'\n'+errors.join('\n').slice(0,3000)
      +'\nStatus: '+(await page.locator('#viewerStatus').innerText()));});
    const before=await debug();
    assert.equal(before.selected.species,'mao-ao');
    assert.equal(before.selected.gender,'male');
    assert(before.canonicalPortrait.loaded,'shared NPC portrait produced a full character model, including torso/arms');
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
        blendRadius:authored.blendRadiusPx,follow:authored.tipFollow};
    });
    assert(natural.tip>natural.upper&&natural.tip>0,
      'new cosmetics start with natural, tip-led poses based on actual strand length: '+JSON.stringify(natural));
    assert(natural.blendRadius>0&&natural.follow>0,
      'automatic motion blend and bottom-parent influence are enabled by default');
    assert(before.regionMasks.front>0,'actual head-overlapping beard pixels default to the rigid region');
    assert(before.viewer.textures.rigidFront?.opaque>0,'the non-deforming head attachment has its own visible 3D sprite');
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
    assert.equal(errors.filter(text=>/uncaught|typeerror|referenceerror|syntaxerror/i.test(text)).length,0,
      'No unhandled source error: '+errors.join('\n').slice(-2400));
    console.log('Portrait spline author browser: indexed head and separate rigid/flexible WebGL hair surfaces, 2D brush/eraser, and 3D gizmos pass.');
  }finally{
    await browser?.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

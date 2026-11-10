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
        return route.fulfill({status:200,contentType:'application/javascript',body:orbitSource});
      if(url==='https://esm.sh/three@0.128.0')
        return route.fulfill({status:200,contentType:'application/javascript',body:threeMain});
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
      return info?.viewer?.webgl===true&&info?.viewer?.headLoaded&&info?.viewer?.hairLoaded;
    },null,{timeout:60000}).catch(async error=>{throw new Error('WebGL head/hair did not load: '+error.message+'\n'+errors.join('\n').slice(0,3000)
      +'\nStatus: '+(await page.locator('#viewerStatus').innerText()));});
    const before=await debug();
    assert.equal(before.selected.species,'mao-ao');
    assert.equal(before.selected.gender,'male');
    assert.equal(before.viewer.knots,3,'the 3D viewer builds the same three rest knots as the 2D author');
    assert(before.viewer.ribbonVertices>100,'the real WebGL ribbon has deformable vertex geometry');
    assert(before.viewer.arrows.some(item=>item.axis==='x'),'the selected knot has a real X-axis move gizmo');
    await page.locator('#autoSeam').click();
    const seam=await debug();
    assert(seam.seamCount>3,'generate head silhouette produces editable mask dabs from the indexed head image');
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
    assert.equal(rotated.seamCount,seam.seamCount,'3D authoring does not discard the editable generated mask');
    assert.equal(errors.filter(text=>/uncaught|typeerror|referenceerror|syntaxerror/i.test(text)).length,0,
      'No unhandled source error: '+errors.join('\n').slice(-2400));
    console.log('Portrait spline author browser: indexed head/hair and 3D WebGL gizmos + editable silhouette seam pass.');
  }finally{
    await browser?.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

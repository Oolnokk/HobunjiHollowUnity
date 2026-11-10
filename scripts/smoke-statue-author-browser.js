#!/usr/bin/env node
'use strict';
// Real Chromium smoke for the mobile reported "black rectangle and black feet"
// regression. Uses the authored NPC, actual portrait renderer, shipped PNG,
// actual Three.js r128 GLB loader and the unmodified Statue Author page.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'); // Real repo docs root is served without external GitHub/GitHack CDN.
const remoteAssets=http.createServer((request,response)=>{
  const route=decodeURIComponent((request.url||'/').split('?')[0]);
  const file=path.resolve(root,'docs',route.replace(/^\/+/,''));
  if(!file.startsWith(path.join(root,'docs')+path.sep)){response.writeHead(403);response.end();return;}
  fs.readFile(file,(error,data)=>{
    if(error){response.writeHead(404);response.end();return;}
    const type=file.endsWith('.png')?'image/png':'image/webp';
    response.writeHead(200,{'Content-Type':type,'Access-Control-Allow-Origin':'*',
      'Cross-Origin-Resource-Policy':'cross-origin'});
    response.end(data);
  });
}); // Separate origin simulates GitHack/CDN image redirects with valid CORS.
let imageRedirects=0; // Test must actually exercise the cross-origin image path.
const server=http.createServer((request,response)=>{
  const url=decodeURIComponent((request.url||'/').split('?')[0]);
  if(/^\/assets\/.+\.(?:png|webp)$/i.test(url)){
    imageRedirects++;
    response.writeHead(302,{Location:'http://127.0.0.1:'+remoteAssets.address().port+url});
    response.end();return;
  }
  const file=path.resolve(root,'docs',url.replace(/^\/+/,''));
  if(!file.startsWith(path.join(root,'docs')+path.sep)){response.writeHead(403);response.end();return;}
  const mime=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':
    file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':
    file.endsWith('.webp')?'image/webp':file.endsWith('.glb')?'model/gltf-binary':'application/octet-stream';
  fs.readFile(file,(error,data)=>{
    if(error){response.writeHead(404);response.end('Missing '+file);return;}
    response.writeHead(200,{'Content-Type':mime});response.end(data);
  });
});
async function run(){
  await new Promise(resolve=>remoteAssets.listen(0,'127.0.0.1',resolve));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle',
      '--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:390,height:820},
      deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const pageErrors=[]; // Console-free diagnostics are also printed for CI.
    page.on('pageerror',error=>pageErrors.push(String(error.stack||error.message)));
    const vendors={
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js':
        'three/build/three.min.js',
      'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js':
        'three/examples/js/controls/OrbitControls.js',
      'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js':
        'three/examples/js/loaders/GLTFLoader.js'
    }; // Versions match the real editor and avoid flaky external script CDNs.
    for(const [url,module] of Object.entries(vendors))
      await page.route(url,route=>route.fulfill({contentType:'text/javascript',
        body:fs.readFileSync(require.resolve(module))}));
    await page.goto('http://127.0.0.1:'+server.address().port+
      '/tools/statue-author/index.html',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>document.querySelectorAll('#npcSelect option').length>1,
      null,{timeout:60000});
    assert.equal(await page.$eval('#phase',el=>el.disabled),true,
      'No animation imported: Neutral should be the only available pose');
    const layout=await page.evaluate(()=>({
      columns:getComputedStyle(document.querySelector('main')).gridTemplateColumns,
      position:getComputedStyle(document.querySelector('#viewport')).position,
      viewportHeight:Math.round(document.querySelector('#viewport').getBoundingClientRect().height)
    }));
    assert.equal(layout.position,'sticky','Mobile layout should keep the statue preview in view');
    await page.selectOption('#npcSelect',{index:1});
    await page.fill('#weaponPaths','assets/toolsprites/harlyao_longsword.png'); // Exercise imported PNG readback over the redirected origin.
    await page.click('#build');
    await page.waitForFunction(()=>{
      const value=document.getElementById('status')?.textContent||'';
      return /Build failed|Built \d+ editable pieces/.test(value);
    },null,{timeout:90000});
    await page.waitForFunction(()=>{
      const debug=window.__hobunjiStatueDebug?.();
      if(!debug?.built)return true;
      return debug.pieces.every(p=>
        p.id.includes('_hand')||p.id.includes('_foot')
          ? p.modelError||p.textureError||(p.modelReady&&p.textureReady)
          : p.textureReady||p.textureError);
    },null,{timeout:30000});
    const output=await page.evaluate(()=>window.__hobunjiStatueDebug());
    assert.ok(output.built,'Real NPC statue must build: '+JSON.stringify(output));
    assert.ok(imageRedirects>0,'All PNGs should have been served via a different origin');
    assert.ok(output.pieces.length>=7,'Should export body, head, hands, feet and weapon');
    const body=output.pieces.find(p=>p.id==='statue_body');
    const head=output.pieces.find(p=>p.id==='statue_head');
    for(const piece of [body,head]){
      assert.ok(piece&&piece.textureReady,'Portrait finish must complete: '+JSON.stringify(piece));
      assert.equal(piece.textureError,null,'Portrait mask/texture should load without error');
      assert.ok(piece.material,'Painted mask should be readable from GPU source CanvasTexture');
      assert.ok(piece.material.coverage>.02&&piece.material.coverage<.94,
        'NPC sprite must be an alpha-cut silhouette, never a black rectangle: '+JSON.stringify(piece));
      assert.ok(piece.material.brightCoverage>.12,
        'Finish must not paint the avatar nearly black: '+JSON.stringify(piece));
    }
    const weapon=output.pieces.find(p=>p.id==='statue_weapon_0');
    assert.ok(weapon?.textureReady&&!weapon.textureError,'Redirected weapon sprite must remain pixel-readable: '+JSON.stringify(weapon));
    for(const limb of output.pieces.filter(p=>p.id.includes('_hand')||p.id.includes('_foot'))) {
      assert.equal(limb.modelError,null,'Species limb GLB should load: '+JSON.stringify(limb));
      assert.equal(limb.modelReady,true,'The real hand/foot model must be loaded: '+JSON.stringify(limb));
      assert.equal(limb.textureReady,true,'The chosen finish must cover hand/foot meshes: '+JSON.stringify(limb));
      assert.ok(limb.material?.brightCoverage>.12,
        'The same statue texture must not leave limb GLBs black: '+JSON.stringify(limb));
    }
    assert.equal(pageErrors.length,0,'No unhandled browser errors: '+pageErrors.join('\n'));
    console.log('PASS actual Chromium mobile statue: '+JSON.stringify({
      layout,body:body.material,head:head.material,pieces:output.pieces.length,
      redirectedImages:imageRedirects,pose:output.phase
    }));
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>remoteAssets.close(resolve));
  }
}
run().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});

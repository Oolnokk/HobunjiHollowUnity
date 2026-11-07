#!/usr/bin/env node
'use strict';
// Runs the real clothing fit editor, game portrait renderer, and Three.js shell in Chromium.
// Unlike structural unit tests, this checks that the selected Tletingan Fine Hood actually builds.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
let chromium;
try{({chromium}=require('playwright'));}catch(error){
  if(error.code!=='MODULE_NOT_FOUND')throw error;
  console.log('skip: playwright unavailable');
  process.exit(0);
}
const root=path.resolve(__dirname,'..'); // Uses shipping docs/config and PNGs, never substitute test assets.
const threeFile=path.join(root,'node_modules/three/build/three.min.js');
const statusErrors=[]; // Captures readable errors for mobile-style diagnostics in CI.
let origin='';
const server=http.createServer((request,response)=>{
  const uri=new URL(request.url||'/',origin||'http://127.0.0.1');
  let pathname;
  try{pathname=decodeURIComponent(uri.pathname);}catch{response.writeHead(400);response.end();return}
  if(pathname==='/vendor-three.js'){
    if(!fs.existsSync(threeFile)){response.writeHead(404);response.end('Three.js unavailable');return}
    response.setHeader('Content-Type','text/javascript');
    response.end(fs.readFileSync(threeFile));return;
  }
  const filename=path.resolve(root,pathname.replace(/^\/+/,''));
  if(!filename.startsWith(root+path.sep)){response.writeHead(403);response.end();return}
  fs.readFile(filename,(error,bytes)=>{
    if(error){response.writeHead(404);response.end(error.message);return}
    if(pathname==='/docs/tools/clothing-species-fit/index.html'){
      let html=bytes.toString('utf8');
      const oldCdn='https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
      const oldDocs='value="https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/main/docs/"';
      assert(html.includes(oldCdn)&&html.includes(oldDocs),'Shipping editor browser bootstrap changed');
      html=html.replace(oldCdn,'/vendor-three.js')
        .replace(oldDocs,'value="'+origin+'/docs/"');
      response.setHeader('Content-Type','text/html');response.end(html);return;
    }
    const ext=path.extname(filename).toLowerCase();
    const mime={'.js':'text/javascript','.txt':'text/plain','.html':'text/html','.json':'application/json',
      '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.css':'text/css'};
    response.setHeader('Content-Type',mime[ext]||'application/octet-stream');
    response.end(bytes);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle',
      '--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1200,height:960}});
    page.on('pageerror',error=>statusErrors.push('JS: '+(error.stack||error.message)));
    page.on('console',message=>{if(message.type()==='error')statusErrors.push('console: '+message.text());});
    await page.goto(origin+'/docs/tools/clothing-species-fit/index.html',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>{
      const species=document.getElementById('species');
      const source=document.getElementById('sourceSpecies');
      return [...(species?.options||[])].some(option=>option.value==='tletingan')&&
        [...(source?.options||[])].some(option=>option.value==='tletingan');
    },null,{timeout:90000});
    await page.selectOption('#fitRegion','headwear');
    await page.selectOption('#sourceSpecies','tletingan');
    await page.selectOption('#sourceGender','male');
    await page.selectOption('#species','tletingan');
    await page.selectOption('#gender','male');
    await page.waitForFunction(()=>[...(document.getElementById('garment')?.options||[])]
      .some(option=>option.value==='fine_hood'),null,{timeout:60000});
    await page.selectOption('#garment','fine_hood');
    await page.waitForFunction(()=>{
      const status=document.getElementById('threeStatus')?.textContent||'';
      const layer=document.getElementById('sourceLayerStatus')?.textContent||'';
      return status.includes('canonical game clothing renderer')||
        status.includes('failed:')||status.includes('Runtime load failed')||
        layer.includes('Cannot show target');
    },null,{timeout:120000});
    const result=await page.evaluate(()=>{
      const value=id=>document.getElementById(id)?.textContent||'';
      const stage=document.getElementById('stage');
      const pixels=stage?.getContext('2d')?.getImageData(0,0,stage.width,stage.height)?.data;
      let opaque=0;
      if(pixels)for(let p=3;p<pixels.length;p+=4)if(pixels[p]>0)opaque++;
      return{
        status:value('threeStatus'),match:value('match3DStatus'),sources:value('sourceLayerStatus'),
        debug:value('debug').slice(0,5000),
        stageOpaquePixels:opaque,threeCanvasCount:document.querySelectorAll('#threeHost canvas').length,
        selectedGarment:document.getElementById('garment')?.value,
        target:document.getElementById('species')?.value,
        source:document.getElementById('sourceSpecies')?.value,
      };
    });
    assert.equal(result.selectedGarment,'fine_hood','The selected garment is Fine Hood');
    assert.equal(result.target,'tletingan','Target species is Tletingan');
    assert.equal(result.source,'tletingan','Donor art is Tletingan');
    assert.match(result.status,/canonical game clothing renderer/,
      'The 3D build must use canonical front and behind portrait rendering; '+result.status);
    assert.match(result.match,/Game-matched:/,'2D must inverse-project the very same front canvas as the 3D rig');
    assert.match(result.debug,/2D and 3D shared front texture: current/,
      'Mobile diagnostics must confirm the two views display the same portrait raster');
    assert(result.stageOpaquePixels>100,'The synchronized 2D portrait must have visible pixels');
    assert(result.threeCanvasCount>0,'Three.js must create an actual WebGL preview canvas');
    assert.match(result.debug,/head\.layers\.front \[front\]/, 'The fitted Fine Hood base material is present');
    assert.match(result.debug,/head\.layers\.front_trim \[front\]/, 'The separately authored trim material is present');
    console.log('PASS: real Chromium Tletingan Fine Hood 3D rig, canonical game renderer, headwear layers, and matched 2D pixels');
  }catch(error){
    console.error('Browser errors:',statusErrors.slice(-15).join('\n'));
    throw error;
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});

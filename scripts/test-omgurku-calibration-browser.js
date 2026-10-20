'use strict';
// CI browser smoke test: actual Omgurku calibration page, shared Three.js model,
// live edit, species export, and local game override. No pre-existing NPC required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only test)');
  process.exit(0);
}
const root=path.resolve(__dirname,'..');
const types={'.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.css':'text/css'};
const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/,'');
  const absolute=path.resolve(root,relative);
  if(!absolute.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(absolute,(error,data)=>{
    if(error){res.writeHead(404);return res.end('Missing '+relative);}
    res.setHeader('Content-Type',types[path.extname(absolute)]||'application/octet-stream');
    res.end(data);
  });
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:800}});
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/docs/tools/omgurku-calibration/index.html',
      {waitUntil:'domcontentloaded',timeout:25000});
    await page.waitForFunction(()=>{
      const api=window.HobunjiOmgurkuCalibration;
      return api && (api.snapshot().hasComposite || api.snapshot().error);
    },null,{timeout:55000});
    const before=await page.evaluate(()=>window.HobunjiOmgurkuCalibration.snapshot());
    assert.equal(before.error,null,'calibration load: '+before.error+'\npage errors: '+errors.join('\n'));
    assert.equal(before.hasComposite,true,'real hybrid Omgurku should build without selected NPC');
    await page.locator('#number_saddleU').fill('0.421');
    await page.locator('#number_saddleU').dispatchEvent('change');
    const current=await page.evaluate(()=>window.HobunjiOmgurkuCalibration.snapshot());
    assert.equal(current.placement.saddleU,.421);
    await page.locator('#saveLocalBtn').click();
    const saved=await page.evaluate(()=>{
      return JSON.parse(localStorage.getItem(window.HobunjiOmgurkuSpecies.localPlacementKey));
    });
    assert.equal(saved.hybridPlacement.saddleU,.421,'browser saved placement');
    await page.locator('#resetBtn').click();
    const cleared=await page.evaluate(()=>localStorage.getItem(window.HobunjiOmgurkuSpecies.localPlacementKey));
    assert.equal(cleared,null,'clear local override');
    await page.locator('#moveBtn').click();
    await page.waitForFunction(()=>/^run[12]$/.test(window.HobunjiOmgurkuCalibration.snapshot().frame),
      null,{timeout:4000});
    await page.locator('#moveBtn').click();
    assert.deepEqual(errors,[],'uncaught browser exceptions');
    console.log('Omgurku editor browser smoke passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
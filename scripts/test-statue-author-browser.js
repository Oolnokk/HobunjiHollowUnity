#!/usr/bin/env node
'use strict';
// Real Chromium smoke for NPC → Attack Editor pose → static stone GLB → Furniture Editor piece.
const assert=require('node:assert/strict'); // Assertions are against actual browser-produced GLB bytes.
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
let chromium;
try{({chromium}=require('playwright'));}
catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;console.log('skip: playwright not installed');process.exit(0);}
const root=path.resolve(__dirname,'..');
const mime={'.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.glb':'model/gltf-binary','.css':'text/css'};
const server=http.createServer((req,res)=>{
  const route=decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/,'');
  const file=path.resolve(root,route);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404);return res.end('Missing '+route);}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(bytes);});
});
const threeDir=path.resolve(root,'node_modules/three'); // CI installs Three r128 alongside Playwright.
const readThree=url=>{
  const match=new URL(url).pathname.match(/^\/three@0\.128\.0\/(.+)$/);
  if(!match)return null;
  const file=path.resolve(threeDir,match[1]);
  if(!file.startsWith(threeDir+path.sep))return null;
  try{return fs.readFileSync(file);}catch{return null;}
};
function brief(errors){return errors.slice(-10).join('\n').slice(0,2500);}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,
      args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const ctx=await browser.newContext({viewport:{width:412,height:850},isMobile:true,hasTouch:true,acceptDownloads:true});
    const page=await ctx.newPage(),errors=[]; // All errors appear in CI output; no mobile devtools required.
    page.on('pageerror',error=>errors.push(error.stack||error.message));
    const base='http://127.0.0.1:'+server.address().port+'/docs/tools/';
    await page.route('https://unpkg.com/three@0.128.0/**',async route=>{
      const bytes=readThree(route.request().url());
      if(!bytes)return route.abort();
      await route.fulfill({status:200,contentType:'text/javascript',body:bytes});
    }); // Deterministic local Three.js r128, independent of a public CDN.
    await page.goto(base+'statue-author/index.html',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>!!document.querySelector('#attack')?.contentWindow?.HobunjiStatuePoseSource,
      null,{timeout:60000}).catch(error=>{throw Error('Attack Editor bridge not ready: '+error.message+'\n'+brief(errors));});
    await page.locator('#weapon').selectOption('no');
    await page.locator('#pose').selectOption('neutral');
    await page.locator('#bake').click();
    const getStatus=()=>page.locator('#status').innerText();
    await page.waitForFunction(()=>/Baked \d+ mesh|Bake failed:/.test(document.querySelector('#status')?.textContent||''),null,{timeout:60000});
    assert.match(await getStatus(),/Baked \d+ mesh/,brief(errors));
    const editor=page.frameLocator('#attack');
    await editor.locator('#toolSpriteSelect').selectOption('hatchet');
    await page.waitForFunction(()=>{
      const iframe=document.querySelector('#attack')?.contentWindow;
      return iframe?.HobunjiAttackEditorToolContext?.toolKey==='hatchet'
        && !!iframe?.HobunjiAttackEditorToolContext?.toolPlaneMesh;
    },null,{timeout:20000});
    await page.locator('#pose').selectOption('strike');
    await page.locator('#weapon').selectOption('yes');
    await page.locator('#bake').click();
    await page.waitForFunction(()=>/Baked \d+ mesh|Bake failed:/.test(document.querySelector('#status')?.textContent||'')
      && !document.querySelector('#bake')?.disabled,null,{timeout:60000});
    const status=await getStatus();
    assert.match(status,/Baked \d+ mesh/,brief(errors));
    assert.match(status,/[1-9]\d* weapon mesh/,'The weapon should have been captured as stone.');
    const [download]=await Promise.all([page.waitForEvent('download',{timeout:20000}),page.locator('#downloadJson').click()]);
    const data=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(data.schema,'hobunji_statue_piece.v1');
    assert.equal(data.part.statueBaked,true);
    assert.equal(data.part.preserveMaterials,true);
    assert.equal(data.part.statueSource.poseKey,'strike');
    assert.equal(data.part.statueSource.toolKey,'hatchet');
    assert.match(data.part.modelPath,/^data:model\/gltf-binary;base64,/);
    const bytes=Buffer.from(data.part.modelPath.split(',')[1],'base64');
    assert.equal(bytes.toString('ascii',0,4),'glTF','Export must be a real binary glTF, not a JSON stand-in.');
    assert(bytes.length>1000,'Static GLB must contain real geometry and textures.');

    const furniture=await ctx.newPage(),furnitureErrors=[];
    furniture.on('pageerror',error=>furnitureErrors.push(error.stack||error.message));
    await furniture.goto(base+'furniture-avatar-author/index.html',{waitUntil:'domcontentloaded',timeout:30000});
    await furniture.locator('#statuePieceFileInput').setInputFiles({
      name:'test_statue_piece.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))
    });
    await furniture.waitForFunction(()=>/Added .* as one independent furniture piece|Import failed/.test(
      document.querySelector('#statuePieceImportStatus')?.textContent||''),null,{timeout:35000});
    const imported=await furniture.locator('#statuePieceImportStatus').innerText();
    assert.match(imported,/Added .* as one independent furniture piece/,brief(furnitureErrors));
    console.log('Statue Author real browser: static skinned NPC, stone weapon, GLB export, and furniture piece import passed. '+status);
  }finally{
    if(browser)await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,15000))]);
    await new Promise(resolve=>server.close(resolve));
  }
})().then(()=>process.exit(0),error=>{console.error(error?.stack||error);process.exit(1);});

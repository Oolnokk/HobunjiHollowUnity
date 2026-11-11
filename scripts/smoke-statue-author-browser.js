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
    await page.waitForFunction(()=>document.querySelector('#weaponSpriteSelect option[value="assets/toolsprites/harlyao_longsword.png"]'),null,{timeout:20000});
    await page.selectOption('#weaponSpriteSelect','assets/toolsprites/harlyao_longsword.png');
    await page.click('#addWeaponSprite'); // Test the new indexed dropdown, including redirected cross-origin PNG loading.
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
      assert.ok(limb.material?.brightCoverage>.6&&limb.material.meanVisibleBrightness>100,
        'The hand/foot texture must be genuinely light enough to read, not nearly black: '+JSON.stringify(limb));
      assert.ok(limb.glbUvModes?.length>0&&!limb.glbUvModes.includes('unknown'),
        'Every GLB limb needs usable authored or generated UVs: '+JSON.stringify(limb));
    }
    assert.equal(pageErrors.length,0,'No unhandled browser errors: '+pageErrors.join('\n'));
    console.log('PASS actual Chromium mobile statue: '+JSON.stringify({
      layout,body:body.material,head:head.material,pieces:output.pieces.length,
      redirectedImages:imageRedirects,pose:output.phase
    }));
    // Pahu's facial cosmetics were visibly lost by the old bare-head-only
    // extraction path. Exercise the actual NPC instead of trusting generic
    // alpha coverage tests on the first NPC in the repository list.
    const options=await page.locator('#npcSelect option').allTextContents();
    const pahuIndex=options.findIndex(option=>/\bPahu\b/i.test(option));
    assert.ok(pahuIndex>0,'Pahu must be selectable in the repository NPC list');
    await page.selectOption('#npcSelect',{index:pahuIndex});
    await page.click('#clearWeaponSprites'); // Test the new mobile Clear button rather than a hidden textarea.
    await page.click('#build');
    await page.waitForFunction(()=>{
      const debug=window.__hobunjiStatueDebug?.();
      if(debug?.builtNpcId!=='pahu'||debug.buildActive)return false; // Wait for this NPC's finished export, not the previously built one.
      return debug.pieces?.every(p=>p.id.includes('_hand')||p.id.includes('_foot')
        ? p.modelError||p.textureError||(p.modelReady&&p.textureReady)
        : p.textureReady||p.textureError);
    },null,{timeout:90000});
    const pahu=await page.evaluate(()=>window.__hobunjiStatueDebug());
    console.log('PAHU PARTS '+JSON.stringify({rig:pahu.sourceRig,parts:pahu.pieces.map(p=>({
      id:p.id,worldSize:p.worldSize,screenCenter:p.screenCenter,visible:p.visible,textureError:p.textureError,modelError:p.modelError
    }))}));
    assert.ok(pahu.built,'Pahu statue should construct: '+JSON.stringify(pahu));
    const pahuHead=pahu.pieces.find(piece=>piece.id==='statue_head');
    const inkSurfaces=pahu.pieces.filter(piece=>piece.id==='statue_head'||piece.id==='statue_body');
    const cells=inkSurfaces.reduce((total,piece)=>total+(piece.surfaceCells||0),0);
    assert.ok(cells>2,'Pahu must use independent animal-style shading per black-outlined cell: '+JSON.stringify(inkSurfaces));
    assert.ok(inkSurfaces.every(piece=>piece.surfaceCellStats?.mode==='animal-cell-shading-global-brightness-overlay'),
      'Each portrait layer must use the new two-pass color pipeline: '+JSON.stringify(inkSurfaces));
    assert.ok(inkSurfaces.every(piece=>piece.surfaceCellStats?.meanOverlayAlpha>=0&&piece.surfaceCellStats?.overlayPeak>0),
      'One normalized grayscale overlay must be applied after color fills: '+JSON.stringify(inkSurfaces));
    assert.ok(inkSurfaces.some(piece=>piece.surfaceCellStats?.inkPixels>15),
      'The statue must preserve original black cell outlines: '+JSON.stringify(inkSurfaces));
    assert.ok(inkSurfaces.every(piece=>piece.material?.surfaceShadeBins>=3&&piece.material?.surfaceShadeRange>20),
      'Animal-style cell shading plus global overlay must preserve authored tonal differences: '+JSON.stringify(inkSurfaces));
    assert.ok(pahuHead?.textureReady&&!pahuHead?.textureError,'Pahu head and cosmetics should render');
    assert.ok(pahuHead.material?.coverage>.02,'Pahu head must have a visible silhouette');
    const pahuBody=pahu.pieces.find(piece=>piece.id==='statue_body');
    assert.ok(pahuBody.material?.meanVisibleBrightness>45&&pahuHead.material?.meanVisibleBrightness>45,
      'The head/hood and body must both show visible sculpture color: '+JSON.stringify([pahuBody,pahuHead]));
    assert.ok(pahuHead.material.meanVisibleBrightness>=pahuBody.material.meanVisibleBrightness*.55,
      'The head cannot be disproportionately darker than the torso: '+JSON.stringify([pahuBody.material,pahuHead.material]));
    for(const limb of pahu.pieces.filter(p=>p.id.includes('_hand')||p.id.includes('_foot'))){
      assert.ok(limb.material?.meanVisibleBrightness>100,
        'Pahu hand and foot material cannot fall back to black: '+JSON.stringify(limb));
      assert.ok(limb.worldSize?.every(value=>value<.55),
        'Attached limb exceeds its furniture dimensions: '+JSON.stringify(limb));
    }
    for(const piece of [pahuBody,pahuHead]){
      assert.equal(piece.visible,true,'Pahu portrait mesh was hidden: '+JSON.stringify(piece));
      assert.equal(piece.opacity,1,'Pahu portrait material was not ready: '+JSON.stringify(piece));
      assert.ok(piece.worldSize?.[1]>.1&&piece.worldSize?.[1]<1.5,
        'Pahu statue must fit in a furniture tile: '+JSON.stringify(piece));
      assert.ok(Math.abs(piece.screenCenter?.[0])<.85&&Math.abs(piece.screenCenter?.[1])<.85,
        'Pahu statue must be inside the actual 3D camera: '+JSON.stringify(piece));
    }
    fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
    const image=await page.locator('#viewport').screenshot({path:path.join(root,'artifacts','statue-pahu.png')});
    const pixels=await page.evaluate(async url=>{
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      const data=ctx.getImageData(0,0,canvas.width,Math.round(canvas.height*.85)).data;
      let statuePixels=0;
      for(let i=0;i<data.length;i+=4){
        const r=data[i],g=data[i+1],b=data[i+2];
        if(r>45&&g>35&&b>25&&r>b*1.05&&g>b*.95&&(r+g+b)>150)statuePixels++;
      }
      return {statuePixels,width:canvas.width,height:canvas.height};
    },'data:image/png;base64,'+image.toString('base64'));
    assert.ok(pixels.statuePixels>3500,
      'Pahu body/head must actually be visible (not merely textured off-camera): '+JSON.stringify({pixels,rig:pahu.sourceRig,body:pahuBody,head:pahuHead}));
    assert.equal(pahu.authoredRig?.rigProfileFound,true,
      'Pahu should use the actual Rakakoan Rig Coordinates profile, not a guessed avatar.');
    assert.ok(pahu.authoredRig?.feet?.restStance?.left?.ankle
      &&pahu.authoredRig.feet.restStance.right.ankle,
      'Pahu feet must come from the actual procedural leg solver: '+JSON.stringify(pahu.authoredRig?.feet));
    assert.equal(pahu.authoredRig?.feet?.samplingWarning,null,
      'Do not silently replace a broken procedural rig with guessed feet.');
    assert.equal(pahu.authoredRig?.provenance?.footPosition,'ProceduralLegAnimation.getRestStance()');
    assert.ok(pahu.authoredRig?.hands?.shoulders?.left&&pahu.authoredRig.hands.shoulders.right,
      'Actual hand shoulder coordinates must survive the furniture snapshot.');
    assert.ok(pahu.authoredRig?.head?.scale>0&&pahu.authoredRig?.bodyScale?.x>0,
      'Rig body axes and independent head scale must survive the snapshot.');
    console.log('PASS Pahu head-and-cosmetics statue: '+JSON.stringify({
      head:pahuHead.material,cells,selected:options[pahuIndex],pixels,rig:pahu.sourceRig,
      pieceBounds:pahu.pieces.map(p=>({id:p.id,worldSize:p.worldSize,visible:p.visible,screenCenter:p.screenCenter})),
      screenshot:'artifacts/statue-pahu.png'
    }));
    await page.waitForFunction(()=>document.querySelector('#generateHero')?.disabled===false,
      null,{timeout:20000});
    await page.selectOption('#heroSpecies','mao-ao');
    await page.click('#generateHero');
    await page.waitForFunction(()=>{
      const debug=window.__hobunjiStatueDebug?.();
      return debug?.builtNpcId?.startsWith('statue-hero-mao-ao-')
        &&debug.heroEquipment?.armor?.length>0&&!debug.buildActive;
    },null,{timeout:120000});
    await page.waitForFunction(()=>{
      const debug=window.__hobunjiStatueDebug?.();
      return !!debug?.pieces?.length&&debug.pieces.every(piece=>
        piece.id.includes('_hand')||piece.id.includes('_foot')
          ? piece.modelReady&&piece.textureReady
          : piece.textureReady);
    },null,{timeout:30000});
    const generated=await page.evaluate(()=>window.__hobunjiStatueDebug());
    assert.ok(generated.authoredRig?.rigProfileFound&&generated.authoredRig?.feet?.restStance?.left,
      'Generated hero must use the real Mao-ao standing rig, not a per-species guessed foot offset');
    assert.equal(generated.authoredRig?.feet?.samplingWarning,null,
      'The hero leg solver must complete without fallback');
    assert.equal(generated.heroEquipment.speciesId,'mao-ao',
      'Hero species must be selected by the user, not bandit gang species weights');
    assert.ok(generated.heroEquipment.cosmetics.length>0,'Hero must have actual whitelist-approved clothing');
    assert.ok(generated.heroEquipment.armor.some(item=>item.id==='rounded_pauldron'),
      'Captain armor must use the game’s real crafted pauldron blueprint');
    assert.ok(generated.heroEquipment.armor.some(item=>item.id==='tangedcirclet'),
      'Captain helmet must use the game’s real crafted circlet blueprint');
    assert.ok(generated.heroEquipment.metalKey,'Hero weapon must use a real metal tier');
    const torsoPart=generated.pieces.find(item=>item.id==='statue_body');
    const mainWeaponPart=generated.pieces.find(item=>item.id==='statue_weapon_0');
    assert.ok(mainWeaponPart?.size?.sy<=torsoPart?.size?.sy*.91,
      'Generated hero weapons must fit the actor height without stretched art: '+JSON.stringify([torsoPart,mainWeaponPart]));
    assert.ok(generated.pieces.some(item=>item.id==='statue_weapon_0'&&item.textureReady),
      'Hero must visibly hold a weapon from the cultural bandit shape pool');
    assert.ok(generated.pieces.some(item=>item.id==='statue_weapon_1'&&item.textureReady),
      'Hero must receive a second weapon from the captain ranged pool');
    await page.locator('#viewport').screenshot({path:path.join(root,'artifacts','statue-hero.png')});
    console.log('PASS Random Hero species-locked equipment: '+JSON.stringify({
      hero:generated.builtNpcId,equipment:generated.heroEquipment,
      pieces:generated.pieces.map(item=>({id:item.id,ready:item.textureReady})),
      screenshot:'artifacts/statue-hero.png'
    }));

  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>remoteAssets.close(resolve));
  }
}
run().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});

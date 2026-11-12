#!/usr/bin/env node
'use strict';
// Inspection aid for authoring static per-cosmetic six-direction spline poses.
// Reads the *actual* 200px portrait compositor, not unscaled source PNG bounds.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
let chromium;
try{({chromium}=require('playwright'));}catch(error){if(error.code==='MODULE_NOT_FOUND'){console.log('skip: playwright unavailable');process.exit(0);}throw error;}
const root=path.resolve(__dirname,'..');
const paths=[
  ['mao-ao','male','mao-ao/grandbeard.json'],
  ['mao-ao','male','mao-ao/wildbeard.json'],
  ['mao-ao','male','mao-ao/braid-L.json'],
  ['mao-ao','male','mao-ao/braid-R.json'],
  ['mao-ao','male','mao-ao/braidcluster-R.json'],
  ['tletingan','male','tletingan/grandbeard.json'],
  ['tletingan','male','tletingan/wildbeard.json'],
  ['tletingan','male','tletingan/braid-R.json'],
  ['tletingan','male','tletingan/braidcluster-R.json'],
  ['kenkari','male','kenkari/grandbeard.json'],
  ['kenkari','male','kenkari/wildbeard.json'],
  ['kenkari','male','kenkari/shirtbeard.json'],
  ['kenkari','male','kenkari/braid-L_m.json'],
  ['kenkari','male','kenkari/braid-R_m.json'],
  ['mashtzarr','male','mashtzarr-m/grandbeard.json'],
  ['mashtzarr','male','mashtzarr-m/wildbeard.json'],
];
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/,''));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(error,bytes)=>{
    if(error){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
    res.end(bytes);
  });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const threeMain=fs.readFileSync(path.join(root,'node_modules/three/build/three.module.js'),'utf8');
  const orbitSource=fs.readFileSync(path.join(root,'node_modules/three/examples/jsm/controls/OrbitControls.js'),'utf8').replace(/from ['"]three['"]/g,"from 'https://esm.sh/three@0.128.0'");
  await context.route(/^https:\/\/esm\.sh\/three@0\.128\.0/,route=>{
    const url=route.request().url();
    return route.fulfill({status:200,contentType:'application/javascript',body:url.includes('/examples/jsm/controls/OrbitControls.js')?orbitSource:threeMain,
      headers:{'Access-Control-Allow-Origin':'*'}});
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/docs/tools/portrait-spline-author/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.HobunjiSplineAuthorDiagnostics?.().canonicalPortrait?.loaded,{timeout:90000});
  const results=await page.evaluate(async targets=>{
    const Catalog=window.PortraitSplineCatalog,Rig=window.PortraitSplineRig;
    const catalog=await Catalog.loadIndex();
    const result=[],heads=new Map();
    for(const [species,gender,filename] of targets){
      const styles=(await catalog.styles(species,gender)).options;
      const style=styles.find(s=>s.entry.path.endsWith(filename));
      if(!style){result.push({filename,error:'No indexed style for '+species+'/'+gender});continue;}
      const image=await Catalog.composeArtwork(style.config,species,gender,'front');
      if(!heads.has(species+'_'+gender)){
        const fighter=(window.getPortraitFighters?.()||[]).find(f=>
          (f.speciesId===species||f.speciesId===species.replace(/-/g,'_'))&&String(f.gender).toLowerCase()===gender);
        if(!fighter){result.push({filename,error:'No portrait fighter for '+species+'/'+gender});continue;}
        const none={id:'none',label:'None',tintSlot:null,layers:[]};
        const profile={fighter,bodyColors:{},hair:none,hairFront:none,hairBack:none,
          hairSide:none,hairSideL:none,hood:none,eyes:none,upperFace:none,
          facialHair:none,pauldron:none,hat:none,torsoCosmetic:none,armCosmetic:none};
        const canvas=document.createElement('canvas');canvas.width=canvas.height=200;
        await window.NpcAvatarPreview.renderProfileToCanvas(canvas,profile,{forceEyesOpen:true,portraitView:'front',onlyHeadSprite:true});
        const rear=document.createElement('canvas');rear.width=rear.height=200; // Separately rendered rear head, never inferred by mirroring front skin pixels.
        await window.NpcAvatarPreview.renderProfileToCanvas(rear,profile,{forceEyesOpen:true,portraitView:'behind',onlyHeadSprite:true});
        heads.set(species+'_'+gender,{front:canvas,rear});
      }
      const head=heads.get(species+'_'+gender).front;
      const points=Rig.suggestRestPoints(image,head);
      const mask=Rig.maskFromOverlap(image,head);
      const rearArtwork=style.slot==='facialHair'?null:await Catalog.composeArtwork(style.config,species,gender,'rear');
      const rearMask=rearArtwork?Rig.maskFromOverlap(rearArtwork,heads.get(species+'_'+gender).rear):null; // Actual rear overlap is an independent binary pin region.
      const source=image.getContext('2d').getImageData(0,0,200,200).data;
      let minX=200,minY=200,maxX=-1,maxY=-1,opaque=0;
      for(let y=0;y<200;y++)for(let x=0;x<200;x++){
        if(source[(y*200+x)*4+3]<8)continue;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);
        minY=Math.min(minY,y);maxY=Math.max(maxY,y);opaque++;
      }
      result.push({filename,species,gender,name:style.label,slot:style.slot,
        source:style.entry.path,points,bbox:[minX,minY,maxX,maxY],opaque,
        rigid:mask.runs.reduce((a,v)=>a+v[1],0),runs:mask.runs,
        rearRigid:rearMask?.runs.reduce((a,v)=>a+v[1],0)||0,rearRuns:rearMask?.runs||[]});
    }
    return result;
  },paths);
  for(const entry of results)console.log('SPLINE_ART '+JSON.stringify(entry));
  if(errors.length)console.warn('Author page diagnostics:',errors.slice(0,8));
  if(results.some(x=>x.error))process.exitCode=1;
 }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error.stack||error);server.close();process.exitCode=1;});

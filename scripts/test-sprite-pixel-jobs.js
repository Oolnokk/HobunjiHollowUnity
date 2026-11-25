#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=name=>fs.readFileSync('docs/js/'+name,'utf8');
function load(ctx,name){vm.runInContext(read(name),ctx,{filename:name});}
const palette=[[0,0,0],[255,255,255],[127,110,119],[186,186,186],[125,125,118],[152,151,142],[112,111,105],[93,130,77],[170,193,140],[25,45,36],[18,18,18],[230,20,180]];
function fixture(n,seed=1234){
  const data=new Uint8ClampedArray(n*4);let x=seed;
  const rand=()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x>>>24;};
  for(let i=0;i<n;i++){
    const c=i%7===0?[rand(),rand(),rand()]:palette[rand()%palette.length];
    data.set([...c,i%13===0?0:i%11===0?127:255],i*4);
  }
  return data;
}
function hash(a){let h=2166136261;for(const b of a)h=Math.imul(h^b,16777619)>>>0;return h.toString(16).padStart(8,'0');}
const expected={
  gurumahi_tawny:'3ba0fa79',gurumahi_charcoal:'7717c346',gurumahi_creamback:'71f7cbf7',gurumahi_snowmuzzle:'a4aa5afd',
  rockscale_goldplate:'2ad19f88',rockscale_giltback:'323a936c',rockscale_silverplate:'6e566936',rockscale_ironvein:'f62eef7e',
  rockscale_slateplate:'838244fb',rockscale_quartzshield:'3f95cf09',rockscale_copperbloom:'1d25c2a0',
  mossfin_fernback:'baa2f0a6',mossfin_peatbelly:'5eb5fc11',mossfin_silverfrond:'8f343c65',
  mossfin_coppergill:'b5622c44',mossfin_frostcap:'1394da19'
}; // RGBA hashes from the unmodified 02ac6870 algorithm, including protected hues and alpha.
let now=0,turns=0,workerInstances=0,failNext=false;
class FakeWorker{
  constructor(url){
    assert.match(url,/sprite-pixel-worker\.js\?v=/);workerInstances++;
    const self={postMessage:m=>Promise.resolve().then(()=>this.onmessage({data:m}))};
    const context=vm.createContext({self,window:self,ArrayBuffer,Uint8ClampedArray,performance:{now:()=>now},importScripts:(...urls)=>urls.forEach(url=>load(context,url.split('?')[0]))});
    load(context,'sprite-pixel-worker.js');this.self=self;
  }
  postMessage(m,transfer){
    assert.equal(transfer[0],m.buffer);
    if(failNext){failNext=false;throw Error('fixture worker blocked');}
    Promise.resolve().then(()=>this.self.onmessage({data:m}));
  }
  terminate(){this.terminated=true;}
}
const w={Worker:FakeWorker,__hobunjiPixelWorker:true,SCRATCHBONES_CONFIG:{game:{portrait:{tinting:{neutralLuminance:.31}}}}};
const context=vm.createContext({window:w,ArrayBuffer,Uint8ClampedArray,URL,
  document:{currentScript:{src:'https://example.com/docs/js/pixel-work-yield.js'},getElementById:()=>null,querySelector:()=>null},
  performance:{now:()=>++now},scheduler:{yield:async()=>{turns++;}},setTimeout,clearTimeout,console});
for(const name of ['color-fill.js','sprite-recolor.js','fish-catalog.js','pixel-work-yield.js'])load(context,name);
const P=w.PixelWorkYield,F=w.FishCatalog,S=w.SpriteRecolor;
(async()=>{
  for(const [key,expectedHash] of Object.entries(expected)){
    const data=fixture(20000);
    for(const _ of F.pixelSteps(data,key,'fixture')){}
    assert.equal(hash(data),expectedHash,key+' matches legacy pixels');
  }
  assert.equal(F.getPixelDebug().profileBuilds,3);
  assert.equal(F.getPixelDebug().profileHits,13);
  const pattern=new Uint8ClampedArray([45,100,10,127,255,0,0,0,5,20,30,255]);
  for(const _ of F.patternSteps(pattern,'#ff0000')){}
  assert.deepEqual([...pattern],[100,0,0,127,255,0,0,0,30,0,0,255]);
  { // Large sprites: both buffer copies are sliced and yield, and the pixels are still byte-identical.
    const big=fixture(1500000), reference=big.slice(); // ~6 MB RGBA, several 1 MB copy slices each way.
    for(const _ of F.pixelSteps(reference,'rockscale_goldplate','fixture-big')){}
    const turnsBefore=turns, yieldsBefore=P.getDebug().yields;
    now+=100; // Budget already spent, so each slice boundary must yield.
    await P.runCanvasJob(()=>P.processPixels('fish-base',big,{key:'rockscale_goldplate',sourceKey:'fixture-big'},()=>{throw Error('unexpected fallback');}));
    assert.equal(hash(big),hash(reference),'large buffer result matches the single-pass algorithm');
    assert.ok(P.getDebug().yields-yieldsBefore>=2,'sliced copies yield to the main thread: '+(P.getDebug().yields-yieldsBefore));
  }
  const result=fixture(20000),source=result.slice();
  await P.runCanvasJob(()=>P.processPixels('fish-base',result,{key:'rockscale_goldplate',sourceKey:'fixture'},()=>{throw Error('unexpected fallback');}));
  assert.equal(hash(result),expected.rockscale_goldplate);
  assert.equal(P.getDebug().workerJobs,2); // The large-buffer case above plus this one.
  assert.equal(P.getDebug().workerFish.profileBuilds,2);
  const second=source.slice();
  await P.runCanvasJob(()=>P.processPixels('fish-base',second,{key:'rockscale_silverplate',sourceKey:'fixture'},()=>{throw Error('unexpected fallback');}));
  assert.equal(hash(second),expected.rockscale_silverplate);assert.equal(P.getDebug().workerFish.profileHits,1);
  const modes=['direct','mushroom','keyed','dual-keyed:cc3344'];
  for(const mode of modes){
    const original=fixture(20000),want=original.slice(),got=original.slice();
    S.recolorImageData(want,0x9245c0,mode);
    await P.runCanvasJob(()=>S.recolorAsync(got,0x9245c0,mode));
    assert.deepEqual(got,want,'worker parity '+mode);
  }
  assert.equal(workerInstances,1,'all jobs share one worker');
  // A failed transfer leaves the original buffer untouched and uses the identical fallback.
  failNext=true;
  const fallback=source.slice(),want=source.slice();
  S.recolorImageData(want,0x5678ab,'direct');
  await P.runCanvasJob(()=>S.recolorAsync(fallback,0x5678ab,'direct'));
  assert.deepEqual(fallback,want);
  assert.equal(P.getDebug().workerState,'failed-fallback');
  assert.equal(P.getDebug().workerFailures,1);
  for(const mode of modes){
    // The first chunk contains only black, white and transparent pixels.
    // Later chunks contain very dark and brighter eligible pixels.
    const original=fixture(20000);for(let i=0;i<4096*4;i+=4){original[i]=original[i+1]=original[i+2]=i%8?255:0;}
    const expected=original.slice(),got=original.slice();
    S.recolorImageData(expected,0x87a322,mode);
    await P.runCanvasJob(()=>S.recolorAsync(got,0x87a322,mode));
    assert.deepEqual(got,expected,'cooperative fallback parity '+mode);
  }
  const nearBlack=new Uint8ClampedArray(5000*4);
  for(let i=0;i<nearBlack.length;i+=4){nearBlack[i+3]=255;if(i>=4096*4)nearBlack[i+2]=1;}
  const nearExpected=nearBlack.slice();S.recolorImageData(nearExpected,0xff5511,'direct');
  await P.runCanvasJob(()=>S.recolorAsync(nearBlack,0xff5511,'direct'));
  assert.deepEqual(nearBlack,nearExpected,'very low positive luminance is not replaced by a chunk fallback');
  const order=[];
  const a=P.runCanvasJob(async()=>{order.push('a start');await Promise.resolve();order.push('a end');throw Error('fixture');});
  const b=P.runCanvasJob(()=>{order.push('b');});
  await a.catch(()=>{});await b;
  assert.deepEqual(order,['a start','a end','b']);assert.equal(P.getDebug().active,0);
  assert.equal(P.getDebug().queued,0);assert(turns>0,'cooperative jobs yield');
  console.log('sprite pixel jobs: legacy fish pixels, shared profiles, worker/fallback parity, failure recovery and serial queue passed');
})().catch(error=>{console.error(error);process.exit(1);});

#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now=0, queued=null, id=0, reads=0, writes=0;
const errors=[];
class WebGLRenderer {
  constructor(){this.info={render:{calls:0,triangles:0}};}
  render(scene,camera){
    if(scene.autoUpdate)scene.updateMatrixWorld();
    now+=2;
    this.info.render.calls=camera.layers.mask===1?30:1;
    this.info.render.triangles=this.info.render.calls*100;
  }
}
const window={THREE:{WebGLRenderer},localStorage:{getItem(){reads++;return null;},setItem(){writes++;}},
  HeldObjectRenderOrder:{replayingDepth:false}, DenseForestWallBatches:{staticMatrixSnapshot:()=>({enabled:true,skippedLeaves:wallSkips})}};
let wallSkips=0;
const context=vm.createContext({window,console:{log:console.log,warn:(...a)=>errors.push(a),error:(...a)=>errors.push(a)},
  performance:{now:()=>now},document:{readyState:'loading',addEventListener(){}},
  requestAnimationFrame(fn){assert.equal(queued,null,'one scheduler RAF');queued=fn;return ++id;},cancelAnimationFrame(){queued=null;}});
const load=name=>vm.runInContext(fs.readFileSync('docs/js/'+name,'utf8'),context,{filename:name});
load('runtime-frame-scheduler.js');
load('render-layers.js');
load('render-hooks.js');
load('performance-debug.js'); // Actual public timing API; no overlay or browser instrumentation installation.
load('probe-performance-capture.js');
const S=window.RuntimeFrameScheduler,P=window.ProbePerformanceCapture,F=window.PerfProfiler,H=window.RenderHooks;
assert.equal(F.isEnabled(),false);
assert.equal(F.begin('inactive'),null,'normal gameplay has no profiler token');
const renderer=new WebGLRenderer(), camera={layers:{mask:1}};
const scene=Object.create({updateMatrixWorld(){now+=5;wallSkips+=10;}});
scene.autoUpdate=true;
let pass='main', fail=false, noWorld=false;
window.WorldRenderPipeline={currentPass:()=>pass};
const original=scene.updateMatrixWorld;
H.register({id:'existing-static-wall-hook',order:900000000,appliesTo:ctx=>ctx.scene===scene&&scene.autoUpdate,
  before(){scene.updateMatrixWorld=function(){return original.call(this);};},
  after(){delete scene.updateMatrixWorld;}});
S.register('input-fixture',()=>{now+=2;},{phase:'input'});
S.register('pre-render-fixture',()=>{now+=4;},{phase:'pre-render'});
S.register('post-fixture',()=>{now+=1;},{phase:'post-game'});
S.setFrameDriver(()=>{
  const loop=F.begin('gameLoop total');
  F.measure('work',()=>{now+=3;}); F.measure('work',()=>{now+=1;});
  F.record('custom direct counter',.25);
  S.checkpoint('pre-render');
  if(!noWorld){
    P.markArea('forest'); H.beginWorldFrame({renderer,scene,camera});
    try {
      renderer.render(scene,camera);
      assert.equal(scene.updateMatrixWorld,original,'native timing and earlier static wrapper restored in order');
      assert.equal(Object.hasOwn(scene,'updateMatrixWorld'),false);
      scene.autoUpdate=false; window.HeldObjectRenderOrder.replayingDepth=true;
      camera.layers.mask=1; renderer.render(scene,camera); // Same WORLD mask, different pass classification.
      if(fail)throw Error('fixture driver failure');
    }finally{
      scene.autoUpdate=true;camera.layers.mask=1;window.HeldObjectRenderOrder.replayingDepth=false;H.endWorldFrame();
    }
  }
  F.end(loop);
});
function tick(t){now=t;const fn=queued;queued=null;assert.equal(typeof fn,'function');fn(t);}
P.start('forest');
assert.equal(F.isEnabled(),false,'capture never enables overlay or expensive wrapper profiling');
tick(0); // Warmup/census frame excluded.
F.measure('deferred classification',()=>{now+=3;});
tick(100);tick(200);
fail=true;tick(300);fail=false;
noWorld=true;tick(400);noWorld=false;
tick(500);tick(600);
const report=P.finish();
assert.equal(report.completeFrames,4);
assert.deepEqual(JSON.parse(JSON.stringify(report.outsideFrameSubsystems)),[{name:'deferred classification',calls:1,totalMs:3,maxCallMs:3}]);
assert.equal(report.interruptedFrames,1);
assert.equal(report.skippedNonWorldFrames,1);
assert.equal(report.discardedWarmupFrames,1);
assert.equal(report.schedulerBoundaryAvailable,true);
assert.equal(report.fps,10);
assert.equal(report.gameLoop.meanMs,17);
assert.equal(report.schedulerFrame.meanMs,20);
assert.equal(report.subsystems.find(x=>x.name==='work').msPerFrame,4);
assert.equal(report.subsystems.find(x=>x.name==='work').callsPerFrame,2);
assert.equal(report.subsystems.find(x=>x.name==='scheduler: pre-render/pre-render-fixture').msPerFrame,4);
assert.equal(report.subsystems.find(x=>x.name==='custom direct counter').msPerFrame,.25);
const base=report.nativePasses.find(x=>x.name==='main/world/WORLD/matrix-walk');
const replay=report.nativePasses.find(x=>x.name==='main/held-replay/WORLD/matrix-reuse');
assert.equal(base.msPerFrame,7);
assert.equal(base.sceneMatrixMsPerFrame,5);
assert.equal(base.drawsPerFrame,30);
assert.equal(base.sceneMatrixCalls,4);
assert.equal(replay.msPerFrame,2);
assert.equal(replay.sceneMatrixCalls,0);
assert.equal(report.counterDeltas.staticWall.skippedLeaves,60,'lifetime counter delta includes warmup and failed rendered frame');
assert.equal(writes,0,'capture changes no saved settings');
assert.equal(P.active,false);assert.equal(F.begin('inactive'),null);
assert(!H.list().includes('pixel-probe-performance-window'),'capture hook removed on finish');
assert.equal(P.finish(),report,'limit/tap can retrieve the same completed report');
P.start('forest');tick(700);P.cancel();assert.equal(P.finish(),null);
P.start('forest');tick(800);tick(900);tick(20900);
const limited=P.finish();assert.equal(limited.reason,'limit');assert.equal(limited.completeFrames,1);
assert.equal(P.active,false);
const off=S.registerTimingObserver({beginFrame(){throw Error('diagnostic error');}});
assert.equal(typeof off,'function');tick(21000);off();
assert.equal(errors.length,2,'driver and observer errors isolated');
console.log('Pixel Probe performance window: actual scheduler/RenderHooks/PerfProfiler, native matrix/pass attribution, interval statistics, bounds and cleanup passed');

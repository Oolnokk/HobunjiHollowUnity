// Shared cooperative budget and serialized asset pixel jobs. CPU math for
// fish/item sprites can run in one worker, with identical local fallback.
// Other consumers (weaving, genetics) keep using maybeYield as before.
(function () {
  'use strict';

  const SLICE_MS = 6; // Budget for cooperating pixel loops, not a hard browser task deadline.
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const workerUrl = typeof document !== 'undefined' && document.currentScript?.src
    ? new URL('sprite-pixel-worker.js?v=20261125pixelWorker1',document.currentScript.src).href : null;
  let sliceStart=now(), yielding=null, yields=0; // One shared yield, even with simultaneous asset continuations.
  let tail=Promise.resolve(), worker=null, workerDisabled=false, nextId=0;
  let pending=null; // At most one transferred pixel buffer is outstanding.
  const stats={queued:0,active:0,completed:0,maxQueued:0,workerJobs:0,fallbackJobs:0,workerFailures:0,workerMs:0,fallbackMs:0,maxCanvasJobMs:0,lastKind:null,lastFailure:null,workerFish:null};

  function yieldToMain() {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') return scheduler.yield();
    if (typeof MessageChannel === 'function') {
      return new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => { channel.port1.close();channel.port2.close();resolve(); };
        channel.port2.postMessage(null);
      });
    }
    return new Promise(resolve => setTimeout(resolve,0));
  }
  function maybeYield() {
    if(yielding)return yielding;
    if(now()-sliceStart<SLICE_MS)return Promise.resolve();
    yields++;
    yielding=Promise.resolve().then(yieldToMain).catch(()=>new Promise(resolve=>setTimeout(resolve,0))).finally(()=>{
      sliceStart=now();yielding=null;
    });
    return yielding;
  }

  // Acquire the slot BEFORE allocating/readback of a canvas. A dozen load
  // events can no longer allocate a dozen full-size ImageData buffers at once.
  // Do not recursively await a canvas job from inside another canvas job.
  function runCanvasJob(fn) {
    stats.queued++;stats.maxQueued=Math.max(stats.maxQueued,stats.queued);
    const run=tail.then(async()=>{
      stats.queued--;stats.active++;
      const started=now();
      try{await maybeYield();return await fn();}
      finally{stats.active--;stats.completed++;stats.maxCanvasJobMs=Math.max(stats.maxCanvasJobMs,now()-started);}
    });
    tail=run.catch(()=>{}); // A failed image must not poison the queue.
    return run;
  }
  function failWorker(error) {
    workerDisabled=true;stats.workerFailures++;stats.lastFailure=String(error?.message||error).slice(0,160);
    const p=pending;pending=null;
    if(p){clearTimeout(p.timer);p.reject(error instanceof Error?error:new Error(stats.lastFailure));}
    if(worker){worker.terminate();worker=null;}
  }
  function ensureWorker() {
    if(workerDisabled||!workerUrl||typeof window.Worker!=='function')return null;
    if(worker)return worker;
    try{
      worker=new window.Worker(workerUrl);
      worker.onmessage=event=>{
        const m=event.data,p=pending;
        if(!p||m?.id!==p.id)return;
        if(m.error){failWorker(new Error(m.error));return;}
        if(!(m.buffer instanceof ArrayBuffer)||m.buffer.byteLength!==p.bytes){failWorker(new Error('Invalid pixel worker reply'));return;}
        pending=null;clearTimeout(p.timer);
        stats.workerMs+=Number(m.ms)||0;
        if(m.fish)stats.workerFish=m.fish;
        p.resolve(m.buffer);
      };
      worker.onerror=event=>{event.preventDefault?.();failWorker(new Error(event.message||'Pixel worker failed'));};
      worker.onmessageerror=()=>failWorker(new Error('Pixel worker message could not be decoded'));
      return worker;
    }catch(error){failWorker(error);return null;}
  }
  async function processPixels(kind,data,args,fallback) {
    stats.lastKind=kind;
    const w=ensureWorker();
    if(w&&!pending){
      try{
        // Transfer a private copy. Keep the untouched caller buffer for retry
        // if worker creation, imports, CSP or processing fail.
        const copy=data.slice(),id=++nextId;
        const reply=await new Promise((resolve,reject)=>{
          pending={id,bytes:copy.byteLength,resolve,reject,timer:setTimeout(()=>failWorker(new Error('Pixel worker timed out')),30000)};
          try{w.postMessage({id,kind,args,buffer:copy.buffer},[copy.buffer]);}
          catch(error){failWorker(error);}
        });
        data.set(new Uint8ClampedArray(reply));stats.workerJobs++;return;
      }catch(_){/* Original buffer remains intact; use the cooperative path. */}
    }
    stats.fallbackJobs++;
    const started=now();
    try{await fallback();}
    finally{stats.fallbackMs+=now()-started;}
  }
  window.PixelWorkYield={
    SLICE_MS,maybeYield,runCanvasJob,processPixels,
    getDebug:()=>({sliceMs:SLICE_MS,yields,...stats,workerState:workerDisabled?'failed-fallback':worker?'ready':workerUrl&&typeof window.Worker==='function'?'idle':'unavailable'}),
  };
})();

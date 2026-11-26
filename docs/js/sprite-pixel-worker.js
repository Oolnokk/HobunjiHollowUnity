// Same pure pixel routines as the main-thread fallback. No DOM, canvas,
// gameplay, or animation loop in this worker; only transferred RGBA arrays.
'use strict';
self.window=self;
self.__hobunjiPixelWorker=true;
importScripts('color-fill.js?v=20261117h93b0e83','sprite-recolor.js?v=20261126he9d2fa1','fish-catalog.js?v=20261125pixelWorker1');
self.onmessage=event=>{
  const {id,kind,args,buffer}=event.data;
  try{
    const data=new Uint8ClampedArray(buffer),started=performance.now();
    if(kind==='fish-base'){
      for(const _ of self.FishCatalog.pixelSteps(data,args.key,args.sourceKey)){}
    }else if(kind==='fish-pattern'){
      for(const _ of self.FishCatalog.patternSteps(data,args.color)){}
    }else if(kind==='sprite'){
      // The direct shade reference fallback uses the caller's actual config.
      self.SCRATCHBONES_CONFIG={game:{portrait:{tinting:args.config}}};
      self.SpriteRecolor.recolorImageData(data,args.targetHex,args.mode,args.opts);
    }else throw new Error('Unknown pixel job '+kind);
    self.postMessage({id,buffer,ms:performance.now()-started,fish:self.FishCatalog.getPixelDebug()},[buffer]);
  }catch(error){self.postMessage({id,error:String(error?.message||error)});}
};

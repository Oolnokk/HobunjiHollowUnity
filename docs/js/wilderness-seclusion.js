// Bounded terrain-aware line-of-sight sampling for Tothal Shift discovery sites.
// Both authored locale placement and independent cliff Puzzle Caves use this
// score; neither runtime frame updates nor map loading recompute it.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WildernessSeclusion=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DIRECTIONS=16; // Observer directions sampled at each distance ring.
  const DEFAULT_RADII=[5,10,16]; // Approximate short, mid and distant wilderness sightlines.

  function finite(value,fallback=0){const number=Number(value);return Number.isFinite(number)?number:fallback;}
  function sampleVisibility(options,col,row){
    const cols=Math.max(0,Math.floor(finite(options?.cols)));
    const rows=Math.max(0,Math.floor(finite(options?.rows)));
    const getTile=options?.getTile;
    if(!cols||!rows||typeof getTile!=='function'||!Number.isFinite(col)||!Number.isFinite(row))
      return {visibleObserverCount:0,observerSampleCount:0,visibilityRatio:1,concealmentScore:0,nearbyObserverCount:0};
    const tx=Math.floor(col),ty=Math.floor(row);
    const target=getTile(tx,ty);
    if(!target)return {visibleObserverCount:0,observerSampleCount:0,visibilityRatio:1,concealmentScore:0,nearbyObserverCount:0};
    const canStand=options?.canStand||(()=>true);
    const blocksSight=options?.blocksSight||(()=>false);
    const elevation=options?.elevation||(()=>0);
    const radii=Array.isArray(options?.radii)&&options.radii.length?options.radii:DEFAULT_RADII;
    const seen=new Set(); // Avoid duplicate observer tiles on small or map-edge rings.
    let visible=0,observers=0,nearby=0;
    const targetHeight=finite(elevation(target),0)+1.5;
    for(const rawRadius of radii){
      const radius=Math.max(2,Math.min(32,Math.floor(finite(rawRadius,5))));
      for(let direction=0;direction<DIRECTIONS;direction++){
        const angle=direction*Math.PI*2/DIRECTIONS;
        const x=Math.round(tx+Math.cos(angle)*radius);
        const y=Math.round(ty+Math.sin(angle)*radius);
        const key=y*cols+x;
        if(x<0||y<0||x>=cols||y>=rows||seen.has(key))continue;
        seen.add(key);
        const start=getTile(x,y);
        if(!start||!canStand(start,x,y))continue;
        observers++;
        if(radius<=5)nearby++;
        const dx=tx-x,dy=ty-y;
        const steps=Math.max(Math.abs(dx),Math.abs(dy));
        const sourceHeight=finite(elevation(start),0)+1.5;
        let clear=true;
        for(let step=1;step<steps;step++){
          const c=Math.round(x+dx*step/steps),r=Math.round(y+dy*step/steps);
          const tile=getTile(c,r);
          if(!tile||blocksSight(tile,c,r)){
            clear=false;
            break;
          }
          // Elevated terrain also occludes sight when the crest rises above
          // the interpolated eye line. No renderer raycasts or Three objects.
          const eyeLine=sourceHeight+(targetHeight-sourceHeight)*step/steps;
          if(finite(elevation(tile),0)>eyeLine+0.55){clear=false;break;}
        }
        if(clear)visible++;
      }
    }
    const ratio=observers?visible/observers:1; // Never reward unreachable, unsampled voids as perfectly secret.
    return {visibleObserverCount:visible,observerSampleCount:observers,
      visibilityRatio:ratio,concealmentScore:1-ratio,nearbyObserverCount:nearby};
  }
  return Object.freeze({sampleVisibility});
});

(() => {
  'use strict';
  // The pattern editor owns the dev controls; no runtime game page loads this file.
  window.FurHoodDirectPaintEditor = Object.freeze({ open: async function openFurHoodDirectPaint({kind,gene,wearerVariant,view,coat,ink,sourcePattern,authoring,onSave}) {
  const api=window.ClothingWeavingSystem;
  if (!api?.garmentPaintToMotif || !api?.renderClothingLayers) throw Error('Updated garment motif compositor is missing.');
  if (!kind || !gene) throw Error('Choose an animal and genotype gene first.');
  const split=wearerVariant.lastIndexOf('_');
  const speciesId=wearerVariant.slice(0,split), gender=wearerVariant.slice(split+1); // Reuses the selected hood-fit sprite's exact species/gender.
  const furHood={kind,genotype:{base:{color:coat},[gene]:{color:ink,enabled:true,copies:2}},baseColor:coat,appearance:{patterns:[{id:gene,color:ink,enabled:true}]}}; // Editor sample, never persisted as a hide.
  const args={furHood,primaryHex:coat,secondaryHex:coat,speciesId,gender,view,furHoodMarkingsOverride:[]}; // Production preview and editable pixel eligibility share one exact hood.
  const [baseResult,maskResult]=await Promise.all([api.renderClothingLayers('fur_hood',args),api.renderClothingLayers('fur_hood',{...args,furPaintMaskOnly:true})]);
  if(!baseResult?.canvas||!maskResult?.canvas) throw Error('Hood base or fur-substrate mask did not resolve.');
  const base=baseResult.canvas,w=base.width,h=base.height; // Fixed logical sprite size for all stored strokes and generated motifs.
  if(w>4096||h>4096) throw Error('Hood art is too large to paint.');
  const coverage=document.createElement('canvas'); coverage.width=w;coverage.height=h; // Merges actual hood base/front/back masks without the decorative trim.
  const coverCtx=coverage.getContext('2d',{willReadFrequently:true});coverCtx.drawImage(maskResult.canvas,0,0);
  const coverageData=coverCtx.getImageData(0,0,w,h).data;
  const allowed=new Uint8Array(w*h); // Refuses brush input on transparency, trim-only and authored near-black outlines.
  for(let p=0;p<allowed.length;p++)allowed[p]=coverageData[p*4+3]>16?1:0;
  if(!allowed.some(Boolean))throw Error('No paintable fur pixels are visible in this hood view.');
  let settings=api.garmentPaintSettings(sourcePattern?.garmentFixed?sourcePattern:{}); // Standard mesh values drive both inverse export and runtime motif placement.
  const overlay=document.createElement('div');overlay.className='trimPaintOverlay';
  overlay.innerHTML=`
    <section class="trimPaintPanel" role="dialog" aria-modal="true" aria-label="Directly paint fur-hood markings">
      <div class="trimPaintHead"><div><h2>Paint fur-hood markings</h2><div class="muted">${kind} · ${gene} · ${wearerVariant} · ${view} · ${w}×${h} pixels</div></div><button data-fur-action="close" class="secondary" aria-label="Close">✕</button></div>
      <div class="trimPaintBody">
        <div><div class="trimPaintTools">
          <button data-fur-tool="paint" class="active">Brush</button><button data-fur-tool="erase" class="secondary">Eraser</button><button data-fur-tool="pan" class="secondary">Pan</button>
          <button data-fur-action="undo" class="secondary">Undo</button><button data-fur-action="redo" class="secondary">Redo</button><button data-fur-action="clear" class="secondary">Clear</button>
          <label>Brush <input data-fur-brush type="range" min="1" max="32" step="1" value="4"><span data-fur-brush-label>4px</span></label>
          <label>Zoom <input data-fur-zoom type="range" min="1" max="8" step="1" value="2"><span data-fur-zoom-label>2×</span></label>
        </div>
        <div class="trimPaintScroller" data-fur-scroller><div class="trimPaintStage" data-fur-stage><canvas data-fur-base></canvas><canvas class="trimPaintInk" data-fur-ink></canvas></div></div>
        <details style="margin-top:9px"><summary>Non-tiling weaving transform</summary><div class="fields" style="margin-top:9px">
          <label>Scale <input type="number" min="0.4" max="3.2" step="0.05" data-fur-setting="meshScale" value="${settings.meshScale}"></label>
          <label>Rotation ° <input type="number" min="-180" max="180" step="1" data-fur-setting="meshRotationDeg" value="${settings.meshRotationDeg}"></label>
          <label>Offset X px <input type="number" step="1" data-fur-setting="usageOffsetX" value="${settings.usageOffsetX}"></label>
          <label>Offset Y px <input type="number" step="1" data-fur-setting="usageOffsetY" value="${settings.usageOffsetY}"></label>
          <label>Stretch X <input type="number" min="0.1" max="10" step="0.05" data-fur-setting="usageStretchX" value="${settings.usageStretchX}"></label>
          <label>Stretch Y <input type="number" min="0.1" max="10" step="0.05" data-fur-setting="usageStretchY" value="${settings.usageStretchY}"></label>
          <label><input type="checkbox" data-fur-setting="usageFlipX" ${settings.usageFlipX?'checked':''}> Flip X</label>
          <label><input type="checkbox" data-fur-setting="usageFlipY" ${settings.usageFlipY?'checked':''}> Flip Y</label>
        </div></details>
        <div class="trimPaintNote">Paint directly on eligible fur, not the trim. The tool inverts your brushwork into a normal non-tiling motif using the same scale, rotation, stretch and offsets as in-game weaving. Strokes are kept for re-editing. Use Pan + Zoom on touchscreens.</div></div>
        <div><div class="muted"><b>Actual in-game result</b></div><div class="trimPaintResult"><canvas data-fur-result width="1" height="1"></canvas></div><div class="trimPaintNote" data-fur-preview-status>Rendering…</div></div>
      </div>
      <div class="trimPaintFoot"><div class="muted" data-fur-status>Ready to paint.</div><div class="row"><button data-fur-action="cancel" class="secondary">Cancel</button><button data-fur-action="save">Save motif</button></div></div>
    </section>`;
  document.body.appendChild(overlay);
  const $=s=>overlay.querySelector(s);
  const baseCanvas=$('[data-fur-base]'),paint=$('[data-fur-ink]'),result=$('[data-fur-result]'); // Visible garment, editable mask, and authoritative production result.
  const stage=$('[data-fur-stage]'),scroller=$('[data-fur-scroller]'); // Zoomable stage and manual touch-pan viewport.
  const status=$('[data-fur-status]'),previewStatus=$('[data-fur-preview-status]'); // Mobile-readable errors, no console required.
  const undoBtn=$('[data-fur-action="undo"]'),redoBtn=$('[data-fur-action="redo"]'),saveBtn=$('[data-fur-action="save"]'); // Stateful editing controls.
  const zoomInput=$('[data-fur-zoom]'),brushInput=$('[data-fur-brush]'); // Pixel scaling and brush diameter.
  baseCanvas.width=paint.width=w;baseCanvas.height=paint.height=h;
  baseCanvas.getContext('2d').drawImage(base,0,0);
  const ctx=paint.getContext('2d',{willReadFrequently:true}),rctx=result.getContext('2d');
  ctx.imageSmoothingEnabled=rctx.imageSmoothingEnabled=false;
  let operations=[]; // Exported editor-only replay journal, not player-visible weaving data.
  let mode='paint',brush=4,drawing=false,last=null,stroke=null,pan=null,closed=false,revision=0; // Per-overlay brush and async preview lifecycle.
  const undo=[],redo=[]; // Bounded raster+operation history for one mobile authoring session.
  const deep=value=>JSON.parse(JSON.stringify(value));
  const close=()=>{closed=true;revision++;overlay.remove();};
  $('[data-fur-action="close"]').onclick=close;$('[data-fur-action="cancel"]').onclick=close;
  overlay.addEventListener('pointerdown',event=>{if(event.target===overlay)close();});
  function normalize() {
    const pixels=ctx.getImageData(0,0,w,h);
    for(let p=0;p<allowed.length;p++){
      const i=p*4,ink=allowed[p]&&pixels.data[i+3]>16;
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=pixels.data[i+3]=ink?255:0;
    }
    ctx.putImageData(pixels,0,0);
  }
  function hasInk(){const data=ctx.getImageData(0,0,w,h).data;for(let i=3;i<data.length;i+=4)if(data[i]>16)return true;return false;}
  function encodePaintRuns(){
    const data=ctx.getImageData(0,0,w,h).data; // Serialized editor-only baseline preserves any imported/reprojected motif alongside the editable stroke journal.
    const runs=[];let state=0,length=0;
    for(let p=0;p<w*h;p++){
      const painted=data[p*4+3]>16?1:0;
      if(painted!==state){runs.push(length);length=0;state=painted;}
      length++;
    }
    runs.push(length);return runs;
  }
  function restorePaintRuns(runs){
    if(!Array.isArray(runs)||runs.some(n=>!Number.isInteger(n)||n<0)||runs.reduce((a,b)=>a+b,0)!==w*h)return false;
    const pixels=ctx.createImageData(w,h);let offset=0;
    for(let i=0;i<runs.length;i++){
      const end=offset+runs[i];
      if(i%2===1)for(let p=offset;p<end;p++){const n=p*4;pixels.data[n]=pixels.data[n+1]=pixels.data[n+2]=pixels.data[n+3]=255;}
      offset=end;
    }
    ctx.putImageData(pixels,0,0);normalize();return true;
  }
  function snapshot(){return {pixels:ctx.getImageData(0,0,w,h),operations:deep(operations)};}
  function restore(value){ctx.clearRect(0,0,w,h);ctx.putImageData(value.pixels,0,0);operations=deep(value.operations);buttons();}
  function buttons(){undoBtn.disabled=!undo.length;redoBtn.disabled=!redo.length;saveBtn.disabled=!hasInk();}
  function push(){undo.push(snapshot());if(undo.length>20)undo.shift();redo.length=0;buttons();}
  function stamp(point,type,size){
    const d=Math.max(1,Math.min(32,Math.round(size))),s=-Math.floor(d/2),o=d%2===0?0.5:0;
    for(let y=0;y<d;y++)for(let x=0;x<d;x++){
      const dx=s+x,dy=s+y;if((dx+o)**2+(dy+o)**2>(d/2)**2)continue;
      const px=point.x+dx,py=point.y+dy;if(px<0||py<0||px>=w||py>=h||!allowed[py*w+px])continue;
      if(type==='erase')ctx.clearRect(px,py,1,1);
      else{ctx.fillStyle='#ffffff';ctx.fillRect(px,py,1,1);}
    }
  }
  function line(a,b,fn){
    let x=a.x,y=a.y;const dx=Math.abs(b.x-x),sx=x<b.x?1:-1,dy=-Math.abs(b.y-y),sy=y<b.y?1:-1;
    let err=dx+dy;
    while(true){fn({x,y});if(x===b.x&&y===b.y)break;const e=2*err;if(e>=dy){err+=dy;x+=sx;}if(e<=dx){err+=dx;y+=sy;}}
  }
  function pointFromEvent(event){const box=paint.getBoundingClientRect();return{x:Math.max(0,Math.min(w-1,Math.floor((event.clientX-box.left)*w/box.width))),y:Math.max(0,Math.min(h-1,Math.floor((event.clientY-box.top)*h/box.height)))};}
  function applyPoint(p){if(last)line(last,p,q=>stamp(q,mode,brush));else stamp(p,mode,brush);if(stroke){const previous=stroke.points.at(-1);if(!previous||previous[0]!==p.x||previous[1]!==p.y)stroke.points.push([p.x,p.y]);}last=p;}
  function replay(journal){
    ctx.clearRect(0,0,w,h);
    for(const op of journal){
      if(op.type==='clear'){ctx.clearRect(0,0,w,h);continue;}
      if(op.type!=='stroke'||!Array.isArray(op.points))continue;
      let before=null;
      for(const pair of op.points){const next={x:Math.round(pair[0]),y:Math.round(pair[1])};if(before)line(before,next,q=>stamp(q,op.mode,op.size));else stamp(next,op.mode,op.size);before=next;}
    }
    normalize();
  }
  function currentSettings(){
    const value={...settings};
    for(const input of overlay.querySelectorAll('[data-fur-setting]'))value[input.dataset.furSetting]=input.type==='checkbox'?input.checked:(input.value===''?value[input.dataset.furSetting]:Number(input.value));
    return api.garmentPaintSettings(value);
  }
  async function preview(){
    const token=++revision;
    if(closed)return;
    if(!hasInk()){
      result.width=w;result.height=h;rctx.clearRect(0,0,w,h);rctx.drawImage(base,0,0);previewStatus.textContent='No motif painted yet.';return;
    }
    previewStatus.textContent='Converting into a motif and rendering through the game compositor…';
    try{
      const settings=currentSettings(),mask=api.garmentPaintToMotif(paint,settings);
      if(!mask)throw Error('Could not invert the paint transform.');
      const pattern={...settings,motifDataUrl:mask.toDataURL('image/png')}; // Runtime receives a normal motif + non-tiling settings, not a direct garment mask.
      const rendered=await api.renderClothingLayers('fur_hood',{...args,furHoodMarkingsOverride:[{geneId:gene,pattern,colorHex:ink}]});
      if(closed||token!==revision||!rendered?.canvas)return;
      result.width=rendered.canvas.width;result.height=rendered.canvas.height;rctx.imageSmoothingEnabled=false;rctx.drawImage(rendered.canvas,0,0);
      previewStatus.textContent='Exact in-game preview · '+settings.meshScale.toFixed(2)+'× mesh · '+settings.meshRotationDeg+'° · non-tiling. Generated outline included.';
    }catch(error){if(!closed&&token===revision)previewStatus.textContent='Preview error: '+error.message;}
  }
  function zoom(){const scale=Math.max(1,Number(zoomInput.value)||1);stage.style.width=w*scale+'px';stage.style.height=h*scale+'px';baseCanvas.style.width=paint.style.width='100%';baseCanvas.style.height=paint.style.height='100%';$('[data-fur-zoom-label]').textContent=scale+'×';}
  paint.addEventListener('pointerdown',event=>{
    event.preventDefault();try{paint.setPointerCapture?.(event.pointerId);}catch(_){}
    if(mode==='pan'){pan={x:event.clientX,y:event.clientY,left:scroller.scrollLeft,top:scroller.scrollTop};return;}
    push();drawing=true;last=null;stroke={type:'stroke',mode,size:brush,points:[]};applyPoint(pointFromEvent(event));
  });
  paint.addEventListener('pointermove',event=>{
    if(pan){event.preventDefault();scroller.scrollLeft=pan.left-(event.clientX-pan.x);scroller.scrollTop=pan.top-(event.clientY-pan.y);}
    else if(drawing){event.preventDefault();applyPoint(pointFromEvent(event));}
  });
  async function endStroke(){if(pan){pan=null;return;}if(!drawing)return;drawing=false;last=null;if(stroke?.points.length)operations.push(stroke);stroke=null;buttons();await preview();}
  paint.addEventListener('pointerup',endStroke);paint.addEventListener('pointercancel',endStroke);
  paint.addEventListener('pointerleave',event=>{if((drawing||pan)&&!paint.hasPointerCapture?.(event.pointerId))endStroke();});
  overlay.querySelectorAll('[data-fur-tool]').forEach(button=>button.onclick=()=>{mode=button.dataset.furTool;overlay.querySelectorAll('[data-fur-tool]').forEach(b=>b.classList.toggle('active',b===button));paint.style.cursor=mode==='pan'?'grab':'crosshair';});
  brushInput.oninput=()=>{brush=Number(brushInput.value)||1;$('[data-fur-brush-label]').textContent=brush+'px';};
  zoomInput.oninput=zoom;
  overlay.querySelectorAll('[data-fur-setting]').forEach(input=>input.onchange=()=>{settings=currentSettings();preview();});
  undoBtn.onclick=async()=>{if(!undo.length)return;redo.push(snapshot());restore(undo.pop());await preview();};
  redoBtn.onclick=async()=>{if(!redo.length)return;undo.push(snapshot());restore(redo.pop());await preview();};
  $('[data-fur-action="clear"]').onclick=async()=>{push();ctx.clearRect(0,0,w,h);operations=[{type:'clear'}];buttons();await preview();};
  saveBtn.onclick=async()=>{
    if(!hasInk())return;
    saveBtn.disabled=true;
    try{
      const projection=currentSettings(),generated=api.garmentPaintToMotif(paint,projection);
      if(!generated)throw Error('Motif inverse transform returned no canvas.');
      const motifDataUrl=generated.toDataURL('image/png');
      await onSave({motifDataUrl,settings:projection,authoring:{mode:'hood-paint',view,width:w,height:h,operations:deep(operations),maskRle:encodePaintRuns()}}); // Editor-only run-length mask safely preserves imported strokes; runtime still reads only motif and settings.
      close();
    }catch(error){saveBtn.disabled=false;status.textContent='Could not save: '+error.message;}
  };
  try {
    const matching=authoring?.mode==='hood-paint'&&authoring.view===view&&authoring.width===w&&authoring.height===h;
    if(matching&&restorePaintRuns(authoring.maskRle)){
      operations=Array.isArray(authoring.operations)?deep(authoring.operations):[];
      status.textContent='Restored the exact saved paint mask and editable stroke journal.';
    }else if(matching&&Array.isArray(authoring.operations)){
      operations=deep(authoring.operations);replay(operations);
      status.textContent='Replayed the saved fur-hood strokes on this view.';
    }else if(sourcePattern?.garmentFixed&&(sourcePattern.motifDataUrl||sourcePattern.motifUrl)){
      const source=sourcePattern.motifDataUrl||sourcePattern.motifUrl;
      const url=/^(?:data:|blob:|https?:)/i.test(source)?source:new URL('../../'+String(source).replace(/^\.\/?/,''),location.href).href;
      const image=await new Promise((resolve,reject)=>{
        const img=new Image();img.crossOrigin='anonymous';
        img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Existing motif PNG could not be read.'));
        img.src=url;
      });
      if(closed)return;
      const motif=document.createElement('canvas');motif.width=image.naturalWidth||image.width;motif.height=image.naturalHeight||image.height;
      motif.getContext('2d').drawImage(image,0,0);
      const projected=api.garmentMotifToPaint(motif,settings,w,h); // Reopen an existing motif on the opposite view with the same normal mesh projection.
      if(projected){ctx.drawImage(projected,0,0);normalize();}
      status.textContent='Projected the existing motif onto this hood view. Brush and erase to modify it.';
    }else if(sourcePattern)status.textContent='Older motif uses custom motif-space placement. Paint here to replace it with a garment-anchored non-tiling version.';
  }catch(error){status.textContent='Could not restore previous paint: '+error.message+'. You can paint a new motif.';}
  zoomInput.value=String(Math.max(1,Math.min(8,Math.floor(520/Math.max(w,h)))));
  zoom();buttons();await preview();
} });
})();

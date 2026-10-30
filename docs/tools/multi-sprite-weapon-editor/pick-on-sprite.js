// Standalone touch/mouse authoring picker: true PNG pixels and composite-space hinge points.
// No library, console or devtools dependency; the Tool Hub editor owns the pick callback.
(function (global) {
  'use strict';
  if (global.HobunjiSpritePointPicker) return;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  function create({canvas, panel, title, info, cancel}) {
    const ctx = canvas.getContext('2d'); // Canvas is a fixed logical pixel grid, independent of CSS/device pixel ratio.
    const state = { active:false, images:[], offsets:[], composite:false, onPick:null, scale:1, cx:0, cy:0, width:1, height:1 }; // Pixel-space offsets follow each authored layer when picking composite head contacts.
    function draw() {
      if (!state.active) return;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle='#0d1928';ctx.fillRect(0,0,w,h);
      const sizes = state.images.map((image,index)=>{
        const o=state.composite ? state.offsets[index] : null;
        return {img:image,w:image.naturalWidth||image.width,h:image.naturalHeight||image.height,
          ox:Number.isFinite(Number(o?.x))?Number(o.x):0, oy:Number.isFinite(Number(o?.y))?Number(o.y):0};
      }); // Composite layers use their actual preview/game offsets instead of pretending every PNG is centered.
      const minX=Math.min(...sizes.map(s=>-s.w/2+s.ox)),maxX=Math.max(...sizes.map(s=>s.w/2+s.ox));
      const minY=Math.min(...sizes.map(s=>-s.h/2+s.oy)),maxY=Math.max(...sizes.map(s=>s.h/2+s.oy));
      state.width=Math.max(1,maxX-minX);state.height=Math.max(1,maxY-minY);
      state.scale=Math.max(.001,Math.min((w-50)/state.width,(h-50)/state.height));
      state.cx=w/2-(minX+maxX)*state.scale/2;state.cy=h/2-(minY+maxY)*state.scale/2; // Fit all displaced layers while retaining the true shared-center crosshair.
      ctx.save();ctx.translate(state.cx,state.cy);ctx.scale(state.scale,state.scale);
      ctx.imageSmoothingEnabled=false; // Keeps authored PNG pixels individually selectable, including transparent gaps.
      for (const s of sizes) ctx.drawImage(s.img,-s.w/2+s.ox,-s.h/2+s.oy,s.w,s.h);
      ctx.restore();
      ctx.strokeStyle='#7197be';ctx.lineWidth=1;ctx.beginPath();
      ctx.moveTo(state.cx,0);ctx.lineTo(state.cx,h);
      ctx.moveTo(0,state.cy);ctx.lineTo(w,state.cy);ctx.stroke();
      ctx.fillStyle='#cfe5ff';ctx.font='14px sans-serif';ctx.fillText('Tap a point on the artwork · blue cross = shared center',12,22);
      state.sizes=sizes;
    }
    function hide(){state.active=false;panel.hidden=true;state.images=[];state.offsets=[];state.onPick=null;}
    function open({images,offsets=[],composite=false,label,onPick}){
      if (!images?.length || images.some(img=>!img)) return false;
      state.active=true;state.images=images;state.offsets=offsets;state.composite=composite;state.onPick=onPick;
      title.textContent='Pick on sprite · '+label;
      info.textContent=composite?'Composite point: x/y measured from the shared head center (positive Y down). Transparent gaps between the sprites are selectable.':'Exact source PNG pixel coordinates, measured from the top-left (0,0).';
      panel.hidden=false;draw();
      panel.scrollIntoView?.({block:'nearest',behavior:'smooth'}); // Make touch-picker visible even below the two preview canvases on narrow screens.
      return true;
    }
    function fromEvent(ev) {
      if (!state.active || !state.sizes?.length) return null;
      const bounds=canvas.getBoundingClientRect();
      if (!bounds?.width || !bounds?.height) return null;
      const px=(ev.clientX-bounds.left)*canvas.width/bounds.width;
      const py=(ev.clientY-bounds.top)*canvas.height/bounds.height;
      const x=(px-state.cx)/state.scale, y=(py-state.cy)/state.scale;
      if (state.composite) return {x:Math.round(x),y:Math.round(y)}; // Gap selection is intentional; do not clamp to either sprite's opacity.
      const size=state.sizes[0];
      return {x:clamp(Math.floor(x+size.w/2),0,size.w-1),y:clamp(Math.floor(y+size.h/2),0,size.h-1)};
    }
    canvas.addEventListener('pointerdown',ev=>{
      const point=fromEvent(ev);if(!point)return;
      const handler=state.onPick;hide();handler?.(point); // One tap commits one point and returns to ordinary weapon editing.
    });
    cancel.addEventListener('click',hide);
    return Object.freeze({open,close:hide,fromEvent,isActive:()=>state.active});
  }
  global.HobunjiSpritePointPicker=Object.freeze({create});
})(window);

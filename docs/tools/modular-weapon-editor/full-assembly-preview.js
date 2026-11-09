// Full modular weapon rig, drawn in source-pixel coordinates. This is a rest-pose
// inspection view, NOT an alternative to the live Three.js pendulum.
// Both use ModularWeapons.flailRecipe() and the same authored layer/contact conventions.
(function (global) {
  'use strict';
  const alphaBoundsCache = new WeakMap(); // Avoid rescanning transparent borders when inspecting many flail combinations.
  const alphaContactCache = new WeakMap(); // Top/bottom sprite attachment points, using the live renderer's >=128 alpha threshold.
  const tintedRopes = new Map(); // Small reuse cache for ColorFill-tinted copies of the source ruin rope PNG.
  const pixelSize = image => ({ width: image?.naturalWidth || image?.width || 0,
    height: image?.naturalHeight || image?.height || 0 }); // Normalizes HTMLImageElement and Canvas source frames.
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const connectorScale = (chain, axis) => Math.max(.05, Math.min(8, number(chain?.[axis] ?? chain?.scale, 1)));

  function opaqueBounds(image) {
    if (alphaBoundsCache.has(image)) return alphaBoundsCache.get(image);
    const { width, height } = pixelSize(image);
    if (!(width > 0 && height > 0)) throw new Error('Connector image has no dimensions');
    const sample = document.createElement('canvas'); sample.width = width; sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    let crop = { x: 0, y: 0, w: width, h: height }; // Source-image fallback if an external image denies pixel reads.
    try {
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      let x0 = width, y0 = height, x1 = -1, y1 = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] < 9) continue; // Same visible threshold as the live ruin-rope plane.
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      if (x1 >= x0 && y1 >= y0) crop = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    } catch (_) { /* The layout can use the original full PNG if alpha pixels cannot be read. */ }
    alphaBoundsCache.set(image, crop);
    return crop;
  }

  function opaqueContact(image, edge) {
    let cached=alphaContactCache.get(image);
    if (!cached) {cached={};alphaContactCache.set(image,cached);}
    if (cached[edge]) return cached[edge];
    const {width,height}=pixelSize(image);
    if (!(width>0 && height>0)) throw new Error('Authored sprite has no pixels');
    const fallback={x:(width-1)/2,y:edge==='top'?0:height-1}; // Same default contact as the gameplay sprite assembler.
    try {
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
      const rgba=ctx.getImageData(0,0,width,height).data;
      for(let n=0;n<height;n++){
        const y=edge==='top'?n:height-n-1;
        let total=0,count=0;
        for(let x=0;x<width;x++) if(rgba[(y*width+x)*4+3]>=128){total+=x;count++;}
        if(count) return (cached[edge]={x:total/count,y});
      }
    }catch(_){ /* A pure-source fallback remains readable if alpha pixels are inaccessible. */ }
    return (cached[edge]=fallback);
  }

  function tintedRope(image, color) {
    const hex = String(color || '').toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex) || hex === '#FFFFFF') return image;
    const tint = global.ColorFill?.shadeFillPixels;
    if (typeof tint !== 'function') throw new Error('ColorFill is unavailable: cannot preview the authored rope color.');
    const key = (image.src || 'rope') + ':' + hex;
    if (tintedRopes.has(key)) return tintedRopes.get(key);
    const {width,height} = pixelSize(image);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(image,0,0);
    const raster = ctx.getImageData(0,0,width,height);
    const rgb = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    tint(raster.data,rgb,{debugLabel:'modular-full-rig:'+hex}); // Canonical Gar-wolf/weapon rope recoloring, not a lookalike shader.
    ctx.putImageData(raster,0,0);
    tintedRopes.set(key,canvas);
    if (tintedRopes.size > 12) tintedRopes.delete(tintedRopes.keys().next().value);
    return canvas;
  }

  function authoredContact(head, layers) {
    if (head.anchorSpace === 'composite') return { x:number(head.anchor?.x), y:number(head.anchor?.y) };
    const selected = layers.find(piece=>piece.layer.id===head.anchorLayer) || layers[0]; // Matches the live Three.js anchor layer fallback.
    if (!selected) throw new Error('Flail head has no authored sprite layers.');
    const {width,height} = pixelSize(selected.image);
    const written = head.anchor || {}; // Explicit pixel positions are clamped by the real sprite assembler.
    const defaultPoint=opaqueContact(selected.image,written.opaque==='top'?'top':'bottom');
    const point = Number.isFinite(written.x) && Number.isFinite(written.y)
      ? {x:Math.max(0,Math.min(width-1,written.x)),y:Math.max(0,Math.min(height-1,written.y))} : defaultPoint;
    return { x:(point.x + .5 - width/2) + number(selected.layer.offsetPx?.x),
      y:(point.y + .5 - height/2) + number(selected.layer.offsetPx?.y) };
  }

  function rasterChainPlan(chain, image, start, alpha) {
    const size = pixelSize(image), sx = connectorScale(chain,'scaleX');
    let sy = connectorScale(chain,'scaleY'); // Y length is the only degree of freedom changed by the rope/chain mount.
    const top = Number.isFinite(chain.top?.x) && Number.isFinite(chain.top?.y)
      ? {x:Math.max(0,Math.min(size.width-1,chain.top.x)),y:Math.max(0,Math.min(size.height-1,chain.top.y))}
      : opaqueContact(image,chain.top?.opaque==='bottom'?'bottom':'top');
    const bottom = Number.isFinite(chain.bottom?.x) && Number.isFinite(chain.bottom?.y)
      ? {x:Math.max(0,Math.min(size.width-1,chain.bottom.x)),y:Math.max(0,Math.min(size.height-1,chain.bottom.y))}
      : opaqueContact(image,chain.bottom?.opaque==='top'?'top':'bottom');
    const vx = (bottom.x - top.x) * sx;
    const height = bottom.y - top.y;
    const target = Number(chain.mountLengthPx);
    if (Number.isFinite(target) && target > 0 && Math.abs(height)>1e-5)
      sy = Math.sqrt(Math.max(1e-8,target*target-vx*vx))/Math.abs(height); // Identical Y-only target-span solve as runtime.
    const vy = height * sy, reach = Math.hypot(vx,vy);
    const angle = Math.atan2(vx,vy); // Rotate the authored angled chain until its actual top/bottom contacts are vertical at rest.
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const transform = point => {
      const x = (point.x - top.x)*sx, y = (point.y - top.y)*sy;
      return {x:start.x+x*ca-y*sa,y:start.y+x*sa+y*ca};
    };
    const corners = [
      transform({x:alpha.x,y:alpha.y}),transform({x:alpha.x+alpha.w,y:alpha.y}),
      transform({x:alpha.x,y:alpha.y+alpha.h}),transform({x:alpha.x+alpha.w,y:alpha.y+alpha.h}),
    ];
    return {kind:'raster',top,bottom,scaleX:sx,scaleY:sy,angle,reach,
      width:alpha.w*sx,frame:size,corners}; // Raster chain keeps its own authentic width, crop, and angled authoring endpoints.
  }

  function layout(recipe, composed, ropeImage, headImages) {
    if (!recipe?.flail || !composed) throw new Error('Complete flail recipe and composed shaft are required');
    const flail = recipe.flail, chain = flail.chain, head = flail.head;
    const layers = head.layers.map((layer,i)=>({layer,image:headImages[i]})); // Z order is the authoring layer order.
    if (layers.some(piece=>!pixelSize(piece.image).width)) throw new Error('A flail head layer did not load');
    const start = {x:number(flail.haftAnchor?.x,225),y:number(flail.haftAnchor?.y,602)};
    const alpha = opaqueBounds(ropeImage);
    const generated = chain.type === 'rope';
    const rope = generated
      ? {kind:'rope',crop:alpha,reach:Math.max(2, Math.min(2048,
          number(chain.mountLengthPx) > 0 ? number(chain.mountLengthPx)
            : number(chain.lengthPx,160)*connectorScale(chain,'scaleY'))),
          width:Math.max(.5,2*number(chain.radiusPx,2.5)*connectorScale(chain,'scaleX'))}
      : rasterChainPlan(chain,ropeImage,start,alpha);
    const end = {x:start.x,y:start.y+rope.reach}; // Same gravity-down rest direction as the live pendulum.
    const scale = Math.max(.05,Math.min(8,number(head.scale,1)));
    const contact = authoredContact(head,layers); // Includes per-layer offset for non-composite anchors.
    const center = {x:end.x-scale*contact.x,y:end.y-scale*contact.y};
    const parts = layers.map(({image,layer})=>{
      const size=pixelSize(image);
      return {image,layer, x:center.x+scale*(number(layer.offsetPx?.x)-size.width/2),
        y:center.y+scale*(number(layer.offsetPx?.y)-size.height/2),
        width:size.width*scale,height:size.height*scale};
    });
    const frame = composed.modularFrame || {left:0,top:0,width:450,height:1204};
    let left=frame.left,top=frame.top,right=frame.left+frame.width,bottom=frame.top+frame.height;
    for(const part of parts){left=Math.min(left,part.x);top=Math.min(top,part.y);
      right=Math.max(right,part.x+part.width);bottom=Math.max(bottom,part.y+part.height);}
    if(rope.kind==='raster'){
      for(const v of rope.corners){left=Math.min(left,v.x);top=Math.min(top,v.y);right=Math.max(right,v.x);bottom=Math.max(bottom,v.y);}
    } else {left=Math.min(left,start.x-rope.width/2);right=Math.max(right,start.x+rope.width/2);}
    top=Math.min(top,start.y);bottom=Math.max(bottom,end.y);
    const guideX=start.x+Math.max(rope.width/2+24,25); // Visible ruler alongside—not on top of—the actual rope texture.
    right=Math.max(right,guideX+165); // Reserve room for full-size attachment labels on a phone.
    const padding=28, bounds={left:Math.floor(left-padding),top:Math.floor(top-padding),
      width:Math.ceil(right-left+2*padding),height:Math.ceil(bottom-top+2*padding)};
    return {start,end,contact,center,parts,rope,guideX,bounds,frame,headScale:scale,
      chain,head,recipe,composed,ropeImage}; // Pure plan is inspectable and testable without renderer/Three.js state.
  }

  function line(ctx,a,b,style,dash=[]) {
    ctx.save();ctx.strokeStyle=style;ctx.lineWidth=2.8;ctx.setLineDash(dash);ctx.beginPath();
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();
  }
  function dot(ctx,point,color,size=6) {
    ctx.save();ctx.fillStyle='#12202a';ctx.beginPath();ctx.arc(point.x,point.y,size+2,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=color;ctx.lineWidth=2.4;ctx.beginPath();ctx.arc(point.x,point.y,size,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  function render(canvas, plan, showGuides=true) {
    const {bounds,start,end,rope,ropeImage,composed,frame,parts,headScale} = plan;
    const ratio = Math.min(1,2048/Math.max(bounds.width,bounds.height),
      Math.sqrt(2400000/(bounds.width*bounds.height))); // Cap total bitmap work without cropping exaggerated authoring.
    canvas.width=Math.max(1,Math.ceil(bounds.width*ratio));
    canvas.height=Math.max(1,Math.ceil(bounds.height*ratio));
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.scale(ratio,ratio);ctx.translate(-bounds.left,-bounds.top);
    ctx.drawImage(composed,frame.left,frame.top,frame.width,frame.height); // Renders the REAL shaft including any conditional connector bore.
    if(rope.kind==='rope') {
      const source=tintedRope(ropeImage,plan.chain.color||'#FFFFFF');
      const crop=rope.crop;
      ctx.drawImage(source,crop.x,crop.y,crop.w,crop.h,start.x-rope.width/2,start.y,rope.width,rope.reach);
    } else {
      const source=ropeImage;
      ctx.save();ctx.translate(start.x,start.y);ctx.rotate(rope.angle);ctx.scale(rope.scaleX,rope.scaleY);
      ctx.drawImage(source,-rope.top.x,-rope.top.y);ctx.restore();
    }
    for(const part of parts) ctx.drawImage(part.image,part.x,part.y,part.width,part.height); // Same center-relative layer offsets and source order as gameplay.
    if(showGuides) {
      const x=plan.guideX,st={x,y:start.y},en={x,y:end.y};
      line(ctx,start,st,'#f5c5ff',[5,4]);line(ctx,st,en,'#ed93ff',[12,6]);
      line(ctx,en,end,'#f5c5ff',[5,4]);dot(ctx,start,'#ffe39c',6);dot(ctx,end,'#72e6ff',6);
      ctx.save();ctx.fillStyle='#ffe39c';ctx.font='bold 15px system-ui';ctx.textBaseline='bottom';
      ctx.fillText('SHAFT ANCHOR',x+10,st.y-6);
      ctx.fillStyle='#72e6ff';ctx.textBaseline='top';ctx.fillText('HEAD CONTACT',x+10,en.y+7);
      ctx.font='13px system-ui';ctx.fillStyle='#f9d3ff';
      ctx.fillText(rope.reach.toFixed(1)+' px reach',x+10,(st.y+en.y)/2);
      ctx.restore();
    }
    ctx.restore();
    canvas.dataset.rigKind='flail'; // Mobile/browser tests can verify the actual full-assembly renderer ran.
    return {reach:rope.reach,width:rope.width,headScale,anchor:start,headContact:end,
      shaftFrame:frame,visibleBounds:bounds,layerCount:parts.length,guide:showGuides};
  }

  function renderRigid(canvas, composed, mounts=[], showGuides=true) {
    const frame=composed.modularFrame||{left:0,top:0,width:450,height:1204};
    const scale=Math.min(1,2048/Math.max(frame.width,frame.height));
    canvas.width=Math.ceil(frame.width*scale);canvas.height=Math.ceil(frame.height*scale);
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(composed,0,0,canvas.width,canvas.height);
    if(showGuides) {ctx.save();ctx.scale(canvas.width/frame.width,canvas.height/frame.height);
      ctx.translate(-frame.left,-frame.top);
      for(const mount of mounts) {
        line(ctx,mount.start,mount.end,'#f5c5ff',[6,5]);dot(ctx,mount.start,'#ffe39c',4);
      }
      ctx.restore();}
    canvas.dataset.rigKind='rigid';
    return {layerCount:0,sourceFrame:frame,mounts:mounts.length};
  }

  global.ModularWeaponFullAssembly=Object.freeze({layout,render,renderRigid,authoredContact,opaqueContact,opaqueBounds,rasterChainPlan});
})(window);

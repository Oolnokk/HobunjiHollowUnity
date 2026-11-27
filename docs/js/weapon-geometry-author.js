// Attack Animation Editor only: canonical, unscaled sprite-space geometry.
(function(global){
  'use strict';
  const MAX_POINTS=128;
  const round=n=>Math.round(n*100000)/100000;
  const copy=v=>JSON.parse(JSON.stringify(v));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function hull(points){
    const sorted=points.slice().sort((a,b)=>a.x-b.x||a.z-b.z);
    const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
    const half=items=>{const out=[];for(const p of items){while(out.length>=2&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}out.pop();return out;};
    return half(sorted).concat(half(sorted.slice().reverse()));
  }
  function mount(host,api){
    const wrap=document.createElement('details');wrap.open=true;wrap.className='field';
    const summary=document.createElement('summary');summary.textContent='Weapon geometry — draw on sprite';wrap.appendChild(summary);host.appendChild(wrap);
    const help=document.createElement('div');help.className='help';
    help.textContent='Drag length A/B, drag shortening bands, or trace the complete contact perimeter. Place the top and bottom of each band around the shortenable part of the haft. The full sprite width compresses within those rows. Bands and rope are fitted once in the grounded Light weapon stance; automatic alpha contact is used at runtime; jumps change rotation, never fitted length. Cyan = length, amber = shortening, pink = contact.';
    wrap.appendChild(help);
    const previewLabel=document.createElement('label');previewLabel.style.cssText='display:flex;gap:6px;align-items:center;margin:6px 0';
    const previewToggle=document.createElement('input');previewToggle.type='checkbox';previewToggle.checked=true;previewToggle.id='weaponGeometryPreviewEnabled';
    previewToggle.addEventListener('change',()=>global.HeldGroundPose?.setPreviewEnabled?.(previewToggle.checked));
    previewLabel.append(previewToggle,document.createTextNode('Preview fitted weapon and ground clearance'));wrap.appendChild(previewLabel);
    const fitStatus=document.createElement('div');fitStatus.id='weaponGeometryFitStatus';fitStatus.className='help';fitStatus.setAttribute('aria-live','polite');fitStatus.textContent='Waiting for preview solver…';wrap.appendChild(fitStatus);
    const toolbar=document.createElement('div');toolbar.style.cssText='display:flex;gap:5px;flex-wrap:wrap;margin:6px 0';wrap.appendChild(toolbar);
    const button=(parent,label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);parent.appendChild(b);return b;};
    const mode=document.createElement('select');mode.setAttribute('aria-label','Draw geometry mode');
    for(const [value,label] of [['length','Length A/B'],['band','Shortenable band'],['outline','Contact outline']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;mode.appendChild(option);
    }
    toolbar.appendChild(mode);
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=440;
    canvas.style.cssText='width:100%;max-width:440px;display:block;background:#202832;border:1px solid #64748b;border-radius:6px;touch-action:none;cursor:crosshair';
    canvas.setAttribute('aria-label','Weapon sprite geometry drawing area');wrap.appendChild(canvas);
    const actions=document.createElement('div');actions.style.cssText=toolbar.style.cssText;wrap.appendChild(actions);
    const numbers=document.createElement('div');numbers.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin:6px 0';wrap.appendChild(numbers);
    function number(label,min,max,step){const field=document.createElement('label');field.style.cssText='display:flex;flex:1;min-width:120px;flex-direction:column';field.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;field.appendChild(input);numbers.appendChild(field);return input;}
    const fraction=number('Mao\'ao length (% reference only)',0,400,1);
    const minimum=number('Minimum band length (%)',10,100,1);
    const ropeMin=number('Flail minimum fitted rope length (%; 0 = fixed)',0,100,1);
    const headCanvas=document.createElement('canvas');headCanvas.width=240;headCanvas.height=160;
    headCanvas.style.cssText='width:100%;max-width:320px;background:#202832;touch-action:none;display:none';
    headCanvas.setAttribute('aria-label','Flail head contact edge; drag between two points');
    wrap.appendChild(headCanvas);
    const headCtx=headCanvas.getContext('2d');
    let headSprite=null,headView=null,headStart=null; // Independent suspended-head edge.
    const status=document.createElement('div');status.className='help';status.setAttribute('aria-live','polite');wrap.appendChild(status);
    const ctx=canvas.getContext('2d');
    let key=null,committed=null,committedSignature='',source=null,view=null,draft=null,dirty=false,gesture=null; // One draft for the selected sprite.
    const history=[]; // Bounded undo stack; direct authoring events only.
    function message(s){status.textContent=s;}
    function readSource(){
      const root=api.source(),plane=root?.userData?.toolPlane;
      const material=Array.isArray(plane?.material)?plane.material[0]:plane?.material;
      const image=material?.map?.image;
      const geometry=global.HeldGroundPose?.originalGeometryFor?.(plane?.geometry)||plane?.geometry;
      if(!geometry||!image||!(image.naturalWidth||image.width)||!(image.naturalHeight||image.height))return null;
      if(source?.plane===plane&&source.image===image&&source.geometry===geometry)return source;
      if(!geometry.boundingBox)geometry.computeBoundingBox?.();
      const b=geometry.boundingBox;
      if(!b||!(b.max.x>b.min.x)||!(b.max.y>b.min.y))return null;
      return {plane,image,geometry,box:{minX:b.min.x,maxX:b.max.x,minZ:-b.max.y,maxZ:-b.min.y},unsupported:(global.HobunjiWeaponSpriteAssemblies?.assemblyKind?.(root)!=='flail'&&root.children?.length!==1)||(global.HeldGroundPose?.hasDrawingHaftChildren?.(plane,true)??(plane.children?.length>0))||root.userData?.toolEndFlipBase===true};
    }
    function defaultDraft(){const b=source.box;return {a:round(b.minZ),b:round(b.maxZ),heightFraction:0,minSegmentScale:.65,segments:[],contactOutline:[]};}
    function syncNumbers(){if(draft){fraction.value=Math.round(draft.heightFraction*10000)/100;minimum.value=Math.round(draft.minSegmentScale*10000)/100;ropeMin.value=(draft.ropeMinScale||0)*100;}}
    function setDraft(value){draft=value?copy(value):source?defaultDraft():null;if(draft){draft.segments||=[];draft.contactOutline||=[];}syncNumbers();history.length=0;dirty=false;draw();}
    function saveUndo(){if(!draft)return;history.push(copy(draft));if(history.length>30)history.shift();}
    function changed(){dirty=true;draw();}
    function pixel(p){return {x:view.x+(p.x-source.box.minX)/(source.box.maxX-source.box.minX)*view.w,y:view.y+(p.z-source.box.minZ)/(source.box.maxZ-source.box.minZ)*view.h};}
    function fromEvent(event){
      const r=canvas.getBoundingClientRect(),x=(event.clientX-r.left)*canvas.width/r.width,y=(event.clientY-r.top)*canvas.height/r.height,b=source.box;
      return {x:round(b.minX+clamp((x-view.x)/view.w,0,1)*(b.maxX-b.minX)),z:round(b.minZ+clamp((y-view.y)/view.h,0,1)*(b.maxZ-b.minZ))};
    }
    function line(z,color,label){const y=pixel({x:0,z}).y;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(view.x,y);ctx.lineTo(view.x+view.w,y);ctx.stroke();ctx.fillStyle=color;ctx.font='12px sans-serif';ctx.fillText(label,view.x+4,y-4);}
    function band(a,b,x0=source.box.minX,x1=source.box.maxX){const p=pixel({x:Math.min(x0,x1),z:Math.min(a,b)}),q=pixel({x:Math.max(x0,x1),z:Math.max(a,b)});ctx.fillStyle='rgba(251,191,36,.23)';ctx.strokeStyle='#fbbf24';ctx.lineWidth=2;ctx.fillRect(p.x,p.y,q.x-p.x,q.y-p.y);ctx.strokeRect(p.x,p.y,q.x-p.x,q.y-p.y);}
    function drawHead(){
      const image=headSprite?.material?.map?.image;
      headCanvas.style.display=image?'block':'none';
      ropeMin.parentNode.style.display=image?'flex':'none';
      if(!image||!headCtx)return;
      const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
      if(!(w>0&&h>0))return;
      const scale=Math.min(220/w,140/h);
      headView={x:(240-w*scale)/2,y:(160-h*scale)/2,w:w*scale,h:h*scale};
      headCtx.clearRect(0,0,240,160);headCtx.drawImage(image,headView.x,headView.y,headView.w,headView.h);
      const edge=draft?.headContact;
      if(edge?.length===2){headCtx.strokeStyle='#f472b6';headCtx.lineWidth=2;headCtx.beginPath();edge.forEach((p,i)=>{const x=headView.x+p.u*headView.w,y=headView.y+p.v*headView.h;i?headCtx.lineTo(x,y):headCtx.moveTo(x,y);});headCtx.stroke();}
    }
    function headPoint(e){const r=headCanvas.getBoundingClientRect();return {u:clamp(((e.clientX-r.left)*240/r.width-headView.x)/headView.w,0,1),v:clamp(((e.clientY-r.top)*160/r.height-headView.y)/headView.h,0,1)};}
    headCanvas.addEventListener('pointerdown',e=>{if(!draft||!headView)return;e.preventDefault();headCanvas.setPointerCapture?.(e.pointerId);headStart=headPoint(e);});
    headCanvas.addEventListener('pointerup',e=>{if(!headStart||!draft)return;saveUndo();draft.headContact=[headStart,headPoint(e)];headStart=null;changed();});
    headCanvas.addEventListener('pointercancel',()=>{headStart=null;});
    ropeMin.addEventListener('change',()=>{if(!draft)return;saveUndo();const n=Number(ropeMin.value);draft.ropeMinScale=n>0?clamp(n/100,.1,1):null;syncNumbers();changed();});
    function draw(){
      drawHead();
      if(!ctx)return;
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#202832';ctx.fillRect(0,0,canvas.width,canvas.height);
      if(!source||!draft){ctx.fillStyle='#fff';ctx.fillText('Select a loaded weapon sprite',16,28);message('Waiting for sprite');return;}
      const {box,image}=source,w=box.maxX-box.minX,h=box.maxZ-box.minZ;
      const scale=Math.min((canvas.width-30)/w,(canvas.height-34)/h);
      view={w:w*scale,h:h*scale,x:(canvas.width-w*scale)/2,y:(canvas.height-h*scale)/2};
      ctx.imageSmoothingEnabled=false;ctx.drawImage(image,view.x,view.y,view.w,view.h);
      for(const v of draft.segments)band(v.a,v.b,v.x0,v.x1);
      line(draft.a,'#67e8f9','A');line(draft.b,'#67e8f9','B');
      if(gesture&&mode.value==='band')band(gesture.start.z,gesture.end.z,gesture.start.x,gesture.end.x);
      if(gesture&&mode.value==='length'){line(gesture.start.z,'#fff','');line(gesture.end.z,'#fff','');}
      const outline=draft.contactOutline;
      if(outline.length){ctx.strokeStyle='#f472b6';ctx.fillStyle='rgba(244,114,182,.10)';ctx.lineWidth=2;ctx.beginPath();outline.forEach((p,i)=>{const q=pixel(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});if(outline.length>2){ctx.closePath();ctx.fill();}ctx.stroke();for(const p of outline){const q=pixel(p);ctx.fillStyle='#f472b6';ctx.fillRect(q.x-2,q.y-2,4,4);}}
      message((dirty?'Unsaved draft • ':'')+key+' • '+round(draft.b-draft.a)+' source length • '+draft.segments.length+' bands • '+outline.length+' contact points'+(source.unsupported&&!headSprite?' • layered/flipped sprite: runtime clearance fallback':headSprite?' • draw suspended head edge in the second canvas':''));
    }
    function refresh(nextKey,profile){
      const next=readSource();
      const part=global.HobunjiWeaponSpriteAssemblies?.previewParts?.(next?.plane)?.groundContactSprite||null;
      const headChanged=part!==headSprite;headSprite=part;
      if(nextKey!==key||next!==source){key=nextKey;source=next;committed=profile;committedSignature=JSON.stringify(profile||null);gesture=null;headStart=null;setDraft(profile);}
      else if(profile!==committed){committed=profile;const sig=JSON.stringify(profile||null);if(sig!==committedSignature){committedSignature=sig;setDraft(profile);}else if(headChanged)drawHead();}
      else if(headChanged)drawHead();
    }
    function addPoint(p){
      const pts=draft.contactOutline,last=pts[pts.length-1];
      if(pts.length>=MAX_POINTS)return;
      if(last){const a=pixel(last),b=pixel(p);if(Math.hypot(a.x-b.x,a.y-b.y)<3)return;}
      pts.push(p);
    }
    canvas.addEventListener('pointerdown',event=>{
      if(!draft||!source||!view||gesture||event.button>0)return;
      event.preventDefault();canvas.setPointerCapture?.(event.pointerId);saveUndo();
      const p=fromEvent(event);gesture={id:event.pointerId,start:p,end:p,mode:mode.value};
      if(gesture.mode==='outline')addPoint(p);
      changed();
    });
    canvas.addEventListener('pointermove',event=>{
      if(!gesture||gesture.id!==event.pointerId)return;
      event.preventDefault();gesture.end=fromEvent(event);
      if(gesture.mode==='outline')addPoint(gesture.end);changed();
    });
    function finish(event){
      if(!gesture||gesture.id!==event.pointerId)return;
      const p=fromEvent(event),a=Math.min(gesture.start.z,p.z),b=Math.max(gesture.start.z,p.z),kind=gesture.mode;
      const x0=Math.min(gesture.start.x,p.x),x1=Math.max(gesture.start.x,p.x);
      gesture=null;
      if(kind==='length'&&b-a>1e-5){draft.a=a;draft.b=b;draft.segments=draft.segments.filter(v=>v.a>=a&&v.b<=b);}
      if(kind==='band'&&b-a>1e-5){
        if(a<draft.a||b>draft.b||draft.segments.some(v=>a<v.b&&b>v.a)){draw();message('Band must be within length A/B and not overlap another band.');return;}
        if(x1-x0<=1e-5){draw();message('Drag a rectangle with nonzero width.');return;}
        if(draft.segments.length<16){draft.segments.push({a,b,x0,x1});draft.segments.sort((x,y)=>x.a-y.a);}
      }
      if(kind==='outline')addPoint(p);
      changed();
    }
    canvas.addEventListener('pointerup',finish);
    canvas.addEventListener('pointercancel',()=>{if(gesture){gesture=null;draft=history.pop()||draft;changed();}});
    mode.addEventListener('change',()=>{gesture=null;draw();});
    for(const [input,field,min,max] of [[fraction,'heightFraction',0,4],[minimum,'minSegmentScale',.1,1]])input.addEventListener('change',()=>{if(!draft)return;const value=Number(input.value);if(!Number.isFinite(value)){syncNumbers();return;}saveUndo();draft[field]=clamp(value/100,min,max);syncNumbers();changed();});
    button(actions,'Auto trace opaque art',()=>{
      try{
        if(!source||!draft)throw Error('Select a loaded weapon first.');
        const image=source.image,w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,b=source.box;
        if(w*h>16000000)throw Error('Sprite is too large for an alpha scan.');
        const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(image,0,0);
        const rgba=g.getImageData(0,0,w,h).data,points=[];
        const pos=(x,y)=>({x:b.minX+(b.maxX-b.minX)*x/w,z:b.minZ+(b.maxZ-b.minZ)*y/h});
        for(let y=0;y<h;y++){
          let left=w,right=-1;
          for(let x=0;x<w;x++)if(rgba[(y*w+x)*4+3]>=21){left=Math.min(left,x);right=x;}
          if(right>=left)points.push(pos(left,y),pos(right+1,y),pos(left,y+1),pos(right+1,y+1));
        }
        if(points.length<3)throw Error('No opaque pixels found.');
        const outline=hull(points);
        if(outline.length<3||outline.length>MAX_POINTS)throw Error('Automatic outline too complex; draw the perimeter manually.');
        saveUndo();draft.a=round(Math.min(...outline.map(p=>p.z)));draft.b=round(Math.max(...outline.map(p=>p.z)));
        draft.contactOutline=outline.map(p=>({x:p.x,z:p.z}));
        draft.segments=draft.segments.filter(v=>v.a>=draft.a&&v.b<=draft.b);
        if(!draft.heightFraction)draft.heightFraction=clamp(api.initialFraction(draft.a,draft.b),0,4);
        syncNumbers();changed();
      }catch(e){message(e.message);}
    });
    button(actions,'Undo',()=>{if(history.length){draft=history.pop();syncNumbers();changed();}});
    button(actions,'Clear outline',()=>{if(draft){saveUndo();draft.contactOutline=[];changed();}});
    button(actions,'Clear flail head edge',()=>{if(draft){saveUndo();draft.headContact=null;changed();}});
    button(actions,'Clear bands',()=>{if(draft){saveUndo();draft.segments=[];changed();}});
    button(actions,'Revert draft',()=>setDraft(committed));
    button(actions,'Apply geometry',()=>{try{if(!draft||!source||readSource()!==source)throw Error('Wait for the selected sprite to load.');if(draft.contactOutline.length>0&&draft.contactOutline.length<3)throw Error('Trace at least three points or clear the outline.');api.apply(copy(draft),key);dirty=false;draw();message('Applied to grip configuration and live preview. Export/save it with the existing grip controls.');}catch(e){message(e.message);}});
    button(actions,'Restore legacy',()=>{try{api.apply(null,key);setDraft(null);message('Legacy weapon geometry restored.');}catch(e){message(e.message);}});
    return {refresh};
  }
  global.HobunjiWeaponGeometryAuthor=Object.freeze({mount,hull});
})(window);

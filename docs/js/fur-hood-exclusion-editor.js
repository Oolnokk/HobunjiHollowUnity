(function FurHoodExclusionEditorModule(){
  'use strict';
  if(window.FurHoodExclusionEditor)return;
  const SCRIPT_URL=document.currentScript?.src||document.baseURI; // Resolves the game asset directory from the JS module even in nested Tool Hub pages.
  const HOOD_CONFIG_URL=new URL('../config/cosmetics/fur_hood.json',SCRIPT_URL).href; // Reads actual authored hood base/trim sprites for both head fits.
  const ROLES=Object.freeze({base:'Hood base',trim:'Hood trim',animalFront:'Animal front',animalBack:'Animal back'}); // Exact runtime role names; not filename guesses.
  const cleanHex=value=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toLowerCase():null; // Validate picked RGB before writing exportable arrays.
  const unique=list=>[...new Set((Array.isArray(list)?list:[]).map(cleanHex).filter(Boolean))]; // Exclusion lists never include alpha or approximate HSV colors.
  const toUrl=path=>new URL('../'+String(path||'').replace(/^\.\//,''),SCRIPT_URL).href; // Maps docs-root assets/ paths to real docs/assets/ URLs.
  const fetchSprite=path=>new Promise((resolve,reject)=>{
    if(!path){reject(Error('No raw sprite is authored for this species, fit, and layer.'));return;}
    const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Could not load raw sprite: '+path));
    img.src=toUrl(path);
  });
  function spritePaths(config,entry,fit,view) {
    const layers=config?.speciesVariants?.[fit]?.parts?.head?.layers||{}; // The same variant group selected in the Pattern Editor.
    const parts=entry?.parts?.[fit]||{};
    return {
      base:view==='behind'?(layers.front?.behindImage?.url||layers.front?.image?.url):layers.front?.image?.url,
      trim:view==='behind'?(layers.front_trim?.behindImage?.url||layers.front_trim?.image?.url):layers.front_trim?.image?.url,
      animalFront:parts.front||null,
      animalBack:parts.back||null,
    };
  }
  function cloneHood(hood,exclusions) {
    const source=hood||{};
    return {...source,authoringPalette:{
      ...(source.authoringPalette||{}),
      exclusionOverrides:{global:[...exclusions.global],byRole:{[exclusions.role]:[...exclusions.local]}}, // Compare actual inherited tint with global+role exclusions against a no-exclusion tint.
    }};
  }
  function spriteTintCanvas(source,hood,role) {
    const api=window.FurHoodLeatherworking;
    const keyed=api?.recolorAnimalPart?.(source,hood,role); // Grehlr's dual hue/saturation fills are exactly the production method.
    if(keyed)return api.preserveProtectedColors(source,keyed,hood,role);
    const canvas=document.createElement('canvas');canvas.width=source.naturalWidth||source.width;canvas.height=source.naturalHeight||source.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);
    const frame=ctx.getImageData(0,0,canvas.width,canvas.height);
    const original=new Uint8ClampedArray(frame.data); // Raw source bytes are the authority for exact exclusions.
    const hex=api?.colorForRole?.(hood,role);
    if(hex&&window.SpriteRecolor?.recolorImageData)window.SpriteRecolor.recolorImageData(frame.data,parseInt(hex.slice(1),16),'direct');
    api?.restoreProtectedPixels?.(frame.data,original,hood,role);
    ctx.putImageData(frame,0,0);
    return canvas;
  }
  function sourcePixelsOf(image) {
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    return {canvas, pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data}; // Fixed exact original pixel buffer for all eyedropper clicks.
  }
  function exportData(manifest,kind,role) {
    const global=unique(manifest.excludedColors);
    const species=manifest.species?.[kind]?.excludedColorsByRole||{};
    const byRole=Object.fromEntries(Object.keys(ROLES).map(key=>[key,unique(species[key])])); // Export every role, not just the visible layer.
    return {schema:'hobunji_fur_exclusions.v1',species:kind,role,global,byRole,effective:unique([...global,...byRole[role]])};
  }
  function triggerDownload(name,text,mime='application/json'){
    const url=URL.createObjectURL(new Blob([text],{type:mime})); // Local export; the repo manifest still needs an explicit author upload.
    const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function open({manifest,getState,onChange}){
    if(!manifest?.species||typeof getState!=='function')throw Error('The animal manifest and current hood selection must be loaded.');
    const dialog=document.createElement('div');dialog.className='trimPaintOverlay';dialog.dataset.furExclusions='true';
    dialog.innerHTML=`<section class="trimPaintPanel" style="max-width:1090px">
      <header class="trimPaintHead"><h2>Raw fur sprite eyedropper · exclusion colors</h2><button data-ex-close type="button">Close</button></header>
      <div style="padding:12px">
        <div class="muted">Tap a pixel in the untreated sprite to add its exact RGB hex. The two previews update immediately. Lists are stored in the animal manifest, not in a player's dye data.</div>
        <div class="fields" style="margin:9px 0">
          <label>Source sprite<select data-ex-role><option value="base">Hood base</option><option value="trim">Hood trim</option><option value="animalFront">Animal front</option><option value="animalBack">Animal back</option></select></label>
          <label>Add sample to<select data-ex-scope><option value="role">This animal + sprite role</option><option value="global">Global (all fur hoods)</option></select></label>
          <label>Zoom (nearest-neighbor)<input data-ex-zoom type="range" min="1" max="14" value="5"></label>
          <label><input type="checkbox" data-ex-highlight style="width:auto"> Highlight protected pixels (debug only)</label>
        </div>
        <div class="row" style="align-items:stretch">
          <div style="flex:1 1 230px;min-width:0"><b style="font-size:12px">Raw source · tap to pick</b><div class="trimPaintScroller" style="max-height:47vh" data-ex-scroller><canvas data-ex-raw style="image-rendering:pixelated;cursor:crosshair;touch-action:manipulation"></canvas></div></div>
          <div style="flex:1 1 230px;min-width:0"><b style="font-size:12px">Recolored without exclusions</b><div class="trimPaintScroller" style="max-height:47vh"><canvas data-ex-before style="image-rendering:pixelated"></canvas></div></div>
          <div style="flex:1 1 230px;min-width:0"><b style="font-size:12px">Recolored with exclusions</b><div class="trimPaintScroller" style="max-height:47vh"><canvas data-ex-after style="image-rendering:pixelated"></canvas></div></div>
        </div>
        <div class="row" style="margin-top:9px">
          <span data-ex-swatch style="display:inline-block;width:26px;height:26px;border:1px solid #fff;border-radius:5px"></span>
          <b data-ex-picked style="font-family:monospace">Tap an opaque raw pixel</b>
          <span class="muted" data-ex-count></span>
        </div>
        <div data-ex-list style="margin-top:10px"></div>
        <div class="row" style="margin-top:10px">
          <button type="button" data-ex-copy class="secondary">Copy visible HEX list</button>
          <button type="button" data-ex-text class="secondary">Export HEX list (.txt)</button>
          <button type="button" data-ex-json>Export exclusion lists (.json)</button>
        </div>
        <div data-ex-status class="trimPaintNote" role="status">Loading raw sprite…</div>
      </div>
    </section>`;
    document.body.appendChild(dialog);
    const $=selector=>dialog.querySelector(selector);
    const roles=$('[data-ex-role]'),scope=$('[data-ex-scope]'),raw=$('[data-ex-raw]'),before=$('[data-ex-before]'),after=$('[data-ex-after]');
    const zoom=$('[data-ex-zoom]'),highlight=$('[data-ex-highlight]'),status=$('[data-ex-status]'),picked=$('[data-ex-picked]'); // All feedback is visible without devtools, including mobile.
    let image=null,rawBuffer=null,loadedPath=null,pickedHex=null,revision=0,closed=false; // Revision rejects sprite fetches after changing role or closing.
    let config=null; // Loaded actual cosmetic config; no hardcoded sprite names or nonexistent fit fallbacks.
    function state(){const selected=getState();const entry=manifest.species?.[selected.kind]||null;return {...selected,entry};}
    function lists(){
      const current=state(),local=current.entry?.excludedColorsByRole?.[roles.value]||[];
      return {global:unique(manifest.excludedColors),local:unique(local),role:roles.value};
    }
    function updateZoom(){
      const scale=Math.max(1,Number(zoom.value)||1);
      for(const canvas of [raw,before,after]){canvas.style.width=canvas.width*scale+'px';canvas.style.height=canvas.height*scale+'px';} // CSS zoom cannot change source pixel indices.
    }
    function paintResult(canvas,result){
      canvas.width=result.width;canvas.height=result.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(result,0,0);
    }
    function overlayDebug(canvas,values){
      if(!highlight.checked||!rawBuffer)return;
      const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
      const allowed=new Set(values.map(hex=>parseInt(hex.slice(1),16)));let protectedCount=0;
      for(let i=0;i<rawBuffer.length;i+=4){
        if(rawBuffer[i+3]===0||!allowed.has((rawBuffer[i]<<16)|(rawBuffer[i+1]<<8)|rawBuffer[i+2]))continue;
        data.data[i]=255;data.data[i+1]=0;data.data[i+2]=180;protectedCount++;
      }
      canvas.getContext('2d').putImageData(data,0,0);
      $('[data-ex-count]').textContent=protectedCount+' source pixels highlighted (not exported)';
    }
    function refreshPreview(){
      if(!image||closed)return;
      const selected=state(),sets=lists(),hood=selected.furHood;
      if(!hood){status.textContent='Select an animal and a sample coat color first.';return;}
      const zero=cloneHood(hood,{global:[],local:[],role:roles.value});
      const excluded=cloneHood(hood,{...sets});
      try{
        paintResult(before,spriteTintCanvas(image,zero,roles.value));
        paintResult(after,spriteTintCanvas(image,excluded,roles.value));
        const effective=unique([...sets.global,...sets.local]);
        const match=new Set(effective.map(hex=>parseInt(hex.slice(1),16)));
        let kept=0;for(let i=0;i<rawBuffer.length;i+=4)if(rawBuffer[i+3]>0&&match.has((rawBuffer[i]<<16)|(rawBuffer[i+1]<<8)|rawBuffer[i+2]))kept++;
        $('[data-ex-count]').textContent=kept+' exact source pixels protected';
        overlayDebug(after,effective);updateZoom();
        status.textContent='Comparing actual source art to production tint methods. Changes update the full hood preview; export fur-hoods.json to publish.';
      }catch(error){status.textContent='Could not calculate preview: '+String(error?.message||error);}
    }
    function renderList(){
      const values=lists(),list=$('[data-ex-list]');list.replaceChildren();
      for(const [label,field,canRemove] of [['Global exclusions','global',true],['This species + sprite role','local',true]]){
        const row=document.createElement('div');row.className='row';row.style.margin='4px 0';
        const title=document.createElement('strong');title.style.fontSize='12px';title.textContent=label+':';row.appendChild(title);
        if(!values[field].length){const none=document.createElement('span');none.className='muted';none.textContent='(none)';row.appendChild(none);}
        for(const hex of values[field]){
          const btn=document.createElement('button');btn.type='button';btn.className='secondary';
          btn.style.padding='5px 8px';btn.style.borderLeft='10px solid '+hex;btn.title='Remove '+hex+' from '+label;
          btn.textContent=hex.toUpperCase()+' ×';
          btn.onclick=()=>{const current=state();if(field==='global')manifest.excludedColors=values.global.filter(x=>x!==hex);
            else {current.entry.excludedColorsByRole ||= {};current.entry.excludedColorsByRole[roles.value]=values.local.filter(x=>x!==hex);}
            changed();};
          row.appendChild(btn);
        }
        list.appendChild(row);
      }
    }
    function changed(){
      renderList();refreshPreview();
      onChange?.(); // Renders the ENTIRE hood using the same game compositor with unsaved manifest-color overrides.
    }
    async function load(){
      const token=++revision,selected=state();
      image=null;rawBuffer=null;loadedPath=null;
      raw.width=before.width=after.width=1;raw.height=before.height=after.height=1;
      if(!config){status.textContent='Loading authored hood layers…';try{const response=await fetch(HOOD_CONFIG_URL);if(!response.ok)throw Error('Hood config HTTP '+response.status);config=await response.json();}catch(error){if(token===revision)status.textContent='Unable to load hood config: '+error.message;return;}}
      if(token!==revision||closed)return;
      const path=spritePaths(config,selected.entry,selected.fit,selected.view)[roles.value];
      if(!path){status.textContent='No '+ROLES[roles.value].toLowerCase()+' sprite exists for '+selected.kind+' / '+selected.fit+'. Select another sprite role or fit.';renderList();return;}
      if(manifest.pendingAssets?.includes(path)){status.textContent='Sprite referenced but not uploaded yet: '+path+'. You can still inspect existing layers; the art will be provided after merge.';renderList();return;}
      status.textContent='Loading untreated sprite: '+path;
      try{
        const source=await fetchSprite(path);if(token!==revision||closed)return;
        image=source;loadedPath=path;
        const drawn=sourcePixelsOf(source);rawBuffer=drawn.pixels;
        paintResult(raw,drawn.canvas);renderList();refreshPreview();
      }catch(error){if(token===revision)status.textContent=error.message;}
    }
    raw.onpointerdown=event=>{
      if(!rawBuffer||!image||closed)return;
      const rect=raw.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)*raw.width/rect.width),y=Math.floor((event.clientY-rect.top)*raw.height/rect.height);
      if(x<0||y<0||x>=raw.width||y>=raw.height)return;
      const offset=(y*raw.width+x)*4;
      if(!rawBuffer[offset+3]){picked.textContent='Transparent pixel ('+x+', '+y+') · select an opaque pixel';return;}
      const hex='#'+[...rawBuffer.slice(offset,offset+3)].map(v=>v.toString(16).padStart(2,'0')).join('');
      const counts=rawBuffer.filter?null:null; // No approximate-color matching: sample one exact RGB tuple.
      pickedHex=hex;picked.textContent=hex.toUpperCase()+' at ('+x+', '+y+')';
      $('[data-ex-swatch]').style.background=hex;
      const selected=state(),values=lists();
      if(scope.value==='global')manifest.excludedColors=unique([...values.global,hex]);
      else{selected.entry.excludedColorsByRole ||= {};selected.entry.excludedColorsByRole[roles.value]=unique([...values.local,hex]);}
      changed();
    };
    roles.onchange=load;scope.onchange=renderList;zoom.oninput=updateZoom;highlight.onchange=refreshPreview;
    $('[data-ex-copy]').onclick=async()=>{
      const hexes=unique([...lists().global,...lists().local]);const value=hexes.join('\n');
      try{await navigator.clipboard.writeText(value);status.textContent='Copied '+hexes.length+' effective HEX colors.';}
      catch(error){status.textContent='Clipboard unavailable; use Export HEX list (.txt). '+String(error?.message||error);}
    };
    $('[data-ex-text]').onclick=()=>{
      const current=state(),value=unique([...lists().global,...lists().local]).map(hex=>hex.toUpperCase()).join('\n')+'\n';
      triggerDownload('furhood-'+current.kind+'-'+roles.value+'-exclusions.txt',value,'text/plain');
      status.textContent='Exported effective source RGB exclusions for '+current.kind+' / '+roles.value+'.';
    };
    $('[data-ex-json]').onclick=()=>{
      const current=state();triggerDownload('furhood-'+current.kind+'-exclusions.json',JSON.stringify(exportData(manifest,current.kind,roles.value),null,2)+'\n');
      status.textContent='Exported global and all four role-specific exclusion lists. Also export fur-hoods.json to publish them for the game.';
    };
    function close(){if(closed)return;closed=true;revision++;dialog.remove();}
    $('[data-ex-close]').onclick=close;
    dialog.addEventListener('pointerdown',event=>{if(event.target===dialog)close();});
    load();
    return Object.freeze({close,refresh:()=>{if(!closed)refreshPreview();},debug:()=>({role:roles.value,scope:scope.value,path:loadedPath,pickedHex,exclusions:exportData(manifest,state().kind,roles.value),status:status.textContent})});
  }
  window.FurHoodExclusionEditor=Object.freeze({open,spritePaths,exportData,unique}); // Tool-only; game runtime does not load this editor.
})();

(async()=>{
  'use strict';
  const status=document.getElementById('status'); // Bootstrap reports progress before the main editor has loaded.
  const banner=document.createElement('div'); // Independent status avoids overwriting repository/3D load diagnostics.
  banner.id='clothingFitBootstrapStatus';
  banner.setAttribute('role','status');
  banner.setAttribute('aria-live','polite');
  banner.style.cssText='margin:8px 0;padding:8px;border:1px solid #526173;border-radius:6px;font-size:12px;overflow-wrap:anywhere';
  status?.insertAdjacentElement('afterend',banner);
  const progress=(message)=>{banner.textContent=message;}; // Visible even when the app itself cannot initialize.
  async function fetchPart(name){
    const controller=new AbortController(); // Every individual module fetch has a bounded wait on mobile networks.
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(name,{cache:'default',signal:controller.signal});
      if(!response.ok)throw new Error(name+': HTTP '+response.status);
      return await response.text();
    }catch(error){
      if(error?.name==='AbortError')throw new Error(name+': request timed out after 15 seconds');
      throw new Error(name+': '+(error?.message||error));
    }finally{clearTimeout(timer);}
  }
  async function fetchParts(prefix,count,label){
    const output=new Array(count); // Preserve author-specified concatenation order despite concurrent network fetches.
    let cursor=0,complete=0;
    async function worker(){
      while(cursor<count){
        const i=cursor++;
        output[i]=await fetchPart(prefix+(i+1)+'.txt');
        complete++;
        progress('Loading '+label+': '+complete+'/'+count+' modules…');
      }
    }
    progress('Loading '+label+': 0/'+count+' modules…');
    await Promise.all(Array.from({length:Math.min(4,count)},worker));
    return output.join('');
  }
  try{
    const core=await fetchParts('app.part',12,'clothing fit editor');
    (0,eval)(core); // The 2D tool initializes immediately, independently of Three.js and patch author.
    const behind=await fetchParts('behind.part',5,'behind-sprite extension');
    (0,eval)(behind);
    const behindPanel=document.getElementById('behindSpritePatchSection');
    if(behindPanel)behindPanel.hidden=document.getElementById('fitRegion')?.value==='headwear';
    banner.remove();
  }catch(error){
    console.error(error);
    progress('Clothing fit initialization failed: '+String(error?.message||error));
    banner.style.borderColor='#fb7185';banner.style.color='#fb7185';
    if(status&&status.textContent==='Loading…')status.textContent='Editor startup failed; see the error below.';
    const retry=document.createElement('button'); // Mobile users can retry without browser developer tools.
    retry.type='button';retry.textContent='Retry loading editor';
    retry.style.cssText='display:block;margin-top:8px;padding:8px';
    retry.onclick=()=>location.reload();
    banner.appendChild(retry);
  }
})();

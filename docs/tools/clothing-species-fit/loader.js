(async()=>{
  try{
    const parts=[]; // Collects the split core editor source before evaluating it as one application.
    for(let i=1;i<=12;i++){
      const r=await fetch(`app.part${i}.txt`,{cache:'no-store'}); // Loads each checked-in editor source chunk in order.
      if(!r.ok)throw new Error(`app.part${i}.txt: ${r.status}`);
      parts.push(await r.text());
    }
    (0,eval)(parts.join(''));

    const patchScript=document.createElement('script'); // Loads the behind-sprite patch UI after the core editor exposes its repository/deformation bridge.
    patchScript.src='behind-sprite-patch.js';
    patchScript.async=false;
    patchScript.onerror=()=>document.body.insertAdjacentHTML('afterbegin','<pre style="color:#fb7185;padding:10px;white-space:pre-wrap">Behind sprite patch author failed to load.</pre>');
    document.body.appendChild(patchScript);
  }catch(error){
    console.error(error);
    document.body.insertAdjacentHTML('afterbegin',`<pre style="color:#fb7185;padding:10px;white-space:pre-wrap">Clothing Species Fit tool failed to load: ${String(error?.message||error)}</pre>`);
  }
})();

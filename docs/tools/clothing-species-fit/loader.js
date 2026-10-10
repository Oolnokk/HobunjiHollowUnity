(async()=>{
  try{
    const parts=[]; // Collects the split V24 core editor source before evaluating it as one application.
    for(let i=1;i<=12;i++){
      const r=await fetch(`app.part${i}.txt`,{cache:'no-store'});
      if(!r.ok)throw new Error(`app.part${i}.txt: ${r.status}`);
      parts.push(await r.text());
    }
    (0,eval)(parts.join(''));

    const patchParts=[]; // Keeps the larger V24 behind-sprite author split into repository-friendly text chunks too.
    for(let i=1;i<=5;i++){
      const r=await fetch(`behind.part${i}.txt`,{cache:'no-store'});
      if(!r.ok)throw new Error(`behind.part${i}.txt: ${r.status}`);
      patchParts.push(await r.text());
    }
    (0,eval)(patchParts.join(''));
  }catch(error){
    console.error(error);
    document.body.insertAdjacentHTML('afterbegin',`<pre style="color:#fb7185;padding:10px;white-space:pre-wrap">Clothing Species Fit tool failed to load: ${String(error?.message||error)}</pre>`);
  }
})();

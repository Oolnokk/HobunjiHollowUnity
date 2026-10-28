// Shared, event-driven controls; each editor owns its state, undo and rebuild.
window.SurfaceFoliageAuthoring = (() => {
  'use strict';
  function mount(host, adapter) {
    const panel = document.createElement('section'); // A single isolated section works in dedicated tabs and sidebar panels.
    panel.className = 'section card';
    panel.innerHTML = `<h2>Roots &amp; vines</h2><p class="hint muted">Grow along actual surfaces. Walls include generated gables. Select pieces in the viewport to restrict growth to them. Recipes are saved in JSON.</p>
      <label>Saved layer <select data-field="layer"><option value="-1">New layer</option></select></label>
      <div class="row"><label>Type <select data-field="kind"><option value="vines">Vines</option><option value="roots">Roots</option></select></label>
      <label>Target <select data-field="target"></select></label></div>
      <div class="row"><label>Growth style <select data-field="style"><option value="natural">Natural (original)</option><option value="cornerFill">Corner Fill · follow intersections</option><option value="wrap">Wrap · spread inward from edges</option></select></label></div>
      <div class="row" data-wrap-controls><label>Wrap density <input data-field="density" type="range" min="0.05" max="1" step="0.05" value="0.45"></label><output data-density-label>45%</output></div>
      <p class="hint muted">Natural follows freely across surface faces. Corner Fill pins its base spline directly to real surface intersections, then adds gentle Curl; Clearance offsets the visible strands from those edges. Wrap spreads from edges toward uncovered areas, with Strands acting as a performance budget. Density is an approximate coverage goal; 100% adds a thin, continuous textured cover without piling up tubes.</p>
      <div class="row"><label>Seed <input data-field="seed" value="surface-1" style="width:130px"></label><label><span data-count-label>Strands per surface</span> <input data-field="count" type="number" min="1" max="80" value="12" style="width:70px"></label></div>
      <div class="row"><label>Maximum strands per surface <input data-field="strandLimit" type="number" min="1" max="80" value="80" style="width:70px"></label><label><input data-field="perSurface" type="checkbox" checked> Distribute by detected surface</label></div>
      <p class="hint muted">Each recognized wall/gable region receives its own Strands budget, capped by its maximum. Legacy Natural layers preserve their previous behavior unless you enable detected surfaces. Shingle layers stay unchanged.</p>
      <div class="row"><label>Length <input data-field="length" type="number" min="0.05" max="30" step="0.1" value="3" style="width:80px"></label><label>Radius <input data-field="radius" type="number" min="0.002" max="0.3" step="0.005" value="0.025" style="width:80px"></label></div>
      <div class="row"><label>Curl <input data-field="curl" type="number" min="0" max="2" step="0.1" value="0.4" style="width:80px"></label><label>Clearance <input data-field="offset" type="number" min="0" max="0.2" step="0.005" value="0.008" style="width:80px"></label><label>Color <input data-field="color" type="color" value="#3a5f3a"></label></div>
      <label>PNG texture <input data-field="texture" type="text" placeholder="assets/textures/example.png" style="width:100%"></label>
      <p class="hint muted">Use an assets/ PNG path or HTTPS URL, upload a PNG to embed it in JSON, or leave blank for solid color.</p><input data-field="textureFile" type="file" accept="image/png" style="max-width:100%"><button data-action="defaults" type="button">Shadewood texture + color</button>
      <div class="row"><button data-action="apply" type="button">Apply / regenerate</button><button data-action="remove" type="button">Remove layer</button><button data-action="refresh" type="button">Refresh layers</button></div><pre data-report role="status" style="white-space:pre-wrap">Ready. Latest change: per-layer PNG textures and colors, defaulting to Shadewood.</pre>`;
    host.appendChild(panel);
    const field = name => panel.querySelector('[data-field="'+name+'"]'), report = panel.querySelector('[data-report]'); // Scoped selectors allow more than one panel without ID collisions.
    const updateStyleControls=()=>{ // Wrap alone exposes the coverage-density slider.
      const wrap=field('style').value==='wrap';
      panel.querySelector('[data-wrap-controls]').style.display=wrap?'':'none'; // Explicit display prevents editor-specific .row CSS from overriding the hidden attribute.
      panel.querySelector('[data-density-label]').textContent=Math.round(Number(field('density').value)*100)+'%';
      panel.querySelector('[data-count-label]').textContent=wrap?'Strand budget per surface':'Strands per surface';
      field('perSurface').disabled=field('target').value==='shingles'; // Wrap's count sets a geometric complexity budget rather than a fixed number of strands.
    };
    field('style').onchange=updateStyleControls;
    field('target').onchange=updateStyleControls;
    field('density').oninput=updateStyleControls;
    for (const [value, label] of adapter.targets) { const option = document.createElement('option'); option.value=value;option.textContent=label;field('target').appendChild(option); }
    function refresh() {
      const previous = field('layer').value, layers = adapter.read() || []; // Preserve the active recipe while unrelated editor geometry changes.
      field('layer').replaceChildren(new Option('New layer', '-1'));
      layers.forEach((recipe,index)=>field('layer').add(new Option(`${index+1}. ${recipe.kind} · ${recipe.target} · ${recipe.seed}`,String(index))));
      field('layer').value = Number(previous)>=0&&Number(previous)<layers.length ? previous : '-1';
    }
    field('layer').onchange = () => {
      const recipe = (adapter.read()||[])[Number(field('layer').value)]; // Editing keeps the recipe's captured selected-object IDs.
      if(recipe)field('perSurface').checked=window.FoliageGenerator.normalizeSurfaceGrowth(recipe).perSurface;
      if(recipe)for(const key of ['kind','target','style','density','seed','count','strandLimit','length','radius','curl','offset','color','texture'])field(key).value=window.FoliageGenerator.normalizeSurfaceGrowth(recipe)[key]??'';
      updateStyleControls();
    };
    function applyDefaults() {
      const defaults=window.FoliageGenerator.surfaceGrowthDefaults(field('kind').value); // One shared default source keeps the UI and saved/runtime recipes aligned.
      field('color').value=defaults.color;field('texture').value=defaults.texture;
    }
    field('kind').onchange=applyDefaults;
    panel.querySelector('[data-action="defaults"]').onclick=applyDefaults;
    field('textureFile').onchange=async event=>{
      try {
        const file=event.target.files?.[0]; // PNG bytes are embedded rather than using an expiring object URL.
        if(!file)return;
        if(file.type!=='image/png'&&!/\.png$/i.test(file.name))throw new Error('Choose a PNG image.');
        const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer()); // Reject mislabeled files before persisting them into a project.
        if(bytes.length!==8||bytes.some((byte,index)=>byte!==[137,80,78,71,13,10,26,10][index]))throw new Error('This file is not a PNG.');
        field('texture').value=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve('data:image/png;base64,'+String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('PNG could not be read.'));reader.readAsDataURL(file);});
        report.textContent='PNG embedded: '+file.name+'. Press Apply / regenerate to save this layer.';
      }catch(error){report.textContent='Texture import failed: '+error.message;}finally{event.target.value='';}
    };
    panel.querySelector('[data-action="apply"]').onclick = () => {
      try {
        const recipes = [...(adapter.read()||[])], index = Number(field('layer').value), input = {}; // Copy the list so undo snapshots retain the prior state.
        for(const key of ['kind','target','style','density','seed','count','length','radius','curl','offset','color','texture'])input[key]=field(key).value;
        input.perSurface=field('perSurface').checked;
        input.targetIds=input.target==='selected' ? adapter.selectedIds() : [];
        if(input.target==='selected'&&!input.targetIds.length){
          if(index>=0&&recipes[index]?.target==='selected')input.targetIds=recipes[index].targetIds||[];
          if(!input.targetIds.length)throw new Error('Select at least one target piece first.');
        }
        if(index<0&&recipes.length>=32)throw new Error('Maximum 32 growth layers. Edit or remove an existing layer.');
        const recipe=window.FoliageGenerator.normalizeSurfaceGrowth(input); // Bounds inputs consistently with gameplay regeneration.
        if(index>=0)recipes[index]=recipe;else recipes.push(recipe);
        report.textContent=adapter.write(recipes)||'Growth regenerated.';refresh();field('layer').value=String(index>=0?index:recipes.length-1);
      } catch(error) { report.textContent='Growth failed: '+error.message;adapter.log?.(report.textContent,'warn'); }
    };
    panel.querySelector('[data-action="remove"]').onclick = () => {
      const index=Number(field('layer').value), recipes=[...(adapter.read()||[])]; // Removing a layer goes through the editor's existing undo path.
      if(index<0){report.textContent='Choose a saved layer first.';return;}
      recipes.splice(index,1);report.textContent=adapter.write(recipes)||'Layer removed.';field('layer').value='-1';refresh();
    };
    panel.querySelector('[data-action="refresh"]').onclick=refresh;
    applyDefaults();refresh();updateStyleControls();return {refresh};
  }
  return {mount};
})();

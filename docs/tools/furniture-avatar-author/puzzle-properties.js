// Generic OFF/ON transition authoring for furniture activators/mechanisms.
(() => {
  'use strict';
  const api = window.FurniturePuzzleProperties;
  if (!api || typeof state !== 'object') return;

  state.puzzle = api.normalizePuzzle(state.puzzle);
  const host = document.getElementById('sidebar-scroll') || document.querySelector('aside');
  const section = document.createElement('div');
  section.className = 'section';
  section.style.cssText = '--sec:#38bdf8;--secBg:rgba(56,189,248,.08)';
  const transformFields = (prefix, label) => `<fieldset style="margin-top:8px"><legend>${label} state</legend>
    <label>Position offset X / Y / Z</label><div class="g3"><input id="${prefix}PX" type="number" step=".05"><input id="${prefix}PY" type="number" step=".05"><input id="${prefix}PZ" type="number" step=".05"></div>
    <label style="margin-top:5px">Rotation offset X° / Y° / Z°</label><div class="g3"><input id="${prefix}RX" type="number" step="5"><input id="${prefix}RY" type="number" step="5"><input id="${prefix}RZ" type="number" step="5"></div>
    <label style="margin-top:5px">Scale multiplier X / Y / Z</label><div class="g3"><input id="${prefix}SX" type="number" step=".05"><input id="${prefix}SY" type="number" step=".05"><input id="${prefix}SZ" type="number" step=".05"></div>
    <div class="g2" style="margin-top:5px"><div><label>Emission color</label><input id="${prefix}Color" type="color"></div><div><label>Emission intensity</label><input id="${prefix}Intensity" type="number" min="0" step=".1"></div></div>
    <div class="g2" style="margin-top:5px"><div><label>Particle rate ×</label><input id="${prefix}Particles" type="number" min="0" step=".1"></div><div><label>Opacity</label><input id="${prefix}Opacity" type="number" min="0" max="1" step=".05"></div></div>
  </fieldset>`;
  section.innerHTML = `<div class="sect-head"><b>Puzzle Furniture</b><span class="sect-tag">OFF ⇄ ON</span></div>
    <p class="muted">Choose OFF or ON, then tap any furniture piece to move, rotate, or scale that piece in the selected state. The state buttons initially select the whole furniture root.</p>
    <div class="g2"><button id="puzzleEditOff" type="button">Edit OFF</button><button id="puzzleEditOn" type="button">Edit ON</button></div>
    <div class="g2" style="margin-top:6px"><button id="puzzlePlay" type="button" class="ok">Play OFF → ON</button><button id="puzzleExitPreview" type="button">Exit state preview</button></div>
    <label style="margin-top:6px">Preview progress</label><input id="puzzlePreviewProgress" type="range" min="0" max="1" step=".001" value="0">
    <div id="puzzlePreviewStatus" class="pill">Base furniture transform · collision n/a</div>
    <div class="g2"><div><label>Role</label><select id="puzzleRole"><option value="none">Ordinary furniture</option><option value="activator">Activator</option><option value="mechanism">Mechanism</option></select></div><div><label>Behavior preset</label><select id="puzzleBehavior"></select></div></div>
    <div class="g2" style="margin-top:6px"><div><label>Default channel</label><input id="puzzleChannel" value="A"></div><div><label>Interaction range</label><input id="puzzleRange" type="number" min=".25" step=".05"></div></div>
    <div style="margin-top:6px"><label>Generic action prompt</label><input id="puzzlePrompt" placeholder="Activate"></div>
    <div class="g2" style="margin-top:6px"><div><label>Turn ON prompt</label><input id="puzzleOnPrompt" placeholder="Open"></div><div><label>Turn OFF prompt</label><input id="puzzleOffPrompt" placeholder="Close"></div></div>
    <label class="chk" style="margin-top:6px"><input id="puzzleStartsActive" type="checkbox"> Starts ON</label>
    <label class="chk"><input id="puzzleDirect" type="checkbox"> Furniture itself can be toggled (simple door/light)</label>
    <label class="chk"><input id="puzzleBlocks" type="checkbox"> Blocks its occupied tiles while OFF</label>
    <div class="g2" style="margin-top:6px"><div><label>Lerp duration seconds</label><input id="puzzleDuration" type="number" min=".05" step=".05"></div><div><label>Collision opens at progress</label><input id="puzzleCollision" type="number" min="0" max="1" step=".05"></div></div>
    ${transformFields('puzzleOff', 'OFF')}${transformFields('puzzleOn', 'ON')}`;
  host.appendChild(section);

  const el = id => document.getElementById(id);
  const vectorIds = ['PX','PY','PZ','RX','RY','RZ','SX','SY','SZ'];
  const preview = window.FurniturePuzzleAuthorPreview = { editState:null, selectedPartId:null, progress:0, playing:false, animationRevision:0, particleRateScale:1 }; // Used by per-piece gizmo authoring, mobile diagnostics, and the editor particle loop.
  const materialBaselines = new WeakMap(); // Restores authored material values when state preview is exited.
  const identityTransitionState = particleRateScale => ({
    position:{ x:0, y:0, z:0 }, rotation:{ x:0, y:0, z:0 }, scale:{ x:1, y:1, z:1 },
    emission:{ color:'#000000', intensity:0, particleRateScale, opacity:1 },
  });
  function defaultPuzzle(role = 'mechanism') {
    return api.normalizePuzzle({
      role, behavior:(role === 'activator' ? api.ACTIVATORS : api.MECHANISMS)[0], channel:'A', interactionRange:1.65,
      motion:{ off:identityTransitionState(0), on:identityTransitionState(1), parts:{}, durationSeconds:.8, collisionOpenProgress:.55 },
    });
  }
  function behaviorOptions(role) {
    const values = role === 'activator' ? api.ACTIVATORS : role === 'mechanism' ? api.MECHANISMS : [];
    el('puzzleBehavior').innerHTML = values.map(value => `<option value="${value}">${value}</option>`).join('');
  }
  function writeState(prefix, value) {
    const values = [value.position.x,value.position.y,value.position.z,value.rotation.x,value.rotation.y,value.rotation.z,value.scale.x,value.scale.y,value.scale.z];
    vectorIds.forEach((suffix, index) => { el(prefix + suffix).value = values[index]; });
    el(prefix + 'Color').value = value.emission.color; el(prefix + 'Intensity').value = value.emission.intensity;
    el(prefix + 'Particles').value = value.emission.particleRateScale; el(prefix + 'Opacity').value = value.emission.opacity;
  }
  function readState(prefix) {
    const n = (suffix, fallback=0) => { const raw=el(prefix + suffix).value; return raw === '' ? fallback : Number(raw); };
    return { position:{ x:n('PX'), y:n('PY'), z:n('PZ') }, rotation:{ x:n('RX'), y:n('RY'), z:n('RZ') }, scale:{ x:n('SX',1), y:n('SY',1), z:n('SZ',1) }, emission:{ color:el(prefix + 'Color').value||'#000000', intensity:n('Intensity'), particleRateScale:n('Particles'), opacity:n('Opacity',1) } };
  }
  function captureMaterial(material) {
    if (!materialBaselines.has(material)) materialBaselines.set(material, { opacity:Number(material.opacity ?? 1), transparent:!!material.transparent, emissive:material.emissive?.clone?.() || null, emissiveIntensity:Number(material.emissiveIntensity ?? 1) });
    return materialBaselines.get(material);
  }
  function restoreAppearance() {
    root.traverse(child => { for (const material of (Array.isArray(child.material) ? child.material : [child.material]).filter(Boolean)) { const base = materialBaselines.get(material); if (!base) continue; material.opacity=base.opacity; material.transparent=base.transparent; if (base.emissive && material.emissive) material.emissive.copy(base.emissive); if ('emissiveIntensity' in material) material.emissiveIntensity=base.emissiveIntensity; material.needsUpdate=true; } });
    preview.particleRateScale=1;
  }
  function basePartTransform(part) {
    const t=part?.transform||{};return{x:Number(t.x)||0,y:Number(t.y)||0,z:Number(t.z)||0,rx:Number(t.rx)||0,ry:Number(t.ry)||0,rz:Number(t.rz)||0,sx:Math.max(.001,Number(t.sx)||.001),sy:Math.max(.001,Number(t.sy)||.001),sz:Math.max(.001,Number(t.sz)||.001)};
  }
  function partState(part, name) {
    const base=basePartTransform(part), authored=api.normalizePuzzle(state.puzzle)?.motion?.parts?.[part.id]?.[name];return authored?api.partTransform(authored,base):base;
  }
  function interpolateState(progress) {
    const puzzle=api.normalizePuzzle(state.puzzle), t=Math.max(0,Math.min(1,Number(progress)||0));
    if (!puzzle) return null;
    const a=puzzle.motion.off,b=puzzle.motion.on,lerp=(x,y)=>THREE.MathUtils.lerp(Number(x)||0,Number(y)||0,t);
    return { position:{x:lerp(a.position.x,b.position.x),y:lerp(a.position.y,b.position.y),z:lerp(a.position.z,b.position.z)}, rotation:{x:lerp(a.rotation.x,b.rotation.x),y:lerp(a.rotation.y,b.rotation.y),z:lerp(a.rotation.z,b.rotation.z)}, scale:{x:lerp(a.scale.x,b.scale.x),y:lerp(a.scale.y,b.scale.y),z:lerp(a.scale.z,b.scale.z)}, emission:{color:'#000000',intensity:lerp(a.emission.intensity,b.emission.intensity),particleRateScale:lerp(a.emission.particleRateScale,b.emission.particleRateScale),opacity:lerp(a.emission.opacity,b.emission.opacity),colorValue:new THREE.Color(a.emission.color).lerp(new THREE.Color(b.emission.color),t)} };
  }
  function updatePreviewStatus() {
    const puzzle=api.normalizePuzzle(state.puzzle), blocked=!!(puzzle?.blocksMovement && preview.progress < puzzle.motion.collisionOpenProgress), selected=preview.selectedPartId?state.parts.find(part=>part.id===preview.selectedPartId)?.name||preview.selectedPartId:'whole furniture', mode=preview.playing?'playing':preview.editState?`editing ${preview.editState.toUpperCase()} · ${selected}`:'scrubbing';
    el('puzzlePreviewStatus').textContent=puzzle?`${mode} · ${(preview.progress*100).toFixed(0)}% · collision ${blocked?'BLOCKED':'open'} · particles ×${preview.particleRateScale.toFixed(2)}`:'Ordinary furniture · no transition';
    el('puzzleEditOff').classList.toggle('active',preview.editState==='off'&&!preview.playing); el('puzzleEditOn').classList.toggle('active',preview.editState==='on'&&!preview.playing);
  }
  function applyPreview(progress,{attach=false}={}) {
    const value=interpolateState(progress); if(!value)return;
    preview.progress=Math.max(0,Math.min(1,Number(progress)||0)); el('puzzlePreviewProgress').value=preview.progress;
    root.position.set(value.position.x,value.position.y,value.position.z); root.rotation.set(value.rotation.x*DEG,value.rotation.y*DEG,value.rotation.z*DEG,'XYZ'); root.scale.set(Math.max(.001,value.scale.x),Math.max(.001,value.scale.y),Math.max(.001,value.scale.z)); root.updateMatrixWorld(true);
    const puzzle=api.normalizePuzzle(state.puzzle), t=preview.progress;
    for(const part of state.parts){const mesh=meshes.get(part.id);if(!mesh)continue;const a=partState(part,'off'),b=partState(part,'on'),base=basePartTransform(part),lerp=(x,y)=>THREE.MathUtils.lerp(Number(x)||0,Number(y)||0,t);mesh.position.set(lerp(a.x,b.x),lerp(a.y,b.y),lerp(a.z,b.z));mesh.rotation.set(lerp(a.rx,b.rx)*DEG,lerp(a.ry,b.ry)*DEG,lerp(a.rz,b.rz)*DEG,'XYZ');mesh.scale.set(lerp(a.sx,b.sx)/base.sx,lerp(a.sy,b.sy)/base.sy,lerp(a.sz,b.sz)/base.sz);mesh.updateMatrixWorld(true);}
    root.traverse(child => { for (const material of (Array.isArray(child.material) ? child.material : [child.material]).filter(Boolean)) { const base=captureMaterial(material); material.opacity=base.opacity*value.emission.opacity; material.transparent=base.transparent||value.emission.opacity<.999; if(material.emissive)material.emissive.copy(value.emission.colorValue); if('emissiveIntensity' in material)material.emissiveIntensity=value.emission.intensity; material.needsUpdate=true; } });
    preview.particleRateScale=value.emission.particleRateScale;
    if(attach){const target=preview.selectedPartId?meshes.get(preview.selectedPartId):root;if(target)transform.attach(target);transform.setSpace?.('world');transform.showX=true;transform.showY=true;transform.showZ=true;}
    updatePreviewStatus();
  }
  function editTransitionState(name) {
    if(!state.puzzle){log('Choose Activator or Mechanism before editing transition states.','warn');return;}
    preview.animationRevision++;preview.playing=false;preview.editState=name;preview.selectedPartId=null;state.selectedType='puzzleTransition';state.selectedId=name;applyPreview(name==='on'?1:0,{attach:true});log(`Editing puzzle ${name.toUpperCase()} state. Tap a piece to animate it independently, or use the current root gizmo for the whole furniture.`);
  }
  function exitPreview({quiet=false}={}) {
    preview.animationRevision++;preview.playing=false;preview.editState=null;preview.selectedPartId=null;preview.progress=0;transform.detach();root.position.set(0,0,0);root.rotation.set(0,0,0);root.scale.set(1,1,1);for(const part of state.parts){const mesh=meshes.get(part.id),base=basePartTransform(part);if(!mesh)continue;mesh.position.set(base.x,base.y,base.z);mesh.rotation.set(base.rx*DEG,base.ry*DEG,base.rz*DEG,'XYZ');mesh.scale.set(1,1,1);}root.updateMatrixWorld(true);restoreAppearance();if(state.selectedType==='puzzleTransition'){state.selectedType=null;state.selectedId=null;}el('puzzlePreviewProgress').value=0;updatePreviewStatus();if(!quiet)log('Exited puzzle state preview; restored every piece to its base authored transform.');
  }
  function syncEditedTransitionTarget() {
    if(state.selectedType!=='puzzleTransition'||!preview.editState||preview.playing)return;
    const puzzle=api.normalizePuzzle(state.puzzle);if(!puzzle)return;const target=puzzle.motion[preview.editState];if(!target)return;
    if(transform.object===root){target.position={x:+root.position.x.toFixed(4),y:+root.position.y.toFixed(4),z:+root.position.z.toFixed(4)};target.rotation={x:+(root.rotation.x*RAD).toFixed(3),y:+(root.rotation.y*RAD).toFixed(3),z:+(root.rotation.z*RAD).toFixed(3)};target.scale={x:+Math.max(.001,root.scale.x).toFixed(4),y:+Math.max(.001,root.scale.y).toFixed(4),z:+Math.max(.001,root.scale.z).toFixed(4)};writeState(preview.editState==='on'?'puzzleOn':'puzzleOff',target);}
    else if(preview.selectedPartId&&transform.object===meshes.get(preview.selectedPartId)){const part=state.parts.find(candidate=>candidate.id===preview.selectedPartId),mesh=transform.object,base=basePartTransform(part);puzzle.motion.parts[part.id]||={off:{...base},on:{...base}};puzzle.motion.parts[part.id][preview.editState]={x:+mesh.position.x.toFixed(4),y:+mesh.position.y.toFixed(4),z:+mesh.position.z.toFixed(4),rx:+(mesh.rotation.x*RAD).toFixed(3),ry:+(mesh.rotation.y*RAD).toFixed(3),rz:+(mesh.rotation.z*RAD).toFixed(3),sx:+Math.max(.001,base.sx*mesh.scale.x).toFixed(4),sy:+Math.max(.001,base.sy*mesh.scale.y).toFixed(4),sz:+Math.max(.001,base.sz*mesh.scale.z).toFixed(4)};}
    state.puzzle=api.normalizePuzzle(puzzle);preview.progress=preview.editState==='on'?1:0;updatePreviewStatus();
  }
  function playTransition() {
    const puzzle=api.normalizePuzzle(state.puzzle);if(!puzzle){log('Choose Activator or Mechanism before previewing a transition.','warn');return;}
    const revision=++preview.animationRevision,start=performance.now(),duration=Math.max(50,puzzle.motion.durationSeconds*1000);preview.playing=true;preview.editState=null;state.selectedType='puzzleTransition';state.selectedId='preview';transform.detach();
    function frame(now){if(revision!==preview.animationRevision)return;const linear=Math.min(1,(now-start)/duration),smooth=linear*linear*(3-2*linear);applyPreview(smooth);if(linear<1)requestAnimationFrame(frame);else{preview.playing=false;preview.editState='on';state.selectedId='on';applyPreview(1,{attach:true});log('Puzzle transition preview finished at ON.');}}
    requestAnimationFrame(frame);
  }
  function render() {
    const puzzle = api.normalizePuzzle(state.puzzle);
    const displayed = puzzle || defaultPuzzle('mechanism');
    el('puzzleRole').value = puzzle?.role || 'none'; behaviorOptions(puzzle?.role || 'none');
    if (puzzle) el('puzzleBehavior').value = puzzle.behavior;
    el('puzzleChannel').value = displayed.channel; el('puzzleRange').value = displayed.interactionRange;
    el('puzzlePrompt').value = displayed.prompt; el('puzzleOnPrompt').value = displayed.onPrompt; el('puzzleOffPrompt').value = displayed.offPrompt;
    el('puzzleStartsActive').checked = displayed.startsActive; el('puzzleDirect').checked = displayed.directInteraction; el('puzzleBlocks').checked = displayed.blocksMovement;
    el('puzzleDuration').value = displayed.motion.durationSeconds; el('puzzleCollision').value = displayed.motion.collisionOpenProgress;
    writeState('puzzleOff', displayed.motion.off); writeState('puzzleOn', displayed.motion.on);
    section.querySelectorAll('input,select').forEach(input => { if (input.id !== 'puzzleRole') input.disabled = !puzzle; });
    for(const id of ['puzzleEditOff','puzzleEditOn','puzzlePlay'])el(id).disabled=!puzzle;
    updatePreviewStatus();
  }
  function read() {
    const role = el('puzzleRole').value;
    state.puzzle = api.normalizePuzzle(role === 'none' ? null : {
      role, behavior:el('puzzleBehavior').value, channel:el('puzzleChannel').value, interactionRange:el('puzzleRange').value,
      prompt:el('puzzlePrompt').value, onPrompt:el('puzzleOnPrompt').value, offPrompt:el('puzzleOffPrompt').value,
      startsActive:el('puzzleStartsActive').checked, directInteraction:el('puzzleDirect').checked, blocksMovement:el('puzzleBlocks').checked,
      motion:{ off:readState('puzzleOff'), on:readState('puzzleOn'), parts:state.puzzle?.motion?.parts||{}, durationSeconds:el('puzzleDuration').value, collisionOpenProgress:el('puzzleCollision').value },
    });
    if(!state.puzzle&&state.selectedType==='puzzleTransition')exitPreview({quiet:true});
    render();
    if(preview.editState)applyPreview(preview.editState==='on'?1:0,{attach:true});
    if (typeof queueUndoHistory === 'function') queueUndoHistory('puzzle furniture transition');
  }
  section.addEventListener('change', event => {
    if(event.target.id==='puzzlePreviewProgress')return;
    if(event.target.id==='puzzleRole') {
      state.puzzle=event.target.value==='none'?null:defaultPuzzle(event.target.value);
      render();
      if(typeof queueUndoHistory==='function')queueUndoHistory('puzzle furniture role');
      return;
    }
    read();
  });
  el('puzzleEditOff').onclick=()=>editTransitionState('off');el('puzzleEditOn').onclick=()=>editTransitionState('on');el('puzzlePlay').onclick=playTransition;el('puzzleExitPreview').onclick=()=>exitPreview();
  el('puzzlePreviewProgress').addEventListener('input',event=>{preview.animationRevision++;preview.playing=false;preview.editState=null;state.selectedType='puzzleTransition';state.selectedId='preview';transform.detach();applyPreview(event.target.value);});
  transform.addEventListener?.('objectChange',syncEditedTransitionTarget);

  const originalSelectObject = selectObject;
  selectObject = function selectObjectOutsidePuzzlePreview(type,id,...args) { if(state.selectedType==='puzzleTransition'&&preview.editState&&type==='part'){const mesh=meshes.get(id);if(!mesh)return;preview.selectedPartId=id;state.selectedId=id;transform.attach(mesh);transform.setSpace?.('world');updatePreviewStatus();log(`Editing ${state.parts.find(part=>part.id===id)?.name||id} in puzzle ${preview.editState.toUpperCase()} state.`);return;}if(state.selectedType==='puzzleTransition')exitPreview({quiet:true});return originalSelectObject(type,id,...args); };

  const originalExportData = exportData;
  exportData = function exportFurnitureWithPuzzle() { const data = originalExportData(); if (state.puzzle) data.puzzle = api.normalizePuzzle(state.puzzle); return data; };
  const originalLoadData = loadData;
  loadData = function loadFurnitureWithPuzzle(data) { exitPreview({quiet:true});originalLoadData(data); state.puzzle = api.normalizePuzzle(data?.puzzle); render(); };
  const originalImportRepoFurniture = importRepoFurniture;
  importRepoFurniture = async function importRepositoryFurnitureWithPuzzle(...args) {
    const entry=repoFurnitureEntries.find(candidate=>candidate.id===selectedRepoFurnitureId),before=new Set(state.parts.map(part=>part.id)),out=await originalImportRepoFurniture(...args);
    if(entry?.type==='json')try{const response=await fetch(REPO_RAW_ROOT+entry.path);if(response.ok){const data=await response.json();if(data?.puzzle&&Array.isArray(data.parts)){const added=state.parts.filter(part=>!before.has(part.id)),idMap=new Map(data.parts.map((part,index)=>[part.id,added[index]?.id]).filter(pair=>pair[1])),puzzle=api.normalizePuzzle(data.puzzle),remapped={};for(const [oldId,states] of Object.entries(puzzle?.motion?.parts||{})){const newId=idMap.get(oldId);if(newId)remapped[newId]=states;}if(puzzle){puzzle.motion.parts=remapped;state.puzzle=api.normalizePuzzle(puzzle);render();log(`Imported ${Object.keys(remapped).length} per-piece OFF/ON transition${Object.keys(remapped).length===1?'':'s'} from ${entry.path}.`);}}}}catch(error){log(`Puzzle transition metadata import failed: ${error.message}`,'warn');}
    return out;
  };
  // setupEvents captured the original function object before this sidecar loaded.
  // Resolve the current wrapper at click time so repository puzzle metadata is not skipped.
  el('importRepoFurnitureBtn').onclick = () => importRepoFurniture();
  render();
})();

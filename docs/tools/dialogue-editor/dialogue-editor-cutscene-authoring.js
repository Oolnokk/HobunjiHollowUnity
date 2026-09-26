'use strict';

let cutsceneCameraRegistry = []; // Locale-authored cinematic cameras loaded for node camera selection and validation in the Dialogue Editor.
let cutsceneLocaleSource = 'unloaded'; // Human-readable source shown beside the camera picker so local-vs-repo authoring is obvious.

const DEFAULT_BANUBU_SPARKLE_EMITTER = Object.freeze({
  id:'banubu_key_sparkles',name:'Banubu Key Sparkles',type:'sparkle',enabled:true,
  position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},
  radius:0.62,size:0.075,rate:30,lifetime:0.8,speed:0.42,spread:0.78,gravity:0.08,
  colorA:'#fff7c2',colorB:'#bfe9ff',
}); // Exact historical key-sparkle recipe used to populate a newly-authored Start cue instead of hiding defaults in runtime code.

async function loadCutsceneCameraRegistry(){
  try{
    const override=window.LocalDBOverrides?.getOverride?.('locales'); // Local Locale Editor output overlays matching repo locales so unsaved camera edits are available without hiding cameras from locales not loaded into that workspace.
    const localLocales=Array.isArray(override)?override:override?.locales;
    let repoLocales=[]; // Repository baseline remains available even when the Locale Editor saved only a partial workspace override.
    try{
      const indexResponse=await fetch('../../config/locales/index.json');
      if(!indexResponse.ok)throw new Error(`locale index HTTP ${indexResponse.status}`);
      const index=await indexResponse.json();
      repoLocales=(await Promise.all((index.locales||[]).map(async entry=>{
        try{
          const response=await fetch('../../'+entry.file);
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          return await response.json();
        }catch{return null}
      }))).filter(Boolean);
    }catch(error){
      if(!(Array.isArray(localLocales)&&localLocales.length))throw error;
    }
    const localesById=new Map(repoLocales.map(locale=>[locale.id,locale])); // Locale id is the stable overlay key shared by repo and Locale Editor workspace exports.
    for(const locale of Array.isArray(localLocales)?localLocales:[])if(locale?.id)localesById.set(locale.id,locale);
    const locales=[...localesById.values()]; // Merged registry lets Dialogue Editor see both committed cameras and current local camera edits.
    cutsceneLocaleSource=(Array.isArray(localLocales)&&localLocales.length)?'repository + Locale Editor local override':'repository locales';
    cutsceneCameraRegistry=locales.flatMap(locale=>(locale.cinematicCameras||[]).map(camera=>({
      localeId:locale.id,
      localeName:locale.name||locale.id,
      mapId:locale.cavern?.mapId||'',
      cameraId:String(camera.id||''),
      label:camera.label||camera.id||'camera',
      targetNpcId:camera.targetNpcId||'',
      dialogueNpcId:camera.dialogueNpcId||'',
    }))).filter(entry=>entry.cameraId); // Compact registry is all the node editor needs; full transforms remain owned by Locale Editor.
    if(state?.nodeEditorOpen)renderNodeEditor();
    logEvent?.('Loaded cinematic camera registry',{source:cutsceneLocaleSource,cameras:cutsceneCameraRegistry.length});
  }catch(error){
    cutsceneCameraRegistry=[];
    cutsceneLocaleSource='camera registry unavailable';
    captureError?.('Cinematic camera registry load failed',error);
  }
}

function cutsceneCameraEntriesForNpc(npcId){
  const id=String(npcId||''); // Current NPC id used to put likely matching cameras first without hiding shared/world cameras.
  return [...cutsceneCameraRegistry].sort((a,b)=>{
    const aMatch=a.dialogueNpcId===id||a.targetNpcId===id?0:1;
    const bMatch=b.dialogueNpcId===id||b.targetNpcId===id?0:1;
    return aMatch-bMatch||String(a.localeName).localeCompare(String(b.localeName))||String(a.label).localeCompare(String(b.label));
  });
}

function banubuSparkleState(node){
  const raw=node?.banubuPresentation?.sparkles; // Existing legacy string or authored object converted into one editor-friendly shape.
  if(typeof raw==='string')return{action:raw,anchor:'root',maxParticles:48,emitter:{...DEFAULT_BANUBU_SPARKLE_EMITTER,position:{...DEFAULT_BANUBU_SPARKLE_EMITTER.position},rotation:{...DEFAULT_BANUBU_SPARKLE_EMITTER.rotation}}};
  if(raw&&typeof raw==='object')return{
    action:raw.action||'',
    anchor:raw.anchor||'root',
    maxParticles:Number(raw.maxParticles)||48,
    emitter:{
      ...DEFAULT_BANUBU_SPARKLE_EMITTER,
      ...(raw.emitter||{}),
      position:{...DEFAULT_BANUBU_SPARKLE_EMITTER.position,...(raw.emitter?.position||{})},
      rotation:{...DEFAULT_BANUBU_SPARKLE_EMITTER.rotation,...(raw.emitter?.rotation||{})},
    },
  };
  return{action:'',anchor:'root',maxParticles:48,emitter:{...DEFAULT_BANUBU_SPARKLE_EMITTER,position:{...DEFAULT_BANUBU_SPARKLE_EMITTER.position},rotation:{...DEFAULT_BANUBU_SPARKLE_EMITTER.rotation}}};
}

function appendCutsceneNodeEditor(tree,node){
  const body=$('nodeEditorBody');
  if(!body||!node)return;
  body.querySelector('#cutsceneNodeSection')?.remove();
  const npc=currentNpc();
  const cameras=cutsceneCameraEntriesForNpc(npc?.id);
  const currentCamera=String(node.cameraId||'');
  const presentation=node.banubuPresentation&&typeof node.banubuPresentation==='object'?node.banubuPresentation:{};
  const move=presentation.move&&typeof presentation.move==='object'?presentation.move:null; // Relative Banubu movement cue authored on this node; absent means the node leaves his position alone.
  const sparkle=banubuSparkleState(node);
  const emitter=sparkle.emitter;
  const section=document.createElement('div'); // Appended after the normal node controls so cutscene authoring works for text, choice, sequence, and end nodes alike.
  section.id='cutsceneNodeSection';
  section.className='editField full editorSection';
  section.innerHTML=`
    <label>Cutscene presentation</label>
    <div class="editorNote">Camera ids come from Locale Editor. Save a Locales local override there, then use Refresh cameras here to author both sides without committing first.</div>
    <datalist id="cutsceneCameraIds">${cameras.map(entry=>`<option value="${esc(entry.cameraId)}">${esc(entry.localeName)} — ${esc(entry.label)}</option>`).join('')}</datalist>
    <div class="fieldGrid" style="margin-top:6px">
      <div><label for="editCutsceneCamera">Camera id</label><input id="editCutsceneCamera" list="cutsceneCameraIds" value="${esc(currentCamera)}" placeholder="blank = keep current dialogue camera"></div>
      <div style="align-self:end"><button class="secondary" id="refreshCutsceneCameras" type="button">Refresh cameras</button><div class="editorNote">${esc(cutsceneLocaleSource)} · ${cameras.length} camera(s)</div></div>
    </div>
    ${npc?.id==='banubu'?`
      <div style="margin-top:9px;padding-top:7px;border-top:1px solid var(--border)">
        <label>Banubu body / neck</label>
        <div class="fieldGrid">
          <div><label for="editBanubuBodyCue">Body state</label><select id="editBanubuBodyCue"><option value="">— unchanged —</option><option value="awake"${presentation.body==='awake'?' selected':''}>awake</option><option value="sleep"${presentation.body==='sleep'?' selected':''}>sleep</option></select></div>
          <div><label for="editBanubuNeckCue">Neck pose</label><select id="editBanubuNeckCue"><option value="">— unchanged —</option><option value="max_down"${presentation.neck==='max_down'?' selected':''}>maximum down</option><option value="release"${presentation.neck==='release'?' selected':''}>release override</option></select></div>
        </div>
      </div>
      <div style="margin-top:9px;padding-top:7px;border-top:1px solid var(--border)">
        <label>Banubu movement / quest commit</label>
        <div class="editorNote">Movement is relative to Banubu's position when this dialogue begins. Use X=0, Z=0 to ease him back to that origin. A commit stage belongs on the final end node so cancelling earlier remains transactional.</div>
        <div class="fieldGrid">
          <label class="checkRow"><input id="editBanubuMoveEnabled" type="checkbox"${move?' checked':''}><span>Apply movement cue</span></label>
          <div><label for="editBanubuMoveX">Relative X</label><input id="editBanubuMoveX" type="number" step=".05" value="${Number(move?.x)||0}"></div>
          <div><label for="editBanubuMoveZ">Relative Z</label><input id="editBanubuMoveZ" type="number" step=".05" value="${Number(move?.z)||0}"></div>
          <div><label for="editBanubuMoveDuration">Duration sec</label><input id="editBanubuMoveDuration" type="number" min=".05" step=".05" value="${Math.max(.05,Number(move?.duration)||.7)}"></div>
          <div><label for="editBanubuCommitTurnIn">Commit turn-in stage</label><select id="editBanubuCommitTurnIn"><option value="0"${!Number(presentation.commitTurnIn)?' selected':''}>— none —</option><option value="1"${Number(presentation.commitTurnIn)===1?' selected':''}>Quest 1</option><option value="2"${Number(presentation.commitTurnIn)===2?' selected':''}>Quest 2</option></select></div>
        </div>
      </div>
      <div style="margin-top:9px;padding-top:7px;border-top:1px solid var(--border)">
        <label>Banubu sparkle emitter</label>
        <div class="fieldGrid">
          <div><label for="editBanubuSparkleAction">Action</label><select id="editBanubuSparkleAction"><option value="">— unchanged —</option><option value="start"${sparkle.action==='start'?' selected':''}>start / replace emitter</option><option value="stop"${sparkle.action==='stop'?' selected':''}>stop emitter</option></select></div>
          <div><label for="editBanubuSparkleAnchor">Attach to</label><select id="editBanubuSparkleAnchor"><option value="root"${sparkle.anchor==='root'?' selected':''}>Banubu root</option><option value="world"${sparkle.anchor==='world'?' selected':''}>Fixed reveal spot</option></select></div>
          <div><label for="editBanubuSparkleMax">Max particles</label><input id="editBanubuSparkleMax" type="number" min="1" max="512" step="1" value="${Number(sparkle.maxParticles)||48}"></div>
        </div>
        <div id="banubuSparkleEmitterFields" style="${sparkle.action==='start'?'':'display:none'}">
          <div class="fieldGrid" style="margin-top:6px">
            <div><label>Emitter id</label><input id="editSparkId" value="${esc(emitter.id)}"></div>
            <div><label>Name</label><input id="editSparkName" value="${esc(emitter.name)}"></div>
            <div><label>Type</label><input id="editSparkType" value="${esc(emitter.type)}"></div>
            <label class="checkRow"><input id="editSparkEnabled" type="checkbox"${emitter.enabled!==false?' checked':''}><span>Enabled</span></label>
          </div>
          <div class="fieldGrid" style="margin-top:6px">
            <div><label>Position X</label><input id="editSparkPX" type="number" step=".01" value="${Number(emitter.position?.x)||0}"></div>
            <div><label>Position Y</label><input id="editSparkPY" type="number" step=".01" value="${Number(emitter.position?.y)||0}"></div>
            <div><label>Position Z</label><input id="editSparkPZ" type="number" step=".01" value="${Number(emitter.position?.z)||0}"></div>
            <div><label>Rotation X</label><input id="editSparkRX" type="number" step=".01" value="${Number(emitter.rotation?.x)||0}"></div>
            <div><label>Rotation Y</label><input id="editSparkRY" type="number" step=".01" value="${Number(emitter.rotation?.y)||0}"></div>
            <div><label>Rotation Z</label><input id="editSparkRZ" type="number" step=".01" value="${Number(emitter.rotation?.z)||0}"></div>
          </div>
          <div class="fieldGrid" style="margin-top:6px">
            <div><label>Radius</label><input id="editSparkRadius" type="number" min="0" step=".01" value="${Number(emitter.radius)||0}"></div>
            <div><label>Particle size</label><input id="editSparkSize" type="number" min="0" step=".005" value="${Number(emitter.size)||0}"></div>
            <div><label>Rate / sec</label><input id="editSparkRate" type="number" min="0" step="1" value="${Number(emitter.rate)||0}"></div>
            <div><label>Lifetime sec</label><input id="editSparkLifetime" type="number" min="0" step=".05" value="${Number(emitter.lifetime)||0}"></div>
            <div><label>Speed</label><input id="editSparkSpeed" type="number" step=".01" value="${Number(emitter.speed)||0}"></div>
            <div><label>Spread</label><input id="editSparkSpread" type="number" step=".01" value="${Number(emitter.spread)||0}"></div>
            <div><label>Gravity</label><input id="editSparkGravity" type="number" step=".01" value="${Number(emitter.gravity)||0}"></div>
            <div><label>Color A</label><input id="editSparkColorA" type="text" value="${esc(emitter.colorA)}"></div>
            <div><label>Color B</label><input id="editSparkColorB" type="text" value="${esc(emitter.colorB)}"></div>
          </div>
        </div>
      </div>
    `:''}
  `;
  body.appendChild(section);

  $('editCutsceneCamera').addEventListener('change',event=>commitMutation('Changed node cinematic camera',()=>{
    const value=event.target.value.trim();
    if(value)node.cameraId=value;else delete node.cameraId;
  },{render:'graph'}));
  $('refreshCutsceneCameras').addEventListener('click',()=>loadCutsceneCameraRegistry());

  if(npc?.id!=='banubu')return;
  const ensurePresentation=()=>node.banubuPresentation||(node.banubuPresentation={}); // Created lazily so ordinary nodes remain free of empty Banubu metadata.
  const cleanPresentation=()=>{if(node.banubuPresentation&&!Object.keys(node.banubuPresentation).length)delete node.banubuPresentation};

  $('editBanubuBodyCue').addEventListener('change',event=>commitMutation('Changed Banubu body cue',()=>{
    const cue=ensurePresentation(),value=event.target.value;
    if(value)cue.body=value;else delete cue.body;
    cleanPresentation();
  },{render:'graph'}));
  $('editBanubuNeckCue').addEventListener('change',event=>commitMutation('Changed Banubu neck cue',()=>{
    const cue=ensurePresentation(),value=event.target.value;
    if(value)cue.neck=value;else delete cue.neck;
    cleanPresentation();
  },{render:'graph'}));

  const readNumber=(id,fallback=0)=>{const value=Number($(id)?.value);return Number.isFinite(value)?value:fallback}; // Shared numeric reader keeps malformed mobile input from leaking NaN into exported dialogue JSON.
  function commitMoveCue(label){
    commitMutation(label,()=>{
      const cue=ensurePresentation();
      if(!$('editBanubuMoveEnabled').checked)delete cue.move;
      else cue.move={x:readNumber('editBanubuMoveX'),z:readNumber('editBanubuMoveZ'),duration:Math.max(.05,readNumber('editBanubuMoveDuration',.7))};
      cleanPresentation();
    },{render:'none',coalesceKey:`banubu-move:${node.id}`,log:false});
  }
  $('editBanubuMoveEnabled').addEventListener('change',()=>{commitMoveCue('Changed Banubu movement cue');renderGraph()});
  for(const id of ['editBanubuMoveX','editBanubuMoveZ','editBanubuMoveDuration']){
    $(id).addEventListener('input',()=>commitMoveCue('Edited Banubu movement cue'));
    $(id).addEventListener('blur',()=>renderGraph());
  }
  $('editBanubuCommitTurnIn').addEventListener('change',event=>commitMutation('Changed Banubu turn-in commit cue',()=>{
    const cue=ensurePresentation(),stage=Math.max(0,Math.min(2,Number(event.target.value)||0));
    if(stage)cue.commitTurnIn=stage;else delete cue.commitTurnIn;
    cleanPresentation();
  },{render:'graph'})); // Shared numeric reader keeps malformed mobile input from leaking NaN into exported dialogue JSON.
  const authoredEmitter=()=>({
    id:$('editSparkId').value.trim()||'banubu_key_sparkles',
    name:$('editSparkName').value.trim()||'Banubu Key Sparkles',
    type:$('editSparkType').value.trim()||'sparkle',
    enabled:$('editSparkEnabled').checked,
    position:{x:readNumber('editSparkPX'),y:readNumber('editSparkPY'),z:readNumber('editSparkPZ')},
    rotation:{x:readNumber('editSparkRX'),y:readNumber('editSparkRY'),z:readNumber('editSparkRZ')},
    radius:Math.max(0,readNumber('editSparkRadius',0.62)),
    size:Math.max(0,readNumber('editSparkSize',0.075)),
    rate:Math.max(0,readNumber('editSparkRate',30)),
    lifetime:Math.max(0,readNumber('editSparkLifetime',0.8)),
    speed:readNumber('editSparkSpeed',0.42),
    spread:readNumber('editSparkSpread',0.78),
    gravity:readNumber('editSparkGravity',0.08),
    colorA:$('editSparkColorA').value.trim()||'#fff7c2',
    colorB:$('editSparkColorB').value.trim()||'#bfe9ff',
  });

  function commitSparkleCue(label){
    commitMutation(label,()=>{
      const action=$('editBanubuSparkleAction').value;
      const cue=ensurePresentation();
      if(!action)delete cue.sparkles;
      else if(action==='stop')cue.sparkles='stop';
      else cue.sparkles={action:'start',anchor:$('editBanubuSparkleAnchor').value||'root',maxParticles:Math.max(1,Math.min(512,Math.round(readNumber('editBanubuSparkleMax',48)))),emitter:authoredEmitter()};
      cleanPresentation();
    },{render:'none',coalesceKey:`banubu-vfx:${node.id}`,log:false});
  }
  $('editBanubuSparkleAction').addEventListener('change',event=>{
    $('banubuSparkleEmitterFields').style.display=event.target.value==='start'?'':'none';
    commitSparkleCue('Changed Banubu sparkle action');
    renderGraph();
  });
  for(const id of ['editBanubuSparkleAnchor','editBanubuSparkleMax','editSparkId','editSparkName','editSparkType','editSparkEnabled','editSparkPX','editSparkPY','editSparkPZ','editSparkRX','editSparkRY','editSparkRZ','editSparkRadius','editSparkSize','editSparkRate','editSparkLifetime','editSparkSpeed','editSparkSpread','editSparkGravity','editSparkColorA','editSparkColorB']){
    const element=$(id);if(!element)continue;
    element.addEventListener(element.tagName==='SELECT'||element.type==='checkbox'?'change':'input',()=>commitSparkleCue('Edited Banubu sparkle emitter'));
    if(element.tagName!=='SELECT'&&element.type!=='checkbox')element.addEventListener('blur',()=>renderGraph());
  }
}

window.DialogueCutsceneAuthoring={
  renderNodeSection:appendCutsceneNodeEditor,
  refreshCameraRegistry:loadCutsceneCameraRegistry,
  cameraRegistry:()=>deepCopy(cutsceneCameraRegistry),
  source:()=>cutsceneLocaleSource,
};

loadCutsceneCameraRegistry();

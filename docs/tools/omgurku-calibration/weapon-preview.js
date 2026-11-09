// Preview existing combat data through the shared attack sampler and hand driver.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TOOLS = { // Sprite identities only; pose/grip/scale data stays in its gameplay owners.
    hatchet: ['Hatchet', 'axe_hatchet.png', 'sweep'],
    fishingspear: ['Fishing spear', 'harpoon_fishingspear.png', 'sweep'],
    plainsSword: ['Plains sword', 'plains-sword.png', 'sweep'],
    pickshovel: ['Pick-shovel', 'shovel_pickshovel.png', 'thrust'],
    bronzehoe: ['Bronze hoe', 'hoe_bronzehoe.png', 'chop'],
  };
  const state = { // One preview actor; the calibration scene owns its frame clock.
    THREE:null, model:null, holder:null, mesh:null, epoch:0, stances:null, values:null,
    actions:[], action:null, pose:null, sample:null, timing:{}, gripTiming:{},
    mode:'idle', toolKey:'hatchet', stance:'heavyWeapon', progress:0, playing:false,
    posePoint:null, poseOptions:null, error:null,
  };
  function say(message) {
    const node=$('weaponPreviewStatus'); // Mobile diagnostics do not require a console.
    if(node.textContent!==message)node.textContent=message;
  }
  function disposeMesh(mesh) {
    if(!mesh)return;
    mesh.parent?.remove(mesh);
    mesh.userData.toolPlane.geometry.dispose();
    mesh.userData.toolPlane.material.map?.dispose();
    mesh.userData.toolPlane.material.dispose();
  }
  async function loadWeapon() {
    const ticket=++state.epoch, THREE=state.THREE; // Reject late image loads after an avatar/weapon change.
    if(!THREE || !state.holder)return;
    disposeMesh(state.mesh);state.mesh=null;state.holder.visible=false; // Never show a stale weapon with the next weapon's grip offsets.
    try {
      const texture=await new THREE.TextureLoader().loadAsync('../../assets/toolsprites/'+TOOLS[state.toolKey][1]);
      if(ticket!==state.epoch){texture.dispose();return;}
      window.HobunjiSpritePngSurface.configureTexture(THREE,texture,'omgurku-preview-weapon');
      const height=.5*texture.image.height/texture.image.width; // Gameplay's half-tile PNG weapon width.
      const plane=new THREE.Mesh(new THREE.PlaneGeometry(.5,height),
        window.HobunjiSpritePngSurface.makeMaterial(THREE,texture,'omgurku-preview-weapon',{side:THREE.DoubleSide}));
      plane.rotation.x=-Math.PI/2;plane.renderOrder=9;
      const mesh=new THREE.Group(); // Same fixed PNG basis and grip metadata used by the attack editor.
      mesh.userData.toolPlane=plane;mesh.add(plane);
      mesh.scale.setScalar(window.HobunjiHandToolGrips.effectiveToolScaleForTool(state.toolKey,'engh-sho','male'));
      disposeMesh(state.mesh);state.mesh=mesh;state.holder.add(mesh);state.error=null;
    } catch(error) {
      if(ticket!==state.epoch)return;
      disposeMesh(state.mesh);state.mesh=null;state.error=error.message;
      say('Weapon PNG unavailable: '+error.message);
    }
  }
  function prepare() {
    if(!state.stances || !state.action)return;
    const shared=window.SharedAttackPose, action=state.action; // Single gameplay authority for endpoints, mirroring and timing.
    const neutral=state.stances[state.stance]; // Loaded from the authored weapon-idle stance document.
    const template=window.AttackPoseTemplates.poseFor(action.anim==='sweep'?'hatchet_swing':'pickshovel_swing');
    const sequence=shared.bakeStanceSequence(action.anim,action.anim==='chop'?null:template,
      action.dirSign||1,action.power||1,neutral,{alternatesHeavyNeutral:state.stance==='heavyWeapon'});
    state.stancePose={neutral};
    state.pose={neutral:sequence.neutral,windup:sequence.windup,strike:sequence.strike,
      returnNeutral:sequence.returnNeutral,neutralMirrorSign:sequence.startNeutralSign,
      returnNeutralMirrorSign:sequence.returnNeutralSign};
    state.sign=sequence.effectiveSign;
    const duration=action.windupS+action.strikeS+(Number(action.returnS)||0); // Same authored attack values and visual clock as gameplay.
    shared.swingTimeline(state.timing,duration,action.windupS/duration,
      (action.windupS+action.strikeS)/duration,Number(action.holdS)||0);
    Object.assign(state.gripTiming,{wf:state.timing.wf,sf:state.timing.sf,hf:state.timing.hf});
    state.progress=0;
  }
  function setMode(mode) {
    state.mode=mode;state.playing=false;state.progress=0;$('weaponPreviewMode').value=mode;
    if(state.model){state.model.userData.omgurkuPreviewBodyYaw=0;}
    say(mode==='idle'?'Procedural idle hands':mode==='stance'?'Authored weapon stance':'Attack ready — press Play or scrub the timeline');
  }
  function unbind() {
    ++state.epoch;disposeMesh(state.mesh);state.mesh=null;
    if(state.model){
      delete state.model.userData.proceduralHandToolHolder;
      delete state.model.userData.proceduralHandToolKey;
      delete state.model.userData.proceduralHandGripContext;
      delete state.model.userData.proceduralHandAnimationGrip;
      delete state.model.userData.omgurkuPreviewBodyYaw;
    }
    state.holder?.parent?.remove(state.holder);
    state.holder=null;state.model=null;
  }
  function bind(THREE,model) {
    unbind();
    state.THREE=THREE;state.model=model;
    state.holder=new THREE.Group();state.holder.name='Omgurku_Preview_WeaponHolder';
    const upper=model.userData.omgurkuComposite.upper; // Tool and hands share the authoritative humanoid frame.
    model.userData.omgurkuComposite.riderFrame.add(state.holder);
    model.userData.proceduralHandToolHolder=state.holder;
    model.userData.proceduralHandGripContext='melee';
    state.sample=window.SharedAttackPose.createSample();state.posePoint=new THREE.Vector3();
    // The portrait already owns its anatomy scale; apply donor pose proportions once in the mounted floor frame.
    state.poseOptions={cx:0,cz:0,floorY:0,baseY:upper.userData.handAttachY||0,
      speciesId:'engh-sho',gender:'male',rigScaleY:1,modelHeight:upper.userData.portraitModelHeight,
      armLength:upper.userData.armLength,poseOrbitScale:upper.userData.poseOrbitScale};
    prepare();loadWeapon();
  }
  function update(dt) {
    if(!state.model || !state.sample)return;
    const root=state.model,upper=root.userData.omgurkuComposite.upper; // All sampled channels stay local to the NPC's upper body.
    state.holder.visible=state.mode!=='idle' && !!state.mesh;
    if(state.mode==='idle'){root.userData.omgurkuPreviewBodyYaw=0;return;}
    if(!state.pose)return;
    if(state.playing){
      state.progress+=dt/state.timing.totalS*Number($('weaponPreviewSpeed').value);
      if(state.progress>=1){
        if($('weaponPreviewLoop').checked)state.progress%=1;
        else{state.progress=1;state.playing=false;}
      }
    }
    const sample=state.sample,shared=window.SharedAttackPose; // Reuse the sampler output; no per-frame pose baking.
    if(state.mode==='stance'){
      shared.samplePose(sample,state.stancePose,shared.STYLE_NEUTRAL_POSE[TOOLS[state.toolKey][2]],0,1,1,1);
    }else shared.samplePose(sample,state.pose,shared.STYLE_NEUTRAL_POSE[state.action.anim],
      state.progress,state.timing.wf,state.timing.sf,state.timing.hf,state.sign);
    root.userData.omgurkuPreviewBodyYaw=sample.bodyYawRad;
    const x=Number(upper.userData.handAttachX)||0,y=Number(upper.userData.handAttachY)||0; // Existing portrait-scanned hand anchor.
    state.posePoint.set(x*sample.mirrorBlend+sample.x,y+sample.y,sample.z);
    window.HobunjiSpeciesPoseScale?.transformPosePoint?.(state.posePoint,state.poseOptions);
    state.holder.position.copy(state.posePoint);
    state.holder.rotation.set(sample.pitchRad,sample.yawRad,sample.rollRad,'YXZ');
    state.holder.scale.setScalar(sample.scale);
    root.userData.proceduralHandToolKey=state.toolKey;
    root.userData.proceduralHandAnimationGrip=window.HobunjiHandToolGrips.animationGripAt(
      state.mode==='stance'?0:state.progress,state.gripTiming,state.pose,'attack',state.toolKey);
    const neutralWeight=state.mode==='stance'?1:state.progress<=state.timing.wf
      ?1-state.progress/Math.max(.0001,state.timing.wf)
      :state.progress>state.timing.hf?(state.progress-state.timing.hf)/Math.max(.0001,1-state.timing.hf):0; // Shared sweep sprite-basis convention.
    if(state.mesh){
      state.mesh.scale.x=Math.abs(state.mesh.scale.x)*(sample.mirrorBlend<0?-1:1);
      state.mesh.userData.toolPlane.rotation.z=(state.mode==='stance'?TOOLS[state.toolKey][2]:state.action.anim)==='sweep'?-Math.PI/2*(1-neutralWeight):0;
    }
    const scrub=$('weaponPreviewScrub'),progress=String(state.progress); // Leave the slider alone when its displayed value already matches.
    if(document.activeElement!==scrub && scrub.value!==progress)scrub.value=progress;
    const phase=state.mode==='stance'?'Stance':state.progress<state.timing.wf?'Windup':state.progress<state.timing.sf?'Strike':state.progress<state.timing.hf?'Hold':'Return'; // Only write the badge when its value changes.
    say(state.error?'Weapon PNG unavailable: '+state.error:phase);
  }
  async function init() {
    const responses=await Promise.all(['weapon-idle-stances','attack-values'].map(name=>fetch('../../config/combat/'+name+'.json'))); // Authored combat documents, shared with the game and attack editor.
    if(responses.some(response=>!response.ok))throw new Error('Could not load combat preview data');
    const [stances,values]=await Promise.all(responses.map(response=>response.json())); // Parse once during author initialization.
    state.stances=stances.stances;state.values=values;
    for(const [key,definition] of Object.entries(TOOLS)){
      const option=document.createElement('option');option.value=key;option.textContent=definition[0];$('weaponPreviewTool').append(option);
    }
    for(const family of ['swingCombo','pokeCombo'])for(const action of values.combo[family])state.actions.push(action);
    state.actions.push({...values.combo.swingCombo[0],name:'Chop',anim:'chop'});
    state.actions.forEach((action,index)=>{
      const option=document.createElement('option');option.value=String(index);option.textContent=action.name;$('weaponPreviewAttack').append(option);
    });
    state.action=state.actions[0];prepare();
    $('weaponPreviewMode').addEventListener('change',event=>setMode(event.target.value));
    $('weaponPreviewTool').addEventListener('change',event=>{state.toolKey=event.target.value;loadWeapon();if(state.mode==='idle')setMode('stance');});
    $('weaponPreviewStance').addEventListener('change',event=>{state.stance=event.target.value;prepare();if(state.mode==='idle')setMode('stance');});
    $('weaponPreviewAttack').addEventListener('change',event=>{state.action=state.actions[Number(event.target.value)];prepare();setMode('attack');});
    $('weaponPreviewPlay').addEventListener('click',()=>{setMode('attack');state.playing=true;});
    $('weaponPreviewIdle').addEventListener('click',()=>setMode('idle'));
    $('weaponPreviewScrub').addEventListener('input',event=>{state.mode='attack';$('weaponPreviewMode').value='attack';state.playing=false;state.progress=Number(event.target.value);});
  }
  window.HobunjiOmgurkuWeaponPreview={init,bind,unbind,update,snapshot:()=>({mode:state.mode,toolKey:state.toolKey,
    playing:state.playing,progress:state.progress,stance:state.stance,weaponLoaded:!!state.mesh,holderVisible:state.holder?.visible===true,sample:state.sample?{...state.sample}:null,error:state.error})};
})();

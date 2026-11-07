// Shared recorded cues for stone interactions and fire ignition in ruins and Puzzle Caves.
// Uses AudioSystem's object-SFX config instead of spawning raw Audio elements.
// Sound-size references: normal push block for activators; large ruin door for mechanisms.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinInteractionAudio=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const REFERENCE_SPAN=Object.freeze({activator:1.2,mechanism:4}); // World-space spans whose uploaded recordings play at original pitch.
  const movement=new WeakMap(); // Per physical mechanism: previous progress/direction, to play once per motion or reversal.
  const plateStates=new WeakMap(); // Per physical pressure plate: last pressed state, to suppress continuous audio.
  const debug={lastCue:null,lastPitch:1,lastSpan:null,plays:0}; // Mobile-friendly playback diagnostics.
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function spanFor(object,explicitSize){
    const override=Number(explicitSize??object?.userData?.ruinSoundSize); // Optional authored physical dimension avoids using decorative parent meshes.
    if(Number.isFinite(override)&&override>0)return override;
    const T=root.THREE;
    if(object?.isObject3D&&T?.Box3&&T?.Vector3){
      try{
        const box=new T.Box3().setFromObject(object);
        if(!box.isEmpty()){
          const size=box.getSize(new T.Vector3());
          const extent=Math.max(size.x,size.y,size.z);
          if(Number.isFinite(extent)&&extent>.01)return extent;
        }
      }catch(_){} // A partially loaded visual should still play its neutral-size cue.
    }
    const scale=object?.scale;
    const extent=Math.max(Number(scale?.x)||0,Number(scale?.y)||0,Number(scale?.z)||0);
    return extent>.01?extent:null;
  }
  function pitchFor(kind,object,options={}){
    if(kind!=='activator'&&kind!=='mechanism')return 1;
    const span=spanFor(object,options.size);
    if(!span)return 1; // Missing geometry never invents object size.
    return clamp(Math.pow(REFERENCE_SPAN[kind]/span,.30),.67,1.6);
  }
  function play(key,pitch=1,span=null){
    const audio=root.AudioSystem;
    if(typeof audio?.playObjectSfxKey!=='function')return false;
    audio.playObjectSfxKey(key,1,pitch);
    debug.lastCue=key;debug.lastPitch=pitch;debug.lastSpan=span;debug.plays++;
    return true;
  }
  function activator(object=null,options={}){
    return play('stoneActivator',pitchFor('activator',object,options),spanFor(object,options.size));
  }
  function mechanism(object=null,options={}){
    return play('stoneMechanism',pitchFor('mechanism',object,options),spanFor(object,options.size));
  }
  function igniteTorch(){return play('igniteLarge');}
  function igniteAmmo(){return play('igniteSmall');}
  function watchMovement(object,progress,options={}){
    if(!object||!Number.isFinite(progress))return false;
    const previous=movement.get(object);
    const now=Number(root.performance?.now?.()??Date.now()); // Used for an idle timeout rather than resetting on duplicate same-frame progress reads.
    if(!previous){
      movement.set(object,{progress,direction:0,initialMotion:!options.silent&&progress>.001&&progress<.999,lastMoveAt:now}); // The first mid-motion sample is audible; learn its direction without double-playing next frame.
      if(options.silent||progress<=.001||progress>=.999)return false;
      return mechanism(object,options); // A first sampled in-progress animation is a genuine move, not a restored end pose.
    }
    const delta=progress-previous.progress; // Progress is signed, so reversing a sliding door plays again.
    previous.progress=progress;
    if(Math.abs(delta)<.001){
      if(now-previous.lastMoveAt>150)previous.direction=0; // performance.now() is milliseconds: only a genuinely idle 150 ms resets the direction.
      return false;
    }
    previous.lastMoveAt=now;
    const direction=Math.sign(delta);
    if(previous.initialMotion){previous.initialMotion=false;previous.direction=direction;return false;} // First measured direction belongs to the already-audible initial movement.
    if(previous.direction===direction)return false;
    previous.direction=direction;
    return mechanism(object,options);
  }
  function watchPlate(object,pressed,options={}){
    if(!object)return false;
    const next=!!pressed,previous=plateStates.get(object);
    if(previous===next)return false;
    plateStates.set(object,next);
    if(options.silent||previous===undefined&&!next)return false; // An initial unpressed plate is silent.
    return activator(object,options); // A newly seated or released stone plate clicks only on its state edge.
  }
  return Object.freeze({pitchFor,spanFor,activator,mechanism,igniteTorch,igniteAmmo,watchMovement,watchPlate,
    debugSnapshot:()=>({...debug,trackedMotion:'per-object',trackedPlates:'per-object'})});
});

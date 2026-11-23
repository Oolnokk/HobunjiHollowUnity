// Key Statue sculpture: a frozen, carved Harlyao Ghost Army soldier.
// Only the sculpture changes. KeyStatues and Shattercasks still own the authored
// prop's existing grip points, hitbox, carry/retrieval, plinth and respawn rules.
(() => {
  'use strict';
  const TARGET_HEIGHT = 1.12; // Matches keyStatue.json's 1.12-high authored carryable hitbox.
  const TARGET_WIDTH = 0.56; // Keep sword, shoulders and head inside a compact statuette silhouette.
  const TARGET_DEPTH = 0.42; // The portrait and blade remain close to the original pedestal footprint.
  const entries = new Set(); // One record per live key-statue prop; asynchronous work can be canceled.
  let ready = 0, failed = 0, lastError = ''; // Mobile-visible counters for portrait and weapon asset failures.
  const random = () => window.GameRandom?.random?.() ?? Math.random();

  // Both pools are exactly those used by HarlyaoNightMarch: a living Harlyao
  // portrait wearing the skeleton minions' same armor/overwear/bandolier pool,
  // and a native-copper melee weapon from MinionCombat.defaultWeaponShapes.
  function rollSoldier(id) {
    const minions = window.MinionCombat;
    if (!minions?.rollRoster || !minions?.defaultWeaponShapes?.length) return null;
    const roster = minions.rollRoster('harlyao', 'Harlyao Ghost Army Soldier', {
      gender: 'male', equipmentSpeciesId: 'harlyao-skeleton',
    });
    const shapes = minions.defaultWeaponShapes;
    const shapeKey = shapes[Math.min(shapes.length - 1,Math.floor(Math.max(0,random()) * shapes.length))];
    const metalKey = 'nativeCopper'; // Same metal selection as the marching army's configuration.
    const weaponKey = window.Combat?.deps?.craftedToolItemKey?.(shapeKey,metalKey) || shapeKey;
    return {id:String(id),roster,shapeKey,metalKey,weaponKey};
  }

  function disposeEntry(entry) {
    if (!entry || entry.disposed) return;
    entry.disposed = true;
    entries.delete(entry);
    entry.figure && window.FestivalAncestorFigures?.disposeFigure?.(entry.figure);
    entry.visual?.parent?.remove?.(entry.visual);
    for(const part of entry.weaponParts || []) {
      part.geometry?.dispose?.();part.material?.map?.dispose?.();part.material?.dispose?.();
    }
    for(const mesh of entry.legacy || []) mesh.visible = true;
    if(entry.group?.userData?.ghostArmyKeyStatue===entry)delete entry.group.userData.ghostArmyKeyStatue;
    entry.figure=null;entry.visual=null;
  }
  function dispose(group) {
    const entry=group?.userData?.ghostArmyKeyStatue;
    if(entry)disposeEntry(entry);
  }

  // Reuse the real equipped weapon sprite, but bake its pixels into the exact
  // Tzizkhanash carved_smooth cell treatment. The static result is an ordinary
  // PNG plane, not a live actor's held-tool/x-ray overlay or another animation loop.
  async function weaponFigure(THREE,spec,stone) {
    const tools = window.CharacterHeldTools;
    const tool=tools?.makeToolPlaneMesh?.(spec.weaponKey,{holder:{weaponMasteryLevel:0}});
    const livePlane=tool?.userData?.toolPlane;
    if(!livePlane?.geometry)return null;
    const definition=window.Combat?.deps?.TOOL_ITEM_DEFS?.[spec.weaponKey]
      ||window.Combat?.deps?.TOOL_ITEM_DEFS?.[spec.shapeKey];
    let image=livePlane.material?.map?.image;
    if(!image?.width && definition?.sprite) {
      image=await new Promise(resolve=>{
        const candidate=new Image();
        candidate.onload=()=>resolve(candidate);
        candidate.onerror=()=>resolve(null);
        candidate.src=definition.sprite;
      });
    }
    if(!image?.width)return null;
    const source=document.createElement('canvas');
    source.width=image.naturalWidth||image.width;source.height=image.naturalHeight||image.height;
    source.getContext('2d').drawImage(image,0,0,source.width,source.height);
    const carved=window.FestivalAncestorFigures.carvedCanvas(source,stone);
    const texture=new THREE.CanvasTexture(carved);
    texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;
    const material=new THREE.MeshBasicMaterial({
      map:texture,transparent:true,alphaTest:0.08,side:THREE.DoubleSide,depthWrite:true,
    });
    const mesh=new THREE.Mesh(livePlane.geometry.clone(),material);
    mesh.name='key_statue_carved_army_weapon';
    mesh.rotation.copy(livePlane.rotation); // Original tool sprite's -90-degree X basis.
    mesh.renderOrder=0; // World sculpture, never an actor's held-overlay render pass.
    tool.traverse?.(node=>{ // The canonical held-weapon factory's temporary model never enters the scene.
      if(node.isMesh){
        if(!node.userData?.sharedToolGeometry)node.geometry?.dispose?.();
        for(const mat of Array.isArray(node.material)?node.material:[node.material])mat?.dispose?.();
      }
    }); // The cached source textures remain owned by CharacterHeldTools.
    return mesh;
  }

  function fitSculpture(THREE,root) {
    const bounds=new THREE.Box3().setFromObject(root);
    const size=new THREE.Vector3();bounds.getSize(size);
    if(!Number.isFinite(size.y)||size.y<=0)return false;
    const ratio=Math.min(TARGET_HEIGHT/size.y,TARGET_WIDTH/Math.max(0.01,size.x),
      TARGET_DEPTH/Math.max(0.01,size.z));
    root.scale.setScalar(ratio);
    root.position.set(-(bounds.min.x+bounds.max.x)*0.5*ratio,-bounds.min.y*ratio,
      -(bounds.min.z+bounds.max.z)*0.5*ratio); // Ground the feet on the old pedestal, never below the physics hitbox.
    root.userData.ghostArmyCarvingSize={height:+(size.y*ratio).toFixed(3),
      width:+(size.x*ratio).toFixed(3),depth:+(size.z*ratio).toFixed(3),scale:ratio};
    return true;
  }

  async function decorate(group,spec) {
    if(!group?.isObject3D||!spec?.roster?.appearance)return false;
    dispose(group);
    const entry={group,spec,legacy:[...group.children],visual:null,figure:null,weaponParts:[],disposed:false};
    entries.add(entry);
    group.userData ||= {};
    group.userData.ghostArmyKeyStatue=entry;
    try{
      const artist=window.FestivalAncestorFigures,THREE=window.THREE;
      if(!artist?.createCarvedFigure||!THREE?.Box3)
        throw new Error('Tzizkhanash portrait/stone renderer is unavailable');
      const figure=await artist.createCarvedFigure(spec.roster,{
        id:'key-statue-'+spec.id,
        pose:{x:0,z:0,scale:1,tilt:0,head:0.07,handRise:0.11},
      });
      if(entry.disposed){artist.disposeFigure?.(figure);return false;}
      entry.figure=figure;
      const display=new THREE.Group();display.name='key_statue_harlyao_ghost_army_soldier';
      display.add(figure.model);
      const blade=await weaponFigure(THREE,spec,figure.stone);
      if(entry.disposed){
        blade?.geometry?.dispose?.();blade?.material?.map?.dispose?.();blade?.material?.dispose?.();
        return false;
      }
      if(blade) {
        const d=figure.model.userData || {};
        const gripX=Number(d.handAttachX)||-0.2;
        const gripY=Number(d.handAttachY)||0;
        blade.rotation.x+=Math.PI/2; // Make the flat weapon upright next to the portrait, not lying on the floor.
        blade.rotation.z=-0.30;
        blade.position.set(gripX,gripY+0.15,0.035);
        blade.scale.setScalar(0.62);
        display.add(blade);
        entry.weaponParts.push(blade);
      }
      if(!fitSculpture(THREE,display))throw new Error('Could not measure Harlyao soldier portrait bounds');
      if(entry.disposed)return false;
      group.add(display);entry.visual=display;
      for(const original of entry.legacy)original.visible=false; // No abstract primitive statue shows through the carved soldier.
      group.userData.ghostArmyStatueInfo={
        species:spec.roster.appearance.speciesId,weaponShape:spec.shapeKey,
        clothing:[...(spec.roster.equippedCosmetics||[])],size:display.userData.ghostArmyCarvingSize,
        weaponVisible:!!blade,
      }; // Mobile inspection follows the moving Burden into hands or onto the defended plinth.
      ready++;
      return true;
    }catch(error){
      lastError=String(error?.message||error);failed++;
      console.warn('[KeyStatueFigures] could not carve Harlyao soldier',error);
      disposeEntry(entry); // Retain the authored emergency fallback so a missing cosmetic cannot block the puzzle.
      return false;
    }
  }
  function debugSnapshot() {
    return {active:entries.size,ready,failed,lastError,
      soldiers:[...entries].map(e=>({id:e.spec.id,shape:e.spec.shapeKey,ready:!!e.visual,
        size:e.visual?.userData?.ghostArmyCarvingSize||null}))};
  }
  window.KeyStatueFigures=Object.freeze({rollSoldier,decorate,dispose,debugSnapshot,
    targetSize:Object.freeze({height:TARGET_HEIGHT,width:TARGET_WIDTH,depth:TARGET_DEPTH})});
  window.__keyStatueFiguresDebug=debugSnapshot; // Accessible without DevTools on mobile via Pixel Probe.
})();

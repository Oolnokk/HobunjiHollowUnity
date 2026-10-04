// Convert Banubu's canonical dialogue into Director cards without copying its script or quest rewards.
(() => {
  'use strict';
  function build(tree, npc, locale) {
    if (!tree?.nodes?.length || !locale?.cinematicCameras?.length) throw new Error('Banubu dialogue/camera source is missing.');
    const station=locale.npcAnchors?.find(s=>/sleep/.test(s.id))||locale.npcAnchors?.[0]; // Authored sleeping station supplies Banubu's starting tile.
    const c=Number(station?.col??station?.c??6),r=Number(station?.row??station?.r??5); // Tile coordinates shared by preview actors and motion cues.
    const points=[{id:'banubu_start',lc:c,lr:r},{id:'player_start',lc:6,lr:8}]; // Authored blocking in the cavern's own grid.
    const stages=[]; // Cards materialized from the live dialogue nodes and their presentation metadata.
    const next=id=>id||'__end__';
    for(const node of tree.nodes){
      const cue=JSON.parse(JSON.stringify(node.banubuPresentation||{})); // Preserve non-transactional visual cues in the editable preview.
      for(const key of ['commitQuestAction','commitIntroAttempt','commitTurnIn'])delete cue[key];
      const common={id:node.id,sourceNodeId:node.id,sourceDialogueNode:JSON.parse(JSON.stringify(node)),speakerId:'banubu',next:next(node.next),cameraId:node.cameraId,banubuPresentation:cue}; // Source identity survives export without running dialogue quest actions.
      if(node.type==='end')stages.push({...common,type:'camera',duration:0,next:'__end__'});
      else if(node.type==='visual')stages.push({...common,type:'camera',duration:node.durationSec||1});
      else if(node.type==='choice')stages.push({...common,type:'choice',text:node.text,options:(node.choices||[]).map(o=>({text:o.label,next:next(o.next)}))});
      else stages.push({...common,type:'talk',text:node.text});
    }
    const start=next(tree.entryNode||tree.startNodeId||tree.startNode||tree.nodes[0].id); // Canonical entry may differ from array ordering.
    const i=stages.findIndex(s=>s.id===start);if(i>0)stages.unshift(...stages.splice(i,1));
    const cameras=JSON.parse(JSON.stringify(locale.cinematicCameras)); // Per-scene camera records remain editable without mutating locale definitions.
    return {version:6,title:tree.label||tree.name||tree.title||'Banubu',mapId:locale.cavern.mapId,localeId:locale.id,anchor:{c:0,r:0,rotationDeg:0},points,actors:[{id:'banubu',name:npc.name||'Banubu',npcId:'banubu',npcRecord:npc,startPointId:'banubu_start',worldC:c,worldR:r,pose:'prone',rotation:270},{id:'player',name:'Player',isPlayer:true,startPointId:'player_start',worldC:6,worldR:8,rotation:0}],stages,cinematicCameras:cameras,cinematicCameraId:'banubu_dialogue_sleep',dialogueSource:{npcId:'banubu',treeId:tree.id,tree:JSON.parse(JSON.stringify(tree))},repoMap:{id:locale.cavern.mapId,name:locale.name,cols:locale.cols,rows:locale.rows,wallStyle:'cavern',exits:locale.connectors.map(c=>({id:c.id,tiles:[[c.col,c.row]]})),floor:Object.keys(locale.tiles).map(k=>k.split(',').map(Number)),furniture:[],npcStations:locale.npcAnchors,cinematicCameras:cameras}};
  }
  window.BanubuCutsceneAuthoring={build};
})();

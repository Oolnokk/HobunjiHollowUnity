// Playable bridge/defence wing for generated ruins. RuinComposer remains the single
// planning authority; this adapter materializes its records in the real ruin scene,
// occupancy grid, world-event, Burden, rope and enemy runtimes.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RuinComposerPlayable = api;
})(typeof self !== 'undefined' ? self : globalThis, function (G) {
  'use strict';

  const SIZE = Object.freeze({ width:36, depth:16, gapStart:9.5, gapWidth:3.4, ceilingY:3.5 });
  const PIECE_COLORS = Object.freeze({ plinth:0x76685a, statueDispenser:0x9a8370, crackedPillar:0x71685e });

  function plan(seed, archetype = 'trialHall') {
    const composer = G.RuinComposer; // Owns focal-goal solving, spatial claims and encounter schedules.
    if (!composer?.compose) throw new Error('RuinComposer is not loaded.');
    const room = archetype==='vaultHall' ? composer.rooms.hall({width:24,depth:18,ceilingY:SIZE.ceilingY}) : composer.rooms.chasm(SIZE); // Defense-only chambers need a whole floor; bridge trials retain their authored chasm.
    const composition = composer.compose(room, { archetype, seed:Number(seed) >>> 0, pressSeconds:30 }); // The authored defence plinth takes 30 real seconds; enemy waves share that deadline.
    if (!composition.ok) throw new Error('Ruin composition rejected: ' + composition.reason);
    return { room, composition };
  }

  function extendGrid(rec, origin, room, makeTile) {
    // Existing V50 tiles remain intact; only new trailing rows/columns belong to this wing.
    const columns = Math.max(rec.cols, Math.ceil(origin.x + room.bounds.maxX + 2));
    const rows = Math.max(rec.rows, Math.ceil(origin.z + room.bounds.maxZ + 2));
    let addedFloors = 0;
    const gap=room.gaps?.[0]||null; // Used by both tile collision and terrain support; a vault hall has no abyss.
    for (let row = 0; row < rows; row++) {
      const target = rec.grid[row] || (rec.grid[row] = []); // Appends collision data for the new wing.
      for (let col = target.length; col < columns; col++) {
        const x = col + .5 - origin.x, z = row + .5 - origin.z;
        const inside = x >= 0 && x < room.bounds.maxX && z >= 0 && z < room.bounds.maxZ;
        const inGap = inside && gap && (gap.axis==='x' ? x>=gap.start&&x<gap.end : z>=gap.start&&z<gap.end);
        const tile = makeTile(inside); // Pit cells remain enterable so a player can fall, rather than hit invisible ROCK.
        if (inGap) tile.bottomless = true; // Bombs recognize the void; DynamicSurfaces owns the player's fall.
        target.push(tile);
        if (inside && !inGap) {
          const key = col + ',' + row;
          rec.floorSet.add(key);
          rec.mapData.floor.push([col, row]);
          addedFloors++;
        }
      }
    }
    rec.cols = columns; rec.rows = rows;
    rec.mapData.cols = columns; rec.mapData.rows = rows;
    return addedFloors;
  }

  function addGeometry(THREE, scene, origin, room, owner) {
    const group = new THREE.Group(); // All generated wing geometry belongs to this runtime instance.
    group.name = 'ruin_composed_trial_wing';
    scene.add(group);
    const mat = new THREE.MeshBasicMaterial({ color:0x524c45 }); // Owned masonry material, disposed with the wing.
    const rim = new THREE.MeshBasicMaterial({ color:0x817364 }); // Separates the two banks visually from the abyss.
    owner.materials.push(mat,rim);
    function box(name,x,y,z,width,height,depth,material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material);
      mesh.name = name;
      mesh.position.set(origin.x+x,y,origin.z+z);
      group.add(mesh);
      owner.generated.push(mesh);
      return mesh;
    }
    const w=room.bounds.maxX,d=room.bounds.maxZ,gap=room.gaps?.[0]||null; // Preserves the bridge chasm while allowing a true defense-only vault.
    if(gap){
      const left=gap.start,right=gap.end;
      box('composed_near_floor',left/2,-.13,d/2,left,.26,d,mat);
      box('composed_far_floor',(right+w)/2,-.13,d/2,w-right,.26,d,mat);
      box('composed_near_lip',left-.07,.025,d/2,.14,.05,d,rim);
      box('composed_far_lip',right+.07,.025,d/2,.14,.05,d,rim);
    }else box('composed_vault_floor',w/2,-.13,d/2,w,.26,d,mat);
    // Outer walls have actual impassable tile cells outside this footprint.
    box('composed_north_wall',w/2,1.5,-.12,w+.5,3,.24,mat);
    box('composed_south_wall',w/2,1.5,d+.12,w+.5,3,.24,mat);
    box('composed_west_wall',-.12,1.5,d/2,.24,3,d+.5,mat);
    box('composed_east_wall',w+.12,1.5,d/2,.24,3,d+.5,mat);
    return group;
  }

  function registerTerrain(DS, scope, origin, room) {
    const x=origin.x,z=origin.z,w=room.bounds.maxX,d=room.bounds.maxZ;
    // Priority 4 beats decorative masonry. A defense-only vault has floor across its whole room.
    const gap=room.gaps?.[0]||null;
    if(!gap){
      DS.registerSurface({id:scope+'-vault',scope,priority:4,bounds:{minX:x,maxX:x+w,minZ:z,maxZ:z+d},topY:0});
      return;
    }
    DS.registerSurface({ id:scope+'-near',scope,priority:4,
      bounds:{minX:x,maxX:x+gap.start,minZ:z,maxZ:z+d},topY:0 });
    DS.registerSurface({ id:scope+'-far',scope,priority:4,
      bounds:{minX:x+gap.end,maxX:x+w,minZ:z,maxZ:z+d},topY:0 });
    DS.registerPit({ id:scope+'-gap',scope,
      bounds:{minX:x+gap.start,maxX:x+gap.end,minZ:z,maxZ:z+d} });
  }

  async function mount(options = {}) {
    const { rec, ruin, makeTile } = options;
    const THREE=options.THREE||G.THREE, DS=options.DynamicSurfaces||G.DynamicSurfaces;
    const C=G.RuinComposer, P=G.FurniturePuzzleRuntime, A=G.AuthoredFurniture;
    const mapId=String(options.mapId||'');
    if (!rec?.scene || !ruin || typeof makeTile!=='function' || !THREE?.Mesh || !DS?.registerPit
      || !A?.load || !A?.buildGroup || !P?.registerNode || !G.HangingRopes?.registerRope || !G.RuinEncounters?.create)
      throw new Error('Playable ruin wing requires the real scene, authored furniture, puzzle, rope and encounter runtimes.');
    const { room, composition } = plan(options.seed, options.archetype);
    const feedPlinthId=composition.records.find(record=>record.piece==='plinth')?.id||null; // Each authored statue dispenser feeds its own encounter objective, not a global map channel.
    const origin = {x:Math.ceil(Number(options.originX)||3),z:Math.ceil(Number(options.originZ)||rec.rows+4)}; // Isolated south wing with a return prompt.
    const keys = [...new Set([...composition.records.map(record=>record.key).filter(Boolean),...(options.burdenOffering===true&&options.archetype!=='vaultHall'?['burdenPlinth','keyStatueDispenser']:[])])]; // Load the optional self-contained Burden offering before mutating the ruin.
    const data = new Map(); // Preload every authored piece before touching the live map: never build half a puzzle.
    for (const key of keys) {
      const item=await A.load(key);
      if (!item?.parts?.length) throw new Error('Missing authored ruin piece: '+key);
      data.set(key,item);
    }
    if (options.isCurrent?.()===false) throw new Error('Playable ruin generation was superseded.');
    const scope=String(options.scope||'composed-ruin-wing'); // Private terrain scope; it must be removed on exit/reroll.
    const owner={ root:null, generated:[], materials:[], placed:[], placementIds:[], blockerTiles:new Map(), blockerStates:new Map(), controls:[], ropes:[], offering:null, applied:null, disposed:false }; // Owns optional carryables, unlocks and every authored node during teardown. // Tracks authored collisions and restores original walkable tiles on rollback.
    let result=null;
    try {
      extendGrid(rec,origin,room,makeTile);
      registerTerrain(DS,scope,origin,room);
      owner.root=addGeometry(THREE,rec.scene,origin,room,owner);
      function setPieceBlocked(record, blocked) {
        // The legacy building grid is the common collision authority for player and ground enemies.
        const baseZ=record.piece==='crackedPillar'?-2:0; // Authored pillar's upright foot sits two units behind its pivot, on the far bank.
        const worldX=origin.x+record.x+Math.sin(record.rotY)*baseZ;
        const worldZ=origin.z+record.z+Math.cos(record.rotY)*baseZ;
        const col=Math.floor(worldX),row=Math.floor(worldZ),key=col+','+row;
        const old=rec.grid[row]?.[col];
        if(!old || old.bottomless) return; // Do not replace the gap's fall semantics with a solid tile.
        if(!owner.blockerTiles.has(key))owner.blockerTiles.set(key,old);
        const last=owner.blockerStates.get(key); // Suppress per-frame tile allocations during mechanism animation.
        if(last===!!blocked)return;
        owner.blockerStates.set(key,!!blocked);
        rec.grid[row][col]=blocked?makeTile(false):owner.blockerTiles.get(key);
      }
      const place = record => {
        const source=data.get(record.key);
        const group=A.buildGroup(source,PIECE_COLORS[record.piece]||0x80766a);
        group.name='composed_'+record.id;
        group.position.set(origin.x+record.x,record.overhead?room.ceilingY-.035:record.y,origin.z+record.z);
        group.rotation.y=record.rotY;
        owner.root.add(group);
        owner.placed.push(group);
        owner.placementIds.push(record.id);
        if (group.userData?.furniturePuzzle) {
          const puzzleOverride = record.piece==='plinth' ? {channel:'Trial-Plinth-'+record.id,completionChannel:'Trial-Done-'+record.id}
            :record.piece==='bombDispenser'?{channel:'Trial-Bomb-'+record.id}:undefined; // Keeps this room's signals isolated from native V50 mechanisms.
          if (!P.registerNode(mapId,{id:record.id,key:record.key,puzzle:puzzleOverride},group,{
            setBlocked:(_puzzleRecord,blocked)=>{if(record.piece==='crackedPillar')setPieceBlocked(record,blocked);},
          })) throw new Error('Could not register authored mechanism: '+record.id);
        }
        if(['plinth','statueDispenser','spawnerPillar'].includes(record.piece))setPieceBlocked(record,true); // Fixed fixtures obstruct walking before the encounter begins.
        if (record.piece==='ropeMount') {
          const dir=record.params?.strikeDir || {x:Math.sin(record.rotY),z:Math.cos(record.rotY)};
          const rope=G.HangingRopes.registerRope({
            id:'composed_'+record.id,mapId,scene:rec.scene,mount:group,
            x:origin.x+record.x,y:room.ceilingY-.035,z:origin.z+record.z,
            length:Number(record.params.length)||2.4,maxLength:Number(record.params.maxLength)||2.95,
            yaw:Math.atan2(dir.z,dir.x),
          });
          if (!rope) throw new Error('Could not mount a rope on '+record.id);
          owner.ropes.push(rope.id);
        }
        if (record.piece==='bombDispenser') {
          if (!G.HronalWitchBombs?.registerDispenser?.(mapId,record.id,group,group.userData.furniturePuzzle))
            throw new Error('Witch-bomb dispenser did not register.');
        }
        if (record.piece==='statueDispenser') {
          if (!G.KeyStatues?.registerDispenser?.(mapId,record.id,group,group.userData.furniturePuzzle,{feedPlinthId}))
            throw new Error('Key Statue dispenser did not register.');
        }
        if (record.piece==='plinth' || record.piece==='statueDispenser' || record.piece==='bombDispenser') {
          const point={x:origin.x+record.x,z:origin.z+record.z}; // Used by the ordinary ruin interaction list on all input devices.
          const descriptor={
            kind:'composed-'+record.piece,point,promptRoot:group,range:1.7,priority:100,
            label:() => {
              const buttons=record.piece==='plinth'?P.burdenPlateButtons(mapId,record.id)
                :record.piece==='statueDispenser'?P.keyStatueButtons(mapId,record.id):null;
              return buttons?.[0]?.label || (record.piece==='bombDispenser'?'Release Witch-bomb':'Use '+record.piece);
            },
            onPress:async() => {
              if (owner.disposed) return {ok:false,message:'This ruin trial is no longer active.'};
              let response;
              if (record.piece==='bombDispenser') {
                const bomb=await G.HronalWitchBombs?.dispenseFromMechanism?.(group);
                response={ok:!!bomb,message:bomb?'A Witch-bomb drops from the tube.':'The dispenser is waiting for its current Witch-bomb.'};
              } else {
                const buttons=record.piece==='plinth'?P.burdenPlateButtons(mapId,record.id):P.keyStatueButtons(mapId,record.id);
                if (buttons?.[0]?.allowed===false) return;
                response=record.piece==='plinth'
                  ?P.interactBurdenPlate(mapId,record.id,buttons?.[0]?.action)
                  :P.interactKeyStatue(mapId,record.id,buttons?.[0]?.action);
              }
              if (response?.message) options.showToast?.(response.message,!!response.ok);
              return response;
            },
          };
          owner.controls.push(descriptor);
        }
        return group;
      };
      owner.applied=await C.apply(composition,{mapId,place,surfaceY:()=>0,
        createEncounter: opts => G.RuinEncounters.create({
          ...opts,id:'composed_trial_'+(Number(options.seed)>>>0),mapId,surfaceY:()=>0,
          spawners:(opts.spawners||[]).map(s=>({...s,x:s.x+origin.x,z:s.z+origin.z})),
        }),
      });
      if (owner.applied.skipped.length) throw new Error('Composer skipped actual placements: '+owner.applied.skipped.join(', '));
      if(options.burdenOffering===true&&composition.archetype==='trialHall'){
        if(!G.KeyStatues?.registerDispenser||!G.DevRandomRuinDungeonChests?.create)
          throw new Error('Burden offering requires the Key Statue dispenser and dungeon chest runtimes.');
        const id='composed_offering_'+(Number(options.seed)>>>0); // Each optional reward plinth has its own independent replaceable Key Statue.
        const dispenserId=id+'_dispenser'; // Its physical Key Statue can be recalled without disrupting the timed defense plinth.
        const z=origin.z+room.bounds.maxZ-2.5;
        const plinth=A.buildGroup(data.get('burdenPlinth'));plinth.name=id;plinth.position.set(origin.x+3.3,0,z);
        owner.root.add(plinth);owner.placed.push(plinth);owner.placementIds.push(id);
        if(!P.registerNode(mapId,{id,key:'burdenPlinth',puzzle:{requiredBurdenKind:'keyStatue',channel:'Offering-'+id,completionChannel:'Offering-Done-'+id}},plinth))
          throw new Error('Could not register optional Key Statue Burden Plinth.');
        const dispenser=A.buildGroup(data.get('keyStatueDispenser'));dispenser.name=dispenserId;dispenser.position.set(origin.x+5.1,0,z);
        owner.root.add(dispenser);owner.placed.push(dispenser);owner.placementIds.push(dispenserId);
        if(!P.registerNode(mapId,{id:dispenserId,key:'keyStatueDispenser'},dispenser)
          ||!G.KeyStatues.registerDispenser(mapId,dispenserId,dispenser,dispenser.userData.furniturePuzzle,{feedPlinthId:id}))
          throw new Error('Could not register the offering\'s replenishable Key Statue dispenser.');
        const chest=G.DevRandomRuinDungeonChests.create({id:id+'_reward',tier:2,theme:ruin.theme,x:origin.x+7.4,y:0,z,parent:owner.root});
        chest.group.visible=false; // The short insertion animation must complete before its treasure becomes accessible.
        owner.offering={id,plinth,dispenserId,dispenser,chest,unlocked:false};
        owner.controls.push({
          kind:'composed-burden-offering',point:{x:origin.x+3.3,z},promptRoot:plinth,range:1.7,priority:98,
          label:()=>P.burdenPlateButtons(mapId,id)?.[0]?.label||'Insert Key Statue',
          onPress:()=>{
            const button=P.burdenPlateButtons(mapId,id)?.[0];
            const response=P.interactBurdenPlate(mapId,id,button?.action);
            if(response?.message)options.showToast?.(response.message,!!response.ok);
            return response;
          },
        },{
          kind:'composed-offering-dispenser',point:{x:origin.x+5.1,z},promptRoot:dispenser,range:1.7,priority:98,
          label:()=>P.keyStatueButtons(mapId,dispenserId)?.[0]?.label||'Restore Key Statue',
          onPress:()=>{
            const button=P.keyStatueButtons(mapId,dispenserId)?.[0];
            if(button?.allowed===false)return {ok:false,message:'The Key Statue is already in use.'};
            const response=P.interactKeyStatue(mapId,dispenserId,button?.action);
            if(response?.message)options.showToast?.(response.message,!!response.ok);
            return response;
          },
        });
      }
      // On both real wilderness sites and dev tests, returning is an ordinary world interaction.
      result={ok:true,origin,room,composition,entry:{x:origin.x+1.7,y:0,z:origin.z+room.bounds.maxZ/2},
        placed:owner.placed.length,controls:owner.controls,feedPlinthId,offering:!!owner.offering,update,dispose};
      return result;
    } catch (error) {
      dispose();
      throw error;
    }
    function update() {
      const bonus=owner.offering;
      if(owner.disposed||!bonus||bonus.unlocked)return false;
      if(P.getNode(mapId,bonus.id)?.userData?.burdenPlateComplete!==true)return false;
      bonus.unlocked=true;bonus.chest.group.visible=true;
      options.addControl?.(bonus.chest.control); // The parent ruin copied our initial controls when the wing was mounted.
      options.showToast?.('The Burden offering unlocks a hidden dungeon chest.',true);
      return true;
    }
    function dispose() {
      if (owner.disposed) return;
      owner.disposed=true;
      if (owner.applied) C.dispose(owner.applied,{unplace:()=>{}});
      for(const [key,tile] of owner.blockerTiles) {
        const [col,row]=key.split(',').map(Number); // Restore original cells when a generation aborts after placement.
        if(rec.grid[row]?.[col])rec.grid[row][col]=tile;
      }
      for (const id of owner.placementIds) P.unregisterNode?.(mapId,id); // Releases surface listeners, active statue dispensers and pending motions.
      for (const id of owner.ropes) G.HangingRopes?.removeRope?.(id);
      for (const group of owner.placed) group.parent?.remove(group);
      owner.root?.parent?.remove(owner.root);
      for (const mesh of owner.generated) mesh.geometry?.dispose?.();
      for (const material of owner.materials) material.dispose?.();
      DS.clearScope?.(scope);
    }
  }

  return Object.freeze({ SIZE, plan, mount });
});

// Cavern ore rocks — extracted from game.js's loadBuildingScene cavern branch.
// Marks each mapData.oreRocks tile as diggable, with original metal-bodied
// patina coloration identical to the town mine, registered in the same mesh table
// the outdoor ore rocks use (mineableRocksByTile/isMineableRockTile/
// removeZoneMineableRockVisual), so mining a cavern rock needs no new code.
// Den caverns and every cave-site history (js/cave-site-system.js — ore
// mines, the mineable chamber separator) go through this one builder.
(() => {
  'use strict';

  const CAVERN_ORE_TINTS = { stone: 0x8a8680, copper: 0xb87333, tinCopper: 0xb66a2e, mushistonite: 0xcd7f32, tin: 0xc8ccd0, lead: 0x6d7375, arsenic: 0xaaa58f, silver: 0xc4c8ce, gold: 0xd8b23a }; // Legacy/debug swatches show metal-bodied rock base hues; materialFor adds separate verdigris markings.

  const separatorCracks = new Map(); // Map id -> scene and live crack set, allowing O(1) removals when one mineable wall rock breaks.
  const rockMaps = new Map(); // Map id -> live ore mesh index; explosions never traverse the entire cave scene.
  const rockScenes = new Map(); // Map id -> scene owning the indexed ore meshes, used by Sense Mode to avoid stale caves.
  const SEPARATOR_ROCK_HEIGHT=2.25; // Visually closes the mineable corridor up to the cave roof, without changing one-rock-per-tile mining rules.
  function rockNoise(col,row,index,coordinate) {
    // Stable per-rock/per-vertex displacement: duplicate vertices remain welded after flat-shaded geometry is distorted.
    const n=Math.sin((col+1)*37.71+(row+1)*83.13+(index+1)*127.19+coordinate*51.77)*43758.5453;
    return n-Math.floor(n);
  }
  function separatorRockMass(THREE,rock,material) {
    if(typeof THREE.IcosahedronGeometry!=='function')return null; // Headless tooling without polyhedron geometry keeps the ordinary rock fallback.
    const group=new THREE.Group(); // One logical tile becomes a cluster of overlapping faceted boulders, never a rectangular cube.
    const lobes=[
      {x:0,y:1.08,z:0,r:.76,sx:.91,sy:1.47,sz:.91},
      {x:-.25,y:.49,z:.15,r:.49,sx:1.01,sy:.83,sz:.91},
      {x:.27,y:1.60,z:-.14,r:.47,sx:.85,sy:.95,sz:1.03},
    ]; // Irregular silhouettes merge visually with neighbouring mineable rocks; each entire tile still breaks as one piece.
    for(let i=0;i<lobes.length;i++){
      const shape=lobes[i],geometry=new THREE.IcosahedronGeometry(shape.r,1);
      const vertices=geometry.getAttribute?.('position'); // Use the existing Three.js buffer vertex contract; keep seam vertices identical.
      if(vertices){
        for(let j=0;j<vertices.count;j++){
          const x=vertices.getX(j),y=vertices.getY(j),z=vertices.getZ(j);
          const code=Math.round(x*400)+Math.round(y*400)*131+Math.round(z*400)*8191; // Same source corner on split faces gets the same deformation.
          const wobble=.88+rockNoise(rock.col,rock.row,i,code)*.24;
          vertices.setXYZ(j,x*wobble,y*wobble,z*wobble);
        }
        vertices.needsUpdate=true;
        geometry.computeVertexNormals?.();
      }
      const mesh=new THREE.Mesh(geometry,material);
      mesh.name='cave_separator_mineable_rock_mass';
      mesh.position.set(shape.x,shape.y,shape.z);
      mesh.scale.set(shape.sx,shape.sy,shape.sz);
      mesh.rotation.y=rockNoise(rock.col,rock.row,i,19)*Math.PI*2;
      mesh.castShadow=mesh.receiveShadow=true;
      mesh.userData.caveSeparatorMass=true; // Debug/Sense Mode can distinguish destructible wall rock from the immutable cavern shell.
      group.add(mesh);
    }
    group.userData.caveSeparatorHeight=SEPARATOR_ROCK_HEIGHT;
    return group;
  }
  function crackRibbons(THREE, col, row) {
    const group = new THREE.Group(); // Individual fracture faces, separate from the parent rock's solid hitbox.
    const vertices = []; // Batched ragged ribbons are the non-glowing analogue of Hronal exploding-pillar fissures.
    const radius = .37;
    for (let side = 0; side < 4; side++) {
      const axisX = side >= 2, sign = side % 2 ? -1 : 1;
      const points = [];
      for (let i = 0; i < 7; i++) {
        const h = .10 + i * .098, along = .085 * Math.sin(i*2.31 + col*3 + row*7 + side);
        points.push({ x:axisX ? sign*radius : along, y:h, z:axisX ? along : sign*radius });
      }
      for (let i = 0; i < points.length-1; i++) {
        const a=points[i],b=points[i+1],d=.014;
        const offset=axisX ? [0,0,d] : [d,0,0];
        const leftA=[a.x-offset[0],a.y,a.z-offset[2]],rightA=[a.x+offset[0],a.y,a.z+offset[2]];
        const leftB=[b.x-offset[0],b.y,b.z-offset[2]],rightB=[b.x+offset[0],b.y,b.z+offset[2]];
        vertices.push(...leftA,...rightA,...leftB,...rightA,...rightB,...leftB);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color:0x292a2d, side:THREE.DoubleSide, depthWrite:false,
      polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2,
    })); // Matte hairline cracks until Perception Mode's green interaction mask lights them.
    mesh.name = 'cave_separator_hronal_style_cracks';
    group.add(mesh);
    group.userData.caveSeparatorCracks = true;
    return group;
  }
  function senseTargets(scene) {
    // Every intact, diggable ore mound (including a separator's actual rock)
    // highlights, but the giant surrounding cave shell never does.
    const roots = []; // Scene-local ore groups; the per-tile index is already maintained by build/removeVisual.
    for (const [mapId, rocks] of rockMaps) {
      if (rockScenes.get(mapId) !== scene) continue;
      for (const group of rocks.values()) if (group.parent === scene) roots.push(group);
    }
    return roots;
  }

  function removeVisual(mapId,col,row) {
    const rocks = rockMaps.get(mapId) || deps?.zoneMineableRockMeshes?.get?.(mapId);
    const tileId = col+','+row;
    const group = rocks?.get(tileId);
    if (!group) return false;
    rocks.delete(tileId);
    const record = separatorCracks.get(mapId);
    for (const child of group.children) if (child.userData?.caveSeparatorCracks) record?.meshes.delete(child);
    group.parent?.remove(group);
    group.traverse(node => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        for (const material of node.material) if (!material?.userData?.sharedOreRockMaterial) material?.dispose?.();
      } else if (!node.material?.userData?.sharedOreRockMaterial) node.material?.dispose?.(); // Do not dispose shared ore textures while other rocks still display them.
    });
    return true;
  }

  let deps = null; // { TileType, markOutline, zoneMineableRockMeshes, oreDefs } from game.js.

  function init(injectedDeps) { deps = injectedDeps; }

  function build(mapId, mapData, scene, grid) {
    const THREE = window.THREE;
    // Fresh map each build (rather than reusing any Map left over from a
    // stale pre-Tothal-Shift cavern of the same mapId — see
    // forgetZoneDenState) so removeZoneMineableRockVisual never targets an
    // orphaned rock group from a layout that no longer exists.
    const oreRockMeshes = new Map();
    separatorCracks.delete(mapId); // The new scene replaces the old registry without retaining old render roots.
    rockMaps.set(mapId, oreRockMeshes); // Direct tile lookup for blasting, independent of scene graph size.
    rockScenes.set(mapId, scene); // Ignore leftover registries from other cave scenes during Sense Mode refresh.
    const cracks = new Set(); // O(1) removal from active Sense Mode fracture registration.
    if (mapData.oreRocks?.length) deps.zoneMineableRockMeshes.set(mapId, oreRockMeshes);
    for (const rock of (mapData.oreRocks || [])) {
      if (grid[rock.row]?.[rock.col]) {
        grid[rock.row][rock.col].type = deps.TileType.ROCK;
        grid[rock.row][rock.col].rockKind = 'diggableRockOre';
        grid[rock.row][rock.col].oreKind = rock.oreKind;
        // A real ore look (game.js ORE_DEFS key) drops that ore when mined,
        // through the same tile.oreKey path Town Mine nodes use; stone-look
        // rocks keep dropping stone only.
        grid[rock.row][rock.col].oreKey = deps.oreDefs?.[rock.oreKey || rock.oreKind] ? (rock.oreKey || rock.oreKind) : null;
        grid[rock.row][rock.col].caveSeparator = rock.caveSeparator === true; // Used by shattercask blast to clear all barrier strata.
      }
      const { stoneGeo } = window.TerrainGeometry.buildRockTileGeo(rock.col, rock.row);
      if (!stoneGeo) continue;
      const material=window.OreRockTextures.materialFor(THREE, rock.oreKey || rock.oreKind, deps.oreDefs); // Retain the authored ore textures and normal mining drop identities.
      const rockGroup = new THREE.Group();
      rockGroup.name = 'cave_ore_' + rock.col + '_' + rock.row; // Pickaxe and blast both retire this one tile-owned group.
      const mass=rock.caveSeparator?separatorRockMass(THREE,rock,material):null;
      if(mass){
        stoneGeo.dispose?.(); // The ordinary low floor mound is not used for a full-height, destructible cave partition.
        rockGroup.add(mass);
      }else{
        const rockMesh = new THREE.Mesh(stoneGeo, material); // Ordinary cave ore mounds remain unchanged outside rock barriers.
        window.OreRockTextures.fitRockMesh(rockMesh, `${mapId}:${rock.col},${rock.row}`); // Existing continuous UV fitting remains exclusive to normal cave ore mounds.
        rockMesh.castShadow = rockMesh.receiveShadow = true;
        rockGroup.add(rockMesh);
      }
      if (rock.caveSeparator) {
        const fracture = crackRibbons(THREE, rock.col, rock.row);
        rockGroup.add(fracture);
        cracks.add(fracture);
      }
      rockGroup.position.set(rock.col + 0.5, 0, rock.row + 0.5);
      scene.add(rockGroup);
      deps.markOutline(rockGroup);
      oreRockMeshes.set(`${rock.col},${rock.row}`, rockGroup);
    }
    if (cracks.size) separatorCracks.set(mapId, {scene,meshes:cracks});
    return oreRockMeshes;
  }

  window.CavernOreRocks = { init, build, senseTargets, removeVisual, CAVERN_ORE_TINTS };
})();

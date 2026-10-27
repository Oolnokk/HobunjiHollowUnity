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
      const rockMesh = new THREE.Mesh(stoneGeo, window.OreRockTextures.materialFor(THREE, rock.oreKey || rock.oreKind, deps.oreDefs)); // Recolored metal body and patina, shared across every cave and mine.
      window.OreRockTextures.fitRockMesh(rockMesh, `${mapId}:${rock.col},${rock.row}`); // Keep the earlier continuous UVs on cave ore rocks; no cliff-style facet remapping.
      rockMesh.castShadow = rockMesh.receiveShadow = true;
      const rockGroup = new THREE.Group();
      rockGroup.name = 'cave_ore_' + rock.col + '_' + rock.row; // Blast removes this exact rock mesh without rebuilding the cave.
      rockGroup.add(rockMesh);
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

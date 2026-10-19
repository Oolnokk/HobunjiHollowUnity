// Cavern ore rocks — extracted from game.js's loadBuildingScene cavern branch.
// Marks each mapData.oreRocks tile as a diggable ore rock and adds a tinted
// rock mesh to the interior scene, registered in the same per-map mesh table
// the outdoor ore rocks use (mineableRocksByTile/isMineableRockTile/
// removeZoneMineableRockVisual), so mining a cavern rock needs no new code.
// Den caverns and every cave-site history (js/cave-site-system.js — ore
// mines, the mineable chamber separator) go through this one builder.
(() => {
  'use strict';

  const CAVERN_ORE_TINTS = { stone: 0x8a8680, copper: 0xb0703a, tin: 0x9aa0a6, lead: 0x6d7375, arsenic: 0xaaa58f, silver: 0xc4c8ce, gold: 0xd8b23a }; // Stone plus game.js ORE_DEFS.

  const separatorCracks = new Map(); // Map id -> meshes exposed to Perception Mode only for mineable chamber separators.
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
    const result = [];
    for (const meshes of separatorCracks.values()) for (const root of meshes) {
      let parent = root;
      while (parent?.parent) parent = parent.parent;
      if (parent === scene) result.push(root);
    }
    return result;
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
    separatorCracks.delete(mapId); // Rebuilt cave scenes must not leave orphaned Sense Mode geometry.
    const cracks = []; // Local registered fracture roots for this map's Perception Mode pass.
    if (mapData.oreRocks?.length) deps.zoneMineableRockMeshes.set(mapId, oreRockMeshes);
    for (const rock of (mapData.oreRocks || [])) {
      if (grid[rock.row]?.[rock.col]) {
        grid[rock.row][rock.col].type = deps.TileType.ROCK;
        grid[rock.row][rock.col].rockKind = 'diggableRockOre';
        grid[rock.row][rock.col].oreKind = rock.oreKind;
        // A real ore look (game.js ORE_DEFS key) drops that ore when mined,
        // through the same tile.oreKey path Town Mine nodes use; stone-look
        // rocks keep dropping stone only.
        grid[rock.row][rock.col].oreKey = deps.oreDefs?.[rock.oreKind] ? rock.oreKind : null;
        grid[rock.row][rock.col].caveSeparator = rock.caveSeparator === true; // Used by shattercask blast to clear all barrier strata.
      }
      const { stoneGeo } = window.TerrainGeometry.buildRockTileGeo(rock.col, rock.row);
      if (!stoneGeo) continue;
      const rockMesh = new THREE.Mesh(stoneGeo, new THREE.MeshLambertMaterial({ color: CAVERN_ORE_TINTS[rock.oreKind] || CAVERN_ORE_TINTS.stone }));
      rockMesh.castShadow = rockMesh.receiveShadow = true;
      const rockGroup = new THREE.Group();
      rockGroup.add(rockMesh);
      if (rock.caveSeparator) {
        const fracture = crackRibbons(THREE, rock.col, rock.row);
        rockGroup.add(fracture);
        cracks.push(fracture);
      }
      rockGroup.position.set(rock.col + 0.5, 0, rock.row + 0.5);
      scene.add(rockGroup);
      deps.markOutline(rockGroup);
      oreRockMeshes.set(`${rock.col},${rock.row}`, rockGroup);
    }
    if (cracks.length) separatorCracks.set(mapId, cracks);
    return oreRockMeshes;
  }

  window.CavernOreRocks = { init, build, senseTargets, CAVERN_ORE_TINTS };
})();

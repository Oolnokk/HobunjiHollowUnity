// Cavern ore rocks — extracted from game.js's loadBuildingScene cavern branch.
// Marks each mapData.oreRocks tile as a diggable ore rock and adds a tinted
// rock mesh to the interior scene, registered in the same per-map mesh table
// the outdoor ore rocks use (mineableRocksByTile/isMineableRockTile/
// removeZoneMineableRockVisual), so mining a cavern rock needs no new code.
// Den caverns and every cave-site history (js/cave-site-system.js — ore
// mines, the mineable chamber separator) go through this one builder.
(() => {
  'use strict';

  const CAVERN_ORE_TINTS = { stone: 0x8a8680, copper: 0xb0703a, tin: 0x9aa0a6, lead: 0x6d7375, arsenic: 0xaaa58f, silver: 0xc4c8ce, gold: 0xd8b23a, crystal: 0x8fd6e0 }; // Ore kinds from game.js ORE_DEFS; no iron in this world.

  let deps = null; // { TileType, markOutline, zoneMineableRockMeshes } from game.js.

  function init(injectedDeps) { deps = injectedDeps; }

  function build(mapId, mapData, scene, grid) {
    const THREE = window.THREE;
    // Fresh map each build (rather than reusing any Map left over from a
    // stale pre-Tothal-Shift cavern of the same mapId — see
    // forgetZoneDenState) so removeZoneMineableRockVisual never targets an
    // orphaned rock group from a layout that no longer exists.
    const oreRockMeshes = new Map();
    if (mapData.oreRocks?.length) deps.zoneMineableRockMeshes.set(mapId, oreRockMeshes);
    for (const rock of (mapData.oreRocks || [])) {
      if (grid[rock.row]?.[rock.col]) {
        grid[rock.row][rock.col].type = deps.TileType.ROCK;
        grid[rock.row][rock.col].rockKind = 'diggableRockOre';
        grid[rock.row][rock.col].oreKind = rock.oreKind;
      }
      const { stoneGeo } = window.TerrainGeometry.buildRockTileGeo(rock.col, rock.row);
      if (!stoneGeo) continue;
      const rockMesh = new THREE.Mesh(stoneGeo, new THREE.MeshLambertMaterial({ color: CAVERN_ORE_TINTS[rock.oreKind] || CAVERN_ORE_TINTS.stone }));
      rockMesh.castShadow = rockMesh.receiveShadow = true;
      const rockGroup = new THREE.Group();
      rockGroup.add(rockMesh);
      rockGroup.position.set(rock.col + 0.5, 0, rock.row + 0.5);
      scene.add(rockGroup);
      deps.markOutline(rockGroup);
      oreRockMeshes.set(`${rock.col},${rock.row}`, rockGroup);
    }
    return oreRockMeshes;
  }

  window.CavernOreRocks = { init, build, CAVERN_ORE_TINTS };
})();

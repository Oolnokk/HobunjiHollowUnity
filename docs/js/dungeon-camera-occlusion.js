// Game-parity camera occlusion helper for standalone dungeon playtests.
// Mirrors game.js occlusionSafeCameraPosition: pull in before the first obstacle,
// keep at least 3 tiles of distance, and lift as the camera is forced closer.
(() => {
  'use strict';
  const VERSION = '1.0.0'; // Reported by the generator debug panel.
  const CAMERA_FLOOR_CLEARANCE = 0.2; // Same minimum floor clearance used by game.js.
  const HIT_PADDING = 0.6; // Same stop-short distance used by game.js.
  const MIN_SAFE_DISTANCE = 3; // Same minimum camera distance used by game.js.
  let session = null; // Holds the active playtest camera solve loop.

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function collectObstacles(scene) {
    // Generator marks wall/elevation groups and blocking furniture as camera obstacles.
    const out = [];
    scene?.traverse?.(object => {
      if (object?.userData?.cameraObstacle === true) out.push(object);
    });
    return out;
  }

  function solve(THREE, raycaster, obstacles, lookAt, ideal, floorY) {
    let resultX = ideal.x, resultY = ideal.y, resultZ = ideal.z;
    let directHitDistance = null;
    const dx = ideal.x - lookAt.x, dy = ideal.y - lookAt.y, dz = ideal.z - lookAt.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= 0.5 && obstacles?.length) {
      const dir = new THREE.Vector3(dx / dist, dy / dist, dz / dist);
      raycaster.set(new THREE.Vector3(lookAt.x, lookAt.y, lookAt.z), dir);
      raycaster.near = 0.3;
      raycaster.far = dist;
      const hits = raycaster.intersectObjects(obstacles, true);
      if (hits.length) {
        directHitDistance = hits[0].distance;
        const safeDist = Math.max(MIN_SAFE_DISTANCE, hits[0].distance - HIT_PADDING);
        const shrink = clamp(1 - safeDist / dist, 0, 1);
        const lift = shrink * dist * 0.5;
        resultX = lookAt.x + dir.x * safeDist;
        resultY = lookAt.y + dir.y * safeDist + lift;
        resultZ = lookAt.z + dir.z * safeDist;
      }
    }

    // Same floor guard idea as game.js: slide along the sightline instead of only clamping Y.
    const minCameraY = Number(floorY || 0) + CAMERA_FLOOR_CLEARANCE;
    if (resultY < minCameraY) {
      const sx = resultX - lookAt.x, sy = resultY - lookAt.y, sz = resultZ - lookAt.z;
      if (sy < -1e-4) {
        const t = clamp((minCameraY - lookAt.y) / sy, 0, 1);
        resultX = lookAt.x + sx * t;
        resultY = lookAt.y + sy * t;
        resultZ = lookAt.z + sz * t;
      } else {
        resultY = minCameraY;
      }
    }

    return {
      x: resultX, y: resultY, z: resultZ,
      idealDistance: dist,
      directHitDistance,
      solvedDistance: Math.hypot(resultX - lookAt.x, resultY - lookAt.y, resultZ - lookAt.z)
    };
  }

  function detach() {
    if (!session) return false;
    session.active = false;
    if (session.raf) cancelAnimationFrame(session.raf);
    session = null;
    return true;
  }

  function attach(options = {}) {
    detach();
    const THREE = window.THREE;
    const scene = options.scene;
    const camera = options.camera;
    const playerName = options.playerName || 'dungeon_playtest_player';
    if (!THREE || !scene || !camera) throw new Error('THREE, scene and camera are required for dungeon camera occlusion.');
    const raycaster = new THREE.Raycaster();
    const state = {
      active: true,
      scene,
      camera,
      playerName,
      obstacles: collectObstacles(scene),
      raycaster,
      raf: 0,
      debug: { obstacleCount: 0, directHitDistance: null, idealDistance: 0, solvedDistance: 0 }
    };
    state.debug.obstacleCount = state.obstacles.length;
    session = state;

    const frame = () => {
      if (!state.active || session !== state) return;
      const player = scene.getObjectByName(playerName);
      if (player) {
        // Runtime writes the ideal game camera first each frame; this helper runs afterward and only shortens that line of sight.
        const lookAt = { x: player.position.x, y: player.position.y, z: player.position.z };
        const ideal = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        const solved = solve(THREE, raycaster, state.obstacles, lookAt, ideal, player.position.y);
        camera.position.set(solved.x, solved.y, solved.z);
        camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
        state.debug = { obstacleCount: state.obstacles.length, ...solved };
      }
      state.raf = requestAnimationFrame(frame);
    };
    state.raf = requestAnimationFrame(frame);
    return {
      detach,
      refreshObstacles() {
        if (session === state) {
          state.obstacles = collectObstacles(scene);
          state.debug.obstacleCount = state.obstacles.length;
        }
        return state.obstacles.length;
      },
      debugSnapshot: () => ({ ...state.debug })
    };
  }

  window.HobunjiDungeonCameraOcclusion = Object.freeze({
    VERSION,
    attach,
    detach,
    collectObstacles,
    solve,
    debugSnapshot: () => session ? { ...session.debug } : null
  });
})();

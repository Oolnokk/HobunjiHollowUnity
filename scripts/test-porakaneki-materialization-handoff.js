const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cfg = JSON.parse(fs.readFileSync('docs/config/porakaneki-camp.json', 'utf8')); // LOD invariants remain owned by the camp config.
const runtime = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8'); // Camp runtime must still delegate locomotion to the shared hostile path.
const guardSource = fs.readFileSync('docs/js/porakaneki-materialization-guard.js', 'utf8'); // Executed below to test the real async builder wrapper.
const snapshot = fs.readFileSync('docs/js/wilderness-ai-snapshot.js', 'utf8'); // Mobile diagnostics must retain handoff visibility.
const houseLoader = fs.readFileSync('docs/js/house-pieces.js', 'utf8'); // Parser-time ordering must install the guard before PorakanekiCamps.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards the shared return locomotion plus render-sync path the live entity relies on.

assert(cfg.behavior.fullSimulationRadiusTiles > 0);
assert(cfg.behavior.fullSimulationReleaseRadiusTiles > cfg.behavior.fullSimulationRadiusTiles,
  'Porakaneki detailed-simulation LOD must use hysteresis');
assert(runtime.includes('distance <= (detailedEntityActive(hunter) ? fullSimulationReleaseRadiusTiles() : fullSimulationRadiusTiles())'),
  'LOD must be radial with the wider release radius for already-live residents');
assert(runtime.includes("entity.state = 'return'"),
  'neutral planner must delegate actual locomotion/rendering to the shared hostile return path');
assert(!runtime.includes('combatDeps.moveCreatureToward?.(entity'),
  'Porakaneki planner must not independently move the live entity alongside updateHostiles');
assert(runtime.indexOf('updateAllHunters(step, coarseStep);') < runtime.indexOf('updateTerritoryWarnings();'),
  'materialization must be attempted before territory warning delivery');
assert(runtime.includes('allowToastFallback: false'),
  'territory warnings must stay pending for Ambient Dialogue instead of degrading to a toast');
assert(snapshot.includes('renderDelta') && snapshot.includes('registered') && snapshot.includes('plannerControlled'),
  'mobile snapshot must expose render/simulation handoff diagnostics');

const guardLoaderIndex = houseLoader.indexOf("['PorakanekiMaterializationGuard', 'porakaneki-materialization-guard.js?v=20260915handoff1']"); // Ensures the new wrapper is actually parser-loaded in gameplay.
const campLoaderIndex = houseLoader.indexOf("['PorakanekiCamps', 'porakaneki-camps-runtime.js?v=20260915materialization1']"); // Existing runtime entry used to verify ordering against the guard.
assert(guardLoaderIndex >= 0 && campLoaderIndex > guardLoaderIndex,
  'materialization guard must load before PorakanekiCamps wraps BanditCombat.init');
assert(gameSource.includes("} else if (c.state === 'return') {"),
  'game.js must retain the shared return-state branch used by neutral Porakaneki');
assert(gameSource.includes('moving = travelCreatureToward(c, c.homeX, c.homeY, def.moveSpeed, entityDt);'),
  'shared hostile return state must own Porakaneki simulation movement');
assert(gameSource.includes('updateCreatureMesh(c, entityDt, aimAngle);'),
  'shared hostile loop must continue synchronizing simulation movement into the PNG avatar');

async function runMaterializationGuardRegression() {
  let currentArea = 'map_western_slope'; // Mutated during the stale-build case to simulate leaving the wilderness while portrait creation awaits.
  let flipAreaDuringBuild = false; // Test hook makes the fake async builder complete after the active area changes.
  let lastEntity = null; // Captures the most recently built entity so stale-build cleanup can be inspected after the wrapper returns null.
  let lastForwardedOptions = null; // Captures wrapper-supplied scene/grid options to prove the build is pinned to the requested zone.
  const logLines = []; // Collects the rare stale-materialization diagnostic exposed to the in-game debug log.
  const targetGrid = Array.from({ length: 8 }, () => Array.from({ length: 9 }, () => ({ type: 'grass' }))); // Stable requested-zone grid expected to reach BanditCombat.
  const targetScene = {
    removed: [], // Records detached scene objects for orphan-cleanup assertions below.
    add(object) { object.parent = this; },
    remove(object) {
      this.removed.push(object);
      if (object?.parent === this) object.parent = null;
    },
  }; // Stable requested-zone scene expected to own every built visual.

  function sceneObject() {
    return { parent: null };
  }

  const banditCombat = {
    init() { return 'bandit-init'; },
    async makeEntity(_base, _rank, _tier, x, y, options) {
      lastForwardedOptions = options;
      const group = sceneObject(); // PNG avatar root added to the scene exactly as combat-bandit.js does.
      const groundShadow = sceneObject(); // Separate scene object verifies stale cleanup does not stop at avatar geometry disposal.
      const toolHolder = sceneObject(); // Melee holder mirrors BanditCombat's separately-parented tool object.
      const rangedHolder = sceneObject(); // Ranged holder covers the optional second tool object as well.
      options.scene?.add?.(group);
      options.scene?.add?.(groundShadow);
      options.scene?.add?.(toolHolder);
      options.scene?.add?.(rangedHolder);
      const avatarRef = {
        group,
        disposed: false,
        dispose() { this.disposed = true; },
      }; // Raw PNG dispose intentionally leaves parentage alone, matching the production renderer contract.
      const entity = {
        id: 'guard-test-porakaneki',
        x,
        y,
        homeX: x,
        homeY: y,
        state: 'idle',
        def: { aggroRangePx: 360, moveSpeed: 118 },
        avatarRef,
        groundShadow,
        _banditToolHolder: toolHolder,
        _banditRangedToolHolder: rangedHolder,
      }; // Ordinary bandit-shaped entity begins in the exact unsafe idle/aggro-capable state under test.
      lastEntity = entity;
      if (flipAreaDuringBuild) currentArea = 'town';
      return entity;
    },
  }; // Fake shared builder preserves the production scene-parenting and initial-state contracts the guard must harden.

  const contextWindow = {
    BanditCombat: banditCombat,
    __farmLog: message => logLines.push(String(message)),
  }; // Browser global supplied to the real guard source below.
  contextWindow.window = contextWindow;
  const context = vm.createContext({ window: contextWindow, console, Object, Number, String, Array, Math, Promise }); // Minimal browser-shaped VM executes the checked-in guard unchanged.
  vm.runInContext(guardSource, context, { filename: 'porakaneki-materialization-guard.js' });

  const deps = {
    zoneScenes: new Map([['map_western_slope', { scene: targetScene, grid: targetGrid }]]),
    getCurrentArea: () => currentArea,
  }; // Same dependency surfaces used by production BanditCombat and PorakanekiCamps.
  assert.equal(contextWindow.BanditCombat.init(deps), 'bandit-init');

  const options = {
    zoneId: 'map_western_slope',
    extra: { isPorakanekiHunter: true },
  }; // Porakaneki marker selects the guard without altering ordinary bandit builds.
  const entity = await contextWindow.BanditCombat.makeEntity({}, 'grunt', 0, 120, 180, options); // Successful same-area build should return fully handoff-ready.
  assert(entity, 'same-zone Porakaneki materialization should survive the guard');
  assert.equal(lastForwardedOptions.scene, targetScene, 'async build must be pinned to the requested zone scene');
  assert.equal(lastForwardedOptions.grid, targetGrid, 'async build must be pinned to the requested zone grid');
  assert.equal(lastForwardedOptions.rows, 8);
  assert.equal(lastForwardedOptions.cols, 9);
  assert.equal(entity.state, 'return', 'builder result must already be neutral before PorakanekiCamps can publish it to hostileObjects');
  assert.equal(entity._porakanekiPlannerControlled, true);
  assert.equal(entity._porakanekiMaterializationReady, true);
  assert.equal(entity.def.aggroRangePx, 0, 'new resident cannot acquire ordinary bandit aggro before the 5 Hz Porakaneki planner tick');
  assert.equal(entity._porakanekiAggroRangePx, 360, 'original aggro range remains available for later provocation');
  assert.equal(entity._porakanekiBaseMoveSpeed, 118, 'original move speed remains available for later hostile restoration');
  assert.equal(entity.homeX, entity.x);
  assert.equal(entity.homeY, entity.y);

  entity.avatarRef.dispose();
  assert.equal(entity.avatarRef.disposed, true, 'guard preserves the renderer\'s original resource disposal');
  assert.equal(entity.avatarRef.group.parent, null, 'scene-aware disposal also detaches the PNG root');
  assert.equal(entity.groundShadow.parent, null, 'scene-aware disposal detaches the shadow');
  assert.equal(entity._banditToolHolder.parent, null, 'scene-aware disposal detaches the melee tool');
  assert.equal(entity._banditRangedToolHolder.parent, null, 'scene-aware disposal detaches the ranged tool');

  currentArea = 'map_western_slope';
  flipAreaDuringBuild = true;
  const stale = await contextWindow.BanditCombat.makeEntity({}, 'grunt', 0, 240, 300, options); // Simulates player navigation completing while the portrait builder is awaiting.
  assert.equal(stale, null, 'an entity that finishes building after the player leaves its zone must never reach PorakanekiCamps');
  assert(lastEntity, 'stale async build still produced an entity that requires cleanup');
  assert.equal(lastEntity.avatarRef.disposed, true, 'stale async build disposes PNG resources');
  assert.equal(lastEntity.avatarRef.group.parent, null, 'stale async build cannot leave a frozen orphan PNG plane in its scene');
  assert.equal(lastEntity.groundShadow.parent, null, 'stale async build cannot leave an orphan shadow');
  assert.equal(lastEntity._banditToolHolder.parent, null, 'stale async build cannot leave an orphan tool');
  assert(logLines.some(line => line.includes('discarded stale materialization')),
    'stale build rejection remains visible in the copyable in-game debug log');
}

runMaterializationGuardRegression()
  .then(() => console.log('Porakaneki materialization handoff regression checks passed.'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });

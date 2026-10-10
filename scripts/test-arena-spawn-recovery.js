'use strict';
const assert = require('node:assert/strict'); // Verifies caught asynchronous spawn failures and retry using production helpers.
const fs = require('node:fs'); // Reads existing spawner and humanoid factory owners.
const vm = require('node:vm'); // Supplies deterministic constructors without loading a whole game scene.
const spawner = fs.readFileSync('docs/js/dev-spawner.js','utf8');
const bandits = fs.readFileSync('docs/js/combat/combat-bandit.js','utf8');
const nodes = {devSpawnBtnAction:{},devSpawnStatus:{}}; // Captures visible pending/result state.
const logs=[],toasts=[]; // Mobile report and toast evidence survive a rejected build.
let fail=true,area='map_dev_arena'; // First constructor rejection must not disable subsequent attempts.
const context={DEV_ARENA_ZONE_ID:'map_dev_arena',DEV_SPAWN_PORAKANEKI_KEY:'porakaneki:enemy',DEV_SPAWN_HARLYAO_SKELETON_KEY:'harlyao-skeleton:enemy',devSpawnSelectedKey:'bandit:grunt',devSpawnBanditTier:1,_arenaSpawnedCreatures:new Set(),renderDevSpawnPanel(){},document:{getElementById:id=>nodes[id]||null},deps:{getCurrentArea:()=>area,player:{x:10,y:20},TILE:10,hostileObjects:new Set(),showToast:msg=>toasts.push(msg)},window:{__farmLog:msg=>logs.push(msg),BanditCombat:{loadGangConfig:async()=>({}),makeEntity:async()=>{if(fail)throw Error('portrait fixture failed');return {id:'bandit',def:{}};},characterBuildSnapshot:()=>({stage:'combat-portrait',error:'portrait fixture failed'})},MinionCombat:{makeEntity:async()=>({id:'skeleton',def:{}})}},console:{log(){}}}; // Real spawn registration runs with small factory seams.
vm.createContext(context);
function execute(start,end){const at=spawner.indexOf(start);vm.runInContext(spawner.slice(at,spawner.indexOf(end,at)),context);}
execute('  function spawnDevArenaCreature(', '  // Bandit counterpart');
execute('  async function spawnDevArenaBandit(', '  // Porakaneki counterpart');
execute('  async function spawnDevArenaHarlyaoSkeleton(', '  async function spawnDevArenaHarlyaoLich(');
execute('  let spawnRequestSerial', '  function _bindListeners()');
(async()=>{
  assert.equal(await context.spawnSelectedDevArenaCreature(),false,'rejected async factory is caught');
  assert.equal(nodes.devSpawnBtnAction.disabled,false,'failure restores button for retry');
  assert(nodes.devSpawnStatus.textContent.includes('portrait fixture failed'),'actual exception appears in panel');
  assert(logs[0].includes('portrait fixture failed'),'copyable log retains error');
  assert.equal(context.spawnSnapshot().humanoidBuild.stage,'combat-portrait');
  fail=false;
  assert.equal(await context.spawnSelectedDevArenaCreature(),true,'second attempt can succeed');
  assert.equal(context.deps.hostileObjects.size,1,'bandit becomes a targetable real hostile');
  context.devSpawnSelectedKey='harlyao-skeleton:enemy';
  assert.equal(await context.spawnSelectedDevArenaCreature(),true,'skeleton uses its existing Minion factory');
  assert.equal(context.deps.hostileObjects.size,2);
  area='farm';
  assert.equal(await context.spawnSelectedDevArenaCreature(),false,'wrong-area request reports cancellation');
  assert.equal(context.deps.hostileObjects.size,2,'cannot spawn an arena actor outside the arena');
  area='map_dev_arena';
  context.devSpawnSelectedKey='bandit:grunt';
  context.window.BanditCombat.loadGangConfig=async()=>null;
  assert.equal(await context.spawnSelectedDevArenaCreature(),false);
  assert(nodes.devSpawnStatus.textContent.includes('bandit-gang-config.json'),'failed config reason survives in mobile status');

  context.devSpawnSelectedKey='uumkaoii'; // Arena prey must use wilderness registration rather than becoming immune companions.
  context.deps.CREATURE_DB={uumkaoii:{hostile:false}};
  context.window.CreatureGenetics={SPECIES_ALIAS:{},makeDefaultGenotype:()=>({})};
  let prey=null; // Actual production spawn path registers this entity in the same collection weapon collision reads.
  context.deps.makeCreatureEntity=()=>{prey={id:'prey',isCompanion:true};return prey;};
  context.deps.companionObjects=new Set();
  assert.equal(await context.spawnSelectedDevArenaCreature(),true);
  assert.equal(prey.isCompanion,false);assert.equal(prey.master,null);
  assert(context.deps.hostileObjects.has(prey),'prey enters the real targeting/projectile collision collection');
  assert.equal(context.deps.companionObjects.size,0,'arena prey cannot become immune player companions');

  let teleportArea='interior'; // Farmhouse-style entry must switch area before constructing an arena actor.
  const scene={add(){},remove(){}}; // Teleport reparents existing player/reticle roots through the real helper.
  const teleportContext={DEV_ARENA_ZONE_ID:'map_dev_arena',_devArenaReturnAnchor:null,window:{},deps:{getCurrentArea:()=>teleportArea,setCurrentArea:value=>{teleportArea=value;},player:{x:10,y:20},TILE:10,_isBuildingArea:()=>false,setCurrentBuildingMapId(){},startSceneTransition:callback=>callback(),getActiveScene:()=>scene,_snapCameraTarget(){},refreshActionBar(){},showToast(){},closeMenu(){},buildZoneScene:id=>{assert.equal(id,'map_dev_arena');assert.equal(teleportArea,id);return {scene};},EXTERIOR_ZONES:{map_dev_arena:{entryCol:2,entryRow:3}}}};
  const teleportStart=spawner.indexOf('  function _addPlayerToScene(');
  vm.runInNewContext(spawner.slice(teleportStart,spawner.indexOf('  // Wilderness Chunk Lab:',teleportStart)),teleportContext);
  teleportContext.teleportToDevArena();
  assert.equal(teleportArea,'map_dev_arena','farmhouse teleport establishes arena authority');
  assert.equal(teleportContext.deps.player.x,25);
  assert.equal(teleportContext.deps.player.y,35);

  let requests=0; // Shared gang config must retry after a transient failed request.
  const configContext={deps:{debugLog(){}},fetch:async()=>{requests++;return requests===1?{ok:false,status:503}:{ok:true,json:async()=>({ready:true})};}};
  const start=bandits.indexOf('  let _banditConfigPromise');
  vm.runInNewContext(bandits.slice(start,bandits.indexOf('  let _banditLocaleDefsPromise',start)),configContext);
  assert.equal(await configContext.loadBanditGangConfig(),null);
  assert.equal((await configContext.loadBanditGangConfig()).ready,true,'failed configuration cache is released');
  await configContext.loadBanditGangConfig();assert.equal(requests,2,'successful config retains shared memoization');

  let failBuild=true; // Rejected portraits must release the queue for later arena spawns.
  const queueContext={deps:{getCurrentArea:()=>area},buildBanditAvatar:async()=>{if(failBuild)throw Error('bad pixels');return {ready:true};}};
  const queueStart=bandits.indexOf('  let characterBuildStatus');
  vm.runInNewContext(bandits.slice(queueStart,bandits.indexOf('  async function makeBanditEntity(',queueStart)),queueContext);
  await assert.rejects(queueContext.buildQueuedBanditAvatar({appearance:{speciesId:'mao-ao'}},area),/bad pixels/);
  failBuild=false;
  assert.equal((await queueContext.buildQueuedBanditAvatar({appearance:{speciesId:'harlyao-skeleton'}},area)).ready,true,'next portrait build is not stranded');
  console.log('arena bandit/skeleton rejection, real registration, status, retry, and build queue checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

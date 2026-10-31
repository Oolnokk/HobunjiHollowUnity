#!/usr/bin/env node
'use strict';
// Regression: Garanki's three-stone exchange, world-persistent diggable vault,
// fixed zero-puzzle interior, bird decal path, and proximity signal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = name => fs.readFileSync('docs/js/' + name + '.js', 'utf8'); // Authoritative shipped modules, never copied logic.
for (const name of ['delvers-guild-story','ruin-sites','dev-random-ruin-interior-map','delvers-vault-signal']) {
  new vm.Script(source(name), {filename:name+'.js'}); // Check parser compatibility for every new runtime seam.
}

// The actual Guild module sees the same live quest and inventory adapters game.js provides.
(async () => {
  let world = {delversGuild:{invited:true,member:true,trusted:true}}; // Shared world story store persists quest phases.
  const quests = {}; // TasksPanel's actual kind/status/progress shape is reused.
  const inventory = {delversStone:1,azgarlu_key_stone:1,nanahi_key_stone:1,imlao_key_stone:1}; // Three defeated lich rewards.
  const defs = {}, items = [], scenes = [], toasts = []; // Inventory catalog, cutscenes, and diagnostics from the real code.
  let saves = 0; // Ensures every physical transfer persists.
  const profile = {worldId:'story-vault-world',characterId:'player',isWorldOwner:true};
  const window = {
    __hobunjiPlayerProfile:profile,__hobunjiGameStarted:true,
    OpeningStoryCutscene:{
      getStory:()=>world,
      updateStory:(_profile,patch)=>{world={...world,...patch};return true;},
    },
    ArtifactCollection:{unlocked:()=>true,value:()=>4},
    LocalDBOverrides:{loadDatabase:async()=>({npcs:[{id:'garanki_gabu'}]})},
    AuthoredCutsceneRuntime:{
      async run(scene,callbacks) {
        scenes.push(scene);
        const key = scene.title.includes('Talisman') ? 'talisman_final' : 'vault_report_final';
        callbacks.onDialogueContinue(scene.stages.find(stage=>stage.id===key));
      },
    },
    TasksPanel:{render(){}},DoorstepVisits:{registerProvider(){}},
    DevCompanion:{registerStateProvider(){}},
    RuinSites:{syncMapMarkers(){}},setTimeout:callback=>callback(),__farmLog(){},
  };
  const context = vm.createContext({window,document:{addEventListener(){}},console});
  vm.runInContext(source('delvers-guild-story'),context);
  const guild = window.DelversGuild; // This is the production API tested by the real dialogue handoff.
  guild.bindInventoryDeps({ITEM_DEFS:defs,inventoryItems:items,inventory,
    saveMemberWorldData(){saves++;},buildInventoryGrid(){},showToast(message){toasts.push(message);}});
  guild.bindQuestDeps({getQuestProgress:()=>quests});
  guild.syncQuest();
  assert.equal(quests[guild.QUEST_ID].progress.ready,true);
  assert.equal(guild.dialogueTree().id,'garanki_talisman_handoff');
  assert.equal(await guild.runHandoff('assemble'),true);
  assert.equal(guild.hasTalisman(),true);
  assert.equal(inventory[guild.TALISMAN_KEY],1);
  assert(guild.KEY_STONES.every(key=>inventory[key.id]===0));
  assert.equal(guild.grantKeyStone('azgarlu'),false,'the same guardian cannot re-award a consumed quest component');
  inventory[guild.TALISMAN_KEY]=0; // Simulate a crash after the world-scoped exchange but before member inventory was committed.
  assert.equal(guild.restoreTalisman(),true,'saved search phase must recover the physical talisman on reload');
  assert.equal(inventory[guild.TALISMAN_KEY],1);
  assert.equal(guild.vaultPhase(),'search');
  assert.match(quests[guild.QUEST_ID].progress.objective,/Western Slope/);
  assert.equal(await guild.runHandoff('assemble'),false); // A second handoff cannot silently mint a new talisman.
  assert.equal(inventory[guild.TALISMAN_KEY],1);

  assert.equal(guild.saveVaultSite({zoneId:guild.VAULT_ZONE,col:24,row:26,cycle:3,revealed:false}),true);
  assert.equal(guild.uncoverVault(),true);
  assert.equal(guild.investigateVault(),true);
  assert.equal(guild.vaultPhase(),'report');
  assert.match(quests[guild.QUEST_ID].progress.objective,/Return to Garanki/);
  assert.equal(guild.dialogueTree().nodes[0].options[0].text,'--explain what you saw--');
  assert.equal(await guild.runHandoff('report'),true);
  assert.equal(inventory[guild.TALISMAN_KEY],0);
  assert.equal(guild.vaultPhase(),'complete');
  assert.equal(quests[guild.QUEST_ID].status,'complete');
  assert.equal(await guild.runHandoff('report'),false);
  assert.equal(scenes.length,2);
  assert(scenes[1].stages.some(stage=>String(stage.text).includes('bird footprints')));
  assert(saves>=4);

  // A separate RuinSites instance gets only its own infrastructure and the real
  // DelversGuild-style world-scoped site protocol, not a precomputed hole.
  let year = 1, phase = 'search', site = null; // Emulates a Tothal Shift without clearing world quest state.
  const zone = 'map_western_slope', trench = 'trench';
  const grid = () => Array.from({length:55},()=>Array.from({length:55},()=>({type:'grass',water:0})));
  let zoneScene = {grid:grid(),cols:55,rows:55,scene:null};
  const zones = new Map([[zone,zoneScene]]);
  const layouts = new Map([[zone,{objects:[],dens:[],buildings:[],localeInstances:[]}]]);
  const story = {
    vaultPhase:()=>phase,hasTalisman:()=>true,vaultSite:()=>site,
    saveVaultSite:newSite=>{site=newSite;return true;},
    uncoverVault:()=>{site={...site,revealed:true};return true;},
  };
  const ruinWindow = {THREE:{},RuinSiteLocales:{CATEGORY:'ruin_entrance',
    hashString(text){let n=2166136261;for(const char of text)n=Math.imul(n^char.charCodeAt(0),16777619)>>>0;return n;}},
    AuthoredFurniture:{load:()=>Promise.resolve({})},
    WildTreasure:{syncZoneInteractivity(){}},DelversGuild:story};
  const localStorage = {getItem:()=>null,setItem(){}};
  const siteContext = vm.createContext({window:ruinWindow,localStorage,setTimeout:fn=>fn(),console});
  vm.runInContext(source('ruin-sites'),siteContext);
  const sites = ruinWindow.RuinSites;
  sites.init({_zoneScenes:zones,_zoneLayouts:layouts,tothalWorldId:()=>profile.worldId,
    currentTothalYear:()=>year,TileType:{TRENCH:trench,GRASS:'grass',ROCK:'rock',RAMP:'ramp'},
    findZoneFlatEmptyTiles:()=>[{col:year===1?20:35,row:year===1?23:36}],
    getCurrentArea:()=>zone,showToast(){},refreshActionBar(){}});
  assert.equal(sites.storyVaultSite().col,20);
  assert.equal(site.revealed,false);
  zoneScene.grid[23][20].type=trench;
  ruinWindow.WildTreasure.syncZoneInteractivity(zone); // Exactly the normal post-dig terrain callback.
  assert.equal(site.revealed,true);
  assert(layouts.get(zone).localeInstances.some(entry=>entry.localeId==='garanki_story_vault'));
  year=2;
  zones.set(zone,zoneScene={grid:grid(),cols:55,rows:55,scene:null});
  assert.equal(sites.storyVaultSite().col,35);
  assert.equal(site.revealed,true);
  assert.equal(zoneScene.grid[36][35].type,trench); // Excavated locale stays open when the world shifts.
  phase='complete';
  sites.syncMapMarkers();
  assert.equal(sites.storyVaultSite(),null);
  assert(!layouts.get(zone).localeInstances.some(entry=>entry.localeId==='garanki_story_vault'));

  // The fixed interior uses the real ruin renderer's building-scene slot,
  // but never calls V50, never rolls a puzzle, and never registers the
  // fractured great door as a collision blocker.
  class Node {
    constructor() {
      this.children=[];this.parent=null;this.userData={};this.visible=true;this.name='';
      this.position={set(){}};
      this.rotation={x:0,y:0,z:0};
      this.scale={set(){},setScalar(){}};
    }
    add(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
    remove(n){this.children=this.children.filter(child=>child!==n);n.parent=null;}
    traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
  }
  class Mesh extends Node {constructor(geometry,material){super();this.isMesh=true;this.geometry=geometry;this.material=material;}}
  const T={Group:Node,Scene:Node,Mesh,BoxGeometry:class{},PlaneGeometry:class{},MeshBasicMaterial:class{
    constructor(raw){Object.assign(this,raw);}
  },Box3:class{},Color:class{},DoubleSide:2,SRGBColorSpace:'srgb'};
  let area=zone, imageSource=null;
  const buildingScenes=new Map(),player={x:22*32,y:23*32,vx:0,vy:0};
  const DS={clearScope(){},registerSurface(){},sampleSupport:()=>({id:'floor',y:0}),addBeforeRenderClient(){}};
  const ruinRuntimeWindow={
    DynamicSurfaces:DS,DevSpawner:{init(){}},GridTileAccessors:{init(){}},
    DevRandomRuinTileOccupancy:{},DevRandomRuinSolvability:{},
    DelversGuild:{hasTalisman:()=>true,vaultPhase:()=> 'search'},
  };
  const areaDeps={player,TILE:32,getCurrentArea:()=>area,setCurrentArea:id=>{area=id;},
    startSceneTransition:callback=>callback(),getActiveScene:()=>buildingScenes.get(area)?.scene||null,
    showToast(){},refreshActionBar(){},closeMenu(){},_snapCameraTarget(){},setCurrentBuildingMapId(){},
    TileType:{GRASS:'grass',ROCK:'rock'}};
  class ImageStub {set src(src){imageSource=src;}} // We test path/orientation, not browser PNG decoding in Node.
  const runtimeContext=vm.createContext({window:ruinRuntimeWindow,document:{readyState:'loading',addEventListener(){},getElementById(){return null;}},
    THREE:T,performance:{now:()=>1000},Image:ImageStub,localStorage:{getItem:()=>null},setTimeout,console});
  vm.runInContext(source('dev-random-ruin-interior-map'),runtimeContext);
  ruinRuntimeWindow.GridTileAccessors.init({_buildingScenes:buildingScenes});
  ruinRuntimeWindow.DevSpawner.init(areaDeps);
  const ruin=ruinRuntimeWindow.DevRandomRuin;
  assert.equal(await ruin.generateStoryVault({returnAnchor:{area:zone,x:player.x,y:player.y}}),true);
  const current=ruin.getRuntimeContext();
  assert.equal(area,'map_i_dev_random_ruin');
  assert.equal(current.floorSet.size,135);
  const names=[];
  current.root.traverse(node=>{if(node.name)names.push(node.name);});
  assert.equal(names.filter(n=>n.startsWith('hachutu_bird_footprint_')).length,66);
  assert.equal(names.filter(n=>n.startsWith('noncolliding_great_door_fragment_')).length,18);
  assert(names.includes('story_vault_empty_altar'));
  assert.equal(ruin.getInteractionControls().length,1);
  assert.equal(imageSource,'assets/textures/decals/footprint_hachutu.png');
  assert.equal(current.puzzleOptions.sanctum,undefined);
  assert.equal(current.specialBoss,false);
  const gridData=buildingScenes.get('map_i_dev_random_ruin').grid;
  assert.equal(gridData[13][6].type,'grass'); // Shattered threshold is walkable even while debris is visible.

  // Pure signal cadence: strictly faster near the target, without revealing bearing.
  const signalWindow={BanditCombat:{init(){}},RuntimeFrameScheduler:{register(){}},DevCompanion:{registerStateProvider(){}}};
  const signalContext=vm.createContext({window:signalWindow,document:{readyState:'loading',addEventListener(){}},performance:{now:()=>0},console});
  vm.runInContext(source('delvers-vault-signal'),signalContext);
  const signal=signalWindow.DelversVaultSignal;
  assert.equal(signal.periodForDistance(0),380);
  assert.equal(signal.periodForDistance(95),3700);
  assert(signal.periodForDistance(7)<signal.periodForDistance(30));
  assert(signal.periodForDistance(30)<signal.periodForDistance(85));

  assert(fs.existsSync('docs/assets/textures/decals/footprint_hachutu.png'),
    'the authored toe-up bird footprint asset must be present on the branch');
  const index=fs.readFileSync('docs/index.html','utf8');
  assert(index.includes('js/delvers-vault-signal.js'));
  assert(index.includes('js/delvers-guild-story.js'));
  assert(fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js','utf8')
    .includes('js/dev-random-ruin-interior-map.js'));
  console.log('Delver story vault: talisman, dialogue, persistent shifting burrow, fixed ruin, decals, prompts and pulse cadence passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

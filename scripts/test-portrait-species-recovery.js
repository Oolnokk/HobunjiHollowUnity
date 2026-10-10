'use strict';
const assert = require('node:assert/strict'); // Verifies production loading, species selection and player commit safety.
const fs = require('node:fs'); // Reads real species definitions and shipped module owners.
const vm = require('node:vm'); // Executes browser owners without a network or renderer.
const read = path => fs.readFileSync(path, 'utf8'); // Shared source reader for fixtures below.
const speciesIndex = JSON.parse(read('docs/config/species/index.json')); // Uses the authored Nuhongan inheritance rather than invented portrait records.
async function main() {
  let failures = 1, calls = 0; // Injects a transient failure in the donor species data request.
  const window = {location:{href:'https://game.test/docs/index.html'},SCRATCHBONES_CONFIG:{game:{}},setPortraitAssetBase(){}}; // Shared browser namespace for the real loader and profile adapter.
  const context = vm.createContext({window,URL,console:{warn(){},log(){}},fetch:async(url,options)=>{
    const path = new URL(url).pathname; // Routes requests into the checked-in authored configuration.
    if(path.endsWith('/cosmetics/index.json'))return {ok:true,json:async()=>({entries:[]})};
    if(path.endsWith('/tletingan.json')){calls++;if(failures-->0)return{ok:false,status:503};}
    if(path.endsWith('/species/index.json'))return{ok:true,json:async()=>speciesIndex};
    const local = 'docs/config/species/'+path.split('/').pop(); // Loads every registered species to exercise the full loader's parent resolution.
    if(!fs.existsSync(local))return{ok:false,status:404};
    return{ok:true,json:async()=>JSON.parse(read(local))};
  }});
  vm.runInContext(read('docs/js/portrait-utils.js'),context);
  vm.runInContext(read('docs/js/npc-avatar-preview-utils.js'),context);
  await window.NpcAvatarPreview.ensurePortraitCosmetics({configBase:'./config/',assetBase:'./assets/'});
  assert.equal(calls,2,'donor fetch retries after HTTP failure');
  assert.equal(window.portraitSpeciesLoadSnapshot().phase,'ready');
  const profile = window.NpcAvatarPreview.buildProfileFromNpcExport({id:'player',appearance:{speciesId:'nuhongan',gender:'male',cosmetics:{}}}); // Same adapter used by refreshPlayerAvatar.
  assert.equal(profile.fighter.speciesId,'nuhongan','Nuhongan never becomes the first Mao’ao fighter');
  assert.equal(profile.fighter.headUrl,JSON.parse(read('docs/config/species/tletingan.json')).male.headSprite);
  assert(profile.fighter.bodyLayers.some(layer=>layer.id==='torso'),'inherited portrait includes its authored torso');
  assert.throws(()=>window.NpcAvatarPreview.buildProfileFromNpcExport({appearance:{speciesId:'missing-species',gender:'male'}}),/Portrait species unavailable/,'unknown identity cannot silently borrow another species');
  failures=2;
  await assert.rejects(window.loadPortraitCosmetics('./config/'),/HTTP 503/,'persistent species failure rejects incomplete data');
  assert.equal(window.portraitSpeciesLoadSnapshot().phase,'failed');
  assert.match(window.portraitSpeciesLoadSnapshot().lastError,/tletingan/);
  failures=0;
  await window.loadPortraitCosmetics('./config/');
  assert.equal(window.portraitSpeciesLoadSnapshot().phase,'ready','later load can recover');

  const badWindow = {...window,loadPortraitCosmetics:async()=>{throw Error('species fetch failed');}}; // Separate adapter instance proves rejected promises never poison its cache.
  vm.runInNewContext(read('docs/js/npc-avatar-preview-utils.js'),{window:badWindow,console});
  await assert.rejects(badWindow.NpcAvatarPreview.ensurePortraitCosmetics(),/species fetch failed/);
  badWindow.loadPortraitCosmetics=window.loadPortraitCosmetics;
  await badWindow.NpcAvatarPreview.ensurePortraitCosmetics({configBase:'./config/'});
  assert.equal(badWindow.NpcAvatarPreview.buildProfileFromNpcExport({appearance:{speciesId:'nuhongan',gender:'male'}}).fighter.speciesId,'nuhongan');

  const source = read('docs/game.js'); // Execute the real player refresh failure path with an existing good avatar still present.
  let removals=0;
  const playerContext=vm.createContext({_playerData:{appearance:{speciesId:'nuhongan'}},playerAvatarRefreshGeneration:0,playerAvatarRefreshDebug:{started:0},window:{NpcAvatarPreview:{buildProfileFromNpcExport(){throw Error('Portrait species unavailable: nuhongan/male');}},PNGPlaneAvatar:{},EquipmentPanel:{applyGearClothingToPlayerData:value=>value}},removePlayerAvatarChildren(){removals++;},showToast(){},Date,Map});
  const start=source.indexOf('      async function refreshPlayerAvatar()');
  vm.runInContext(source.slice(start,source.indexOf('\n      // Clothing-sprite lookup',start)),playerContext);
  await assert.rejects(vm.runInContext('refreshPlayerAvatar()',playerContext),/Portrait species unavailable/);
  assert.equal(removals,0,'failed profile construction leaves the current avatar attached');
  assert.match(playerContext.playerAvatarRefreshDebug.lastError,/nuhongan/,'failure is available to mobile diagnostics');
  console.log('portrait species retries, exact identity, inheritance and avatar preservation checks passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

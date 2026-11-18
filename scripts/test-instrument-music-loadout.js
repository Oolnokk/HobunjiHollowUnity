#!/usr/bin/env node
'use strict';
// Tests the shipped instrument pattern model and gameplay-only music policy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const modelSource = read('docs/js/instrument-pattern-loadout.js');
const host = read('docs/js/music-minigame.js');
const engine = read('docs/assets/minigames/lyre-performance.html');
const html = read('docs/index.html');
const ui = read('docs/js/combat/combat-loadout-ui.js');
const css = read('docs/style.css');
const equipment = read('docs/js/equipment-panel.js');
const loader = read('docs/js/bootstrap/classic-groups/combat-main.js');

const legacy = ['arp-forward-8','arp-reverse-8','tremolo-8','strum-waltz'];
const storageData = new Map([
  ['musicSystemDemoSettingsV13',JSON.stringify({autoPickSlots:legacy,tonicMidi:51,scaleName:'Major'})],
  ['hobunjiSaveMeta',JSON.stringify({characters:[{id:'a'},{id:'b'}]})]
]); // Shared fake browser storage verifies both legacy migration and profile metadata writes.
const localStorage = {getItem:key=>storageData.get(key)||null,setItem:(key,value)=>storageData.set(key,String(value))};
const events = {};
let equipped = 'flute';
const profileA = {characterId:'a'};
const profileB = {characterId:'b'};
const win = {
  __hobunjiPlayerProfile:profileA,
  MusicMinigame:{
    patternOptions:()=>[
      ['direct','Single'],['arp-forward-8','Forward'],['arp-reverse-8','Reverse'],
      ['arp-forward-reverse-16','Forward-Reverse'],['tremolo-8','Tremolo'],
      ['tremolo-16','Rapid'],['strum-reggae-8','Reggae'],['strum-waltz','Waltz']
    ],
    getEquippedInstrument:()=>equipped
  }
}; // The mock exposes the exact music host API that supplies instrument keys and valid patterns.
vm.runInNewContext(modelSource,{window:win,document:{addEventListener:(name,fn)=>{events[name]=fn;}},localStorage,console},{filename:'instrument-pattern-loadout.js'});
const model = win.InstrumentPatternLoadout;
assert(model);
assert.deepEqual(Array.from(model.getSlots('flute')),legacy,'legacy patterns seed a new instrument');
assert(model.setSlot('flute',0,'tremolo-16'));
assert.equal(model.getSlots('flute')[0],'tremolo-16');
assert.deepEqual(Array.from(model.getSlots('kurraya')),legacy,'another instrument is initially independent');
assert(model.setSlot('kurraya',2,'direct'));
assert.equal(model.getSlots('flute')[2],'tremolo-8','Kurraya changes never overwrite flute slots');
for (const [key,index,value] of [['',0,'direct'],['flute',-1,'direct'],['flute',4,'direct'],['flute',0,'invalid']]) {
  assert.equal(model.setSlot(key,index,value),false,'invalid pattern/slot/key must not be saved');
}
const savedA = JSON.parse(localStorage.getItem('hobunjiSaveMeta')).characters[0];
assert.equal(savedA.instrumentPatternLoadout.flute[0],'tremolo-16','flute persists under the active character');
assert.equal(savedA.instrumentPatternLoadout.kurraya[2],'direct','Kurraya persists separately');
win.__hobunjiPlayerProfile = profileB;
events.hobunjiPlayerReady({detail:profileB});
assert.deepEqual(Array.from(model.getSlots('flute')),legacy,'character B does not inherit character A slots');
assert(model.setSlot('flute',1,'strum-waltz'));
win.__hobunjiPlayerProfile = {characterId:'a',instrumentPatternLoadout:savedA.instrumentPatternLoadout};
events.hobunjiPlayerReady({detail:win.__hobunjiPlayerProfile});
assert.equal(model.getSlots('flute')[0],'tremolo-16','character A reloads its saved flute');
assert.equal(model.getSlots('flute')[1],'arp-reverse-8','character B changes do not leak into A');
equipped = 'kurraya';
assert.equal(model.debugState().instrumentKey,'kurraya','diagnostics follow equipped instrument');

// Execute the real, isolated audio policy functions against controlled iframe and developer settings.
const start = engine.indexOf('  const GAME_OVERWORLD_MUSIC =');
const end = engine.indexOf('  const HOSTED_FLUTE_PERFORMANCE =',start);
assert(start>=0 && end>start);
const factory = new Function('state','location','window','normalizeAutoPickSlots','DEFAULT_AUTO_PICK_SLOTS',
  engine.slice(start,end)+'\nreturn {enforceGameMusicKey,gameMusicDevMode,applyGameInstrumentSlots};');
let dev = false;
const state = {tonicMidi:55,scaleName:'Major',leftStickSector:2,autoPickSlots:[],pluckInputMode:'direct'};
const customSlots = ['arp-reverse-8','direct','strum-waltz','arp-forward-8'];
const hosted = {parent:{
  document:{getElementById:()=>({get checked(){return dev;}})},
  InstrumentPatternLoadout:{getSlots:key=>{assert.equal(key,'flute');return customSlots.slice();}}
}};
const normalize = slots => {state.autoPickSlots = slots.slice();return state.autoPickSlots;};
const policy = factory(state,{search:'?overworld=1&instrument-key=flute'},hosted,normalize,['direct','direct','direct','direct']);
policy.enforceGameMusicKey();
assert.equal(state.tonicMidi,48,'ordinary gameplay forces C3');
assert.equal(state.scaleName,'Pentatonic Minor','ordinary gameplay uses C pentatonic minor');
policy.applyGameInstrumentSlots();
assert.deepEqual(state.autoPickSlots,customSlots,'the equipped instrument supplies the four pattern slots');
assert.equal(state.pluckInputMode,'strum-waltz','active sector immediately uses the loaded instrument pattern');
dev = true;
state.tonicMidi=57;state.scaleName='Minor';
policy.enforceGameMusicKey();
assert.equal(state.tonicMidi,57,'Dev Mode allows a custom root');
assert.equal(state.scaleName,'Minor','Dev Mode allows a custom scale');
const labState={tonicMidi:55,scaleName:'Major'};
factory(labState,{search:''},{},()=>{},['direct']).enforceGameMusicKey();
assert.equal(labState.tonicMidi,55,'standalone Music Lab has no game key restriction');

assert.match(host,/if \(!gameMusicDevMode\(\)\) return '48\|Pentatonic Minor'/);
assert.match(host,/MUSIC_MINIGAME_SRC \+ '&instrument-key=' \+ encodeURIComponent\(playerSession\.instrumentKey\)/);
assert.match(host,/syncGameplayTuning\?\.\(\)/,'live Dev Mode changes reapply the fixed key');
assert.match(engine,/function startSong\([\s\S]*?enforceGameMusicKey\(\)/);
assert.match(engine,/setAutoPickSlot\(sector, mode\)\s*\{\s*if \(GAME_OVERWORLD_MUSIC\) return false/);
assert.match(engine,/function cycleScale\([\s\S]*?!gameMusicDevMode\(\)/);
assert.match(engine,/serializable\.tonicMidi = previous/,'ordinary game saves preserve prior developer choices');
assert(!html.includes('id="lyrePatternLoadoutSettings"'),'Settings no longer owns four-direction patterns');
assert(html.indexOf('instrument-pattern-loadout.js?v=') < html.indexOf('music-minigame.js?v='));
assert.match(ui,/model\.setSlot\(instrumentKey,index,id\)/);
assert.match(ui,/loadoutSubtab_.*id/);
assert.match(css,/#mpLoadout\.instrument-subtab #combatLoadoutPreview\s*\{\s*display:\s*none/);
assert.match(equipment,/hobunji-instrument-equipped/);
assert.match(loader,/combat-loadout-ui\.js\?v=20261118instrumentLoadout1/);
console.log('C pentatonic minor lock, Dev override, per-instrument/character patterns, legacy migration and menu wiring: passed.');

#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/assets/minigames/lyre-performance.html','utf8'); // Shipped music engine, not duplicated input logic.
function extract(name){const start=source.indexOf('function '+name+'(');assert(start>=0,name);const brace=source.indexOf('{',start);let level=0;for(let i=brace;i<source.length;i++){if(source[i]==='{')level++;if(source[i]==='}'){level--;if(!level)return source.slice(start,i+1);}}throw Error('Unclosed '+name);}
let reads=0,notes=0,stops=0;const listeners={}; // Captures physical input consumption and preview interruptions.
const state={ambientOnly:true,game:{demoActive:true,backupAccompaniment:false},gamepadIndex:null};
const context={state,window:{addEventListener:(name,fn)=>{listeners[name]=fn;}},navigator:{getGamepads:()=>{reads++;return [{index:0,id:'controller',axes:[0,0,0,0]}];}},requestAnimationFrame(){},
 $:()=>({}),connectGamepad(){},processGamepadButton(){notes++;},processRightStick(){},moveStickNub(){},refs:{arpNub:{}},isFrettedPluckLayout:()=>false,isLatchedAutoBankLayout:()=>false,stopSong(){stops++;},log(){},feedback(){}};
vm.createContext(context);
for(const name of ['backupPlayerInputBlocked','interruptSuccessfulPreviewForPlayer','pollGamepad','bindKeyboard'])vm.runInContext(extract(name),context);
context.pollGamepad();assert.equal(reads,0,'hidden NPC iframe must not even read the overworld controller');assert.equal(notes,0);
assert.equal(context.backupPlayerInputBlocked('gp-a'),true);assert.equal(context.backupPlayerInputBlocked('demo-note-1'),false,'generated NPC notes remain permitted');
assert.equal(context.interruptSuccessfulPreviewForPlayer('gp-a'),false);assert.equal(stops,0,'overworld input cannot stop an NPC’s generated song');
context.bindKeyboard();listeners.keydown({code:'KeyA'});assert.equal(stops,0,'hidden keyboard input also returns before any music controls');
state.ambientOnly=false;context.pollGamepad();assert.equal(reads,1);assert(notes>0,'ordinary visible/standalone music retains physical input');
console.log('Ambient generated music ignores physical input without blocking normal player music.');

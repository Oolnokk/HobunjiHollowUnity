'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/tools/wilderness-generation-lab/lab-height-curve-editor.js'), 'utf8');
const events = new Map(); // Fake DOM event handlers used to test finger drawing without a real browser.
const elements = new Map(); // Fake inputs and canvases used by the exported height editor.

function element(id) {
  if (elements.has(id)) return elements.get(id);
  const handlers = {}; // Each element's listener registry for synthetic test interactions.
  const item = {
    id, value:'0', checked:false, style:{}, width:128, height:128,
    addEventListener(name,fn) { handlers[name]=fn; },
    dispatch(name,event={}) { handlers[name]?.(event); },
    setPointerCapture() {},
    getBoundingClientRect() { return {left:0,top:0,width:128,height:128}; },
    getContext() {
      return {
        clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, arc() {}, fill() {}
      };
    }
  };
  elements.set(id,item);
  events.set(id,handlers);
  return item;
}

const window = {}; // Captures the editor module's expected public API.
const document = { getElementById:element }; // Minimal browser document implementing the editor's element lookups.
vm.runInNewContext(source, {window,document,Map,Array,Number,Math}, {filename:'lab-height-curve-editor.js'});
const editor = window.WildernessLabHeightCurveEditor;
assert(editor?.init && editor?.getProfile && editor?.setProfile);
let notifications = 0; // Used to prove interactive edits notify the main generator scheduler.
editor.init({onChange:()=>notifications++});
assert.equal(editor.getProfile().enabled,false);
const ew = element('heightCurve_eastWest'); // Canvas receiving one simulated finger stroke from the west to the east edge.
ew.dispatch('pointerdown',{pointerId:5,pointerType:'touch',clientX:0,clientY:0});
ew.dispatch('pointermove',{pointerId:5,pointerType:'touch',clientX:128,clientY:128});
ew.dispatch('pointerup',{pointerId:5});
const painted = editor.getProfile();
assert.equal(painted.enabled,true);
assert.equal(painted.eastWest[0],1);
assert.equal(painted.eastWest[12],0);
assert.equal(painted.northSouth[0],0.5);
assert(notifications >= 2,'drag must notify the generator scheduler');
const up = element('heightCurve_upwardVariation'); // Range control used to specify the maximum positive elevation jitter.
up.value='1.7';up.dispatch('input');
assert.equal(editor.getProfile().upwardVariation,1.7);
assert.equal(element('heightCurve_upwardVariation_num').value,'1.7');
editor.setProfile({enabled:true,eastWest:[1,0],northSouth:[.5,.5],upwardVariation:2,downwardVariation:3});
const imported=editor.getProfile();
assert.equal(imported.eastWest.length,13);
assert.equal(imported.eastWest[0],1);
assert.equal(imported.eastWest[12],0);
assert.equal(imported.downwardVariation,3);
assert.equal(element('heightCurvesEnabled').checked,true);
console.log('Wilderness height editor finger interpolation, curves and two variation offsets passed.');

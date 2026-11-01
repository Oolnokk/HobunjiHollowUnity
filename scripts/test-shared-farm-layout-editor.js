'use strict';
const assert = require('node:assert/strict'); // Execute the shared editor's real event handlers and rendering lifecycle.
const fs = require('node:fs'); // Reads the shipped farm panel rather than a second implementation.
const vm = require('node:vm'); // Minimal browser/Three environment keeps the regression independent of WebGL availability.
const nodes = new Map(), listeners = {}, frames = new Map(); // DOM, window events, and isolated RAF ownership.
let rendererCount = 0, nextFrame = 0, allowed = true, sidebar, moves = 0, placements = 0; // Evidence for renderer reuse and authoritative mutations.
function node(id) {
  const result = { id, children: [], dataset: {}, userData: {}, style: {}, events: {}, attributes: {},
    classList: { values: new Set(), add(v) { this.values.add(v); }, remove(v) { this.values.delete(v); }, contains(v) { return this.values.has(v); } },
    setAttribute(k,v) { this.attributes[k] = v; }, addEventListener(k,f) { this.events[k] = f; },
    appendChild(child) { this.children.push(child); nodes.set(child.id, child); }, before(child) { nodes.set(child.id,child); },
    querySelector(selector) { return nodes.get(selector); }, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left:0,top:0,width:200,height:200 }), parentElement:{clientWidth:200,clientHeight:200},
  }; // Implements only operations used by the real layout editor.
  Object.defineProperty(result,'innerHTML',{set() { this.children=[]; }});
  nodes.set(id,result); return result;
}
['houseLayoutModal','houseLayoutClose','houseLayout3dCanvas','houseLayoutCursorToggle','houseLayoutHint','houseLayoutPieceList','houseLayoutSelectedActions','houseLayoutArchitecture','houseLayoutDeeds','.house-layout-title'].forEach(node);
function vector() { return { set(){}, x:0,y:0,z:0 }; }
class Group {
  constructor() { this.children=[]; this.userData={}; }
  add(object) { this.children.push(object); }
  remove(object) { this.children=this.children.filter(child=>child!==object); }
}
class Geometry { dispose() { this.disposed=true; } }
class Mesh {
  constructor(geometry,material) { this.geometry=geometry;this.material=material;this.position=vector();this.userData={}; }
}
const scene = new Group(); scene.fog={name:'gameplay-fog'}; // Fog/light changes must be scoped to the editor's one render pass.
const originalFog = scene.fog; // Exact reference restored after each render, including exceptional paths.
const THREE = { Scene:Group, BoxGeometry:Geometry, EdgesGeometry:Geometry, Mesh, LineSegments:Mesh,
  MeshBasicMaterial:class {constructor(){this.color={set(){}};}}, LineBasicMaterial:class{}, AmbientLight:class{},
  OrthographicCamera:class {constructor(){this.up=vector();this.position=vector();}lookAt(){}updateProjectionMatrix(){}},
  Vector3:class {constructor(x,y){this.x=x;this.z=y;}unproject(){return this;}},
  WebGLRenderer:class {constructor(){rendererCount++;}setSize(){}clear(){}render(){}},
}; // Actual editor selects a 3D context; these stand-ins verify lifecycle without requiring a GPU.
const housePieces=[{id:'house_starter',pieceKey:'starter',stage:'built',col:-1,row:-1,w:2,h:2}]; // Native house view used after switching back from barns.
const context={console,THREE,document:{getElementById:id=>nodes.get(id),createElement:()=>node(`dynamic-${nodes.size}`)},
  requestAnimationFrame:fn=>{const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
  addEventListener:(name,fn)=>{listeners[name]=fn;},
}; // Shared modal owner reads browser globals through window.
context.window=context;
context.ControllerUI = { activePanel: () => nodes.get('houseLayoutModal') }; // Controller cursor input only owns the editor while it is the frontmost panel.
vm.createContext(context); vm.runInContext(fs.readFileSync('docs/js/farm-panel-core.js','utf8'),context);
context.FarmPanel.init({scene,COLS:60,ROWS:50,ITEM_DEFS:{},hasFarmPermission:()=>allowed,getHousePieces:()=>housePieces,
  getHousePieceCatalog:()=>({}),housePieceLabel:()=> 'Starter',getHouseFixtureInventory:()=>[],esc:value=>value,showToast(){},canMovePieceTo:()=>true});
const barnPiece={id:'barn-room',col:-1,row:-1,w:2,h:2}; // Under the screen center in the deterministic unproject stub.
const adapter={kind:'barn',title:'Little Barn Layout',selectedId:barnPiece.id,getPieces:()=>[barnPiece],getViewPieces:()=>[barnPiece],
  canDrag:()=>true,canMove:()=>true,resolveMove:(_,col,row)=>({col,row,w:2,h:2}),getHint:()=> 'Drag a barn room.',label:()=> 'Little Barn',
  renderSidebar:ui=>{sidebar=ui;},move:()=>{moves++;return {ok:true,message:'moved'};},place:()=>{placements++;return {ok:true,message:'placed'};},
}; // Barn domain actions are supplied while all UI/3D/input remains owned by FarmPanel.
const panel=context.FarmPanel, canvas=nodes.get('houseLayout3dCanvas'); // Production exports and shared canvas.
panel.openLayoutEditor(adapter);
assert.equal(rendererCount,1);assert.equal(frames.size,1);assert.equal(panel.layoutEditorDebug().editor,'barn');
assert.equal(nodes.get('.house-layout-title').textContent,'Little Barn Layout');
assert.equal(scene.fog,originalFog);assert.equal(scene.children.length,0,'temporary fill light removed');
function event(x,y=100) { return {pointerId:1,clientX:x,clientY:y}; }
canvas.events.pointerdown(event(100));canvas.events.pointermove(event(125));canvas.events.pointerup(event(125));
assert.equal(moves,1,'barn drag commits through the supplied domain authority');
const cursorToggle = nodes.get('houseLayoutCursorToggle'); // Shared button is the handoff from ordinary menu focus to the tile cursor.
assert.equal(typeof cursorToggle.events.click,'function','cursor entry button is bound without a second input loop');
cursorToggle.events.click();
assert.equal(panel.layoutEditorDebug().cursor.active,true,'cursor entered in the shared 3D view');
const cursorInput = (now, move = {}, down = {}) => panel.handleLayoutControllerFrame({
  now, focused:true,pad:{},move:{x:move.x || 0,y:move.y || 0}
},id=>!!down[id]); // Uses the production frame handler, while the existing editor authority performs moves.
cursorInput(10);cursorInput(20,{}, {uiConfirm:true});cursorInput(30); // A picks up the initially selected barn, after the opening A has been released.
assert.equal(panel.layoutEditorDebug().cursor.carryingId,barnPiece.id);
const startCol = panel.layoutEditorDebug().cursor.col; // Used to check exactly one snapped tile, not continuous world-unit drift.
cursorInput(40,{x:1});
assert.equal(panel.layoutEditorDebug().cursor.col,startCol+1);
cursorInput(50,{}, {uiConfirm:true});cursorInput(60);
assert.equal(moves,2,'cursor drop commits through the same barn domain authority as pointer dragging');
cursorInput(70,{}, {uiCancel:true});
assert.equal(panel.layoutEditorDebug().cursor.active,false,'B exits cursor mode without closing the editor');
sidebar.arm({type:'placeIncubator',tier:'small'});canvas.events.pointerdown(event(100));canvas.events.pointerup(event(100));
assert.equal(placements,1,'plain tap uses the same shared house pointer handler for an armed barn plan');
assert.equal(panel.layoutEditorDebug().placing,null,'successful placement disarms');
canvas.events.pointerdown(event(100));canvas.events.pointermove(event(125));canvas.events.pointercancel(event(125));
assert.equal(moves,2,'cancellation never commits a move');
allowed=false;canvas.events.pointerdown(event(100));canvas.events.pointermove(event(125));canvas.events.pointerup(event(125));
assert.equal(moves,2,'read-only users can select but never start a drag');
allowed=true;canvas.events.pointerdown(event(100));
panel.closeLayoutEditor();assert.equal(frames.size,0);assert.equal(nodes.get('houseLayoutModal').attributes['aria-hidden'],'true');
panel.openLayoutEditor();assert.equal(rendererCount,1,'house reopening reuses the barn renderer');
assert.equal(panel.layoutEditorDebug().editor,'house');assert.equal(panel.layoutEditorDebug().placing,null);
assert.equal(nodes.get('.house-layout-title').textContent,'House Layout');
listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(frames.size,0);
panel.openLayoutEditor(adapter);canvas.events.pointerdown(event(100));canvas.events.pointermove(event(125));canvas.events.pointerup(event(125));
assert.equal(moves,3,'close mid-gesture clears pointer capture state for the next opening');
assert(nodes.has('houseLayoutDebug'),'both editors expose copyable diagnostics on mobile');
panel.closeLayoutEditor();
console.log('Shared farm layout renderer, selection, controller tile cursor pickup/drop, drag/place, permissions, cancellation, switching, and diagnostics passed.');

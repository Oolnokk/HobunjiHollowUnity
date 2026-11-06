'use strict';
// V50 stamps every display pedestal and coffin with a gold diamond showing the first letter of the
// item label (createItemSpriteMaterial): an unreplaced stand-in for treasure. The ruin hides them.
// They must stay in the scene though: the sanctum finds its goal pedestals by walking for
// isSurfaceItemSprite planes and reading their parent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Obj {
  constructor(name = '') { this.name = name; this.children = []; this.parent = null; this.userData = {}; this.visible = true; }
  add(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
const window = {
  THREE: { Vector3: class {}, Group: Obj, Color: class {} },
  AuthoredFurniture: { load() {}, peek: () => null, buildGroup: () => new Obj() },
  DynamicSurfaces: { addBeforeRenderClient() {} },
  performance: { now: () => 0 },
};
window.window = window;
vm.runInContext(fs.readFileSync('docs/js/dev-random-ruin-furniture-pieces.js', 'utf8'), vm.createContext(window), { filename:'dev-random-ruin-furniture-pieces.js' });
const Pieces = window.DevRandomRuinFurniturePieces;
assert.ok(Pieces?.hidePlaceholderItems, 'exported');

const root = new Obj('root');
const pedestal = new Obj('pedestal'), coffin = new Obj('coffin'), pillar = new Obj('pillar');
const sprite = label => { const plane = new Obj('sprite'); plane.userData = { isSurfaceItemSprite:true, itemLabel:label }; return plane; };
const relic = sprite('Core Relic'), idol = sprite('Stone Idol'), tomb = sprite('Sanctum Key');
pedestal.add(relic, idol); coffin.add(tomb);
const body = new Obj('pedestal body'); pedestal.add(body);
root.add(pedestal, coffin, pillar);

assert.equal(Pieces.hidePlaceholderItems(root), 3, 'all three diamonds hidden');
assert.ok([relic, idol, tomb].every(plane => plane.visible === false), 'the placeholder diamonds are hidden');
assert.ok([pedestal, coffin, pillar, body, root].every(node => node.visible === true), 'nothing else is touched');
assert.equal(Pieces.hidePlaceholderItems(root), 0, 'idempotent: a second pass finds nothing new');

// The sanctum's lookup still finds every plane and its pedestal, so goal braziers still land on them.
const found = [];
root.traverse(object => { if (object.userData?.isSurfaceItemSprite) found.push(object); });
assert.deepEqual(found, [relic, idol, tomb], 'planes stay in the scene');
assert.deepEqual(found.map(plane => plane.parent), [pedestal, pedestal, coffin], 'with their pedestals as parents');

assert.equal(Pieces.hidePlaceholderItems(null), 0, 'a missing root is harmless');
console.log('ruin placeholder items regression passed');

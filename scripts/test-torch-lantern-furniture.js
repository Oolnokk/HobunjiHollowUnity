'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm'); // Exercises the actual sprite renderer without a browser/WebGL context.
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const lamp = JSON.parse(read('docs/config/furniture-authored/standingLamp.json'));
const torch = JSON.parse(read('docs/config/furniture-authored/wallTorch.json'));
const candleTable = JSON.parse(read('docs/config/furniture-authored/candleTable.json'));
const sourceLamp = JSON.parse(read('docs/assets/models/furniture/data/standing_lamp_bronze.json'));
const lampParts = new Map(lamp.parts.map(part => [part.id, part]));
const torchParts = new Map(torch.parts.map(part => [part.id, part]));
assert.equal(lamp.key, 'standingLamp', 'legacy furniture key remains stable for saves and toggle-light behavior');
assert.ok(lampParts.has('lantern_table_top'), 'replacement has a table top');
assert.ok(lampParts.has('lantern_table_leg_4'), 'replacement has four table legs');
assert.ok(lampParts.has('lantern_glass'), 'table carries amber lantern glass');
assert.ok(lampParts.has('lantern_top_hood'), 'lantern has a bronze hood');
assert.equal(lampParts.get('lantern_glass').surfaceOpacity, .62, 'lantern glass remains translucent');
const tableTop = lampParts.get('lantern_table_top').transform; // Table geometry must not shrink with its accessory.
assert.equal(tableTop.y, .62, 'lantern table remains at its existing authored height');
assert.equal(tableTop.sy, .09, 'lantern tabletop thickness stays unchanged');
const lanternParts = lamp.parts.filter(part => !part.name.startsWith('Lantern Table ')); // Accessory bounding dimensions, including the candle/flame.
const baseBottom = lampParts.get('lantern_base').transform.y - lampParts.get('lantern_base').transform.sy / 2;
const lanternTop = Math.max(...lanternParts.map(part => part.transform.y + part.transform.sy / 2));
const lanternWidth = Math.max(...lanternParts.map(part => Math.abs(part.transform.x) + part.transform.sx / 2)) * 2;
const saucerWidth = candleTable.parts.find(part => part.name === 'Candle Table Disc').transform.sx;
assert.ok(lanternTop - baseBottom >= .28 && lanternTop - baseBottom <= .32, 'mini-lantern height remains close to candle plus flame');
assert.ok(lanternWidth >= saucerWidth && lanternWidth <= saucerWidth * 1.2, 'lantern width stays just above candle saucer');
const glass = lampParts.get('lantern_glass').transform; // Glass must enclose both the wax and the permanent flame.
const candle = lampParts.get('lantern_candle')?.transform;
const flame = lampParts.get('lantern_flame')?.transform;
assert.ok(candle && flame, 'lantern physically contains wax and a flame');
assert.ok(candle.y - candle.sy / 2 >= glass.y - glass.sy / 2 - .01, 'wax begins inside the glass');
assert.ok(flame.y - flame.sy / 2 >= candle.y + candle.sy / 2 - .005, 'flame sits on the wax');
assert.ok(flame.y + flame.sy / 2 < glass.y + glass.sy / 2, 'flame fits inside the lantern glass');
assert.equal(lampParts.get('lantern_flame').materialLighting, 'unlit', 'flame remains visible even when no particle tick is active');
const emitter = lamp.particleEmitters.find(part => part.id === 'lantern_candle_fire'); // Particle anchoring follows the wax after height adjustments.
assert.equal(emitter?.attachedPartId, 'lantern_candle', 'ambient flame stays parented to the candle');
assert.equal(emitter?.type, 'fire', 'existing ambient fire effect powers the lantern');
assert.ok(read('docs/js/interior-fire-floor-runtime.js').includes("'candleTable', 'candleCluster', 'standingLamp', 'hearth'"), 'lantern and cluster both share the existing furniture fire scheduler');
assert.ok(!lamp.parts.some(part => /lampshade|fabric shade/i.test(part.name)), 'old lampshade parts are gone');
assert.equal(sourceLamp.lightSource.enabled, true, 'existing toggle-light and furniture-light metadata is retained');
assert.deepEqual([...torchParts.keys()], ['wall_torch_plate','wall_torch_arm','wall_torch_rest'],
  'wall torch JSON has only the mounting perch, never the old geometry torch and fake flames');
assert.equal(torchParts.get('wall_torch_arm').transform.z,.145,'arm reaches the painted handle');
assert.equal(torchParts.get('wall_torch_rest').transform.z,.34,'30° socket sits along the torch centerline');
assert.equal(torchParts.get('wall_torch_rest').transform.rx,30,'authored socket pitches 30° outward to match the PNG');
const authoredTorchSource=read('docs/js/authored-furniture-runtime.js'); // Validate the art bridge for rendered authored furniture.
const fallbackTorchSource=read('docs/js/wall-ornament-placement.js'); // JSON-cold fallback must match the authored version.
const houseTorchSource=read('docs/js/house-wall-fixtures.js'); // Older house fixtures must not use cubes.
assert.ok(authoredTorchSource.includes("new URL('../assets/toolsprites/torch.png'"),
  'wall torch uses the exact handheld tool PNG in the game and editors');
assert.ok(authoredTorchSource.includes('png.rotation.z = Math.PI'),
  'PNG -Y business end is rotated to world up');
assert.ok(authoredTorchSource.includes("data.key === 'wallTorch') attachWallTorchSprite(group, THREE)"),
  'authored furniture builds the sprite onto the perch');
assert.ok(fallbackTorchSource.includes('AuthoredFurniture?.attachWallTorchSprite?.(group, THREE)'),
  'procedural fallback uses the same cached texture renderer');
assert.ok(houseTorchSource.includes('AuthoredFurniture?.attachWallTorchSprite?.(mount,THREE,spriteOptions)'),
  'house fixtures use the shared sprite where available');
assert.ok(houseTorchSource.includes('art.rotation.z=Math.PI'),
  'isolated house editor fallback flips the sprite too');
assert.ok(fallbackTorchSource.includes("rx: 30, ry: 0, rz: 0"),
  'procedural wall socket uses the same thirty-degree X-axis tilt');
assert.ok(houseTorchSource.includes('handleRest.rotation.x=Math.PI/6'),
  'house wall support surface rotates to align with the handheld torch');
assert.ok(houseTorchSource.includes('tilt.rotation.x=Math.PI/6'),
  'isolated house editor art tilts outward too');
assert.ok(!fallbackTorchSource.includes("id: 'wall_torch_shaft'"),
  'procedural fallback never recreates the unwanted cylinder shaft');
assert.equal(torch.wallOrnament.attachmentSurfaceId, 'wall_torch_plate:surface:4', 'wall attachment contract remains stable');
assert.ok(torch.recognizedSurfaces[0].bounds.maxU > torch.recognizedSurfaces[0].bounds.minU, 'mounting surface bounds remain valid');
const procedural = read('docs/js/procedural-furniture.js');
const fallback = procedural.match(/CATALOG\.standingLamp = \[[\s\S]*?\n  \];/)?.[0] || '';
assert.ok(fallback.includes("box(0, .62, 0") && fallback.includes("cyl(0, .869, 0"), 'procedural fallback uses the miniature authored lantern');
assert.ok(fallback.includes("cyl(0, .748, 0") && fallback.includes("cyl(0, .814, 0"), 'fallback already contains the inner candle and flame');
assert.ok(!fallback.includes('roundLeg(0, 0, 1.3'), 'old standing lamp fallback is removed');
assert.match(read('docs/tools/map-editor/index.html'), /standingLamp:\{icon:'🏮',label:'Lantern Table'/, 'Map Editor labels the legacy key Lantern Table');
assert.match(read('docs/tools/building-interior-author/index.html'), /key:'standingLampFurniture',\s+label:'Lantern Table',\s+modelFile:null/, 'interior author previews the authored/procedural Lantern Table');
assert.ok(!read('docs/tools/locale-editor/locale-preview3d.js').includes("standingLamp: 'furniture/standing_lamp_bronze.glb'"), 'locale preview no longer loads the old lampshade GLB');
assert.match(read('docs/index.html'), /procedural-furniture\.js\?v=[A-Za-z0-9_-]+/, 'game procedural furniture loader has a cache-bust token');
console.log('Torch and Lantern Table furniture regressions passed.');


const loadedTorchTextures=[]; // Verifies that separate wall torches reuse one GPU texture.
const registeredTorchLights=[]; // Verifies exactly one renderer light per wall torch.
class TorchNode {
  constructor() {
    this.children=[]; this.userData={}; this.name='';
    this.position={ set(...xyz){ this.xyz=xyz; } };
    this.rotation={}; this.scale={ setScalar(value){ this.value=value; } };
  }
  add(node) { this.children.push(node); node.parent=this; }
  getObjectByName(name) { return this.children.find(child=>child.name===name)||null; }
}
class TorchMesh extends TorchNode {
  constructor(geometry,material) { super();this.geometry=geometry;this.material=material; }
}
const fakeThree={
  Group:TorchNode,Mesh:TorchMesh,Sprite:TorchMesh,PointLight:TorchNode,
  Matrix4:class {},Vector3:class {},Quaternion:class {},
  TextureLoader:class { load(url){const texture={url};loadedTorchTextures.push(texture);return texture;} },
  PlaneGeometry:class { constructor(width,height){this.width=width;this.height=height;} },
  MeshBasicMaterial:class { constructor(args){Object.assign(this,args);} },
  DoubleSide:2,NearestFilter:1003,SRGBColorSpace:'srgb'
}; // Only the Three entry points needed by the static torch artwork.
const artWindow={THREE:fakeThree,
  FurnitureLightRegistry:{register(light){registeredTorchLights.push(light);}}};
vm.runInNewContext(authoredTorchSource,{window:artWindow,THREE:fakeThree}, {filename:'authored-furniture-runtime.js'});
const firstMount=new TorchNode(),secondMount=new TorchNode(); // Independent furniture roots must not share mutable transforms.
const sprite1=artWindow.AuthoredFurniture.attachWallTorchSprite(firstMount,fakeThree);
const sprite2=artWindow.AuthoredFurniture.attachWallTorchSprite(secondMount,fakeThree);
assert.ok(sprite1&&sprite2,'wall torches assemble with the real runtime helper');
assert.notEqual(sprite1,sprite2,'each placed torch has its own support-relative transform');
assert.equal(loadedTorchTextures.length,1,'all mounted sprites share the same loaded handheld PNG');
const paintedSprite=sprite1.children.find(child=>child.name==='wall_torch_actual_handheld_png');
assert.ok(paintedSprite,'one handheld torch PNG plane is attached to the perch');
assert.equal(paintedSprite.rotation.z,Math.PI,'painted down points up in world space');
assert.equal(sprite1.rotation.x,Math.PI/6,'torch leans exactly thirty degrees toward the room');
assert.equal(paintedSprite.geometry.width,.26,'wall sprite maintains the intended narrow handheld proportions');
assert.equal(paintedSprite.geometry.height,.70,'wall sprite maintains the original elongated torch aspect');
assert.equal(registeredTorchLights.length,2,'one light source per mounted torch, not per primitive flame');
assert.equal(artWindow.AuthoredFurniture.attachWallTorchSprite(firstMount,fakeThree),sprite1,
  'repeated attachments never duplicate the torch or its light');
assert.equal(registeredTorchLights.length,2,'reattachment does not register duplicate lights');

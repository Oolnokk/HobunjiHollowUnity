'use strict';

const assert = require('node:assert/strict'); // Pair-only sprite layer order regression checks.
const fs = require('node:fs'); // Test actual editor/runtime modules.
const vm = require('node:vm'); // Execute browser implementation with a small canvas harness.

async function run() {
  const canvases = []; // Every composed PNG receives its own recorded draw list.
  class Image {
    set src(value) {
      this.key = value.includes('weaponhead_') ? 'head' : 'haft'; // Identify which image the production compositor paints.
      this.onload?.(); // Simulate successful CORS image loading.
    }
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas'); // Production compositor creates one alpha-inspection canvas plus an output canvas.
      const canvas = { width: 0, height: 0, operations: [] };
      const ctx = {
        drawImage(image) { canvas.operations.push('paint:' + (image?.key || 'unknown')); },
        getImageData() {
          const data = new Uint8ClampedArray(450 * 1204 * 4); // One opaque head pixel for real bounds math.
          data[(100 * 450 + 200) * 4 + 3] = 255;
          return { data };
        },
        save() { canvas.operations.push('save'); }, restore() { canvas.operations.push('restore'); },
        rect() {}, clip() { canvas.operations.push('clip'); }, beginPath() {},
        scale(x,y) { canvas.operations.push('scale:' + x + ',' + y); },
        translate(x,y) { canvas.operations.push('translate:' + x + ',' + y); },
        transform(a,b,c,d,e,f) { canvas.operations.push('head-transform:' + [a,b,c,d,e,f].join(',')); }
      };
      canvas.getContext = () => ctx;
      canvases.push(canvas);
      return canvas;
    }
  };
  const window = {}; // Shared game namespace for config, cache and sprite composition.
  const ctx = vm.createContext({ window, Image, document, console, Uint8ClampedArray }); // Real browser module can run unaltered.
  for (const path of ['docs/config/modular-weapons.js', 'docs/js/modular-weapons.js']) {
    vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  }
  const api = window.ModularWeapons;
  const config = api.getConfig();
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'haft-over-head', 'Default is haft in the foreground.');
  assert.equal(config.shafts.dagger.overrides['fishing-spear']?.layerOrder, 'haft-over-head', 'Every pair has an explicitly curated shipped layer.');
  function paints(canvas) { return canvas.operations.filter(op => op.startsWith('paint:')); }
  const defaultCanvas = await api.compose('dagger', 'fishing-spear'); // Compatible single-headed weapon.
  assert.deepEqual(paints(defaultCanvas), ['paint:head', 'paint:haft'], 'Default renderer paints head first.');

  const draft = JSON.parse(JSON.stringify(api.getConfig())); // Simulates editor save/export into a validated draft.
  draft.shafts.dagger.overrides['fishing-spear'].layerOrder = 'head-over-haft'; // Override only one exact pair.
  api.replace(draft, true);
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'head-over-haft');
  assert.equal(api.settings('dagger', 'dagger-sword').layerOrder, 'haft-over-head', 'Override must not leak to other heads.');
  const swapped = await api.compose('dagger', 'fishing-spear'); // Revision change invalidates previous canvas.
  assert.notEqual(swapped, defaultCanvas, 'Switching layer order recomposes cached artwork.');
  assert.deepEqual(paints(swapped), ['paint:haft', 'paint:head'], 'Head-over-haft paints the haft first.');

  const copy = JSON.parse(JSON.stringify(api.getConfig())); // Pair preference survives export -> import validation.
  api.replace(copy);
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'head-over-haft');

  copy.shafts.dagger.overrides['fishing-spear'].layerOrder = 'invalid';
  api.replace(copy);
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'haft-over-head', 'Unknown layer values fall back safely.');
  const restored = await api.compose('dagger', 'fishing-spear');
  assert.deepEqual(paints(restored), ['paint:head', 'paint:haft']);

  // Multi-ended weapon draws EVERY matching head below a single shaft, not interleaved with it.
  const doubled = await api.compose('bshuakauitl', 'warhammer');
  assert.deepEqual(paints(doubled), ['paint:haft', 'paint:head', 'paint:head'], 'Both sleeve heads sit above the haft from authored pair settings.');
  const multi = JSON.parse(JSON.stringify(api.getConfig()));
  multi.shafts.bshuakauitl.overrides.warhammer = {
    ...multi.shafts.bshuakauitl.overrides.warhammer, layerOrder: 'haft-over-head'
  };
  api.replace(multi);
  assert.deepEqual(paints(await api.compose('bshuakauitl', 'warhammer')),
    ['paint:head', 'paint:head', 'paint:haft'], 'Manual per-pair override puts both sleeve heads below the shaft.');

  // Cloned rig adjustments must affect fitted HEAD primitives, but never the shaft drawing
  // or its original fuel-marker source (living flames have their own stationary carrier).
  const resetStaff = JSON.parse(JSON.stringify(window.MODULAR_WEAPON_CONFIG)); // Reset known source setup before the rig-transform test.
  api.replace(resetStaff);
  const staffIdentity = await api.compose('hachutuTorchStaff', 'warhammer'); // Original head fit and fixed nonmetal shaft.
  const initialHeadTransforms = staffIdentity.operations.filter(op => op.startsWith('head-transform:'));
  assert.equal(initialHeadTransforms.length, 2, 'Torch-Staff uses both mirrored B\'shuakauitl sleeve mounts');
  const staffEdited = JSON.parse(JSON.stringify(api.getConfig()));
  staffEdited.shafts.hachutuTorchStaff.duplicateTransform = { scaleX: 1.75, scaleY: 0.65, x: 125, y: -200 }; // Intentionally large attachment-only motion.
  api.replace(staffEdited);
  const transformed = await api.compose('hachutuTorchStaff', 'warhammer');
  assert.deepEqual(paints(transformed), paints(staffIdentity), 'rig movement never removes or duplicates the staff PNG or the heads');
  assert.notDeepEqual(transformed.operations.filter(op => op.startsWith('head-transform:')), initialHeadTransforms,
    'fitted head primitive matrices must follow the transformed tang/sleeve rig');
  const globalFrameTransformCount = transformed.operations.filter(op => op.startsWith('scale:') || op.startsWith('translate:')).length;
  assert.equal(globalFrameTransformCount, 2,
    'shaft rendering only uses output-frame scale/translation, with no duplicate-rig transform on the shaft PNG');
  assert.equal(transformed.operations.filter(op => op === 'paint:haft').length, 1,
    'nonmetal shaft artwork is painted exactly once at original authoring coordinates');
  assert(transformed.modularNonMetalMask instanceof Uint8Array, 'the fixed shaft still preserves its independent nonmetal recolor mask');

  const fireActivations = []; // Captures the actual modular weapon decorator's living flame carrier in a lightweight Three.js fixture.
  const fireWindow = { ModularWeapons: api, HobunjiLayeredWeaponEffects: {
    activateStatic(state, base, layers, meshes, image, unit) {
      fireActivations.push({ carrier: state.plane, base, image, unit });
    }, dispose() {}, stepFire() {},
  } };
  vm.runInContext(fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8'),
    vm.createContext({ window: fireWindow })); // Runtime uses the same committed staff VFX configuration.
  class Vec3 {
    constructor(x=0,y=0,z=0) { this.set(x,y,z); }
    set(x,y,z) { this.x=x;this.y=y;this.z=z;return this; }
    toArray() { return [this.x,this.y,this.z]; }
  }
  class Group3 {
    constructor() {
      this.children=[];this.userData={};this.position=new Vec3();this.scale=new Vec3(1,1,1);
      this.renderOrder=0;
    }
    add(child) { this.children.push(child);child.parent=this; }
    remove(child) { this.children=this.children.filter(x=>x!==child);child.parent=null; }
  }
  const modelImage={width:450,height:1204}; // Source dimensions match the existing modular PNG authoring frame.
  const Three={Group:Group3,Vector3:Vec3,TextureLoader:class {
    load(_url,done) { done({image:modelImage}); }
  }}; // No WebGL is required to verify the real asynchronous decorator's source-transform behavior.
  const fireDocument={currentScript:{src:'https://example.test/docs/js/weapon-sprite-assemblies.js'}};
  vm.runInContext(fs.readFileSync('docs/js/weapon-sprite-assemblies.js','utf8'),
    vm.createContext({window:fireWindow,document:fireDocument,URL,location:{href:'https://example.test/docs/index.html',pathname:'/index.html'},
      performance:{now:()=>50},setTimeout(){},console})); // Separate living FX harness uses the real production assembler.
  const carrierPlane=new Group3(); // The composite PNG stays as the unchanged main held weapon plane.
  carrierPlane.material={map:{image:modelImage}};carrierPlane.geometry={parameters:{width:.5}};carrierPlane.renderOrder=1.5;
  const heldRoot=new Group3();
  heldRoot.userData.toolPlane=carrierPlane;heldRoot.add(carrierPlane);
  const itemKey='modular:hachutuTorchStaff:warhammer:nativeCopper'; // One of the allowed B'shuakauitl head families.
  fireWindow.HobunjiWeaponSpriteAssemblies.decorate(heldRoot,itemKey,{
    modular:{shaft:'hachutuTorchStaff',head:'warhammer'},shapeKey:'hachutuTorchStaff',sprite:itemKey,
  },{THREE:Three});
  for(let i=0;i<12;i++)await Promise.resolve(); // Flush async image texture fixture without requiring an event loop.
  assert.equal(fireActivations.length,1,'the complete modular staff has one independently animated source-shaft emitter');
  assert.equal(fireActivations[0].base.vfx.worldRise,true,'the modular staff retains world-up particle motion');
  assert.equal(fireActivations[0].carrier.parent,carrierPlane,'live flames stay under the fixed shaft pose');
  assert.equal(fireActivations[0].carrier.position.x,0,'rig X translation does not drag shaft flame origins');
  assert.equal(fireActivations[0].carrier.position.y,0,'rig Y translation does not drag shaft flame origins');
  assert.equal(fireActivations[0].carrier.scale.x,1,'rig X scaling does not resize shaft flames');
  assert.equal(fireActivations[0].carrier.scale.y,1,'rig Y scaling does not resize shaft flames');
  assert.equal(carrierPlane.material.map.image,modelImage,'the real composite metal head texture remains unchanged');

  // Older imports inherit all committed, manually authored pair choices.
  api.replace({ schema: 'hobunji_modular_weapons.v1', heads: {}, shafts: {} });
  assert.equal(api.settings('dagger', 'fishing-spear').layerOrder, 'haft-over-head');
  assert.equal(api.settings('warhammer', 'fishing-mace').layerOrder, 'head-over-haft', 'Legacy imports inherit committed sleeve-head foreground order.');

  const html = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8');
  const editor = fs.readFileSync('docs/tools/modular-weapon-editor/editor.js', 'utf8');
  assert(html.includes('id="layer-order"') && html.includes('value="haft-over-head"')
    && html.includes('value="head-over-haft"'), 'Editor exposes both order options.');
  assert(editor.includes("byId('layer-order').onchange"), 'Layer select has active change handler.');
  assert(editor.includes("pair.layerOrder = byId('layer-order').value"), 'Both manual choices are saved explicitly and survive curated default fallback.');
  console.log('Modular layering: default, per-pair override, render order, cache, multi-mount, import and editor wiring passed.');
}

module.exports = run; // Allows tests to run inside a library harness without spawning subprocesses.
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });

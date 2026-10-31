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
  const originalRig = api.attachmentRig(api.getConfig().shafts.hachutuTorchStaff,
    api.getConfig().heads.warhammer, api.settings('hachutuTorchStaff', 'warhammer')); // Actual source hierarchy, not just modified world mount coordinates.
  assert.equal(originalRig.children.length, 2, 'both mounting lines are children of the scaling rig');
  assert.deepEqual(originalRig.children.map(mount => mount.children.map(child => child.kind)),
    [['primitive'], ['primitive']], 'head primitives are nested under each mount, not under the shaft bitmap');
  const staffEdited = JSON.parse(JSON.stringify(api.getConfig()));
  staffEdited.shafts.hachutuTorchStaff.duplicateTransform = { scaleX: 1.75, scaleY: 0.65, x: 125, y: -200 }; // Intentionally large attachment-only motion.
  api.replace(staffEdited);
  const transformed = await api.compose('hachutuTorchStaff', 'warhammer');
  assert.deepEqual(paints(transformed), paints(staffIdentity), 'rig movement never removes or duplicates the staff PNG or the heads');
  const transformedRig = api.attachmentRig(api.getConfig().shafts.hachutuTorchStaff,
    api.getConfig().heads.warhammer, api.settings('hachutuTorchStaff', 'warhammer')); // Parent/child hierarchy must survive saved nonuniform edits.
  assert.equal(transformedRig.kind, 'attachmentRig');
  assert.equal(transformedRig.shaftOutsideRig, true);
  assert.equal(transformedRig.children.length, 2);
  assert(transformedRig.children.every(mount => mount.type === 'eye'), 'warhammer head primitives are children of sleeve mount nodes');
  const tangRig = api.attachmentRig(api.getConfig().shafts.hachutuTorchStaff,
    api.getConfig().heads['fishing-spear'], api.settings('hachutuTorchStaff', 'fishing-spear')); // Check blade/tang descendants independently.
  assert.equal(tangRig.children.length, 2, 'both tang mounts inherit the same shared parent rig');
  assert(tangRig.children.every(mount => mount.type === 'tang' && mount.children[0].kind === 'primitive'),
    'tang-based heads remain nested child primitives, not independently transformed heads');
  assert.deepEqual(transformedRig.children.map(m => m.children[0].localMatrix),
    originalRig.children.map(m => m.children[0].localMatrix),
    'parent rig movement must not change each primitive\'s local placement');
  assert.notDeepEqual(transformedRig.children.map(m => m.children[0].worldMatrix),
    originalRig.children.map(m => m.children[0].worldMatrix),
    'both child primitives inherit the parent\'s X/Y scale and translation');
  for (const mount of transformedRig.children) {
    assert.deepEqual(mount.children[0].worldMatrix,
      api.multiplyAffine(transformedRig.parent, mount.children[0].localMatrix),
      'rendered primitive world transform must be rig-parent multiplied by child local fit');
  }
  const actualTransforms = transformed.operations.filter(op => op.startsWith('head-transform:'));
  assert.equal(actualTransforms.length, 3, 'one explicit parent rig transform wraps exactly two child head transforms');
  assert.deepEqual(actualTransforms.slice(1), initialHeadTransforms,
    'the canvas renders the same primitive-local matrices inside the transformed parent');
  assert.notDeepEqual(actualTransforms[0], initialHeadTransforms[0],
    'the rig transform is a separate parent, not an additional child-primitive adjustment');
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
  const Three={Group:Group3,Vector3:Vec3,Quaternion:class {},Matrix4:class {},TextureLoader:class {
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
  assert(html.includes('id="rig-tree"') && editor.includes('api.attachmentRig('),
    'Mobile editor exposes the actual parent rig and primitive child hierarchy rather than only flattened transforms.');
  // Run the actual editor's rig/canvas helpers: the old bug was that the artist-facing
  // shaft canvas painted RAW mounts even though the hidden compositor had transformed them.
  const helperStart = editor.indexOf('  function rigLayout(id) {');
  const helperEnd = editor.indexOf('  async function preview() {', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'editor rig helpers must remain a single testable block');
  const rigHelperSource = editor.slice(helperStart, helperEnd);
  const fixture = JSON.parse(JSON.stringify(api.getConfig().shafts.hachutuTorchStaff)); // Fixed shaft bitmap, editable child mount rig.
  fixture.duplicateTransform = { scaleX: 1.8, scaleY: .75, x: 50, y: -120 };
  const editorCanvasOps = [];
  const authorCanvas = {
    width: 450, height: 1204,
    getContext: () => ({
      clearRect: (...args) => editorCanvasOps.push(['clear', ...args]),
      drawImage: () => editorCanvasOps.push(['haft']),
    }),
  };
  const editorDrawnMounts = []; // Receives positions of actual overlay lines, not just source draft values.
  const editorDrawnGizmos = [];
  const editorHelpers = new Function('api', 'chosenShaft', 'chosenHead', 'cachedImages', 'byId',
    'lineMarker', 'drawGizmo', 'mountIndex', rigHelperSource +
    '\\nreturn { rigLayout, displayMounts, rigToLocal, drawLines };')(
    api, () => fixture, () => api.getConfig().heads.warhammer, { 'shaft-canvas': {} },
    () => authorCanvas,
    (_ctx, mount) => editorDrawnMounts.push(mount),
    (_ctx, mount) => editorDrawnGizmos.push(mount), 0);
  editorHelpers.drawLines('shaft-canvas');
  assert.equal(editorCanvasOps.filter(event => event[0] === 'haft').length, 1,
    'rig edit draws the original shaft only once, with no source-image scaling');
  assert.deepEqual(editorDrawnMounts, api.shaftMounts(fixture),
    'visible primitive mount lines are the fully transformed parent-rig children');
  assert.deepEqual(editorDrawnGizmos[0], editorDrawnMounts[0],
    'touch/drag gizmo is rendered at the actual visible transformed mount');
  const sourcePoint = fixture.mounts[0].start;
  const visiblePoint = api.duplicatePoint(sourcePoint, fixture.duplicateTransform);
  const pointerBackToLocal = editorHelpers.rigToLocal(visiblePoint, 'shaft-canvas');
  assert(Math.abs(pointerBackToLocal.x - sourcePoint.x) < 1e-9
    && Math.abs(pointerBackToLocal.y - sourcePoint.y) < 1e-9,
    'editing a transformed primitive maps the gesture back to original local mount coordinates');
  assert(editor.includes("field.addEventListener('input', () => applyRig(false))")
    && editor.includes("drawLines('shaft-canvas'); updateRigTree(); preview()"),
    'typing scale or translation immediately redraws both the visible rig and assembled primitives');
  console.log('Modular layering: default, per-pair override, render order, cache, multi-mount, import and editor wiring passed.');
}

module.exports = run; // Allows tests to run inside a library harness without spawning subprocesses.
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });

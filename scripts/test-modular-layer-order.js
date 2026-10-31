'use strict';

const assert = require('node:assert/strict'); // Pair-only sprite layer order regression checks.
const fs = require('node:fs'); // Test actual editor/runtime modules.
const vm = require('node:vm'); // Execute browser implementation with a small canvas harness.

async function run() {
  const canvases = []; // Every composed PNG receives its own recorded draw list.
  class Image {
    set src(value) {
      this.key = value.includes('weaponjunction_') ? 'junction' : value.includes('weaponhead_') ? 'head' : 'haft'; // Identify actual primitive and junction sprites.
      this.width = this.key === 'junction' ? 20 : 450; this.height = this.key === 'junction' ? 12 : 1204; // Authoring frame and junction size fixture.
      this.onload?.(); // Simulate successful CORS image loading.
    }
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas'); // Production compositor creates one alpha-inspection canvas plus an output canvas.
      const canvas = { width: 0, height: 0, operations: [], drawnPixels: [] };
      let matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; // Real canvas CTM semantics, not the old operation-count-only fixture.
      const saved = []; // Parent and child transforms are nested via save/restore.
      const multiply = t => { matrix = {
        a: matrix.a*t.a + matrix.c*t.b, b: matrix.b*t.a + matrix.d*t.b,
        c: matrix.a*t.c + matrix.c*t.d, d: matrix.b*t.c + matrix.d*t.d,
        e: matrix.a*t.e + matrix.c*t.f + matrix.e,
        f: matrix.b*t.e + matrix.d*t.f + matrix.f,
      }; };
      const pointOnBitmap = (x,y) => ({x:matrix.a*x + matrix.c*y + matrix.e,y:matrix.b*x+matrix.d*y+matrix.f});
      const ctx = {
        drawImage(image, x=0, y=0) {
          canvas.operations.push('paint:' + (image?.key || 'unknown'));
          if (image?.key === 'head' || image?.key === 'haft') {
            canvas.drawnPixels.push({kind:image.key, origin:pointOnBitmap(200,100),
              axis:pointOnBitmap(300,100)}); // Track two actual raster sample positions under composed parent/child transforms.
          }
          if (image?.key === 'junction') {
            canvas.drawnPixels.push({kind:'junction', origin:pointOnBitmap(x+(image.width||0)/2,y+(image.height||0)/2)});
          }
        },
        getImageData() {
          const data = new Uint8ClampedArray(450 * 1204 * 4); // One opaque head pixel for real bounds math.
          data[(100 * 450 + 200) * 4 + 3] = 255;
          return { data };
        },
        save() { canvas.operations.push('save'); saved.push({...matrix}); },
        restore() { canvas.operations.push('restore'); matrix = saved.pop(); },
        rect() {}, clip() { canvas.operations.push('clip'); }, beginPath() {},
        scale(x,y) { canvas.operations.push('scale:' + x + ',' + y); multiply({a:x,b:0,c:0,d:y,e:0,f:0}); },
        translate(x,y) { canvas.operations.push('translate:' + x + ',' + y); multiply({a:1,b:0,c:0,d:1,e:x,f:y}); },
        transform(a,b,c,d,e,f) { canvas.operations.push('head-transform:' + [a,b,c,d,e,f].join(',')); multiply({a,b,c,d,e,f}); },
        setTransform(a,b,c,d,e,f) { canvas.operations.push('set-transform'); matrix={a,b,c,d,e,f}; },
        rotate(theta) { canvas.operations.push('rotate'); multiply({a:Math.cos(theta),b:Math.sin(theta),
          c:-Math.sin(theta),d:Math.cos(theta),e:0,f:0}); },
        putImageData() { canvas.operations.push('raster-update'); }
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
  staffEdited.shafts.hachutuTorchStaff.attachmentRigTransform = { scaleX: 1.75, scaleY: 0.65, x: 125, y: -200 }; // Intentionally large attachment-only motion.
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
  const sampleRelativeToShaft = canvas => {
    const frame = canvas.modularFrame; // Recover real source pixels from potentially resized/compressed canvas coordinates.
    const toOriginal = pixel => ({
      x: frame.left + pixel.x / canvas.width * frame.width,
      y: frame.top + pixel.y / canvas.height * frame.height,
    });
    const headPixels = canvas.drawnPixels.filter(p => p.kind === 'head');
    const shaftPixels = canvas.drawnPixels.filter(p => p.kind === 'haft');
    const shaftPt = toOriginal(shaftPixels[0].origin);
    return headPixels.map(p => ({
      dx:toOriginal(p.origin).x-shaftPt.x,dy:toOriginal(p.origin).y-shaftPt.y,
      headWidth:Math.hypot(toOriginal(p.axis).x-toOriginal(p.origin).x,
        toOriginal(p.axis).y-toOriginal(p.origin).y),
    }));
  };
  const identityPixels = sampleRelativeToShaft(staffIdentity);
  const scaledPixels = sampleRelativeToShaft(transformed);
  assert.equal(identityPixels.length, 2);
  assert.equal(scaledPixels.length, 2);
  assert(scaledPixels.some((p,i) => Math.abs(p.dx - identityPixels[i].dx)>5),
    'real composed head raster pixels must translate relative to the fixed staff');
  assert(scaledPixels.some((p,i) => Math.abs(p.dy - identityPixels[i].dy)>5),
    'real composed head raster pixels must move vertically with the rig');
  assert(scaledPixels.some((p,i) => Math.abs(p.headWidth-identityPixels[i].headWidth)>5),
    'real composed head raster pixel spacing must scale; checking matrices alone is insufficient');
  // The historical duplicate-only gate silently ignored scaling on any ORIGINAL shaft.
  const originalShaftDraft = JSON.parse(JSON.stringify(api.getConfig()));
  originalShaftDraft.shafts.bshuakauitl.attachmentRigTransform = { scaleX: 2.2, scaleY: .8, x: 95, y: 45 };
  api.replace(originalShaftDraft);
  const originalShaftRig = api.attachmentRig(api.getConfig().shafts.bshuakauitl,
    api.getConfig().heads.warhammer, api.settings('bshuakauitl','warhammer'));
  assert.equal(originalShaftRig.parent.a, 2.2, 'parent X scale is not gated behind duplicateFrom');
  assert.equal(originalShaftRig.parent.d, .8, 'parent Y scale is not gated behind duplicateFrom');
  assert.equal(api.shaftMounts(api.getConfig().shafts.bshuakauitl).length, 4);
  const oldDraft = JSON.parse(JSON.stringify(window.MODULAR_WEAPON_CONFIG));
  oldDraft.shafts.hachutuTorchStaff.duplicateTransform = { scaleX: 1.3, scaleY: 1.6, x: -45, y: 70 };
  api.replace(oldDraft);
  assert.deepEqual(api.shaftRigTransform(api.getConfig().shafts.hachutuTorchStaff),
    { scaleX: 1.3, scaleY: 1.6, x: -45, y: 70 },
    'existing exported duplicateTransform drafts migrate to the canonical rig transform');

  vm.runInContext(fs.readFileSync('docs/js/modular-weapon-bridge-fill.js','utf8'), ctx); // Recipe expansion is required for actual area tests.
  // Independently transformed local area: only the TOP eye/head and the TOP
  // recipe box are children. The lower end of the same shaft must be untouched.
  const areaBase=JSON.parse(JSON.stringify(window.MODULAR_WEAPON_CONFIG));
  api.replace(areaBase);
  const baseTwoHead=await api.compose('hachutuTorchStaff','warhammer');
  const areaDraft=JSON.parse(JSON.stringify(api.getConfig()));
  const topArea={id:'topCap',label:'Top cap',box:{x0:130,y0:185,x1:280,y1:348},
    transform:{scaleX:1.4,scaleY:.7,x:63,y:-36}};
  areaDraft.shafts.hachutuTorchStaff.rigRegions=[topArea];
  api.replace(areaDraft);
  const areaShaft=api.getConfig().shafts.hachutuTorchStaff;
  assert.equal(areaShaft.rigRegions.length,1,'area selection survives validated save/load');
  const areaRig=api.attachmentRig(areaShaft,api.getConfig().heads.warhammer,
    api.settings('hachutuTorchStaff','warhammer'));
  assert.equal(areaRig.children.filter(m=>m.regionId==='topCap').length,1,
    'ONLY the top mounting primitive joins this local area');
  assert.equal(areaRig.children.filter(m=>!m.regionId).length,1);
  const areaCanvas=await api.compose('hachutuTorchStaff','warhammer');
  const sampleHeads=canvas=>{
    const frame=canvas.modularFrame;
    return canvas.drawnPixels.filter(p=>p.kind==='head').map(p=>({
      x:frame.left+p.origin.x/canvas.width*frame.width,
      y:frame.top+p.origin.y/canvas.height*frame.height,
      scale:Math.hypot(p.axis.x-p.origin.x,p.axis.y-p.origin.y)*frame.width/canvas.width,
    }));
  };
  const samples0=sampleHeads(baseTwoHead),samples1=sampleHeads(areaCanvas);
  assert.equal(samples0.length,2);assert.equal(samples1.length,2);
  assert(Math.hypot(samples0[0].x-samples1[0].x,samples0[0].y-samples1[0].y)<1e-5,
    'head on unselected lower mount does not move');
  assert(Math.hypot(samples0[1].x-samples1[1].x,samples0[1].y-samples1[1].y)>15,
    'selected top head is transformed in final composed artwork');
  assert(Math.abs(samples1[1].scale-samples0[1].scale)>5,'selected head really scales');
  const beforeRecipe=api.expandOps(areaBase.shafts.hachutuTorchStaff.overrides.dagger.bridges.strokes);
  const afterRecipe=api.rigBridgeOperations(areaShaft,areaShaft.overrides.dagger.bridges.strokes);
  assert.equal(beforeRecipe.length,afterRecipe.length);
  assert(afterRecipe.some(op=>op._rigRegionId==='topCap'),
    'top placed recipe produces transformed children');
  assert(afterRecipe.some(op=>!op._rigRegionId && op.points),
    'lower placed recipe retains unselected original geometry');
  for(const op of afterRecipe.filter(op=>op._rigRegionId==='topCap'&&op.points)){
    const src=beforeRecipe[afterRecipe.indexOf(op)];
    if(!src.points?.length)continue;
    const expected=api.rigPoint(areaShaft,{x:src.points[0][0],y:src.points[0][1]},topArea);
    assert(Math.abs(expected.x-op.points[0][0])<1e-7&&Math.abs(expected.y-op.points[0][1])<1e-7,
      'every expanded top recipe stroke inherits local area before parent');
  }
  const regionReload=JSON.parse(JSON.stringify(api.getConfig()));
  api.replace(regionReload);
  assert.deepEqual(api.getConfig().shafts.hachutuTorchStaff.rigRegions,areaShaft.rigRegions,
    'area labels, source box, and transformation survive a second configuration round trip');
  // Optional shaft art: the shaft and fuel move together, but the two fitted
  // head primitives preserve their positions when the overall rig is unchanged.
  const unscaledArt=await api.compose('hachutuTorchStaff','warhammer');
  const artDraft=JSON.parse(JSON.stringify(api.getConfig()));
  artDraft.shafts.hachutuTorchStaff.shaftArtTransform={
    enabled:true,scaleX:1.45,scaleY:.8,x:45,y:-70
  };
  api.replace(artDraft);
  const artShaft=api.getConfig().shafts.hachutuTorchStaff;
  assert.equal(api.shaftArtTransform(artShaft).enabled,true);
  const scaledArt=await api.compose('hachutuTorchStaff','warhammer');
  for(const [i,before] of sampleHeads(unscaledArt).entries()) {
    const after=sampleHeads(scaledArt)[i];
    assert(Math.hypot(after.x-before.x,after.y-before.y)<1e-7
      && Math.abs(after.scale-before.scale)<1e-7,
      'optional shaft art must not change attached head pixels (allow subpixel canvas rounding)');
  }
  const shaftSample=canvas=>{
    const p=canvas.drawnPixels.find(x=>x.kind==='haft').origin,f=canvas.modularFrame;
    return {x:f.left+p.x/canvas.width*f.width,y:f.top+p.y/canvas.height*f.height};
  };
  assert(Math.hypot(shaftSample(unscaledArt).x-shaftSample(scaledArt).x,
    shaftSample(unscaledArt).y-shaftSample(scaledArt).y)>12,
    'opt-in shaft-art transform moves actual shaft pixels independently of heads');
  const artOffDraft=JSON.parse(JSON.stringify(api.getConfig()));
  artOffDraft.shafts.hachutuTorchStaff.shaftArtTransform.enabled=false;
  api.replace(artOffDraft);
  for(const [i,before] of sampleHeads(unscaledArt).entries()) {
    const after=sampleHeads(await api.compose('hachutuTorchStaff','warhammer'))[i];
    assert(Math.hypot(after.x-before.x,after.y-before.y)<1e-7
      && Math.abs(after.scale-before.scale)<1e-7,
      'disabled shaft art must preserve attached head pose');
  }

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
  // A separate opt-in shaft transformation must move/scale both the shaft bitmap
  // and its living source emitter. Region and overall rig edits cannot do this.
  const flameDraft=JSON.parse(JSON.stringify(api.getConfig()));
  flameDraft.shafts.hachutuTorchStaff.shaftArtTransform={enabled:true,scaleX:1.4,scaleY:.6,x:72,y:-90};
  api.replace(flameDraft);
  const secondPlane=new Group3();
  secondPlane.material={map:{image:modelImage}};secondPlane.geometry={parameters:{width:.5}};
  const secondRoot=new Group3();
  secondRoot.userData.toolPlane=secondPlane;secondRoot.add(secondPlane);
  fireWindow.HobunjiWeaponSpriteAssemblies.decorate(secondRoot,itemKey,{
    modular:{shaft:'hachutuTorchStaff',head:'warhammer'},shapeKey:'hachutuTorchStaff',sprite:itemKey,
  },{THREE:Three});
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(fireActivations.length,2,'opt-in transformed staff still initializes its live fire carrier');
  const fireCar=fireActivations[1].carrier;
  assert(Math.abs(fireCar.position.x-(72*.5/450))<1e-9
    && Math.abs(fireCar.position.y-(90*.5/450))<1e-9,
    'live flame origins inherit opt-in shaft-art translation but not rig-region movement');
  assert(Math.abs(fireCar.scale.x-1.4)<1e-9 && Math.abs(fireCar.scale.y-.6)<1e-9,
    'flame emission scale follows ONLY optional shaft art scaling');

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
  for(const id of ['shaft-art-enabled','shaft-art-scale-x','shaft-art-scale-y','shaft-art-x','shaft-art-y',
    'region-select','region-list','region-remove','region-name','region-scale-x','region-scale-y','region-x','region-y']){
    assert(html.includes('id="'+id+'"'), 'mobile editor must expose working '+id+' input');
  }
  assert(editor.includes("previewCanvas.addEventListener('pointerdown'") &&
    editor.includes("if(regionSelecting && bridgeView && event.isPrimary)") &&
    editor.includes('regionDraft.box=') && editor.includes("region.transform="),
    'region selection is wired to a real pointer rectangle and local transform controls');
  // Run the actual editor's rig/canvas helpers: the old bug was that the artist-facing
  // shaft canvas painted RAW mounts even though the hidden compositor had transformed them.
  const helperStart = editor.indexOf('  function rigLayout(id) {');
  const helperEnd = editor.indexOf('  async function preview() {', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'editor rig helpers must remain a single testable block');
  const rigHelperSource = editor.slice(helperStart, helperEnd);
  const fixture = JSON.parse(JSON.stringify(api.getConfig().shafts.hachutuTorchStaff)); // Fixed shaft bitmap, editable child mount rig.
  fixture.attachmentRigTransform = { scaleX: 1.8, scaleY: .75, x: 50, y: -120 };
  const editorCanvasOps = [];
  const authorCanvas = {
    width: 450, height: 1204,
    getContext: () => ({
      clearRect: (...args) => editorCanvasOps.push(['clear', ...args]),
      drawImage: () => editorCanvasOps.push(['haft']),
      save() {}, restore() {}, translate() {}, scale() {},
    }),
  };
  const editorDrawnMounts = []; // Receives positions of actual overlay lines, not just source draft values.
  const editorDrawnGizmos = [];
  const editorHelpers = new Function('api', 'chosenShaft', 'chosenHead', 'cachedImages', 'byId',
    'lineMarker', 'drawGizmo', 'mountIndex', rigHelperSource +
    '\nreturn { rigLayout, displayMounts, rigToLocal, drawLines };')(
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
  // Verify that bridge/recipe editor pointer coordinates are inverse-transformed
  // from their visible positions, without overwriting the original source steps.
  const bridgeHelpersStart = editor.indexOf('  function bridgeVisual(point, area=undefined) {');
  const bridgeHelpersEnd = editor.indexOf('  function drawBridgeOverlay() {', bridgeHelpersStart);
  assert(bridgeHelpersStart >= 0 && bridgeHelpersEnd > bridgeHelpersStart);
  const bridgeCanvas = { width: 450, height: 1204 };
  const bridgeHelpers = new Function('api','chosenShaft','byId','contentRect','bridgeView',
    editor.slice(bridgeHelpersStart, bridgeHelpersEnd) +
    '\nreturn {bridgeVisual,bridgeLocal,logicalPoint};')(
      api, () => fixture, () => bridgeCanvas,
      () => ({ left: 0, top: 0, scale: 1 }),
      {frame:{left:0,top:0,width:450,height:1204}});
  const localRecipePoint = [215, 480];
  const shownRecipePoint = bridgeHelpers.bridgeVisual(localRecipePoint);
  const pointerRecipePoint = bridgeHelpers.logicalPoint({clientX:shownRecipePoint[0],clientY:shownRecipePoint[1]});
  assert.deepEqual(pointerRecipePoint,localRecipePoint,
    'bridge and recipe touch inputs map back into the original saved rig-local frame');
  assert(editor.includes('const [x0,y0]=bridgeVisual([box.x0,box.y0],area)'),
    'saved recipe boxes are rendered under their region and overall parent in the mobile preview');
  assert(editor.includes('ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f)'),
    'junction ghost preview must inherit the same parent affine as the final sprite');
  const sourcePoint = fixture.mounts[0].start;
  const visiblePoint = api.duplicatePoint(sourcePoint, api.shaftRigTransform(fixture));
  const pointerBackToLocal = editorHelpers.rigToLocal(visiblePoint, 'shaft-canvas');
  assert(Math.abs(pointerBackToLocal.x - sourcePoint.x) < 1e-9
    && Math.abs(pointerBackToLocal.y - sourcePoint.y) < 1e-9,
    'editing a transformed primitive maps the gesture back to original local mount coordinates');
  assert(editor.includes("field.addEventListener('input', () => applyRig(false))")
    && editor.includes("drawLines('shaft-canvas'); updateRigTree(); preview()"),
    'typing scale or translation immediately redraws both the visible rig and assembled primitives');
  // Execute the editor's real input binding; a previous onchange-only hookup left visual
  // primitives unmoved on mobile until the numeric control was blurred.
  const controlsStart = editor.indexOf('  for (const [id, key, fallback, min, max] of [', helperEnd);
  const controlsEnd = editor.indexOf('  function refreshRigPreview() {', controlsStart);
  assert(controlsStart > helperEnd && controlsEnd > controlsStart);
  const controls = new Map();
  for (const id of ['duplicate-scale-x','duplicate-scale-y','duplicate-x','duplicate-y']) {
    controls.set(id, { value: '1', listeners: new Map(),
      addEventListener(name, fn) { this.listeners.set(name, fn); } });
  }
  const changes = { render: 0, tree: 0, preview: 0, save: 0, replaced: 0 };
  const rigBinding = new Function('byId', 'chosenShaft', 'api', 'data', 'drawLines',
    'updateRigTree', 'preview', 'save', editor.slice(controlsStart, controlsEnd));
  rigBinding(id => controls.get(id), () => fixture,
    { replace() { changes.replaced++; }, shaftRigTransform: api.shaftRigTransform }, { shafts: { hachutuTorchStaff: fixture } },
    () => { changes.render++; }, () => { changes.tree++; }, () => { changes.preview++; },
    () => { changes.save++; });
  controls.get('duplicate-scale-x').value = '2.4';
  controls.get('duplicate-scale-x').listeners.get('input')();
  assert.equal(fixture.attachmentRigTransform.scaleX, 2.4);
  assert.equal(changes.replaced, 1);
  assert.equal(changes.preview, 1);
  assert.equal(changes.render, 1);
  controls.get('duplicate-y').value = '86';
  controls.get('duplicate-y').listeners.get('input')();
  assert.equal(fixture.attachmentRigTransform.y, 86);
  assert.equal(changes.preview, 2);
  assert.equal(changes.tree, 2);
  controls.get('duplicate-y').onchange();
  assert.equal(changes.save, 1, 'committing rig edits persists the result without requiring a second transform');
  controls.get('duplicate-scale-y').value = '-';
  controls.get('duplicate-scale-y').listeners.get('input')();
  assert.equal(fixture.attachmentRigTransform.scaleY, .75, 'partial numeric entry does not corrupt the rig');
  // Execute the very same input handler on an ORIGINAL shaft, which has no duplicateFrom.
  // That used to short-circuit, leaving head primitives at their identity transform.
  const originalFixture = JSON.parse(JSON.stringify(api.getConfig().shafts.bshuakauitl));
  assert(!originalFixture.duplicateFrom);
  const originalField = controls.get('duplicate-scale-x');
  originalField.value = '1.65';
  rigBinding(id => controls.get(id), () => originalFixture,
    { replace() { changes.replaced++; }, shaftRigTransform: api.shaftRigTransform },
    { shafts: { bshuakauitl: originalFixture } },
    () => { changes.render++; }, () => { changes.tree++; },
    () => { changes.preview++; }, () => { changes.save++; });
  const prevRenders = changes.preview;
  originalField.listeners.get('input')();
  assert.equal(originalFixture.attachmentRigTransform.scaleX, 1.65,
    'original shafts can move their attached primitives with no duplication requirement');
  assert.equal(changes.preview, prevRenders + 1,
    'original-shaft controls must refresh the visible preview too');
  const recolorSource = fs.readFileSync('docs/js/tool-metal-recolor.js','utf8');
  assert(recolorSource.includes('spritePath, modularRevision'),
    'modular head textures must be keyed by composition revision, not stale before the rig moves');
  // THE PREVIOUS MISSING CHILDREN: Dagger, Spear and Dagger-Sword have 20–26
  // operation steps per pair. Recipes are expanded before the parent's affine
  // transform; junction sprites and masks must be included with the heads.
  vm.runInContext(fs.readFileSync('docs/js/modular-weapon-bridge-fill.js','utf8'), ctx);
  const sourceConfig = JSON.parse(JSON.stringify(api.getConfig()));
  const originalStaff = sourceConfig.shafts.hachutuTorchStaff;
  const daggerRecipe = originalStaff.overrides.dagger.bridges.strokes;
  const flatRecipe = api.expandOps(daggerRecipe); // 2 placed recipes expand into 20 actual brush/junction children.
  assert.equal(flatRecipe.length, 20, 'two placed Torch-Staff dagger recipes have 20 child operations');
  const identityOps = api.rigBridgeOperations(originalStaff, daggerRecipe);
  assert.equal(identityOps.length, flatRecipe.length);
  const riggedDraft = JSON.parse(JSON.stringify(sourceConfig));
  riggedDraft.shafts.hachutuTorchStaff.attachmentRigTransform =
    { scaleX: 1.8, scaleY: .65, x: 124, y: -168 };
  api.replace(riggedDraft);
  const rigShaft = api.getConfig().shafts.hachutuTorchStaff;
  const movedOps = api.rigBridgeOperations(rigShaft, daggerRecipe);
  assert.equal(movedOps.length, 20, 'recipe expansion never loses its original children');
  for (let i = 0; i < flatRecipe.length; i++) {
    const oldOp = flatRecipe[i], moved = movedOps[i];
    if (oldOp.junction) {
      assert.equal(moved.x, oldOp.x, 'junction local origin is untouched; canvas parent moves the sprite');
      assert.equal(moved._rigJunction, true);
      continue;
    }
    if (!oldOp.points) continue; // Global cleanup/shading steps affect changed regions, not coordinate lines.
    for (let j = 0; j < oldOp.points.length; j++) {
      const expected = api.duplicatePoint({x:oldOp.points[j][0],y:oldOp.points[j][1]},
        api.shaftRigTransform(rigShaft));
      assert(Math.abs(moved.points[j][0]-expected.x)<1e-7 && Math.abs(moved.points[j][1]-expected.y)<1e-7,
        'EVERY expanded recipe stroke point must inherit the parent rig before replay');
    }
    assert(Math.abs(moved.rX-oldOp.r*1.8)<1e-8
      && Math.abs(moved.rY-oldOp.r*.65)<1e-8,
      'bridge-fill masks must inherit nonuniform X/Y scale, not only move their centre');
  }
  const swordOps = originalStaff.overrides['dagger-sword'].bridges.strokes;
  const swordLocal = api.rigBridgeOperations(originalStaff, swordOps);
  const swordMoved = api.rigBridgeOperations(rigShaft, swordOps);
  assert.equal(swordLocal.length, 26, 'directly authored Dagger-Sword junction and brush sequence is intact');
  assert.equal(swordMoved.filter(op=>op.junction).length, 4);
  for(let i=0;i<swordLocal.length;i++){
    if(swordLocal[i].junction){
      assert.equal(swordMoved[i].x,swordLocal[i].x,
        'junction coordinates stay local so the parent transform is applied once during painting');
    } else if(swordLocal[i].points?.length){
      assert.notDeepEqual(swordMoved[i].points,swordLocal[i].points,
        'manual bridge/smudge points also move with rig, not just recipe operations');
    }
  }
  const junctions = {band:{width:20,height:12},block:{width:22,height:14},sphere:{width:18,height:18}};
  const headBounds = {left:180,top:70,right:225,bottom:300};
  const withoutBridge = api.compositionFrame(rigShaft,api.getConfig().heads['dagger-sword'],
    headBounds,api.settings('hachutuTorchStaff','dagger-sword'));
  const withBridge = api.compositionFrame(rigShaft,api.getConfig().heads['dagger-sword'],
    headBounds,api.settings('hachutuTorchStaff','dagger-sword'),swordMoved,junctions);
  assert(withBridge.width>=withoutBridge.width && withBridge.height>=withoutBridge.height,
    'composite output bounds include scaled/translated operations in addition to the head');
  const stamped=new Uint8Array(120*120), fill=window.ModularWeaponBridgeFill;
  fill.stampStroke(stamped,120,120,{r:5,rX:18,rY:3,points:[[55,55],[65,55]]});
  assert.equal(stamped[55*120+80],1,'X radius visibly expands with X rig scale');
  assert.equal(stamped[65*120+60],0,'Y radius stays compact under reduced Y rig scale');
  assert.deepEqual(api.getConfig().recipes,riggedDraft.recipes,
    'scaling rig must never modify shared authored recipe source data');
  // End-to-end compositing: a junction sprite must be rendered under its own
  // picture transform AND the rig parent, not left behind after head scaling.
  const originalOpsDraft = JSON.parse(JSON.stringify(api.getConfig()));
  originalOpsDraft.shafts.hachutuTorchStaff.attachmentRigTransform = {scaleX:1,scaleY:1,x:0,y:0};
  originalOpsDraft.shafts.hachutuTorchStaff.overrides.warhammer.bridges = {
    strokes:[{junction:'band',x:205,y:520,rotation:0,scale:1}],outline:4,light:[0,-1],shade:0.3,seed:1
  }; // One explicit sprite operation to isolate actual Canvas parent movement.
  api.replace(originalOpsDraft);
  const junctionIdentity = await api.compose('hachutuTorchStaff','warhammer');
  const beforeJunction = junctionIdentity.drawnPixels.filter(p=>p.kind==='junction');
  assert.equal(beforeJunction.length,1,'junction sprite was really drawn on composed frame');
  const translatedOpsDraft = JSON.parse(JSON.stringify(api.getConfig()));
  translatedOpsDraft.shafts.hachutuTorchStaff.attachmentRigTransform={scaleX:1.8,scaleY:.65,x:124,y:-168};
  api.replace(translatedOpsDraft);
  const junctionMoved = await api.compose('hachutuTorchStaff','warhammer');
  const afterJunction = junctionMoved.drawnPixels.filter(p=>p.kind==='junction');
  assert.equal(afterJunction.length,1);
  const unframe = (canvas,p) => ({
    x:canvas.modularFrame.left+p.origin.x*canvas.modularFrame.width/canvas.width,
    y:canvas.modularFrame.top+p.origin.y*canvas.modularFrame.height/canvas.height
  });
  const p0=unframe(junctionIdentity,beforeJunction[0]),p1=unframe(junctionMoved,afterJunction[0]);
  const expected=api.duplicatePoint({x:205,y:520},api.shaftRigTransform(api.getConfig().shafts.hachutuTorchStaff));
  assert(Math.abs(p1.x-expected.x)<1e-5 && Math.abs(p1.y-expected.y)<1e-5,
    'junction sprite is painted using actual scaled/translated parent matrix');
  assert(Math.hypot(p1.x-p0.x,p1.y-p0.y)>30,
    'junction PNG must visibly move, not remain at saved local pixels when the rig moves');
  console.log('Modular layering: transformed actual raster sample positions, original and cloned rig controls, saved drafts, revision cache and editor preview passed.');
}

module.exports = run; // Allows tests to run inside a library harness without spawning subprocesses.
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });

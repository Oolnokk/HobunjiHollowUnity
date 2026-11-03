'use strict';
// Run with node scripts/test-fur-hood-direct-paint.js in a repository checkout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'); // All test fixtures are the committed source, not copies of implementation logic.
const read = pathname => fs.readFileSync(path.join(root, pathname), 'utf8');
const source = read('docs/js/clothing-weaving-system.js');
const author = read('docs/js/fur-hood-direct-paint-editor.js');
const editor = read('docs/tools/pattern-editor/index.html');
new vm.Script(source); // Both the game compositor and its garment paint inverse must parse normally.
new vm.Script(author);
const inline = editor.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
assert(inline, 'Pattern Editor inline initialization exists');
new vm.Script(inline[1]);
assert(editor.includes('id="furPaintBtn"'), 'Paint on hood is available in the existing fur authoring section');
assert(editor.includes('id="furMainViewportBtn"'), 'main right viewport toggle is exposed in animal authoring');
assert(editor.includes("openHoodPainter($('preview').parentElement,exitRightPainter)"), 'the main viewport embeds the editable painter rather than showing a passive hood image');
assert(editor.includes("furRightPainterActive=()=>openingRightPainter||!!rightPainter?.isOpen?.()"), 'the main preview does not overwrite an active paint session');
assert(editor.includes("window.PatternFurniturePreview.dispose();"), 'the embedded painter replaces a previously active 3D viewport too');
assert(editor.includes("previewMode').disabled=value"), 'main preview mode cannot replace the painter during an edit');
assert(author.includes("mountTarget.appendChild(overlay)"), 'paint tools render within the main right-hand viewport when requested');
assert(author.includes("return Object.freeze({ close, isOpen:()=>!closed })"), 'right panel can close an existing shared painting session cleanly');
assert(editor.includes('<option value="furHood">Animal fur hood</option>'), 'main right preview mode supports the hood');
assert(editor.includes("mode === 'furHood'"), 'normal preview renderer delegates to the hood when selected');
assert(editor.includes('window.CreatureGenetics?.PATTERN_DEFS?.[kind]'), 'gene dropdown uses canonical genotype definitions');
assert(editor.includes('<select id="furGeneId">'), 'animal genes are selected rather than manually typed');
assert(editor.includes('FurHoodDirectPaintEditor.visibleBounds(mask.canvas,12)'), 'main hood preview frames only paintable fur, not black opaque sprite padding');
assert(editor.includes("furHoodMarkingsOverride:motif&&gene?[{geneId:gene,pattern:motif,colorHex:ink}]:[]"), 'bare hoods render even before any motif is authored');
assert(editor.includes('id="furPaintView"'), 'front and behind authoring can be selected');
assert(editor.includes('fur-hood-direct-paint-editor.js'), 'editor loads its dedicated paint module');
// The editor loads portrait-utils.js, which provides window.loadImg to ClothingWeavingSystem.
// Without explicitly configuring its base, the nested tool tries tools/pattern-editor/assets/ instead of docs/assets/.
const baseBootstrap = editor.match(/<script>\s*\/\/ This nested tool page[\s\S]*?<\/script>/);
assert(baseBootstrap, 'nested Pattern Editor configures its portrait asset root');
let configuredAssetBase = null; // The standalone bootstrap is evaluated here against a commit-pinned tool-page URL.
const toolUrl = 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/pinned/docs/tools/pattern-editor/index.html';
vm.runInNewContext(baseBootstrap[0].replace(/^<script>|<\/script>$/g, ''), {
  window: { setPortraitAssetBase(value) { configuredAssetBase = value; } },
  document: { baseURI: toolUrl }, URL,
});
assert.equal(configuredAssetBase,
  'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/pinned/docs/assets/',
  'portrait image loader uses the current commit pinned docs/assets/ directory');
for (const sprite of ['furhood-base_tl_m.png', 'furhood-trim_tl_m.png', 'furhood-base_mashtz_m.png', 'furhood-trim_mashtz_m.png']) {
  const resolved = new URL('cosmetics/clothes/hood/' + sprite, configuredAssetBase).href;
  assert(resolved.includes('/docs/assets/cosmetics/clothes/hood/' + sprite), 'hood sprite resolves within docs/assets: ' + sprite);
}
assert(editor.includes('FurHoodDirectPaintEditor.open'), 'button is wired to the real editor');
assert.match(editor,/entry\.patterns\[gene\]\s*=\s*\{\s*motifPng:\s*path,\s*settings,\s*authoring\s*\}/,'runtime motif/setting fields remain unchanged while authoring is dev-only');
assert(source.includes("patternDef?.garmentFixed === true && patternDef?.tiling === false"), 'non-tiling authored motifs use a fixed source frame');
assert(source.includes('directMaskPass || anchored'), 'fixed garment motifs do not inherit the general weaving per-cell phase offset');
assert(source.includes("['base', 'animalFront', 'animalBack'].includes(role)"), 'eligible fur mask excludes normal trim');
assert(author.includes('api.renderClothingLayers'), 'authoring previews use the actual game compositor');
assert(author.includes('stage.style.width=crop.width*scale'), 'the paint stage is sized to visible hood pixels rather than full transparent atlas');
assert(author.includes("canvas.style.left=-crop.x*scale"), 'paint and base canvases preserve full-size source coordinates when visually cropped');
assert(author.includes('result.width=crop.width'), 'result pane also frames the real hood');
assert(author.includes('visibleBounds, open:'), 'framing helper is reused by the right viewport');
assert(author.includes('visibleBounds(maskResult.canvas, 12)'), 'paintable fur mask, not opaque dark backgrounds, determines the hood editor framing');
// The editor must crop transparent sprite margins without moving actual paint coordinates.
const hoodEditorWindow = {};
vm.runInNewContext(author, {window: hoodEditorWindow});
const hoodPixels = new Uint8ClampedArray(64 * 40 * 4); // Mock painted natural fur: only one small shape is opaque.
for (let y = 12; y <= 21; y++) for (let x = 22; x <= 35; x++) hoodPixels[(y*64+x)*4+3] = 255;
const sampleMask = {width:64,height:40,getContext:()=>({getImageData:()=>({data:hoodPixels})})};
const framed = hoodEditorWindow.FurHoodDirectPaintEditor.visibleBounds(sampleMask, 3);
assert.equal(framed.x,19,'visible bounds move past unused horizontal padding');
assert.equal(framed.y,9,'visible bounds move past unused vertical padding');
assert.equal(framed.width,20,'visible bounds include consistent horizontal brush margin');
assert.equal(framed.height,16,'visible bounds include consistent vertical brush margin');
assert.throws(()=>hoodEditorWindow.FurHoodDirectPaintEditor.visibleBounds({width:1,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(4)})})}),/completely transparent/,'a blank source exposes an actionable error');
assert(author.includes('maskRle:encodePaintRuns()'), 'editor retains an exact re-editable pixel baseline');
assert(author.includes('restorePaintRuns(authoring.maskRle)'), 'reopening restores the saved pixel baseline');
assert(author.includes('api.garmentMotifToPaint(motif,settings,w,h)'), 'cross-view re-editing can reproject an existing motif');
assert(author.includes("addEventListener('pointercancel'"), 'touch cancellation does not leave a stuck stroke');
assert(author.includes("data-fur-action=\"undo\"") && author.includes("data-fur-action=\"redo\""), 'mobile undo/redo controls are present');

// A minimal affine-only CanvasRenderingContext2D tracks the actual sequence of
// transform calls made by production garmentPaintToMotif/garmentMotifToPaint.
function multiply(a,b) {
  return [
    a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5],
  ];
}
function canvas() {
  const image={width:0,height:0}; // Receives the saved draw matrix for later real-function invertibility checks.
  const context={
    transform:[1,0,0,1,0,0],stack:[],
    save(){this.stack.push([...this.transform]);},
    restore(){this.transform=this.stack.pop();},
    translate(x,y){this.transform=multiply(this.transform,[1,0,0,1,x,y]);},
    scale(x,y){this.transform=multiply(this.transform,[x,0,0,y,0,0]);},
    rotate(t){this.transform=multiply(this.transform,[Math.cos(t),Math.sin(t),-Math.sin(t),Math.cos(t),0,0]);},
    drawImage(){image.drawTransform=[...this.transform];},
  };
  image.getContext=()=>context;
  return image;
}
const document={
  currentScript:{src:'https://example.test/docs/js/clothing-weaving-system.js'},
  documentElement:{dataset:{}},
  addEventListener(){},querySelectorAll(){return [];},getElementById(){return null;},
  createElement(tag){return tag==='canvas'?canvas():{style:{},dataset:{},appendChild(){}};},
};
const window={
  _imageForTint(image){return image;},
  renderProfile(){},renderPortraitProfile(){},addEventListener(){},setTimeout(){},
};
vm.runInNewContext(source,{
  window,document,URL,performance:{now:()=>0},
  MutationObserver:class{observe(){}},Image:class{},
  fetch:async()=>({ok:false}),
});
const api=window.ClothingWeavingSystem;
assert(api, 'production clothing renderer initialized');
assert.equal(api.garmentPaintSettings({}).tiling,false, 'paint-generated motifs do not tile');
assert.equal(api.garmentPaintSettings({}).garmentFixed,true, 'paint-generated motifs retain fixed source-frame anchoring');
assert.equal(api.__test.resolvedPatternMeshScale(api.garmentPaintSettings({})),1, 'default hood-space motif scale is 1:1 physical garment pixels');
for(const input of [
  {meshScale:1,meshRotationDeg:0},
  {meshScale:0.5,meshRotationDeg:65,usageOffsetX:16,usageOffsetY:-6},
  {meshScale:1.6,meshRotationDeg:-42,usageOffsetX:42,usageOffsetY:12,usageStretchX:1.2,usageStretchY:0.5},
  {meshScale:3.2,meshRotationDeg:180,usageFlipX:true,usageFlipY:true},
]) {
  const settings=api.garmentPaintSettings(input);
  const original={width:150,height:120}; // Non-square source exposes incorrect width/height-origin assumptions.
  const motif=api.garmentPaintToMotif(original,settings);
  const restored=api.garmentMotifToPaint(motif,settings,original.width,original.height);
  assert.equal(restored.width,original.width);
  assert.equal(restored.height,original.height);
  const product=multiply(restored.drawTransform,motif.drawTransform);
  const expected=[1,0,0,1,0,0];
  product.forEach((value,i)=>assert(Math.abs(value-expected[i])<1e-9, 'inverse/forward projection mismatch at affine component '+i));
  if(input.meshScale<1 && input.meshRotationDeg)assert(motif.width>original.width && motif.height>original.height,'small, rotated motif canvas expands rather than clipping edge brushstrokes');
}
assert.throws(
  ()=>api.garmentPaintToMotif({width:400,height:400},api.garmentPaintSettings({meshScale:0.4,usageOffsetX:4000})),
  /larger than 4094/,
  'impossible motif exports fail visibly rather than cropping the painted data'
);
console.log('OK: fur hood direct painting, non-tiling renderer anchoring, UI wiring, re-edit persistence, and four affine transforms');

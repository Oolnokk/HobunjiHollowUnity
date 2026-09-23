const assert = require('assert');
const fs = require('fs');

const editor = fs.readFileSync('docs/tools/procedural-animation-editor/index.html', 'utf8'); // Confirms the original large editor remains structurally intact.
const panelUi = fs.readFileSync('docs/js/panel-ui.js', 'utf8'); // Confirms the adapter loads only for the intended tool path.
const adapterLoader = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8'); // Confirms the small loader preserves Impact and adds Pants inside the same tool.
const adapter = fs.readFileSync('docs/js/procedural-impact-tabs-base.js', 'utf8'); // Verifies the original Impact tab/modal integration contract after modularization.
const pantsLayout = fs.readFileSync('docs/js/procedural-pants-rig-layout-fix.js', 'utf8'); // Guards the embedded Pants author's full-height host allocation.

assert(editor.includes('<summary><b>Baked impact blend space</b>'), 'source blendspace section is missing');
assert(editor.includes('id="gameModalOverlayRoot"'), 'procedural editor modal host is missing');
assert(editor.includes('class="animationHudActions"'), 'procedural editor HUD action row is missing');

assert(panelUi.includes('procedural-animation-editor'), 'PanelUI does not scope the adapter to the procedural editor');
assert(panelUi.includes('procedural-impact-tabs.js?v='), 'PanelUI does not load the Impact/Pants adapter');
assert(adapterLoader.includes('procedural-impact-tabs-base.js'), 'adapter loader does not preserve the original Impact implementation');
assert(adapterLoader.includes('procedural-pants-rig-author.js'), 'adapter loader does not integrate Pants Rig into Procedural Animation');
assert(adapterLoader.includes('procedural-pants-rig-layout-fix.js'), 'adapter loader does not install the Pants full-height layout correction');
assert(pantsLayout.includes('display:flex!important'), 'Pants panel must use a definite flex height chain instead of intrinsic iframe sizing');
assert(pantsLayout.includes('flex:1 1 0!important'), 'Pants author iframe must own the remaining vertical space');
assert(pantsLayout.includes('height:0!important'), 'Pants author iframe/body must suppress intrinsic iframe height during flex sizing');
assert(pantsLayout.includes('flex:0 0 auto!important'), 'Pants status must remain a compact non-growing footer');
assert(pantsLayout.includes('ProceduralPantsRigLayoutFix'), 'Pants layout correction must expose mobile-readable allocation diagnostics');

for (const contract of [
  'impactAuthoringTabPanel',
  'impactBlendspaceTabPanel',
  'dataset.impactTabsReady',
  'nestedBlendspace.childNodes',
  "quickButton.textContent = 'Impact'",
  "selectImpactTab(panel, 'blendspace'",
  'modalRoot.appendChild(panel)',
]) {
  assert(adapter.includes(contract), `Impact tab adapter is missing contract: ${contract}`);
}
assert(!adapter.includes("innerHTML = nestedBlendspace"), 'adapter must move existing controls rather than recreate them');
assert(adapter.includes('width:min(520px,44vw)'), 'wide-screen Impact workspace does not preserve preview space beside it');
assert(adapter.includes('height:min(46dvh,520px)'), 'portrait Impact workspace does not preserve preview space above it');
assert(adapter.includes("getObjectByName('AuthoringPhysicsPortraitCollider')"), 'adapter does not locate the cyan authoring collider');
assert(adapter.includes("previewMode === 'creature' ? Math.PI * 0.5 : 0"), 'animal authoring collider does not receive a creature-only 90-degree Y rotation');
assert(adapter.includes('child.rotation.y = yaw'), 'cyan collider fill and outline do not share the animal Y rotation');
assert(adapter.includes('plane?.geometry?.parameters'), 'animal authoring collider does not read exact PNG PlaneGeometry dimensions');
assert(adapter.includes('model.userData.portraitModelWidth = dimensions.width'), 'animal PNG width is not supplied to the existing authoring-physics collider builder');
assert(adapter.includes('model.userData.portraitModelHeight = dimensions.height'), 'animal PNG height is not supplied to the existing authoring-physics collider builder');
assert(adapter.includes('authoringColliderPngDimensions'), 'resolved animal collider dimensions are not exposed in diagnostic metadata');

console.log('procedural Impact tabs: PASS');

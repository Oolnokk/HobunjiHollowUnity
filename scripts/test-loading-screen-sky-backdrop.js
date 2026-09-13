'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..'); // Used by every fixture read so the test works from any invocation directory.
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8'); // Used to load the production files covered by this regression guard.

const runtimePath = 'docs/js/loading-screen-sky-backdrop.js'; // Used in parse failures and required-runtime assertions below.
const skyDomePath = 'docs/js/sky-dome.js'; // Used to verify the normal 3D sky keeps clouds in front of both celestial bodies.
const editorPath = 'docs/tools/loading-screen-editor/index.html'; // Used to validate the integrated loading-screen + sky-framing authoring surface.
const removedToolPath = 'docs/tools/loading-screen-editor/sky-focus.html'; // Used to guard against accidentally restoring the old standalone workflow.
const configPath = 'docs/config/loading-screens.json'; // Used to confirm exported/shipped framing settings remain compatible.
const bootstrapPath = 'docs/js/local-save-folder.js'; // Used to confirm initial boot still installs the backdrop before the loading-screen runtime.

const runtimeSource = read(runtimePath); // Used by syntax and integration assertions for the loading-screen sky runtime.
const skyDomeSource = read(skyDomePath); // Used by the 3D cloud/celestial ordering assertions.
const editorSource = read(editorPath); // Used by syntax and authoring-workflow assertions for the integrated editor.
const bootstrapSource = read(bootstrapPath); // Used by the boot-loader reference assertion.
const config = JSON.parse(read(configPath)); // Used by version and persisted-offset/zoom assertions.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJavaScript(source, filename) {
  new vm.Script(source, { filename });
}

function extractInlineScripts(html) {
  const scripts = []; // Used as the collected executable inline script bodies from the editor HTML.
  const pattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi; // Used to parse ordinary inline script blocks without executing browser code.
  let match; // Used as the current regex match while walking all inline script tags.
  while ((match = pattern.exec(html))) scripts.push(match[1]);
  return scripts;
}

parseJavaScript(runtimeSource, runtimePath);
parseJavaScript(skyDomeSource, skyDomePath);
parseJavaScript(bootstrapSource, bootstrapPath);
const inlineScripts = extractInlineScripts(editorSource); // Used to ensure the integrated editor contains syntax-valid executable script.
assert(inlineScripts.length > 0, `${editorPath}: expected an inline script`);
inlineScripts.forEach((source, index) => parseJavaScript(source, `${editorPath}#script-${index + 1}`));

assert(Number(config.version) >= 7, `${configPath}: expected version >= 7`);
assert(Number.isFinite(Number(config.settings?.skyFocusOffsetX)), `${configPath}: skyFocusOffsetX must be numeric`);
assert(Number.isFinite(Number(config.settings?.skyFocusOffsetY)), `${configPath}: skyFocusOffsetY must be numeric`);
assert(Number.isFinite(Number(config.settings?.skyZoom)), `${configPath}: skyZoom must be numeric`);
assert(Number(config.settings?.loreSize) === 19, `${configPath}: uploaded loreSize must remain 19`);
assert(Number(config.settings?.scriptSize) === 150, `${configPath}: uploaded scriptSize must remain 150`);
assert(Number(config.settings?.scriptY) === 45, `${configPath}: uploaded scriptY must remain 45`);
assert(Number(config.settings?.columnSpacing) === -0.56, `${configPath}: uploaded columnSpacing must remain -0.56`);
assert(Number(config.settings?.scriptScrollSpeed) === 0.042, `${configPath}: uploaded scriptScrollSpeed must remain 0.042`);
assert(Number(config.settings?.loadPercent) === 63, `${configPath}: uploaded preview progress must remain 63`);
assert(Number(config.settings?.skyFocusOffsetX) === 0, `${configPath}: uploaded skyFocusOffsetX must remain 0`);
assert(Number(config.settings?.skyFocusOffsetY) === -0.5, `${configPath}: uploaded skyFocusOffsetY must remain -0.5`);
assert(Number(config.settings?.skyZoom) === 1.25, `${configPath}: shipped sky zoom must remain 1.25x`);

assert(bootstrapSource.includes('loading-screen-sky-backdrop.js?v=20260913c'), `${bootstrapPath}: current backdrop bootstrap reference missing`);
assert(bootstrapSource.includes('data-loading-sky-retry'), `${bootstrapPath}: DOM-ready backdrop retry guard missing`);
assert(bootstrapSource.includes('#hobunjiLoadScreen>#hlsSkyBackdrop{z-index:0!important}'), `${bootstrapPath}: explicit runtime sky stacking contract missing`);
assert(runtimeSource.includes("document.getElementById('hobunjiLoadScreen')"), `${runtimePath}: must attach to the canonical loading-screen root`);
assert(runtimeSource.includes('window.HobunjiSkyDome?.getDebugState?.()'), `${runtimePath}: must reuse live skydome state when available`);
assert(runtimeSource.includes('window.HobunjiSkyDome?.getLightingState?.()'), `${runtimePath}: must reuse live skydome lighting when available`);
assert(runtimeSource.includes("focusKind: night >= 0.5 ? 'moon' : 'sun'"), `${runtimePath}: automatic day/night celestial focus rule missing`);
assert(runtimeSource.includes('skyFocusOffsetX') && runtimeSource.includes('skyFocusOffsetY'), `${runtimePath}: tool-authored framing offsets missing`);
assert(runtimeSource.includes('skyZoom: 1.25'), `${runtimePath}: 1.25x fallback sky zoom missing`);
assert(runtimeSource.includes('VIEW_SPAN_U / zoom') && runtimeSource.includes('VIEW_SPAN_V / zoom'), `${runtimePath}: sky zoom must change the projected field of view`);
assert(runtimeSource.includes('root.insertBefore(canvas, root.firstChild)'), `${runtimePath}: sky canvas must remain behind existing loading-screen foreground content`);
const runtimeSunDraw = runtimeSource.indexOf("drawCelestial(state.context, dimensions.width, dimensions.height, center, sky, 'sun')");
const runtimeMoonDraw = runtimeSource.indexOf("drawCelestial(state.context, dimensions.width, dimensions.height, center, sky, 'moon')");
const runtimeCloudDraw = runtimeSource.indexOf('drawClouds(state.context, dimensions.width, dimensions.height, center, sky, now)');
assert(runtimeSunDraw >= 0 && runtimeMoonDraw > runtimeSunDraw && runtimeCloudDraw > runtimeMoonDraw, `${runtimePath}: clouds must composite after both sun and moon so they can occlude them`);

assert(skyDomeSource.includes('const CELESTIAL_RADIUS = 197'), `${skyDomePath}: expected celestial radius contract missing`);
assert(skyDomeSource.includes('const CLOUD_RADII = [176, 184, 192]'), `${skyDomePath}: expected nearer cloud-shell radii missing`);
assert(skyDomeSource.includes('sprite.renderOrder = -900') && skyDomeSource.includes('selfLight.renderOrder = -899') && skyDomeSource.includes('glow.renderOrder = -901'), `${skyDomePath}: celestial transparent render ordering changed`);
assert(skyDomeSource.includes('mesh.renderOrder = -800 + index'), `${skyDomePath}: cloud shells must render after celestial sprites`);

assert(editorSource.includes('id="skyBackdrop"'), `${editorPath}: integrated sky canvas missing`);
assert(editorSource.includes('id="skyFocusOffsetX"') && editorSource.includes('id="skyFocusOffsetY"'), `${editorPath}: integrated sky offset controls missing`);
assert(editorSource.includes('id="skyPreviewHour"'), `${editorPath}: day/night preview-hour control missing`);
assert(editorSource.includes('id="skyZoom"'), `${editorPath}: sky zoom control missing`);
assert(editorSource.includes('The sky is the actual preview backdrop behind the image, script, lore, and load percentage'), `${editorPath}: behind-content live sky workflow missing`);
assert(editorSource.includes('body.previewOnly #skyFocusGuide'), `${editorPath}: focus guide must disappear in full preview mode`);
assert(editorSource.includes('delete output.settings.skyPreviewHour'), `${editorPath}: editor-only preview hour must not leak into exported runtime config`);
assert(editorSource.includes('function syncPreviewViewport()'), `${editorPath}: device viewport synchronization missing`);
assert(editorSource.includes('previewW=Math.max(1,Math.round(innerWidth))') && editorSource.includes('previewH=Math.max(1,Math.round(innerHeight))'), `${editorPath}: preview must derive its dimensions from the current browser/device viewport`);
assert(editorSource.includes('availableW/previewW') && editorSource.includes('availableH/previewH'), `${editorPath}: device-aspect frame fitting logic missing`);
assert(!editorSource.includes('const PREVIEW_W=1920,PREVIEW_H=1080'), `${editorPath}: fixed 16:9 viewport must not return`);
assert(editorSource.includes('max-width:78%;max-height:70%'), `${editorPath}: image bounds must scale from the simulated runtime viewport`);
assert(editorSource.includes('width:min(42%,540px);height:min(72%,880px)'), `${editorPath}: script viewport must use runtime-equivalent device-relative bounds`);
assert(editorSource.includes('scriptSize:150') && editorSource.includes('scriptY:45'), `${editorPath}: defaults must use the uploaded script sizing/position`);
assert(editorSource.includes('columnSpacing:-.56') && editorSource.includes('scriptScrollSpeed:.042'), `${editorPath}: defaults must use the uploaded script composition`);
assert(editorSource.includes('skyFocusOffsetY:-.5') && editorSource.includes('skyZoom:1.25'), `${editorPath}: uploaded sky framing plus 1.25x zoom must be the default`);
const editorSunDraw = editorSource.indexOf('drawBody("sun",w,h,state)');
const editorMoonDraw = editorSource.indexOf('drawBody("moon",w,h,state)');
const editorCloudDraw = editorSource.indexOf('drawClouds(w,h,state)', editorMoonDraw);
assert(editorSunDraw >= 0 && editorMoonDraw > editorSunDraw && editorCloudDraw > editorMoonDraw, `${editorPath}: preview clouds must render over sun and moon`);
assert(!fs.existsSync(path.join(root, removedToolPath)), `${removedToolPath}: standalone tool should remain removed`);

console.log('loading-screen sky backdrop regression: PASS');

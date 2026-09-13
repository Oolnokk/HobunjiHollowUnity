'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const runtimePath = 'docs/js/loading-screen-sky-backdrop.js';
const loadingRuntimePath = 'docs/js/loading-screen-runtime.js';
const skyDomePath = 'docs/js/sky-dome.js';
const editorPath = 'docs/tools/loading-screen-editor/index.html';
const removedToolPath = 'docs/tools/loading-screen-editor/sky-focus.html';
const configPath = 'docs/config/loading-screens.json';
const bootstrapPath = 'docs/js/local-save-folder.js';

const runtimeSource = read(runtimePath);
const loadingRuntimeSource = read(loadingRuntimePath);
const skyDomeSource = read(skyDomePath);
const editorSource = read(editorPath);
const bootstrapSource = read(bootstrapPath);
const config = JSON.parse(read(configPath));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJavaScript(source, filename) {
  new vm.Script(source, { filename });
}

function extractInlineScripts(html) {
  const scripts = [];
  const pattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) scripts.push(match[1]);
  return scripts;
}

parseJavaScript(runtimeSource, runtimePath);
parseJavaScript(loadingRuntimeSource, loadingRuntimePath);
parseJavaScript(skyDomeSource, skyDomePath);
parseJavaScript(bootstrapSource, bootstrapPath);
const inlineScripts = extractInlineScripts(editorSource);
assert(inlineScripts.length > 0, `${editorPath}: expected an inline script`);
inlineScripts.forEach((source, index) => parseJavaScript(source, `${editorPath}#script-${index + 1}`));

assert(Number(config.version) >= 7, `${configPath}: expected version >= 7`);
assert(Number.isFinite(Number(config.settings?.skyFocusOffsetX)), `${configPath}: skyFocusOffsetX must be numeric`);
assert(Number.isFinite(Number(config.settings?.skyFocusOffsetY)), `${configPath}: skyFocusOffsetY must be numeric`);
assert(Number.isFinite(Number(config.settings?.skyZoom)), `${configPath}: skyZoom must be numeric`);
assert(Number(config.settings?.loreSize) === 19, `${configPath}: uploaded loreSize must remain 19`);
assert(Number(config.settings?.scriptSize) === 160, `${configPath}: latest uploaded scriptSize must remain 160`);
assert(Number(config.settings?.scriptY) === 45, `${configPath}: uploaded scriptY must remain 45`);
assert(Number(config.settings?.columnSpacing) === -0.56, `${configPath}: uploaded columnSpacing must remain -0.56`);
assert(Number(config.settings?.scriptScrollSpeed) === 0.03, `${configPath}: latest uploaded scriptScrollSpeed must remain 0.03`);
assert(Number(config.settings?.loadPercent) === 63, `${configPath}: uploaded preview progress must remain 63`);
assert(Number(config.settings?.skyFocusOffsetX) === 8, `${configPath}: latest uploaded skyFocusOffsetX must remain 8`);
assert(Number(config.settings?.skyFocusOffsetY) === 0, `${configPath}: latest uploaded skyFocusOffsetY must remain 0`);
assert(Number(config.settings?.skyZoom) === 3.25, `${configPath}: shipped sky zoom must remain 3.25x`);

// The compatibility loader may still prewarm the sky, but correctness must not depend on it.
assert(bootstrapSource.includes('loading-screen-sky-backdrop.js?v=20260913d'), `${bootstrapPath}: compatibility backdrop bootstrap reference missing`);
assert(runtimeSource.includes("document.getElementById('hobunjiLoadScreen')"), `${runtimePath}: must attach to the canonical loading-screen root`);
assert(runtimeSource.includes('window.HobunjiSkyDome?.getDebugState?.()'), `${runtimePath}: must reuse live skydome state when available`);
assert(runtimeSource.includes('window.HobunjiSkyDome?.getLightingState?.()'), `${runtimePath}: must reuse live skydome lighting when available`);
assert(runtimeSource.includes("focusKind: night >= 0.5 ? 'moon' : 'sun'"), `${runtimePath}: automatic day/night celestial focus rule missing`);
assert(runtimeSource.includes('skyFocusOffsetX') && runtimeSource.includes('skyFocusOffsetY'), `${runtimePath}: tool-authored framing offsets missing`);
assert(runtimeSource.includes('skyZoom: 3.25'), `${runtimePath}: 3.25x fallback sky zoom missing`);
assert(runtimeSource.includes('0.5, 4'), `${runtimePath}: runtime sky zoom ceiling must remain 4x`);
assert(runtimeSource.includes('VIEW_SPAN_U / zoom') && runtimeSource.includes('VIEW_SPAN_V / zoom'), `${runtimePath}: sky zoom must change the projected field of view`);
assert(runtimeSource.includes('root.insertBefore(canvas, root.firstChild)'), `${runtimePath}: sky canvas must remain behind existing loading-screen foreground content`);
const runtimeSunDraw = runtimeSource.indexOf("drawCelestial(state.context, dimensions.width, dimensions.height, center, sky, 'sun')");
const runtimeMoonDraw = runtimeSource.indexOf("drawCelestial(state.context, dimensions.width, dimensions.height, center, sky, 'moon')");
const runtimeCloudDraw = runtimeSource.indexOf('drawClouds(state.context, dimensions.width, dimensions.height, center, sky, now)');
assert(runtimeSunDraw >= 0 && runtimeMoonDraw > runtimeSunDraw && runtimeCloudDraw > runtimeMoonDraw, `${runtimePath}: clouds must composite after both sun and moon so they can occlude them`);

assert(loadingRuntimeSource.includes("const SKY_BACKDROP_URL = 'js/loading-screen-sky-backdrop.js?v=20260913e'"), `${loadingRuntimePath}: loading runtime must own a cache-busted sky backdrop URL`);
assert(loadingRuntimeSource.includes('function ensureSkyBackdropLoaded()'), `${loadingRuntimePath}: runtime-owned sky bootstrap missing`);
assert(loadingRuntimeSource.includes("script.dataset.hobunjiLoadingSkyRuntime = '1'"), `${loadingRuntimePath}: runtime sky script marker missing`);
assert(loadingRuntimeSource.includes('if (!installed) state.skyBackdropPromise = null'), `${loadingRuntimePath}: failed sky install must become retryable`);
assert(loadingRuntimeSource.includes('await Promise.all([ensureSkyBackdropLoaded(), ensureFontsLoaded(), ensureConfigLoaded(), ensureCompendiumLoaded()])'), `${loadingRuntimePath}: show() must wait for its own sky bootstrap alongside other loader resources`);
assert(loadingRuntimeSource.includes("skyBackdrop=${window.LoadingScreenSkyBackdrop?.installed ? 'installed'"), `${loadingRuntimePath}: loader diagnostics must expose sky bootstrap state`);
assert(loadingRuntimeSource.includes('#hobunjiLoadScreen{position:fixed;inset:0;z-index:9000;background:#000;display:none;overflow:hidden;pointer-events:none;isolation:isolate}'), `${loadingRuntimePath}: loading root must own an isolated stacking context`);
assert(loadingRuntimeSource.includes('#hlsSkyBackdrop{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}'), `${loadingRuntimePath}: runtime must stack the sky canvas above the root background itself`);
assert(loadingRuntimeSource.includes('z-index:1') && loadingRuntimeSource.includes('#hlsSkyDebug{z-index:2!important}'), `${loadingRuntimePath}: loader foreground/debug stacking contract missing`);
assert(loadingRuntimeSource.includes('#hlsScriptViewport{position:absolute;top:0;width:min(42vw,540px);height:100%;overflow:visible;transform:translateX(-50%)'), `${loadingRuntimePath}: Tankan script viewport must span the real screen and not add internal top/bottom masks`);
assert(loadingRuntimeSource.includes('const travel = viewportHeight + contentHeight'), `${loadingRuntimePath}: script scroll must travel across the full real viewport plus its own height`);
assert(loadingRuntimeSource.includes('const scriptY = viewportHeight - travelPhase * travel'), `${loadingRuntimePath}: script scroll must enter from below and exit above the real viewport`);
assert(!loadingRuntimeSource.includes('contentHeight - viewportHeight'), `${loadingRuntimePath}: legacy internal-window scroll range must not return`);
assert(!loadingRuntimeSource.includes("els.scriptViewport.style.top = `${settings.scriptY}%`"), `${loadingRuntimePath}: scriptY must no longer move a clipping viewport`);
assert(loadingRuntimeSource.includes("scriptSize: 160, scriptY: 45") && loadingRuntimeSource.includes('columnSpacing: -0.56, scriptScrollSpeed: 0.03'), `${loadingRuntimePath}: synchronous first paint must match current shipped script defaults`);

assert(skyDomeSource.includes('const CELESTIAL_RADIUS = 197'), `${skyDomePath}: expected celestial radius contract missing`);
assert(skyDomeSource.includes('const CLOUD_RADII = [176, 184, 192]'), `${skyDomePath}: expected nearer cloud-shell radii missing`);
assert(skyDomeSource.includes('sprite.renderOrder = -900') && skyDomeSource.includes('selfLight.renderOrder = -899') && skyDomeSource.includes('glow.renderOrder = -901'), `${skyDomePath}: celestial transparent render ordering changed`);
assert(skyDomeSource.includes('mesh.renderOrder = -800 + index'), `${skyDomePath}: cloud shells must render after celestial sprites`);

assert(editorSource.includes('id="skyBackdrop"'), `${editorPath}: integrated sky canvas missing`);
assert(editorSource.includes('id="skyFocusOffsetX"') && editorSource.includes('id="skyFocusOffsetY"'), `${editorPath}: integrated sky offset controls missing`);
assert(editorSource.includes('id="skyPreviewHour"'), `${editorPath}: day/night preview-hour control missing`);
assert(editorSource.includes('id="skyZoom"'), `${editorPath}: sky zoom control missing`);
assert(editorSource.includes('id="skyZoom" type="range" min="0.5" max="4"'), `${editorPath}: editor sky zoom slider must reach 4x`);
assert(editorSource.includes('The sky is the actual preview backdrop behind the image, script, lore, and load percentage'), `${editorPath}: behind-content live sky workflow missing`);
assert(editorSource.includes('body.previewOnly #skyFocusGuide'), `${editorPath}: focus guide must disappear in full preview mode`);
assert(editorSource.includes('delete output.settings.skyPreviewHour'), `${editorPath}: editor-only preview hour must not leak into exported runtime config`);
assert(editorSource.includes('function syncPreviewViewport()'), `${editorPath}: device viewport synchronization missing`);
assert(editorSource.includes('previewW=Math.max(1,Math.round(innerWidth))') && editorSource.includes('previewH=Math.max(1,Math.round(innerHeight))'), `${editorPath}: preview must derive its dimensions from the current browser/device viewport`);
assert(editorSource.includes('availableW/previewW') && editorSource.includes('availableH/previewH'), `${editorPath}: device-aspect frame fitting logic missing`);
assert(!editorSource.includes('const PREVIEW_W=1920,PREVIEW_H=1080'), `${editorPath}: fixed 16:9 viewport must not return`);
assert(editorSource.includes('max-width:78%;max-height:70%'), `${editorPath}: image bounds must scale from the simulated runtime viewport`);
assert(editorSource.includes('#scriptViewport{position:absolute;top:0;left:25%;width:min(42%,540px);height:100%;overflow:visible'), `${editorPath}: preview script must be clipped only by the stage/game viewport`);
assert(editorSource.includes('travel=viewportHeight+contentHeight') && editorSource.includes('scriptY=viewportHeight-travelPhase*travel'), `${editorPath}: preview script must enter/exit across actual viewport edges`);
assert(!editorSource.includes('contentHeight-viewportHeight'), `${editorPath}: legacy preview internal-window scroll range must not return`);
assert(!editorSource.includes('els.scriptViewport.style.top=`${data.settings.scriptY}%`'), `${editorPath}: scriptY must not move the preview clipping viewport`);
assert(editorSource.includes('scriptSize:160') && editorSource.includes('scriptY:45'), `${editorPath}: defaults must use the latest uploaded script sizing/position`);
assert(editorSource.includes('columnSpacing:-.56') && editorSource.includes('scriptScrollSpeed:.03'), `${editorPath}: defaults must use the latest uploaded script composition`);
assert(editorSource.includes('skyFocusOffsetX:8') && editorSource.includes('skyFocusOffsetY:0') && editorSource.includes('skyZoom:3.25'), `${editorPath}: latest uploaded sky framing plus 3.25x zoom must be the default`);
assert(editorSource.includes(',.5,4)'), `${editorPath}: editor normalization/preview zoom ceiling must remain 4x`);
const editorSunDraw = editorSource.indexOf('drawBody("sun",w,h,state)');
const editorMoonDraw = editorSource.indexOf('drawBody("moon",w,h,state)');
const editorCloudDraw = editorSource.indexOf('drawClouds(w,h,state)', editorMoonDraw);
assert(editorSunDraw >= 0 && editorMoonDraw > editorSunDraw && editorCloudDraw > editorMoonDraw, `${editorPath}: preview clouds must render over sun and moon`);
assert(!fs.existsSync(path.join(root, removedToolPath)), `${removedToolPath}: standalone tool should remain removed`);

console.log('loading-screen sky backdrop regression: PASS');

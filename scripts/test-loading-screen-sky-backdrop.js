'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..'); // Used by every fixture read so the test works from any invocation directory.
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8'); // Used to load the production files covered by this regression guard.

const runtimePath = 'docs/js/loading-screen-sky-backdrop.js'; // Used in parse failures and required-runtime assertions below.
const editorPath = 'docs/tools/loading-screen-editor/index.html'; // Used to validate the integrated loading-screen + sky-framing authoring surface.
const removedToolPath = 'docs/tools/loading-screen-editor/sky-focus.html'; // Used to guard against accidentally restoring the old standalone workflow.
const configPath = 'docs/config/loading-screens.json'; // Used to confirm exported/shipped framing settings remain compatible.
const bootstrapPath = 'docs/js/local-save-folder.js'; // Used to confirm initial boot still installs the backdrop before the loading-screen runtime.

const runtimeSource = read(runtimePath); // Used by syntax and integration assertions for the loading-screen sky runtime.
const editorSource = read(editorPath); // Used by syntax and authoring-workflow assertions for the integrated editor.
const bootstrapSource = read(bootstrapPath); // Used by the boot-loader reference assertion.
const config = JSON.parse(read(configPath)); // Used by version and persisted-offset assertions.

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
const inlineScripts = extractInlineScripts(editorSource); // Used to ensure the integrated editor contains syntax-valid executable script.
assert(inlineScripts.length > 0, `${editorPath}: expected an inline script`);
inlineScripts.forEach((source, index) => parseJavaScript(source, `${editorPath}#script-${index + 1}`));

assert(Number(config.version) >= 6, `${configPath}: expected version >= 6`);
assert(Number.isFinite(Number(config.settings?.skyFocusOffsetX)), `${configPath}: skyFocusOffsetX must be numeric`);
assert(Number.isFinite(Number(config.settings?.skyFocusOffsetY)), `${configPath}: skyFocusOffsetY must be numeric`);

assert(bootstrapSource.includes('loading-screen-sky-backdrop.js'), `${bootstrapPath}: backdrop bootstrap reference missing`);
assert(runtimeSource.includes("document.getElementById('hobunjiLoadScreen')"), `${runtimePath}: must attach to the canonical loading-screen root`);
assert(runtimeSource.includes('window.HobunjiSkyDome?.getDebugState?.()'), `${runtimePath}: must reuse live skydome state when available`);
assert(runtimeSource.includes('window.HobunjiSkyDome?.getLightingState?.()'), `${runtimePath}: must reuse live skydome lighting when available`);
assert(runtimeSource.includes("focusKind: night >= 0.5 ? 'moon' : 'sun'"), `${runtimePath}: automatic day/night celestial focus rule missing`);
assert(runtimeSource.includes('skyFocusOffsetX') && runtimeSource.includes('skyFocusOffsetY'), `${runtimePath}: tool-authored framing offsets missing`);
assert(runtimeSource.includes('root.insertBefore(canvas, root.firstChild)'), `${runtimePath}: sky canvas must remain behind existing loading-screen foreground content`);

assert(editorSource.includes('id="skyBackdrop"'), `${editorPath}: integrated sky canvas missing`);
assert(editorSource.includes('id="skyFocusOffsetX"') && editorSource.includes('id="skyFocusOffsetY"'), `${editorPath}: integrated sky offset controls missing`);
assert(editorSource.includes('id="skyPreviewHour"'), `${editorPath}: day/night preview-hour control missing`);
assert(editorSource.includes('The sky is the actual preview backdrop behind the image, script, lore, and load percentage'), `${editorPath}: behind-content live sky workflow missing`);
assert(editorSource.includes('body.previewOnly #skyFocusGuide'), `${editorPath}: focus guide must disappear in full preview mode`);
assert(editorSource.includes('delete output.settings.skyPreviewHour'), `${editorPath}: editor-only preview hour must not leak into exported runtime config`);
assert(!fs.existsSync(path.join(root, removedToolPath)), `${removedToolPath}: standalone tool should remain removed`);

console.log('loading-screen sky backdrop regression: PASS');

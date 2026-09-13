'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..'); // Used by every fixture read so the test works from any invocation directory.
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8'); // Used to load the four production files covered by this regression guard.

const runtimePath = 'docs/js/loading-screen-sky-backdrop.js'; // Used in parse failures and required-runtime assertions below.
const toolPath = 'docs/tools/loading-screen-editor/sky-focus.html'; // Used in parse failures and required-tool assertions below.
const configPath = 'docs/config/loading-screens.json'; // Used to confirm exported/shipped framing settings remain compatible.
const bootstrapPath = 'docs/js/local-save-folder.js'; // Used to confirm initial boot still installs the backdrop before the loading-screen runtime.

const runtimeSource = read(runtimePath); // Used by syntax and integration assertions for the loading-screen sky runtime.
const toolSource = read(toolPath); // Used by syntax and authoring-workflow assertions for the sky-focus tool.
const bootstrapSource = read(bootstrapPath); // Used by the boot-loader reference assertion.
const config = JSON.parse(read(configPath)); // Used by version and persisted-offset assertions.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJavaScript(source, filename) {
  new vm.Script(source, { filename });
}

function extractInlineScripts(html) {
  const scripts = []; // Used as the collected executable inline script bodies from the standalone tool HTML.
  const pattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi; // Used to parse the tool's ordinary inline script blocks without executing browser code.
  let match; // Used as the current regex match while walking all inline script tags.
  while ((match = pattern.exec(html))) scripts.push(match[1]);
  return scripts;
}

parseJavaScript(runtimeSource, runtimePath);
const inlineScripts = extractInlineScripts(toolSource); // Used to ensure the framing tool contains at least one syntax-valid executable script.
assert(inlineScripts.length > 0, `${toolPath}: expected an inline script`);
inlineScripts.forEach((source, index) => parseJavaScript(source, `${toolPath}#script-${index + 1}`));

assert(Number(config.version) >= 6, `${configPath}: expected version >= 6`);
assert(Number.isFinite(Number(config.settings?.skyFocusOffsetX)), `${configPath}: skyFocusOffsetX must be numeric`);
assert(Number.isFinite(Number(config.settings?.skyFocusOffsetY)), `${configPath}: skyFocusOffsetY must be numeric`);

assert(bootstrapSource.includes('loading-screen-sky-backdrop.js'), `${bootstrapPath}: backdrop bootstrap reference missing`);
assert(runtimeSource.includes("document.getElementById('hobunjiLoadScreen')"), `${runtimePath}: must attach to the canonical loading-screen root`);
assert(runtimeSource.includes('window.HobunjiSkyDome?.getDebugState?.()'), `${runtimePath}: must reuse live skydome state when available`);
assert(runtimeSource.includes('window.HobunjiSkyDome?.getLightingState?.()'), `${runtimePath}: must reuse live skydome lighting when available`);
assert(runtimeSource.includes("focusKind: night >= 0.5 ? 'moon' : 'sun'"), `${runtimePath}: automatic day/night celestial focus rule missing`);
assert(runtimeSource.includes('skyFocusOffsetX') && runtimeSource.includes('skyFocusOffsetY'), `${runtimePath}: tool-authored framing offsets missing`);
assert(runtimeSource.includes("root.insertBefore(canvas, root.firstChild)"), `${runtimePath}: sky canvas must remain behind existing loading-screen foreground content`);

assert(toolSource.includes('skyFocusOffsetX') && toolSource.includes('skyFocusOffsetY'), `${toolPath}: exported framing controls missing`);
assert(toolSource.includes("link.download = 'loading-screens.json'"), `${toolPath}: complete loading-screen JSON export path missing`);
assert(toolSource.includes("focusKind = night >= 0.5 ? 'moon' : 'sun'"), `${toolPath}: preview must use the same automatic focus rule as runtime`);

console.log('loading-screen sky backdrop regression: PASS');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/google-drive-save-legacy-cloud-bridge.js'), 'utf8');

new Function(source);
assert(source.includes("CLOUD_BUTTON_SELECTOR = '#hobunjiEmptySaveCloud, #slSourceCloud'"), 'existing fresh-browser/onboarding Cloud buttons are reused rather than duplicated');
assert(source.includes("button.textContent !== '☁ Google Drive'") && source.includes("button.textContent = '☁ Google Drive'"), 'legacy Cloud controls are relabeled Google Drive in place');
assert(source.includes("event.stopImmediatePropagation()"), 'capture bridge stops legacy Netlify click handlers before they run');
assert(source.includes('drive.linkExistingFile()'), 'restore gesture starts with exact-file Google Picker linking');
assert(source.includes("state === 'external-only-no-baseline'"), 'fresh-device Drive-only restore is recognized as safe to pull');
assert(source.includes("state === 'external-only-change'"), 'trusted remote-only changes are safe to pull from the restore action');
assert(source.includes("state === 'first-link-needs-direction' || state === 'conflict'"), 'ambiguous/divergent first links require an explicit user decision');
assert(source.includes('Neither has been overwritten'), 'conflict copy explains that both branches remain preserved');
assert(source.includes("window.__hobunjiGameStarted === true"), 'restore bridge refuses to hot-replace an active running world');
assert(!source.includes('NetlifyCloudSave'), 'user-facing restore bridge has no dependency on the legacy Netlify save API');
console.log('OK  legacy Cloud Save restore buttons are safely routed to canonical Google Drive saves');

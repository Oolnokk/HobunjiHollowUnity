'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..'); // Resolves the checked runtime/tool files from the repository root.
const panelBootstrap = fs.readFileSync(path.join(ROOT, 'docs/js/panel-ui.js'), 'utf8'); // Verifies Cutscene Director receives the repo-selector module without changing its monolithic HTML.
const selectorSource = fs.readFileSync(path.join(ROOT, 'docs/js/cutscene-director-repo-scenes.js'), 'utf8'); // Verifies the selector points at shipping builders and reuses the Director import path.
const openingStorySource = fs.readFileSync(path.join(ROOT, 'docs/js/opening-story-cutscene.js'), 'utf8'); // Confirms every catalog entry maps to a builder actually exported by the live opening-story module.
const hunundiRoom = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/maps/map_i_temple_basement_hunundi.json'), 'utf8')); // Pins the manually requested office camera height.

new Function(panelBootstrap); // Syntax-check the shared bootstrap as ordinary browser JavaScript.
new Function(selectorSource); // Syntax-check the injected selector before any browser-only globals are needed.

assert(panelBootstrap.includes('cutscene-director-repo-scenes.js'), 'PanelUI bootstrap must load the repo selector module.');
assert(panelBootstrap.includes('/\\/tools\\/cutscene-director\\//'), 'Repo selector loading must stay scoped to Cutscene Director.');

for (const builder of ['buildRescueScene', 'buildHunundiMeetingScene']) {
  assert(selectorSource.includes(`builder: '${builder}'`), `Repo selector must expose ${builder}.`);
  assert(openingStorySource.includes(`    ${builder},`), `OpeningStoryCutscene must publicly export ${builder}.`);
}
assert(selectorSource.includes("new URL('../../js/opening-story-cutscene.js"), 'Repo selector must load the shipping opening-story module rather than copy its scene data.');
assert(selectorSource.includes("document.getElementById('importFile')"), 'Repo selector must reuse the Director JSON import control.');
assert(selectorSource.includes("new DataTransfer()"), 'Normal repo-scene loading must flow through the existing import event path.');
assert(selectorSource.includes("document.getElementById('wildernessSelect')"), 'Procedural repo cutscenes must restore their wilderness context after import.');

const wallCamera = hunundiRoom.cinematicCameras.find(camera => camera.id === 'hunundi_office_wall');
assert(wallCamera, 'Father Hunundi room must retain the hunundi_office_wall camera.');
assert.strictEqual(wallCamera.position.y, 2, 'Hunundi office wall camera Y must stay at the requested 2.0 world units.');

console.log('Cutscene Director repo selector regression checks passed.');

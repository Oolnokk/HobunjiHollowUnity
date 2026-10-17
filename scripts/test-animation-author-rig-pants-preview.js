'use strict';
const assert = require('assert');
const fs = require('fs');
const author = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');
const dump = fs.readFileSync('docs/js/transform-dump-utils.js', 'utf8');
assert.match(author, /'config\/pants-rigs\.js'[\s\S]*'js\/pants-rig-core\.js'[\s\S]*'js\/pants-garment-renderer\.js'/,
  'Animation Author must load the same authored pants config/core/renderer used by gameplay');
assert.match(author, /function installRigPantsPreviewV1546\(actor\)/, 'Rig Coordinates must own an explicit pants preview installer');
assert.match(author, /Renderer\.garmentForCosmetics\?\.\(npc\?\.equippedCosmetics \|\| \[\]\)/,
  'Rig pants must follow the NPC database authored pants\/skirt instead of inventing clothing');
assert.match(author, /Renderer\.attachToLegs\(state\.three\.THREE, actor\.rigFeetPreview/,
  'Rig pants must bind to the exact gameplay ProceduralLegAnimation handle already shown in the character rig animator');
assert.match(author, /avatarGroup: actor\.model/, 'garment mapping must use the rendered portrait model as its coordinate space');
assert.match(author, /garment\.imageLayers = garment\.imageLayers\.map/,
  'multi-sprite draped pants and layered skirts must retain every authored image layer');
assert.match(author, /Renderer\.buildOverlayMask\(sourceFront, profile/,
  'pants must respect overwear\/arm\/pauldron\/hood occlusion in the rig preview');
assert.match(author, /installRigPantsPreviewV1546\(actor\);[\s\S]*actor\.rigFeetPreview\?\.update/,
  'pants must attach before the initial procedural-leg tick so the first visible rig frame is clothed');
assert.match(dump, /LEGACY_POSTERIOR_FLOORS/, 'Animation Author stale-profile repair must migrate the superseded posterior defaults');
console.log('Animation Author rig pants/posterior preview guards passed');

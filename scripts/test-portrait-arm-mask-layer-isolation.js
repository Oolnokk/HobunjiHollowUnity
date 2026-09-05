'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimePath = path.join(root, 'docs', 'js', 'portrait-arm-cloud-mask.js');
const editorPath = path.join(root, 'docs', 'tools', 'portrait-arm-mask', 'app.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const editor = fs.readFileSync(editorPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(runtime.includes("mode: 'per-arm-hard-cut-black-cap'"), 'arm cut must report hard-cut black-cap mode');
assert(runtime.includes('activeArmClipsByCanvas'), 'arm cut must scope temporary arm images to the portrait canvas');
assert(runtime.includes('buildClippedArmImage'), 'arm cut must preprocess only the authored arm image');
assert(runtime.includes('buildCutOutlineMask'), 'arm cut must cap the newly exposed edge');
assert(runtime.includes('valueNoise1D') && runtime.includes('valueNoise2D'), 'arm cut must retain deterministic verdigris-style noise');
assert(runtime.includes('profiles?.[profileKey]'), 'runtime must support species+gender profile overrides');
assert(runtime.includes('AUTHORED_PROFILES'), 'runtime must carry committed authored profile defaults');
assert(runtime.includes("'rakakoan:male'") && runtime.includes("'rakakoan:female'"), 'Rakakoan must retain copied Kenkari arm-mask defaults');
assert(runtime.includes("'ghoul:male'") && runtime.includes("'ghoul:female'"), 'both ghoul genders must retain copied Mao-ao arm-mask defaults');
assert(runtime.includes('660632132'), 'Mao-ao/ghoul authored edge seed must be retained');
assert(runtime.includes('cutThreshold') && runtime.includes('wobbleStrength') && runtime.includes('outlineWidth'), 'hard-cut controls must be runtime tunables');
assert(runtime.includes('armData.data[i + 3] = 0'), 'masked arm pixels must be erased instead of softly faded');
assert(runtime.includes('armData.data[i] = 0'), 'new arm cap pixels must be painted black');
assert(runtime.includes('state?.clips?.get'), 'draw helpers must substitute only known authored arm source keys');
assert(runtime.includes("const shouldClip = renderOptions?.onlyHeadSprite !== true;"), 'front and behind portrait planes must both receive the arm hard cut');
assert(!runtime.includes("renderOptions?.portraitView !== 'behind'"), 'behind portrait renders must not bypass the arm hard cut');
assert(!runtime.includes("renderOptions?.view !== 'behind'"), 'behind-view alias must not bypass the arm hard cut');
assert(!runtime.includes('material.alphaMap'), 'arm-only cut must not be applied to the flattened portrait material');
assert(!runtime.includes('buildSinglePlaneAvatarModel'), 'arm-only cut must not patch the finished PNG-plane avatar');
assert(!runtime.includes('hobunjiArmCloudAlphaMap'), 'legacy flattened arm alpha-map state must stay removed');

assert(editor.includes("schema: 'hobunji_portrait_arm_mask.v2'"), 'mask editor must export the species/gender profile schema');
assert(editor.includes('profiles[profileKey()]'), 'editor must store distinct settings per species+gender');
assert(editor.includes('seedAuthoredProfiles'), 'editor must seed the committed authored profiles');
assert(editor.includes('authoredSettingsFor'), 'editor reset must return to committed species/gender defaults');
assert(editor.includes('STORAGE_KEY'), 'editor must retain authored profile values across browser reloads');
assert(editor.includes('wobbleStrength') && editor.includes('outlineWidth'), 'editor must expose hard-edge authoring values');
assert(editor.includes('NpcAvatarPreview.renderProfileToCanvas'), 'mask editor must preview through the real portrait pipeline');
assert(!editor.includes('weightMap'), 'mask editor must not retain weight-paint data');
assert(!editor.includes('calculated-bicep'), 'mask editor must not retain bicep-rig bindings');
assert(!editor.includes('deformPreview'), 'mask editor must not retain deformation preview code');

console.log('portrait arm hard-cut/profile regression checks passed');

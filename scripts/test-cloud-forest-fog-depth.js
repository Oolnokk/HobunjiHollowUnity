#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for fail-fast source-contract assertions.
const fs = require('node:fs'); // Used to inspect the live fog, player-layering and depth-occluder sources.
const path = require('node:path'); // Used to resolve repository-relative paths portably.

const root = path.resolve(__dirname, '..'); // Repository root used for every source-file lookup below.
const housePieces = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8'); // Confirms the retired overlay stays out and the avatar depth helper loads.
const cloudFog = fs.readFileSync(path.join(root, 'docs/js/cloud-forest-fog.js'), 'utf8'); // Confirms native mist remains an ordinary depth-tested transparent draw.
const avatarDepth = fs.readFileSync(path.join(root, 'docs/js/cloud-forest-avatar-depth-occluder.js'), 'utf8'); // Guards the colorless player/pet depth copies that precede the mist.
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8'); // Confirms shoulder-pet layering really does disable visible player/pet depth writes at runtime.

assert.doesNotMatch(
  housePieces,
  /\['CloudForestMistSoftDepth', 'cloud-forest-mist-soft-depth\.js/,
  'Cloud Forest mist must not load the retired post-composite soft-depth renderer',
);
assert.match(
  housePieces,
  /\['CloudForestAvatarDepthOccluder', 'cloud-forest-avatar-depth-occluder\.js\?v=20260906a'\]/,
  'Cloud Forest runtime must load the attached-avatar depth occluder before rendering mist',
);
assert.match(
  housePieces,
  /\['OutlineRenderPerformance', 'outline-render-performance\.js\?v=20260905c'\]/,
  'fog repair must not remove the ordinary outline renderer',
);
assert.match(
  cloudFog,
  /transparent: true,[\s\S]{0,180}depthWrite: false,[\s\S]{0,80}depthTest: true/,
  'native Cloud Forest mist stays transparent and uses the ordinary scene depth buffer',
);
assert.match(
  cloudFog,
  /mesh\.renderOrder = 890 \+ index/,
  'native mist cylinders retain render orders 890-892',
);

assert.match(
  game,
  /_setLayerDepthWrite\(_playerAvatarFrontMaterial, !active\);[\s\S]{0,100}_setLayerDepthWrite\(_playerAvatarBackMaterial, !active\);/,
  'shoulder-pet mode intentionally disables the visible player portrait depth writes',
);
assert.match(
  game,
  /for \(const m of \[pet\.avatarRef\?\.frontPlane\?\.material, pet\.avatarRef\?\.backPlane\?\.material\]\) \{[\s\S]{0,100}_setLayerDepthWrite\(m, false\);/,
  'shoulder-pet mode intentionally disables the attached pet portrait depth writes too',
);

assert.match(avatarDepth, /const DEPTH_RENDER_ORDER = 889/,
  'attached-avatar depth helpers must render immediately before mist 890-892');
assert.match(avatarDepth, /material\.transparent = true/,
  'depth helpers stay in the transparent render queue so renderOrder 889 is authoritative');
assert.match(avatarDepth, /material\.colorWrite = false/,
  'depth helpers must not alter visible player/pet color ordering');
assert.match(avatarDepth, /material\.depthWrite = true/,
  'depth helpers write the missing cutout silhouette depth');
assert.match(avatarDepth, /material\.depthTest = true/,
  'depth helpers still respect nearer world geometry');
assert.match(avatarDepth, /originals\.some\(material => material\.depthWrite === false\)/,
  'extra depth draws run only while another layering mode intentionally disabled normal depth writes');
assert.match(avatarDepth, /window\.Combat\?\.deps\?\.companionObjects/,
  'depth helper resolves the same live companion collection already exposed to avatar runtime code');
assert.match(avatarDepth, /syncRecord\('shoulder_pet_front', pet\?\.avatarRef\?\.frontPlane \|\| null\);/,
  'active shoulder-pet front art participates in mist occlusion');
assert.match(avatarDepth, /syncRecord\('shoulder_pet_back', pet\?\.avatarRef\?\.backPlane \|\| null\);/,
  'active shoulder-pet back art participates in mist occlusion');
assert.match(avatarDepth, /activeScene !== lastMistSearchScene/,
  'mist-group discovery is scene-change-scoped rather than a permanent per-frame traversal');
assert.match(avatarDepth, /const result = priorUpdate\.call\(this, dt\);[\s\S]{0,140}sync\(\);/,
  'depth helpers synchronize from the existing CloudForestFog update immediately before scene rendering');
assert.doesNotMatch(avatarDepth, /requestAnimationFrame\s*\(/,
  'fog repair must not add an independent per-frame polling loop');
assert.match(avatarDepth, /DEPTH_OCCLUDER_MIN_ALPHA_TEST\s*=\s*0\.5/,
  'depth occluders must raise the portrait materials\' permissive 0.001 alphaTest, or faint edge/glow pixels cut a hole in the mist well past the visible silhouette');
assert.match(avatarDepth, /depth\.alphaTest = Math\.max\(Number\(original\.alphaTest\)[\s\S]{0,20}DEPTH_OCCLUDER_MIN_ALPHA_TEST\)/,
  'depth occluder alphaTest must be raised, never simply copied from the visible material');

console.log('Cloud Forest fog depth regression checks passed.');

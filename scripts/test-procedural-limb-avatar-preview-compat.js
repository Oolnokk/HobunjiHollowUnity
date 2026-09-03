const assert = require('assert');
const fs = require('fs');

const previewScene = fs.readFileSync('docs/js/avatar-preview-scene.js', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
const editor = fs.readFileSync('docs/tools/procedural-animation-editor/index.html', 'utf8');
const author = fs.readFileSync('docs/js/procedural-limb-pose-author.js', 'utf8');
const hands = fs.readFileSync('docs/js/procedural-hand-attachments.js', 'utf8');
const legs = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8');

// Main's reusable preview renderer is now the source of truth for preview-scene
// bootstrap and the configured Three.js module build.
assert(previewScene.includes('window.AvatarPreviewScene = { create }'), 'shared AvatarPreviewScene module must remain available');
assert(previewScene.includes('window.PNGPlaneAvatar.loadThreeModules()'), 'shared preview renderer must load Three through PNGPlaneAvatar');
assert(config.includes('https://esm.sh/three@0.128.0'), 'shared avatar preview config must remain pinned to the proven Three.js 0.128 build');

// The procedural editor is not migrated to AvatarPreviewScene yet, but main's
// renderer refactor deliberately brought its module/loader fallback onto the same
// configured 0.128 stack. Ground / Carry must therefore reuse that active stack,
// never bootstrap a second renderer or scene of its own.
assert(editor.includes("|| 'https://esm.sh/three@0.128.0'"), 'procedural editor loader fallbacks must match the shared 0.128 preview stack');
assert(author.includes('const modules = await window.PNGPlaneAvatar.loadThreeModules()'), 'Ground / Carry must obtain Three through the shared PNGPlaneAvatar module loader');
assert(author.includes('SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.threeModuleUrl'), 'Ground / Carry auxiliary GLTF loading must derive its Three version from shared avatar config');
assert(!author.includes('new runtime.THREE.WebGLRenderer'), 'Ground / Carry must not create a private WebGL renderer');
assert(!author.includes('new runtime.THREE.Scene'), 'Ground / Carry must not create a private Three.js scene');

// Ground / Carry remains an overlay on the procedural editor's public preview
// lifecycle. This keeps it compatible if avatar construction/rendering is
// refactored behind that public API again later.
assert(author.includes('runtime.backdrop = window.HobunjiGameplayBackdrop'), 'Ground / Carry must attach through the editor public backdrop API');
assert(author.includes('runtime.backdrop?.getAvatarModel?.()'), 'Ground / Carry must consume the currently-rendered avatar through the public backdrop API');
assert(author.includes("runtime.backdrop?.getPreviewMode?.() !== 'npc'"), 'Ground / Carry must refuse non-NPC preview models');

// Main updated the real hand/leg helper loaders at the same time as the renderer
// module. Keep those dependencies on the same Three build Ground / Carry uses.
assert(hands.includes("|| 'https://esm.sh/three@0.128.0'"), 'procedural hand loader fallback must match shared preview Three.js');
assert(legs.includes("|| 'https://esm.sh/three@0.128.0'"), 'procedural leg loader fallback must match shared preview Three.js');

console.log('procedural limb/shared avatar preview compatibility: PASS');

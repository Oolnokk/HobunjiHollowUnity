// Shared per-frame "where is this creature/character's head, in world
// space" cache. Several independent systems (livestock/companion
// look-at-player, farm-animal look-at-player, combat head-nod, dialogue
// facing) each used to recompute a near-identical formula for the same
// entity, sometimes more than once in the same frame (e.g. two different
// predators both aiming at the same fleeing prey). This module computes a
// given entity's head world position once per rendered frame and hands
// every asker the same cached result. RuntimeFrameScheduler's shared frame
// serial invalidates the cache, so this module owns no permanent RAF loop.
//
// Every getHeadWorld() result has the shape { x, z, worldY }: x/z are in
// the game's raw pixel/world units (the same convention game.js's own
// per-entity `x`/`y` fields use — NOT tile units, and NOT Three.js scene
// units), while worldY is a real Three.js scene-space height, ready to
// compare directly against a group's position.y. This mirrors game.js's
// pre-existing _playerFaceTarget/_creatureHeadWorldY conventions exactly,
// so callers migrating to this cache don't need to convert anything.
//
// Public API: window.CreatureHeadCache = {
//   getHeadWorld(entity, kind, ctx) -> {x, z, worldY} | null,
//   PLAYER_FACE_HEIGHT_RATIO,
// }
(() => {
  'use strict';

  const GREHLR_AUTHORED_HEAD_RIG = {"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.3615050095996143,"y":0.4662322932868983},"weightMap":{"width":128,"height":96,"encoding":"rle-u9","unsetValue":256,"data":[21,256,107,0,20,256,108,0,18,256,110,0,17,256,111,0,16,256,112,0,15,256,113,0,15,256,113,0,14,256,114,0,13,256,115,0,12,256,116,0,11,256,117,0,10,256,118,0,9,256,119,0,8,256,120,0,7,256,121,0,6,256,122,0,6,256,122,0,5,256,52,0,8,256,63,0,4,256,51,0,13,256,60,0,4,256,50,0,15,256,59,0,3,256,50,0,17,256,58,0,2,256,51,0,17,256,58,0,1,256,52,0,18,256,109,0,19,256,85,0,20,64,4,0,19,256,83,0,3,64,18,128,5,64,19,256,82,0,2,64,3,128,16,191,6,128,20,256,80,0,2,64,2,128,3,191,14,128,7,191,21,256,78,0,2,64,2,128,2,191,3,128,12,191,7,128,23,256,76,0,2,64,2,128,2,191,2,128,3,191,10,255,8,191,23,256,76,0,1,64,2,128,2,191,2,128,2,191,19,255,25,256,72,0,4,64,1,128,2,191,2,128,2,191,19,255,26,256,70,0,3,64,4,128,1,191,2,128,2,191,19,255,27,256,69,0,2,64,3,128,4,191,1,128,2,191,20,255,27,256,68,0,2,64,2,128,3,191,4,128,1,191,20,255,28,256,68,0,1,64,2,128,2,191,3,128,4,191,20,255,27,256,68,0,2,64,1,128,2,191,2,128,3,191,23,255,27,256,68,0,1,64,2,128,1,191,2,128,2,191,25,255,26,256,69,0,1,64,1,128,2,191,1,128,2,191,26,255,25,256,70,0,1,64,1,128,1,191,2,128,1,191,27,255,24,256,70,0,2,64,1,128,1,191,1,128,2,191,27,255,25,256,69,0,1,64,2,128,1,191,1,128,1,191,28,255,25,256,69,0,1,64,1,128,2,191,1,128,1,191,27,255,25,256,69,0,2,64,1,128,1,191,2,128,1,191,26,255,26,256,66,0,4,64,2,128,1,191,1,128,2,191,26,255,28,256,61,0,4,64,4,128,2,191,1,128,1,191,26,255,30,256,2,0,2,256,55,0,2,64,4,128,4,191,2,128,1,191,26,255,37,256,51,0,2,64,2,128,4,191,4,128,2,191,25,255,39,256,49,0,2,64,2,128,2,191,4,128,4,191,26,255,43,256,44,0,2,64,2,128,2,191,2,128,4,191,29,255,45,256,42,0,1,64,2,128,2,191,2,128,2,191,32,255,47,256,39,0,2,64,1,128,2,191,2,128,2,191,33,255,48,256,37,0,2,64,2,128,1,191,2,128,2,191,32,255,2,199,1,155,47,256,37,0,1,64,2,128,2,191,1,128,2,191,31,255,1,199,2,155,1,121,1,94,47,256,37,0,1,64,1,128,2,191,2,128,1,191,31,255,1,211,2,177,1,121,2,94,48,256,36,0,2,128,1,191,2,128,2,191,31,255,3,194,1,129,1,94,2,73,47,256,36,0,1,128,2,191,1,128,2,191,31,255,3,194,1,135,1,144,1,113,2,73,47,256,36,0,1,128,1,191,2,128,1,191,32,255,2,173,1,157,3,135,1,57,1,73,46,256,37,0,2,191,1,128,2,191,31,255,1,221,1,173,1,157,1,144,3,126,1,83,1,43,46,256,37,0,1,191,2,128,1,191,12,255,1,207,18,255,2,228,1,173,2,144,2,126,2,121,1,23,45,256,38,0,1,191,1,128,2,191,9,255,1,221,1,194,5,207,12,255,3,228,2,191,1,179,1,161,1,144,1,135,2,126,1,121,1,23,44,256,39,0,2,128,1,191,9,255,2,226,1,194,1,191,1,205,3,191,1,173,9,255,2,221,1,234,1,228,1,207,1,191,1,179,2,168,2,135,2,126,1,121,1,23,32,256,3,0,8,256,40,0,1,128,2,191,9,255,2,226,1,216,1,191,1,205,3,191,1,173,1,157,1,173,2,194,1,221,3,255,3,221,1,228,1,205,1,191,3,168,1,154,1,168,1,135,1,126,1,135,1,34,1,23,26,256,57,0,1,128,1,191,9,255,2,226,2,216,2,205,2,191,1,179,2,144,1,157,1,194,2,207,1,191,1,207,1,221,2,194,2,179,1,209,1,196,3,168,2,161,2,144,1,90,2,57,24,256,59,0,1,128,1,191,9,255,2,226,2,216,1,225,3,191,1,168,3,144,1,216,1,226,1,225,1,205,1,191,1,207,2,205,1,179,1,168,2,196,7,255,1,113,1,129,1,44,25,256,58,0,1,128,1,191,9,255,1,226,4,216,1,191,1,173,2,168,1,161,1,214,1,223,1,232,1,225,1,216,2,196,1,214,1,219,1,202,13,255,1,113,25,256,58,0,2,191,9,255,1,226,4,216,1,173,1,179,1,161,1,182,1,211,3,221,1,214,1,198,1,202,1,214,1,207,15,255,25,256,59,0,1,191,10,255,1,226,4,216,2,157,1,135,1,182,1,198,5,255,1,218,1,226,15,255,26,256,59,0,1,191,11,255,1,226,2,216,1,196,1,129,1,113,1,126,1,154,23,255,26,256,59,0,1,191,11,255,1,234,2,205,1,73,1,101,1,135,1,150,23,255,26,256,60,0,1,191,12,255,1,228,1,73,2,90,1,135,22,255,27,256,61,0,1,191,11,255,1,177,1,155,1,94,2,101,1,182,21,255,26,256,1,27,62,0,1,191,10,255,1,199,2,121,1,94,23,255,27,256,2,48,61,0,1,191,9,255,1,199,1,121,1,94,1,256,23,255,27,256,2,102,2,48,60,0,1,191,9,255,1,155,1,73,2,256,23,255,25,256,1,57,1,34,1,57,1,48,1,62,1,29,1,12,59,0,1,191,8,255,1,199,1,94,2,256,24,255,22,256,1,27,1,21,1,34,1,27,2,34,1,57,1,48,1,23,1,12,1,16,58,0,1,191,8,255,1,155,3,256,24,255,21,256,1,57,2,21,1,12,3,21,1,34,1,48,1,37,1,12,1,16,58,0,1,191,7,255,1,199,1,121,3,256,23,255,21,256,1,57,1,34,1,12,1,9,1,16,1,12,2,16,1,21,1,34,1,37,1,35,1,45,58,0,1,191,7,255,1,199,1,94,3,256,23,255,20,256,1,44,1,34,1,27,1,16,2,7,1,9,3,16,1,21,1,29,1,46,1,16,58,0,1,191,7,255,1,199,1,94,8,256,17,255,21,256,2,34,1,16,1,21,1,16,2,7,2,12,1,21,2,27,1,59,1,58,58,0,2,191,4,255,50,256,1,34,3,16,1,21,2,12,1,16,1,21,1,27,7,256,55,0,1,128,1,191,3,255,50,256,1,27,20,256,52,0,1,128,1,191,1,255,74,256,51,0,1,128,1,191,76,256,50,0,1,128,78,256,49,0,1,191,79,256,48,0,81,256,47,0,81,256,47,0,82,256,46,0,82,256,46,0,82,256,46,0,82,256,46,0,83,256,45,0,83,256,45,0,83,256,45,0,82,256,46,0]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48,"compressibilityMap":{"width":128,"height":96,"encoding":"rle-u9","unsetValue":256,"data":[5153,256,2,245,121,256,12,245,114,256,16,245,111,256,19,245,108,256,21,245,105,256,22,245,106,256,22,245,105,256,22,245,105,256,23,245,105,256,23,245,104,256,24,245,104,256,24,245,104,256,22,245,2,191,1,149,102,256,21,245,1,191,2,149,1,116,1,90,102,256,20,245,1,203,2,170,1,116,1,90,1,83,102,256,20,245,3,186,1,124,1,83,1,64,1,59,101,256,19,245,3,186,1,130,1,138,1,100,1,61,1,59,101,256,19,245,2,166,1,151,1,130,1,120,1,115,1,47,1,57,101,256,18,245,1,212,1,166,1,151,1,138,1,113,2,107,1,62,1,32,101,256,17,245,2,219,1,166,2,138,1,111,1,105,1,91,1,87,1,15,102,256,1,199,12,245,3,219,2,183,1,172,1,155,1,138,1,123,1,103,1,92,1,87,1,15,102,256,1,183,1,166,9,245,2,212,1,225,1,219,1,199,1,183,1,172,2,161,1,123,1,121,1,103,1,94,1,87,1,15,32,256,3,0,67,256,1,183,1,166,1,151,1,166,2,186,1,212,3,245,3,212,1,219,1,197,1,183,3,161,1,148,1,156,1,122,1,99,1,101,1,24,1,13,26,256,18,0,59,256,2,138,1,151,1,186,2,199,1,183,1,199,1,212,2,186,2,172,1,201,1,188,3,161,1,155,1,149,1,128,1,114,1,63,1,40,1,36,24,256,22,0,57,256,3,138,1,207,1,217,1,216,1,197,1,183,1,199,2,197,1,172,1,161,2,188,3,245,1,243,1,232,1,220,1,196,1,77,1,85,1,27,25,256,22,0,56,256,1,52,1,205,1,214,1,223,1,216,1,207,2,188,1,205,1,210,1,194,7,245,1,243,1,229,1,208,1,192,1,168,1,162,1,63,25,256,23,0,53,256,1,92,1,19,2,256,2,212,1,205,1,190,1,194,1,144,1,199,2,245,2,243,4,238,1,243,1,232,1,221,1,204,1,189,1,162,1,152,25,256,25,0,52,256,1,14,4,256,3,245,1,209,1,48,1,227,2,230,1,233,5,234,1,233,1,217,1,198,1,188,1,173,1,162,26,256,26,0,50,256,1,7,6,256,1,245,1,217,1,1,1,12,1,59,1,174,1,219,1,224,1,226,1,227,1,233,1,234,1,230,1,216,1,205,1,186,1,180,1,159,1,132,26,256,27,0,48,256,1,58,6,256,1,235,4,1,1,21,1,207,1,213,1,215,1,220,1,223,2,222,1,221,1,212,1,195,1,177,1,155,1,151,26,256,28,0,52,256,1,245,1,226,1,217,6,1,1,22,1,201,1,213,1,215,2,219,1,217,1,203,1,195,1,189,1,170,27,256,30,0,37,256,1,145,2,83,2,145,7,256,1,245,1,235,1,226,1,217,1,200,7,1,1,170,1,189,1,199,1,205,1,209,1,203,1,195,1,177,1,164,26,256,1,12,31,0,35,256,1,145,6,83,1,64,4,256,2,245,2,226,1,217,1,200,8,1,1,177,1,0,3,29,1,186,1,174,1,171,27,256,2,12,31,0,33,256,1,145,4,83,1,81,1,83,1,64,1,39,1,31,2,256,1,245,1,45,1,235,1,226,2,208,6,1,2,0,1,1,1,170,3,0,3,10,27,256,1,19,1,18,2,12,30,0,33,256,7,83,1,50,1,24,2,0,2,245,1,139,1,39,1,2,6,1,12,0,25,256,7,12,29,0,32,256,1,145,6,83,1,64,1,31,2,0,1,80,2,245,1,123,1,71,1,12,2,1,16,0,22,256,11,12,28,0,32,256,3,83,1,82,3,83,1,50,3,0,1,80,1,245,2,217,1,123,1,12,1,2,1,1,16,0,21,256,12,12,28,0,32,256,4,83,1,82,1,83,1,64,1,39,3,0,1,80,1,235,2,217,1,208,1,12,1,5,1,1,15,0,21,256,1,13,2,12,1,9,9,12,28,0,32,256,6,83,1,0,1,31,3,0,1,80,1,226,2,217,1,118,1,37,1,5,1,3,15,0,20,256,4,12,2,7,1,9,7,12,28,0,33,256,5,83,1,0,1,31,1,256,7,0,1,21,1,9,1,3,15,0,20,256,5,12,2,7,7,12,28,0,33,256,3,83,4,256,26,0,20,256,10,12,32,0,34,256,1,83,5,256,27,0,18,256,1,12,42,0,40,256,27,0,18,256,43,0,40,256,28,0,17,256,42,0,41,256,29,0,16,256,42,0,41,256,32,0,12,256,43,0,41,256,34,0,10,256,43,0,41,256,35,0,8,256,44,0,41,256,37,0,3,256,48,0,40,256,88,0,40,256,88,0,41,256,87,0,41,256,87,0,42,256,86,0,42,256,86,0,43,256,85,0,30,256]},"stretchabilityMap":{"width":128,"height":96,"encoding":"rle-u9","unsetValue":256,"data":[7047,256,2,228,123,256,1,158,1,171,2,228,1,234,2,239,1,234,118,256,2,106,1,165,1,221,2,228,3,239,2,221,1,211,115,256,1,158,1,111,2,171,1,228,1,221,1,239,1,234,1,228,5,221,10,256,2,199,101,256,1,165,1,111,1,115,1,171,3,228,1,234,5,228,1,248,1,243,1,239,6,256,1,232,1,225,1,191,1,173,3,121,1,155,98,256,1,165,1,111,2,171,2,228,1,234,1,228,1,234,2,239,1,248,1,252,1,219,1,192,2,205,3,256,1,253,1,246,1,233,2,219,1,157,1,129,3,94,1,121,1,155,96,256,2,111,1,171,5,228,1,239,1,243,1,246,1,251,2,224,1,192,1,189,1,203,2,256,1,189,1,171,1,253,1,250,1,238,1,219,1,157,1,129,3,94,2,82,1,112,95,256,1,115,1,171,1,175,2,234,2,228,1,221,1,243,1,248,1,251,1,253,2,224,1,214,1,189,1,203,1,256,2,189,1,171,1,155,1,171,1,187,1,167,1,117,1,101,2,57,1,64,2,82,1,84,1,98,94,256,1,115,1,171,3,234,1,228,1,221,1,211,1,239,1,250,1,252,2,224,2,214,2,203,2,189,1,177,2,142,1,155,1,189,1,169,1,103,1,69,1,46,1,50,2,44,1,51,1,66,1,77,1,119,93,256,1,111,1,171,1,228,2,234,1,228,1,221,1,211,1,243,2,250,2,224,2,214,1,223,3,189,1,166,2,142,1,139,1,204,1,182,1,74,1,28,1,27,2,36,1,46,1,40,1,37,2,73,2,256,5,155,1,69,1,101,84,256,1,111,1,165,2,221,2,228,1,211,1,199,1,234,1,246,1,250,1,223,4,214,1,189,1,171,2,166,1,159,1,212,1,207,1,211,1,153,1,29,2,27,1,29,1,30,1,36,1,44,2,57,1,94,1,121,4,155,4,121,1,54,83,256,2,165,2,221,2,211,2,199,1,211,1,243,1,250,1,222,1,213,3,214,1,171,1,177,1,159,1,180,1,208,1,203,1,191,1,171,1,84,2,0,1,29,1,28,3,34,2,44,2,57,2,155,4,121,2,73,84,256,1,165,4,221,1,211,2,199,1,211,1,221,1,243,1,217,1,211,1,209,1,213,1,205,1,153,1,155,1,133,1,175,1,186,1,221,1,198,1,100,5,0,6,34,1,57,4,121,1,94,2,73,26,256,4,0,55,256,1,165,4,221,3,199,2,211,1,228,1,234,1,208,1,198,1,154,1,103,1,0,1,25,1,50,1,60,1,100,10,0,1,34,1,21,1,27,1,34,1,44,3,121,4,73,26,256,7,0,52,256,1,165,2,228,2,221,4,199,3,211,1,194,1,45,18,0,2,21,2,27,2,121,4,73,26,256,10,0,50,256,1,165,4,221,1,211,5,199,1,211,21,0,2,21,1,27,1,121,1,94,2,73,27,256,12,0,49,256,1,165,4,221,1,211,5,199,24,0,1,34,1,121,2,73,26,256,1,2,14,0,49,256,3,221,2,211,5,199,27,0,27,256,2,2,14,0,49,256,1,221,3,211,4,199,27,0,27,256,2,3,2,2,13,0,51,256,2,211,4,199,27,0,25,256,7,2,12,0,56,256,28,0,22,256,3,0,8,2,12,0,55,256,28,0,21,256,5,0,7,2,12,0,55,256,27,0,21,256,6,0,7,2,12,0,55,256,27,0,20,256,8,0,6,2,12,0,55,256,27,0,20,256,8,0,6,2,12,0,55,256,27,0,20,256,9,0,1,2,15,0,56,256,28,0,18,256,26,0,57,256,27,0,18,256,25,0,58,256,28,0,17,256,25,0,58,256,29,0,16,256,24,0,60,256,31,0,12,256,23,0,62,256,33,0,10,256,22,0,64,256,33,0,8,256,12,0,76,256,34,0,3,256,15,0,77,256,50,0,80,256,48,0,82,256,45,0,84,256,44,0,85,256,42,0,88,256,39,0,92,256,34,0,69,256]}}; // User-authored Grehlr rig; material maps are intentionally swapped to preserve its visual result after the corrected side semantics.

  // The rig renderer loads immediately before this module. Keep the latest
  // painter-authored Grehlr rig in the shared committed rig object before
  // game.js/farm-animals build any animal avatars. Mutating that nested rig
  // in place preserves references while the outer ANIMAL_HEAD_RIGS map stays
  // intentionally frozen by creature-genetics-render.js.
  function _syncGrehlrHeadRigProfile() {
    const rig = window.CreatureGeneticsRender?.ANIMAL_HEAD_RIGS?.grehlr; // Existing mutable nested Grehlr rig shared by all species-rig consumers.
    if (!rig) {
      window.__farmLog?.('[head-rig] Grehlr committed rig unavailable; authored profile was not applied.', 'warn');
      return;
    }
    const authored = JSON.parse(JSON.stringify(GREHLR_AUTHORED_HEAD_RIG)); // Clone prevents later runtime edits from mutating the authored constant.
    Object.keys(rig).forEach(key => delete rig[key]);
    Object.assign(rig, authored);
    window.__farmLog?.(`[head-rig] Grehlr authored rig active x=${rig.pivot.x.toFixed(6)} y=${rig.pivot.y.toFixed(6)} + asymmetric material maps`, 'wildlife');
  }
  _syncGrehlrHeadRigProfile();

  // Keep the asymmetric material-response implementation out of this cache,
  // but bridge avatar construction here because this file deliberately loads
  // immediately after creature-genetics-render.js (which injects the raw
  // species headRig) and before gameplay starts building creatures.
  function _installAnimalHeadMaterialResponseBridge() {
    const api = window.PNGPlaneAvatar; // Existing animal-plane builder already wrapped by the base head rig and species-rig bridge.
    if (!api?.buildAnimalPlaneAvatarModel || api.__animalHeadMaterialResponseBridgeInstalled) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api); // Preserves every earlier renderer/head-rig wrapper in the current load order.
    api.buildAnimalPlaneAvatarModel = function materialResponsiveAnimalBuild(THREE, spriteUrl, options = {}) {
      const avatarRef = priorBuild(THREE, spriteUrl, options);
      const rawRig = options?.headRig || window.HobunjiAnimalHeadRigSpecies?.resolveForOptions?.(options) || null; // Raw rig retains response maps that the legacy normalizer intentionally ignores.
      if (!rawRig?.compressibilityMap && !rawRig?.stretchabilityMap) return avatarRef;
      if (window.AnimalHeadMaterialResponse?.decorateAvatar) {
        window.AnimalHeadMaterialResponse.decorateAvatar(avatarRef, rawRig);
      } else {
        const pending = window.__hobunjiPendingAnimalHeadMaterialResponses || (window.__hobunjiPendingAnimalHeadMaterialResponses = []); // Used until the decoupled response module finishes loading.
        pending.push({ avatarRef, rawRig });
      }
      return avatarRef;
    };
    api.__animalHeadMaterialResponseBridgeInstalled = true;
    return true;
  }

  function _loadAnimalHeadMaterialResponseModule() {
    if (window.AnimalHeadMaterialResponse || typeof document === 'undefined') return;
    if (document.querySelector('script[data-animal-head-material-response]')) return;
    const script = document.createElement('script'); // Loads the decoupled material-response math/runtime without adding it to game.js.
    const source = document.currentScript?.src || (typeof location !== 'undefined' ? location.href : ''); // Resolves next to this module both on GitHub Pages and commit-pinned GitHack builds.
    script.src = new URL('animal-head-material-response.js', source).href;
    script.async = false;
    script.dataset.animalHeadMaterialResponse = '1';
    script.addEventListener('error', () => window.__farmLog?.('[head-rig] Could not load animal-head-material-response.js', 'warn'));
    document.head.appendChild(script);
  }

  _installAnimalHeadMaterialResponseBridge();
  _loadAnimalHeadMaterialResponseModule();

  // Matches game.js's own PLAYER_FACE_HEIGHT_RATIO (0.76) — kept here too
  // since this module has no access to that closure-local constant, and a
  // player/companion-portrait head estimate needs the same ratio game.js's
  // pre-existing _playerFaceTarget already used.
  const PLAYER_FACE_HEIGHT_RATIO = 0.76;

  // Frame identity comes from the shared RuntimeFrameScheduler. This keeps
  // the cache caller-agnostic without creating another permanent browser RAF.
  // In standalone/test contexts where the scheduler is absent, frame 0 is a
  // stable graceful fallback.
  function _currentFrameToken() {
    return window.RuntimeFrameScheduler?.frameId?.() ?? 0;
  }

  const _cache = new WeakMap(); // entity -> { frame, pos }

  // Wild/hostile CREATURE_DB creatures, farm livestock (farm-animals.js),
  // and shoulder pets/companions all share this same avatarRef/headRig
  // shape (see png-plane-avatar.js's buildAnimalPlaneAvatarModel +
  // applyAnimalHeadRig) — one formula covers every one of them. Mirrors
  // game.js's former _creatureHeadWorldY and farm-animals.js's former
  // _farmAnimalHeadWorldY, which were near-identical hand copies of this
  // same math.
  function _computeAnimalHeadWorld(c) {
    const group = c?.avatarRef?.group;
    if (!group) return { x: Number(c?.x) || 0, z: Number(c?.y) || 0, worldY: 0 };
    const rig = c.avatarRef?.headRig?.rig;
    const modelHeight = (Number(c.def?.modelWidth) * Number(c.def?.spriteAspect || (600 / 1375)))
      || Number(c.modelHeight)
      || Number(c.halfHeight || 0.45) * 2;
    const scaleY = Number(group.scale?.y) || 1;
    const pivotY = Number(rig?.pivot?.y);
    const pivotOffset = Number.isFinite(pivotY) ? (0.5 - pivotY) * modelHeight : modelHeight * 0.08;
    const planeOffset = Number(c.avatarRef?.frontPlane?.position?.y) || 0;
    const worldY = (Number(group.position?.y) || Number(c.wy) || 0) + (planeOffset + pivotOffset) * scaleY;
    return { x: Number(c.x) || 0, z: Number(c.y) || 0, worldY };
  }

  // ctx: { x, y, mesh, avatarModelHeight } — game.js supplies the player's
  // own globals here since they're closure-local, not properties on the
  // shared `player` object this cache keys by.
  function _computePlayerHeadWorld(ctx) {
    const modelHeight = Number(ctx?.avatarModelHeight) || 0.9;
    const floorY = Number(ctx?.mesh?.position?.y) || 0;
    return { x: Number(ctx?.x) || 0, z: Number(ctx?.y) || 0, worldY: floorY + modelHeight * PLAYER_FACE_HEIGHT_RATIO };
  }

  // A companion acting as a look-at "master" (see game.js's
  // _playerFaceTarget(master) — historically also accepted a non-player
  // companion) reads its portrait model height off the avatar group's own
  // userData instead of a def/headRig, since it's a portrait-plane avatar
  // rather than an animal-plane one.
  function _computeCompanionPortraitHeadWorld(master) {
    const modelHeight = Number(master?.avatarRef?.group?.userData?.portraitModelHeight) || Number(master?.halfHeight || 0.45) * 2;
    const floorY = (Number(master?.avatarRef?.group?.position?.y) || 0) - (Number(master?.halfHeight) || modelHeight / 2);
    return { x: Number(master?.x) || 0, z: Number(master?.y) || 0, worldY: floorY + modelHeight * PLAYER_FACE_HEIGHT_RATIO };
  }

  function getHeadWorld(entity, kind, ctx) {
    if (!entity) return null;
    const frameToken = _currentFrameToken();
    const cached = _cache.get(entity);
    if (cached && cached.frame === frameToken) return cached.pos;
    let pos;
    if (kind === 'player') pos = _computePlayerHeadWorld(ctx);
    else if (kind === 'companion-portrait') pos = _computeCompanionPortraitHeadWorld(entity);
    else pos = _computeAnimalHeadWorld(entity);
    _cache.set(entity, { frame: frameToken, pos });
    return pos;
  }

  // Is `point` (a real Three.js scene-space {x,y,z} — NOT this module's own
  // raw-px getHeadWorld() convention; convert x/z by dividing by TILE
  // first) close to the given camera/aim ray? Used for "is the player
  // focusing on this creature's head" checks (see game.js's
  // currentPlayerInteractionRay/currentPlayerAimRay and their deps.get*
  // exposures) — finds the closest point on the ray ahead of its origin
  // and tests it against radiusWorld, so a creature only "notices" being
  // looked at when the aim is actually close to its head, not merely
  // somewhere in its general direction.
  function isRayNearPoint(ray, point, radiusWorld) {
    if (!ray?.origin || !ray?.direction || !point) return false;
    const ox = Number(ray.origin.x) || 0, oy = Number(ray.origin.y) || 0, oz = Number(ray.origin.z) || 0;
    let dx = Number(ray.direction.x) || 0, dy = Number(ray.direction.y) || 0, dz = Number(ray.direction.z) || 0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    dx /= len; dy /= len; dz /= len;
    const px = (Number(point.x) || 0) - ox, py = (Number(point.y) || 0) - oy, pz = (Number(point.z) || 0) - oz;
    const t = px * dx + py * dy + pz * dz;
    if (t < 0) return false; // Head is behind the ray's origin (behind the camera) — not being looked at.
    const cx = ox + dx * t, cy = oy + dy * t, cz = oz + dz * t;
    const ddx = (Number(point.x) || 0) - cx, ddy = (Number(point.y) || 0) - cy, ddz = (Number(point.z) || 0) - cz;
    const radius = Number(radiusWorld) || 0.35;
    return (ddx * ddx + ddy * ddy + ddz * ddz) <= radius * radius;
  }

  window.CreatureHeadCache = { getHeadWorld, isRayNearPoint, PLAYER_FACE_HEIGHT_RATIO };
})();

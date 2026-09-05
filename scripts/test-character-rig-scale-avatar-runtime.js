const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/character-rig-scale-avatar-runtime.js', 'utf8');
const calls = []; // Captures the runtime bridge invocation so the test can verify identity, authored tuple, and age forwarding.
const avatarRoot = { userData: {} }; // Mimics the shared PNG avatar object returned by buildSinglePlaneAvatarModel.
const baseBuild = function baseBuild() { return avatarRoot; }; // Represents the real PNGPlaneAvatar constructor before the runtime bridge wraps it.
const resolved = { x: 1.125, y: 1.125, head: 1.02, offsetY: 0 }; // Matches one non-trivial authored tuple so head compensation cannot accidentally degrade to uniform body scale.

const window = {
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  HobunjiCharacterRigScale: {
    scaleFor(species, gender) {
      assert.strictEqual(species, 'mao-ao');
      assert.strictEqual(gender, 'male');
      return resolved;
    },
    applyHeadCompensation(root, species, gender, tuple, age) {
      calls.push({ root, species, gender, tuple, age });
      return true;
    },
  },
  PNGPlaneAvatar: { buildSinglePlaneAvatarModel: baseBuild },
};

let intervalCallback = null; // Lets the test prove the immediate install succeeds without relying on asynchronous timing.
const context = vm.createContext({
  window,
  setInterval(callback) { intervalCallback = callback; return 1; },
  clearInterval() {},
  console,
});
vm.runInContext(source, context, { filename: 'character-rig-scale-avatar-runtime.js' });

assert.notStrictEqual(window.PNGPlaneAvatar.buildSinglePlaneAvatarModel, baseBuild, 'runtime bridge must wrap the shared PNG avatar constructor');
assert.strictEqual(window.PNGPlaneAvatar.buildSinglePlaneAvatarModel.__hobunjiCharacterRigScaleAvatarHeadWrapped, true, 'runtime wrapper must expose its install sentinel');
assert.strictEqual(window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.characterRigHeadRuntimeHook, 'PNGPlaneAvatar.buildSinglePlaneAvatarModel', 'mobile diagnostics must report the head runtime hook');

const result = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(null, null, {
  profile: { appearance: { speciesId: 'mao-ao', gender: 'male' } },
  npcRecord: { age: 0.25 },
  neckRig: true,
});
assert.strictEqual(result, avatarRoot, 'wrapper must preserve the original constructor return value');
assert.strictEqual(calls.length, 1, 'head compensation must run during avatar construction, independent of later hand attachment');
assert.strictEqual(calls[0].root, avatarRoot);
assert.strictEqual(calls[0].species, 'mao-ao');
assert.strictEqual(calls[0].gender, 'male');
assert.strictEqual(calls[0].tuple, resolved);
assert.strictEqual(calls[0].age, 0.25);
assert.deepStrictEqual(avatarRoot.userData.hobunjiCharacterRigHeadRuntime, {
  applied: true,
  species: 'mao-ao',
  gender: 'male',
  headScale: 1.02,
  headOffsetY: 0,
  bodyScaleX: 1.125,
  bodyScaleY: 1.125,
  source: 'PNGPlaneAvatar.buildSinglePlaneAvatarModel',
});

// Re-running the retry callback after a successful immediate install must not
// stack another wrapper or double-apply on each future avatar construction.
const installed = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel;
intervalCallback?.();
assert.strictEqual(window.PNGPlaneAvatar.buildSinglePlaneAvatarModel, installed, 'late-load retry must be idempotent');

console.log('character rig scale avatar runtime tests passed');

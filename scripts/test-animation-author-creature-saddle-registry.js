const assert = require('assert'); // Used for the focused rig/bootstrap regression checks below.
const fs = require('fs'); // Reads the production scripts under test without requiring a browser.
const path = require('path'); // Resolves repository-relative fixture paths consistently from this script.
const vm = require('vm'); // Executes the authored saddle module against a small mutable runtime-profile stub.

const root = path.resolve(__dirname, '..'); // Repository root used by the read helper below.
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8'); // Loads one production source file for execution/static-order assertions.
const saddleSource = read('docs/js/creature-saddle-authored-20261016.js'); // Production override containing the uploaded October 16 saddle coordinates.
const bootstrapSource = read('docs/js/attachment-rig-latest-authored-snapshot.js'); // Production bootstrap whose load order must make the coordinates and Voorg-Ass registration available in time.
const bridgeSource = read('docs/js/animal-chathead-frame.js'); // Existing Animation Author registry bridge that consumes the preloaded Voorg-Ass registration.
const voorgRegistrationSource = read('docs/js/voorg-ass-registration.js'); // Existing single source of truth the bootstrap must preload instead of duplicating.

const originalPuktukSaddle = { x: 7, y: 8, z: 9 }; // Sentinel proving the narrow October pass does not rewrite unchanged Puktuk saddle data.
const originalVoorgSaddle = { x: -7, y: -8, z: -9 }; // Sentinel proving the narrow October pass does not rewrite unchanged Voorg-Ass saddle data.
const creatureProfile = position => ({ anchors: { saddle: { position: { ...position }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }, saddleRule: { source: 'older-authoring-pass' } }); // Builds mutable runtime-profile fixtures matching the production shape.
const library = { // Supplies every changed species plus unchanged Puktuk/Voorg-Ass sentinels to the authored saddle module.
  creatures: {
    drenkirra: creatureProfile({ x: 0, y: 1, z: 0 }),
    grehlr: creatureProfile({ x: 0, y: 1, z: 0 }),
    'gar-wolf': creatureProfile({ x: 0, y: 1, z: 0 }),
    'dabinggi-hound': creatureProfile({ x: 0, y: 1, z: 0 }),
    uumkaoii: creatureProfile({ x: 0, y: 1, z: 0 }),
    puktuk: creatureProfile(originalPuktukSaddle),
    'voorg-ass': creatureProfile(originalVoorgSaddle),
  },
};
const windowStub = { HOBUNJI_ATTACHMENT_RIG_PROFILES: library, HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {} }; // Browser-shaped global consumed by the authored saddle module.
const context = vm.createContext({ window: windowStub, console }); // Isolated execution context preventing test globals from leaking into Node.
vm.runInContext(saddleSource, context, { filename: 'creature-saddle-authored-20261016.js' });

const expected = { // Exact coordinates supplied by the October 16 Animation Author export and intentionally changed from the earlier master.
  drenkirra: { x: 0, y: 0.030605877381859603, z: 0.02 },
  grehlr: { x: 0, y: 0.1224031140623686, z: 0 },
  'gar-wolf': { x: 0, y: 0.15973815894365057, z: 0.3293044388176616 },
  'dabinggi-hound': { x: 0, y: 0.17901245841201874, z: 0.6091387381509006 },
  uumkaoii: { x: 0, y: 0.6408071738820479, z: 0.02 },
};
for (const [kind, position] of Object.entries(expected)) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(library.creatures[kind].anchors.saddle.position)), position, `${kind} saddle must match the uploaded October 16 coordinates`);
  assert.strictEqual(library.creatures[kind].saddleRule.source, 'animation-author-export-2026-10-16T22:54:56.556Z', `${kind} saddle provenance must identify the uploaded authoring pass`);
  assert.strictEqual(library.creatures[kind].saddleRule.authoredFixed, true, `${kind} saddle must remain fixed instead of being preview-recalculated`);
  assert.strictEqual(library.creatures[kind].saddleRule.recalculateOnPreview, false, `${kind} saddle must not be overwritten by preview-derived defaults`);
}
assert.deepStrictEqual(JSON.parse(JSON.stringify(library.creatures.puktuk.anchors.saddle.position)), originalPuktukSaddle, 'unchanged Puktuk saddle must not be rewritten by the October pass');
assert.deepStrictEqual(JSON.parse(JSON.stringify(library.creatures['voorg-ass'].anchors.saddle.position)), originalVoorgSaddle, 'unchanged Voorg-Ass saddle must not be rewritten by the October pass');
assert.strictEqual(windowStub.HobunjiCreatureSaddleAuthoring.getDebug().applied, 5, 'mobile-safe saddle diagnostics must report all five changed species');
assert.deepStrictEqual(JSON.parse(JSON.stringify(windowStub.HobunjiCreatureSaddleAuthoring.getDebug().missing)), [], 'mobile-safe saddle diagnostics must report no missing changed species');

const vorgPreloadAt = bootstrapSource.indexOf("voorg-ass-registration.js?v=20261015h47a3826"); // Used to verify the dependency is explicitly preloaded for Animation Author only.
const saddlePassAt = bootstrapSource.indexOf('creature-saddle-authored-20261016.js?v=20261016a'); // Used to verify authored saddle coordinates are applied before snapshot import.
const snapshotCoreAt = bootstrapSource.indexOf('attachment-rig-latest-authored-snapshot-core.js?v=20261012h02be7fe'); // Comparison point for required import ordering.
assert(vorgPreloadAt >= 0, 'rig bootstrap must reference the existing Voorg-Ass registration module');
assert.match(bootstrapSource, /isAnimationAuthor[\s\S]*voorg-ass-registration\.js/, 'Voorg-Ass dependency preload must remain scoped to Animation Author pages');
assert(saddlePassAt >= 0 && snapshotCoreAt >= 0 && saddlePassAt < snapshotCoreAt, 'authored saddle pass must run before the snapshot core imports runtime rig profiles into Animation Author');
assert.match(bridgeSource, /REQUIRED_KINDS\s*=\s*Object\.freeze\(\['puktuk', 'voorg-ass'\]\)/, 'existing Animation Author registry bridge must still require both new livestock species');
assert.match(bridgeSource, /creature-genetics\.js\?v=20261002h5fdf0c4/, 'existing registry bridge must still load the gameplay genetics extension that installs Puktuk and invokes Voorg-Ass registration');
assert.match(voorgRegistrationSource, /function ensureRendererSpecies\(/, 'Voorg-Ass preload must reuse the existing renderer registration implementation');

console.log('Animation Author creature saddle/registry checks passed.');
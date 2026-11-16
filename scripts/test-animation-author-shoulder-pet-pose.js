#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Checks integration into the actual Rig Coordinates editor.
const adapter = fs.readFileSync('docs/js/animation-author-shoulder-pose-preview.js', 'utf8'); // Executes the shipped preview controller, not a test clone.
const scriptPaths = [
  'js/grehlr-head-rig-correction.js',
  'js/animal-head-rig-authored.js',
  'js/animal-shoulder-spline-profiles.js',
  'js/animal-shoulder-spline.js',
]; // Must load after CreatureGeneticsRender and in the same order as the gameplay renderer.
const scriptList = html.slice(html.indexOf('const REQUIRED_SCRIPTS = ['), html.indexOf('];', html.indexOf('const REQUIRED_SCRIPTS = ['))); // Ignore the nearby paired-runtime URL map when checking loader order.
const positions = scriptPaths.map(path => scriptList.indexOf("  '" + path + "'"));
assert(positions.every(x => x > scriptList.indexOf('  CREATURE_RENDER_SCRIPT,')), 'all authored shoulder scripts load after creature genetics');
assert(positions.every((x, i) => !i || positions[i - 1] < x), 'shoulder scripts load in dependency order');
assert.match(html, /animation-author-shoulder-pose-preview\.js\?v=/, 'the editor loads the reusable shoulder pose controller');
assert.match(html, /creatureId: kind, \/\/ The authored head\/shoulder rig resolves by species/,
  'the generated PNG URL cannot substitute for explicit species identification');
assert.match(html, /actor\.shoulderRestSourceAvatar = animal/, 'source avatar is retained for restoring the unposed art');
assert.match(html, /selectedRigAnchorName\(actor\) === 'shoulderGrip'/, 'posed presentation is scoped to grip authoring');
assert.match(html, /selectedRigAnchorName\(actor\) !== 'shoulderGrip'/, 'other rig anchors do not implicitly use the shoulder-pet pose');
assert.match(html, /value="perched">Perched · gameplay shoulder deformation/, 'the authored pose is a visible selectable editor option');
assert.match(html, /value="source">Source · undeformed sprite/, 'the original art is available for visual comparison');
assert.match(html, /actor\.shoulderGripPosePreviewControllerV1549\?\.dispose\?\.\(\)/,
  'clearing actors disposes skinned shoulder-pet preview resources');
assert.doesNotMatch(adapter, /profile\.anchors\.shoulderGrip\s*=|rigAnchors\.shoulderGrip\.position\.(?:set|copy)/,
  'displaying a posed preview must not rewrite the authored attachment grip');

function makeCanvas(tag) {
  const canvas = {
    tag, width: 64, height: 40, drawn: [],
    toDataURL() { return 'data:image/png;pose=' + tag; },
    getContext() {
      return {
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
        drawImage(image) { canvas.drawn.push(image.tag); },
      };
    },
  }; // Mimics only the Canvas2D operations used by the production split renderer.
  return canvas;
}
function fakeAvatar() {
  const group = {
    visible: true, parent: null, children: [],
    add(child) { this.children.push(child); child.parent = this; },
    remove(child) { this.children = this.children.filter(x => x !== child); child.parent = null; },
  }; // Preserves the actual source root hierarchy while testing art swapping.
  return {
    group,
    frontPlane: { visible: true, rotation: { y: Math.PI / 2 } },
    backPlane: { visible: true, rotation: { y: -Math.PI / 2 } },
    dispose() { this.didDispose = true; },
    setShoulderRestEnabled(value) { this.deformed = value; return value; },
    setShoulderSplitOverlayCanvas(canvas, visible) { this.overlay = canvas; this.overlayVisible = visible; return true; },
  };
}

async function runTest() {
  const calls = [], builds = [], notifications = [], separatorCalls = []; // Captures real adapter decisions without requiring browser WebGL.
  const authored = {
    puktuk: { enabled: true, useSpline: true, useRun1: true, splitFrame: false },
    grehlr: { enabled: true, useSpline: true, useRun1: false, splitFrame: true, splitRightUsesIdle: false },
    moot: { enabled: true, useSpline: true, useRun1: false, splitFrame: false },
  }; // Test run1, the runtime's two-layer split, and a normal idle shoulder pose.
  const window = {
    HobunjiShoulderSplineProfiles: { supportRigFor(kind) { return authored[kind] ? { shoulderRest: authored[kind] } : null; } },
    AnimalShoulderSpline: {
      separatorPolygon(width, height, rest, right) {
        separatorCalls.push(right);
        return right
          ? [{ x: width / 2, y: 0 }, { x: width, y: 0 }, { x: width, y: height }]
          : [{ x: 0, y: 0 }, { x: width / 2, y: 0 }, { x: 0, y: height }];
      },
    }, // Uses the same geometry API as gameplay rather than independently computing a separator.
    CreatureGeneticsRender: {
      async composeFrame(kind, frame) {
        calls.push([kind, frame]);
        return makeCanvas(kind + '/' + frame);
      },
    },
    PNGPlaneAvatar: {
      buildAnimalPlaneAvatarModel(THREE, url, options) {
        const avatar = fakeAvatar();
        builds.push({ avatar, url, options });
        return avatar;
      },
    },
  }; // Editor's runtime dependencies are injected into the actual module.
  const document = { createElement(type) { assert.equal(type, 'canvas'); return makeCanvas('split-canvas'); } };
  new Function('window', 'document', adapter)(window, document);
  const moduleApi = window.AnimationAuthorShoulderPosePreview;
  assert.equal(moduleApi.authoredRestFor('nonexistent'), null);
  assert.equal(moduleApi.create({ kind: 'nonexistent', sourceAvatar: fakeAvatar(), THREE: {} }), null);

  const source = fakeAvatar(), viewport = [], anchor = { x: 0.21, y: -0.32, z: 0.06 };
  const savedAnchor = JSON.stringify(anchor); // Ensures swapping source/perched art never touches the authored grip.
  const controller = moduleApi.create({
    kind: 'puktuk', genotype: { sizeClass: 'small' }, THREE: {},
    sourceAvatar: source, modelWidth: 1.1, modelHeight: 0.7, actorName: 'Puktuk',
    viewportCreaturePlanes: viewport, onChange: state => notifications.push(state),
  });
  assert(controller, 'Puktuk gets a pose controller');
  await controller.setPose('perched');
  assert.deepEqual(calls, [['puktuk', 'run1']], 'Puktuk uses its runtime run1 shoulder stance, not idle');
  assert.equal(builds.length, 1, 'one extra posed rig is built on first use');
  assert.equal(builds[0].options.creatureId, 'puktuk', 'the actual animal rig resolves by species id');
  assert.equal(builds[0].options.modelWidth, 1.1, 'posed mesh retains original plane dimensions');
  assert.equal(builds[0].avatar.deformed, true, 'production shoulder deformation is enabled on the rendered pose');
  assert.equal(source.frontPlane.visible, false);
  assert.equal(source.backPlane.visible, false);
  assert.equal(builds[0].avatar.group.visible, true);
  assert.equal(source.group.children[0], builds[0].avatar.group, 'perched sprite inherits source actor world pose');
  assert.equal(viewport.length, 2, 'both posed planes take part in the existing viewport orientation logic');
  const noticeCount = notifications.length; // Ensures a 60-fps editor loop does not rewrite the inspector on every tick.
  for (let i = 0; i < 60; i++) controller.setPose('perched');
  assert.equal(notifications.length, noticeCount, 'repeated frames cause no inspector DOM updates');
  await controller.setPose('source');
  assert.equal(source.frontPlane.visible, true);
  assert.equal(source.backPlane.visible, true);
  assert.equal(builds[0].avatar.group.visible, false);
  await controller.setPose('perched');
  assert.equal(builds.length, 1, 'switching views reuses the existing skinned mesh');
  assert.equal(JSON.stringify(anchor), savedAnchor, 'the grip is not moved or reauthored');
  controller.dispose();
  assert.equal(builds[0].avatar.didDispose, true, 'extra skinned pose resources are disposed');
  assert.equal(source.group.children.length, 0, 'disposed posed mesh cannot remain attached');
  assert.equal(source.frontPlane.visible, true, 'normal art becomes visible after the editor clears actors');

  const splitSource = fakeAvatar(), before = calls.length;
  const split = moduleApi.create({ kind: 'grehlr', genotype: {}, THREE: {},
    sourceAvatar: splitSource, modelWidth: 2, modelHeight: 1, actorName: 'Grehlr' });
  await split.setPose('perched');
  assert.deepEqual(calls.slice(before), [['grehlr', 'idle'], ['grehlr', 'run1']],
    'split artwork uses the same idle left and run1 right sources as gameplay');
  assert.deepEqual(separatorCalls, [true, false], 'foreground and background use authored split-side polygon');
  assert.equal(builds.at(-1).avatar.overlayVisible, true, 'the split foreground uses the actual overlay mesh');
  assert.equal(builds.at(-1).avatar.overlay.drawn[0], 'grehlr/idle', 'left foreground retains idle pixels');
  split.dispose();

  let isCurrent = true;
  const slowSource = fakeAvatar();
  const stale = moduleApi.create({ kind: 'moot', THREE: {}, sourceAvatar: slowSource,
    modelWidth: 1, modelHeight: 1, actorName: 'Moot', isCurrent: () => isCurrent });
  isCurrent = false;
  await stale.setPose('perched');
  assert.equal(slowSource.group.children.length, 0, 'queued art cannot resurrect a removed actor');
  assert.equal(slowSource.frontPlane.visible, true);

  const failingWindow = {
    ...window,
    CreatureGeneticsRender: { async composeFrame() { throw new Error('network artwork missing'); } },
  }; // Test visible in-editor failure diagnostics without requiring a desktop console.
  new Function('window', 'document', adapter)(failingWindow, document);
  const failureSource = fakeAvatar();
  const failure = failingWindow.AnimationAuthorShoulderPosePreview.create({
    kind: 'puktuk', THREE: {}, sourceAvatar: failureSource, modelWidth: 1,
    modelHeight: 1, actorName: 'Failure',
  });
  await failure.setPose('perched');
  assert.match(failure.status().error, /network artwork missing/, 'load failures are visible via status');
  assert.equal(failureSource.frontPlane.visible, true, 'failure never hides the existing creature');
  failure.dispose();
}

module.exports = { runTest };
if (require.main === module) runTest().then(() => console.log('Animation Author shoulder-pet grip pose checks passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });

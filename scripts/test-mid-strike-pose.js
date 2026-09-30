'use strict';

const assert = require('node:assert/strict'); // Verifies optional Mid Strike math and backward compatibility.
const fs = require('node:fs'); // Loads the shipped runtime/editor sources under test.
const vm = require('node:vm'); // Executes isolated pure interpolation helpers without booting Three.js.

const read = path => fs.readFileSync(path, 'utf8');
const gameSource = read('docs/game.js');
const editorSource = read('docs/tools/attack-animation-editor/index.html');
const stanceSource = read('docs/js/weapon-tool-stances.js');
const spacingSource = read('docs/js/combat/melee-pose-spacing.js');
const banditSource = read('docs/js/combat/combat-bandit.js');
const shoulderSource = read('docs/js/hand-shoulder-pose-runtime.js');
const gripSource = read('docs/js/hand-tool-grips.js');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

// Runtime interpolation: no midpoint is mathematically identical to the old four-phase path.
const interpolationSandbox = {};
vm.runInNewContext(`${extractFunction(gameSource, 'fourPhaseLerp')}; this.fourPhaseLerp = fourPhaseLerp;`, interpolationSandbox);
const fourPhaseLerp = interpolationSandbox.fourPhaseLerp;
const legacy = (progress, wf, sf, hf, windupV, strikeV, neutralV = 0, returnNeutralV = neutralV) => {
  if (progress <= wf) return neutralV + (windupV - neutralV) * (progress / wf);
  if (progress <= sf) return windupV + (strikeV - windupV) * ((progress - wf) / (sf - wf));
  if (progress <= hf) return strikeV;
  return strikeV + (returnNeutralV - strikeV) * ((progress - hf) / (1 - hf));
};
const args = [0.2, 0.6, 0.75, 10, 20, 0, -5];
for (const progress of [0, 0.1, 0.2, 0.21, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.9, 1]) {
  assert.equal(fourPhaseLerp(progress, ...args), legacy(progress, ...args), `no-mid runtime changed legacy pose at progress ${progress}`);
}
assert.equal(fourPhaseLerp(0.4, ...args, 100), 100, 'Mid Strike must be reached exactly halfway through Windup→Strike');
assert(Math.abs(fourPhaseLerp(0.3, ...args, 100) - 55) < 1e-12, 'first half of Strike must interpolate Windup→Mid Strike');
assert(Math.abs(fourPhaseLerp(0.5, ...args, 100) - 60) < 1e-12, 'second half of Strike must interpolate Mid Strike→Strike');

// Player preparation/runtime must carry the optional pose without manufacturing one.
assert.match(stanceSource, /let midStrike = null/, 'WeaponToolStances must keep Mid Strike optional');
assert.match(stanceSource, /authoredPose\.midStrike[\s\S]*bakeAuthoredEndpoint/, 'authored Mid Strike must use the same endpoint normalization as Windup/Strike');
assert.match(stanceSource, /\.\.\.\(midStrike \? \{ midStrike \} : \{\}\)/, 'prepared runtime pose must omit Mid Strike when absent');
assert.match(spacingSource, /phase === 'midStrike'[\s\S]*RANGE_DELTA\.windup \+ RANGE_DELTA\.strike/, 'shared melee spacing must calibrate the optional waypoint between endpoint calibrations');
assert.match(gameSource, /const mf = wf \+ \(sf - wf\) \* 0\.5/, 'player runtime must use the timing-free midpoint convention');
assert.match(gameSource, /for \(const phase of \['windup', 'midStrike', 'strike'\]\)/, 'partial held releases must scale Mid Strike with the same charge amplitude');

// Enemy rendering must preserve legacy no-mid behavior and support authored arcs.
assert.match(banditSource, /if \(!Number\.isFinite\(midStrikeV\)\) return strikeV/, 'bandits without Mid Strike must retain the old post-windup Strike hold exactly');
assert.match(banditSource, /banditPoseLerp\(progress, wf, w, s, n, m\)/, 'bandits must consume an authored Mid Strike waypoint');

// Hand/elbow runtime: transform-only midpoint is deliberately non-invasive.
const shoulderWindow = { setInterval() {} };
vm.runInNewContext(shoulderSource, { window: shoulderWindow, performance: { now: () => 0 } }, { filename: 'hand-shoulder-pose-runtime.js' });
const shoulder = shoulderWindow.HobunjiHandShoulderPoseRuntime;
const timing = { windupFrac: 0.2, strikeFrac: 0.6, holdFrac: 0.75 };
const basePose = {
  neutral: { shoulderAim: { grip: 1, palmNormal: 1 } },
  windup: { shoulderAim: { grip: 0, palmNormal: 1 } },
  strike: { shoulderAim: { grip: 1, palmNormal: 0 } },
};
const oldHands = shoulder.weightsAt(0.4, timing, basePose);
const transformOnlyHands = shoulder.weightsAt(0.4, timing, { ...basePose, midStrike: { x: 3, bodyYaw: 90 } });
assert.deepEqual(transformOnlyHands, oldHands, 'enabling a transform-only midpoint must not change the pre-existing hand interpolation');
const authoredHands = shoulder.weightsAt(0.4, timing, { ...basePose, midStrike: { shoulderAim: { grip: 1, palmNormal: 1 } } });
assert.deepEqual(authoredHands, { grip: 1, palmNormal: 1 }, 'explicit Mid Strike hand metadata must be reached at the midpoint');

// Secondary grip follows the same opt-in rule.
const gripWindow = { requestAnimationFrame: () => 0 };
vm.runInNewContext(gripSource, { window: gripWindow, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, { filename: 'hand-tool-grips.js' });
const gripApi = gripWindow.HobunjiHandToolGrips;
const gripPose = {
  neutral: { secondaryGrip: { enabled: false, percent: 20 } },
  windup: { secondaryGrip: { enabled: true, percent: 40 } },
  strike: { secondaryGrip: { enabled: true, percent: 80 } },
};
const oldGrip = gripApi.animationGripAt(0.4, timing, gripPose);
const transformOnlyGrip = gripApi.animationGripAt(0.4, timing, { ...gripPose, midStrike: { x: 1 } });
assert.deepEqual(transformOnlyGrip, oldGrip, 'transform-only Mid Strike must not alter off-hand interpolation');
const authoredGrip = gripApi.animationGripAt(0.4, timing, { ...gripPose, midStrike: { secondaryGrip: { enabled: true, percent: 10 } } });
assert.equal(authoredGrip.percent, 10, 'explicit Mid Strike off-hand position must be reached at the midpoint');

// Editor exposes a single optional waypoint, with no new timing slider.
assert.match(editorSource, /id="useMidStrike"/, 'editor must expose the Mid Strike opt-in');
assert.match(editorSource, /id="poseTabMidStrike"[^>]*data-edit-phase="midStrike"/, 'editor must expose Mid Strike as an editable pose');
assert.match(editorSource, /function midpointPose\(a, b\)/, 'editor must seed Mid Strike from the old path');
assert.match(editorSource, /const pose = lerpPose\(a, b, 0\.5\)/, 'enabling Mid Strike must initially preserve the old transform path exactly');
assert.match(editorSource, /phase === 'midStrike'\) return anim\.windupFrac \+ \(anim\.strikeFrac - anim\.windupFrac\) \* 0\.5/, 'Mid Strike must use the existing strike interval midpoint');
assert.doesNotMatch(editorSource, /id="midStrikeFrac"|id="midStrikeTime"/, 'Mid Strike must not add a separate timing control');
assert.match(editorSource, /\.\.\.\(anim\.poses\.midStrike \? \{ midStrike: clonePoseData\(anim\.poses\.midStrike\) \} : \{\}\)/, 'old exports must continue omitting the optional keyframe');

console.log('optional Mid Strike pose regression: ok');

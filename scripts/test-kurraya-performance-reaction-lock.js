'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/npc-performance-reaction-lock-runtime.js', 'utf8');

let performers = [{ npcId: 'foroji_funji', area: 'map_i_inn' }];
let directFacingCalls = 0;
let originalRenderSawDance = null;
const target = {
  id: 'foroji-kurraya-station',
  socialLookAt: { stimulusId: 'player-dance' },
  socialDance: { stimulusId: 'player-dance' },
};
const walker = {
  rec: { id: 'foroji_funji' },
  area: 'map_i_inn',
  rot: 1.25,
  currentScheduleTarget: target,
  applyFacingDeadzone() { directFacingCalls++; return 99; },
};
const otherWalker = {
  rec: { id: 'other_npc' },
  area: 'map_i_inn',
  currentScheduleTarget: null,
  applyFacingDeadzone() { return 0; },
};

class Renderer {
  render() {
    originalRenderSawDance = !!walker.currentScheduleTarget.socialDance;
    return 'rendered';
  }
}

const stimuli = {
  getActive() { return [{ id: 'player-dance', type: 'dance' }]; },
  strongestNear() { return { stimulus: { id: 'player-dance', type: 'dance' }, proximity: 1 }; },
};

const planner = {
  init(deps) { this.deps = deps; },
  resolveNpcTarget(rec) {
    const active = stimuli.getActive();
    const strongest = stimuli.strongestNear();
    if (active.length || strongest) return { id: `social-${rec.id}`, socialDance: { stimulusId: 'player-dance' } };
    return { id: `schedule-${rec.id}`, activity: 'play-kurraya' };
  },
};

const logs = [];
const context = {
  window: {
    THREE: { WebGLRenderer: Renderer },
    NpcScheduling: { listInstrumentPerformers: () => performers },
    NpcSocialStimuli: stimuli,
    NpcActivityPlanner: planner,
    __farmLog: message => logs.push(message),
    setInterval: () => 0,
  },
  performance: { now: () => 1000 },
  Date,
  Object,
  String,
  Number,
  WeakSet,
  Set,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'npc-performance-reaction-lock-runtime.js' });

planner.init({
  findNpcWalker: id => id === 'foroji_funji' ? walker : otherWalker,
  getCurrentArea: () => 'map_i_inn',
  listNpcWalkersInArea: () => [walker, otherWalker],
});

const originalGetActive = stimuli.getActive;
const originalStrongestNear = stimuli.strongestNear;
const forojiTarget = planner.resolveNpcTarget({ id: 'foroji_funji' });
assert.equal(forojiTarget.id, 'schedule-foroji_funji', 'active Kurraya performer keeps ordinary schedule target instead of a dance target');
assert.equal(stimuli.getActive, originalGetActive, 'getActive is restored after the synchronous performer resolve');
assert.equal(stimuli.strongestNear, originalStrongestNear, 'strongestNear is restored after the synchronous performer resolve');

const otherTarget = planner.resolveNpcTarget({ id: 'other_npc' });
assert.equal(otherTarget.id, 'social-other_npc', 'non-performing NPCs still receive ordinary social dance reactions');

assert.equal(walker.applyFacingDeadzone(0.5, 0.34), 1.25, 'direct physical facing is suppressed while performing');
assert.equal(directFacingCalls, 0, 'suppressed facing never reaches the original walker facing handler');

const renderer = new Renderer();
assert.equal(renderer.render(), 'rendered');
assert.equal(originalRenderSawDance, false, 'render-time social dance presentation is hidden while the performer is locked');
assert.ok(target.socialDance, 'render suppression restores the target metadata after the render pass');
assert.ok(target.socialLookAt, 'render suppression restores look-at metadata after the render pass');

performers = [];
assert.equal(walker.applyFacingDeadzone(0.5, 0.34), 99, 'physical facing resumes as soon as the instrument performance ends');
assert.equal(directFacingCalls, 1, 'unlocked facing reaches the original walker handler');

const debug = context.window.NpcPerformanceReactionLock.getDebug();
assert.ok(debug.maskedResolves >= 1, 'debug tracks masked planner resolves');
assert.ok(debug.renderSuppressions >= 1, 'debug tracks render suppressions');
assert.ok(debug.facingSuppressions >= 1, 'debug tracks direct facing suppressions');
assert.equal(debug.lastNpcId, 'foroji_funji');
assert.ok(logs.some(line => line.includes('foroji_funji')), 'first suppression emits one in-game debug log line');

console.log('Kurraya performer physical-reaction lock tests passed');

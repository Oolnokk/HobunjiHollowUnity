// The player's held tool-action animations (felling a tree, breaking a rock, digging, casting a fishing
// spear) as data + a sampler, so NPCs play exactly what the player plays.
//
// game.js aliases CHOP_TREE_STAGES / MINE_ROCK_STAGES to the tables below (the player's hold timeline);
// js/npc-held-equipment-v4.js samples poseAt() for any NPC whose schedule target carries a `toolActivity`.
// Both read the same SharedAttackPose math, the same authored hatchet_swing pose and the same legacy
// thrust arc the player's updateToolMesh uses — see docs/architecture/shared-attack-pose.md.
(() => {
  'use strict';
  if (window.ToolActivityStages) return;

  const RAD_TO_DEG = 180 / Math.PI;

  // Felling a tree: alternating forehand/backhand swings of the authored sweep pose.
  const CHOP_TREE_STAGES = [1, -1, 1].map((dirSign, index, stages) => ({
    pose: true,
    dirSign,
    dur: 0.55,
    sfxKey: 'chop',
    terminalSfxKey: index === stages.length - 1 ? 'breakTree' : null,
  }));

  // Breaking a rock: three plain thrust jabs (the pick-shovel is flipped spike-forward for them).
  const MINE_ROCK_STAGES = [0, 0, 0].map((_, index, stages) => ({
    anim: 'thrust',
    dur: 0.55,
    sfxKey: 'pick',
    terminalSfxKey: index === stages.length - 1 ? 'breakRock' : null,
  }));

  // Digging a trench: the thrust half of the player's dig/toss pairs (the toss is a bespoke player-only arc).
  const DIG_THRUST_STAGES = [1.0, 0.25].map(dur => ({ anim: 'thrust', dur, sfxAt: 0.16, sfxKey: 'dig' }));

  // Per-activity playback: which stage table, which sprite style, and the tool a NPC holds for it.
  const ACTIVITIES = {
    chop: { stages: CHOP_TREE_STAGES, style: 'sweep', toolKey: 'hatchet', sfxKey: 'chop', loop: true },
    mine: { stages: MINE_ROCK_STAGES, style: 'thrust', toolKey: 'pickshovel', flip: true, sfxKey: 'pick', loop: true },
    dig: { stages: DIG_THRUST_STAGES, style: 'thrust', toolKey: 'pickshovel', flip: true, sfxKey: 'dig', loop: true },
    fish: { style: 'ranged', toolKey: 'fishingspear', cycleS: 9, loop: true },
  };

  const WINDUP_FRAC = 0.22, STRIKE_FRAC = 0.55; // The player's chop stage fractions (game.js beginChargeStage).
  const THRUST_WF = 0.16, THRUST_SF = 0.28; // updateToolMesh's default tool-thrust fractions.

  let sample = null; // Reused every call; created lazily because shared-attack-pose.js may load after this file.

  function stageTotalS(stages) {
    let total = 0;
    for (const stage of stages) total += stage.dur;
    return total;
  }

  function fillPose(out, s) {
    out.x = s.x; out.y = s.y; out.z = s.z;
    out.pitch = s.pitchRad * RAD_TO_DEG;
    out.yaw = s.yawRad * RAD_TO_DEG;
    out.roll = s.rollRad * RAD_TO_DEG;
    out.bodyYaw = s.bodyYawRad * RAD_TO_DEG;
    return out;
  }

  function fishAnimation() {
    return window.HeldActionAnimations?.weaponThrowSpearSpin || null; // The pose fishing-minigame.js throws with.
  }

  // Samples `activity` at `elapsedS` (looping) into `out` (editor-channel degrees: x y z pitch yaw roll
  // bodyYaw) and returns it, adding `out.dirSign` and `out.sweep` for the sprite twist/mirror. `speed`
  // scales the clock like the player's skill speed multiplier. Returns null when the activity or the
  // shared pose math is unavailable.
  function poseAt(activity, elapsedS, out, speed = 1) {
    const def = ACTIVITIES[activity];
    const SAP = window.SharedAttackPose;
    if (!def || !SAP) return null;
    if (!sample) sample = SAP.createSample();
    const clock = Math.max(0, Number(elapsedS) || 0) * Math.max(0.1, speed);
    out.sweep = def.style === 'sweep';
    out.dirSign = 1;
    if (activity === 'fish') {
      const animation = fishAnimation();
      if (!animation?.poses) return null;
      const durationS = Math.max(0.2, Number(animation.durationS) || 1.04);
      const t = clock % def.cycleS;
      const progress = Math.min(1, t / durationS); // One cast per cycle, then the rod rests until the next.
      const wf = Number.isFinite(Number(animation.windupFrac)) ? Number(animation.windupFrac) : 0.49;
      const sf = Number.isFinite(Number(animation.strikeFrac)) ? Number(animation.strikeFrac) : 0.57;
      const hf = Number.isFinite(Number(animation.holdFrac)) ? Number(animation.holdFrac) : 0.82;
      SAP.samplePose(sample, animation.poses, SAP.STYLE_NEUTRAL_POSE.ranged, progress, wf, sf, hf, 1, 1, animation.sequence || 'attack');
      return fillPose(out, sample);
    }
    const total = stageTotalS(def.stages);
    let t = clock % total;
    let stage = def.stages[0];
    for (const candidate of def.stages) {
      stage = candidate;
      if (t < candidate.dur) break;
      t -= candidate.dur;
    }
    const progress = Math.min(1, t / stage.dur);
    if (stage.pose) {
      const pose = window.AttackPoseTemplates?.poseFor?.('hatchet_swing');
      if (!pose) return null;
      const hf = SAP.holdFrac(STRIKE_FRAC, 0, stage.dur);
      out.dirSign = stage.dirSign || 1;
      SAP.samplePose(sample, pose, SAP.STYLE_NEUTRAL_POSE.sweep, progress, WINDUP_FRAC, STRIKE_FRAC, hf, out.dirSign, 1, 'attack');
      return fillPose(out, sample);
    }
    const hf = SAP.holdFrac(THRUST_SF, 0, stage.dur);
    SAP.sampleLegacyThrust(sample, progress, THRUST_WF, THRUST_SF, hf, 1, SAP.LEGACY_THRUST.windupBackTool);
    return fillPose(out, sample);
  }

  // Seconds into the loop at which the tool lands (for contact sounds / progress): the strike of each stage.
  function strikeTimes(activity) {
    const def = ACTIVITIES[activity];
    if (!def?.stages) return [];
    const times = [];
    let at = 0;
    for (const stage of def.stages) {
      times.push(at + stage.dur * (stage.pose ? STRIKE_FRAC : THRUST_SF));
      at += stage.dur;
    }
    return times;
  }

  window.ToolActivityStages = Object.freeze({
    CHOP_TREE_STAGES,
    MINE_ROCK_STAGES,
    DIG_THRUST_STAGES,
    ACTIVITIES,
    poseAt,
    strikeTimes,
    toolKeyFor: activity => ACTIVITIES[activity]?.toolKey || '',
    loopSeconds: activity => ACTIVITIES[activity]?.stages ? stageTotalS(ACTIVITIES[activity].stages) : (ACTIVITIES[activity]?.cycleS || 0),
  });
})();

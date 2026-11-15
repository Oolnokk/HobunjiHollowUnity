// Shared attack pose templates: the single source for the Neutral/Windup/Strike
// poses the attack-animation editor shows when an attack is selected, and the
// poses the game plays for that attack. Both docs/tools/attack-animation-editor
// and the combat modules (combat-combo.js, combat-quickattacks.js,
// combat-charged-breaker.js, combat-flurry.js) read from here, so an attack
// looks in-game the way it looks in the editor.
//
// Channels: x/y/z are hand-relative right/height/forward offsets, pitch/yaw/roll
// the tool's own tilt (degrees), bodyYaw the whole character's turn (degrees).
// Mirroring (Backhand, dirSign -1) negates x, yaw, roll and bodyYaw at runtime.
(() => {
  'use strict';
  if (window.AttackPoseTemplates) return;

  const pose = (x, y, z, pitch, yaw, bodyYaw = 0, roll = 0) => ({ x, y, z, pitch, yaw, bodyYaw, roll });
  const GRIP_OFF = { enabled: false, percent: 50, primaryPercent: 50 };
  const GRIP_ON = { enabled: true, percent: 50, primaryPercent: 50 };
  const DUAL = { enabled: true };

  // Fallback rest pose per style (the editor's STYLE_NEUTRAL_POSE). In game the
  // weapon slot's Light/Heavy stance (WeaponToolStances) replaces Neutral.
  const STYLE_NEUTRAL_POSE = Object.freeze({
    thrust: Object.freeze({ ...pose(0, 0, 0, 10.31, 0, 0), scale: 1 }),
    sweep: Object.freeze({ ...pose(0, 0, 0.16, 0, 0, 0), scale: 1 }),
  });

  const SWEEP_SWING = {
    style: 'sweep',
    neutral: { ...STYLE_NEUTRAL_POSE.sweep, secondaryGrip: GRIP_OFF, dualWield: DUAL },
    windup: { ...pose(0, 0, 0.16, 0, 0, -126.05), secondaryGrip: GRIP_ON, dualWield: DUAL },
    strike: { ...pose(0, 0, 0.16, 0, 0, 121.49), secondaryGrip: GRIP_ON, dualWield: DUAL },
  };
  const THRUST_SWING = {
    style: 'thrust',
    neutral: { ...STYLE_NEUTRAL_POSE.thrust, secondaryGrip: GRIP_OFF, dualWield: DUAL },
    windup: { ...pose(0, 0, -0.22, 10.31, 0, -45), secondaryGrip: GRIP_ON, dualWield: DUAL },
    strike: { ...pose(-0.23, 0, 0.32, 1, -45, 46), secondaryGrip: GRIP_ON, dualWield: DUAL },
  };

  function deepFreeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  }

  const TEMPLATES = deepFreeze({
    hatchet_swing: SWEEP_SWING,
    fishingspear_swing: SWEEP_SWING,
    fishingmace_swing: SWEEP_SWING,
    pickshovel_swing: THRUST_SWING,
  });

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  // A mutable copy of a template's three poses, with the editor's power rule
  // applied: power scales only a sweep's body turn (windup/strike bodyYaw).
  // Callers then pass power 1 to the swing visual so nothing rescales it.
  function poseFor(templateId, power = 1) {
    const template = TEMPLATES[templateId];
    if (!template) return null;
    const out = { neutral: clone(template.neutral), windup: clone(template.windup), strike: clone(template.strike) };
    const p = Number(power);
    if (template.style === 'sweep' && Number.isFinite(p) && p !== 1) {
      out.windup.bodyYaw *= p;
      out.strike.bodyYaw *= p;
    }
    return out;
  }

  window.AttackPoseTemplates = Object.freeze({ TEMPLATES, STYLE_NEUTRAL_POSE, poseFor, styleOf: id => TEMPLATES[id]?.style || null });
})();

// Oddclaw's per-exercise state for Spearhead's practice arena (pause, reset,
// per-frame lesson conditions). Extracted from game.js's CombatTutorial.init
// deps; spawning/removal stay in game.js because they own scene collections.
(() => {
  'use strict';
  let tile = 32; // Replaced by game.js's TILE during init.
  function init(deps) { tile = deps.TILE; }
  function pause(target) {
    if (!target) return;
    target.combatTutorialHostile = false;
    target._banditAction?.cancel(); target._banditAction = null;
    target.telegraphState = null; target._banditLunging = false;
    target.vx = 0; target.vy = 0;
  }
  function reset(target, lesson, practice) {
    if (!target) return;
    target.x = (practice?.c ?? 10.5) * tile; target.y = (practice?.r ?? 11.5) * tile;
    target.facing = Math.PI / 2; target.state = 'idle';
    target.attackCooldownT = 1.5; target._banditComboIndex = 0;
    target.knockbackT = 0; target.knockbackVX = 0; target.knockbackVY = 0;
    target.prone = false; target.exhaustion = { active: false, blackStamina: 100 };
    target.maxHealth = lesson?.preview ? 100 : 10000; target.health = target.maxHealth;
    target.afflictions = {}; target._rangedAmmoDebuffs = {};
    target.footing = target.maxFooting; target.stamina = target.maxStamina;
  }
  function maintain(target, lesson) {
    target.combatTutorialPreview = !!lesson?.preview; // Preserve real damage, afflictions and movement while comparing upgrade effects.
    if (!lesson?.preview) {
      target.health = lesson?.condition === 'lowHealth' ? 2000 : target.maxHealth; target.afflictions = {};
      target.footing = target.maxFooting; target.prone = false;
      target.stamina = lesson?.condition === 'exhausted' ? 0 : target.maxStamina;
      target.exhaustion = { active: lesson?.condition === 'exhausted', blackStamina: 100 };
    }
    if (!target.combatTutorialHostile && !lesson?.preview) {
      target.knockbackT = 0; target.knockbackVX = 0; target.knockbackVY = 0;
      target.staggered = { active: false, endsAt: 0 };
    }
  }
  window.CombatTutorialPartner = { init, pause, reset, maintain };
})();

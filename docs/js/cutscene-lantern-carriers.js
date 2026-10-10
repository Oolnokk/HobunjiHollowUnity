(() => {
  'use strict';

  // Authored cutscene actors that carry a lantern (actor.lantern === true in
  // the cutscene payload). WeatherFX's lantern mask normally follows only the
  // real player and "watch" NPCs; during a cutscene the real player is parked
  // and the on-screen people are temporary rigs, so game.js registers each
  // lantern-carrying rig's root here for the scene's duration and
  // WeatherFX.drawLanternMasks() reads list() every lighting pass.
  const roots = new Set();

  window.CutsceneLanternCarriers = {
    add(root) { if (root) roots.add(root); },
    remove(root) { roots.delete(root); },
    clear() { roots.clear(); }, // Called from the cutscene cleanup path so no rig outlives its scene.
    list() { return roots; },
    active() { return roots.size > 0; },
  };
})();

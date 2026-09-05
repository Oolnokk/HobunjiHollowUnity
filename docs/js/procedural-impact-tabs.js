// Procedural Animation Editor adapter loader.
// Keeps the current-main Impact/Dance workspace intact in
// procedural-impact-tabs-core.js, then layers modern Ground / Rest and Carry
// authoring beside it from the exact same branch/commit as this script.
(function () {
  'use strict';

  const SELF_SCRIPT_SRC = document.currentScript?.src || '';
  const src = (relative) => SELF_SCRIPT_SRC
    ? new URL(relative, SELF_SCRIPT_SRC).href
    : new URL(`../../js/${relative}`, window.location.href).href;

  function loadScript(id, url, ready) {
    if (ready?.()) return Promise.resolve(true);
    const existing = document.getElementById(id) || [...document.scripts].find((script) => script.src === url);
    if (existing) return new Promise((resolve) => {
      if (ready?.()) return resolve(true);
      existing.addEventListener('load', () => resolve(ready ? !!ready() : true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
    });
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.id = id;
      script.async = false;
      script.src = url;
      script.addEventListener('load', () => resolve(ready ? !!ready() : true), { once: true });
      script.addEventListener('error', () => {
        console.error(`[Procedural adapters] Failed to load ${url}`);
        resolve(false);
      }, { once: true });
      document.head.appendChild(script);
    });
  }

  async function boot() {
    await loadScript(
      'proceduralImpactTabsCoreScript',
      src('procedural-impact-tabs-core.js'),
      () => Boolean(document.getElementById('proceduralDanceModeScript') || window.ProceduralDanceMode?.installed)
    );

    await loadScript(
      'proceduralGroundCarryLegBonesScript',
      src('leg-bones.js'),
      () => typeof window.LegBones?.solveFixedTwoBoneChain === 'function'
    );

    await loadScript(
      'proceduralAnatomyProfilesScript',
      src('../config/procedural-anatomy-profiles.js'),
      () => Boolean(window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve)
    );

    await loadScript(
      'proceduralLiveArmAnchorsScript',
      src('procedural-live-arm-anchors.js'),
      () => Number(window.HobunjiProceduralArmAnchors?.version) >= 1
    );

    await loadScript(
      'proceduralLimbManualAuthorScript',
      src('procedural-limb-manual-author.js'),
      () => Boolean(window.ProceduralLimbManualAuthor?.create)
    );

    await loadScript(
      'proceduralGroundRestModeScript',
      src('procedural-limb-pose-author.js'),
      () => Number(window.HobunjiProceduralLimbPoseAuthor?.version) >= 5
    );

    await loadScript(
      'proceduralCarryWalkModeScript',
      src('procedural-carry-walk-mode.js'),
      () => Boolean(window.ProceduralCarryWalkMode?.installed)
    );

    const status = document.getElementById('statusPill');
    if (status && window.HobunjiProceduralLimbPoseAuthor?.version >= 5 && window.ProceduralCarryWalkMode?.installed) {
      status.textContent = 'Modern Ground / Rest + Carry modes ready · live shoulders';
      status.className = 'pill good';
    }
    console.info('[Procedural adapters] Current-main Impact/Dance + Ground/Rest + Regular-derived Carry loaded with live attachment shoulders.');
  }

  boot();
})();

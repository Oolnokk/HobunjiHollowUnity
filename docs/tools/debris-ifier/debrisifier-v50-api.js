// Small bridge around the exact Debris-ifier V50 source for dev/runtime playtests.
// This file intentionally lives in the same classic-script realm as V50 so it can
// expose the generator without copying or reimplementing any of its constructors.
(() => {
  'use strict';

  let previewLoopPaused = false;

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function restorePreviewRoots() {
    if (localePreviewRoot.parent !== scene) {
      localePreviewRoot.removeFromParent();
      localePreviewRoot.position.set(0, 0, 0);
      localePreviewRoot.rotation.set(0, 0, 0);
      localePreviewRoot.scale.set(1, 1, 1);
      scene.add(localePreviewRoot);
    }
    if (mechanismParticleRoot.parent !== scene) {
      mechanismParticleRoot.removeFromParent();
      mechanismParticleRoot.position.set(0, 0, 0);
      mechanismParticleRoot.rotation.set(0, 0, 0);
      mechanismParticleRoot.scale.set(1, 1, 1);
      scene.add(mechanismParticleRoot);
    }
  }

  async function generateInteriorLocale(options = {}) {
    restorePreviewRoots();
    await loadRepoFurnitureLibrary();

    $('localeSeed').value = String(options.seed ?? 'dev-ruin');
    $('localeSize').value = options.size || 'medium';
    $('localeEnvironment').value = 'interior';
    $('localeDensity').value = String(options.density ?? 62);
    $('interiorRoomMin').value = String(options.roomMin ?? 3);
    $('interiorRoomMax').value = String(options.roomMax ?? 8);
    syncLocaleEnvironmentControls();
    updateOutputs();

    await generateRuinsLocalePreview({ keepCurrentSeed: true });
    if (!lastGeneratedLocale || lastGeneratedLocale.meta?.environment !== 'interior') {
      throw new Error($('localeStatus')?.textContent || 'V50 did not produce an interior ruin.');
    }

    return {
      seed: $('localeSeed').value,
      locale: cloneJson(lastGeneratedLocale),
      status: $('localeStatus')?.textContent || '',
    };
  }

  function takePreviewRoots() {
    localePreviewRoot.removeFromParent();
    mechanismParticleRoot.removeFromParent();
    return { localeRoot: localePreviewRoot, particleRoot: mechanismParticleRoot };
  }

  // The normal V50 tool owns a requestAnimationFrame loop that applies one global
  // preview progress value to every mechanism. Runtime playtests need independent
  // mechanism state instead, so stop future tool frames after generation and let
  // the game call tickRuntime/applyProgress explicitly.
  function pausePreviewLoop() {
    if (previewLoopPaused) return;
    previewLoopPaused = true;
    window.requestAnimationFrame = () => 0;
  }

  function setMechanismTarget(active) {
    mechanismTargetState = active ? 1 : 0;
    updateMechanismButton();
    return mechanismTargetState;
  }

  function snapMechanismState(progress) {
    mechanismProgress = clamp(Number(progress) || 0, 0, 1);
    mechanismTargetState = mechanismProgress;
    snapMechanisms(localePreviewRoot, mechanismProgress);
    updateMechanismButton();
    return mechanismProgress;
  }

  function applyProgress(root, progress) {
    applyMechanismProgress(root, clamp(Number(progress) || 0, 0, 1));
  }

  function rotateLinkedCube(root, controlIndex, direction = 1) {
    return rotateLinkedCubeControl(root, Number(controlIndex) || 0, direction < 0 ? -1 : 1);
  }

  function tickRuntime(dt) {
    const safeDt = clamp(Number(dt) || 0, 0, .05);
    updateLinkedCubePuzzles(safeDt);
    updateMechanismParticleEffects(safeDt);
  }

  function getState() {
    return {
      seed: $('localeSeed')?.value || null,
      locale: cloneJson(lastGeneratedLocale),
      mechanismProgress,
      mechanismTargetState,
      previewLoopPaused,
      previewRootAttachedToTool: localePreviewRoot.parent === scene,
    };
  }

  window.DebrisifierV50 = Object.freeze({
    sourceSha256: '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40',
    generateInteriorLocale,
    takePreviewRoots,
    restorePreviewRoots,
    pausePreviewLoop,
    setMechanismTarget,
    snapMechanismState,
    applyProgress,
    rotateLinkedCube,
    tickRuntime,
    getState,
  });
})();

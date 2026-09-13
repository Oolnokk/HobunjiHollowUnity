// Small bridge around the exact Debris-ifier V50 source for dev/runtime playtests.
// This file intentionally lives in the same classic-script realm as V50 so it can
// expose the generator without copying or reimplementing any of its constructors.
(() => {
  'use strict';

  let previewLoopPaused = false;

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function detachObject(root) {
    if (root?.parent?.remove) root.parent.remove(root);
  }

  function restorePreviewRoots() {
    if (localePreviewRoot.parent !== scene) {
      detachObject(localePreviewRoot);
      localePreviewRoot.position.set(0, 0, 0);
      localePreviewRoot.rotation.set(0, 0, 0);
      localePreviewRoot.scale.set(1, 1, 1);
      scene.add(localePreviewRoot);
    }
    if (mechanismParticleRoot.parent !== scene) {
      detachObject(mechanismParticleRoot);
      mechanismParticleRoot.position.set(0, 0, 0);
      mechanismParticleRoot.rotation.set(0, 0, 0);
      mechanismParticleRoot.scale.set(1, 1, 1);
      scene.add(mechanismParticleRoot);
    }
  }

  // V50 keeps the authoritative per-cell elevation map on its generated
  // Roughbrick floor mesh because the standalone preview can query the scene
  // directly. The game bridge needs that same map after the roots leave this
  // iframe, so mirror it into exported metadata without changing V50 source.
  function hydrateInteriorPlateauLevels() {
    const shell = lastGeneratedLocale?.meta?.interiorShell;
    if (!shell?.plateauModel || !localePreviewRoot?.traverse) return null;
    let floor = null;
    localePreviewRoot.traverse(object => {
      if (floor) return;
      const model = object.userData?.plateauModel;
      if (object.userData?.wallBuilderRecipe === 'wallrecipe2.json' && model?.levelByCell) floor = object;
    });
    const floorModel = floor?.userData?.plateauModel;
    if (!floorModel?.levelByCell) return shell.plateauModel;
    shell.plateauModel.levelByCell = { ...floorModel.levelByCell };
    if (Number.isFinite(Number(floorModel.stepHeight))) shell.plateauModel.stepHeight = Number(floorModel.stepHeight);
    shell.plateauModel.runtimeLevelSource = floor.name || 'V50 Roughbrick floor mesh';
    return shell.plateauModel;
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
    hydrateInteriorPlateauLevels();

    return {
      seed: $('localeSeed').value,
      locale: cloneJson(lastGeneratedLocale),
      status: $('localeStatus')?.textContent || '',
    };
  }

  function takePreviewRoots() {
    detachObject(localePreviewRoot);
    detachObject(mechanismParticleRoot);
    return { localeRoot: localePreviewRoot, particleRoot: mechanismParticleRoot };
  }

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

  function syncPressurePlates(root) {
    if (!root?.traverse) return;
    root.traverse(plateRoot => {
      if (plateRoot.userData?.previewMotion?.type !== 'pressurePlate') return;
      let weight = 0;
      const block = plateRoot.userData.linkedWeightBlock;
      if (block) {
        const dx = block.position.x - plateRoot.position.x;
        const dz = block.position.z - plateRoot.position.z;
        const dy = Math.abs(block.position.y - plateRoot.position.y);
        const dist = Math.hypot(dx, dz);
        const threshold = (block.userData.pushBlockSize || .62) * .58 + .34;
        const verticalThreshold = (block.userData.pushBlockSize || .62) * .72 + .18;
        if (dy < verticalThreshold) weight = clamp((threshold - dist) / Math.max(.08, threshold * .28), 0, 1);
      }
      plateRoot.userData.weightProgress = weight;
      plateRoot.userData.weightActive = weight > .82;
      if (plateRoot.userData.pressPlate) {
        plateRoot.userData.pressPlate.position.y = (plateRoot.userData.plateOpenY ?? .105)
          - (plateRoot.userData.plateDepress ?? .05) * weight;
      }
    });
  }

  function rotateLinkedCube(root, controlIndex, direction = 1) {
    return rotateLinkedCubeControl(root, Number(controlIndex) || 0, direction < 0 ? -1 : 1);
  }

  function tickRuntime(dt) {
    const safeDt = clamp(Number(dt) || 0, 0, .05);
    updateLinkedCubePuzzles(safeDt);
    updateMechanismParticleEffects(safeDt);
  }

  // Runtime-generated recovery access deliberately calls V50's real ladder
  // constructor instead of drawing a game-side stand-in.
  function createRuntimeStoneLadder(height, width = .72, depth = .12) {
    const material = new THREE.MeshStandardMaterial({
      color: hexToNum(RUIN_STONE_FILL), roughness: .92, metalness: .02,
    });
    const ladder = createStoneLadder(material, Math.max(.5, Number(height) || .5), width, depth);
    ladder.userData.runtimeRecoveryEgress = true;
    return ladder;
  }

  const KNOWN_MOTIONS = new Set([
    'bridge','bridgeSequence','stoneDoor','movingDais','collapsingStairs',
    'pushPuzzleBlock','elevatorPushBlock','pressurePlate','torch','brazier',
    'signalObelisk','rotatingObelisk','linkedCubePair',
  ]);
  const KNOWN_ACTIVATORS = new Set([
    'pressurePlate','torch','brazier','glyphObelisk','stackedObelisk','linkedCubePillars',
  ]);
  const KNOWN_ACCESS = new Set(['stoneStair','stoneLadder']);

  function inspectRuntimeTags(root) {
    const motions = new Set(), activators = new Set(), access = new Set(), unknown = [];
    let transitDoors = 0, staticDaises = 0, elevatorSockets = 0, ladders = 0;
    root?.traverse?.(object => {
      const d = object.userData || {};
      const motion = d.previewMotion?.type;
      if (motion) {
        motions.add(motion);
        if (!KNOWN_MOTIONS.has(motion)) unknown.push({ kind:'motion', value:motion, name:object.name || String(object.id) });
      }
      if (d.activatorType) {
        activators.add(d.activatorType);
        if (!KNOWN_ACTIVATORS.has(d.activatorType)) unknown.push({ kind:'activator', value:d.activatorType, name:object.name || String(object.id) });
      }
      if (d.generatedAccessType) {
        access.add(d.generatedAccessType);
        if (d.generatedAccessType === 'stoneLadder') ladders++;
        if (!KNOWN_ACCESS.has(d.generatedAccessType)) unknown.push({ kind:'access', value:d.generatedAccessType, name:object.name || String(object.id) });
      }
      if (d.transitDoor) transitDoors++;
      if (d.staticPuzzleDais) staticDaises++;
      if (d.elevatorWellSocket) elevatorSockets++;
    });
    return {
      motions:[...motions].sort(), activators:[...activators].sort(), access:[...access].sort(),
      transitDoors, staticDaises, elevatorSockets, ladders, unknown,
    };
  }

  async function auditInteriorSeeds(options = {}) {
    const count = Math.max(1, Math.min(50, Math.floor(Number(options.count) || 12)));
    const seedPrefix = String(options.seedPrefix || 'runtime-audit');
    const results = [];
    const aggregate = { motions:new Set(), activators:new Set(), access:new Set(), unknown:[] };
    for (let i = 0; i < count; i++) {
      const generated = await generateInteriorLocale({
        seed:`${seedPrefix}-${i}`,
        size:options.size || 'medium',
        density:options.density ?? 62,
        roomMin:options.roomMin ?? 3,
        roomMax:options.roomMax ?? 8,
      });
      const tags = inspectRuntimeTags(localePreviewRoot);
      for (const value of tags.motions) aggregate.motions.add(value);
      for (const value of tags.activators) aggregate.activators.add(value);
      for (const value of tags.access) aggregate.access.add(value);
      for (const entry of tags.unknown) aggregate.unknown.push({ seed:generated.seed, ...entry });
      const levels = Object.values(generated.locale?.meta?.interiorShell?.plateauModel?.levelByCell || {}).map(Number);
      results.push({
        seed:generated.seed,
        rooms:generated.locale?.meta?.interiorShell?.rooms?.length || 0,
        negativeLevelCells:levels.filter(level => level < 0).length,
        ...tags,
      });
    }
    return {
      count,
      results,
      aggregate:{
        motions:[...aggregate.motions].sort(),
        activators:[...aggregate.activators].sort(),
        access:[...aggregate.access].sort(),
        unknown:aggregate.unknown,
      },
    };
  }

  function getState() {
    hydrateInteriorPlateauLevels();
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
    syncPressurePlates,
    rotateLinkedCube,
    tickRuntime,
    createRuntimeStoneLadder,
    inspectRuntimeTags,
    auditInteriorSeeds,
    hydrateInteriorPlateauLevels,
    getState,
  });
})();

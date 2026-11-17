'use strict';

// Optional baby growth regions and cross-species shoulder pose copying.
// This editor-only module delegates deformation and shoulder serialization to the
// existing shared systems instead of introducing a second pose/texture implementation.
(() => {
  const customToggle = $('babyHeadUseCustomFrame'); // Opts the active species out of its automatic chathead selection.
  const drawHeadButton = $('babyHeadDrawCustom'); // Starts a one-gesture source-image rectangle drag.
  const clearHeadButton = $('babyHeadClearCustom'); // Clears the authored override without changing head paint.
  const customLabel = $('babyHeadCustomFrameStatus'); // Touch-friendly confirmation of the head box.
  const abdomenToggle = $('babyAbdomenEnabled'); // Enables a separate abdominal growth warp.
  const abdomenSlider = $('babyAbdomenScale'); // Per-species abdomen growth percentage.
  const abdomenLabel = $('babyAbdomenScaleLabel'); // Displays the current abdominal growth percentage.
  const drawAbdomenButton = $('babyHeadDrawAbdomen'); // Draws the independent belly rectangle.
  const clearAbdomenButton = $('babyHeadClearAbdomen'); // Removes the abdomen rectangle safely.
  const abdomenStatus = $('babyAbdomenFrameStatus'); // Reports missing or valid abdomen bounds.
  const copySpeciesSelect = $('shoulderCopySource'); // Source animal whose complete authored shoulder rest will be copied.
  const copyShoulderButton = $('shoulderCopyFromSpecies'); // Applies the source pose to the current species.
  const copyShoulderStatus = $('shoulderCopyStatus'); // Mobile-visible confirmation and errors.
  const warp = window.BabyAnimalHeadWarp; // Shared runtime rectangle validation and post-composite pixels.

  let customEnabled = false; // True only when a manually selected head box should replace the automatic portrait.
  let customFrame = null; // Normalized bounds independent of the source PNG's native pixel resolution.
  let abdomenEnabled = false; // Optional abdomen deformation is off for all existing animal rigs.
  let abdomenFrame = null; // Normalized box for abdominal growth, stored on each species head rig.
  let abdomenScale = 1.20; // Default when an author first enables abdomen growth; 100% means no change.
  let activeBox = null; // 'head', 'abdomen', or null; only one canvas-gesture tool can be active.
  let drawing = null; // A transient pointer gesture that never edits source paint, shoulder nodes, or animal assets.
  let lastCopied = null; // Last copied pair for mobile debug and human confirmation.

  function safeFrame(raw) { return warp?.validateFrame?.(raw) || null; }

  function regionSummary(frame) {
    return frame
      ? Math.round(frame.width * 100) + '% wide × ' + Math.round(frame.height * 100) + '% high'
      : 'not drawn';
  }

  function syncRegionControls() {
    customToggle.checked = customEnabled;
    abdomenToggle.checked = abdomenEnabled;
    abdomenSlider.value = String(Math.round(abdomenScale * 100));
    abdomenLabel.textContent = Math.round(abdomenScale * 100) + '%';
    customLabel.textContent = (customEnabled ? 'Custom head box: ' : 'Stored head box: ') + regionSummary(customFrame);
    abdomenStatus.textContent = (abdomenEnabled ? 'Abdomen box: ' : 'Stored abdomen box: ') + regionSummary(abdomenFrame);
    drawHeadButton.classList.toggle('active', activeBox === 'head');
    drawAbdomenButton.classList.toggle('active', activeBox === 'abdomen');
    drawHeadButton.setAttribute('aria-pressed', String(activeBox === 'head'));
    drawAbdomenButton.setAttribute('aria-pressed', String(activeBox === 'abdomen'));
    drawHeadButton.textContent = activeBox === 'head' ? 'Drag on sprite to draw head…' : 'Draw head box on sprite';
    drawAbdomenButton.textContent = activeBox === 'abdomen' ? 'Drag on sprite to draw abdomen…' : 'Draw abdomen box on sprite';
  }

  function rigForRecord(record) {
    const id = String(record?.id || '').trim();
    const saved = id ? readPreviewRigs()?.[id] : null; // The painter's unsent game preview overrides the repository snapshot.
    return saved || record?.headRig || null;
  }

  function loadRegions(record) {
    const saved = String(record?.id || '').trim() ? readPreviewRigs()?.[record.id] : null;
    const rig = record?.headRig || {};
    customEnabled = (saved?.babyHeadUseCustomFrame ?? rig.babyHeadUseCustomFrame) === true;
    customFrame = safeFrame(saved?.babyHeadCustomFrame ?? rig.babyHeadCustomFrame);
    abdomenEnabled = (saved?.babyAbdomenEnabled ?? rig.babyAbdomenEnabled) === true;
    abdomenFrame = safeFrame(saved?.babyAbdomenFrame ?? rig.babyAbdomenFrame);
    const amount = saved?.babyAbdomenScale ?? rig.babyAbdomenScale;
    abdomenScale = Number.isFinite(amount) ? clamp(amount, 1, warp?.MAX_ABDOMEN_SCALE ?? 1.8) : 1.20;
    activeBox = null;
    drawing = null;
    syncRegionControls();
  }

  const loadBeforeRegions = applyRecord;
  applyRecord = function applyRecordWithGrowthRegions(record, index = -1) {
    const result = loadBeforeRegions(record, index);
    loadRegions(record);
    populateCopySources();
    requestDraw();
    return result;
  };

  const normalizeBeforeRegions = normalizedRig;
  normalizedRig = function normalizedRigWithGrowthRegions() {
    const rig = normalizeBeforeRegions();
    if (!rig) return rig;
    rig.babyHeadUseCustomFrame = customEnabled && !!customFrame;
    if (customFrame) rig.babyHeadCustomFrame = { ...customFrame };
    else delete rig.babyHeadCustomFrame;
    rig.babyAbdomenEnabled = abdomenEnabled && !!abdomenFrame;
    if (abdomenFrame) {
      rig.babyAbdomenFrame = { ...abdomenFrame };
      rig.babyAbdomenScale = abdomenScale;
    } else {
      delete rig.babyAbdomenFrame;
      delete rig.babyAbdomenScale;
    }
    return rig; // Save/export flow already writes normalizedRig into the selected animal record.
  };

  const resolveBeforeCustom = resolveBabyPreviewFrame;
  resolveBabyPreviewFrame = function resolveGrowthHeadFrame() {
    if (customEnabled && customFrame) return { frame: customFrame, source: 'custom drawn head box' };
    return resolveBeforeCustom();
  };

  const captureBeforeRegions = captureHistoryState;
  captureHistoryState = function captureGrowthRegionHistory() {
    return { ...captureBeforeRegions(), babyHeadUseCustomFrame: customEnabled,
      babyHeadCustomFrame: customFrame && { ...customFrame }, babyAbdomenEnabled: abdomenEnabled,
      babyAbdomenFrame: abdomenFrame && { ...abdomenFrame }, babyAbdomenScale: abdomenScale };
  };
  const signatureBeforeRegions = historySignature;
  historySignature = function growthRegionHistorySignature(snapshot) {
    const signature = frame => frame ? [frame.x, frame.y, frame.width, frame.height]
      .map(value => Number(value).toFixed(6)).join(',') : 'none';
    return signatureBeforeRegions(snapshot) + '|custom=' + !!snapshot?.babyHeadUseCustomFrame
      + ':' + signature(snapshot?.babyHeadCustomFrame) + '|abdomen=' + !!snapshot?.babyAbdomenEnabled
      + ':' + signature(snapshot?.babyAbdomenFrame) + ':' + Number(snapshot?.babyAbdomenScale ?? 1.2).toFixed(3);
  };
  const restoreBeforeRegions = restoreHistoryState;
  restoreHistoryState = function restoreGrowthRegionHistory(snapshot) {
    if (snapshot) {
      customEnabled = snapshot.babyHeadUseCustomFrame === true;
      customFrame = safeFrame(snapshot.babyHeadCustomFrame);
      abdomenEnabled = snapshot.babyAbdomenEnabled === true;
      abdomenFrame = safeFrame(snapshot.babyAbdomenFrame);
      abdomenScale = clamp(numberOr(snapshot.babyAbdomenScale, 1.20), 1, warp?.MAX_ABDOMEN_SCALE ?? 1.8);
      activeBox = null;
      drawing = null;
      syncRegionControls();
    }
    return restoreBeforeRegions(snapshot); // Existing shoulder, head paint, and broad pose snapshots still restore normally.
  };

  function previewAbdomen() {
    return { enabled: abdomenEnabled && !!abdomenFrame, frame: abdomenFrame, scale: abdomenScale };
  }
  window.__animalRigGrowthRegions = Object.freeze({
    previewAbdomen, // Read once per editor rasterization; never called per triangle.
    debugSnapshot: () => ({
      customEnabled, customFrame, abdomenEnabled, abdomenFrame, abdomenScale,
      tool: activeBox, dragging: !!drawing, lastCopied,
    }),
  });

  function drawBoxGuide(fit, frame, color, title, active) {
    if (!frame || !state.image) return;
    const x = fit.x + frame.x * fit.width, y = fit.y + frame.y * fit.height;
    const w = frame.width * fit.width, h = frame.height * fit.height;
    paintCtx.save();
    paintCtx.strokeStyle = color;
    paintCtx.lineWidth = Math.max(2, (window.devicePixelRatio || 1) * (active ? 2 : 1));
    paintCtx.setLineDash(active ? [] : [5, 3]);
    paintCtx.strokeRect(x, y, w, h);
    paintCtx.setLineDash([]);
    paintCtx.font = 'bold ' + Math.max(11, 11 * (window.devicePixelRatio || 1)) + 'px system-ui';
    paintCtx.textAlign = 'left';
    paintCtx.fillStyle = color;
    paintCtx.fillText(title, x + 3, Math.max(14, y - 3));
    paintCtx.restore();
  }
  const guidesBeforeRegions = drawGuides;
  drawGuides = function drawGuidesWithGrowthRegions(fit) {
    guidesBeforeRegions(fit); // Preserve rig vertices, shoulder seam, weight paint, and native head-frame guide.
    if (customFrame) drawBoxGuide(fit, customFrame, '#77e3ff', 'Head growth', activeBox === 'head');
    if (abdomenFrame) drawBoxGuide(fit, abdomenFrame, '#ffab78', 'Abdomen growth', activeBox === 'abdomen');
    if (drawing) {
      const draft = draggedFrame(drawing.start, drawing.current);
      if (draft) drawBoxGuide(fit, draft, '#ffffff', 'Drawing ' + drawing.mode, true);
    }
  };

  function draggedFrame(start, end) {
    if (!start || !end) return null;
    const size = sourceSize();
    if (!size.width || !size.height) return null;
    const x0 = clamp(Math.min(start.x, end.x) / size.width, 0, 1);
    const y0 = clamp(Math.min(start.y, end.y) / size.height, 0, 1);
    const x1 = clamp(Math.max(start.x, end.x) / size.width, 0, 1);
    const y1 = clamp(Math.max(start.y, end.y) / size.height, 0, 1);
    if (x1 - x0 < .01 || y1 - y0 < .01) return null; // Ignore taps and micro-drags instead of corrupting saved regions.
    return safeFrame({ x: x0, y: y0, width: x1 - x0, height: y1 - y0,
      coordinateSpace: 'sprite-normalized-top-left' });
  }

  function chooseBox(mode) {
    if (!state.image) { setStatus('Load an animal sprite before drawing a growth box.', false); return; }
    activeBox = activeBox === mode ? null : mode; // Tap the same tool again to cancel.
    drawing = null;
    syncRegionControls();
    setStatus(activeBox ? 'Drag diagonally across the source sprite to select the ' + mode + ' growth rectangle.' :
      'Growth box tool canceled.', true);
    requestDraw();
  }
  drawHeadButton.addEventListener('click', () => chooseBox('head'));
  drawAbdomenButton.addEventListener('click', () => chooseBox('abdomen'));

  function consumeBoxEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation(); // Prevent the pointer from also painting Head/Shoulder or moving a spline control.
  }
  function onPointerDown(event) {
    if (!activeBox || event.target !== paintCanvas || drawing || (event.button != null && event.button !== 0)) return;
    const start = pointerToSource(event);
    if (!start) return;
    checkpointHistory(); // The entire drag creates exactly one undoable edit.
    drawing = { mode: activeBox, pointerId: event.pointerId, start, current: start };
    paintCanvas.setPointerCapture?.(event.pointerId);
    consumeBoxEvent(event);
    requestDraw();
  }
  function onPointerMove(event) {
    if (!drawing || event.pointerId !== drawing.pointerId) return;
    drawing.current = pointerToSource(event) || drawing.current;
    consumeBoxEvent(event);
    requestDraw(); // Live guide updates once per animation frame; texture only changes on release.
  }
  function finishPointer(event, cancelled) {
    if (!drawing || event.pointerId !== drawing.pointerId) return;
    if (!cancelled) drawing.current = pointerToSource(event) || drawing.current;
    const chosen = cancelled ? null : draggedFrame(drawing.start, drawing.current);
    const mode = drawing.mode;
    drawing = null;
    activeBox = null;
    paintCanvas.releasePointerCapture?.(event.pointerId);
    consumeBoxEvent(event);
    if (chosen) {
      if (mode === 'head') { customFrame = chosen; customEnabled = true; }
      else { abdomenFrame = chosen; abdomenEnabled = true; }
      comparingBabyOriginal = false;
      setStatus('Selected ' + mode + ' growth box (' + regionSummary(chosen) + '). Save the rig to use it in game.', true);
    } else {
      setStatus('No growth box changed. Drag at least 1% across both sprite dimensions.', !cancelled);
    }
    syncRegionControls();
    requestDraw();
  }
  // Capture on window, before the paint canvas' existing capture handlers, so box drags never modify rig paint.
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', event => finishPointer(event, false), true);
  window.addEventListener('pointercancel', event => finishPointer(event, true), true);

  customToggle.addEventListener('change', () => {
    checkpointHistory();
    customEnabled = !!customToggle.checked;
    syncRegionControls();
    if (customEnabled && !customFrame) setStatus('Select Draw head box, then drag over the sprite.', false);
    requestDraw();
  });
  abdomenToggle.addEventListener('change', () => {
    checkpointHistory();
    abdomenEnabled = !!abdomenToggle.checked;
    syncRegionControls();
    if (abdomenEnabled && !abdomenFrame) setStatus('Select Draw abdomen box, then drag over the sprite.', false);
    requestDraw();
  });
  abdomenSlider.addEventListener('pointerdown', () => checkpointHistory());
  abdomenSlider.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key))
      checkpointHistory();
  });
  abdomenSlider.addEventListener('input', () => {
    abdomenScale = clamp(numberOr(abdomenSlider.value, 120) / 100, 1, warp?.MAX_ABDOMEN_SCALE ?? 1.8);
    syncRegionControls();
    comparingBabyOriginal = false;
    requestDraw();
  });
  clearHeadButton.addEventListener('click', () => {
    checkpointHistory();
    customFrame = null; customEnabled = false;
    activeBox = null; drawing = null;
    syncRegionControls(); requestDraw();
    setStatus('Cleared the custom head box; automatic head selection is restored.', true);
  });
  clearAbdomenButton.addEventListener('click', () => {
    checkpointHistory();
    abdomenFrame = null; abdomenEnabled = false;
    activeBox = null; drawing = null;
    syncRegionControls(); requestDraw();
    setStatus('Cleared abdomen growth without changing the head or shoulder pose.', true);
  });

  function canonicalId(raw) {
    return String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  }
  function sourceShoulderRest(id) {
    const key = canonicalId(id);
    const stored = readPreviewRigs()?.[key]; // Per-species painter preview is the newest approved source in this browser.
    if (stored?.shoulderRest) return stored.shoulderRest;
    const matching = (state.selectRecords || []).find(record => canonicalId(record?.id) === key);
    if (matching?.headRig?.shoulderRest) return matching.headRig.shoulderRest;
    const committed = window.HobunjiAuthoredAnimalHeadRigs?.get?.(key)
      || window.CreatureGeneticsRender?.headRigForKind?.(key);
    return committed?.shoulderRest || null; // Never invent a pose for an unknown or unconfigured source species.
  }
  function populateCopySources() {
    const current = canonicalId($('animalId').value);
    const previous = copySpeciesSelect.value;
    const candidateNames = new Map(); // One dropdown entry per canonical species, not per alias or rig record.
    for (const key of shoulderProfileApi?.species || []) candidateNames.set(canonicalId(key), key);
    for (const record of state.selectRecords || []) {
      const id = canonicalId(record?.id);
      if (id && record?.headRig?.shoulderRest) candidateNames.set(id, record.label || record.name || id);
    }
    for (const [id, rig] of Object.entries(readPreviewRigs())) {
      if (rig?.shoulderRest) candidateNames.set(canonicalId(id), id);
    }
    copySpeciesSelect.innerHTML = '<option value="">Choose a species…</option>';
    for (const [id, label] of [...candidateNames].sort((a, b) => String(a[1]).localeCompare(String(b[1])))) {
      if (!id || id === current || !sourceShoulderRest(id)) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      copySpeciesSelect.appendChild(option);
    }
    copySpeciesSelect.value = [...copySpeciesSelect.options].some(option => option.value === previous) ? previous : '';
    copyShoulderButton.disabled = !copySpeciesSelect.value || !current;
  }

  const populateBeforeCopy = populateAnimalSelect;
  populateAnimalSelect = function populateSpeciesWithCopySources(records, indexes = null) {
    const result = populateBeforeCopy(records, indexes);
    populateCopySources();
    return result;
  };
  $('animalId').addEventListener('input', populateCopySources);
  copySpeciesSelect.addEventListener('change', () => { copyShoulderButton.disabled = !copySpeciesSelect.value || !canonicalId($('animalId').value); });

  copyShoulderButton.addEventListener('click', () => {
    const id = canonicalId(copySpeciesSelect.value);
    const target = canonicalId($('animalId').value);
    if (!target || !id || target === id) {
      copyShoulderStatus.textContent = 'Select a different source species and a current destination first.';
      setStatus(copyShoulderStatus.textContent, false);
      return;
    }
    const source = sourceShoulderRest(id);
    if (!source) {
      copyShoulderStatus.textContent = 'No authored shoulder pose exists for ' + id + '.';
      setStatus(copyShoulderStatus.textContent, false);
      return;
    }
    checkpointHistory();
    applyShoulderRestConfig(deepClone(source)); // Copies every shoulder checkbox, shift, separator, curves, and painted material map.
    updateShoulderUi(); // Existing importer also clears stale split textures and resets editor-only broad macros.
    lastCopied = { from: id, to: target, splineAllowed: splineAllowedForCurrentSpecies() };
    const limitation = source.useSpline && !lastCopied.splineAllowed
      ? ' Body spline is not enabled for this target species; other settings were copied.' : '';
    copyShoulderStatus.textContent = 'Copied complete shoulder pose: ' + id + ' → ' + target
      + '. Undo is available. Save the rig for game preview or export the animal record.' + limitation;
    setStatus(copyShoulderStatus.textContent, true);
    requestDraw();
  });

  syncRegionControls();
  populateCopySources();
})();

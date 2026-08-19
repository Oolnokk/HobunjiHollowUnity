// Pose-local 3D elbow target authoring for the experimental PNG bicep rig.
// Values are avatar-local fractions of portrait height and are exported on each pose.
(function (global) {
  'use strict';

  const runtime = global.HobunjiHandElbowPoseRuntime;
  const settings = global.HobunjiHandExperimentalRigSettings;
  const jsonView = document.getElementById('jsonView');
  const presetSelect = document.getElementById('presetSelect');
  const presetButton = document.getElementById('loadPresetBtn');
  const loadFile = document.getElementById('loadFile');
  if (!runtime || !jsonView || global.HobunjiAttackEditorElbowControls) return;

  const PHASES = ['neutral', 'windup', 'strike'];
  const SIDES = ['right', 'left'];
  const AXES = ['x', 'y', 'z'];
  const defaults = runtime.defaults;
  const cache = new Map();
  let activeKey = 'draft:new-attack';
  let poseElbows = defaultPoseSet();

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function defaultPoseSet() {
    return Object.fromEntries(PHASES.map(phase => [phase, {
      right: { ...defaults.right },
      left: { ...defaults.left },
    }]));
  }
  function normalizePoint(raw, side) {
    const fallback = defaults[side];
    return {
      x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : fallback.x,
      y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : fallback.y,
      z: Number.isFinite(Number(raw?.z)) ? Number(raw.z) : fallback.z,
    };
  }
  function fromAnimation(data) {
    const next = defaultPoseSet();
    for (const phase of PHASES) {
      for (const side of SIDES) {
        next[phase][side] = normalizePoint(data?.poses?.[phase]?.elbowTarget?.[side] || data?.poses?.[phase]?.elbow?.[side], side);
      }
    }
    return next;
  }

  function controlId(phase, side, axis) { return `handElbow_${phase}_${side}_${axis}`; }
  function makeField(phase, side, axis) {
    const label = axis.toUpperCase();
    return `<div class="field" style="margin-bottom:5px"><label>${label} <span id="${controlId(phase, side, axis)}_v"></span></label><div class="fieldRow">
      <input id="${controlId(phase, side, axis)}" type="range" min="-75" max="75" step="0.5">
      <input id="${controlId(phase, side, axis)}_n" type="number" min="-200" max="200" step="0.5" style="width:72px;flex:0 0 72px">
    </div></div>`;
  }

  for (const phase of PHASES) {
    const panel = document.getElementById(`panel${phase[0].toUpperCase()}${phase.slice(1)}`);
    const poseGroup = panel?.closest('.poseGroup');
    if (!poseGroup || poseGroup.querySelector(`[data-hand-elbow-phase="${phase}"]`)) continue;
    const box = document.createElement('div');
    box.dataset.handElbowPhase = phase;
    box.style.cssText = 'margin-top:8px;padding:7px;border:1px solid rgba(244,114,182,.25);border-radius:8px;background:rgba(244,114,182,.045)';
    box.innerHTML = `
      <div class="help" style="margin-bottom:6px"><b>3D elbow target — ${phase}</b> · % avatar height in avatar-local X/Y/Z</div>
      ${SIDES.map(side => `<div style="margin:5px 0 7px"><div class="help" style="font-weight:700">${side === 'right' ? 'Right' : 'Left'} elbow</div>${AXES.map(axis => makeField(phase, side, axis)).join('')}</div>`).join('')}
    `;
    const scrub = poseGroup.querySelector('button');
    poseGroup.insertBefore(box, scrub || null);
  }

  function setPaired(phase, side, axis, value) {
    const percent = (Number(value) || 0) * 100;
    const range = document.getElementById(controlId(phase, side, axis));
    const number = document.getElementById(`${controlId(phase, side, axis)}_n`);
    const readout = document.getElementById(`${controlId(phase, side, axis)}_v`);
    if (range) range.value = Math.max(Number(range.min), Math.min(Number(range.max), percent));
    if (number) number.value = percent;
    if (readout) readout.textContent = `${percent.toFixed(1)}%`;
  }

  function syncFields() {
    for (const phase of PHASES) for (const side of SIDES) for (const axis of AXES) {
      setPaired(phase, side, axis, poseElbows[phase][side][axis]);
    }
    syncVisibility();
  }

  function inject(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    if (!parsed.poses || typeof parsed.poses !== 'object') parsed.poses = {};
    for (const phase of PHASES) {
      if (!parsed.poses[phase] || typeof parsed.poses[phase] !== 'object') parsed.poses[phase] = {};
      parsed.poses[phase].elbowTarget = clone(poseElbows[phase]);
    }
    return parsed;
  }
  function jsonWithElbows(raw) {
    try { return JSON.stringify(inject(JSON.parse(String(raw || ''))), null, 2); }
    catch (_) { return raw; }
  }

  const previousValueDescriptor = Object.getOwnPropertyDescriptor(jsonView, 'value')
    || Object.getOwnPropertyDescriptor(global.HTMLTextAreaElement?.prototype || {}, 'value');
  if (previousValueDescriptor?.get && previousValueDescriptor?.set && !jsonView.__hobunjiElbowValueWrapped) {
    Object.defineProperty(jsonView, 'value', {
      configurable: true,
      enumerable: true,
      get() { return previousValueDescriptor.get.call(this); },
      set(value) { previousValueDescriptor.set.call(this, jsonWithElbows(value)); },
    });
    Object.defineProperty(jsonView, '__hobunjiElbowValueWrapped', { value: true, configurable: true });
  }

  function refreshJson() {
    try { jsonView.value = jsonView.value; } catch (_) {}
  }
  function refreshRig() {
    global.ProceduralHandTwoBoneSkin?.refreshAll?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
    requestAnimationFrame(() => global.ProceduralHandFrameDriver?.syncNow?.());
  }

  for (const phase of PHASES) for (const side of SIDES) for (const axis of AXES) {
    const range = document.getElementById(controlId(phase, side, axis));
    const number = document.getElementById(`${controlId(phase, side, axis)}_n`);
    const apply = source => {
      const percent = Number(source?.value);
      if (!Number.isFinite(percent)) return;
      poseElbows[phase][side][axis] = percent / 100;
      setPaired(phase, side, axis, poseElbows[phase][side][axis]);
      cache.set(activeKey, clone(poseElbows));
      refreshJson();
      refreshRig();
    };
    range?.addEventListener('input', () => apply(range));
    number?.addEventListener('input', () => apply(number));
  }

  function progressFromTimeline() {
    const marker = document.getElementById('timelineMarker');
    const raw = parseFloat(marker?.style?.left || '0');
    return Math.max(0, Math.min(1, Number.isFinite(raw) ? raw / 100 : Number(document.getElementById('scrub')?.value) || 0));
  }
  function currentElbowNormalized(side) {
    const timing = {
      windupFrac: Number(document.getElementById('windupFrac')?.value) || 0.16,
      strikeFrac: Number(document.getElementById('strikeFrac')?.value) || 0.55,
      holdFrac: Number(document.getElementById('holdFrac')?.value) || 0.68,
    };
    const sequence = document.getElementById('playbackSequence')?.value || 'attack';
    const raw = Object.fromEntries(PHASES.map(phase => [phase, { elbowTarget: poseElbows[phase] }]));
    return runtime.pointAt(progressFromTimeline(), timing, raw, sequence, side);
  }

  function switchKey(key, next) {
    cache.set(activeKey, clone(poseElbows));
    activeKey = key;
    poseElbows = clone(cache.get(activeKey) || next || defaultPoseSet());
    cache.set(activeKey, clone(poseElbows));
    syncFields();
    refreshJson();
    refreshRig();
  }

  presetButton?.addEventListener('click', () => {
    const key = `preset:${presetSelect?.value || 'unknown'}`;
    switchKey(key, defaultPoseSet());
  }, true);

  loadFile?.addEventListener('change', async () => {
    const file = loadFile.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      switchKey(`file:${file.name}`, fromAnimation(parsed));
    } catch (_) {
      switchKey(`file:${file.name}`, defaultPoseSet());
    }
  }, true);

  function syncVisibility() {
    const enabled = settings?.bicepElbowTracking === true;
    for (const box of document.querySelectorAll('[data-hand-elbow-phase]')) {
      box.style.display = enabled ? '' : 'none';
    }
  }
  settings?.subscribe?.(() => { syncVisibility(); refreshRig(); });

  cache.set(activeKey, clone(poseElbows));
  syncFields();
  refreshJson();

  global.HobunjiAttackEditorElbowControls = Object.freeze({
    currentElbowNormalized,
    syncFields,
    syncVisibility,
    get poseElbows() { return clone(poseElbows); },
  });
})(window);

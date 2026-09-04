(() => {
'use strict';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'hobunji_portrait_arm_mask_profiles_v2';
const DEFAULTS = Object.freeze({
  maskYScaleMultiplier: 0.60,
  axOffset: 0.12,
  cutThreshold: 0.50,
  wobbleStrength: 0.16,
  wobbleScale: 1.00,
  outlineWidth: 2,
  seed: 28480,
});
const state = { fighters: [], fighter: null, rendering: false, rerenderQueued: false };
const canvas = $('preview');
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeKeyPart(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/\s+/g, '-');
}
function profileKey(fighter = state.fighter) {
  return `${normalizeKeyPart(fighter?.speciesId || fighter?.id)}:${normalizeKeyPart(fighter?.gender)}`;
}
function ensureMaskConfig() {
  window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {};
  const game = window.SCRATCHBONES_CONFIG.game = window.SCRATCHBONES_CONFIG.game || {};
  const portrait = game.portrait = game.portrait || {};
  const cfg = portrait.armOnlyOpacityMask = portrait.armOnlyOpacityMask || {};
  cfg.profiles = cfg.profiles || {};
  return cfg;
}
function fallbackSettings() {
  const cfg = ensureMaskConfig();
  return {
    maskYScaleMultiplier: finite(cfg.maskYScaleMultiplier, DEFAULTS.maskYScaleMultiplier),
    axOffset: finite(cfg.axOffset, DEFAULTS.axOffset),
    cutThreshold: finite(cfg.cutThreshold, DEFAULTS.cutThreshold),
    wobbleStrength: finite(cfg.wobbleStrength, DEFAULTS.wobbleStrength),
    wobbleScale: finite(cfg.wobbleScale, DEFAULTS.wobbleScale),
    outlineWidth: Math.round(finite(cfg.outlineWidth, DEFAULTS.outlineWidth)),
    seed: Math.round(finite(cfg.seed, DEFAULTS.seed)),
  };
}
function settingsFor(fighter = state.fighter) {
  const cfg = ensureMaskConfig();
  return { ...fallbackSettings(), ...(cfg.profiles?.[profileKey(fighter)] || {}) };
}
function controlsToSettings() {
  return {
    maskYScaleMultiplier: finite($('scale').value, DEFAULTS.maskYScaleMultiplier),
    axOffset: finite($('offset').value, DEFAULTS.axOffset),
    cutThreshold: finite($('threshold').value, DEFAULTS.cutThreshold),
    wobbleStrength: finite($('wobble').value, DEFAULTS.wobbleStrength),
    wobbleScale: finite($('wobbleScale').value, DEFAULTS.wobbleScale),
    outlineWidth: Math.round(finite($('outline').value, DEFAULTS.outlineWidth)),
    seed: Math.max(1, Math.round(finite($('seed').value, DEFAULTS.seed))),
  };
}
function loadSettingsIntoControls(settings) {
  $('scale').value = String(settings.maskYScaleMultiplier);
  $('offset').value = String(settings.axOffset);
  $('threshold').value = String(settings.cutThreshold);
  $('wobble').value = String(settings.wobbleStrength);
  $('wobbleScale').value = String(settings.wobbleScale);
  $('outline').value = String(settings.outlineWidth);
  $('seed').value = String(settings.seed);
  syncLabels();
}
function syncLabels() {
  $('scaleLabel').textContent = `${finite($('scale').value, .6).toFixed(2)}×`;
  $('offsetLabel').textContent = finite($('offset').value, .12).toFixed(3);
  $('thresholdLabel').textContent = finite($('threshold').value, .5).toFixed(2);
  $('wobbleLabel').textContent = finite($('wobble').value, .16).toFixed(2);
  $('wobbleScaleLabel').textContent = `${finite($('wobbleScale').value, 1).toFixed(2)}×`;
  $('outlineLabel').textContent = `${Math.round(finite($('outline').value, 2))} px`;
  $('profileKey').textContent = profileKey();
}
function persistProfiles() {
  try {
    const profiles = ensureMaskConfig().profiles || {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (_) {}
}
function restoreProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      Object.assign(ensureMaskConfig().profiles, raw);
    }
  } catch (_) {}
}
function storeCurrentProfile() {
  if (!state.fighter) return;
  ensureMaskConfig().profiles[profileKey()] = controlsToSettings();
  persistProfiles();
  syncLabels();
  syncOutput();
}
function exportObject() {
  const cfg = ensureMaskConfig();
  return {
    schema: 'hobunji_portrait_arm_mask.v2',
    armOnlyOpacityMask: {
      ...fallbackSettings(),
      profiles: JSON.parse(JSON.stringify(cfg.profiles || {})),
    },
  };
}
function syncOutput() {
  $('output').value = JSON.stringify(exportObject(), null, 2);
  $('profileCount').textContent = `${Object.keys(ensureMaskConfig().profiles || {}).length} authored profile${Object.keys(ensureMaskConfig().profiles || {}).length === 1 ? '' : 's'}`;
}
function status(message, kind = '') {
  const node = $('status');
  node.textContent = message;
  node.className = `status ${kind}`;
}
function buildProfile() {
  return {
    fighter: state.fighter,
    bodyColors: {}, hair: null, hairFront: null, hairBack: null, hairSide: null, hairSideL: null,
    hood: null, eyes: null, upperFace: null, facialHair: null, pauldron: null, hat: null,
    torsoCosmetic: null, armCosmetic: null,
  };
}
async function render() {
  if (!state.fighter || !window.NpcAvatarPreview?.renderProfileToCanvas) return;
  if (state.rendering) { state.rerenderQueued = true; return; }
  state.rendering = true;
  try {
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ok = await window.NpcAvatarPreview.renderProfileToCanvas(canvas, buildProfile(), {
      forceEyesOpen: true,
      portraitView: 'front',
    });
    if (!ok) throw new Error('Portrait renderer returned false.');
    $('badge').textContent = `${state.fighter.label || state.fighter.id} · hard cut + black cap`;
    status('Rendered through the real portrait pipeline. The cloud fade is now thresholded into a verdigris-style wobbly hard cut, and the exposed arm edge is capped in black.', 'good');
  } catch (error) {
    status(`Preview failed: ${error?.message || error}`, 'warn');
  } finally {
    state.rendering = false;
    if (state.rerenderQueued) { state.rerenderQueued = false; render(); }
  }
}
function populateFighters() {
  const select = $('fighter');
  select.innerHTML = '';
  state.fighters = (window.getPortraitFighters?.() || [])
    .filter(fighter => Array.isArray(fighter?.bodyLayers) && fighter.bodyLayers.some(layer => /arm[lr]/i.test(String(layer?.id || ''))));
  for (const fighter of state.fighters) {
    const option = document.createElement('option');
    option.value = fighter.id;
    option.textContent = `${fighter.label || fighter.id} — ${fighter.speciesId || '?'} / ${fighter.gender || '?'}`;
    select.appendChild(option);
  }
  state.fighter = state.fighters[0] || null;
  if (state.fighter) select.value = state.fighter.id;
}
function switchFighter() {
  state.fighter = state.fighters.find(fighter => fighter.id === $('fighter').value) || state.fighters[0] || null;
  loadSettingsIntoControls(settingsFor());
  syncOutput();
  render();
}
function wire() {
  $('fighter').addEventListener('change', switchFighter);
  for (const id of ['scale', 'offset', 'threshold', 'wobble', 'wobbleScale', 'outline', 'seed']) {
    $(id).addEventListener('input', () => {
      storeCurrentProfile();
      render();
    });
  }
  $('reroll').addEventListener('click', () => {
    $('seed').value = String(1 + Math.floor(Math.random() * 999999999));
    storeCurrentProfile();
    render();
  });
  $('reset').addEventListener('click', () => {
    if (!state.fighter) return;
    delete ensureMaskConfig().profiles[profileKey()];
    persistProfiles();
    loadSettingsIntoControls(fallbackSettings());
    syncOutput();
    render();
  });
  $('refresh').addEventListener('click', render);
  $('copy').addEventListener('click', async () => {
    const text = JSON.stringify(exportObject(), null, 2);
    try { await navigator.clipboard.writeText(text); status('All species/gender arm-mask settings copied.', 'good'); }
    catch (_) { status('Clipboard unavailable; the JSON remains in the output box.', 'warn'); }
  });
  $('download').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(exportObject(), null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'portrait-arm-mask-profiles.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
  });
}
async function boot() {
  try {
    window.setPortraitAssetBase?.('../../assets/');
    if (typeof window.loadPortraitCosmetics === 'function') await window.loadPortraitCosmetics('../../config/');
    restoreProfiles();
    populateFighters();
    if (!state.fighters.length) { status('No portrait fighters with authored arm layers were found.', 'warn'); return; }
    wire();
    loadSettingsIntoControls(settingsFor());
    syncOutput();
    await render();
  } catch (error) {
    status(`Editor startup failed: ${error?.message || error}`, 'warn');
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
})();

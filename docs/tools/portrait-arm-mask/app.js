(() => {
'use strict';

const $ = id => document.getElementById(id);
const state = { fighters: [], fighter: null, rendering: false, rerenderQueued: false };
const canvas = $('preview');

function finite(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function ensureMaskConfig() {
  window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {};
  const game = window.SCRATCHBONES_CONFIG.game = window.SCRATCHBONES_CONFIG.game || {};
  const portrait = game.portrait = game.portrait || {};
  return portrait.armOnlyOpacityMask = portrait.armOnlyOpacityMask || {};
}

function syncLabels() {
  $('scaleLabel').textContent = `${finite($('scale').value, 0.60).toFixed(2)}×`;
  $('offsetLabel').textContent = finite($('offset').value, 0.12).toFixed(3);
}

function exportObject() {
  return {
    schema: 'hobunji_portrait_arm_mask.v1',
    armOnlyOpacityMask: {
      maskYScaleMultiplier: finite($('scale').value, 0.60),
      axOffset: finite($('offset').value, 0.12),
    },
  };
}

function syncOutput() {
  $('output').value = JSON.stringify(exportObject(), null, 2);
}

function applyControlsToConfig() {
  const cfg = ensureMaskConfig();
  cfg.maskYScaleMultiplier = finite($('scale').value, 0.60);
  cfg.axOffset = finite($('offset').value, 0.12);
  syncLabels();
  syncOutput();
}

function status(message, kind = '') {
  const node = $('status');
  node.textContent = message;
  node.className = `status ${kind}`;
}

function buildProfile() {
  return {
    fighter: state.fighter,
    bodyColors: {},
    hair: null,
    hairFront: null,
    hairBack: null,
    hairSide: null,
    hairSideL: null,
    hood: null,
    eyes: null,
    upperFace: null,
    facialHair: null,
    pauldron: null,
    hat: null,
    torsoCosmetic: null,
    armCosmetic: null,
  };
}

async function render() {
  if (!state.fighter || !window.NpcAvatarPreview?.renderProfileToCanvas) return;
  if (state.rendering) {
    state.rerenderQueued = true;
    return;
  }
  state.rendering = true;
  try {
    applyControlsToConfig();
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ok = await window.NpcAvatarPreview.renderProfileToCanvas(canvas, buildProfile(), {
      forceEyesOpen: true,
      portraitView: 'front',
    });
    if (!ok) throw new Error('Portrait renderer returned false.');
    $('badge').textContent = `${state.fighter.label || state.fighter.id} · arm-mask draw clip`;
    status(
      'Rendered through the game portrait pipeline. The higher mask is clipped into each authored arm sprite before composition, so overlapping torso/clothing pixels remain intact.',
      'good'
    );
  } catch (error) {
    status(`Preview failed: ${error?.message || error}`, 'warn');
  } finally {
    state.rendering = false;
    if (state.rerenderQueued) {
      state.rerenderQueued = false;
      render();
    }
  }
}

function populateFighters() {
  const select = $('fighter');
  select.innerHTML = '';
  state.fighters = (window.getPortraitFighters?.() || [])
    .filter(fighter => Array.isArray(fighter?.bodyLayers)
      && fighter.bodyLayers.some(layer => /arm[lr]/i.test(String(layer?.id || ''))));
  for (const fighter of state.fighters) {
    const option = document.createElement('option');
    option.value = fighter.id;
    option.textContent = `${fighter.label || fighter.id} — ${fighter.speciesId || '?'} / ${fighter.gender || '?'}`;
    select.appendChild(option);
  }
  state.fighter = state.fighters[0] || null;
  if (state.fighter) select.value = state.fighter.id;
}

function wire() {
  $('fighter').addEventListener('change', () => {
    state.fighter = state.fighters.find(fighter => fighter.id === $('fighter').value) || state.fighters[0] || null;
    render();
  });
  for (const id of ['scale', 'offset']) {
    $(id).addEventListener('input', () => {
      applyControlsToConfig();
      render();
    });
  }
  $('reset').addEventListener('click', () => {
    $('scale').value = '0.60';
    $('offset').value = '0.12';
    render();
  });
  $('refresh').addEventListener('click', render);
  $('copy').addEventListener('click', async () => {
    const text = JSON.stringify(exportObject(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      status('Config JSON copied.', 'good');
    } catch (_) {
      status('Clipboard unavailable; the JSON remains in the output box.', 'warn');
    }
  });
  $('download').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(exportObject(), null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'portrait-arm-mask.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
  });
}

async function boot() {
  try {
    window.setPortraitAssetBase?.('../../assets/');
    if (typeof window.loadPortraitCosmetics === 'function') {
      await window.loadPortraitCosmetics('../../config/');
    }
    populateFighters();
    if (!state.fighters.length) {
      status('No portrait fighters with authored arm layers were found.', 'warn');
      return;
    }
    const maskApi = window.PortraitArmCloudMask;
    $('scale').value = String(maskApi?.configuredArmMaskYScaleMultiplier ?? 0.60);
    $('offset').value = String(maskApi?.configuredAxOffset ?? 0.12);
    wire();
    applyControlsToConfig();
    await render();
  } catch (error) {
    status(`Editor startup failed: ${error?.message || error}`, 'warn');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
})();

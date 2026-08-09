// World-space combat and reward text, adapted from HobunjiAmbientDialoguePreviewV2.
// Float+ is used for damage/healing; the centered five-row list is used for
// progression, favor, currency, and loot. Chathead Yap remains in the stored
// reference prototype for a later ambient-dialogue integration.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunjiWorldPopupSettings.v1';
  const DEFAULTS = {
    assignments: {
      damage: 'floatPlus', healing: 'floatPlus', skillXp: 'centeredFiveRow',
      masteryXp: 'centeredFiveRow', favor: 'centeredFiveRow',
      currency: 'centeredFiveRow', loot: 'centeredFiveRow',
    },
    floatPlus: { textHeight: 0.075, lifetimeMs: 1150, maxRadius: 0.24 },
    centeredFiveRow: { textHeight: 0.065, lifetimeMs: 1500, horizontalOffset: 0.08, rowSpacing: 1.08, maxRows: 5 },
    colors: {
      damage: '#fff4e2', healing: '#71f59a', skillXp: '#9de7ff',
      masteryXp: '#78cfff', favor: '#ff9fd7', currency: '#ffe181', loot: '#ffffff',
    },
  };
  const PRIORITY = { skillXp: 0, masteryXp: 1, favor: 2, currency: 3, loot: 4 };
  const state = { deps: null, settings: DEFAULTS, active: [], sequence: 0, pending: [], flushQueued: false };

  const clone = value => JSON.parse(JSON.stringify(value));
  const merge = (base, extra) => {
    const out = clone(base);
    for (const [key, value] of Object.entries(extra || {})) {
      out[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(out[key] || {}), ...value }
        : value;
    }
    return out;
  };

  async function loadSettings() {
    let authored = {};
    try {
      const response = await fetch('config/ui/world-popup-settings.json');
      if (response.ok) authored = await response.json();
    } catch (_) {}
    let local = {};
    try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) {}
    state.settings = merge(merge(DEFAULTS, authored), local);
    return state.settings;
  }

  function avatarCentroidWorld(root) {
    const THREE = state.deps?.THREE;
    if (!THREE || !root) return null;
    let avatarRoot = null;
    root.traverse?.(child => {
      if (!avatarRoot && Number.isFinite(child.userData?.portraitModelHeight)) avatarRoot = child;
    });
    if (avatarRoot) {
      const center = new THREE.Vector3();
      avatarRoot.updateWorldMatrix(true, false);
      avatarRoot.getWorldPosition(center);
      const height = avatarRoot.userData.portraitModelHeight;
      const placementRatio = avatarRoot.userData.portraitVerticalPlacementRatio ?? 0.5;
      center.y += (placementRatio - 0.5) * height;
      return center;
    }
    const center = new THREE.Vector3();
    root.updateWorldMatrix?.(true, false);
    root.getWorldPosition?.(center);
    return center;
  }

  function makePlane(text, kind, layout) {
    const THREE = state.deps.THREE;
    const size = layout.textHeight;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontPx = 64;
    ctx.font = `800 ${fontPx}px system-ui, sans-serif`;
    const width = Math.ceil(ctx.measureText(text).width + 28);
    canvas.width = Math.max(64, width);
    canvas.height = 92;
    ctx.font = `800 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(15,10,8,.9)';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = state.settings.colors[kind] || '#fff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const aspect = canvas.width / canvas.height;
    const geometry = new THREE.PlaneGeometry(aspect, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(geometry, material);
    plane.scale.setScalar(size);
    plane.renderOrder = 1200;
    plane.frustumCulled = false;
    plane.userData.isBillboard = true;
    return { plane, geometry, material, texture, width: aspect * size, height: size };
  }

  function dispose(event) {
    event.plane.parent?.remove(event.plane);
    event.geometry.dispose();
    event.material.dispose();
    event.texture.dispose();
  }

  function listFor(root) {
    return state.active
      .filter(event => event.root === root && event.mode === 'centeredFiveRow')
      .sort((a, b) => (PRIORITY[a.kind] ?? 99) - (PRIORITY[b.kind] ?? 99) || a.sequence - b.sequence);
  }

  function claimFloatOffset(root, bounds) {
    const cfg = state.settings.floatPlus;
    const existing = state.active.filter(event => event.root === root && event.mode === 'floatPlus');
    for (let index = 0; index < 240; index++) {
      const angle = index * 2.399963229728653;
      const radius = cfg.maxRadius * Math.sqrt(index / 239);
      const point = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.62 };
      const free = existing.every(event => Math.abs(point.x - event.offsetX) > (bounds.width + event.width) * 0.48 || Math.abs(point.y - event.offsetY) > (bounds.height + event.height) * 0.55);
      if (free) return point;
    }
    return { x: 0, y: 0 };
  }

  function spawn(entry) {
    const mode = state.settings.assignments[entry.kind];
    if (!state.deps || !entry.root || (mode !== 'floatPlus' && mode !== 'centeredFiveRow')) return null;
    const cfg = state.settings[mode];
    const parts = makePlane(entry.text, entry.kind, cfg);
    const event = { ...entry, ...parts, mode, sequence: state.sequence++, startedAt: performance.now(), lifetimeMs: cfg.lifetimeMs, listSlot: -1, offsetX: 0, offsetY: 0 };
    if (mode === 'centeredFiveRow') {
      const list = listFor(entry.root);
      if (list.length >= cfg.maxRows) {
        const oldest = list.reduce((candidate, item) => item.sequence < candidate.sequence ? item : candidate, list[0]);
        dispose(oldest);
        state.active.splice(state.active.indexOf(oldest), 1);
      }
      listFor(entry.root).forEach((item, index) => { item.listSlot = index; });
      event.listSlot = listFor(entry.root).length;
    } else {
      const offset = claimFloatOffset(entry.root, parts);
      event.offsetX = offset.x;
      event.offsetY = offset.y;
    }
    (entry.scene || state.deps.getActiveScene()).add(event.plane);
    state.active.push(event);
    return event.sequence;
  }

  function queueReward(kind, text, options = {}) {
    state.pending.push({ kind, text: String(text), root: options.root || state.deps?.playerRoot, scene: options.scene });
    if (state.flushQueued) return;
    state.flushQueued = true;
    queueMicrotask(() => {
      state.flushQueued = false;
      const batch = state.pending.splice(0).sort((a, b) => (PRIORITY[a.kind] ?? 99) - (PRIORITY[b.kind] ?? 99));
      batch.forEach(spawn);
    });
  }

  function showChange(kind, amount, options = {}) {
    const value = Math.round(Math.abs(Number(amount) || 0) * 10) / 10;
    if (!value) return null;
    const sign = Number(amount) >= 0 ? '+' : '-';
    const text = options.text || `${sign}${value}`;
    if (kind === 'damage' || kind === 'healing') return spawn({ kind, text, root: options.root || state.deps?.playerRoot, scene: options.scene });
    queueReward(kind, text, options);
    return state.sequence;
  }

  function update(now) {
    const camera = state.deps?.camera;
    if (!camera) return;
    const cameraRight = new state.deps.THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    for (let index = state.active.length - 1; index >= 0; index--) {
      const event = state.active[index];
      const progress = Math.max(0, Math.min(1, (now - event.startedAt) / event.lifetimeMs));
      const center = avatarCentroidWorld(event.root);
      if (!center || progress >= 1) {
        dispose(event);
        state.active.splice(index, 1);
        continue;
      }
      if (event.mode === 'floatPlus') {
        center.addScaledVector(cameraRight, event.offsetX + Math.sin(progress * Math.PI) * event.height * 0.12);
        center.y += event.offsetY + 0.075 * (1 - Math.pow(1 - progress, 2));
      } else {
        const list = listFor(event.root);
        list.forEach((item, slot) => { item.listSlot = slot; });
        const centerSlot = (state.settings.centeredFiveRow.maxRows - 1) * 0.5;
        center.addScaledVector(cameraRight, state.settings.centeredFiveRow.horizontalOffset);
        center.y += (centerSlot - event.listSlot) * event.height * state.settings.centeredFiveRow.rowSpacing;
      }
      event.plane.position.copy(center);
      event.plane.quaternion.copy(camera.quaternion);
      event.material.opacity = progress < 0.72 ? 1 : (1 - progress) / 0.28;
      const pop = event.kind === 'damage' ? 1.1 - 0.1 * Math.min(1, progress / 0.24) : 1;
      event.plane.scale.setScalar((event.mode === 'floatPlus' ? state.settings.floatPlus.textHeight : state.settings.centeredFiveRow.textHeight) * pop);
    }
  }

  function init(deps) {
    state.deps = deps;
    loadSettings();
    return api;
  }

  const api = { init, update, showChange, queueReward, avatarCentroidWorld, loadSettings, defaults: clone(DEFAULTS), storageKey: STORAGE_KEY };
  window.WorldPopupText = api;
})();

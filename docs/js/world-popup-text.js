// World-space combat and reward text, adapted from HobunjiAmbientDialoguePreviewV2.
// Float+ is used for damage/healing; the centered five-row list is used for
// progression, favor, currency, and loot. Chathead Yap remains in the stored
// reference prototype for a later ambient-dialogue integration.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunjiWorldPopupSettings.v1';
  const POPUP_FONT_FAMILY = "'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace"; // Used for popup measurement and canvas rendering.
  const DEFAULTS = {
    assignments: {
      damage: 'floatPlus', healing: 'floatPlus', skillXp: 'centeredFiveRow',
      masteryXp: 'centeredFiveRow', favor: 'centeredFiveRow',
      currency: 'centeredFiveRow', loot: 'centeredFiveRow', interaction: 'centeredFiveRow',
    },
    floatPlus: { worldHeight: 0.36, xOffsetPercent: 10, yOffsetPercent: 13, lifetimeMs: 1150 },
    centeredFiveRow: { worldHeight: 0.32, xOffsetPercent: 40, yOffsetPercent: -4, lifetimeMs: 3200, rowSpacing: 1.08, maxRows: 5, textAlign: 'left' },
    colors: {
      damage: '#fff4e2', healing: '#71f59a', skillXp: '#9de7ff',
      masteryXp: '#78cfff', favor: '#ff9fd7', currency: '#ffe181', loot: '#ffffff', interaction: '#ffffff',
    },
  };
  const PRIORITY = { skillXp: 0, masteryXp: 1, favor: 2, currency: 3, loot: 4 };
  const state = { deps: null, settings: DEFAULTS, active: [], sequence: 0, pending: [], flushQueued: false, interactionSignature: '' };

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

  function normalizeSettings(value) {
    const normalized = merge(DEFAULTS, value);
    // Migrates settings saved by the first editor, when both modes shared
    // one placement object. Float+ intentionally keeps its centroid X=0.
    if (value?.placement) {
      normalized.floatPlus.worldHeight = value.placement.worldHeight ?? normalized.floatPlus.worldHeight;
      normalized.floatPlus.yOffsetPercent = value.placement.yOffsetPercent ?? normalized.floatPlus.yOffsetPercent;
      normalized.centeredFiveRow.worldHeight = value.placement.worldHeight ?? normalized.centeredFiveRow.worldHeight;
      normalized.centeredFiveRow.xOffsetPercent = value.placement.xOffsetPercent ?? normalized.centeredFiveRow.xOffsetPercent;
      normalized.centeredFiveRow.yOffsetPercent = value.placement.yOffsetPercent ?? normalized.centeredFiveRow.yOffsetPercent;
      delete normalized.placement;
    }
    return normalized;
  }

  async function loadSettings() {
    let authored = {};
    try {
      const response = await fetch('config/ui/world-popup-settings.json');
      if (response.ok) authored = await response.json();
    } catch (_) {}
    let local = {};
    try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) {}
    state.settings = normalizeSettings(merge(authored, local));
    return state.settings;
  }

  // Interaction prompts sit in state.active with lifetimeMs: Infinity for as
  // long as the player stands near their target, so avatarMetrics() runs
  // every frame for that root the whole time — cache the resolved avatar
  // child (once actually found) instead of re-walking the subtree each
  // call. Checked for .parent on reuse so a torn-down/re-skinned avatar
  // (detached from the scene graph) is detected and re-resolved rather than
  // silently reused stale.
  const _avatarRootCache = new WeakMap();
  function avatarMetrics(root) {
    const THREE = state.deps?.THREE;
    if (!THREE || !root) return null;
    let avatarRoot = _avatarRootCache.get(root) || null;
    if (avatarRoot && !avatarRoot.parent) avatarRoot = null;
    if (!avatarRoot) {
      root.traverse?.(child => {
        if (!avatarRoot && Number.isFinite(child.userData?.portraitModelHeight)) avatarRoot = child;
      });
      if (avatarRoot) _avatarRootCache.set(root, avatarRoot);
      else _avatarRootCache.delete(root);
    }
    if (avatarRoot) {
      const height = Number(avatarRoot.userData.portraitModelHeight);
      const width = Number(avatarRoot.userData.portraitModelWidth) || height;
      const placementRatio = Number(avatarRoot.userData.portraitVerticalPlacementRatio ?? 0.5);
      const verticalOffset = (placementRatio - 0.5) * height;
      const combinedHeight = height * 0.5 + verticalOffset;
      const center = new THREE.Vector3(0, verticalOffset, 0);
      avatarRoot.updateWorldMatrix(true, false);
      avatarRoot.localToWorld(center);
      return { avatarRoot, center, height, width, combinedHeight };
    }
    const center = new THREE.Vector3();
    root.updateWorldMatrix?.(true, false);
    root.getWorldPosition?.(center);
    return { avatarRoot: root, center, height: 1, width: 1, combinedHeight: 0.5 };
  }

  function avatarCentroidWorld(root) {
    return avatarMetrics(root)?.center || null;
  }

  function popupAnchorWorld(root, mode) {
    const metrics = avatarMetrics(root);
    if (!metrics) return null;
    const placement = state.settings[mode];
    const xOffset = metrics.width * placement.xOffsetPercent / 100;
    const yOffset = metrics.combinedHeight * placement.yOffsetPercent / 100;
    if (metrics.avatarRoot?.localToWorld) {
      const placementRatio = Number(metrics.avatarRoot.userData?.portraitVerticalPlacementRatio ?? 0.5);
      const local = new state.deps.THREE.Vector3(xOffset, (placementRatio - 0.5) * metrics.height + yOffset, 0);
      metrics.avatarRoot.localToWorld(local);
      return local;
    }
    return metrics.center.clone().add(new state.deps.THREE.Vector3(xOffset, yOffset, 0));
  }

  function makePlane(text, kind, layout) {
    const THREE = state.deps.THREE;
    const size = layout.worldHeight;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontPx = 64;
    ctx.font = `900 ${fontPx}px ${POPUP_FONT_FAMILY}`;
    const width = Math.ceil(ctx.measureText(text).width + 28);
    canvas.width = Math.max(64, width);
    canvas.height = 92;
    ctx.font = `900 ${fontPx}px ${POPUP_FONT_FAMILY}`;
    const leftAligned = layout.textAlign === 'left';
    const textX = leftAligned ? 14 : canvas.width / 2;
    ctx.textAlign = leftAligned ? 'left' : 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(15,10,8,.9)';
    ctx.strokeText(text, textX, canvas.height / 2);
    ctx.fillStyle = state.settings.colors[kind] || '#fff';
    ctx.fillText(text, textX, canvas.height / 2);
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
      .filter(event => event.root === root && event.mode === 'centeredFiveRow' && !event.interactionPrompt)
      .sort((a, b) => (PRIORITY[a.kind] ?? 99) - (PRIORITY[b.kind] ?? 99) || a.sequence - b.sequence);
  }

  function interactionListFor(root) {
    return state.active
      .filter(event => event.root === root && event.interactionPrompt)
      .sort((a, b) => a.sequence - b.sequence);
  }

  function claimFloatOffset(root, bounds) {
    const worldHeight = state.settings.floatPlus.worldHeight;
    const existing = state.active.filter(event => event.root === root && event.mode === 'floatPlus');
    const pathXClearance = worldHeight * 0.24; // Covers two popups' full Float+ horizontal wobble range.
    const pathYClearance = 0.075; // Covers the maximum difference in Float+ upward travel.
    const isFree = point => existing.every(event =>
      Math.abs(point.x - event.offsetX) > (bounds.width + event.width) * 0.5 + pathXClearance ||
      Math.abs(point.y - event.offsetY) > (bounds.height + event.height) * 0.5 + pathYClearance
    );
    const searchCount = Math.max(240, (existing.length + 1) * 240); // Expands instead of reusing an occupied fallback point.
    for (let index = 0; index < searchCount; index++) {
      const angle = index * 2.399963229728653;
      // Keeps the prototype's first 240-point radius, then grows outward as
      // needed so simultaneous numbers always receive distinct clear space.
      const radius = Math.max(0.18, worldHeight * 3.2) * Math.sqrt(index / 239);
      const point = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.62 };
      if (isFree(point)) return point;
    }
    const topEdge = existing.reduce((top, event) => Math.max(top, event.offsetY + event.height * 0.5), 0); // Collision-safe last resort above every active popup.
    return { x: 0, y: topEdge + bounds.height * 0.5 + pathYClearance };
  }

  function spawn(entry) {
    const mode = entry.modeOverride || state.settings.assignments[entry.kind];
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
    state.pending.push({ kind, text: String(text), root: options.root || state.deps?.playerRoot, scene: options.scene, modeOverride: options.mode });
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
    if (kind === 'damage' || kind === 'healing') return spawn({ kind, text, root: options.root || state.deps?.playerRoot, scene: options.scene, modeOverride: options.mode });
    queueReward(kind, text, options);
    return state.sequence;
  }

  function clearInteractionPrompts() {
    for (let index = state.active.length - 1; index >= 0; index--) {
      if (!state.active[index].interactionPrompt) continue;
      dispose(state.active[index]);
      state.active.splice(index, 1);
    }
    state.interactionSignature = '';
  }

  function setInteractionPrompts(root, prompts, options = {}) {
    const entries = (prompts || []).filter(prompt => prompt && prompt.allowed !== false)
      .slice(0, state.settings.centeredFiveRow.maxRows)
      .map(prompt => ({ text: String(prompt.text || prompt.label || '').trim(), action: prompt.action || '' }))
      .filter(prompt => prompt.text);
    if (!root || !entries.length) {
      clearInteractionPrompts();
      return [];
    }
    const signature = `${root.uuid || root.name || 'root'}|${entries.map(entry => `${entry.action}:${entry.text}`).join('|')}`;
    if (signature === state.interactionSignature) return interactionListFor(root).map(event => event.sequence);
    clearInteractionPrompts();
    state.interactionSignature = signature;
    const cfg = state.settings.centeredFiveRow;
    const scene = options.scene || state.deps?.getActiveScene?.();
    if (!scene) return [];
    return entries.map((entry, listSlot) => {
      const parts = makePlane(entry.text, 'interaction', cfg);
      const event = {
        ...entry, ...parts, root, scene, kind: 'interaction', mode: 'centeredFiveRow',
        interactionPrompt: true, sequence: state.sequence++, listSlot,
        startedAt: performance.now(), lifetimeMs: Infinity, offsetX: 0, offsetY: 0,
      };
      scene.add(event.plane);
      state.active.push(event);
      return event.sequence;
    });
  }

  function syncInteractionPrompts(options = {}) {
    const buttons = Array.isArray(options.buttons) ? options.buttons : [];
    const isWorldInteraction = typeof options.isWorldInteraction === 'function'
      ? options.isWorldInteraction
      : button => !!button?.worldInteraction;
    const worldInteractions = buttons.filter(isWorldInteraction);
    const show = options.enabled !== false
      && (worldInteractions.some(button => button.contextualHeldItem)
        || worldInteractions.length > 1);
    if (!show || !options.root) {
      clearInteractionPrompts();
      return [];
    }
    const promptKeys = options.promptKeys || ['E', 'Q', 'F3', 'F4', 'F5'];
    const prompts = worldInteractions.map(button => {
      const slot = buttons.indexOf(button);
      const keyHint = options.desktop && slot >= 0
        ? `${promptKeys[slot] || `F${slot + 1}`}  `
        : '';
      return { ...button, text: `${keyHint}${button.label}` };
    });
    return setInteractionPrompts(options.root, prompts, { scene: options.scene });
  }

  function update(now) {
    const camera = state.deps?.camera;
    if (!camera) return;
    const cameraRight = new state.deps.THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    for (let index = state.active.length - 1; index >= 0; index--) {
      const event = state.active[index];
      const progress = event.interactionPrompt ? 0 : Math.max(0, Math.min(1, (now - event.startedAt) / event.lifetimeMs));
      const center = popupAnchorWorld(event.root, event.mode);
      if (!center || progress >= 1) {
        dispose(event);
        state.active.splice(index, 1);
        continue;
      }
      if (event.mode === 'floatPlus') {
        center.addScaledVector(cameraRight, event.offsetX + Math.sin(progress * Math.PI) * event.height * 0.12);
        center.y += event.offsetY + 0.075 * (1 - Math.pow(1 - progress, 2));
      } else {
        const list = event.interactionPrompt ? interactionListFor(event.root) : listFor(event.root);
        list.forEach((item, slot) => { item.listSlot = slot; });
        const centerSlot = event.interactionPrompt
          ? (Math.max(1, list.length) - 1) * 0.5
          : (state.settings.centeredFiveRow.maxRows - 1) * 0.5;
        center.y += (centerSlot - event.listSlot) * event.height * state.settings.centeredFiveRow.rowSpacing;
        // Plane geometry is centered on its position. Shift by half its width so
        // every variable-width row begins at the configured horizontal anchor.
        if (state.settings.centeredFiveRow.textAlign === 'left') center.addScaledVector(cameraRight, event.width * 0.5);
      }
      event.plane.position.copy(center);
      event.plane.quaternion.copy(camera.quaternion);
      event.material.opacity = event.interactionPrompt ? 1 : progress < 0.72 ? 1 : (1 - progress) / 0.28;
      const pop = event.kind === 'damage' ? 1.1 - 0.1 * Math.min(1, progress / 0.24) : 1;
      event.plane.scale.setScalar(state.settings[event.mode].worldHeight * pop);
    }
  }

  function init(deps) {
    state.deps = deps;
    loadSettings();
    return api;
  }

  function clear() {
    state.active.splice(0).forEach(dispose);
    state.pending.length = 0;
    state.interactionSignature = '';
  }

  function applySettings(settings) {
    state.settings = normalizeSettings(settings);
    clear();
    return clone(state.settings);
  }

  const api = { init, update, showChange, queueReward, setInteractionPrompts, syncInteractionPrompts, clearInteractionPrompts, avatarCentroidWorld, loadSettings, applySettings, clear, defaults: clone(DEFAULTS), storageKey: STORAGE_KEY };
  window.WorldPopupText = api;
})();

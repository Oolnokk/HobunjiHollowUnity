// World-space combat and reward text, adapted from HobunjiAmbientDialoguePreviewV2.
// Float+ is used for damage/healing; the centered five-row list is used for
// progression, favor, currency, and loot. Chathead Yap remains in the stored
// reference prototype for a later ambient-dialogue integration.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunjiWorldPopupSettings.v1';
  const POPUP_FONT_FAMILY = "'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace"; // Used for popup measurement and canvas rendering.
  const TANKAN_FONT_FAMILY = "'TankanScript', 'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace"; // Used by the persistent Quick Attack condition callout.
  const TANKAN_FONT_URL = 'assets/hud/tankanscript_rotated_flipped_horiz.otf'; // Existing HUD font used to render the vertical Hahai condition callout.
  const CENTERED_LIST_SCALE = 0.25; // Interaction, reward, and progression lists render at one quarter of their former world-space size.
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
      masteryXp: '#78cfff', favor: '#ff9fd7', currency: '#ffe181', loot: '#ffffff', interaction: '#ffffff', conditionReady: '#fff4e2',
    },
  };
  const PRIORITY = { skillXp: 0, masteryXp: 1, favor: 2, currency: 3, loot: 4 };
  const state = { deps: null, settings: DEFAULTS, active: [], sequence: 0, pending: [], flushQueued: false, interactionSignature: '', conditionCallout: null, aimLabel: null };
  let tankanFontPromise = null; // Used to load the existing Tankan OTF once before redrawing any persistent callout canvas.

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

  function ensureTankanFont() {
    if (tankanFontPromise) return tankanFontPromise;
    if (typeof FontFace !== 'function' || !document.fonts) return Promise.resolve(false);
    tankanFontPromise = new FontFace('TankanScript', `url('${TANKAN_FONT_URL}')`, { weight: 'normal', style: 'normal' })
      .load()
      .then(font => { document.fonts.add(font); return true; })
      .catch(() => false);
    return tankanFontPromise;
  }

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

  function drawConditionCallout(parts, text) {
    const chars = Array.from(text || 'Hahai!');
    const ctx = parts.ctx;
    const canvas = parts.canvas;
    const fontPx = 64;
    const row = 66;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fontPx}px ${TANKAN_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let index = 0; index < chars.length; index++) {
      const y = 20 + row * (index + 0.5);
      ctx.lineWidth = 9;
      ctx.strokeStyle = 'rgba(15,10,8,.92)';
      ctx.strokeText(chars[index], canvas.width / 2, y);
      ctx.fillStyle = state.settings.colors.conditionReady || '#fff4e2';
      ctx.fillText(chars[index], canvas.width / 2, y);
    }
    parts.texture.needsUpdate = true;
  }

  function makeConditionCalloutPlane(text, layout) {
    const THREE = state.deps.THREE;
    const chars = Array.from(text || 'Hahai!');
    const canvas = document.createElement('canvas');
    canvas.width = 112;
    canvas.height = Math.max(112, 40 + chars.length * 66);
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const aspect = canvas.width / canvas.height;
    const geometry = new THREE.PlaneGeometry(aspect, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(geometry, material);
    const totalHeight = layout.worldHeight * Math.max(2.7, chars.length * 0.82); // Each stacked glyph reads at roughly the same scale as one centered reward-list row.
    plane.scale.setScalar(totalHeight);
    plane.renderOrder = 1201;
    plane.frustumCulled = false;
    plane.userData.isBillboard = true;
    const parts = { plane, geometry, material, texture, canvas, ctx, width: aspect * totalHeight, height: totalHeight };
    drawConditionCallout(parts, text);
    ensureTankanFont().then(loaded => {
      if (loaded && parts.plane.parent) drawConditionCallout(parts, text);
    });
    return parts;
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
    const pathXClearance = worldHeight * 0.24;
    const pathYClearance = 0.075;
    const isFree = point => existing.every(event =>
      Math.abs(point.x - event.offsetX) > (bounds.width + event.width) * 0.5 + pathXClearance ||
      Math.abs(point.y - event.offsetY) > (bounds.height + event.height) * 0.5 + pathYClearance
    );
    const searchCount = Math.max(240, (existing.length + 1) * 240);
    for (let index = 0; index < searchCount; index++) {
      const angle = index * 2.399963229728653;
      const radius = Math.max(0.18, worldHeight * 3.2) * Math.sqrt(index / 239);
      const point = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.62 };
      if (isFree(point)) return point;
    }
    const topEdge = existing.reduce((top, event) => Math.max(top, event.offsetY + event.height * 0.5), 0);
    return { x: 0, y: topEdge + bounds.height * 0.5 + pathYClearance };
  }

  function spawn(entry) {
    const mode = entry.modeOverride || state.settings.assignments[entry.kind];
    if (!state.deps || !entry.root || (mode !== 'floatPlus' && mode !== 'centeredFiveRow')) return null;
    const cfg = state.settings[mode];
    const planeCfg = mode === 'centeredFiveRow'
      ? { ...cfg, worldHeight: cfg.worldHeight * CENTERED_LIST_SCALE }
      : cfg;
    const parts = makePlane(entry.text, entry.kind, planeCfg);
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
    const interactionCfg = { ...cfg, worldHeight: cfg.worldHeight * CENTERED_LIST_SCALE };
    const scene = options.scene || state.deps?.getActiveScene?.();
    if (!scene) return [];
    return entries.map((entry, listSlot) => {
      const parts = makePlane(entry.text, 'interaction', interactionCfg);
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

  function clearConditionCallout() {
    if (!state.conditionCallout) return;
    dispose(state.conditionCallout);
    state.conditionCallout = null;
  }

  function setConditionCallout(root, enabled, options = {}) {
    if (!enabled || !root || !state.deps) {
      clearConditionCallout();
      return null;
    }
    const text = String(options.text || 'Hahai!');
    const scene = options.scene || state.deps.getActiveScene?.();
    if (!scene) {
      clearConditionCallout();
      return null;
    }
    const signature = `${root.uuid || root.name || 'root'}|${text}`;
    const existing = state.conditionCallout;
    if (existing?.signature === signature) {
      if (existing.plane.parent !== scene) {
        existing.plane.parent?.remove(existing.plane);
        scene.add(existing.plane);
      }
      existing.scene = scene;
      return existing.sequence;
    }

    clearConditionCallout();
    const parts = makeConditionCalloutPlane(text, state.settings.centeredFiveRow);
    const event = {
      ...parts, root, scene, text, signature,
      kind: 'conditionReady', conditionCallout: true,
      sequence: state.sequence++, startedAt: performance.now(), lifetimeMs: Infinity,
    };
    scene.add(event.plane);
    state.conditionCallout = event;
    return event.sequence;
  }

  function syncInteractionPrompts(options = {}) {
    const buttons = Array.isArray(options.buttons) ? options.buttons : [];
    const isWorldInteraction = typeof options.isWorldInteraction === 'function'
      ? options.isWorldInteraction
      : button => !!button?.worldInteraction;
    const worldInteractions = buttons.filter(isWorldInteraction);
    // Every interactible world target uses the list presentation, including
    // a single available action. This keeps discovery and input hints
    // consistent instead of silently switching UI modes by option count.
    const show = options.enabled !== false && worldInteractions.length > 0;
    if (!show || !options.root) {
      clearInteractionPrompts();
      return [];
    }
    const promptKeys = options.promptKeys || ['E', 'Q', 'F3', 'F4', 'F5'];
    const prompts = worldInteractions.map(button => {
      const slot = buttons.indexOf(button);
      const keyHint = options.showInputHints !== false && slot >= 0
        ? `${promptKeys[slot] || `Action ${slot + 1}`}  `
        : '';
      return { ...button, text: `${keyHint}${button.label}` };
    });
    return setInteractionPrompts(options.root, prompts, { scene: options.scene });
  }

  function clearAimLabel() {
    if (!state.aimLabel) return;
    dispose(state.aimLabel);
    state.aimLabel = null;
  }

  function setAimLabel(root, text, options = {}) {
    const label = String(text || '').trim();
    if (!root || !label || !state.deps) {
      clearAimLabel();
      return null;
    }
    const scene = options.scene || state.deps.getActiveScene?.();
    if (!scene) {
      clearAimLabel();
      return null;
    }
    const signature = (root.uuid || root.name || 'root') + '|' + label;
    if (state.aimLabel?.signature === signature) {
      if (state.aimLabel.plane.parent !== scene) {
        state.aimLabel.plane.parent?.remove(state.aimLabel.plane);
        scene.add(state.aimLabel.plane);
      }
      state.aimLabel.scene = scene;
      return state.aimLabel.sequence;
    }
    clearAimLabel();
    const parts = makePlane(label, 'interaction', { worldHeight: options.worldHeight || 0.22, textAlign: 'center' });
    const event = {
      ...parts, root, scene, text: label, signature,
      kind: 'interaction', aimLabel: true,
      sequence: state.sequence++, startedAt: performance.now(), lifetimeMs: Infinity,
    };
    scene.add(event.plane);
    state.aimLabel = event;
    return event.sequence;
  }

  function updateAimLabel(camera) {
    const event = state.aimLabel;
    if (!event) return;
    const metrics = avatarMetrics(event.root);
    if (!metrics || !event.root?.parent) {
      clearAimLabel();
      return;
    }
    let anchor;
    if (metrics.avatarRoot?.localToWorld) {
      const placementRatio = Number(metrics.avatarRoot.userData?.portraitVerticalPlacementRatio ?? 0.5);
      anchor = new state.deps.THREE.Vector3(0, (placementRatio - 0.5) * metrics.height + metrics.height * 0.68, 0);
      metrics.avatarRoot.localToWorld(anchor);
    } else {
      anchor = metrics.center.clone();
      anchor.y += metrics.height * 0.68;
    }
    event.plane.position.copy(anchor);
    event.plane.quaternion.copy(camera.quaternion);
    event.material.opacity = 1;
  }

  function updateConditionCallout(camera, cameraRight) {
    const event = state.conditionCallout;
    if (!event) return;
    const metrics = avatarMetrics(event.root);
    if (!metrics || !event.root?.parent) {
      clearConditionCallout();
      return;
    }
    const cfg = state.settings.centeredFiveRow;
    const center = metrics.center.clone();
    const mirroredListOffset = Math.abs(metrics.width * cfg.xOffsetPercent / 100) + event.width * 0.5; // Same horizontal list offset, mirrored to the opposite screen side.
    center.addScaledVector(cameraRight, -mirroredListOffset);
    center.y += metrics.combinedHeight * cfg.yOffsetPercent / 100;
    event.plane.position.copy(center);
    event.plane.quaternion.copy(camera.quaternion);
    event.material.opacity = 1;
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
        if (state.settings.centeredFiveRow.textAlign === 'left') center.addScaledVector(cameraRight, event.width * 0.5);
      }
      event.plane.position.copy(center);
      event.plane.quaternion.copy(camera.quaternion);
      event.material.opacity = event.interactionPrompt ? 1 : progress < 0.72 ? 1 : (1 - progress) / 0.28;
      const pop = event.kind === 'damage' ? 1.1 - 0.1 * Math.min(1, progress / 0.24) : 1;
      const listScale = event.mode === 'centeredFiveRow' ? CENTERED_LIST_SCALE : 1;
      event.plane.scale.setScalar(state.settings[event.mode].worldHeight * listScale * pop);
    }
    updateConditionCallout(camera, cameraRight);
    updateAimLabel(camera);
  }

  function init(deps) {
    state.deps = deps;
    loadSettings();
    ensureTankanFont();
    return api;
  }

  function clear() {
    state.active.splice(0).forEach(dispose);
    state.pending.length = 0;
    state.interactionSignature = '';
    clearConditionCallout();
    clearAimLabel();
  }

  function applySettings(settings) {
    state.settings = normalizeSettings(settings);
    clear();
    return clone(state.settings);
  }

  const api = {
    init, update, showChange, queueReward,
    setInteractionPrompts, syncInteractionPrompts, clearInteractionPrompts,
    setConditionCallout, clearConditionCallout,
    setAimLabel, clearAimLabel,
    avatarCentroidWorld, loadSettings, applySettings, clear,
    defaults: clone(DEFAULTS), storageKey: STORAGE_KEY,
  };
  window.WorldPopupText = api;
})();

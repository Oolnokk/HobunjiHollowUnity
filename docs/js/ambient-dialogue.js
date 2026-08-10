// Proximity-driven world dialogue: NPC chathead greetings, companion calls,
// and reusable crowd cheer/jeer hooks. Visuals are adapted from the stored
// HobunjiAmbientDialoguePreviewV2 reference without opening the main dialogue UI.
(() => {
  'use strict';

  const FONT = "'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace";
  const DEFAULTS = {
    enabled: true,
    greetingRadiusTiles: 2.6,
    greetingCooldownMs: 1300,
    durationMs: 4200,
    textWorldHeight: 0.28,
    chatheadWorldSize: 0.48,
    anchorLiftTiles: 0.18,
    friendGroups: [],
    greetingTemplates: ['{targetName}! Good to see you.', 'Hello, {targetName}!', 'Ah, {targetName} — there you are!'],
    companionTreasureLines: {
      'dabinggi-hound': ['Arf! Arf!', 'Rrruf!', 'Snff-snff… arf!'],
      'gar-wolf': ['Rrrrowf!', 'Awrf!', 'Snrrf…!'],
      'grehlr': ['Hrrrmm!', 'Mrrup!', 'Hrru-hrru!'],
      'drenkirra': ['Krrik-krrik!', 'Chrrup!', 'Tik-tik-tik!'],
      default: ['?!', 'Hrrm!', 'Snff-snff!'],
    },
    crowdLines: {
      cheer: ['Hooray!', 'Again!', 'Wonderful!', 'Bravo!'],
      jeer: ['Boo!', 'Oh, come on!', 'Was that it?', 'Try again!'],
    },
  };

  const state = {
    deps: null,
    settings: structuredCloneSafe(DEFAULTS),
    active: [],
    greeted: new Set(),
    proximity: new Map(),
    lastGreetingAt: 0,
    lastDay: null,
    ledgerKey: null,
    renderQueue: Promise.resolve(),
  };

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeSettings(authored) {
    return {
      ...structuredCloneSafe(DEFAULTS),
      ...(authored || {}),
      companionTreasureLines: { ...DEFAULTS.companionTreasureLines, ...(authored?.companionTreasureLines || {}) },
      crowdLines: { ...DEFAULTS.crowdLines, ...(authored?.crowdLines || {}) },
    };
  }

  async function loadSettings() {
    try {
      const response = await fetch('config/dialogue/ambient-dialogue.json');
      state.settings = mergeSettings(response.ok ? await response.json() : null);
    } catch (_) {
      state.settings = mergeSettings(null);
    }
    return structuredCloneSafe(state.settings);
  }

  function seededIndex(seed, length) {
    let hash = 2166136261;
    for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return length ? (hash >>> 0) % length : 0;
  }

  function pick(lines, seed = Math.random()) {
    const list = Array.isArray(lines) && lines.length ? lines : ['…'];
    return list[seededIndex(seed, list.length)];
  }

  function templateLine(targetName, speakerId, day) {
    return pick(state.settings.greetingTemplates, `${speakerId}:${day}`)
      .replaceAll('{targetName}', String(targetName || 'friend'));
  }

  function friendSetFor(npcId) {
    const set = new Set();
    for (const group of state.settings.friendGroups || []) {
      if (!Array.isArray(group) || !group.includes(npcId)) continue;
      group.forEach(id => { if (id !== npcId) set.add(id); });
    }
    return set;
  }

  function anchorFor(root) {
    const THREE = state.deps?.THREE;
    if (!THREE || !root) return null;
    root.updateWorldMatrix?.(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) {
      const fallback = new THREE.Vector3();
      root.getWorldPosition?.(fallback);
      fallback.y += 1.1;
      return fallback;
    }
    const center = box.getCenter(new THREE.Vector3());
    center.y = box.max.y + state.settings.anchorLiftTiles;
    return center;
  }

  function canvasTexture(canvas) {
    const THREE = state.deps.THREE;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  function textPlane(text) {
    const THREE = state.deps.THREE;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const fontPx = 58;
    context.font = `900 ${fontPx}px ${FONT}`;
    canvas.width = Math.max(128, Math.ceil(context.measureText(text).width + 30));
    canvas.height = 92;
    const texture = canvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(canvas.width / canvas.height, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(geometry, material);
    plane.renderOrder = 1210;
    plane.frustumCulled = false;
    return { canvas, context, texture, geometry, material, plane, fontPx };
  }

  function drawText(event, visibleText) {
    const { canvas, context, fontPx, text } = event.textPart;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `900 ${fontPx}px ${FONT}`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 10;
    context.strokeStyle = 'rgba(15,10,8,.92)';
    context.strokeText(visibleText, 15, canvas.height / 2);
    context.fillStyle = event.tone === 'jeer' ? '#ffb4a8' : event.tone === 'cheer' ? '#ffe68b' : '#fff8e9';
    context.fillText(visibleText, 15, canvas.height / 2);
    event.textPart.texture.needsUpdate = true;
    event.visibleChars = visibleText.length;
    event.textPart.plane.visible = visibleText.length > 0;
    event.textPart.plane.userData.fullText = text; // Mobile Pixel Probe/debug inspection hook.
  }

  function makeHeadPart() {
    const THREE = state.deps.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 125;
    const texture = canvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(1.6, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(geometry, material);
    plane.renderOrder = 1211;
    plane.frustumCulled = false;
    return { canvas, texture, geometry, material, plane, nextFrameAt: 0, busy: false };
  }

  function disposePart(part) {
    part.plane.parent?.remove(part.plane);
    part.geometry.dispose();
    part.material.dispose();
    part.texture.dispose();
  }

  function dispose(event) {
    event.group.parent?.remove(event.group);
    disposePart(event.textPart);
    if (event.headPart) disposePart(event.headPart);
  }

  function renderChathead(event, now, force = false) {
    if (!event.headPart || !event.profile || event.headPart.busy || (!force && now < event.headPart.nextFrameAt)) return;
    const source = event.headSource || (event.headSource = Object.assign(document.createElement('canvas'), { width: 200, height: 200 }));
    event.headPart.busy = true;
    event.headPart.nextFrameAt = now + 110;
    state.renderQueue = state.renderQueue.then(async () => {
      await window.NpcAvatarPreview?.renderProfileToCanvas(source, event.profile, {
        seatId: event.seatId,
        breathingComposer: window.portraitBreathingComposer || null,
      });
      if (!state.active.includes(event)) return;
      const context = event.headPart.canvas.getContext('2d');
      context.clearRect(0, 0, 200, 125);
      // The avatar portrait's head occupies its upper portion. Cropping here
      // produces the reference tool's detached chathead without a bubble.
      context.drawImage(source, 0, 0, 200, 125, 0, 0, 200, 125);
      event.headPart.texture.needsUpdate = true;
    }).catch(error => state.deps?.debugLog?.(`[ambient-dialogue] chathead render failed: ${error?.message || error}`, 'warn'))
      .finally(() => { event.headPart.busy = false; });
  }

  function show(root, text, options = {}) {
    const THREE = state.deps?.THREE;
    const scene = options.scene || state.deps?.getActiveScene?.();
    const message = String(text || '').trim();
    if (!THREE || !root || !scene || !message || state.settings.enabled === false) return null;
    const mode = options.mode === 'overhead' ? 'overhead' : 'chathead';
    const textPart = textPlane(message);
    textPart.text = message;
    textPart.plane.scale.setScalar(state.settings.textWorldHeight);
    const group = new THREE.Group();
    group.name = `ambient_dialogue_${options.speakerId || 'speaker'}`;
    group.add(textPart.plane);
    const headPart = mode === 'chathead' && options.profile ? makeHeadPart() : null;
    if (headPart) {
      headPart.plane.scale.setScalar(state.settings.chatheadWorldSize);
      group.add(headPart.plane);
    }
    const textWidth = (textPart.canvas.width / textPart.canvas.height) * state.settings.textWorldHeight;
    const headWidth = headPart ? 1.6 * state.settings.chatheadWorldSize : 0;
    textPart.plane.position.x = (headWidth + textWidth) / 2;
    if (headPart) headPart.plane.position.x = -textWidth / 2;
    scene.add(group);
    const now = performance.now();
      const event = {
        root, group, textPart, headPart, profile: options.profile || null,
        faceWalker: options.faceWalker || null,
        faceTarget: options.faceTarget || null,
      seatId: `ambient:${options.speakerId || 'speaker'}:${Math.round(now)}`,
      tone: options.tone || 'greeting', startedAt: now,
      durationMs: Number(options.durationMs) || state.settings.durationMs,
      visibleChars: -1,
    };
    state.active.push(event);
    drawText(event, '');
    if (headPart) {
      window.portraitBreathingComposer?.scheduleYapSequence(event.seatId, message);
      renderChathead(event, now, true);
    }
    window.dispatchEvent(new CustomEvent('hobunji-ambient-dialogue', { detail: { speakerId: options.speakerId || null, text: message, mode, tone: event.tone } }));
    return event;
  }

  function updateActive(now) {
    const camera = state.deps?.camera;
    if (!camera) return;
    for (let index = state.active.length - 1; index >= 0; index--) {
      const event = state.active[index];
      const progress = (now - event.startedAt) / event.durationMs;
      const anchor = anchorFor(event.root);
      if (!anchor || progress >= 1) {
        dispose(event);
        state.active.splice(index, 1);
        continue;
      }
      const revealProgress = Math.min(1, progress / 0.55);
      const visibleChars = Math.ceil(event.textPart.text.length * revealProgress);
      if (visibleChars !== event.visibleChars) drawText(event, event.textPart.text.slice(0, visibleChars));
      event.group.position.copy(anchor);
      event.group.quaternion.copy(camera.quaternion);
      if (event.faceWalker && event.faceTarget) {
        const targetPosition = event.faceTarget.root?.position || event.faceTarget;
        const angle = -Math.atan2(targetPosition.z - event.faceWalker.root.position.z, targetPosition.x - event.faceWalker.root.position.x) + Math.PI / 2;
        event.faceWalker.applyFacingDeadzone?.(angle, 0.34);
      }
      const opacity = progress < 0.78 ? 1 : Math.max(0, (1 - progress) / 0.22);
      event.textPart.material.opacity = opacity;
      if (event.headPart) {
        event.headPart.material.opacity = opacity;
        renderChathead(event, now);
      }
    }
  }

  function greetPairKey(day, speakerId, targetId) {
    return `${day}:${speakerId}>${targetId}`;
  }

  function ensureGreetingLedger(day) {
    const worldId = String(state.deps?.getWorldId?.() || 'local');
    const ledgerKey = `hobunjiAmbientGreetings.v1:${worldId}`;
    if (state.ledgerKey === ledgerKey && state.lastDay === day) return;
    state.ledgerKey = ledgerKey;
    state.lastDay = day;
    state.proximity.clear();
    try {
      const saved = JSON.parse(localStorage.getItem(ledgerKey) || 'null');
      state.greeted = new Set(saved?.day === day && Array.isArray(saved.keys) ? saved.keys : []);
    } catch (_) {
      state.greeted = new Set();
    }
  }

  function saveGreetingLedger(day) {
    if (!state.ledgerKey) return;
    try {
      localStorage.setItem(state.ledgerKey, JSON.stringify({ day, keys: [...state.greeted] }));
    } catch (_) {}
  }

  function tryGreeting(walker, target, now, day) {
    const speakerId = walker?.rec?.id;
    if (!speakerId || walker.area !== state.deps.getCurrentArea()) return false;
    const targetId = target.id;
    const key = greetPairKey(day, speakerId, targetId);
    if (state.greeted.has(key)) return false;
    const distance = Math.hypot(walker.root.position.x - target.x, walker.root.position.z - target.z);
    const proximityKey = `${speakerId}>${targetId}`;
    if (distance > state.settings.greetingRadiusTiles) {
      state.proximity.delete(proximityKey);
      return false;
    }
    const enteredAt = state.proximity.get(proximityKey) ?? now;
    state.proximity.set(proximityKey, enteredAt);
    if (now - enteredAt < 300 || now - state.lastGreetingAt < state.settings.greetingCooldownMs) return false;
    state.greeted.add(key);
    saveGreetingLedger(day);
    state.lastGreetingAt = now;
    const angle = -Math.atan2(target.z - walker.root.position.z, target.x - walker.root.position.x) + Math.PI / 2;
    walker.applyFacingDeadzone?.(angle, 0.34);
    show(walker.root, templateLine(target.name, speakerId, day), {
      speakerId,
      profile: walker.profile,
      mode: 'chathead',
      faceWalker: walker,
      faceTarget: target.root ? { root: target.root } : { x: target.x, z: target.z },
    });
    return true;
  }

  function updateGreetings(now) {
    if (state.deps?.isDialogueOpen?.() || state.deps?.isPaused?.()) return;
    const day = Number(state.deps?.getDay?.()) || 1;
    ensureGreetingLedger(day);
    const area = state.deps.getCurrentArea();
    const walkers = (state.deps.getNpcWalkers?.() || []).filter(walker => walker.area === area);
    const player = state.deps.getPlayerPosition?.();
    if (player) {
      for (const walker of walkers) {
        if (tryGreeting(walker, { id: 'player', name: state.deps.getPlayerName?.() || 'neighbor', ...player }, now, day)) return;
      }
    }
    for (const walker of walkers) {
      const friends = friendSetFor(walker.rec?.id);
      for (const other of walkers) {
        if (walker === other || !friends.has(other.rec?.id)) continue;
        if (tryGreeting(walker, { id: other.rec.id, name: other.rec.name, x: other.root.position.x, z: other.root.position.z, root: other.root }, now, day)) return;
      }
    }
  }

  function companionTreasure(companion) {
    if (!companion?.avatarRef?.group) return null;
    const lines = state.settings.companionTreasureLines[companion.creatureKey]
      || state.settings.companionTreasureLines.default;
    return show(companion.avatarRef.group, pick(lines, `${companion.id}:${state.deps?.getDay?.()}`), {
      speakerId: companion.id,
      mode: 'overhead',
      durationMs: 2800,
      tone: 'companion',
    });
  }

  function crowd(root, tone = 'cheer', options = {}) {
    const normalizedTone = tone === 'jeer' ? 'jeer' : 'cheer';
    const lines = options.lines || state.settings.crowdLines[normalizedTone];
    return show(root, options.text || pick(lines), { ...options, mode: 'overhead', tone: normalizedTone });
  }

  function update(now = performance.now()) {
    updateActive(now);
    updateGreetings(now);
  }

  function clear() {
    state.active.splice(0).forEach(dispose);
    state.proximity.clear();
  }

  function init(deps) {
    state.deps = deps;
    loadSettings();
    return api;
  }

  const api = { init, update, show, companionTreasure, crowd, cheer: (root, options) => crowd(root, 'cheer', options), jeer: (root, options) => crowd(root, 'jeer', options), clear, loadSettings };
  window.AmbientDialogue = api;
})();

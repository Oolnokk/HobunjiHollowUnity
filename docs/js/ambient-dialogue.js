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
    npcNicknames: {},
    npcGreetings: {},
    npcAlcoholOffers: {
      default: {
        acceptMode: 'always',
        acceptConditions: {},
        acceptLines: ['Gladly.', "Don't mind if I do.", 'Just one swig.'],
        refuseLines: ['No, thank you.', 'Not right now.'],
      },
    },
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
    dialogueDeps: null,
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
      npcNicknames: { ...DEFAULTS.npcNicknames, ...(authored?.npcNicknames || {}) },
      npcGreetings: { ...DEFAULTS.npcGreetings, ...(authored?.npcGreetings || {}) },
      npcAlcoholOffers: {
        ...DEFAULTS.npcAlcoholOffers,
        ...(authored?.npcAlcoholOffers || {}),
        default: { ...DEFAULTS.npcAlcoholOffers.default, ...(authored?.npcAlcoholOffers?.default || {}) },
      },
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

  // DialogueContent already owns every condition input used by its phrase-pool
  // selector. Capture that injected dependency bag once so ambient {targetName}
  // can consult the same nickname pools without duplicating those inputs in game.js.
  function installDialogueDependencyBridge() {
    const dialogue = window.DialogueContent;
    if (!dialogue?.init || dialogue.__ambientNicknameBridgeWrapped) return;
    const originalInit = dialogue.init; // Used to preserve DialogueContent's normal initialization after capturing the dependency bag.
    dialogue.init = function ambientAwareDialogueInit(injectedDeps) {
      state.dialogueDeps = injectedDeps;
      return originalInit.call(dialogue, injectedDeps);
    };
    dialogue.__ambientNicknameBridgeWrapped = true;
  }
  installDialogueDependencyBridge();

  function seededIndex(seed, length) {
    let hash = 2166136261;
    for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return length ? (hash >>> 0) % length : 0;
  }

  function pick(lines, seed = Math.random()) {
    const list = Array.isArray(lines) && lines.length ? lines : ['…'];
    return list[seededIndex(seed, list.length)];
  }

  function greetingLinesFor(speakerId, targetId) {
    const authored = state.settings.npcGreetings?.[speakerId];
    if (targetId === 'player' && authored?.player?.length) return authored.player;
    if (targetId !== 'player' && authored?.friends?.[targetId]?.length) return authored.friends[targetId];
    return state.settings.greetingTemplates;
  }

  function templateLine(targetName, speakerId, targetId, day) {
    const values = {
      targetName: String(targetName || 'friend'),
      weekDay: String(state.deps?.getWeekDay?.(day) || 'day'),
      dayPart: String(state.deps?.getDayPart?.() || 'day'),
    }; // Used here and by diagnostics to resolve every supported greeting placeholder.
    const source = pick(greetingLinesFor(speakerId, targetId), `${speakerId}:${targetId}:${day}`);
    const unresolved = [...source.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
      .map(match => match[1]).filter(key => !(key in values));
    if (unresolved.length) state.deps?.debugLog?.(`[ambient-dialogue] Unknown placeholder(s) for ${speakerId}: ${[...new Set(unresolved)].join(', ')}`, 'warn');
    return source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, key) => key in values ? values[key] : token);
  }

  function friendSetFor(npcId) {
    const set = new Set();
    for (const group of state.settings.friendGroups || []) {
      if (!Array.isArray(group) || !group.includes(npcId)) continue;
      group.forEach(id => { if (id !== npcId) set.add(id); });
    }
    Object.keys(state.settings.npcGreetings?.[npcId]?.friends || {}).forEach(id => set.add(id));
    return set;
  }

  function firstNameWord(name) {
    return String(name || '').trim().split(/\s+/)[0] || 'friend';
  }

  function dialogueWorldStateFor(rec, walker) {
    const deps = state.dialogueDeps;
    const dlgState = window.DialogueContent?.getNpcDlgState?.(rec?.id) || {};
    const scheduleTarget = walker?.currentScheduleTarget || null; // Used so nickname station conditions see the ambient speaker's station rather than an inactive dialogue walker.
    return {
      weekdays: deps?.currentWeekdayName?.(),
      seasons: deps?.currentSeason?.()?.name,
      weather: deps?.calendar?.weather,
      timesOfDay: deps?.fishingTimeOfDay?.(),
      encounter: (dlgState.heardTrees || []).length ? 'returning' : 'first',
      maps: deps?.getCurrentArea?.(),
      stations: scheduleTarget ? (deps?.normalizeStationLabel?.(scheduleTarget.label) || '') : '',
      playerSpecies: deps?.getPlayerData?.()?.appearance?.speciesId || '',
      relationship: dlgState.favor ?? 0,
    };
  }

  function nicknamePoolFor(rec) {
    return (rec?.phrasePools || []).find(pool => {
      const label = `${pool?.id || ''} ${pool?.name || ''}`; // Used to recognize the per-NPC "Nicknames" phrase pool authored by the main Dialogue Editor.
      return /(?:^|[\s_-])nicknames?(?:$|[\s_-])/i.test(label);
    }) || null;
  }

  function pickConditionedPoolEntry(pool, rec, walker) {
    if (!pool?.entries?.length || !window.ConditionRegistry?.pickBestEntry) return null;
    const dlgState = window.DialogueContent?.getNpcDlgState?.(rec?.id) || {};
    return window.ConditionRegistry.pickBestEntry(
      pool.entries,
      dialogueWorldStateFor(rec, walker),
      dlgState.heardPoolEntries || []
    );
  }

  function resolveDialogueNicknameTokens(text, rec, walker, depth = 0) {
    const deps = state.dialogueDeps;
    const player = deps?.getPlayerData?.() || null;
    const playerName = player?.nickname || state.deps?.getPlayerName?.() || 'Farmer';
    const gender = player?.appearance?.gender || 'male';
    const pr1 = gender === 'female' ? 'she' : gender === 'neutral' ? 'they' : 'he';
    const pr2 = gender === 'female' ? 'her' : gender === 'neutral' ? 'them' : 'him';
    const pr3 = gender === 'female' ? 'her' : gender === 'neutral' ? 'their' : 'his';
    const prSelf = gender === 'female' ? 'herself' : gender === 'neutral' ? 'themself' : 'himself';
    const vowels = new Set('aeiouAEIOU');
    let firstL2V1 = '';
    for (const ch of playerName) { firstL2V1 += ch; if (vowels.has(ch)) break; }
    const dlgState = window.DialogueContent?.getNpcDlgState?.(rec?.id) || {};
    const localNickname = dlgState.localNickname || playerName;
    let out = String(text || '')
      .replace(/\{\{npcName\}\}/g, rec?.name || '')
      .replace(/\{\{playerName\}\}/g, playerName)
      .replace(/\{\{playerNickname\}\}/g, playerName)
      .replace(/\{\{playerLocalNickname\}\}/g, localNickname)
      .replace(/\{\{playerPronoun1\}\}/g, pr1)
      .replace(/\{\{playerPronoun2\}\}/g, pr2)
      .replace(/\{\{playerPronoun3\}\}/g, pr3)
      .replace(/\{\{playerPronounSelf\}\}/g, prSelf)
      .replace(/\{\{playerFirstL2V1\}\}/g, firstL2V1)
      .replace(/\{\{role\}\}/g, rec?.role || '')
      .replace(/\{\{npcSpecies\}\}/g, rec?.appearance?.speciesId || rec?.species || '')
      .replace(/\{\{playerSpecies\}\}/g, player?.appearance?.speciesId || '');
    if (depth < 4) {
      out = out.replace(/\{\{pool:([^}]+)\}\}/g, (_token, poolId) => {
        const nested = (rec?.phrasePools || []).find(pool => pool.id === poolId.trim() || pool.name === poolId.trim());
        const entry = pickConditionedPoolEntry(nested, rec, walker);
        return entry ? resolveDialogueNicknameTokens(entry.text, rec, walker, depth + 1) : '';
      });
    }
    return out;
  }

  function playerNicknameFor(walker) {
    const rec = walker?.rec;
    const pool = nicknamePoolFor(rec);
    const entry = pickConditionedPoolEntry(pool, rec, walker);
    if (entry) {
      const resolved = resolveDialogueNicknameTokens(entry.text, rec, walker).trim();
      if (resolved) return resolved;
    }
    return state.dialogueDeps?.getPlayerData?.()?.nickname || state.deps?.getPlayerName?.() || 'neighbor';
  }

  function resolveTargetName(walker, target) {
    if (target?.id === 'player') return playerNicknameFor(walker);
    const authored = state.settings.npcNicknames?.[walker?.rec?.id]?.[target?.id]; // Used for directional family/personal nicknames such as Dad, Mom, Sis, and Tak.
    return String(authored || '').trim() || firstNameWord(target?.name);
  }

  // Off-screen follow tuning for chatheads directed at the player: how far
  // into the frustum a point must sit to count as "on camera" again, how
  // close to the true edge the off-screen indicator is pinned, and how fast
  // the displayed position/scale eases toward wherever it currently belongs.
  const EDGE_ON_SCREEN_MARGIN = 0.92;
  const EDGE_PIN_MARGIN = 0.86;
  const EDGE_MIN_MARGIN = 0.22; // floor so a long text bubble can't invert/collapse the pin margin
  const EDGE_LERP_SPEED = 7;
  // Fixed camera-relative depth for the off-screen "locked" spot — deliberately
  // NOT tied to the speaker's real distance. A constant depth (with the
  // bubble's own world-space size already fixed) makes its on-screen size and
  // position fully deterministic, like a real screen-space HUD icon, and the
  // easing of world position from the true anchor's own depth down to this
  // fixed one is what reads as the bubble collapsing out of 3D into a flat
  // 2D marker (and expanding back out of it when the speaker returns to view).
  const EDGE_LOCK_DEPTH = 3;
  const EDGE_SCALE = 0.6; // how much smaller the whole chathead+text bubble renders while pinned off-screen

  // Reports whether `anchor` is inside the camera's frustum (with margin);
  // when it isn't, also hands back the camera-relative vector to it so the
  // caller can work out which screen edge is closest without projecting twice.
  function cameraVisibility(anchor, camera) {
    const THREE = state.deps.THREE;
    const toAnchor = anchor.clone().sub(camera.position);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    if (toAnchor.dot(forward) > 0.1) {
      const ndc = anchor.clone().project(camera);
      if (Math.abs(ndc.x) <= EDGE_ON_SCREEN_MARGIN && Math.abs(ndc.y) <= EDGE_ON_SCREEN_MARGIN && ndc.z < 1) {
        return { onScreen: true };
      }
    }
    return { onScreen: false, toAnchor };
  }

  // Persistent HUD chrome the screen-locked marker must never sit under.
  // Measured live (rather than hand-guessed as fixed margins) so it tracks
  // the game's actual responsive layout and only reserves space for pieces
  // that are currently laid out and visible. Every piece of this game's
  // persistent chrome sits in a horizontal band pinned to the top or bottom
  // of the screen (never a left/right column), so exclusion is modeled as
  // two bands rather than a general per-edge inset — that avoids a wide,
  // short top element (like the status bar) getting misread as needing its
  // whole column blocked all the way down the screen.
  const UI_SAFE_SELECTORS = ['#statusBar', '#navigationCompass', '#buffBar', '#menuBtn', '#farmEditBtn', '#devSpawnBtn', '#actionPrompt'];
  const UI_SAFE_REFRESH_MS = 400;
  let _uiSafeBox = null;

  // Unions the top-band and bottom-band footprint of every currently-visible
  // chrome element into one measurement, cached briefly since
  // getBoundingClientRect forces layout and this chrome barely ever moves
  // frame-to-frame.
  function uiSafeNdcBox(now) {
    if (_uiSafeBox && now - _uiSafeBox.atMs < UI_SAFE_REFRESH_MS) return _uiSafeBox;
    const vh = window.innerHeight;
    let topSafePx = 0, bottomSafePx = vh;
    for (const selector of UI_SAFE_SELECTORS) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || parseFloat(style.opacity || '1') < 0.05) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      // Whichever half of the screen this element's center falls in is the
      // band it's reserving; only that band's boundary needs to move.
      if ((rect.top + rect.bottom) / 2 < vh / 2) topSafePx = Math.max(topSafePx, rect.bottom);
      else bottomSafePx = Math.min(bottomSafePx, rect.top);
    }
    const pad = 0.02; // small breathing room past the measured chrome, in NDC
    _uiSafeBox = {
      atMs: now,
      top: 1 - 2 * (topSafePx / vh) - pad,
      bottom: -1 + 2 * ((vh - bottomSafePx) / vh) + pad,
      left: -1 + pad,
      right: 1 - pad,
    };
    return _uiSafeBox;
  }

  // Finds the screen-locked point closest to the direction the camera would
  // need to turn to actually see the speaker. Sits at a fixed depth (see
  // EDGE_LOCK_DEPTH) so its screen position and size are fully deterministic,
  // inset first by the bubble's own half-width/half-height (at its off-screen
  // render scale) so the whole bubble — chathead included — stays inside the
  // frustum, then clamped again against the game's actual HUD chrome so nothing
  // ever renders underneath it.
  function screenEdgePoint(camera, toAnchor, bubbleHalfWidth, bubbleHalfHeight, now) {
    const THREE = state.deps.THREE;
    const localDir = toAnchor.clone().normalize().applyQuaternion(camera.quaternion.clone().invert());
    const yaw = Math.atan2(localDir.x, -localDir.z);
    const pitch = Math.atan2(localDir.y, -localDir.z);
    const halfVFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const halfHFov = Math.atan(Math.tan(halfVFov) * camera.aspect);
    const depth = EDGE_LOCK_DEPTH;
    const angularHalfWidth = (bubbleHalfWidth * EDGE_SCALE / depth) / Math.tan(halfHFov);
    const angularHalfHeight = (bubbleHalfHeight * EDGE_SCALE / depth) / Math.tan(halfVFov);
    const marginX = Math.max(EDGE_MIN_MARGIN, EDGE_PIN_MARGIN - angularHalfWidth);
    const marginY = Math.max(EDGE_MIN_MARGIN, EDGE_PIN_MARGIN - angularHalfHeight);
    const sxRaw = yaw / halfHFov;
    const syRaw = pitch / halfVFov;
    const pinScale = Math.min(marginX / Math.max(Math.abs(sxRaw), 1e-6), marginY / Math.max(Math.abs(syRaw), 1e-6));
    let sx = sxRaw * pinScale;
    let sy = syRaw * pinScale;
    const safe = uiSafeNdcBox(now);
    const safeMinX = safe.left + angularHalfWidth, safeMaxX = safe.right - angularHalfWidth;
    const safeMinY = safe.bottom + angularHalfHeight, safeMaxY = safe.top - angularHalfHeight;
    if (safeMaxX >= safeMinX) sx = THREE.MathUtils.clamp(sx, safeMinX, safeMaxX);
    if (safeMaxY >= safeMinY) sy = THREE.MathUtils.clamp(sy, safeMinY, safeMaxY);
    const local = new THREE.Vector3(sx * Math.tan(halfHFov) * depth, sy * Math.tan(halfVFov) * depth, -depth);
    return local.applyMatrix4(camera.matrixWorld);
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
    context.font = `400 ${fontPx}px ${FONT}`;
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
    context.font = `400 ${fontPx}px ${FONT}`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 8;
    context.strokeStyle = '#000';
    context.strokeText(visibleText, 15, canvas.height / 2);
    context.fillStyle = event.tone === 'jeer' ? '#ffb4a8' : event.tone === 'cheer' ? '#ffe68b' : event.tone === 'quest' ? '#c9a0ff' : '#fff6be';
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
    canvas.height = 200;
    const texture = canvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(geometry, material);
    plane.renderOrder = 1211;
    plane.frustumCulled = false;
    return { canvas, texture, geometry, material, plane, nextFrameAt: 0, busy: false };
  }

  function portraitBounds(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width, height = canvas.height;
    const pixels = context.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < 8) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return maxX < 0 ? { x: 0, y: 0, width, height }
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  function buildChatheadProfile(profile) {
    if (!profile?.fighter) return profile;
    return {
      ...profile,
      fighter: {
        ...profile.fighter,
        id: `ambient-head-only:${profile.fighter.id || 'fighter'}`,
        headUrl: String(profile.fighter.headUrl || '').replace(/([^/]+)$/, './$1'),
        bodyLayers: [],
      },
      torsoCosmetic: null,
      armCosmetic: null,
    };
  }

  function revealSchedule(text) {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.npcDialogue?.text?.typewriter || {};
    if (cfg.enabled === false) return [];
    return window.DialogueSpeechCadence?.buildSchedule(text, cfg) || [];
  }

  function disposePart(part) {
    part.plane.parent?.remove(part.plane);
    part.geometry.dispose();
    part.material.dispose();
    part.texture.dispose();
  }

  function dispose(event) {
    for (const timer of event.cadenceTimers || []) clearTimeout(timer);
    event.group.parent?.remove(event.group);
    disposePart(event.textPart);
    if (event.headPart) disposePart(event.headPart);
  }

  // Crops sourceCanvas down to its visible-pixel bounding box (padded) and
  // scales that into a square drawn onto targetContext — the composite step
  // shared by the world chathead bubble (renderChathead, below) and any 2D
  // DOM chathead icon (renderChatheadImage, exported — see its own use in
  // js/relationships-panel.js). Returns the bounds actually used.
  function compositeChatheadSquare(sourceCanvas, targetContext, size, padding = 7) {
    targetContext.clearRect(0, 0, size, size);
    targetContext.imageSmoothingEnabled = false;
    const bounds = portraitBounds(sourceCanvas);
    const sourceSize = sourceCanvas.width;
    const sx = Math.max(0, bounds.x - padding), sy = Math.max(0, bounds.y - padding);
    const sw = Math.min(sourceSize - sx, bounds.width + padding * 2);
    const sh = Math.min(sourceSize - sy, bounds.height + padding * 2);
    const drawableSize = size * 0.96;
    const scale = Math.min(drawableSize / sw, drawableSize / sh);
    const dw = sw * scale, dh = sh * scale;
    targetContext.drawImage(sourceCanvas, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return bounds;
  }

  function renderChathead(event, now, force = false) {
    if (!event.headPart || !event.profile || event.headPart.busy || (!force && now < event.headPart.nextFrameAt)) return;
    const source = event.headSource || (event.headSource = Object.assign(document.createElement('canvas'), { width: 200, height: 200 }));
    event.headPart.busy = true;
    const portraitFps = Math.max(1, Number(window.SCRATCHBONES_CONFIG?.game?.npcDialogue?.portrait?.maxFps) || 30);
    event.headPart.nextFrameAt = now + 1000 / portraitFps;
    state.renderQueue = state.renderQueue.then(async () => {
      await window.NpcAvatarPreview?.renderProfileToCanvas(source, event.chatheadProfile || event.profile, {
        seatId: event.seatId,
        breathingComposer: window.portraitBreathingComposer || null,
      });
      if (!state.active.includes(event)) return;
      // Fit every visible head/head-cosmetic pixel into the square; torso, arms,
      // and body cosmetics were omitted from the render-only profile above.
      const bounds = compositeChatheadSquare(source, event.headPart.canvas.getContext('2d'), 200);
      event.headPart.plane.userData.portraitBounds = { ...bounds }; // Mobile Pixel Probe/debug inspection hook.
      event.headPart.texture.needsUpdate = true;
    }).catch(error => state.deps?.debugLog?.(`[ambient-dialogue] chathead render failed: ${error?.message || error}`, 'warn'))
      .finally(() => { event.headPart.busy = false; });
  }

  // Renders the same head-cropped chathead image ambient dialogue shows
  // above an NPC's head, but onto an arbitrary 2D DOM <canvas> instead of a
  // 3D world plane — for UI lists that want an NPC's chathead as their row
  // icon (see js/relationships-panel.js). One-shot, not on the ambient
  // render queue/FPS throttle (those exist to spread cost across many
  // simultaneously-talking NPCs in the world; a UI list renders a handful
  // of icons once each). Resolves true on success, false if there was
  // nothing to render.
  async function renderChatheadImage(targetCanvas, profile, options = {}) {
    if (!targetCanvas || !profile || !window.NpcAvatarPreview?.renderProfileToCanvas) return false;
    const source = Object.assign(document.createElement('canvas'), { width: 200, height: 200 });
    await window.NpcAvatarPreview.renderProfileToCanvas(source, buildChatheadProfile(profile), {
      seatId: options.seatId,
      forceEyesOpen: true,
    });
    compositeChatheadSquare(source, targetCanvas.getContext('2d'), targetCanvas.width || 200);
    return true;
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
    const headWidth = headPart ? state.settings.chatheadWorldSize : 0;
    const gap = headPart ? state.settings.chatheadWorldSize * 0.14 : 0; // Used below to reproduce the demo's 7–14 px gap relative to its 60–90 px head.
    const totalWidth = headWidth + gap + textWidth;
    textPart.plane.position.x = -totalWidth / 2 + headWidth + gap + textWidth / 2;
    if (headPart) headPart.plane.position.x = -totalWidth / 2 + headWidth / 2;
    scene.add(group);
    const now = performance.now();
    const event = {
      root, group, textPart, headPart, profile: options.profile || null,
      chatheadProfile: headPart ? buildChatheadProfile(options.profile) : null,
      faceWalker: options.faceWalker || null,
      faceTarget: options.faceTarget || null,
      speakerId: options.speakerId || null,
      greeting: options.greeting === true,
      directedAtPlayer: options.directedAtPlayer === true,
      // Bubble's own half-width/half-height in world units (the chathead
      // included), so the off-screen edge follow can inset by the bubble's
      // actual footprint instead of just its center pivot.
      bubbleHalfWidth: totalWidth / 2,
      bubbleHalfHeight: Math.max(state.settings.textWorldHeight, headWidth) / 2,
      displayPos: null,
      displayScale: 1,
      seatId: `ambient:${options.speakerId || 'speaker'}:${Math.round(now)}`,
      tone: options.tone || 'greeting', startedAt: now,
      durationMs: Number(options.durationMs) || state.settings.durationMs,
      revealSchedule: revealSchedule(message), // Shared syllable cadence keeps text and mouth pulses synchronized.
      cadenceTimers: [],
      visibleChars: -1,
    };
    state.active.push(event);
    drawText(event, '');
    if (!event.revealSchedule.length) {
      drawText(event, message);
    } else {
      let visibleText = '';
      for (const unit of event.revealSchedule) {
        event.cadenceTimers.push(setTimeout(() => {
          if (!state.active.includes(event)) return;
          visibleText += unit.text;
          drawText(event, visibleText);
        }, unit.revealAtMs));
        for (let index = 0; index < unit.vowels.length; index++) {
          const pulseAtMs = unit.revealAtMs + (unit.pulseOffsetsMs[index] || 0);
          event.cadenceTimers.push(setTimeout(() => {
            if (!state.active.includes(event)) return;
            window.DialogueContent?.playSpeechTick?.(unit.vowels[index], event.profile);
            if (event.headPart) window.portraitBreathingComposer?.triggerYap(event.seatId);
          }, pulseAtMs));
        }
      }
    }
    if (headPart) {
      renderChathead(event, now, true);
    }
    window.dispatchEvent(new CustomEvent('hobunji-ambient-dialogue', { detail: { speakerId: options.speakerId || null, text: message, mode, tone: event.tone } }));
    return event;
  }

  function updateActive(now) {
    const camera = state.deps?.camera;
    if (!camera) return;
    const dt = state.lastActiveUpdateAt != null ? Math.min(0.1, Math.max(0, (now - state.lastActiveUpdateAt) / 1000)) : 0;
    state.lastActiveUpdateAt = now;
    for (let index = state.active.length - 1; index >= 0; index--) {
      const event = state.active[index];
      const progress = (now - event.startedAt) / event.durationMs;
      const anchor = anchorFor(event.root);
      if (!anchor || progress >= 1) {
        dispose(event);
        state.active.splice(index, 1);
        continue;
      }
      if (event.directedAtPlayer) {
        // Ambient speech aimed at the player stays reachable even when the
        // speaker is off-screen: it shrinks and eases into a fixed,
        // screen-locked spot on whichever edge is closest to them (fully
        // clear of the HUD, chathead included), then eases back out to full
        // size at its true position above their head the moment that
        // position re-enters view.
        const visibility = cameraVisibility(anchor, camera);
        const targetScale = visibility.onScreen ? 1 : EDGE_SCALE;
        const targetPos = visibility.onScreen ? anchor
          : screenEdgePoint(camera, visibility.toAnchor, event.bubbleHalfWidth, event.bubbleHalfHeight, now);
        if (!event.displayPos) {
          event.displayPos = targetPos.clone();
          event.displayScale = targetScale;
        } else {
          const alpha = dt > 0 ? 1 - Math.exp(-EDGE_LERP_SPEED * dt) : 1;
          event.displayPos.lerp(targetPos, alpha);
          event.displayScale += (targetScale - event.displayScale) * alpha;
        }
        event.group.position.copy(event.displayPos);
        event.group.scale.setScalar(event.displayScale);
      } else {
        event.group.position.copy(anchor);
      }
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

  function hasActiveGreetingFor(speakerId) {
    return state.active.some(event => event.greeting && event.speakerId === speakerId);
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

  function tryGreeting(walker, target, now, day, override = null) {
    const speakerId = walker?.rec?.id;
    if (!speakerId || walker.area !== state.deps.getCurrentArea()) return false;
    if (window.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(speakerId)) return false;
    // The active event remains in this list through its final opacity fade,
    // so this releases the NPC only after the prior greeting is fully gone.
    if (hasActiveGreetingFor(speakerId)) return false;
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
    // A pending-request override (see getPendingRequestGreeting) replaces the
    // ordinary nickname-templated line with the quest-giver's own purple
    // call-over line, so it can't be mistaken for a random ambient greeting.
    const targetName = resolveTargetName(walker, target); // Used so {targetName} follows main-dialogue player nicknames or directional NPC family nicknames.
    const line = override?.text || templateLine(targetName, speakerId, targetId, day);
    show(walker.root, line, {
      speakerId,
      profile: walker.profile,
      mode: 'chathead',
      greeting: true,
      tone: override ? 'quest' : undefined,
      durationMs: override ? Math.max(state.settings.durationMs, 5600) : undefined,
      directedAtPlayer: targetId === 'player',
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
        const questLine = state.deps.getPendingRequestGreeting?.(walker.rec?.id);
        const override = questLine ? { text: questLine } : null;
        if (tryGreeting(walker, { id: 'player', name: state.deps.getPlayerName?.() || 'neighbor', ...player }, now, day, override)) return;
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
      durationMs: 3600,
      tone: 'companion',
    });
  }

  function crowd(root, tone = 'cheer', options = {}) {
    const normalizedTone = tone === 'jeer' ? 'jeer' : 'cheer';
    const lines = options.lines || state.settings.crowdLines[normalizedTone];
    return show(root, options.text || pick(lines), { ...options, mode: 'overhead', tone: normalizedTone });
  }

  function alcoholConditionWorld(walker) {
    return {
      weekdays: state.deps?.getWeekDay?.(state.deps?.getDay?.()),
      seasons: state.deps?.getSeason?.(),
      weather: state.deps?.getWeather?.(),
      timesOfDay: state.deps?.getDayPart?.(),
      maps: state.deps?.getCurrentArea?.(),
      stations: walker?.currentScheduleTarget?.activity || walker?.currentScheduleTarget?.label || null,
      playerSpecies: state.deps?.getPlayerSpecies?.(),
      relationship: state.deps?.getNpcRelationship?.(walker?.rec?.id),
    };
  }

  function resolveAlcoholOffer(walker) {
    const fallback = state.settings.npcAlcoholOffers?.default || DEFAULTS.npcAlcoholOffers.default;
    const authored = state.settings.npcAlcoholOffers?.[walker?.rec?.id] || {};
    const cfg = { ...fallback, ...authored };
    const mode = cfg.acceptMode === 'never' ? 'never' : cfg.acceptMode === 'conditional' ? 'conditional' : 'always';
    const accepted = mode === 'always' || (mode === 'conditional'
      && (window.ConditionRegistry?.entryEligible?.({ conditions: cfg.acceptConditions || {} }, alcoholConditionWorld(walker)) ?? true));
    const lines = accepted ? cfg.acceptLines : cfg.refuseLines;
    return {
      accepted,
      text: pick(lines, `${walker?.rec?.id || 'npc'}:${state.deps?.getDay?.() || 1}:${accepted ? 'accept' : 'refuse'}`),
      config: structuredCloneSafe(cfg),
    };
  }

  function showAlcoholOfferResponse(walker, response = resolveAlcoholOffer(walker)) {
    if (!walker?.root || !response?.text) return null;
    // Explicit interaction speech replaces that speaker's incidental greeting
    // so the accepted/refused line is never hidden under a second chathead.
    for (let index = state.active.length - 1; index >= 0; index--) {
      if (state.active[index].speakerId !== walker.rec?.id) continue;
      dispose(state.active[index]);
      state.active.splice(index, 1);
    }
    const player = state.deps?.getPlayerPosition?.();
    if (player) {
      const angle = -Math.atan2(player.z - walker.root.position.z, player.x - walker.root.position.x) + Math.PI / 2;
      walker.applyFacingDeadzone?.(angle, 0.34);
    }
    return show(walker.root, response.text, {
      speakerId: walker.rec?.id,
      profile: walker.profile,
      mode: 'chathead',
      durationMs: state.settings.durationMs,
      tone: response.accepted ? 'accept' : 'refuse',
      directedAtPlayer: true,
      faceWalker: walker,
      faceTarget: player || null,
    });
  }

  // updateGreetings does an O(walkers^2) friend-pair scan; nothing about
  // when a greeting is allowed to fire depends on checking every single
  // frame (tryGreeting already cooldown-gates on state.lastGreetingAt in
  // the seconds range), so it's throttled to ~5Hz here — imperceptible
  // against that cooldown, but cuts the scan rate by roughly 90%+ at 60fps.
  let _lastGreetingsScan = 0;
  function update(now = performance.now()) {
    updateActive(now);
    if (now - _lastGreetingsScan >= 200) {
      _lastGreetingsScan = now;
      updateGreetings(now);
    }
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

  const api = {
    init,
    update,
    show,
    companionTreasure,
    crowd,
    cheer: (root, options) => crowd(root, 'cheer', options),
    jeer: (root, options) => crowd(root, 'jeer', options),
    resolveAlcoholOffer,
    showAlcoholOfferResponse,
    clear,
    loadSettings,
    resolveTargetName,
    renderChatheadImage,
  };
  window.AmbientDialogue = api;
})();

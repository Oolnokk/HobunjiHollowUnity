// Real Testing Arena precreator: an isolated guest runs normal game avatar/gear systems.
// Installed FIRST in index.html. Every Storage/IndexedDB write is quarantined before any
// game script can touch a saved farmer; no rollback-on-exit or save restoration is required.
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('previewArena') !== '1' || window.HobunjiPrecreatorArena) return;

  const ARENA = 'map_dev_arena'; // DevSpawner's existing combat/testing zone.
  const YAW_CHANNEL = 'precreator-temporary-facing'; // Native PlayerBodyTransformComposer, including real held-gear attachments.
  const CAMERA_ID = 'precreator-locked-camera'; // One CinematicCameraRuntime shot, not a second Three.js renderer.
  const VIEW = { x: 2.25, y: 1.9, z: 3.2 }; // Fixed angled view; only translation/panning can change.
  const PAN_LIMIT = 2.5; // Keep the preview view inside the arena's central floor.
  const INPUT_DEADZONE = 0.16; // Ignore small gamepad stick jitter.
  const GAMEPAD_YAW_RATE = 2.4; // Radians of character yaw per second on the right stick.
  const GAMEPAD_PAN_RATE = 1.7; // World units per second camera pan from left stick or keyboard.
  const guestId = 'preview_farmer_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); // Collision-proof ephemeral actor/world.
  const dbPrefix = 'hobunji-precreator-' + guestId + ':'; // Dedicated per-visit IndexedDB databases; real DBs are never opened.
  const shadowLocal = new Map(), shadowSession = new Map(); // Every preview Storage key is virtual, not from real saves.
  const previewDbs = new Set(); // Names of temporary databases, for best-effort cleanup on page exit.
  const originalLocal = window.localStorage; // Used only for read-only diagnostic key count.
  const originalSession = window.sessionStorage; // Captured before installing the virtual stores.
  const originalDb = window.indexedDB; // Native factory, called only with namespaced database names.
  const readPads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : null; // Real axes reserved for pan/turn before neutralizing game input.
  const pressed = new Set(); // Keyboard camera-pan keys, intercepted in the capture phase.
  const pointerPositions = new Map(); // Mouse/touch turns the real avatar; two-finger gesture translates camera.
  let lastMidpoint = null; // Last two-pointer camera pan center.
  let previewReady = false; // Native actor spawned and arena entered.
  let entering = false; // Prevent repeat Testing Arena teleports while scene transition is underway.
  let panel = null; // One persistent mobile-friendly controls card.
  let lockedShot = null; // Our active actual-game cinematic camera record.
  let playerYaw = Math.atan2(VIEW.x, VIEW.z); // Initial facing towards the fixed camera.
  let panX = 0, panZ = 0; // Camera target offset; never edits player position.
  let currentSpecies = 'mao-ao', currentGender = 'male'; // Displayed guest identity, never a save.
  let currentOutfit = [], currentTool = null; // Visual-only diagnostic labels for real currently equipped assets.
  let building = false; // Prevents overlapping asynchronous avatar rebuilds.
  let errors = ''; // On-screen error report available without browser devtools.
  let frameIndex = 0, frameLastTime = 0; // Throttled debug display and frame-independent gamepad camera motion.
  let stopPreviewFrame = null; // Owns the one shared scheduler subscription; removed on exit.

  function isolatedStorage(map) {
    const api = { // Real Storage methods mirrored with a Map, including bracket notation.
      getItem: key => map.get(String(key)) ?? null,
      setItem: (key, value) => { map.set(String(key), String(value)); },
      removeItem: key => { map.delete(String(key)); },
      clear: () => map.clear(),
      key: i => [...map.keys()][Number(i)] ?? null,
    };
    return new Proxy(api, {
      get(target, prop) {
        if (prop === 'length') return map.size;
        return Object.prototype.hasOwnProperty.call(target, prop) ? target[prop] : map.get(String(prop));
      },
      set(_target, prop, value) { if (typeof prop === 'string') map.set(prop, String(value)); return true; },
      deleteProperty(_target, prop) { if (typeof prop === 'string') map.delete(prop); return true; },
      has(target, prop) { return Object.prototype.hasOwnProperty.call(target, prop) || map.has(String(prop)); },
      ownKeys: target => [...Reflect.ownKeys(target), ...map.keys()],
      getOwnPropertyDescriptor(target, prop) {
        const own = Reflect.getOwnPropertyDescriptor(target, prop);
        return own || (map.has(prop) ? { enumerable: true, configurable: true, writable: true, value: map.get(prop) } : undefined);
      },
    });
  }

  function secureBoot() {
    // If any protected API cannot be redirected, DO NOT launch a guest or overwrite saved data.
    for (const prop of ['localStorage', 'sessionStorage', 'indexedDB']) {
      const desc = Object.getOwnPropertyDescriptor(window, prop);
      if (desc && !desc.configurable) throw new Error('Browser disallows protected ' + prop + ' storage.');
    }
    const local = isolatedStorage(shadowLocal), session = isolatedStorage(shadowSession);
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => local });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => session });
    if (originalDb) {
      const facade = {
        open(name, version) {
          const isolatedName = dbPrefix + String(name);
          previewDbs.add(isolatedName);
          return version === undefined ? originalDb.open(isolatedName) : originalDb.open(isolatedName, version);
        },
        deleteDatabase(name) {
          const isolatedName = dbPrefix + String(name);
          previewDbs.delete(isolatedName);
          return originalDb.deleteDatabase(isolatedName);
        },
        cmp: (...args) => originalDb.cmp(...args),
        databases: async () => typeof originalDb.databases === 'function'
          ? (await originalDb.databases()).filter(db => previewDbs.has(db.name))
            .map(db => ({ ...db, name: db.name.slice(dbPrefix.length) })) : [],
      };
      Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => facade });
    }
  }
  try { secureBoot(); }
  catch (error) {
    // A partial Storage replacement is still ephemeral; critically we never seed the live game.
    const failure = String(error?.message || error);
    document.addEventListener('DOMContentLoaded', () => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#1d3027;color:#fff;padding:22px;font:16px system-ui';
      wrapper.textContent = 'Preview blocked to protect your existing saves: ' + failure + '.';
      const link = document.createElement('a'); link.href = 'index.html';
      link.textContent = ' Return to character selection'; link.style.cssText = 'display:block;color:#f8d890;margin-top:20px';
      wrapper.append(link); document.body.append(wrapper);
    });
    return;
  }

  const guest = { // Same runtime profile shape used by actual browser gameplay smoke tests; never entered into SaveMeta.
    playerId: guestId, characterId: guestId, worldId: guestId,
    worldLabel: 'Temporary Testing Arena', worldOwnerCharacterId: guestId,
    isWorldOwner: true, nickname: 'Preview Farmer', isNewWorld: false,
    farmhandPermissions: {}, nonGearInventory: {}, packClothing: [],
    npcRelationships: {}, questProgress: {}, equippedCosmetics: ['pants_basic'],
    appliedDyes: {}, appearance: { speciesId: currentSpecies, gender: currentGender, cosmetics: {} },
  };
  window.__hobunjiPlayerProfile = guest;
  window.__hobunjiPrecreatorArena = { guestId, temporary: true, storageIsolated: true }; // Existing onboarding guard skips persistent character creation.
  window.addEventListener('pagehide', () => {
    window.PlayerBodyTransformComposer?.clearChannel?.(YAW_CHANNEL);
    if (window.CinematicCameraRuntime?.activeRecord?.() === lockedShot) window.CinematicCameraRuntime.deactivate();
    stopPreviewFrame?.(); // The real game scheduler keeps running; only this guest input subscriber goes away.
    stopPreviewFrame = null;
    for (const name of previewDbs) try { originalDb?.deleteDatabase(name); } catch (_) {}
  });

  const $ = id => document.getElementById(id); // All ids belong to the precreator panel.
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v)); // Preview pan is bounded.
  const random = a => a[Math.floor(Math.random() * a.length)]; // Pick authored cosmetics and tool definitions.
  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/_/g, '-'); // Game's species naming convention.
  const getArea = () => window.DevSpawner?.spawnSnapshot?.()?.currentArea || null; // Real game area, no guessed map.
  function show(text, error = false) {
    if (error) errors = String(text);
    if ($('precreatorArenaStatus')) $('precreatorArenaStatus').textContent = String(text);
    debugUpdate();
  }

  function actorAnchor() {
    const root = window.PlayerBodyTransformComposer?.getPlayerMesh?.();
    if (root?.getWorldPosition && window.THREE?.Vector3) {
      const point = root.getWorldPosition(new window.THREE.Vector3());
      return { x: point.x, y: point.y, z: point.z };
    }
    return { x: 10, y: 0, z: 10 }; // Only during initial boot, before the native rig is available.
  }
  function cameraTarget() {
    const a = actorAnchor();
    return { x: a.x + panX, y: a.y + 0.55, z: a.z + panZ };
  }
  function cameraPosition() {
    const t = cameraTarget();
    return { x: t.x + VIEW.x, y: t.y + VIEW.y, z: t.z + VIEW.z };
  }
  function lockCamera() {
    if (!window.CinematicCameraRuntime?.activate) return false;
    lockedShot = window.CinematicCameraRuntime.activate(ARENA, {
      id: 'precreator-arena-fixed-angle', label: 'Preview camera', fovDeg: 39, blendSeconds: 0,
      position: cameraPosition(), target: cameraTarget(), positionProvider: cameraPosition,
      targetProvider: cameraTarget, horizontalCameraCollision: false,
    }, { reason: CAMERA_ID });
    return !!lockedShot;
  }
  function turn(delta) {
    if (!previewReady || !Number.isFinite(delta)) return;
    playerYaw += delta;
    window.PlayerBodyTransformComposer?.setChannel?.(YAW_CHANNEL, {
      priority: 1000, space: 'world', mode: 'override', absoluteYaw: playerYaw,
      includePlayer: true, includeExternal: true,
    }); // Composes body, native hand rigs, feet and held tool in the game renderer without accumulating transforms.
  }
  function pan(dx, dz) {
    panX = clamp(panX + dx, -PAN_LIMIT, PAN_LIMIT);
    panZ = clamp(panZ + dz, -PAN_LIMIT, PAN_LIMIT);
  }
  function resetView() {
    panX = panZ = 0;
    const baseline = Math.atan2(VIEW.x, VIEW.z);
    if (previewReady) turn(baseline - playerYaw); else playerYaw = baseline;
    debugUpdate();
  }
  function speciesOptions() {
    const data = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor || {};
    return Object.entries(data.availability || {}).map(([id, rec]) => {
      const genders = (Array.isArray(rec?.genders) ? rec.genders : []).filter(g => g === 'male' || g === 'female');
      return { id: normalizeSpecies(id), label: data.species?.[normalizeSpecies(id)]?.label ||
        normalizeSpecies(id).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), genders };
    }).filter(x => x.genders.length);
  }
  function selectGenders(old = currentGender) {
    const item = speciesOptions().find(x => x.id === $('precreatorSpecies')?.value);
    const sel = $('precreatorGender');
    if (!sel || !item) return;
    sel.replaceChildren();
    for (const g of item.genders) sel.add(new Option(g[0].toUpperCase() + g.slice(1), g));
    sel.value = item.genders.includes(old) ? old : item.genders[0];
  }
  function populateSpecies() {
    const sel = $('precreatorSpecies'), items = speciesOptions();
    sel.replaceChildren();
    for (const item of items) sel.add(new Option(item.label, item.id));
    sel.value = items.some(x => x.id === currentSpecies) ? currentSpecies : items[0]?.id || '';
    selectGenders();
  }
  function makeGarment(record, slot) {
    const colors = ['#987b60', '#678c79', '#bd986e', '#9c6c82', '#6c7fa4', '#6b8958'];
    return {
      uid: 'precreator-gear-' + slot + '-' + Math.random().toString(36).slice(2, 8),
      cosmeticId: record.id, slot, label: String(record.label || record.id),
      colorA: { hex: random(colors), tintMode: 'hexShadeFill' },
      colorB: { hex: random(colors), tintMode: 'hexShadeFill' },
      sprite: window.EquipmentPanel?.clothingSpriteForCosmetic?.(record.id) || null,
    };
  }
  function garmentsFor(slot) {
    return (window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [])
      .filter(x => x?.id && x.category === slot
        && (!x.species || normalizeSpecies(x.species) === currentSpecies)
        && (!x.gender || x.gender === currentGender));
  }
  async function randomClothes(nested = false) {
    if (!previewReady || (building && !nested)) return false;
    if (!nested) building = true;
    show('Equipping native garment meshes and pants…');
    try {
      const gear = window.EquipmentPanel?.devWornClothing?.();
      if (!gear) throw new Error('Game clothing inventory is not ready.');
      const chosen = [];
      for (const slot of ['pants', 'torso', 'overwear', 'hat', 'hood', 'mask', 'pauldron']) {
        const items = garmentsFor(slot);
        const validPants = slot !== 'pants' || !!window.PantsGarmentRenderer?.hasRigFor?.(currentSpecies, currentGender);
        if (!validPants || !items.length || (slot !== 'pants' && Math.random() < (slot === 'torso' ? 0.04 : 0.50))) {
          gear[slot] = null; continue;
        }
        const item = makeGarment(random(items), slot);
        gear[slot] = item;
        chosen.push(item.label);
      }
      if (!gear.pants && window.PantsGarmentRenderer?.hasRigFor?.(currentSpecies, currentGender)) {
        const id = currentSpecies === 'mao-ao' && currentGender === 'female' ? 'layered_skirt' : 'pants_basic';
        gear.pants = makeGarment({ id, label: id === 'pants_basic' ? 'Basic pants' : 'Layered skirt' }, 'pants');
        chosen.push(gear.pants.label);
      }
      await window.EquipmentPanel.refreshPlayerAvatar(); // The full actual game assembly: skinned neck/head, hands, two-bone legs, feet and deforming pants.
      currentOutfit = chosen;
      show('Wearing ' + (chosen.join(', ') || 'no fitted garments'));
      return true;
    } catch (error) { show('Clothing failed: ' + (error?.message || error), true); return false; }
    finally { if (!nested) building = false; debugUpdate(); }
  }
  async function changeIdentity() {
    if (!previewReady || building) return;
    const species = $('precreatorSpecies')?.value, gender = $('precreatorGender')?.value;
    if (!speciesOptions().some(x => x.id === species && x.genders.includes(gender))) {
      show('Unsupported species/gender selection', true); return;
    }
    building = true;
    show('Reassembling real character rig: ' + species + ' ' + gender + '…');
    try {
      if (!await window.DevArenaPondDummy?.previewApplyAppearance?.(species, gender))
        throw new Error('Live arena character rebuild failed');
      currentSpecies = species; currentGender = gender;
      await randomClothes(true);
      resetView();
      show('Ready: native ' + species + ' / ' + gender + ' with re-equipped real garment rig');
    } catch (error) { show('Appearance failed: ' + (error?.message || error), true); }
    finally { building = false; debugUpdate(); }
  }
  function randomTool() {
    if (!previewReady || building) return false;
    const choices = window.DevArenaPondDummy?.previewToolChoices?.() || [];
    if (!choices.length) { show('No authored tool definitions available', true); return false; }
    const selected = window.DevArenaPondDummy.previewEquipTool(random(choices).key);
    if (!selected) { show('Could not attach actual held tool', true); return false; }
    currentTool = selected;
    show('Equipped ' + selected.label + ' (' + selected.slot + ') on the real hand/tool rig');
    return true;
  }
  function debugUpdate() {
    const element = $('precreatorArenaDebug');
    if (!element) return;
    const body = window.PlayerBodyTransformComposer;
    const root = body?.getPlayerMesh?.(), feet = body?.getPlayerLegHandle?.();
    const pantsCount = window.PantsGarmentRenderer?.liveHandles?.()?.length ?? 0;
    element.textContent = [
      'Zone: ' + (getArea() || 'loading'),
      'Guest: ' + guestId + ' · no save or world created',
      'Storage: isolated (' + shadowLocal.size + ' local / ' + shadowSession.size + ' session writes)',
      'IndexedDB: ' + previewDbs.size + ' isolated DB names',
      'Body and neck: ' + (root ? root.name || 'runtime attached' : 'not yet ready'),
      'Procedural bones/feet: ' + (feet ? 'live' : 'not yet ready'),
      'Pants rig handles: ' + pantsCount,
      'Hand rigs: ' + (window.ProceduralHandAttachments?.getActiveDebug?.()?.length ?? 0),
      'Tool: ' + (currentTool?.label || 'none'),
      'Outfit: ' + (currentOutfit.join(', ') || 'none'),
      'Camera: locked angled, pan ' + panX.toFixed(2) + ' / ' + panZ.toFixed(2),
      'Body yaw: ' + (playerYaw * 180 / Math.PI).toFixed(1) + '°',
      'Frames: ' + frameIndex,
      errors ? 'Error: ' + errors : '',
    ].filter(Boolean).join('\n');
  }

  function twoFingerCenter() {
    const pts = [...pointerPositions.values()];
    return pts.length < 2 ? null : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  function previewGesture(event) {
    const scenePointer = event.target?.closest?.('#canvasWrap');
    if (!previewReady || (!scenePointer && !pointerPositions.has(event.pointerId))) return;
    if (event.type === 'pointerdown') {
      if (event.button != null && event.button !== 0) return;
      pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
      lastMidpoint = twoFingerCenter();
    } else if (event.type === 'pointermove' && pointerPositions.has(event.pointerId)) {
      const old = pointerPositions.get(event.pointerId), dx = event.clientX - old.x, dy = event.clientY - old.y;
      pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointerPositions.size >= 2) {
        const center = twoFingerCenter();
        if (center && lastMidpoint) pan((lastMidpoint.x - center.x) * 0.010, (lastMidpoint.y - center.y) * 0.010);
        lastMidpoint = center;
      } else if (event.shiftKey) pan(-dx * 0.010, -dy * 0.010);
      else turn(dx * 0.012);
    } else if (event.type === 'pointerup' || event.type === 'pointercancel') {
      pointerPositions.delete(event.pointerId);
      lastMidpoint = twoFingerCenter();
    }
    event.preventDefault();
    event.stopImmediatePropagation(); // Suppress default attack and pointer-lock while rotating the test character.
  }
  function previewKeys(event) {
    if (!previewReady || event.target?.closest?.('input,select,button,a,textarea')) return;
    const key = String(event.key || '').toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) return;
    if (event.type === 'keydown') pressed.add(key); else pressed.delete(key);
    event.preventDefault(); event.stopImmediatePropagation();
  }
  function isolateInput() {
    if (readPads) try {
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value() {
        return Array.from(readPads() || [], pad => {
          if (!pad) return null;
          const axes = Array.from(pad.axes || []);
          for (let i = 0; i < Math.min(axes.length, 4); i++) axes[i] = 0; // Game sees no movement/camera input.
          return new Proxy(pad, { get(obj, prop) {
            if (prop === 'axes') return axes;
            const value = Reflect.get(obj, prop, obj);
            return typeof value === 'function' ? value.bind(obj) : value;
          } });
        });
      } });
    } catch (_) { show('Controller input could not be fully isolated', true); }
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
      window.addEventListener(event, previewGesture, { capture: true, passive: false });
    for (const event of ['keydown', 'keyup'])
      window.addEventListener(event, previewKeys, { capture: true });
    window.addEventListener('blur', () => { pressed.clear(); pointerPositions.clear(); });
    document.documentElement.classList.add('precreator-guest-active');
  }
  function frame(time) {
    if (!previewReady) return;
    const dt = Math.min((time - (frameLastTime || time)) / 1000, 0.045);
    frameLastTime = time;
    let dx = Number(pressed.has('d') || pressed.has('arrowright')) - Number(pressed.has('a') || pressed.has('arrowleft'));
    let dz = Number(pressed.has('s') || pressed.has('arrowdown')) - Number(pressed.has('w') || pressed.has('arrowup'));
    let turnInput = 0;
    for (const pad of readPads?.() || []) {
      if (!pad?.axes || pad.axes.length < 4) continue;
      const axis = index => Math.abs(pad.axes[index] || 0) > INPUT_DEADZONE ? pad.axes[index] : 0;
      dx += axis(0); dz += axis(1); turnInput += axis(2);
    }
    const scale = Math.max(1, Math.hypot(dx, dz));
    if (dx || dz) pan(dx * dt * GAMEPAD_PAN_RATE / scale, dz * dt * GAMEPAD_PAN_RATE / scale);
    if (turnInput) turn(turnInput * dt * GAMEPAD_YAW_RATE);
    frameIndex++;
    if (frameIndex % 30 === 0) {
      if (window.CinematicCameraRuntime?.activeRecord?.() !== lockedShot) lockCamera();
      debugUpdate();
    }
  }
  function selectTab(name) {
    $('precreatorAppearance').hidden = name !== 'appearance';
    $('precreatorControls').hidden = name !== 'controls';
    $('precreatorTabAppearance').setAttribute('aria-selected', String(name === 'appearance'));
    $('precreatorTabControls').setAttribute('aria-selected', String(name === 'controls'));
    debugUpdate();
  }
  function mountPanel() {
    if (panel) return;
    const style = document.createElement('style');
    style.textContent =
      'html.precreator-guest-active #canvasWrap{touch-action:none}' +
      '#precreatorArenaPanel{position:fixed;right:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:100040;width:min(345px,calc(100vw - 24px));background:#1b3329f4;border:1px solid #7c9f86;color:#f3efda;border-radius:13px;box-shadow:0 12px 42px #000a;font:13px/1.4 system-ui;overflow:hidden}' +
      '#precreatorArenaPanel *{box-sizing:border-box}#precreatorArenaPanel .pa-h{display:flex;justify-content:space-between;gap:8px;padding:9px 11px;background:#2a4b37}' +
      '#precreatorArenaPanel .pa-h a{color:#f9d88f}#precreatorArenaPanel .pa-tabs{display:flex}#precreatorArenaPanel .pa-tabs button{flex:1}' +
      '#precreatorArenaPanel button,#precreatorArenaPanel select{font:inherit;color:#f4f0e2;background:#315640;border:1px solid #87a588;border-radius:7px;padding:9px;min-height:43px;min-width:0}' +
      '#precreatorArenaPanel button[aria-selected=true]{background:#52785d}#precreatorArenaPanel .pa-p{padding:10px;display:grid;gap:8px}' +
      '#precreatorArenaPanel .pa-r{display:grid;grid-template-columns:1fr 1fr;gap:8px}#precreatorArenaPanel label{display:grid;gap:4px}' +
      '#precreatorArenaPanel .pa-t{font-size:12px;opacity:.83}#precreatorArenaPanel .pa-status,#precreatorArenaDebug{white-space:pre-wrap;overflow-wrap:anywhere;background:#10251c;padding:8px;border-radius:7px}' +
      '#precreatorArenaPanel [hidden]{display:none!important}#precreatorArenaPanel :focus-visible{outline:3px solid #f9d685;outline-offset:2px}' +
      '@media(max-width:600px){#precreatorArenaPanel{right:8px;bottom:max(8px,env(safe-area-inset-bottom));width:min(312px,calc(100vw - 16px))}}';
    document.head.appendChild(style);
    panel = document.createElement('aside');
    panel.id = 'precreatorArenaPanel'; panel.setAttribute('aria-label', 'Temporary Testing Arena character preview');
    panel.innerHTML = [
      '<div class="pa-h"><strong>🧪 Real Arena Preview</strong><a href="index.html">Exit · no save</a></div>',
      '<div class="pa-tabs" role="tablist"><button id="precreatorTabAppearance" role="tab" aria-selected="true" aria-controls="precreatorAppearance">Appearance</button>',
      '<button id="precreatorTabControls" role="tab" aria-selected="false" aria-controls="precreatorControls">Controls / Debug</button></div>',
      '<div id="precreatorAppearance" class="pa-p" role="tabpanel"><div class="pa-r"><label>Species<select id="precreatorSpecies"></select></label>',
      '<label>Gender<select id="precreatorGender"></select></label></div><div class="pa-r">',
      '<button id="precreatorOutfit" type="button">🎲 Random clothes</button><button id="precreatorTool" type="button">🎲 Random tool</button></div>',
      '<button id="precreatorReset" type="button">Center camera / character</button>',
      '<div id="precreatorArenaStatus" class="pa-status" role="status" aria-live="polite">Preparing real game engine…</div></div>',
      '<div id="precreatorControls" class="pa-p" role="tabpanel" hidden>',
      '<div class="pa-t">Actual Testing Arena and game character: skinned portrait and neck, native hands, bones, feet, pants, and held weapons.',
      ' Drag or use one finger to turn the farmer. Shift+drag or two fingers pan. Right stick turns; left stick, WASD, or arrows pan.',
      ' Camera stays at a fixed three-quarter angle. This visit never creates a save.</div>',
      '<button id="precreatorDebugCopy" type="button">Copy live rig report</button><div id="precreatorArenaDebug"></div></div>',
    ].join('');
    document.body.appendChild(panel);
    $('precreatorTabAppearance').addEventListener('click', () => selectTab('appearance'));
    $('precreatorTabControls').addEventListener('click', () => selectTab('controls'));
    $('precreatorSpecies').addEventListener('change', () => { selectGenders(); changeIdentity(); });
    $('precreatorGender').addEventListener('change', changeIdentity);
    $('precreatorOutfit').addEventListener('click', () => randomClothes());
    $('precreatorTool').addEventListener('click', randomTool);
    $('precreatorReset').addEventListener('click', resetView);
    $('precreatorDebugCopy').addEventListener('click', async () => {
      debugUpdate();
      try { await navigator.clipboard.writeText($('precreatorArenaDebug').textContent); show('Rig report copied.'); }
      catch (_) { show('Clipboard unavailable; the diagnostic report is visible here.', true); }
    });
  }
  function boot() {
    mountPanel();
    show('Booting isolated farmer with real game code…');
    let checks = 0; // Poll only during boot, never a permanent 100ms game-loop scan.
    const watcher = setInterval(() => {
      checks++;
      if (window.__hobunjiGameStarted === true && !entering && window.DevSpawner?.teleportToDevArena) {
        entering = true;
        window.DevSpawner.teleportToDevArena(); // Uses the actual arena floor, terrain and renderer.
      }
      if (entering && getArea() === ARENA && window.DevArenaPondDummy?.previewApplyAppearance
        && window.EquipmentPanel?.refreshPlayerAvatar && window.PlayerBodyTransformComposer?.getPlayerMesh?.()) {
        previewReady = true;
        clearInterval(watcher);
        populateSpecies();
        lockCamera();
        isolateInput();
        turn(0);
        show('Real Testing Arena ready. Equipping a real starter outfit…');
        randomClothes(); // Dress the initial guest in the same native deforming pants as subsequent rerolls.
        debugUpdate();
        const scheduler = window.RuntimeFrameScheduler; // Join the existing gameplay frame, never start a second RAF owner.
        if (!scheduler?.register) {
          show('Native frame scheduler unavailable; preview input could not start.', true);
        } else {
          stopPreviewFrame = scheduler.register('precreator-arena-preview', ctx => frame(ctx.timestamp), {
            phase: 'pre-game', owner: 'HobunjiPrecreatorArena',
            description: 'Temporary Testing Arena camera pan and native character yaw; disabled outside preview mode',
          });
        }
      } else if (checks > 700) {
        clearInterval(watcher);
        show('Arena failed to initialize: game=' + (window.__hobunjiGameStarted === true) + ', area=' + getArea() +
          ', teleport=' + entering + '. Existing saves remain untouched.', true);
      }
    }, 100);
    // The title input gate must be dismissed for pre-character-select previews.
    setTimeout(() => window.HobunjiTitleScreen?.start?.(), 90);
  }

  window.HobunjiPrecreatorArena = Object.freeze({
    version: 2, guestId, resetView, randomClothes, randomTool, changeIdentity,
    getDebug: () => ({ ready: previewReady, entering, area: getArea(), guestId,
      species: currentSpecies, gender: currentGender, tool: currentTool, outfit: currentOutfit.slice(),
      yaw: playerYaw, panX, panZ, frames: frameIndex,
      originalSaveKeysUnmodified: originalLocal?.length ?? null,
      virtualLocalWrites: shadowLocal.size, virtualSessionWrites: shadowSession.size,
      isolatedIndexedDbNames: previewDbs.size, error: errors }),
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

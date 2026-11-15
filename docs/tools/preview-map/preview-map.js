// Pre-creator tiny-map appearance sandbox. No live world, save slots, gameplay or global render monkey-patches.
(() => {
  'use strict';
  if (window.HobunjiPreviewMap) return;

  const $ = id => document.getElementById(id); // Local page controls only.
  const ROTATE_SPEED = 0.012; // Degrees of screen motion applied to the preview farmer as radians.
  const STICK_DEADZONE = 0.17; // Ignores idle joystick drift on mobile controllers.
  const PAN_LIMIT = 2.0; // Prevents panning the locked camera beyond the small scene.
  const CAMERA_OFFSET = [2.15, 1.88, 3.25]; // Fixed three-quarter view; pan translates camera and target together.
  const TOOLS = Object.freeze([
    { label: 'Hatchet', path: 'axe_hatchet.png', width: 0.30, height: 0.66 },
    { label: 'Work hammer', path: 'work_hammer.png', width: 0.30, height: 0.64 },
    { label: 'Plains sword', path: 'plains-sword.png', width: 0.28, height: 0.72 },
    { label: 'Flute', path: 'flute.png', width: 0.19, height: 0.56 },
    { label: 'Warhammer', path: 'warhammer.png', width: 0.34, height: 0.77 },
    { label: 'Harlyao longsword', path: 'harlyao_longsword.png', width: 0.29, height: 0.82 },
  ]); // Real artwork shared with the attack-animation editor.

  let preview = null; // Shared AvatarPreviewScene renderer, camera, and character holder.
  let speciesOptions = []; // Supported fighter species/gender pairs from the portrait database.
  let currentProfile = null; // Last successful preview profile, for species and outfit refreshes.
  let currentTool = null; // Owned visual tool mesh and texture; never gameplay equipment.
  let outfitSeed = 0; // Increased by Random clothes so each click chooses a different look.
  let buildGeneration = 0; // Drops stale asynchronous portrait renders after rapid button presses.
  let lastFrame = 0; // Delta time for controller pan/rotation independent of refresh rate.
  let disposed = false; // Teardown guard for async portraits and the Three.js renderer.
  let statusText = 'Preparing portrait artwork…'; // Mobile diagnostics visible without DevTools.
  let errorText = null; // Last recoverable asset/renderer failure shown on screen.
  const heldKeys = new Set(); // WASD/arrow pan state; cleared on blur.
  const pointers = new Map(); // Active pointers in the canvas used for single-drag rotate or two-finger pan.
  const pan = { x: 0, z: 0 }; // Camera translation; the player stays stationary at map center.
  let lastPinchCenter = null; // Previous two-finger midpoint used to translate rather than orbit the camera.
  const debug = { frames: 0, previewBuilds: 0, toolLoads: 0, selectedSpecies: null, selectedGender: null,
    lastTool: null, lastInput: 'none', lastError: null }; // Readable in Controls and window.HobunjiPreviewMap.

  const between = (n, min, max) => Math.min(max, Math.max(min, n)); // Shared limits for pan and character tilt.
  const random = list => list[Math.floor(Math.random() * list.length)]; // Uniform picker for authored clothes and tools.
  const normalized = value => String(value || '').trim().toLowerCase().replace(/_/g, '-'); // Fighter species aliases.
  const genderOf = fighter => String(fighter?.gender || (fighter?.id === 'F' ? 'female' : 'male')).toLowerCase(); // Older portrait fighters use M/F IDs.

  function status(message, error = false) {
    statusText = String(message);
    if (error) { errorText = statusText; debug.lastError = statusText; }
    if ($('status')) $('status').textContent = statusText;
    updateDebug();
  }

  function updateDebug() {
    if (!$('debug')) return;
    const species = $('species')?.value || '-';
    const gender = $('gender')?.value || '-';
    $('debug').textContent = [
      'Species: ' + species + ' / ' + gender,
      'Portrait builds: ' + debug.previewBuilds + ' · Tool loads: ' + debug.toolLoads,
      'Camera pan: ' + pan.x.toFixed(2) + ', ' + pan.z.toFixed(2),
      'Farmer yaw: ' + ((preview?.avatarHolder?.rotation.y || 0) * 180 / Math.PI).toFixed(1) + '°',
      'Input: ' + debug.lastInput,
      'Status: ' + statusText,
      errorText ? 'Error: ' + errorText : '',
    ].filter(Boolean).join('\n');
  }

  function supportedSpecies() {
    const fighters = window.getPortraitFighters?.() || [];
    const available = new Map(); // One species row with its actually supported genders, no invented variants.
    const configured = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {};
    for (const fighter of fighters) {
      if (!fighter?.speciesId) continue;
      const id = normalized(fighter.speciesId);
      const gender = genderOf(fighter);
      if (!available.has(id)) {
        const config = configured[id] || configured[id.replace(/-/g, '_')] || {};
        available.set(id, { id, label: config.label || fighter.speciesLabel ||
          id.replace(/(^|-)\w/g, match => match.replace('-', ' ').toUpperCase()), genders: [] });
      }
      const option = available.get(id);
      if (!option.genders.includes(gender)) option.genders.push(gender);
    }
    return [...available.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  function fillSpecies() {
    speciesOptions = supportedSpecies();
    const select = $('species');
    select.replaceChildren();
    for (const option of speciesOptions) select.add(new Option(option.label, option.id));
    const preferred = speciesOptions.find(option => option.id === 'mao-ao') || speciesOptions[0];
    if (!preferred) throw new Error('No portrait species are available in the repository configuration.');
    select.value = preferred.id;
    fillGenders();
  }

  function fillGenders(previous = 'male') {
    const species = speciesOptions.find(option => option.id === $('species').value);
    const select = $('gender');
    select.replaceChildren();
    for (const gender of species?.genders || []) select.add(new Option(gender[0].toUpperCase() + gender.slice(1), gender));
    select.value = species?.genders.includes(previous) ? previous : species?.genders[0] || '';
    debug.selectedSpecies = $('species').value;
    debug.selectedGender = select.value;
  }

  function randomOutfitIds(speciesId, gender) {
    const catalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    const categories = ['torso', 'overwear', 'hat', 'hood', 'pauldron', 'mask']; // Garment slots the canonical NPC profile renderer can equip.
    const equipped = []; // One eligible authored cosmetic per category, picked independently.
    for (const category of categories) {
      const candidates = catalog.filter(item => item?.id && item.category === category
        && (!item.species || normalized(item.species) === speciesId)
        && (!item.gender || item.gender === gender));
      if (candidates.length && (category === 'torso' || Math.random() > 0.36)) equipped.push(random(candidates).id);
    }
    return equipped;
  }

  function makeProfile() {
    const speciesId = $('species').value, gender = $('gender').value;
    const seed = 'little-preview:' + speciesId + ':' + gender + ':' + outfitSeed;
    const base = window.NpcAvatarPreview.randomProfile(seed, { speciesId, gender });
    if (!base) throw new Error('Portrait profile could not be built for ' + speciesId + ' / ' + gender);
    const cosmetics = {}; // Preserve species-appropriate facial features when re-equipping authored clothing.
    for (const key of ['hairFront', 'hairBack', 'hairSide', 'hairSideL', 'eyes', 'upperFace', 'facialHair']) {
      if (base[key]?.id) cosmetics[key] = base[key].id;
    }
    const items = randomOutfitIds(speciesId, gender);
    const npc = { name: 'Preview Farmer', appearance: {
      speciesId, gender, cosmetics, bodyColors: base.bodyColors, randomSeed: seed,
    }, equippedCosmetics: items };
    const dressed = window.NpcAvatarPreview.buildProfileFromNpcExport(npc);
    if (!dressed) throw new Error('Unable to equip the preview farmer using authored clothing.');
    return { profile: dressed, items };
  }

  async function refreshAvatar(reason) {
    const ticket = ++buildGeneration;
    if (!preview) return;
    status('Rendering ' + $('species').selectedOptions[0]?.textContent + '…');
    try {
      const { profile, items } = makeProfile();
      const size = Math.max(100, Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.previewPortraitCanvasSize) || 200);
      const front = document.createElement('canvas'), back = document.createElement('canvas'); // Separate front/rear sprite renders for genuine 360° turns.
      front.width = front.height = back.width = back.height = size;
      if (!await window.NpcAvatarPreview.renderProfileToCanvas(front, profile, { seatId: 'preview-map-front' })) throw new Error('Front portrait renderer unavailable.');
      if (ticket !== buildGeneration || disposed) return;
      if (!await window.NpcAvatarPreview.renderProfileToCanvas(back, profile, { portraitView: 'behind', seatId: 'preview-map-back' })) throw new Error('Back portrait renderer unavailable.');
      if (ticket !== buildGeneration || disposed) return;
      preview.setAvatar(front, { backCanvas: back, profile, speciesId: $('species').value,
        gender: $('gender').value, name: 'Preview_Map_Generic_Farmer', userData: { previewOnly: true } });
      currentProfile = profile;
      errorText = null;
      debug.previewBuilds++;
      debug.selectedSpecies = $('species').value;
      debug.selectedGender = $('gender').value;
      status(reason + ' · ' + items.length + ' clothing pieces' + (currentTool ? ' · ' + currentTool.label : ''));
    } catch (error) {
      if (ticket === buildGeneration && !disposed) status('Portrait: ' + (error?.message || String(error)), true);
    }
  }

  function disposeTool() {
    if (!currentTool) return;
    preview?.avatarHolder.remove(currentTool.mesh);
    currentTool.mesh.geometry.dispose();
    currentTool.mesh.material.map?.dispose();
    currentTool.mesh.material.dispose();
    currentTool = null;
    debug.lastTool = null;
  }

  function equipTool(definition) {
    if (!preview) return;
    disposeTool();
    if (!definition) { status('Tool put away.'); return; }
    const THREE = preview.THREE;
    const texture = new THREE.TextureLoader().load('../../assets/toolsprites/' + definition.path,
      () => { if (!disposed && currentTool?.mesh?.material.map === texture) status('Holding ' + definition.label); },
      undefined, () => {
        if (currentTool?.mesh?.material.map === texture) {
          disposeTool();
          status('Tool artwork unavailable: ' + definition.path, true);
        }
      });
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, alphaTest: 0.22, side: THREE.DoubleSide, depthWrite: true,
    }); // Same alpha-cutout pixel art type as the avatar, not a generic polygon weapon.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(definition.width, definition.height), material);
    mesh.name = 'preview_held_' + definition.path;
    mesh.position.set(0.34, -0.045, 0.18);
    mesh.rotation.z = Math.PI; // Source weapon sprites point downward; the held business end faces up.
    mesh.renderOrder = 4;
    preview.avatarHolder.add(mesh);
    currentTool = { label: definition.label, mesh };
    debug.lastTool = definition.label;
    debug.toolLoads++;
    status('Holding ' + definition.label);
  }

  function makeTinyMap() {
    const { THREE, scene } = preview;
    const palette = [0x52795c, 0x5a8460, 0x62875c, 0x54765c]; // Stable grass colors for the seven-tile sandbox.
    const grassMaterials = palette.map(color => new THREE.MeshLambertMaterial({ color }));
    const edgeMaterial = new THREE.MeshLambertMaterial({ color: 0x4a5349 });
    const rockMaterial = new THREE.MeshLambertMaterial({ color: 0x899187 });
    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x664f39 });
    const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x3c6a51 });
    const groundGeo = new THREE.BoxGeometry(0.99, 0.15, 0.99);
    const rockGeo = new THREE.DodecahedronGeometry(0.19, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.45, 5);
    const crownGeo = new THREE.ConeGeometry(0.31, 0.74, 6);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
      const border = Math.max(Math.abs(x), Math.abs(z)) === 3;
      const tile = new THREE.Mesh(groundGeo, border ? edgeMaterial : grassMaterials[Math.abs(x * 11 + z * 7) % palette.length]);
      tile.position.set(x, -0.64 - (border ? 0.08 : 0), z);
      scene.add(tile);
      const edge = Math.max(Math.abs(x), Math.abs(z)) >= 2;
      const decorSeed = Math.abs(x * 37 + z * 61);
      if (!edge || decorSeed % 4 === 0 || (x === 0 && z === 0)) continue;
      if (decorSeed % 3 === 0) {
        const rock = new THREE.Mesh(rockGeo, rockMaterial);
        rock.position.set(x + 0.18, -0.46, z - 0.11);
        scene.add(rock);
      } else {
        const trunk = new THREE.Mesh(trunkGeo, trunkMaterial);
        const crown = new THREE.Mesh(crownGeo, leafMaterial);
        trunk.position.set(x, -0.31, z);
        crown.position.set(x, 0.20, z);
        scene.add(trunk, crown);
      }
    }
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.71, 0.11, 8),
      new THREE.MeshLambertMaterial({ color: 0x877c67 }));
    center.position.y = -0.50;
    scene.add(center);
    scene.fog = new THREE.Fog(0x111e19, 6.5, 13); // Distant grass fades while the farmer remains crisp.
  }

  function setCameraPan() {
    if (!preview) return;
    pan.x = between(pan.x, -PAN_LIMIT, PAN_LIMIT);
    pan.z = between(pan.z, -PAN_LIMIT, PAN_LIMIT);
    const target = { x: pan.x, y: -0.06, z: pan.z };
    preview.camera.position.set(target.x + CAMERA_OFFSET[0], target.y + CAMERA_OFFSET[1], target.z + CAMERA_OFFSET[2]);
    preview.camera.lookAt(target.x, target.y, target.z);
  }

  function resetView() {
    pan.x = pan.z = 0;
    if (preview) {
      preview.avatarHolder.rotation.set(0, Math.atan2(CAMERA_OFFSET[0], CAMERA_OFFSET[2]), 0);
      setCameraPan();
    }
    updateDebug();
  }

  function onKeyDown(event) {
    const target = event.target;
    if (target?.closest?.('button, select, input, textarea, a')) return;
    const key = String(event.key || '').toLowerCase();
    if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) return;
    heldKeys.add(key);
    if (key.startsWith('arrow')) event.preventDefault();
    debug.lastInput = 'keyboard pan';
  }
  function onKeyUp(event) { heldKeys.delete(String(event.key || '').toLowerCase()); }
  function twoFingerCenter() {
    const points = [...pointers.values()];
    if (points.length < 2) return null;
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  }
  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const canvas = $('world');
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    lastPinchCenter = twoFingerCenter();
    debug.lastInput = pointers.size >= 2 ? 'touch camera pan' : 'pointer farmer rotate';
    event.preventDefault();
  }
  function onPointerMove(event) {
    const last = pointers.get(event.pointerId);
    if (!last || !preview) return;
    const dx = event.clientX - last.x, dy = event.clientY - last.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const center = twoFingerCenter();
      if (lastPinchCenter && center) {
        pan.x -= (center.x - lastPinchCenter.x) * 0.010;
        pan.z -= (center.y - lastPinchCenter.y) * 0.010;
        setCameraPan();
      }
      lastPinchCenter = center;
      debug.lastInput = 'two-finger camera pan';
    } else if (event.shiftKey) {
      pan.x -= dx * 0.010;
      pan.z -= dy * 0.010;
      setCameraPan();
      debug.lastInput = 'shift-drag camera pan';
    } else {
      preview.avatarHolder.rotation.y += dx * ROTATE_SPEED;
      preview.avatarHolder.rotation.x = between(preview.avatarHolder.rotation.x + dy * 0.004, -0.27, 0.27);
      debug.lastInput = 'pointer farmer rotation';
    }
    event.preventDefault();
  }
  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    lastPinchCenter = twoFingerCenter();
    try { $('world').releasePointerCapture?.(event.pointerId); } catch (_) {}
  }
  function axis(v) { return Math.abs(v || 0) > STICK_DEADZONE ? v : 0; }
  function frame(now) {
    if (disposed || !preview) return;
    const dt = Math.min((now - (lastFrame || now)) / 1000, 0.05);
    lastFrame = now;
    let panX = (heldKeys.has('d') || heldKeys.has('arrowright') ? 1 : 0) -
      (heldKeys.has('a') || heldKeys.has('arrowleft') ? 1 : 0);
    let panZ = (heldKeys.has('s') || heldKeys.has('arrowdown') ? 1 : 0) -
      (heldKeys.has('w') || heldKeys.has('arrowup') ? 1 : 0);
    let yaw = 0, pitch = 0;
    const pads = navigator.getGamepads?.() || [];
    for (const pad of pads) {
      if (!pad || !Array.isArray(pad.axes)) continue;
      panX += axis(pad.axes[0]); panZ += axis(pad.axes[1]);
      yaw += axis(pad.axes[2]); pitch += axis(pad.axes[3]);
    }
    if (panX || panZ) {
      const normalizer = Math.max(1, Math.hypot(panX, panZ));
      pan.x += dt * 1.55 * panX / normalizer;
      pan.z += dt * 1.55 * panZ / normalizer;
      setCameraPan();
      debug.lastInput = 'keyboard / left-stick pan';
    }
    if (yaw || pitch) {
      preview.avatarHolder.rotation.y += yaw * dt * 2.4;
      preview.avatarHolder.rotation.x = between(preview.avatarHolder.rotation.x + pitch * dt * 0.72, -0.27, 0.27);
      debug.lastInput = 'right-stick farmer rotation';
    }
    debug.frames++;
    if (debug.frames % 20 === 0) updateDebug();
  }

  function installControls() {
    const canvas = $('world');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, onPointerUp);
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => heldKeys.clear());
    $('species').addEventListener('change', () => {
      const previous = $('gender').value;
      fillGenders(previous);
      refreshAvatar('Species changed');
    });
    $('gender').addEventListener('change', () => refreshAvatar('Gender changed'));
    $('outfit').addEventListener('click', () => {
      outfitSeed++; // Each explicit random outfit click produces a fresh profile seed.
      refreshAvatar('Random clothes');
    });
    $('tool').addEventListener('click', () => equipTool(random(TOOLS)));
    $('clearTool').addEventListener('click', () => equipTool(null));
    $('resetView').addEventListener('click', resetView);
    $('resetViewOther').addEventListener('click', resetView);
    for (const [selectedId, panelId, otherId, otherPanel] of [
      ['tabAppearance', 'appearance', 'tabControls', 'controls'],
      ['tabControls', 'controls', 'tabAppearance', 'appearance'],
    ]) {
      $(selectedId).addEventListener('click', () => {
        $(panelId).hidden = false; $(otherPanel).hidden = true;
        $(selectedId).setAttribute('aria-selected', 'true');
        $(otherId).setAttribute('aria-selected', 'false');
        updateDebug();
      });
    }
    window.addEventListener('pagehide', () => {
      disposed = true; buildGeneration++; pointers.clear(); heldKeys.clear();
      disposeTool(); preview?.dispose(); preview = null;
    }, { once: true });
  }

  async function init() {
    installControls();
    status('Loading shared avatar and portrait tools…');
    try {
      if (!window.renderPortraitProfile && window.renderProfile) window.renderPortraitProfile = window.renderProfile;
      const cosmeticsPromise = window.NpcAvatarPreview?.ensurePortraitCosmetics?.({
        assetBase: '../../assets/', configBase: '../../config/',
      });
      preview = await window.AvatarPreviewScene.create({
        canvas: $('world'), antialias: false, alpha: false,
        preserveDrawingBuffer: false, backgroundColor: 0x111e19,
        cameraDistance: 4.1, fovDeg: 38, controls: false, grid: false,
        onFrame: frame,
      });
      if (disposed) { preview.dispose(); return; }
      makeTinyMap();
      resetView();
      preview.start();
      await cosmeticsPromise;
      if (disposed) return;
      fillSpecies();
      await refreshAvatar('Generic preview ready');
      $('species').disabled = false; $('gender').disabled = false;
      $('outfit').disabled = false; $('tool').disabled = false;
    } catch (error) { status('Preview failed: ' + (error?.message || String(error)), true); }
    window.addEventListener('resize', () => preview?.resize());
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => preview?.resize()).observe($('world'));
  }

  for (const id of ['species', 'gender', 'outfit', 'tool']) $(id).disabled = true; // Do not use controls before renderer/cosmetics load.
  window.HobunjiPreviewMap = Object.freeze({
    getDebug: () => ({ ...debug, status: statusText, pan: { ...pan },
      yaw: preview?.avatarHolder.rotation.y || 0, pitch: preview?.avatarHolder.rotation.x || 0,
      profileLoaded: !!currentProfile, activeTool: currentTool?.label || null,
      rendererReady: !!preview, disposed }),
    resetView,
  });
  init();
})();

// URL-loaded dungeon playtest adapter. Avatar rendering uses the same Hobunji modules as gameplay.
// Locomotion mirrors game.js until updateMovement() is extracted into a shared module.
(() => {
  'use strict';

  const VERSION = '1.2.1';
  const TILE = 55;
  const RADIUS = (15 * .72) / TILE;
  const SPEED = 238 / TILE;
  const ACCEL = 980 / TILE;
  const TURN = 1320 / TILE;
  const DECEL = 1850 / TILE;
  const PROFILE_KEY = 'hobunjiPlayerProfile';
  const sourceUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = sourceUrl && sourceUrl.protocol !== 'blob:' ? new URL('../', sourceUrl).href : null;
  const loaded = new Map();
  const keys = new Set();

  const S = {
    active: false, starting: false,
    map: null, scene: null, camera: null, canvas: null, orbit: null,
    elevation: null, surfaceY: null,
    root: null, avatar: null, legs: null, player: null, target: null,
    ui: null, raf: 0, last: 0, zoom: 1,
    profileSource: 'none', errors: [], onStop: null, floor: null
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const key = (c, r) => `${c},${r}`;
  const tileElev = (c, r) => Number(S.elevation?.(c, r, S.map)) || 0;
  const groundY = (x, z) => {
    // Stand on a caller-provided continuous collision deck when available. Decorative floor/stair meshes never participate here.
    if (typeof S.surfaceY === 'function') {
      const y = Number(S.surfaceY(x, z, S.map));
      if (Number.isFinite(y)) return y;
    }
    return tileElev(Math.floor(x), Math.floor(z));
  };

  function load(path, test) {
    if (test?.()) return Promise.resolve();
    if (!docsBase) return Promise.reject(new Error(`Cannot resolve repo URL for ${path}.`));
    const url = new URL(path, docsBase).href;
    if (loaded.has(url)) return loaded.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = false;
      script.onload = () => test && !test() ? reject(new Error(`${path} loaded without its API.`)) : resolve();
      script.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.head.appendChild(script);
    });
    loaded.set(url, promise);
    return promise;
  }

  async function deps() {
    if (!window.THREE) throw new Error('Three.js is missing.');
    await load('config/config.js');
    await load('config/scratchbones-config.js', () => !!window.SCRATCHBONES_CONFIG?.game);
    await load('config/attachment-rig-profiles.js', () => !!window.HOBUNJI_ATTACHMENT_RIG_PROFILES);
    await load('js/portrait-utils.js', () => typeof window.renderPortraitProfile === 'function');
    await load('js/npc-avatar-preview-utils.js', () => !!window.NpcAvatarPreview);
    await load('js/png-plane-avatar.js', () => !!window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel);
    await load('js/leg-bones.js', () => !!window.LegBones?.solveTwoBoneLeg);
    await load('js/procedural-leg-animation.js', () => !!window.ProceduralLegAnimation?.attach);
    await load('js/hobunji-puzzle-runtime.js', () => !!window.HobunjiPuzzleRuntime?.registerMap);
    await window.NpcAvatarPreview.ensurePortraitCosmetics({
      assetBase: new URL('assets/', docsBase).href,
      configBase: new URL('config/', docsBase).href
    });
  }

  function profile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      if (p?.appearance?.speciesId) { S.profileSource = 'saved player'; return p; }
    } catch (error) { S.errors.push(`profile: ${error.message}`); }
    S.profileSource = 'fallback Mao-ao';
    return { nickname: 'Dungeon Tester', appearance: { speciesId: 'mao-ao', gender: 'male', cosmetics: {}, bodyColors: {} }, equippedCosmetics: [], appliedDyes: {} };
  }

  async function avatar() {
    const THREE = window.THREE;
    const p = profile();
    const appearance = p.appearance || {};
    let prof = window.NpcAvatarPreview.buildProfileFromNpcExport(p)
      || window.NpcAvatarPreview.randomProfile('dungeon-playtest', { speciesId: appearance.speciesId || 'mao-ao', gender: appearance.gender || 'male' });
    if (!prof) throw new Error('Could not build player portrait.');
    const cfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
    const modelWidth = Number(cfg.worldModelWidth) || .9;
    const portraitSize = Number(cfg.previewPortraitCanvasSize) || 200;
    const canvas = () => Object.assign(document.createElement('canvas'), { width: portraitSize, height: portraitSize });
    const front = canvas(), back = canvas(), head = canvas();
    await window.NpcAvatarPreview.renderProfileToCanvas(front, prof, { forceEyesOpen: true });
    await window.NpcAvatarPreview.renderProfileToCanvas(back, prof, { portraitView: 'behind', forceEyesOpen: true });
    await window.NpcAvatarPreview.renderProfileToCanvas(head, prof, { onlyHeadSprite: true, forceEyesOpen: true });
    const root = new THREE.Group();
    root.name = 'dungeon_playtest_player';
    const avatarGroup = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE, front, {
      backCanvas: back, headCanvas: head, profile: prof, appearance,
      modelWidth, modelHeight: modelWidth, anchorZ: 0,
      alphaTest: cfg.worldAlphaTest ?? .01, neckRig: true, name: 'player_avatar'
    });
    const modelHeight = Number(avatarGroup.userData?.portraitModelHeight) || modelWidth;
    avatarGroup.position.y = modelHeight / 2;
    root.add(avatarGroup);
    const legs = window.ProceduralLegAnimation?.attach(THREE, root, {
      speciesId: appearance.speciesId, gender: appearance.gender,
      bodyColors: prof.bodyColors || appearance.bodyColors,
      modelWidth: Number(avatarGroup.userData?.portraitModelWidth) || modelWidth,
      modelHeight, handAttachY: avatarGroup.userData?.handAttachY,
      name: 'player', profile: prof, portraitSize
    }) || null;
    return { root, avatar: avatarGroup, legs };
  }

  function spawn() {
    const exit = (S.map.exits || []).find(x => x.id === 'exit_dungeon_entry' || /entrance/i.test(x.label || '')) || S.map.exits?.[0];
    const tile = exit?.tiles?.[0] || S.map.floor?.[0] || [0, 0];
    return { x: +tile[0] + .5, z: +tile[1] + .5 };
  }

  function occupy(x, z) {
    const blocked = new Set((S.map.colliders || []).map(t => key(+t[0], +t[1])));
    return [[-RADIUS,-RADIUS],[RADIUS,-RADIUS],[-RADIUS,RADIUS],[RADIUS,RADIUS]].every(([dx,dz]) => {
      const c = Math.floor(x + dx), r = Math.floor(z + dz), k = key(c, r);
      return c >= 0 && r >= 0 && c < S.map.cols && r < S.map.rows && S.floor.has(k) && !blocked.has(k);
    });
  }

  function keyInput() {
    let x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let z = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    const mag = Math.hypot(x, z);
    if (mag > 1) { x /= mag; z /= mag; }
    return { x, z, strength: Math.min(1, mag), keyboard: mag > 0 };
  }

  function padInput() {
    const pad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
    if (!pad) return { x: 0, z: 0, strength: 0 };
    const dead = Number(window.SCRATCHBONES_CONFIG?.game?.input?.gamepadDeadzone) || .24;
    const x = +pad.axes?.[0] || 0, z = +pad.axes?.[1] || 0, mag = Math.hypot(x, z);
    if (mag <= dead) return { x: 0, z: 0, strength: 0 };
    return { x: x / Math.max(1, mag), z: z / Math.max(1, mag), strength: clamp((mag - dead) / (1 - dead), 0, 1), pad };
  }

  function input() {
    const keyboard = keyInput();
    if (keyboard.strength) return keyboard;
    if (S.ui?.stick?.strength) return { x: S.ui.stick.x, z: S.ui.stick.z, strength: S.ui.stick.strength };
    return padInput();
  }

  function move(dt) {
    const p = S.player, i = input(), strength = i.strength || 0;
    const ease = i.keyboard ? 1 : (.28 + .72 * strength), targetSpeed = SPEED * ease;
    if (strength > .001) {
      const targetVx = i.x * targetSpeed, targetVz = i.z * targetSpeed;
      const current = Math.hypot(p.vx, p.vz);
      const dot = current > .001 ? (p.vx / current) * i.x + (p.vz / current) * i.z : 1;
      const step = (dot < .35 ? TURN : ACCEL) * dt;
      p.vx += clamp(targetVx - p.vx, -step, step);
      p.vz += clamp(targetVz - p.vz, -step, step);
    } else {
      const speed = Math.hypot(p.vx, p.vz);
      if (speed) {
        const next = Math.max(0, speed - DECEL * dt), mul = next / speed;
        p.vx *= mul; p.vz *= mul;
      }
    }

    const nextX = p.x + p.vx * dt, nextZ = p.z + p.vz * dt;
    if (occupy(nextX, p.z)) p.x = nextX; else p.vx = 0;
    if (occupy(p.x, nextZ)) p.z = nextZ; else p.vz = 0;

    const speed = Math.hypot(p.vx, p.vz);
    if (speed > .03) p.angle = Math.atan2(p.vx, p.vz);
    p.y = groundY(p.x, p.z);
    S.root.position.set(p.x, p.y, p.z);
    S.root.rotation.y = p.angle;
    S.legs?.update?.(dt, speed * TILE, false, null);
  }

  function cam() {
    const p = S.player, camera = S.camera;
    const cfg = window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.default || {};
    const lerp = clamp(Number(cfg.followLerp) || .08, .001, 1);
    S.target.x += (p.x - S.target.x) * lerp;
    S.target.y += (p.y - S.target.y) * lerp;
    S.target.z += (p.z - S.target.z) * lerp;
    const distance = (Number(cfg.distanceTiles) || 14) / S.zoom;
    const angle = window.THREE.MathUtils.degToRad(Number(cfg.angleFromGroundDeg) || 32.73);
    const azimuth = window.THREE.MathUtils.degToRad(Number(cfg.azimuthDeg) || 0);
    const lookY = S.target.y + (Number(cfg.targetYOffsetTiles) || 0);
    const ground = Math.cos(angle) * distance;
    camera.position.set(
      S.target.x + Math.sin(azimuth) * ground,
      lookY + Math.sin(angle) * distance,
      S.target.z + Math.cos(azimuth) * ground
    );
    camera.lookAt(S.target.x, lookY, S.target.z);
    camera.fov = Number(cfg.fovDeg) || 42;
    camera.updateProjectionMatrix();
  }

  function near() {
    return S.player && window.HobunjiPuzzleRuntime?.nearestAvailableSource(S.map.id, { x: S.player.x * TILE, y: S.player.z * TILE }) || null;
  }

  function operate() {
    const n = near();
    if (!n) { msg('Nothing operable nearby.'); return false; }
    const result = window.HobunjiPuzzleRuntime.activateNode(n.mapId, n.machineId, n.node.id, 'interact');
    msg(result?.ok ? `Operated ${n.node.name || n.node.label || n.node.atomId}` : `Blocked: ${result?.reason || 'unknown'}`);
    return !!result?.ok;
  }

  function msg(text) { if (S.ui?.message) S.ui.message.textContent = text; }

  function debug() {
    const p = S.player, n = near(), machines = S.map?.generator?.puzzles?.machines || [];
    const done = machines.filter(m => window.HobunjiPuzzleRuntime?.isMachineComplete(S.map.id, m.id)).length;
    return [
      `Playtest ${VERSION}`,
      `Character: SAME repo modules`,
      `Movement: game.js parity mirror`,
      `Grounding: ${S.surfaceY ? 'continuous collision deck' : 'tile elevation fallback'}`,
      `Profile: ${S.profileSource}`,
      `Pos: ${p ? `${p.x.toFixed(2)}, ${p.y.toFixed(3)}, ${p.z.toFixed(2)}` : '-'}`,
      `Speed: ${p ? Math.hypot(p.vx, p.vz).toFixed(2) : '-'} tiles/s`,
      `Puzzles: ${done}/${machines.length}`,
      `Nearby: ${n ? n.node.name || n.node.label || n.node.atomId : 'none'}`,
      `Errors: ${S.errors.join(' | ') || 'none'}`
    ].join('\n');
  }

  function ui() {
    if (!document.getElementById('hdpStyle')) {
      const style = document.createElement('style');
      style.id = 'hdpStyle';
      style.textContent = `body.hdp{overflow:hidden!important}body.hdp .sidebar{display:none!important}body.hdp .app{display:block!important;position:fixed!important;inset:0!important}body.hdp .viewport{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important}body.hdp .hud{display:none!important}#hdp{position:fixed;inset:0;z-index:90;pointer-events:none;color:#eef6ff;font:12px/1.35 ui-monospace,monospace}#hdp button{pointer-events:auto;min-height:44px;border:1px solid #8298aa;background:#101923e8;color:#fff;border-radius:10px;padding:8px 12px;font-weight:700}#hdpTop{position:absolute;top:8px;left:8px;right:8px;display:flex;justify-content:space-between;gap:8px}#hdpMsg,#hdpDbg{background:#081018e8;border:1px solid #52677a;border-radius:9px;padding:7px 9px}#hdpDbg{position:absolute;right:8px;top:60px;max-width:min(430px,90vw);white-space:pre-wrap;pointer-events:auto}#hdpJoy{position:absolute;left:20px;bottom:20px;width:132px;height:132px;border:1px solid #9db0c266;border-radius:50%;background:#08101866;pointer-events:auto;touch-action:none}#hdpKnob{position:absolute;left:41px;top:41px;width:50px;height:50px;border-radius:50%;background:#dae7f0aa}#hdpOp{position:absolute;right:22px;bottom:24px;min-width:108px}#hdpOp.ready{outline:3px solid #72e7ff}@media(pointer:fine){#hdpJoy{opacity:.28}}`;
      document.head.appendChild(style);
    }
    const root = document.createElement('div');
    root.id = 'hdp';
    root.innerHTML = `<div id="hdpTop"><div id="hdpMsg">Playtest loading…</div><div><button id="hdpDebug">Debug</button> <button id="hdpExit">Exit</button></div></div><pre id="hdpDbg"></pre><div id="hdpJoy"><div id="hdpKnob"></div></div><button id="hdpOp">Operate</button>`;
    document.body.appendChild(root);
    document.body.classList.add('hdp');

    const joy = root.querySelector('#hdpJoy'), knob = root.querySelector('#hdpKnob');
    const stick = { x: 0, z: 0, strength: 0, id: null };
    const setStick = event => {
      const rect = joy.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, radius = rect.width * .34;
      let dx = event.clientX - cx, dy = event.clientY - cy, mag = Math.hypot(dx, dy);
      if (mag > radius) { dx *= radius / mag; dy *= radius / mag; mag = radius; }
      stick.x = dx / radius; stick.z = dy / radius; stick.strength = mag / radius;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    const resetStick = event => {
      if (event && stick.id !== null && event.pointerId !== stick.id) return;
      stick.x = stick.z = stick.strength = 0; stick.id = null; knob.style.transform = 'translate(0,0)';
    };
    joy.onpointerdown = event => { stick.id = event.pointerId; joy.setPointerCapture?.(event.pointerId); setStick(event); };
    joy.onpointermove = event => { if (event.pointerId === stick.id) setStick(event); };
    joy.onpointerup = joy.onpointercancel = resetStick;
    root.querySelector('#hdpOp').onclick = operate;
    root.querySelector('#hdpExit').onclick = stop;
    root.querySelector('#hdpDebug').onclick = () => root.querySelector('#hdpDbg').hidden = !root.querySelector('#hdpDbg').hidden;
    return { root, message: root.querySelector('#hdpMsg'), debug: root.querySelector('#hdpDbg'), op: root.querySelector('#hdpOp'), stick, padHeld: false };
  }

  function down(event) {
    if (!S.active) return;
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) { keys.add(event.code); event.preventDefault(); }
    if (event.code === 'KeyE') { operate(); event.preventDefault(); }
    if (event.code === 'Escape') { stop(); event.preventDefault(); }
  }
  const up = event => keys.delete(event.code);

  function wheel(event) {
    if (!S.active) return;
    const cfg = window.SCRATCHBONES_CONFIG?.game?.desktopControls || {};
    const step = Number(cfg.wheelZoomStep) || .05;
    S.zoom = clamp(S.zoom + (event.deltaY < 0 ? step : -step), Number(cfg.wheelZoomMin) || .75, Number(cfg.wheelZoomMax) || 2.5);
    event.preventDefault();
  }

  function frame(now) {
    if (!S.active) return;
    const dt = clamp((now - S.last) / 1000 || 0, 0, .05);
    S.last = now;
    const pad = Array.from(navigator.getGamepads?.() || []).find(Boolean), held = !!pad?.buttons?.[0]?.pressed;
    if (held && !S.ui.padHeld) operate();
    S.ui.padHeld = held;
    move(dt);
    cam();
    const n = near();
    S.ui.op.classList.toggle('ready', !!n);
    S.ui.op.textContent = n ? (n.node.prompt || `Operate ${n.node.name || n.node.label || 'mechanism'}`) : 'Operate';
    S.ui.debug.textContent = debug();
    S.raf = requestAnimationFrame(frame);
  }

  async function start(options = {}) {
    if (S.active || S.starting) return { ok: false, reason: 'busy' };
    S.starting = true;
    S.errors.length = 0;
    try {
      if (!options.map || !options.scene || !options.camera || !options.canvas) throw new Error('map, scene, camera and canvas are required.');
      Object.assign(S, {
        map: options.map, scene: options.scene, camera: options.camera, canvas: options.canvas,
        orbit: options.orbitControls || null,
        elevation: options.tileElevation || null,
        surfaceY: options.surfaceYAtWorld || options.groundHeightAtWorld || null,
        onStop: typeof options.onStop === 'function' ? options.onStop : null,
        zoom: 1
      });
      S.floor = new Set((S.map.floor || []).map(t => key(+t[0], +t[1])));
      await deps();
      const validation = window.HobunjiPuzzleRuntime.validatePuzzleData(S.map);
      if (!validation.ok) throw new Error(validation.errors.join(' | '));
      window.HobunjiPuzzleRuntime.registerMap(S.map, { aliases: [S.map.name] });
      window.HobunjiPuzzleRuntime.setActiveMap(S.map.id);
      window.HobunjiPuzzleRuntime.reset(S.map.id);

      const av = await avatar();
      S.root = av.root; S.avatar = av.avatar; S.legs = av.legs;
      S.scene.add(S.root);
      const sp = spawn();
      S.player = { x: sp.x, z: sp.z, y: groundY(sp.x, sp.z), vx: 0, vz: 0, angle: Math.PI };
      S.root.position.set(S.player.x, S.player.y, S.player.z);
      S.root.rotation.y = S.player.angle;
      S.target = new window.THREE.Vector3(S.player.x, S.player.y, S.player.z);
      if (S.orbit) S.orbit.enabled = false;
      S.ui = ui();
      window.addEventListener('keydown', down, { passive: false });
      window.addEventListener('keyup', up);
      S.canvas.addEventListener('wheel', wheel, { passive: false });
      S.active = true; S.starting = false; S.last = performance.now();
      cam();
      msg('WASD/arrows · controller stick · E/A/Operate · wheel zoom · Esc exits');
      S.raf = requestAnimationFrame(frame);
      return { ok: true, profileSource: S.profileSource, grounding: S.surfaceY ? 'continuous collision deck' : 'tile elevation fallback' };
    } catch (error) {
      S.errors.push(error.stack || error.message);
      S.starting = false;
      stop();
      throw error;
    }
  }

  function stop() {
    if (!S.active && !S.starting && !S.root && !S.ui) return false;
    S.active = S.starting = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
    keys.clear();
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    S.canvas?.removeEventListener('wheel', wheel);
    S.legs?.dispose?.(); S.legs = null;
    if (S.avatar) { window.PNGPlaneAvatar?.disposeAvatarModel?.(S.avatar); S.avatar = null; }
    if (S.root) { S.root.parent?.remove(S.root); S.root = null; }
    if (S.orbit) S.orbit.enabled = true;
    S.ui?.root?.remove(); S.ui = null;
    document.body.classList.remove('hdp');
    const done = S.onStop;
    S.map = S.scene = S.camera = S.canvas = S.orbit = S.elevation = S.surfaceY = S.player = S.target = S.onStop = S.floor = null;
    try { done?.(); } catch (_) {}
    return true;
  }

  window.HobunjiDungeonPlaytest = Object.freeze({
    VERSION, ensureDependencies: deps, start, stop,
    isActive: () => S.active,
    operateNearest: operate,
    debugSnapshot: () => ({
      version: VERSION, active: S.active,
      characterSource: 'shared repo modules',
      movementSource: 'game.js parity mirror',
      groundingSource: S.surfaceY ? 'continuous collision deck' : 'tile elevation fallback',
      profileSource: S.profileSource, errors: [...S.errors], text: debug()
    })
  });
})();

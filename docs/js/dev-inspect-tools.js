// Developer inspection tools (window.DevInspectTools), developer mode only.
//
//   Fly camera   F8, or Settings → "Fly camera". Detaches the camera from the
//                player and flies it freely (no collision) so level geometry —
//                ruin floors, walls, ceilings, shaft pits — can be checked from
//                any angle. WASD / arrows move along the view, Space/E rise,
//                Q/C fall, Shift is 4x speed, the wheel changes base speed,
//                drag (mouse or touch) looks around. The on-screen pad covers
//                touch devices. The player is locked in place while flying;
//                G ("Drop player here") lands them under the camera.
//                game.js's updateCameraPosition() skips its follow pose while
//                ownsCamera() is true (the same contract as the Map Editor's
//                orbit camera), so every system that reads the camera during
//                the frame — culling, reticle rays, x-ray — sees the fly pose.
//   Enemies off  F9, or Settings → "Enemies off". Freezes hostile AI: the
//                game.js hostile loop only refreshes meshes, ruin Skeeri stop,
//                wall coffins stay shut and ruin encounters pause. Creatures
//                stay where they are and still take damage.
//   Random dungeon  Settings button / randomDungeon(): enters a generated ruin
//                with a random size tier (cave/hole/lich) and tradition, the
//                same generator real ruin sites use.
//
// Headless drivers can call lookFrom(x, y, z, lookX, lookY, lookZ, fov) and
// getPose() directly. Nothing here runs for players without developer mode.
(() => {
  'use strict';
  if (window.DevInspectTools) return;

  const SCHEDULER_ID = 'dev-inspect-fly-camera';
  const FLY_KEY = 'F8', ENEMY_KEY = 'F9';
  const LOOK_DEG_PER_PX = 0.22, PITCH_LIMIT = Math.PI / 2 - 0.01;
  const TIERS = ['cave', 'hole', 'lich'], THEMES = ['tothal', 'hronal', 'kanthic'];
  const MOVE_CODES = Object.freeze({
    KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    Space: 'up', KeyE: 'up', KeyQ: 'down', KeyC: 'down', ShiftLeft: 'fast', ShiftRight: 'fast',
  });

  let deps = null;
  let active = false, frozen = false, lock = null, hud = null;
  let yaw = 0, pitch = 0, fov = null, speed = 8;
  const pos = { x: 0, y: 0, z: 0 };
  const held = new Set(); // Keyboard and on-screen pad directions currently held.
  let drag = null, lastFrameMs = 0;

  const devModeEnabled = () => { try { return localStorage.getItem('hobunjiDevMode') === '1'; } catch (_) { return false; } };
  const toast = (msg, ok = true) => deps?.showToast?.(msg, ok);

  function captureCameraPose() {
    const cam = deps.camera;
    pos.x = cam.position.x; pos.y = cam.position.y; pos.z = cam.position.z;
    const dir = cam.getWorldDirection(new deps.THREE.Vector3());
    yaw = Math.atan2(dir.x, dir.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  }

  function applyPose() {
    if (!active || !deps?.camera) return;
    const cam = deps.camera, cp = Math.cos(pitch);
    cam.position.set(pos.x, pos.y, pos.z);
    cam.lookAt(pos.x + Math.sin(yaw) * cp, pos.y + Math.sin(pitch), pos.z + Math.cos(yaw) * cp);
    if (fov && cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  function step(deltaMs) {
    const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
    if (!dt || !held.size) return;
    const v = speed * (held.has('fast') ? 4 : 1) * dt, cp = Math.cos(pitch);
    const fx = Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = Math.cos(yaw) * cp; // Forward follows the full view direction (fly, not walk).
    const rx = -Math.cos(yaw), rz = Math.sin(yaw); // Camera right on the ground plane.
    const f = (held.has('fwd') ? 1 : 0) - (held.has('back') ? 1 : 0);
    const r = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const u = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
    pos.x += (fx * f + rx * r) * v; pos.y += fy * f * v + u * v; pos.z += (fz * f + rz * r) * v;
  }

  function preGameFrame(ctx) { // Moves, then poses the camera before gameplay so every system this frame sees the fly pose.
    if (!active) return;
    const now = Number(ctx?.timestamp) || performance.now();
    step(lastFrameMs ? now - lastFrameMs : 0); lastFrameMs = now;
    applyPose();
  }
  function preRenderFrame() { if (active) applyPose(); } // updateCameraPosition() still rewrites fov/aspect each frame.

  function setFlying(on) {
    if (!deps?.camera || !devModeEnabled()) return false;
    on = !!on;
    if (on === active) return active;
    if (on) {
      captureCameraPose();
      active = true;
      lastFrameMs = 0;
      lock = window.CharacterActionLocks?.acquire?.({ owner: 'dev-fly-camera', reason: 'Developer fly camera', participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }] }) || null;
      showHud(true);
      applyPose();
      toast('Fly camera on — WASD/arrows, Space/E up, Q/C down, Shift fast, drag to look. ' + FLY_KEY + ' to exit.');
    } else {
      active = false; fov = null; held.clear(); drag = null;
      lock?.release?.(); lock = null;
      showHud(false);
      toast('Fly camera off.');
    }
    refreshButtons();
    return active;
  }

  function setEnemiesFrozen(on) {
    if (!devModeEnabled()) return false;
    frozen = !!on;
    refreshButtons();
    toast(frozen ? 'Enemies off: hostile AI, ruin Skeeri, coffins and encounters are frozen.' : 'Enemies back on.');
    return frozen;
  }

  // Lands the player on the highest surface under the camera (inside a generated ruin, through the ruin's own
  // story-aware teleport) and hands the camera back to the follow rig.
  function dropPlayer() {
    if (!active || !deps?.player || !deps?.TILE) return false;
    const x = pos.x, z = pos.z;
    const inRuin = deps.getCurrentArea?.() === 'map_i_dev_random_ruin' && window.DevRandomRuin?.setPlayerWorldPoint;
    if (inRuin) {
      const support = window.DynamicSurfaces?.sampleSupport?.(x, z, { minY: pos.y - 40, maxY: pos.y + .5, pad: .02 });
      if (!support) { toast('Nothing to stand on below the camera.', false); return false; }
      if (!window.DevRandomRuin.setPlayerWorldPoint({ x, y: support.y, z }, { grounded: true, snapCamera: true })) { toast('Could not place the player there.', false); return false; }
    } else {
      deps.player.x = x * deps.TILE; deps.player.y = z * deps.TILE;
    }
    setFlying(false);
    return true;
  }

  async function randomDungeon(options = {}) {
    const ruin = window.DevRandomRuin;
    if (!ruin?.generate || !devModeEnabled()) return false;
    const tier = TIERS.includes(options.tier) ? options.tier : TIERS[Math.floor(Math.random() * TIERS.length)];
    const theme = THEMES.includes(options.theme) ? options.theme : THEMES[Math.floor(Math.random() * THEMES.length)];
    const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) >>> 0 : Math.floor(Math.random() * 2147483647);
    const wasFlying = active;
    if (wasFlying) setFlying(false); // Arrival places the follow camera; flying resumes from there.
    const ok = await ruin.generate(seed, { tier, theme });
    if (ok) toast('Dungeon: ' + tier + ' / ' + theme + ' #' + seed);
    if (ok && wasFlying) setFlying(true);
    return ok ? { tier, theme, seed } : false;
  }

  // ── Input ────────────────────────────────────────────────────────────
  function onKey(event) {
    if (!deps || !devModeEnabled()) return;
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ''))) return;
    const down = event.type === 'keydown';
    if (down && !event.repeat && event.code === FLY_KEY) { event.preventDefault(); event.stopImmediatePropagation(); setFlying(!active); return; }
    if (down && !event.repeat && event.code === ENEMY_KEY) { event.preventDefault(); event.stopImmediatePropagation(); setEnemiesFrozen(!frozen); return; }
    if (!active) return;
    if (down && !event.repeat && event.code === 'KeyG') { event.preventDefault(); event.stopImmediatePropagation(); dropPlayer(); return; }
    const dir = MOVE_CODES[event.code];
    if (!dir) return;
    event.preventDefault(); event.stopImmediatePropagation(); // Flying keys never reach gameplay (jump, interact, tool wheel).
    if (down) held.add(dir); else held.delete(dir);
  }

  function onPointerDown(event) {
    if (!active || event.target !== deps?.renderer?.domElement) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.preventDefault(); event.stopImmediatePropagation();
  }
  function onPointerMove(event) {
    if (!active || !drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    yaw -= dx * LOOK_DEG_PER_PX * Math.PI / 180;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - dy * LOOK_DEG_PER_PX * Math.PI / 180));
    event.stopImmediatePropagation();
  }
  function onPointerUp(event) { if (drag && event.pointerId === drag.id) { drag = null; if (active) event.stopImmediatePropagation(); } }
  function onWheel(event) {
    if (!active || event.target !== deps?.renderer?.domElement) return;
    speed = Math.max(1, Math.min(80, speed * (event.deltaY > 0 ? 0.8 : 1.25)));
    event.preventDefault(); event.stopImmediatePropagation();
    refreshButtons();
  }
  function onBlur() { held.clear(); drag = null; }

  // ── HUD + Settings ───────────────────────────────────────────────────
  function showHud(on) {
    if (on && !hud) {
      hud = document.createElement('div');
      hud.id = 'devFlyHud';
      hud.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9400;display:grid;grid-template-columns:repeat(4,44px);gap:6px;'
        + 'padding:8px;border-radius:12px;background:rgba(8,18,13,.78);border:1px solid rgba(255,255,255,.2);font:12px sans-serif;color:#f0ffe6;touch-action:none;user-select:none';
      const pad = [['up', '⤒'], ['fwd', '▲'], ['down', '⤓'], ['fast', '⇧'], ['left', '◀'], ['back', '▼'], ['right', '▶']];
      for (const [dir, label] of pad) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.dataset.dir = dir; b.title = dir;
        b.style.cssText = 'height:40px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:inherit;font-size:16px;touch-action:none';
        const press = e => { e.preventDefault(); e.stopPropagation(); held.add(dir); };
        const release = e => { e.preventDefault(); e.stopPropagation(); held.delete(dir); };
        b.addEventListener('pointerdown', press); b.addEventListener('pointerup', release);
        b.addEventListener('pointercancel', release); b.addEventListener('pointerleave', release);
        hud.appendChild(b);
      }
      const exit = document.createElement('button');
      exit.type = 'button'; exit.textContent = '✕'; exit.title = 'Exit fly camera (' + FLY_KEY + ')';
      exit.style.cssText = 'height:40px;border-radius:8px;border:1px solid rgba(255,140,140,.5);background:rgba(120,20,20,.4);color:inherit;font-size:16px';
      exit.addEventListener('click', e => { e.stopPropagation(); setFlying(false); });
      hud.appendChild(exit);
      const drop = document.createElement('button');
      drop.type = 'button'; drop.textContent = 'Drop player here (G)';
      drop.style.cssText = 'grid-column:1/-1;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:inherit;font-size:12px';
      drop.addEventListener('click', e => { e.stopPropagation(); dropPlayer(); });
      hud.appendChild(drop);
      const info = document.createElement('div');
      info.id = 'devFlyHudInfo';
      info.style.cssText = 'grid-column:1/-1;font-size:11px;opacity:.8;text-align:center';
      hud.appendChild(info);
      document.body.appendChild(hud);
    }
    if (hud) hud.style.display = on ? 'grid' : 'none';
    refreshButtons();
  }

  function refreshButtons() {
    const fly = document.getElementById('devFlyCameraBtn');
    const label = active ? 'Stop flying' : 'Fly';
    if (fly && fly.textContent !== label) fly.textContent = label;
    const enemies = document.getElementById('devEnemiesOffBtn');
    const enemyLabel = frozen ? 'Enemies: OFF' : 'Enemies: on';
    if (enemies && enemies.textContent !== enemyLabel) enemies.textContent = enemyLabel;
    const info = document.getElementById('devFlyHudInfo');
    const text = 'speed ' + speed.toFixed(1) + (frozen ? ' · enemies off' : '');
    if (info && info.textContent !== text) info.textContent = text;
  }

  function installSettingsRow() {
    if (!devModeEnabled() || document.getElementById('devFlyCameraBtn')) return;
    const anchor = document.getElementById('devTeleportArenaBtn')?.closest('.settings-row');
    if (!anchor) return;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.setAttribute('data-dev-only', '');
    row.innerHTML = '<div class="settings-label"><div class="settings-name">Inspect: fly camera / enemies</div>'
      + '<div class="settings-desc">Fly the camera freely through walls (' + FLY_KEY + '; WASD, Space/E up, Q/C down, Shift fast, drag to look), '
      + 'freeze every enemy (' + ENEMY_KEY + '), or jump into a random generated dungeon (random size tier and tradition).</div></div>';
    const add = (id, text, onClick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.id = id; b.className = 'settings-small-btn'; b.textContent = text;
      b.addEventListener('click', onClick); row.appendChild(b);
    };
    add('devFlyCameraBtn', 'Fly', () => setFlying(!active));
    add('devEnemiesOffBtn', 'Enemies: on', () => setEnemiesFrozen(!frozen));
    add('devRandomDungeonBtn', 'Random dungeon', () => randomDungeon());
    anchor.insertAdjacentElement('afterend', row);
    refreshButtons();
  }

  function init(injected) {
    deps = injected || null;
    if (!deps?.camera || !deps?.THREE) return false;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('blur', onBlur);
    const scheduler = window.RuntimeFrameScheduler;
    scheduler?.register?.(SCHEDULER_ID + '-move', preGameFrame, { phase: 'pre-game', owner: 'DevInspectTools', description: 'Developer fly camera movement and pose' });
    scheduler?.register?.(SCHEDULER_ID + '-pose', preRenderFrame, { phase: 'pre-render', owner: 'DevInspectTools', description: 'Developer fly camera pose after the follow-camera update' });
    installSettingsRow();
    return true;
  }

  window.DevInspectTools = Object.freeze({
    init,
    ownsCamera: () => active,
    enemiesFrozen: () => frozen,
    setFlying, toggleFlying: () => setFlying(!active), isFlying: () => active,
    setEnemiesFrozen, toggleEnemies: () => setEnemiesFrozen(!frozen),
    randomDungeon, dropPlayer,
    lookFrom(x, y, z, lookX, lookY, lookZ, fovDeg) {
      if (!active && !setFlying(true)) return false;
      pos.x = +x; pos.y = +y; pos.z = +z;
      const dx = lookX - x, dy = lookY - y, dz = lookZ - z, len = Math.hypot(dx, dy, dz) || 1;
      yaw = Math.atan2(dx, dz); pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
      fov = Number.isFinite(Number(fovDeg)) ? Math.max(20, Math.min(120, Number(fovDeg))) : fov;
      applyPose();
      return true;
    },
    setSpeed(value) { speed = Math.max(1, Math.min(80, Number(value) || speed)); refreshButtons(); return speed; },
    getPose: () => ({ active, x: pos.x, y: pos.y, z: pos.z, yawDeg: yaw * 180 / Math.PI, pitchDeg: pitch * 180 / Math.PI, fov, speed, enemiesFrozen: frozen }),
  });
})();

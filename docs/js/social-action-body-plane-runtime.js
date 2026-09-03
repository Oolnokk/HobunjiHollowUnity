// Keeps the player's PNG body plane in the same live social-dance transform as
// the procedural hands/feet. Two responsibilities live here deliberately:
// 1) submit the authored dance body channel every animation frame (independent
//    of renderer-hook ordering), and
// 2) refresh the portrait mesh's matrixWorld immediately before its draw.
//
// The second step matters in Hobunji's optimized render stack because some
// passes render with scene.autoUpdate=false. PlayerBodyTransformComposer can
// temporarily move playerMesh while a descendant portrait still holds the
// previous matrixWorld; the procedural limbs already refresh their own matrices,
// which is why they can visibly dance while the PNG body appears frozen.
(function (global) {
  'use strict';

  if (global.SocialActionBodyPlaneRuntime?.installed) return;

  const CHANNEL = 'social-dance';
  const STYLE = Object.freeze({
    'side-step': Object.freeze({ intensity: 1.00 }),
    'gentle-twirl': Object.freeze({ intensity: 1.18 }),
    'loose-sway': Object.freeze({ intensity: 0.96 }),
  });

  const state = {
    danceKey: null,
    startedAt: 0,
    wasDancing: false,
    channelUpdates: 0,
    hookedPlanes: 0,
    planeSyncs: 0,
  };

  const hooked = new WeakSet();
  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

  function smootherstep01(value) {
    const t = clamp01(value);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function grooveScale(groove) {
    const safeGroove = Math.max(0, Number(groove) || 0);
    const curveRate = 52;
    return Math.expm1(safeGroove / curveRate) / Math.expm1(100 / curveRate);
  }

  function tactusBpm(rawBpm) {
    let bpm = Number(rawBpm) || 104;
    while (bpm > 122) bpm /= 2;
    while (bpm < 58) bpm *= 2;
    return bpm;
  }

  function danceInfo() {
    try { return global.SocialActionWheel?.getDebug?.()?.dancing || null; }
    catch (_) { return null; }
  }

  function currentPlayerMesh() {
    return global.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || global.ProceduralHandAttachments?.gameDeps?.playerMesh
      || global.Combat?.deps?.playerMesh
      || null;
  }

  function dimensions(player) {
    let plane = null;
    player?.traverse?.(node => {
      if (!plane && node?.isMesh && (node.userData?.hobunjiPlaneFace || /(?:front|back|skinned).*plane|avatar.*plane/i.test(node.name || ''))) plane = node;
    });
    const parameters = plane?.geometry?.parameters || {};
    const width = Number(player?.userData?.portraitModelWidth) || Number(parameters.width) || 0.9;
    const height = Number(player?.userData?.portraitModelHeight) || Number(parameters.height) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function danceMotion(style, beat, mappedIntensity) {
    const phase = beat * Math.PI * 2;
    const alternatingWeight = Math.sin(phase * 0.5);
    const fourBeatSway = Math.sin(phase * 0.25);
    const beatPulse = Math.pow(Math.max(0, Math.cos(phase)), 4);
    let tangentShift = 0;
    let bounce = 0;
    let bodySway = 0;
    let twirlRotation = 0;

    if (style === 'side-step') {
      tangentShift = alternatingWeight * 0.30 * mappedIntensity;
      bounce = beatPulse * 0.12 * mappedIntensity;
      bodySway = fourBeatSway * 0.22 * mappedIntensity;
    } else if (style === 'gentle-twirl') {
      tangentShift = alternatingWeight * 0.14 * mappedIntensity;
      bounce = beatPulse * 0.12 * mappedIntensity;
      bodySway = fourBeatSway * 0.20 * mappedIntensity;
      const cycle = ((beat % 8) + 8) % 8;
      const turnProgress = clamp01((cycle - 4.5) / 2);
      twirlRotation = mappedIntensity >= 0.56
        ? Math.PI * 2 * smootherstep01(turnProgress)
        : Math.sin(turnProgress * Math.PI) * 0.8 * mappedIntensity;
    } else {
      tangentShift = alternatingWeight * 0.18 * mappedIntensity;
      bounce = beatPulse * 0.09 * mappedIntensity;
      bodySway = fourBeatSway * 0.36 * mappedIntensity;
    }

    return { tangentShift, bounce, bodySway, twirlRotation };
  }

  function isPortraitPlane(node) {
    if (!node?.isMesh) return false;
    if (node.userData?.hobunjiPlaneFace) return true;
    const name = String(node.name || '').toLowerCase();
    return name.includes('front_plane')
      || name.includes('back_plane')
      || (name.includes('avatar') && name.includes('plane'))
      || (node.isSkinnedMesh && name.includes('avatar'));
  }

  function hookPlane(mesh) {
    if (!mesh || hooked.has(mesh)) return false;
    hooked.add(mesh);
    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    mesh.onBeforeRender = function socialDanceBodyPlaneMatrixSync(...args) {
      // Composer changes playerMesh immediately outside the native r128 render.
      // Rebuild this descendant from that temporary parent transform before any
      // existing portrait/outline callback inspects or snapshots matrixWorld.
      if (danceInfo()) {
        this.updateWorldMatrix?.(true, false);
        state.planeSyncs++;
      }
      return previousBefore?.apply(this, args);
    };
    state.hookedPlanes++;
    return true;
  }

  function discoverPlanes() {
    const player = currentPlayerMesh();
    player?.traverse?.(node => { if (isPortraitPlane(node)) hookPlane(node); });
  }

  function submitBodyChannel(t) {
    const info = danceInfo();
    const composer = global.PlayerBodyTransformComposer;
    if (!info || !composer?.setChannel) {
      if (state.wasDancing && composer?.clearChannel) composer.clearChannel(CHANNEL);
      state.wasDancing = false;
      state.danceKey = null;
      state.startedAt = 0;
      return;
    }

    const key = `${info.style || ''}|${info.armStyle || ''}`;
    if (!state.startedAt || state.danceKey !== key) {
      state.danceKey = key;
      state.startedAt = t;
    }

    const cfg = global.SCRATCHBONES_CONFIG?.game?.socialActions || {};
    const bpm = tactusBpm(cfg.danceBpm);
    const beat = (t - state.startedAt) / (60000 / bpm);
    const style = STYLE[info.style] || STYLE['loose-sway'];
    const mappedIntensity = grooveScale(cfg.danceGroove ?? 72) * style.intensity;
    const motion = danceMotion(info.style, beat, mappedIntensity);
    const d = dimensions(currentPlayerMesh());
    const sizeScale = d.width / 0.9;

    composer.setChannel(CHANNEL, {
      priority: 60,
      rotation: { pitch: 0, yaw: motion.twirlRotation, roll: motion.bodySway },
      translation: { x: motion.tangentShift * sizeScale, y: motion.bounce * sizeScale, z: 0 },
    });
    state.channelUpdates++;
    state.wasDancing = true;
  }

  function frame(t) {
    discoverPlanes();
    submitBodyChannel(t);
    global.requestAnimationFrame(frame);
  }

  global.SocialActionBodyPlaneRuntime = Object.freeze({
    installed: true,
    getDebug() {
      const composer = global.PlayerBodyTransformComposer?.getDebug?.() || null;
      return {
        dancing: !!danceInfo(),
        hookedPlanes: state.hookedPlanes,
        planeSyncs: state.planeSyncs,
        channelUpdates: state.channelUpdates,
        composerPlayerAttached: !!composer?.playerAttached,
        composerAppliedOrder: composer?.appliedOrder || [],
        composerLastRenderOrder: composer?.lastRender?.appliedOrder || [],
      };
    },
  });

  global.requestAnimationFrame(frame);
})(window);

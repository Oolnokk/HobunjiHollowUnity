// Scratchbones emoji reactions, adapted from its original card-game effects.
// Sends the original silhouettes and animation curves to the shared world popup renderer.
(() => {
  'use strict';
  const TYPES = Object.freeze({ // Animation timing and tint used by all world actors.
    love: { icon: 'emoji_love.png', color: '#ff88ca', duration: 1650 },
    disgust: { icon: 'emoji_disgust.png', color: '#7ac65c', duration: 1650 },
    alarmed: { icon: 'emoji_alarmed.png', color: '#ff5454', duration: 680 },
    curious: { icon: 'emoji_curious.png', color: '#ffffff', duration: 680 },
    shock: { icon: 'emoji_curious.png', color: '#ff2d2d', duration: 1500 },
    gloat: { icon: 'emoji_gloat_cloud.png', color: '#c8d7e8', duration: 3800 },
  });
  const COINS = Object.freeze(['emoji_gloat_coin1.png', 'emoji_gloat_coin2.png', 'emoji_gloat_coin3.png']); // Original animated gloat-coin variations.
  const COIN_COLORS = Object.freeze(['#4d9980', '#dad4af', '#a2a0a0']); // Verdigris, white bronze and tin.
  const EMOJI_SIZE_FACTOR = 1 / 3; // Shrinks only reaction art and its animation travel, leaving other world popups alone.
  const EMOJI_GLOW_BLUR_PX = 5; // Subtle colored edge glow for each cached PNG mask.
  const ASSET_BASE = typeof document !== 'undefined' && document.currentScript?.src
    ? new URL('../assets/symbols/', document.currentScript.src).href : 'assets/symbols/'; // Asset path relative to module, not page URL.
  const masks = new Map(); // Cached tinted canvases, reused across actors and repeated coin particles.
  const lastByRoot = new WeakMap(); // Actor-specific cooldown shared by NPC and animal reaction triggers.
  const POPUP_KIND = 'scratchbonesEmoji'; // Used to replace a prior reaction and report active popups.
  const stats = { triggered: 0, completed: 0, failedAssets: 0, last: null, lastAssetError: null }; // Read by ?emojiDebug=1 and debugSnapshot().

  const POSE_FRAMES = Object.freeze({ // Immutable source animation curves reused by every frame without allocating arrays.
    love: [[0,0,0,.1,0,0], [.12,0,0,1.55,1,0], [.22,0,0,1.1,1,0],
      [.60,-.8,1.1,1.5,.95,0], [1,-1.8,2.2,2.1,0,0]],
    disgust: [[0,0,0,.35,0,0], [.08,0,0,1.3,1,-14],
      [.26,.65,.25,1.2,1,12], [1,1,-8.4,1.15,0,260]],
    burst: [[0,0,0,.05,0,0], [.18,0,0,2.1,1,0], [.58,0,0,2.1,1,0],
      [1,0,1.3,2.9,0,0]],
    gloatCloud: [[0,0,0,.08,0,0], [.14,0,0,1.12,.88,0],
      [.22,0,0,.96,.82,0], [.72,0,0,1,.78,0], [1,0,0,1.04,0,0]],
  });
  function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
  function smooth(value) { const t = clamp(value); return t * t * (3 - 2 * t); }
  function lerpFrames(frames, progress) {
    const t = clamp(progress);
    let index = 1;
    while (index < frames.length - 1 && t > frames[index][0]) index++;
    const a = frames[index - 1], b = frames[index];
    const blend = smooth((t - a[0]) / Math.max(.0001, b[0] - a[0]));
    return { x: a[1] + (b[1] - a[1]) * blend,
      y: a[2] + (b[2] - a[2]) * blend,
      scale: a[3] + (b[3] - a[3]) * blend,
      alpha: a[4] + (b[4] - a[4]) * blend,
      rotation: a[5] + (b[5] - a[5]) * blend };
  }
  function sample(type, progress, part = 'icon', index = 0) {
    const t = clamp(progress); // Sample position, size and opacity independently of frame rate.
    if (type === 'love') return lerpFrames(POSE_FRAMES.love, t);
    if (type === 'disgust') return lerpFrames(POSE_FRAMES.disgust, t);
    if (type === 'alarmed' || type === 'curious') return lerpFrames(POSE_FRAMES.burst, t);
    if (type === 'shock') {
      const phase = clamp((t * 1500 - index * 25) / 1460); // Five rays burst at staggered 25 ms offsets.
      const angle = (-60 + index * 30) * Math.PI / 180;
      const distance = 1.7 * smooth(Math.min(1, phase / .45)) * (phase > .45 ? 1 + (phase - .45) * .55 : 1);
      return { x: Math.sin(angle) * distance, y: Math.cos(angle) * distance,
        scale: 1.15, alpha: Math.min(1, phase * 10) * (1 - smooth(Math.max(0, (phase - .45) / .55))),
        rotation: 0 };
    }
    if (type === 'gloat' && part === 'cloud') return lerpFrames(POSE_FRAMES.gloatCloud, t);
    if (type === 'gloat') {
      const phase = (t * 3800 - 150 - index * 105) / 1350; // Three staggered streams of falling coins.
      if (phase <= 0 || phase >= 1) return { x: 0, y: 0, scale: 1, alpha: 0, rotation: 0 };
      const lane = index % 3 - 1;
      return { x: lane * .72 + (index % 5 - 2) * .07 * phase,
        y: -2.2 * phase, scale: .76,
        alpha: Math.min(.9, phase * 9) * (1 - smooth(Math.max(0, (phase - .67) / .33))),
        rotation: (index % 2 ? -1 : 1) * 280 * phase };
    }
    return null;
  }

  function maskFor(icon, color) {
    const key = icon + ':' + color; // The same tinted mask backs every use of this icon and color.
    if (masks.has(key)) return masks.get(key);
    const promise = new Promise(resolve => {
      const image = new Image(); // Load anonymously before setting src so the composed canvas can be uploaded to WebGL.
      image.crossOrigin = 'anonymous';
      const fail = error => {
        stats.failedAssets++;
        stats.lastAssetError = { icon, reason: error.message };
        const label = document.getElementById('hobunjiEmojiDebugStatus'); // Reports image failures without needing devtools.
        if (label) label.textContent = icon + ': ' + error.message;
        masks.delete(key); // A later reaction can retry a temporary image failure.
        resolve(null);
      };
      image.onerror = () => fail(new Error('PNG could not be loaded'));
      image.onload = () => {
        try {
          const mask = document.createElement('canvas'); // Tint the source silhouette using its alpha.
          const canvas = document.createElement('canvas'); // Cache the final tint and glow.
          mask.width = mask.height = canvas.width = canvas.height = 128;
          const maskCtx = mask.getContext('2d'), ctx = canvas.getContext('2d');
          if (!maskCtx || !ctx) throw new Error('2D canvas unavailable');
          const factor = Math.min(90 / image.naturalWidth, 90 / image.naturalHeight); // Center the artwork without stretching it.
          maskCtx.imageSmoothingEnabled = false;
          maskCtx.drawImage(image, (128 - image.naturalWidth * factor) / 2,
            (128 - image.naturalHeight * factor) / 2, image.naturalWidth * factor, image.naturalHeight * factor);
          maskCtx.globalCompositeOperation = 'source-in';
          maskCtx.fillStyle = color;
          maskCtx.fillRect(0, 0, 128, 128);
          ctx.shadowColor = color;
          ctx.shadowBlur = EMOJI_GLOW_BLUR_PX;
          ctx.drawImage(mask, 0, 0);
          ctx.shadowBlur = 0;
          ctx.drawImage(mask, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; // Reject blank or CORS-tainted art before WebGL upload.
          let pixel = 3; // Walk the alpha channel until the first visible pixel.
          while (pixel < pixels.length && !pixels[pixel]) pixel += 4;
          if (pixel >= pixels.length) throw new Error('PNG mask is empty');
          resolve(canvas);
        } catch (error) { fail(error); }
      };
      image.src = ASSET_BASE + icon;
    });
    masks.set(key, promise);
    return promise;
  }
  function partsFor(type) {
    const definition = TYPES[type];
    if (type === 'shock') return Array.from({ length: 5 }, (_, index) => ({
      icon: index % 2 ? 'emoji_alarmed.png' : 'emoji_curious.png',
      color: definition.color, part: 'ray', index }));
    if (type === 'gloat') {
      const items = [{ icon: definition.icon, color: definition.color, part: 'cloud', index: 0 }]; // One stable cloud above falling coins.
      for (let i = 0; i < 18; i++) items.push({
        icon: COINS[i % COINS.length], color: COIN_COLORS[i % COIN_COLORS.length], part: 'coin', index: i });
      return items;
    }
    return [{ icon: definition.icon, color: definition.color, part: 'icon', index: 0 }];
  }
  function heightFor(root, fallback) {
    const fallbackHeight = Math.max(.35, Number(fallback) || 1.1); // Uses authored height when no useful visible geometry is available.
    try {
      root.updateWorldMatrix?.(true, true);
      const box = new window.THREE.Box3().setFromObject(root); // Calculated once on trigger, *before* sprites are added.
      if (box.isEmpty()) return fallbackHeight;
      const position = root.getWorldPosition(new window.THREE.Vector3()); // Convert absolute box top to root-relative height.
      const scale = root.getWorldScale(new window.THREE.Vector3()); // World Y scale includes species-specific scaling.
      const height = (box.max.y - position.y) / Math.max(.001, Math.abs(scale.y));
      return Number.isFinite(height) && height > .2 ? Math.min(6, height) : fallbackHeight;
    } catch (_) { return fallbackHeight; }
  }
  function trigger(root, inputType, options = {}) {
    const type = String(inputType || '').toLowerCase();
    const popup = window.WorldPopupText; // Owns the billboard, animation clock, and scene lifecycle.
    if (!Object.hasOwn(TYPES, type) || !root?.isObject3D || !root.parent || root.visible === false || !popup?.showIconEffect) return false;
    const now = performance.now();
    const last = lastByRoot.get(root); // Limits repeated emotional reactions on any one character.
    if (!options.force && last != null && now - last < 900) return false;
    const height = heightFor(root, options.height); // Popups attach to the scene, so previous reactions never affect actor bounds.
    const accepted = popup.showIconEffect(root, {
      kind: POPUP_KIND,
      duration: TYPES[type].duration,
      height: height + .28,
      size: Math.max(.25, Math.min(.62, height * .38)) * EMOJI_SIZE_FACTOR,
      loadParts: () => Promise.all(partsFor(type).map(async item => {
        const widthScale = item.part === 'cloud' ? 2 : item.part === 'coin' ? .72 : item.part === 'ray' ? .8 : 1; // Preserve the source cloud, coin and ray proportions.
        return { part: item.part, index: item.index, canvas: await maskFor(item.icon, item.color),
          name: 'scratchbones_emoji_' + type, widthScale, heightScale: item.part === 'cloud' ? .92 : widthScale };
      })),
      sample: (progress, part, index) => sample(type, progress, part, index),
      onDispose: () => { stats.completed++; },
    });
    if (!accepted) return false;
    lastByRoot.set(root, now);
    stats.triggered++;
    stats.last = { actor: root.name || 'character', type, at: Date.now() };
    return true;
  }
  function reactionForDialogue(options = {}) {
    if (options.emojiReaction === false) return null;
    if (Object.hasOwn(TYPES, options.emojiReaction)) return options.emojiReaction;
    const tone = String(options.tone || '').toLowerCase(); // Existing NPC tone categories, not guessed text sentiment.
    if (tone === 'animal') return null; // Creature vocalizations have their own warning/growl hook.
    if (tone === 'shock' || tone === 'surprise' || tone === 'startled') return 'shock';
    if (tone === 'warning' || tone === 'alarmed') return 'alarmed';
    if (tone === 'gloat' || tone === 'cheer' || tone === 'reaction-silliness-positive') return 'gloat'; // Gloating coin shower is used for exuberant cheers and playful NPC reactions.
    if (tone.includes('negative') || tone === 'jeer' || tone === 'refuse') return 'disgust';
    if (tone.includes('positive') || tone === 'accept') return 'love';
    if (tone === 'quest' || tone === 'question') return 'curious';
    return options.greeting === true ? 'curious' : null;
  }
  function reactToDialogue(root, options) {
    const type = reactionForDialogue(options);
    return type ? trigger(root, type, options) : false;
  }
  function debugSnapshot() {
    return { ...stats, active: window.WorldPopupText?.countIconEffects?.(POPUP_KIND) || 0, loadedMasks: masks.size,
      latestChange: 'Reaction sprites are one-third size with subtler glow; other popups are unchanged.' };
  }
  function debugControls() {
    if (typeof document === 'undefined' || typeof location === 'undefined' || !new URLSearchParams(location.search).has('emojiDebug')) return;
    const mount = () => {
      if (!document.body || document.getElementById('hobunjiEmojiDebug')) return;
      const panel = document.createElement('section'); // Tiny touch-friendly optional debug UI for mobile.
      panel.id = 'hobunjiEmojiDebug';
      panel.style.cssText = 'position:fixed;right:10px;bottom:95px;z-index:30001;background:#1b2028e8;color:white;border:1px solid #aaa;border-radius:10px;padding:8px;max-width:240px;font:12px sans-serif';
      const label = document.createElement('div'); // The button result appears above the buttons without needing the console.
      label.id = 'hobunjiEmojiDebugStatus';
      label.setAttribute('role', 'status');
      label.textContent = 'Scratchbones emoji popup debug';
      panel.appendChild(label);
      for (const type of Object.keys(TYPES)) {
        const button = document.createElement('button'); // Trigger each source animation on the live player rig.
        button.textContent = type;
        button.style.cssText = 'margin:3px;padding:5px;color:#fff;background:#38465c;border:1px solid #9aa9bf;border-radius:5px';
        button.addEventListener('pointerdown', e => e.stopPropagation());
        button.addEventListener('click', e => {
          e.stopPropagation();
          const root = window.PlayerBodyTransformComposer?.getPlayerMesh?.()
            || window.Combat?.deps?.playerMesh || null;
          label.textContent = root && trigger(root, type, { force: true }) ? 'Playing ' + type : 'Emoji popup unavailable';
        });
        panel.appendChild(button);
      }
      document.body.appendChild(panel);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }
  window.HobunjiEmojiReactions = Object.freeze({ trigger, reactToDialogue, reactionForDialogue, sample, debugSnapshot });
  debugControls();
})();

// Scratchbones emoji reactions, adapted from its original card-game effects.
// Reuses the original silhouette PNGs and shows them as world-space billboards
// above NPC and livestock models, without changing character animations.
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
  const ASSET_BASE = typeof document !== 'undefined' && document.currentScript?.src
    ? new URL('../assets/symbols/', document.currentScript.src).href : 'assets/symbols/'; // Asset path relative to module, not page URL.
  const textures = new Map(); // Promise cache for recolored PNG-mask textures shared by every speaker.
  const active = new Set(); // Live short-lived effects; the updater never traverses the entire scene.
  const lastByRoot = new WeakMap(); // Actor-specific cooldown shared by NPC and animal reaction triggers.
  const stats = { triggered: 0, completed: 0, failedAssets: 0, last: null }; // Read by Pixel Probe or ?emojiDebug=1.
  const FRAME_SUBSCRIBER_ID = 'scratchbones-emoji-reactions'; // Single owner for render-time animation, managed by RuntimeFrameScheduler.
  let frameRegistered = false; // Lazy registration keeps this effect entirely inactive until first use.
  const generationByRoot = new WeakMap(); // Ignores stale async image loads when a newer reaction takes over the same actor.

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

  function textureFor(icon, color) {
    const key = icon + ':' + color; // Same recolored source is shared by all instances.
    if (textures.has(key)) return textures.get(key);
    const promise = new Promise(resolve => {
      if (!window.THREE?.CanvasTexture || typeof Image === 'undefined' || typeof document === 'undefined') {
        resolve(null);
        return;
      }
      const image = new Image(); // Original source mask loaded through browser's image cache.
      image.onerror = () => { stats.failedAssets++; resolve(null); };
      image.onload = () => {
        try {
          const mask = document.createElement('canvas'); // One intermediate canvas applies the tint through alpha masking.
          const canvas = document.createElement('canvas'); // Final cached glow/billboard texture.
          mask.width = mask.height = canvas.width = canvas.height = 128;
          const maskCtx = mask.getContext('2d'), ctx = canvas.getContext('2d');
          if (!maskCtx || !ctx) throw new Error('2D canvas unavailable');
          const factor = Math.min(90 / (image.width || 1), 90 / (image.height || 1)); // Fits original transparent pixels within an icon square.
          maskCtx.imageSmoothingEnabled = false;
          maskCtx.drawImage(image, (128 - image.width * factor) / 2,
            (128 - image.height * factor) / 2, image.width * factor, image.height * factor);
          maskCtx.globalCompositeOperation = 'source-in';
          maskCtx.fillStyle = color;
          maskCtx.fillRect(0, 0, 128, 128);
          ctx.shadowColor = color;
          ctx.shadowBlur = 17;
          ctx.drawImage(mask, 0, 0);
          ctx.shadowBlur = 0;
          ctx.drawImage(mask, 0, 0);
          const texture = new window.THREE.CanvasTexture(canvas); // Global per-color cache; no redraw in tick().
          if (window.THREE.SRGBColorSpace) texture.colorSpace = window.THREE.SRGBColorSpace;
          texture.magFilter = window.THREE.LinearFilter;
          texture.minFilter = window.THREE.LinearFilter;
          resolve(texture);
        } catch (_) { stats.failedAssets++; resolve(null); }
      };
      image.src = ASSET_BASE + icon;
    });
    textures.set(key, promise);
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
  function end(effect) {
    active.delete(effect);
    for (const item of effect.items) {
      effect.root.remove(item.sprite);
      item.sprite.material.dispose(); // Dispose only per-instance materials, never shared textures.
    }
    stats.completed++;
  }
  function update(frameContext) {
    const now = Number(frameContext?.timestamp) || performance.now(); // Authoritative pre-render frame time, shared with the game.
    for (const effect of active) {
      const progress = (now - effect.startedAt) / effect.duration;
      if (!effect.root.parent || effect.root.visible === false || progress >= 1) {
        end(effect);
        continue;
      }
      for (const item of effect.items) {
        const pose = sample(effect.type, progress, item.part, item.index);
        const sprite = item.sprite;
        sprite.visible = !!pose && pose.alpha > .001;
        if (!pose) continue;
        sprite.position.set(pose.x * effect.size, effect.height + .28 + pose.y * effect.size, .05);
        const factor = item.part === 'cloud' ? 2 : item.part === 'coin' ? .72 : item.part === 'ray' ? .8 : 1;
        sprite.scale.set(effect.size * pose.scale * factor, effect.size * pose.scale *
          (item.part === 'cloud' ? .92 : factor), 1);
        sprite.material.opacity = pose.alpha;
        sprite.material.rotation = pose.rotation * Math.PI / 180;
      }
    }
    if (!active.size) window.RuntimeFrameScheduler?.setEnabled?.(FRAME_SUBSCRIBER_ID, false); // Nothing remains to animate between reactions.
  }
  function ensureFrameOwner() {
    const scheduler = window.RuntimeFrameScheduler; // The parser-bootstrapped game scheduler owns every persistent browser frame.
    if (!scheduler?.register || !scheduler?.setEnabled) return false;
    if (frameRegistered) return true;
    scheduler.register(FRAME_SUBSCRIBER_ID, update, {
      phase: 'pre-render', enabled: false, owner: 'HobunjiEmojiReactions',
      description: 'Move and expire Scratchbones emoji billboards after gameplay pose updates, before scene render.',
    });
    frameRegistered = true;
    return true;
  }

  function trigger(root, inputType, options = {}) {
    const type = String(inputType || '').toLowerCase();
    if (!TYPES[type] || !root?.isObject3D || !root.parent || root.visible === false || !ensureFrameOwner()) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = lastByRoot.get(root); // Limits repeated emotional reactions on any one character.
    if (!options.force && last != null && now - last < 900) return false;
    if (active.size >= 20) return false; // Hard cap for crowded festival scenes.
    lastByRoot.set(root, now);
    for (const effect of active) if (effect.root === root) end(effect); // Do not stack sprites or mistake a previous emoji for character height.
    const generation = (generationByRoot.get(root) || 0) + 1; // Newer reactions supersede pending async masks for this actor.
    generationByRoot.set(root, generation);
    const height = heightFor(root, options.height); // Read geometry after retiring any previous emoji from this root.
    const size = Math.max(.25, Math.min(.62, height * .38)); // Proportional to species size but still legible on small animals.
    const parts = partsFor(type); // Sprite specifications for a single icon, five rays or a cloud/coin shower.
    stats.triggered++;
    stats.last = { actor: root.name || 'character', type, at: Date.now() };
    Promise.all(parts.map(item => textureFor(item.icon, item.color))).then(loaded => {
      if (!root.parent || root.visible === false || active.size >= 20 || generationByRoot.get(root) !== generation) return;
      const items = []; // Own one disposable material per sprite; share recolored mask textures.
      for (let i = 0; i < parts.length; i++) {
        if (!loaded[i]) continue;
        const material = new window.THREE.SpriteMaterial({ map: loaded[i], transparent: true,
          opacity: 0, depthTest: true, depthWrite: false, fog: false, toneMapped: false }); // Opaque world surfaces occlude the FX; avoid through-wall emojis.
        const sprite = new window.THREE.Sprite(material);
        sprite.name = 'scratchbones_emoji_' + type;
        sprite.userData.hobunjiEmojiFx = true;
        sprite.renderOrder = 9990;
        root.add(sprite);
        items.push({ sprite, part: parts[i].part, index: parts[i].index });
      }
      if (!items.length) return;
      active.add({ root, type, items, height, size, duration: TYPES[type].duration, startedAt: performance.now() });
      window.RuntimeFrameScheduler.setEnabled(FRAME_SUBSCRIBER_ID, true); // Wake the dormant pre-render subscriber only for an active reaction.
    }).catch(() => { stats.failedAssets++; });
    return true;
  }
  function reactionForDialogue(options = {}) {
    if (options.emojiReaction === false) return null;
    if (TYPES[options.emojiReaction]) return options.emojiReaction;
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
  function debugSnapshot() { return { ...stats, active: active.size, loadedMasks: textures.size }; }
  function debugControls() {
    if (typeof document === 'undefined' || typeof location === 'undefined' || !new URLSearchParams(location.search).has('emojiDebug')) return;
    const mount = () => {
      if (!document.body || document.getElementById('hobunjiEmojiDebug')) return;
      const panel = document.createElement('section'); // Tiny touch-friendly optional debug UI for mobile.
      panel.id = 'hobunjiEmojiDebug';
      panel.style.cssText = 'position:fixed;right:10px;bottom:95px;z-index:30001;background:#1b2028e8;color:white;border:1px solid #aaa;border-radius:10px;padding:8px;max-width:240px;font:12px sans-serif';
      const label = document.createElement('div'); // The button result appears above the buttons without needing the console.
      label.textContent = 'Scratchbones emoji debug';
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
          label.textContent = root && trigger(root, type, { force: true }) ? 'Playing ' + type : 'Player rig not available';
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

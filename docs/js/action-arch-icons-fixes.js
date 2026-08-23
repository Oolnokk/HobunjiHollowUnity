// Follow-up presentation fixes for the dedicated action-arch artwork.
// Loaded after action-arch-icons.js so it can repair/redecorate DOM nodes that
// game.js and the base arch module rebuild dynamically without changing combat logic.
(() => {
  'use strict';
  if (window.ActionArchIconFixes?.installed) return;

  const ICON_BASE = new URL('assets/hud/action_icons/', document.baseURI).href; // Used for potion/quiver/combo artwork below.
  const imageState = new Map(); // filename -> preload record used by canvas/plain PNG renderers.
  const rasterCache = new Map(); // composite key -> data URL for combo/ammo numbered symbols.
  let queued = false; // Coalesces action-bar rebuilds into one presentation pass.
  let observer = null; // Stored for debug/duplicate-install status.

  function log(message, level = 'items') {
    window.__farmLog?.(`[action-arch-fixes] ${message}`, level);
  }

  function ensureStyles() {
    if (document.getElementById('actionArchIconFixStyles')) return;
    const style = document.createElement('style');
    style.id = 'actionArchIconFixStyles';
    style.textContent = `
      /* The exponent is a sibling of the clipped circular face, so it can sit
         genuinely outside the button rather than being shaved off at the rim. */
      button.combat-dual-input { overflow: visible !important; }
      button.combat-dual-input > .combat-hold-exponent {
        position:absolute !important;
        right:-13% !important;
        top:-13% !important;
        width:30% !important;
        height:30% !important;
        display:grid !important;
        place-items:center !important;
        z-index:9 !important;
        pointer-events:none !important;
        opacity:1;
        transform:scale(1);
        transform-origin:center;
        transition:opacity 90ms ease, transform 90ms ease;
        filter:drop-shadow(0 1px 2px rgba(0,0,0,.72));
      }
      button.combat-dual-input.combat-hold-flipped > .combat-hold-exponent {
        opacity:0;
        transform:scale(.65);
      }
      button.combat-dual-input > .combat-hold-exponent .action-arch-png {
        width:100% !important;
        height:100% !important;
      }
      .action-arch-fix-icon {
        width:78%; height:78%; object-fit:contain; display:block; margin:auto;
        pointer-events:none; filter:brightness(0) invert(1);
      }
      .action-arch-numbered-raster {
        width:82%; height:82%; object-fit:contain; display:block; margin:auto;
        pointer-events:none;
      }
      .action-arch-combo-layered {
        position:relative; width:100%; height:100%; display:grid; place-items:center;
      }
      .action-arch-combo-layered > img {
        position:absolute; inset:0; width:100%; height:100%; object-fit:contain;
      }
      .action-arch-combo-layered > span {
        position:relative; z-index:2; color:#fff;
        font:700 1.68em/1 'KhymeryyanRomanLetters+Numbers','DM Mono',monospace;
        text-shadow:0 0 4px #111,0 0 4px #111;
      }
      @media (prefers-reduced-motion: reduce) {
        button.combat-dual-input > .combat-hold-exponent { transition-duration:1ms; }
      }
    `;
    document.head.appendChild(style);
  }

  function preload(file) {
    const existing = imageState.get(file);
    if (existing) return existing;
    const record = { file, url: new URL(file, ICON_BASE).href, state:'loading', image:null };
    imageState.set(file, record);
    const image = new Image();
    record.image = image;
    image.onload = () => { record.state = 'loaded'; rasterCache.clear(); queueRefresh(); };
    image.onerror = () => { record.state = 'failed'; log(`Failed to load ${record.url}`, 'error'); };
    image.src = record.url;
    return record;
  }

  function plainIcon(file, alt = '') {
    const record = preload(file);
    if (record.state !== 'loaded') return null;
    const image = document.createElement('img');
    image.src = record.url;
    image.alt = alt;
    image.draggable = false;
    image.className = 'action-arch-fix-icon';
    image.dataset.actionArchFixIcon = file;
    return image;
  }

  function actionIconHost(button) {
    return button?.querySelector?.('.abt-icon') || null;
  }

  function actionButtons() {
    return [...document.querySelectorAll('#actionStack button[data-action]')];
  }

  function actionButton(action) {
    return actionButtons().find(button => !button.classList.contains('abt-hidden') && button.dataset.action === action) || null;
  }

  function combatButton(slotIndex) {
    return window.ActionArchIcons?.combatButtonForSlot?.(slotIndex)
      || document.querySelector(`#actionStack button[data-combat-slot="${slotIndex}"]`)
      || null;
  }

  function isDedicatedHost(host) {
    return Boolean(host?.querySelector?.('.combat-coin, .action-arch-fix-icon, .action-arch-numbered-raster, .action-arch-combo-layered'));
  }

  function hideLegacyHost(button) {
    const host = actionIconHost(button);
    if (!host || isDedicatedHost(host)) return;
    host.style.visibility = 'hidden'; // MutationObservers run before paint, preventing one-frame legacy glyph flashes.
  }

  function suppressFreshLegacyGlyphs() {
    const dedicatedActions = new Set(['cut', 'slash', 'potion_select', 'ammo_select']);
    actionButtons().forEach(button => {
      const host = actionIconHost(button);
      if (!host) return;
      if (dedicatedActions.has(button.dataset.action)) hideLegacyHost(button);
      else host.style.visibility = ''; // World-context actions must immediately reclaim their own icon host.
    });
  }

  function moveExponentOutside(button) {
    if (!button?.classList?.contains('combat-dual-input')) return;
    const nested = button.querySelector('.combat-coin-front .combat-hold-exponent');
    const direct = [...button.children].find(child => child.classList?.contains('combat-hold-exponent')) || null;
    if (!nested) return;
    if (direct && direct !== nested) direct.remove();
    button.appendChild(nested); // Leaves the exponent outside .abt-icon/.combat-coin-face clipping.
  }

  function comboAbilityId() {
    return window.Combat?.loadout?.getSlot?.('tap1') || window.Combat?.deps?.currentComboAbilityId?.() || 'swingCombo';
  }

  function comboStep() {
    const id = comboAbilityId();
    try {
      const snapshot = window.ActionArchIcons?.debugSnapshot?.();
      const entry = snapshot?.combo?.find?.(item => item.id === id);
      const step = Number(entry?.shownNextStep || entry?.nextStep);
      if (step >= 1 && step <= 3) return step;
    } catch (_) {}
    return 1;
  }

  function composeNumbered(file, number, rotationDeg = 0, cachePrefix = 'numbered', options = {}) {
    const { drawNumeral = true } = options;
    const record = preload(file);
    if (record.state !== 'loaded' || !record.image?.naturalWidth) return null;
    const key = `${cachePrefix}:v4:${file}:${number}:${rotationDeg}:${drawNumeral ? 'with-text' : 'cutout-only'}`;
    if (rasterCache.has(key)) return rasterCache.get(key);

    const size = 160;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const source = record.image;
    const maxSide = 118;
    const scale = Math.min(maxSide / source.naturalWidth, maxSide / source.naturalHeight);
    const dw = source.naturalWidth * scale, dh = source.naturalHeight * scale;

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Number(rotationDeg || 0) * Math.PI / 180);
    ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);

    const text = String(Math.max(0, Math.floor(Number(number) || 0)));
    const px = text.length >= 2 ? 84 : 105;
    const font = `700 ${px}px "KhymeryyanRomanLetters+Numbers", "DM Mono", monospace`;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    ctx.globalCompositeOperation = 'destination-out';
    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.lineWidth = text.length >= 2 ? 20 : 23;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, size / 2, size / 2 + 3);
    ctx.fillText(text, size / 2, size / 2 + 3);
    ctx.restore();
    ctx.filter = 'none';
    ctx.lineWidth = text.length >= 2 ? 11 : 12;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, size / 2, size / 2 + 3);
    ctx.fillText(text, size / 2, size / 2 + 3);

    if (drawNumeral) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff';
      ctx.font = font;
      ctx.fillText(text, size / 2, size / 2 + 3);
    }

    let url = null;
    try { url = canvas.toDataURL('image/png'); } catch (_) {}
    if (url) rasterCache.set(key, url);
    return url;
  }

  function numberedImage(file, number, rotationDeg, cachePrefix, alt, options = {}) {
    const url = composeNumbered(file, number, rotationDeg, cachePrefix, options);
    if (!url) return null;
    const image = document.createElement('img');
    image.src = url;
    image.alt = alt;
    image.draggable = false;
    image.className = 'action-arch-numbered-raster';
    return image;
  }

  function comboLayeredContent(file, number, rotationDeg, cachePrefix, alt) {
    const url = composeNumbered(file, number, rotationDeg, cachePrefix, { drawNumeral: false });
    if (!url) return null;
    const wrap = document.createElement('span');
    wrap.className = 'action-arch-combo-layered';
    wrap.setAttribute('aria-label', alt);
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.draggable = false;
    image.className = 'action-arch-numbered-raster';
    const numeral = document.createElement('span');
    numeral.textContent = String(number);
    wrap.append(image, numeral);
    return wrap;
  }

  function fixComboButton() {
    const button = combatButton(1);
    if (!button?.classList?.contains('combat-dual-input')) return;
    const main = button.querySelector('.combat-coin-front .combat-main-symbol');
    if (!main) return;
    const step = comboStep();
    const signature = `${comboAbilityId()}:${step}:number150:white-count`;
    if (main.dataset.comboFixSignature === signature && !main.querySelector('.combat-slot-x')) return;

    const rotations = { 1:-90, 2:-45, 3:0 };
    const layered = comboLayeredContent('draw_melee.png', step, rotations[step] ?? 0, 'combo-fix', `Combo — next attack ${step}`);
    if (layered) {
      main.replaceChildren(layered);
    } else {
      const record = preload('draw_melee.png');
      if (record.state !== 'failed') {
        const wrap = document.createElement('span');
        wrap.className = 'action-arch-combo-layered';
        const raw = document.createElement('img');
        raw.src = record.url;
        raw.alt = '';
        raw.draggable = false;
        const numeral = document.createElement('span');
        numeral.textContent = String(step);
        wrap.append(raw, numeral);
        main.replaceChildren(wrap);
      }
    }
    main.dataset.comboFixSignature = signature;
  }

  function fixPotionShortcut() {
    const button = actionButton('potion_select');
    if (!button) return;
    const host = actionIconHost(button);
    const image = plainIcon('potion_select.png', button.querySelector('.abt-label')?.textContent || 'Potion select');
    if (!host || !image) return;
    if (!host.querySelector('img[data-action-arch-fix-icon="potion_select.png"]')) host.replaceChildren(image);
    host.style.visibility = 'visible';
  }

  function fixRangedAmmoShortcut() {
    const button = actionButton('ammo_select');
    if (!button || !window.RangedWeapons?.specialAmmoCount) return;
    const host = actionIconHost(button);
    if (!host) return;
    const count = Math.max(0, Math.floor(Number(window.RangedWeapons.specialAmmoCount()) || 0));
    const signature = `${count}:number150`;
    if (!(host.dataset.quiverCountSignature === signature && host.querySelector('.action-arch-numbered-raster'))) {
      const image = numberedImage('ammo_select.png', count, 0, 'special-ammo', `Special ammo: ${count}`);
      if (!image) return;
      host.replaceChildren(image);
      host.dataset.quiverCountSignature = signature;
    }
    host.style.visibility = 'visible';
  }

  function refresh() {
    queued = false;
    [1, 2].forEach(slotIndex => moveExponentOutside(combatButton(slotIndex)));
    fixComboButton();
    fixPotionShortcut();
    fixRangedAmmoShortcut();
    actionButtons().forEach(button => {
      const host = actionIconHost(button);
      if (!host) return;
      if (isDedicatedHost(host)) host.style.visibility = 'visible';
      else if (!['cut', 'slash', 'potion_select', 'ammo_select'].includes(button.dataset.action)) host.style.visibility = '';
    });
  }

  function queueRefresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(refresh);
  }

  function install() {
    ensureStyles();
    preload('draw_melee.png');
    preload('potion_select.png');
    preload('ammo_select.png');
    window.addEventListener('hobunji-combat-input-state', queueRefresh);
    window.addEventListener('hobunjiPlayerReady', queueRefresh);
    document.addEventListener('hobunji-ranged-ammo-change', queueRefresh);
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => { rasterCache.clear(); queueRefresh(); }).catch(() => {});
    }
    observer = new MutationObserver(() => {
      suppressFreshLegacyGlyphs();
      queueRefresh();
    });
    observer.observe(document.body, {
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true,
      attributeFilter:['data-action','data-combat-slot','aria-label','class','title'],
    });
    window.setInterval(queueRefresh, 100);
    suppressFreshLegacyGlyphs();
    queueRefresh();
  }

  window.ActionArchIconFixes = {
    installed: true,
    refresh: queueRefresh,
    debugSnapshot: () => ({
      comboAbilityId: comboAbilityId(),
      comboStep: comboStep(),
      combat1: combatButton(1)?.id || null,
      combat2: combatButton(2)?.id || null,
      potion: actionButton('potion_select')?.id || null,
      ammo: actionButton('ammo_select')?.id || null,
      actions: Object.fromEntries(actionButtons().map(button => [button.id, button.dataset.action || null])),
      hiddenHosts: actionButtons().filter(button => actionIconHost(button)?.style?.visibility === 'hidden').map(button => button.id),
      images: Object.fromEntries([...imageState].map(([file, record]) => [file, record.state])),
      observing: Boolean(observer),
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();

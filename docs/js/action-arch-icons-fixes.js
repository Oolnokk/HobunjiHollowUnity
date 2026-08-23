// Follow-up presentation fixes for the dedicated action-arch artwork.
// Loaded after action-arch-icons.js so it can repair/redecorate DOM nodes that
// game.js and the base arch module rebuild dynamically without changing combat logic.
(() => {
  'use strict';
  if (window.ActionArchIconFixes?.installed) return;

  const ICON_BASE = new URL('assets/hud/action_icons/', document.baseURI).href; // Used for the potion/quiver/combo artwork below.
  const imageState = new Map(); // filename -> preload record used by the canvas compositor and plain PNG renderer.
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
      .action-arch-combo-fallback {
        position:relative; width:100%; height:100%; display:grid; place-items:center;
      }
      .action-arch-combo-fallback > img {
        position:absolute; inset:0; width:100%; height:100%; object-fit:contain;
        filter:brightness(0) invert(1);
        transform:rotate(var(--combo-rotation, 0deg));
      }
      .action-arch-combo-fallback > span {
        position:relative; z-index:2; color:#fff;
        font:700 1.12em/1 'KhymeryyanRomanLetters+Numbers','DM Mono',monospace;
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

  function descriptor(element) {
    return [
      element?.dataset?.action,
      element?.dataset?.label,
      element?.getAttribute?.('aria-label'),
      element?.title,
      element?.querySelector?.('.abt-label')?.textContent,
      element?.textContent,
    ].filter(Boolean).join(' ').replace(/[_&/\\-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function actionIconHost(button) {
    return button?.querySelector?.('.abt-icon') || null;
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

  function composeNumbered(file, number, rotationDeg = 0, cachePrefix = 'numbered') {
    const record = preload(file);
    if (record.state !== 'loaded' || !record.image?.naturalWidth) return null;
    const key = `${cachePrefix}:${file}:${number}:${rotationDeg}`;
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

    // Purpose-built PNGs are authored black; turn the preserved alpha into white.
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);

    const text = String(Math.max(0, Math.floor(Number(number) || 0)));
    const px = text.length >= 2 ? 56 : 70;
    const font = `700 ${px}px "KhymeryyanRomanLetters+Numbers", "DM Mono", monospace`;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // Soft transparent moat + crisp inner cutout: same disconnected-overlap
    // treatment as the combo-number motif, so icon lines never cross the numeral.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.save();
    ctx.filter = 'blur(2px)';
    ctx.lineWidth = text.length >= 2 ? 13 : 15;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, size / 2, size / 2 + 3);
    ctx.fillText(text, size / 2, size / 2 + 3);
    ctx.restore();
    ctx.filter = 'none';
    ctx.lineWidth = text.length >= 2 ? 7 : 8;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, size / 2, size / 2 + 3);
    ctx.fillText(text, size / 2, size / 2 + 3);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.font = font;
    ctx.fillText(text, size / 2, size / 2 + 3);

    let url = null;
    try { url = canvas.toDataURL('image/png'); } catch (_) {}
    if (url) rasterCache.set(key, url);
    return url;
  }

  function numberedImage(file, number, rotationDeg, cachePrefix, alt) {
    const url = composeNumbered(file, number, rotationDeg, cachePrefix);
    if (!url) return null;
    const image = document.createElement('img');
    image.src = url;
    image.alt = alt;
    image.draggable = false;
    image.className = 'action-arch-numbered-raster';
    return image;
  }

  function fixComboButton() {
    const button = document.getElementById('btnAction1');
    if (!button?.classList?.contains('combat-dual-input')) return;
    const main = button.querySelector('.combat-coin-front .combat-main-symbol');
    if (!main) return;
    const step = comboStep();
    const signature = `${comboAbilityId()}:${step}`;
    if (main.dataset.comboFixSignature === signature && !main.querySelector('.combat-slot-x')) return;

    const rotations = { 1:-90, 2:-45, 3:0 };
    const image = numberedImage('draw_melee.png', step, rotations[step] ?? 0, 'combo-fix', `Combo — next attack ${step}`);
    if (image) {
      main.replaceChildren(image);
    } else {
      // Avoid showing an "unslotted" X while draw_melee.png is still decoding.
      const record = preload('draw_melee.png');
      if (record.state !== 'failed') {
        const wrap = document.createElement('span');
        wrap.className = 'action-arch-combo-fallback';
        wrap.style.setProperty('--combo-rotation', `${rotations[step] ?? 0}deg`);
        const raw = document.createElement('img'); raw.src = record.url; raw.alt = '';
        const numeral = document.createElement('span'); numeral.textContent = String(step);
        wrap.append(raw, numeral);
        main.replaceChildren(wrap);
      }
    }
    main.dataset.comboFixSignature = signature;
  }

  function weaponAction3IsPotion(button) {
    if (!button) return false;
    const own = descriptor(button);
    if (own.includes('potion')) return true;
    // On the weapon/ranged action layouts Action 3 is reserved for quick potion
    // selection; use neighboring combat/ranged actions as a fallback when the
    // legacy button only exposes its emoji and no useful label.
    const a1 = descriptor(document.getElementById('btnAction1'));
    const a2 = descriptor(document.getElementById('btnAction2'));
    return /\b(cut|slash|shoot|fire|load|reload|ammo|ranged)\b/.test(`${a1} ${a2}`);
  }

  function fixPotionShortcut() {
    const button = document.getElementById('btnAction3');
    if (!weaponAction3IsPotion(button)) return;
    const host = actionIconHost(button);
    const image = plainIcon('potion_select.png', button.getAttribute('aria-label') || 'Potion select');
    if (!host || !image) return;
    if (host.querySelector('img[data-action-arch-fix-icon="potion_select.png"]')) return;
    host.replaceChildren(image);
  }

  function rangedAmmoSelector(button) {
    if (!button) return false;
    const own = descriptor(button);
    if (/\b(ammo|quiver)\b/.test(own)) return true;
    const a1 = descriptor(document.getElementById('btnAction1'));
    return /\b(shoot|fire|reload|load|ranged|crossbow|scatterbow)\b/.test(a1) && !/\b(cut|slash)\b/.test(a1);
  }

  function fixRangedAmmoShortcut() {
    const button = document.getElementById('btnAction2');
    if (!rangedAmmoSelector(button) || !window.RangedWeapons?.specialAmmoCount) return;
    const host = actionIconHost(button);
    if (!host) return;
    const count = Math.max(0, Math.floor(Number(window.RangedWeapons.specialAmmoCount()) || 0));
    const signature = String(count);
    if (host.dataset.quiverCountSignature === signature && host.querySelector('.action-arch-numbered-raster')) return;
    const image = numberedImage('ammo_select.png', count, 0, 'special-ammo', `Special ammo: ${count}`);
    if (!image) return;
    host.replaceChildren(image);
    host.dataset.quiverCountSignature = signature;
  }

  function refresh() {
    queued = false;
    moveExponentOutside(document.getElementById('btnAction1'));
    moveExponentOutside(document.getElementById('btnAction2'));
    fixComboButton();
    fixPotionShortcut();
    fixRangedAmmoShortcut();
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
    document.fonts?.ready?.then?.(() => { rasterCache.clear(); queueRefresh(); }).catch?.(() => {});
    observer = new MutationObserver(queueRefresh);
    observer.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['data-action','data-label','aria-label','class','title'] });
    window.setInterval(queueRefresh, 100); // Mirrors the base module's cheap dynamic-loadout watcher.
    queueRefresh();
  }

  window.ActionArchIconFixes = {
    installed: true,
    refresh: queueRefresh,
    debugSnapshot: () => ({
      comboAbilityId: comboAbilityId(),
      comboStep: comboStep(),
      specialAmmo: window.RangedWeapons?.specialAmmoCount?.() ?? null,
      action2: descriptor(document.getElementById('btnAction2')),
      action3: descriptor(document.getElementById('btnAction3')),
      images: Object.fromEntries([...imageState].map(([file, record]) => [file, record.state])),
      observing: Boolean(observer),
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
(() => {
  'use strict';

  if (window.HobunjiGenericHudIcons?.version >= 1) return;

  const ICON_BASE = 'assets/hud/generic_icons/'; // Used as the single runtime base for all generic HUD icon files.
  const ICONS = Object.freeze({ // Used by DOM replacement and relationship popup rendering.
    heart: `${ICON_BASE}icon_heart.png`,
    exclamation: `${ICON_BASE}icon_exclamation.png`,
    question: `${ICON_BASE}icon_question.png`,
    x: `${ICON_BASE}icon_x.png`,
  });
  const HEART_COLORS = Object.freeze({ // Used to preserve the old relationship-heart color semantics while swapping the glyph art.
    '❤️': '#ff718f',
    '❤': '#ff718f',
    '♥': '#ff718f',
    '♥️': '#ff718f',
    '💜': '#9d73d9',
    '🖤': '#252126',
    '🤍': '#f4eee8',
  });
  const TOKEN_PATTERN = /(❤️|❤|♥️?|💜|🖤|🤍|❗|❓|❌|✖️?|✕)/gu; // Used to split visible runtime text into text and icon fragments.
  const TEXT_SKIP_SELECTOR = 'script,style,textarea,input,select,option,[data-generic-hud-icon]'; // Used to keep icon substitution out of editable/source-like DOM.
  const X_CONTROL_HINT = /(close|cancel|delete|remove|unequip|unassign|dismiss|clear)/i; // Used to distinguish a semantic × close/remove control from multiplication text.
  const RELATIONSHIPS_TAB_SELECTOR = '[data-mpanel="relationships"]'; // Used to make the Relationships tab a heart-only affordance.
  const RAPPORT_HEART_COLOR = '#ffd84d'; // Used only by Rapport change hearts so the changed value reads as temporary Rapport.
  const FAVOR_HEART_COLOR = '#ff8fbd'; // Used only by Favor change hearts so permanent Favor is explicitly pink, not negative red.
  const RELATIONSHIP_GAIN_COLOR = '#66d96f'; // Used by positive relationship change numbers regardless of which relationship value changed.
  const RELATIONSHIP_LOSS_COLOR = '#ff5b5b'; // Used by negative relationship change numbers regardless of which relationship value changed.
  const RELATIONSHIP_RENDER_ORDER = 1200; // Used to keep relationship popups in WorldPopupText's shell-outline-safe overlay band.
  const relationshipPopups = []; // Used by the WorldPopupText update extension to animate/dispose active Rapport and Favor changes.
  const decoratedMemoryArrays = new WeakSet(); // Used to ensure each relationship memory array reports Rapport changes exactly once.
  const initCaptureNames = new Set(); // Used to avoid installing duplicate dependency-capture wrappers on runtime namespaces.
  const debugState = { // Used by the in-game/mobile-accessible debug snapshot.
    replacementCount: 0,
    lastReplacement: null,
    runtimeDepsCaptured: false,
    popupDepsCaptured: false,
    lastRelationshipPopup: null,
    lastRelationshipPopupSkipped: null,
    lastRapportPopup: null,
    lastRapportPopupSkipped: null,
    lastFavorPopup: null,
    lastFavorPopupSkipped: null,
  };
  let runtimeDeps = null; // Used to resolve an NPC id to its current live walker/root.
  let popupDeps = null; // Used to access THREE/camera while extending WorldPopupText.
  let heartImagePromise = null; // Used to preload and reuse icon_heart.png for all relationship popup canvases.
  let observer = null; // Used to watch dynamically generated runtime UI for emoji/symbol additions.

  function injectStyles() {
    const styleId = 'hobunjiGenericHudIconStyles'; // Used to make style injection idempotent.
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style'); // Used to hold all generic icon sizing/tint rules without expanding style.css.
    style.id = styleId;
    style.textContent = `
      .generic-hud-icon {
        display: inline-block;
        width: 1em;
        height: 1em;
        min-width: 1em;
        vertical-align: -0.12em;
        flex: 0 0 auto;
        line-height: 1;
        pointer-events: none;
      }
      img.generic-hud-icon {
        object-fit: contain;
        object-position: center;
      }
      .generic-hud-icon-heart {
        background-color: var(--generic-heart-color, #ff718f);
        -webkit-mask: url('${ICONS.heart}') center / contain no-repeat;
        mask: url('${ICONS.heart}') center / contain no-repeat;
      }
      ${RELATIONSHIPS_TAB_SELECTOR} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      ${RELATIONSHIPS_TAB_SELECTOR} .relationships-tab-heart {
        width: 1.35em;
        height: 1.35em;
        --generic-heart-color: #ff718f;
        vertical-align: middle;
      }
      .vb-icon .generic-hud-icon-heart {
        width: 1.1em;
        height: 1.1em;
      }
    `;
    document.head?.appendChild(style);
  }

  function iconElement(kind, token = '') {
    const icon = kind === 'heart' ? document.createElement('span') : document.createElement('img'); // Used as the concrete PNG-backed replacement node.
    icon.className = `generic-hud-icon generic-hud-icon-${kind}`;
    icon.dataset.genericHudIcon = kind;
    icon.setAttribute('aria-hidden', 'true');
    if (kind === 'heart') {
      const heartColor = HEART_COLORS[token] || HEART_COLORS['❤️']; // Used to retain red/purple/black/white relationship states.
      icon.style.setProperty('--generic-heart-color', heartColor);
    } else {
      icon.src = ICONS[kind];
      icon.alt = '';
      icon.draggable = false;
    }
    return icon;
  }

  function tokenKind(token) {
    if (Object.prototype.hasOwnProperty.call(HEART_COLORS, token)) return 'heart';
    if (token === '❗') return 'exclamation';
    if (token === '❓') return 'question';
    return 'x';
  }

  function shouldSkipTextNode(node) {
    const parent = node?.parentElement; // Used to reject text whose owner should remain literal/editable.
    return !parent || !!parent.closest(TEXT_SKIP_SELECTOR);
  }

  function replaceTextNode(node) {
    if (!node?.nodeValue || shouldSkipTextNode(node)) return false;
    const source = node.nodeValue; // Used as the immutable text scanned for visible icon tokens.
    TOKEN_PATTERN.lastIndex = 0;
    if (!TOKEN_PATTERN.test(source)) return false;
    TOKEN_PATTERN.lastIndex = 0;
    const fragment = document.createDocumentFragment(); // Used to replace one text node with interleaved text/icon nodes.
    let cursor = 0; // Used to preserve source text between icon tokens.
    let match = null; // Used to iterate the global token regexp.
    while ((match = TOKEN_PATTERN.exec(source))) {
      if (match.index > cursor) fragment.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const token = match[0]; // Used to choose the correct icon asset and heart tint.
      fragment.appendChild(iconElement(tokenKind(token), token));
      cursor = match.index + token.length;
      debugState.replacementCount += 1;
      debugState.lastReplacement = { token, kind: tokenKind(token), at: Date.now() };
    }
    if (cursor < source.length) fragment.appendChild(document.createTextNode(source.slice(cursor)));
    node.replaceWith(fragment);
    return true;
  }

  function semanticLabel(element) {
    return [ // Used to classify symbol-only × controls without touching textual multiplication.
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.dataset?.action,
      element?.className,
      element?.id,
    ].filter(Boolean).join(' ');
  }

  function replaceSemanticTimesControl(element) {
    if (!(element instanceof Element) || element.closest?.('[data-generic-hud-icon]')) return false;
    const isControl = element.matches?.('button,[role="button"],.btn,.iconBtn'); // Used to restrict × conversion to interactive controls.
    if (!isControl || element.children.length || element.textContent.trim() !== '×') return false;
    if (!X_CONTROL_HINT.test(semanticLabel(element))) return false;
    element.textContent = '';
    element.appendChild(iconElement('x', '×'));
    debugState.replacementCount += 1;
    debugState.lastReplacement = { token: '×', kind: 'x', at: Date.now() };
    return true;
  }

  function styleRelationshipsTab() {
    const tab = document.querySelector(RELATIONSHIPS_TAB_SELECTOR); // Used as the single Relationships menu tab target.
    if (!tab || tab.dataset.genericRelationshipsHeart === '1') return false;
    tab.textContent = '';
    const heart = iconElement('heart', '❤️'); // Used as the tab's only visible content.
    heart.classList.add('relationships-tab-heart');
    tab.appendChild(heart);
    tab.dataset.genericRelationshipsHeart = '1';
    tab.setAttribute('aria-label', 'Relationships');
    tab.title = 'Relationships';
    return true;
  }

  function labelVitalsHeart() {
    const fill = document.getElementById('vbHealthFill'); // Used to find the health row after its emoji is replaced.
    const iconHost = fill?.closest?.('.vb-row')?.querySelector?.('.vb-icon'); // Used to keep the now-image-only health indicator accessible.
    if (iconHost && !iconHost.getAttribute('aria-label')) iconHost.setAttribute('aria-label', 'Health');
  }

  function scanNode(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      replaceTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) replaceSemanticTimesControl(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); // Used to visit only visible text candidates under the changed subtree.
    const textNodes = []; // Used to avoid mutating the DOM while TreeWalker is advancing.
    let current = null; // Used as the TreeWalker cursor.
    while ((current = walker.nextNode())) textNodes.push(current);
    textNodes.forEach(replaceTextNode);
    if (root.querySelectorAll) root.querySelectorAll('button,[role="button"],.btn,.iconBtn').forEach(replaceSemanticTimesControl);
    styleRelationshipsTab();
    labelVitalsHeart();
  }

  function installObserver() {
    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') replaceTextNode(record.target);
        for (const node of record.addedNodes || []) scanNode(node);
      }
      styleRelationshipsTab();
      labelVitalsHeart();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  function captureRuntimeDeps(injectedDeps) {
    if (!injectedDeps?.npcWalkers) return;
    runtimeDeps = injectedDeps;
    debugState.runtimeDepsCaptured = true;
  }

  function wrapInitForDeps(api, globalName) {
    if (!api?.init || api.__genericHudIconDepsWrapped) return api;
    const originalInit = api.init; // Used to preserve the namespace's existing initialization exactly.
    api.init = function genericHudIconInitCapture(injectedDeps, ...args) {
      captureRuntimeDeps(injectedDeps);
      return originalInit.call(this, injectedDeps, ...args);
    };
    api.__genericHudIconDepsWrapped = true;
    initCaptureNames.add(globalName);
    return api;
  }

  function hookRuntimeNamespace(globalName) {
    const current = window[globalName]; // Used when the target namespace already loaded before this compatibility module.
    if (current) {
      wrapInitForDeps(current, globalName);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, globalName); // Used to preserve any preexisting lazy getter/setter contract.
    if (descriptor && !descriptor.configurable) return;
    if (descriptor?.set || descriptor?.get) {
      Object.defineProperty(window, globalName, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get ? descriptor.get.call(window) : undefined; },
        set(value) {
          descriptor.set?.call(window, value);
          wrapInitForDeps(descriptor.get ? descriptor.get.call(window) : value, globalName);
        },
      });
      return;
    }
    let value = descriptor?.value; // Used as the backing value until the later-loaded script assigns its namespace.
    Object.defineProperty(window, globalName, {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return value; },
      set(next) {
        value = wrapInitForDeps(next, globalName);
      },
    });
  }

  function liveNpcWalkers() {
    const captured = runtimeDeps?.npcWalkers; // Used as the preferred authoritative walker collection from game initialization.
    if (Array.isArray(captured)) return captured;
    const debugWalkers = window.__hobunjiFurnitureDebug?.getNpcWalkers?.(); // Used only as a fallback when a namespace initialized before the capture hook.
    return Array.isArray(debugWalkers) ? debugWalkers : [];
  }

  function walkerForNpc(npcId) {
    const id = String(npcId || ''); // Used to compare relationship ids against live walker records.
    return id ? liveNpcWalkers().find(walker => String(walker?.rec?.id || '') === id) || null : null;
  }

  function loadHeartImage() {
    if (heartImagePromise) return heartImagePromise;
    heartImagePromise = new Promise(resolve => {
      const image = new Image(); // Used to paint icon_heart.png into each WorldPopupText canvas.
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = ICONS.heart;
    });
    return heartImagePromise;
  }

  function tintHeartCanvas(image, color, size) {
    const canvas = document.createElement('canvas'); // Used as a temporary recolor buffer that preserves icon alpha.
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d'); // Used to recolor every nontransparent heart pixel to the requested color.
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = 'source-over';
    return canvas;
  }

  function signedRelationshipAmount(amount) {
    const value = Math.round((Number(amount) || 0) * 10) / 10; // Used to retain the sign while keeping popup values compact.
    return Object.is(value, -0) ? 0 : value;
  }

  function relationshipHeartColor(kind) {
    return kind === 'favor' ? FAVOR_HEART_COLOR : RAPPORT_HEART_COLOR;
  }

  function relationshipNumberColor(amount) {
    return amount > 0 ? RELATIONSHIP_GAIN_COLOR : RELATIONSHIP_LOSS_COLOR;
  }

  function disposeRelationshipPopup(event) {
    event?.plane?.parent?.remove(event.plane);
    event?.geometry?.dispose?.();
    event?.material?.dispose?.();
    event?.texture?.dispose?.();
  }

  function clearRelationshipPopups() {
    while (relationshipPopups.length) disposeRelationshipPopup(relationshipPopups.pop());
  }

  function rootScene(root) {
    let node = root; // Used to walk from an NPC root to the active THREE.Scene that owns it.
    while (node && !node.isScene) node = node.parent;
    return node || null;
  }

  function popupHeadOffset(root, center) {
    const THREE = popupDeps?.THREE || window.THREE; // Used to compute the NPC's visible top once at popup spawn.
    if (!THREE?.Box3 || !root || !center) return 0.45;
    const bounds = new THREE.Box3().setFromObject(root); // Used to place relationship events above the live avatar instead of at body center.
    if (!Number.isFinite(bounds.max?.y)) return 0.45;
    return Math.max(0.2, bounds.max.y - center.y + 0.08);
  }

  async function spawnRelationshipPopup(root, kind, amount) {
    const api = window.WorldPopupText; // Used as the owner/anchor provider for specialized relationship popup types.
    const THREE = popupDeps?.THREE || window.THREE; // Used to build the same canvas-textured mesh style as WorldPopupText.
    const value = signedRelationshipAmount(amount); // Used as the actual signed delta displayed to the player.
    if (!api?.avatarCentroidWorld || !THREE || !root || !value) return null;
    const initialScene = rootScene(root); // Used to reject a root that is not currently in a rendered world scene.
    if (!initialScene) return null;
    const image = await loadHeartImage(); // Used to render the actual repository heart PNG rather than a Unicode glyph.
    const scene = rootScene(root); // Used again after image loading in case the NPC changed areas during the await.
    if (!root.parent || !scene) return null;

    const canvas = document.createElement('canvas'); // Used as the combined value-colored heart + direction-colored number texture.
    canvas.width = 360;
    canvas.height = 112;
    const context = canvas.getContext('2d'); // Used to draw the heart art and outlined signed number.
    const iconSize = 76; // Used to keep the heart visually comparable to the popup numeral height.
    const iconX = 16; // Used as the heart's left padding inside the popup texture.
    const iconY = (canvas.height - iconSize) * 0.5; // Used to vertically center the heart beside the number.
    const heartColor = relationshipHeartColor(kind); // Used so yellow means Rapport while pink means Favor.
    const numberColor = relationshipNumberColor(value); // Used so green means increase while red means decrease.
    if (image) {
      const tinted = tintHeartCanvas(image, heartColor, iconSize); // Used to identify which relationship value changed independently from direction.
      context.drawImage(tinted, iconX, iconY, iconSize, iconSize);
    }
    const label = `${value > 0 ? '+' : '-'}${Math.abs(value)}`; // Used as the exact signed relationship change shown above NPC heads.
    context.font = "900 68px 'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace";
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 9;
    context.strokeStyle = 'rgba(15,10,8,.92)';
    context.strokeText(label, 108, canvas.height / 2);
    context.fillStyle = numberColor;
    context.fillText(label, 108, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas); // Used by the shell-outline-safe world-space popup material.
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const aspect = canvas.width / canvas.height; // Used to keep the PNG and number from stretching horizontally.
    const geometry = new THREE.PlaneGeometry(aspect, 1); // Used as the camera-facing relationship billboard.
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide }); // Used to match WorldPopupText's visibility/render characteristics.
    const plane = new THREE.Mesh(geometry, material); // Used as the actual world-space relationship visual.
    const worldHeight = Math.max(0.18, Number(api.defaults?.floatPlus?.worldHeight) || 0.36); // Used to reuse the configured Float+ physical scale.
    plane.scale.setScalar(worldHeight);
    plane.renderOrder = RELATIONSHIP_RENDER_ORDER;
    plane.frustumCulled = false;
    plane.userData.isBillboard = true;
    const center = api.avatarCentroidWorld(root); // Used to calculate a stable above-head offset at spawn.
    const event = { // Used by updateRelationshipPopups to animate, fade, and clean up this one change.
      kind,
      root,
      plane,
      geometry,
      material,
      texture,
      startedAt: performance.now(),
      lifetimeMs: Math.max(250, Number(api.defaults?.floatPlus?.lifetimeMs) || 1150),
      headOffsetY: popupHeadOffset(root, center),
      worldHeight,
      value,
      heartColor,
      numberColor,
    };
    scene.add(plane);
    relationshipPopups.push(event);
    const payload = { kind, value, heartColor, numberColor, npcId: root.userData?.npcId || null, at: Date.now() };
    debugState.lastRelationshipPopup = payload;
    if (kind === 'favor') debugState.lastFavorPopup = payload;
    else debugState.lastRapportPopup = payload;
    return event;
  }

  function updateRelationshipPopups(now) {
    const api = window.WorldPopupText; // Used to share the popup system's live avatar centroid calculation.
    const camera = popupDeps?.camera || runtimeDeps?.camera; // Used to billboard relationship meshes exactly like the core popup system.
    if (!api?.avatarCentroidWorld || !camera) return;
    for (let index = relationshipPopups.length - 1; index >= 0; index--) {
      const event = relationshipPopups[index]; // Used as the active relationship popup being advanced this frame.
      const progress = Math.max(0, Math.min(1, (now - event.startedAt) / event.lifetimeMs)); // Used for Float+-style rise/fade timing.
      const center = api.avatarCentroidWorld(event.root); // Used to follow an NPC who keeps moving after the relationship change.
      if (!center || !event.root?.parent || progress >= 1) {
        disposeRelationshipPopup(event);
        relationshipPopups.splice(index, 1);
        continue;
      }
      center.y += event.headOffsetY + 0.14 * (1 - Math.pow(1 - progress, 2));
      event.plane.position.copy(center);
      event.plane.quaternion.copy(camera.quaternion);
      event.material.opacity = progress < 0.72 ? 1 : (1 - progress) / 0.28;
      const pop = 1.08 - 0.08 * Math.min(1, progress / 0.24); // Used to give the change the same quick settle as Float+ damage text.
      event.plane.scale.setScalar(event.worldHeight * pop);
    }
  }

  function hookWorldPopupText() {
    const current = window.WorldPopupText; // Used when the popup namespace already exists at this module's load point.
    if (current) {
      extendWorldPopupText(current);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'WorldPopupText'); // Used to preserve any preexisting lazy popup namespace contract.
    if (descriptor && !descriptor.configurable) return;
    if (descriptor?.set || descriptor?.get) {
      Object.defineProperty(window, 'WorldPopupText', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return descriptor.get ? descriptor.get.call(window) : undefined; },
        set(value) {
          descriptor.set?.call(window, value);
          extendWorldPopupText(descriptor.get ? descriptor.get.call(window) : value);
        },
      });
      return;
    }
    let value = descriptor?.value; // Used as the backing popup namespace until world-popup-text.js assigns its API.
    Object.defineProperty(window, 'WorldPopupText', {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return value; },
      set(next) {
        value = next;
        extendWorldPopupText(next);
      },
    });
  }

  function extendWorldPopupText(api = window.WorldPopupText) {
    if (!api || api.__genericHudRelationshipExtended) return false;
    const originalInit = typeof api.init === 'function' ? api.init.bind(api) : null; // Used to capture the core popup's THREE/camera dependencies without changing game.js.
    const originalUpdate = typeof api.update === 'function' ? api.update.bind(api) : null; // Used to keep all existing popup updates ahead of relationship updates.
    const originalClear = typeof api.clear === 'function' ? api.clear.bind(api) : null; // Used to dispose relationship meshes whenever the core popup system clears.
    const originalDebugSnapshot = typeof api.debugSnapshot === 'function' ? api.debugSnapshot.bind(api) : null; // Used to append relationship diagnostics to the existing debug surface.
    if (originalInit) {
      api.init = function genericHudPopupInit(injectedDeps, ...args) {
        popupDeps = injectedDeps;
        debugState.popupDepsCaptured = !!injectedDeps;
        return originalInit(injectedDeps, ...args);
      };
    }
    if (originalUpdate) {
      api.update = function genericHudPopupUpdate(now, ...args) {
        const result = originalUpdate(now, ...args); // Used as the untouched core WorldPopupText frame result.
        updateRelationshipPopups(now);
        return result;
      };
    }
    if (originalClear) {
      api.clear = function genericHudPopupClear(...args) {
        clearRelationshipPopups();
        return originalClear(...args);
      };
    }
    api.showRelationshipChange = (root, kind, amount) => spawnRelationshipPopup(root, kind, amount);
    api.showRapportGain = (root, amount) => spawnRelationshipPopup(root, 'rapport', amount); // Compatibility alias retained for callers from the previous popup revision.
    api.showRapportChange = (root, amount) => spawnRelationshipPopup(root, 'rapport', amount);
    api.showFavorChange = (root, amount) => spawnRelationshipPopup(root, 'favor', amount);
    api.debugSnapshot = function genericHudPopupDebugSnapshot() {
      const base = originalDebugSnapshot ? originalDebugSnapshot() : {}; // Used to preserve the core popup debug payload.
      return { ...base, relationshipPopups: relationshipPopups.map(event => ({ kind: event.kind, value: event.value, ageMs: Math.max(0, performance.now() - event.startedAt) })) };
    };
    api.__genericHudRelationshipExtended = true;
    api.__genericHudRapportExtended = true; // Compatibility marker retained for older diagnostics.
    return true;
  }

  function showRelationshipChange(npcId, kind, amount) {
    const value = signedRelationshipAmount(amount); // Used to reject only zero changes while retaining losses.
    if (!value) return false;
    const id = String(npcId || '');
    const walker = walkerForNpc(id); // Used to anchor the change to the NPC whose relationship value actually changed.
    if (!walker?.root) {
      const payload = { npcId: id, kind, value, reason: 'walker-not-found', at: Date.now() };
      debugState.lastRelationshipPopupSkipped = payload;
      if (kind === 'favor') debugState.lastFavorPopupSkipped = payload;
      else debugState.lastRapportPopupSkipped = payload;
      return false;
    }
    const api = window.WorldPopupText; // Used to route both relationship values through the existing world popup owner.
    if (!api?.showRelationshipChange) extendWorldPopupText(api);
    if (!api?.showRelationshipChange) {
      const payload = { npcId: id, kind, value, reason: 'popup-api-unavailable', at: Date.now() };
      debugState.lastRelationshipPopupSkipped = payload;
      if (kind === 'favor') debugState.lastFavorPopupSkipped = payload;
      else debugState.lastRapportPopupSkipped = payload;
      return false;
    }
    api.showRelationshipChange(walker.root, kind, value);
    const payload = { npcId: id, kind, value, at: Date.now() };
    debugState.lastRelationshipPopup = payload;
    if (kind === 'favor') debugState.lastFavorPopup = payload;
    else debugState.lastRapportPopup = payload;
    return true;
  }

  function showRapportChange(npcId, amount) {
    return showRelationshipChange(npcId, 'rapport', amount);
  }

  function showFavorChange(npcId, amount) {
    return showRelationshipChange(npcId, 'favor', amount);
  }

  function decorateRelationshipState(npcId, state) {
    const memory = state?.memory; // Used as the central event stream written by every successful NpcRapport.adjust call.
    if (!Array.isArray(memory) || decoratedMemoryArrays.has(memory)) return state;
    const originalPush = memory.push; // Used to preserve normal relationship-memory storage before emitting visuals.
    Object.defineProperty(memory, 'push', {
      configurable: true,
      writable: true,
      value: function genericHudRapportMemoryPush(...entries) {
        const result = originalPush.apply(this, entries); // Used as the original Array push result expected by callers.
        for (const entry of entries) {
          if (entry?.type !== 'rapport') continue;
          const amount = Number(entry.amount); // Used to show both positive and negative actually-applied Rapport deltas after clamping.
          if (Number.isFinite(amount) && amount !== 0) showRapportChange(npcId, amount);
        }
        return result;
      },
    });
    decoratedMemoryArrays.add(memory);
    return state;
  }

  function installRapportObserver() {
    const dialogue = window.DialogueContent; // Used as the relationship-state entry point NpcRapport itself already calls.
    if (!dialogue?.getNpcDlgState || dialogue.__genericHudRapportObserver) return false;
    const originalGetState = dialogue.getNpcDlgState.bind(dialogue); // Used to preserve midnight settlement and all existing relationship behavior.
    dialogue.getNpcDlgState = function genericHudGetNpcDlgState(npcId, ...args) {
      return decorateRelationshipState(String(npcId || ''), originalGetState(npcId, ...args));
    };
    dialogue.__genericHudRapportObserver = true;
    return true;
  }

  function installFavorObserver() {
    const dialogue = window.DialogueContent; // Used as the authoritative permanent-Favor mutation surface, including gifts.
    if (!dialogue?.adjustNpcFavor || dialogue.__genericHudFavorObserver) return false;
    const originalAdjust = dialogue.adjustNpcFavor.bind(dialogue); // Used to preserve Favor clamping, memory, spillover, and existing reward text exactly.
    dialogue.adjustNpcFavor = function genericHudFavorAdjust(npcId, amount, reason, ...args) {
      const id = String(npcId || '');
      const beforeState = id ? dialogue.getNpcDlgState?.(id) : null; // Used to measure the actual applied delta instead of the requested delta.
      const before = Number(beforeState?.favor);
      const result = originalAdjust(npcId, amount, reason, ...args);
      const afterState = id ? dialogue.getNpcDlgState?.(id) : null;
      const after = Number(afterState?.favor);
      const applied = Number.isFinite(before) && Number.isFinite(after) ? after - before : Number(amount) || 0;
      if (applied) showFavorChange(id, applied);
      return result;
    };
    dialogue.__genericHudFavorObserver = true;
    return true;
  }

  function debugSnapshot() {
    return {
      version: 1,
      icons: { ...ICONS },
      relationshipColors: {
        rapportHeart: RAPPORT_HEART_COLOR,
        favorHeart: FAVOR_HEART_COLOR,
        gainNumber: RELATIONSHIP_GAIN_COLOR,
        lossNumber: RELATIONSHIP_LOSS_COLOR,
      },
      replacementCount: debugState.replacementCount,
      lastReplacement: debugState.lastReplacement,
      runtimeDepsCaptured: debugState.runtimeDepsCaptured,
      popupDepsCaptured: debugState.popupDepsCaptured,
      initCaptureNames: [...initCaptureNames],
      activeRelationshipPopups: relationshipPopups.length,
      activeRapportPopups: relationshipPopups.filter(event => event.kind === 'rapport').length,
      activeFavorPopups: relationshipPopups.filter(event => event.kind === 'favor').length,
      lastRelationshipPopup: debugState.lastRelationshipPopup,
      lastRelationshipPopupSkipped: debugState.lastRelationshipPopupSkipped,
      lastRapportPopup: debugState.lastRapportPopup,
      lastRapportPopupSkipped: debugState.lastRapportPopupSkipped,
      lastFavorPopup: debugState.lastFavorPopup,
      lastFavorPopupSkipped: debugState.lastFavorPopupSkipped,
      observed: !!observer,
      relationshipsTabStyled: document.querySelector(RELATIONSHIPS_TAB_SELECTOR)?.dataset?.genericRelationshipsHeart === '1',
    };
  }

  injectStyles();
  installObserver();
  hookRuntimeNamespace('NpcScheduling');
  hookRuntimeNamespace('RelationshipsPanel');
  hookRuntimeNamespace('NpcWardrobe');
  hookWorldPopupText();
  installRapportObserver();
  installFavorObserver();
  loadHeartImage();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanNode(document.body);
      installRapportObserver();
      installFavorObserver();
      styleRelationshipsTab();
      labelVitalsHeart();
    }, { once: true });
  } else {
    scanNode(document.body);
  }

  window.HobunjiGenericHudIcons = Object.freeze({
    version: 1,
    icons: ICONS,
    scan: () => scanNode(document.body),
    showRelationshipChange,
    showRapportGain: showRapportChange,
    showRapportChange,
    showFavorChange,
    debugSnapshot,
  });
  window.__genericHudIconsDebug = debugSnapshot;
})();
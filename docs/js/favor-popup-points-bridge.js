(() => {
  'use strict';

  if (Number(window.FavorPopupPointsBridge?.version) >= 2) return;

  const debugState = { hardenedPopups: 0, lastHardenedPopup: null }; // Used by snapshot() to make relationship-popup render repairs visible in mobile diagnostics.

  function convertFavorHeartDelta(kind, amount) {
    if (kind !== 'favor') return amount;
    const points = window.NpcFavorBalance?.heartsToFavorPoints?.(amount);
    return Number.isFinite(Number(points)) ? points : amount;
  }

  function hardenRelationshipPopupEvent(event, kind) {
    const plane = event?.plane; // Used to keep relationship canvases out of the inverted-shell outline pass.
    if (!plane) return event;

    plane.userData ||= {};
    plane.userData.noOutline = true;
    plane.userData.hobunjiWorldTextOverlay = true;
    plane.layers?.disable?.(1);
    plane.castShadow = false;
    plane.receiveShadow = false;

    const material = event?.material || plane.material; // Used to preserve transparent world-text rendering even if another runtime mutates the material defaults.
    if (material) {
      material.transparent = true;
      material.depthTest = false;
      material.depthWrite = false;
      material.fog = false;
      material.needsUpdate = true;
    }

    const texture = event?.texture || material?.map; // Used to force the just-painted canvas upload before the popup reaches the final overlay pass.
    if (texture) texture.needsUpdate = true;

    debugState.hardenedPopups += 1;
    debugState.lastHardenedPopup = {
      kind: String(kind || event?.kind || 'relationship'),
      value: Number(event?.value) || 0,
      renderOrder: Number(plane.renderOrder) || 0,
      layerMask: Number(plane.layers?.mask) || 0,
      at: Date.now(),
    };
    return event;
  }

  function hardenRelationshipPopupResult(result, kind) {
    if (result && typeof result.then === 'function') {
      return result.then(event => hardenRelationshipPopupEvent(event, kind));
    }
    return hardenRelationshipPopupEvent(result, kind);
  }

  function wrapRelationshipMethod(api, methodName, transformAmount) {
    if (typeof api?.[methodName] !== 'function') return false;
    const original = api[methodName].bind(api); // Used to preserve the relationship popup implementation already installed by generic-hud-icons.js.
    api[methodName] = function hardenedRelationshipPopup(root, ...args) {
      const nextArgs = typeof transformAmount === 'function' ? transformAmount(args) : args;
      const kind = methodName.includes('Favor') ? 'favor' : methodName.includes('Rapport') ? 'rapport' : nextArgs[0]; // Used only for debug labeling after the existing renderer returns its event.
      return hardenRelationshipPopupResult(original(root, ...nextArgs), kind);
    };
    return true;
  }

  function install() {
    const api = window.WorldPopupText;
    if (!api || Number(api.__favorPopupPointsBridgeVersion) >= 2) return false;

    const previousVersion = Number(api.__favorPopupPointsBridgeVersion || (api.__favorPopupPointsBridge ? 1 : 0)); // Used to avoid converting Favor twice when v2 hot-loads over the old v1 wrapper.
    const needsFavorConversion = previousVersion < 1;

    wrapRelationshipMethod(api, 'showRelationshipChange', args => {
      if (!needsFavorConversion) return args;
      const [kind, amount, ...rest] = args;
      return [kind, convertFavorHeartDelta(kind, amount), ...rest];
    });
    wrapRelationshipMethod(api, 'showFavorChange', args => {
      if (!needsFavorConversion) return args;
      const [amount, ...rest] = args;
      return [convertFavorHeartDelta('favor', amount), ...rest];
    });
    wrapRelationshipMethod(api, 'showRapportChange');
    wrapRelationshipMethod(api, 'showRapportGain');

    api.__favorPopupPointsBridge = true;
    api.__favorPopupPointsBridgeVersion = 2;
    return true;
  }

  if (!install() && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (!install()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.FavorPopupPointsBridge = Object.freeze({
    version: 2,
    install,
    snapshot() {
      return {
        version: 2,
        hardenedPopups: debugState.hardenedPopups,
        lastHardenedPopup: debugState.lastHardenedPopup,
        popupBridgeVersion: Number(window.WorldPopupText?.__favorPopupPointsBridgeVersion) || 0,
      };
    },
  });
})();

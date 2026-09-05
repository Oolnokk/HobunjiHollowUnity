// Bootstrap the sanitized latest-authored rig snapshot, allowlisted Mao-ao
// shoulder authoring, shared whole-rig scale, runtime head-scale bridge, Pixel
// Probe character-rig verification, and Full Character Scale workspace.
(() => {
  'use strict';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const base = selfUrl ? new URL('./', selfUrl) : new URL('./js/', location.href);
  const urls = [
    new URL('../config/character-rig-scale-defaults.js?v=20260905c', base).href,
    new URL('attachment-rig-latest-authored-snapshot-core.js?v=20260904a', base).href,
    new URL('character-rig-maoao-authored-20260905.js?v=20260905a', base).href,
    new URL('character-rig-scale.js?v=20260904i', base).href,
    new URL('character-rig-scale-avatar-runtime.js?v=20260905a', base).href,
    new URL('character-rig-pixel-probe-runtime.js?v=20260905a', base).href,
    new URL('character-scale-comparison-host-bridge.js?v=20260904j', base).href,
    new URL('character-scale-comparison.js?v=20260904k', base).href,
    new URL('character-scale-comparison-body-input-guard.js?v=20260905a', base).href,
    new URL('character-scale-comparison-presentation.js?v=20260905b', base).href,
  ];
  const loadSequentially = list => list.reduce((promise, src) => promise.then(() => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  })), Promise.resolve());
  if (document.readyState === 'loading' && document.currentScript) {
    for (const src of urls) document.write(`<script src="${src}"><\/script>`);
  } else {
    loadSequentially(urls).catch(error => console.warn('[attachment-rig-bootstrap]', error));
  }
})();

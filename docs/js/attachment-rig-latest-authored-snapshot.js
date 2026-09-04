// Bootstrap the sanitized latest-authored rig snapshot and the shared whole-rig
// parent-scale feature from the same already-loaded attachment-rig hook.
(() => {
  'use strict';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const base = selfUrl ? new URL('./', selfUrl) : new URL('./js/', location.href);
  const urls = [
    new URL('attachment-rig-latest-authored-snapshot-core.js?v=20260904a', base).href,
    new URL('character-rig-scale.js?v=20260904a', base).href,
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

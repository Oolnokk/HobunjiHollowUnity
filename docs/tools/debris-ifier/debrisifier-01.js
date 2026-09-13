// Boots the exact readable Debris-ifier V50 source and then exposes its dev API.
// Direct tool usage executes the source byte-for-byte. The hidden in-game ruin
// generator keeps the same source file and generator logic, but patches only its
// repository transport at load time so generation is same-origin and offline-safe.
(() => {
  'use strict';

  const SOURCE_SHA256 = '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40';
  const EMBEDDED_TREE = 'debrisifier-v50-embedded-tree.json';
  const EMBEDDED_FURNITURE_COUNT = 11;
  const params = new URLSearchParams(location.search);
  const embeddedRuntime = params.get('devRuntime') === '1' || params.get('embedded') === 'devRandomRuin';
  const debug = document.getElementById('debug');

  const fail = message => {
    if (debug) debug.textContent = `Debris-ifier bootstrap: FAILED — ${message}`;
    console.error('[Debris-ifier bootstrap]', message);
  };

  function loadApi() {
    const api = document.createElement('script');
    api.src = 'debrisifier-v50-api.js';
    api.onerror = () => fail('V50 dev API did not load.');
    document.head.appendChild(api);
  }

  function injectSource(sourceText) {
    const script = document.createElement('script');
    script.textContent = `${sourceText}\n//# sourceURL=debrisifier-v50-source.embedded.js`;
    document.head.appendChild(script);
    loadApi();
  }

  function patchEmbeddedTransport(sourceText) {
    const treeNeedle = "const REPO_TREE_URL='https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/git/trees/main?recursive=1';";
    const treeReplacement = `const REPO_TREE_URL='${EMBEDDED_TREE}';`;
    const rawNeedle = "function rawTextureUrl(path){return REPO_RAW_ROOT+String(path||'').replace(/^\\/+/, '');}";
    const rawReplacement = "function rawTextureUrl(path){const clean=String(path||'').replace(/^\\/+/, '');const fromDocsRoot=clean.startsWith('docs/')?clean.slice(5):clean;return new URL('../../'+fromDocsRoot,location.href).href;}";

    if (!sourceText.includes(treeNeedle)) throw new Error('V50 repository-tree binding changed; refusing an unverified embedded patch.');
    if (!sourceText.includes(rawNeedle)) throw new Error('V50 raw-asset URL helper changed; refusing an unverified embedded patch.');

    const patched = sourceText.replace(treeNeedle, treeReplacement).replace(rawNeedle, rawReplacement);
    window.__debrisifierEmbeddedTransport = Object.freeze({
      active: true,
      sameOrigin: true,
      sourceSha256: SOURCE_SHA256,
      tree: EMBEDDED_TREE,
      expectedFurniturePaths: EMBEDDED_FURNITURE_COUNT,
    });
    return patched;
  }

  if (embeddedRuntime) {
    fetch('debrisifier-v50-source.js', { cache:'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`readable V50 source HTTP ${response.status}`);
        return response.text();
      })
      .then(sourceText => injectSource(patchEmbeddedTransport(sourceText)))
      .catch(error => fail(error?.message || String(error)));
    return;
  }

  const source = document.createElement('script');
  source.src = 'debrisifier-v50-source.js';
  source.onerror = () => fail('readable V50 source did not load.');
  source.onload = loadApi;
  document.head.appendChild(source);
})();

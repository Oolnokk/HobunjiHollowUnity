// Boots the exact readable Debris-ifier V50 source and then exposes its dev API.
// Direct tool usage executes the source byte-for-byte. The hidden in-game ruin
// generator keeps the same source file and generator logic, but patches only its
// repository transport at load time so generation is independent of live repo I/O.
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
    const brickNeedle = 'new THREE.GLTFLoader().load(REPO_RAW_ROOT+WALL_BRICK_GLB_PATH,gltf=>';
    const brickReplacement = 'new THREE.GLTFLoader().load(rawTextureUrl(WALL_BRICK_GLB_PATH),gltf=>';
    const decalNeedle = 'const texture=loader.load(REPO_RAW_ROOT+path,loaded=>';
    const decalReplacement = 'const texture=loader.load(rawTextureUrl(path),loaded=>';

    for (const [label, needle] of [
      ['repository-tree binding', treeNeedle],
      ['raw-asset URL helper', rawNeedle],
      ['Roughbrick loader', brickNeedle],
      ['mechanism decal loader', decalNeedle],
    ]) {
      if (!sourceText.includes(needle)) throw new Error(`V50 ${label} changed; refusing an unverified embedded patch.`);
    }

    const patched = sourceText
      .replace(treeNeedle, treeReplacement)
      .replace(rawNeedle, rawReplacement)
      .replace(brickNeedle, brickReplacement)
      .replace(decalNeedle, decalReplacement);
    window.__debrisifierEmbeddedTransport = Object.freeze({
      active: true,
      sameOrigin: true,
      sourceSha256: SOURCE_SHA256,
      tree: EMBEDDED_TREE,
      expectedFurniturePaths: EMBEDDED_FURNITURE_COUNT,
      patchedBindings: 4,
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

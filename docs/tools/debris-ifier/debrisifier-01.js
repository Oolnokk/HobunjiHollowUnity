// Boots the exact readable Debris-ifier V50 source and then exposes its dev API.
// Direct tool usage executes the source byte-for-byte. The hidden in-game ruin
// generator keeps the same source file and generator logic, but applies a small
// verified runtime patch set: local repo transport plus player-safe corridor sizing.
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

  function patchEmbeddedRuntime(sourceText) {
    const treeNeedle = "const REPO_TREE_URL='https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/git/trees/main?recursive=1';";
    const treeReplacement = `const REPO_TREE_URL='${EMBEDDED_TREE}';`;
    const rawNeedle = "function rawTextureUrl(path){return REPO_RAW_ROOT+String(path||'').replace(/^\\/+/, '');}";
    const rawReplacement = "function rawTextureUrl(path){const clean=String(path||'').replace(/^\\/+/, '');const fromDocsRoot=clean.startsWith('docs/')?clean.slice(5):clean;return new URL('../../'+fromDocsRoot,location.href).href;}";
    const brickNeedle = 'new THREE.GLTFLoader().load(REPO_RAW_ROOT+WALL_BRICK_GLB_PATH,gltf=>';
    const brickReplacement = 'new THREE.GLTFLoader().load(rawTextureUrl(WALL_BRICK_GLB_PATH),gltf=>';
    const decalNeedle = 'const texture=loader.load(REPO_RAW_ROOT+path,loaded=>';
    const decalReplacement = 'const texture=loader.load(rawTextureUrl(path),loaded=>';

    // The original preview's 3–4 half-cell hallways were authored for orbit-view
    // inspection, not the game's collision radius. Runtime-only V50 generation
    // uses 5–6 cells, which become 5–6 world units after the game's 2× X/Z scale.
    const hallNeedle = 'const width=randomIntInclusive(rng,3,4),length=randomIntInclusive(rng,5,8);';
    const hallReplacement = 'const width=randomIntInclusive(rng,5,6),length=randomIntInclusive(rng,5,8);';
    const escapeHallNeedle = 'hallWidth=randomIntInclusive(rng,3,4),hallLen=10+rooms.length*3;';
    const escapeHallReplacement = 'hallWidth=randomIntInclusive(rng,5,6),hallLen=10+rooms.length*3;';
    const focusDoorNeedle = 'footprintWidth:cs*3,footprintDepth:cs,doorwayId:`${chosen.door.from}->${chosen.door.to}`,side:chosen.side';
    const focusDoorReplacement = 'footprintWidth:cs*Math.max(3,Number(chosen.door.widthCells)||3),footprintDepth:cs,doorwayId:`${chosen.door.from}->${chosen.door.to}`,side:chosen.side';
    const hallDoorNeedle = 'footprintWidth:network.cellSize*3,footprintDepth:network.cellSize,doorwayId:`${door.from}->${door.to}`';
    const hallDoorReplacement = 'footprintWidth:network.cellSize*Math.max(3,Number(door.widthCells)||3),footprintDepth:network.cellSize,doorwayId:`${door.from}->${door.to}`';

    const patches = [
      ['repository-tree binding', treeNeedle, treeReplacement],
      ['raw-asset URL helper', rawNeedle, rawReplacement],
      ['Roughbrick loader', brickNeedle, brickReplacement],
      ['mechanism decal loader', decalNeedle, decalReplacement],
      ['hallway width', hallNeedle, hallReplacement],
      ['escape hallway width', escapeHallNeedle, escapeHallReplacement],
      ['focus doorway width', focusDoorNeedle, focusDoorReplacement],
      ['hallway doorway width', hallDoorNeedle, hallDoorReplacement],
    ];

    let patched = sourceText;
    for (const [label, needle, replacement] of patches) {
      if (!patched.includes(needle)) throw new Error(`V50 ${label} changed; refusing an unverified embedded patch.`);
      patched = patched.replace(needle, replacement);
    }

    window.__debrisifierEmbeddedTransport = Object.freeze({
      active: true,
      sameOrigin: true,
      sourceSha256: SOURCE_SHA256,
      tree: EMBEDDED_TREE,
      expectedFurniturePaths: EMBEDDED_FURNITURE_COUNT,
      patchedBindings: patches.length,
      runtimeHallwayWidthCells: [5, 6],
      runtimeDoorwayUsesAuthoredWidth: true,
    });
    return patched;
  }

  if (embeddedRuntime) {
    fetch('debrisifier-v50-source.js', { cache:'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`readable V50 source HTTP ${response.status}`);
        return response.text();
      })
      .then(sourceText => injectSource(patchEmbeddedRuntime(sourceText)))
      .catch(error => fail(error?.message || String(error)));
    return;
  }

  const source = document.createElement('script');
  source.src = 'debrisifier-v50-source.js';
  source.onerror = () => fail('readable V50 source did not load.');
  source.onload = loadApi;
  document.head.appendChild(source);
})();

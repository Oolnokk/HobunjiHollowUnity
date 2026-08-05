(() => {
  'use strict';

  const repository = 'Oolnokk/HobunjiHollowUnity';
  const refs = ['agent/npc-station-areas-attention', 'main'];
  const parts = ['runtime-clean.001', 'runtime-clean.002', 'runtime-clean.003'];

  async function fetchPart(part) {
    let lastError = null;
    for (const ref of refs) {
      const url = `https://raw.githubusercontent.com/${repository}/${ref}/.github/npc-station-payload/${part}`;
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) return response.text();
        lastError = new Error(`${response.status} ${response.statusText}: ${url}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Unable to load ${part}.`);
  }

  function removeTransportDuplicate(source) {
    const marker = 'function updateMovementHeading';
    const first = source.indexOf(marker);
    const second = first < 0 ? -1 : source.indexOf(marker, first + marker.length);
    if (second < 0) return source;
    const nextFunction = source.indexOf('function updateDebugRow', second);
    if (nextFunction < 0) throw new Error('Could not remove duplicated runtime transport declarations.');
    return source.slice(0, second) + source.slice(nextFunction);
  }

  async function install() {
    const encoded = (await Promise.all(parts.map(fetchPart))).join('').replace(/\s+/g, '');
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const source = removeTransportDuplicate(new TextDecoder().decode(bytes));
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = blobUrl;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Decoded NPC station runtime script failed to load.'));
        document.head.appendChild(script);
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  install().catch(error => {
    const message = `[npc-station-runtime] ${error?.message || error}`;
    console.error(message, error);
    window.__farmLog?.(message, 'error');
  });
})();

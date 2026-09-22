(() => {
  'use strict';

  const PART_COUNT = 7; // Used to reconstruct the exact uploaded Debris-ifier V50 runtime from repository-safe payload chunks.
  const EXPECTED_SOURCE_SHA256 = '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40'; // Used to reject a truncated or mismatched V50 payload before executing it.
  const debug = document.getElementById('debug'); // Used to surface bootstrap failures directly in the tool on mobile where a console may be unavailable.

  function bootstrapStatus(message) {
    if (debug) debug.textContent = `Debris-ifier bootstrap: ${message}`;
  }

  function bytesToHex(bytes) {
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function decodeBase64(text) {
    const binary = atob(text.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function gunzip(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser does not support DecompressionStream(gzip). Use a current Chrome/Edge/Firefox build.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function loadRuntime() {
    bootstrapStatus('loading V50 runtime…');
    const partUrls = Array.from({ length: PART_COUNT }, (_, index) =>
      `runtime/debrisifier-v50.part${String(index + 1).padStart(2, '0')}.b64`
    );
    const responses = await Promise.all(partUrls.map(url => fetch(url, { cache: 'no-cache' })));
    const failed = responses.findIndex(response => !response.ok);
    if (failed >= 0) throw new Error(`runtime payload part ${failed + 1} failed to load (HTTP ${responses[failed].status})`);
    const payloadText = (await Promise.all(responses.map(response => response.text()))).join('');
    const sourceBytes = await gunzip(decodeBase64(payloadText));
    const digest = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', sourceBytes)));
    if (digest !== EXPECTED_SOURCE_SHA256) {
      throw new Error(`runtime integrity mismatch: expected ${EXPECTED_SOURCE_SHA256}, got ${digest}`);
    }
    bootstrapStatus('runtime verified; starting…');
    const source = new TextDecoder().decode(sourceBytes);
    (0, eval)(source); // Executes the verified V50 script with normal global-script semantics after its dependencies are present.
  }

  loadRuntime().catch(error => {
    bootstrapStatus(`FAILED — ${error.message}`);
    console.error('[Debris-ifier bootstrap]', error);
  });
})();

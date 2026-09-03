// Source-level Animation Author grounding A/B test.
//
// Installed only beneath the commit-pinned RawGitHack /docs/tools/ scope. It
// rewrites the real Animation Author navigation before any editor JavaScript
// executes, while preserving the genuine /docs/tools/animation-author/index.html
// document URL and therefore all location/ref/path bootstrap behavior.
const MARKER = 'groundingSourceTest';
const TEST_VERSION = '2026-09-03-sw-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function replaceExactlyOnce(html, from, to) {
  const first = html.indexOf(from);
  if (first < 0) throw new Error(`Missing source expression: ${from.slice(0, 100)}`);
  if (html.indexOf(from, first + from.length) >= 0) throw new Error(`Source expression is not unique: ${from.slice(0, 100)}`);
  return html.slice(0, first) + to + html.slice(first + from.length);
}

function rewriteAnimationAuthor(html) {
  const replacements = [
    ['const groundLiftY = modelHeight / 2;', 'const groundLiftY = 0; // GROUNDING-SW-TEST: PNGPlaneAvatar root is already floor-relative.'],
    ['canvasBottomY: (placementRatio - .5) * modelHeight,', 'canvasBottomY: (placementRatio - 1) * modelHeight, // GROUNDING-SW-TEST'],
    ['canvasTopY: (placementRatio + .5) * modelHeight,', 'canvasTopY: placementRatio * modelHeight, // GROUNDING-SW-TEST'],
    ['canvasCenterY: placementRatio * modelHeight,', 'canvasCenterY: (placementRatio - .5) * modelHeight, // GROUNDING-SW-TEST'],
    ["y: metrics.modelHeight * (.5 + metrics.placementRatio - (finiteNumber(pixelY) + .5) / metrics.pixelHeight),", "y: metrics.modelHeight * (metrics.placementRatio - (finiteNumber(pixelY) + .5) / metrics.pixelHeight), // GROUNDING-SW-TEST"],
    ['// game.js places the model root at floor Y, then raises the complete portrait model by avatarHeight / 2.', '// GROUNDING-SW-TEST: gameplay leaves PNGPlaneAvatar at floor Y; no redundant half-height lift.'],
  ];
  for (const [from, to] of replacements) html = replaceExactlyOnce(html, from, to);
  const marker = "log('V15.45 patch installed: creature Rig Coordinates now author normalized dialogue chathead frames with touch preview; animal ambient speech and animal-looking NPC dialogue share the same crop runtime.');";
  return replaceExactlyOnce(html, marker, `${marker}\nlog('GROUNDING SOURCE TEST ACTIVE · real-page source rewrite ${TEST_VERSION}', 'warn');\ndocument.documentElement.dataset.groundingSourceTest = '${TEST_VERSION}';`);
}

function failureDocument(error) {
  const message = String(error?.stack || error?.message || error).replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grounding source test failed</title><body style="margin:0;padding:18px;background:#120b0b;color:#ffd9d9;font:14px system-ui"><h2>GROUNDING SOURCE TEST FAILED</h2><p>The normal editor was not modified.</p><pre style="white-space:pre-wrap">${message}</pre></body>`;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isMarkedEditor = event.request.mode === 'navigate'
    && /\/docs\/tools\/animation-author\/(?:index\.html)?$/.test(url.pathname)
    && url.searchParams.get(MARKER) === '1';
  if (!isMarkedEditor) return;

  event.respondWith((async () => {
    try {
      const cleanUrl = new URL(url);
      cleanUrl.searchParams.delete(MARKER);
      cleanUrl.searchParams.set('_groundingSourceNetwork', TEST_VERSION);
      const response = await fetch(cleanUrl.href, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Could not fetch original editor source: HTTP ${response.status}`);
      const rewritten = rewriteAnimationAuthor(await response.text());
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('cache-control', 'no-store');
      headers.set('x-hobunji-grounding-source-test', TEST_VERSION);
      return new Response(rewritten, { status: 200, headers });
    } catch (error) {
      return new Response(failureDocument(error), { status: 500, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
  })());
});

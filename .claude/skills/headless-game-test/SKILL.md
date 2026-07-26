---
name: headless-game-test
description: How to launch and drive HobunjiHollowUnity (docs/index.html, a Three.js browser game) headlessly in a Claude Code sandbox for real visual/behavioral testing — not just code review. Use this whenever asked to run, test, screenshot, or verify a change to the game actually works, or when a change touches rendering, animation, combat AI, or anything else that's hard to verify by reading the diff alone. The game's own CDN script tag for three.js is commonly blocked by this sandbox's outbound proxy, which makes a naive headless launch fail with "THREE is not defined" — this skill documents the working vendor-locally-instead workaround plus the selectors and scene-graph inspection technique needed to actually drive the game and verify results.
---

# Headless-testing HobunjiHollowUnity

This game (`docs/index.html` + `docs/game.js`, a single ~30k-line IIFE, plus
helper modules in `docs/js/*.js` loaded before it) can be run and driven in a
real headless browser in this sandbox — it just takes one workaround for a
blocked CDN. This was worked out through live trial-and-error in a prior
session; follow it directly instead of rediscovering it.

## The blocker, and the fix

`docs/index.html` loads three.js from a CDN:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
```

This sandbox's outbound HTTPS proxy commonly blocks that CDN host (you'll see
`net::ERR_TUNNEL_CONNECTION_FAILED` / a 403 from the proxy, and the page ends
up with `THREE is not defined`). Check the pinned version in the script tag
above — if it ever changes, adjust step 1 to match.

`registry.npmjs.org` is normally allowlisted even when the CDN isn't, and
three.js is published there too, so: vendor it from npm instead of trying to
unblock the CDN.

**Never edit the real `docs/` in place for this.** Do everything in a scratch
directory (e.g. your scratchpad), copy `docs/` there, and only patch the copy.

```bash
SCRATCH=/tmp/your-scratch-dir   # use your actual scratchpad
mkdir -p "$SCRATCH/threevendor" && cd "$SCRATCH/threevendor"
npm init -y >/dev/null 2>&1
npm install three@0.128.0   # 0.128.0 on npm == three.js r128

rm -rf "$SCRATCH/docs_test"
cp -r /path/to/repo/docs "$SCRATCH/docs_test"
cp "$SCRATCH/threevendor/node_modules/three/build/three.min.js" "$SCRATCH/docs_test/three.local.js"
sed -i 's#https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js#three.local.js#' \
  "$SCRATCH/docs_test/index.html"
```

Serve the scratch copy and wait for it to actually be up (don't fixed-sleep):

```bash
cd "$SCRATCH/docs_test" && (python3 -m http.server 8792 >/tmp/http.log 2>&1 &)
timeout 10 bash -c 'until curl -sf http://localhost:8792/index.html >/dev/null; do sleep 0.5; done'
```

Stop it later with `lsof -ti:8792 -sTCP:LISTEN | xargs -r kill` — not a broad
`pkill` pattern.

## Driving it with Playwright

Chromium is pre-installed at `/opt/pw-browsers/chromium` (a symlink to the
real binary; `PLAYWRIGHT_BROWSERS_PATH` is already set). The `playwright` npm
package isn't a dependency of this repo, but it's installed globally — reach
it from a plain script like this:

```js
process.env.NODE_PATH = '/opt/node22/lib/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:8792/index.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
```

Run scripts like this backgrounded (`nohup node script.js > out.log 2>&1 &`,
then poll for the process to exit) rather than foreground — spawning a bandit
gang and letting genotype/portrait art finish compositing can take longer
than a single tool call's timeout.

## Getting into the game

**First load** is character creation:

```js
await page.fill('input[placeholder*="name" i]', 'HeadlessTester').catch(() => {});
await page.click('button:has-text("Start Farming")');
```

**Main menu**, once on the farm:

```js
await page.click('#menuBtn');                        // opens the menu
await page.click('[data-mpanel="settings"]');         // switches tabs; other
// tabs use the same data-mpanel attribute: inventory/calendar/map/farm/
// stable/progress/tasks/relationships/loadout/settings/debug/wildlife
```

**Dev Testing Arena** — an empty sandbox zone with a creature/bandit spawner,
built for exactly this kind of isolated testing:

```js
await page.click('#devTeleportArenaBtn');   // from Settings; click again to warp back out
await page.click('#devSpawnBtn');           // opens the spawner (replaces the farm-editor pencil while here)
await page.click('[data-species="bandit:grunt"]');   // or bandit:lieutenant / bandit:captain,
                                                       // or any CREATURE_DB key
await page.click('[data-tier="0"]');        // bandit difficulty 0-3, optional, bandits only
await page.click('#devSpawnBtnAction');     // spawns near the player
await page.click('#devKillAllBtn');         // clears everything this panel spawned
```

**Reading the bandit combat-log tool** — a structured text snapshot buffer
built for exactly this kind of headless review (see `docs/game.js`'s
`captureBanditCombatSnapshotText`/`COMBAT_LOG_GUIDE` if you need the field
reference). It copies to the clipboard, so grant clipboard permissions on the
context first:

```js
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
// ... after clicking #devCombatLogBtn:
const text = await page.evaluate(() => navigator.clipboard.readText());
```

## Verifying beyond screenshots: inspecting the live scene graph

Screenshots of small sprites are hard to judge by eye — a rotation or
orientation bug can be genuinely ambiguous at thumbnail scale. When the thing
you're checking is numeric (a mesh's rotation, position, scale), read it
straight from the running THREE.js scene instead of guessing from pixels.

One wrinkle in this three.js build (r128): `WebGLRenderer.prototype.render`
is `undefined` — `render` is defined as an own instance property inside the
constructor closure, not on the shared prototype, so patching the prototype
does nothing. Wrap the constructor instead, via `page.addInitScript` (which
runs before the page's own scripts, so `window.THREE` doesn't exist yet —
poll for it):

```js
await page.addInitScript(() => {
  window.__scenes = new Set();
  let patched = false;
  const tryPatch = () => {
    if (patched || !window.THREE?.WebGLRenderer) return;
    patched = true;
    const OrigCtor = window.THREE.WebGLRenderer;
    window.THREE.WebGLRenderer = function (...args) {
      const inst = new OrigCtor(...args);
      const origRender = inst.render.bind(inst);
      inst.render = function (scene, camera) {
        window.__scenes.add(scene);
        return origRender(scene, camera);
      };
      return inst; // returning an object from a `new`-called function
                    // overrides the default `this` — no prototype juggling needed
    };
  };
  const iv = setInterval(() => { tryPatch(); if (patched) clearInterval(iv); }, 10);
});
```

Then, after some gameplay has happened, pull real mesh state out with
`page.evaluate`:

```js
const report = await page.evaluate(() => {
  const out = [];
  for (const scene of window.__scenes) {
    scene.traverse(obj => {
      if (obj.isMesh && obj.geometry?.type === 'PlaneGeometry' && obj.material?.map) {
        out.push({ name: obj.name, rotZ: obj.rotation.z, scaleX: obj.scale.x });
      }
    });
  }
  return out;
});
```

This is how a bandit weapon-orientation bug (a missing sprite-plane twist for
sweep-style weapons) was confirmed fixed: checking that sweep-weapon tool
planes actually reported `rotation.z === -Math.PI / 2` at runtime, rather
than trying to eyeball a few pixels of a tiny sprite in a screenshot.

## Noise to ignore

- A Google Fonts stylesheet fails to load (`ERR_CONNECTION_RESET`) — cosmetic
  font fallback only, not a real failure.
- Some CORS/404 console errors reference internal pseudo-URL cache keys the
  game's own texture-caching system uses (strings like `toolmetal:...`) —
  benign background-prefetch noise, not blockers.
- WebGL software-fallback warnings (`GL Driver Message`, "Automatic fallback
  to software WebGL...") are expected in a headless/no-GPU container.

## Cleanup

Everything above should live under your scratchpad, never inside the repo —
the vendored `three` package, the copied `docs_test/`, and any driver
scripts. Kill the http.server by port when done, and don't leave stray
Chromium/node processes running across turns.

#!/usr/bin/env node
// Real-browser A/B benchmark for fish / sprite pixel jobs (replaces hand-run
// Pixel Probe recordings for this one question: "do the multi-second stalls
// still happen?").
//
//   node scripts/perf-pixel-jobs-browser.js [--base <git-ref>] [--runs N] [--out file.json]
//
// For each side (the baseline git ref and the working tree) it copies docs/
// into a scratch dir, serves it, loads a minimal page containing only
// pixel-work-yield.js + fish-catalog.js (no WebGL, so frame times reflect
// the pixel work, not software rendering), recolours every authored fish
// variant with its real sprite sheet while a RAF loop and PerformanceObserver
// (longtask + long-animation-frame) record main-thread stalls.
// Exits non-zero if the working tree has any task >= --fail-ms (default 250)
// or the worker did not actually start. Not named test-*.js on purpose: it
// needs Chromium and is not part of the fast CI suite.
'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
require('module').Module._initPaths();
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const BASE = opt('base', '02ac68705');
const RUNS = +opt('runs', 1);
const FAIL_MS = +opt('fail-ms', 250);
const OUT = opt('out', null);
const root = path.resolve(__dirname, '..');

const BENCH_HTML = `<!doctype html><meta charset=utf-8><body>
<script src="js/pixel-work-yield.js"></script>
<script src="js/fish-catalog.js"></script>
<script>
window.__long = []; window.__loaf = []; window.__raf = [];
try { new PerformanceObserver(l => l.getEntries().forEach(e => __long.push(Math.round(e.duration*10)/10)))
  .observe({ entryTypes: ['longtask'] }); } catch (e) {}
try { new PerformanceObserver(l => l.getEntries().forEach(e => __loaf.push({ d: Math.round(e.duration), blocking: Math.round(e.blockingDuration||0) })))
  .observe({ type: 'long-animation-frame', buffered: true }); } catch (e) {}
let last = performance.now();
(function tick(t) { const n = performance.now(); __raf.push(n - last); last = n; requestAnimationFrame(tick); })(0);
window.runBench = async function () {
  const FC = window.FishCatalog;
  const sheetOf = f => 'assets/objectsprites/fish_' + f.species + '.png';
  const t0 = performance.now(); const hashes = {};
  const entries = FC.entries.map(e => FC.get(e.key || e[0]) || e).filter(Boolean);
  // Fire them all at once, like many fish loading together on zone entry.
  const canvases = {};
  await Promise.all(entries.map(async f => { canvases[f.key] = await FC.getRecoloredCanvas(sheetOf(f), f.key); }));
  const totalMs = Math.round(performance.now() - t0);
  await new Promise(r => setTimeout(r, 300));
  window.__stalls = { long: window.__long.slice(), loaf: window.__loaf.slice(), raf: window.__raf.slice() }; // Snapshot before hashing readbacks.
  for (const f of entries) { // Verification only; its getImageData stalls are excluded from the snapshot above.
    const c = canvases[f.key], d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261; for (let i = 0; i < d.length; i += 97) h = Math.imul(h ^ d[i], 16777619);
    hashes[f.key] = (h >>> 0).toString(16) + ':' + c.width + 'x' + c.height;
  }
  return { totalMs, count: entries.length, hashes };
};
</script>`;

function sh(cmd, a, cwd) { return execFileSync(cmd, a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }

function stage(label, ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxbench-' + label + '-'));
  if (ref) {
    const tar = path.join(dir, 'a.tar');
    sh('git', ['archive', '-o', tar, ref, 'docs'], root);
    sh('tar', ['-xf', tar, '-C', dir]);
  } else {
    sh('cp', ['-r', path.join(root, 'docs'), path.join(dir, 'docs')]);
  }
  const docs = path.join(dir, 'docs');
  fs.writeFileSync(path.join(docs, 'bench.html'), BENCH_HTML);
  return docs;
}

function serve(docs) {
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json' };
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const p = path.join(docs, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(p, (e, b) => {
        if (e || !p.startsWith(docs)) { r.writeHead(404); r.end(); return; }
        r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(b);
      });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)].toFixed(1); };

async function measure(browser, label, ref) {
  const docs = stage(label, ref), srv = await serve(docs);
  const out = { label, ref: ref || 'working-tree', runs: [] };
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
    await page.goto(`http://127.0.0.1:${srv.address().port}/bench.html`);
    await page.waitForFunction(() => window.FishCatalog && window.runBench, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => window.runBench());
    const m = await page.evaluate(() => ({
      long: window.__stalls.long, loaf: window.__stalls.loaf, raf: window.__stalls.raf,
      pixel: window.PixelWorkYield?.getDebug?.() || null, fish: window.FishCatalog.getPixelDebug?.() || null,
    }));
    out.runs.push({
      totalMs: r.totalMs, fishCount: r.count, hashes: r.hashes, errors,
      longTasks: { count: m.long.length, maxMs: Math.max(0, ...m.long), over100: m.long.filter(x => x > 100).length, all: m.long.slice(0, 40) },
      loaf: { count: m.loaf.length, maxMs: Math.max(0, ...m.loaf.map(x => x.d)) },
      rafGapMs: { p50: pct(m.raf, .5), p99: pct(m.raf, .99), max: +Math.max(0, ...m.raf).toFixed(1) },
      pixel: m.pixel, fish: m.fish,
    });
    await ctx.close();
  }
  srv.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const base = await measure(browser, 'base', BASE);
  const cur = await measure(browser, 'cur', null);
  await browser.close();
  const b = base.runs[0], c = cur.runs[0];
  const sameHashes = Object.keys(b.hashes).length === Object.keys(c.hashes).length
    && Object.keys(b.hashes).every(k => b.hashes[k] === c.hashes[k]);
  const summary = {
    baseRef: BASE, fishCount: c.fishCount,
    baseline: { totalMs: b.totalMs, maxLongTaskMs: b.longTasks.maxMs, longTasks: b.longTasks.count, maxRafGapMs: b.rafGapMs.max, loafMaxMs: b.loaf.maxMs },
    current: { totalMs: c.totalMs, maxLongTaskMs: c.longTasks.maxMs, longTasks: c.longTasks.count, maxRafGapMs: c.rafGapMs.max, loafMaxMs: c.loaf.maxMs,
      workerState: c.pixel?.workerState, workerJobs: c.pixel?.workerJobs, fallbackJobs: c.pixel?.fallbackJobs, workerFailures: c.pixel?.workerFailures, lastFailure: c.pixel?.lastFailure },
    outputIdenticalToBaseline: sameHashes, pageErrors: { baseline: b.errors, current: c.errors },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, base, cur }, null, 2));
  const problems = [];
  if (c.longTasks.maxMs >= FAIL_MS) problems.push(`current long task ${c.longTasks.maxMs}ms >= ${FAIL_MS}ms`);
  if (c.pixel?.workerState !== 'ready') problems.push(`worker state is ${c.pixel?.workerState}`);
  if (!sameHashes) problems.push('output differs from baseline');
  if (c.errors.length) problems.push('page errors: ' + c.errors.join('; '));
  if (problems.length) { console.error('FAIL:\n - ' + problems.join('\n - ')); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error(e); process.exit(2); });

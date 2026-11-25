#!/usr/bin/env node
// Plays the real game headlessly and reports which scripts cause long main-thread tasks.
//   node scripts/perf-gameplay-stalls-browser.js <docs-dir-with-local-three> [--settle 150] [--record 120] [--out file.json]
// STATUS: unverified end to end. In the cloud sandbox (software WebGL) the page stopped answering
// during new-farm creation in two runs, so the recording/report half has not produced real data yet.
// Prepare <docs-dir> per .claude/skills/headless-game-test (vendored three.local.js, patched index.html).
// Software WebGL makes frames slow, so rank by SCRIPT attribution (long-animation-frame scripts and a
// CDP CPU profile), not by raw FPS. Output is a ranked list of stall sources, worst first.
'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const docs = path.resolve(args[0]);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const SETTLE = +opt('settle', 150) * 1000, RECORD = +opt('record', 120) * 1000, OUT = opt('out', null);
const T = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const srv = http.createServer((q, r) => {
  const p = path.join(docs, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(p)] || 'application/octet-stream' }); r.end(b); });
});
srv.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${srv.address().port}/index.html?skipIntro=1&skipRescue=1&skipMeeting=1`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 360, height: 240 } })).newPage();
  const errs = []; page.on('crash', () => console.error('PAGE CRASHED at', new Date().toISOString())); page.on('close', () => console.error('page closed', new Date().toISOString())); page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    window.__loaf = [];
    try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__loaf.push({
      t: Math.round(e.startTime), d: Math.round(e.duration), blocking: Math.round(e.blockingDuration || 0),
      style: Math.round((e.styleAndLayoutStart && e.startTime + e.duration - e.styleAndLayoutStart) || 0),
      scripts: (e.scripts || []).map(s => ({ src: String(s.sourceURL).split('/').slice(-2).join('/').split('?')[0], fn: s.sourceFunctionName, type: s.invokerType, d: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration || 0) })),
    }))).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) {}
  });
  const early = await page.context().newCDPSession(page);
  await early.send('Profiler.enable'); await early.send('Profiler.setSamplingInterval', { interval: 2000 }); await early.send('Profiler.start');
  const topOf = prof => { const nodes = new Map(prof.nodes.map(n => [n.id, n])), m = new Map();
    prof.samples.forEach((id, i) => { const c = nodes.get(id).callFrame; const k = `${c.functionName || '(anon)'} ${String(c.url).split('/').slice(-2).join('/').split('?')[0]}:${c.lineNumber + 1}`; m.set(k, (m.get(k) || 0) + (prof.timeDeltas[i] || 0) / 1000); });
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, ms]) => Math.round(ms) + 'ms ' + k); };
  const watchdog = setTimeout(async () => { try { const { profile } = await early.send('Profiler.stop'); console.error('STALLED >240s in start flow; top self time:\n' + topOf(profile).join('\n')); await early.send('Profiler.start'); } catch (e) { console.error('watchdog failed', e.message); } }, 240000);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000); await page.keyboard.press('Enter'); await page.waitForTimeout(2000);
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) console.error('start loop', i, new Date().toISOString());
    if (await page.evaluate(() => window.__hobunjiGameStarted === true).catch(() => false)) break;
    const sel = await page.evaluate(() => {
      const vis = el => el && el.offsetParent !== null && !el.disabled;
      const f = document.querySelector('#slNewWorldName');
      if (vis(f) && !f.value.trim()) { f.value = 'Test Farm'; f.dispatchEvent(new Event('input', { bubbles: true })); }
      return ['#hobunjiEmptySaveCreate', '#ob-start-btn', '#slPlay', '#slCharNext', '#slSourceContinue'].find(s => vis(document.querySelector(s))) || null;
    }).catch(() => null);
    if (sel) await page.click(sel, { timeout: 8000 }).catch(() => {}); else await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(4000);
  }
  clearTimeout(watchdog); try { await early.send('Profiler.stop'); } catch (e) {}
  console.error('game started:', await page.evaluate(() => window.__hobunjiGameStarted).catch(() => 'err'));
  await page.waitForTimeout(SETTLE); // World gen + NPC spawn settle (see skill: ~2 minutes).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
  const mark = await page.evaluate(() => { window.__loaf.length = 0; return performance.now(); });
  // Walk around so movement/NPC/animal paths run, not just idle.
  const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
  for (let t = 0, k = 0; t < RECORD; t += 3000, k++) { await page.keyboard.down(keys[k % 4]); await page.waitForTimeout(3000); await page.keyboard.up(keys[k % 4]); }
  const { profile } = await cdp.send('Profiler.stop');
  const loaf = await page.evaluate(() => window.__loaf);
  const nodes = new Map(profile.nodes.map(n => [n.id, n])); const self = new Map();
  const dt = profile.timeDeltas; profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (dt[i] || 0)));
  const byFn = new Map(), byModule = new Map(), special = { idle: 0, program: 0, gc: 0, root: 0 };
  let total = 0;
  for (const [id, us] of self) {
    const n = nodes.get(id), c = n.callFrame, ms = us / 1000; total += ms;
    const fn = c.functionName || '(anon)';
    if (fn === '(idle)') { special.idle += ms; continue; }
    if (fn === '(program)') { special.program += ms; continue; }
    if (fn === '(garbage collector)') { special.gc += ms; continue; }
    if (fn === '(root)') { special.root += ms; continue; }
    const mod = c.url ? String(c.url).split('/').slice(-2).join('/').split('?')[0] : '(native/browser)';
    const key = `${fn} ${mod}:${c.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) || 0) + ms); byModule.set(mod, (byModule.get(mod) || 0) + ms);
  }
  const busy = total - special.idle; // Share is of non-idle time so the long tail is visible.
  const sortedFns = [...byFn].sort((a, b) => b[1] - a[1]);
  const cum = n => Math.round(100 * sortedFns.slice(0, n).reduce((a, x) => a + x[1], 0) / busy);
  const cpu = sortedFns.slice(0, 25).map(([k, ms]) => ({ fn: k, selfMs: Math.round(ms), pctBusy: +(100 * ms / busy).toFixed(2) }));
  const cpuModules = [...byModule].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, ms]) => ({ module: k, selfMs: Math.round(ms), pctBusy: +(100 * ms / busy).toFixed(2) }));
  const coverage = {
    totalMs: Math.round(total), idleMs: Math.round(special.idle), busyMs: Math.round(busy),
    nativeProgramMs: Math.round(special.program), gcMs: Math.round(special.gc), jsFunctions: sortedFns.length,
    pctOfBusyInTop10: cum(10), top50: cum(50), top200: cum(200), top1000: cum(1000),
    functionsUnder0_05pctEach: sortedFns.filter(x => 100 * x[1] / busy < 0.05).length,
  };
  const srcAgg = new Map();
  for (const f of loaf) for (const s of f.scripts) { const k = `${s.src} ${s.fn || s.type}`; const a = srcAgg.get(k) || { src: k, count: 0, totalMs: 0, maxMs: 0, forcedMs: 0 }; a.count++; a.totalMs += s.d; a.maxMs = Math.max(a.maxMs, s.d); a.forcedMs += s.forced; srcAgg.set(k, a); }
  const report = {
    recordMs: RECORD, frames: loaf.length, worstFrames: loaf.slice().sort((a, b) => b.d - a.d).slice(0, 10),
    scriptsByMaxStall: [...srcAgg.values()].sort((a, b) => b.maxMs - a.maxMs).slice(0, 20),
    coverage, cpuSelfTop: cpu, cpuByModule: cpuModules, pageErrors: [...new Set(errs)].slice(0, 10),
  };
  console.log(JSON.stringify(report, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  await b.close(); srv.close();
});

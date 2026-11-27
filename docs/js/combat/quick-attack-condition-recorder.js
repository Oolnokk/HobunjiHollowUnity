// Quick Attack condition recorder (dev tool).
//
// Tick "Record quick-attack conditions" in Settings (developer mode), fight, tick it off, and the
// report lands on the clipboard. While recording, every living hostile within RANGE_TILES of the
// local player is sampled once per browser frame through the SAME evaluator the game uses
// (Combat.getQuickAttackConditions), so the numbers are exactly what the Quick Attack bonuses saw.
//
// Per group (bandit, tribe id, or creature key) and per individual it records how much of the
// time each condition was active, how many separate openings there were and how long they lasted.
// It also keeps weighted histograms of Health fraction, Stamina fraction and "seconds since the
// enemy's last staged attack ended" so the report can say which Health/Stamina threshold or
// post-strike grace would make each condition as frequent as "behind" — the benchmark the
// Quick Attack conditions are balanced against.
(() => {
  'use strict';
  const SCHEDULER_ID = 'quick-attack-condition-recorder';
  const RANGE_TILES = 10; // Enemies farther than this are not part of the fight being recorded.
  const MAX_DT_S = 0.5; // A hitch (tab switch, load) must not be credited as seconds of one condition.
  const KEYS = ['enemyStriking', 'exhausted', 'behind', 'lowHealth'];
  const BIN = 0.05; // Histogram resolution for Health/Stamina fractions.
  const SINCE_BIN_S = 0.25;
  const SINCE_MAX_S = 12;

  let recording = false;
  let session = null;
  let unregister = null;
  let lastFrameMs = 0;

  const nowMs = () => Number(window.SimClock?.now?.()) || performance.now(); // Gameplay clock, same as the evaluator's grace timers.

  function newHist(size) { return new Array(size).fill(0); }
  function newStats() {
    const conds = {};
    for (const k of KEYS) conds[k] = { activeS: 0, episodes: 0, durs: [], startMs: null };
    return {
      aliveS: 0, conds,
      hp: newHist(Math.round(1 / BIN) + 1), stam: newHist(Math.round(1 / BIN) + 1),
      sinceWhiff: newHist(Math.round(SINCE_MAX_S / SINCE_BIN_S) + 1), sinceHit: newHist(Math.round(SINCE_MAX_S / SINCE_BIN_S) + 1),
      attacks: 0, hits: 0, whiffs: 0,
    };
  }
  function groupOf(c) {
    if (c.tribeId) return c.tribeId;
    if (c.isBandit || typeof c.id === 'string' && c.id.startsWith('bandit_')) return 'bandit';
    return c.creatureKey || c.species || 'creature';
  }

  function addSample(stats, c, cond, dt, nowMsValue, grp) {
    stats.aliveS += dt;
    for (const k of KEYS) {
      const s = stats.conds[k];
      if (cond[k]) { s.activeS += dt; if (s.startMs == null) { s.startMs = nowMsValue; s.episodes++; } }
      else if (s.startMs != null) { s.durs.push((nowMsValue - s.startMs) / 1000); s.startMs = null; }
    }
    const hp = Math.max(0, Math.min(1, (Number(c.health) || 0) / (Number(c.maxHealth) || 1)));
    const st = Math.max(0, Math.min(1, (Number(c.stamina) || 0) / (Number(c.maxStamina) || 1)));
    stats.hp[Math.round(hp / BIN)] += dt;
    stats.stam[Math.round(st / BIN)] += c.exhaustion?.active ? 0 : dt; // True Exhausted is counted separately (always qualifies).
    if (c.exhaustion?.active) stats.stam[0] += dt;
    if (Number(c._oppEndedMs) > 0 && Number(c._oppEndedMs) >= Number(c._oppStartMs) && !(c._oppHadPhase)) {
      const since = (nowMsValue - c._oppEndedMs) / 1000;
      if (since >= 0 && since <= SINCE_MAX_S) {
        const connected = Number(c._oppConnectedMs) >= Number(c._oppStartMs);
        (connected ? stats.sinceHit : stats.sinceWhiff)[Math.floor(since / SINCE_BIN_S)] += dt;
      }
    }
  }

  function closeOpenEpisodes(stats, nowMsValue) {
    for (const k of KEYS) { const s = stats.conds[k]; if (s.startMs != null) { s.durs.push((nowMsValue - s.startMs) / 1000); s.startMs = null; } }
  }

  function frame() {
    if (!recording || !session) return;
    const combat = window.Combat; const deps = combat?.deps;
    const player = window.ActorRegistry?.getLocalPlayer?.() || deps?.player;
    const evaluate = combat?.getQuickAttackConditions;
    if (!deps || !player || typeof evaluate !== 'function') return;
    const now = nowMs();
    const dt = Math.min(MAX_DT_S, Math.max(0, (now - lastFrameMs) / 1000)); lastFrameMs = now;
    if (!(dt > 0)) return;
    session.frames++; session.durationS += dt;
    const range = (Number(deps.TILE) || 32) * RANGE_TILES;
    const area = deps.getCurrentArea?.();
    const seen = new Set();
    for (const c of deps.hostileObjects || []) {
      if (!c || !(c.health > 0) || (area != null && c.areaId != null && c.areaId !== area)) continue;
      if (Math.hypot(c.x - player.x, c.y - player.y) > range) continue;
      let cond;
      try { cond = evaluate(deps, c, player); } catch (error) { session.errors++; continue; }
      const key = c.id ?? c;
      seen.add(key);
      let ind = session.individuals.get(key);
      if (!ind) { ind = { id: String(c.id ?? 'enemy'), name: c.name || null, group: groupOf(c), stats: newStats(), lastStart: 0, wasConnected: false }; session.individuals.set(key, ind); }
      // Attack bookkeeping: a new staged attack is identified by its start stamp.
      const start = Number(c._oppStartMs) || 0;
      if (start && start !== ind.lastStart) { ind.lastStart = start; ind.stats.attacks++; ind.counted = false; }
      if (start && !ind.counted && Number(c._oppConnectedMs) >= start) { ind.counted = true; ind.stats.hits++; }
      addSample(ind.stats, c, cond, dt, now, ind.group);
    }
    for (const [key, ind] of session.individuals) { // Left range or died: close their open episodes.
      if (!seen.has(key)) closeOpenEpisodes(ind.stats, now);
    }
  }

  function start() {
    if (recording) return false;
    recording = true; lastFrameMs = nowMs();
    session = { startedAt: new Date().toISOString(), frames: 0, durationS: 0, errors: 0, individuals: new Map() };
    unregister = window.RuntimeFrameScheduler?.register?.(SCHEDULER_ID, frame, { phase: 'post-game', owner: 'QuickAttackConditionRecorder', description: 'Dev-only sampler for Quick Attack condition frequency.' }) || null;
    return true;
  }

  function stop() {
    if (!recording) return null;
    recording = false;
    try { unregister?.(); } catch (e) { /* already gone */ }
    unregister = null;
    const now = nowMs();
    for (const ind of session.individuals.values()) { closeOpenEpisodes(ind.stats, now); ind.stats.whiffs = Math.max(0, ind.stats.attacks - ind.stats.hits); }
    return buildReport();
  }

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  function merge(statsList) {
    const out = newStats();
    for (const s of statsList) {
      out.aliveS += s.aliveS; out.attacks += s.attacks; out.hits += s.hits; out.whiffs += s.whiffs;
      for (const k of KEYS) { out.conds[k].activeS += s.conds[k].activeS; out.conds[k].episodes += s.conds[k].episodes; out.conds[k].durs.push(...s.conds[k].durs); }
      for (const h of ['hp', 'stam', 'sinceWhiff', 'sinceHit']) s[h].forEach((v, i) => { out[h][i] += v; });
    }
    return out;
  }
  const pct = (a, b) => b > 0 ? Math.round(1000 * a / b) / 10 : 0;
  function summarize(stats) {
    const row = { aliveS: Math.round(stats.aliveS * 10) / 10, attacks: stats.attacks, hits: stats.hits, whiffs: stats.whiffs, conditions: {} };
    for (const k of KEYS) {
      const c = stats.conds[k];
      row.conditions[k] = { activePct: pct(c.activeS, stats.aliveS), episodes: c.episodes, perMin: stats.aliveS > 0 ? Math.round(600 * c.episodes / stats.aliveS) / 10 : 0, avgS: c.durs.length ? Math.round(10 * sum(c.durs) / c.durs.length) / 10 : 0 };
    }
    return row;
  }

  // Smallest Health/Stamina fraction (or post-whiff grace in seconds) whose active share reaches `targetPct`.
  function thresholdFor(hist, binSize, targetPct, totalS, extraS = 0) {
    let acc = extraS;
    for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (totalS > 0 && 100 * acc / totalS >= targetPct) return (i + 1) * binSize; }
    return null;
  }
  function suggestions(stats, whiffAlive) {
    const target = pct(stats.conds.behind.activeS, stats.aliveS);
    const out = { benchmarkBehindPct: target, lowHealthHpAtMost: null, exhaustedStaminaAtMost: null, strikingGraceS: null };
    if (!(stats.aliveS > 0) || !(target > 0)) return out;
    out.lowHealthHpAtMost = thresholdFor(stats.hp, BIN, target, stats.aliveS);
    out.exhaustedStaminaAtMost = thresholdFor(stats.stam, BIN, target, stats.aliveS);
    const strikingNowS = stats.conds.enemyStriking.activeS - sum(stats.sinceWhiff.slice(0, Math.floor(Number(window.Combat?.quickAttackData?.OPPORTUNITY_GRACE_S ?? 3) / SINCE_BIN_S))); // Remove the current grace's contribution, then add it back per candidate length.
    out.strikingGraceS = thresholdFor(stats.sinceWhiff, SINCE_BIN_S, target, stats.aliveS, Math.max(0, strikingNowS));
    return out;
  }

  function buildReport() {
    const all = [...session.individuals.values()];
    const groups = {};
    for (const ind of all) (groups[ind.group] ||= []).push(ind);
    const report = { startedAt: session.startedAt, durationS: Math.round(session.durationS * 10) / 10, frames: session.frames, errors: session.errors,
      graceS: window.Combat?.quickAttackData?.OPPORTUNITY_GRACE_S ?? null, groups: {}, overall: null };
    const mergedAll = merge(all.map(i => i.stats));
    report.overall = { ...summarize(mergedAll), suggested: suggestions(mergedAll) };
    for (const [name, list] of Object.entries(groups)) {
      const merged = merge(list.map(i => i.stats));
      const shuffled = list.map(i => [Math.random(), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(0, 5); // 5 random specific individuals per group.
      report.groups[name] = { individuals: list.length, ...summarize(merged), suggested: suggestions(merged),
        sample: shuffled.map(i => ({ id: i.id, name: i.name, ...summarize(i.stats) })) };
    }
    return report;
  }

  function formatReport(r) {
    const lines = [`QUICK ATTACK CONDITION RECORDING — ${r.durationS}s, ${r.frames} frames, grace ${r.graceS}s, errors ${r.errors}`];
    const fmt = (row) => KEYS.map(k => { const c = row.conditions[k]; return `${k} ${c.activePct}% (${c.perMin}/min, avg ${c.avgS}s)`; }).join(' | ');
    const sug = (s) => `benchmark behind ${s.benchmarkBehindPct}% -> lowHealth HP<=${s.lowHealthHpAtMost ?? '?'} | exhausted Stamina<=${s.exhaustedStaminaAtMost ?? '?'} | striking grace ${s.strikingGraceS ?? '?'}s`;
    lines.push(`ALL ${r.overall.aliveS}s in range, attacks ${r.overall.attacks} (hit ${r.overall.hits}, whiffed ${r.overall.whiffs}): ${fmt(r.overall)}`, `  suggested: ${sug(r.overall.suggested)}`);
    for (const [name, g] of Object.entries(r.groups)) {
      lines.push(`${name} x${g.individuals} ${g.aliveS}s, attacks ${g.attacks} (hit ${g.hits}, whiffed ${g.whiffs}): ${fmt(g)}`, `  suggested: ${sug(g.suggested)}`);
      for (const i of g.sample) lines.push(`  - ${i.name || i.id} ${i.aliveS}s: ${fmt(i)}`);
    }
    return lines.join('\n');
  }

  async function copyReport(report) {
    const text = `${formatReport(report)}\n\n${JSON.stringify(report)}`;
    try { await navigator.clipboard.writeText(text); return true; } catch (error) { console.log(text); return false; }
  }

  function bindUi() {
    const box = document.getElementById('devQuickRecorderToggle');
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    const status = document.getElementById('devQuickRecorderStatus');
    const setStatus = (t) => { if (status && status.textContent !== t) status.textContent = t; };
    box.addEventListener('change', async () => {
      if (box.checked) { start(); setStatus('Recording… fight, then untick to copy the report.'); return; }
      const report = stop();
      if (!report) return;
      const copied = await copyReport(report);
      setStatus(copied ? `Report copied (${report.durationS}s, ${Object.keys(report.groups).length} groups).` : 'Clipboard blocked — report printed to the console.');
      window.showToast?.(copied ? 'Quick-attack condition report copied' : 'Report printed to console', copied);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi); else bindUi();

  window.QuickAttackConditionRecorder = { start, stop, isRecording: () => recording, formatReport, copyReport, snapshot: () => (session ? buildReport() : null) };
})();

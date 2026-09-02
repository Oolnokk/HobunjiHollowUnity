#!/usr/bin/env node
'use strict';

// Data-integrity check for every NPC's real agenda[] content in
// docs/config/npcs/hobunji-starter-npc-database.json — a Node port of the
// Schedule Editor's own agendaIssuesFor() (docs/tools/schedule-editor/
// index.html), run automatically instead of only when someone opens the
// tool. All this session's agenda authoring has been hand-edited JSON via
// string replacement, which is exactly the kind of work a typo'd
// destinationStationId or activity key slips through silently (the NPC
// just gets ACTIVITY_UNAVAILABLE/NO_PLAN forever) — this catches that
// class of mistake across the whole roster in one pass.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Mirrors js/npc-activities.js's registry (register(...) calls) and
// game.js's KNOWN_ACTIVITY_KEYS/ACTIVITIES_REQUIRING_EXPLICIT_DESTINATION —
// keep in sync with both if the registry ever changes.
const KNOWN_ACTIVITY_KEYS = new Set(['legacyScheduleActivity', 'goToStation', 'goToRole', 'work', 'eat', 'drink', 'sleep', 'shop', 'performMusic', 'joinPerformance', 'idle', 'break', 'freeTime', 'socialize', 'visit', 'wander', 'sit', 'chat', 'watchPerformance']);
const ACTIVITIES_REQUIRING_EXPLICIT_DESTINATION = new Set(['work', 'goToStation', 'goToRole']);
const KNOWN_OBLIGATIONS = new Set(['critical', 'duty', 'plan', 'leisure']);
const KNOWN_DAYPARTS = new Set(['dawn', 'morning', 'midday', 'afternoon', 'evening', 'night', 'lateNight']);

function parseTimeMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// ── Load every NPC record ───────────────────────────────────────────────
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/npcs/hobunji-starter-npc-database.json'), 'utf8'));
function collectNpcs(node, out) {
  if (Array.isArray(node)) { for (const item of node) collectNpcs(item, out); }
  else if (node && typeof node === 'object') {
    if (typeof node.id === 'string' && (node.scheduleHooks || node.agenda)) out.push(node);
    for (const v of Object.values(node)) collectNpcs(v, out);
  }
}
const npcs = [];
collectNpcs(db, npcs);
assert(npcs.length >= 39, `expected at least the 39-NPC starter roster, found ${npcs.length}`);

// ── Load every known station id + the roles it advertises ──────────────
const stationIds = new Set();
const roleIndex = new Map(); // role -> Set(stationId)
function addRole(role, stationId) {
  if (!roleIndex.has(role)) roleIndex.set(role, new Set());
  roleIndex.get(role).add(stationId);
}
const mapsDir = path.join(ROOT, 'docs/config/maps');
const mapFiles = fs.readdirSync(mapsDir).filter(f => f.endsWith('.json'));
// Building areas are loaded via fetch('config/maps/' + mapId + '.json')
// (game.js's loadBuildingScene) — the *filename* is the real area id a
// destinationArea/mapId string must match, not each file's own internal
// "id" field (map_i_temple.json's internal id is "hh_temple_F1", a quirk
// that predates this redesign; "map_i_temple" — the filename — is what
// every schedule rule/agenda beat actually references, and what really
// resolves at runtime). The one exception is the outdoor town map, whose
// filename (hobunji_hollow_town.map.json) doesn't match its own area
// string at all — normalizeNpcArea (game.js) hardcodes that alias set,
// mirrored here rather than re-derived.
const mapIds = new Set(['town', 'hobunji_main_town', 'map_hobunji_town']);
for (const f of mapFiles) mapIds.add(f.replace(/\.json$/, ''));
for (const f of mapFiles) {
  const m = JSON.parse(fs.readFileSync(path.join(mapsDir, f), 'utf8'));
  const areaId = f.replace(/\.json$/, ''); // see mapIds note above — filename, not m.id
  for (const st of (m.npcStations || [])) {
    if (!st.id) continue;
    stationIds.add(st.id);
    for (const r of (st.roles || [])) addRole(r, st.id);
  }
  // *Every* sittable map-authored furniture piece auto-registers as
  // furniture_chair_<area>_<c>_<r> (game.js's registerChairNpcStation/
  // furnitureNpcStationId) regardless of whether it carries authored
  // roles[] — roles[] just layers extra semantic tags on top (e.g. the
  // Khibu living room stools). A non-sittable piece (crates, a counter)
  // never actually gets registered, but nothing here schedules an NPC to
  // "sit" at one, so treating every furniture entry as a valid seat id is
  // safe and avoids duplicating DECORATIVE_FURNITURE_DEFS's sit-flag table.
  for (const furn of (m.furniture || [])) {
    if (!Number.isFinite(furn.col) || !Number.isFinite(furn.row)) continue;
    const fid = `furniture_chair_${areaId}_${furn.col}_${furn.row}`;
    stationIds.add(fid);
    for (const r of (furn.roles || [])) addRole(r, fid);
  }
}
// Runtime-registered stations that intentionally live outside any map file
// (see docs/config/npcs/dynamic-station-sources.json's own note).
const dynamicSources = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/npcs/dynamic-station-sources.json'), 'utf8'));
for (const src of (dynamicSources.sources || [])) {
  if (!src.idPattern) continue;
  stationIds.add(src.idPattern);
  for (const r of (src.roles || [])) addRole(r, src.idPattern);
}
// 'sit' is additionally granted at runtime to every placed decorative chair
// (registerChairNpcStation) — never assumed empty by the editor's own check.

// Shared by both a beat's own destinationStationId/destinationRole and its
// preferences.{prefer,fallback}{StationId,Role} — the socialize/visit
// activity resolves those exactly the same way (see npc-activities.js's
// socialize()), so a typo in a fallback is just as capable of silently
// stranding an NPC as one in the beat's primary destination.
function checkStationRef(tag, whichLabel, stationId, role) {
  const issues = [];
  if (stationId && !stationIds.has(stationId)) {
    issues.push(`${tag}: ${whichLabel} "${stationId}" doesn't match any known station.`);
  }
  if (role) {
    const candidates = roleIndex.get(role);
    if ((!candidates || !candidates.size) && role !== 'sit') {
      issues.push(`${tag}: ${whichLabel} role "${role}" — no known station advertises it.`);
    }
  }
  return issues;
}

function issuesFor(npc) {
  const issues = [];
  const label = i => `${npc.name || npc.id}, agenda beat ${i + 1}`;
  (npc.agenda || []).forEach((beat, i) => {
    const tag = `${label(i)}${beat.id ? ` ("${beat.id}")` : ''}`;
    if (!beat.activity) issues.push(`${tag}: no activity set.`);
    else if (!KNOWN_ACTIVITY_KEYS.has(beat.activity)) issues.push(`${tag}: activity "${beat.activity}" isn't a registered activity.`);
    if (beat.obligation && !KNOWN_OBLIGATIONS.has(beat.obligation)) issues.push(`${tag}: obligation "${beat.obligation}" isn't critical/duty/plan/leisure.`);
    if (ACTIVITIES_REQUIRING_EXPLICIT_DESTINATION.has(beat.activity) && !beat.destinationStationId && !beat.destinationRole) {
      issues.push(`${tag}: activity "${beat.activity}" needs destinationStationId or destinationRole.`);
    }
    issues.push(...checkStationRef(tag, 'destinationStationId', beat.destinationStationId, null));
    issues.push(...checkStationRef(tag, 'destinationRole', null, beat.destinationRole));
    if (beat.preferences) {
      const p = beat.preferences;
      issues.push(...checkStationRef(tag, 'preferences.preferStationId', p.preferStationId, null));
      issues.push(...checkStationRef(tag, 'preferences.preferRole', null, p.preferRole));
      issues.push(...checkStationRef(tag, 'preferences.fallbackStationId', p.fallbackStationId, null));
      issues.push(...checkStationRef(tag, 'preferences.fallbackRole', null, p.fallbackRole));
    }
    if (beat.destinationArea && !mapIds.has(beat.destinationArea)) {
      issues.push(`${tag}: destinationArea "${beat.destinationArea}" isn't a known map id.`);
    }
    if (Array.isArray(beat.window)) {
      if (beat.window.length !== 2 || parseTimeMin(beat.window[0]) === null || parseTimeMin(beat.window[1]) === null) {
        issues.push(`${tag}: window should be exactly two "HH:MM" strings, got ${JSON.stringify(beat.window)}.`);
      }
    } else if (beat.daypart) {
      const parts = Array.isArray(beat.daypart) ? beat.daypart : [beat.daypart];
      for (const d of parts) if (!KNOWN_DAYPARTS.has(d)) issues.push(`${tag}: daypart "${d}" isn't recognized.`);
    }
  });
  return issues;
}

const allIssues = [];
let npcsWithAgenda = 0;
for (const npc of npcs) {
  if (!(Array.isArray(npc.agenda) && npc.agenda.length)) continue;
  npcsWithAgenda++;
  for (const msg of issuesFor(npc)) allIssues.push(`${npc.id}: ${msg}`);
}

assert(npcsWithAgenda >= 16, `expected at least the 16 NPCs converted to agenda[] so far, found ${npcsWithAgenda}`);
assert.deepEqual(allIssues, [], `agenda content issues found:\n  ${allIssues.join('\n  ')}`);

console.log(`npc agenda data integrity checks passed (${npcsWithAgenda} NPCs on agenda[], ${stationIds.size} known stations, ${roleIndex.size} distinct roles)`);

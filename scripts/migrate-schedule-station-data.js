#!/usr/bin/env node
// One-time data migration for the NPC schedule / structure-door cleanup.
// Run with: node scripts/migrate-schedule-station-data.js [--dry-run]
//
// What it does, in order (see the plan this shipped with for the full
// rationale — this comment is the short version):
//
// 1. House pieces (docs/config/pieces/*.json): backfills a single authored
//    footprint.door = {x, y} point from whatever footprint.entrances[] used
//    to hold (the game never read that array — see js/building-door.js's
//    header comment), or from the same porch/south-edge geometry heuristic
//    the game and Map Editor already used to compute a door on the fly.
//    Removes the old entrances[] array once door is populated.
//
// 2. NPC database (docs/config/npcs/hobunji-starter-npc-database.json):
//      a. Drops the redundant raw position/{c,r} on any schedule rule that
//         already has a stationId resolving to a real, authored station —
//         stationId is the one source of truth going forward; keeping a
//         second, independently-stale coordinate next to it is exactly the
//         kind of silent-fallback duplication this cleanup targets.
//      b. Flags rules/NPCs that don't resolve to anything real as
//         contentIncomplete (with a reason), instead of leaving them to
//         silently resolve to world-origin or a map that doesn't exist.
//         docs/game.js's resolver skips contentIncomplete entries entirely
//         (falls through / defers spawn) rather than treating them as valid.
//      c. Removes gantami_ginju's defaultStationId, which points at a
//         station that was never authored anywhere — dead, and provably
//         unreachable besides (her two rules already cover all 24 hours).
//      d. Extracts the hardcoded Temple Service schedule (day/time window,
//         excluded NPC ids, pew station ids — previously baked into
//         docs/game.js) into an authored, editable `sharedSchedules[]`
//         array on the database's top level.
//
// 3. Writes docs/config/npcs/dynamic-station-sources.json, a small registry
//    documenting station ids that are registered at runtime by procedural
//    code (currently just Garanki Gabu's tent desk/statues) rather than
//    authored in any static map file — so tooling can label them instead of
//    just failing to find them.
//
// Idempotent: safe to re-run (already-migrated data is left alone).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  if (DRY_RUN) { console.log(`[dry-run] would write ${path.relative(ROOT, p)}`); return; }
  fs.writeFileSync(p, text);
  console.log(`wrote ${path.relative(ROOT, p)}`);
}

const { BuildingDoor } = require(path.join(ROOT, 'docs/js/building-door.js'));

// ── 1. House piece doors ────────────────────────────────────────────────────
function migratePieceDoors() {
  const piecesDir = path.join(ROOT, 'docs/config/pieces');
  const files = fs.readdirSync(piecesDir).filter(f => f.endsWith('.json') && f !== 'index.json');
  let changed = 0;
  for (const f of files) {
    const p = path.join(piecesDir, f);
    const piece = readJson(p);
    if (!piece.footprint) continue;
    let didChange = false;
    if (!piece.footprint.door) {
      const authoredEntrances = Array.isArray(piece.footprint.entrances) ? piece.footprint.entrances : [];
      let door = null;
      if (authoredEntrances.length && Number.isFinite(authoredEntrances[0]?.x) && Number.isFinite(authoredEntrances[0]?.y)) {
        // Only the game-never-reads-this footprint.entrances[0] previously
        // stood in for "the door" — promote it to the one real door point.
        door = { x: authoredEntrances[0].x, y: authoredEntrances[0].y };
      } else {
        door = BuildingDoor.computeDefaultDoorLocal(piece);
      }
      if (door) { piece.footprint.door = door; didChange = true; }
    }
    if ('entrances' in piece.footprint) { delete piece.footprint.entrances; didChange = true; }
    if (didChange) { writeJson(p, piece); changed++; }
  }
  console.log(`House pieces: ${changed}/${files.length} updated with a single footprint.door.`);
}

// ── 2. NPC schedule data ────────────────────────────────────────────────────
function migrateNpcDatabase() {
  const dbPath = path.join(ROOT, 'docs/config/npcs/hobunji-starter-npc-database.json');
  const db = readJson(dbPath);

  // 2a/2b: build the set of stations actually authored somewhere, so we can
  // tell "stationId resolves" from "doesn't" the same way the resolver does.
  const mapsDir = path.join(ROOT, 'docs/config/maps');
  const authoredStationIds = new Set();
  for (const f of fs.readdirSync(mapsDir).filter(f => f.endsWith('.json'))) {
    let mapData;
    try { mapData = readJson(path.join(mapsDir, f)); } catch { continue; }
    for (const st of mapData.npcStations || []) if (st?.id) authoredStationIds.add(st.id);
  }
  // Stations registered at runtime by procedural code (not in any map file)
  // still resolve fine in-game — see dynamic-station-sources.json below.
  const DYNAMIC_STATION_IDS = new Set([
    'station_researchers_tent_desk',
    'station_researchers_tent_statue_1',
    'station_researchers_tent_statue_2',
    'station_researchers_tent_statue_3',
  ]);
  const resolvable = id => authoredStationIds.has(id) || DYNAMIC_STATION_IDS.has(id);

  let dedupedPositions = 0, flaggedRules = 0, flaggedNpcs = 0;
  for (const npc of db.npcs || []) {
    const hooks = npc.scheduleHooks;
    if (!hooks) continue;

    for (const rule of hooks.rules || []) {
      if (rule.stationId && resolvable(rule.stationId) && rule.position) {
        delete rule.position;
        dedupedPositions++;
      }
      // leaf/pahu's swamp-house rule: only source of a position, on a map
      // that doesn't exist in docs/config/maps — mark it rather than let the
      // resolver try to load a building scene that will never load.
      if (!rule.stationId && rule.mapId === 'map_i_swamp_house' && !fs.existsSync(path.join(mapsDir, 'map_i_swamp_house.json'))) {
        if (!rule.contentIncomplete) {
          rule.contentIncomplete = true;
          rule.contentIncompleteReason = 'mapId map_i_swamp_house has no map file yet in docs/config/maps — needs a real interior + station before this rule can resolve.';
          flaggedRules++;
        }
      }
    }

    // gantami_ginju: defaultStationId (station_ginju_rug_gantami) points at
    // a station authored nowhere, and is provably unreachable — her two
    // rules (08:00-19:00 and 19:00-08:00, no day restriction) already cover
    // all 24 hours of every day, so this fallback can never actually be
    // consulted. Confirmed by hand against the current data; dropped rather
    // than flagged since it's genuinely dead, not incomplete.
    if (npc.id === 'gantami_ginju' && hooks.defaultStationId && !resolvable(hooks.defaultStationId)) {
      delete hooks.defaultStationId;
    } else if (hooks.defaultStationId && !resolvable(hooks.defaultStationId) && !hooks.contentIncomplete) {
      // Any other unresolvable defaultStationId is left in place (it may
      // still be reachable via a dynamic station not yet in
      // DYNAMIC_STATION_IDS, or via a map that hasn't loaded this session —
      // see resolveNpcScheduleTarget's warm-up path) but flagged so the
      // Schedule Editor can surface it for a human to double-check.
      hooks.contentIncomplete = true;
      hooks.contentIncompleteReason = `defaultStationId "${hooks.defaultStationId}" is not authored in any map file — verify it resolves before trusting this NPC's fallback position.`;
      flaggedNpcs++;
    }

    // 2b: NPCs whose defaultPosition is a placeholder {area:'town',c:0,r:0}
    // (spawns/falls back to world origin whenever no rule is active — true
    // whether or not they have *some* narrow rule, e.g. bird_bone's one
    // Anan-only rule leaves the other ~165 hours of the week on this
    // placeholder), or with literally no schedule data at all.
    const noRules = !(hooks.rules && hooks.rules.length);
    const pos = hooks.defaultPosition;
    const isZeroZeroPlaceholder = pos && pos.c === 0 && pos.r === 0;
    const isFullyEmpty = noRules && !hooks.defaultStationId && !pos;
    if (!hooks.contentIncomplete && (isZeroZeroPlaceholder || isFullyEmpty)) {
      hooks.contentIncomplete = true;
      hooks.contentIncompleteReason = isZeroZeroPlaceholder
        ? 'defaultPosition is a placeholder {0,0} — this NPC spawns (or falls back) to world origin whenever no schedule rule is active. Needs a real station.'
        : 'No schedule authored yet — this NPC never spawns (resolveNpcScheduleTarget has nothing to resolve to).';
      flaggedNpcs++;
    }
  }

  // 2d: Temple Service, extracted from docs/game.js's previously-hardcoded
  // TEMPLE_SERVICE_DAY / _START_MIN / _END_MIN / _EXCLUDED_NPC_IDS /
  // TEMPLE_PEW_STATION_IDS constants into authored data.
  if (!Array.isArray(db.sharedSchedules)) {
    db.sharedSchedules = [{
      id: 'shared_temple_service',
      label: 'Temple Service',
      appliesToTag: 'villager',
      day: 'Anan',
      from: '09:00',
      to: '11:00',
      stationIds: Array.from({ length: 11 }, (_, i) => `station_temple_pew_${i + 1}`),
      excludeNpcIds: ['talisman_hatayap', 'bowstring_hatayap', 'hammerhead_tuhupnuk'],
      note: 'Any NPC with appliesToTag who has no schedule rule of their own for this window joins the congregation (least-recently-used pew, see game.js hashNpcIdToIndex).',
    }];
  }

  writeJson(dbPath, db);
  console.log(`NPC database: deduped ${dedupedPositions} redundant rule positions, flagged ${flaggedRules} rules + ${flaggedNpcs} NPCs as content-incomplete, ensured sharedSchedules.`);
}

// ── 3. Dynamic station sources registry ─────────────────────────────────────
function writeDynamicStationSources() {
  const outPath = path.join(ROOT, 'docs/config/npcs/dynamic-station-sources.json');
  const data = {
    schema: 'hobunji_dynamic_station_sources.v1',
    note: "Station ids in this list are NOT authored in any docs/config/maps/*.json npcStations array — they're registered at runtime by procedural code, so they can't be hand-placed in the Map Editor's Station tool. Listed here so tooling (Schedule Editor, Map Editor) can label them instead of reporting them as broken/missing.",
    sources: [
      {
        idPattern: 'station_researchers_tent_desk',
        label: "Garanki's Desk",
        system: "Tothal Shift — Researcher's Tent locale",
        codeRef: 'docs/game.js — tent decor station registration (search "Garanki Gabu\'s desk + 3 specimen statues")',
        description: "Registered from the researcher's tent locale's decor object position wherever the wilderness Tothal Shift stamps the tent this session. Moves with the tent, so it can't live in a static map file.",
      },
      {
        idPattern: 'station_researchers_tent_statue_1',
        label: 'Specimen Statue 1',
        system: "Tothal Shift — Researcher's Tent locale",
        codeRef: 'docs/game.js — tent decor station registration',
        description: 'Same as station_researchers_tent_desk, for the first specimen statue prop.',
      },
      {
        idPattern: 'station_researchers_tent_statue_2',
        label: 'Specimen Statue 2',
        system: "Tothal Shift — Researcher's Tent locale",
        codeRef: 'docs/game.js — tent decor station registration',
        description: 'Same as station_researchers_tent_desk, for the second specimen statue prop.',
      },
      {
        idPattern: 'station_researchers_tent_statue_3',
        label: 'Specimen Statue 3',
        system: "Tothal Shift — Researcher's Tent locale",
        codeRef: 'docs/game.js — tent decor station registration',
        description: 'Same as station_researchers_tent_desk, for the third specimen statue prop.',
      },
    ],
  };
  writeJson(outPath, data);
}

migratePieceDoors();
migrateNpcDatabase();
writeDynamicStationSources();
console.log(DRY_RUN ? '\nDry run complete — no files written.' : '\nMigration complete.');

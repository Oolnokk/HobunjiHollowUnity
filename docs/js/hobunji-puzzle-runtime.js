// Hobunji procedural puzzle runtime: executes backward-built dungeon puzzle graphs in-game.
(() => {
  'use strict';

  // Runtime version is exported for generated-map compatibility checks and debug reports.
  const VERSION = '1.0.0';
  // Schema identifies maps whose generator.puzzles payload can execute in this runtime.
  const SCHEMA = 'hobunji_puzzle_runtime.v1';
  // World tile size mirrors game.js and is used only by the non-console proximity interaction adapter.
  const TILE_SIZE = 55;
  // Interaction radius keeps touch/keyboard operation forgiving without allowing remote activation.
  const INTERACT_RADIUS_TILES = 1.35;
  // Registered puzzle maps are retained by reference so gate collider changes affect the loaded map object when possible.
  const maps = new Map();
  // Alias lookup maps currentArea/map names back to registered puzzle-map ids.
  const aliases = new Map();
  // Per-map runtime states hold latched nodes, completed machines and diagnostic events.
  const states = new Map();
  // Optional active-map override is used by authored integrations and automated tests.
  let activeMapId = null;
  // UI references are kept together so the mobile interaction surface can update without repeated DOM queries.
  const ui = { root:null, button:null, label:null, debug:null, toggle:null };

  const keyOf = (value) => String(value ?? '').trim();
  const tileKey = (c, r) => `${Number(c)},${Number(r)}`;
  const puzzleData = (map) => map?.generator?.puzzles || null;
  const machinesOf = (map) => Array.isArray(puzzleData(map)?.machines) ? puzzleData(map).machines : [];
  const nodeMap = (machine) => new Map((machine?.nodes || []).map(node => [node.id, node]));

  function normalizeRuntimeNode(node) {
    // Activation defaults preserve compatibility with generator V5 while V6 exports explicit modes.
    const source = node?.kind === 'source' || !(node?.inputs || node?.inputSignals || []).length;
    return {
      ...node,
      activationMode: node?.activationMode || (source ? 'interact' : 'automatic'),
      oneShot: node?.oneShot !== false,
      prompt: node?.prompt || (source ? `Operate ${node?.name || node?.label || 'mechanism'}` : ''),
      latencyMs: Math.max(0, Number(node?.latencyMs) || 0)
    };
  }

  function validatePuzzleData(mapOrPuzzles) {
    const puzzles = mapOrPuzzles?.generator ? puzzleData(mapOrPuzzles) : mapOrPuzzles;
    const errors = [];
    if (!puzzles) return { ok:false, errors:['Missing generator.puzzles payload.'] };
    if (puzzles.schema && puzzles.schema !== SCHEMA) errors.push(`Unsupported puzzle schema ${puzzles.schema}.`);
    const machines = Array.isArray(puzzles.machines) ? puzzles.machines : [];
    const machineIds = new Set();
    for (const machine of machines) {
      if (!machine?.id || machineIds.has(machine.id)) { errors.push(`Invalid or duplicate machine id ${machine?.id || '(missing)'}.`); continue; }
      machineIds.add(machine.id);
      const nodes = Array.isArray(machine.nodes) ? machine.nodes.map(normalizeRuntimeNode) : [];
      const ids = new Set();
      for (const node of nodes) {
        if (!node?.id || ids.has(node.id)) errors.push(`${machine.id}: invalid or duplicate node id ${node?.id || '(missing)'}.`);
        ids.add(node?.id);
        if (!Array.isArray(node?.tile) || node.tile.length < 2) errors.push(`${machine.id}/${node?.id}: missing tile.`);
        if (node.activationMode !== 'interact' && node.activationMode !== 'automatic') errors.push(`${machine.id}/${node?.id}: invalid activationMode ${node.activationMode}.`);
      }
      const rootNodeId = machine.rootNodeId || machine.goalNodeId;
      if (!ids.has(rootNodeId)) errors.push(`${machine.id}: missing root node ${rootNodeId}.`);
      const indegree = new Map(nodes.map(node => [node.id, 0]));
      const outgoing = new Map(nodes.map(node => [node.id, []]));
      for (const edge of machine.edges || []) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) { errors.push(`${machine.id}: edge references unknown node ${edge.from}->${edge.to}.`); continue; }
        indegree.set(edge.to, indegree.get(edge.to) + 1);
        outgoing.get(edge.from).push(edge.to);
      }
      const queue = Array.from(indegree, ([id, degree]) => degree === 0 ? id : null).filter(Boolean);
      let visited = 0;
      while (queue.length) {
        const id = queue.shift(); visited++;
        for (const next of outgoing.get(id) || []) if (indegree.set(next, indegree.get(next) - 1).get(next) === 0) queue.push(next);
      }
      if (visited !== nodes.length) errors.push(`${machine.id}: causal graph contains a cycle.`);
    }
    return { ok:errors.length === 0, errors };
  }

  function createState(map) {
    // Machine state is lazily populated so maps with no puzzles have zero runtime overhead.
    const machineStates = new Map();
    for (const machine of machinesOf(map)) machineStates.set(machine.id, { active:new Set(), scheduled:new Set(), complete:false });
    return { mapId:keyOf(map.id || map.name), machineStates, events:[], startedAt:Date.now() };
  }

  function resolveMapId(value) {
    const key = keyOf(value);
    return maps.has(key) ? key : (aliases.get(key) || key);
  }

  function stateFor(mapId) {
    const id = resolveMapId(mapId);
    const map = maps.get(id);
    if (!map) return null;
    if (!states.has(id)) states.set(id, createState(map));
    return states.get(id);
  }

  function emit(mapId, type, detail={}) {
    const state = stateFor(mapId);
    const event = { at:Date.now(), type, ...detail };
    if (state) { state.events.push(event); if (state.events.length > 120) state.events.shift(); }
    try { window.dispatchEvent?.(new CustomEvent('hobunji:puzzle-event', { detail:{ mapId:resolveMapId(mapId), ...event } })); } catch (_) {}
    return event;
  }

  function gateTileFor(machine) {
    const target = machine?.target || {};
    return target.gateTile || target.tile || null;
  }

  function ensureGateCollider(map, machine, locked) {
    // Dynamic collider mutation is best-effort; loaded map consumers that read colliders live immediately honor gate changes.
    const tile = gateTileFor(machine);
    if (!Array.isArray(tile) || tile.length < 2) return;
    if (!Array.isArray(map.colliders)) map.colliders = [];
    const wanted = tileKey(tile[0], tile[1]);
    const index = map.colliders.findIndex(cell => Array.isArray(cell) && tileKey(cell[0], cell[1]) === wanted);
    if (locked && index < 0) map.colliders.push([Number(tile[0]), Number(tile[1])]);
    if (!locked && index >= 0) map.colliders.splice(index, 1);
  }

  function applyGateStates(mapId) {
    const id = resolveMapId(mapId), map = maps.get(id), state = stateFor(id);
    if (!map || !state) return;
    for (const machine of machinesOf(map)) ensureGateCollider(map, machine, !state.machineStates.get(machine.id)?.complete);
  }

  function registerMap(map, options={}) {
    if (!map || typeof map !== 'object' || !puzzleData(map)) return null;
    const validation = validatePuzzleData(map);
    if (!validation.ok) return { ok:false, errors:validation.errors };
    const id = keyOf(map.id || map.name || `puzzle-map-${maps.size+1}`);
    maps.set(id, map);
    aliases.set(id, id);
    for (const alias of [map.name, ...(options.aliases || [])].filter(Boolean)) aliases.set(keyOf(alias), id);
    if (!states.has(id)) states.set(id, createState(map));
    applyGateStates(id);
    emit(id, 'map-registered', { machineCount:machinesOf(map).length });
    return { ok:true, mapId:id, machineCount:machinesOf(map).length };
  }

  function machineById(map, machineId) { return machinesOf(map).find(machine => machine.id === machineId) || null; }
  function incomingEdges(machine, nodeId) { return (machine.edges || []).filter(edge => edge.to === nodeId); }
  function outgoingEdges(machine, nodeId) { return (machine.edges || []).filter(edge => edge.from === nodeId); }

  function nodeReady(machine, machineState, node) {
    const incoming = incomingEdges(machine, node.id);
    return incoming.length > 0 && incoming.every(edge => machineState.active.has(edge.from));
  }

  function finishMachineIfReady(mapId, machine, machineState) {
    const rootNodeId = machine.rootNodeId || machine.goalNodeId;
    if (machineState.complete || !machineState.active.has(rootNodeId)) return false;
    machineState.complete = true;
    const map = maps.get(resolveMapId(mapId));
    ensureGateCollider(map, machine, false);
    emit(mapId, 'machine-complete', { machineId:machine.id, goalLabel:machine.goalLabel, target:machine.target });
    return true;
  }

  function fireAutomaticDownstream(mapId, machine, machineState, fromNodeId) {
    for (const edge of outgoingEdges(machine, fromNodeId)) {
      const next = nodeMap(machine).get(edge.to);
      if (!next || machineState.active.has(next.id) || machineState.scheduled.has(next.id)) continue;
      const runtimeNode = normalizeRuntimeNode(next);
      if (runtimeNode.activationMode !== 'automatic' || !nodeReady(machine, machineState, runtimeNode)) continue;
      machineState.scheduled.add(runtimeNode.id);
      const activate = () => {
        machineState.scheduled.delete(runtimeNode.id);
        activateNode(mapId, machine.id, runtimeNode.id, 'automatic');
      };
      if (runtimeNode.latencyMs > 0 && typeof setTimeout === 'function') setTimeout(activate, runtimeNode.latencyMs);
      else activate();
    }
  }

  function activateNode(mapId, machineId, nodeId, reason='interact') {
    const id = resolveMapId(mapId), map = maps.get(id), state = stateFor(id);
    if (!map || !state) return { ok:false, reason:'map-not-registered' };
    const machine = machineById(map, machineId), machineState = state.machineStates.get(machineId);
    if (!machine || !machineState) return { ok:false, reason:'machine-not-found' };
    const rawNode = nodeMap(machine).get(nodeId);
    if (!rawNode) return { ok:false, reason:'node-not-found' };
    const node = normalizeRuntimeNode(rawNode);
    if (machineState.active.has(nodeId)) return { ok:true, alreadyActive:true, complete:machineState.complete };
    if (reason !== 'automatic' && node.activationMode !== 'interact') return { ok:false, reason:'not-player-operable' };
    if (reason === 'automatic' && node.activationMode !== 'automatic') return { ok:false, reason:'requires-player-interaction' };
    if (node.activationMode === 'automatic' && !nodeReady(machine, machineState, node)) return { ok:false, reason:'inputs-not-ready' };
    machineState.active.add(nodeId);
    emit(id, 'node-activated', { machineId, nodeId, atomId:node.atomId, name:node.name || node.label, output:node.output || node.outputSignal, reason });
    finishMachineIfReady(id, machine, machineState);
    fireAutomaticDownstream(id, machine, machineState, nodeId);
    return { ok:true, complete:machineState.complete, node };
  }

  function availableSources(mapId) {
    const id = resolveMapId(mapId), map = maps.get(id), state = stateFor(id);
    if (!map || !state) return [];
    const out = [];
    for (const machine of machinesOf(map)) {
      const machineState = state.machineStates.get(machine.id);
      if (!machineState || machineState.complete) continue;
      for (const rawNode of machine.nodes || []) {
        const node = normalizeRuntimeNode(rawNode);
        if (node.activationMode === 'interact' && !machineState.active.has(node.id)) out.push({ mapId:id, machineId:machine.id, node });
      }
    }
    return out;
  }

  function nearestAvailableSource(mapId, player, radiusTiles=INTERACT_RADIUS_TILES) {
    if (!player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return null;
    const px = Number(player.x) / TILE_SIZE, pr = Number(player.y) / TILE_SIZE;
    let best = null;
    for (const candidate of availableSources(mapId)) {
      const tile = candidate.node.tile || [], dx = (Number(tile[0]) + .5) - px, dr = (Number(tile[1]) + .5) - pr;
      const distance = Math.hypot(dx, dr);
      if (distance <= radiusTiles && (!best || distance < best.distance)) best = { ...candidate, distance };
    }
    return best;
  }

  function isMachineComplete(mapId, machineId) { return !!stateFor(mapId)?.machineStates.get(machineId)?.complete; }
  function isGateLocked(mapId, machineId) { return !isMachineComplete(mapId, machineId); }
  function isTileBlocked(mapId, c, r) {
    const id = resolveMapId(mapId), map = maps.get(id);
    if (!map) return false;
    const wanted = tileKey(c, r);
    return machinesOf(map).some(machine => isGateLocked(id, machine.id) && Array.isArray(gateTileFor(machine)) && tileKey(...gateTileFor(machine)) === wanted);
  }

  function exportState(mapId) {
    const id = resolveMapId(mapId), state = stateFor(id);
    if (!state) return null;
    return { schema:SCHEMA, runtimeVersion:VERSION, mapId:id, machines:Array.from(state.machineStates, ([machineId, value]) => ({ machineId, active:Array.from(value.active), complete:value.complete })) };
  }

  function importState(mapId, snapshot) {
    const id = resolveMapId(mapId), state = stateFor(id), map = maps.get(id);
    if (!state || !map || !snapshot) return false;
    for (const saved of snapshot.machines || []) {
      const machine = machineById(map, saved.machineId), target = state.machineStates.get(saved.machineId);
      if (!machine || !target) continue;
      const validIds = new Set((machine.nodes || []).map(node => node.id));
      target.active = new Set((saved.active || []).filter(nodeId => validIds.has(nodeId)));
      target.complete = target.active.has(machine.rootNodeId || machine.goalNodeId) || !!saved.complete;
      target.scheduled.clear();
    }
    applyGateStates(id);
    emit(id, 'state-imported');
    return true;
  }

  function reset(mapId) {
    const id = resolveMapId(mapId), map = maps.get(id);
    if (!map) return false;
    states.set(id, createState(map));
    applyGateStates(id);
    emit(id, 'reset');
    return true;
  }

  function setActiveMap(mapId) { activeMapId = resolveMapId(mapId); return maps.has(activeMapId); }
  function currentMapId() {
    if (activeMapId && maps.has(activeMapId)) return activeMapId;
    const area = window.__hobunjiFurnitureDebug?.currentArea;
    return area ? resolveMapId(area) : null;
  }

  function installFetchRegistration() {
    if (typeof window.fetch !== 'function' || window.fetch.__hobunjiPuzzleWrapped) return;
    const originalFetch = window.fetch.bind(window);
    const wrapped = async (...args) => {
      const response = await originalFetch(...args);
      if (!response || typeof response.json !== 'function') return response;
      const originalJson = response.json.bind(response);
      response.json = async () => {
        const value = await originalJson();
        if (value?.generator?.puzzles) registerMap(value);
        return value;
      };
      return response;
    };
    wrapped.__hobunjiPuzzleWrapped = true;
    wrapped.__hobunjiPuzzleOriginal = originalFetch;
    window.fetch = wrapped;
  }

  function installUi() {
    if (typeof document === 'undefined' || ui.root) return;
    const root = document.createElement('div');
    root.id = 'hobunjiPuzzleRuntimeUi';
    root.style.cssText = 'position:fixed;right:max(10px,env(safe-area-inset-right));bottom:max(86px,calc(env(safe-area-inset-bottom) + 70px));z-index:100050;display:none;max-width:min(320px,84vw);font:13px/1.25 system-ui,sans-serif;color:#fff;pointer-events:auto;';
    const label = document.createElement('div');
    label.style.cssText = 'background:#111d;border:1px solid #ffffff44;border-radius:8px 8px 0 0;padding:7px 9px;';
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Operate';
    button.style.cssText = 'width:100%;min-height:44px;border:1px solid #ffffff55;border-top:0;border-radius:0 0 8px 8px;background:#5a4c35;color:#fff;font:700 14px system-ui,sans-serif;touch-action:manipulation;';
    const toggle = document.createElement('button');
    toggle.type='button'; toggle.textContent='Puzzle debug';
    toggle.style.cssText='margin-top:5px;width:100%;min-height:30px;border:1px solid #ffffff33;border-radius:6px;background:#111c;color:#ddd;font:11px system-ui,sans-serif;';
    const debug = document.createElement('pre');
    debug.style.cssText='display:none;margin:5px 0 0;max-height:32vh;overflow:auto;white-space:pre-wrap;background:#080d;border:1px solid #ffffff33;border-radius:6px;padding:7px;font:10px/1.3 ui-monospace,monospace;';
    root.append(label, button, toggle, debug); document.body.appendChild(root);
    ui.root=root; ui.button=button; ui.label=label; ui.debug=debug; ui.toggle=toggle;
    let nearby = null;
    button.addEventListener('click', () => { if (nearby) activateNode(nearby.mapId, nearby.machineId, nearby.node.id, 'interact'); });
    toggle.addEventListener('click', () => { debug.style.display = debug.style.display === 'none' ? 'block' : 'none'; });
    const refresh = () => {
      const mapId = currentMapId(), player = window.__hobunjiFurnitureDebug?.playerState;
      nearby = mapId ? nearestAvailableSource(mapId, player) : null;
      root.style.display = nearby ? 'block' : 'none';
      if (nearby) label.textContent = nearby.node.prompt || `Operate ${nearby.node.name || nearby.node.label}`;
      if (mapId && debug.style.display !== 'none') {
        const state = stateFor(mapId), map = maps.get(resolveMapId(mapId));
        debug.textContent = [`Map: ${resolveMapId(mapId)}`, ...machinesOf(map).map(machine => {
          const ms = state?.machineStates.get(machine.id); return `${ms?.complete?'✓':'○'} ${machine.target?.label || machine.goalLabel || machine.id}  ${ms?.active.size || 0}/${machine.nodes?.length || 0}`;
        }), '', ...(state?.events || []).slice(-8).map(event => `${new Date(event.at).toLocaleTimeString()} ${event.type} ${event.name || event.machineId || ''}`)].join('\n');
      }
    };
    setInterval(refresh, 160);
  }

  function install() { installFetchRegistration(); installUi(); }

  window.HobunjiPuzzleRuntime = Object.freeze({
    VERSION, SCHEMA, TILE_SIZE,
    validatePuzzleData, registerMap, setActiveMap, activateNode, availableSources, nearestAvailableSource,
    isMachineComplete, isGateLocked, isTileBlocked, applyGateStates, exportState, importState, reset,
    currentMapId, install
  });
  install();
})();

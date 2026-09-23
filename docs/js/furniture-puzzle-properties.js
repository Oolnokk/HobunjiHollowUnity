// Shared furniture puzzle metadata used by gameplay and all authoring tools.
// Keeping normalization here prevents each editor from inventing a subtly
// different activator/mechanism format.
(() => {
  'use strict';

  const ROLES = Object.freeze(['none', 'activator', 'mechanism']);
  const ACTIVATORS = Object.freeze(['interact', 'projectile', 'pressurePlate', 'torch', 'brazier', 'glyphObelisk', 'stackedObelisk', 'linkedCubePillars']);
  const MECHANISMS = Object.freeze(['toggle', 'stoneDoor', 'bridge', 'bridgeSequence', 'movingDais', 'collapsingStairs', 'pushPuzzleBlock', 'elevatorPushBlock', 'pressurePlate', 'torch', 'brazier', 'signalObelisk', 'rotatingObelisk', 'linkedCubePair']);

  function text(value, fallback = '') { return String(value ?? fallback).trim(); }
  function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function vector(raw, fallback) {
    return { x:number(raw?.x, fallback.x), y:number(raw?.y, fallback.y), z:number(raw?.z, fallback.z) };
  }
  function color(value, fallback = '#000000') { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback; }
  function transitionState(raw, fallback = {}) {
    return {
      position:vector(raw?.position, fallback.position || { x:0, y:0, z:0 }),
      rotation:vector(raw?.rotation, fallback.rotation || { x:0, y:0, z:0 }),
      scale:vector(raw?.scale, fallback.scale || { x:1, y:1, z:1 }),
      emission:{
        color:color(raw?.emission?.color, fallback.emission?.color || '#000000'),
        intensity:Math.max(0, number(raw?.emission?.intensity, fallback.emission?.intensity || 0)),
        particleRateScale:Math.max(0, number(raw?.emission?.particleRateScale, fallback.emission?.particleRateScale || 0)),
        opacity:Math.max(0, Math.min(1, number(raw?.emission?.opacity, fallback.emission?.opacity ?? 1))),
      },
    };
  }
  function partTransform(raw, fallback = {}) {
    return {
      x:number(raw?.x, fallback.x || 0), y:number(raw?.y, fallback.y || 0), z:number(raw?.z, fallback.z || 0),
      rx:number(raw?.rx, fallback.rx || 0), ry:number(raw?.ry, fallback.ry || 0), rz:number(raw?.rz, fallback.rz || 0),
      sx:Math.max(.001, number(raw?.sx, fallback.sx ?? 1)), sy:Math.max(.001, number(raw?.sy, fallback.sy ?? 1)), sz:Math.max(.001, number(raw?.sz, fallback.sz ?? 1)),
    };
  }
  function partTransitions(rawParts) {
    const result = {}; // Authored part ID -> absolute OFF/ON local transforms consumed by the editor and runtime.
    for (const [partId, raw] of Object.entries(rawParts && typeof rawParts === 'object' ? rawParts : {})) {
      const id = text(partId); if (!id || !raw || typeof raw !== 'object') continue;
      const off = partTransform(raw.off);
      result[id] = { off, on:partTransform(raw.on, off) };
    }
    return result;
  }
  function transition(rawMotion) {
    const motion = rawMotion && typeof rawMotion === 'object' ? rawMotion : {};
    const axis = ['x', 'y', 'z'].includes(motion.axis) ? motion.axis : 'y';
    const signedDistance = number(motion.distance, 1) * (motion.invert ? -1 : 1);
    const legacyOn = { position:{ x:0, y:0, z:0 }, rotation:{ x:0, y:0, z:0 }, scale:{ x:1, y:1, z:1 }, emission:{ color:'#000000', intensity:0, particleRateScale:1, opacity:1 } };
    legacyOn.position[axis] = signedDistance;
    const off = transitionState(motion.off, { emission:{ color:'#000000', intensity:0, particleRateScale:0, opacity:1 } });
    const on = transitionState(motion.on, legacyOn);
    return {
      off, on, parts:partTransitions(motion.parts),
      durationSeconds:Math.max(.05, number(motion.durationSeconds, .8)),
      collisionOpenProgress:Math.max(0, Math.min(1, number(motion.collisionOpenProgress, .55))),
    };
  }
  function normalizePuzzle(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const role = ROLES.includes(raw.role) ? raw.role : 'none';
    if (role === 'none') return null;
    const allowed = role === 'activator' ? ACTIVATORS : MECHANISMS;
    const behavior = allowed.includes(raw.behavior) ? raw.behavior : allowed[0];
    return {
      version: 3,
      role,
      behavior,
      channel: text(raw.channel, 'A') || 'A',
      startsActive: !!raw.startsActive,
      blocksMovement: role === 'mechanism' && raw.blocksMovement !== false,
      interactionRange: Math.max(.25, number(raw.interactionRange, 1.65)),
      activationSeconds: Math.max(0, number(raw.activationSeconds, 0)),
      resetSeconds: Math.max(0, number(raw.resetSeconds, 0)),
      prompt: text(raw.prompt),
      offPrompt: text(raw.offPrompt, 'Turn off'),
      onPrompt: text(raw.onPrompt, 'Turn on'),
      directInteraction: role === 'mechanism' && !!raw.directInteraction,
      motion: transition(raw.motion),
    };
  }

  function normalizeWire(raw, index = 0) {
    const fromId = text(raw?.fromId);
    const toId = text(raw?.toId);
    if (!fromId || !toId || fromId === toId) return null;
    return {
      id: text(raw.id, `wire_${index + 1}`),
      fromId,
      toId,
      invert: !!raw.invert,
      delaySeconds: Math.max(0, number(raw.delaySeconds, 0)),
    };
  }

  function normalizeWiring(raw) {
    const records = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    return records.map(normalizeWire).filter(wire => {
      if (!wire) return false;
      const key = `${wire.fromId}>${wire.toId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function validateWiring(nodes, rawWiring) {
    const byId = new Map((nodes || []).filter(Boolean).map(node => [String(node.id || ''), node]));
    const errors = [];
    const wiring = normalizeWiring(rawWiring);
    for (const wire of wiring) {
      const from = byId.get(wire.fromId), to = byId.get(wire.toId);
      if (!from) errors.push(`${wire.id}: missing activator ${wire.fromId}`);
      else if (normalizePuzzle(from.puzzle)?.role !== 'activator') errors.push(`${wire.id}: ${wire.fromId} is not an activator`);
      if (!to) errors.push(`${wire.id}: missing mechanism ${wire.toId}`);
      else if (normalizePuzzle(to.puzzle)?.role !== 'mechanism') errors.push(`${wire.id}: ${wire.toId} is not a mechanism`);
    }
    return { wiring, errors, valid: errors.length === 0 };
  }

  function applyToObject3D(object, rawPuzzle, furnitureKey = '') {
    const puzzle = normalizePuzzle(rawPuzzle);
    if (!object || !puzzle) return null;
    object.userData ||= {};
    object.userData.furnitureKey = furnitureKey || object.userData.furnitureKey || '';
    object.userData.furniturePuzzle = puzzle;
    object.userData.puzzleRole = puzzle.role;
    if (puzzle.role === 'activator') object.userData.activatorType = puzzle.behavior;
    else object.userData.previewMotion = { ...(object.userData.previewMotion || {}), type: puzzle.behavior };
    return puzzle;
  }

  window.FurniturePuzzleProperties = Object.freeze({
    schema: 'hobunji_furniture_puzzle.v3', ROLES, ACTIVATORS, MECHANISMS,
    normalizePuzzle, normalizeWiring, validateWiring, applyToObject3D, transitionState, partTransform,
  });
})();

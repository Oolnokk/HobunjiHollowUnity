// Shared 2D line-gizmo geometry for the modular weapon mounting editor.
(function (global) {
  'use strict';

  const FRAME = Object.freeze({ width: 450, height: 1204 }); // Weapon PNG coordinate space shared by gameplay and editor.
  function midpoint(line) {
    return { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 }; // Rotation pivot and move handle.
  }
  function length(line) {
    return Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y); // Single Euclidean distance from arrow origin to tip.
  }
  function maxLength(line) {
    const d = length(line);
    if (d < 1) return 0; // A degenerate authored arrow has no direction in which to extend.
    const ux = (line.end.x - line.start.x) / d, uy = (line.end.y - line.start.y) / d;
    const xLimit = ux > 0 ? (FRAME.width - line.start.x) / ux
      : ux < 0 ? -line.start.x / ux : Infinity;
    const yLimit = uy > 0 ? (FRAME.height - line.start.y) / uy
      : uy < 0 ? -line.start.y / uy : Infinity;
    return Math.max(0, Math.min(xLimit, yLimit)); // Endpoint stays within its canvas, without moving the origin.
  }
  function setLength(line, desired) {
    if (!Number.isFinite(desired) || desired < 2) return line; // Reject invalid lengths, preserving a valid source line.
    const original = length(line);
    if (original < 1) return line;
    const actual = Math.min(desired, maxLength(line)); // Clamp only the tip to the sprite boundary.
    if (actual < 2) return line;
    const ratio = actual / original;
    return { ...line, start: { ...line.start },
      end: { x: line.start.x + (line.end.x - line.start.x) * ratio,
        y: line.start.y + (line.end.y - line.start.y) * ratio } }; // Direction and origin remain unchanged.
  }
  function rotationHandle(line) {
    const mid = midpoint(line), dx = line.end.x - line.start.x, dy = line.end.y - line.start.y; // Directed arrow axis.
    const length = Math.hypot(dx, dy) || 1; // Zero-length lines are rejected by config validation; avoid invalid preview coordinates.
    const distance = 110; // Distinct rotation handle, separate from move handle even on narrow mobile canvases.
    const first = { x: mid.x - dy / length * distance, y: mid.y + dx / length * distance }; // Left perpendicular direction.
    const second = { x: mid.x + dy / length * distance, y: mid.y - dx / length * distance }; // Fallback if near the image edge.
    const visible = point => point.x >= 10 && point.x <= FRAME.width - 10 && point.y >= 10 && point.y <= FRAME.height - 10;
    if (visible(first)) return first;
    if (visible(second)) return second;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v)); // Keep handle accessible near edge/corners.
    return { x: clamp(first.x, 10, FRAME.width - 10), y: clamp(first.y, 10, FRAME.height - 10) };
  }
  function move(line, dx, dy) {
    const x0 = Math.min(line.start.x, line.end.x), x1 = Math.max(line.start.x, line.end.x); // Entire line bounds.
    const y0 = Math.min(line.start.y, line.end.y), y1 = Math.max(line.start.y, line.end.y);
    const tx = Math.max(-x0, Math.min(FRAME.width - x1, dx)); // Common shift keeps endpoints and their spacing intact.
    const ty = Math.max(-y0, Math.min(FRAME.height - y1, dy));
    return { ...line, start: { x: line.start.x + tx, y: line.start.y + ty },
      end: { x: line.end.x + tx, y: line.end.y + ty } };
  }
  function rotate(line, angle) {
    if (!Number.isFinite(angle)) return line; // Avoid corrupting edited mount lines from malformed pointer geometry.
    const mid = midpoint(line), dx = (line.end.x - line.start.x) / 2, dy = (line.end.y - line.start.y) / 2; // Half-line vector.
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const rx = cos * dx - sin * dy, ry = sin * dx + cos * dy; // Rotate relative to the midpoint, not an endpoint.
    if (2 * Math.abs(rx) > FRAME.width || 2 * Math.abs(ry) > FRAME.height) return line; // Never shorten a line to squeeze it into the sprite.
    const tx = Math.max(Math.abs(rx), Math.min(FRAME.width - Math.abs(rx), mid.x)); // Move center only if needed for canvas bounds.
    const ty = Math.max(Math.abs(ry), Math.min(FRAME.height - Math.abs(ry), mid.y));
    return { ...line, start: { x: tx - rx, y: ty - ry }, end: { x: tx + rx, y: ty + ry } };
  }
  function rotationDelta(line, start, now) {
    const mid = midpoint(line); // Drag rotates by the change in pointer angle around the original line midpoint.
    if (Math.hypot(start.x - mid.x, start.y - mid.y) < 0.001) return 0;
    return Math.atan2(now.y - mid.y, now.x - mid.x) - Math.atan2(start.y - mid.y, start.x - mid.x);
  }
  global.ModularMountGizmos = Object.freeze({ midpoint, length, maxLength, setLength, rotationHandle, move, rotate, rotationDelta, frame: FRAME });
})(typeof window === 'object' ? window : globalThis);

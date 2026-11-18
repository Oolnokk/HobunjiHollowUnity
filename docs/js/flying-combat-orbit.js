// Bounded, terrain-agnostic orbital evasion waypoints for airborne combatants.
// Each flight owner retains collision checks, altitude, attack timers and its own update clock.
(() => {
  'use strict';
  if (window.FlyingCombatOrbit) return;
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function waypoint(actor, foe, options = {}) {
    const x = finite(actor?.x), y = finite(actor?.y); // Current airborne position, used only while planning the next flight leg.
    const tx = finite(foe?.x), ty = finite(foe?.y); // Live enemy position, so repeated arcs follow a moving opponent.
    if (x === null || y === null || tx === null || ty === null) return null;
    const unit = Math.max(.001, finite(options.unit) || 1); // Converts the owner's existing world pixels/tiles into an orbital radius.
    const minimum = Math.max(0.5, finite(options.minRadius) ?? 2.8) * unit; // Keeps the bird clear of melee range.
    const maximum = Math.max(minimum, (finite(options.maxRadius) ?? 5) * unit); // Caps circling instead of fleeing the encounter.
    const dx = x - tx, dy = y - ty, length = Math.hypot(dx, dy);
    const radius = clamp(length, minimum, maximum); // Holds an existing comfortable orbit, correcting only extreme ranges.
    const angle = length > .0001 ? Math.atan2(dy, dx) : 0;
    const direction = options.direction === -1 ? -1 : 1; // The flight owner chooses one stable clockwise/counterclockwise side.
    const step = clamp(finite(options.stepRad) ?? Math.PI / 4, .15, Math.PI / 2); // Short chords approximate a circle without teleporting.
    return { x: tx + Math.cos(angle + direction * step) * radius,
      y: ty + Math.sin(angle + direction * step) * radius, radius };
  }
  function tangent(actor, foe, options = {}) {
    const x = finite(actor?.x), y = finite(actor?.y); // Current moving entity; calculated only while an evasive move is active.
    const tx = finite(foe?.x), ty = finite(foe?.y); // Live foe keeps reactive dodges curved around its position.
    if (x === null || y === null || tx === null || ty === null) return null;
    const dx = x - tx, dy = y - ty, distance = Math.hypot(dx, dy);
    if (distance < .0001) return null;
    const ux = dx / distance, uy = dy / distance, side = options.direction === -1 ? -1 : 1;
    const desired = Math.max(.001, finite(options.radius) ?? distance); // Initial attack separation is the dodge's safe orbital radius.
    const correction = clamp((distance - desired) / desired, -.3, .3); // Small inward/outward trim avoids spiralling into or away from the target.
    const vx = -uy * side - ux * correction, vy = ux * side - uy * correction;
    const length = Math.hypot(vx, vy);
    return { x: vx / length, y: vy / length };
  }
  window.FlyingCombatOrbit = Object.freeze({ waypoint, tangent });
})();

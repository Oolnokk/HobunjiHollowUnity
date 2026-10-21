// Seeded, map-size-independent archipelago landform generator. Exposes the
// same integer altitude tiers and water/land mask the wilderness map uses.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WildernessArchipelago = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    archipelagoEnabled: false,
    islandCount: 11,
    islandSize: 11.5, // Approximate middle island radius in source tiles.
    islandSizeVariation: 0.52,
    islandHeight: 6, // Maximum tier above the continuous sea surface.
    islandSteepness: 1.1, // Faster inland rise at larger values.
    islandIrregularity: 0.72, // Broad lobes, bays, and capes.
    islandCoastDetail: 0.65, // Fine coastline fractal modulation.
    islandSpacing: 1.05, // Sea-channel separation between primary islands.
    islandClustering: 0.65, // How strongly island centers follow an arcing chain.
    islandSatellites: 15, // Smaller offshore skerries.
  });

  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  function settingsWithDefaults(value = {}) {
    const n = (key, min, max, integer = false) => {
      const raw = Number(value[key]);
      const v = Number.isFinite(raw) ? clamp(raw, min, max) : DEFAULTS[key];
      return integer ? Math.round(v) : v;
    };
    return {
      archipelagoEnabled: value.archipelagoEnabled === true,
      islandCount: n('islandCount', 2, 32, true),
      islandSize: n('islandSize', 2, 30),
      islandSizeVariation: n('islandSizeVariation', 0, 1),
      islandHeight: n('islandHeight', 1, 20, true),
      islandSteepness: n('islandSteepness', 0.3, 3),
      islandIrregularity: n('islandIrregularity', 0, 1),
      islandCoastDetail: n('islandCoastDetail', 0, 1),
      islandSpacing: n('islandSpacing', 0.35, 2.5),
      islandClustering: n('islandClustering', 0, 1),
      islandSatellites: n('islandSatellites', 0, 50, true),
    };
  }

  function hashSeed(text) {
    let h = 2166136261;
    for (const ch of String(text)) { h = Math.imul(h ^ ch.charCodeAt(0), 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    let state = hashSeed(seed);
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash01(x, y, salt) {
    let h = (Math.imul(x + 374761393, 668265263)
      ^ Math.imul(y + 2246822519, 3266489917) ^ Math.imul(salt + 11, 1274126177)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function smoothNoise(x, y, salt) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const tx = x - ix, ty = y - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const top = hash01(ix, iy, salt) * (1 - sx) + hash01(ix + 1, iy, salt) * sx;
    const bottom = hash01(ix, iy + 1, salt) * (1 - sx) + hash01(ix + 1, iy + 1, salt) * sx;
    return top * (1 - sy) + bottom * sy;
  }

  function islandShape(cx, cy, radius, aspect, angle, seed, kind) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return {
      cx, cy, radius, rx: radius * aspect, ry: radius / aspect, c, s,
      seed, kind,
      a: seed * 0.013, b: seed * 0.027, d: seed * 0.037,
    };
  }

  function generate(widthRaw, heightRaw, seed, overrides = {}) {
    const width = Math.max(16, Math.round(widthRaw)), height = Math.max(16, Math.round(heightRaw));
    const config = settingsWithDefaults({ ...DEFAULTS, ...overrides, archipelagoEnabled:true });
    const rng = makeRng('archipelago:' + seed);
    const random = (lo, hi) => lo + (hi - lo) * rng();
    const minDim = Math.min(width, height);
    const scaledRadius = config.islandSize * Math.min(1, minDim / 90);
    // Tiny island mode retains the requested *small* radius, including at
    // the entrance, and enforces geographic channels between major islands.
    // Previously the entrance always had radius >=6 and every major island
    // >=3.2, so a 2- or 3-tile size slider could never actually make one.
    const compactIslands = scaledRadius <= 6.5;
    const islands = [];
    const mainY = height * (0.48 + random(-0.04, 0.04));
    const mainRadius = compactIslands
      ? Math.max(2.35, scaledRadius * 1.03)
      : Math.max(6, scaledRadius * 1.35);
    // A broad natural west-coast island provides the town-facing entrance,
    // while the other map sides dissolve into open sea.
    islands.push(islandShape(
      Math.max(3, mainRadius * 0.46), mainY, mainRadius, 1.12, random(-0.5, 0.5),
      Math.floor(rng() * 1000000), 'gateway'
    ));

    const majorCount = config.islandCount;
    const coastlineMargin = Math.max(3, minDim * 0.04);
    const shapeRadius = (i) => {
      const scale = 1 + (random(-1, 1) * config.islandSizeVariation * 0.58);
      return Math.max(1.9, scaledRadius * scale);
    };
    for (let i = 1; i < majorCount; i++) {
      let best = null;
      const t = i / Math.max(1, majorCount - 1);
      const r = shapeRadius(i);
      const aspect = random(0.95, 1.55);
      for (let attempt = 0; attempt < (compactIslands ? 144 : 48); attempt++) {
        const spineX = width * (0.15 + 0.72 * t);
        const spineY = height * (0.47 + 0.19 * Math.sin(2.45 * Math.PI * t + 0.34));
        const drift = 1 - config.islandClustering;
        const x = clamp(
          spineX + random(-1, 1) * (r * 1.75 + drift * width * 0.27),
          coastlineMargin + r * 0.45, width - coastlineMargin - r * 0.45
        );
        const y = clamp(
          spineY + random(-1, 1) * (r * 2 + drift * height * 0.34),
          coastlineMargin + r * 0.55, height - coastlineMargin - r * 0.55
        );
        let nearest = Infinity;
        for (const other of islands) {
          const distance = Math.hypot(x - other.cx, y - other.cy);
          const minRequired = compactIslands
            // Conservative radius accounts for long aspect axes AND lobes.
            // This produces separate islands and visible sea channels rather
            // than 15 overlapping centers masquerading as 5 landmasses.
            ? (r * Math.max(aspect, 1 / aspect)
              + Math.max(other.rx, other.ry))
              * (1 + 0.13 * config.islandIrregularity + 0.07 * config.islandCoastDetail)
              + config.islandSpacing * 1.45
            : (r + Math.min(other.rx, other.ry)) *
              (0.66 + config.islandSpacing * 0.29);
          nearest = Math.min(nearest, distance - minRequired);
        }
        const candidate = { x, y, r, aspect, score: nearest - attempt * 0.0001 };
        if (!best || candidate.score > best.score) best = candidate;
        if (nearest > (compactIslands ? 0 : config.islandSpacing * 0.8)) break;
      }
      islands.push(islandShape(best.x, best.y, r, aspect,
        random(-1.35, 1.35), Math.floor(rng() * 1000000), 'major'));
    }

    for (let i = 0; i < config.islandSatellites; i++) {
      const parent = islands[Math.floor(rng() * majorCount)];
      const r = Math.max(1.65, scaledRadius * random(0.18, 0.36));
      const bearing = random(-Math.PI, Math.PI);
      const reach = Math.max(parent.rx, parent.ry) * random(0.9, 1.38)
        + r * (0.6 + 0.25 * config.islandSpacing);
      const x = parent.cx + Math.cos(bearing) * reach;
      const y = parent.cy + Math.sin(bearing) * reach;
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
      islands.push(islandShape(x, y, r, random(0.84, 1.45),
        bearing + random(-0.7, 0.7), Math.floor(rng() * 1000000), 'skerry'));
    }

    const size = width * height;
    const land = new Uint8Array(size);
    const islandIndex = new Int16Array(size);
    islandIndex.fill(-1);
    const signedCoast = new Float32Array(size);
    signedCoast.fill(-9999);
    // Anisotropic lobes plus two spatially continuous octaves: no rows of
    // circular blobs or individual random-pixel dents at the shore.
    for (let id = 0; id < islands.length; id++) {
      const island = islands[id];
      const bounds = Math.max(island.rx, island.ry) * 1.65;
      const loX = Math.max(0, Math.floor(island.cx - bounds));
      const hiX = Math.min(width - 1, Math.ceil(island.cx + bounds));
      const loY = Math.max(0, Math.floor(island.cy - bounds));
      const hiY = Math.min(height - 1, Math.ceil(island.cy + bounds));
      for (let y = loY; y <= hiY; y++) {
        for (let x = loX; x <= hiX; x++) {
          const dx = x - island.cx, dy = y - island.cy;
          const u = dx * island.c + dy * island.s;
          const v = -dx * island.s + dy * island.c;
          const angle = Math.atan2(v / island.ry, u / island.rx);
          const radial = Math.hypot(u / island.rx, v / island.ry);
          if (radial > 1.55) continue;
          const broad = Math.sin(angle * 2 + island.a) * 0.20
            + Math.sin(angle * 3 + island.b) * 0.135
            + Math.sin(angle * 5 + island.d) * 0.095;
          const geographic = (smoothNoise(x / 8, y / 8, island.seed + 11) - 0.5) * 0.45
            + (smoothNoise(x / 3.4, y / 3.4, island.seed + 71) - 0.5) * 0.18;
          const boundary = 1 + broad * config.islandIrregularity
            + geographic * config.islandCoastDetail * (0.3 + 0.7 * config.islandIrregularity);
          const coast = (boundary - radial) * Math.min(island.rx, island.ry);
          const index = y * width + x;
          if (coast > 0 && coast > signedCoast[index]) {
            land[index] = 1;
            islandIndex[index] = id;
            signedCoast[index] = coast;
          }
        }
      }
    }

    // Ensure the world entrance is a natural piece of the western shore, not a
    // gate that teleports through deep water. The main island already reaches
    // the west map edge; small entrance-adjacent straits can be rejoined.
    const gateY = Math.round(mainY);
    const gatewayHalfWidth = compactIslands ? 1 : 3;
    const gatewayReach = compactIslands ? 4 : 7;
    for (let y = gateY - gatewayHalfWidth; y <= gateY + gatewayHalfWidth; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = 0; x < Math.min(width, gatewayReach); x++) {
        const dy = Math.abs(y - gateY);
        if (!compactIslands && dy > 2 + Math.max(0, 3 - x) * 0.2) continue;
        const index = y * width + x;
        land[index] = 1;
        islandIndex[index] = 0;
      }
    }

    // Multi-source shoreline distance transform. Every shore is low beach or
    // marsh, while the elevation/steepness controls determine the raised
    // interior. This works for concave coves and merged island lobes too.
    const shoreDistance = new Int16Array(size);
    shoreDistance.fill(-1);
    const queue = new Int32Array(size);
    let head = 0, tail = 0, shoreTiles = 0, landTiles = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (!land[index]) continue;
        landTiles++;
        const coast = x === 0 || y === 0 || x === width - 1 || y === height - 1
          || !land[index - 1] || !land[index + 1]
          || !land[index - width] || !land[index + width];
        if (!coast) continue;
        shoreDistance[index] = 0;
        queue[tail++] = index;
        shoreTiles++;
      }
    }
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = (index - x) / width;
      const step = shoreDistance[index] + 1;
      for (const other of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (other < 0 || !land[other] || shoreDistance[other] >= 0) continue;
        shoreDistance[other] = step;
        queue[tail++] = other;
      }
    }

    // Normalize elevation against each island's own deepest inland point.
    // A 3-tile island now really can be three tiers high, rather than
    // silently flattening because it does not have a 9-tile inland radius.
    // Higher steepness produces a quicker rise from beach to hilltop.
    const peakInlandByIsland = new Int16Array(islands.length);
    for (let index = 0; index < size; index++) {
      const id = islandIndex[index];
      if (id >= 0) peakInlandByIsland[id] = Math.max(peakInlandByIsland[id], shoreDistance[index]);
    }
    const elevation = new Uint8Array(size);
    const peakByIsland = new Uint8Array(islands.length);
    const ascentExponent = 1.55 / config.islandSteepness;
    let maxTier = 0, heightTotal = 0;
    for (let index = 0; index < size; index++) {
      if (!land[index]) continue;
      const id = islandIndex[index];
      const inland = shoreDistance[index];
      const available = Math.max(1, peakInlandByIsland[id]);
      const inlandProgress = clamp(inland / available, 0, 1);
      const tier = inland > 0 ? Math.round(config.islandHeight * Math.pow(inlandProgress, ascentExponent)) : 0;
      elevation[index] = tier;
      peakByIsland[id] = Math.max(peakByIsland[id], tier);
      maxTier = Math.max(maxTier, tier);
      heightTotal += tier;
    }

    // Count actual separate landmasses, not merely the number of seeded
    // centers, so presets reveal when islands have collided or merged.
    const visited = new Uint8Array(size);
    const landmassAreas = [];
    const landmassPeaks = [];
    const massQueue = new Int32Array(size);
    for (let start = 0; start < size; start++) {
      if (!land[start] || visited[start]) continue;
      let front = 0, back = 0, peak = 0;
      visited[start] = 1;
      massQueue[back++] = start;
      while (front < back) {
        const index = massQueue[front++];
        peak = Math.max(peak, elevation[index]);
        const x = index % width, y = (index - x) / width;
        const neighbors = [
          x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1, y < height - 1 ? index + width : -1,
        ];
        for (const other of neighbors) {
          if (other < 0 || visited[other] || !land[other]) continue;
          visited[other] = 1;
          massQueue[back++] = other;
        }
      }
      landmassAreas.push(back);
      landmassPeaks.push(peak);
    }

    const result = {
      width, height, land, elevation, islandIndex, shoreDistance,
      stats: {
        seed: String(seed), islandCount: islands.filter(x => x.kind !== 'skerry').length,
        skerries: islands.filter(x => x.kind === 'skerry').length,
        landTiles, waterTiles: size - landTiles, coastlineTiles: shoreTiles,
        landFraction: Number((landTiles / size).toFixed(4)),
        peakTier: maxTier, meanLandTier: Number((heightTotal / Math.max(1, landTiles)).toFixed(2)),
        distinctLandmasses: landmassAreas.length,
        substantialLandmasses: landmassAreas.filter(area => area >= 10).length,
        raisedLandmasses: landmassPeaks.filter(tier => tier >= Math.min(2, config.islandHeight)).length,
        entrance: { col: 0, row: gateY, side:'west' },
        config,
        centers: islands.map(({cx,cy,rx,ry,kind}) => ({
          x:Number(cx.toFixed(2)), y:Number(cy.toFixed(2)),
          radiusX:Number(rx.toFixed(2)), radiusY:Number(ry.toFixed(2)), kind
        }))
      }
    };
    return result;
  }

  return Object.freeze({ DEFAULTS, settingsWithDefaults, generate, makeRng });
});

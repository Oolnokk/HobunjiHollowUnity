// ============================================================
// PORTRAIT BREATHING COMPOSER
// Manages mesh-deformation breathing animations for portrait
// body, body-cosmetic, and hood layers.
//
// Usage:
//   const composer = new BreathingComposer();
//   await composer.load('./docs/config/');   // loads default + overrides
//   // In render loop:
//   renderPortraitProfile(canvas, profile, { breathingComposer: composer, breathingPhaseOffsetMs: offset });
//
// Species overrides:
//   Species JSON may define "breathingAnimationUrl" under a gender key.
//   loadPortraitCosmetics() passes override data to the composer automatically
//   when it detects a "breathingAnimation" block in species gender data.
//
// Emoji compositing hook:
//   composer.triggerEmote('disgust'|'love'|'alarmed'|'curious') plays a
//   one-shot body deformation that blends additively on top of breathing.
//   composer.setBodyOverlay(speciesId, gender, animData, opts) is the lower-
//   level API; opts can be a number (durationMs) or { oneshot, global, durationMs }.
//   composer.clearBodyOverlay() cancels any active overlay.
// ============================================================

'use strict';

// ── Neutral 4×6 control points (reused by emote animation definitions) ────
const _N4x6 = [
  [0,0],[0.333333,0],[0.666667,0],[1,0],
  [0,0.2],[0.333333,0.2],[0.666667,0.2],[1,0.2],
  [0,0.4],[0.333333,0.4],[0.666667,0.4],[1,0.4],
  [0,0.6],[0.333333,0.6],[0.666667,0.6],[1,0.6],
  [0,0.8],[0.333333,0.8],[0.666667,0.8],[1,0.8],
  [0,1],[0.333333,1],[0.666667,1],[1,1],
];

// ── Emote one-shot deformation animations ────────────────────────────────
// Each animation starts AND ends at neutral so blending in/out is seamless.
// Poses are additive on top of the breathing cycle via triggerEmote().
// Peak pose objects referenced twice per animation so the from→to lerp is identity,
// producing a true hold at the peak without needing extra poses.
const _dPeak = { label: 'squash', points: [
  [0,0.14],[0.290,0.14],[0.710,0.14],[1,0.14],
  [0,0.29],[0.288,0.29],[0.712,0.29],[1,0.29],
  [0,0.44],[0.287,0.44],[0.713,0.44],[1,0.44],
  [0,0.61],[0.288,0.61],[0.712,0.61],[1,0.61],
  [0,0.79],[0.290,0.79],[0.710,0.79],[1,0.79],
  [0,1],   [0.333333,1],[0.666667,1],[1,1],
]};
const _aPeak = { label: 'burst', points: [
  [0,0],    [0.317,0],    [0.683,0],    [1,0],
  [0,0.194],[0.322,0.194],[0.678,0.194],[1,0.194],
  [0,0.392],[0.318,0.392],[0.682,0.392],[1,0.392],
  [0,0.594],[0.318,0.594],[0.682,0.594],[1,0.594],
  [0,0.797],[0.322,0.797],[0.678,0.797],[1,0.797],
  [0,1],    [0.333333,1], [0.666667,1], [1,1],
]};
const _cPeak = { label: 'contract', points: [
  [0,0],    [0.346,0],    [0.654,0],    [1,0],
  [0,0.204],[0.340,0.204],[0.660,0.204],[1,0.204],
  [0,0.406],[0.343,0.406],[0.657,0.406],[1,0.406],
  [0,0.594],[0.343,0.594],[0.657,0.594],[1,0.594],
  [0,0.796],[0.340,0.796],[0.660,0.796],[1,0.796],
  [0,1],    [0.333333,1], [0.666667,1], [1,1],
]};

// Laugh puff peak: subtle outward expansion (~12% vs alarmed's 20%) for staccato heartily-laughing effect.
const _lPeak = { label: 'laugh-puff', points: [
  [0,0],    [0.312,0],    [0.688,0],    [1,0],
  [0,0.198],[0.318,0.198],[0.682,0.198],[1,0.198],
  [0,0.397],[0.315,0.397],[0.685,0.397],[1,0.397],
  [0,0.596],[0.315,0.596],[0.685,0.596],[1,0.596],
  [0,0.798],[0.318,0.798],[0.682,0.798],[1,0.798],
  [0,1],    [0.333333,1], [0.666667,1], [1,1],
]};
const _lNeutral = { label: 'neutral', points: _N4x6 };

const EMOTE_ANIMATIONS = {

  // Three distinct staccato puffs: simulate a separated "ha... ha... ha" body shake.
  laugh: {
    gridCols: 4, gridRows: 6,
    poseDurations: [0.12, 0.14, 0.18, 0.12, 0.14, 0.18, 0.12, 0.14, 0.60],
    poses: [_lNeutral, _lPeak, _lNeutral, _lNeutral, _lPeak, _lNeutral, _lNeutral, _lPeak, _lNeutral],
  },

  // Single bounce: quick snap to squash (bottom locked), long drawn-out hold, snap back.
  disgust: {
    gridCols: 4, gridRows: 6,
    poseDurations: [0.10, 0.80, 0.10, 1.20],
    poses: [{ label: 'neutral', points: _N4x6 }, _dPeak, _dPeak, { label: 'neutral', points: _N4x6 }],
  },

  // Cartoony blow-kiss: full-body shear lean rooted at feet, max lean at head.
  // Each row shifts right by an amount that decreases linearly toward the fixed bottom.
  love: {
    gridCols: 4, gridRows: 6,
    poseDurations: [0.24, 0.88, 0.60, 0.48, 1.20],
    poses: [
      { label: 'neutral', points: _N4x6 },
      { label: 'lean-right', points: [
        [ 0.044,0],   [0.377,0],   [0.711,0],   [1.044,0],
        [ 0.035,0.2], [0.368,0.2], [0.702,0.2], [1.035,0.2],
        [ 0.026,0.4], [0.359,0.4], [0.693,0.4], [1.026,0.4],
        [ 0.016,0.6], [0.349,0.6], [0.683,0.6], [1.016,0.6],
        [ 0.006,0.8], [0.339,0.8], [0.673,0.8], [1.006,0.8],
        [ 0,1],       [0.333333,1],[0.666667,1], [1,1],
      ]},
      { label: 'lean-right-hold', points: [
        [ 0.035,0],   [0.368,0],   [0.702,0],   [1.035,0],
        [ 0.028,0.2], [0.361,0.2], [0.695,0.2], [1.028,0.2],
        [ 0.021,0.4], [0.354,0.4], [0.688,0.4], [1.021,0.4],
        [ 0.013,0.6], [0.346,0.6], [0.680,0.6], [1.013,0.6],
        [ 0.005,0.8], [0.338,0.8], [0.672,0.8], [1.005,0.8],
        [ 0,1],       [0.333333,1],[0.666667,1], [1,1],
      ]},
      { label: 'lean-left-slight', points: [
        [-0.022,0],   [0.311,0],   [0.645,0],   [0.978,0],
        [-0.018,0.2], [0.315,0.2], [0.649,0.2], [0.982,0.2],
        [-0.013,0.4], [0.320,0.4], [0.654,0.4], [0.987,0.4],
        [-0.008,0.6], [0.325,0.6], [0.659,0.6], [0.992,0.6],
        [-0.003,0.8], [0.330,0.8], [0.664,0.8], [0.997,0.8],
        [ 0,1],       [0.333333,1],[0.666667,1], [1,1],
      ]},
      { label: 'neutral', points: _N4x6 },
    ],
  },

  // Single bounce: quick snap outward (bottom locked, 20% scale), long hold at max expand, snap back.
  alarmed: {
    gridCols: 4, gridRows: 6,
    poseDurations: [0.03, 0.70, 0.06, 0.60],
    poses: [{ label: 'neutral', points: _N4x6 }, _aPeak, _aPeak, { label: 'neutral', points: _N4x6 }],
  },

  // Single bounce: quick snap inward (bottom locked, 20% scale), long hold at max compress, snap back.
  curious: {
    gridCols: 4, gridRows: 6,
    poseDurations: [0.03, 0.70, 0.06, 0.60],
    poses: [{ label: 'neutral', points: _N4x6 }, _cPeak, _cPeak, { label: 'neutral', points: _N4x6 }],
  },
};

// ============================================================

class BreathingComposer {
  constructor() {
    this._defaultAnim = null;
    this._overrides   = new Map(); // "speciesId:gender" → anim data

    // One-shot emoji body overlay state
    this._overlay = null; // { anim, startMs, durationMs, oneshot, global, speciesId, gender }

    // Mouth facial expression state per seat
    this._expressions = new Map(); // seatId → { expression, expiresAtMs }

    // Persistent default/resting expression per seat (returned when timed expression expires)
    this._defaultExpressions = new Map(); // seatId → expression string
  }

  get enabled() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.breathing;
    return cfg?.enabled !== false;
  }

  // ── Data management ──────────────────────────────────────

  setDefault(animData) {
    this._defaultAnim = _validateBreathingAnim(animData) ? animData : null;
  }

  setOverride(speciesId, gender, animData) {
    const key = `${String(speciesId).trim()}:${String(gender).trim()}`;
    if (_validateBreathingAnim(animData)) {
      this._overrides.set(key, animData);
    }
  }

  getAnimData(speciesId, gender) {
    const key = `${String(speciesId || '').trim()}:${String(gender || '').trim()}`;
    return this._overrides.get(key) || this._defaultAnim;
  }

  // ── Loading ──────────────────────────────────────────────

  async load(configBase) {
    const base = String(configBase || './config/').replace(/\/?$/, '/');
    try {
      const url = new URL(base + 'animations/breathing-default.json', window.location.href).toString();
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        this.setDefault(data);
      } else {
        console.warn('[breathing] Default animation not found:', url);
      }
    } catch (e) {
      console.warn('[breathing] Could not load default breathing animation', e);
    }
  }

  // ── Emoji body overlay ───────────────────────────────────

  /**
   * Trigger a one-shot body deformation for an emoji reaction on a specific seat.
   * emoteName: 'disgust' | 'love' | 'alarmed' | 'curious'
   * seatId: the seat whose portrait should deform (null = all seats)
   */
  triggerEmote(emoteName, seatId) {
    const animKey = emoteName === 'shock' ? 'alarmed'
                  : emoteName === 'gloat' ? 'alarmed'
                  : emoteName;
    const baseAnim = EMOTE_ANIMATIONS[animKey];
    if (!baseAnim || !this.enabled) return;
    const anim = _getConfiguredEmoteAnimation(animKey, baseAnim);
    const durations = Array.isArray(anim.poseDurations) ? anim.poseDurations : [];
    const totalMs = durations.reduce((s, d) => s + (Number(d) || 0.8), 0) * 1000;
    this.setBodyOverlay(null, null, anim, {
      oneshot:      true,
      targetSeatId: seatId != null ? String(seatId) : null,
      durationMs:   totalMs,
    });
  }

  /**
   * Low-level overlay API. animData must pass validation.
   * opts: number (legacy durationMs) or { oneshot, targetSeatId, durationMs }
   * targetSeatId null/omitted = apply to all seats.
   */
  setBodyOverlay(speciesId, gender, animData, opts) {
    if (!_validateBreathingAnim(animData)) return;
    let oneshot = false, targetSeatId = null, durationMs = 2000;
    if (typeof opts === 'number') {
      durationMs = Number(opts) || 2000;
    } else if (opts && typeof opts === 'object') {
      oneshot      = !!opts.oneshot;
      targetSeatId = opts.targetSeatId != null ? String(opts.targetSeatId) : null;
      durationMs   = Number(opts.durationMs) || 2000;
    }
    this._overlay = {
      anim: animData,
      startMs: Date.now(),
      durationMs,
      oneshot,
      targetSeatId, // null = all seats; string seatId = specific seat only
    };
  }

  clearBodyOverlay() {
    this._overlay = null;
  }

  // ── Facial expression state ──────────────────────────────

  /**
   * Set mouth expression for a seat.
   * expression: 'neutral' | 'smile' | 'frown' | 'laugh'
   * durationMs: how long before returning to the default expression (default from config or 10 000ms)
   */
  setExpression(seatId, expression, durationMs) {
    const ms = Number(durationMs) ||
      Number(window.SCRATCHBONES_CONFIG?.game?.portrait?.expressions?.durationMs) ||
      10000;
    if (!expression || expression === 'neutral') {
      this._expressions.delete(String(seatId ?? ''));
      return;
    }
    this._expressions.set(String(seatId ?? ''), {
      expression: String(expression),
      expiresAtMs: Date.now() + ms,
    });
  }

  /**
   * Set the persistent default/resting expression for a seat.
   * This is returned when no timed expression is active or after one expires.
   * expression: 'neutral' | 'smile' | 'frown'
   */
  setDefaultExpression(seatId, expression) {
    const key = String(seatId ?? '');
    if (!expression || expression === 'neutral') {
      this._defaultExpressions.delete(key);
    } else {
      this._defaultExpressions.set(key, String(expression));
    }
  }

  /**
   * Get the current mouth expression for a seat.
   * Returns the default expression (or 'neutral') when none is active or it has expired.
   */
  getExpression(seatId, nowMs) {
    const key = String(seatId ?? '');
    const defaultExpr = this._defaultExpressions.get(key) || 'neutral';
    const state = this._expressions.get(key);
    if (!state) return defaultExpr;
    if ((nowMs ?? Date.now()) >= state.expiresAtMs) {
      this._expressions.delete(key);
      return defaultExpr;
    }
    return state.expression;
  }

  // ── Point interpolation ──────────────────────────────────

  /**
   * Returns interpolated deformed mesh points combining breathing + active emote overlay.
   * seatId scopes the overlay check so only the triggering seat is affected.
   * Returns null if no animation data is available.
   */
  getInterpolatedPoints(speciesId, gender, nowMs, phaseOffsetMs, seatId) {
    if (!this.enabled) return null;
    const anim = this.getAnimData(speciesId, gender);
    const offset = Number(phaseOffsetMs) || 0;
    const breathePts = anim ? _interpolatePoses(anim, nowMs + offset) : null;

    if (this._overlay) {
      const ol = this._overlay;
      const elapsed = nowMs - ol.startMs;

      if (elapsed >= ol.durationMs) {
        this._overlay = null;
      } else {
        const applies = (ol.targetSeatId === null) ||
          (ol.targetSeatId === String(seatId ?? ''));

        if (applies) {
          const olPts = ol.oneshot
            ? _interpolatePosesOneShot(ol.anim, elapsed)
            : _interpolatePoses(ol.anim, elapsed);

          if (olPts) {
            const olNeutral = _getNeutralPoints(ol.anim.gridCols, ol.anim.gridRows);
            const base = breathePts || olNeutral;

            if (ol.oneshot) {
              return base.map(([bx, by], i) => {
                const [onx, ony] = olNeutral[i];
                const [ox, oy] = olPts[i];
                return [bx + (ox - onx), by + (oy - ony)];
              });
            } else {
              const t = elapsed / ol.durationMs;
              const env = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
              return base.map(([bx, by], i) => {
                const [onx, ony] = olNeutral[i];
                const [ox, oy] = olPts[i];
                return [bx + (ox - onx) * env, by + (oy - ony) * env];
              });
            }
          }
        }
      }
    }

    return breathePts;
  }

  /**
   * Schedule a sequence of momentary 'yap' mouth flashes to simulate lip-sync for a chat message.
   * The number of flashes equals the vowel/diphthong count; spacing is determined by spaces
   * (spaceDelayMs each) and terminal punctuation (pauseDelayMs each).
   */
  scheduleYapSequence(seatId, text, opts = {}) {
    if (!this.enabled) return;
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.yap || {};
    const flashMs     = Math.max(50,  Number(opts.flashMs      ?? cfg.flashMs      ?? 120));
    const spaceDelayMs = Math.max(0,  Number(opts.spaceDelayMs ?? cfg.spaceDelayMs ?? 60));
    const pauseDelayMs = Math.max(0,  Number(opts.pauseDelayMs ?? cfg.pauseDelayMs ?? 250));

    const DIPHTHONGS = new Set(['ai','ao','au','ei','eu','oi','ou','ea','ee','oo','ay','ey','ow','oy','ia','ie','io','iu']);
    const VOWELS     = new Set('aeiou');
    const lower      = String(text || '').toLowerCase();
    const seatIdStr  = String(seatId ?? '');
    let t = 0;
    let i = 0;

    while (i < lower.length) {
      const ch = lower[i];
      if (ch === ' ' || ch === '\t') {
        t += spaceDelayMs;
        i++;
      } else if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
        t += pauseDelayMs;
        i++;
      } else {
        const two = lower.slice(i, i + 2);
        if (DIPHTHONGS.has(two)) {
          const schedT = t;
          setTimeout(() => this.setExpression(seatIdStr, 'yap', flashMs), schedT);
          t += flashMs;
          i += 2;
        } else if (VOWELS.has(ch)) {
          const schedT = t;
          setTimeout(() => this.setExpression(seatIdStr, 'yap', flashMs), schedT);
          t += flashMs;
          i++;
        } else {
          i++;
        }
      }
    }
  }

  /**
   * Returns the emote overlay's deformed points for head/static layers (no breathing added).
   * Used by portrait-utils to apply emote deformation to head, hair, eyes, and hat layers.
   * Returns null when no overlay is active or it doesn't target this seatId.
   */
  getOverlayOnlyPoints(nowMs, seatId) {
    if (!this.enabled || !this._overlay) return null;
    const ol = this._overlay;
    const elapsed = nowMs - ol.startMs;
    if (elapsed >= ol.durationMs) { this._overlay = null; return null; }
    if (ol.targetSeatId !== null && ol.targetSeatId !== String(seatId ?? '')) return null;

    const olPts = ol.oneshot
      ? _interpolatePosesOneShot(ol.anim, elapsed)
      : _interpolatePoses(ol.anim, elapsed);
    if (!olPts) return null;

    if (ol.oneshot) return olPts;

    const t = elapsed / ol.durationMs;
    const env = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
    const neutral = _getNeutralPoints(ol.anim.gridCols, ol.anim.gridRows);
    return neutral.map(([nx, ny], i) => {
      const [ox, oy] = olPts[i];
      return [nx + (ox - nx) * env, ny + (oy - ny) * env];
    });
  }
}

// ── Internal helpers ─────────────────────────────────────────

function _validateBreathingAnim(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.poses) || data.poses.length < 2) return false;
  if (!Number.isFinite(data.gridCols) || !Number.isFinite(data.gridRows)) return false;
  const ptCount = data.gridCols * data.gridRows;
  for (const pose of data.poses) {
    if (!Array.isArray(pose.points) || pose.points.length !== ptCount) return false;
  }
  return true;
}

function _getNeutralPoints(gridCols, gridRows) {
  const pts = [];
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      pts.push([
        gridCols > 1 ? c / (gridCols - 1) : 0.5,
        gridRows > 1 ? r / (gridRows - 1) : 0.5,
      ]);
    }
  }
  return pts;
}
function _getConfiguredEmoteAnimation(animKey, anim) {
  if (animKey === 'laugh') return _getConfiguredLaughAnimation(anim);
  if (animKey !== 'disgust') return anim;
  const scale = Number(window.SCRATCHBONES_CONFIG?.game?.portrait?.emotes?.disgust?.horizontalDeformationScale);
  if (!Number.isFinite(scale) || scale === 1) return anim;

  const neutral = Array.isArray(anim.poses?.[0]?.points)
    ? anim.poses[0].points
    : _getNeutralPoints(anim.gridCols, anim.gridRows);
  return {
    ...anim,
    poses: anim.poses.map((pose) => ({
      ...pose,
      points: pose.points.map(([x, y], i) => {
        const [nx] = neutral[i] || [x];
        return [nx + (x - nx) * scale, y];
      }),
    })),
  };
}

function _getConfiguredLaughAnimation(anim) {
  const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.emotes?.laugh || {};
  const puffCount = Math.max(1, Math.floor(Number(cfg.puffCount) || 3));
  const inflateDurationSeconds = Math.max(0.001, Number(cfg.inflateDurationSeconds) || 0.12);
  const deflateDurationSeconds = Math.max(0.001, Number(cfg.deflateDurationSeconds) || 0.14);
  const pauseDurationSeconds = Math.max(0, Number(cfg.pauseDurationSeconds) || 0.18);
  const settleDurationSeconds = Math.max(0, Number(cfg.settleDurationSeconds) || 0.60);
  const neutralPose = anim.poses?.[0] || _lNeutral;
  const puffPose = anim.poses?.[1] || _lPeak;
  const poseDurations = [];
  const poses = [neutralPose];

  for (let i = 0; i < puffCount; i += 1) {
    poseDurations.push(inflateDurationSeconds, deflateDurationSeconds);
    poses.push(puffPose, neutralPose);
    if (i < puffCount - 1 && pauseDurationSeconds > 0) {
      poseDurations.push(pauseDurationSeconds);
      poses.push(neutralPose);
    }
  }
  poseDurations.push(settleDurationSeconds);

  return { ...anim, poseDurations, poses };
}


/**
 * Looping interpolation used for the breathing cycle.
 * Uses Ken Perlin smoothstep: 3t² − 2t³
 */
function _interpolatePoses(anim, timeMs) {
  const poses = anim.poses;
  const durations = Array.isArray(anim.poseDurations) ? anim.poseDurations : [];
  const n = poses.length;
  const defaultDur = 0.8;

  let totalDuration = 0;
  for (let i = 0; i < n; i++) totalDuration += Number(durations[i]) || defaultDur;
  if (totalDuration <= 0) return null;

  const cycleT = ((timeMs / 1000) % totalDuration + totalDuration) % totalDuration;

  let elapsed = 0;
  let fromI = n - 1;
  for (let i = 0; i < n; i++) {
    const dur = Number(durations[i]) || defaultDur;
    if (elapsed + dur > cycleT) { fromI = i; break; }
    elapsed += dur;
  }
  const toI = (fromI + 1) % n;
  const dur = Number(durations[fromI]) || defaultDur;
  const localT = Math.max(0, Math.min(1, (cycleT - elapsed) / dur));
  const st = localT * localT * (3 - 2 * localT);

  const fromPts = poses[fromI].points;
  const toPts   = poses[toI].points;
  return fromPts.map(([fx, fy], i) => {
    const [tx, ty] = toPts[i];
    return [fx + (tx - fx) * st, fy + (ty - fy) * st];
  });
}

/**
 * One-shot interpolation: plays through poses once then holds the last frame.
 * Last pose should be neutral for a clean exit.
 */
function _interpolatePosesOneShot(anim, elapsedMs) {
  const poses = anim.poses;
  const durations = Array.isArray(anim.poseDurations) ? anim.poseDurations : [];
  const n = poses.length;
  const defaultDur = 0.8;
  const elapsedS = elapsedMs / 1000;

  let totalDuration = 0;
  for (let i = 0; i < n; i++) totalDuration += Number(durations[i]) || defaultDur;

  if (elapsedS >= totalDuration) {
    return poses[n - 1].points.map(p => [p[0], p[1]]);
  }

  let accum = 0, fromI = 0;
  for (let i = 0; i < n; i++) {
    const dur = Number(durations[i]) || defaultDur;
    if (accum + dur > elapsedS) { fromI = i; break; }
    accum += dur;
  }
  const toI = Math.min(fromI + 1, n - 1);
  const dur = Number(durations[fromI]) || defaultDur;
  const localT = Math.max(0, Math.min(1, (elapsedS - accum) / dur));
  const st = localT * localT * (3 - 2 * localT);

  const fromPts = poses[fromI].points;
  const toPts   = poses[toI].points;
  return fromPts.map(([fx, fy], i) => {
    const [tx, ty] = toPts[i];
    return [fx + (tx - fx) * st, fy + (ty - fy) * st];
  });
}

window.BreathingComposer = BreathingComposer;

// ── Auto-initialise a shared global composer ─────────────────
// Loaded automatically so callers (bootstrap.js, lobby.js) don't need
// to be modified. renderProfile() in portrait-utils.js falls back to
// window.portraitBreathingComposer when no composer is in renderOptions.
(function _autoInitBreathingComposer() {
  const composer = new BreathingComposer();
  window.portraitBreathingComposer = composer;

  // Derive config base from the portrait-utils or breathing script src,
  // falling back to common paths used in the project.
  function _resolveConfigBase() {
    const candidates = ['./docs/config/', './config/'];
    // Try to mirror whatever loadPortraitCosmetics was last called with.
    const cfgBase = window.SCRATCHBONES_CONFIG?.game?.assets?.portrait?.configBase;
    if (cfgBase) candidates.unshift(cfgBase);
    return candidates[0];
  }

  function _load() {
    composer.load(_resolveConfigBase()).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _load, { once: true });
  } else {
    _load();
  }
}());

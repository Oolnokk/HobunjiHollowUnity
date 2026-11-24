// Perception information-list presentation: crop/livestock status and Spyglass
// enemy names. Target selection and refresh cadence remain with PerceptionMode.
(() => {
  'use strict';
  const INFO_RANGE_TILES = 6; // Info lists only for close objects, so a full farm doesn't drown in text.
  const MAX_INFO_LISTS = 10;
  const INFO_COLORS = Object.freeze({
    title: '#FFB86C', // Matches WorldPopupText's interaction object color.
    good: '#71f59a',
    bad: '#dc143c', // Crimson.
    muted: '#B8C5C0',
    value: '#ffffff',
  });

  // ── Info lists ───────────────────────────────────────────────────────
  const capitalize = text => String(text || '').replace(/\b\w/g, ch => ch.toUpperCase());
  const fmt1 = value => (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');

  function lerpHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = shift => Math.round(((pa >> shift) & 255) + ((((pb >> shift) & 255) - ((pa >> shift) & 255)) * t));
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }

  // Moisture shown in tenths of the tile's max water; the ideal (white
  // denominator) is the middle of the crop's ideal band. The numerator runs
  // white → crimson with distance from that ideal, reaching full crimson
  // where growth stops entirely (0.4 outside the band, per game.js's
  // cropGrowthMultiplier).
  function cropRows(crop) {
    const { tile, data, maxWater } = crop;
    if (!tile || !data) return null;
    const w = Math.max(0, (Number(tile.water) || 0) / maxWater);
    const ideal = (data.idealMin + data.idealMax) / 2;
    const reach = (data.idealMax - data.idealMin) / 2 + 0.4;
    const t = Math.min(1, Math.abs(w - ideal) / reach);
    const growth = Math.max(0, Math.min(1, (Number(tile.cropAge) || 0) / Math.max(0.001, data.growDays)));
    const rows = [
      [{ text: capitalize(data.label), color: INFO_COLORS.title }],
      tile.cropReady
        ? [{ text: 'Growth', small: true }, { text: '100%', color: INFO_COLORS.good }, { text: 'Ready', color: INFO_COLORS.good }]
        : [{ text: 'Growth', small: true }, { text: Math.floor(growth * 100) + '%', color: INFO_COLORS.value }],
      [{ text: 'Moisture', small: true }, { text: fmt1(w * 10), color: lerpHex('#ffffff', INFO_COLORS.bad, t) }, { text: '/' + fmt1(ideal * 10), color: INFO_COLORS.value, tight: true }],
    ];
    if (tile.stress) rows.push([{ text: capitalize(tile.stress), color: INFO_COLORS.bad }]);
    return rows;
  }

  const yesNo = (ok, yes, no) => ({ text: ok ? yes : no, color: ok ? INFO_COLORS.good : INFO_COLORS.bad });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function livestockRows(status) {
    if (!status) return null;
    const rows = [
      [{ text: status.name, color: INFO_COLORS.title }, { text: 'Hearts', small: true }, { text: `${fmt1(status.hearts)}/${status.heartMax}`, color: INFO_COLORS.value }],
      status.hasTrough
        ? [{ text: 'Fed', small: true }, yesNo(status.fed, 'Yes', 'No'), ...(status.fed ? [{ text: `(${plural(status.feedDays, 'day')} in trough)`, small: true }] : [{ text: '(trough empty)', small: true }])]
        : [{ text: 'Fed', small: true }, { text: status.housed ? 'No trough' : 'Unhoused', color: INFO_COLORS.muted }],
      [{ text: 'Petted', small: true }, yesNo(status.pettedToday, 'Yes', 'Not today')],
    ];
    if (status.resourceLabel) {
      rows.push(status.resourceReady
        ? [{ text: status.resourceLabel, color: INFO_COLORS.good }, { text: 'ready to collect', color: INFO_COLORS.good }]
        : [{ text: status.resourceLabel, small: true }, { text: status.housed && status.daysUntilResource != null ? `in ${plural(status.daysUntilResource, 'day')}` : 'paused', color: INFO_COLORS.value }]);
    }
    if (status.dewReady != null) {
      rows.push(status.dewReady
        ? [{ text: 'Dew', color: INFO_COLORS.good }, { text: 'ready', color: INFO_COLORS.good }]
        : [{ text: 'Dew', small: true }, { text: status.housed && status.dewDaysUntil != null ? `in ${plural(status.dewDaysUntil, 'day')}` : 'paused', color: INFO_COLORS.value }]);
    }
    return rows;
  }

  function refreshInfoLists(targets, scene) {
    const popup = window.WorldPopupText;
    if (!popup?.syncInfoLists) return;
    const showEnemyNames = window.Spyglass?.isLookingCloser?.() === true; // Spyglass close-look reuses the same nearby info-list presentation.
    const enemies = showEnemyNames
      ? targets.filter(t => t.category === 'hostile' && t.creature)
        .sort((a, b) => a.dist - b.dist).slice(0, MAX_INFO_LISTS)
      : [];
    const near = targets
      .filter(t => t.dist <= INFO_RANGE_TILES && (t.crop || t.livestockId))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, Math.max(0, MAX_INFO_LISTS - enemies.length));
    const ids = near.filter(t => t.livestockId).map(t => t.livestockId);
    const statuses = ids.length ? (window.FarmAnimals?.livestockStatus?.(ids) || new Map()) : new Map();
    const entries = enemies.map((target, index) => {
      const creature = target.creature;
      const name = String(creature.name || creature.def?.label || creature.def?.name || creature.speciesLabel || creature.species || creature.kind || 'Hostile').trim();
      return { key: 'spyglass-enemy:' + (target.root.uuid || target.root.name || index), root: target.root, rows: [[{ text: name, color: INFO_COLORS.title }]] };
    });
    for (const t of near) {
      if (t.crop) {
        const rows = cropRows(t.crop);
        if (rows) entries.push({ key: `crop:${t.crop.col},${t.crop.row}`, root: t.root, rows, objectAnchor: true, lift: 0.55 });
      } else {
        const rows = livestockRows(statuses.get(t.livestockId));
        if (rows) entries.push({ key: `livestock:${t.livestockId}`, root: t.root, rows });
      }
    }
    return popup.syncInfoLists(entries, { scene });
  }

  window.PerceptionInfoLists = Object.freeze({ refreshInfoLists, cropRows, livestockRows, lerpHex });
})();

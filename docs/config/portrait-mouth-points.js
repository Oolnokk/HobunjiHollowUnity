// Species/gender "mouth" coordinate on the portrait, in the same SOURCE-pixel space as
// neckRig.headCentroidPx. Head-anchored tool poses (blowgun, drink) mate their tool's aperture
// with this point; SharedAttackPose.headFrame resolves it through the live skinned head.
// A species with no authored entry uses its head centroid, which is every species for now.
(() => {
  'use strict';

  const VERSION = 1;
  const points = {}; // 'mao-ao::male': { x, y } once a species' real mouth pixel is authored.
  const keyFor = (speciesId, gender) => `${String(speciesId || '').trim().toLowerCase().replace(/_/g, '-')}::${String(gender || 'male').trim().toLowerCase() === 'female' ? 'female' : 'male'}`;

  function pixelFor(speciesId, gender, rig = null) {
    const authored = points[keyFor(speciesId, gender)];
    if (authored && Number.isFinite(authored.x) && Number.isFinite(authored.y)) return authored;
    return rig?.headCentroidPx || null;
  }

  function set(speciesId, gender, point) {
    const x = Number(point?.x), y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    points[keyFor(speciesId, gender)] = { x, y };
    return true;
  }

  window.HobunjiPortraitMouthPoints = Object.freeze({ version: VERSION, points, pixelFor, set, keyFor });
})();

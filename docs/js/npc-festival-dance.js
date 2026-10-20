// Character-driven festival decisions: who wants to dance, with whom, and what to do after a meal.
// Pure rules (no scene access) so the gathering routine in npc-shared-meals.js stays a thin state machine.
(() => {
  'use strict';
  let deps = null; // Gathering owner supplies relationships, romance eligibility, inhibition, drunkenness and the NPC alive check.
  let socialCache = null, socialFor = null; // Relationship sets are rebuilt only when the authored relationship array changes.
  const traitCache = new Map(); // Stable per-NPC temperament; inhibition itself is re-read so alcohol and edits stay live.
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number(value) || 0));
  const clamp01 = value => clamp(value, 0, 1);
  function init(injected) { deps = injected || {}; socialCache = null; socialFor = null; traitCache.clear(); }
  function hash01(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function relationships() { return deps?.relationships?.() || []; }
  function graph() {
    const source = relationships();
    if (socialCache && socialFor === source) return socialCache;
    const out = { partner: new Map(), family: new Map(), friend: new Map() }; // type -> id -> Set(ids)
    for (const link of source) {
      const type = out[link?.type]; const members = Array.isArray(link?.members) ? link.members : [];
      if (!type) continue;
      for (const a of members) for (const b of members) {
        if (a === b) continue;
        if (!type.has(a)) type.set(a, new Set());
        type.get(a).add(b);
      }
    }
    socialFor = source; socialCache = out;
    return out;
  }
  const idsOf = (type, id) => graph()[type].get(id) || new Set();
  function spouseIds(rec) { return idsOf('partner', rec?.id); }
  function isMarried(rec) { return spouseIds(rec).size > 0 || (!!rec?.id && deps?.playerSpouseId?.() === rec.id); }
  // 'married' dance only with a spouse, 'single' are unmarried romanceable adults who mingle freely,
  // everyone else ('casual': children, elders, friends) dances only with people they already know.
  function kind(rec) {
    if (isMarried(rec)) return 'married';
    return deps?.isRomanceable?.(rec) ? 'single' : 'casual';
  }
  function bond(a, b) {
    if (!a?.id || !b?.id) return 0;
    let weight = 0;
    if (idsOf('partner', a.id).has(b.id)) weight += 14;
    if (idsOf('family', a.id).has(b.id)) weight += 11;
    if (idsOf('friend', a.id).has(b.id)) weight += 8;
    return weight;
  }
  function ageGroup(rec) {
    const text = `${rec?.ageBand || ''} ${rec?.role || ''}`.toLowerCase();
    if (rec?.isChild || /child|boy|girl/.test(text)) return 'child';
    if (/old|elder|eldress|ancient/.test(text) && !/middle/.test(text)) return 'old';
    return 'adult';
  }
  function inhibition(rec) {
    const value = Number(deps?.inhibition?.(rec));
    return Number.isFinite(value) ? clamp(value, 1, 99) : 64;
  }
  // Temperament is derived from data every NPC already has (inhibition, age, id hash); nothing is scripted per character.
  function traits(rec) {
    let cached = traitCache.get(rec?.id);
    if (!cached) {
      const age = ageGroup(rec), seed = hash01(`festival:${rec?.id}`);
      cached = {
        age,
        appetite: clamp(.7 + seed * .6 + (age === 'child' ? .25 : 0), .5, 1.5), // How readily they go back for more.
        stamina: clamp(.6 + hash01(`stamina:${rec?.id}`) * .6 + (age === 'old' ? -.25 : age === 'child' ? .2 : 0), .3, 1.3), // How many songs before they sit out.
      };
      traitCache.set(rec?.id, cached);
    }
    const personality = rec?.personality || {};
    const base = inhibition(rec);
    return { ...cached, inhibition: base,
      sociability: clamp01(personality.sociability ?? 1.05 - base / 110),
      shyness: clamp01(personality.shyness ?? base / 140) };
  }
  function danceThreshold(effective) { // Matches NpcSocialInhibition.danceThresholdFor so festival and ambient dancing agree.
    if (typeof deps?.danceThreshold === 'function') return deps.danceThreshold(effective);
    const e = clamp(effective, 1, 99);
    return e <= 30 ? e : clamp(30 + (e - 30) * 2, 1, 99);
  }
  // Probability (0..1) that this character is willing to dance right now: inhibition, music and venue pull, shyness and drink.
  function danceDrive(rec) {
    const t = traits(rec), drunk = clamp01(Number(deps?.drunkFraction?.(rec?.id)) || 0);
    let effective = 1 + (t.inhibition - 1) * (1 - drunk);
    effective += (t.shyness - .5) * 10 + (.5 - t.sociability) * 6 - 11; // -8 live music, -3 festival venue (same terms as the ambient equation)
    return clamp((100 - danceThreshold(effective)) / 100, .02, .97);
  }
  // Weight of dancing a song with `other` (0 = never). Rules: spouses only for married people, any two unmarried
  // romanceable non-relatives for singles, and known friends/relatives for everyone else.
  function pairWeight(rec, other, { lastPartnerId = null } = {}) {
    if (!rec?.id || !other?.id || rec.id === other.id) return 0;
    const a = kind(rec), b = kind(other);
    if (a === 'married' || b === 'married') return a === 'married' && b === 'married' && idsOf('partner', rec.id).has(other.id) ? 20 : 0;
    if (a === 'single' && b === 'single') {
      if (idsOf('family', rec.id).has(other.id) || ageGroup(rec) === 'child' || ageGroup(other) === 'child') return 0;
      let weight = 1 + (deps?.likesDancing?.(rec.id) ? .6 : 0) + (deps?.likesDancing?.(other.id) ? .6 : 0) + (idsOf('friend', rec.id).has(other.id) ? .5 : 0);
      if (lastPartnerId === other.id) weight *= .15; // Swapping partners is the default; repeats stay possible but rare.
      return weight;
    }
    if (a === 'casual' && b === 'casual') return Math.min(6, bond(rec, other)) / 4 * (lastPartnerId === other.id ? .3 : 1);
    return 0;
  }
  function pickWeighted(items, weightOf, random) {
    let total = 0; const weights = items.map(item => { const w = Math.max(0, Number(weightOf(item)) || 0); total += w; return w; });
    if (total <= 0) return null;
    let roll = random() * total;
    for (let i = 0; i < items.length; i++) { roll -= weights[i]; if (roll < 0) return items[i]; }
    return items[items.length - 1];
  }
  // Groups the dance floor's authored standing spots into facing pairs (nearest first); the rest remain solo/waiting spots.
  function pairSlots(stations, maxDistance = 1.35) {
    const candidates = [];
    for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
      const d = Math.hypot(stations[i].c - stations[j].c, stations[i].r - stations[j].r);
      if (d <= maxDistance && stations[i].area === stations[j].area) candidates.push({ d, a: stations[i], b: stations[j] });
    }
    candidates.sort((x, y) => x.d - y.d || String(x.a.stationId).localeCompare(String(y.a.stationId)) || String(x.b.stationId).localeCompare(String(y.b.stationId)));
    const used = new Set(), slots = [];
    for (const { a, b } of candidates) {
      if (used.has(a.stationId) || used.has(b.stationId)) continue;
      used.add(a.stationId); used.add(b.stationId);
      slots.push({ id: `${a.stationId}|${b.stationId}`, a, b });
    }
    return { slots, leftovers: stations.filter(s => !used.has(s.stationId)) };
  }
  // After a meal or a song: pick the next thing from character-weighted options instead of a fixed sequence.
  function decide(rec, ctx, random = Math.random) {
    const t = traits(rec), k = kind(rec), drive = danceDrive(rec);
    const options = [];
    const fullness = Math.pow(.62, Math.max(0, ctx.helpings - (ctx.arriving ? 0 : 1))); // Each plate dulls the appetite.
    const hunger = 1 + clamp((ctx.minutesSinceMeal - 60) / 120, 0, 1); // A long dance makes the buffet attractive again.
    options.push({ action: 'seconds', weight: (ctx.arriving ? 2.4 : 1.2) * t.appetite * fullness * hunger });
    let dance = 0, solo = false;
    if (ctx.musicOn && ctx.floorOpen) {
      const tired = Math.pow(.8, ctx.songs / Math.max(.3, t.stamina));
      if (k === 'married') dance = ctx.spouseAvailable ? 2.6 * drive * tired * (ctx.spouseWaiting ? 3 : 1) + (ctx.spouseWaiting ? .8 : 0) : 0;
      else if (k === 'single') dance = (ctx.partnerCount > 0 ? 2.4 : .6) * drive * tired * (.7 + .6 * t.sociability);
      else if (ctx.partnerCount > 0) dance = 1.6 * drive * tired;
      else if (t.inhibition < 36) { dance = 1.1 * drive * tired; solo = true; } // Only the genuinely uninhibited dance alone.
    }
    options.push({ action: 'dance', weight: dance, solo });
    options.push({ action: 'other', weight: .45 + .5 * t.sociability + (ctx.justDanced ? .3 : 0) + (t.age === 'old' ? .4 : 0) });
    const picked = pickWeighted(options, o => o.weight, random) || options[options.length - 1];
    return { ...picked, options };
  }
  // Whether one dancer wants another song: stamina, hunger, shyness and the music all count.
  function wantsAnotherSong(rec, ctx, random = Math.random) {
    const t = traits(rec);
    let p = .35 + danceDrive(rec) * .6 - .1 * ctx.songs / Math.max(.3, t.stamina);
    if (ctx.minutesSinceMeal > 90) p -= .2;
    if (!ctx.musicOn) return false;
    return random() < clamp(p, .05, .95);
  }
  function songMinutes(random = Math.random) { return 16 + random() * 12; } // ~7-13 real seconds at 672 s per game day.
  window.NpcFestivalDance = Object.freeze({ init, kind, isMarried, spouseIds, bond, traits, danceDrive, pairWeight, pickWeighted, pairSlots, decide, wantsAnotherSong, songMinutes, ageGroup });
})();

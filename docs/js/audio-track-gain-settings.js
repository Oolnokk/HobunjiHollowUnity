(() => {
  'use strict';

  const STORAGE_KEY = 'hobunjiMusicTrackGains.v2'; // Persists user overrides on top of the Follow-the-Signs calibrated defaults; v2 intentionally drops the earlier uncalibrated 100%-baseline experiment.
  const SELECTED_KEY = 'hobunjiMusicTrackGainSelected.v1'; // Remembers which song the Settings dropdown last displayed.
  const EVENT_NAME = 'hobunji-track-gain-changed'; // Tells Music to refresh a currently-playing track immediately.
  const MIN_PERCENT = 0; // Allows muting an individual song without changing the master BGM level.
  const MAX_PERCENT = 500; // Gives quiet masters enough real gain headroom while keeping the authoring control bounded.
  const STEP_PERCENT = 5; // Keeps controller/keyboard range input adjustments practical.
  // Reference gains are derived from the measured integrated loudness of
  // Follow the Signs (-18.51 LUFS). Rounded 5% values keep every ordinary
  // BGM within about half a dB of that reference in game. Torchlight is
  // calibrated against its existing authored 2x Ghoul-floor multiplier, so
  // that special soundtrack also lands in the same audible band at full mix.
  const TRACKS = Object.freeze([
    { id: 'bgm_farm1.m4a', label: 'Farm 1', url: 'assets/audio/music/bgm/bgm_farm1.m4a', referencePercent: 60 },
    { id: 'bgm_follow_the_signs.ogg', label: 'Follow the Signs', url: 'assets/audio/music/bgm/bgm_follow_the_signs.ogg', referencePercent: 100 },
    { id: 'bgm_gentle_twilight.m4a', label: 'Gentle Twilight', url: 'assets/audio/music/bgm/bgm_gentle_twilight.m4a', referencePercent: 170 },
    { id: 'bgm_just_beyond_the_torchlight.ogg', label: 'Just Beyond the Torchlight', url: 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg', referencePercent: 180 },
    { id: 'bgm_quiet_hope.m4a', label: 'Quiet Hope', url: 'assets/audio/music/bgm/bgm_quiet_hope.m4a', referencePercent: 335 },
    { id: 'bgm_remembrance.m4a', label: 'Remembrance', url: 'assets/audio/music/bgm/bgm_remembrance.m4a', referencePercent: 145 },
    { id: 'bgm_skirmish.m4a', label: 'Skirmish', url: 'assets/audio/music/bgm/bgm_skirmish.m4a', referencePercent: 70 },
    { id: 'bgm_snow_and_darkness.m4a', label: 'Snow and Darkness', url: 'assets/audio/music/bgm/bgm_snow_and_darkness.m4a', referencePercent: 95 },
    { id: 'bgm_still_waking_up.mp3', label: 'Still Waking Up', url: 'assets/audio/music/bgm/bgm_still_waking_up.mp3', referencePercent: 30 },
    { id: 'bgm_what_the_winds_carry.mp3', label: 'What the Winds Carry', url: 'assets/audio/music/bgm/bgm_what_the_winds_carry.mp3', referencePercent: 65 },
  ]);

  let gains = loadGains(); // In-memory copy used by both the Settings UI and Music's hot playback path.

  function clampPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, Math.round(n / STEP_PERCENT) * STEP_PERCENT)) : 100;
  }

  function trackIdForUrl(url) {
    const clean = String(url || '').split(/[?#]/, 1)[0];
    const filename = clean.slice(clean.lastIndexOf('/') + 1);
    return TRACKS.some(track => track.id === filename) ? filename : '';
  }

  function trackForId(id) {
    return TRACKS.find(track => track.id === id) || null;
  }

  function loadGains() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean = {};
      for (const track of TRACKS) {
        if (Object.prototype.hasOwnProperty.call(parsed, track.id)) clean[track.id] = clampPercent(parsed[track.id]);
      }
      return clean;
    } catch (_) {
      return {};
    }
  }

  function saveGains() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gains)); } catch (_) {}
  }

  function hasTrack(url) {
    return !!trackIdForUrl(url);
  }

  function referencePercentForUrl(url) {
    const track = trackForId(trackIdForUrl(url));
    return track ? clampPercent(track.referencePercent) : 100;
  }

  function gainPercentForUrl(url) {
    const id = trackIdForUrl(url);
    if (!id) return 100;
    return Object.prototype.hasOwnProperty.call(gains, id)
      ? clampPercent(gains[id])
      : referencePercentForUrl(url);
  }

  function gainForUrl(url) {
    return gainPercentForUrl(url) / 100;
  }

  function setGainPercent(urlOrId, percent, { emit = true } = {}) {
    const id = trackIdForUrl(urlOrId) || (trackForId(urlOrId)?.id || '');
    const track = trackForId(id);
    if (!track) return 100;
    const next = clampPercent(percent);
    const referencePercent = clampPercent(track.referencePercent);
    if (next === referencePercent) delete gains[track.id];
    else gains[track.id] = next;
    saveGains();
    if (emit) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: { id: track.id, url: track.url, percent: next, gain: next / 100 },
      }));
    }
    return next;
  }

  function selectedTrackId() {
    try {
      const saved = localStorage.getItem(SELECTED_KEY) || '';
      if (trackForId(saved)?.id === saved) return saved;
    } catch (_) {}
    return TRACKS[0]?.id || '';
  }

  function saveSelectedTrackId(id) {
    try { localStorage.setItem(SELECTED_KEY, id); } catch (_) {}
  }

  function installUi() {
    const select = document.getElementById('settingMusicTrackGainSong');
    const slider = document.getElementById('settingMusicTrackGain');
    const value = document.getElementById('settingMusicTrackGainValue');
    const reset = document.getElementById('settingMusicTrackGainReset');
    if (!select || !slider || !value || select.dataset.trackGainBound === '1') return false;

    select.dataset.trackGainBound = '1';
    select.innerHTML = '';
    for (const track of TRACKS) select.add(new Option(track.label, track.id));
    slider.min = String(MIN_PERCENT);
    slider.max = String(MAX_PERCENT);
    slider.step = String(STEP_PERCENT);

    const syncFromSelection = () => {
      const track = trackForId(select.value) || TRACKS[0];
      if (!track) return;
      if (select.value !== track.id) select.value = track.id;
      const percent = gainPercentForUrl(track.url);
      slider.value = String(percent);
      value.textContent = percent + '%';
      if (reset) {
        const referencePercent = referencePercentForUrl(track.url);
        reset.disabled = percent === referencePercent;
        reset.title = 'Reset to Follow the Signs loudness reference (' + referencePercent + '%)';
      }
    };

    select.value = selectedTrackId();
    if (!select.value && TRACKS[0]) select.value = TRACKS[0].id;
    select.addEventListener('change', () => {
      saveSelectedTrackId(select.value);
      syncFromSelection();
    });
    slider.addEventListener('input', () => {
      const track = trackForId(select.value);
      if (!track) return;
      const percent = setGainPercent(track.url, slider.value);
      slider.value = String(percent);
      value.textContent = percent + '%';
      if (reset) {
        const referencePercent = referencePercentForUrl(track.url);
        reset.disabled = percent === referencePercent;
        reset.title = 'Reset to Follow the Signs loudness reference (' + referencePercent + '%)';
      }
    });
    reset?.addEventListener('click', () => {
      const track = trackForId(select.value);
      if (!track) return;
      setGainPercent(track.url, referencePercentForUrl(track.url));
      syncFromSelection();
    });
    syncFromSelection();
    return true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi, { once: true });
  else installUi();

  window.AudioTrackGainSettings = Object.freeze({
    hasTrack,
    referencePercentForUrl,
    gainForUrl,
    gainPercentForUrl,
    setGainPercent,
    tracks: TRACKS,
    minPercent: MIN_PERCENT,
    maxPercent: MAX_PERCENT,
    stepPercent: STEP_PERCENT,
    installUi,
  });
})();

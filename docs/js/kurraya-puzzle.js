/* Shared, timing-free five-note Kurraya song model for the puzzle instrument and Tool Hub. */
(function (root) {
  'use strict';
  const SONGS_KEY = 'hobunji.kurrayaPuzzleSongs.v1'; // Shared between the music lab and gameplay on the same origin.
  const SETTINGS_KEY = 'hobunji.kurrayaPuzzleSettings.v1'; // Stores the puzzle mode's independently adjustable key and scale.
  const SCALES = Object.freeze({
    'Pentatonic Major': [0, 2, 4, 7, 9],
    'Pentatonic Minor': [0, 3, 5, 7, 10],
    'Major': [0, 2, 4, 5, 7],
    'Natural Minor': [0, 2, 3, 5, 7],
    'Dorian': [0, 2, 3, 7, 9],
    'Phrygian': [0, 1, 3, 5, 7],
    'Hirajoshi': [0, 2, 3, 7, 8],
    'Yo': [0, 2, 5, 7, 9],
    'Chromatic': [0, 1, 2, 3, 4]
  }); // Each scale supplies exactly five distinct single-note buttons, with no banks or chords.
  const NOTE_CODES = Object.freeze(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG']); // Default keyboard notes 1–5.
  const BUILTIN_SONGS = Object.freeze([
    Object.freeze({id:'puzzle-practice',title:'Practice Melody',notes:[0,1,2,4,2,1,0],scale:'Pentatonic Major',tonicMidi:60})
  ]); // Gives new saves one recognizable example without requiring authoring first.
  let memorySongs = []; // Fallback if storage is unavailable, also used by isolated tests.
  let memorySettings = {scale:'Pentatonic Major',tonicMidi:60}; // Fallback for privacy/storage-restricted browsers.

  function storage() { try { return root.localStorage || null; } catch (_) { return null; } }
  function sanitizeSettings(input) {
    const scale = Object.prototype.hasOwnProperty.call(SCALES,input?.scale) ? input.scale : 'Pentatonic Major';
    const n = Number(input?.tonicMidi);
    return {scale:scale,tonicMidi:Number.isFinite(n) ? Math.max(36,Math.min(84,Math.round(n))) : 60};
  }
  function settings() {
    try { return sanitizeSettings(JSON.parse(storage()?.getItem(SETTINGS_KEY) || 'null') || memorySettings); }
    catch (_) { return sanitizeSettings(memorySettings); }
  }
  function setSettings(input) {
    memorySettings = sanitizeSettings(Object.assign({},settings(),input || {}));
    try { storage()?.setItem(SETTINGS_KEY,JSON.stringify(memorySettings)); } catch (_) {}
    return settings();
  }
  function normalizeSong(input) {
    if (!input || typeof input !== 'object') return null;
    const title = String(input.title || '').trim().slice(0,64);
    const notes = input.notes;
    if (!title || !Array.isArray(notes) || notes.length < 3 || notes.length > 32 ||
        !notes.every(note => Number.isInteger(note) && note >= 0 && note < 5)) return null;
    const id = String(input.id || '').trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64);
    if (!id) return null;
    return Object.assign({id:id,title:title,notes:notes.slice()},sanitizeSettings(input));
  }
  function userSongs() {
    let loaded = memorySongs;
    try { const value = JSON.parse(storage()?.getItem(SONGS_KEY) || 'null'); if (Array.isArray(value)) loaded = value; } catch (_) {}
    return loaded.slice(0,100).map(normalizeSong).filter(Boolean)
      .filter(song => !BUILTIN_SONGS.some(builtin => builtin.id === song.id));
  }
  function listSongs() { return BUILTIN_SONGS.map(normalizeSong).concat(userSongs()); }
  function persistUserSongs(songs) {
    memorySongs = songs.slice(0,100).map(normalizeSong).filter(Boolean);
    try { storage()?.setItem(SONGS_KEY,JSON.stringify(memorySongs)); }
    catch (_) {}
    try { root.dispatchEvent?.(new Event('hobunji-kurraya-puzzle-songs-changed')); } catch (_) {}
    return listSongs();
  }
  function ambiguousMelody(a,b) {
    const shorter = a.notes.length <= b.notes.length ? a : b;
    const longer = a.notes.length <= b.notes.length ? b : a;
    // Finishing a short song before a longer one ends resets the player sequence.
    // A shorter suffix is safe: matchSuffix prefers the longest completed song.
    const lastEarlyStart = longer.notes.length - shorter.notes.length - 1;
    for (let start=0; start<=lastEarlyStart; start++) {
      if (shorter.notes.every((note,index) => longer.notes[start+index] === note)) return true;
    }
    return a.notes.length === b.notes.length && a.notes.every((note,index) => b.notes[index] === note);
  }
  function checkSongbookAmbiguity(songs) {
    for (let index=0; index<songs.length; index++) {
      for (let prior=0; prior<index; prior++) {
        if (ambiguousMelody(songs[index],songs[prior])) {
          throw new Error('Melody conflicts with "'+songs[prior].title+'". A shorter tune cannot finish before a longer one; change some notes.');
        }
      }
    }
  }
  function saveSong(input) {
    const draft = Object.assign({},input);
    if (!draft.id || BUILTIN_SONGS.some(song => song.id === draft.id)) {
      draft.id = 'song-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
    }
    const song = normalizeSong(draft);
    if (!song) throw new Error('A song needs a title and 3–32 notes, each between 1 and 5.');
    const songs = userSongs();
    const index = songs.findIndex(item => item.id === song.id);
    if (index >= 0) songs[index] = song;
    else {
      if (songs.length >= 100) throw new Error('The songbook is full (100 custom songs).');
      songs.push(song);
    }
    checkSongbookAmbiguity(BUILTIN_SONGS.concat(songs));
    persistUserSongs(songs);
    return song;
  }
  function deleteSong(id) {
    if (BUILTIN_SONGS.some(song => song.id === id)) return false;
    const songs = userSongs();
    if (!songs.some(song => song.id === id)) return false;
    persistUserSongs(songs.filter(song => song.id !== id));
    return true;
  }
  function importSongs(payload) {
    const raw = Array.isArray(payload) ? payload : payload?.songs;
    if (!Array.isArray(raw) || raw.length > 100) throw new Error('Expected a songbook JSON object with up to 100 songs.');
    const songs = raw.map(normalizeSong);
    if (songs.some(song => !song)) throw new Error('Invalid song: each entry requires an ID, title, and 3–32 note indices (0–4).');
    const merged = new Map(userSongs().map(song => [song.id,song]));
    songs.forEach(song => { if (!BUILTIN_SONGS.some(builtin => builtin.id === song.id)) merged.set(song.id,song); });
    if (merged.size > 100) throw new Error('The merged songbook exceeds 100 songs.');
    checkSongbookAmbiguity(BUILTIN_SONGS.concat([...merged.values()]));
    persistUserSongs([...merged.values()]);
    return songs.length;
  }
  function pitchFor(noteIndex,inputSettings) {
    const tune = sanitizeSettings(inputSettings || settings());
    if (!Number.isInteger(noteIndex) || noteIndex < 0 || noteIndex >= 5) return null;
    return tune.tonicMidi + SCALES[tune.scale][noteIndex];
  }
  function noteName(midi) {
    const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
    return names[((midi % 12) + 12) % 12] + String(Math.floor(midi / 12) - 1);
  }
  function matchSuffix(history,songs) {
    const matches = (songs || listSongs()).filter(song =>
      history.length >= song.notes.length &&
      song.notes.every((note,i) => note === history[history.length - song.notes.length + i]));
    return matches.sort((a,b) => b.notes.length - a.notes.length)[0] || null;
  }
  function createSampler(url, options = {}) {
    const useCustomSample = options.useCustomSample !== false; // Flute uses its own authored sample rather than a Kurraya Music Lab recording.
    const allowMidiFallback = options.fallback === 'midi'; // The flute remains playable through Web Audio synthesis until its named sample is uploaded.
    let context = null; // Allocated on first gesture, preserving mobile autoplay policy.
    let buffer = null; // Decoded bundled Kurraya pluck, shared across all subsequent notes.
    let pending = null; // Coalesces decode when several notes are pressed during first load.
    let voice = null; // The sole sounding voice; stopping it prevents overlapping chords.
    let requestSerial = 0; // Makes only the newest note press audible if the first sample is still decoding.
    let sampleRootMidi = 60; // Recorded fundamental used by the same pitch-shift formula as the legacy Kurraya sampler.
    let sampleName = 'Bundled Kurraya pluck'; // Visible when the imported Music Lab sample is restored.
    let usingMidiFallback = false; // Selects a pitched, monophonic flute synth when the optional sample cannot load.
    let lastError = ''; // Readable in the tool and puzzle diagnostics when audio cannot start.
    function configuredGain() {
      // Music Lab persists the shared Kurraya and master levels in the existing
      // performance settings. Puzzle uses those two levels, never pad/metronome mix.
      try {
        const saved = JSON.parse(storage()?.getItem('musicSystemDemoSettingsV13') || 'null');
        const masterRaw = Number(saved?.masterVolume);
        const kurrayaRaw = Number(saved?.kurrayaMixLevel);
        const master = Number.isFinite(masterRaw) ? Math.max(0,Math.min(1,masterRaw)) : 0.78;
        const kurraya = Number.isFinite(kurrayaRaw) ? Math.max(0,Math.min(2,kurrayaRaw)) : 1;
        return Math.min(1,0.7 * master * kurraya);
      } catch (_) { return 0.7 * 0.78; }
    }
    async function restoreImportedKurrayaSample() {
      // The performance instrument already stores normalized PCM at this exact IndexedDB key.
      // Reusing it keeps Puzzle Mode faithful to a Music Lab custom-pluck choice.
      if (!root.indexedDB || !storage()?.getItem('hobunji.kurrayaCustomSample.v1')) return false;
      let db = null;
      try {
        db = await new Promise((resolve,reject) => {
          const request = root.indexedDB.open('MusicSystemDemoSampleCacheV1',1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('Sample cache inaccessible'));
        });
        if (!db.objectStoreNames.contains('samples')) return false;
        const record = await new Promise((resolve,reject) => {
          const request = db.transaction('samples','readonly').objectStore('samples').get('last');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('Custom sample read failed'));
        });
        if (!record?.pcm || !record.sampleRate) return false;
        const pcm = new Float32Array(record.pcm); // Previously normalized mono PCM from the real instrument editor.
        if (!pcm.length || pcm.length > 50_000_000) return false;
        buffer = context.createBuffer(1,pcm.length,record.sampleRate);
        buffer.copyToChannel(pcm,0);
        sampleRootMidi = Math.max(24,Math.min(96,Math.round(Number(record.sampleRootMidi) || 60)));
        sampleName = String(record.name || 'Imported Kurraya sample');
        return true;
      } catch (error) {
        lastError = 'Custom sample restore: ' + String(error.message || error);
        return false; // Bundled pluck remains available when the custom cache is stale.
      } finally { try { db?.close(); } catch (_) {} }
    }
    async function ready() {
      const AudioCtor = root.AudioContext || root.webkitAudioContext;
      if (!AudioCtor) throw new Error('Web Audio is unavailable.');
      if (!context) context = new AudioCtor();
      if (context.state === 'suspended') await context.resume();
      if (buffer || usingMidiFallback) return context;
      if (!pending) pending = (async () => {
        if (useCustomSample && await restoreImportedKurrayaSample()) return;
        try {
          const response = await root.fetch(url);
          if (!response.ok) throw new Error('Instrument sample HTTP ' + response.status);
          const bytes = await response.arrayBuffer();
          buffer = await context.decodeAudioData(bytes);
          sampleRootMidi = 60;
          sampleName = options.sampleName || 'Bundled Kurraya pluck';
        } catch (error) {
          if (!allowMidiFallback) throw error;
          usingMidiFallback = true;
          sampleName = 'MIDI flute fallback';
          lastError = '';
        }
      })().catch(error => { pending = null; lastError = String(error.message || error); throw error; });
      await pending;
      return context;
    }
    async function play(midi) {
      const serial = ++requestSerial;
      const ctx = await ready();
      if (serial !== requestSerial) return false; // The later note is authoritative even across asynchronous decode.
      if (voice) { try { voice.stop(); } catch (_) {} voice = null; }
      const source = usingMidiFallback ? ctx.createOscillator() : ctx.createBufferSource();
      const gain = ctx.createGain();
      const start = ctx.currentTime + 0.001; // Connect the voice before scheduling its start, including on Safari's stricter Web Audio pipeline.
      if (usingMidiFallback) {
        // A simple MIDI-pitched sine flute with breathlike attack/release; no audio asset or external synth library is required.
        source.type = 'sine';
        source.frequency.value = 440 * Math.pow(2, (Number(midi) - 69) / 12);
        gain.gain.setValueAtTime(0.0001,start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002,configuredGain() * 0.65),start + 0.045);
        gain.gain.exponentialRampToValueAtTime(0.0001,start + 0.42);
      } else {
        source.buffer = buffer;
        // The sample is pitched by the same playback-rate method as Kurraya Music Lab.
        source.playbackRate.value = Math.pow(2,(Number(midi) - sampleRootMidi) / 12);
        gain.gain.value = configuredGain();
      }
      source.connect(gain); gain.connect(ctx.destination);
      source.start(start);
      if (usingMidiFallback) source.stop(start + 0.44);
      voice = source;
      source.onended = () => { if (voice === source) voice = null; source.disconnect(); gain.disconnect(); };
      lastError = '';
      return true;
    }
    function stop() { ++requestSerial; if (voice) { try { voice.stop(); } catch (_) {} voice = null; } }
    return {ready:ready,play:play,stop:stop,get diagnostics() { return {ready:!!buffer||usingMidiFallback,playing:!!voice,sampleName:sampleName,sampleRootMidi:sampleRootMidi,midiFallback:usingMidiFallback,error:lastError}; }};
  }
  const api = Object.freeze({SONGS_KEY:SONGS_KEY,SETTINGS_KEY:SETTINGS_KEY,SCALES:SCALES,NOTE_CODES:NOTE_CODES,
    normalizeSong:normalizeSong,listSongs:listSongs,saveSong:saveSong,deleteSong:deleteSong,importSongs:importSongs,
    settings:settings,setSettings:setSettings,pitchFor:pitchFor,noteName:noteName,matchSuffix:matchSuffix,createSampler:createSampler});
  root.KurrayaPuzzle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// Controller-first chest lockpicking. One reusable 2–4 ring timing minigame;
// reward systems own their loot and call open({ tier, valid, onSuccess }).
(() => {
  'use strict';

  const OWNER = 'chest-lockpicking'; // Exclusive controller-input ownership while a lock is on screen.
  const BUTTONS = ['Button4', 'Button5', 'LeftTrigger', 'RightTrigger']; // LB/RB/LT/RT operate the four independently moving rings.
  const KEYS = ['KeyQ', 'KeyE', 'KeyZ', 'KeyC']; // Keyboard equivalents used by the same catch handler as touch and controllers.
  const NAMES = ['Outer', 'Middle I', 'Middle II', 'Inner']; // Physical names displayed beside each ring and in feedback.
  const COLORS = ['#f3d99b', '#9ee7df', '#f1b2a5', '#aebff0']; // Ring-specific markers, notches, and touch-button hints.
  const SPEED_FACTORS = [1, -0.79, 0.66, -1.13]; // Opposing speeds prevent all rings from aligning at once.
  const PRESETS = Object.freeze({
    1: { rings: 2, speed: 105, window: 18, slipMs: 4200, stages: 2 },
    2: { rings: 3, speed: 135, window: 15, slipMs: 6800, stages: 3 },
    3: { rings: 3, speed: 170, window: 12, slipMs: 6300, stages: 3 },
    4: { rings: 4, speed: 190, window: 11, slipMs: 10000, stages: 3 },
  }); // Chest tier maps to difficulty, including the four-ring top tier.
  const DEBUG_INTERVAL_MS = 250; // Throttles diagnostics so mobile browsers never rebuild a debug panel each frame.

  let session = null; // Only one chest may own a minigame, callback and cleanup at any time.
  let root = null; // Reusable modal root, created lazily after document.body is available.
  let svg = null; // Existing SVG dial updated in place during play, never rebuilt per frame.
  let feedback = null; // Announced to screen readers and visually during catches/slips.
  let progress = null; // Round indicator for the current chest lock.
  let buttons = []; // Touch targets for each currently visible ring.
  let debug = null; // In-game copyable diagnostics for mobile users.
  let closeButton = null; // Escape/B/cancel surface used without gameplay input leakage.
  let frameId = 0; // A single animation frame loop exists only while the modal is active.
  let lastFrame = 0; // Monotonic clock of the previous frame for clamped physics.
  let lastDebug = 0; // Timestamp of the last debug refresh while diagnostics are visible.
  let audio = null; // Lazily constructed audio context (user gesture required).
  let unsubscribePad = null; // Subscription to the game's shared, single gamepad polling authority.
  let actionLock = null; // Scoped movement/tool/action suppression for the player during picking.
  let priorOwner = 'gameplay'; // Controller-input owner restored on exit unless another system claimed it.
  let lastError = ''; // Debuggable failure without requiring a mobile devtools console.
  let lastOutcome = null; // Last completed/cancelled chest, visible in the debug snapshot.
  let mounted = false; // Prevents duplicate event handlers when a chest is reopened.

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value)); // Constrains tier and frame-delta inputs.
  const wrap = angle => ((angle % 360) + 360) % 360; // Keeps arbitrary ring rotations in degree space.
  const distance = (a, b) => Math.abs(((a - b + 540) % 360) - 180); // Shortest circular angle between marker and target.
  const rand = (lo, hi) => lo + Math.random() * (hi - lo); // Varies each ring's phase and target at the start of a round.
  const ringLabel = (i, total) => total === 2 ? ['Outer', 'Inner'][i] : total === 3 ? ['Outer', 'Middle', 'Inner'][i] : NAMES[i]; // Match visual ring order.
  const radiusFor = (i, total) => 127 - i * (total === 2 ? 44 : total === 3 ? 33 : 26); // Keep 2–4 nested rings legible at mobile widths.

  function describeError(error) {
    lastError = String(error?.stack || error?.message || error); // Debug uses a stable string, never an Error object that JSON.stringify drops.
    window.__farmLog?.('[chest-lockpicking] ' + lastError, 'warn');
  }

  function sound(freq = 450, duration = .09, volume = .045, kind = 'triangle') {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audio ||= new Ctx();
      if (audio.state === 'suspended') audio.resume?.().catch?.(() => {});
      const t = audio.currentTime;
      const tone = audio.createOscillator(), gain = audio.createGain(); // Ephemeral one-shot synthesizer avoids loading sound assets per chest.
      tone.type = kind;
      tone.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(Math.max(volume, .0001), t);
      gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
      tone.connect(gain); gain.connect(audio.destination);
      tone.start(t); tone.stop(t + duration + .015);
    } catch (error) { describeError(error); }
  }

  function rumble(ms = 30) {
    try {
      const pad = window.ControllerInput?.frame?.().pad; // Shared selected gamepad; no independent permanent gamepad polling.
      const motor = pad?.vibrationActuator;
      motor?.playEffect?.('dual-rumble', {duration:ms, startDelay:0, weakMagnitude:.15, strongMagnitude:.08})?.catch?.(() => {});
    } catch (_) { /* Haptic support is optional. */ }
  }

  function point(cx, cy, r, deg) {
    const rad = deg * Math.PI / 180; // SVG target notches use the same angular convention as marker rotations.
    return `${(cx + Math.sin(rad) * r).toFixed(2)} ${(cy - Math.cos(rad) * r).toFixed(2)}`;
  }

  function arc(cx, cy, r, start, end) {
    return `M ${point(cx,cy,r,start)} A ${r} ${r} 0 0 1 ${point(cx,cy,r,end)}`; // Clockwise target window around the ring's assigned notch.
  }

  function ensureUi() {
    if (mounted) return;
    if (!document.body) return;
    const style = document.createElement('style'); // Scoped to this minigame: game panels and other SVGs never inherit lock styles.
    style.id = 'chestLockStyle';
    style.textContent = `
      @font-face{font-family:ChestKhymeryyan;src:url('assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf') format('truetype');font-display:swap}
      #chestLockOverlay{position:fixed;inset:0;z-index:2147483600;display:none;align-items:center;justify-content:center;padding:env(safe-area-inset-top) max(9px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(9px,env(safe-area-inset-left));background:rgba(8,9,11,.86);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);color:#f2e5c8;font:clamp(13px,2.35vmin,20px)/1.3 ChestKhymeryyan,Georgia,serif;text-shadow:0 2px 3px #000;box-sizing:border-box;user-select:none;-webkit-user-select:none;touch-action:manipulation}
      #chestLockOverlay[aria-hidden=false]{display:flex}
      #chestLockOverlay *,#chestLockOverlay *:before,#chestLockOverlay *:after{box-sizing:border-box}
      #chestLockOverlay button{font:inherit;color:inherit;cursor:pointer;touch-action:manipulation;min-height:44px}
      #chestLockOverlay button:focus-visible,#chestLockOverlay summary:focus-visible{outline:2px solid #fff1b7;outline-offset:3px}
      #chestLockOverlay .cl-shell{width:min(100%,750px);max-height:100%;overflow:auto;overscroll-behavior:contain;border:1px solid #705d43;background:linear-gradient(170deg,#25251f,#101715 70%);box-shadow:0 12px 46px #000e, inset 0 0 0 3px #111;position:relative;padding:clamp(10px,2.4vmin,22px);display:grid;gap:clamp(8px,1.6vmin,15px);text-align:center}
      #chestLockOverlay .cl-heading{font-size:clamp(19px,3.7vmin,32px);letter-spacing:.06em;margin:0;color:#f3d99b}
      #chestLockOverlay .cl-subhead{color:#bfb29c;font-size:clamp(11px,2vmin,15px)}
      #chestLockOverlay .cl-x{position:absolute;right:9px;top:7px;border:1px solid #574b3a;background:#201b18;border-radius:5px;padding:0 14px;min-width:44px}
      #chestLockOverlay .cl-dial{width:min(100%,min(58dvh,500px));height:auto;max-height:47dvh;display:block;margin:auto;filter:drop-shadow(0 0 16px #0009)}
      #chestLockOverlay .cl-feedback{min-height:2.5em;display:flex;justify-content:center;align-items:center;color:#f1d1a4}
      #chestLockOverlay .cl-progress{font-size:clamp(12px,2.4vmin,17px);color:#b8d9bb}
      #chestLockOverlay .cl-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-width:580px;width:100%;margin:auto}
      #chestLockOverlay .cl-ring{border:2px solid var(--ring-color);background:#151917;border-radius:6px;padding:8px 6px;display:grid;gap:2px;place-items:center;line-height:1.18}
      #chestLockOverlay .cl-ring[disabled]{opacity:.52;cursor:default}
      #chestLockOverlay .cl-ring small{font:13px/1.2 system-ui,sans-serif;color:#cecbc2}
      #chestLockOverlay .cl-hints{font:clamp(11px,2.1vmin,13px)/1.5 system-ui,sans-serif;color:#b2a999}
      #chestLockOverlay .cl-debug{font:11px/1.25 ui-monospace,monospace;text-align:left;border-top:1px solid #594c39;padding:5px;max-height:36dvh;overflow:auto}
      #chestLockOverlay .cl-debug pre{white-space:pre-wrap;overflow-wrap:anywhere}
      #chestLockOverlay .cl-copy{background:#34332a;border:1px solid #796d4b;border-radius:4px;padding:3px 10px}
      @media(max-width:550px){#chestLockOverlay .cl-shell{gap:7px;padding:9px}#chestLockOverlay .cl-dial{width:min(98%,46dvh,390px);max-height:39dvh}#chestLockOverlay .cl-ring{padding:5px 4px}#chestLockOverlay .cl-feedback{min-height:2em}#chestLockOverlay .cl-heading{padding-right:32px}}
      @media(max-height:535px) and (orientation:landscape){#chestLockOverlay .cl-shell{max-width:900px;grid-template-columns:minmax(150px,1fr) minmax(260px,1fr);grid-template-rows:auto 1fr auto;gap:6px}#chestLockOverlay .cl-heading,#chestLockOverlay .cl-subhead,#chestLockOverlay .cl-progress{grid-column:1}#chestLockOverlay .cl-dial{grid-column:2;grid-row:1/4;width:auto;max-width:42dvh;max-height:42dvh}#chestLockOverlay .cl-buttons{grid-column:1;grid-row:4}#chestLockOverlay .cl-feedback{grid-column:2;grid-row:4}#chestLockOverlay .cl-hints,#chestLockOverlay .cl-debug{grid-column:1/-1}}
    `;
    root = document.createElement('section'); // Modal has no generic data-ctrl-panel: this interaction owns LB/RB rather than menu navigation.
    root.id = 'chestLockOverlay'; root.setAttribute('aria-label','Pick chest lock'); root.setAttribute('aria-hidden','true');
    root.innerHTML = `<div class="cl-shell"><button type="button" class="cl-x" aria-label="Leave lockpicking">×</button><h2 class="cl-heading">RING TUMBLERS</h2><div class="cl-subhead" id="chestLockTitle">Chest Lock</div><div class="cl-progress" id="chestLockProgress"></div><svg class="cl-dial" viewBox="0 0 500 320" role="img" aria-label="Rotating ring tumblers with colored timing notches"><g id="chestLockDial"></g></svg><div class="cl-feedback" id="chestLockFeedback" role="status" aria-live="polite"></div><div class="cl-buttons" id="chestLockButtons"></div><div class="cl-hints">LB / RB / LT / RT to catch rings · B / Esc to leave<br>Keyboard: Q / E / Z / C · Touch: ring buttons</div><details class="cl-debug" id="chestLockDiagnostics"><summary>Lockpicking diagnostics</summary><pre id="chestLockDebug"></pre><button class="cl-copy" type="button" id="chestLockCopy">Copy diagnostics</button></details></div>`;
    document.head.append(style); document.body.append(root);
    svg = root.querySelector('.cl-dial');
    feedback = root.querySelector('#chestLockFeedback');
    progress = root.querySelector('#chestLockProgress');
    debug = root.querySelector('#chestLockDebug');
    closeButton = root.querySelector('.cl-x');
    closeButton.addEventListener('click', () => close('cancelled'));
    root.querySelector('#chestLockCopy').addEventListener('click', () => {
      const value = JSON.stringify(snapshot(),null,2); // Copyable without a console; avoids dumping live world state.
      navigator.clipboard?.writeText?.(value)?.catch?.(() => { debug.textContent = value; });
    });
    mounted = true;
  }

  function announce(message) { if (feedback) feedback.textContent = message; }

  function setProgress() {
    if (!session || !progress) return;
    progress.textContent = `Set ${session.stage + 1} of ${session.cfg.stages} · ${session.misses} misses`;
  }

  function makeRings() {
    if (!session) return;
    const { rings:count } = session.cfg;
    session.rings = Array.from({length:count}, (_,i) => ({
      angle:rand(0,360), target:rand(35,325), speed:session.cfg.speed*SPEED_FACTORS[i],
      radius:radiusFor(i,count), frozen:false, name:ringLabel(i,count),
    })); // A new set rotates independently; progress is not tied to randomness after a ring is caught.
    session.firstCatch = -1;
    const grooves = session.rings.map((ring,i) => {
      const c = COLORS[i];
      return `<circle cx="250" cy="155" r="${ring.radius}" fill="none" stroke="#0d1313" stroke-width="20"/><circle cx="250" cy="155" r="${ring.radius}" fill="none" stroke="${c}" stroke-opacity=".5" stroke-width="14"/><path id="chestLockTarget${i}" stroke="${c}" stroke-width="16" stroke-linecap="round" fill="none"/><g id="chestLockMarker${i}"><rect x="244" y="${155-ring.radius-11}" width="12" height="22" rx="3" fill="${c}" stroke="#181512" stroke-width="1.5"/></g>`;
    }).join('');
    svg.querySelector('#chestLockDial').innerHTML = `<circle cx="250" cy="155" r="140" fill="#202320" stroke="#997b51" stroke-width="5"/>${grooves}<circle cx="250" cy="155" r="27" fill="#98815c" stroke="#302819" stroke-width="3"/><text x="250" y="158" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#e7d6ad">LOCK</text><text id="chestLockTimer" x="250" y="182" font-family="sans-serif" font-size="11" text-anchor="middle" fill="#e7d6ad"></text>`;
    const wrapButtons = root.querySelector('#chestLockButtons');
    wrapButtons.replaceChildren(); buttons=[];
    for(let i=0;i<count;i++) {
      const button = document.createElement('button'); // One touch hit-target per ring; identical catch() path as gamepad and keyboard.
      button.type='button'; button.className='cl-ring'; button.style.setProperty('--ring-color',COLORS[i]);
      const name = ringLabel(i,count), control = ['LB · Q','RB · E','LT · Z','RT · C'][i];
      button.innerHTML = `<span>Catch ${name}</span><small>${control}</small>`;
      button.setAttribute('aria-label',`Catch ${name} ring, ${control}`);
      button.addEventListener('pointerdown', e => { if(e.button!==0) return; e.preventDefault(); catchRing(i,'touch'); });
      button.addEventListener('click', e => { if(e.detail===0) catchRing(i,'accessibility'); });
      wrapButtons.append(button); buttons.push(button);
    }
    setProgress();
    render();
  }

  function miss(message) {
    if (!session) return;
    session.misses++;
    sound(180,.2,.06,'sawtooth'); rumble(60);
    if (session.misses%3 === 0 && session.stage>0) session.stage--; // Three misses lose one secured set, as in the standalone prototype.
    announce(message + (session.misses%3===0 ? ' A completed set slipped.' : ''));
    session.phase='playing'; makeRings();
  }

  function catchRing(i, source='unknown') {
    const active = session;
    if (!active || active.phase!=='playing') return false;
    const ring = active.rings[i];
    if (!ring || ring.frozen) return false;
    active.lastInput = `${source}: ${ring.name}`;
    if (distance(ring.angle, ring.target)>active.cfg.window) { miss(`${ring.name} missed its notch.`); return false; }
    ring.frozen = true;
    sound(465+i*93,.09,.05); rumble();
    if (active.firstCatch<0) active.firstCatch=active.elapsed;
    const caught = active.rings.filter(item=>item.frozen).length;
    if (caught!==active.rings.length) announce(`${ring.name} seated · ${caught} / ${active.rings.length}`);
    else {
      active.stage++;
      sound(795,.17,.055);
      if (active.stage>=active.cfg.stages) {
        active.phase='won';
        announce('Lock opened!');
        close('success');
        return true;
      }
      active.phase='transition';
      active.transitionMs=650;
      announce(`Set secured! ${active.stage} / ${active.cfg.stages}`);
    }
    setProgress(); render();
    return true;
  }

  function render() {
    if (!session || !svg) return;
    const state = session;
    for(const [i,ring] of state.rings.entries()){
      svg.querySelector(`#chestLockTarget${i}`)?.setAttribute('d',arc(250,155,ring.radius,ring.target-state.cfg.window,ring.target+state.cfg.window));
      const marker=svg.querySelector(`#chestLockMarker${i}`);
      marker?.setAttribute('transform',`rotate(${ring.angle.toFixed(2)} 250 155)`);
      marker?.setAttribute('opacity',ring.frozen?'.45':'1');
      if (buttons[i]) buttons[i].disabled=ring.frozen || state.phase!=='playing';
    }
    const remaining=state.firstCatch<0?null:Math.max(0,state.cfg.slipMs-(state.elapsed-state.firstCatch));
    const clock=svg.querySelector('#chestLockTimer');
    if (clock) clock.textContent=remaining==null?'':(remaining/1000).toFixed(1)+'s';
  }

  function tick(dt) {
    const active=session;
    if(!active) return;
    if(typeof active.valid==='function') {
      let okay=false;
      try {okay=active.valid()!==false;} catch(error){describeError(error);}
      if(!okay){close('invalid');return;}
    }
    if(active.phase==='transition'){
      active.transitionMs-=dt;
      if(active.transitionMs<=0){active.phase='playing';makeRings();announce('Catch every moving notch before the rings slip.');}
      return;
    }
    if(active.phase!=='playing')return;
    active.elapsed+=dt;
    for(const ring of active.rings) if(!ring.frozen) ring.angle=wrap(ring.angle+ring.speed*(dt/1000));
    if(active.firstCatch>=0 && active.elapsed-active.firstCatch>=active.cfg.slipMs){ miss('The secured rings slipped.');return; }
    render();
  }

  function frame(now) {
    frameId=0;
    if(!session)return;
    const dt=lastFrame?clamp(now-lastFrame,0,50):16;
    lastFrame=now;
    tick(dt);
    if(session && root.querySelector('#chestLockDiagnostics')?.open && now-lastDebug>=DEBUG_INTERVAL_MS){
      lastDebug=now;debug.textContent=JSON.stringify(snapshot(),null,2);
    }
    if(session)frameId=requestAnimationFrame(frame); // Single short-lived animation loop; destroyed on close.
  }

  function onKey(event) {
    if(!session)return;
    if(!['keydown','keyup'].includes(event.type))return;
    const ring=KEYS.indexOf(event.code);
    if(ring<0 && event.code!=='Escape' && event.code!=='KeyB') {
      // Do not let gameplay keyboard hotkeys fire through the overlay.
      event.preventDefault();event.stopImmediatePropagation();return;
    }
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='keydown' && !event.repeat){
      if(event.code==='Escape'||event.code==='KeyB')close('cancelled');
      else catchRing(ring,'keyboard');
    }
  }

  function onPadFrame(padFrame){
    if(!session || !padFrame?.focused)return;
    if(padFrame.pressed?.has('Button1')){close('cancelled');return;}
    for(let i=0;i<session.cfg.rings;i++){
      if(padFrame.pressed?.has(BUTTONS[i])){catchRing(i,'controller');break;}
    }
  }

  function snapshot(){
    return {
      active:!!session, lastOutcome, lastError,
      chest:session?.id||null, tier:session?.tier||null, phase:session?.phase||null,
      rings:session?.rings?.map((ring,i)=>({index:i,name:ring.name,angle:+ring.angle.toFixed(2),target:+ring.target.toFixed(2),frozen:ring.frozen}))||[],
      stage:session?.stage||0, stages:session?.cfg?.stages||0, misses:session?.misses||0,
      remainingMs:!session||session.firstCatch<0?null:Math.max(0,Math.round(session.cfg.slipMs-(session.elapsed-session.firstCatch))),
      lastInput:session?.lastInput||null,
      controllerOwner:window.ControllerInput?.owner||null,
      actionLock:!!actionLock,
    };
  }

  function close(outcome='cancelled') {
    const finished=session;
    if(!finished)return false;
    session=null; // Prevents reentrancy and grants loot once even if callback opens another chest.
    lastOutcome={id:finished.id,outcome,tier:finished.tier,misses:finished.misses};
    if(frameId)cancelAnimationFrame(frameId);
    frameId=0;lastFrame=0;
    root?.setAttribute('aria-hidden','true');
    window.removeEventListener('keydown',onKey,true);
    window.removeEventListener('keyup',onKey,true);
    unsubscribePad?.();unsubscribePad=null;
    actionLock?.release?.();actionLock=null;
    if(window.ControllerInput?.owner===OWNER)window.ControllerInput.setOwner(priorOwner||'gameplay');
    if(document.activeElement?.closest?.('#chestLockOverlay'))document.activeElement.blur?.();
    try {
      if(outcome==='success') finished.onSuccess?.();
      else finished.onCancel?.(outcome);
    }catch(error){describeError(error);}
    return true;
  }

  function open(options={}) {
    if(session || typeof options.onSuccess!=='function')return false;
    if(typeof options.valid==='function'){
      try {if(options.valid()===false)return false;}catch(error){describeError(error);return false;}
    }
    ensureUi();
    if(!root)return false;
    const tier=clamp(Math.round(Number(options.tier)||1),1,4); // Shared tier selection used by ruin, buried, and cave-cache chests.
    const cfg=PRESETS[tier];
    session={id:String(options.id||'chest'),tier,cfg,valid:options.valid,onSuccess:options.onSuccess,onCancel:options.onCancel,
      phase:'playing',stage:0,misses:0,elapsed:0,rings:[],firstCatch:-1,transitionMs:0,lastInput:''};
    root.querySelector('#chestLockTitle').textContent=String(options.title||'Chest Lock');
    root.setAttribute('aria-hidden','false');
    makeRings();announce('Catch every rotating notch before the first ring slips.');
    priorOwner=window.ControllerInput?.owner||'gameplay';
    window.ControllerInput?.setOwner?.(OWNER);
    actionLock=window.CharacterActionLocks?.acquire?.({owner:OWNER,participants:[{id:'player',channels:['movement','actions','tools']}],reason:'Picking a chest lock'})||null;
    window.addEventListener('keydown',onKey,true);
    window.addEventListener('keyup',onKey,true);
    unsubscribePad=window.ControllerInput?.subscribe?.(OWNER,onPadFrame,25)||null; // One central poller, not one new getGamepads() loop per chest.
    try {if(document.pointerLockElement)document.exitPointerLock?.();}catch(_){/* Optional pointer-lock reset. */}
    closeButton?.focus?.({preventScroll:true});
    lastFrame=0;frameId=requestAnimationFrame(frame);
    return true;
  }

  window.ChestLockpicking=Object.freeze({open,close,isActive:()=>!!session,snapshot,catchRing,PRESETS});
})();
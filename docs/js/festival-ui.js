// Accessible activity menus; standard modal semantics opt into ControllerUI navigation.
(() => {
  'use strict';
  let root = null; // Lazily built so the game and standalone rule tests share the same module.
  let prop = null; // Authored activity anchor currently being inspected.
  let feastInspectIndex = null; // Indexed serving pot currently previewed in the reused festival modal.
  let eventId = ''; // Prevents stale menus surviving a festival/date change.
  let lock = null; // Existing character-action authority owns movement/tool blocking while the menu is open.
  let previousFocus = null; // Restored on dismissal for keyboard and controller users.
  let selection = {}; // Exact inventory quality and genotype variant selected for the ancestor offering.
  let offeringFilter = ''; // Search persists while the offering preview rerenders.
  let busy = false; // Stops double-clicked async activities and reward actions.
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); // Shared safe text interpolation.
  function system() { return window.FestivalSystem; }
  function button(label, action, disabled = false, extra = '') { return `<button type="button" data-festival-action="${action}" ${disabled ? 'disabled' : ''} ${extra}>${esc(label)}</button>`; }
  function ensure() {
    if (root) return;
    const style = document.createElement('style'); // Scoped styles support phone portrait/landscape and the existing game palette.
    style.textContent = '#festivalDialog{position:fixed;inset:0;z-index:1100;background:#071318bb;display:none;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}#festivalDialog .festival-card{width:min(620px,100%);max-height:85dvh;overflow:auto;background:#162622;color:#f3ebd8;border:2px solid var(--festival-color,#dbc296);border-radius:14px;padding:18px;box-sizing:border-box;box-shadow:0 15px 65px #0009}#festivalDialog h2{margin:0 0 6px;color:var(--festival-color)}#festivalDialog p{line-height:1.5}#festivalDialog button{min-height:44px;padding:9px 12px;margin:4px;border:1px solid #b5c4ac;border-radius:7px;background:#30483d;color:#fff;font:inherit}#festivalDialog button:disabled{opacity:.45}#festivalDialog .festival-options{display:flex;flex-wrap:wrap;gap:4px}#festivalDialog [aria-pressed=true]{background:#51652d;border:2px solid #ffe08a}#festivalDialog .festival-note{font-size:13px;color:#b8c8b9}#festivalDialog pre{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;font-size:12px}#festivalDialog .festival-status{padding:8px;background:#0c1916;border-radius:6px}';
    style.textContent += '#festivalDialog .festival-dish-picker{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:5px}#festivalDialog .festival-dish-picker button{margin:0;text-align:left;white-space:pre-line;overflow-wrap:anywhere}#festivalDialog .festival-dish-picker button[aria-pressed=true]{border-color:#ffe08a;background:#465b36}#festivalDialog .festival-dish-info{margin-top:14px;border-top:1px solid #68775f;padding-top:10px}#festivalDialog .festival-ingredient-list{list-style:none;padding:0;margin:8px 0}#festivalDialog .festival-ingredient-list li{padding:9px 4px;border-bottom:1px solid #56665a}#festivalDialog .festival-ingredient-list small{display:block;color:#b8c8b9;margin-top:3px}#festivalDialog .festival-dish-total{padding:7px 10px;background:#253a31;border-radius:6px}';
    style.textContent += '#festivalDialog .festival-card.festival-offering-view{width:min(860px,100%)}#festivalDialog .festival-offering-search{width:100%;min-height:44px;background:#0c1916;color:#fff;border:1px solid #879b81;border-radius:8px;padding:10px;font:inherit;box-sizing:border-box}#festivalDialog .festival-offering-group{margin:12px 0;padding:10px;background:#192e29;border:1px solid #44584e;border-radius:10px}#festivalDialog .festival-offering-group h3{margin:0 0 9px;font-size:17px}#festivalDialog .festival-offering-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:8px}#festivalDialog .festival-offering-choice{display:flex;gap:9px;align-items:flex-start;width:100%;margin:0;text-align:left;min-height:62px;padding:10px;background:#263d35}#festivalDialog .festival-offering-choice span{display:block;min-width:0;overflow-wrap:anywhere}#festivalDialog .festival-offering-choice small{display:block;color:#c0d4c6;line-height:1.35;font-size:12px;margin-top:4px}#festivalDialog .festival-offering-choice .festival-offering-icon{font-size:25px;min-width:30px;text-align:center}#festivalDialog .festival-offering-group[hidden],#festivalDialog .festival-offering-choice[hidden]{display:none}#festivalDialog .festival-offering-preview{background:#263a33;border:1px solid #8ca281;border-radius:10px;padding:12px;margin-top:14px}#festivalDialog .festival-offering-preview h3{margin:3px 0 8px}#festivalDialog .festival-offering-math{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:6px;padding:8px 0}#festivalDialog .festival-offering-math span{background:#10251e;border-radius:5px;padding:7px;font-size:12px}#festivalDialog .festival-offering-commit{font-weight:bold;border-color:#f7d991;background:#475b39;padding:12px 18px}';
    document.head.append(style);
    root = document.createElement('section');
    root.id = 'festivalDialog'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'festivalTitle'); root.setAttribute('data-ctrl-panel', '');
    root.innerHTML = '<div class="festival-card"><header><h2 id="festivalTitle"></h2><div id="festivalSubtitle" class="festival-note"></div></header><div id="festivalContent"></div><p id="festivalStatus" class="festival-status" role="status" hidden></p><footer><button type="button" data-festival-action="close" data-ctrl-cancel>Close</button><button type="button" data-festival-action="debug">Copy diagnostics</button></footer></div>';
    document.body.append(root);
    root.addEventListener('pointerdown', event => event.stopPropagation());
    root.addEventListener('pointerup', event => event.stopPropagation());
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
    root.addEventListener('click', event => { const target = event.target.closest('button[data-festival-action]'); if (target && !target.disabled) void handle(target); });
    root.addEventListener('input', event => { if (event.target.matches?.('[data-offering-filter]')) { offeringFilter=event.target.value; filterOfferingChoices(); } });
  }
  function filterOfferingChoices() {
    if (!root) return;
    const needle=offeringFilter.trim().toLocaleLowerCase(); // Filter existing offering cards without closing the mobile keyboard.
    for (const group of root.querySelectorAll('.festival-offering-group')) {
      let showing=0;
      for (const choice of group.querySelectorAll('.festival-offering-choice')) {
        choice.hidden=!!needle && !(choice.dataset.search || '').includes(needle);
        if (!choice.hidden) showing++;
      }
      group.hidden=!showing;
    }
    const empty=root.querySelector('[data-offering-no-results]'); // Search feedback for mobile users.
    if (empty) empty.hidden=!!root.querySelector('.festival-offering-choice:not([hidden])');
  }
  function offeringChoicesHtml(api) {
    const choices=api.qualityChoices('offering'); // Already separated by exact inherited genotype when applicable.
    const categories=new Map(); // Groups item cards by their independently tunable fortune effect.
    for (const choice of choices) {
      const id=choice.category || 'treasureFortune';
      if (!categories.has(id)) categories.set(id,[]);
      categories.get(id).push(choice);
    }
    let html='<label for="festivalOfferingFilter"><strong>Find an offering</strong></label><input id="festivalOfferingFilter" data-offering-filter class="festival-offering-search" type="search" placeholder="Search items, traits or fortunes" value="'+esc(offeringFilter)+'" autocomplete="off">';
    html+='<p class="festival-note">Different animal genotypes are separate choices, including hidden carriers; identical genotypes may stack. One yearly offering replaces the previous fortune.</p>';
    for (const [id,rows] of categories) {
      const def=window.FestivalCalendar.blessings[id]; // One authored definition supplies label, target and actual effect strength.
      html+='<section class="festival-offering-group"><h3>'+esc((def?.icon || '✨')+' '+(def?.label || id))+'</h3><p class="festival-note">'+esc(def?.target || 'Fortune')+'</p><div class="festival-offering-grid">';
      for (const choice of rows) {
        const selected=selection.key===choice.key && selection.stars===choice.stars && selection.variant===choice.variant;
        const traits=choice.traitSummary || '';
        const search=[choice.label,traits,def?.label,def?.target].filter(Boolean).join(' ').toLocaleLowerCase();
        const variant=typeof choice.variant==='string' ? ' data-variant="'+esc(choice.variant)+'"' : '';
        html+='<button type="button" class="festival-offering-choice" data-festival-action="select-item" data-search="'+esc(search)+'" data-key="'+esc(choice.key)+'" data-stars="'+choice.stars+'"'+variant+' aria-pressed="'+selected+'"><span class="festival-offering-icon">'+esc(choice.icon)+'</span><span><strong>'+esc(choice.label)+'</strong><small>'+esc('★'.repeat(choice.stars)+'☆'.repeat(5-choice.stars))+' · ×'+choice.count+'</small>'+(traits?'<small>'+esc(traits)+'</small>':'')+'</span></button>';
      }
      html+='</div></section>';
    }
    if (!choices.length) html+='<p class="festival-note">No suitable keepsakes or young animals in your bag.</p>';
    else html+='<p data-offering-no-results hidden class="festival-note">No offerings match this search.</p>';
    const preview=selection.key ? api.offeringPreview?.(selection.key,selection.stars,selection.variant) : null; // Matches the selected lineage rather than a generic species.
    const bless=preview && window.FestivalCalendar.blessings[preview.stat];
    if (preview && bless) {
      const amount=Math.round(bless.perLevel*preview.level*1000)/10; // Probability points are different from relative drop-weight boosts.
      const effect=bless.unit==='chance' ? '+'+amount+' percentage points' : '+'+amount+'% to the relevant chance or rarity weight';
      html+='<section class="festival-offering-preview" aria-label="Selected fortune"><h3>'+
        esc((preview.mode==='release'?'🐣 Release alive':'🔥 Offer to the pyre')+' · '+bless.icon+' '+bless.label)+
        '</h3><p>'+esc(preview.statement)+'</p><strong>'+esc(bless.description)+': '+effect+'</strong>'+
        '<p class="festival-note">Power '+esc(preview.level)+'/5 · Duration 336 game days · Target: '+esc(bless.target||bless.description)+'</p>'+
        '<div class="festival-offering-math"><span>Quality ×'+preview.qualityUnits.toFixed(2)+'</span><span>Source rarity ×'+preview.scarcityFactor.toFixed(2)+'</span>'+
        '<span>Value ×'+preview.valueFactor.toFixed(2)+'</span><span>Processing ×'+preview.effortFactor.toFixed(2)+'</span>'+
        (preview.traitFactor>1?'<span>Inherited traits ×'+preview.traitFactor.toFixed(2)+'</span>':'')+'</div>'+
        '<p class="festival-note">Known source: '+esc(preview.sourceLabel)+' ('+esc(preview.confidence)+'). Conditional source odds are not global drop rates.</p></section>';
    } else if (selection.key) html+='<p class="festival-note">This exact offering is no longer available. Select another.</p>';
    html+='<div class="festival-options">'+button(preview?.mode==='release'?'Confirm: release this exact animal':'Confirm: sacrifice this keepsake','perform',!preview,'class="festival-offering-commit"')+'</div>';
    return html;
  }
  function open(anchor = system().nearestActivity()) {
    if (!anchor || !system().atProp(anchor) || !system().festival()) return false;
    // A joinable locale begins through the ordinary Action input, without another festival menu.
    // Offerings, masks and gift selection retain their necessary inventory/choice menus.
    if (anchor.festivalLocale && ['dance','duel','story','music','remembrance'].includes(anchor.activity?.type)) {
      const result = system().perform(anchor.activity.type,{propId:anchor.id});
      return result === true || result?.ok === true;
    }
    ensure();
    close();
    prop = anchor; eventId = `${system().year()}:${system().festival().id}`; selection = {}; offeringFilter=''; previousFocus = document.activeElement;
    root.style.display = 'flex'; root.style.setProperty('--festival-color', system().festival().color);
    document.exitPointerLock?.();
    lock = window.CharacterActionLocks?.acquire?.({ owner: 'festival-menu', reason: 'Festival activity menu', participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }] });
    render();
    root.querySelector('button:not(:disabled)')?.focus();
    return true;
  }
  function openFeast(index = 0) {
    const api = system();
    if (api?.festival?.()?.id !== 'gorkunash' || !api.festivalHours?.()) return false;
    const meal = api.feastDishDetails?.(index);
    if (!meal || meal.id === 'reserved') return false;
    ensure();
    close();
    feastInspectIndex = index; // Open directly on the pot that was inspected in the world.
    eventId = `${api.year()}:${api.festival().id}`;
    previousFocus = document.activeElement;
    root.style.display = 'flex';
    root.style.setProperty('--festival-color', api.festival().color);
    document.exitPointerLock?.();
    lock = window.CharacterActionLocks?.acquire?.({owner:'festival-menu',reason:'Inspect festival dishes',participants:[{id:'player',channels:['movement','tools','actions']}]});
    render();
    root.querySelector('button:not(:disabled)')?.focus();
    return true;
  }
  function close() {
    if (root) root.style.display = 'none';
    lock?.release?.(); lock = null; prop = null; feastInspectIndex = null; eventId = '';
    previousFocus?.focus?.(); previousFocus = null;
  }
  function status(message) {
    if (!root) return;
    const output = root.querySelector('#festivalStatus'); // Live region reports reward/capacity/errors without the console.
    output.hidden = !message; output.textContent = message || '';
  }
  function render() {
    if (!prop && feastInspectIndex === null) return;
    const api = system(); // One rule authority for disabled state, preview, and commit.
    const f = api.festival();
    const type = feastInspectIndex !== null ? 'feast' : prop.activity.type;
    root.querySelector('#festivalTitle').textContent = type === 'feast' ? '🍲 Gorkunash potluck dishes'
      : `${f.icon} ${prop.activity.label || window.FestivalCalendar.activityLabels[type]}`;
    root.querySelector('#festivalSubtitle').textContent = `${f.name} · ${window.CalendarSystem.formatCalendarDate()} · gatherings ${api.gatheringHoursLabel()}`;
    const content = root.querySelector('#festivalContent');
    root.querySelector('.festival-card')?.classList?.toggle('festival-offering-view',type==='offering'); // Responsive width only for offerings.
    let html = '';
    if (type === 'feast') {
      const dishes = api.feastMenu(); // Same persisted seven-pot lineup that the furniture service serves.
      const chosen = api.feastDishDetails(feastInspectIndex);
      const describeEffects = effects => Object.entries(effects || {}).filter(([,amount])=>Number(amount)>0)
        .map(([effect,amount])=>window.CookingSystem?.formatEffectStrength?.(effect,amount) || `${effect} (+${amount})`);
      html = '<p class="festival-note">Contest points multiply ingredient star quality, processing depth and any known source rarity. The actual eating buffs still depend on quality and processing. The strongest dish in the competition may not give you the skill benefits you need today.</p>';
      html += `<h3>Compare dishes · day ${api.contestStandings()?.day || 1} of 7</h3><div class="festival-dish-picker">${dishes.map((meal,index)=>
        button(`${index+1}. ${meal.label} · ${meal.id==='reserved'?'Not yet entered':meal.score+' points'}\n${describeEffects(meal.foodEffects).slice(0,3).join(', ') || 'No food buffs recorded'}`,
          'inspect-pot', meal.id==='reserved', `data-pot-index="${index}" aria-pressed="${index===feastInspectIndex}"`)
      ).join('')}</div>`;
      if (chosen && chosen.id !== 'reserved') {
        html += `<section class="festival-dish-info"><h3>${esc(chosen.label)}</h3>`;
        html += `<p class="festival-dish-total"><strong>${chosen.score} contest points</strong> · ${chosen.ingredientDetails.length} ingredients</p>`;
        if (chosen.estimatedQuality) html += '<p class="festival-note">This older dish predates ingredient-quality records. Ingredient stars are estimated from finished-food quality; the saved contest score and eating buffs remain authoritative.</p>';
        if (chosen.estimatedEffects) html += '<p class="festival-note">Individual ingredient buffs are approximate for this older recipe; the total eating effects shown below are the stored values.</p>';
        const inspectedTotal = Math.round((chosen.ingredientDetails || []).reduce((sum,item)=>sum+(Number(item.points)||0),0)*100)/100; // Older saved entries may predate rarity snapshots.
        if (Math.abs((Number(chosen.score)||0)-inspectedTotal)>0.01) html += '<p class="festival-note">Historical score preserved. The ingredient breakdown reflects current source estimates because the original rarity multipliers were not recorded.</p>';
        html += '<h4>Ingredient quality and contribution</h4><ul class="festival-ingredient-list">';
        html += chosen.ingredientDetails.map(item=>{
          const contribution=describeEffects(item.effects).join(', ') || 'No cooking buff';
          const rarity = Number(item.rarityMultiplier) || 1; // Cook-time factor is authoritative for the preserved Gorkunash score.
          const math = rarity === 1 ? `${item.stars} × ${item.processingMultiplier ?? item.multiplier}`
            : `${item.stars} × ${item.processingMultiplier} processing × ${rarity.toFixed(2)} rarity (${item.raritySource || 'estimated'})`;
          return `<li><strong>${esc(item.icon)} ${esc(item.label)}</strong> · ${'★'.repeat(item.stars)}${'☆'.repeat(5-item.stars)} · ${esc(math)} = <strong>${item.points} points</strong><small>${esc(contribution)}</small></li>`;
        }).join('') || '<li>Original ingredient details were not recorded for this older dish.</li>';
        html += '</ul><h4>Effects when eaten</h4><div class="festival-dish-total">';
        html += describeEffects(chosen.foodEffects).map(value=>`<div>${esc(value)}</div>`).join('') || 'No recorded food buffs';
        html += '</div><p class="festival-note">Each seated bite gives five minutes of these buffs, up to fifty minutes total. Fullness still applies. To eat this dish, close the list and aim at its pot with a bowl to use Fill bowl.</p></section>';
      }
    } else if (type === 'welcome') {
      html = `<p>${esc(f.description)}</p><p class="festival-note">All roads, building entrances, and town exits remain open. Rewards are once per festival unless stated otherwise.</p><ul>${api.activityProps().filter(p => p.activity.type !== 'welcome').map(p => `<li>${esc(p.activity.label || window.FestivalCalendar.activityLabels[p.activity.type])} — town tile ${p.col}, ${p.row}</li>`).join('')}</ul>`;
    } else if (type === 'potluck' || type === 'offering') {
      const done = api.claimed(type);
      html = `<p>${type === 'potluck' && f.id==='gorkunash'
        ? 'Enter one cooked dish in the seven-day potluck competition. Every ingredient contributes its own star level; processed ingredients earn twice their source ingredient score per processing step, and known source rarity multiplies that result. Rivals have fixed quality ceilings. The seventh serving pot is yours for the rest of the festival. After the festival, Hreesh visits the winning cook with the Replica Helm of Bzabag. Your normal 10× friendly gift Favor still applies.'
        : type==='potluck'?'Give one cooked meal to the feast.':'Surrender a keepsake to the ancestor pyre, or release a baby animal alive. Item rarity, scarcity of its sources, its value, crafting effort and star quality multiply into a 336-day blessing. The type of offering determines its unique fortune; rarity, quality, effort and inherited animal traits determine its power.'}</p>`;
      if(type==='potluck'&&f.id==='gorkunash') {
        const bowl=api.festivalBowl();
        const dishes=api.feastMenu();
        html+=`<h3>Seven pots · day ${api.contestStandings()?.day || 1} of 7</h3><p class="festival-note">Feast hours: ${esc(api.gatheringHoursLabel())}. Pick up a temporary bowl, fill it with ten portions of one meal, then eat while sitting with the villagers. Each portion adds five minutes of that food buff (up to fifty). At 10/10 fullness, no more festival food can be eaten for eighteen in-game hours from the first serving.</p>`;
        html+=`<p>🥣 Bowl: ${bowl?.meal ? esc(bowl.meal.label)+' · '+bowl.uses+'/10':bowl?'empty · 0/10':'not held'} · Fullness ${api.currentFullness()}/10</p>`;
        html+=button('Take fresh bowl','take-bowl',!api.festivalHours());
        html+=`<div class="festival-options">${dishes.map((meal,index)=>button(`${meal.icon} Pot ${index+1}: ${meal.label}${meal.id==='reserved'?'':' · '+meal.score+'★'}`,'fill-bowl',!bowl||!api.festivalHours()||meal.id==='reserved',`data-pot-index="${index}"`)).join('')}</div>`;
        const standings=api.contestStandings?.();
        if(standings)html+=`<p class="festival-note">Current highest NPC entry: ${esc(standings.strongest?.label||'None')} · ${standings.strongest?.score||0}★. ${standings.entry ? 'Your entry: '+esc(standings.entry.label)+' · '+standings.entry.score+'★'+(standings.winning?' (currently ahead or tied).':' (try stronger ingredients next year).') : 'You have not entered yet.'}</p>`;
        html+=`<p class="festival-note">To eat: sit in a festival dining chair and use the Eat bowl prompt. Your character will take another bite every few seconds, with the normal Drink animation and a ${bowl?.uses ?? 0}/10 portion counter. Stand or switch equipment to stop.</p>`;
      }
      if (done) html += '<p class="festival-offering-preview">Your annual contribution is complete. Your fortune lasts 336 game days from the ceremony.</p>';
      else if (type==='offering') html += offeringChoicesHtml(api);
      else {
        html += '<div class="festival-options">'+api.qualityChoices(type).map(choice => button(choice.label+' · '+('★'.repeat(choice.stars))+' ×'+choice.count, 'select-item', false, 'data-key="'+esc(choice.key)+'" data-stars="'+choice.stars+'" aria-pressed="'+(selection.key===choice.key && selection.stars===choice.stars)+'"')).join('')+'</div>';
        html += button('Confirm: give one selected item','perform',!selection.key);
      }
    } else if (type === 'gifts' || type === 'sweets') {
      const candidates = type === 'sweets' ? api.residents() : api.getNpcs().filter(npc => !npc.deceased && !npc.dead && !String(npc.homeId || '').includes('deceased') && api.favorHearts(npc.id) >= 3);
      html = `<p>${type === 'gifts' ? 'Friends with at least three hearts have left high-potency restorative gifts for you. Collect each friend’s gift once this festival.' : 'Each townsfolk has one animal-shaped sweet for you this festival. Eat it through your normal inventory food action.'}</p><div class="festival-options">${candidates.map(npc => button(`${npc.name || npc.displayName || npc.id}${api.claimed(`${type === 'gifts' ? 'gift' : 'sweet'}:${npc.id}`) ? ' · collected' : ''}`, 'perform', api.claimed(`${type === 'gifts' ? 'gift' : 'sweet'}:${npc.id}`), `data-npc-id="${esc(npc.id)}"`)).join('') || '<p>No eligible friends yet. Build Favor through conversation and gifts.</p>'}</div>`;
    } else if (type === 'masks') {
      html = '<p>Choose one free animal mask. It is ordinary wearable clothing and stays yours after the festival.</p><div class="festival-options">' + api.MASKS.map(mask => button(mask, 'perform', api.claimed('mask'), `data-mask="${esc(mask)}"`)).join('') + '</div>';
    } else if (type === 'remembrance') {
      html = '<p>Little wooden carvings stand for the ancestors. Honor those lost, and appreciate the peace in death.</p><p>“Everyone gets a little engh-sho-ey today,” Kinami says of the Mashtzarr.</p><p class="festival-note">The offering shrine grants a year of targeted fortune based on the offering. Baby animals are released alive, never burned.</p>';
    } else {
      const descriptions = { dance: `${f.id === 'five_blossoms' ? 'The Five Blossom Dance' : 'The festival dance'}: stay in the marked court and dance for 20 seconds. Your first completed dance this festival earns +2 Favor with every townsfolk. You can dance again for pleasure.`, story: 'Hear Father Hunundi tell how laughter defeated the Hachutu and their magical masks.', duel: 'Spearhead supervises a safe, live sparring round with Oddclaw in this ring. Land three hits. Borrowed equipment and your original resources are restored when you finish or leave. First completion: +6 Favor with each of them.', music: 'Join the existing music minigame. The festival musician supplies live accompaniment when present.', liquor: 'The festival keg pours a free, already-filled cup. Hold it to drink or offer a swig (which earns Festival Fun) through the ordinary alcohol system, and refill whenever you like. It cannot be stowed or gifted.' }; // Mechanical promises shown before entering an activity.
      html = `<p>${esc(descriptions[type] || '')}</p>${button(window.FestivalCalendar.activityLabels[type], 'perform', false)}`;
    }
    content.innerHTML = html;
    if (type==='offering') filterOfferingChoices(); // Preserve the active search while updating the details pane.
    status('');
  }
  async function handle(target) {
    const action = target.dataset.festivalAction; // Standard click works with touch, keyboard, and ControllerUI.
    if (action === 'close') { close(); return; }
    if (action === 'debug') {
      const report = JSON.stringify(system().diagnostics(), null, 2);
      try { await navigator.clipboard.writeText(report); status('Diagnostics copied.'); }
      catch { const output = document.createElement('textarea'); output.value = report; output.style.cssText = 'width:100%;height:180px'; root.querySelector('#festivalContent').append(output); output.select(); status('Select and copy the diagnostics below.'); }
      return;
    }
    if ((!prop && feastInspectIndex === null) || busy) return;
    if (action === 'inspect-pot') {
      const index = Number(target.dataset.potIndex);
      const meal = system().feastDishDetails?.(index);
      if (meal && meal.id !== 'reserved') { feastInspectIndex=index; render(); }
      return;
    }
    if (['take-bowl','fill-bowl','eat-bowl'].includes(action)) {
      const result=action==='take-bowl'?system().takeFestivalBowl():
        action==='fill-bowl'?system().fillFestivalBowl(Number(target.dataset.potIndex)):
        system().eatFestivalBowl();
      render();status(result?.message||'');return;
    }
    if (action === 'select-item') { const panel=root.querySelector('.festival-card'); const top=panel?.scrollTop ?? 0; selection={key:target.dataset.key,stars:Number(target.dataset.stars),...(target.hasAttribute('data-variant')?{variant:target.dataset.variant}:{})}; render(); if(panel) panel.scrollTop=top; return; }
    if (action !== 'perform') return;
    busy = true; target.disabled = true;
    try {
      const result = await system().perform(prop.activity.type, { ...selection, propId: prop.id, npcId: target.dataset.npcId, mask: target.dataset.mask });
      if (prop) { render(); status(result?.message); }
    } catch (error) { status(`Activity could not complete: ${error.message}`); }
    finally { busy = false; }
  }
  function update() {
    if (feastInspectIndex !== null) {
      if (eventId !== `${system().year()}:${system().festival()?.id}` || !system().festivalHours?.()) close();
      return;
    }
    if (prop && (!system().atProp(prop) || eventId !== `${system().year()}:${system().festival()?.id}`)) close();
  }
  window.FestivalUI = { open, openFeast, close, update, isOpen: () => !!prop || feastInspectIndex !== null };
})();

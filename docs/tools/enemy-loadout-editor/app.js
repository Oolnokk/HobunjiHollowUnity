import { EnemyPreview } from './preview.js?v=20261030revertedFacing9';
const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'hobunji.enemyLoadoutWorkshop.v1';
const state = {
  kind: 'bandit:grunt',
  tab: 'weapons',
  data: null,
  busy: false,
  history: [],
  selected: null,
  ready: false,
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 4500);
}
function log(text) {
  const area = $('log');
  area.textContent = (
    area.textContent +
    '\n' +
    new Date().toLocaleTimeString() +
    ' · ' +
    text
  ).slice(-18000);
  area.scrollTop = area.scrollHeight;
}
const preview = new EnemyPreview($('stage'), log);
preview.onTimeline = (p, phase) => {
  if (document.activeElement !== $('scrub')) $('scrub').value = p;
  if ($('phaseLabel').textContent !== phase)
    $('phaseLabel').textContent = phase;
};
function setBusy(value) {
  state.busy = value;
  $('poolPanel').inert = value;
  $('ruleEditor').disabled = value;
  $('tier').disabled = value;
  $('townValue').disabled = value;
  $('seed').disabled = value;
  for (const id of [
    'rollBtn',
    'replayBtn',
    'batchBtn',
    'importBtn',
    'resetRepoBtn',
    'applyRuleBtn',
    'resetRuleBtn',
  ])
    $(id).disabled = value;
  for (const button of document.querySelectorAll(
    '.enemy-button,.history-card',
  ))
    button.disabled = value;
}
function rules() {
  return window.EnemyLoadoutRules.snapshot();
}
function rule() {
  return rules().rules[state.kind] || {};
}
function persist(data) {
  window.EnemyLoadoutRules.set(data);
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    $('draftState').textContent = 'Draft saved on this device';
  } catch (_) {
    $('draftState').textContent = 'Draft in memory · export to keep';
  }
  updateRuleJson();
  $('ruleBadge').textContent = Object.keys(rule()).length
    ? 'Authored pools'
    : 'Game defaults';
}
function mutate(fn) {
  const data = rules();
  data.rules[state.kind] ||= {};
  fn(data.rules[state.kind]);
  if (!Object.keys(data.rules[state.kind]).length)
    delete data.rules[state.kind];
  try {
    persist(data);
  } catch (e) {
    toast(e.message);
    throw e;
  }
}
function pathGet(obj, path) {
  return path.reduce((v, k) => v?.[k], obj);
}
function pathSet(obj, path, value) {
  let target = obj;
  for (const key of path.slice(0, -1)) target = target[key] ||= {};
  if (value === undefined) {
    delete target[path.at(-1)];
    for (let i = path.length - 2; i >= 0; i--) {
      const p = path.slice(0, i + 1);
      if (Object.keys(pathGet(obj, p) || {}).length === 0) {
        let o = obj;
        for (const k of p.slice(0, -1)) o = o[k];
        delete o[p.at(-1)];
      }
    }
  } else target[path.at(-1)] = value;
}
function updateRuleJson() {
  if (document.activeElement !== $('ruleEditor'))
    $('ruleEditor').value = JSON.stringify(rule(), null, 2);
  $('ruleError').textContent = '';
}
function labelFor(id) {
  return (
    state.optionLabels?.get(id) ||
    state.data?.species[id]?.label ||
    window.AlchemySystem?.RECIPE_DEFS?.[id]?.label ||
    state.data?.shapes[id]?.label ||
    state.data?.metals[id]?.label ||
    window.Combat?.previewAbilities?.[id]?.label ||
    preview.cosmetics?.optionCache?.get(id)?.label ||
    preview.cosmetics?.optionCache?.get('appearance::' + id)?.label ||
    id.replace(/^dye:CLOTH:/, '').replaceAll('_', ' ')
  );
}
function library() {
  const filter = $('enemySearch').value.trim().toLowerCase();
  const list = $('enemyList');
  list.replaceChildren();
  let group = '';
  for (const type of window.EnemyLoadoutSourceData.types) {
    if (filter && !type.label.toLowerCase().includes(filter)) continue;
    if (type.group !== group) {
      list.append(el('div', 'enemy-group', type.group));
      group = type.group;
    }
    const b = el(
      'button',
      'enemy-button' + (state.kind === type.id ? ' active' : ''),
      type.label,
    );
    b.dataset.enemy = type.id;
    b.onclick = () => selectKind(type.id);
    b.disabled = state.busy;
    list.append(b);
  }
  $('typeCount').textContent = window.EnemyLoadoutSourceData.types.length;
}
function pool(
  title,
  path,
  defaults,
  catalog = [],
  hint = 'Relative weights · 0 excludes a choice',
  chanceDefault = null,
) {
  const value = pathGet(rule(), path);
  const isClothing = path[0] === 'clothing';
  const enabled = value != null;
  const weights = enabled ? (isClothing ? value.items : value) : defaults;
  const box = el('section', 'pool' + (enabled ? '' : ' disabled'));
  const header = el('div', 'pool-head');
  const label = el('label');
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.checked = enabled;
  label.append(toggle, document.createTextNode(title));
  header.append(
    label,
    el('span', 'native', enabled ? 'OVERRIDE' : 'NATIVE'),
  );
  if (isClothing) {
    label.replaceChildren(document.createTextNode(title));
    header.querySelector('.native')?.remove();
    const mode = el('select', 'clothing-mode');
    mode.setAttribute('aria-label', title + ' clothing mode');
    for (const [id, text] of [
      ['native', 'Game defaults'],
      ['custom', 'Custom choices'],
      ['never', 'Leave empty'],
    ]) {
      const opt = el('option', null, text);
      opt.value = id;
      mode.append(opt);
    }
    mode.value = !enabled
      ? 'native'
      : value.chance === 0
        ? 'never'
        : 'custom';
    mode.onchange = () => {
      const choices = Object.fromEntries(
        Object.entries(defaults).filter(
          ([id, w]) => id !== 'none' && w > 0,
        ),
      );
      const total = Object.values(defaults).reduce(
        (sum, w) => sum + Number(w),
        0,
      );
      const chosen = Object.values(choices).reduce(
        (sum, w) => sum + Number(w),
        0,
      );
      let chance =
        total && chosen ? ((chanceDefault ?? 1) * chosen) / total : 1;
      if (!chosen) {
        const first = catalog.find((id) => id !== 'none');
        if (first) choices[first] = 1;
        else chance = 0;
      }
      mutate((r) =>
        pathSet(
          r,
          path,
          mode.value === 'native'
            ? undefined
            : mode.value === 'never'
              ? { chance: 0, items: { none: 1 } }
              : {
                  chance,
                  items: Object.keys(choices).length
                    ? choices
                    : { none: 1 },
                },
        ),
      );
      renderPools();
    };
    header.append(mode);
    box.classList.remove('disabled');
    const worn = (state.selected?.roster?.equippedCosmetics || []).filter(
      (id) =>
        (state.selected.roster.cosmeticSlots?.[id] ||
          preview.cosmetics.optionCache.get(id)?.slot) === path[1],
    );
    box.append(
      el(
        'p',
        'currently-worn',
        'Currently shown: ' + (worn.map(labelFor).join(', ') || 'Empty'),
      ),
    );
  }
  box.append(header, el('p', 'pool-hint', hint));
  if (isClothing && box.querySelector('.currently-worn'))
    box.append(box.querySelector('.currently-worn'));
  if (isClothing && (!enabled || value.chance === 0)) {
    box.append(
      el(
        'p',
        'clothing-summary',
        enabled
          ? 'Nothing will spawn in this slot.'
          : 'Default wear chance: ' +
              Math.round((chanceDefault ?? 0) * 100) +
              '%. Choices: ' +
              Object.keys(defaults)
                .map((id) => (id === 'none' ? 'No item' : labelFor(id)))
                .join(', '),
      ),
    );
    $('poolPanel').append(box);
    return;
  }
  const setPool = (next) =>
    mutate((r) =>
      pathSet(
        r,
        path,
        isClothing
          ? { chance: value?.chance ?? chanceDefault ?? 1, items: next }
          : next,
      ),
    );
  toggle.onchange = () => {
    mutate((r) =>
      pathSet(
        r,
        path,
        toggle.checked
          ? isClothing
            ? { chance: chanceDefault ?? 1, items: clone(defaults) }
            : clone(defaults)
          : undefined,
      ),
    );
    renderPools();
  };
  if (isClothing) {
    const line = el('label', 'chance', 'Chance to wear (%)');
    const n = el('input');
    n.type = 'number';
    n.min = '0';
    n.max = '100';
    n.step = '5';
    n.value = Math.round(100 * (enabled ? value.chance : chanceDefault));
    n.disabled = !enabled;
    n.onchange = () => {
      mutate((r) => {
        pathGet(r, path).chance = Number(n.value) / 100;
      });
      renderPools();
    };
    line.append(n);
    box.append(line);
  }
  if (isClothing)
    box.append(
      el(
        'p',
        'pool-hint',
        'Choose one article per spawn. Weights control how often each option wins.',
      ),
    );
  const all = Object.entries(weights || {});
  const total = all.reduce((n, [, w]) => n + Number(w), 0);
  const list = el('div', 'weight-list');
  for (const [id, weight] of all) {
    const row = el('div', 'weight-row');
    const name = el(
      'span',
      'name',
      id === 'none' && isClothing ? 'No item' : labelFor(id),
    );
    name.title = id;
    if (path[0] === 'dyes') {
      const color = id.startsWith('#') ? id : state.dyeColors?.get(id);
      if (color) {
        const swatch = el('i', 'swatch');
        swatch.style.backgroundColor = color;
        name.prepend(swatch);
      }
    }
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.max = '1000000';
    input.step = '.1';
    input.value = weight;
    input.disabled = !enabled;
    input.setAttribute('aria-label', title + ' weight for ' + id);
    input.onchange = () => {
      const next = { ...weights, [id]: Number(input.value) };
      try {
        setPool(next);
        renderPools();
      } catch (_) {
        input.value = weight;
      }
    };
    const remove = el('button', null, '×');
    remove.title = 'Remove ' + id;
    remove.disabled = !enabled;
    remove.onclick = () => {
      const next = { ...weights };
      delete next[id];
      if (!Object.values(next).some((w) => w > 0)) {
        toast(
          isClothing
            ? 'Keep one clothing option, or choose Leave empty.'
            : 'Keep at least one positive choice, or disable the override.',
        );
        return;
      }
      setPool(next);
      renderPools();
    };
    row.append(
      name,
      input,
      el(
        'span',
        'percent',
        total ? ((weight / total) * 100).toFixed(0) + '%' : '—',
      ),
      remove,
    );
    list.append(row);
  }
  box.append(list);
  if (enabled) {
    const line = el('div', 'add-choice');
    const idInput = el(isClothing ? 'select' : 'input');
    idInput.placeholder = 'Choose or type an ID…';
    idInput.setAttribute('aria-label', 'Add ' + title + ' choice');
    const listId = 'choices-' + path.join('-');
    const datalist = el('datalist');
    datalist.id = listId;
    for (const id of [...new Set(catalog)].filter(
      (id) => !isClothing || id !== 'none',
    )) {
      const option = el('option');
      option.value = id;
      option.label = labelFor(id);
      if (isClothing) {
        option.textContent = id === 'none' ? 'No item' : labelFor(id);
        idInput.append(option);
      } else datalist.append(option);
    }
    idInput.setAttribute('list', listId);
    const add = el('button', null, isClothing ? 'Add option' : '+');
    add.title = 'Add weighted choice';
    add.onclick = () => {
      const id = idInput.value.trim();
      if (!id) return;
      if (
        !catalog.includes(id) &&
        !(path[0] === 'dyes' && /^#[0-9a-f]{6}$/i.test(id))
      ) {
        toast('Choose an ID from the available catalog.');
        return;
      }
      setPool({ ...weights, [id]: 1 });
      renderPools();
    };
    line.append(idInput, add, datalist);
    box.append(line);
  }
  $('poolPanel').append(box);
}
function scalar(title, key, fallback) {
  const box = el('section', 'pool');
  const label = el('label', 'chance', title);
  const check = el('input');
  check.type = 'checkbox';
  check.checked = rule()[key] != null;
  const input = el('input');
  input.type = 'number';
  input.min = '0';
  input.max = '1';
  input.step = '.05';
  input.value = rule()[key] ?? fallback;
  input.disabled = !check.checked;
  check.onchange = () => {
    mutate((r) => {
      if (check.checked) r[key] = Number(input.value);
      else delete r[key];
    });
    renderPools();
  };
  input.onchange = () => {
    try {
      mutate((r) => {
        r[key] = Number(input.value);
      });
    } catch (_) {
      renderPools();
    }
  };
  label.prepend(check);
  label.append(input);
  box.append(label);
  $('poolPanel').append(box);
}
// Optional per-enemy body proportions, in the Animation Author's Character Rig Scale units (width / height / head as % of the
// authored size, head Y offset as % of model height). Only checked fields are written to the rules; they are applied in game at spawn.
function bodyDefaults(species, gender) {
  const troop = state.kind.startsWith('maskbound:')
    ? window.MaskboundGuardianCombat?.troopTypes?.[state.kind.split(':')[1]]
    : null;
  if (troop)
    return {
      x: troop.anatomy.rigScaleX,
      y: troop.anatomy.rigScaleY,
      head: troop.anatomy.headScale,
      offsetY: troop.anatomy.headOffsetY,
    };
  const special = window.SpecialHarlyaoLiches?.DATA?.[state.kind.split(':')[1]]; // Named bosses start from their exact custom stature, not normal skeleton proportions.
  if (state.kind.split(':').length === 3 && special?.scale) return window.SpecialHarlyaoLiches?.rigScaleFor?.(state.kind.split(':')[1]) || {x:1,y:1,head:1,offsetY:0}; // Editor controls are the exact relative-to-species boss body dimensions applied in game.
  const base = window.HobunjiCharacterRigScale?.scaleFor?.(species, gender);
  return base
    ? { x: base.x, y: base.y, head: base.head, offsetY: base.offsetY }
    : { x: 1, y: 1, head: 1, offsetY: 0 };
}
let proportionPreviewTimer = null;
// Body edits only change the saved rule; the enemy is built from it, so replay the current seed (debounced, and retried while a build is running) to show the new head/torso proportions without a manual roll.
function queueProportionPreview() {
  clearTimeout(proportionPreviewTimer);
  proportionPreviewTimer = setTimeout(() => {
    if (state.busy) queueProportionPreview();
    else if (state.ready) roll(false);
  }, 350);
}
function renderBodyProportions(species, gender) {
  const defaults = bodyDefaults(species, gender);
  const ranges = window.EnemyLoadoutRules.rigScaleRanges;
  const fields = [
    ['x', 'Body width (%)', 2.5],
    ['y', 'Body height (%)', 2.5],
    ['head', 'Head scale (%)', 2.5],
    ['offsetY', 'Head Y offset (%)', 0.5],
  ];
  const box = el('section', 'pool');
  box.append(
    el(
      'p',
      'help',
      'Same four values as Character Rig Scale in the Multi-Avatar Animation Author. Camera framing stays at the unmodified species size so changing body width/height visibly resizes the actual portrait, not just hands and pants. Tick a value to override ' +
        (state.kind.startsWith('maskbound:') ? 'this troop’s' : 'the species') +
        ' default for this enemy; unticked values keep the default. Overrides are saved with the spawn rules and used in game.',
    ),
  );
  for (const [key, title, step] of fields) {
    const label = el('label', 'chance', title);
    const check = el('input');
    check.type = 'checkbox';
    check.checked = rule().rigScale?.[key] != null;
    const input = el('input');
    input.type = 'number';
    input.step = String(step);
    input.min = String(ranges[key][0] * 100);
    input.max = String(ranges[key][1] * 100);
    input.value = (
      (rule().rigScale?.[key] ?? defaults[key]) * 100
    ).toFixed(1);
    input.disabled = !check.checked;
    const hint = el('span', 'muted', ' default ' + (defaults[key] * 100).toFixed(1));
    const write = () => {
      mutate((r) => {
        if (check.checked) {
          const [lo, hi] = ranges[key];
          r.rigScale ||= {};
          r.rigScale[key] = Math.min(hi, Math.max(lo, Number(input.value) / 100));
        } else if (r.rigScale) {
          delete r.rigScale[key];
          if (!Object.keys(r.rigScale).length) delete r.rigScale;
        }
      });
      queueProportionPreview();
    };
    check.onchange = () => {
      write();
      renderPools();
    };
    input.onchange = () => {
      try {
        write();
      } catch (_) {
        renderPools();
      }
    };
    label.prepend(check);
    label.append(input, hint);
    box.append(label);
  }
  const gate = el('label', 'chance', 'Head gate');
  const gateSelect = el('select');
  for (const [value, text] of [
    ['', 'Game default (tight; legacy for Mashtzarr/Mammakhbuur)'],
    ['tight', 'Tight box — ends just below the skull'],
    ['legacy', 'Legacy — wide box, long fade'],
    ['mask', 'Head + head cosmetics mask (experimental)'],
  ]) {
    const option = el('option', null, text);
    option.value = value;
    gateSelect.append(option);
  }
  gateSelect.value = rule().headGate || '';
  gateSelect.onchange = () => {
    mutate((r) => {
      if (gateSelect.value) r.headGate = gateSelect.value;
      else delete r.headGate;
    });
    queueProportionPreview();
  };
  gate.append(
    gateSelect,
    el('span', 'muted', ' which part of the portrait head scale controls; the rest (hood, shoulders, vest) follows body width/height'),
  );
  box.append(gate);
  const patterns = el('label', 'chance', 'Procedural mask patterns');
  const patternsCheck = el('input');
  patternsCheck.type = 'checkbox';
  patternsCheck.checked = rule().maskPatterns !== false;
  patternsCheck.onchange = () => {
    mutate((r) => {
      if (patternsCheck.checked) delete r.maskPatterns;
      else r.maskPatterns = false;
    });
  };
  patterns.prepend(patternsCheck);
  patterns.append(
    el('span', 'muted', ' random Hachutu glyph + overpass, each in its own iridescent colour'),
  );
  box.append(patterns);
  const scaleRow = el('label', 'chance', 'Pattern scale % (min / max of authored)');
  const scaleInputs = ['min', 'max'].map((side) => {
    const input = el('input');
    input.type = 'number';
    input.step = '5';
    input.min = '5';
    input.max = '200';
    input.placeholder = side === 'min' ? '25' : '100';
    input.value = rule().maskPatternScale?.[side] != null ? String(Math.round(rule().maskPatternScale[side] * 100)) : '';
    input.onchange = () =>
      mutate((r) => {
        const entry = { ...(r.maskPatternScale || {}) };
        const raw = input.value.trim();
        if (raw === '') delete entry[side];
        else entry[side] = Math.min(2, Math.max(0.05, Number(raw) / 100));
        if (Object.keys(entry).length) r.maskPatternScale = entry;
        else delete r.maskPatternScale;
      });
    return input;
  });
  scaleRow.append(' ', scaleInputs[0], ' / ', scaleInputs[1], el('span', 'muted', ' blank = game default (25 / 100)'));
  box.append(scaleRow);
  const apply = el('button', null, 'Roll with these proportions');
  apply.onclick = () => roll(false);
  box.append(apply);
  $('poolPanel').append(box);
}
function renderBossSettings(special) {
  const type=state.kind.split(':')[1]; // Runtime boss tradition selects the ability set rather than hand-entered editor copies.
  const names=type==='hronal'
    ? {switchSeconds:'Seconds between magic and melee',meleeCooldownSeconds:'Warhammer attack cooldown (seconds)',meleeDamage:'Warhammer damage'}
    : type==='tothal'
      ? {specialCooldownSeconds:'Seconds between kneeling barrages',kneelDurationSeconds:'Time kneeling and vulnerable (seconds)',barrageIntervalSeconds:'Seconds between overlapping icicle waves'}
      : {specialCooldownSeconds:'Seconds between charge sequences',chargeSpeedTiles:'Charge speed (tiles/second)',chargeCount:'Consecutive charges',chargeMaxTiles:'Maximum tiles per charge',blastRadiusTiles:'Concussive blast radius (tiles)',blastDamage:'Concussive blast damage',plasmDurationSeconds:'Trail plasm lifetime (seconds)'};
  const defaults=window.SpecialHarlyaoLiches.BOSS_DEFAULTS[type]; // Same constants as the actual boss combat module.
  const ranges=window.EnemyLoadoutRules.bossRanges; // Shared validation used by import, export, and runtime.
  const container=el('section','pool');
  container.append(el('h3',null,'Named-boss combat tuning'),el('p','help','Check a value to override the shipped boss default. These values affect the real encounter after you export the rule file.'));
  for(const [key,labelText] of Object.entries(names)) {
    const row=el('label','chance',labelText);
    const enabled=el('input');enabled.type='checkbox';enabled.checked=rule().bossSettings?.[key]!=null;
    const input=el('input');input.type='number';input.min=ranges[key][0];input.max=ranges[key][1];input.step=key==='chargeCount'?'1':'0.05';input.value=rule().bossSettings?.[key] ?? defaults[key];input.disabled=!enabled.checked;
    const hint=el('small','muted',' default '+defaults[key]);
    const commit=()=>{
      try { mutate(r=>pathSet(r,['bossSettings',key],enabled.checked?Number(input.value):undefined));renderPools(); }
      catch(_) {renderPools();}
    };
    enabled.onchange=commit;input.onchange=commit;
    row.prepend(enabled);row.append(input,hint);container.append(row);
  }
  $('poolPanel').append(container);
}
function renderBossAppearance(special, tab) {
  const box=el('section','pool');
  box.append(el('h3',null,tab==='weapons'?'Signature weapon':'Signature colors and glyph'),
    el('p','help','The guardian’s Body Color C is shared by eye glow, robe motif and ruin walls. An authored Body Color C swatch takes priority over this fallback; unchecked fields keep the canonical preset.'));
  const settings=tab==='weapons'
    ? [['weaponKey','Warhammer tool key',special.weapon || 'warhammer_nativeCopper','text']]
    : [['glyphId','Harlyao glyph',special.glyph,'glyph'],['ink','Body Color 3 override (hex); default is the inverse of the robe color',window.SpecialHarlyaoLiches.inverseRobeColor(state.kind.split(':')[1]) || special.ink,'color'],['robeDye','Robe dye ID',special.dye,'text']];
  for(const [key,labelText,fallback,type] of settings) {
    const row=el('label','chance',labelText);
    const enabled=el('input');enabled.type='checkbox';enabled.checked=rule().bossAppearance?.[key]!=null;
    let input;
    if(type==='glyph') {
      input=el('select');
      for(const id of window.EnemyLoadoutRules.bossGlyphIds) {
        const option=el('option',null,id.replace('harlyao_glyph_',''));option.value=id;input.append(option);
      }
    } else {input=el('input');input.type=type==='color'?'color':'text';input.style.maxWidth='13rem';}
    input.value=rule().bossAppearance?.[key] || fallback;input.disabled=!enabled.checked;
    const commit=()=>{try{mutate(r=>pathSet(r,['bossAppearance',key],enabled.checked?input.value:undefined));renderPools();}catch(_){renderPools();}};
    enabled.onchange=commit;input.onchange=commit;
    row.prepend(enabled);row.append(input);box.append(row);
  }
  const patternKind = tab === 'weapons' ? 'weaponPattern' : 'clothingPattern';
  const patternRow = el('div', 'chance');
  const authored = rule().bossAppearance?.[patternKind];
  patternRow.append(
    el('span', 'muted', tab === 'weapons' ? 'Hammer metal pattern: ' : 'Robe and pants pattern: '),
    el('span', 'muted', authored ? (authored.patternLibraryId ? 'library ' + authored.patternLibraryId : 'custom drawing') : 'canonical glyph '),
  );
  const open = el('button', null, authored ? 'Edit pattern…' : 'Author pattern…');
  open.onclick = () => openBossPatternEditor(special, patternKind);
  patternRow.append(open);
  if (authored) {
    const clear = el('button', null, 'Use canonical glyph');
    clear.onclick = () => { mutate((r) => pathSet(r, ['bossAppearance', patternKind], undefined)); queueProportionPreview(); renderPools(); };
    patternRow.append(clear);
  }
  box.append(patternRow);
  $('poolPanel').append(box);
}
// Opens the shared Pattern editor (the same UI the game, Pattern Editor and house/furniture tools use) for one named guardian.
async function openBossPatternEditor(special, patternKind) {
  if (!window.PatternAuthoring?.openEditor) { toast('Pattern editor is not loaded.'); return; }
  await window.RepoPatternLibrary?.load?.().catch(() => {});
  const type = state.kind.split(':')[1];
  const weapon = patternKind === 'weaponPattern';
  const current = window.SpecialHarlyaoLiches.patternFor(type, patternKind); // Authored pattern, else the canonical glyph.
  const dye = (id) => window.ScratchbonesAccount?.getDyeCatalog?.().find((entry) => entry.id === id)?.hex;
  const cloth = dye(rule().bossAppearance?.robeDye || special.dye) || '#c76a1f';
  const ink = window.SpecialHarlyaoLiches.bodyColor3For(type); // Authored C swatch, Workshop override, else the inverse of the robe color.
  const toolKey = rule().bossAppearance?.weaponKey || special.weapon || 'warhammer_nativeCopper';
  const sprite = state.data?.shapes?.[toolKey.split('_')[0]]?.baseSprite || 'assets/toolsprites/warhammer.png';
  const editable = { frameShape: 'triangle', frameScale: 1, frameRotationDeg: 0, frameX: 0, frameY: 0, motifScale: 1, tiling: true, ...((await window.FurniturePatternSurfaces?.editablePattern?.({ pattern: current })) || current) }; // The canonical glyph carries no frame fields; give the editor sane starting values.
  const authored = rule().bossAppearance?.[patternKind];
  window.PatternAuthoring.openEditor({
    title: (weapon ? 'Weapon pattern — ' : 'Robe and pants pattern — ') + special.name,
    motifHint: weapon ? 'Draw the motif painted in Body Color 3 onto the hammer’s silver plating.' : 'Draw the motif woven into the robe and pants (it uses the guardian’s Body Color C).',
    initialPattern: editable,
    initialPatternLibraryId: authored?.patternLibraryId || null,
    library: window.PatternLibrary ? {
      list: () => window.PatternLibrary.listAvailable(),
      get: (id) => window.PatternLibrary.getById(id),
      save: (label, data) => window.PatternLibrary.saveToLibrary(label, data),
      remove: (id) => window.PatternLibrary.removeSaved(id),
    } : null,
    renderPreview: (data) => weapon
      ? window.ToolMetalRecolor.getRecoloredCanvas(sprite, { targetHex: ink, verdigrisHex: '#C0C0C0', oxidationAmount: 1, authoredPattern: data }) // Silver plating painted in Body Color 3.
      : window.FurniturePatternSurfaces.renderTile({ solid: false, palette: [cloth, ink, ink] }, data),
    onSave: async (data, libraryId) => {
      mutate((r) => pathSet(r, ['bossAppearance', patternKind], libraryId ? { patternLibraryId: libraryId } : { pattern: JSON.parse(JSON.stringify(data)) }));
      queueProportionPreview();
      renderPools();
      return true;
    },
  });
}
function renderPools() {
  if (!state.ready) return;
  $('poolPanel').replaceChildren();
  $('poolHelp').textContent =
    state.tab === 'clothing'
      ? 'Choose game defaults, custom spawn choices, or an empty slot. Preview clothing changes to see your edits.'
      : 'Unchecked pools use the game generator. Enable a pool to replace its choices; changes affect the next roll.';
  const d = window.EnemyLoadoutSourceData.defaults(state.kind, state.data);
  const current = state.selected?.roster?.appearance || {};
  const species = current.speciesId || Object.keys(d.species)[0];
  const gender = current.gender || 'male';
  const fighter = window
    .getPortraitFighters()
    .find((f) => f.speciesId === species && f.gender === gender);
  const opts = preview.cosmetics.optionCache;
  const cosmeticIds = [...opts.keys()];
  const dyeIds =
    window.ScratchbonesAccount?.getDyeCatalog?.().map((dye) => dye.id) ||
    Object.keys(d.dyes);
  const note = $('specialNote');
  note.textContent = d.special
    ? d.special.name + ' · exclusive key-stone guardian. Body proportions, combat cadence, colors, signature glyphs and attacks are editable; export enemy-loadouts.json to use changes in game.'
    : d.lich
      ? 'Ordinary liches keep their tradition’s spell AI. Primary/summon toggles affect that AI; the viewport previews the shared casting gesture.'
    : d.mount
      ? 'Mount: ' +
        d.mount +
        '. The preview uses the compound rider/body renderer.'
      : 'Native clothing rolls retain species restrictions, forced headwear, armor and pants rules. Overriding a slot deliberately replaces that slot’s native roll.';
  if (state.tab === 'body') {
    renderBodyProportions(species, gender);
    updateRuleJson();
    return;
  }
  if (state.tab === 'weapons') {
    if (d.lich) {
      if(d.special?.weapon) renderBossAppearance(d.special,'weapons'); // Azgarlu's visible enchanted hammer has its own editable authored tool key.
      $('poolPanel').append(
        el(
          'p',
          'help',
          d.special
            ? (d.special.weapon ? 'This boss holds an enchanted warhammer for melee, then alternates to magic. Signature glyph and robe color are under Species & dyes.' : 'This boss uses spellcasting poses and its exclusive attack phase; edit its combat cadence in Attacks.')
            : 'Ordinary liches carry an invisible casting tool. Primary/summon toggles affect its spell AI.',
        ),
      );
      updateRuleJson();
      return;
    }
    const nativeShapes = state.kind.startsWith('bandit:')
      ? window.WeaponTrustBanditLoadouts?.allowedMeleeShapes(species)
      : null;
    const nativeWeapons = nativeShapes?.length
      ? Object.fromEntries(nativeShapes.map((id) => [id, 1]))
      : d.weapons;
    pool(
      'Melee weapon shape',
      ['weapons'],
      nativeWeapons,
      Object.keys(state.data.shapes).filter((k) =>
        state.data.shapes[k].slots.includes('weapon'),
      ),
    );
    const metalDefaults = {};
    if (
      d.tribe ||
      state.kind.startsWith('maskbound:') ||
      state.kind.includes('skeleton')
    )
      metalDefaults.nativeCopper = 1;
    else {
      const range = state.data.gang.weaponMetalTierRangeByRank[d.rank] || [
        1, 2,
      ];
      for (const [id, m] of Object.entries(state.data.metals))
        if (
          m.tier >= range[0] &&
          m.tier <= range[1] + Number($('tier').value)
        )
          metalDefaults[id] = 1;
    }
    pool(
      'Weapon metal',
      ['metals'],
      metalDefaults,
      Object.keys(state.data.metals).filter(
        (k) => state.data.metals[k].tier,
      ),
    );
    scalar(
      'Chance of ranged weapon',
      'rangedChance',
      d.tribe || d.lich || state.kind.startsWith('maskbound:')
        ? 0
        : state.data.gang.rangedWeaponChanceByRank[d.rank] || 0,
    );
    pool(
      'Ranged weapon',
      ['ranged'],
      state.selected?.culturalLoadout?.ranged?.weights ||
        state.data.gang.rangedWeaponWeightsByRank[d.rank] || {
          crossbow: 1,
          scatterbow: 1,
        },
      Object.keys(window.RangedWeapons.config),
    );
    if (state.kind === 'bandit:flasker') {
      const recipes = window.BanditCombat.availableFlaskRecipeIds();
      pool(
        'Throwable flask recipes',
        ['flasks'],
        Object.fromEntries(recipes.map((id) => [id, 1])),
        recipes,
        'Samples without replacement from the selected recipes. See the rolled flask list in the enemy record.',
      );
      const box = el('div', 'pool');
      const label = el('label', 'chance', 'Flasks per enemy');
      const count = el('input');
      count.type = 'number';
      count.min = 1;
      count.max = Math.min(12, recipes.length);
      count.value =
        rule().flaskCount ?? state.data.gang.flasker?.loadoutSize ?? 2;
      count.onchange = () => {
        mutate((r) => {
          r.flaskCount = Number(count.value);
        });
      };
      label.append(count);
      box.append(label);
      $('poolPanel').append(box);
    }
  } else if (state.tab === 'clothing') {
    const intro = el('section', 'clothing-intro');
    intro.append(
      el(
        'p',
        'help',
        'Each slot can use game defaults, your custom choices, or stay empty. A mask and hood can be worn together. Custom slots choose one article per spawn; wear chance controls whether it appears.',
      ),
    );
    const apply = el('button', 'primary', 'Preview clothing changes');
    apply.onclick = () => roll(false);
    intro.append(apply);
    $('poolPanel').append(intro);
    for (const slot of [
      'mask',
      'hood',
      'hat',
      'torso',
      'overwear',
      'pants',
    ]) {
      let def = d.clothing[slot] || { chance: 0, items: { none: 1 } };
      if (state.kind.startsWith('bandit:') || d.tribe) {
        const ids = state.data.gang.clothingPool.itemsBySlot[slot];
        if (ids) {
          const items = window.BanditCombat.clothingCandidates(
            state.data.species[species],
            gender,
            slot,
            ids,
            state.data.gang.clothingPool.banditExclusiveIds,
          );
          def = {
            ...def,
            items: Object.keys(items).length ? items : { none: 1 },
          };
        }
      }
      const candidates = cosmeticIds.filter((id) => {
        const o = opts.get(id);
        return (
          (o.slot === slot || (slot === 'overwear' && o.slot === 'arm')) &&
          (!fighter || window.resolveOptionLayers(o, fighter).length)
        );
      });
      if (slot === 'pants') candidates.push('pants_basic', 'draped_pants');
      pool(
        slot[0].toUpperCase() + slot.slice(1),
        ['clothing', slot],
        def.items,
        ['none', ...candidates, ...Object.keys(def.items)],
        'Choices available to this species and gender. Custom choices replace the normal roll for this slot.',
        def.chance,
      );
    }
    if (state.kind === 'harlyao-skeleton')
      $('poolPanel').prepend(
        el(
          'p',
          'help',
          'Native Harlyao Skeletons also wear town-value-scaled metal armor. The full record includes alloy and Temper.',
        ),
      );
  } else if (state.tab === 'appearance') {
    for (const [slot, key] of [
      ['hairFront', 'hairFrontOptions'],
      ['hairBack', 'hairBackOptions'],
      ['hairSide', 'hairSideOptions'],
      ['hairSideL', 'hairSideLOptions'],
      ['facialHair', 'facialHairOptions'],
      ['eyes', 'eyesOptions'],
      ['upperFace', 'upperFaceOptions'],
    ]) {
      const allowed = (preview.cosmetics[key] || [])
        .filter(
          (o) =>
            o.id === 'none' ||
            (fighter && window.resolveOptionLayers(o, fighter).length),
        )
        .map((o) =>
          o.id === 'none'
            ? 'none'
            : [...opts.entries()].find(([, entry]) => entry === o)?.[0] ||
              o.id,
        );
      pool(
        slot,
        ['appearance', slot],
        Object.fromEntries(allowed.map((id) => [id, 1])),
        allowed,
        'Native appearance is species-weighted. Enable to replace this appearance slot.',
      );
    }
  } else if (state.tab === 'identity') {
    pool(
      'Species',
      ['species'],
      d.species,
      Object.keys(state.data.species),
    );
    pool(
      'Gender',
      ['genders'],
      Object.fromEntries(
        (
          state.data.species[species]?.genders || Object.keys(d.genders)
        ).map((gender) => [gender, 1]),
      ),
      ['male', 'female'],
      'Species with one authored gender retain that restriction.',
    );
    if (d.special) renderBossAppearance(d.special,'identity'); // Authored robe dye and glyph color/pattern are independent of ordinary random-dye weights.
    for (const slot of [
      'A',
      'B',
      'C',
      'HOOD',
      'HOOD_B',
      'HOOD_C',
      'MASK',
      'MASK_B',
      'MASK_C',
      'HAT',
      'HAT_B',
      'TORSO',
      'TORSO_B',
      'CLOTH',
      'CLOTH_B',
      'PANTS',
      'PANTS_B',
    ])
      pool(
        slot.startsWith('A') || ['B', 'C'].includes(slot)
          ? (slot==='C' && d.special ? 'Body color C · eye / walls / robe glyph' : 'Body color ' + slot)
          : slot === 'MASK_C'
            ? 'Mask · glow (color 3)'
            : slot === 'MASK'
              ? 'Mask · base color'
              : slot === 'MASK_B'
                ? 'Mask · trim'
                : 'Dye · ' + slot,
        ['dyes', slot],
        slot === 'MASK_C' && state.kind.startsWith('maskbound:')
          ? { '#7F00FF': 1 }
          : d.dyes,
        [...dyeIds, ...Object.keys(d.dyes)],
        'Dye IDs or an exact #RRGGBB color. On named liches, the highest-weight Body C swatch is fixed per guardian and drives its eyes, robe pattern and ruin walls. MASK_C is independent mask dye color 3.',
      );
  } else if (state.tab === 'attacks') {
    if (d.lich) {
      const exclusive = d.special
        ? [state.kind.includes('hronal')?'melee':state.kind.includes('tothal')?'blizzard':'plasmCharge']
        : []; // Per-boss toggles appear in addition to the existing primary spell and resurrection.
      for (const ability of ['primary', 'summon', ...exclusive]) {
        const line = el('label', 'toggle-line');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = rule().specialAttacks?.[ability] !== false;
        input.onchange = () =>
          mutate((r) => {
            r.specialAttacks ||= {};
            r.specialAttacks[ability] = input.checked;
          });
        line.append(
          input,
          document.createTextNode(
            ability === 'primary'
              ? 'Allow tradition’s primary spell'
              : ability === 'summon' ? 'Allow skeleton summoning / reanimation'
                : ability === 'melee' ? 'Allow Azgarlu’s warhammer melee stance'
                : ability === 'blizzard' ? 'Allow Nanahi’s kneeling ceiling barrage'
                : 'Allow Imlao’s plasm-covered charging sequence',
          ),
        );
        $('poolPanel').append(line);
      }
      if(d.special) renderBossSettings(d.special); // Dedicated numeric controls persist into the shared spawn-rule JSON.
    } else
      for (const slot of ['tap1', 'tap2', 'hold1', 'hold2'])
        pool(
          slot,
          ['attacks', slot],
          slot === 'tap1' && state.selected
            ? {
                [state.selected.definition.banditAbilityLoadout?.tap1 ||
                'swingCombo']: 1,
              }
            : d.attacks[slot],
          window.EnemyLoadoutRules.attackChoices[slot],
          'Only occupied and supported slots are played by the enemy AI.',
        );
  }
  updateRuleJson();
}
async function selectKind(kind) {
  if (state.busy) return;
  state.kind = kind;
  const type = window.EnemyLoadoutSourceData.types.find(
    (t) => t.id === kind,
  );
  $('enemyTitle').textContent = type.label;
  $('family').textContent =
    type.group.toUpperCase() + ' / LOADOUT PREVIEW';
  library();
  $('ruleBadge').textContent = Object.keys(rule()).length
    ? 'Authored pools'
    : 'Game defaults';
  renderPools();
  await roll(false);
}
function fact(label, value, wide = false) {
  const n = el('div', 'fact' + (wide ? ' wide' : ''));
  n.append(el('small', null, label), el('strong', null, value || 'None'));
  return n;
}
function showRecord(record) {
  state.selected = record;
  const a = record.roster.appearance,
    def = record.definition;
  $('actorTag').textContent = (
    a.speciesId +
    ' / ' +
    a.gender
  ).toUpperCase();
  const facts = $('rollFacts');
  facts.replaceChildren(
    fact('Species', a.speciesId),
    fact('Gender', a.gender),
    fact('Health / Stamina', def.maxHealth + ' / ' + def.maxStamina),
    fact('Weapon', def.weaponKey),
    fact('Ranged', def.rangedWeaponKey),
    fact('Outfit', record.roster.equippedCosmetics.join(', '), true),
    fact('Mount', record.mountSpecies),
    fact(
      'Weapon orbit · X / Y / Z',
      record.poseOrbitAxes &&
        ['x', 'y', 'z']
          .map((axis) => Number(record.poseOrbitAxes[axis]).toFixed(2))
          .join(' / '),
      true,
    ),
    fact(
      'Attacks',
      Object.entries(def.banditAbilityLoadout || {})
        .filter(([, v]) => v)
        .map(([k, v]) => k + ': ' + v)
        .join(' · '),
      true,
    ),
    fact(
      'Dyes',
      Object.entries(record.roster.appliedDyes || {})
        .map(([k, v]) => k + ': ' + labelFor(v))
        .join(' · '),
      true,
    ),
  );
  if (record.specialLichId) facts.append(
    fact('Named lich guardian',record.specialLichId + ' · ' + (record.bossSettings ? JSON.stringify(record.bossSettings) : 'game defaults'),true),
    fact('Signature glyph',record.roster.glyphPatternId || 'none',true),
  ); // Roll summary is readable without devtools on mobile.
  if (record.roster.metalArmorItems?.length)
    facts.append(
      fact(
        'Armor',
        record.roster.metalArmorItems
          .map((item) => item.label + ' · Temper ' + item.temperXp)
          .join(' / '),
        true,
      ),
    );
  const select = $('attackChoice');
  select.replaceChildren();
  for (const entry of preview.attackOptions()) {
    const o = el('option', null, entry.label);
    o.value = entry.id;
    select.append(o);
  }
  const compact = { ...record };
  delete compact.thumbnail;
  $('rollJson').textContent = JSON.stringify(compact, null, 2);
  renderHistory();
  renderPools();
}
function renderHistory() {
  const h = $('history');
  h.replaceChildren();
  $('historyCount').textContent = state.history.length;
  state.history.forEach((record, index) => {
    const b = el(
      'button',
      'history-card' + (record === state.selected ? ' active' : ''),
    );
    if (record.thumbnail) {
      const img = el('img');
      img.src = record.thumbnail;
      img.alt =
        record.roster.appearance.speciesId +
        ' ' +
        record.roster.appearance.gender +
        ' outfit';
      b.append(img);
    }
    b.append(
      el('small', null, '#' + (index + 1) + ' · ' + record.seed),
      el('small', null, record.definition.weaponKey),
    );
    b.disabled = state.busy;
    b.onclick = async () => {
      setBusy(true);
      $('stageMessage').textContent = 'Restoring this exact enemy…';
      try {
        await preview.restore(record);
        showRecord(record);
      } catch (e) {
        log(e.stack);
        toast(e.message);
      } finally {
        setBusy(false);
        $('stageMessage').textContent = '';
      }
    };
    h.append(b);
  });
}
async function roll(newSeed = true, batch = 1) {
  if (state.busy || !state.ready) return;
  setBusy(true);
  let succeeded = false;
  const rootSeed = $('seed').value.trim() || 'hollow';
  try {
    for (let i = 0; i < batch; i++) {
      const seed =
        batch > 1
          ? rootSeed + '-' + (i + 1)
          : newSeed
            ? 'hollow-' +
              crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
            : rootSeed;
      $('seed').value = seed;
      $('stageMessage').textContent =
        'Rolling ' +
        (batch > 1 ? i + 1 + ' / ' + batch + ' · ' : '') +
        'building the complete enemy…';
      const record = await preview.roll(
        state.kind,
        Number($('tier').value),
        seed,
      );
      state.history.push(record);
      if (state.history.length > 32) state.history.shift();
      showRecord(record);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    log('Rolled ' + state.kind + ' · seed ' + $('seed').value);
    succeeded = true;
  } catch (e) {
    log(e.stack || e.message);
    $('stageMessage').textContent = e.message;
    toast('Preview failed. Diagnostics contain the load error.');
  } finally {
    setBusy(false);
    if (succeeded) $('stageMessage').textContent = '';
  }
}
async function download(name, data, type = 'application/json') {
  const blob =
    data instanceof Blob
      ? data
      : new Blob(
          [
            typeof data === 'string'
              ? data
              : JSON.stringify(data, null, 2) + '\n',
          ],
          { type },
        );
  const a = el('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$('enemySearch').oninput = () => {
  if (state.ready) library();
};
$('rollBtn').onclick = () => roll(true);
$('replayBtn').onclick = () => roll(false);
$('batchBtn').onclick = () => roll(false, 8);
$('townValue').onchange = () => roll(false);
$('tier').onchange = () => {
  renderPools();
  roll(false);
};
for (const b of document.querySelectorAll('[data-tab]'))
  b.onclick = () => {
    state.tab = b.dataset.tab;
    for (const x of document.querySelectorAll('[data-tab]'))
      x.classList.toggle('active', x === b);
    renderPools();
  };
$('fitBtn').onclick = () => preview.fit();
for (const b of document.querySelectorAll('[data-view]'))
  b.onclick = () => preview.view(b.dataset.view === 'back');
$('orbitBtn').onclick = () => {
  if (!preview.controls) return;
  preview.controls.autoRotate = !preview.controls.autoRotate;
  $('orbitBtn').setAttribute(
    'aria-pressed',
    String(preview.controls.autoRotate),
  );
};
$('gridToggle').onchange = () => {
  if (preview.grid) preview.grid.visible = $('gridToggle').checked;
};
$('bonesToggle').onchange = () =>
  window.ProceduralLegAnimation?.setShowBones($('bonesToggle').checked);
$('lighting').onchange = () => preview.setLighting($('lighting').value);
$('motion').onchange = () => {
  preview.motion = $('motion').value;
};
$('playbackSpeed').onchange = () => {
  preview.speed = Number($('playbackSpeed').value);
};
$('attackBtn').onclick = () => {
  preview.play($('attackChoice').value);
  preview.paused = false;
  $('pauseBtn').textContent = 'Pause';
};
$('loopAttack').onchange = () => {
  preview.loop = $('loopAttack').checked;
};
$('pauseBtn').onclick = () => {
  preview.paused = !preview.paused;
  $('pauseBtn').textContent = preview.paused ? 'Resume' : 'Pause';
  $('pauseBtn').setAttribute('aria-pressed', String(preview.paused));
};
$('scrub').oninput = () => {
  preview.paused = false;
  preview.play($('attackChoice').value, Number($('scrub').value), true);
};
$('captureBtn').onclick = () => {
  if (preview.renderer)
    preview
      .capture()
      .toBlob((blob) => download('enemy-preview.png', blob, 'image/png'));
};
$('resetRuleBtn').onclick = () => {
  const data = rules();
  delete data.rules[state.kind];
  persist(data);
  renderPools();
  toast('This enemy now uses the original generator.');
};
$('applyRuleBtn').onclick = () => {
  try {
    const parsed = JSON.parse($('ruleEditor').value);
    const data = rules();
    data.rules[state.kind] = parsed;
    persist(data);
    renderPools();
    toast('Rule applied. Roll to preview it.');
  } catch (e) {
    $('ruleError').textContent = e.message;
  }
};
$('exportBtn').onclick = async () => {
  if (!state.ready) return;
  const data = rules();
  window.EnemyLoadoutRules.validate(data);
  await download('enemy-loadouts.json', data);
  toast(
    'Exported spawn rules. Install the file at docs/config/combat/enemy-loadouts.json.',
  );
};

async function readUncachedRepoRules() {
  const url = new URL('config/combat/enemy-loadouts.json', document.baseURI); // The actual repository rules file served by this commit; never a device-stored Workshop draft.
  url.searchParams.set('workshopReset', String(Date.now())); // Unique URL also bypasses stale CDN responses for the JSON.
  const response = await fetch(url.href, {cache:'no-store'}); // Verify fetch and schema before touching the local draft.
  if (!response.ok) throw new Error('Repository rules HTTP ' + response.status);
  return window.EnemyLoadoutRules.validate(await response.json());
}
$('resetRepoBtn').onclick = async () => {
  if (state.busy || !state.ready) return;
  if (!window.confirm('Discard ALL locally edited Enemy Workshop rules and restore the repository copy? Export any changes you want to keep first.')) return;
  setBusy(true);
  try {
    const repositoryRules = await readUncachedRepoRules();
    localStorage.removeItem(DRAFT_KEY); // Unlike persist(), reset must not immediately write the old draft back.
    window.EnemyLoadoutRules.set(repositoryRules); // Use the freshly fetched bytes now; a page reload could independently retrieve stale cached JSON.
    state.history = []; // Old previews were built with the discarded rules, so their snapshots cannot be treated as current.
    state.selected = null;
    renderHistory();
    updateRuleJson();
    renderPools();
    $('draftState').textContent = 'Repository rules loaded · local draft cleared';
    log('Reset to fresh repository rules; discarded saved draft and prior preview history.');
    setBusy(false); // The normal roll path owns its own busy state.
    await roll(false); // Build the real avatar again from freshly fetched repository rules.
    toast('Repository rules restored and enemy preview rebuilt.');
  } catch (error) {
    log('Reset to repo failed: ' + (error.stack || error.message)); // A failed fetch or storage clear leaves the old draft intact; a failed roll has its own visible diagnostics.
    toast('Reset failed: ' + error.message);
    setBusy(false);
  }
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0];
  if (!f) return;
  try {
    persist(JSON.parse(await f.text()));
    renderPools();
    toast('Imported rules. Roll to preview them.');
  } catch (e) {
    toast('Import rejected: ' + e.message);
  } finally {
    $('importFile').value = '';
  }
};
$('exportRollBtn').onclick = () => {
  if (!state.selected) return;
  const data = { ...state.selected };
  delete data.thumbnail;
  download(
    'enemy-' + data.kind.replaceAll(':', '-') + '-' + data.seed + '.json',
    data,
  );
};
$('copyRollBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('rollJson').textContent);
    toast('Enemy JSON copied');
  } catch (_) {
    toast('Clipboard unavailable. Use Export this enemy.');
  }
};
$('dumpRigBtn').onclick = async () => {
  // Same capture the game's "Dump full rig" button uses, so this preview can be diffed against the Attack Animation Editor.
  const api = window.HobunjiRigDump;
  const actor = preview.actor;
  const dump = api && actor ? api.captureHostile(actor) : null;
  if (!dump) return toast('No enemy to dump yet.');
  const report = api.formatText(dump) + '\n\n--- JSON (paste into the Attack Animation Editor "Compare with game dump" box) ---\n' + JSON.stringify([dump]);
  $('log').textContent = report;
  try {
    await navigator.clipboard.writeText(report);
    toast('Rig transforms dumped and copied');
  } catch (_) {
    toast('Rig transforms dumped below — select and copy them.');
  }
};
$('copyLogBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('log').textContent);
    toast('Diagnostics copied');
  } catch (_) {
    toast('Select and copy the diagnostics text.');
  }
};
$('clearHistory').onclick = () => {
  state.history = [];
  renderHistory();
};
window.addEventListener('pagehide', () => preview.dispose(), {
  once: true,
});
window.addEventListener('error', (e) => log(e.message));
window.addEventListener('unhandledrejection', (e) =>
  log(e.reason?.stack || e.reason),
);
window.EnemyLoadoutWorkshop = { state, preview, roll, selectKind, rules };
(async () => {
  try {
    setBusy(true);
    state.data = await preview.init();
    state.optionLabels = new Map();
    for (const [id, o] of preview.cosmetics.optionCache) {
      state.optionLabels.set(id, o.label);
      state.optionLabels.set(o.id, o.label);
    }
    state.dyeColors = new Map();
    for (const dye of window.ScratchbonesAccount?.getDyeCatalog?.() ||
      window.SCRATCHBONES_CONFIG.game.dyes.catalog ||
      []) {
      state.optionLabels.set(dye.id, dye.label);
      if (dye.hex) state.dyeColors.set(dye.id, dye.hex);
    }
    state.ready = true;
    let draft;
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch (_) {}
    if (draft) {
      try {
        persist(draft);
      } catch (e) {
        log('Stored draft rejected: ' + e.message);
      }
    } else $('draftState').textContent = 'Repository rules loaded';
    setBusy(false);
    await selectKind(state.kind);
  } catch (e) {
    log(e.stack || e.message);
    $('stageMessage').textContent =
      'Workshop could not start: ' + e.message;
    $('draftState').textContent = 'Runtime load failed · see diagnostics';
    setBusy(false);
  }
})();

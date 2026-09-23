(() => {
  'use strict';

  if (window.AmbientDialogueReactionEditor?.installed) return;
  if (typeof state === 'undefined' || typeof listItems !== 'function' || typeof render !== 'function') return;

  const REACTION_CONFIG_URL = '../../config/dialogue/npc-reaction-profiles.json'; // Loaded separately from ambient-dialogue.json but edited inside the same Ambient Dialogue tool.
  const ANIMAL_TIERS = Object.freeze([
    ['trained', 'Well trained / direct greeting'],
    ['familiar', 'Some training'],
    ['wary', 'Untrained / wary'],
    ['recognition', 'One-time recognition conversation'],
  ]); // Drives the repeated animal-role authoring controls.
  const SIZE_REACTION_TIERS = Object.freeze([
    ['sizeTwoLarger', 'Two sizes larger', 'Small species bred Large: the biggest-species reaction.'],
    ['sizeOneLarger', 'One size larger', 'Any pet one genetic size above its species normal.'],
    ['sizeOneSmaller', 'One size smaller', 'Any pet one genetic size below its species normal.'],
    ['sizeTwoSmaller', 'Two sizes smaller', 'Large species bred Small: the tiniest-species reaction.'],
  ]); // Drives role-independent rare-size reaction authoring while ordinary pet copy remains familiarity/role based.
  const ROLES = Object.freeze([
    ['mount', 'Mount'],
    ['companion', 'Companion'],
    ['shoulderPet', 'Shoulder pet'],
  ]); // Stable roles used by the runtime and profile JSON.
  const SOCIAL_CATEGORIES = Object.freeze([
    ['silliness', 'Silliness / pranks'],
    ['dance', 'Dance'],
    ['music', 'Music'],
  ]); // Non-animal reaction categories with positive/negative relationship pools.

  const reactionState = { // Editor-only state kept separate from the base editor's NPC/animal selection.
    config: null,
    selectedProfile: null,
    loading: true,
    error: null,
  };
  const baseListItems = listItems; // Original sidebar renderer reused for NPC/Animal/Crowd modes.
  const baseRender = render; // Original main-pane renderer reused outside the Reactions mode.

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function reactionLines(value) {
    return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }
  function reactionLineText(value) { return Array.isArray(value) ? value.join('\n') : ''; }
  function safeId(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function defaultProfileId() {
    const configured = String(reactionState.config?.defaultProfile || ''); // Current inheritance profile is preferred when it still exists.
    if (configured && reactionState.config?.profiles?.[configured]) return configured;
    return Object.keys(reactionState.config?.profiles || {})[0] || 'neighborly';
  }
  function profileEntries() {
    return Object.entries(reactionState.config?.profiles || {}).map(([id, profile]) => ({ id, profile }));
  }
  function selectedProfile() {
    const id = reactionState.selectedProfile || defaultProfileId(); // Sidebar selection falls back to the current default personality.
    return { id, profile: reactionState.config?.profiles?.[id] || null };
  }
  function ensureProfileShape(profile) {
    profile.animal ||= {};
    profile.animal.recognized ||= [];
    for (const [tier] of SIZE_REACTION_TIERS) profile.animal[tier] ||= [];
    for (const [tier] of ANIMAL_TIERS) {
      profile.animal[tier] ||= {};
      for (const [role] of ROLES) profile.animal[tier][role] ||= [];
    }
    for (const [category] of SOCIAL_CATEGORIES) {
      profile[category] ||= {};
      profile[category].positive ||= [];
      profile[category].negative ||= [];
    }
    return profile;
  }
  function emptyProfile(label = 'New Personality') {
    return ensureProfileShape({ label, animal: { recognized: [] }, silliness: {}, dance: {}, music: {} });
  }
  function markReaction() {
    $('status').textContent = 'Reaction profiles edited · export reactions to save';
  }
  function reactionStatus(text) {
    $('status').textContent = text;
  }

  function reactionSidebar() {
    const query = String($('search')?.value || '').trim().toLowerCase(); // Existing sidebar search filters personality IDs/labels in Reactions mode.
    const entries = profileEntries().filter(({ id, profile }) => `${id} ${profile?.label || ''}`.toLowerCase().includes(query));
    const selected = reactionState.selectedProfile;
    $('list').innerHTML = entries.map(({ id, profile }) => `<div class="item${id === selected ? ' active' : ''}" data-reaction-profile="${esc(id)}"><b>${esc(profile?.label || id)}</b><div class="muted">${esc(id)}${id === defaultProfileId() ? ' · default' : ''}</div></div>`).join('');
    $('list').querySelectorAll('[data-reaction-profile]').forEach(element => {
      element.onclick = () => {
        reactionState.selectedProfile = element.dataset.reactionProfile;
        listItems();
        render();
      };
    });
  }

  function poolEditor(path, label, value, help = '') {
    return `<label class="field"><b>${esc(label)}</b><textarea class="compactText" data-reaction-path="${esc(path)}" placeholder="One line per row · blank inherits default profile">${esc(reactionLineText(value))}</textarea>${help ? `<span class="muted">${esc(help)}</span>` : ''}</label>`;
  }
  function animalTierEditor(profile, tier, label) {
    return `<details class="card"><summary><b>${esc(label)}</b></summary><div class="grid" style="margin-top:10px">${ROLES.map(([role, roleLabel]) => poolEditor(`animal|${tier}|${role}`, roleLabel, profile.animal?.[tier]?.[role])).join('')}</div></details>`;
  }
  function socialEditor(profile, category, label) {
    return `<details class="card"><summary><b>${esc(label)}</b></summary><div class="grid" style="margin-top:10px">${poolEditor(`${category}|positive`, 'Zero / positive hearts', profile?.[category]?.positive)}${poolEditor(`${category}|negative`, 'Negative hearts', profile?.[category]?.negative)}</div></details>`;
  }
  function assignmentEditor() {
    const ids = Object.keys(reactionState.config?.profiles || {}); // Current profile IDs populate every NPC assignment selector.
    const fallback = defaultProfileId(); // Blank assignment display explains which profile inheritance will use.
    const options = id => ids.map(profileId => `<option value="${esc(profileId)}"${profileId === id ? ' selected' : ''}>${esc(reactionState.config.profiles[profileId]?.label || profileId)} (${esc(profileId)})</option>`).join('');
    const rows = (state.npcs || []).map(npc => {
      const assigned = reactionState.config.assignments?.[npc.id] || fallback; // Effective assignment shown even when the JSON omits an explicit NPC key.
      return `<label class="field"><span>${esc(npc.name || npc.id)}</span><select data-reaction-assignment="${esc(npc.id)}">${options(assigned)}</select></label>`;
    }).join('');
    return `<details class="card"><summary><b>NPC personality assignments</b></summary><div class="muted" style="margin:8px 0">Each NPC uses one reusable reaction personality. Changing this affects animal, silliness, dance, and music reactions together.</div><div class="grid">${rows || '<span class="muted">NPC database is still loading.</span>'}</div></details>`;
  }

  function valueAtPath(profile, path) {
    const parts = path.split('|'); // Serialized textarea path identifies the nested profile pool to update.
    let node = profile;
    for (const part of parts) node = node?.[part];
    return node;
  }
  function setAtPath(profile, path, value) {
    const parts = path.split('|'); // Serialized textarea path is materialized one object level at a time.
    let node = profile;
    for (let index = 0; index < parts.length - 1; index++) node = node[parts[index]] ||= {};
    node[parts[parts.length - 1]] = value;
  }

  function renderReactionProfile() {
    if (reactionState.loading) {
      $('editor').innerHTML = '<div class="card muted">Loading NPC reaction personalities…</div>';
      return;
    }
    if (!reactionState.config) {
      $('editor').innerHTML = `<div class="card warn">Reaction profile load failed: ${esc(reactionState.error || 'unknown error')}</div>`;
      return;
    }
    const selected = selectedProfile(); // Current sidebar profile is the profile whose pools are rendered and edited.
    if (!selected.profile) {
      reactionState.selectedProfile = defaultProfileId();
      reactionSidebar();
      return renderReactionProfile();
    }
    const profile = ensureProfileShape(selected.profile); // Missing optional pools are materialized only when the profile is edited/rendered.
    const isDefault = selected.id === defaultProfileId(); // Default personality cannot be deleted because blank sub-pools inherit from it.
    const profileOptions = profileEntries().map(({ id, profile: item }) => `<option value="${esc(id)}"${id === defaultProfileId() ? ' selected' : ''}>${esc(item?.label || id)} (${esc(id)})</option>`).join('');

    $('editor').innerHTML = `<div class="card">
      <div class="row"><h2>NPC Reaction Personalities</h2><span class="pill">${esc(selected.id)}</span><span class="spacer"></span><button id="newReactionProfile" class="subtle">+ New personality</button><button id="deleteReactionProfile" class="subtle"${isDefault ? ' disabled' : ''}>Delete</button></div>
      <div class="muted">These pools replace hardcoded NPC pet/mount copy and the old separate silliness-reactions file. Placeholders for animal lines: <code>{animalName}</code>, <code>{species}</code>. Blank pools inherit from the default personality.</div>
      <div class="grid" style="margin-top:10px"><label class="field">Personality name<input id="reactionProfileLabel" value="${esc(profile.label || selected.id)}"></label><label class="field">Default personality<select id="reactionDefaultProfile">${profileOptions}</select></label></div>
    </div>
    ${assignmentEditor()}
    <div class="card"><h3>Animal reactions</h3><div class="muted">Recognized is used for ordinary ambient greetings once this NPC knows the individual animal. The other tiers are role-specific.</div>${poolEditor('animal|recognized', 'Recognized animal greetings', profile.animal.recognized, 'Applies to mounts, companions, and shoulder pets after recognition.')}</div>
    <div class="card"><h3>Rare size reactions</h3><div class="muted">These override ordinary ambient pet copy when a bred Size differs from the species default. Recognition conversations keep their own lines. Blank pools inherit from the default personality.</div><div class="grid" style="margin-top:10px">${SIZE_REACTION_TIERS.map(([tier, label, help]) => poolEditor(`animal|${tier}`, label, profile.animal?.[tier], help)).join('')}</div></div>
    ${ANIMAL_TIERS.map(([tier, label]) => animalTierEditor(profile, tier, label)).join('')}
    ${SOCIAL_CATEGORIES.map(([category, label]) => socialEditor(profile, category, label)).join('')}`;

    $('reactionProfileLabel').oninput = () => {
      profile.label = $('reactionProfileLabel').value.trim() || selected.id;
      markReaction();
      reactionSidebar();
    };
    $('reactionDefaultProfile').onchange = () => {
      reactionState.config.defaultProfile = $('reactionDefaultProfile').value;
      markReaction();
      reactionSidebar();
    };
    $('newReactionProfile').onclick = () => {
      const requested = prompt('New personality ID (letters/numbers/dashes):', 'new-personality'); // Small one-time identifier prompt keeps the main editor compact on mobile.
      const id = safeId(requested); // Safe JSON/runtime key derived from the author-entered identifier.
      if (!id) return;
      if (reactionState.config.profiles[id]) { alert(`A personality named ${id} already exists.`); return; }
      reactionState.config.profiles[id] = emptyProfile(id.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()));
      reactionState.selectedProfile = id;
      markReaction();
      listItems();
      render();
    };
    $('deleteReactionProfile').onclick = () => {
      if (isDefault) return;
      const replacement = defaultProfileId(); // Deleted profile assignments fall back to the configured default instead of becoming dangling IDs.
      delete reactionState.config.profiles[selected.id];
      for (const [npcId, profileId] of Object.entries(reactionState.config.assignments || {})) if (profileId === selected.id) reactionState.config.assignments[npcId] = replacement;
      reactionState.selectedProfile = replacement;
      markReaction();
      listItems();
      render();
    };
    $('editor').querySelectorAll('[data-reaction-path]').forEach(textarea => {
      textarea.oninput = () => {
        setAtPath(profile, textarea.dataset.reactionPath, reactionLines(textarea.value));
        markReaction();
      };
    });
    $('editor').querySelectorAll('[data-reaction-assignment]').forEach(select => {
      select.onchange = () => {
        reactionState.config.assignments ||= {};
        reactionState.config.assignments[select.dataset.reactionAssignment] = select.value;
        markReaction();
      };
    });
  }

  function installTab() {
    const tabs = document.querySelector('.tabs'); // Existing Ambient Dialogue mode strip receives one fourth mode without replacing the base editor.
    if (!tabs || tabs.querySelector('[data-mode="reactions"]')) return;
    tabs.style.gridTemplateColumns = 'repeat(4,1fr)';
    const button = document.createElement('button'); // New Reactions mode enters the personality/profile editor.
    button.dataset.mode = 'reactions';
    button.textContent = 'Reactions';
    button.onclick = () => {
      state.mode = 'reactions';
      document.querySelectorAll('[data-mode]').forEach(tab => tab.classList.toggle('active', tab === button));
      reactionState.selectedProfile ||= defaultProfileId();
      listItems();
      render();
    };
    tabs.appendChild(button);
  }

  function downloadReactionConfig() {
    if (!reactionState.config) return;
    const blob = new Blob([JSON.stringify(reactionState.config, null, 2) + '\n'], { type: 'application/json' }); // Exported profile JSON is ready to replace the repository config verbatim.
    const link = document.createElement('a'); // Temporary download anchor follows the base editor's existing export pattern.
    link.href = URL.createObjectURL(blob);
    link.download = 'npc-reaction-profiles.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    reactionStatus('Exported npc-reaction-profiles.json');
  }

  function installHeaderControls() {
    const exportAmbient = $('exportBtn'); // Existing ambient export button anchors the reaction import/export controls beside it.
    if (!exportAmbient || document.getElementById('exportReactionProfiles')) return;
    const importButton = document.createElement('button'); // Reaction-only import avoids mixing two independently stored JSON files.
    importButton.id = 'importReactionProfiles';
    importButton.textContent = 'Import Reactions';
    const exportButton = document.createElement('button'); // Reaction-only export writes npc-reaction-profiles.json.
    exportButton.id = 'exportReactionProfiles';
    exportButton.className = 'good';
    exportButton.textContent = 'Export Reactions';
    const fileInput = document.createElement('input'); // Hidden file chooser mirrors the base editor's ambient JSON import flow.
    fileInput.id = 'reactionProfileFile';
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.hidden = true;
    exportAmbient.parentNode.insertBefore(importButton, exportAmbient);
    exportAmbient.parentNode.insertBefore(exportButton, exportAmbient);
    exportAmbient.parentNode.insertBefore(fileInput, exportAmbient);
    importButton.onclick = () => fileInput.click();
    exportButton.onclick = downloadReactionConfig;
    fileInput.onchange = async () => {
      try {
        const parsed = JSON.parse(await fileInput.files[0].text()); // Imported profile document replaces only editor reaction state after minimal shape validation.
        if (!parsed?.profiles || !Object.keys(parsed.profiles).length) throw new Error('No reaction profiles found.');
        parsed.assignments ||= {};
        reactionState.config = parsed;
        reactionState.selectedProfile = parsed.profiles[reactionState.selectedProfile] ? reactionState.selectedProfile : defaultProfileId();
        reactionState.error = null;
        reactionState.loading = false;
        listItems();
        render();
        reactionStatus('Imported npc-reaction-profiles.json');
      } catch (error) {
        reactionStatus(`Reaction import failed: ${error.message}`);
      }
    };
  }

  async function loadReactionConfig() {
    reactionState.loading = true;
    try {
      const response = await fetch(REACTION_CONFIG_URL, { cache: 'no-store' }); // Repository profile JSON is always refreshed during authoring.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json(); // Parsed profile config is isolated from the base ambient-dialogue state object.
      if (!config?.profiles || !Object.keys(config.profiles).length) throw new Error('No reaction profiles found.');
      config.assignments ||= {};
      reactionState.config = config;
      reactionState.selectedProfile = config.defaultProfile && config.profiles[config.defaultProfile] ? config.defaultProfile : Object.keys(config.profiles)[0];
      reactionState.error = null;
    } catch (error) {
      reactionState.config = null;
      reactionState.error = error?.message || String(error);
    } finally {
      reactionState.loading = false;
      if (state.mode === 'reactions') { listItems(); render(); }
    }
  }

  listItems = function reactionAwareListItems() {
    if (state.mode === 'reactions') return reactionSidebar();
    return baseListItems();
  };
  render = function reactionAwareRender() {
    if (state.mode === 'reactions') return renderReactionProfile();
    return baseRender();
  };

  installTab();
  installHeaderControls();
  $('search').oninput = listItems;
  loadReactionConfig();

  window.AmbientDialogueReactionEditor = Object.freeze({ // Small debug surface helps mobile authoring verify what file/profile is currently selected.
    installed: true,
    getDebug: () => ({
      loaded: !!reactionState.config,
      loading: reactionState.loading,
      error: reactionState.error,
      selectedProfile: reactionState.selectedProfile,
      profileCount: Object.keys(reactionState.config?.profiles || {}).length,
      assignmentCount: Object.keys(reactionState.config?.assignments || {}).length,
    }),
  });
})();

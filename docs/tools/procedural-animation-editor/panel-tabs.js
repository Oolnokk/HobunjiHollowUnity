(() => {
  'use strict';

  if (window.ProceduralAnimationEditorNav?.version >= 1) return;

  const PANEL_IDS = {
    setup: 'leftPanel',
    movement: 'leftPanel',
    ragdoll: 'footingPanel',
    'impact-blendspace': 'footingPanel',
    kurraya: 'kurrayaPanel'
  };
  const TABS = [
    ['setup', 'NPC / Source'],
    ['movement', 'Movement'],
    ['ragdoll', 'Ragdoll / Footing'],
    ['impact-blendspace', 'Impact Blendspace'],
    ['kurraya', 'Kurraya']
  ];
  const STORAGE_KEY = 'hobunji_procedural_animator_active_panel_v1';
  let activeTab = null;
  let blendspaceDetails = null;

  function getPanel(id) {
    return document.getElementById(PANEL_IDS[id] || '');
  }

  function findImpactBlendspace() {
    const footing = document.getElementById('footingPanel');
    if (!footing) return null;
    return [...footing.querySelectorAll('details')].find(details =>
      (details.querySelector(':scope > summary')?.textContent || '').toLowerCase().includes('baked impact blend space')
    ) || null;
  }

  function ensureStyles() {
    if (document.getElementById('proceduralPanelTabsStyle')) return;
    const style = document.createElement('style');
    style.id = 'proceduralPanelTabsStyle';
    style.textContent = `
      body.pae-tabs-enabled #proceduralPanelTabs {
        position: fixed; z-index: 145; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right));
        width: min(720px, calc(100vw - 16px)); display: flex; gap: 4px; overflow-x: auto; padding: 5px;
        border: 1px solid rgba(255,255,255,.16); border-radius: 12px; background: rgba(7,16,26,.94);
        box-shadow: 0 12px 32px rgba(0,0,0,.38); backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px);
        scrollbar-width: thin;
      }
      body.pae-tabs-enabled #proceduralPanelTabs button {
        flex: 0 0 auto; min-height: 34px; padding: 5px 9px; font-size: 11px; white-space: nowrap;
      }
      body.pae-tabs-enabled #proceduralPanelTabs button[aria-selected="true"] {
        outline: 2px solid var(--accent); outline-offset: -1px; background: rgba(107,169,255,.28);
      }
      body.pae-tabs-enabled #leftPanel,
      body.pae-tabs-enabled #kurrayaPanel,
      body.pae-tabs-enabled #footingPanel {
        position: fixed !important; z-index: 140 !important; top: max(54px, calc(env(safe-area-inset-top) + 46px)) !important;
        right: max(8px, env(safe-area-inset-right)) !important; bottom: max(8px, env(safe-area-inset-bottom)) !important;
        left: auto !important; width: min(720px, calc(100vw - 16px)) !important; height: auto !important;
        max-height: none !important; margin: 0 !important; border: 1px solid rgba(255,255,255,.16) !important;
        border-radius: 14px !important; background: rgba(7,16,26,.97) !important; overflow: hidden !important;
        box-shadow: 0 18px 48px rgba(0,0,0,.46) !important; filter: none !important;
      }
      body.pae-tabs-enabled #leftPanel.pae-panel-hidden,
      body.pae-tabs-enabled #kurrayaPanel.pae-panel-hidden,
      body.pae-tabs-enabled #footingPanel.pae-panel-hidden { display: none !important; }
      body.pae-tabs-enabled #leftPanel.pae-panel-active,
      body.pae-tabs-enabled #kurrayaPanel.pae-panel-active,
      body.pae-tabs-enabled #footingPanel.pae-panel-active { display: block !important; }
      body.pae-tabs-enabled #leftPanel.pae-panel-active > summary,
      body.pae-tabs-enabled #kurrayaPanel.pae-panel-active > summary,
      body.pae-tabs-enabled #footingPanel.pae-panel-active > summary { display: none !important; }
      body.pae-tabs-enabled #leftPanel.pae-panel-active .selectorBody,
      body.pae-tabs-enabled #kurrayaPanel.pae-panel-active > .authoringBody,
      body.pae-tabs-enabled #footingPanel.pae-panel-active > .authoringBody {
        height: 100% !important; max-height: none !important; overflow: auto !important; padding-bottom: 24px !important;
        -webkit-overflow-scrolling: touch;
      }
      body.pae-tabs-enabled[data-pae-panel="movement"] #leftPanel .selectorBody > * { display: none !important; }
      body.pae-tabs-enabled[data-pae-panel="movement"] #leftPanel #animationEditor { display: grid !important; }
      body.pae-tabs-enabled[data-pae-panel="setup"] #leftPanel #animationEditor { display: none !important; }
      body.pae-tabs-enabled[data-pae-panel="ragdoll"] #paeImpactBlendspacePanel { display: none !important; }
      body.pae-tabs-enabled[data-pae-panel="impact-blendspace"] #footingPanel > .authoringBody > :not(#paeImpactBlendspacePanel):not(script) { display: none !important; }
      body.pae-tabs-enabled[data-pae-panel="impact-blendspace"] #paeImpactBlendspacePanel {
        display: block !important; margin: 0 !important; padding: 10px !important; border: 0 !important; border-radius: 0 !important;
        background: transparent !important;
      }
      body.pae-tabs-enabled[data-pae-panel="impact-blendspace"] #paeImpactBlendspacePanel > summary { display: none !important; }
      @media (max-width: 700px) {
        body.pae-tabs-enabled #proceduralPanelTabs { left: 6px; right: 6px; width: auto; top: max(6px, env(safe-area-inset-top)); }
        body.pae-tabs-enabled #leftPanel,
        body.pae-tabs-enabled #kurrayaPanel,
        body.pae-tabs-enabled #footingPanel {
          left: 6px !important; right: 6px !important; width: auto !important;
          top: max(52px, calc(env(safe-area-inset-top) + 44px)) !important; bottom: max(6px, env(safe-area-inset-bottom)) !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureTabBar() {
    let bar = document.getElementById('proceduralPanelTabs');
    if (bar) return bar;
    bar = document.createElement('nav');
    bar.id = 'proceduralPanelTabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Procedural animation editor panels');
    for (const [id, label] of TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.dataset.paeTab = id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', 'false');
      button.textContent = label;
      button.addEventListener('click', () => selectTab(id));
      bar.appendChild(button);
    }
    document.body.appendChild(bar);
    return bar;
  }

  function setPanelVisibility(id) {
    const activePanel = getPanel(id);
    const uniquePanels = [...new Set(Object.values(PANEL_IDS))]
      .map(panelId => document.getElementById(panelId))
      .filter(Boolean);
    for (const panel of uniquePanels) {
      const isActive = panel === activePanel;
      panel.classList.toggle('pae-panel-active', isActive);
      panel.classList.toggle('pae-panel-hidden', !isActive);
      if (panel.tagName === 'DETAILS') panel.open = isActive;
    }
  }

  function updateTabButtons(id) {
    document.querySelectorAll('#proceduralPanelTabs [data-pae-tab]').forEach(button => {
      const selected = button.dataset.paeTab === id;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.classList.toggle('active', selected);
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function resetPanelScroll(id) {
    const panel = getPanel(id);
    const scroller = panel?.querySelector(':scope > .collapsibleBody, .selectorBody');
    if (!scroller) return;
    requestAnimationFrame(() => { scroller.scrollTop = 0; });
  }

  function selectTab(id) {
    if (!PANEL_IDS[id]) return false;
    const panel = getPanel(id);
    if (!panel) return false;

    document.body.classList.add('pae-tabs-enabled');
    document.body.dataset.paePanel = id;
    setPanelVisibility(id);
    updateTabButtons(id);

    blendspaceDetails ||= findImpactBlendspace();
    if (blendspaceDetails) {
      blendspaceDetails.id = 'paeImpactBlendspacePanel';
      blendspaceDetails.open = id === 'impact-blendspace';
    }

    activeTab = id;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
    resetPanelScroll(id);
    window.dispatchEvent(new CustomEvent('procedural-animation-editor:tab-change', { detail: { tab: id } }));
    return true;
  }

  function initialize() {
    ensureStyles();
    ensureTabBar();
    blendspaceDetails = findImpactBlendspace();
    if (blendspaceDetails) blendspaceDetails.id = 'paeImpactBlendspacePanel';

    let initial = 'movement';
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && PANEL_IDS[stored]) initial = stored;
    } catch (_) {}
    selectTab(initial);
  }

  const api = {
    version: 1,
    selectTab,
    getActiveTab: () => activeTab,
    listTabs: () => TABS.map(([id, label]) => ({ id, label })),
    panelIds: { ...PANEL_IDS },
    refresh: initialize
  };
  window.ProceduralAnimationEditorNav = api;
  window.__PAE_DEBUG__ = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();

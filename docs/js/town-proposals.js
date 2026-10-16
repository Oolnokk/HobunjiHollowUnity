// Hunundi's desk letters; TownMine remains the authority for costs, purchases and saves.
(function (global) {
  'use strict';
  let deps = null; // Live inventory and the game's modal input gate.
  let root = null, page = null, confirmation = null, observer = null; // One reusable letter reader and its resize subscription.
  let selected = 0, previousFocus = null; // Letter index and focus restored when the reader closes.
  let ignoreOpeningConfirm = false; // Prevents the held interaction A press from also accepting the letter.
  let texture = null, textureState = 'not loaded'; // Shared background image and console-free diagnostics.
  const assetBase = new URL('../assets/', document.currentScript.src).href; // Resolves correctly on GitHack and nested hosting paths.
  const letters = [{
    id: 'foundry', from: 'Kzubug', title: 'A Foundry for Hobunji Hollow',
    body: `I heard some rumors that we need to increase the economic value of our town, and when I did, an idea came to me immediately. Well, it's not a new idea, it's been brewing for over three decades, I just thought it would be rude to bring it up. I'm always of the mindset that trouble comes when you try to fix something that isn't broken.

Well now that you're saying our town IS broken, so to speak, here's my fix.

Years ago, before Father Shunji died and you came here to take over, you may have remembered that it was just my parents and my sister Bzabashka living at the smithy at the time. You and I didn't actually meet until I showed up a year later, and that's because I was studying as an apprentice up in Gaz-Baduun. You should have seen the place I was working at; the whole building was designed around efficiency, and the forge was unlike anything you've ever seen. It was part building, part machine, built for quick, precise work, and was also capable of certain advanced metallurgical techniques that you simply cannot pull off with simple smithing tools. It was called the Gaz-Baduun Foundry, and it was famous all across the Eastern Highplains. All the finest weapons came from there, and the secret was not as much the mastery of the smiths, but the foundry itself.

My proposition is that we build a foundry just like it here, in Hobunji Hollow. Not remotely at the scale of the one at Gaz-Baduun, of course. It's only me and Sloomi working here, and this isn't the big city. But even a miniature version of what I was working with up there would make a world of difference in quality and efficiency. I promise you it would put us on the map. Not necessarily a map of the continent, but a map of the province for sure, and if things were to go really, really well, maybe even a map of Northern Tanka. As far as I'm aware there is no foundry quite like the one in Gaz-Baduun anywhere north of Kumapirra. So small scale or not, our work will certainly stand out from the others in its quality, and we'll be able to produce far more than you'd expect a place as small as Hobunji Hollow to be capable of, let alone from the work of only two smiths.

But of course there's a downside: the cost and materials.
Two smiths will be enough to run the foundry, but to actually build it, we'll need a lot more, and ones who know what they're doing. I'd wager it would cost a few thousand ganang to bring in the proper experts. I still have a few connections up there still, but they won't work for free.

And transporting metal from elsewhere would be a tremendous expense that could be fully avoided. All of the needed materials could certainly be sourced from the town mine and the surrounding wilderness, if we could get someone working on it. I, of course am unfortunately very busy, and my mining and woodcutting days are long behind me anyway.

From my estimation we'd need:`,
  }]; // Additional proposals use the same reader and authoritative improvement IDs.

  function node(tag, text = '', className = '') {
    const result = document.createElement(tag); // Safe text-only element factory for letters and resource names.
    result.textContent = text; result.className = className;
    return result;
  }
  function button(text, action) {
    const result = node('button', text); // Native tap/click targets also participate in ControllerUI navigation.
    result.type = 'button'; result.onclick = action;
    return result;
  }
  function count(key) {
    const value = Number(deps?.inventory?.[key]); // Invalid/missing inventory values must display as zero.
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  function requirements(id) {
    const status = global.TownMine?.improvementStatus(id); // Prices and affordability always come from the existing purchase authority.
    if (!status) return [];
    return Object.entries(status.cost).map(([key, needed]) => ({
      key, needed, owned: key === 'wood' ? count('pineLog') + count('shadewoodLog') : count(key),
      label: key === 'gold' ? 'ganang' : key === 'wood' ? 'Wood' : deps?.ITEM_DEFS?.[key]?.label || ({ stone: 'Stone', bar_tinBronze: 'Tin Bronze bars' })[key] || key,
    }));
  }
  function drawBackground() {
    if (!page || root.hidden || !texture?.complete || !texture.naturalWidth) return;
    const canvas = page.querySelector('canvas'); // Background covers the complete letter including its bottom cost section.
    const width = page.clientWidth, height = page.offsetHeight; // CSS dimensions keep border size stable on phones and tall letters.
    const ratio = Math.min(2, global.devicePixelRatio || 1); // Bounded backing resolution for mobile memory use.
    if (!width || !height) return;
    canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
    const ctx = canvas.getContext('2d'); // The shared cliff mapper supplies the exact protected-border stretch.
    ctx.scale(ratio, ratio);
    if (global.HobunjiSurfaceStretchUV?.drawCanvasSurface(ctx, texture, width, height)) textureState = 'edge-preserving-nine-slice';
    else textureState = 'surface mapper unavailable';
  }
  function ensureUI() {
    if (root) return;
    const style = node('style'); // Scoped styles keep every letter black except resource and acceptance states.
    style.textContent = `
      #townProposalReader{position:fixed;inset:0;z-index:15000;background:#0009;display:grid;place-items:center;padding:12px;color:#111}
      #townProposalReader[hidden]{display:none}
      #townProposalReader .proposal-shell{width:min(740px,100%);max-height:94dvh;display:flex;flex-direction:column;min-height:0}
      #townProposalReader button{font:inherit;min-height:44px;min-width:48px;border:1px solid #473f31;border-radius:5px;padding:8px 12px;background:#e7dcc4;color:#111;cursor:pointer;touch-action:manipulation}
      #townProposalReader button:disabled{background:#ccc4b4;color:#555;cursor:default}
      #townProposalReader button:focus-visible{outline:3px solid #156c33;outline-offset:2px}
      #townProposalReader .proposal-toolbar{display:flex;gap:8px;align-items:center;padding:8px;background:#e7dcc4;border-radius:8px 8px 0 0;color:#111}
      #townProposalReader .proposal-position{flex:1;text-align:center}
      #townProposalReader .proposal-scroll{overflow:auto;overscroll-behavior:contain;min-height:0}
      #townProposalReader .proposal-paper{position:relative;isolation:isolate;padding:clamp(24px,6vw,48px);background:#e7dcc4;font:17px/1.6 Georgia,serif;color:#111}
      #townProposalReader canvas{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}
      #townProposalReader h2{font:700 25px/1.3 Georgia,serif;color:#111;margin:0 0 18px}
      #townProposalReader p{color:#111;margin:0 0 18px;white-space:pre-line}
      #townProposalReader .proposal-cost{display:flex;align-items:center;gap:8px;font-weight:bold}
      #townProposalReader .proposal-cost img{height:1.2em;width:1.2em;object-fit:contain}
      #townProposalReader .proposal-accept{width:100%;margin-top:22px}
      #townProposalReader .proposal-accept:enabled{background:#237b3b;color:#fff}
      #townProposalReader .proposal-confirm{position:absolute;inset:0;background:#0009;display:grid;place-items:center;padding:16px;z-index:2}
      #townProposalReader .proposal-confirm[hidden]{display:none}
      #townProposalReader .proposal-confirm-box{background:#e7dcc4;padding:24px;border:2px solid #443c30;border-radius:8px;max-width:440px;color:#111}
      #townProposalReader .proposal-confirm-actions{display:flex;gap:12px;justify-content:flex-end}
      #townProposalReader .proposal-hint{display:none}
      #townProposalReader.proposal-controller .proposal-hint{display:inline}
      #townProposalReader details{font:13px/1.5 sans-serif;margin-top:20px;color:#111}
      #townProposalReader pre{white-space:pre-wrap;color:#111}
    `;
    document.head.appendChild(style);
    root = node('div'); root.id = 'townProposalReader'; root.hidden = true;
    root.setAttribute('data-ctrl-panel', ''); root.setAttribute('data-ctrl-actions', '');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Town improvement proposals');
    root.addEventListener('hobunji-controller-panel-action', event => {
      event.preventDefault(); // ControllerUI owns polling; this panel owns the meaning of A/B/LB/RB.
      if (event.detail.action === 'confirm') {
        if (ignoreOpeningConfirm) {
          ignoreOpeningConfirm = false;
          const binding = global.InputBindings?.getCurrentBindings?.()?.controller?.uiConfirm || 'Button0'; // Shared press edges distinguish a fresh A press from the interaction still being held.
          if (!global.ControllerInput?.frame?.()?.pressed?.has(binding)) return;
        }
        confirmation ? accept() : ask();
      }
      else if (event.detail.action === 'cancel') confirmation ? dismissConfirmation() : close();
      else if (!confirmation) flip(event.detail.action === 'previous' ? -1 : 1);
    });
    global.addEventListener('hobunji-controller-ui-snapshot', () => {
      if (!root.hidden && !root.classList.contains('proposal-controller')) root.classList.add('proposal-controller');
    });
    document.body.appendChild(root);
    document.addEventListener('keydown', event => {
      if (root.hidden || !['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') confirmation ? dismissConfirmation() : close();
      else if (!confirmation) flip(event.key === 'ArrowLeft' ? -1 : 1);
    }, true);
    texture = new Image(); texture.crossOrigin = 'anonymous';
    texture.onload = drawBackground;
    texture.onerror = () => { textureState = 'canvas.png failed to load'; global.__farmLog?.('[town-proposals] canvas.png failed to load', 'warn'); };
    texture.src = assetBase + 'textures/canvas.png';
    textureState = 'loading';
    observer = new ResizeObserver(drawBackground);
  }
  function render() {
    observer?.disconnect(); root.replaceChildren(); confirmation = null;
    const letter = letters[selected], status = global.TownMine?.improvementStatus(letter.id); // Live proposal and purchased state.
    const shell = node('section', '', 'proposal-shell'); // Toolbar stays visible while the entire letter scrolls underneath it.
    const toolbar = node('nav', '', 'proposal-toolbar'); // Both arrows stay tappable even with only one proposal.
    toolbar.setAttribute('aria-label', 'Proposal letters');
    toolbar.append(button('‹', () => flip(-1)), node('span', `${selected + 1} / ${letters.length}`, 'proposal-position'), button('›', () => flip(1)));
    toolbar.children[0].setAttribute('aria-label', 'Previous proposal (LB)');
    toolbar.children[0].setAttribute('data-ctrl-default', '');
    toolbar.children[0].appendChild(node('span', ' [LB]', 'proposal-hint'));
    toolbar.children[2].setAttribute('aria-label', 'Next proposal (RB)');
    toolbar.children[2].appendChild(node('span', ' [RB]', 'proposal-hint'));
    const back = button('Close', close); // B closes the reader, or dismisses only its confirmation when present.
    back.appendChild(node('span', ' [B]', 'proposal-hint'));
    back.setAttribute('data-ctrl-cancel', ''); toolbar.appendChild(back);
    const scroll = node('div', '', 'proposal-scroll'); // Controller right-stick scroll follows the focused accept button's ancestor.
    scroll.setAttribute('data-ctrl-scroll', '');
    page = node('article', '', 'proposal-paper');
    const background = node('canvas'); // Decorative texture stays outside the letter's accessibility text.
    background.setAttribute('aria-hidden', 'true'); page.appendChild(background);
    page.append(node('h2', letter.title), node('p', 'From ' + letter.from + ':'));
    for (const paragraph of letter.body.split('\n\n')) page.appendChild(node('p', paragraph));
    const costs = node('div'); // The actual live costs replace the author's n placeholders at the letter's end.
    for (const resource of requirements(letter.id)) {
      const row = node('div', '', 'proposal-cost'); // Each owned/required fraction has an independent sufficient/insufficient color.
      row.style.color = resource.owned >= resource.needed ? '#156c33' : '#ab1919';
      if (resource.key === 'gold') {
        const icon = node('img'); icon.src = assetBase + 'hud/generic_icons/icon_bronzecurrency.png'; icon.alt = 'Ganang'; row.appendChild(icon); // Existing currency symbol.
      }
      row.appendChild(node('span', `${resource.owned.toLocaleString()} / ${resource.needed.toLocaleString()} ${resource.label}`));
      costs.appendChild(row);
    }
    page.appendChild(costs);
    const acceptButton = button(status?.built ? 'Proposal completed — Foundry built' : 'Accept proposal', ask); // A offers confirmation independently of the current reading/navigation position.
    acceptButton.className = 'proposal-accept'; acceptButton.disabled = !status || status.built || !status.affordable;
    acceptButton.appendChild(node('span', ' [A]', 'proposal-hint'));
    if (deps.isDevMode?.()) {
      const debug = node('details'); // Uses the existing dev gate; mobile diagnostics need no console.
      debug.append(node('summary', 'Proposal diagnostics'), node('pre', JSON.stringify({ change: 'Foundry upgrade moved to Hunundi’s desk letters', id: letter.id, status, requirements: requirements(letter.id), background: textureState }, null, 2)));
      page.appendChild(debug);
    }
    page.appendChild(acceptButton);
    scroll.appendChild(page); shell.append(toolbar, scroll); root.appendChild(shell);
    observer.observe(page); drawBackground();
  }
  function flip(delta) {
    if (confirmation) return;
    selected = (selected + delta + letters.length) % letters.length;
    render();
  }
  function ask() {
    const status = global.TownMine?.improvementStatus(letters[selected].id); // Check again on tap/A in case inventory changed after opening.
    if (!status || status.built || !status.affordable) { render(); return; }
    confirmation = node('div', '', 'proposal-confirm');
    confirmation.setAttribute('role', 'alertdialog'); confirmation.setAttribute('aria-modal', 'true'); confirmation.setAttribute('aria-label', 'Confirm proposal');
    const box = node('div', '', 'proposal-confirm-box'); // The yes/no prompt describes exactly what will be spent.
    box.append(node('h2', 'Are you sure?'), node('p', 'Spend the listed ganang and materials to upgrade the smithy to a foundry?'));
    const actions = node('div', '', 'proposal-confirm-actions'); // Direct A/B meanings are also shown on both tap targets.
    const yes = button('Yes', accept), no = button('No', dismissConfirmation); // No never spends resources.
    yes.appendChild(node('span', ' [A]', 'proposal-hint')); no.appendChild(node('span', ' [B]', 'proposal-hint'));
    yes.setAttribute('data-ctrl-default', ''); no.setAttribute('data-ctrl-cancel', '');
    actions.append(yes, no); box.appendChild(actions); confirmation.appendChild(box); root.appendChild(confirmation);
    root.querySelector('.proposal-shell').inert = true;
    root.querySelector('.proposal-shell').setAttribute('data-ctrl-skip', '');
    yes.focus();
  }
  function dismissConfirmation() {
    confirmation?.remove(); confirmation = null;
    root.querySelector('.proposal-shell').inert = false;
    root.querySelector('.proposal-shell').removeAttribute('data-ctrl-skip');
    root.querySelector('.proposal-accept')?.focus();
  }
  function accept() {
    if (!confirmation) return; // A single click/press must never bypass the confirmation step.
    dismissConfirmation();
    const result = global.TownMine.buildImprovement(letters[selected].id); // Rechecks affordability and duplicate purchases before any deduction/save.
    deps.showToast(result.message, result.ok);
    render();
  }
  function open() {
    if (!deps || !global.TownMine) return false;
    ensureUI(); if (!root.hidden) return true;
    const confirmBinding = global.InputBindings?.getCurrentBindings?.()?.controller?.uiConfirm || 'Button0'; // Respect the player's mapped confirm input.
    ignoreOpeningConfirm = !!global.ControllerInput?.frame?.()?.isDown(confirmBinding);
    previousFocus = document.activeElement; root.hidden = false;
    root.classList.toggle('proposal-controller', !!global.ControllerInput?.frame?.()?.pad);
    deps.setInteractionBlocked(true); render();
    return true;
  }
  function close() {
    if (!root || root.hidden) return;
    observer.disconnect(); root.hidden = true; confirmation = null;
    deps.setInteractionBlocked(false); previousFocus?.focus?.();
  }
  function makeInteractable() {
    return {
      getButtons: () => [{ icon: '✉️', label: 'Read Proposals', action: 'obj_town_proposals', style: 'primary', allowed: true }],
      onAction(action) {
        if (action !== 'obj_town_proposals') return { ok: false, message: 'Unknown action.' };
        return { ok: open(), message: 'Town improvement proposal letters.' };
      },
    };
  }
  function attachLetters(desk, THREE) {
    desk.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(desk); // Authored desk height/position, including editor transforms.
    const pile = new THREE.Group(); // Three thin paper sheets sit directly above the real tabletop.
    pile.position.set((bounds.min.x + bounds.max.x) / 2, bounds.max.y + 0.008, (bounds.min.z + bounds.max.z) / 2);
    for (let i = 0; i < 3; i++) {
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.006, 0.24), new THREE.MeshBasicMaterial({ color: 0xe7dcc4 })); // Geometric paper prop, not an authored PNG plane.
      sheet.position.set(i * 0.012, i * 0.008, -i * 0.007); sheet.rotation.y = (i - 1) * 0.13;
      pile.add(sheet);
    }
    desk.parent.add(pile); desk.attach(pile); // Preserve world sizing while inheriting subsequent desk movement.
    return pile;
  }
  global.TownProposals = { init(value) { deps = value; }, open, close, makeInteractable, attachLetters, requirements };
})(window);

// Dialogue UI layout guard.
//
// The main stylesheet intentionally makes the game's render canvases fill their
// containing scene (`canvas { position:absolute; inset:0; ... }`). The NPC
// portrait is also a canvas, but it is ordinary flexbox UI and must not inherit
// that scene-canvas positioning. Keep the exception next to the dialogue
// runtime rather than letting the portrait escape its small left-hand slot and
// cover the name/text/response panel.
(() => {
  'use strict';

  const STYLE_ID = 'dialogue-layout-guard-style'; // Used to make the guard idempotent if a hot reload or test loads it twice.
  const STYLE_TEXT = `
#npcPortraitCanvas {
  position: static;
  inset: auto;
}
`;

  function install() {
    if (typeof document === 'undefined') return false;
    if (document.getElementById(STYLE_ID)) return true;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    (document.head || document.documentElement)?.appendChild(style);
    return !!style.parentNode;
  }

  function debugSnapshot() {
    const canvas = document.getElementById('npcPortraitCanvas');
    const text = document.getElementById('npcDialogueText');
    const wrapper = document.getElementById('npcPortraitWrap');
    const dialogue = document.getElementById('npcDialogue');
    const computed = canvas && typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
    const rect = element => {
      const box = element?.getBoundingClientRect?.();
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    };
    return {
      installed: !!document.getElementById(STYLE_ID),
      portraitPosition: computed?.position || null,
      portraitInset: computed ? [computed.top, computed.right, computed.bottom, computed.left] : null,
      portraitRect: rect(canvas),
      portraitWrapRect: rect(wrapper),
      dialogueRect: rect(dialogue),
      textRect: rect(text),
      visibleText: text?.textContent || '',
    };
  }

  install();
  window.DialogueLayoutGuard = Object.freeze({ install, debugSnapshot });
  window.__dialogueLayoutDebug = debugSnapshot; // Mobile/no-console debug hook used by the in-game debug tooling when this layout is investigated again.
})();

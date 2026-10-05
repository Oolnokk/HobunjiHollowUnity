from pathlib import Path

path = Path('docs/js/character-studio-pattern-integration.js')
text = path.read_text()

old_css = "      .cs-pattern-overlay{position:fixed;inset:0;z-index:9700;background:rgba(3,7,12,.86);display:flex;align-items:center;justify-content:center;padding:12px}.cs-pattern-popup{"
new_css = "      .cs-pattern-overlay[hidden]{display:none!important}.cs-pattern-overlay{position:fixed;inset:0;z-index:9700;background:rgba(3,7,12,.86);display:flex;align-items:center;justify-content:center;padding:12px}.cs-pattern-popup{"
if old_css not in text:
    raise SystemExit('missing popup CSS anchor')
text = text.replace(old_css, new_css, 1)

old_events = "    overlay.querySelector('.cs-pattern-popup-close').onclick = closePopup;\n    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) closePopup(); });\n  }"
new_events = "    overlay.querySelector('.cs-pattern-popup-close').onclick = closePopup;\n    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) closePopup(); });\n    document.addEventListener('keydown', event => {\n      if (event.key === 'Escape' && overlay && !overlay.hidden) closePopup();\n    }); // Popup-only Escape handler; ensureOverlay runs once, so this cannot stack duplicate listeners.\n  }"
if old_events not in text:
    raise SystemExit('missing popup event anchor')
text = text.replace(old_events, new_events, 1)

path.write_text(text)

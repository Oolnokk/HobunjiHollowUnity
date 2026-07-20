# Hobunji Animation Author

This tool combines two authoring modes:

- **Multi-avatar animation** for relative actor choreography and reusable scene presets.
- **Single-avatar animation** for the native portrait mesh format used by breathing and body emotes.

The browser entry point is `index.html`. Its ordered `animation-author-XX.js` files are classic scripts split from the standalone author so existing lexical bindings and repository-runtime behavior remain intact while individual source files stay reviewable.

Tool and weapon attack animation data is intentionally excluded; it remains owned by `../attack-animation-editor/`.

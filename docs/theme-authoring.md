# Theme authoring

Two shared themes ship: Walnut Parlor (`walnut`) and Slate Study (`slate`). Their schemas are the actual JSON files under `src/themes/<id>/theme.json`; register metadata in `src/themes/themes.js`.

The browser's `GNC.applyTheme` maps `colors`, `typography`, `textures`, `borders` and `controls` to CSS variables. Player color arrays use corresponding text colors and symbols so color is not the only cue. Sounds use the theme's synthesized palette. Current textures are CSS expressions, and browser fonts use locally available font stacks; Cinzel is bundled for the optional EffectCraft tool, not fetched by the browser.

Themes affect presentation only. Every game shares controls and must remain legible in each theme. The Wordwright artwork selector is independent: drawn, Maple, Walnut, Felt and Slate boards share the same calibrated grid from `assets/wordwright/boards.json`. JPEGs are converted into Apps Script HTML data files by the build and fetched through the authenticated asset RPC. Missing optional images fall back to drawn tiles/board. There are no raster letter tiles in the kit.

For approved board replacements, update the source PNG, regenerate JPEGs with `python3 tools/make_board_assets.py` (Pillow), inspect alignment and provenance, then deliberately update the content allowlist in `tools/asset-policy.json`. The build rejects unknown raster content, including renamed or embedded images. A hash approval is an engineering inventory decision, not legal clearance. Test both themes at phone and desktop sizes and regenerate the How to Play PDFs after visual changes.

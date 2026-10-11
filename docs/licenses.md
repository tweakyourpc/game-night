# Licence and asset inventory

| Material | Origin and terms |
|---|---|
| Platform, games, UI, build and docs | Game Night contributors, MIT; full text in ../LICENSE. Wordwright carries over rules/tests from the user-supplied Crabbles project. No separate upstream code notice was found in that supplied source. |
| Cinzel.ttf | Copied from the supplied project's font assets; matches that font byte-for-byte. Copyright 2020 The Cinzel Project Authors. SIL Open Font License 1.1, verbatim in ../tools/effectcraft/fonts/OFL. Used by the optional EffectCraft converter. |
| ENABLE word list | Downloaded at runtime from dolph/dictionary's enable1.txt; upstream describes ENABLE as public domain. Not bundled. The implementation adds QI, ZA, QIS, ZAS, OK and EW. |
| Maple source board | Byte-identical to the supplied project's assets_src/CRABBLES.png. Earlier project notes describe it as user-provided custom artwork. Original artist, creation process, source rights and redistribution permission have not been independently established. |
| Walnut, Felt, Slate source boards | Byte-identical to supplied assets_src/boards/crabbles_walnut.png, crabbles_felt.png and crabbles_slate.png. Prior plan describes generated variants; generation history/model and licensing evidence were not supplied. Rights remain unresolved. |
| Four JPEG board derivatives | Made by tools/make_board_assets.py from those four PNGs at 1000 pixels, JPEG quality 82. Same unresolved provenance applies. Removal of metadata or visible text proves no ownership or clearance. |
| Grid calibration | Carried over with the supplied custom board; assets_src/wordwright/boards/grid.json and generated assets/wordwright/boards.json. |
| Letter tiles, game pieces, How to Play diagrams | Drawn in SVG/CSS by kit code. EffectCraft tiles are freshly drawn using Cinzel; no old tile photographs or birch-tile rasters are included. |
| Sounds | Synthesized by WebAudio in kit code; no bundled audio recordings. |
| Browser libraries | No external runtime JavaScript libraries or remote browser fonts are required. Developer tools have their own licences and are not bundled. |

The excluded 1948 Scrabble board screenshot/photo, old photographed wooden tiles and generated birch tile pictures are not distributed. The build keeps known source and embedded-image SHA-256 fingerprints and accepts only the eight inventoried board raster files. Renaming an excluded or unknown raster does not bypass the content guard. This guard does not establish legal clearance or identify every possible derivative image.

Cinzel's OFL was compared byte-for-byte with the authoritative [Google Fonts copy](https://raw.githubusercontent.com/google/fonts/main/ofl/cinzel/OFL.txt). Its SHA-256 and the font/artwork hashes are recorded in the source `tools/asset-policy.json`. No other pre-existing licence texts are bundled in this kit. The original supplied project's font licence was inspected read-only; any difference there is not silently propagated or edited.

[ENABLE source and public-domain statement](https://github.com/dolph/dictionary). Do not extend the MIT notice to the font or make unverified claims about the custom boards.

#!/usr/bin/env python3
"""Contributor tool: turn the Wordwright board pictures in assets_src/wordwright/boards/
into the small prebuilt files the release uses (assets/wordwright/). Installers never
run this; the outputs are committed.

  python3 tools/make_board_assets.py        (needs Pillow)

Writes board-<id>.jpg (1000 px, quality 82) and boards.json with the square grid as
fractions of the picture, so any size works.
"""
import json
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "assets_src" / "wordwright" / "boards"
OUT = HERE / "assets" / "wordwright"
BOARDS = {"maple": "Maple", "walnut": "Walnut", "felt": "Felt", "slate": "Slate"}
SIZE = 1000

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    grid = json.loads((SRC / "grid.json").read_text())
    w, h = grid["size"]
    meta = {"grid": {"cols": [round(x / w, 5) for x in grid["cols"]], "rows": [round(y / h, 5) for y in grid["rows"]]}, "boards": {}}
    for bid, name in BOARDS.items():
        im = Image.open(SRC / f"{bid}.png").convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        dest = OUT / f"board-{bid}.jpg"
        im.save(dest, "JPEG", quality=82, optimize=True, progressive=True)   # no metadata is written
        meta["boards"][bid] = {"name": name, "file": dest.name, "bytes": dest.stat().st_size}
        print(dest.relative_to(HERE), dest.stat().st_size, "bytes")
    (OUT / "boards.json").write_text(json.dumps(meta, indent=1) + "\n")

if __name__ == "__main__":
    main()

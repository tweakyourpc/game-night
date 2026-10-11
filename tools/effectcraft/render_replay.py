#!/usr/bin/env python3
"""Turn a Wordwright replay file into an EffectCraft project (and, optionally, an MP4).

Contributor tool. It runs on your computer, never inside an installation.
Needs Python 3 with Pillow; rendering also needs the EffectCraft command-line tool.

  python3 tools/effectcraft/render_replay.py replay.json
  python3 tools/effectcraft/render_replay.py replay.json --board walnut --speed fast --render

Input: a replay file in Game Night replay format v1 (from "Download replay file").
Output folder (default build/effectcraft/<name>/):
  recipe.yaml        the game in the EffectCraft "game recipe" layout (mode: game), the same
                     fields the earlier replay renderer read, so existing tools still work
  media/board.png    the board: drawn here, or one of the optional board pictures
  media/tiles/*.png  letter tiles, DRAWN HERE from the bundled font (no tile pictures)
  <name>.jsx         the EffectCraft script that builds the animation
With --render it also runs effectcraft-cli to build the project and write <name>.mp4.

Everything is deterministic: the same replay and options give byte-identical tiles and the
same script, so outputs can be compared or cached.
"""

import argparse
import math
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FONT = HERE / "fonts" / "Cinzel.ttf"
BOARDS_SRC = ROOT / "assets_src" / "wordwright" / "boards"
BOARD_META = ROOT / "assets" / "wordwright" / "boards.json"
VALUES = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", [1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10]))
SPEEDS = {"slow": 1.4, "normal": 1.0, "fast": 0.65}
W, H, FPS = 1920, 1080, 30
TILE = 160
BOARD_PX = 1254
PREMIUM_Q = {"TW": [(0, 0), (0, 7), (7, 0)], "DW": [(1, 1), (2, 2), (3, 3), (4, 4), (7, 7)],
             "TL": [(1, 5), (5, 1), (5, 5)], "DL": [(0, 3), (3, 0), (2, 6), (6, 2), (3, 7), (7, 3), (6, 6)]}


def premium_grid():
    g = [[""] * 15 for _ in range(15)]
    for kind, cells in PREMIUM_Q.items():
        for r, c in cells:
            for rr, cc in ((r, c), (r, 14 - c), (14 - r, c), (14 - r, 14 - c)):
                g[rr][cc] = kind
    return g


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "replay"


# --------------------------------------------------------------------------- recipe

def to_recipe(rp, board):
    """Replay format v1 -> the EffectCraft game recipe layout (mode: game)."""
    if rp.get("format") != "game-night-replay" or rp.get("version") != 1:
        raise SystemExit("That is not a Game Night replay file (format game-night-replay, version 1).")
    if rp["game"]["id"] != "wordwright":
        raise SystemExit(f"This converter makes word-game animations; {rp['game']['name']} replays play in the browser instead.")
    names = {p["id"]: p["name"] for p in rp["players"]}
    moves = []
    for e in rp["events"]:
        p = e.get("public") or {}
        who = names.get(p.get("player") or e.get("actor"), "?")
        if e["type"] == "play":
            moves.append({"player": who, "type": "play", "tiles": [[t["r"], t["c"], t["l"], bool(t.get("b"))] for t in p["tiles"]],
                          "words": [w["word"] for w in p.get("words", [])], "score": p.get("score", 0), "bingo": bool(p.get("bingo"))})
        elif e["type"] == "exchange":
            moves.append({"player": who, "type": "exchange", "count": p.get("count", 0)})
        elif e["type"] == "pass":
            moves.append({"player": who, "type": "pass"})
        elif e["type"] == "abandoned":
            moves.append({"player": who, "type": "ended"})
    final = rp.get("final") or {}
    winners = [names.get(w, "?") for w in final.get("winners") or []]
    status = {"finished": "finished", "abandoned": "ended"}.get(final.get("status"), "active")
    scores = {names.get(k, k): v for k, v in (final.get("scores") or {}).items()}
    started = rp["match"].get("started") or 0
    name = slug(f"wordwright-{rp['match']['id']}")
    return {
        "mode": "game", "name": name, "skin": board, "players": [p["name"] for p in rp["players"]], "moves": moves,
        "result": {"status": status, "winner": ("tie" if len(winners) > 1 else winners[0]) if winners else None, "scores": scores,
                   "adjustments": [{"player": names.get(a["player"], "?"), "points": a["points"], "reason": a["reason"]} for a in final.get("adjustments") or []]},
        "source": {"format": rp["format"], "version": rp["version"], "rulesVersion": rp["game"]["rulesVersion"], "started": started},
    }


def yaml_dump(obj, indent=0):
    """A small YAML writer (JSON scalars are valid YAML), so PyYAML is not needed."""
    pad = "  " * indent
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)) and v:
                out.append(f"{pad}{k}:")
                out.append(yaml_dump(v, indent + 1))
            else:
                out.append(f"{pad}{k}: {json.dumps(v, ensure_ascii=False) if v != {} and v != [] else ('{}' if v == {} else '[]')}")
    else:
        for v in obj:
            if isinstance(v, dict) and v:
                first = True
                for line in yaml_dump(v, indent + 1).split("\n"):
                    out.append((pad + "- " + line.lstrip()) if first else line)
                    first = False
            else:
                out.append(f"{pad}- {json.dumps(v, ensure_ascii=False)}")
    return "\n".join(out)


# --------------------------------------------------------------------------- drawn media

def font(size):
    return ImageFont.truetype(str(FONT), size)


def draw_tile(letter, blank=False):
    """One tile, drawn: cream face, brown edge, letter and points (blank: dashed ring)."""
    s = 4  # supersample, then reduce: smooth edges, still deterministic
    im = Image.new("RGBA", (TILE * s, TILE * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad, rad = 6 * s, 20 * s
    d.rounded_rectangle([pad, pad, TILE * s - pad, TILE * s - pad], rad, fill=(247, 236, 210, 255), outline=(138, 106, 63, 255), width=4 * s)
    d.rounded_rectangle([pad + 4 * s, pad + 4 * s, TILE * s - pad - 4 * s, TILE * s // 2], rad, fill=(255, 255, 255, 60))
    if blank:
        m = 26 * s
        for i in range(0, TILE * s - 2 * m, 18 * s):
            for (x0, y0, x1, y1) in ((m + i, m, m + i + 9 * s, m), (m + i, TILE * s - m, m + i + 9 * s, TILE * s - m),
                                     (m, m + i, m, m + i + 9 * s), (TILE * s - m, m + i, TILE * s - m, m + i + 9 * s)):
                d.line([x0, y0, min(x1, TILE * s - m), min(y1, TILE * s - m)], fill=(138, 59, 18, 255), width=3 * s)
    else:
        f = font(92 * s)
        box = d.textbbox((0, 0), letter, font=f)
        cx = TILE * s * 0.45
        d.text((cx - (box[2] + box[0]) / 2, TILE * s * 0.47 - (box[3] + box[1]) / 2), letter, font=f, fill=(42, 26, 15, 255))
        pts = str(VALUES[letter])
        f2 = font(34 * s)
        b2 = d.textbbox((0, 0), pts, font=f2)
        d.text((TILE * s - 22 * s - b2[2], TILE * s - 22 * s - b2[3]), pts, font=f2, fill=(42, 26, 15, 255))
    return im.resize((TILE, TILE), Image.LANCZOS)


def draw_board(meta):
    """The drawn board: the same squares and premiums as the game, no artwork."""
    s = 2
    size = BOARD_PX * s
    im = Image.new("RGB", (size, size), (110, 70, 38))
    d = ImageDraw.Draw(im)
    cols = [x * size for x in meta["grid"]["cols"]]
    rows = [y * size for y in meta["grid"]["rows"]]
    d.rectangle([cols[0] - 10 * s, rows[0] - 10 * s, cols[-1] + 10 * s, rows[-1] + 10 * s], fill=(201, 154, 91))
    colors = {"TW": (168, 50, 42), "DW": (232, 164, 127), "TL": (30, 95, 143), "DL": (169, 211, 239), "": (231, 194, 140)}
    ink = {"TW": (255, 255, 255), "DW": (58, 20, 5), "TL": (255, 255, 255), "DL": (12, 43, 64)}
    label = {"TW": "3W", "DW": "2W", "TL": "3L", "DL": "2L"}
    g = premium_grid()
    f = font(26 * s)
    for r in range(15):
        for c in range(15):
            x0, x1, y0, y1 = cols[c] + 2 * s, cols[c + 1] - 2 * s, rows[r] + 2 * s, rows[r + 1] - 2 * s
            d.rounded_rectangle([x0, y0, x1, y1], 5 * s, fill=colors[g[r][c]])
            text = "★" if (r, c) == (7, 7) else label.get(g[r][c])
            if text and text != "★":
                b = d.textbbox((0, 0), text, font=f)
                d.text(((x0 + x1 - b[2] - b[0]) / 2, (y0 + y1 - b[3] - b[1]) / 2), text, font=f, fill=ink[g[r][c]])
            elif text == "★":
                cx, cy, rr = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.32
                pts = [(cx + rr * (1 if k % 2 == 0 else 0.45) * math.sin(k * math.pi / 5), cy - rr * (1 if k % 2 == 0 else 0.45) * math.cos(k * math.pi / 5)) for k in range(10)]
                d.polygon(pts, fill=(58, 20, 5))
    return im.resize((BOARD_PX, BOARD_PX), Image.LANCZOS)


def save_png(im, path):
    im.save(path, "PNG", optimize=True)          # Pillow writes no timestamps or text chunks here


# --------------------------------------------------------------------------- EffectCraft script

def build(replay_path, out_dir, board, speed):
    rp = json.loads(Path(replay_path).read_text())
    recipe = to_recipe(rp, board)
    meta = json.loads(BOARD_META.read_text())
    name = recipe["name"]
    out = Path(out_dir) if out_dir else ROOT / "build" / "effectcraft" / name
    media = out / "media"
    (media / "tiles").mkdir(parents=True, exist_ok=True)
    (out / "recipe.yaml").write_text("# EffectCraft game recipe, made from a Game Night replay by render_replay.py\n" + yaml_dump(recipe) + "\n")

    if board == "drawn":
        save_png(draw_board(meta), media / "board.png")
    else:
        src = BOARDS_SRC / f"{board}.png"
        if not src.exists():
            raise SystemExit(f"The {board} board picture is not in this copy ({src}); use --board drawn.")
        Image.open(src).convert("RGB").resize((BOARD_PX, BOARD_PX), Image.LANCZOS).save(media / "board.png", "PNG", optimize=True)
    for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        save_png(draw_tile(ch), media / "tiles" / f"{ch}.png")
    save_png(draw_tile("", blank=True), media / "tiles" / "BLANK.png")

    k = SPEEDS[speed]
    js = json.dumps
    scale = H / BOARD_PX
    ox = (W - BOARD_PX * scale) / 2
    cols = [x * BOARD_PX for x in meta["grid"]["cols"]]
    rows = [y * BOARD_PX for y in meta["grid"]["rows"]]

    def center(r, c):
        return [round(ox + (cols[c] + cols[c + 1]) / 2 * scale, 2), round((rows[r] + rows[r + 1]) / 2 * scale, 2)]

    def tile_scale(r, c):
        return round((cols[c + 1] - cols[c] - 3) * scale / TILE * 100, 3)

    moves = recipe["moves"]
    t, times = 1.0 * k, []
    for m in moves:
        times.append(t)
        t += (1.0 + 0.14 * len(m.get("tiles") or [])) * k if m["type"] == "play" else 1.2 * k
    t_moves = t
    t_end = t_moves + 4.5 * k
    L = [
        f"// generated by render_replay.py from {Path(replay_path).name} (Game Night replay format v1)",
        "var P = app.project;",
        f"var comp = P.items.addComp({js(name)}, {W}, {H}, 1, {t_end:.3f}, {FPS});",
        "comp.bgColor = [0.07, 0.055, 0.045];",
        "function imp(p){ return P.importFile(new ImportOptions(new File(p))); }",
        "function tr(l,n){ return l.property('ADBE Transform Group').property(n); }",
        "function lin(p){ for (var i=1;i<=p.numKeys;i++) p.setInterpolationTypeAtKey(i, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); }",
        "function txt(s, size, color, x, y, a, b, nm) {",
        "  var T = comp.layers.addText(s); T.name = nm;",
        "  var D = T.property('ADBE Text Properties').property('ADBE Text Document'); var d = D.value;",
        "  d.fontSize = size; d.fillColor = color; d.font = 'DejaVuSans-Bold'; d.justification = ParagraphJustification.CENTER_JUSTIFY; D.setValue(d);",
        "  tr(T,'ADBE Position').setValue([x,y]);",
        "  var o = tr(T,'ADBE Opacity'); if (b) o.setValuesAtTimes([a, a+0.3, b-0.25, b], [0,100,100,0]); else o.setValuesAtTimes([a, a+0.3], [0,100]);",
        "}",
        "var boardSrc = imp('media/board.png');",
        "var board = comp.layers.add(boardSrc); board.name = 'Board';",
        f"tr(board,'ADBE Position').setValue([{W / 2},{H / 2}]); tr(board,'ADBE Scale').setValue([{scale * 100:.4f},{scale * 100:.4f}]);",
        "var srcs = {};",
    ]
    n = 0
    for m, tm in zip(moves, times):
        for i, (r, c, letter, blank) in enumerate(m.get("tiles") or []):
            a, d = tm + 0.14 * k * i, 0.35 * k
            key = "BLANK" if blank else letter
            sc = tile_scale(r, c)
            n += 1
            L += [
                f"if (!srcs[{js(key)}]) srcs[{js(key)}] = imp({js('media/tiles/' + key + '.png')});",
                f"var Lt = comp.layers.add(srcs[{js(key)}]); Lt.name = {js(f'{letter}{n:03d}')};",
                f"tr(Lt,'ADBE Position').setValue({js(center(r, c))});",
                f"var s = tr(Lt,'ADBE Scale'); s.setValuesAtTimes([{a:.3f},{a + d:.3f}], [[{sc * 1.6:.3f},{sc * 1.6:.3f}],[{sc},{sc}]]); lin(s);",
                f"var o = tr(Lt,'ADBE Opacity'); o.setValuesAtTimes([0,{a:.3f},{a + d * 0.6:.3f}], [0,0,100]);",
            ]
            if blank:
                cell = (rows[r + 1] - rows[r]) * scale
                cx, cy = center(r, c)
                L.append(f"txt({js(letter)}, {round(cell * 0.55)}, [0.54,0.23,0.07], {cx}, {cy + cell * 0.2:.2f}, {a + d * 0.6:.3f}, 0, {js('blank ' + letter + str(n))});")
    side = ox
    head, ink = "[0.85,0.7,0.45]", "[0.96,0.92,0.84]"
    scores = {p: 0 for p in recipe["players"]}
    segs = [(0.2, times[0] if times else t_moves, dict(scores))]
    for i, (m, tm) in enumerate(zip(moves, times)):
        if m["type"] == "play":
            scores[m["player"]] = scores.get(m["player"], 0) + m["score"]
        nxt = times[i + 1] if i + 1 < len(times) else t_moves
        segs.append((tm + 0.3 * k, nxt + 0.3 * k if i + 1 < len(times) else t_moves, dict(scores)))
        what = {"play": f"{m['player']} plays {', '.join(m.get('words', []))}", "exchange": f"{m['player']} swaps {m.get('count', '')} tiles",
                "pass": f"{m['player']} passes", "ended": f"{m['player']} ends the game"}[m["type"]]
        L.append(f"txt({js(what)}, 30, {ink}, {W - side / 2:.1f}, {H * 0.46:.1f}, {tm:.3f}, {nxt + 0.2 * k:.3f}, {js('move ' + str(i + 1))});")
        if m["type"] == "play":
            pts = f"+{m['score']}" + ("  ALL SEVEN!" if m.get("bingo") else "")
            L.append(f"txt({js(pts)}, 44, {head}, {W - side / 2:.1f}, {H * 0.46 + 60:.1f}, {tm + 0.15 * k:.3f}, {nxt + 0.2 * k:.3f}, {js('points ' + str(i + 1))});")
    final = recipe["result"]["scores"] or scores
    segs.append((t_moves, 0, dict(final)))
    for si, (a, b, sc) in enumerate(segs):
        L.append(f"txt('SCORE', 24, {head}, {side / 2:.1f}, {H * 0.36:.1f}, {a:.3f}, {b:.3f}, {js('score head ' + str(si))});")
        for pi, p in enumerate(recipe["players"]):
            L.append(f"txt({js(f'{p}  {sc.get(p, 0)}')}, 34, {ink}, {side / 2:.1f}, {H * 0.36 + 60 + pi * 50:.1f}, {a:.3f}, {b:.3f}, {js(f'score {si} {pi}')});")
    res = recipe["result"]
    end = ("It's a tie!" if res["winner"] == "tie" else f"{res['winner']} wins!") if res["status"] == "finished" and res["winner"] else \
        "Game ended early" if res["status"] == "ended" else "To be continued…"
    L.append(f"txt({js(end)}, 40, {head}, {W - side / 2:.1f}, {H * 0.46:.1f}, {t_moves + 0.2:.3f}, 0, 'result');")
    L.append("writeLn('layers ' + comp.numLayers);")
    jsx = out / f"{name}.jsx"
    jsx.write_text("\n".join(L) + "\n")
    return out, jsx, name, len(moves), t_end


def find_cli(given):
    for c in (given, os.environ.get("EFFECTCRAFT_CLI"), shutil.which("effectcraft-cli")):
        if c and Path(c).exists():
            return c
    raise SystemExit("effectcraft-cli was not found. Install EffectCraft, or pass --cli /path/to/effectcraft-cli (or set EFFECTCRAFT_CLI).")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("replay", type=Path)
    ap.add_argument("--out", type=Path, help="output folder (default build/effectcraft/<name>)")
    ap.add_argument("--board", default="drawn", choices=["drawn", "maple", "walnut", "felt", "slate"])
    ap.add_argument("--speed", default="normal", choices=list(SPEEDS))
    ap.add_argument("--render", action="store_true", help="also build the project and render an MP4 with effectcraft-cli")
    ap.add_argument("--cli", help="path to effectcraft-cli")
    a = ap.parse_args()
    if not a.replay.exists():
        raise SystemExit(f"No such file: {a.replay}")
    out, jsx, name, n, dur = build(a.replay, a.out, a.board, a.speed)
    print(f"{n} moves, {dur:.0f} s. Wrote {out}/recipe.yaml, media/ and {jsx.name}.")
    if not a.render:
        print("Add --render to make the MP4 (needs effectcraft-cli).")
        return
    cli = find_cli(a.cli)
    proj = out / f"{name}.ecproj"
    r = subprocess.run([cli, "script", jsx.name, "--save-as", proj.name], cwd=out, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit((r.stdout + r.stderr)[-1500:] + "\nBuilding the project failed.")
    mp4 = out / f"{name}.mp4"
    r = subprocess.run([cli, "render", proj.name, "--out", str(mp4), "--format", "h264", "--bitrate", "12000"], cwd=out, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit((r.stdout + r.stderr)[-1500:] + "\nThe render failed.")
    print(f"Done: {mp4}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
CARTOON_DIR = ROOT / "apps/web/public/assets/images/themes/cartoon/avatar"
PIXEL_DIR = ROOT / "apps/web/public/assets/images/themes/pixel/avatar"

SIZE = 128
OUTER_BOX = (6, 6, 122, 122)
INNER_BOX = (11, 11, 117, 117)

WHITE = (255, 255, 255, 255)
INK = (58, 42, 24, 255)


ROLES: list[dict[str, Any]] = [
    {
        "id": 1,
        "kind": "landlord",
        "skin": "#f2c79a",
        "bg": "#c63b2e",
        "shirt": "#7c2f1f",
        "accent": "#e8b53a",
    },
    {
        "id": 2,
        "kind": "farmer",
        "skin": "#d6a06a",
        "bg": "#b98a3c",
        "shirt": "#557c77",
        "accent": "#d8b15a",
    },
    {
        "id": 3,
        "kind": "farmer_woman",
        "skin": "#f4cfa6",
        "bg": "#e07a8a",
        "shirt": "#4f8a5e",
        "accent": "#d6483f",
    },
    {
        "id": 4,
        "kind": "youth",
        "skin": "#eec199",
        "bg": "#3a8fd0",
        "shirt": "#2f78b7",
        "accent": "#f7f0de",
    },
    {
        "id": 5,
        "kind": "wealthy_woman",
        "skin": "#f6d2ad",
        "bg": "#8e6fc0",
        "shirt": "#8b4c91",
        "accent": "#e8bf3c",
    },
    {
        "id": 6,
        "kind": "accountant",
        "skin": "#ecc59a",
        "bg": "#2aa39a",
        "shirt": "#2f6c77",
        "accent": "#181818",
    },
    {
        "id": 7,
        "kind": "butcher",
        "skin": "#d98e63",
        "bg": "#e07b29",
        "shirt": "#a43b2c",
        "accent": "#c82126",
    },
    {
        "id": 8,
        "kind": "peddler",
        "skin": "#e9bd92",
        "bg": "#5aa83a",
        "shirt": "#496f39",
        "accent": "#b98b4e",
    },
    {
        "id": 9,
        "kind": "fisher",
        "skin": "#d49a66",
        "bg": "#2f9bbf",
        "shirt": "#2f7893",
        "accent": "#a8c06a",
    },
    {
        "id": 10,
        "kind": "scholar",
        "skin": "#f3cda4",
        "bg": "#5566c0",
        "shirt": "#3b4f8e",
        "accent": "#34406e",
    },
    {
        "id": 11,
        "kind": "child",
        "skin": "#f8d5b0",
        "bg": "#f0b830",
        "shirt": "#e89d2d",
        "accent": "#17120f",
    },
    {
        "id": 12,
        "kind": "matchmaker",
        "skin": "#f2c9a0",
        "bg": "#c84a9a",
        "shirt": "#bd3c78",
        "accent": "#d62735",
    },
]


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    hex_color = hex_color.lstrip("#")
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
        alpha,
    )


def mix(
    c1: tuple[int, int, int, int],
    c2: tuple[int, int, int, int],
    t: float,
) -> tuple[int, int, int, int]:
    t = max(0.0, min(1.0, t))
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))  # type: ignore[return-value]


def layer(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", size, (0, 0, 0, 0))


def draw_gradient_ellipse(
    base: Image.Image,
    box: tuple[int, int, int, int],
    inner: tuple[int, int, int, int],
    outer: tuple[int, int, int, int],
    highlight_center: tuple[float, float],
) -> None:
    x0, y0, x1, y1 = box
    w = x1 - x0
    h = y1 - y0
    gradient = layer((w, h))
    pixels = gradient.load()
    cx = w * highlight_center[0]
    cy = h * highlight_center[1]
    max_dist = max(1.0, ((max(cx, w - cx) ** 2) + (max(cy, h - cy) ** 2)) ** 0.5)

    for y in range(h):
        for x in range(w):
            dx = x - cx
            dy = y - cy
            pixels[x, y] = mix(inner, outer, ((dx * dx + dy * dy) ** 0.5) / max_dist)

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, w - 1, h - 1), fill=255)
    base.paste(gradient, (x0, y0), mask)


def draw_circle_clip(size: int, box: tuple[int, int, int, int]) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    return mask


def clear_outside_avatar_circle(image: Image.Image) -> None:
    pixels = image.load()
    cx = cy = SIZE / 2
    radius = 58.0
    for y in range(SIZE):
        for x in range(SIZE):
            if math.hypot((x + 0.5) - cx, (y + 0.5) - cy) > radius:
                pixels[x, y] = (0, 0, 0, 0)


def save(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    print(f"generated {path.relative_to(ROOT)} {image.size[0]}x{image.size[1]} {image.mode}")


class CartoonDraw:
    def __init__(self, image: Image.Image, scale: int) -> None:
        self.image = image
        self.draw = ImageDraw.Draw(image)
        self.scale = scale

    def sc(self, value: float) -> int:
        return int(round(value * self.scale))

    def box(self, values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
        return tuple(self.sc(value) for value in values)  # type: ignore[return-value]

    def point(self, value: tuple[float, float]) -> tuple[int, int]:
        return self.sc(value[0]), self.sc(value[1])

    def points(self, values: list[tuple[float, float]]) -> list[tuple[int, int]]:
        return [self.point(value) for value in values]

    def ellipse(
        self,
        box: tuple[float, float, float, float],
        fill: tuple[int, int, int, int],
        outline: tuple[int, int, int, int] | None = None,
        width: float = 1,
    ) -> None:
        self.draw.ellipse(self.box(box), fill=fill, outline=outline, width=self.sc(width))

    def rectangle(
        self,
        box: tuple[float, float, float, float],
        fill: tuple[int, int, int, int],
        outline: tuple[int, int, int, int] | None = None,
        width: float = 1,
    ) -> None:
        self.draw.rectangle(self.box(box), fill=fill, outline=outline, width=self.sc(width))

    def rounded(
        self,
        box: tuple[float, float, float, float],
        radius: float,
        fill: tuple[int, int, int, int],
        outline: tuple[int, int, int, int] | None = None,
        width: float = 1,
    ) -> None:
        self.draw.rounded_rectangle(
            self.box(box),
            radius=self.sc(radius),
            fill=fill,
            outline=outline,
            width=self.sc(width),
        )

    def polygon(
        self,
        points: list[tuple[float, float]],
        fill: tuple[int, int, int, int],
        outline: tuple[int, int, int, int] | None = None,
    ) -> None:
        self.draw.polygon(self.points(points), fill=fill)
        if outline is not None:
            self.draw.line(self.points(points + [points[0]]), fill=outline, width=self.sc(2), joint="curve")

    def line(self, points: list[tuple[float, float]], fill: tuple[int, int, int, int], width: float = 1) -> None:
        self.draw.line(self.points(points), fill=fill, width=self.sc(width), joint="curve")

    def arc(
        self,
        box: tuple[float, float, float, float],
        start: int,
        end: int,
        fill: tuple[int, int, int, int],
        width: float = 1,
    ) -> None:
        self.draw.arc(self.box(box), start=start, end=end, fill=fill, width=self.sc(width))


def draw_cartoon_body(cd: CartoonDraw, role: dict[str, Any]) -> None:
    skin = rgba(role["skin"])
    shirt = rgba(role["shirt"])
    shirt_shadow = mix(shirt, rgba("#100907"), 0.24)
    neck_shadow = mix(skin, rgba("#6b351d"), 0.18)

    cd.ellipse((24, 86, 104, 132), INK)
    cd.ellipse((29, 89, 99, 132), shirt)
    cd.arc((31, 91, 97, 132), 198, 342, shirt_shadow, 2)
    cd.rounded((54, 76, 74, 100), 7, INK)
    cd.rounded((57, 77, 71, 99), 6, neck_shadow)
    cd.polygon([(49, 91), (64, 105), (79, 91), (76, 128), (52, 128)], mix(shirt, WHITE, 0.12))
    cd.line([(64, 103), (64, 128)], shirt_shadow, 1.2)


def draw_cartoon_back_hair(cd: CartoonDraw, role: dict[str, Any]) -> None:
    kind = role["kind"]
    hair = rgba("#2d2118")
    hair_light = rgba("#5a3a2a")

    if kind == "farmer_woman":
        cd.ellipse((31, 31, 51, 53), INK)
        cd.ellipse((34, 32, 50, 50), hair)
    elif kind == "wealthy_woman":
        cd.ellipse((45, 11, 83, 43), INK)
        cd.ellipse((49, 14, 79, 39), hair_light)
        cd.ellipse((36, 34, 51, 61), INK)
        cd.ellipse((77, 34, 92, 61), INK)
        cd.ellipse((39, 36, 51, 59), hair_light)
        cd.ellipse((77, 36, 89, 59), hair_light)
    elif kind == "child":
        cd.ellipse((54, 16, 74, 33), INK)
        cd.ellipse((57, 18, 71, 30), hair)
    elif kind == "matchmaker":
        cd.ellipse((43, 13, 85, 43), INK)
        cd.ellipse((47, 16, 81, 39), hair)
        cd.ellipse((31, 35, 50, 59), INK)
        cd.ellipse((78, 35, 97, 59), INK)
        cd.ellipse((34, 37, 49, 57), hair)
        cd.ellipse((79, 37, 94, 57), hair)


def draw_cartoon_head(cd: CartoonDraw, role: dict[str, Any]) -> None:
    skin = rgba(role["skin"])
    face_hi = mix(skin, WHITE, 0.16)
    face_shadow = mix(skin, rgba("#8a4a28"), 0.17)
    ear_shadow = mix(skin, rgba("#8a4a28"), 0.12)

    cd.ellipse((32, 57, 43, 75), INK)
    cd.ellipse((85, 57, 96, 75), INK)
    cd.ellipse((35, 59, 42, 73), ear_shadow)
    cd.ellipse((86, 59, 93, 73), ear_shadow)
    cd.ellipse((35, 29, 93, 98), INK)
    draw_gradient_ellipse(cd.image, cd.box((38, 32, 90, 95)), face_hi, face_shadow, (0.36, 0.22))

    if role["kind"] in {"wealthy_woman", "matchmaker"}:
        gold = rgba("#e8bf3c")
        cd.ellipse((27, 65, 33, 76), INK)
        cd.ellipse((95, 65, 101, 76), INK)
        cd.ellipse((28, 66, 32, 74), gold)
        cd.ellipse((96, 66, 100, 74), gold)


def draw_straw_lines(cd: CartoonDraw, color: tuple[int, int, int, int], top: bool = False) -> None:
    if top:
        for x in (48, 56, 64, 72, 80):
            cd.line([(64, 12), (x, 34)], color, 0.8)
    else:
        for y in (27, 33, 38):
            cd.arc((24, y - 6, 104, y + 8), 7, 173, color, 0.8)


def draw_cartoon_identity(cd: CartoonDraw, role: dict[str, Any]) -> None:
    kind = role["kind"]
    accent = rgba(role["accent"])
    accent_light = mix(accent, WHITE, 0.25)
    accent_shadow = mix(accent, rgba("#120907"), 0.18)
    hair = rgba("#241810")
    hair_light = rgba("#5a3a2a")
    straw_line = rgba("#7b5a2d", 210)
    red = rgba("#d6483f")

    if kind == "landlord":
        cd.ellipse((38, 20, 90, 50), INK)
        cd.ellipse((42, 23, 86, 47), accent)
        cd.rounded((42, 38, 86, 49), 5, accent_shadow)
        cd.ellipse((51, 25, 65, 34), accent_light)
        cd.line([(51, 40), (77, 40)], rgba("#7b4f18"), 1)
    elif kind == "farmer":
        cd.ellipse((18, 19, 110, 44), INK)
        cd.ellipse((22, 22, 106, 41), accent)
        cd.polygon([(39, 28), (64, 9), (89, 28), (100, 36), (28, 36)], INK)
        cd.polygon([(44, 28), (64, 13), (84, 28), (93, 34), (35, 34)], accent_light)
        draw_straw_lines(cd, straw_line, top=True)
        draw_straw_lines(cd, straw_line)
    elif kind == "farmer_woman":
        cd.polygon([(33, 45), (43, 25), (65, 18), (88, 27), (96, 48), (64, 44)], INK)
        cd.polygon([(38, 43), (46, 28), (65, 23), (84, 30), (91, 45), (64, 41)], red)
        cd.ellipse((84, 39, 101, 54), INK)
        cd.ellipse((87, 40, 98, 51), red)
        cd.polygon([(94, 48), (109, 57), (91, 61)], red, INK)
        cd.line([(46, 30), (64, 41), (84, 30)], mix(red, WHITE, 0.18), 1)
    elif kind == "youth":
        cd.ellipse((38, 23, 90, 48), INK)
        cd.ellipse((41, 25, 87, 43), hair)
        cd.polygon([(39, 38), (47, 29), (55, 38), (63, 29), (72, 38), (84, 30), (90, 42)], hair)
        cd.rounded((36, 33, 92, 43), 4, INK)
        cd.rounded((39, 34, 89, 41), 3, rgba("#f7f0de"))
        cd.ellipse((84, 31, 99, 45), INK)
        cd.ellipse((87, 32, 96, 42), rgba("#f7f0de"))
        cd.line([(45, 36), (78, 39)], mix(rgba("#f7f0de"), rgba("#cbbf9e"), 0.5), 0.8)
    elif kind == "wealthy_woman":
        gold = rgba("#e8bf3c")
        cd.ellipse((49, 15, 79, 40), hair_light)
        cd.line([(43, 29), (85, 20)], gold, 2.2)
        cd.ellipse((83, 18, 90, 25), INK)
        cd.ellipse((84, 19, 89, 24), gold)
        cd.arc((43, 28, 85, 61), 190, 350, hair, 2)
    elif kind == "accountant":
        cd.ellipse((39, 21, 89, 48), INK)
        cd.ellipse((43, 24, 85, 45), rgba("#171717"))
        cd.rectangle((43, 39, 85, 48), rgba("#101010"))
        cd.line([(49, 41), (79, 41)], rgba("#3a3a3a"), 1)
    elif kind == "butcher":
        cd.rounded((36, 35, 92, 45), 4, INK)
        cd.rounded((39, 36, 89, 42), 3, accent)
        cd.polygon([(87, 38), (103, 34), (92, 47)], accent, INK)
        cd.line([(43, 38), (82, 40)], mix(accent, WHITE, 0.18), 0.8)
    elif kind == "peddler":
        cd.ellipse((20, 20, 108, 43), INK)
        cd.ellipse((24, 22, 104, 40), accent)
        cd.polygon([(39, 28), (64, 9), (90, 29), (96, 35), (32, 35)], INK)
        cd.polygon([(44, 28), (64, 13), (85, 29), (91, 33), (37, 33)], mix(accent, WHITE, 0.14))
        draw_straw_lines(cd, rgba("#6f512c", 215), top=True)
    elif kind == "fisher":
        cd.ellipse((22, 18, 106, 42), INK)
        cd.ellipse((26, 21, 102, 38), accent)
        cd.polygon([(38, 27), (64, 7), (91, 28), (99, 35), (30, 35)], INK)
        cd.polygon([(43, 27), (64, 12), (86, 28), (92, 33), (36, 33)], mix(accent, WHITE, 0.12))
        cd.line([(45, 30), (88, 29)], mix(accent, rgba("#566d38"), 0.34), 1)
        draw_straw_lines(cd, rgba("#5c743a", 215), top=True)
    elif kind == "scholar":
        blue = rgba("#34406e")
        cd.ellipse((37, 19, 91, 47), INK)
        cd.ellipse((41, 22, 87, 43), blue)
        cd.rounded((38, 38, 90, 50), 5, INK)
        cd.rounded((41, 39, 87, 48), 4, mix(blue, WHITE, 0.08))
        cd.polygon([(84, 42), (102, 49), (89, 58)], blue, INK)
        cd.line([(48, 29), (80, 28)], mix(blue, WHITE, 0.18), 1)
    elif kind == "child":
        cd.line([(64, 30), (64, 20)], INK, 2.5)
        cd.ellipse((56, 16, 72, 30), hair)
        cd.ellipse((59, 20, 69, 32), INK)
        cd.ellipse((60, 21, 68, 29), rgba("#bb2d34"))
        for x in (42, 51, 77, 86):
            cd.ellipse((x - 5, 34, x + 5, 45), hair)
    elif kind == "matchmaker":
        cd.arc((41, 20, 87, 58), 190, 350, hair, 2)
        flower = rgba("#e9374f")
        flower_hi = rgba("#ff8ba1")
        for dx, dy in ((0, -5), (5, 0), (0, 5), (-5, 0)):
            cd.ellipse((83 + dx, 26 + dy, 94 + dx, 37 + dy), INK)
            cd.ellipse((85 + dx, 28 + dy, 92 + dx, 35 + dy), flower)
        cd.ellipse((86, 29, 91, 34), flower_hi)


def draw_cartoon_eyes(cd: CartoonDraw, kind: str) -> None:
    brow = rgba("#2a1c14")
    if kind == "accountant":
        cd.ellipse((47, 54, 62, 69), (0, 0, 0, 0), INK, 1.6)
        cd.ellipse((66, 54, 81, 69), (0, 0, 0, 0), INK, 1.6)
        cd.line([(62, 61), (66, 61)], INK, 1.2)
        cd.ellipse((53, 60, 57, 64), brow)
        cd.ellipse((72, 60, 76, 64), brow)
        cd.line([(49, 52), (59, 51)], brow, 1.1)
        cd.line([(69, 51), (79, 52)], brow, 1.1)
        return

    if kind == "child":
        for cx in (53, 75):
            cd.ellipse((cx - 5, 57, cx + 5, 69), brow)
            cd.ellipse((cx - 2, 59, cx + 1, 63), WHITE)
        cd.line([(47, 53), (58, 51)], brow, 1.2)
        cd.line([(70, 51), (82, 53)], brow, 1.2)
        return

    if kind == "matchmaker":
        cd.arc((46, 55, 60, 66), 200, 340, brow, 2)
        cd.arc((68, 55, 82, 66), 200, 340, brow, 2)
        cd.line([(45, 50), (58, 52)], brow, 1.5)
        cd.line([(70, 52), (83, 50)], brow, 1.5)
        return

    for cx in (53, 75):
        cd.ellipse((cx - 3.4, 57, cx + 3.4, 65), brow)
        cd.ellipse((cx - 1, 58, cx + 0.8, 60.5), WHITE)

    if kind == "butcher":
        cd.line([(45, 52), (60, 56)], brow, 2)
        cd.line([(68, 56), (83, 52)], brow, 2)
    elif kind == "scholar":
        cd.arc((46, 52, 60, 61), 200, 340, brow, 1.2)
        cd.arc((68, 52, 82, 61), 200, 340, brow, 1.2)
    else:
        cd.line([(46, 53), (60, 52)], brow, 1.2)
        cd.line([(68, 52), (82, 53)], brow, 1.2)


def draw_cartoon_mouth(cd: CartoonDraw, role: dict[str, Any]) -> None:
    kind = role["kind"]
    mouth = rgba("#5b1a16")
    lip = rgba("#b8323b")
    gold = rgba("#f0c34a")

    if kind == "landlord":
        cd.ellipse((46, 66, 64, 76), rgba("#14100d"))
        cd.ellipse((64, 66, 82, 76), rgba("#14100d"))
        cd.ellipse((52, 74, 78, 88), INK)
        cd.rounded((55, 75, 75, 85), 5, mouth)
        cd.rectangle((57, 76, 66, 80), WHITE)
        cd.rectangle((66, 76, 72, 80), gold)
    elif kind == "farmer":
        gray = rgba("#d6d0bf")
        cd.ellipse((47, 66, 63, 77), gray)
        cd.ellipse((65, 66, 81, 77), gray)
        cd.arc((48, 71, 80, 94), 8, 172, rgba("#817d72"), 2)
        cd.arc((55, 72, 73, 84), 18, 162, mouth, 1.6)
    elif kind == "farmer_woman":
        cd.ellipse((43, 68, 51, 76), rgba("#ee7f86", 130))
        cd.ellipse((77, 68, 85, 76), rgba("#ee7f86", 130))
        cd.arc((54, 69, 76, 84), 18, 162, lip, 2)
    elif kind == "youth":
        cd.rounded((54, 72, 76, 85), 6, INK)
        cd.rectangle((57, 73, 73, 77), WHITE)
        cd.arc((55, 73, 75, 88), 20, 160, lip, 1.6)
    elif kind == "wealthy_woman":
        cd.ellipse((42, 69, 50, 76), rgba("#ef8b92", 120))
        cd.ellipse((78, 69, 86, 76), rgba("#ef8b92", 120))
        cd.arc((53, 69, 77, 86), 16, 164, mouth, 2)
        cd.arc((50, 82, 78, 97), 12, 168, mix(rgba(role["skin"]), rgba("#8a4a28"), 0.2), 1)
    elif kind == "accountant":
        cd.line([(55, 77), (73, 77)], mouth, 1.6)
    elif kind == "butcher":
        for x, y in ((49, 69), (56, 72), (74, 70), (80, 73), (63, 76), (70, 77)):
            cd.ellipse((x, y, x + 2.5, y + 2.5), rgba("#5a3426", 170))
        cd.rounded((52, 73, 79, 88), 7, INK)
        cd.rectangle((56, 74, 75, 79), WHITE)
        cd.arc((54, 74, 77, 90), 15, 165, lip, 1.6)
    elif kind == "peddler":
        cd.arc((54, 70, 76, 84), 18, 162, mouth, 1.8)
    elif kind == "fisher":
        gray = rgba("#c6c0b5")
        cd.rectangle((51, 68, 61, 71), gray)
        cd.rectangle((67, 68, 77, 71), gray)
        for x, y in ((52, 75), (59, 78), (70, 76), (76, 80)):
            cd.ellipse((x, y, x + 2.3, y + 2.3), rgba("#6e655f", 150))
        cd.arc((55, 70, 75, 84), 18, 162, mouth, 1.5)
    elif kind == "scholar":
        cd.arc((55, 71, 75, 83), 22, 158, mouth, 1.4)
    elif kind == "child":
        cd.ellipse((42, 69, 51, 77), rgba("#ee7f86", 140))
        cd.ellipse((77, 69, 86, 77), rgba("#ee7f86", 140))
        cd.rounded((56, 73, 74, 84), 6, INK)
        cd.rectangle((59, 74, 71, 78), WHITE)
    elif kind == "matchmaker":
        cd.ellipse((40, 67, 52, 78), rgba("#e23d62", 160))
        cd.ellipse((76, 67, 88, 78), rgba("#e23d62", 160))
        cd.ellipse((77, 61, 82, 66), rgba("#25170f"))
        cd.ellipse((53, 72, 80, 90), INK)
        cd.ellipse((56, 74, 77, 88), lip)
        cd.arc((55, 73, 78, 89), 18, 162, WHITE, 1.4)


def draw_cartoon_features(cd: CartoonDraw, role: dict[str, Any]) -> None:
    kind = role["kind"]
    nose = mix(rgba(role["skin"]), rgba("#8a4a28"), 0.25)
    draw_cartoon_eyes(cd, kind)
    cd.arc((60, 62, 69, 75), 270, 90, nose, 1.2)
    draw_cartoon_mouth(cd, role)


def cartoon_avatar(role: dict[str, Any]) -> Image.Image:
    scale = 4
    canvas_size = SIZE * scale
    img = layer((canvas_size, canvas_size))
    cd = CartoonDraw(img, scale)
    bg = rgba(role["bg"])

    cd.ellipse(OUTER_BOX, bg)
    draw_gradient_ellipse(
        img,
        cd.box(INNER_BOX),
        mix(bg, WHITE, 0.33),
        mix(bg, rgba("#1f130b"), 0.12),
        (0.36, 0.22),
    )
    cd.arc((17, 90, 111, 119), 185, 355, mix(bg, rgba("#24110d"), 0.2), 3)

    draw_cartoon_body(cd, role)
    draw_cartoon_back_hair(cd, role)
    draw_cartoon_head(cd, role)
    draw_cartoon_identity(cd, role)
    draw_cartoon_features(cd, role)

    mask = draw_circle_clip(canvas_size, cd.box(OUTER_BOX))
    clipped = layer((canvas_size, canvas_size))
    clipped.paste(img, (0, 0), mask)
    avatar = clipped.resize((SIZE, SIZE), Image.Resampling.LANCZOS)

    final_mask = draw_circle_clip(canvas_size, cd.box(OUTER_BOX)).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    avatar.putalpha(final_mask)
    clear_outside_avatar_circle(avatar)
    return avatar


def fill_pixel_background(img: Image.Image, role: dict[str, Any]) -> None:
    pixels = img.load()
    bg = rgba(role["bg"])
    inner = mix(bg, WHITE, 0.32)
    outer = mix(bg, rgba("#160c08"), 0.10)
    cx = cy = 15.5
    outer_radius = 14.5
    inner_radius = 13.15

    for y in range(32):
        for x in range(32):
            distance = math.hypot((x + 0.5) - cx, (y + 0.5) - cy)
            if distance <= outer_radius:
                if distance >= inner_radius:
                    pixels[x, y] = bg
                else:
                    t = min(1.0, distance / inner_radius * 0.72 + y / 32 * 0.18)
                    pixels[x, y] = mix(inner, outer, t)


def clip_pixel_circle(img: Image.Image) -> None:
    pixels = img.load()
    cx = cy = 15.5
    radius = 14.5
    for y in range(32):
        for x in range(32):
            if math.hypot((x + 0.5) - cx, (y + 0.5) - cy) > radius:
                pixels[x, y] = (0, 0, 0, 0)
            elif pixels[x, y][3] != 0:
                pixels[x, y] = (*pixels[x, y][:3], 255)


def draw_px_body(d: ImageDraw.ImageDraw, role: dict[str, Any]) -> None:
    shirt = rgba(role["shirt"])
    shirt_dark = mix(shirt, rgba("#0d0806"), 0.28)
    skin = rgba(role["skin"])
    d.ellipse((6, 22, 26, 35), fill=INK)
    d.ellipse((8, 23, 24, 35), fill=shirt)
    d.rectangle((9, 28, 23, 32), fill=shirt_dark)
    d.rectangle((14, 19, 17, 25), fill=mix(skin, rgba("#7a3a22"), 0.18))
    d.polygon([(11, 24), (16, 28), (21, 24), (20, 32), (12, 32)], fill=mix(shirt, WHITE, 0.12))


def draw_px_head_base(d: ImageDraw.ImageDraw, role: dict[str, Any]) -> None:
    skin = rgba(role["skin"])
    skin_dark = mix(skin, rgba("#7a3a22"), 0.16)
    d.ellipse((8, 14, 11, 19), fill=INK)
    d.ellipse((21, 14, 24, 19), fill=INK)
    d.rectangle((9, 15, 10, 18), fill=skin_dark)
    d.rectangle((22, 15, 23, 18), fill=skin_dark)
    d.ellipse((8, 7, 24, 25), fill=INK)
    d.ellipse((9, 8, 23, 24), fill=skin)
    d.rectangle((11, 8, 21, 11), fill=mix(skin, WHITE, 0.16))


def draw_px_back_hair(d: ImageDraw.ImageDraw, role: dict[str, Any]) -> None:
    kind = role["kind"]
    hair = rgba("#241810")
    hair2 = rgba("#5a3a2a")
    if kind == "farmer_woman":
        d.ellipse((7, 8, 12, 14), fill=INK)
        d.ellipse((8, 9, 12, 13), fill=hair)
    elif kind == "wealthy_woman":
        d.ellipse((11, 2, 21, 10), fill=INK)
        d.ellipse((12, 3, 20, 9), fill=hair2)
        d.rectangle((10, 8, 22, 14), fill=INK)
        d.rectangle((11, 9, 21, 13), fill=hair2)
    elif kind == "child":
        d.rectangle((15, 4, 16, 8), fill=INK)
        d.ellipse((13, 3, 18, 8), fill=rgba("#17120f"))
    elif kind == "matchmaker":
        d.ellipse((10, 3, 22, 11), fill=INK)
        d.ellipse((11, 4, 21, 10), fill=hair)
        d.ellipse((7, 9, 12, 15), fill=INK)
        d.ellipse((20, 9, 25, 15), fill=INK)
        d.rectangle((8, 10, 11, 14), fill=hair)
        d.rectangle((21, 10, 24, 14), fill=hair)


def draw_px_straw(d: ImageDraw.ImageDraw, color: tuple[int, int, int, int]) -> None:
    for x in (12, 14, 16, 18, 20):
        d.line((16, 3, x, 9), fill=color)
    d.line((7, 8, 25, 8), fill=color)
    d.line((8, 10, 24, 10), fill=color)


def draw_px_identity(d: ImageDraw.ImageDraw, role: dict[str, Any]) -> None:
    kind = role["kind"]
    accent = rgba(role["accent"])
    accent_hi = mix(accent, WHITE, 0.22)
    accent_dark = mix(accent, rgba("#120907"), 0.22)
    hair = rgba("#17120f")
    straw_line = rgba("#6a4d25")

    if kind == "landlord":
        d.ellipse((10, 5, 22, 12), fill=INK)
        d.rectangle((11, 9, 21, 12), fill=accent_dark)
        d.ellipse((11, 5, 21, 11), fill=accent)
        d.rectangle((13, 6, 16, 7), fill=accent_hi)
    elif kind == "farmer":
        d.ellipse((4, 5, 28, 12), fill=INK)
        d.rectangle((6, 8, 26, 11), fill=accent)
        d.polygon([(9, 9), (16, 2), (23, 9), (26, 11), (6, 11)], fill=accent_hi)
        d.line((6, 11, 26, 11), fill=INK)
        draw_px_straw(d, straw_line)
    elif kind == "farmer_woman":
        d.polygon([(8, 12), (11, 6), (16, 4), (22, 7), (25, 13), (16, 12)], fill=INK)
        d.polygon([(9, 11), (12, 7), (16, 5), (21, 8), (23, 12), (16, 11)], fill=accent)
        d.rectangle((22, 10, 26, 13), fill=accent)
        d.polygon([(25, 13), (29, 15), (24, 16)], fill=accent)
    elif kind == "youth":
        d.ellipse((10, 6, 22, 12), fill=hair)
        d.polygon([(10, 10), (12, 8), (14, 10), (16, 8), (19, 10), (22, 8), (23, 11)], fill=hair)
        d.rectangle((9, 9, 23, 11), fill=INK)
        d.rectangle((10, 9, 22, 10), fill=rgba("#f7f0de"))
        d.rectangle((22, 8, 25, 11), fill=rgba("#f7f0de"))
    elif kind == "wealthy_woman":
        gold = rgba("#e8bf3c")
        d.line((10, 8, 22, 5), fill=gold, width=1)
        d.rectangle((22, 4, 24, 6), fill=gold)
        d.rectangle((6, 16, 7, 19), fill=gold)
        d.rectangle((25, 16, 26, 19), fill=gold)
    elif kind == "accountant":
        d.ellipse((10, 5, 22, 12), fill=INK)
        d.rectangle((11, 9, 21, 12), fill=rgba("#111111"))
        d.ellipse((11, 5, 21, 10), fill=rgba("#171717"))
        d.line((12, 10, 20, 10), fill=rgba("#3b3b3b"))
    elif kind == "butcher":
        d.rectangle((9, 9, 23, 11), fill=INK)
        d.rectangle((10, 9, 22, 10), fill=accent)
        d.polygon([(22, 9), (27, 8), (24, 12)], fill=accent)
    elif kind == "peddler":
        d.ellipse((5, 5, 27, 12), fill=INK)
        d.rectangle((7, 8, 25, 11), fill=accent)
        d.polygon([(9, 9), (16, 2), (24, 9), (26, 11), (6, 11)], fill=accent_hi)
        draw_px_straw(d, straw_line)
    elif kind == "fisher":
        d.ellipse((5, 5, 27, 12), fill=INK)
        d.rectangle((7, 8, 25, 11), fill=accent)
        d.polygon([(9, 9), (16, 2), (24, 9), (26, 11), (6, 11)], fill=accent_hi)
        draw_px_straw(d, rgba("#5a7436"))
    elif kind == "scholar":
        blue = rgba("#34406e")
        d.ellipse((9, 5, 23, 12), fill=INK)
        d.ellipse((10, 6, 22, 11), fill=blue)
        d.rectangle((9, 10, 23, 13), fill=INK)
        d.rectangle((10, 10, 22, 12), fill=mix(blue, WHITE, 0.12))
        d.polygon([(22, 11), (27, 13), (23, 16)], fill=blue)
    elif kind == "child":
        d.rectangle((15, 6, 16, 8), fill=rgba("#bb2d34"))
        d.rectangle((10, 9, 12, 11), fill=hair)
        d.rectangle((20, 9, 22, 11), fill=hair)
    elif kind == "matchmaker":
        flower = rgba("#e9374f")
        d.rectangle((22, 6, 24, 8), fill=flower)
        d.rectangle((23, 5, 23, 9), fill=flower)
        d.point((23, 7), fill=rgba("#ffb1bd"))


def draw_px_face(d: ImageDraw.ImageDraw, role: dict[str, Any]) -> None:
    kind = role["kind"]
    dark = rgba("#23160f")
    mouth = rgba("#581713")
    lip = rgba("#b8323b")
    blush = rgba("#ee7f86")

    if kind == "accountant":
        d.rectangle((12, 14, 15, 17), outline=dark)
        d.rectangle((17, 14, 20, 17), outline=dark)
        d.point((15, 15), fill=dark)
        d.point((17, 15), fill=dark)
        d.rectangle((13, 14, 14, 15), fill=dark)
        d.rectangle((18, 14, 19, 15), fill=dark)
        d.line((15, 16, 17, 16), fill=dark)
        d.line((13, 21, 19, 21), fill=mouth)
        return

    if kind == "child":
        d.rectangle((12, 14, 14, 16), fill=dark)
        d.rectangle((18, 14, 20, 16), fill=dark)
        d.point((13, 14), fill=WHITE)
        d.point((19, 14), fill=WHITE)
        d.rectangle((10, 18, 12, 19), fill=blush)
        d.rectangle((20, 18, 22, 19), fill=blush)
        d.rectangle((14, 20, 18, 22), fill=dark)
        d.rectangle((15, 20, 17, 20), fill=WHITE)
        return

    if kind == "matchmaker":
        d.line((11, 14, 14, 15), fill=dark)
        d.line((18, 15, 21, 14), fill=dark)
        d.rectangle((10, 18, 12, 20), fill=rgba("#e23d62"))
        d.rectangle((20, 18, 22, 20), fill=rgba("#e23d62"))
        d.point((20, 16), fill=dark)
        d.rectangle((13, 20, 19, 23), fill=dark)
        d.rectangle((14, 21, 18, 23), fill=lip)
        d.line((14, 20, 18, 20), fill=WHITE)
        return

    d.rectangle((12, 14, 13, 15), fill=dark)
    d.rectangle((19, 14, 20, 15), fill=dark)

    if kind == "butcher":
        d.line((11, 13, 14, 14), fill=dark)
        d.line((18, 14, 21, 13), fill=dark)
    elif kind == "scholar":
        d.line((12, 13, 14, 13), fill=dark)
        d.line((18, 13, 20, 13), fill=dark)
    else:
        d.point((12, 13), fill=dark)
        d.point((20, 13), fill=dark)

    d.point((16, 17), fill=mix(rgba(role["skin"]), rgba("#7a3a22"), 0.25))

    if kind == "landlord":
        d.rectangle((11, 17, 15, 18), fill=dark)
        d.rectangle((17, 17, 21, 18), fill=dark)
        d.rectangle((13, 20, 19, 22), fill=mouth)
        d.rectangle((14, 20, 16, 20), fill=WHITE)
        d.point((17, 20), fill=rgba("#f0c34a"))
    elif kind == "farmer":
        gray = rgba("#d6d0bf")
        d.rectangle((11, 17, 15, 18), fill=gray)
        d.rectangle((17, 17, 21, 18), fill=gray)
        d.rectangle((12, 21, 20, 23), fill=rgba("#9d9688"))
        d.line((14, 20, 18, 20), fill=mouth)
    elif kind == "farmer_woman":
        d.rectangle((10, 18, 12, 19), fill=blush)
        d.rectangle((20, 18, 22, 19), fill=blush)
        d.line((14, 20, 18, 20), fill=lip)
        d.point((15, 21), fill=lip)
        d.point((17, 21), fill=lip)
    elif kind == "youth":
        d.rectangle((13, 20, 19, 22), fill=mouth)
        d.line((14, 20, 18, 20), fill=WHITE)
    elif kind == "wealthy_woman":
        d.rectangle((10, 18, 12, 19), fill=blush)
        d.rectangle((20, 18, 22, 19), fill=blush)
        d.line((14, 20, 18, 21), fill=mouth)
        d.line((13, 23, 19, 23), fill=mix(rgba(role["skin"]), rgba("#7a3a22"), 0.25))
    elif kind == "butcher":
        for point in ((12, 18), (14, 19), (18, 18), (20, 19), (16, 21)):
            d.point(point, fill=rgba("#5a3426"))
        d.rectangle((13, 20, 20, 22), fill=mouth)
        d.line((14, 20, 19, 20), fill=WHITE)
    elif kind == "peddler":
        d.line((14, 20, 18, 21), fill=mouth)
    elif kind == "fisher":
        gray = rgba("#c6c0b5")
        d.rectangle((12, 17, 15, 18), fill=gray)
        d.rectangle((17, 17, 20, 18), fill=gray)
        d.point((13, 21), fill=rgba("#665e55"))
        d.point((19, 21), fill=rgba("#665e55"))
        d.line((14, 20, 18, 20), fill=mouth)
    elif kind == "scholar":
        d.line((14, 20, 18, 20), fill=mouth)


def pixel_avatar(role: dict[str, Any]) -> Image.Image:
    img = layer((32, 32))
    d = ImageDraw.Draw(img)

    fill_pixel_background(img, role)
    draw_px_body(d, role)
    draw_px_back_hair(d, role)
    draw_px_head_base(d, role)
    draw_px_identity(d, role)
    draw_px_face(d, role)
    clip_pixel_circle(img)

    return img.resize((SIZE, SIZE), Image.Resampling.NEAREST)


def expected_outputs() -> list[Path]:
    paths: list[Path] = []
    for role in ROLES:
        paths.append(CARTOON_DIR / f"{role['id']}.png")
        paths.append(PIXEL_DIR / f"{role['id']}.png")
    return paths


def validate_outputs(paths: list[Path]) -> None:
    missing = [path for path in paths if not path.exists()]
    if missing:
        raise RuntimeError(f"missing generated files: {missing}")

    for path in paths:
        with Image.open(path) as image:
            if image.size != (SIZE, SIZE) or image.mode != "RGBA":
                raise RuntimeError(f"invalid image: {path} {image.mode} {image.size}")
            print(f"verified {path.relative_to(ROOT)} {image.size[0]}x{image.size[1]} {image.mode}")

            if PIXEL_DIR in path.parents:
                alpha_values = set(image.getchannel("A").getdata())
                if not alpha_values.issubset({0, 255}):
                    raise RuntimeError(f"pixel avatar has antialias alpha values: {path}")

    print(f"verified {len(paths)} avatar PNG files; pixel alpha is hard-edged")


def main() -> None:
    outputs: list[Path] = []
    for role in ROLES:
        cartoon_path = CARTOON_DIR / f"{role['id']}.png"
        pixel_path = PIXEL_DIR / f"{role['id']}.png"
        save(cartoon_path, cartoon_avatar(role))
        save(pixel_path, pixel_avatar(role))
        outputs.extend([cartoon_path, pixel_path])

    validate_outputs(outputs)


if __name__ == "__main__":
    main()

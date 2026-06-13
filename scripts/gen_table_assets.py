from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
CARTOON_DIR = ROOT / "apps/web/public/assets/images/themes/cartoon"
PIXEL_DIR = ROOT / "apps/web/public/assets/images/themes/pixel"


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
    gradient = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pixels = gradient.load()
    cx = w * highlight_center[0]
    cy = h * highlight_center[1]
    max_dist = ((max(cx, w - cx) ** 2) + (max(cy, h - cy) ** 2)) ** 0.5

    for y in range(h):
        for x in range(w):
            dx = x - cx
            dy = y - cy
            distance = ((dx * dx + dy * dy) ** 0.5) / max_dist
            pixels[x, y] = mix(inner, outer, distance)

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, w - 1, h - 1), fill=255)
    base.paste(gradient, (x0, y0), mask)


def cartoon_clock() -> Image.Image:
    scale = 4
    size = 128 * scale
    img = layer((size, size))
    d = ImageDraw.Draw(img)

    def sbox(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        return tuple(v * scale for v in box)  # type: ignore[return-value]

    def sc(value: int) -> int:
        return value * scale

    def radial_ellipse(
        box: tuple[int, int, int, int],
        inner: tuple[int, int, int, int],
        outer: tuple[int, int, int, int],
    ) -> None:
        x0, y0, x1, y1 = sbox(box)
        w = x1 - x0
        h = y1 - y0
        gradient = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        pixels = gradient.load()
        rx = max(1.0, (w - 1) / 2)
        ry = max(1.0, (h - 1) / 2)
        cx = rx
        cy = ry

        for y in range(h):
            for x in range(w):
                nx = (x - cx) / rx
                ny = (y - cy) / ry
                distance = min(1.0, (nx * nx + ny * ny) ** 0.5)
                pixels[x, y] = mix(inner, outer, distance)

        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, w - 1, h - 1), fill=255)
        img.paste(gradient, (x0, y0), mask)

    def soft_highlight(box: tuple[int, int, int, int], alpha: int, blur: int) -> None:
        shine = layer((size, size))
        ImageDraw.Draw(shine).ellipse(sbox(box), fill=(255, 255, 255, alpha))
        img.alpha_composite(shine.filter(ImageFilter.GaussianBlur(sc(blur))))

    outline = rgba("#6b3f17")
    outline_soft = rgba("#6b3f17", 115)
    gold_center = rgba("#ffe08a")
    gold_edge = rgba("#f5a623")
    gold_hi = rgba("#fff4c7")
    cream = rgba("#fff6e0")
    cream_hi = rgba("#fffaf0")

    shadow = layer((size, size))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse(sbox((24, 104, 104, 123)), fill=(76, 45, 16, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(sc(5)))
    img.alpha_composite(shadow)

    # Feet sit behind the body so the blank dial stays visually clean.
    for foot in ((34, 99, 52, 118), (76, 99, 94, 118)):
        d.rounded_rectangle(sbox(foot), radius=sc(6), fill=outline_soft)
    for foot in ((36, 97, 53, 115), (75, 97, 92, 115)):
        d.rounded_rectangle(sbox(foot), radius=sc(6), fill=outline)
        inner = (foot[0] + 3, foot[1] + 2, foot[2] - 3, foot[3] - 4)
        d.rounded_rectangle(sbox(inner), radius=sc(4), fill=gold_edge)
        d.ellipse(
            sbox((inner[0] + 1, inner[1], inner[2] - 1, inner[1] + 7)),
            fill=rgba("#fff0b8", 135),
        )

    # Alarm bells and top handle.
    d.arc(sbox((46, 5, 82, 34)), start=198, end=342, fill=outline, width=sc(3))
    d.arc(sbox((49, 8, 79, 32)), start=198, end=342, fill=gold_hi, width=sc(1))
    d.rounded_rectangle(sbox((58, 18, 70, 36)), radius=sc(4), fill=outline)
    d.rounded_rectangle(sbox((61, 15, 67, 31)), radius=sc(3), fill=gold_edge)
    d.ellipse(sbox((59, 8, 69, 18)), fill=outline)
    d.ellipse(sbox((61, 9, 67, 15)), fill=gold_hi)

    for bell in ((32, 12, 64, 43), (64, 12, 96, 43)):
        d.ellipse(sbox(bell), fill=outline)
        inner = (bell[0] + 3, bell[1] + 3, bell[2] - 3, bell[3] - 3)
        radial_ellipse(inner, gold_center, gold_edge)
        d.arc(sbox((bell[0] + 6, bell[1] + 18, bell[2] - 6, bell[3] + 3)), 8, 172, fill=outline, width=sc(1))
    soft_highlight((38, 17, 53, 27), 112, 2)
    soft_highlight((70, 17, 85, 27), 112, 2)

    # Main metal body.
    d.ellipse(sbox((18, 29, 110, 121)), fill=outline)
    radial_ellipse((21, 32, 107, 118), gold_center, gold_edge)

    shine = layer((size, size))
    sh = ImageDraw.Draw(shine)
    sh.ellipse(sbox((31, 39, 73, 61)), fill=(255, 255, 255, 108))
    sh.ellipse(sbox((39, 42, 64, 54)), fill=(255, 255, 255, 126))
    body_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(body_mask).ellipse(sbox((21, 32, 107, 118)), fill=255)
    shine = shine.filter(ImageFilter.GaussianBlur(sc(2)))
    img.paste(shine, (0, 0), body_mask)

    # Blank cream dial for runtime digits.
    d.ellipse(sbox((32, 43, 96, 107)), fill=outline)
    d.ellipse(sbox((35, 46, 93, 104)), fill=gold_edge)
    radial_ellipse((39, 50, 89, 100), cream_hi, cream)
    d.ellipse(sbox((39, 50, 89, 100)), outline=gold_center, width=sc(1))

    # Outer rim detail after dial so the silhouette remains crisp.
    d.arc(sbox((24, 35, 104, 115)), start=205, end=335, fill=rgba("#d87f12", 170), width=sc(2))
    d.ellipse(sbox((18, 29, 110, 121)), outline=outline, width=sc(3))

    return img.resize((128, 128), Image.Resampling.LANCZOS)


def pixel_clock() -> Image.Image:
    img = layer((32, 32))
    d = ImageDraw.Draw(img)

    dark = rgba("#5b3a1e")
    dark2 = rgba("#3a2617")
    gold = rgba("#f2a51d")
    gold_light = rgba("#ffe58a")
    gold_deep = rgba("#bf6b10")
    cream = rgba("#fff6e0")
    cream_shadow = rgba("#efd391")

    d.rectangle((14, 3, 17, 8), fill=dark)
    d.rectangle((15, 2, 16, 5), fill=gold_light)
    d.rectangle((8, 4, 13, 9), fill=dark)
    d.rectangle((19, 4, 24, 9), fill=dark)
    d.rectangle((9, 5, 13, 8), fill=gold_light)
    d.rectangle((19, 5, 23, 8), fill=gold_light)
    d.rectangle((10, 8, 13, 9), fill=gold_deep)
    d.rectangle((19, 8, 22, 9), fill=gold_deep)
    d.rectangle((7, 26, 11, 29), fill=dark2)
    d.rectangle((20, 26, 24, 29), fill=dark2)
    d.rectangle((8, 25, 11, 27), fill=gold_deep)
    d.rectangle((20, 25, 23, 27), fill=gold_deep)

    d.rounded_rectangle((4, 8, 28, 30), radius=4, fill=dark)
    d.rounded_rectangle((5, 9, 27, 29), radius=3, fill=gold_deep)
    d.rounded_rectangle((6, 9, 26, 26), radius=3, fill=gold)
    d.rectangle((8, 10, 24, 12), fill=gold_light)
    d.rectangle((7, 23, 25, 26), fill=gold_deep)

    d.rounded_rectangle((9, 12, 23, 26), radius=3, fill=dark)
    d.rounded_rectangle((10, 13, 22, 25), radius=2, fill=cream_shadow)
    d.rectangle((11, 13, 21, 16), fill=cream)
    d.rectangle((12, 17, 20, 22), fill=cream)

    return img.resize((128, 128), Image.Resampling.NEAREST)


def pixel_button(
    main: str,
    highlight: str,
    thick: str,
    outline: str = "#422610",
) -> Image.Image:
    img = layer((52, 23))
    d = ImageDraw.Draw(img)
    main_c = rgba(main)
    hi_c = rgba(highlight)
    thick_c = rgba(thick)
    outline_c = rgba(outline)
    shade_c = mix(main_c, thick_c, 0.35)
    inner_hi = mix(main_c, hi_c, 0.42)

    d.rounded_rectangle((0, 2, 51, 22), radius=3, fill=outline_c)
    d.rounded_rectangle((1, 3, 50, 21), radius=2, fill=thick_c)
    d.rounded_rectangle((2, 2, 49, 17), radius=2, fill=main_c)

    # Crisp pixel bands: bright top edge, calm center for text, heavy lower lip.
    d.line((5, 3, 46, 3), fill=hi_c, width=1)
    d.line((4, 4, 47, 4), fill=inner_hi, width=1)
    d.rectangle((3, 5, 48, 14), fill=main_c)
    d.rectangle((3, 15, 48, 17), fill=shade_c)
    d.line((4, 18, 47, 18), fill=thick_c, width=1)
    d.line((5, 20, 46, 20), fill=mix(thick_c, outline_c, 0.35), width=1)

    # Restore visible outline pixels at the corners after banding.
    d.line((3, 2, 48, 2), fill=outline_c, width=1)
    d.line((1, 5, 1, 18), fill=outline_c, width=1)
    d.line((50, 5, 50, 18), fill=outline_c, width=1)
    d.line((4, 22, 47, 22), fill=outline_c, width=1)

    return img.resize((208, 92), Image.Resampling.NEAREST)


def save(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    print(f"{path.relative_to(ROOT)} {image.size[0]}x{image.size[1]}")


def main() -> None:
    outputs = [
        (CARTOON_DIR / "clock_alarm.png", cartoon_clock()),
        (PIXEL_DIR / "clock_alarm.png", pixel_clock()),
        (
            PIXEL_DIR / "btn_pill_blue.png",
            pixel_button("#3aa3e6", "#9ad8ff", "#1c66a8", "#184470"),
        ),
        (
            PIXEL_DIR / "btn_pill_green.png",
            pixel_button("#82c23a", "#c4ec84", "#4a7d18", "#2f5412"),
        ),
        (
            PIXEL_DIR / "btn_pill_orange.png",
            pixel_button("#ff9d2e", "#ffd87a", "#bf5a10", "#6b340b"),
        ),
    ]
    for path, image in outputs:
        save(path, image)


if __name__ == "__main__":
    main()

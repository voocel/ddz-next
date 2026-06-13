from __future__ import annotations

from pathlib import Path

from PIL import Image

from gen_table_assets import pixel_button


ROOT = Path(__file__).resolve().parents[1]
CARTOON_DIR = ROOT / "apps/web/public/assets/images/themes/cartoon"
PIXEL_DIR = ROOT / "apps/web/public/assets/images/themes/pixel"

PIXEL_OUT = PIXEL_DIR / "btn_pill_wood.png"
CARTOON_TEMPLATE = CARTOON_DIR / "btn_pill_green.png"
CARTOON_OUT = CARTOON_DIR / "btn_pill_wood.png"


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    hex_color = hex_color.lstrip("#")
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
        alpha,
    )


def mix_rgb(
    c1: tuple[int, int, int],
    c2: tuple[int, int, int],
    t: float,
) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))  # type: ignore[return-value]


def wood_tone(luma: int) -> tuple[int, int, int]:
    dark = rgba("#5e3d14")[:3]
    mid = rgba("#a9712e")[:3]
    high = rgba("#ecc88f")[:3]
    t = luma / 255

    if t <= 0.5:
        return mix_rgb(dark, mid, t / 0.5)
    return mix_rgb(mid, high, (t - 0.5) / 0.5)


def cartoon_wood_button() -> Image.Image:
    template = Image.open(CARTOON_TEMPLATE).convert("RGBA")
    luma = template.convert("L")
    alpha = template.getchannel("A")
    img = Image.new("RGBA", template.size, (0, 0, 0, 0))

    out = img.load()
    luma_pixels = luma.load()
    alpha_pixels = alpha.load()
    width, height = template.size
    for y in range(height):
        for x in range(width):
            r, g, b = wood_tone(luma_pixels[x, y])
            out[x, y] = (r, g, b, alpha_pixels[x, y])

    return img


def save(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def alpha_values(path: Path) -> set[int]:
    return set(Image.open(path).convert("RGBA").getchannel("A").getdata())


def main() -> None:
    save(
        PIXEL_OUT,
        pixel_button("#b9772f", "#e7bd7e", "#6e4a1c", "#3a2410"),
    )
    save(CARTOON_OUT, cartoon_wood_button())

    checks = [
        (PIXEL_OUT, (208, 92)),
        (CARTOON_OUT, (400, 240)),
    ]
    for path, expected_size in checks:
        image = Image.open(path)
        exists = path.exists()
        size_ok = image.size == expected_size
        print(
            f"{path.relative_to(ROOT)} exists={exists} "
            f"size={image.size[0]}x{image.size[1]} expected={expected_size[0]}x{expected_size[1]} "
            f"size_ok={size_ok}"
        )

    pixel_alpha = alpha_values(PIXEL_OUT)
    print(
        f"{PIXEL_OUT.relative_to(ROOT)} alpha_values={sorted(pixel_alpha)} "
        f"alpha_ok={pixel_alpha == {0, 255}}"
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""把 AI 生成的透明立绘（raw_mascot）裁掉透明边、缩放，替换大厅/登录页吉祥物 mascot_left/right。

复现：先用 .tmp_avatar_gen/prompt_mascot_test.txt + prompt_mascot_batch.txt 驱动 codex 生成 4 张透明立绘
（dragon/tiger/dragon_pixel/tiger_pixel）到 .tmp_avatar_gen/raw_mascot/，再跑本脚本。
卡通直接裁边缩放；像素额外做调色板量化 + 硬边 alpha，保持像素质感。
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / ".tmp_avatar_gen" / "raw_mascot"
THEMES = ROOT / "apps/web/public/assets/images/themes"

CARTOON_W = 540   # 卡通立绘输出宽（显示约 270px 的 2x）
PIXEL_W = 240     # 像素立绘输出宽（像素网格分辨率）
PIXEL_COLORS = 48

# (源文件, 目标路径, 是否像素)
JOBS = [
    ("dragon.png", THEMES / "cartoon/mascot_left.png", False),
    ("tiger.png", THEMES / "cartoon/mascot_right.png", False),
    ("dragon_pixel.png", THEMES / "pixel/mascot_left.png", True),
    ("tiger_pixel.png", THEMES / "pixel/mascot_right.png", True),
]


def trim(im: Image.Image) -> Image.Image:
    bbox = im.getchannel("A").getbbox()
    return im.crop(bbox) if bbox else im


def scale(im: Image.Image, width: int) -> Image.Image:
    height = round(im.height * width / im.width)
    return im.resize((width, height), Image.LANCZOS)


def process(src: str, dst: Path, pixel: bool) -> None:
    im = trim(Image.open(RAW / src).convert("RGBA"))
    im = scale(im, PIXEL_W if pixel else CARTOON_W)
    if pixel:
        alpha = im.getchannel("A").point(lambda a: 255 if a > 128 else 0)  # 硬边 alpha
        rgb = im.convert("RGB").quantize(colors=PIXEL_COLORS, dither=Image.Dither.NONE).convert("RGBA")
        rgb.putalpha(alpha)
        im = rgb
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst)
    print(f"mascot: {src} -> {dst.relative_to(THEMES)}  {im.size} {im.mode}")


def main() -> None:
    missing = [s for s, _, _ in JOBS if not (RAW / s).exists()]
    if missing:
        raise SystemExit(f"缺少立绘原图: {missing}（请先用 codex 生成到 {RAW}）")
    for src, dst, pixel in JOBS:
        process(src, dst, pixel)
    print("✅ 4 张吉祥物立绘处理完成")


if __name__ == "__main__":
    main()

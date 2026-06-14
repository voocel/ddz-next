#!/usr/bin/env python3
"""把 AI(gpt-image-2)生成的像素风原图量化成硬边像素 + 圆裁，覆盖 pixel 主题头像。

复现流程（一次性离线）：
  1. 用 scripts/gen_pixel_avatars_prompt.txt 驱动 codex 生图到 .tmp_avatar_gen/raw_pixel/<1..12>.png：
       codex exec -C . -s workspace-write - < scripts/gen_pixel_avatars_prompt.txt
  2. 跑本脚本（GRID/COLORS 调像素颗粒度与调色板）：
       python3 scripts/process_pixel_avatars.py
"""
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / ".tmp_avatar_gen" / "raw_pixel"
OUT = ROOT / "apps/web/public/assets/images/themes/pixel/avatar"
SIZE = 128      # 输出尺寸（=量化网格，保留 codex 像素原图的精细度）
COLORS = 48     # 调色板色数（量化恢复硬边色块，贴近 codex 有限色板）
COUNT = 12


def process(idx: int) -> None:
    im = Image.open(RAW / f"{idx}.png").convert("RGB")
    w, h = im.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    im = im.crop((left, top, left + s, top + s))
    # 缩到输出网格 + 调色板量化（色块化硬边，保留 codex 精细像素结构）
    img = im.resize((SIZE, SIZE), Image.LANCZOS)
    img = img.quantize(colors=COLORS, dither=Image.Dither.NONE).convert("RGBA")
    # 网格上硬边圆裁（圆外透明，圆内实心）
    px = img.load()
    c = (SIZE - 1) / 2.0
    r = SIZE / 2.0 - 0.5
    for y in range(SIZE):
        for x in range(SIZE):
            if math.hypot(x - c, y - c) > r:
                px[x, y] = (0, 0, 0, 0)
    img.save(OUT / f"{idx}.png")
    print(f"pixel {idx}: -> pixel/avatar/{idx}.png  {img.size} {img.mode}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    missing = [i for i in range(1, COUNT + 1) if not (RAW / f"{i}.png").exists()]
    if missing:
        raise SystemExit(f"缺少原图: {missing}（请先用 codex 生成到 {RAW}）")
    for i in range(1, COUNT + 1):
        process(i)
    for i in range(1, COUNT + 1):
        im = Image.open(OUT / f"{i}.png")
        assert im.size == (SIZE, SIZE) and im.mode == "RGBA", f"{i}.png 规格错误"
        alpha = set(im.getchannel("A").getdata())
        assert alpha.issubset({0, 255}), f"{i}.png 像素 alpha 非硬边"
    print(f"✅ {COUNT} 张像素头像处理完成并校验通过 -> {OUT}")


if __name__ == "__main__":
    main()

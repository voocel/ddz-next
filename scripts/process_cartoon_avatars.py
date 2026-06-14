#!/usr/bin/env python3
"""把 AI(gpt-image-2)生成的方形角色原图裁成 128x128 圆形透明头像，覆盖 cartoon 主题头像。

复现流程（一次性离线，不进运行时；像素主题头像由 gen_avatars.py 程序化生成）：
  1. 用 scripts/gen_cartoon_avatars_prompt.txt 作为 prompt 驱动 codex 生图，产出到 .tmp_avatar_gen/raw/<1..12>.png：
       codex exec -C . -s workspace-write - < scripts/gen_cartoon_avatars_prompt.txt
  2. 跑本脚本做裁圆后处理：
       python3 scripts/process_cartoon_avatars.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / ".tmp_avatar_gen" / "raw_cartoon"
OUT = ROOT / "apps/web/public/assets/images/themes/cartoon/avatar"
SIZE = 128
SS = 4  # 超采样让圆形边缘平滑抗锯齿
COUNT = 12


def process(idx: int) -> None:
    src = RAW / f"{idx}.png"
    im = Image.open(src).convert("RGBA")
    # 居中裁成正方形，避免非方原图被拉伸
    w, h = im.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    im = im.crop((left, top, left + s, top + s))
    # 超采样缩放 + 圆形 alpha 遮罩（圆外透明），与像素头像/UI 的圆形造型一致
    big = SIZE * SS
    im = im.resize((big, big), Image.LANCZOS)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    im.putalpha(mask)
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    im.save(OUT / f"{idx}.png")
    print(f"avatar {idx}: {src.name} -> cartoon/avatar/{idx}.png  {im.size} {im.mode}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    missing = [i for i in range(1, COUNT + 1) if not (RAW / f"{i}.png").exists()]
    if missing:
        raise SystemExit(f"缺少原图: {missing}（请先用 codex image_gen 生成到 {RAW}）")
    for i in range(1, COUNT + 1):
        process(i)
    for i in range(1, COUNT + 1):
        im = Image.open(OUT / f"{i}.png")
        assert im.size == (SIZE, SIZE) and im.mode == "RGBA", f"{i}.png 规格错误"
        assert im.getpixel((1, 1))[3] == 0, f"{i}.png 四角应透明"
    print(f"✅ {COUNT} 张卡通头像处理完成并校验通过 -> {OUT}")


if __name__ == "__main__":
    main()

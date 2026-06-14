import Phaser from "phaser";
import type { CardId } from "@ddz/domain";
import type { AudioLevels } from "../audio";
import type { ThemeId } from "../theme";
import { TableScene } from "./TableScene";
import { getTableDevicePixelRatio, TABLE_STAGE_HEIGHT, TABLE_STAGE_WIDTH } from "./tableConfig";

interface TableGameOptions {
  readonly localPlayerId: string;
  readonly theme: ThemeId;
  readonly audio: AudioLevels;
  readonly onPass: () => void;
  readonly onPlay: (cards: readonly CardId[]) => void;
}

export function createTableGame(parent: HTMLElement, options: TableGameOptions) {
  const scene = new TableScene(options);
  const bounds = parent.getBoundingClientRect();
  const dpr = getTableDevicePixelRatio();
  const width = Math.max(TABLE_STAGE_WIDTH, Math.round(bounds.width * dpr));
  const height = Math.max(TABLE_STAGE_HEIGHT, Math.round(bounds.height * dpr));
  const pixelTheme = options.theme === "pixel";
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    parent,
    backgroundColor: pixelTheme ? "#3f7d2c" : "#4e9e2f",
    // 牌面/文字统一抗锯齿渲染，避免相机非整数缩放下最近邻采样发虚；
    // 像素主题的辨识度由素材本身（背景/牌背/按钮）承载，高分辨率素材线性缩小反而更干净
    pixelArt: false,
    antialias: true,
    antialiasGL: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      autoRound: true
    },
    scene
  });

  const setCanvasDisplaySize = (displayWidth: number, displayHeight: number): void => {
    const nextWidth = Math.max(TABLE_STAGE_WIDTH, Math.round(displayWidth * dpr));
    const nextHeight = Math.max(TABLE_STAGE_HEIGHT, Math.round(displayHeight * dpr));
    game.scale.resize(nextWidth, nextHeight);
    game.canvas.style.width = `${displayWidth}px`;
    game.canvas.style.height = `${displayHeight}px`;
  };
  const resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) {
      return;
    }
    setCanvasDisplaySize(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(parent);
  setCanvasDisplaySize(bounds.width, bounds.height);

  return {
    game,
    bridge: scene,
    destroy() {
      resizeObserver.disconnect();
      game.destroy(true);
    }
  };
}

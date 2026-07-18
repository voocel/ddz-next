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
      // 画布显示尺寸由样式表钉死为铺满容器(.game-host canvas),这里只管内部分辨率;
      // 禁用 autoCenter:它按新旧尺寸差算负 margin 居中画布,与容器随布局(AI 侧栏出现)变宽窄互相打架,会把画布推偏留黑边
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
      autoRound: true
    },
    scene
  });

  let lastDisplaySize = { width: bounds.width, height: bounds.height };
  const setCanvasResolution = (displayWidth: number, displayHeight: number): void => {
    lastDisplaySize = { width: displayWidth, height: displayHeight };
    const nextWidth = Math.max(TABLE_STAGE_WIDTH, Math.round(displayWidth * dpr));
    const nextHeight = Math.max(TABLE_STAGE_HEIGHT, Math.round(displayHeight * dpr));
    game.scale.resize(nextWidth, nextHeight);
  };
  const resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) {
      return;
    }
    setCanvasResolution(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(parent);
  setCanvasResolution(bounds.width, bounds.height);
  // 布局仍在变动(如 AI 侧栏出现)时,启动早期的 resize 可能被 Phaser 引导流程覆盖——就绪后按最终容器尺寸重放一次
  game.events.once(Phaser.Core.Events.READY, () => {
    setCanvasResolution(lastDisplaySize.width, lastDisplaySize.height);
  });

  return {
    game,
    bridge: scene,
    destroy() {
      resizeObserver.disconnect();
      game.destroy(true);
    }
  };
}

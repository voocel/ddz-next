import type Phaser from "phaser";
import type { CardDto } from "@ddz/protocol";
import { getTableDevicePixelRatio } from "./tableConfig";

type CardSuit = "♥" | "♦" | "♠" | "♣";

export interface CardFaceOptions {
  readonly fontSize?: string;
  readonly height: number;
  readonly selected?: boolean;
  readonly width: number;
}

/** 牌面文字标签：王显示中文，普通牌为「点数 + 花色符号」（与 isRed 配套，仅渲染层使用） */
export function formatCard(card: CardDto): string {
  if (card.id === "SJ") {
    return "小王";
  }
  if (card.id === "BJ") {
    return "大王";
  }
  const suit = card.suit === "hearts" ? "♥" : card.suit === "diamonds" ? "♦" : card.suit === "spades" ? "♠" : "♣";
  return `${card.rank}${suit}`;
}

export function isRed(card: CardDto): boolean {
  return card.suit === "hearts" || card.suit === "diamonds" || card.id === "BJ";
}

/**
 * 渲染单张牌面为一个 Phaser 容器（奶油底板 + 角标 + 中央花色/王像）。
 * 牌面统一一套素材、不随主题变化（仅牌背受主题影响），故只依赖场景的 add 工厂与相机缩放，
 * 与具体牌桌状态无关，便于手牌/上一手/底牌/回放四处复用。
 */
export function createCardFace(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  red: boolean,
  options: CardFaceOptions
): Phaser.GameObjects.Container {
  const width = options.width;
  const height = options.height;
  const color = red ? "#c41f1f" : "#171717";
  const suit = readCardSuit(label);
  const rank = suit ? label.slice(0, -1) : label;
  // 牌面统一圆角奶油底板，不随主题变化（仅牌背受主题影响）
  const radius = Math.max(5, Math.round(width * 0.08));
  const innerRadius = Math.max(3, radius - 2);
  const container = scene.add.container(x, y);
  const graphics = scene.add.graphics();

  graphics.fillStyle(0x000000, 0.26);
  graphics.fillRoundedRect(-width / 2 + 3, -height / 2 + 4, width, height, radius);
  // 暖象牙底色 + 轻微内panel，避免纯白卡面过亮
  graphics.fillStyle(0xf6edd9, 1);
  graphics.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
  graphics.fillStyle(0xefe4cd, 1);
  graphics.fillRoundedRect(-width / 2 + 4, -height / 2 + 4, width - 8, height - 8, innerRadius);
  graphics.lineStyle(
    options.selected ? 3 : 1,
    options.selected ? 0xf4c542 : 0xb68f5a,
    options.selected ? 1 : 0.72
  );
  graphics.strokeRoundedRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, radius);
  // 内高光收弱，仅留一丝纸面光泽，不要发亮发糊
  graphics.lineStyle(1, 0xffffff, 0.22);
  graphics.strokeRoundedRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, innerRadius);

  container.add(graphics);

  if (suit) {
    addStandardCardFace(scene, container, rank, suit, color, width, height, options.fontSize);
  } else {
    addJokerCardFace(scene, container, label, red, width, height, options.fontSize);
  }

  if (options.selected) {
    const selectedMark = scene.add
      .text(0, -height / 2 - 10, "已选", {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "11px",
        fontStyle: "800",
        color: "#1a1206",
        backgroundColor: "#f4c542",
        resolution: cardTextResolution(scene),
        padding: {
          x: 6,
          y: 2
        }
      })
      .setOrigin(0.5);
    container.add(selectedMark);
  }

  container.setSize(width, height);
  return container;
}

/**
 * 牌面文字的纹理超采样倍率。相机为 fit 缩放（非整数倍），文字纹理须按当前
 * 相机缩放倍率渲染才能 1:1 显示；只取 dpr 会在 zoom>dpr 时上采样发虚。
 */
function cardTextResolution(scene: Phaser.Scene): number {
  return Math.max(getTableDevicePixelRatio(), Math.ceil(scene.cameras.main.zoom));
}

function addStandardCardFace(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  rank: string,
  suit: CardSuit,
  color: string,
  width: number,
  height: number,
  fontSize?: string
): void {
  const rankSize = fontSize ?? `${Math.max(16, Math.round(width * 0.28))}px`;
  const res = cardTextResolution(scene);
  const cornerX = -width / 2 + Math.max(6, width * 0.1);
  const cornerY = -height / 2 + Math.max(5, height * 0.08);
  const rightX = width / 2 - Math.max(6, width * 0.1);
  const rightY = height / 2 - Math.max(5, height * 0.08);
  const suitKey = suitImageKey(suit);
  const centerSuit = scene.add
    .image(0, height * 0.08, suitKey)
    .setDisplaySize(width * 0.46, width * 0.46)
    .setAlpha(0.94);
  const cornerSuitWidth = Math.max(11, width * 0.17);
  const topRank = scene.add.text(cornerX, cornerY, rank, cardTextStyle(rankSize, color, res)).setOrigin(0, 0);
  const topSuit = scene.add
    .image(cornerX + width * 0.02, cornerY + height * 0.22, suitKey)
    .setDisplaySize(cornerSuitWidth, cornerSuitWidth)
    .setOrigin(0, 0);
  const bottomRank = scene.add.text(rightX, rightY, rank, cardTextStyle(rankSize, color, res)).setOrigin(1, 1);
  const bottomSuit = scene.add
    .image(rightX - width * 0.02, rightY - height * 0.22, suitKey)
    .setDisplaySize(cornerSuitWidth, cornerSuitWidth)
    .setOrigin(1, 1);

  container.add([centerSuit, topRank, topSuit, bottomRank, bottomSuit]);
}

function addJokerCardFace(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  label: string,
  red: boolean,
  width: number,
  height: number,
  fontSize?: string
): void {
  const color = red ? "#c41f1f" : "#171717";
  const cornerSize = fontSize ?? `${Math.max(13, Math.round(width * 0.2))}px`;
  const res = cardTextResolution(scene);
  const cornerX = -width / 2 + Math.max(6, width * 0.1);
  const cornerY = -height / 2 + Math.max(6, height * 0.08);
  const rightX = width / 2 - Math.max(6, width * 0.1);
  const rightY = height / 2 - Math.max(6, height * 0.08);
  const jokerKey = red ? "joker-big" : "joker-small";
  const portrait = scene.add.image(0, height * 0.05, jokerKey);
  portrait.setScale(Math.min((height * 0.62) / portrait.height, (width * 0.66) / portrait.width));
  const topText = scene.add.text(cornerX, cornerY, label, cardTextStyle(cornerSize, color, res)).setOrigin(0, 0);
  const bottomText = scene.add.text(rightX, rightY, label, cardTextStyle(cornerSize, color, res)).setOrigin(1, 1);

  container.add([portrait, topText, bottomText]);
}

function readCardSuit(label: string): CardSuit | null {
  const suit = label.at(-1);
  return suit === "♥" || suit === "♦" || suit === "♠" || suit === "♣" ? suit : null;
}

function suitImageKey(suit: CardSuit): string {
  switch (suit) {
    case "♥":
      return "suit-hearts";
    case "♦":
      return "suit-diamonds";
    case "♠":
      return "suit-spades";
    case "♣":
      return "suit-clubs";
  }
}

function cardTextStyle(fontSize: string, color: string, resolution: number): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize,
    fontStyle: "900",
    color,
    resolution
  };
}

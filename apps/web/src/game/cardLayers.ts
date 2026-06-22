import Phaser from "phaser";
import type { CardId } from "@ddz/domain";
import type { CardDto, GameSnapshotDto } from "@ddz/protocol";
import { createCardFace, formatCard, isRed } from "./cardFace";
import type { RenderedHandCard } from "./handSelection";
import { formatCardId, isRedCardId } from "./tablePresentation";
import {
  HAND_RESTING_Y,
  HAND_SELECTED_Y,
  LAST_PLAY_Y,
  TABLE_INK,
  TABLE_TEXT_STYLE,
  type StagePoint
} from "./tableStage";

export class HandLayer {
  private readonly layer: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = scene.add.container(0, 0);
  }

  render(hand: readonly CardDto[], isSelected: (id: CardId) => boolean): RenderedHandCard[] {
    this.layer.removeAll(true);
    const rendered: RenderedHandCard[] = [];
    const cardWidth = 74;
    const cardHeight = 106;
    const gap = 30;
    const totalWidth = cardWidth + Math.max(0, hand.length - 1) * gap;
    const startX = 640 - totalWidth / 2;

    hand.forEach((card, index) => {
      const cardId = card.id as CardId;
      const selected = isSelected(cardId);
      const x = startX + index * gap;
      const y = selected ? HAND_SELECTED_Y : HAND_RESTING_Y;
      const isLast = index === hand.length - 1;
      const hitWidth = isLast ? cardWidth : gap;
      const cardFace = createCardFace(this.scene, x, y, formatCard(card), isRed(card), {
        selected,
        width: cardWidth,
        height: cardHeight
      });

      rendered.push({
        id: cardId,
        bounds: new Phaser.Geom.Rectangle(x - cardWidth / 2, y - cardHeight / 2, hitWidth, cardHeight)
      });
      this.layer.add(cardFace);
    });

    return rendered;
  }
}

export class TableCardLayers {
  private readonly landlordCardsLayer: Phaser.GameObjects.Container;
  private readonly lastPlayLayer: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    this.landlordCardsLayer = scene.add.container(0, 0);
    this.lastPlayLayer = scene.add.container(0, 0);
  }

  clearLandlordCards(): void {
    this.renderLandlordCards(null);
  }

  clearLastPlay(): void {
    this.lastPlayLayer.removeAll(true);
  }

  renderLandlordCards(snapshot: GameSnapshotDto | null): void {
    this.landlordCardsLayer.removeAll(true);
    const cards = snapshot?.landlordCards ?? [];
    const revealed = cards.length > 0;
    const label = this.scene.add.text(640, 74, revealed ? "地主底牌" : "底牌待定", {
      ...TABLE_TEXT_STYLE,
      fontSize: "14px",
      fontStyle: "900",
      color: "#ffffff",
      stroke: TABLE_INK,
      strokeThickness: 4
    }).setOrigin(0.5);
    this.landlordCardsLayer.add(label);

    const startX = 640 - 58;
    for (let index = 0; index < 3; index += 1) {
      const card = cards[index];
      const x = startX + index * 58;
      if (card) {
        const cardFace = createCardFace(this.scene, x, 126, formatCard(card), isRed(card), {
          fontSize: "14px",
          width: 48,
          height: 68
        });
        this.landlordCardsLayer.add(cardFace);
      } else {
        const cardBack = this.scene.add.image(x, 126, "card-back").setDisplaySize(48, 68).setAlpha(revealed ? 1 : 0.72);
        this.landlordCardsLayer.add(cardBack);
      }
    }
  }

  renderLastPlay(cards: readonly CardDto[], source: StagePoint | null, animated = true): void {
    this.lastPlayLayer.removeAll(true);
    const startX = 640 - Math.max(0, cards.length - 1) * 24;
    cards.forEach((card, index) => {
      const x = startX + index * 48;
      const y = LAST_PLAY_Y;
      const cardFace = createCardFace(this.scene, x, y, formatCard(card), isRed(card), {
        width: 72,
        height: 100
      });
      if (animated && source) {
        cardFace.setPosition(source.x, source.y).setAlpha(0.2).setScale(0.72);
        this.scene.tweens.add({
          targets: cardFace,
          x,
          y,
          alpha: 1,
          scaleX: 1,
          scaleY: 1,
          duration: 180,
          ease: "Cubic.easeOut",
          delay: index * 22
        });
      }
      this.lastPlayLayer.add(cardFace);
    });
  }

  renderReplayLastPlay(cardIds: readonly string[]): void {
    this.lastPlayLayer.removeAll(true);
    const startX = 640 - Math.max(0, cardIds.length - 1) * 24;
    cardIds.forEach((cardId, index) => {
      const x = startX + index * 48;
      const cardFace = createCardFace(this.scene, x, LAST_PLAY_Y, formatCardId(cardId), isRedCardId(cardId), {
        fontSize: "17px",
        width: 72,
        height: 100
      });
      this.lastPlayLayer.add(cardFace);
    });
  }
}

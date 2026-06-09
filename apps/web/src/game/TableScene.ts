import Phaser from "phaser";
import { identifyCombination, suggestPlay, type Card, type CardId } from "@ddz/domain";
import { gameSnapshotSchema } from "@ddz/protocol";
import type { CardDto, GameEvent, GameSnapshotDto, RoundHistoryActionDto, RoundReplayDto } from "@ddz/protocol";
import { describeSelectedCards, validateSelectedPlay } from "./playValidation";
import { describeEventFeedback, describePhasePrompt, describeSettlement, describeSnapshotStatus } from "./tablePresentation";
import { getTableDevicePixelRatio, TABLE_STAGE_HEIGHT, TABLE_STAGE_WIDTH } from "./tableConfig";

export interface TableGameBridge {
  applyEvent(event: GameEvent): void;
  applyReplay(replay: RoundReplayDto | null, step: number): void;
}

interface TableSceneOptions {
  readonly localPlayerId: string;
  readonly onPass: () => void;
  readonly onPlay: (cards: readonly CardId[]) => void;
}

type SoundKey = "sound-click" | "sound-select" | "sound-play" | "sound-pass" | "sound-deal" | "sound-start";
type CardSuit = "♥" | "♦" | "♠" | "♣";

interface RenderedHandCard {
  readonly id: CardId;
  readonly bounds: Phaser.Geom.Rectangle;
}

const TEXT_STYLE = {
  fontFamily: "Menlo, monospace",
  fontSize: "16px",
  color: "#f6e7b1",
  resolution: getTableDevicePixelRatio()
} satisfies Phaser.Types.GameObjects.Text.TextStyle;

const BUTTON_WIDTH = 132;
const BUTTON_HEIGHT = 79;
const SEAT_POSITIONS = [
  { x: 640, y: 198 },
  { x: 216, y: 360 },
  { x: 1064, y: 360 }
] as const;

export class TableScene extends Phaser.Scene implements TableGameBridge {
  private readonly selected = new Set<CardId>();
  private hand: CardDto[] = [];
  private snapshot: GameSnapshotDto | null = null;
  private statusText?: Phaser.GameObjects.Text;
  private phaseText?: Phaser.GameObjects.Text;
  private actionText?: Phaser.GameObjects.Text;
  private settlementText?: Phaser.GameObjects.Text;
  private replayText?: Phaser.GameObjects.Text;
  private landlordCardsLayer?: Phaser.GameObjects.Container;
  private settlementLayer?: Phaser.GameObjects.Container;
  private handLayer?: Phaser.GameObjects.Container;
  private lastPlayLayer?: Phaser.GameObjects.Container;
  private seatsLayer?: Phaser.GameObjects.Container;
  private renderedHandCards: RenderedHandCard[] = [];
  private dragSelection:
    | {
        readonly pointerId: number;
        readonly mode: "add" | "remove";
        readonly touched: Set<CardId>;
        moved: boolean;
      }
    | null = null;

  constructor(private readonly options: TableSceneOptions) {
    super("TableScene");
  }

  preload(): void {
    this.load.image("table-bg", "/assets/images/generated/table_room.png");
    this.load.image("card-back", "/assets/images/generated/card_back.png");
    this.load.image("coin", "/assets/images/generated/coin.png");
    this.load.image("suit-hearts", "/assets/images/heart.png");
    this.load.image("suit-diamonds", "/assets/images/diamond.png");
    this.load.image("suit-spades", "/assets/images/spade.png");
    this.load.image("suit-clubs", "/assets/images/club.png");
    this.load.image("play-button", "/assets/images/generated/button/play.png");
    this.load.image("pass-button", "/assets/images/generated/button/pass.png");
    this.load.image("tip-button", "/assets/images/generated/button/tip.png");

    this.load.audio("sound-click", "/assets/audio/click.mp3");
    this.load.audio("sound-select", "/assets/audio/select.mp3");
    this.load.audio("sound-play", "/assets/audio/play.mp3");
    this.load.audio("sound-pass", "/assets/audio/pass0.mp3");
    this.load.audio("sound-deal", "/assets/audio/deal.mp3");
    this.load.audio("sound-start", "/assets/audio/start.mp3");
  }

  create(): void {
    this.fitStageToCanvas();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitStageToCanvas, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitStageToCanvas, this);
    });
    this.add.image(640, 360, "table-bg").setDisplaySize(1280, 720);
    this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.18);

    this.add.rectangle(380, 82, 690, 96, 0x11150f, 0.58).setStrokeStyle(1, 0xf1c45d, 0.28);
    this.statusText = this.add.text(56, 44, "等待服务端状态", {
      ...TEXT_STYLE,
      fontSize: "15px"
    });
    this.settlementText = this.add.text(56, 106, "", {
      ...TEXT_STYLE,
      color: "#f4c542"
    });
    this.replayText = this.add.text(56, 146, "", {
      ...TEXT_STYLE,
      color: "#d6f5dc",
      wordWrap: {
        width: 760
      }
    });
    this.phaseText = this.add
      .text(640, 246, "等待玩家入座", {
        ...TEXT_STYLE,
        fontSize: "30px",
        color: "#f4c542"
      })
      .setOrigin(0.5)
      .setDepth(15);
    this.actionText = this.add
      .text(640, 298, "", {
        ...TEXT_STYLE,
        fontSize: "22px",
        color: "#d6f5dc",
        backgroundColor: "rgba(17, 21, 15, 0.72)"
      })
      .setOrigin(0.5)
      .setPadding(18, 8, 18, 8)
      .setDepth(16)
      .setAlpha(0);

    this.seatsLayer = this.add.container(0, 0);
    this.landlordCardsLayer = this.add.container(0, 0);
    this.settlementLayer = this.add.container(0, 0).setDepth(22).setVisible(false);
    this.lastPlayLayer = this.add.container(0, 0);
    this.handLayer = this.add.container(0, 0);
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.handleHandDragMove(pointer);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      this.finishHandDrag(pointer);
    });

    this.createImageButton(888, 646, "tip-button", "提示", () => {
      this.applySuggestion();
    });
    this.createImageButton(1038, 646, "pass-button", "不出", () => {
      if (!this.ensureLocalTurn()) {
        return;
      }
      this.playSound("sound-pass");
      this.options.onPass();
    });
    this.createImageButton(1188, 646, "play-button", "出牌", () => {
      const validation = validateSelectedPlay(this.hand, this.selected, this.snapshot, this.options.localPlayerId);
      if (!validation.ok) {
        this.replayText?.setText(validation.reason);
        return;
      }
      this.playSound("sound-play");
      this.options.onPlay(validation.cardIds);
      this.selected.clear();
      this.renderHand();
    });
  }

  private fitStageToCanvas(): void {
    const scale = Math.min(this.scale.width / TABLE_STAGE_WIDTH, this.scale.height / TABLE_STAGE_HEIGHT);
    const camera = this.cameras.main;
    camera.setZoom(scale);
    camera.centerOn(TABLE_STAGE_WIDTH / 2, TABLE_STAGE_HEIGHT / 2);
  }

  applyEvent(event: GameEvent): void {
    this.replayText?.setText("");
    const feedback = describeEventFeedback(event, this.options.localPlayerId);
    if (feedback) {
      this.showActionFeedback(feedback, event.type === "command_rejected" ? 0xff8f70 : 0xd6f5dc);
    }

    if ("snapshot" in event) {
      this.snapshot = event.snapshot;
      this.renderStatus(event.snapshot);
      this.renderSeats(event.snapshot);
      this.renderLandlordCards(event.snapshot);
      this.renderSettlementOverlay(event.snapshot);
    }

    if (event.type === "room_failed") {
      this.statusText?.setText(`房间故障: ${event.reason}`);
    }

    if ("hand" in event) {
      this.hand = event.hand;
      this.pruneSelectedCards();
      this.renderHand();
    }

    if (event.type === "round_started") {
      this.playSound("sound-start");
      this.playSound("sound-deal");
      this.lastPlayLayer?.removeAll(true);
      this.settlementText?.setText("");
      this.settlementLayer?.setVisible(false);
    }

    if (event.type === "landlord_bid" || event.type === "landlord_robbed") {
      this.playSound("sound-click");
    }

    if (event.type === "cards_played") {
      this.playSound("sound-play");
      this.renderLastPlay(event.play.cards, event.play.playerId);
    }

    if (event.type === "player_passed") {
      this.playSound("sound-pass");
    }

    if (event.type === "round_settled") {
      this.hand = event.hand;
      this.pruneSelectedCards();
      this.renderHand();
      this.settlementText?.setText(
        [
          `赢家: ${shortId(event.settlement.winnerId)}`,
          `地主: ${shortId(event.settlement.landlordId)}`,
          ...event.settlement.players.map((player) => `${shortId(player.playerId)}: ${formatScore(player.scoreDelta)}`)
        ].join("  ")
      );
    }

    if (event.type === "command_rejected") {
      this.statusText?.setText(`命令被拒绝: ${event.reason}`);
    }
  }

  applyReplay(replay: RoundReplayDto | null, step: number): void {
    if (!replay) {
      this.replayText?.setText("");
      return;
    }

    this.selected.clear();
    this.hand = [];
    this.snapshot = null;
    this.renderHand();
    const currentStep = Math.min(Math.max(step, 0), Math.max(0, replay.actions.length - 1));
    const action = replay.actions[currentStep];
    const snapshot = action ? parseReplaySnapshot(action.payload.snapshot) : null;
    this.statusText?.setText(`回放: ${replay.roomCode}  ${currentStep + 1}/${Math.max(1, replay.actions.length)}`);
    if (snapshot) {
      this.snapshot = snapshot;
      this.renderStatus(snapshot);
      this.renderSeats(snapshot);
      this.renderLandlordCards(snapshot);
      this.renderSettlementOverlay(snapshot);
      this.settlementText?.setText(snapshot.settlement ? formatSettlement(snapshot.settlement) : formatReplayScore(replay));
      this.replayText?.setText(action ? formatReplayAction(action) : "暂无回放事件");
    } else {
      this.renderReplaySeats(replay);
      this.renderLandlordCards(null);
      this.settlementLayer?.setVisible(false);
      this.settlementText?.setText(formatReplayScore(replay));
      this.replayText?.setText(action ? `历史事件缺少快照: ${formatReplayAction(action)}` : "暂无回放事件");
    }

    if (snapshot?.lastPlay) {
      this.renderLastPlay(snapshot.lastPlay.cards, snapshot.lastPlay.playerId, false);
    } else if (action?.type === "cards_played") {
      this.renderReplayLastPlay(parseReplayCardIds(action.payload.cards));
    } else {
      this.lastPlayLayer?.removeAll(true);
    }
  }

  private createImageButton(x: number, y: number, texture: string, label: string, onClick: () => void): void {
    const button = this.add.image(x, y, texture).setDisplaySize(BUTTON_WIDTH, BUTTON_HEIGHT).setInteractive({
      useHandCursor: true
    });
    this.add
      .text(x, y + 13, label, {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "17px",
        fontStyle: "800",
        color: "#fff6d3",
        stroke: "#2f1f0b",
        strokeThickness: 4
      })
      .setOrigin(0.5);

    button.on("pointerdown", () => {
      button.setTint(0xd7f5ff);
    });
    button.on("pointerout", () => {
      button.clearTint();
    });
    button.on("pointerup", () => {
      button.clearTint();
      this.playSound("sound-click");
      onClick();
    });
  }

  private renderHand(): void {
    if (!this.handLayer) {
      return;
    }

    this.handLayer.removeAll(true);
    this.renderedHandCards = [];
    const cardWidth = 74;
    const cardHeight = 106;
    const gap = 30;
    const totalWidth = cardWidth + Math.max(0, this.hand.length - 1) * gap;
    const startX = 640 - totalWidth / 2;

    this.hand.forEach((card, index) => {
      const cardId = card.id as CardId;
      const selected = this.selected.has(cardId);
      const x = startX + index * gap;
      const y = selected ? 558 : 590;
      const cardFace = this.createCardFace(x, y, formatCard(card), isRed(card), {
        interactive: true,
        selected,
        width: cardWidth,
        height: cardHeight
      });
      this.renderedHandCards.push({
        id: cardId,
        bounds: new Phaser.Geom.Rectangle(x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight)
      });

      cardFace.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        const mode = this.selected.has(cardId) ? "remove" : "add";
        this.dragSelection = {
          pointerId: pointer.id,
          mode,
          touched: new Set<CardId>(),
          moved: false
        };
        this.applyDragSelection(cardId);
      });

      this.handLayer?.add(cardFace);
    });
  }

  private applySuggestion(): void {
    if (!this.snapshot || this.snapshot.phase !== "playing") {
      this.replayText?.setText("提示仅在出牌阶段可用");
      return;
    }
    if (!this.ensureLocalTurn()) {
      return;
    }

    const previousCards = this.snapshot.lastPlay?.cards ?? null;
    const previous = previousCards ? identifyCombination(previousCards.map(toDomainCard)) : null;
    if (previousCards && !previous) {
      this.replayText?.setText("上一手牌型无法识别，不能生成提示");
      return;
    }
    const suggestion = suggestPlay(this.hand.map(toDomainCard), previous);
    if (!suggestion) {
      this.selected.clear();
      this.renderHand();
      this.replayText?.setText("没有可压过上一手的牌");
      return;
    }

    this.selected.clear();
    for (const card of suggestion) {
      this.selected.add(card.id);
    }
    this.playSound("sound-select");
    this.renderHand();
    this.replayText?.setText(`提示: ${describeSelectedCards(this.hand, this.selected)}`);
  }

  private ensureLocalTurn(): boolean {
    if (this.snapshot?.phase !== "playing") {
      this.replayText?.setText("当前不是出牌阶段");
      return false;
    }

    if (!this.options.localPlayerId) {
      this.replayText?.setText("尚未绑定本地玩家");
      return false;
    }

    if (this.snapshot.currentPlayerId !== this.options.localPlayerId) {
      this.replayText?.setText("还没轮到你出牌");
      return false;
    }

    return true;
  }

  private renderStatus(snapshot: GameSnapshotDto): void {
    this.statusText?.setText(describeSnapshotStatus(snapshot, this.options.localPlayerId));
    this.phaseText?.setText(describePhasePrompt(snapshot, this.options.localPlayerId));
  }

  private renderSeats(snapshot: GameSnapshotDto): void {
    const seatsLayer = this.seatsLayer;
    if (!seatsLayer) {
      return;
    }

    seatsLayer.removeAll(true);

    snapshot.players.forEach((player) => {
      const position = SEAT_POSITIONS[player.seat];
      if (!position) {
        return;
      }

      const active = snapshot.currentPlayerId === player.id;
      const rect = this.add
        .rectangle(position.x, position.y, 214, 74, 0x11150f, 0.78)
        .setStrokeStyle(active ? 3 : 2, active ? 0xf4c542 : 0x6b4c1c, active ? 0.9 : 0.58);
      const coin = this.add.image(position.x - 82, position.y - 18, "coin").setDisplaySize(28, 28);
      const landlord = snapshot.landlordId === player.id ? " 地主" : "";
      const label = this.add.text(position.x - 54, position.y - 28, `#${player.seat + 1} ${shortId(player.id)}${landlord}`, {
        ...TEXT_STYLE,
        fontSize: "14px"
      });
      const meta = this.add.text(
        position.x - 54,
        position.y - 4,
        `${player.ready ? "已准备" : "未准备"}  手牌 ${player.handCount}  分 ${player.score}`,
        {
          ...TEXT_STYLE,
          fontSize: "12px",
          color: player.connected ? "#d6f5dc" : "#ff8f70"
        }
      );

      this.addCardBackStack(seatsLayer, position.x + 35, position.y + 19, player.handCount);
      seatsLayer.add([rect, coin, label, meta]);
    });
  }

  private renderLandlordCards(snapshot: GameSnapshotDto | null): void {
    const layer = this.landlordCardsLayer;
    if (!layer) {
      return;
    }

    layer.removeAll(true);
    const cards = snapshot?.landlordCards ?? [];
    const revealed = cards.length > 0;
    const label = this.add.text(640, 88, revealed ? "地主底牌" : "底牌待定", {
      ...TEXT_STYLE,
      fontSize: "14px",
      color: "#f4c542"
    }).setOrigin(0.5);
    layer.add(label);

    const startX = 640 - 58;
    for (let index = 0; index < 3; index += 1) {
      const card = cards[index];
      const x = startX + index * 58;
      if (card) {
        const cardFace = this.createCardFace(x, 126, formatCard(card), isRed(card), {
          fontSize: "14px",
          width: 48,
          height: 68
        });
        layer.add(cardFace);
      } else {
        const cardBack = this.add.image(x, 126, "card-back").setDisplaySize(48, 68).setAlpha(revealed ? 1 : 0.72);
        layer.add(cardBack);
      }
    }
  }

  private renderSettlementOverlay(snapshot: GameSnapshotDto): void {
    const layer = this.settlementLayer;
    if (!layer) {
      return;
    }

    layer.removeAll(true);
    if (!snapshot.settlement) {
      layer.setVisible(false);
      return;
    }

    const rows = describeSettlement(snapshot, this.options.localPlayerId);
    const backdrop = this.add.rectangle(640, 388, 560, 254, 0x11150f, 0.92).setStrokeStyle(2, 0xf4c542, 0.68);
    const title = this.add.text(640, 298, "本局结算", {
      ...TEXT_STYLE,
      fontSize: "28px",
      color: "#f4c542"
    }).setOrigin(0.5);
    layer.add([backdrop, title]);

    rows.forEach((row, index) => {
      const text = this.add.text(420, 340 + index * 30, row, {
        ...TEXT_STYLE,
        fontSize: index < 2 ? "17px" : "15px",
        color: index < 2 ? "#f6e7b1" : "#d6f5dc"
      });
      layer.add(text);
    });

    layer.setVisible(true).setAlpha(0);
    this.tweens.add({
      targets: layer,
      alpha: 1,
      duration: 180,
      ease: "Cubic.easeOut"
    });
  }

  private renderLastPlay(cards: readonly CardDto[], playerId?: string, animated = true): void {
    if (!this.lastPlayLayer) {
      return;
    }

    this.lastPlayLayer.removeAll(true);
    const startX = 640 - Math.max(0, cards.length - 1) * 24;
    const source = playerId ? this.findSeatPosition(playerId) : null;
    cards.forEach((card, index) => {
      const x = startX + index * 48;
      const y = 320;
      const cardFace = this.createCardFace(x, 320, formatCard(card), isRed(card), {
        width: 72,
        height: 100
      });
      if (animated && source) {
        cardFace.setPosition(source.x, source.y).setAlpha(0.2).setScale(0.72);
        this.tweens.add({
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
      this.lastPlayLayer?.add(cardFace);
    });
  }

  private renderReplayLastPlay(cardIds: readonly string[]): void {
    if (!this.lastPlayLayer) {
      return;
    }

    this.lastPlayLayer.removeAll(true);
    const startX = 640 - Math.max(0, cardIds.length - 1) * 24;
    cardIds.forEach((cardId, index) => {
      const x = startX + index * 48;
      const cardFace = this.createCardFace(x, 320, formatCardId(cardId), isRedCardId(cardId), {
        fontSize: "17px",
        width: 72,
        height: 100
      });
      this.lastPlayLayer?.add(cardFace);
    });
  }

  private renderReplaySeats(replay: RoundReplayDto): void {
    const seatsLayer = this.seatsLayer;
    if (!seatsLayer) {
      return;
    }

    seatsLayer.removeAll(true);

    replay.players.forEach((player) => {
      const position = SEAT_POSITIONS[player.seat];
      if (!position) {
        return;
      }

      const rect = this.add.rectangle(position.x, position.y, 214, 74, 0x11150f, 0.78).setStrokeStyle(2, 0x6b4c1c, 0.58);
      const coin = this.add.image(position.x - 82, position.y - 18, "coin").setDisplaySize(28, 28);
      const label = this.add.text(position.x - 54, position.y - 28, `#${player.seat + 1} ${shortId(player.playerId)}`, {
        ...TEXT_STYLE,
        fontSize: "14px"
      });
      const meta = this.add.text(position.x - 54, position.y - 4, `分 ${player.score}  流水 ${formatScore(player.coinDelta)}`, {
        ...TEXT_STYLE,
        fontSize: "12px",
        color: "#d6f5dc"
      });

      this.addCardBackStack(seatsLayer, position.x + 35, position.y + 19, 5);
      seatsLayer.add([rect, coin, label, meta]);
    });
  }

  private createCardFace(
    x: number,
    y: number,
    label: string,
    red: boolean,
    options: {
      readonly fontSize?: string;
      readonly height: number;
      readonly interactive?: boolean;
      readonly selected?: boolean;
      readonly width: number;
    }
  ): Phaser.GameObjects.Container {
    const width = options.width;
    const height = options.height;
    const color = red ? "#c41f1f" : "#171717";
    const suit = readCardSuit(label);
    const rank = suit ? label.slice(0, -1) : label;
    const radius = Math.max(5, Math.round(width * 0.08));
    const container = this.add.container(x, y);
    const graphics = this.add.graphics();

    graphics.fillStyle(0x000000, 0.26);
    graphics.fillRoundedRect(-width / 2 + 3, -height / 2 + 4, width, height, radius);
    graphics.fillStyle(0xfffbef, 1);
    graphics.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    graphics.fillStyle(0xf3ead6, 1);
    graphics.fillRoundedRect(-width / 2 + 4, -height / 2 + 4, width - 8, height - 8, Math.max(3, radius - 2));
    graphics.lineStyle(options.selected ? 3 : 1, options.selected ? 0xf4c542 : 0xb68f5a, options.selected ? 1 : 0.72);
    graphics.strokeRoundedRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, radius);
    graphics.lineStyle(1, 0xffffff, 0.56);
    graphics.strokeRoundedRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, Math.max(3, radius - 2));

    container.add(graphics);

    if (suit) {
      this.addStandardCardFace(container, rank, suit, color, width, height, options.fontSize);
    } else {
      this.addJokerCardFace(container, label, red, width, height, options.fontSize);
    }

    if (options.selected) {
      const selectedMark = this.add
        .text(0, -height / 2 - 10, "已选", {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "11px",
          fontStyle: "800",
          color: "#1a1206",
          backgroundColor: "#f4c542",
          padding: {
            x: 6,
            y: 2
          }
        })
        .setOrigin(0.5);
      container.add(selectedMark);
    }

    container.setSize(width, height);
    if (options.interactive) {
      container.setInteractive(
        new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
        Phaser.Geom.Rectangle.Contains,
        false
      );
    }

    return container;
  }

  private addStandardCardFace(
    container: Phaser.GameObjects.Container,
    rank: string,
    suit: CardSuit,
    color: string,
    width: number,
    height: number,
    fontSize?: string
  ): void {
    const rankSize = fontSize ?? `${Math.max(16, Math.round(width * 0.28))}px`;
    const cornerSuitSize = `${Math.max(12, Math.round(width * 0.18))}px`;
    const cornerX = -width / 2 + Math.max(6, width * 0.1);
    const cornerY = -height / 2 + Math.max(5, height * 0.08);
    const rightX = width / 2 - Math.max(6, width * 0.1);
    const rightY = height / 2 - Math.max(5, height * 0.08);
    const suitKey = suitImageKey(suit);
    const centerSuit = this.add
      .image(0, height * 0.08, suitKey)
      .setDisplaySize(width * 0.46, width * 0.46)
      .setAlpha(0.94);
    const topRank = this.add.text(cornerX, cornerY, rank, cardTextStyle(rankSize, color)).setOrigin(0, 0);
    const topSuit = this.add
      .text(cornerX + width * 0.02, cornerY + height * 0.21, suit, cardTextStyle(cornerSuitSize, color))
      .setOrigin(0, 0);
    const bottomRank = this.add.text(rightX, rightY, rank, cardTextStyle(rankSize, color)).setOrigin(1, 1);
    const bottomSuit = this.add
      .text(rightX - width * 0.02, rightY - height * 0.21, suit, cardTextStyle(cornerSuitSize, color))
      .setOrigin(1, 1);

    container.add([centerSuit, topRank, topSuit, bottomRank, bottomSuit]);
  }

  private addJokerCardFace(
    container: Phaser.GameObjects.Container,
    label: string,
    red: boolean,
    width: number,
    height: number,
    fontSize?: string
  ): void {
    const color = red ? "#c41f1f" : "#171717";
    const centerColor = red ? "#d22b2b" : "#222222";
    const cornerSize = fontSize ?? `${Math.max(13, Math.round(width * 0.2))}px`;
    const centerSize = `${Math.max(28, Math.round(width * 0.42))}px`;
    const cornerX = -width / 2 + Math.max(6, width * 0.1);
    const cornerY = -height / 2 + Math.max(6, height * 0.08);
    const rightX = width / 2 - Math.max(6, width * 0.1);
    const rightY = height / 2 - Math.max(6, height * 0.08);
    const topText = this.add.text(cornerX, cornerY, label, cardTextStyle(cornerSize, color)).setOrigin(0, 0);
    const centerText = this.add
      .text(0, height * 0.02, "王", {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: centerSize,
        fontStyle: "900",
        color: centerColor,
        stroke: "#f9e8bd",
        strokeThickness: Math.max(2, Math.round(width * 0.04))
      })
      .setOrigin(0.5);
    const bottomText = this.add.text(rightX, rightY, label, cardTextStyle(cornerSize, color)).setOrigin(1, 1);

    container.add([topText, centerText, bottomText]);
  }

  private addCardBackStack(layer: Phaser.GameObjects.Container, x: number, y: number, count: number): void {
    const visibleCards = Math.min(4, Math.max(0, count));
    for (let index = 0; index < visibleCards; index += 1) {
      const cardBack = this.add
        .image(x + index * 10, y, "card-back")
        .setDisplaySize(28, 41)
        .setAngle(-8 + index * 4);
      layer.add(cardBack);
    }

    const countText = this.add.text(x + 58, y - 9, `x${count}`, {
      ...TEXT_STYLE,
      fontSize: "12px",
      color: "#f4c542"
    });
    layer.add(countText);
  }

  private playSound(key: SoundKey): void {
    const played = this.sound.play(key, {
      volume: key === "sound-select" ? 0.45 : 0.62
    });

    if (!played) {
      const message = `音效播放失败: ${key}`;
      this.replayText?.setText(message);
      console.warn(message);
    }
  }

  private showActionFeedback(message: string, color: number): void {
    if (!this.actionText) {
      return;
    }

    this.tweens.killTweensOf(this.actionText);
    this.actionText.setText(message).setColor(`#${color.toString(16).padStart(6, "0")}`).setAlpha(1).setScale(0.92);
    this.tweens.add({
      targets: this.actionText,
      alpha: 0,
      scaleX: 1,
      scaleY: 1,
      duration: 900,
      ease: "Cubic.easeOut",
      hold: 550
    });
  }

  private pruneSelectedCards(): void {
    const handIds = new Set(this.hand.map((card) => card.id));
    for (const cardId of this.selected) {
      if (!handIds.has(cardId)) {
        this.selected.delete(cardId);
      }
    }
  }

  private findSeatPosition(playerId: string): (typeof SEAT_POSITIONS)[number] | null {
    const player = this.snapshot?.players.find((item) => item.id === playerId);
    return player ? SEAT_POSITIONS[player.seat] ?? null : null;
  }

  private handleHandDragMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragSelection || this.dragSelection.pointerId !== pointer.id) {
      return;
    }

    if (Math.abs(pointer.position.x - pointer.downX) > 6 || Math.abs(pointer.position.y - pointer.downY) > 6) {
      this.dragSelection.moved = true;
    }

    const cardId = this.findRenderedHandCard(pointer.worldX, pointer.worldY);
    if (cardId) {
      this.applyDragSelection(cardId);
    }
  }

  private finishHandDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.dragSelection || this.dragSelection.pointerId !== pointer.id) {
      return;
    }

    const touched = this.dragSelection.touched.size;
    this.dragSelection = null;
    if (touched > 0) {
      this.playSound("sound-select");
      this.replayText?.setText(describeSelectedCards(this.hand, this.selected));
      this.renderHand();
    }
  }

  private applyDragSelection(cardId: CardId): void {
    const drag = this.dragSelection;
    if (!drag || drag.touched.has(cardId)) {
      return;
    }

    if (drag.mode === "add") {
      this.selected.add(cardId);
    } else {
      this.selected.delete(cardId);
    }

    drag.touched.add(cardId);
  }

  private findRenderedHandCard(x: number, y: number): CardId | null {
    for (let index = this.renderedHandCards.length - 1; index >= 0; index -= 1) {
      const card = this.renderedHandCards[index];
      if (card && Phaser.Geom.Rectangle.Contains(card.bounds, x, y)) {
        return card.id;
      }
    }

    return null;
  }
}

function formatCard(card: CardDto): string {
  if (card.id === "SJ") {
    return "小王";
  }
  if (card.id === "BJ") {
    return "大王";
  }
  const suit = card.suit === "hearts" ? "♥" : card.suit === "diamonds" ? "♦" : card.suit === "spades" ? "♠" : "♣";
  return `${card.rank}${suit}`;
}

function isRed(card: CardDto): boolean {
  return card.suit === "hearts" || card.suit === "diamonds" || card.id === "BJ";
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

function cardTextStyle(fontSize: string, color: string): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize,
    fontStyle: "900",
    color
  };
}

function toDomainCard(card: CardDto): Card {
  if (card.suit === undefined) {
    return {
      id: card.id,
      rank: card.rank
    };
  }

  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit
  };
}

function formatScore(score: number): string {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatReplayScore(replay: RoundReplayDto): string {
  const endedAt = replay.endedAt ? `结束: ${new Date(replay.endedAt).toLocaleString("zh-CN")}` : "进行中";
  return [
    `地主: ${replay.landlordId ? shortId(replay.landlordId) : "-"}`,
    endedAt,
    ...replay.players.map((player) => `${shortId(player.playerId)} ${formatScore(player.coinDelta)}`)
  ].join("  ");
}

function formatSettlement(settlement: NonNullable<GameSnapshotDto["settlement"]>): string {
  return [
    `赢家: ${shortId(settlement.winnerId)}`,
    `地主: ${shortId(settlement.landlordId)}`,
    ...settlement.players.map((player) => `${shortId(player.playerId)} ${formatScore(player.scoreDelta)}`)
  ].join("  ");
}

function formatReplayAction(action: RoundHistoryActionDto): string {
  const actor = action.playerId ? shortId(action.playerId) : "系统";
    switch (action.type) {
      case "round_started":
        return "开局发牌";
      case "landlord_bid":
        return `${actor} ${action.payload.called === true ? "叫地主" : "不叫"}`;
    case "landlord_robbed":
      return `${actor} ${action.payload.robbed === true ? "抢地主" : "不抢"}`;
    case "cards_played":
      return `${actor} 出牌 ${parseReplayCardIds(action.payload.cards).map(formatCardId).join(" ")}`;
    case "player_passed":
      return `${actor} 过牌`;
      case "round_settled":
        return `${actor} 完成结算`;
    }
  }

function parseReplaySnapshot(value: unknown): GameSnapshotDto | null {
  const parsed = gameSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseReplayCardIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

function formatCardId(cardId: string): string {
  if (cardId === "SJ") {
    return "小王";
  }
  if (cardId === "BJ") {
    return "大王";
  }

  const [rank, suit] = cardId.split("-");
  const suitText = suit === "hearts" ? "♥" : suit === "diamonds" ? "♦" : suit === "spades" ? "♠" : "♣";
  return `${rank ?? cardId}${suit ? suitText : ""}`;
}

function isRedCardId(cardId: string): boolean {
  return cardId.includes("-hearts") || cardId.includes("-diamonds") || cardId === "BJ";
}

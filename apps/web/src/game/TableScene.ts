import Phaser from "phaser";
import { identifyCombination, suggestPlay, type CardId } from "@ddz/domain";
import { gameSnapshotSchema } from "@ddz/protocol";
import type { CardDto, GameEvent, GameSnapshotDto, RoundReplayDto } from "@ddz/protocol";
import { describeSelectedCards, toDomainCard, validateSelectedPlay } from "./playValidation";
import {
  describeEventFeedback,
  describePhasePrompt,
  describeSettlement,
  formatActor,
  formatCardId,
  formatReplayAction,
  formatScore,
  isRedCardId,
  parseReplayCardIds
} from "./tablePresentation";
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

type SoundKey =
  | "sound-click"
  | "sound-select"
  | "sound-play"
  | "sound-pass"
  | "sound-deal"
  | "sound-start"
  | "sound-win"
  | "sound-lose";
type CardSuit = "♥" | "♦" | "♠" | "♣";

interface RenderedHandCard {
  readonly id: CardId;
  readonly bounds: Phaser.Geom.Rectangle;
}

const TEXT_STYLE = {
  fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontSize: "16px",
  fontStyle: "700",
  color: "#fff6e0",
  resolution: getTableDevicePixelRatio()
} satisfies Phaser.Types.GameObjects.Text.TextStyle;

const INK = "#5b3a1e";
const INK_SOFT = "#7a5a36";
const ACCENT = "#d8820c";

const BUTTON_WIDTH = 132;
const BUTTON_HEIGHT = 79;
// 按相对本地玩家的座位渲染：0 = 自己（左下），1 = 下家（右上），2 = 上家（左上）
const RELATIVE_SEAT_POSITIONS = [
  { x: 176, y: 556 },
  { x: 1064, y: 300 },
  { x: 216, y: 300 }
] as const;

export class TableScene extends Phaser.Scene implements TableGameBridge {
  private readonly selected = new Set<CardId>();
  private hand: CardDto[] = [];
  private snapshot: GameSnapshotDto | null = null;
  private replayMode = false;
  // React 状态可能先于场景 create() 到达，缓存待应用的回放与进入回放前的直播状态
  private replayState: { readonly replay: RoundReplayDto; readonly step: number } | null = null;
  private liveState: { readonly snapshot: GameSnapshotDto | null; readonly hand: CardDto[] } | null = null;
  private phaseText?: Phaser.GameObjects.Text;
  private actionText?: Phaser.GameObjects.Text;
  private feedbackText?: Phaser.GameObjects.Text;
  private playControls: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [];
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
    this.load.image("table-bg", "/assets/images/generated/lobby/bg_table.jpg");
    this.load.image("card-back", "/assets/images/generated/lobby/card_back.png");
    this.load.image("coin", "/assets/images/coin.png");
    this.load.image("suit-hearts", "/assets/images/heart.png");
    this.load.image("suit-diamonds", "/assets/images/diamond.png");
    this.load.image("suit-spades", "/assets/images/spade.png");
    this.load.image("suit-clubs", "/assets/images/club.png");
    this.load.image("play-button", "/assets/images/generated/lobby/btn_pill_orange.png");
    this.load.image("pass-button", "/assets/images/generated/lobby/btn_pill_green.png");
    this.load.image("tip-button", "/assets/images/generated/lobby/btn_pill_blue.png");

    this.load.audio("sound-click", "/assets/audio/click.mp3");
    this.load.audio("sound-select", "/assets/audio/select.mp3");
    this.load.audio("sound-play", "/assets/audio/play.mp3");
    this.load.audio("sound-pass", "/assets/audio/pass0.mp3");
    this.load.audio("sound-deal", "/assets/audio/deal.mp3");
    this.load.audio("sound-start", "/assets/audio/start.mp3");
    this.load.audio("sound-win", "/assets/audio/end_win.mp3");
    this.load.audio("sound-lose", "/assets/audio/end_lose.mp3");
  }

  create(): void {
    this.fitStageToCanvas();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitStageToCanvas, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitStageToCanvas, this);
    });
    this.add.image(640, 360, "table-bg").setDisplaySize(1280, 720);

    this.feedbackText = this.add
      .text(640, 502, "", {
        ...TEXT_STYLE,
        fontSize: "15px",
        backgroundColor: "rgba(74, 42, 16, 0.78)",
        wordWrap: {
          width: 760
        }
      })
      .setOrigin(0.5)
      .setPadding(14, 6, 14, 6)
      .setDepth(18)
      .setVisible(false);
    this.phaseText = this.add
      .text(640, 246, "等待玩家入座", {
        ...TEXT_STYLE,
        fontSize: "30px",
        fontStyle: "900",
        color: "#ffffff",
        stroke: INK,
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(15);
    this.actionText = this.add
      .text(640, 298, "", {
        ...TEXT_STYLE,
        fontSize: "22px",
        color: "#fff6e0",
        backgroundColor: "rgba(74, 42, 16, 0.78)"
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
        this.setFeedback(validation.reason);
        return;
      }
      this.playSound("sound-play");
      this.options.onPlay(validation.cardIds);
      this.selected.clear();
      this.renderHand();
    });
    this.updatePlayControls();

    // 场景就绪前到达的 snapshot/hand/回放在此补渲染，避免白屏
    if (this.replayState) {
      this.applyReplay(this.replayState.replay, this.replayState.step);
    } else {
      this.renderLiveState();
    }
  }

  private fitStageToCanvas(): void {
    const scale = Math.min(this.scale.width / TABLE_STAGE_WIDTH, this.scale.height / TABLE_STAGE_HEIGHT);
    const camera = this.cameras.main;
    camera.setZoom(scale);
    camera.centerOn(TABLE_STAGE_WIDTH / 2, TABLE_STAGE_HEIGHT / 2);
  }

  applyEvent(event: GameEvent): void {
    this.setFeedback("");
    const feedback = describeEventFeedback(event, this.options.localPlayerId);
    if (feedback) {
      this.showActionFeedback(feedback, event.type === "command_rejected" ? 0xff8f70 : 0xd6f5dc);
    }

    if ("snapshot" in event) {
      this.snapshot = event.snapshot;
      this.renderSnapshotViews(event.snapshot);
      if (event.type !== "cards_played") {
        // 同步快照中的上一手牌；cards_played 走下方的动画路径
        this.syncLastPlay(event.snapshot);
      }
    }

    if (event.type === "room_failed") {
      this.setFeedback(`房间故障: ${event.reason}`);
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
      this.playSound(event.settlement.winnerId === this.options.localPlayerId ? "sound-win" : "sound-lose");
    }
  }

  applyReplay(replay: RoundReplayDto | null, step: number): void {
    const wasReplay = this.replayMode;
    this.replayMode = Boolean(replay);

    if (!replay) {
      this.replayState = null;
      if (wasReplay) {
        // 退出回放：恢复进入前暂存的直播状态
        this.snapshot = this.liveState?.snapshot ?? null;
        this.hand = this.liveState?.hand ?? [];
        this.liveState = null;
        this.selected.clear();
        this.renderLiveState();
      }
      this.setFeedback("");
      this.updatePlayControls();
      return;
    }

    if (!wasReplay) {
      // 进入回放：暂存直播状态，退出时恢复
      this.liveState = { snapshot: this.snapshot, hand: this.hand };
    }
    this.replayState = { replay, step };

    this.selected.clear();
    this.hand = [];
    this.snapshot = null;
    this.renderHand();
    this.updatePlayControls();
    const currentStep = Math.min(Math.max(step, 0), Math.max(0, replay.actions.length - 1));
    const action = replay.actions[currentStep];
    const snapshot = action ? parseReplaySnapshot(action.payload.snapshot) : null;
    if (snapshot) {
      this.snapshot = snapshot;
      this.renderSnapshotViews(snapshot);
      this.setFeedback(action ? formatReplayAction(action) : "暂无回放事件");
    } else {
      this.renderReplaySeats(replay);
      this.renderLandlordCards(null);
      this.settlementLayer?.setVisible(false);
      this.setFeedback(action ? `历史事件缺少快照: ${formatReplayAction(action)}` : "暂无回放事件");
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
    const buttonLabel = this.add
      .text(x, y - 3, label, {
        fontFamily: TEXT_STYLE.fontFamily,
        fontSize: "19px",
        fontStyle: "900",
        color: "#ffffff",
        stroke: INK,
        strokeThickness: 4
      })
      .setOrigin(0.5);
    this.playControls.push(button, buttonLabel);

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

  private createSeatPlate(x: number, y: number, active: boolean): Phaser.GameObjects.Graphics {
    const plate = this.add.graphics();
    plate.fillStyle(0x8c5318, active ? 0.85 : 0.5);
    plate.fillRoundedRect(x - 107 + 3, y - 37 + 5, 214, 74, 18);
    plate.fillStyle(0xfff6e0, 0.96);
    plate.fillRoundedRect(x - 107, y - 37, 214, 74, 18);
    plate.lineStyle(active ? 4 : 2, active ? 0xffb300 : 0xb9772f, 1);
    plate.strokeRoundedRect(x - 107, y - 37, 214, 74, 18);
    return plate;
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
      this.setFeedback("提示仅在出牌阶段可用");
      return;
    }
    if (!this.ensureLocalTurn()) {
      return;
    }

    const previousCards = this.snapshot.lastPlay?.cards ?? null;
    const previous = previousCards ? identifyCombination(previousCards.map(toDomainCard)) : null;
    if (previousCards && !previous) {
      this.setFeedback("上一手牌型无法识别，不能生成提示");
      return;
    }
    const suggestion = suggestPlay(this.hand.map(toDomainCard), previous);
    if (!suggestion) {
      this.selected.clear();
      this.renderHand();
      this.setFeedback("没有可压过上一手的牌");
      return;
    }

    this.selected.clear();
    for (const card of suggestion) {
      this.selected.add(card.id);
    }
    this.playSound("sound-select");
    this.renderHand();
    this.setFeedback(`提示: ${describeSelectedCards(this.hand, this.selected)}`);
  }

  private ensureLocalTurn(): boolean {
    if (this.snapshot?.phase !== "playing") {
      this.setFeedback("当前不是出牌阶段");
      return false;
    }

    if (!this.options.localPlayerId) {
      this.setFeedback("尚未绑定本地玩家");
      return false;
    }

    if (this.snapshot.currentPlayerId !== this.options.localPlayerId) {
      this.setFeedback("还没轮到你出牌");
      return false;
    }

    return true;
  }

  /** 渲染快照对应的全部视图（座位/底牌/结算/状态行） */
  private renderSnapshotViews(snapshot: GameSnapshotDto): void {
    this.renderStatus(snapshot);
    this.renderSeats(snapshot);
    this.renderLandlordCards(snapshot);
    this.renderSettlementOverlay(snapshot);
  }

  /** 按快照同步上一手牌区（无动画） */
  private syncLastPlay(snapshot: GameSnapshotDto): void {
    if (snapshot.lastPlay) {
      this.renderLastPlay(snapshot.lastPlay.cards, snapshot.lastPlay.playerId, false);
    } else {
      this.lastPlayLayer?.removeAll(true);
    }
  }

  /** 按当前缓存的直播 snapshot/hand 渲染整桌；无快照时清空各层 */
  private renderLiveState(): void {
    this.renderHand();
    if (this.snapshot) {
      this.renderSnapshotViews(this.snapshot);
      this.syncLastPlay(this.snapshot);
      return;
    }

    this.seatsLayer?.removeAll(true);
    this.renderLandlordCards(null);
    this.settlementLayer?.setVisible(false);
    this.lastPlayLayer?.removeAll(true);
    this.phaseText?.setText("等待玩家入座").setVisible(true);
    this.updatePlayControls();
  }

  private renderStatus(snapshot: GameSnapshotDto): void {
    this.phaseText
      ?.setText(describePhasePrompt(snapshot, this.options.localPlayerId))
      .setVisible(!snapshot.settlement);
    this.updatePlayControls();
  }

  private setFeedback(message: string): void {
    this.feedbackText?.setText(message).setVisible(message.length > 0);
  }

  private updatePlayControls(): void {
    const visible = !this.replayMode && this.snapshot?.phase === "playing";
    for (const control of this.playControls) {
      control.setVisible(visible);
    }
  }

  private renderSeats(snapshot: GameSnapshotDto): void {
    const seatsLayer = this.seatsLayer;
    if (!seatsLayer) {
      return;
    }

    seatsLayer.removeAll(true);
    const localSeat = snapshot.players.find((player) => player.id === this.options.localPlayerId)?.seat ?? null;
    const showReady = snapshot.phase === "waiting" || snapshot.phase === "ready";

    snapshot.players.forEach((player) => {
      const position = this.seatPositionFor(player.seat, localSeat);
      const isLocal = player.id === this.options.localPlayerId;
      const active = snapshot.currentPlayerId === player.id;
      const plate = this.createSeatPlate(position.x, position.y, active);
      const coin = this.add.image(position.x - 82, position.y - 18, "coin").setDisplaySize(28, 28);
      const landlord = snapshot.landlordId === player.id ? " 👑地主" : "";
      const label = this.add.text(
        position.x - 54,
        position.y - 28,
        `${formatActor(player.id, this.options.localPlayerId)}${landlord}`,
        {
          ...TEXT_STYLE,
          fontSize: "14px",
          fontStyle: "900",
          color: INK
        }
      );
      const offline = !player.connected ? "  已离线" : "";
      const meta = this.add.text(
        position.x - 54,
        position.y - 4,
        `${showReady ? (player.ready ? "已准备  " : "未准备  ") : ""}手牌 ${player.handCount}  分 ${player.score}${offline}`,
        {
          ...TEXT_STYLE,
          fontSize: "12px",
          color: player.connected ? INK_SOFT : "#e25840"
        }
      );

      if (!isLocal) {
        this.addCardBackStack(seatsLayer, position.x + 35, position.y + 19, player.handCount);
      }
      seatsLayer.add([plate, coin, label, meta]);
    });
  }

  private seatPositionFor(seat: number, localSeat: number | null): { x: number; y: number } {
    const relative = localSeat === null ? seat : (seat - localSeat + 3) % 3;
    return RELATIVE_SEAT_POSITIONS[relative] ?? RELATIVE_SEAT_POSITIONS[0];
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
      fontStyle: "900",
      color: "#ffffff",
      stroke: INK,
      strokeThickness: 4
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
    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x8c5318, 0.6);
    backdrop.fillRoundedRect(360 + 4, 261 + 7, 560, 254, 26);
    backdrop.fillStyle(0xfff6e0, 0.98);
    backdrop.fillRoundedRect(360, 261, 560, 254, 26);
    backdrop.lineStyle(5, 0xb9772f, 1);
    backdrop.strokeRoundedRect(360, 261, 560, 254, 26);
    const title = this.add.text(640, 298, "本局结算", {
      ...TEXT_STYLE,
      fontSize: "28px",
      fontStyle: "900",
      color: ACCENT
    }).setOrigin(0.5);
    layer.add([backdrop, title]);

    rows.forEach((row, index) => {
      // 前 3 行为赢家/地主/倍数摘要，其余为玩家明细
      const text = this.add
        .text(640, 340 + index * 30, row, {
          ...TEXT_STYLE,
          fontSize: index < 3 ? "17px" : "15px",
          fontStyle: index < 3 ? "900" : "700",
          color: index < 3 ? INK : INK_SOFT
        })
        .setOrigin(0.5, 0);
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
    const localSeat = replay.players.find((player) => player.playerId === this.options.localPlayerId)?.seat ?? null;

    replay.players.forEach((player) => {
      const position = this.seatPositionFor(player.seat, localSeat);
      const plate = this.createSeatPlate(position.x, position.y, false);
      const coin = this.add.image(position.x - 82, position.y - 18, "coin").setDisplaySize(28, 28);
      const label = this.add.text(
        position.x - 54,
        position.y - 28,
        formatActor(player.playerId, this.options.localPlayerId),
        {
          ...TEXT_STYLE,
          fontSize: "14px",
          fontStyle: "900",
          color: INK
        }
      );
      const meta = this.add.text(position.x - 54, position.y - 4, `分 ${player.score}  流水 ${formatScore(player.coinDelta)}`, {
        ...TEXT_STYLE,
        fontSize: "12px",
        color: INK_SOFT
      });

      this.addCardBackStack(seatsLayer, position.x + 35, position.y + 19, 5);
      seatsLayer.add([plate, coin, label, meta]);
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
      fontStyle: "900",
      color: "#ffffff",
      stroke: INK,
      strokeThickness: 3
    });
    layer.add(countText);
  }

  private playSound(key: SoundKey): void {
    // 音效失败只记录日志，不打断游戏流程
    try {
      const played = this.sound.play(key, {
        volume: key === "sound-select" ? 0.45 : 0.62
      });
      if (!played) {
        console.warn(`音效播放失败: ${key}`);
      }
    } catch (error) {
      console.warn(`音效播放失败: ${key}`, error);
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

  private findSeatPosition(playerId: string): { x: number; y: number } | null {
    const players = this.snapshot?.players;
    const player = players?.find((item) => item.id === playerId);
    if (!player) {
      return null;
    }

    const localSeat = players?.find((item) => item.id === this.options.localPlayerId)?.seat ?? null;
    return this.seatPositionFor(player.seat, localSeat);
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
      this.setFeedback(describeSelectedCards(this.hand, this.selected));
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

function parseReplaySnapshot(value: unknown): GameSnapshotDto | null {
  const parsed = gameSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
